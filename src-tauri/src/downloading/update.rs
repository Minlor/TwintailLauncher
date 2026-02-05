use crate::DownloadState;
use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::downloading::{DownloadGamePayload, QueueJobPayload};
use crate::utils::db_manager::{
    get_install_info_by_id, get_manifest_info_by_id, update_install_after_update_by_id,
};
use crate::utils::repo_manager::get_manifest;
use crate::utils::{
    empty_dir,
    models::{DiffGameFile, GameVersion},
    prevent_exit, run_async_command, send_notification, show_dialog, show_dialog_with_callback,
};
use fischl::download::game::{Game, Kuro, Sophon};
use fischl::utils::free_space::available;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener, Manager};

pub fn register_update_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_game_update", move |event| {
        let payload: DownloadGamePayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::GameUpdate, QueueJobPayload::Game(payload));
        } else {
            let h5 = a.clone();
            std::thread::spawn(move || {
                let job_id = format!(
                    "direct_update_{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                );
                let _ = run_game_update(h5, payload, job_id);
            });
        }
    });
}

pub fn run_game_update(
    h5: AppHandle,
    payload: DownloadGamePayload,
    job_id: String,
) -> QueueJobOutcome {
    let job_id = Arc::new(job_id);
    let install = match get_install_info_by_id(&h5, payload.install) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };
    let gid = match get_manifest_info_by_id(&h5, install.manifest_id.clone()) {
        Some(v) => v,
        None => return QueueJobOutcome::Failed,
    };

    let mm = get_manifest(&h5, gid.filename);
    if let Some(gm) = mm {
        let lv = gm.latest_version.clone();
        let version = gm
            .game_versions
            .iter()
            .filter(|e| e.metadata.version == lv)
            .collect::<Vec<&GameVersion>>();
        let picked = match version.get(0) {
            Some(v) => *v,
            None => return QueueJobOutcome::Failed,
        };
        let tmp = Arc::new(h5.clone());
        let vn = picked.metadata.versioned_name.clone();
        let vc = picked.metadata.version.clone();
        let ig = picked.assets.game_icon.clone();
        let gb = picked.assets.game_background.clone();
        let gbiz = gm.biz.clone();

        let instn = Arc::new(install.name.clone());
        let dlpayload = Arc::new(Mutex::new(HashMap::new()));

        let mut dlp = dlpayload.lock().unwrap();
        dlp.insert("job_id", job_id.to_string());
        dlp.insert("name", install.name.clone());
        dlp.insert("progress", "0".to_string());
        dlp.insert("total", "1000".to_string());

        h5.emit("update_progress", dlp.clone()).unwrap();
        drop(dlp);
        prevent_exit(&h5, true);

        match picked.metadata.download_mode.as_str() {
            // Generic zipped mode, Variety per game
            "DOWNLOAD_MODE_FILE" => {
                let urls = picked
                    .game
                    .diff
                    .iter()
                    .filter(|e| e.original_version.as_str() == install.version.clone().as_str())
                    .collect::<Vec<&DiffGameFile>>();
                if urls.is_empty() {
                    // Show dialog with Redownload/Cancel options
                    let callback_id = format!(
                        "update_redownload_file_{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                    );

                    let install_clone = install.clone();
                    let h5_clone = h5.clone();
                    let gbiz_clone = gbiz.clone();
                    let payload_lang = payload.lang.clone();
                    let vn_clone = vn.clone();
                    let ig_clone = ig.clone();
                    let gb_clone = gb.clone();
                    let vc_clone = vc.clone();
                    let callback_id_clone = callback_id.clone();

                    h5.listen("dialog_response", move |event| {
                        #[derive(serde::Deserialize)]
                        struct DialogResponse {
                            callback_id: String,
                            button_index: usize,
                        }
                        if let Ok(response) =
                            serde_json::from_str::<DialogResponse>(event.payload())
                        {
                            if response.callback_id == callback_id_clone {
                                if response.button_index == 0 {
                                    // "Redownload" clicked
                                    let ip = Path::new(&install_clone.directory);
                                    empty_dir(&ip).unwrap_or_default();
                                    let mut data = HashMap::new();
                                    data.insert("install", install_clone.id.clone());
                                    data.insert("biz", gbiz_clone.clone());
                                    data.insert("lang", payload_lang.clone());
                                    data.insert("region", install_clone.region_code.clone());
                                    data.insert("is_latest", "1".to_string());
                                    h5_clone.emit("start_game_download", data).unwrap();
                                    update_install_after_update_by_id(
                                        &h5_clone,
                                        install_clone.id.clone(),
                                        vn_clone.clone(),
                                        ig_clone.clone(),
                                        gb_clone.clone(),
                                        vc_clone.clone(),
                                    );
                                } else {
                                    // "Cancel" clicked
                                    prevent_exit(&h5_clone, false);
                                    h5_clone.emit("update_complete", ()).unwrap();
                                }
                            }
                        }
                    });

                    show_dialog_with_callback(
                        &h5,
                        "info",
                        "TwintailLauncher",
                        &format!(
                            "Could not find update for {}!\nRedownload latest full game version by pressing \"Redownload\" button.",
                            install.name
                        ),
                        Some(vec!["Redownload", "Cancel"]),
                        Some(&callback_id),
                    );
                } else {
                    prevent_exit(&h5, false);
                    h5.emit("update_complete", ()).unwrap();
                }
            }
            // HoYoverse sophon chunk mode
            "DOWNLOAD_MODE_CHUNK" => {
                let urls = picked
                    .game
                    .diff
                    .iter()
                    .filter(|e| e.original_version.as_str() == install.version.clone().as_str())
                    .collect::<Vec<&DiffGameFile>>();
                if urls.is_empty() {
                    // Show dialog with Redownload/Cancel options
                    let callback_id = format!(
                        "update_redownload_chunk_{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                    );

                    let install_clone = install.clone();
                    let h5_clone = h5.clone();
                    let gbiz_clone = gbiz.clone();
                    let payload_lang = payload.lang.clone();
                    let vn_clone = vn.clone();
                    let ig_clone = ig.clone();
                    let gb_clone = gb.clone();
                    let vc_clone = vc.clone();
                    let callback_id_clone = callback_id.clone();

                    h5.listen("dialog_response", move |event| {
                        #[derive(serde::Deserialize)]
                        struct DialogResponse {
                            callback_id: String,
                            button_index: usize,
                        }
                        if let Ok(response) =
                            serde_json::from_str::<DialogResponse>(event.payload())
                        {
                            if response.callback_id == callback_id_clone {
                                if response.button_index == 0 {
                                    // "Redownload" clicked
                                    let ip = Path::new(&install_clone.directory);
                                    empty_dir(&ip).unwrap_or_default();
                                    let mut data = HashMap::new();
                                    data.insert("install", install_clone.id.clone());
                                    data.insert("biz", gbiz_clone.clone());
                                    data.insert("lang", payload_lang.clone());
                                    data.insert("region", install_clone.region_code.clone());
                                    data.insert("is_latest", "1".to_string());
                                    h5_clone.emit("start_game_download", data).unwrap();
                                    update_install_after_update_by_id(
                                        &h5_clone,
                                        install_clone.id.clone(),
                                        vn_clone.clone(),
                                        ig_clone.clone(),
                                        gb_clone.clone(),
                                        vc_clone.clone(),
                                    );
                                } else {
                                    // "Cancel" clicked
                                    prevent_exit(&h5_clone, false);
                                    h5_clone.emit("update_complete", ()).unwrap();
                                }
                            }
                        }
                    });

                    show_dialog_with_callback(
                        &h5,
                        "info",
                        "TwintailLauncher",
                        &format!(
                            "Could not find update for {}!\nRedownload latest full game version by pressing \"Redownload\" button.",
                            install.name
                        ),
                        Some(vec!["Redownload", "Cancel"]),
                        Some(&callback_id),
                    );
                } else {
                    let total_size: u64 = urls
                        .clone()
                        .into_iter()
                        .map(|e| e.decompressed_size.parse::<u64>().unwrap())
                        .sum();
                    let available = available(install.directory.clone());
                    let has_space = if let Some(av) = available {
                        av >= total_size
                    } else {
                        false
                    };
                    if has_space {
                        let patching_marker = Path::new(&install.directory).join("patching");
                        let is_preload = patching_marker.join(".preload").exists();
                        // Create patching marker if not exists (for resume detection)
                        if !patching_marker.exists() { fs::create_dir_all(&patching_marker).unwrap_or_default(); }
                        #[cfg(target_os = "linux")]
                        let hpatchz = h5.path().app_data_dir().unwrap().join("hpatchz");
                        #[cfg(target_os = "windows")]
                        let hpatchz = h5.path().app_data_dir().unwrap().join("hpatchz.exe");
                        urls.into_iter().for_each(|e| {
                            run_async_command(async {
                                <Game as Sophon>::patch(
                                    e.file_url.to_owned(),
                                    install.version.clone(),
                                    e.file_hash.to_owned(),
                                    install.directory.clone(),
                                    hpatchz.to_str().unwrap().to_string(),
                                    is_preload,
                                    {
                                        let dlpayload = dlpayload.clone();
                                        let tmp = tmp.clone();
                                        let instn = instn.clone();
                                        move |_dl_cur,
                                              _dl_total,
                                              current,
                                              total,
                                              net_speed,
                                              disk_speed,
                                              _phase| {
                                            let mut dlp = dlpayload.lock().unwrap();
                                            dlp.insert("name", instn.to_string());
                                            dlp.insert("progress", current.to_string());
                                            dlp.insert("total", total.to_string());
                                            dlp.insert("speed", net_speed.to_string());
                                            dlp.insert("disk", disk_speed.to_string());
                                            tmp.emit("update_progress", dlp.clone()).unwrap();
                                            drop(dlp);
                                        }
                                    },
                                )
                                .await
                            });
                        });
                        // We finished the loop emit complete - remove patching marker
                        if patching_marker.exists() { fs::remove_dir_all(&patching_marker).unwrap_or_default(); }
                        h5.emit("update_complete", ()).unwrap();
                        prevent_exit(&h5, false);
                        send_notification(
                            &h5,
                            format!("Updating {inn} complete.", inn = install.name.clone())
                                .as_str(),
                            None,
                        );
                        update_install_after_update_by_id(
                            &h5,
                            install.id,
                            picked.metadata.versioned_name.clone(),
                            picked.assets.game_icon.clone(),
                            picked.assets.game_background.clone(),
                            picked.metadata.version.clone(),
                        );
                    } else {
                        show_dialog(
                            &h5,
                            "warning",
                            "TwintailLauncher",
                            &format!(
                                "Unable to update {} as there is not enough free space, please make sure there is enough free space for the update!",
                                install.name
                            ),
                            Some(vec!["Ok"]),
                        );
                        prevent_exit(&h5, false);
                        h5.emit("update_complete", ()).unwrap();
                    }
                }
            }
            // KuroGame only
            "DOWNLOAD_MODE_RAW" => {
                let urls = picked
                    .game
                    .diff
                    .iter()
                    .filter(|e| e.original_version.as_str() == install.version.clone().as_str())
                    .collect::<Vec<&DiffGameFile>>();
                if urls.is_empty() {
                    // Show dialog with Redownload/Cancel options
                    let callback_id = format!(
                        "update_redownload_raw_{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                    );

                    let install_clone = install.clone();
                    let h5_clone = h5.clone();
                    let gbiz_clone = gbiz.clone();
                    let payload_lang = payload.lang.clone();
                    let vn_clone = vn.clone();
                    let ig_clone = ig.clone();
                    let gb_clone = gb.clone();
                    let vc_clone = vc.clone();
                    let callback_id_clone = callback_id.clone();

                    h5.listen("dialog_response", move |event| {
                        #[derive(serde::Deserialize)]
                        struct DialogResponse {
                            callback_id: String,
                            button_index: usize,
                        }
                        if let Ok(response) =
                            serde_json::from_str::<DialogResponse>(event.payload())
                        {
                            if response.callback_id == callback_id_clone {
                                if response.button_index == 0 {
                                    // "Redownload" clicked
                                    let ip = Path::new(&install_clone.directory);
                                    empty_dir(&ip).unwrap_or_default();
                                    let mut data = HashMap::new();
                                    data.insert("install", install_clone.id.clone());
                                    data.insert("biz", gbiz_clone.clone());
                                    data.insert("lang", payload_lang.clone());
                                    data.insert("region", install_clone.region_code.clone());
                                    data.insert("is_latest", "1".to_string());
                                    h5_clone.emit("start_game_download", data).unwrap();
                                    update_install_after_update_by_id(
                                        &h5_clone,
                                        install_clone.id.clone(),
                                        vn_clone.clone(),
                                        ig_clone.clone(),
                                        gb_clone.clone(),
                                        vc_clone.clone(),
                                    );
                                } else {
                                    // "Cancel" clicked
                                    prevent_exit(&h5_clone, false);
                                    h5_clone.emit("update_complete", ()).unwrap();
                                }
                            }
                        }
                    });

                    show_dialog_with_callback(
                        &h5,
                        "info",
                        "TwintailLauncher",
                        &format!(
                            "Could not find update for {}!\nRedownload latest full game version by pressing \"Redownload\" button.",
                            install.name
                        ),
                        Some(vec!["Redownload", "Cancel"]),
                        Some(&callback_id),
                    );
                } else {
                    let total_size: u64 = urls
                        .clone()
                        .into_iter()
                        .map(|e| e.decompressed_size.parse::<u64>().unwrap())
                        .sum();
                    let available = available(install.directory.clone());
                    let has_space = if let Some(av) = available {
                        av >= total_size
                    } else {
                        false
                    };
                    if has_space {
                        let manifest = urls.get(0).unwrap();
                        let patching_marker = Path::new(&install.directory).join("patching");
                        let is_preload = patching_marker.join(".preload").exists();
                        // Create patching marker if not exists (for resume detection)
                        if !patching_marker.exists() { fs::create_dir_all(&patching_marker).unwrap_or_default(); }
                        let rslt = run_async_command(async {
                            <Game as Kuro>::patch(
                                manifest.file_url.to_owned(),
                                manifest.file_hash.clone(),
                                picked.metadata.res_list_url.clone(),
                                install.directory.clone(),
                                is_preload,
                                {
                                    let dlpayload = dlpayload.clone();
                                    let job_id = job_id.clone();
                                    move |download_current: u64, download_total: u64, install_current: u64, install_total: u64, net_speed: u64, disk_speed: u64, phase: u8| {
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
                                        tmp.emit("update_progress", dlp.clone()).unwrap();
                                        drop(dlp);
                                    }
                                },
                            )
                            .await
                        });
                        if rslt {
                            // Remove patching marker on success
                            if patching_marker.exists() { fs::remove_dir_all(&patching_marker).unwrap_or_default(); }
                            h5.emit("update_complete", ()).unwrap();
                            prevent_exit(&h5, false);
                            send_notification(&h5, format!("Updating {inn} complete.", inn = install.name).as_str(), None);
                            update_install_after_update_by_id(&h5, install.id, picked.metadata.versioned_name.clone(), picked.assets.game_icon.clone(), picked.assets.game_background.clone(), picked.metadata.version.clone());
                            #[cfg(target_os = "linux")]
                            crate::utils::apply_patch(&h5, Path::new(&install.directory.clone()).to_str().unwrap().to_string(), "aki".to_string(), "add".to_string());
                        } else {
                            // Show error dialog - keep marker so user can resume
                            show_dialog(&h5, "warning", "TwintailLauncher", &format!("Error occurred while trying to update {}\nPlease try again!", install.name), Some(vec!["Ok"]));
                            prevent_exit(&h5, false);
                            h5.emit("update_complete", ()).unwrap();
                        }
                    } else {
                        show_dialog(
                            &h5,
                            "warning",
                            "TwintailLauncher",
                            &format!(
                                "Unable to update {} as there is not enough free space, please make sure there is enough free space for the update!",
                                install.name
                            ),
                            Some(vec!["Ok"]),
                        );
                        prevent_exit(&h5, false);
                        h5.emit("update_complete", ()).unwrap();
                    }
                }
            }
            // Fallback mode
            _ => {}
        }
        QueueJobOutcome::Completed
    } else {
        eprintln!("Failed to update game!");
        QueueJobOutcome::Failed
    }
}
