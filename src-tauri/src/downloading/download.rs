use crate::DownloadState;
use crate::downloading::DownloadGamePayload;
use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::utils::db_manager::{get_install_info_by_id, get_manifest_info_by_id};
use crate::utils::repo_manager::get_manifest;
use crate::utils::{
    PathResolve,
    models::{FullGameFile, GameVersion},
    prevent_exit, run_async_command, send_notification,
};
use fischl::download::game::{Game, Kuro, Sophon, Zipped};
use fischl::utils::{assemble_multipart_archive, extract_archive};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener, Manager};

#[cfg(target_os = "linux")]
use crate::utils::patch_aki;

pub fn register_download_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_game_download", move |event| {
        let payload: DownloadGamePayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::GameDownload, payload);
        } else {
            let h4 = a.clone();
            std::thread::spawn(move || {
                let job_id = format!(
                    "direct_download_{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                );
                let _ = run_game_download(h4, payload, job_id);
            });
        }
    });
}

pub fn run_game_download(
    h4: AppHandle,
    payload: DownloadGamePayload,
    job_id: String,
) -> QueueJobOutcome {
    let job_id = Arc::new(job_id);
    let install = match get_install_info_by_id(&h4, payload.install.clone()) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };
    let gid = match get_manifest_info_by_id(&h4, install.manifest_id) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };

    let mm = get_manifest(&h4, gid.filename);
    if let Some(gm) = mm {
        let version = if payload.is_latest.is_some() {
            gm.game_versions
                .iter()
                .filter(|e| e.metadata.version == gm.latest_version)
                .collect::<Vec<&GameVersion>>()
        } else {
            gm.game_versions
                .iter()
                .filter(|e| e.metadata.version == install.version)
                .collect::<Vec<&GameVersion>>()
        };
        let picked = match version.get(0) {
            Some(v) => *v,
            None => return QueueJobOutcome::Failed,
        };

        let instn = if payload.is_latest.is_some() {
            Arc::new(picked.metadata.versioned_name.clone())
        } else {
            Arc::new(install.name.clone())
        };
        let inna = instn.clone();
        let dlpayload = Arc::new(Mutex::new(HashMap::new()));

        let mut dlp = dlpayload.lock().unwrap();
        dlp.insert("job_id", job_id.to_string());
        dlp.insert("name", instn.clone().to_string());
        dlp.insert("progress", "0".to_string());
        dlp.insert("total", "1000".to_string());

        h4.emit("download_progress", dlp.clone()).unwrap();
        drop(dlp);
        prevent_exit(&h4, true);

        let cancel_token = Arc::new(AtomicBool::new(false));
        {
            let state = h4.state::<DownloadState>();
            let mut tokens = state.tokens.lock().unwrap();
            tokens.insert(payload.install.clone(), cancel_token.clone());
        }

        let mut success = false;
        match picked.metadata.download_mode.as_str() {
            // Generic zipped mode
            "DOWNLOAD_MODE_FILE" => {
                let install_dir = Path::new(&install.directory);
                let downloading_marker = install_dir.join("downloading");
                if !install_dir.exists() {
                    std::fs::create_dir_all(install_dir).unwrap_or_default();
                }
                if !downloading_marker.exists() {
                    std::fs::create_dir(&downloading_marker).unwrap_or_default();
                }

                let urls = picked
                    .game
                    .full
                    .iter()
                    .map(|v| v.file_url.clone())
                    .collect::<Vec<String>>();
                let totalsize = picked
                    .game
                    .full
                    .iter()
                    .map(|x| x.compressed_size.parse::<u64>().unwrap())
                    .sum::<u64>();
                let cancel_token = cancel_token.clone();
                let rslt = run_async_command(async {
                    <Game as Zipped>::download(
                        urls.clone(),
                        install.directory.clone(),
                        {
                            let dlpayload = dlpayload.clone();
                            let h4 = h4.clone();
                            let instn = instn.clone();
                            let job_id = job_id.clone();
                            move |current, _, speed| {
                                let mut dlp = dlpayload.lock().unwrap();
                                dlp.insert("job_id", job_id.to_string());
                                dlp.insert("name", instn.to_string());
                                dlp.insert("progress", current.to_string());
                                dlp.insert("total", totalsize.to_string());
                                dlp.insert("speed", speed.to_string());
                                dlp.insert("disk", speed.to_string());
                                h4.emit("download_progress", dlp.clone()).unwrap();
                                drop(dlp);
                            }
                        },
                        Some(cancel_token),
                    )
                    .await
                });
                if rslt {
                    // Get first entry in the list, and start extraction
                    let first = urls.get(0).unwrap();
                    let tmpf = first.split('/').collect::<Vec<&str>>();
                    let fnn = tmpf.last().unwrap().to_string();
                    let ap = Path::new(&install.directory).follow_symlink().unwrap();
                    let aps = ap.to_str().unwrap().to_string();
                    let parts = urls
                        .into_iter()
                        .map(|e| {
                            e.split('/')
                                .collect::<Vec<&str>>()
                                .last()
                                .unwrap()
                                .to_string()
                        })
                        .collect::<Vec<String>>();

                    if fnn.ends_with(".001") {
                        let r = assemble_multipart_archive(parts, aps);
                        if r {
                            let aar = fnn.strip_suffix(".001").unwrap().to_string();
                            let far = ap.join(aar).to_str().unwrap().to_string();

                            // Extraction stage (Steam-like "Installing files")
                            {
                                let mut dlp = dlpayload.lock().unwrap();
                                dlp.insert("job_id", job_id.to_string());
                                dlp.insert("name", instn.clone().to_string());
                                dlp.insert("progress", "0".to_string());
                                dlp.insert("total", "100".to_string());
                                h4.emit("download_installing", dlp.clone()).unwrap();
                            }
                            let ext = extract_archive(far, install.directory.clone(), false);
                            if ext {
                                {
                                    let mut dlp = dlpayload.lock().unwrap();
                                    dlp.insert("job_id", job_id.to_string());
                                    dlp.insert("name", instn.clone().to_string());
                                    dlp.insert("progress", "100".to_string());
                                    dlp.insert("total", "100".to_string());
                                    h4.emit("download_installing", dlp.clone()).unwrap();
                                }
                                if downloading_marker.exists() {
                                    std::fs::remove_dir(&downloading_marker).unwrap_or_default();
                                }
                                h4.emit("download_complete", ()).unwrap();
                                prevent_exit(&h4, false);
                                send_notification(
                                    &h4,
                                    format!("Download of {inn} complete.", inn = inna.to_string())
                                        .as_str(),
                                    None,
                                );
                                success = true;
                            }
                        }
                    } else {
                        let far = ap.join(fnn.clone()).to_str().unwrap().to_string();

                        // Extraction stage (Steam-like "Installing files")
                        {
                            let mut dlp = dlpayload.lock().unwrap();
                            dlp.insert("job_id", job_id.to_string());
                            dlp.insert("name", instn.clone().to_string());
                            dlp.insert("progress", "0".to_string());
                            dlp.insert("total", "100".to_string());
                            h4.emit("download_installing", dlp.clone()).unwrap();
                        }
                        let ext = extract_archive(far, install.directory.clone(), false);
                        if ext {
                            {
                                let mut dlp = dlpayload.lock().unwrap();
                                dlp.insert("job_id", job_id.to_string());
                                dlp.insert("name", instn.clone().to_string());
                                dlp.insert("progress", "100".to_string());
                                dlp.insert("total", "100".to_string());
                                h4.emit("download_installing", dlp.clone()).unwrap();
                            }
                            if downloading_marker.exists() {
                                std::fs::remove_dir(&downloading_marker).unwrap_or_default();
                            }
                            h4.emit("download_complete", ()).unwrap();
                            prevent_exit(&h4, false);
                            send_notification(
                                &h4,
                                format!("Download of {inn} complete.", inn = inna.to_string())
                                    .as_str(),
                                None,
                            );
                            success = true;
                        }
                    }
                }
            }
            // HoYoverse sophon chunk mode
            "DOWNLOAD_MODE_CHUNK" => {
                let urls = if payload.biz == "bh3_global" {
                    picked
                        .game
                        .full
                        .clone()
                        .iter()
                        .filter(|e| e.region_code.clone().unwrap() == payload.region)
                        .cloned()
                        .collect::<Vec<FullGameFile>>()
                } else {
                    picked.game.full.clone()
                };
                let mut ok = true;
                for e in urls.clone() {
                    let h4 = h4.clone();
                    let cancel_token = cancel_token.clone();
                    let rslt = run_async_command(async {
                        <Game as Sophon>::download(
                            e.file_url.clone(),
                            e.file_path.clone(),
                            install.directory.clone(),
                            {
                                let dlpayload = dlpayload.clone();
                                let instn = instn.clone();
                                let job_id = job_id.clone();
                                move |current, total, speed| {
                                    let mut dlp = dlpayload.lock().unwrap();
                                    let instn = instn.clone();
                                    dlp.insert("job_id", job_id.to_string());
                                    dlp.insert("name", instn.to_string());
                                    dlp.insert("progress", current.to_string());
                                    dlp.insert("total", total.to_string());
                                    dlp.insert("speed", speed.to_string());
                                    dlp.insert("disk", speed.to_string());
                                    h4.emit("download_progress", dlp.clone()).unwrap();
                                    drop(dlp);
                                }
                            },
                            Some(cancel_token),
                        )
                        .await
                    });
                    if !rslt {
                        ok = false;
                        break;
                    }
                }
                if ok {
                    h4.emit("download_complete", ()).unwrap();
                    prevent_exit(&h4, false);
                    send_notification(
                        &h4,
                        format!("Download of {inn} complete.", inn = inna.to_string()).as_str(),
                        None,
                    );
                    success = true;
                }
            }
            // KuroGame only
            "DOWNLOAD_MODE_RAW" => {
                let urls = picked
                    .game
                    .full
                    .iter()
                    .map(|v| v.file_url.clone())
                    .collect::<Vec<String>>();
                let manifest = urls.get(0).unwrap();
                let cancel_token = cancel_token.clone();
                let rslt = run_async_command(async {
                    <Game as Kuro>::download(
                        manifest.to_owned(),
                        picked.metadata.res_list_url.clone(),
                        install.directory.clone(),
                        {
                            let dlpayload = dlpayload.clone();
                            let h4 = h4.clone();
                            let instn = instn.clone();
                            let job_id = job_id.clone();
                            move |current, total, speed| {
                                let mut dlp = dlpayload.lock().unwrap();
                                dlp.insert("job_id", job_id.to_string());
                                dlp.insert("name", instn.to_string());
                                dlp.insert("progress", current.to_string());
                                dlp.insert("total", total.to_string());
                                dlp.insert("speed", speed.to_string());
                                dlp.insert("disk", speed.to_string());
                                h4.emit("download_progress", dlp.clone()).unwrap();
                                drop(dlp);
                            }
                        },
                        Some(cancel_token),
                    )
                    .await
                });
                if rslt {
                    h4.emit("download_complete", ()).unwrap();
                    prevent_exit(&h4, false);
                    send_notification(
                        &h4,
                        format!("Download of {inn} complete.", inn = inna.to_string()).as_str(),
                        None,
                    );
                    success = true;
                    #[cfg(target_os = "linux")]
                    {
                        let target = Path::new(&install.directory.clone())
                            .join("Client/Binaries/Win64/ThirdParty/KrPcSdk_Global/KRSDKRes/KRSDK.bin")
                            .follow_symlink()
                            .unwrap();
                        patch_aki(target.to_str().unwrap().to_string());
                    }
                }
            }
            _ => {}
        }

        let mut cancelled = false;
        {
            let state = h4.state::<DownloadState>();
            let tokens = state.tokens.lock().unwrap();
            if let Some(token) = tokens.get(&payload.install) {
                if token.load(Ordering::Relaxed) {
                    cancelled = true;
                }
            }
        }

        {
            let state = h4.state::<DownloadState>();
            let mut tokens = state.tokens.lock().unwrap();
            tokens.remove(&payload.install);
        }

        if cancelled {
            let mut dlp = HashMap::new();
            dlp.insert("job_id", job_id.to_string());
            dlp.insert("name", instn.to_string());
            h4.emit("download_paused", dlp).unwrap();
            prevent_exit(&h4, false);
            return QueueJobOutcome::Cancelled;
        }

        if success {
            QueueJobOutcome::Completed
        } else {
            QueueJobOutcome::Failed
        }
    } else {
        eprintln!("Failed to download game!");
        QueueJobOutcome::Failed
    }
}
