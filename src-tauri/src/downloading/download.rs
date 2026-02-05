use crate::DownloadState;
use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::downloading::{DownloadGamePayload, QueueJobPayload};
use crate::utils::db_manager::{get_install_info_by_id, get_manifest_info_by_id};
use crate::utils::repo_manager::get_manifest;
use crate::utils::{
    models::{FullGameFile, GameVersion},
    prevent_exit, run_async_command, send_notification, show_dialog,
};
use fischl::download::game::{Game, Kuro, Sophon, Zipped};
use fischl::utils::{assemble_multipart_archive, extract_archive_with_progress};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener, Manager};

pub fn register_download_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_game_download", move |event| {
        let payload: DownloadGamePayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::GameDownload, QueueJobPayload::Game(payload));
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

        let verified_files = {
            let state = h4.state::<DownloadState>();
            let mut vf = state.verified_files.lock().unwrap();
            vf.entry(payload.install.clone())
                .or_insert_with(|| Arc::new(Mutex::new(std::collections::HashSet::new())))
                .clone()
        };

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
                let _ = picked
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
                            move |current, total, net_speed, disk_speed| {
                                let mut dlp = dlpayload.lock().unwrap();
                                let instn = instn.to_string();
                                dlp.insert("job_id", job_id.to_string());
                                dlp.insert("name", instn);
                                dlp.insert("progress", current.to_string());
                                dlp.insert("total", total.to_string());
                                dlp.insert("speed", net_speed.to_string());
                                dlp.insert("disk", disk_speed.to_string());
                                h4.emit("download_progress", dlp.clone()).unwrap();
                                drop(dlp);
                            }
                        },
                        Some(cancel_token),
                        None,
                    )
                    .await
                });
                if rslt {
                    // Get first entry in the list, and start extraction
                    let first = urls.get(0).unwrap();
                    let tmpf = first.split('/').collect::<Vec<&str>>();
                    let fnn = tmpf.last().unwrap().to_string();
                    let ap = Path::new(&install.directory).to_path_buf();
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
                            let ext = extract_archive_with_progress(
                                far,
                                install.directory.clone(),
                                false,
                                {
                                    let dlpayload = dlpayload.clone();
                                    let h4 = h4.clone();
                                    let instn = instn.clone();
                                    let job_id = job_id.clone();
                                    move |current, total| {
                                        let mut dlp = dlpayload.lock().unwrap();
                                        dlp.insert("job_id", job_id.to_string());
                                        dlp.insert("name", instn.to_string());
                                        dlp.insert("progress", current.to_string());
                                        dlp.insert("total", total.to_string());
                                        h4.emit("download_installing", dlp.clone()).unwrap();
                                    }
                                },
                            );
                            if ext {
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
                        let ext =
                            extract_archive_with_progress(far, install.directory.clone(), false, {
                                let dlpayload = dlpayload.clone();
                                let h4 = h4.clone();
                                let instn = instn.clone();
                                let job_id = job_id.clone();
                                move |current, total| {
                                    let mut dlp = dlpayload.lock().unwrap();
                                    dlp.insert("job_id", job_id.to_string());
                                    dlp.insert("name", instn.to_string());
                                    dlp.insert("progress", current.to_string());
                                    dlp.insert("total", total.to_string());
                                    h4.emit("download_installing", dlp.clone()).unwrap();
                                }
                            });
                        if ext {
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
                let biz = if payload.biz.is_empty() {
                    gm.biz.clone()
                } else {
                    payload.biz.clone()
                };
                let region = if payload.region.is_empty() {
                    install.region_code.clone()
                } else {
                    payload.region.clone()
                };

                let urls = if biz == "bh3_global" {
                    picked
                        .game
                        .full
                        .clone()
                        .iter()
                        .filter(|e| e.region_code.clone().unwrap() == region)
                        .cloned()
                        .collect::<Vec<FullGameFile>>()
                } else {
                    picked.game.full.clone()
                };
                // Pre-calculate combined totals across all manifest files
                let combined_download_total: u64 = urls.iter().map(|e| e.compressed_size.parse::<u64>().unwrap_or(0)).sum();
                let combined_install_total: u64 = urls.iter().map(|e| e.decompressed_size.parse::<u64>().unwrap_or(0)).sum();
                // Track cumulative progress from completed manifests
                let cumulative_download = Arc::new(std::sync::atomic::AtomicU64::new(0));
                let cumulative_install = Arc::new(std::sync::atomic::AtomicU64::new(0));
                let mut ok = true;
                for e in urls.clone() {
                    let h4 = h4.clone();
                    let cancel_token = cancel_token.clone();
                    let cumulative_download = cumulative_download.clone();
                    let cumulative_install = cumulative_install.clone();
                    let rslt = run_async_command(async {
                        <Game as Sophon>::download(
                            e.file_url.clone(),
                            e.file_path.clone(),
                            install.directory.clone(),
                            {
                                let dlpayload = dlpayload.clone();
                                let instn = instn.clone();
                                let job_id = job_id.clone();
                                let cumulative_download = cumulative_download.clone();
                                let cumulative_install = cumulative_install.clone();
                                move |download_current, _download_total, install_current, _install_total, net_speed, disk_speed, phase| {
                                    let mut dlp = dlpayload.lock().unwrap();
                                    let instn = instn.to_string();
                                    // Add cumulative progress from previous manifests to current progress
                                    let total_download_progress = cumulative_download.load(std::sync::atomic::Ordering::SeqCst) + download_current;
                                    let total_install_progress = cumulative_install.load(std::sync::atomic::Ordering::SeqCst) + install_current;
                                    dlp.insert("job_id", job_id.to_string());
                                    dlp.insert("name", instn.clone());
                                    dlp.insert("progress", total_download_progress.to_string());
                                    dlp.insert("total", combined_download_total.to_string());
                                    dlp.insert("speed", net_speed.to_string());
                                    dlp.insert("disk", disk_speed.to_string());
                                    // Include install progress in same event to avoid flickering
                                    dlp.insert("install_progress", total_install_progress.to_string());
                                    dlp.insert("install_total", combined_install_total.to_string());
                                    // Phase: 0=idle, 1=verifying, 2=downloading, 3=installing, 4=validating, 5=moving
                                    dlp.insert("phase", phase.to_string());
                                    h4.emit("download_progress", dlp.clone()).unwrap();
                                    drop(dlp);
                                }
                            },
                            Some(cancel_token),
                            Some(verified_files.clone()),
                        )
                        .await
                    });
                    if !rslt {
                        ok = false;
                        break;
                    }
                    // After manifest completes, add its size to cumulative progress
                    cumulative_download.fetch_add(e.compressed_size.parse::<u64>().unwrap_or(0), std::sync::atomic::Ordering::SeqCst);
                    cumulative_install.fetch_add(e.decompressed_size.parse::<u64>().unwrap_or(0), std::sync::atomic::Ordering::SeqCst);
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
                            move |current, total, net_speed, disk_speed| {
                                let mut dlp = dlpayload.lock().unwrap();
                                dlp.insert("job_id", job_id.to_string());
                                dlp.insert("name", instn.to_string());
                                dlp.insert("progress", current.to_string());
                                dlp.insert("total", total.to_string());
                                dlp.insert("speed", net_speed.to_string());
                                dlp.insert("disk", disk_speed.to_string());
                                h4.emit("download_progress", dlp.clone()).unwrap();
                                drop(dlp);
                            }
                        },
                        Some(cancel_token),
                        Some(verified_files.clone()),
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
                    crate::utils::apply_patch(
                        &h4,
                        Path::new(&install.directory.clone())
                            .to_str()
                            .unwrap()
                            .to_string(),
                        "aki".to_string(),
                        "add".to_string(),
                    );
                } else {
                    // Show error dialog using React dialog system
                    show_dialog(
                        &h4,
                        "warning",
                        "TwintailLauncher",
                        &format!(
                            "Error occurred while trying to download {}\nPlease try again!",
                            install.name
                        ),
                        Some(vec!["Ok"]),
                    );
                    let dir = Path::new(&install.directory).join("downloading");
                    if dir.exists() {
                        std::fs::remove_dir_all(dir).unwrap_or_default();
                    }
                    prevent_exit(&h4, false);
                    h4.emit("download_complete", ()).unwrap();
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
