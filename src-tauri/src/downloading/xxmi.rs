use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::downloading::{QueueJobPayload, XXMIDownloadPayload};
use crate::utils::{empty_dir, prevent_exit, run_async_command, show_dialog};
use crate::DownloadState;
use fischl::download::Extras;
use fischl::utils::extract_archive;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager};

#[cfg(target_os = "linux")]
use crate::utils::db_manager::{
    get_install_info_by_id, get_manifest_info_by_id, update_install_xxmi_config_by_id,
};
#[cfg(target_os = "linux")]
use crate::utils::repo_manager::get_manifest;
#[cfg(target_os = "linux")]
use crate::utils::{apply_xxmi_tweaks, get_mi_path_from_game};

pub fn register_xxmi_download_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_xxmi_download", move |event| {
        let payload: XXMIDownloadPayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::XxmiDownload, QueueJobPayload::XXMI(payload));
        } else {
            let h = a.clone();
            std::thread::spawn(move || {
                let job_id = format!(
                    "direct_xxmi_{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                );
                let _ = run_xxmi_download(h, payload, job_id);
            });
        }
    });
}

pub fn run_xxmi_download(
    app: AppHandle,
    payload: XXMIDownloadPayload,
    job_id: String,
) -> QueueJobOutcome {
    let job_id = Arc::new(job_id);
    let xxmi_path = Path::new(&payload.xxmi_path).to_path_buf();
    let is_update = payload.is_update;
    #[allow(unused_variables)]
    let install_id = payload.install_id.clone();

    let event_name = if is_update {
        "update_progress"
    } else {
        "download_progress"
    };
    let complete_event = if is_update {
        "update_complete"
    } else {
        "download_complete"
    };

    let display_name = if is_update {
        "XXMI Update"
    } else {
        "XXMI Modding Tool"
    };

    let mut dlp = HashMap::new();
    dlp.insert("job_id", job_id.to_string());
    dlp.insert("name", display_name.to_string());
    dlp.insert("progress", "0".to_string());
    dlp.insert("total", "1000".to_string());
    app.emit(event_name, dlp.clone()).unwrap();
    prevent_exit(&app, true);

    // Download XXMI main package
    let r = run_async_command(async {
        Extras::download_xxmi(
            "SpectrumQT/XXMI-Libs-Package".to_string(),
            xxmi_path.to_str().unwrap().to_string(),
            true,
            {
                let app = app.clone();
                let job_id = job_id.clone();
                let event_name = event_name.to_string();
                let display_name = display_name.to_string();
                move |current, total, net_speed, disk_speed| {
                    let mut dlp = HashMap::new();
                    dlp.insert("job_id", job_id.to_string());
                    dlp.insert("name", display_name.clone());
                    dlp.insert("progress", current.to_string());
                    dlp.insert("total", total.to_string());
                    dlp.insert("speed", net_speed.to_string());
                    dlp.insert("disk", disk_speed.to_string());
                    app.emit(&event_name, dlp).unwrap();
                }
            },
        )
        .await
    });

    if r {
        // Extract main XXMI archive
        extract_archive(
            xxmi_path
                .join("xxmi.zip")
                .to_str()
                .unwrap()
                .to_string(),
            xxmi_path.to_str().unwrap().to_string(),
            false,
        );

        // Download game-specific MI packages
        let gimi = String::from("SilentNightSound/GIMI-Package");
        let srmi = String::from("SpectrumQT/SRMI-Package");
        let zzmi = String::from("leotorrez/ZZMI-Package");
        let wwmi = String::from("SpectrumQT/WWMI-Package");
        let himi = String::from("leotorrez/HIMI-Package");

        let dl1 = run_async_command(async {
            Extras::download_xxmi_packages(
                gimi,
                srmi,
                zzmi,
                wwmi,
                himi,
                xxmi_path.to_str().unwrap().to_string(),
            )
            .await
        });

        if dl1 {
            // Extract all MI packages
            for mi in ["gimi", "srmi", "zzmi", "wwmi", "himi"] {
                extract_archive(
                    xxmi_path
                        .join(format!("{mi}.zip"))
                        .to_str()
                        .unwrap()
                        .to_string(),
                    xxmi_path.join(mi).to_str().unwrap().to_string(),
                    false,
                );
                // Link DLLs
                for lib in ["d3d11.dll", "d3dcompiler_47.dll"] {
                    let linkedpath = xxmi_path.join(mi).join(lib);
                    if !linkedpath.exists() {
                        #[cfg(target_os = "linux")]
                        {
                            let _ = std::os::unix::fs::symlink(xxmi_path.join(lib), linkedpath);
                        }
                        #[cfg(target_os = "windows")]
                        {
                            let _ = std::fs::copy(xxmi_path.join(lib), linkedpath);
                        }
                    }
                }
            }

            // Apply XXMI tweaks on Linux
            #[cfg(target_os = "linux")]
            {
                if let Some(id) = install_id {
                    if let Some(ai) = get_install_info_by_id(&app, id) {
                        if let Some(repm) = get_manifest_info_by_id(&app, ai.manifest_id) {
                            if let Some(gm) = get_manifest(&app, repm.filename) {
                                let exe = gm
                                    .paths
                                    .exe_filename
                                    .clone()
                                    .split('/')
                                    .last()
                                    .unwrap()
                                    .to_string();
                                if let Some(mi) = get_mi_path_from_game(exe) {
                                    let base = xxmi_path.join(mi);
                                    let data = apply_xxmi_tweaks(base, ai.xxmi_config);
                                    update_install_xxmi_config_by_id(&app, ai.id, data);
                                }
                            }
                        }
                    }
                }
            }

            app.emit(complete_event, job_id.to_string()).unwrap();
            prevent_exit(&app, false);
            QueueJobOutcome::Completed
        } else {
            let action = if is_update { "update" } else { "download" };
            show_dialog(
                &app,
                "error",
                "TwintailLauncher",
                &format!(
                    "Error occurred while trying to {} XXMI packages! Please retry later.",
                    action
                ),
                None,
            );
            prevent_exit(&app, false);
            app.emit(complete_event, job_id.to_string()).unwrap();
            let _ = empty_dir(&xxmi_path);
            QueueJobOutcome::Failed
        }
    } else {
        let action = if is_update { "update" } else { "download" };
        show_dialog(
            &app,
            "error",
            "TwintailLauncher",
            &format!(
                "Error occurred while trying to {} XXMI Modding Tool! Please retry later by re-enabling \"Inject XXMI\" in Install Settings.",
                action
            ),
            None,
        );
        prevent_exit(&app, false);
        app.emit(complete_event, job_id.to_string()).unwrap();
        let _ = empty_dir(&xxmi_path);
        QueueJobOutcome::Failed
    }
}
