use std::collections::HashMap;
use std::fs;
use std::ops::Add;
use std::path::Path;
use std::sync::Arc;
use fischl::utils::{prettify_bytes};
use fischl::utils::free_space::available;
use tauri::{AppHandle, Emitter, Manager};
use crate::utils::db_manager::{create_installation, delete_installation_by_id, get_install_info_by_id, get_installs, get_installs_by_manifest_id, get_manifest_info_by_filename, get_manifest_info_by_id, get_settings, update_install_env_vars_by_id, update_install_fps_value_by_id, update_install_game_location_by_id, update_install_ignore_updates_by_id, update_install_launch_args_by_id, update_install_launch_cmd_by_id, update_install_mangohud_config_location_by_id, update_install_pre_launch_cmd_by_id, update_install_prefix_location_by_id, update_install_shortcut_location_by_id, update_install_skip_hash_check_by_id, update_install_use_fps_unlock_by_id, update_install_use_gamemode_by_id, update_install_use_jadeite_by_id, update_install_use_mangohud_by_id, update_install_use_xxmi_by_id};
use crate::utils::game_launch_manager::launch;
use crate::utils::{copy_dir_all, download_or_update_fps_unlock, download_or_update_jadeite, download_or_update_xxmi, generate_cuid, prevent_exit, send_notification, AddInstallRsp, DownloadSizesRsp, PathResolve, ResumeStatesRsp};
use crate::utils::repo_manager::{get_manifest, GameVersion};
use crate::utils::shortcuts::{remove_desktop_shortcut};

#[cfg(target_os = "linux")]
use crate::utils::runner_from_runner_version;
#[cfg(target_os = "linux")]
use fischl::compat::Compat;
#[cfg(target_os = "linux")]
use crate::utils::repo_manager::get_compatibility;
#[cfg(target_os = "linux")]
use fischl::utils::patch_aki;
#[cfg(target_os = "linux")]
use crate::utils::is_flatpak;
#[cfg(target_os = "linux")]
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "linux")]
use crate::utils::shortcuts::{add_steam_shortcut, remove_steam_shortcut};
#[cfg(target_os = "linux")]
use steam_shortcuts_util::app_id_generator::calculate_app_id;
#[cfg(target_os = "linux")]
use steam_shortcuts_util::Shortcut;
#[cfg(target_os = "linux")]
use crate::utils::db_manager::update_install_shortcut_is_steam_by_id;
#[cfg(target_os = "linux")]
use crate::utils::shortcuts::add_desktop_shortcut;

#[tauri::command]
pub async fn list_installs(app: AppHandle) -> Option<String> {
    let installs = get_installs(&app);

    if installs.is_some() {
        let install = installs.unwrap();
        let stringified = serde_json::to_string(&install).unwrap();
        Some(stringified)
    } else {
        None
    }
}

#[tauri::command]
pub fn list_installs_by_manifest_id(app: AppHandle, manifest_id: String) -> Option<String> {
    let installs = get_installs_by_manifest_id(&app, manifest_id);

    if installs.is_some() {
        let install = installs.unwrap();
        let stringified = serde_json::to_string(&install).unwrap();
        Some(stringified)
    } else {
        None
    }
}

#[tauri::command]
pub fn get_install_by_id(app: AppHandle, id: String) -> Option<String> {
    let inst = get_install_info_by_id(&app, id);

    if inst.is_some() {
        let install = inst.unwrap();
        let stringified = serde_json::to_string(&install).unwrap();
        Some(stringified)
    } else {
        None
    }
}

