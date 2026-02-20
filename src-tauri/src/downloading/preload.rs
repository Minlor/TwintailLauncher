use crate::DownloadState;
use crate::downloading::{DownloadGamePayload, QueueJobPayload};
use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::utils::db_manager::{get_install_info_by_id, get_manifest_info_by_id};
use crate::utils::repo_manager::get_manifest;
use crate::utils::{models::DiffGameFile, run_async_command, show_dialog};
use fischl::download::game::{Game, Kuro, Sophon};
use fischl::utils::free_space::available;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool,Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener, Manager};

pub fn register_preload_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_game_preload", move |event| {
        let payload: DownloadGamePayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::GamePreload, QueueJobPayload::Game(payload));
        } else {
            let h5 = a.clone();
            std::thread::spawn(move || {
                let job_id = format!("direct_preload_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                let _ = run_game_preload(h5, payload, job_id);
            });
        }
    });
}

pub fn run_game_preload(h5: AppHandle, payload: DownloadGamePayload, job_id: String) -> QueueJobOutcome {
    let job_id = Arc::new(job_id);
    let install_id = payload.install.clone();
    let install = match get_install_info_by_id(&h5, payload.install) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };
    let gid = match get_manifest_info_by_id(&h5, install.manifest_id) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };

    let mm = get_manifest(&h5, gid.filename);
    if let Some(gm) = mm {
        let version = gm.extra.preload;
        if let Some(picked) = version {
            let tmp = Arc::new(h5.clone());

            let pmd = picked.metadata.unwrap();
            let instn = Arc::new(install.name.replace(install.version.as_str(), pmd.version.as_str()).clone(), );
            let dlpayload = Arc::new(Mutex::new(HashMap::new()));

            let mut dlp = dlpayload.lock().unwrap();
            dlp.insert("job_id", job_id.to_string());
            dlp.insert("name", instn.to_string());
            dlp.insert("progress", "0".to_string());
            dlp.insert("total", "1000".to_string());
            h5.emit("preload_progress", dlp.clone()).unwrap();
            drop(dlp);

            let cancel_token = Arc::new(AtomicBool::new(false));
            {
                let state = h5.state::<DownloadState>();
                let mut tokens = state.tokens.lock().unwrap();
                tokens.insert(install_id.clone(), cancel_token.clone());
            }

            match pmd.download_mode.as_str() {
                "DOWNLOAD_MODE_FILE" => {
                    h5.emit("preload_complete", ()).unwrap();
                }
                "DOWNLOAD_MODE_CHUNK" => {
                    let pg = picked.game.unwrap();
                    let urls = pg.diff.iter().filter(|e| e.original_version.as_str() == install.version.clone().as_str()).collect::<Vec<&DiffGameFile>>();

                    if urls.is_empty() {
                        h5.emit("preload_complete", ()).unwrap();
                    } else {
                        let total_size: u64 = urls.clone().into_iter().map(|e| e.decompressed_size.parse::<u64>().unwrap()).sum();
                        let available = available(install.directory.clone());
                        let has_space = if let Some(av) = available { av >= total_size } else { false };
                        if has_space {
                            urls.into_iter().for_each(|e| {
                                let cancel_token = cancel_token.clone();
                                run_async_command(async {
                                    <Game as Sophon>::preload(e.file_url.to_owned(), install.version.clone(), e.file_hash.to_owned(), install.directory.clone(), {
                                            let dlpayload = dlpayload.clone();
                                            let tmp = tmp.clone();
                                            let instn = instn.clone();
                                            let job_id = job_id.clone();
                                            move |download_current, download_total, install_current, install_total, net_speed, disk_speed, phase| {
                                                let mut dlp = dlpayload.lock().unwrap();
                                                let tmp = tmp.clone();
                                                let instn = instn.clone();

                                                dlp.insert("job_id", job_id.to_string());
                                                dlp.insert("name", instn.to_string());
                                                dlp.insert("progress", download_current.to_string());
                                                dlp.insert("total", download_total.to_string());
                                                dlp.insert("speed", net_speed.to_string());
                                                dlp.insert("disk", disk_speed.to_string());
                                                // Include install progress in same event to avoid flickering
                                                dlp.insert("install_progress", install_current.to_string());
                                                dlp.insert("install_total", install_total.to_string());
                                                // Phase: 0=idle, 1=verifying, 2=downloading, 3=installing, 4=validating, 5=moving
                                                dlp.insert("phase", phase.to_string());
                                                tmp.emit("preload_progress", dlp.clone()).unwrap();
                                                drop(dlp);
                                            }
                                        }, Some(cancel_token),
                                    ).await
                                });
                            });
                            h5.emit("preload_complete", ()).unwrap();
                        } else {
                            show_dialog(&h5,"warning", "TwintailLauncher", format!("Unable to predownload update for {inn} as there is not enough free space, please make sure there is enough free space for predownload!", inn = install.name).as_str(), Some(vec!["Ok"]));
                            h5.emit("preload_complete", ()).unwrap();
                        }
                    }
                }
                "DOWNLOAD_MODE_RAW" => {
                    let pg = picked.game.unwrap();
                    let urls = pg.diff.iter().filter(|e| e.original_version.as_str() == install.version.clone().as_str()).collect::<Vec<&DiffGameFile>>();
                    let manifest = urls.get(0).unwrap();

                    if urls.is_empty() {
                        h5.emit("preload_complete", ()).unwrap();
                    } else {
                        let total_size: u64 = urls.clone().into_iter().map(|e| e.decompressed_size.parse::<u64>().unwrap()).sum();
                        let available = available(install.directory.clone());
                        let has_space = if let Some(av) = available { av >= total_size } else { false };
                        if has_space {
                            let cancel_token = cancel_token.clone();
                            let rslt = run_async_command(async {
                                <Game as Kuro>::preload(manifest.file_url.clone(), manifest.file_hash.clone(), pmd.res_list_url.clone(), install.directory.clone(), {
                                        let dlpayload = dlpayload.clone();
                                        let tmp = tmp.clone();
                                        let instn = instn.clone();
                                        let job_id = job_id.clone();
                                        move |download_current, download_total, install_current, install_total, net_speed, disk_speed, phase| {
                                            let mut dlp = dlpayload.lock().unwrap();
                                            let tmp = tmp.clone();
                                            let instn = instn.clone();
                                            dlp.insert("job_id", job_id.to_string());
                                            dlp.insert("name", instn.to_string());
                                            dlp.insert("progress", download_current.to_string());
                                            dlp.insert("total", download_total.to_string());
                                            dlp.insert("speed", net_speed.to_string());
                                            dlp.insert("disk", disk_speed.to_string());
                                            dlp.insert("install_progress", install_current.to_string());
                                            dlp.insert("install_total", install_total.to_string());
                                            // Phase: 0=idle, 1=verifying, 2=downloading, 3=installing, 4=validating, 5=moving
                                            dlp.insert("phase", phase.to_string());
                                            tmp.emit("preload_progress", dlp.clone()).unwrap();
                                            drop(dlp);
                                        }
                                    }, Some(cancel_token),
                                ).await
                            });
                            if rslt {
                                h5.emit("preload_complete", ()).unwrap();
                            } else {
                                show_dialog(&h5,"warning", "TwintailLauncher", format!("Error occurred while trying to predownload {inn}\nPlease try again!", inn = install.name).as_str(), Some(vec!["Ok"]));
                                let dir = std::path::Path::new(&install.directory).join("patching");
                                if dir.exists() { std::fs::remove_dir_all(dir).unwrap_or_default(); }
                                h5.emit("preload_complete", ()).unwrap();
                            }
                        } else {
                            show_dialog(&h5,"warning", "TwintailLauncher", format!("Unable to predownload update for {inn} as there is not enough free space, please make sure there is enough free space for predownload!", inn = install.name).as_str(), Some(vec!["Ok"]));
                            h5.emit("preload_complete", ()).unwrap();
                        }
                    }
                }
                _ => {}
            }
        }

        let mut cancelled = false;
        {
            let state = h5.state::<DownloadState>();
            let tokens = state.tokens.lock().unwrap();
            if let Some(token) = tokens.get(&install_id) { if token.load(Ordering::Relaxed) { cancelled = true; } }
        }
        {
            let state = h5.state::<DownloadState>();
            let mut tokens = state.tokens.lock().unwrap();
            tokens.remove(&install_id);
        }
        if cancelled {
            let mut dlp = HashMap::new();
            dlp.insert("job_id", job_id.to_string());
            dlp.insert("name", install.name.clone());
            h5.emit("preload_paused", dlp).unwrap();
            return QueueJobOutcome::Cancelled;
        }
        QueueJobOutcome::Completed
    } else {
        eprintln!("Failed to preload game!");
        QueueJobOutcome::Failed
    }
}
