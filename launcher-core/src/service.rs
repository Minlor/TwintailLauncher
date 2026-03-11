use crate::data::LauncherData;
use crate::protocol::RpcResponse;
use serde::Serialize;
use serde_json::{Value,json};

const ALL_COMMANDS: &[&str] = &[
    "open_uri","open_folder","empty_folder","open_in_prefix","list_settings","update_settings_third_party_repo_updates","update_settings_default_game_path","update_settings_default_xxmi_path","update_settings_default_fps_unlock_path","update_settings_default_jadeite_path","update_settings_default_prefix_path","update_settings_default_runner_path","update_settings_default_dxvk_path","update_settings_default_mangohud_config_path","update_settings_download_speed_limit_cmd","update_settings_launcher_action","update_settings_manifests_hide",
    "remove_repository","add_repository","get_repository","list_repositories",
    "get_manifest_by_id","get_manifest_by_filename","list_manifests_by_repository_id","update_manifest_enabled",
    "get_game_manifest_by_filename","list_game_manifests","get_game_manifest_by_manifest_id","override_manifest_url","clear_manifest_override",
    "list_installs","list_installs_by_manifest_id","get_install_by_id","add_install","remove_install","set_installs_order",
    "update_install_game_path","update_install_runner_path","update_install_dxvk_path","update_install_skip_version_updates","update_install_skip_hash_valid","update_install_use_jadeite","update_install_use_xxmi","update_install_use_fps_unlock","update_install_fps_value","update_install_graphics_api","update_install_env_vars","update_install_pre_launch_cmd","update_install_launch_cmd","update_install_game_background","update_install_prefix_path","update_install_launch_args","update_install_dxvk_version","update_install_runner_version","update_install_use_gamemode","update_install_use_mangohud","update_install_xxmi_config","update_install_show_drpc","update_install_disable_system_idle","copy_authkey",
    "list_compatibility_manifests","get_compatibility_manifest_by_manifest_id",
    "game_launch","check_game_running","get_download_sizes","get_resume_states","update_install_mangohud_config_path","add_shortcut","remove_shortcut","pause_game_download","queue_move_up","queue_move_down","queue_remove","queue_set_paused","queue_activate_job","queue_reorder","queue_resume_job","get_download_queue_state","queue_clear_completed",
    "add_installed_runner","remove_installed_runner","get_installed_runner_by_version","get_installed_runner_by_id","list_installed_runners","update_installed_runner_install_status","is_steamrt_installed","check_network_connectivity"
];
const SHELL_OWNED_COMMANDS: &[&str] = &["open_uri"];
const ALL_EVENTS: &[&str] = &["download_queue_state","download_progress","download_installing","download_complete","download_paused","update_progress","update_installing","update_complete","repair_progress","repair_installing","repair_complete","preload_progress","preload_installing","preload_complete","move_progress","move_complete","game_closed","show_dialog","connection_status","download_removed"];
const SHELL_OWNED_EVENTS: &[&str] = &["launcher_action_exit","launcher_action_minimize","dialog_response","sync_tray_toggle"];

#[derive(Debug,Clone,Serialize)]
struct ContractDescription<'a> {
    protocol: &'a str,
    all_commands: &'a [&'a str],
    shell_owned_commands: &'a [&'a str],
    sidecar_startup_stubs: &'a [&'a str],
    all_events: &'a [&'a str],
    shell_owned_events: &'a [&'a str],
}

pub struct LauncherCore {
    data: LauncherData,
}

impl LauncherCore {
    pub fn new() -> Self { Self { data: LauncherData::from_env() } }

    pub fn handle_request(&mut self, id: Option<u64>, method: &str, params: Value) -> RpcResponse {
        match method {
            "runtime.invoke" => {
                let command = params.get("command").and_then(Value::as_str).unwrap_or_default();
                let payload = params.get("payload").cloned().unwrap_or(Value::Null);
                self.handle_invoke(id, command, payload)
            }
            "runtime.emit" => {
                let event_name = params.get("event_name").and_then(Value::as_str).unwrap_or_default();
                self.handle_emit(id, event_name)
            }
            _ => RpcResponse::err(id, -32601, format!("Unsupported JSON-RPC method: {method}")),
        }
    }