#[allow(unused_mut, unused_variables)]
#[tauri::command]
pub fn add_install(app: AppHandle, manifest_id: String, version: String, audio_lang: String, name: String, mut directory: String, mut runner_path: String, mut dxvk_path: String, runner_version: String, dxvk_version: String, game_icon: String, game_background: String, mut ignore_updates: bool, skip_hash_check: bool, mut use_jadeite: bool, use_xxmi: bool, use_fps_unlock: bool, env_vars: String, pre_launch_command: String, launch_command: String, fps_value: String, mut runner_prefix: String, launch_args: String, skip_game_dl: bool) -> Option<AddInstallRsp> {
    if manifest_id.is_empty() || version.is_empty() || name.is_empty() || directory.is_empty() || runner_path.is_empty() || dxvk_path.is_empty() || game_icon.is_empty() || game_background.is_empty() {
        None
    } else {
        let gs = get_settings(&app).unwrap();
        let cuid = generate_cuid();
        let m = manifest_id + ".json";
        let dbm = get_manifest_info_by_filename(&app, m.clone()).unwrap();
        let gm = get_manifest(&app, m.clone()).unwrap();
        let g = gm.game_versions.iter().find(|e| e.metadata.version == version).unwrap();

        let install_location = if skip_game_dl { Path::new(directory.as_str()).follow_symlink().unwrap().to_path_buf() } else { Path::new(directory.as_str()).join(cuid.clone()).follow_symlink().unwrap().to_path_buf() };
        if !install_location.exists() { fs::create_dir_all(&install_location).unwrap(); }
        directory = install_location.to_str().unwrap().to_string();

        // If wuwa is steam build auto ignore updates
        if gm.biz == "wuwa_global" && skip_game_dl {
            let steamdll = install_location.join("Client/Binaries/Win64/steam_api64.dll");
            if steamdll.exists() { ignore_updates = true; }
        }

        #[cfg(target_os = "windows")]
        {
            dxvk_path = "".to_string();
            runner_path = "".to_string();
        }

        #[cfg(target_os = "linux")]
        {
            let wine = Path::new(gs.default_runner_path.as_str()).follow_symlink().unwrap();
            let dxvk = Path::new(gs.default_dxvk_path.as_str()).follow_symlink().unwrap();
            let prefix_loc = Path::new(&runner_prefix).join(cuid.clone()).follow_symlink().unwrap();
            runner_prefix = prefix_loc.to_str().unwrap().to_string();

            // Remove prefix just in case
            if prefix_loc.exists() { fs::remove_dir_all(runner_prefix.clone()).unwrap(); }

            runner_path = wine.join(runner_version.clone()).follow_symlink().unwrap().to_str().unwrap().to_string();
            dxvk_path = dxvk.join(dxvk_version.clone()).follow_symlink().unwrap().to_str().unwrap().to_string();

            if !Path::exists(runner_path.as_ref()) { fs::create_dir_all(runner_path.clone()).unwrap(); }
            if !Path::exists(dxvk_path.as_ref()) { fs::create_dir_all(dxvk_path.clone()).unwrap(); }
            if !prefix_loc.exists() { fs::create_dir_all(runner_prefix.clone()).unwrap(); }
            
            let archandle = Arc::new(app.clone());
            let runv = Arc::new(runner_version.clone());
            let runpp = Arc::new(runner_path.clone());
            let rpp = Arc::new(runner_prefix.clone());
            //let dxvkpp = Arc::new(dxvk_path.clone());
            //let dxvkv = Arc::new(dxvk_version.clone());

            std::thread::spawn(move || {
                let rm = get_compatibility(archandle.as_ref(), &runner_from_runner_version(runv.as_str().to_string()).unwrap()).unwrap();
                let rv = rm.versions.into_iter().filter(|v| v.version.as_str() == runv.as_str()).collect::<Vec<_>>();
                let runnerp = rv.get(0).unwrap().to_owned();
                let rp = Path::new(runpp.as_str()).follow_symlink().unwrap().to_path_buf();

                // Download selected DXVK | Deprecated | Reason: Proton ships their own and this is pointless if wine is deprecated
                /*let dm = get_compatibility(archandle.as_ref(), &runner_from_runner_version(dxvkv.as_str().to_string()).unwrap()).unwrap();
                let dv = dm.versions.into_iter().filter(|v| v.version.as_str() == dxvkv.as_str()).collect::<Vec<_>>();
                let dxvkp = dv.get(0).unwrap().to_owned();
                if fs::read_dir(dxvkpp.as_str().to_string()).unwrap().next().is_none() { Compat::download_dxvk(dxvkp.url, dxvkpp.as_str().to_string(), true, move |_current, _total| {}); }*/

                if fs::read_dir(rp.as_path()).unwrap().next().is_none() {
                    let mut dlpayload = HashMap::new();

                    dlpayload.insert("name", runv.to_string());
                    dlpayload.insert("progress", "0".to_string());
                    dlpayload.insert("total", "1000".to_string());
                    archandle.emit("download_progress", dlpayload.clone()).unwrap();
                    prevent_exit(&*archandle, true);

                    let r0 = Compat::download_runner(runnerp.url, runpp.as_str().to_string(), true, {
                        let archandle = archandle.clone();
                        let dlpayload = dlpayload.clone();
                        let runv = runv.clone();
                        move |current, total| {
                            let mut dlpayload = dlpayload.clone();
                            dlpayload.insert("name", runv.to_string());
                            dlpayload.insert("progress", current.to_string());
                            dlpayload.insert("total", total.to_string());
                            archandle.emit("download_progress", dlpayload.clone()).unwrap();
                        }
                    });
                    if r0 {
                        /*let wine64 = if rm.paths.wine64.is_empty() { rm.paths.wine32 } else { rm.paths.wine64 };
                        let winebin = rp.join(wine64).to_str().unwrap().to_string();*/
                        let is_proton = rm.display_name.to_ascii_lowercase().contains("proton") && !rm.display_name.to_ascii_lowercase().contains("wine");

                        if is_proton {
                            archandle.emit("download_complete", ()).unwrap();
                            prevent_exit(&*archandle, false);
                            send_notification(&*archandle, format!("Download of {runn} complete.", runn = runv.as_str().to_string()).as_str(), None);
                        } else {
                            // Wine is deprecated | Reason: Honestly more trouble than its worth it and some games won't even work on it anymore
                            /*let r1 = Compat::setup_prefix(winebin, rpp.as_str().to_string());
                            if r1.is_ok() {
                                let r = r1.unwrap();
                                let r2 = Compat::stop_processes(r.wine.binary.to_str().unwrap().to_string(), rpp.as_str().to_string(), false);
                                if r2.is_ok() {
                                    let da = Compat::add_dxvk(r.wine.binary.to_str().unwrap().to_string(), rpp.as_str().to_string(), dxvkpp.as_str().to_string(), false);
                                    if da.is_ok() {
                                        Compat::stop_processes(r.wine.binary.to_str().unwrap().to_string(), rpp.as_str().to_string(), false).unwrap();
                                        if skip_game_dl { archandle.emit("download_complete", runv.as_str().to_string()).unwrap(); prevent_exit(&*archandle, false); send_notification(&*archandle, format!("Download of {runn} complete.", runn = runv.as_str().to_string()).as_str(), None); }
                                    }
                                }
                            }*/
                        }
                    }
                } else {
                    //let wine64 = if rm.paths.wine64.is_empty() { rm.paths.wine32 } else { rm.paths.wine64 };
                    //let winebin = rp.join(wine64).to_str().unwrap().to_string();
                    let is_proton = rm.display_name.to_ascii_lowercase().contains("proton") && !rm.display_name.to_ascii_lowercase().contains("wine");

                    if is_proton {  } else {
                        // Wine is deprecated | Reason: same as stated in many comments around this function
                        /*let r1 = Compat::setup_prefix(winebin, rpp.as_str().to_string());
                        if r1.is_ok() {
                            let r = r1.unwrap();
                            let r2 = Compat::stop_processes(r.wine.binary.to_str().unwrap().to_string(), rpp.as_str().to_string(), false);
                            if r2.is_ok() {
                                let da = Compat::add_dxvk(r.wine.binary.to_str().unwrap().to_string(), rpp.as_str().to_string(), dxvkpp.as_str().to_string(), false);
                                if da.is_ok() {
                                    Compat::stop_processes(r.wine.binary.to_str().unwrap().to_string(), rpp.as_str().to_string(), false).unwrap();
                                }
                            }
                        }*/
                    }
                }
            });

            // Patch wuwa if existing install
            if gm.biz == "wuwa_global" && skip_game_dl { let target = Path::new(&directory.clone()).join("Client/Binaries/Win64/ThirdParty/KrPcSdk_Global/KRSDKRes/KRSDK.bin").follow_symlink().unwrap();patch_aki(target.to_str().unwrap().to_string()); }
            // Download and enable jadeite automatically for these games
            if gm.biz == "bh3_global" {
                use_jadeite = true;
                let jadeite = Path::new(&gs.jadeite_path).follow_symlink().unwrap().to_path_buf();
                download_or_update_jadeite(jadeite, false);
            }
        }
        create_installation(&app, cuid.clone(), dbm.id, version, audio_lang, g.metadata.versioned_name.clone(), directory, runner_path, dxvk_path, runner_version, dxvk_version, g.assets.game_icon.clone(), g.assets.game_background.clone(), ignore_updates, skip_hash_check, use_jadeite, use_xxmi, use_fps_unlock, env_vars, pre_launch_command, launch_command, fps_value, runner_prefix, launch_args, false, false, gs.default_mangohud_config_path.clone()).unwrap();
        Some(AddInstallRsp {
            success: true,
            install_id: cuid.clone(),
            background: g.assets.game_background.clone()
        })
    }
}

