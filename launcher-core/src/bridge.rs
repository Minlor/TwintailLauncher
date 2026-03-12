use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};
use crate::runtime::{LauncherContext, Emitter, Listener};

#[derive(Deserialize)]
struct RpcRequest {
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct RpcResponse {
    jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

#[derive(Serialize)]
struct RpcEventNotification {
    jsonrpc: &'static str,
    method: &'static str,
    params: RpcEventParams,
}

#[derive(Serialize)]
struct RpcEventParams {
    event_name: String,
    payload: Value,
}

#[derive(Deserialize)]
struct RuntimeInvokeParams {
    command: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Deserialize)]
struct RuntimeEmitParams {
    event_name: String,
    #[serde(default)]
    payload: Value,
}

macro_rules! req_str {
    ($payload:expr,$($key:expr),+ $(,)?) => {
        get_required_string($payload,&[$($key),+])?
    };
}

macro_rules! req_bool {
    ($payload:expr,$($key:expr),+ $(,)?) => {
        get_required_bool($payload,&[$($key),+])?
    };
}

macro_rules! req_i64 {
    ($payload:expr,$($key:expr),+ $(,)?) => {
        get_required_i64($payload,&[$($key),+])?
    };
}

macro_rules! req_usize {
    ($payload:expr,$($key:expr),+ $(,)?) => {
        get_required_usize($payload,&[$($key),+])?
    };
}

pub fn start_stdio_bridge(app: LauncherContext) {
    let writer = Arc::new(Mutex::new(io::BufWriter::new(io::stdout())));
    write_json(&writer, &RpcEventNotification { jsonrpc: "2.0", method: "event", params: RpcEventParams { event_name: "sidecar_ready".to_string(), payload: serde_json::json!({"protocol":"jsonrpc-stdio-v1"}) } });
    register_event_forwarders(app.clone(), writer.clone());
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break; };
        let line = line.trim_start_matches('\u{feff}').trim().to_string();
        if line.is_empty() { continue; }
        let request = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(req) => req,
            Err(err) => {
                write_json(&writer, &RpcResponse { jsonrpc: "2.0", id: None, result: None, error: Some(RpcError { code: -32700, message: format!("Invalid JSON-RPC payload: {err}") }) });
                continue;
            }
        };
        let response = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { handle_request(&app, request) })) {
            Ok(r) => r,
            Err(_) => rpc_error(None, -32603, "Internal error: command handler panicked".to_string()),
        };
        write_json(&writer, &response);
    }
}

fn register_event_forwarders(app: LauncherContext, writer: Arc<Mutex<io::BufWriter<io::Stdout>>>) {
    for event_name in ["show_dialog","download_queue_state","download_progress","download_installing","download_complete","download_paused","download_removed","update_progress","update_installing","update_complete","update_paused","repair_progress","repair_installing","repair_complete","repair_paused","preload_progress","preload_installing","preload_complete","preload_paused","move_progress","move_complete","game_closed","connection_status"] {
        let wr = writer.clone();
        let name = event_name.to_string();
        app.listen_any(event_name, move |event| {
            let payload = parse_event_payload(event.payload());
            write_json(&wr, &RpcEventNotification { jsonrpc: "2.0", method: "event", params: RpcEventParams { event_name: name.clone(), payload } });
        });
    }
}

fn handle_request(app: &LauncherContext, request: RpcRequest) -> RpcResponse {
    let rslt = match request.method.as_str() {
        "runtime.invoke" => {
            let params: RuntimeInvokeParams = match serde_json::from_value(request.params.clone()) {
                Ok(params) => params,
                Err(err) => { return rpc_error(request.id, -32602, format!("Invalid invoke params: {err}")); }
            };
            dispatch_invoke(app, params.command.as_str(), &params.payload)
        }
        "runtime.emit" => {
            let params: RuntimeEmitParams = match serde_json::from_value(request.params.clone()) {
                Ok(params) => params,
                Err(err) => { return rpc_error(request.id, -32602, format!("Invalid emit params: {err}")); }
            };
            dispatch_emit(app, params.event_name.as_str(), params.payload)
        }
        _ => Err(format!("Unsupported RPC method {}", request.method)),
    };
    match rslt { Ok(result) => RpcResponse { jsonrpc: "2.0", id: request.id, result: Some(result), error: None }, Err(err) => rpc_error(request.id, -32601, err) }
}

