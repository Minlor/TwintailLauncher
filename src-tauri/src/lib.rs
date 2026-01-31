extern crate core;

use std::sync::{Mutex, Arc};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use crate::commands::install::{add_install, check_game_running, game_launch, get_download_sizes, get_resume_states, get_install_by_id, list_installs, list_installs_by_manifest_id, remove_install, set_installs_order, update_install_dxvk_path, update_install_dxvk_version, update_install_env_vars, update_install_fps_value, update_install_game_path, update_install_launch_args, update_install_launch_cmd, update_install_pre_launch_cmd, update_install_preferred_background, update_install_prefix_path, update_install_runner_path, update_install_runner_version, update_install_skip_hash_valid, update_install_skip_version_updates, update_install_use_fps_unlock, update_install_use_jadeite, update_install_use_xxmi, update_install_use_gamemode, update_install_use_mangohud, update_install_mangohud_config_path, add_shortcut, remove_shortcut, update_install_xxmi_config, pause_game_download, queue_move_up, queue_move_down, queue_remove, queue_set_paused, queue_activate_job, queue_reorder, queue_resume_job, get_download_queue_state, queue_clear_completed};
use crate::commands::manifest::{get_manifest_by_filename, get_manifest_by_id, list_game_manifests, get_game_manifest_by_filename, list_manifests_by_repository_id, update_manifest_enabled, get_game_manifest_by_manifest_id, list_compatibility_manifests, get_compatibility_manifest_by_manifest_id};
use crate::commands::repository::{list_repositories, remove_repository, add_repository, get_repository};
use crate::commands::settings::{block_telemetry_cmd, list_settings, open_folder, open_uri, update_settings_default_dxvk_path, update_settings_default_fps_unlock_path, update_settings_default_game_path, update_settings_default_jadeite_path, update_settings_default_mangohud_config_path, update_settings_default_prefix_path, update_settings_default_runner_path, update_settings_default_xxmi_path, update_settings_download_speed_limit_cmd, update_settings_launcher_action, update_settings_manifests_hide, update_settings_third_party_repo_updates};
use crate::downloading::download::register_download_handler;
use crate::downloading::preload::register_preload_handler;
use crate::downloading::repair::register_repair_handler;
use crate::downloading::update::register_update_handler;
use crate::downloading::queue::{start_download_queue_worker, QueueJob, QueueJobKind, QueueJobOutcome};
use crate::downloading::QueueJobPayload;
use crate::downloading::misc::check_extras_update;
use crate::utils::db_manager::{init_db, DbInstances};
use crate::utils::repo_manager::{load_manifests, ManifestLoader, ManifestLoaders};
use crate::utils::{args, notify_update, register_listeners, run_async_command, setup_or_fix_default_paths, sync_install_backgrounds, ActionBlocks};
use crate::utils::system_tray::init_tray;
use crate::commands::runners::{add_installed_runner, get_installed_runner_by_id, get_installed_runner_by_version, is_steamrt_installed, list_installed_runners, remove_installed_runner, update_installed_runner_install_status};
use crate::commands::network::check_network_connectivity;

#[cfg(target_os = "linux")]
use crate::downloading::misc::register_runner_download_handler;
#[cfg(target_os = "linux")]
use crate::utils::{deprecate_jadeite, sync_installed_runners, is_flatpak, block_telemetry};
#[cfg(target_os = "linux")]
use crate::downloading::misc::{download_or_update_steamrt, register_steamrt_download_handler};

mod utils;
mod commands;
mod downloading;