#[tauri::command]
pub async fn remove_install(app: AppHandle, id: String, wipe_prefix: bool) -> Option<bool> {
    if id.is_empty() {
        None
    } else {
        let install = get_install_info_by_id(&app, id.clone());

        if install.is_some() {
            let i = install.unwrap();
            let lm = get_manifest_info_by_id(&app, i.manifest_id.clone()).unwrap();
            let gm = get_manifest(&app, lm.filename.clone()).unwrap();

            let installdir = i.directory;
            let prefixdir = i.runner_prefix;
            let idp = Path::new(&installdir);
            let pdp = Path::new(&prefixdir);
            let gexe = idp.join(gm.paths.exe_filename.clone());

            if wipe_prefix { if pdp.exists() { fs::remove_dir_all(prefixdir.clone()).unwrap(); } }
            if idp.exists() && gexe.exists() {
                let r = fs::remove_dir_all(installdir.clone());
                match r {
                    Ok(_) => {},
                    Err(e) => { send_notification(&app, format!("Failed to remove game installation directory. {} - Please remove the folder manually!", e.to_string()).as_str(), None) }
                }
            } else { send_notification(&app, "Failed to remove game installation directory. Please remove the folder manually!", None); }
            delete_installation_by_id(&app, id.clone()).unwrap();
            Some(true)
        } else {
            None
        }
    }
}