fn dispatch_invoke(app: &LauncherContext, command: &str, payload: &Value) -> Result<Value, String> {
    let payload = get_payload_map(payload)?;
    match command {
        "list_settings" => to_json(crate::utils::run_async_command(async { crate::commands::settings::list_settings(app.clone()).await })),
        "update_settings_download_speed_limit_cmd" => to_json(crate::commands::settings::update_settings_download_speed_limit_cmd(app.clone(), req_i64!(payload, "speed_limit", "speedLimit"))),
        "update_settings_third_party_repo_updates" => to_json(crate::commands::settings::update_settings_third_party_repo_updates(app.clone(), req_bool!(payload, "enabled"))),
        "update_settings_default_game_path" => to_json(crate::commands::settings::update_settings_default_game_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_default_xxmi_path" => to_json(crate::commands::settings::update_settings_default_xxmi_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_default_fps_unlock_path" => to_json(crate::commands::settings::update_settings_default_fps_unlock_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_default_jadeite_path" => to_json(crate::commands::settings::update_settings_default_jadeite_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_default_prefix_path" => to_json(crate::commands::settings::update_settings_default_prefix_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_default_runner_path" => to_json(crate::commands::settings::update_settings_default_runner_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_default_dxvk_path" => to_json(crate::commands::settings::update_settings_default_dxvk_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_default_mangohud_config_path" => to_json(crate::commands::settings::update_settings_default_mangohud_config_path(app.clone(), req_str!(payload, "path"))),
        "update_settings_launcher_action" => to_json(crate::commands::settings::update_settings_launcher_action(app.clone(), req_str!(payload, "action"))),
        "update_settings_manifests_hide" => to_json(crate::commands::settings::update_settings_manifests_hide(app.clone(), req_bool!(payload, "enabled"))),
        "open_folder" => { crate::commands::settings::open_folder(app.clone(), req_str!(payload, "manifest_id", "manifestId"), req_str!(payload, "install_id", "installId"), req_str!(payload, "runner_version", "runnerVersion"), req_str!(payload, "path_type", "pathType")); Ok(Value::Null) }
        "empty_folder" => { crate::commands::settings::empty_folder(app.clone(), req_str!(payload, "install_id", "installId"), req_str!(payload, "path_type", "pathType")); Ok(Value::Null) }
        "open_in_prefix" => { crate::commands::settings::open_in_prefix(app.clone(), req_str!(payload, "install_id", "installId"), req_str!(payload, "path_type", "pathType")); Ok(Value::Null) }
        "open_uri" => { crate::commands::settings::open_uri(app.clone(), req_str!(payload, "uri")); Ok(Value::Null) }
        "list_repositories" => to_json(crate::commands::repository::list_repositories(app.clone())),
        "get_repository" => to_json(crate::commands::repository::get_repository(app.clone(), req_str!(payload, "repository_id", "repositoryId"))),
        "add_repository" => to_json(crate::commands::repository::add_repository(app.clone(), req_str!(payload, "url"))),
        "remove_repository" => to_json(crate::commands::repository::remove_repository(app.clone(), req_str!(payload, "id"))),
        "get_manifest_by_id" => to_json(crate::commands::manifest::get_manifest_by_id(app.clone(), req_str!(payload, "id"))),
        "get_manifest_by_filename" => to_json(crate::commands::manifest::get_manifest_by_filename(app.clone(), req_str!(payload, "filename"))),
        "list_manifests_by_repository_id" => to_json(crate::commands::manifest::list_manifests_by_repository_id(app.clone(), req_str!(payload, "repository_id", "repositoryId"))),
        "update_manifest_enabled" => to_json(crate::commands::manifest::update_manifest_enabled(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "list_game_manifests" => to_json(crate::commands::manifest::list_game_manifests(app.clone())),
        "get_game_manifest_by_filename" => to_json(crate::commands::manifest::get_game_manifest_by_filename(app.clone(), req_str!(payload, "filename"))),
        "get_game_manifest_by_manifest_id" => to_json(crate::commands::manifest::get_game_manifest_by_manifest_id(app.clone(), req_str!(payload, "id"))),
        "override_manifest_url" => {
            let filename = req_str!(payload, "filename");
            let url = req_str!(payload, "url");
            to_json(crate::utils::run_async_command(async { crate::commands::manifest::override_manifest_url(app.clone(), filename, url).await }))
        }
        "clear_manifest_override" => to_json(crate::commands::manifest::clear_manifest_override(app.clone(), req_str!(payload, "filename"))),
        "list_compatibility_manifests" => to_json(crate::commands::manifest::list_compatibility_manifests(app.clone())),
        "get_compatibility_manifest_by_manifest_id" => to_json(crate::commands::manifest::get_compatibility_manifest_by_manifest_id(app.clone(), req_str!(payload, "id"))),
        "list_installs" => to_json(crate::utils::run_async_command(async { crate::commands::install::list_installs(app.clone()).await })),
        "list_installs_by_manifest_id" => to_json(crate::commands::install::list_installs_by_manifest_id(app.clone(), req_str!(payload, "manifest_id", "manifestId"))),
        "set_installs_order" => to_json({ crate::commands::install::set_installs_order(app.clone(), get_required_value::<Vec<(String, i32)>>(payload, &["order"])?); true }),
        "get_install_by_id" => to_json(crate::commands::install::get_install_by_id(app.clone(), req_str!(payload, "id"))),
        "add_install" => to_json(crate::commands::install::add_install(app.clone(), req_str!(payload, "manifest_id", "manifestId"), req_str!(payload, "version"), req_str!(payload, "audio_lang", "audioLang"), req_str!(payload, "name"), req_str!(payload, "directory"), get_optional_string(payload, &["runner_path", "runnerPath"]).unwrap_or_default(), get_optional_string(payload, &["dxvk_path", "dxvkPath"]).unwrap_or_default(), req_str!(payload, "runner_version", "runnerVersion"), req_str!(payload, "dxvk_version", "dxvkVersion"), req_str!(payload, "game_icon", "gameIcon"), req_str!(payload, "game_background", "gameBackground"), req_bool!(payload, "ignore_updates", "ignoreUpdates"), req_bool!(payload, "skip_hash_check", "skipHashCheck"), req_bool!(payload, "use_jadeite", "useJadeite"), req_bool!(payload, "use_xxmi", "useXxmi"), req_bool!(payload, "use_fps_unlock", "useFpsUnlock"), req_str!(payload, "env_vars", "envVars"), req_str!(payload, "pre_launch_command", "preLaunchCommand"), req_str!(payload, "launch_command", "launchCommand"), req_str!(payload, "fps_value", "fpsValue"), req_str!(payload, "runner_prefix", "runnerPrefix"), req_str!(payload, "launch_args", "launchArgs"), req_bool!(payload, "skip_game_dl", "skipGameDl"), req_str!(payload, "region_code", "regionCode"))),
        "remove_install" => {
            let id = req_str!(payload, "id");
            let wipe_prefix = req_bool!(payload, "wipe_prefix", "wipePrefix");
            let keep_game_data = req_bool!(payload, "keep_game_data", "keepGameData");
            to_json(crate::utils::run_async_command(async { crate::commands::install::remove_install(app.clone(), id, wipe_prefix, keep_game_data).await }))
        }
        "update_install_game_path" => to_json(crate::commands::install::update_install_game_path(app.clone(), req_str!(payload, "id"), req_str!(payload, "path"))),
        "update_install_runner_path" => to_json(crate::commands::install::update_install_runner_path(app.clone(), req_str!(payload, "id"), req_str!(payload, "path"))),
        "update_install_dxvk_path" => to_json(crate::commands::install::update_install_dxvk_path(app.clone(), req_str!(payload, "id"), req_str!(payload, "path"))),
        "update_install_skip_version_updates" => to_json(crate::commands::install::update_install_skip_version_updates(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_skip_hash_valid" => to_json(crate::commands::install::update_install_skip_hash_valid(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_use_jadeite" => to_json(crate::commands::install::update_install_use_jadeite(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_use_xxmi" => to_json(crate::commands::install::update_install_use_xxmi(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_use_fps_unlock" => to_json(crate::commands::install::update_install_use_fps_unlock(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_fps_value" => to_json(crate::commands::install::update_install_fps_value(app.clone(), req_str!(payload, "id"), req_str!(payload, "fps"))),
        "update_install_graphics_api" => to_json(crate::commands::install::update_install_graphics_api(app.clone(), req_str!(payload, "id"), req_str!(payload, "api"))),
        "update_install_use_gamemode" => to_json(crate::commands::install::update_install_use_gamemode(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_use_mangohud" => to_json(crate::commands::install::update_install_use_mangohud(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_mangohud_config_path" => to_json(crate::commands::install::update_install_mangohud_config_path(app.clone(), req_str!(payload, "id"), req_str!(payload, "path"))),
        "update_install_xxmi_config" => to_json(crate::commands::install::update_install_xxmi_config(app.clone(), req_str!(payload, "id"), get_optional_u64(payload, &["xxmi_hunting", "xxmiHunting"]), get_optional_bool(payload, &["xxmi_sd", "xxmiSd"]), get_optional_bool(payload, &["xxmi_sw", "xxmiSw"]), get_optional_bool(payload, &["_engineini_tweaks", "engineini_tweaks", "engineiniTweaks"]))),
        "update_install_show_drpc" => to_json(crate::commands::install::update_install_show_drpc(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_disable_system_idle" => to_json(crate::commands::install::update_install_disable_system_idle(app.clone(), req_str!(payload, "id"), req_bool!(payload, "enabled"))),
        "update_install_env_vars" => to_json(crate::commands::install::update_install_env_vars(app.clone(), req_str!(payload, "id"), req_str!(payload, "env_vars", "envVars"))),
        "update_install_pre_launch_cmd" => to_json(crate::commands::install::update_install_pre_launch_cmd(app.clone(), req_str!(payload, "id"), req_str!(payload, "cmd"))),
        "update_install_launch_cmd" => to_json(crate::commands::install::update_install_launch_cmd(app.clone(), req_str!(payload, "id"), req_str!(payload, "cmd"))),
        "update_install_game_background" => to_json(crate::commands::install::update_install_game_background(app.clone(), req_str!(payload, "id"), req_str!(payload, "background"))),
        "update_install_prefix_path" => to_json(crate::commands::install::update_install_prefix_path(app.clone(), req_str!(payload, "id"), req_str!(payload, "path"))),
        "update_install_launch_args" => to_json(crate::commands::install::update_install_launch_args(app.clone(), req_str!(payload, "id"), req_str!(payload, "args"))),
        "update_install_runner_version" => to_json(crate::commands::install::update_install_runner_version(app.clone(), req_str!(payload, "id"), req_str!(payload, "version"))),
        "update_install_dxvk_version" => to_json(crate::commands::install::update_install_dxvk_version(app.clone(), req_str!(payload, "id"), req_str!(payload, "version"))),
        "game_launch" => to_json(crate::commands::install::game_launch(app.clone(), req_str!(payload, "id"))),
        "check_game_running" => to_json(crate::commands::install::check_game_running(app.clone(), req_str!(payload, "id"))),
        "get_download_sizes" => to_json(crate::commands::install::get_download_sizes(app.clone(), req_str!(payload, "biz"), req_str!(payload, "version"), req_str!(payload, "lang"), req_str!(payload, "path"), get_optional_string(payload, &["region"]))),
        "get_resume_states" => to_json(crate::commands::install::get_resume_states(app.clone(), req_str!(payload, "install"))),
        "add_shortcut" => { crate::commands::install::add_shortcut(app.clone(), req_str!(payload, "install_id", "installId"), req_str!(payload, "shortcut_type", "shortcutType")); Ok(Value::Null) }
        "remove_shortcut" => { crate::commands::install::remove_shortcut(app.clone(), req_str!(payload, "install_id", "installId"), req_str!(payload, "shortcut_type", "shortcutType")); Ok(Value::Null) }
        "copy_authkey" => to_json(crate::commands::install::copy_authkey(app.clone(), req_str!(payload, "id"))),
        "pause_game_download" => to_json(crate::commands::queue::pause_game_download(app.clone(), req_str!(payload, "install_id", "installId"))),
        "queue_move_up" => to_json(crate::commands::queue::queue_move_up(app.clone(), req_str!(payload, "job_id", "jobId"))),
        "queue_move_down" => to_json(crate::commands::queue::queue_move_down(app.clone(), req_str!(payload, "job_id", "jobId"))),
        "queue_remove" => to_json(crate::commands::queue::queue_remove(app.clone(), req_str!(payload, "job_id", "jobId"))),
        "queue_set_paused" => { crate::commands::queue::queue_set_paused(app.clone(), req_bool!(payload, "paused")); Ok(Value::Null) }
        "queue_activate_job" => to_json(crate::commands::queue::queue_activate_job(app.clone(), req_str!(payload, "job_id", "jobId"))),
        "queue_reorder" => to_json(crate::commands::queue::queue_reorder(app.clone(), req_str!(payload, "job_id", "jobId"), req_usize!(payload, "new_position", "newPosition"))),
        "queue_resume_job" => to_json(crate::commands::queue::queue_resume_job(app.clone(), req_str!(payload, "install_id", "installId"))),
        "get_download_queue_state" => to_json(crate::commands::queue::get_download_queue_state(app.clone())),
        "queue_clear_completed" => { crate::commands::queue::queue_clear_completed(app.clone()); Ok(Value::Null) }
        "add_installed_runner" => to_json(crate::commands::runners::add_installed_runner(app.clone(), req_str!(payload, "runner_url", "runnerUrl"), req_str!(payload, "runner_version", "runnerVersion"))),
        "remove_installed_runner" => to_json(crate::commands::runners::remove_installed_runner(app.clone(), req_str!(payload, "runner_version", "runnerVersion"))),
        "get_installed_runner_by_version" => to_json(crate::commands::runners::get_installed_runner_by_version(app.clone(), req_str!(payload, "runner_version", "runnerVersion"))),
        "get_installed_runner_by_id" => to_json(crate::commands::runners::get_installed_runner_by_id(app.clone(), req_str!(payload, "runner_id", "runnerId"))),
        "list_installed_runners" => to_json(crate::commands::runners::list_installed_runners(app.clone())),
        "update_installed_runner_install_status" => to_json(crate::commands::runners::update_installed_runner_install_status(app.clone(), req_str!(payload, "version"), req_bool!(payload, "is_installed", "isInstalled"))),
        "is_steamrt_installed" => to_json(crate::commands::runners::is_steamrt_installed(app.clone())),
        "check_network_connectivity" => to_json(crate::utils::run_async_command(async { crate::commands::network::check_network_connectivity().await })),
        _ => Err(format!("Unsupported invoke command {command}")),
    }
}

fn dispatch_emit(app: &LauncherContext, event_name: &str, payload: Value) -> Result<Value, String> {
    app.emit(event_name, payload).map_err(|err| { err.to_string() })?;
    Ok(Value::Null)
}

fn get_payload_map(payload: &Value) -> Result<&Map<String, Value>, String> {
    if payload.is_null() { static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new(); return Ok(EMPTY.get_or_init(Map::new)); }
    payload.as_object().ok_or_else(|| { "Expected payload object".to_string() })
}

fn find_value<'a>(payload: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(value) = payload.get(*key) { return Some(value); }
    }
    None
}

fn get_required_string(payload: &Map<String, Value>, keys: &[&str]) -> Result<String, String> {
    match find_value(payload, keys).and_then(|value| { value.as_str().map(|v| { v.to_string() }) }) {
        Some(value) => Ok(value),
        None => Err(format!("Missing or invalid string payload field {}", keys.join("/"))),
    }
}

fn get_required_bool(payload: &Map<String, Value>, keys: &[&str]) -> Result<bool, String> {
    match find_value(payload, keys).and_then(|value| { value.as_bool() }) {
        Some(value) => Ok(value),
        None => Err(format!("Missing or invalid bool payload field {}", keys.join("/"))),
    }
}

fn get_required_i64(payload: &Map<String, Value>, keys: &[&str]) -> Result<i64, String> {
    match find_value(payload, keys).and_then(|value| { value.as_i64() }) {
        Some(value) => Ok(value),
        None => Err(format!("Missing or invalid integer payload field {}", keys.join("/"))),
    }
}

fn get_required_usize(payload: &Map<String, Value>, keys: &[&str]) -> Result<usize, String> {
    match find_value(payload, keys).and_then(|value| { value.as_u64() }) {
        Some(value) => Ok(value as usize),
        None => Err(format!("Missing or invalid integer payload field {}", keys.join("/"))),
    }
}

fn get_optional_string(payload: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    find_value(payload, keys).and_then(|value| { value.as_str().map(|v| { v.to_string() }) })
}

fn get_optional_bool(payload: &Map<String, Value>, keys: &[&str]) -> Option<bool> {
    find_value(payload, keys).and_then(|value| { value.as_bool() })
}

fn get_optional_u64(payload: &Map<String, Value>, keys: &[&str]) -> Option<u64> {
    find_value(payload, keys).and_then(|value| { value.as_u64() })
}

fn get_required_value<T: for<'de> Deserialize<'de>>(payload: &Map<String, Value>, keys: &[&str]) -> Result<T, String> {
    let value = find_value(payload, keys).cloned().ok_or_else(|| { format!("Missing payload field {}", keys.join("/")) })?;
    serde_json::from_value(value).map_err(|err| { format!("Invalid payload field {}: {err}", keys.join("/")) })
}

fn parse_event_payload(payload: &str) -> Value {
    if payload.is_empty() { Value::Null } else { serde_json::from_str(payload).unwrap_or_else(|_| { Value::String(payload.to_string()) }) }
}

fn rpc_error(id: Option<Value>, code: i32, message: String) -> RpcResponse {
    RpcResponse { jsonrpc: "2.0", id, result: None, error: Some(RpcError { code, message }) }
}

fn to_json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|err| { err.to_string() })
}

fn write_json(writer: &Arc<Mutex<io::BufWriter<io::Stdout>>>, message: &impl Serialize) {
    if let Ok(mut writer) = writer.lock() {
        let _ = serde_json::to_writer(&mut *writer, message);
        let _ = writer.write_all(b"\n");
        let _ = writer.flush();
    }
}