pub struct DownloadState {
    pub tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub queue: Mutex<Option<crate::downloading::queue::DownloadQueueHandle>>,
    pub verified_files: Mutex<HashMap<String, Arc<Mutex<std::collections::HashSet<String>>>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = {
        #[cfg(target_os = "linux")]
        {
            utils::gpu::fuck_nvidia();
            // Raise file descriptor limit for the app so downloads go smoothly
            utils::raise_fd_limit(999999);
            tauri::Builder::default()
                .manage(Mutex::new(ActionBlocks { action_exit: false, prevent_exit_count: 0 }))
                .manage(ManifestLoaders {game: ManifestLoader::default(), runner: utils::repo_manager::RunnerLoader::default()})
                .manage(DownloadState { tokens: Mutex::new(HashMap::new()), queue: Mutex::new(None), verified_files: Mutex::new(HashMap::new()) })
                .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| { let _ = app.get_window("main").expect("no main window").show(); let _ = app.get_window("main").expect("no main window").set_focus(); }))
                .plugin(tauri_plugin_notification::init())
                .plugin(tauri_plugin_dialog::init())
                .plugin(tauri_plugin_opener::init())
        }
        #[cfg(target_os = "windows")]
        {
            tauri::Builder::default()
                .manage(Mutex::new(ActionBlocks { action_exit: false, prevent_exit_count: 0 }))
                .manage(DownloadState { tokens: Mutex::new(HashMap::new()), queue: Mutex::new(None), verified_files: Mutex::new(HashMap::new()) })
                .manage(ManifestLoaders {game: ManifestLoader::default()})
                .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| { let _ = app.get_window("main").expect("no main window").show(); let _ = app.get_window("main").expect("no main window").set_focus(); }))
                .plugin(tauri_plugin_notification::init())
                .plugin(tauri_plugin_dialog::init())
                .plugin(tauri_plugin_opener::init())
        }
    }.setup(|app| {
            let handle = app.handle();
            #[cfg(target_arch = "aarch64")]
            {
                use crate::utils::show_dialog_with_callback;
                use tauri::Listener;
                let h = handle.clone();
                let h2 = handle.clone();
                let callback_id = format!("unsupported_arch_{}", std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis());
                let callback_id_clone = callback_id.clone();
                
                handle.listen("dialog_response", move |event| {
                    #[derive(serde::Deserialize)]
                    struct DialogResponse {
                        callback_id: String,
                        #[allow(dead_code)]
                        button_index: usize,
                    }
                    if let Ok(response) = serde_json::from_str::<DialogResponse>(event.payload()) {
                        if response.callback_id == callback_id_clone {
                            // Exit the application when dialog is acknowledged
                            h.cleanup_before_exit();
                            h.exit(0);
                            std::process::exit(0);
                        }
                    }
                });
                
                show_dialog_with_callback(
                    &h2,
                    "warning",
                    "Unsupported Architecture",
                    "TwintailLauncher does not support ARM based architectures. Flatpak required ARM builds to be provided but they are not supported!",
                    Some(vec!["Exit"]),
                    Some(&callback_id),
                );
            }

            #[cfg(target_arch = "x86_64")]
            {
                notify_update(handle);
                run_async_command(async { init_db(handle).await; });

                // Start download queue worker (limits concurrent download-like jobs)
                fn run_queued_job(app: AppHandle, job: QueueJob) -> QueueJobOutcome {
                    match (&job.kind, job.payload) {
                        (QueueJobKind::GameDownload, QueueJobPayload::Game(p)) => crate::downloading::download::run_game_download(app, p, job.id),
                        (QueueJobKind::GameUpdate, QueueJobPayload::Game(p)) => crate::downloading::update::run_game_update(app, p, job.id),
                        (QueueJobKind::GamePreload, QueueJobPayload::Game(p)) => crate::downloading::preload::run_game_preload(app, p, job.id),
                        (QueueJobKind::GameRepair, QueueJobPayload::Game(p)) => crate::downloading::repair::run_game_repair(app, p, job.id),
                        #[cfg(target_os = "linux")]
                        (QueueJobKind::RunnerDownload, QueueJobPayload::Runner(p)) => crate::downloading::misc::run_runner_download(app, p, job.id),
                        #[cfg(target_os = "linux")]
                        (QueueJobKind::SteamrtDownload, QueueJobPayload::Steamrt(p)) => crate::downloading::misc::run_steamrt_download(app, p, job.id),
                        // Mismatch between kind and payload - should never happen
                        _ => QueueJobOutcome::Failed,
                    }
                }

                // Only 1 game can download at a time - others wait in queue
                let queue_handle = start_download_queue_worker(handle.clone(), 1, run_queued_job);
                {
                    let state = handle.state::<DownloadState>();
                    let mut q = state.queue.lock().unwrap();
                    *q = Some(queue_handle);
                }

                load_manifests(handle);
                init_tray(handle).unwrap();
                // Initialize the listeners
                register_listeners(handle);
                register_download_handler(handle);
                register_update_handler(handle);
                register_repair_handler(handle);
                register_preload_handler(handle);
                #[cfg(target_os = "linux")]
                {
                    register_runner_download_handler(handle);
                    register_steamrt_download_handler(handle);
                }

                if args::get_launch_install().is_some() {
                    let id = args::get_launch_install().unwrap();
                    game_launch(handle.clone(), id);
                    handle.get_window("main").unwrap().hide().unwrap();
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    handle.cleanup_before_exit();
                    handle.exit(0);
                    std::process::exit(0);
                }

                let res_dir = app.path().resource_dir().unwrap();
                let data_dir = app.path().app_data_dir().unwrap();
                setup_or_fix_default_paths(handle, data_dir.clone(), true);
                sync_install_backgrounds(handle);
                check_extras_update(handle);

                // https://github.com/tauri-apps/tauri/issues/14596
                #[cfg(target_os = "windows")]
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) { let _ = app.get_window("main").unwrap().set_icon(icon); }

                #[cfg(target_os = "linux")]
                {
                    match std::env::var("XDG_SESSION_DESKTOP") {
                        Ok(val) => {
                            if val.to_ascii_lowercase() == "hyprland" ||
                                val.to_ascii_lowercase() == "i3" ||
                                val.to_ascii_lowercase() == "sway" ||
                                val.to_ascii_lowercase() == "bspwm" ||
                                val.to_ascii_lowercase() == "awesome" ||
                                val.to_ascii_lowercase() == "dwm" ||
                                val.to_ascii_lowercase() == "xmonad" ||
                                val.to_ascii_lowercase() == "qtile" ||
                                val.to_ascii_lowercase() == "niri" {
                                app.get_window("main").unwrap().set_decorations(false).unwrap();
                            } else { app.get_window("main").unwrap().set_decorations(true).unwrap(); }
                        },
                        Err(_e) => {},
                    }
                    // cleanup steam.exe jank
                    let tmphome = data_dir.join("tmp_home/");
                    if tmphome.exists() { std::fs::remove_dir_all(&tmphome).unwrap(); }

                    deprecate_jadeite(handle);
                    sync_installed_runners(handle);
                    download_or_update_steamrt(handle);

                    let path = data_dir.join(".telemetry_blocked");
                    if !path.exists() && !is_flatpak() {
                        use tauri_plugin_dialog::DialogExt;
                        let h = handle.clone();
                        h.dialog().message(format!("Hey! Before you start enjoying your games on Linux we are asking you to let application block game telemetry servers to ensure game companies do not collect information about your Linux gaming journey.\nPlease press \"Block telemetry\" and be prompted with password to allow us to write to your /etc/hosts file.").as_str())
                            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom("Block telemetry".to_string(), "Do not show again".to_string()))
                            .kind(tauri_plugin_dialog::MessageDialogKind::Info).title("TwintailLauncher").show(move |action| { if action { block_telemetry(&h); } else { std::fs::write(&path, ".").unwrap(); } });
                    }
                }

                // Delete deprecated resource files (PS: reaper binary is executable in resources dir so useless to copy)
                for df in ["7zr", "7zr.exe", "krpatchz", "krpatchz.exe", "reaper"] {
                    let fd = data_dir.join(df);
                    if fd.exists() { std::fs::remove_file(fd).unwrap(); }
                }
                // Copy required resource files
                for r in ["hpatchz", "hpatchz.exe"] {
                    let rd = res_dir.join("resources").join(r);
                    let fd = data_dir.join(r);
                    if rd.exists() { std::fs::copy(rd, fd).unwrap(); }
                }
            }
            Ok(())
        }).invoke_handler(tauri::generate_handler![open_uri, open_folder, block_telemetry_cmd, list_settings, update_settings_third_party_repo_updates, update_settings_default_game_path, update_settings_default_xxmi_path, update_settings_default_fps_unlock_path, update_settings_default_jadeite_path, update_settings_default_prefix_path, update_settings_default_runner_path, update_settings_default_dxvk_path, update_settings_default_mangohud_config_path, update_settings_download_speed_limit_cmd, update_settings_launcher_action, update_settings_manifests_hide,
            remove_repository, add_repository, get_repository, list_repositories,
            get_manifest_by_id, get_manifest_by_filename, list_manifests_by_repository_id, update_manifest_enabled,
            get_game_manifest_by_filename, list_game_manifests, get_game_manifest_by_manifest_id,
            list_installs, list_installs_by_manifest_id, get_install_by_id, add_install, remove_install, set_installs_order,
            update_install_game_path, update_install_runner_path, update_install_dxvk_path, update_install_skip_version_updates, update_install_skip_hash_valid, update_install_use_jadeite, update_install_use_xxmi, update_install_use_fps_unlock, update_install_fps_value, update_install_env_vars, update_install_pre_launch_cmd, update_install_launch_cmd, update_install_preferred_background, update_install_prefix_path, update_install_launch_args, update_install_dxvk_version, update_install_runner_version, update_install_use_gamemode, update_install_use_mangohud, update_install_xxmi_config,
            list_compatibility_manifests, get_compatibility_manifest_by_manifest_id,
            game_launch, check_game_running, get_download_sizes, get_resume_states, update_install_mangohud_config_path, update_settings_default_mangohud_config_path, add_shortcut, remove_shortcut, pause_game_download, queue_move_up, queue_move_down, queue_remove, queue_set_paused, queue_activate_job, queue_reorder, queue_resume_job, get_download_queue_state, queue_clear_completed,
            add_installed_runner, remove_installed_runner, get_installed_runner_by_version, get_installed_runner_by_id, list_installed_runners, update_installed_runner_install_status, is_steamrt_installed, check_network_connectivity])
        .build(tauri::generate_context!())
        .expect("Error while running TwintailLauncher!");

    builder.run(|app, event| {
        match &event {
            RunEvent::WindowEvent {event, ..} => {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        let blocks = app.state::<Mutex<ActionBlocks>>();
                        let state = blocks.lock().unwrap();
                        if state.action_exit {
                            app.get_window("main").unwrap().hide().unwrap();
                            api.prevent_close();
                            app.emit("sync_tray_toggle", "Show").unwrap();
                        }
                    }
                    _ => {}
                }
            }
            RunEvent::Exit => { run_async_command(async { app.state::<DbInstances>().0.lock().await.get("db").unwrap().close().await; }); }
            _ => ()
        }
    })
}