    fn handle_invoke(&mut self, id: Option<u64>, command: &str, payload: Value) -> RpcResponse {
        if command == "protocol.describe" || command == "core_describe_contract" { return RpcResponse::ok(id, serde_json::to_value(self.describe_contract()).unwrap()); }
        if SHELL_OWNED_COMMANDS.contains(&command) { return RpcResponse::err(id, -32002, format!("Command `{command}` is shell-owned and should be handled by Electron main.")); }
        match command {
            "list_settings" => ok_string(id, self.data.get_settings()),
            "update_settings_third_party_repo_updates" => ok_option_bool(id, self.data.update_settings_bool("third_party_repo_updates", payload_bool(&payload, "enabled"))),
            "update_settings_default_game_path" => ok_option_bool(id, self.data.update_settings_string("default_game_path", payload_string(&payload, &["path"]))),
            "update_settings_default_xxmi_path" => ok_option_bool(id, self.data.update_settings_string("xxmi_path", payload_string(&payload, &["path"]))),
            "update_settings_default_fps_unlock_path" => ok_option_bool(id, self.data.update_settings_string("fps_unlock_path", payload_string(&payload, &["path"]))),
            "update_settings_default_jadeite_path" => ok_option_bool(id, self.data.update_settings_string("jadeite_path", payload_string(&payload, &["path"]))),
            "update_settings_default_prefix_path" => ok_option_bool(id, self.data.update_settings_string("default_runner_prefix_path", payload_string(&payload, &["path"]))),
            "update_settings_default_runner_path" => ok_option_bool(id, self.data.update_settings_string("default_runner_path", payload_string(&payload, &["path"]))),
            "update_settings_default_dxvk_path" => ok_option_bool(id, self.data.update_settings_string("default_dxvk_path", payload_string(&payload, &["path"]))),
            "update_settings_default_mangohud_config_path" => ok_option_bool(id, self.data.update_settings_string("default_mangohud_config_path", payload_string(&payload, &["path"]))),
            "update_settings_download_speed_limit_cmd" => ok_option_bool(id, self.data.update_settings_i64("download_speed_limit", payload_i64(&payload, &["speedLimit","speed_limit"]))),
            "update_settings_launcher_action" => ok_option_bool(id, self.data.update_settings_string("launcher_action", payload_string(&payload, &["action"]))),
            "update_settings_manifests_hide" => ok_option_bool(id, self.data.update_settings_bool("hide_manifests", payload_bool(&payload, "enabled"))),
            "list_repositories" => ok_string(id, Value::Array(self.data.list_repositories())),
            "get_repository" => ok_option_string(id, self.data.get_repository(&payload_string(&payload, &["repositoryId","repository_id","id"]))),
            "get_manifest_by_id" => ok_option_string(id, self.data.get_manifest_by_id(&payload_string(&payload, &["id"]))),
            "get_manifest_by_filename" => ok_option_string(id, self.data.get_manifest_by_filename(&payload_string(&payload, &["filename"]))),
            "list_manifests_by_repository_id" => ok_string(id, Value::Array(self.data.list_manifests_by_repository_id(&payload_string(&payload, &["repositoryId","repository_id"])))),
            "update_manifest_enabled" => ok_option_bool(id, self.data.update_manifest_enabled(&payload_string(&payload, &["id"]), payload_bool(&payload, "enabled"))),
            "list_game_manifests" => ok_string(id, Value::Array(self.data.list_game_manifests())),
            "get_game_manifest_by_filename" => ok_option_string(id, self.data.get_game_manifest_by_filename(&payload_string(&payload, &["filename"]))),
            "get_game_manifest_by_manifest_id" => ok_option_string(id, self.data.get_game_manifest_by_manifest_id(&payload_string(&payload, &["id"]))),
            "list_installs" => ok_string(id, Value::Array(self.data.list_installs())),
            "get_install_by_id" => ok_option_string(id, self.data.get_install_by_id(&payload_string(&payload, &["id"]))),
            "list_compatibility_manifests" => ok_string(id, Value::Array(self.data.list_compatibility_manifests())),
            "get_compatibility_manifest_by_manifest_id" => ok_option_string(id, self.data.get_compatibility_manifest_by_manifest_id(&payload_string(&payload, &["id"]))),
            "list_installed_runners" => ok_string(id, Value::Array(self.data.list_installed_runners())),
            "is_steamrt_installed" => RpcResponse::ok(id, json!(self.data.steamrt_installed())),
            "check_network_connectivity" => RpcResponse::ok(id, json!({"status":"online","latency_ms":0,"message":"Electron sidecar connectivity check stub"})),
            "get_download_queue_state" => RpcResponse::ok(id, json!(r#"{"running":[],"queued":[],"pausedJobs":[],"completed":[]}"#)),
            "get_resume_states" => RpcResponse::ok(id, json!(r#"{"downloading":false,"updating":false,"preloading":false,"repairing":false}"#)),
            _ if ALL_COMMANDS.contains(&command) => RpcResponse::err(id, -32601, format!("Command `{command}` is not implemented in the Electron sidecar yet.")),
            _ => RpcResponse::err(id, -32601, format!("Unknown launcher command: {command}")),
        }
    }

    fn handle_emit(&mut self, id: Option<u64>, event_name: &str) -> RpcResponse {
        if SHELL_OWNED_EVENTS.contains(&event_name) { return RpcResponse::err(id, -32002, format!("Event `{event_name}` is shell-owned and should be handled by Electron main.")); }
        RpcResponse::ok(id, Value::Null)
    }

    fn describe_contract(&self) -> ContractDescription<'static> {
        ContractDescription { protocol: "jsonrpc-stdio-v1", all_commands: ALL_COMMANDS, shell_owned_commands: SHELL_OWNED_COMMANDS, sidecar_startup_stubs: &["list_settings","list_repositories","list_game_manifests","list_compatibility_manifests","list_installs","list_installed_runners","get_download_queue_state","get_resume_states","is_steamrt_installed","check_network_connectivity"], all_events: ALL_EVENTS, shell_owned_events: SHELL_OWNED_EVENTS }
    }
}

fn ok_string(id: Option<u64>, value: Value) -> RpcResponse { RpcResponse::ok(id, Value::String(serde_json::to_string(&value).unwrap_or_else(|_| "[]".to_string()))) }
fn ok_option_string(id: Option<u64>, value: Option<Value>) -> RpcResponse { value.map(|item| ok_string(id, item)).unwrap_or_else(|| RpcResponse::ok(id, Value::Null)) }
fn ok_option_bool(id: Option<u64>, value: Option<bool>) -> RpcResponse { RpcResponse::ok(id, value.map(Value::Bool).unwrap_or(Value::Null)) }

fn payload_bool(payload: &Value, key: &str) -> bool { payload.get(key).and_then(Value::as_bool).unwrap_or(false) }
fn payload_i64(payload: &Value, keys: &[&str]) -> i64 { keys.iter().find_map(|key| payload.get(*key).and_then(Value::as_i64)).unwrap_or(0) }
fn payload_string(payload: &Value, keys: &[&str]) -> String { keys.iter().find_map(|key| payload.get(*key).and_then(Value::as_str)).unwrap_or_default().to_string() }