#[tauri::command]
pub fn update_install_game_path(app: AppHandle, id: String, path: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        let np = path.clone();
        let app1 = app.clone();
        let oldpath = Arc::new(m.directory);
        let installation_id = m.id.clone();
        let install_name = m.name.clone();

        if !Path::exists(path.as_ref()) { fs::create_dir_all(path.clone()).unwrap(); }

        // Initialize move only IF old path has files AND new path is empty directory
        if Path::exists(oldpath.as_ref().to_string().as_ref()) {
            if fs::read_dir(oldpath.as_ref()).unwrap().next().is_some() && fs::read_dir(&path).unwrap().next().is_none() {
                let op = oldpath.clone();
                std::thread::spawn(move || {
                    let ap = Path::new(op.as_ref()).follow_symlink().unwrap();
                    copy_dir_all(&app1, ap, &path.clone(), installation_id, install_name.clone(), "Game".to_string()).unwrap();

                    let mut payload = HashMap::new();
                    payload.insert("install_name", install_name.clone());
                    payload.insert("install_type", "Game".to_string());
                    payload.insert("progress", "0".to_string());
                    payload.insert("total", "1000".to_string());
                    app1.emit("move_complete", &payload).unwrap();
                    prevent_exit(&app1, false);
                    send_notification(&app1, format!("Moving of {inn}'s {intt} complete.", inn = install_name, intt = "Game").as_str(), None);
                });
            }
        }
        update_install_game_location_by_id(&app, m.id, np);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_runner_path(app: AppHandle, id: String, path: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        let np = path.clone();
        let app1 = app.clone();
        let oldpath = Arc::new(m.runner_path);
        let installation_id = m.id.clone();
        let install_name = m.name.clone();

        if !Path::exists(path.as_ref()) { fs::create_dir_all(path.clone()).unwrap(); }

        if Path::exists(oldpath.as_ref().to_string().as_ref()) {
            if fs::read_dir(oldpath.as_ref()).unwrap().next().is_some() && fs::read_dir(&path).unwrap().next().is_none() {
                let op = oldpath.clone();
                std::thread::spawn(move || {
                    let ap = Path::new(op.as_ref()).follow_symlink().unwrap();
                    copy_dir_all(&app1, ap, &path.clone(), installation_id, install_name.clone(), "Runner".to_string()).unwrap();

                    let mut payload = HashMap::new();
                    payload.insert("install_name", install_name.clone());
                    payload.insert("install_type", "Runner".to_string());
                    payload.insert("progress", "0".to_string());
                    payload.insert("total", "1000".to_string());
                    app1.emit("move_complete", &payload).unwrap();
                    prevent_exit(&app1, false);
                    send_notification(&app1, format!("Moving of {inn}'s {intt} complete.", inn = install_name, intt = "Runner").as_str(), None);
                });
            }
        }
        crate::utils::db_manager::update_install_runner_location_by_id(&app, m.id, np);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_dxvk_path(app: AppHandle, id: String, path: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        let np = path.clone();
        let app1 = app.clone();
        let oldpath = Arc::new(m.dxvk_path);
        let installation_id = m.id.clone();
        let install_name = m.name.clone();

        if !Path::exists(path.as_ref()) { fs::create_dir_all(path.clone()).unwrap(); }

        if Path::exists(oldpath.as_ref().to_string().as_ref()) {
            if fs::read_dir(oldpath.as_ref()).unwrap().next().is_some() && fs::read_dir(&path).unwrap().next().is_none() {
                let op = oldpath.clone();
                std::thread::spawn(move || {
                    let ap = Path::new(op.as_ref()).follow_symlink().unwrap();
                    copy_dir_all(&app1, ap, &path.clone(), installation_id, install_name.clone(),"DXVK".to_string()).unwrap();

                    let mut payload = HashMap::new();
                    payload.insert("install_name", install_name.clone());
                    payload.insert("install_type", "DXVK".to_string());
                    payload.insert("progress", "0".to_string());
                    payload.insert("total", "1000".to_string());
                    app1.emit("move_complete", &payload).unwrap();
                    prevent_exit(&app1, false);
                    send_notification(&app1, format!("Moving of {inn}'s {intt} complete.", inn = install_name, intt = "DXVK").as_str(), None);
                });
            }
        }
        crate::utils::db_manager::update_install_dxvk_location_by_id(&app, m.id, np);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_skip_version_updates(app: AppHandle, id: String, enabled: bool) -> Option<bool> {
    let manifest = get_install_info_by_id(&app, id);

    if manifest.is_some() {
        let m = manifest.unwrap();
        update_install_ignore_updates_by_id(&app, m.id, enabled);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_skip_hash_valid(app: AppHandle, id: String, enabled: bool) -> Option<bool> {
    let manifest = get_install_info_by_id(&app, id);

    if manifest.is_some() {
        let m = manifest.unwrap();
        update_install_skip_hash_check_by_id(&app, m.id, enabled);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_use_jadeite(app: AppHandle, id: String, enabled: bool) -> Option<bool> {
    let manifest = get_install_info_by_id(&app, id);
    let settings = get_settings(&app).unwrap();

    if manifest.is_some() {
        let m = manifest.unwrap();
        let p = Path::new(&settings.jadeite_path).follow_symlink().unwrap().to_path_buf();

        update_install_use_jadeite_by_id(&app, m.id, enabled);
        if enabled { download_or_update_jadeite(p, false); }
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_use_xxmi(app: AppHandle, id: String, enabled: bool) -> Option<bool> {
    let manifest = get_install_info_by_id(&app, id);
    let settings = get_settings(&app).unwrap();

    if manifest.is_some() {
        let m = manifest.unwrap();
        let p = Path::new(&settings.xxmi_path).follow_symlink().unwrap().to_path_buf();

        update_install_use_xxmi_by_id(&app, m.id, enabled);
        if enabled { download_or_update_xxmi(&app, p, false); }
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_use_fps_unlock(app: AppHandle, id: String, enabled: bool) -> Option<bool> {
    let manifest = get_install_info_by_id(&app, id);
    let settings = get_settings(&app).unwrap();

    if manifest.is_some() {
        let m = manifest.unwrap();
        let p = Path::new(&settings.fps_unlock_path).follow_symlink().unwrap().to_path_buf();

        update_install_use_fps_unlock_by_id(&app, m.id, enabled);
        if enabled { download_or_update_fps_unlock(p, false); }
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_fps_value(app: AppHandle, id: String, fps: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);
    let settings = get_settings(&app).unwrap();

    if install.is_some() {
        let m = install.unwrap();
        let p = Path::new(&settings.fps_unlock_path).follow_symlink().unwrap().to_path_buf();

        update_install_fps_value_by_id(&app, m.id, fps);
        if m.use_fps_unlock { download_or_update_fps_unlock(p, false); }
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_use_gamemode(app: AppHandle, id: String, enabled: bool) -> Option<bool> {
    let manifest = get_install_info_by_id(&app, id);

    if manifest.is_some() {
        let m = manifest.unwrap();
        update_install_use_gamemode_by_id(&app, m.id, enabled);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_use_mangohud(app: AppHandle, id: String, enabled: bool) -> Option<bool> {
    let manifest = get_install_info_by_id(&app, id);

    if manifest.is_some() {
        let m = manifest.unwrap();
        update_install_use_mangohud_by_id(&app, m.id, enabled);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_mangohud_config_path(app: AppHandle, id: String, path: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        let np = path.clone();
        update_install_mangohud_config_location_by_id(&app, m.id, np);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_env_vars(app: AppHandle, id: String, env_vars: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        update_install_env_vars_by_id(&app, m.id, env_vars);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_pre_launch_cmd(app: AppHandle, id: String, cmd: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        update_install_pre_launch_cmd_by_id(&app, m.id, cmd);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_launch_cmd(app: AppHandle, id: String, cmd: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        update_install_launch_cmd_by_id(&app, m.id, cmd);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_prefix_path(app: AppHandle, id: String, path: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        let np = path.clone();
        let app1 = app.clone();
        let oldpath = Arc::new(m.runner_prefix.clone());
        let installation_id = m.id.clone();
        let install_name = m.name.clone();

        if !Path::exists(path.as_ref()) { fs::create_dir_all(path.clone()).unwrap(); }

        if Path::exists(oldpath.as_ref().to_string().as_ref()) {
            if fs::read_dir(oldpath.as_ref()).unwrap().next().is_some() && fs::read_dir(&path).unwrap().next().is_none() {
                let op = oldpath.clone();
                std::thread::spawn(move || {
                    let ap = Path::new(op.as_ref()).follow_symlink().unwrap();
                    copy_dir_all(&app1, ap, &path.clone(), installation_id, install_name.clone(), "Prefix".to_string()).unwrap();

                    let mut payload = HashMap::new();
                    payload.insert("install_name", install_name.clone());
                    payload.insert("install_type", "Prefix".to_string());
                    payload.insert("progress", "0".to_string());
                    payload.insert("total", "1000".to_string());
                    app1.emit("move_complete", &payload).unwrap();
                    prevent_exit(&app1, false);
                    send_notification(&app1, format!("Moving of {inn}'s {intt} complete.", inn = install_name, intt = "Prefix").as_str(), None);
                });
            }
        }
        update_install_prefix_location_by_id(&app, m.id, np);
        Some(true)
    } else {
        None
    }
}

#[tauri::command]
pub fn update_install_launch_args(app: AppHandle, id: String, args: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);

    if install.is_some() {
        let m = install.unwrap();
        update_install_launch_args_by_id(&app, m.id, args);
        Some(true)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn update_install_runner_version(app: AppHandle, id: String, version: String) -> Option<bool> {
        let install = get_install_info_by_id(&app, id);

        if install.is_some() {
            let m = install.unwrap();
            let rp = m.runner_path.clone();
            let rpn = rp.replace(m.runner_version.as_str(), version.as_str());
            if !Path::exists(rpn.as_ref()) { fs::create_dir_all(rpn.clone()).unwrap(); }

            let archandle = Arc::new(app.clone());
            let runv = Arc::new(version.clone());
            let runpp = Arc::new(rpn.clone());
            let rpp = Arc::new(m.runner_prefix.clone());

            if fs::read_dir(rpn.as_str()).unwrap().next().is_none() {
                std::thread::spawn(move || {
                    let rm = get_compatibility(archandle.as_ref(), &runner_from_runner_version(runv.as_str().to_string()).unwrap()).unwrap();
                    let rv = rm.versions.into_iter().filter(|v| v.version.as_str() == runv.as_str()).collect::<Vec<_>>();
                    let runnerp = rv.get(0).unwrap().to_owned();
                    let rp = Path::new(runpp.as_str()).follow_symlink().unwrap().to_path_buf();

                    let mut dlpayload = HashMap::new();

                    dlpayload.insert("name", runv.to_string());
                    dlpayload.insert("progress", "0".to_string());
                    dlpayload.insert("total", "1000".to_string());
                    archandle.emit("download_progress", dlpayload.clone()).unwrap();
                    prevent_exit(&*archandle, true);

                    let r0 = Compat::download_runner(runnerp.url, runpp.as_str().to_string(), true, {
                        let archandle = archandle.clone();
                        let dlpayload = dlpayload.clone();
                        let runv = runv.clone();
                        move |current, total| {
                            let mut dlpayload = dlpayload.clone();
                            dlpayload.insert("name", runv.to_string());
                            dlpayload.insert("progress", current.to_string());
                            dlpayload.insert("total", total.to_string());
                            archandle.emit("download_progress", dlpayload.clone()).unwrap();
                        }
                    });
                    if r0 {
                        let wine64 = if rm.paths.wine64.is_empty() { rm.paths.wine32 } else { rm.paths.wine64 };
                        let winebin = rp.join(wine64).to_str().unwrap().to_string();

                        let is_proton = rm.display_name.to_ascii_lowercase().contains("proton") && !rm.display_name.to_ascii_lowercase().contains("wine");
                        if is_proton {  } else { Compat::update_prefix(winebin, rpp.as_str().to_string()).unwrap(); }
                        archandle.emit("download_complete", ()).unwrap();
                        prevent_exit(&*archandle, false);
                        send_notification(&*archandle, format!("Download of {rnn} complete.", rnn = runv.as_str().to_string()).as_str(), None);
                    }
                });
            } else {
                std::thread::spawn(move || {
                    let rm = get_compatibility(archandle.as_ref(), &runner_from_runner_version(runv.as_str().to_string()).unwrap()).unwrap();
                    let rp = Path::new(runpp.as_str()).follow_symlink().unwrap().to_path_buf();

                    let wine64 = if rm.paths.wine64.is_empty() { rm.paths.wine32 } else { rm.paths.wine64 };
                    let winebin = rp.join(wine64).to_str().unwrap().to_string();

                    let is_proton = rm.display_name.to_ascii_lowercase().contains("proton") && !rm.display_name.to_ascii_lowercase().contains("wine");
                    if is_proton {  } else { Compat::update_prefix(winebin, rpp.as_str().to_string()).unwrap(); }
                });
            }

            crate::utils::db_manager::update_install_runner_version_by_id(&app, m.id.clone(), version);
            crate::utils::db_manager::update_install_runner_location_by_id(&app, m.id, rpn);
            Some(true)
        } else {
            None
        }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn update_install_runner_version(_app: AppHandle, _id: String, _version: String) -> Option<bool> {None}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn update_install_dxvk_version(app: AppHandle, id: String, version: String) -> Option<bool> {
        let install = get_install_info_by_id(&app, id);

        if install.is_some() {
            let m = install.unwrap();
            let p = m.dxvk_path.clone();
            let pn = p.replace(m.dxvk_version.as_str(), version.as_str());
            if !Path::exists(pn.as_ref()) { fs::create_dir_all(pn.clone()).unwrap(); }

            let archandle = Arc::new(app.clone());
            let dxvkv = Arc::new(version.clone());
            let dxpp = Arc::new(pn.clone());
            let rpp = Arc::new(m.runner_prefix.clone());
            let runv = Arc::new(m.runner_version.clone());
            let runp = Arc::new(m.runner_path.clone());

            if fs::read_dir(pn.as_str()).unwrap().next().is_none() {
                std::thread::spawn(move || {
                    let rm = get_compatibility(archandle.as_ref(), &runner_from_runner_version(runv.as_str().to_string()).unwrap()).unwrap();
                    let dm = get_compatibility(archandle.as_ref(), &runner_from_runner_version(dxvkv.as_str().to_string()).unwrap()).unwrap();
                    let dv = dm.versions.into_iter().filter(|v| v.version.as_str() == dxvkv.as_str()).collect::<Vec<_>>();
                    let dxp = dv.get(0).unwrap().to_owned();
                    let dxpp = Path::new(dxpp.as_str()).follow_symlink().unwrap().to_path_buf();
                    let rp = Path::new(runp.as_str()).follow_symlink().unwrap().to_path_buf();

                    let mut dlpayload = HashMap::new();

                    let is_proton = rm.display_name.to_ascii_lowercase().contains("proton") && !rm.display_name.to_ascii_lowercase().contains("wine");

                    if is_proton { send_notification(&*archandle, "Skipping DXVK download because Proton ships with DXVK.", None); } else {
                        dlpayload.insert("name", runv.to_string());
                        dlpayload.insert("progress", "0".to_string());
                        dlpayload.insert("total", "1000".to_string());
                        archandle.emit("download_progress", dlpayload.clone()).unwrap();
                        prevent_exit(&*archandle, true);

                        let r0 = Compat::download_dxvk(dxp.url, dxpp.to_str().unwrap().to_string(), true, {
                            let archandle = archandle.clone();
                            let dlpayload = dlpayload.clone();
                            let runv = runv.clone();
                            move |current, total| {
                                let mut dlpayload = dlpayload.clone();
                                dlpayload.insert("name", runv.to_string());
                                dlpayload.insert("progress", current.to_string());
                                dlpayload.insert("total", total.to_string());
                                archandle.emit("download_progress", dlpayload.clone()).unwrap();
                            }
                        });
                        if r0 {
                            let wine64 = if rm.paths.wine64.is_empty() { rm.paths.wine32 } else { rm.paths.wine64 };
                            let winebin = rp.join(wine64).to_str().unwrap().to_string();

                            let r1 = Compat::remove_dxvk(winebin.clone(), rpp.as_str().to_string());
                            if r1.is_ok() {
                                Compat::add_dxvk(winebin, rpp.as_str().to_string(), dxpp.to_str().unwrap().to_string(), false).unwrap();
                                archandle.emit("download_complete", ()).unwrap();
                                prevent_exit(&*archandle, false);
                                send_notification(&*archandle, format!("Download of {dxvn} complete.", dxvn = dxvkv.as_str().to_string()).as_str(), None);
                            }
                        }
                    }
                });
            } else {
                std::thread::spawn(move || {
                    let rm = get_compatibility(archandle.as_ref(), &runner_from_runner_version(runv.as_str().to_string()).unwrap()).unwrap();
                    let dxpp = Path::new(dxpp.as_str()).follow_symlink().unwrap().to_path_buf();
                    let rp = Path::new(runp.as_str()).follow_symlink().unwrap().to_path_buf();

                    let is_proton = rm.display_name.to_ascii_lowercase().contains("proton") && !rm.display_name.to_ascii_lowercase().contains("wine");

                    if is_proton {  } else {
                        let wine64 = if rm.paths.wine64.is_empty() { rm.paths.wine32 } else { rm.paths.wine64 };
                        let winebin = rp.join(wine64).to_str().unwrap().to_string();
                        let r1 = Compat::remove_dxvk(winebin.clone(), rpp.as_str().to_string());
                        if r1.is_ok() { Compat::add_dxvk(winebin, rpp.as_str().to_string(), dxpp.to_str().unwrap().to_string(), false).unwrap(); }
                    }
                });
            }

            crate::utils::db_manager::update_install_dxvk_version_by_id(&app, m.id.clone(), version);
            crate::utils::db_manager::update_install_dxvk_location_by_id(&app, m.id, pn);
            Some(true)
        } else {
            None
        }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn update_install_dxvk_version(_app: AppHandle, _id: String, _version: String) -> Option<bool> {None}

#[tauri::command]
pub fn game_launch(app: AppHandle, id: String) -> Option<bool> {
    let install = get_install_info_by_id(&app, id);
    let global_settings = get_settings(&app).unwrap();

    if install.is_some() {
        let m = install.unwrap();
        let gmm = get_manifest_info_by_id(&app, m.clone().manifest_id).unwrap();
        let gm = get_manifest(&app, gmm.filename).unwrap();

        let rslt = launch(&app, m.clone(), gm, global_settings).unwrap();
        if rslt {
            Some(true)
        } else {
            send_notification(&app, "Failed to launch game! Please check game.log file inside game directory for more information.", None);
            None
        }
    } else {
        send_notification(&app, "Failed to find game installation!", None);
        None
    }
}

#[tauri::command]
pub fn get_download_sizes(app: AppHandle, biz: String, version: String, lang: String, path: String) -> Option<String> {
    let manifest = get_manifest(&app, biz + ".json");

    if manifest.is_some() {
        let m = manifest.unwrap();
        
        let entry = m.game_versions.into_iter().filter(|e| e.metadata.version == version).collect::<Vec<GameVersion>>();
        let g = entry.get(0).unwrap();
        let gs = g.game.full.iter().map(|x| x.decompressed_size.parse::<u64>().unwrap()).sum::<u64>();
        let mut fss = gs;
        if !g.audio.full.is_empty() {
            let audios: Vec<_> = g.audio.full.iter().filter(|x| x.language == lang).collect();
            let audio = audios.get(0).unwrap().decompressed_size.parse::<u64>().unwrap();
            fss = gs.add(audio);
        }

        let p = Path::new(&path).follow_symlink().unwrap();
        let a = available(p);
        let stringified;
        
        if a.is_some() {
            stringified = serde_json::to_string(&DownloadSizesRsp {
                game_decompressed_size: prettify_bytes(fss),
                free_disk_space: prettify_bytes(a.unwrap()),
                game_decompressed_size_raw: fss,
                free_disk_space_raw: a.unwrap(),
            }).unwrap();
        } else {
            stringified = serde_json::to_string(&DownloadSizesRsp {
                game_decompressed_size: prettify_bytes(fss),
                free_disk_space: prettify_bytes(0),
                game_decompressed_size_raw: fss,
                free_disk_space_raw: 0,
            }).unwrap();
        };
        
        Some(stringified)
    } else {
        None
    }
}

#[tauri::command]
pub fn get_resume_states(app: AppHandle, install: String) -> Option<String> {
    let install = get_install_info_by_id(&app, install);

    if install.is_some() {
        let i = install.unwrap();

        let ip = Path::new(&i.directory).follow_symlink().unwrap();
        let dp = ip.join("downloading");
        let up = ip.join("patching");
        let pup = ip.join("patching").join(".preload");
        let rep = ip.join("repairing");
        
        let frsp: ResumeStatesRsp;
        if dp.exists() && !rep.exists() && !up.exists() && !pup.exists() {
            frsp = ResumeStatesRsp {
                downloading: true,
                updating: false,
                preloading: false,
                repairing: false,
            };
        } else if up.exists() && !rep.exists() && !pup.exists() && !dp.exists() {
            frsp = ResumeStatesRsp {
                downloading: false,
                updating: true,
                preloading: false,
                repairing: false,
            };
        } else if pup.exists() && !dp.exists() && !up.exists() && !rep.exists() {
            frsp = ResumeStatesRsp {
                downloading: false,
                updating: false,
                preloading: true,
                repairing: false,
            };
        } else if rep.exists() && !dp.exists() && !up.exists() && !pup.exists() {
            frsp = ResumeStatesRsp {
                downloading: false,
                updating: false,
                preloading: false,
                repairing: true,
            };
        } else {
            frsp = ResumeStatesRsp {
                downloading: false,
                updating: false,
                preloading: false,
                repairing: false,
            };
        }

        let stringified = serde_json::to_string(&frsp).unwrap();
        Some(stringified)
    } else {
        None
    }
}

#[tauri::command]
pub fn add_shortcut(app: AppHandle, install_id: String, shortcut_type: String) {
    let install = get_install_info_by_id(&app, install_id).unwrap();
    #[cfg(target_os = "linux")]
    {
        match shortcut_type.as_str() {
            "desktop" => {
                let base = app.path().home_dir().unwrap().join(".local/share/applications");
                let file = base.join(format!("{}.desktop", install.name.as_str())).follow_symlink().unwrap();
                let bin_name = if is_flatpak() { "flatpak run app.twintaillauncher.ttl" } else { "twintaillauncher" };
                let icon = if is_flatpak() { "app.twintaillauncher.ttl" } else { "twintaillauncher" };

                let content = format!(r#"[Desktop Entry]
Categories=Game;
Comment=Launch this game using TwintailLauncher
Exec={} --install={}
Icon={}
Name={}
Terminal=false
Type=Application
"#, bin_name, install.id.as_str(), icon, install.name.as_str());

                let status = add_desktop_shortcut(file.clone(), content);
                if status {
                    update_install_shortcut_location_by_id(&app, install.id.clone(), file.clone().to_str().unwrap().to_string());
                    send_notification(&app, format!("Successfully created {} desktop shortcut.", install.name.as_str()).as_str(), None);
                } else { send_notification(&app, format!("Failed to create {} desktop shortcut! If you use flatpak please make sure we have permission to access ~/.local/share/applications", install.name.as_str()).as_str(), None); }
            }
            "steam" => {
                let flatpak_steam = app.path().home_dir().unwrap().follow_symlink().unwrap().join(".var/app/com.valvesoftware.Steam/data/Steam/userdata");
                let normal_steam = app.path().data_dir().unwrap().follow_symlink().unwrap().join("Steam/userdata");

                let manifest = get_manifest_info_by_id(&app, install.manifest_id).unwrap();
                let m = get_manifest(&app, manifest.filename).unwrap();
                let launchargs = format!("--install={}", install.id.as_str());

                let shortcut = Shortcut {
                    order: "",
                    app_id: calculate_app_id(m.paths.exe_filename.as_str(), install.name.as_str()),
                    app_name: install.name.as_str(),
                    exe: if is_flatpak() { "flatpak run app.twintaillauncher.ttl" } else { "twintaillauncher" },
                    start_dir: install.directory.as_str(),
                    icon: install.game_icon.as_str(),
                    shortcut_path: "",
                    launch_options: launchargs.as_str(),
                    is_hidden: false,
                    allow_desktop_config: true,
                    allow_overlay: true,
                    open_vr: 0,
                    dev_kit: 0,
                    dev_kit_game_id: "",
                    dev_kit_overrite_app_id: 0,
                    last_play_time: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as u32,
                    tags: vec!["twintaillauncher", "ttl"],
                };

                if flatpak_steam.exists() {
                    let status = add_steam_shortcut(flatpak_steam, install.name.as_str(), shortcut.clone());
                    if status {
                        update_install_shortcut_is_steam_by_id(&app, install.id.clone(), true);
                        send_notification(&app, format!("Successfully added {} to Steam (Flatpak), please restart Steam to apply changes.", install.name.as_str()).as_str(), None);
                    } else { send_notification(&app, format!("Failed to add {} to Steam (Flatpak)!", install.name.as_str()).as_str(), None); }
                }

                if normal_steam.exists() {
                    let status = add_steam_shortcut(normal_steam, install.name.as_str(), shortcut);
                    if status {
                        update_install_shortcut_is_steam_by_id(&app, install.id.clone(), true);
                        send_notification(&app, format!("Successfully added {} to Steam, please restart Steam to apply changes.", install.name.as_str()).as_str(), None);
                    } else { send_notification(&app, format!("Failed to add {} to Steam!", install.name.as_str()).as_str(), None); }
                }
            }
            _ => {}
        }
    };

    #[cfg(target_os = "windows")]
    {
        match shortcut_type.as_str() {
            "desktop" => {
                let base = app.path().desktop_dir().unwrap();
                let bin_name = app.path().app_local_data_dir().unwrap().join("twintaillauncher.exe");
                let file = base.join(format!("{}.lnk", install.name.as_str()));
                let sl = shortcuts_rs::ShellLink::new(bin_name.as_path(), Some(format!("--install={}", install.id.as_str())), Some(install.name.clone()), None).unwrap();
                let r = sl.create_lnk(file.as_path());
                if r.is_ok() {
                    update_install_shortcut_location_by_id(&app, install.id.clone(), file.clone().to_str().unwrap().to_string());
                    send_notification(&app, "Successfully created desktop shortcut. Find it on your desktop.", None);
                } else { send_notification(&app, "Failed to create launch shortcut!", None); }
            }
            "steam" => { send_notification(&app, "Steam shortcuts are currently not supported on Windows!", None); }
            _ => {}
        }
    }
}

#[tauri::command]
pub fn remove_shortcut(app: AppHandle, install_id: String, shortcut_type: String) {
    let install = get_install_info_by_id(&app, install_id).unwrap();
    #[cfg(target_os = "linux")]
    {
        match shortcut_type.as_str() {
            "desktop" => {
                let base = app.path().home_dir().unwrap().join(".local/share/applications");
                let file = base.join(format!("{}.desktop", install.name.as_str())).follow_symlink().unwrap();

                let status = remove_desktop_shortcut(file.clone());
                if status {
                    update_install_shortcut_location_by_id(&app, install.id.clone(), "".to_string());
                    send_notification(&app, format!("Successfully deleted {} desktop shortcut.", install.name.as_str()).as_str(), None);
                } else { send_notification(&app, format!("Desktop shortcut for {} does not exist!", install.name.as_str()).as_str(), None); }
            }
            "steam" => {
                let flatpak_steam = app.path().home_dir().unwrap().follow_symlink().unwrap().join(".var/app/com.valvesoftware.Steam/data/Steam/userdata");
                let normal_steam = app.path().data_dir().unwrap().follow_symlink().unwrap().join("Steam/userdata");

                if flatpak_steam.exists() {
                    let status = remove_steam_shortcut(flatpak_steam, install.name.as_str());
                    if status {
                        update_install_shortcut_is_steam_by_id(&app, install.id.clone(), false);
                        send_notification(&app, format!("Successfully removed {} from Steam (Flatpak), please restart Steam to apply changes.", install.name.as_str()).as_str(), None);
                    } else {
                        send_notification(&app, format!("Failed to remove {} from Steam (Flatpak)!", install.name.as_str()).as_str(), None);
                    }
                }

                if normal_steam.exists() {
                    let status = remove_steam_shortcut(normal_steam, install.name.as_str());
                    if status {
                        update_install_shortcut_is_steam_by_id(&app, install.id.clone(), false);
                        send_notification(&app, format!("Successfully removed {} from Steam, please restart Steam to apply changes.", install.name.as_str()).as_str(), None);
                    } else {
                        send_notification(&app, format!("Failed to remove {} from Steam!", install.name.as_str()).as_str(), None);
                    }
                }
            }
            _ => {}
        }
    };

    #[cfg(target_os = "windows")]
    {
      match shortcut_type.as_str() {
          "desktop" => {
              let base = app.path().desktop_dir().unwrap();
              let file = base.join(format!("{}.lnk", install.name.as_str()));

              let status = remove_desktop_shortcut(file.clone());
              if status {
                  update_install_shortcut_location_by_id(&app, install.id.clone(), "".to_string());
                  send_notification(&app, "Successfully deleted desktop shortcut.", None);
              } else { crate::utils::send_notification(&app, "Desktop shortcut for this game does not exist!", None); }
          }
          "steam" => { send_notification(&app, "Steam shortcuts are currently not supported on Windows!", None); }
          _ => {}
      }
    };
}