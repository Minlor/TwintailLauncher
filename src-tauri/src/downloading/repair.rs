use crate::DownloadState;
use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::downloading::{DownloadGamePayload, QueueJobPayload};
use crate::utils::db_manager::{get_install_info_by_id, get_manifest_info_by_id};
use crate::utils::repo_manager::get_manifest;
use crate::utils::{models::{FullGameFile, GameVersion}, run_async_command, send_notification, show_dialog};
use fischl::download::game::{Game, Kuro, Sophon};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool,Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener, Manager};

#[cfg(target_os = "linux")]
use crate::utils::empty_dir;

pub fn register_repair_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_game_repair", move |event| {
        let payload: DownloadGamePayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::GameRepair, QueueJobPayload::Game(payload));
        } else {
            let h5 = a.clone();
            std::thread::spawn(move || {
                let job_id = format!("direct_repair_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                let _ = run_game_repair(h5, payload, job_id);
            });
        }
    });
}

pub fn run_game_repair(h5: AppHandle, payload: DownloadGamePayload, job_id: String) -> QueueJobOutcome {
    let job_id = Arc::new(job_id);
    let install_id = payload.install.clone();
    let install = get_install_info_by_id(&h5, payload.install);
    if install.is_none() { eprintln!("Failed to find installation for repair!");return QueueJobOutcome::Failed; }

    let i = install.unwrap();
    let lm = match get_manifest_info_by_id(&h5, i.manifest_id.clone()) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };
    let gm = match get_manifest(&h5, lm.filename) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };

    let version = gm.game_versions.iter().filter(|e| e.metadata.version == i.version).collect::<Vec<&GameVersion>>();
    let picked = match version.get(0) {
        Some(v) => *v,
        None => return QueueJobOutcome::Failed,
    };

    let tmp = Arc::new(h5.clone());
    let instn = Arc::new(i.name.clone());
    let dlpayload = Arc::new(Mutex::new(HashMap::new()));

    let mut dlp = dlpayload.lock().unwrap();
    dlp.insert("job_id", job_id.to_string());
    dlp.insert("name", i.name.clone());
    dlp.insert("progress", "0".to_string());
    dlp.insert("total", "1000".to_string());

    h5.emit("repair_progress", dlp.clone()).unwrap();
    drop(dlp);

    let cancel_token = Arc::new(AtomicBool::new(false));
    {
        let state = h5.state::<DownloadState>();
        let mut tokens = state.tokens.lock().unwrap();
        tokens.insert(install_id.clone(), cancel_token.clone());
    }

    #[cfg(target_os = "linux")]
    {
        // Set prefix in repair state by emptying the directory
        let prefix_path = std::path::Path::new(&i.runner_prefix);
        if prefix_path.exists() && !gm.extra.compat_overrides.install_to_prefix { empty_dir(prefix_path).unwrap(); }
    }

    match picked.metadata.download_mode.as_str() {
        // Generic zipped mode, Variety per game
        "DOWNLOAD_MODE_FILE" => {
            h5.emit("repair_complete", ()).unwrap();
        }
        // HoYoverse sophon chunk mode
        "DOWNLOAD_MODE_CHUNK" => {
            let biz = if payload.biz.is_empty() { gm.biz.clone() } else { payload.biz.clone() };
            let region = if payload.region.is_empty() { i.region_code.clone() } else { payload.region.clone() };

            let urls = if biz == "bh3_global" { picked.game.full.clone().iter().filter(|e| e.region_code.clone().unwrap() == region).cloned().collect::<Vec<FullGameFile>>() } else { picked.game.full.clone() };
            urls.into_iter().for_each(|e| {
                let cancel_token = cancel_token.clone();
                run_async_command(async {
                    <Game as Sophon>::repair_game(e.file_url.clone(), e.file_path.clone(), i.directory.clone(), false, {
                            let dlpayload = dlpayload.clone();
                            let instn = instn.clone();
                            let tmp = tmp.clone();
                            let job_id = job_id.clone();
                            move |download_current, download_total, install_current, install_total, net_speed, disk_speed, phase| {
                                let mut dlp = dlpayload.lock().unwrap();
                                let instn = instn.clone();
                                let tmp = tmp.clone();
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
                                tmp.emit("repair_progress", dlp.clone()).unwrap();
                                drop(dlp);
                            }
                        }, Some(cancel_token),
                    ).await
                });
            });
            // We finished the loop emit complete
            h5.emit("repair_complete", ()).unwrap();
            send_notification(&h5, format!("Repair of {inn} complete.", inn = i.name).as_str(), None);
        }
        // KuroGame only
        "DOWNLOAD_MODE_RAW" => {
            let urls = picked.game.full.iter().map(|v| v.file_url.clone()).collect::<Vec<String>>();
            let manifest = urls.get(0).unwrap();
            let cancel_token = cancel_token.clone();
            let rslt = run_async_command(async {
                <Game as Kuro>::repair_game(manifest.to_owned(), picked.metadata.res_list_url.clone(), i.directory.clone(), false, {
                        let dlpayload = dlpayload.clone();
                        let job_id = job_id.clone();
                        move |download_current, download_total, install_current, install_total, net_speed, disk_speed, phase| {
                            let mut dlp = dlpayload.lock().unwrap();
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
                            tmp.emit("repair_progress", dlp.clone()).unwrap();
                            drop(dlp);
                        }
                    }, Some(cancel_token),
                ).await
            });
            if rslt {
                h5.emit("repair_complete", ()).unwrap();
                send_notification(&h5, format!("Repair of {inn} complete.", inn = i.name).as_str(), None);
                #[cfg(target_os = "linux")]
                crate::utils::apply_patch(&h5, std::path::Path::new(&i.directory.clone()).to_str().unwrap().to_string(), "aki".to_string(), "add".to_string());
            } else {
                show_dialog(&h5, "warning", "TwintailLauncher", &format!("Error occurred while trying to repair {}\nPlease try again!", i.name), Some(vec!["Ok"]));
                let dir = std::path::Path::new(&i.directory).join("repairing");
                if dir.exists() { std::fs::remove_dir_all(dir).unwrap_or_default(); }
                h5.emit("repair_complete", ()).unwrap();
            }
        }
        // Fallback mode
        _ => {}
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
        dlp.insert("name", i.name.clone());
        h5.emit("repair_paused", dlp).unwrap();
        return QueueJobOutcome::Cancelled;
    }
    QueueJobOutcome::Completed
}
