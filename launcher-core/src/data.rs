use rusqlite::{Connection,OptionalExtension,Row,params};
use serde_json::{Value,json};
use std::collections::HashMap;
use std::fs;
use std::path::{Path,PathBuf};

#[derive(Debug,Clone)]
pub struct LauncherData {
    data_dir: PathBuf,
}

#[derive(Debug,Clone)]
struct RepositoryRow {
    id: String,
    github_id: String,
}

#[derive(Debug,Clone)]
struct ManifestRow {
    repository_id: String,
    filename: String,
}

impl LauncherData {
    pub fn from_env() -> Self {
        let data_dir = std::env::var("TTL_DATA_DIR").map(PathBuf::from).unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        Self { data_dir }
    }

    pub fn default_settings(&self) -> Value {
        json!({
            "launcher_action": "keep",
            "third_party_repo_updates": false,
            "download_speed_limit": 0,
            "default_game_path": "",
            "xxmi_path": "",
            "fps_unlock_path": "",
            "jadeite_path": "",
            "default_runner_path": "",
            "default_runner_prefix_path": "",
            "default_dxvk_path": "",
            "default_mangohud_config_path": "",
            "hide_manifests": false
        })
    }

    pub fn get_settings(&self) -> Value {
        let Some(conn) = self.open_db() else { return self.default_settings(); };
        let sql = "SELECT * FROM settings WHERE id = 1";
        let mapped = conn.query_row(sql, [], |row| {
            Ok(json!({
                "default_game_path": get_string(row, "default_game_path"),
                "xxmi_path": get_string(row, "xxmi_path"),
                "fps_unlock_path": get_string(row, "fps_unlock_path"),
                "jadeite_path": get_string(row, "jadeite_path"),
                "third_party_repo_updates": get_bool(row, "third_party_repo_updates", false),
                "default_runner_prefix_path": get_string(row, "default_runner_prefix_path"),
                "download_speed_limit": get_i64(row, "download_speed_limit", 0),
                "launcher_action": fallback_string(get_string(row, "launcher_action"), "keep"),
                "hide_manifests": get_bool(row, "hide_manifests", false),
                "default_runner_path": get_string(row, "default_runner_path"),
                "default_dxvk_path": get_string(row, "default_dxvk_path"),
                "default_mangohud_config_path": get_string(row, "default_mangohud_config_path")
            }))
        }).optional().ok().flatten();
        mapped.unwrap_or_else(|| self.default_settings())
    }

    pub fn update_settings_bool(&self, column: &str, value: bool) -> Option<bool> { self.execute_update_1(format!("UPDATE settings SET '{column}' = ?1 WHERE id = 1").as_str(), [&value as &dyn rusqlite::ToSql]) }
    pub fn update_settings_i64(&self, column: &str, value: i64) -> Option<bool> { self.execute_update_1(format!("UPDATE settings SET '{column}' = ?1 WHERE id = 1").as_str(), [&value as &dyn rusqlite::ToSql]) }
    pub fn update_settings_string(&self, column: &str, value: String) -> Option<bool> { self.execute_update_1(format!("UPDATE settings SET '{column}' = ?1 WHERE id = 1").as_str(), [&value as &dyn rusqlite::ToSql]) }

    pub fn list_repositories(&self) -> Vec<Value> {
        let Some(conn) = self.open_db() else { return vec![]; };
        let mut stmt = match conn.prepare("SELECT * FROM repository") { Ok(stmt) => stmt, Err(_) => return vec![] };
        let rows = stmt.query_map([], |row| Ok(json!({"id": get_string(row, "id"), "github_id": get_string(row, "github_id")})));
        rows.map(|mapped| mapped.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn get_repository(&self, repository_id: &str) -> Option<Value> {
        let Some(conn) = self.open_db() else { return None; };
        conn.query_row("SELECT * FROM repository WHERE id = ?1", params![repository_id], |row| {
            Ok(json!({"id": get_string(row, "id"), "github_id": get_string(row, "github_id")}))
        }).optional().ok().flatten()
    }

    pub fn list_manifests_by_repository_id(&self, repository_id: &str) -> Vec<Value> {
        let Some(conn) = self.open_db() else { return vec![]; };
        let mut stmt = match conn.prepare("SELECT * FROM manifest WHERE repository_id = ?1") { Ok(stmt) => stmt, Err(_) => return vec![] };
        let rows = stmt.query_map(params![repository_id], |row| Ok(manifest_row_to_value(row)));
        rows.map(|mapped| mapped.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn get_manifest_by_id(&self, manifest_id: &str) -> Option<Value> {
        let conn = self.open_db()?;
        conn.query_row("SELECT * FROM manifest WHERE id = ?1", params![manifest_id], |row| Ok(manifest_row_to_value(row))).optional().ok().flatten()
    }

    pub fn get_manifest_by_filename(&self, filename: &str) -> Option<Value> {
        let conn = self.open_db()?;
        conn.query_row("SELECT * FROM manifest WHERE filename = ?1", params![filename], |row| Ok(manifest_row_to_value(row))).optional().ok().flatten()
    }

    pub fn update_manifest_enabled(&self, manifest_id: &str, enabled: bool) -> Option<bool> {
        self.execute_update_2("UPDATE manifest SET enabled = ?1 WHERE id = ?2", [&enabled as &dyn rusqlite::ToSql, &manifest_id])
    }

    pub fn list_game_manifests(&self) -> Vec<Value> {
        self.list_manifest_files().into_iter().filter_map(|(_, value)| if is_game_manifest(&value) { Some(value) } else { None }).collect()
    }

    pub fn list_compatibility_manifests(&self) -> Vec<Value> {
        self.list_manifest_files().into_iter().filter_map(|(_, value)| if is_runner_manifest(&value) { Some(value) } else { None }).collect()
    }

    pub fn get_game_manifest_by_filename(&self, filename: &str) -> Option<Value> {
        let manifest = self.get_manifest_by_filename(filename)?;
        if !manifest.get("enabled").and_then(Value::as_bool).unwrap_or(false) { return None; }
        self.load_manifest_json(filename).filter(is_game_manifest)
    }

    pub fn get_game_manifest_by_manifest_id(&self, manifest_id: &str) -> Option<Value> {
        let manifest = self.get_manifest_by_id(manifest_id)?;
        if !manifest.get("enabled").and_then(Value::as_bool).unwrap_or(false) { return None; }
        let filename = manifest.get("filename").and_then(Value::as_str)?;
        self.load_manifest_json(filename).filter(is_game_manifest)
    }

    pub fn get_compatibility_manifest_by_manifest_id(&self, manifest_id: &str) -> Option<Value> {
        let manifest = self.get_manifest_by_id(manifest_id)?;
        if !manifest.get("enabled").and_then(Value::as_bool).unwrap_or(false) { return None; }
        let filename = manifest.get("filename").and_then(Value::as_str)?;
        self.load_manifest_json(filename).filter(is_runner_manifest)
    }

    pub fn list_installs(&self) -> Vec<Value> {
        let Some(conn) = self.open_db() else { return vec![]; };
        let mut stmt = match conn.prepare("SELECT * FROM install ORDER BY sort_order ASC") { Ok(stmt) => stmt, Err(_) => return vec![] };
        let rows = stmt.query_map([], |row| Ok(install_row_to_value(row)));
        rows.map(|mapped| mapped.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn get_install_by_id(&self, install_id: &str) -> Option<Value> {
        let conn = self.open_db()?;
        conn.query_row("SELECT * FROM install WHERE id = ?1", params![install_id], |row| Ok(install_row_to_value(row))).optional().ok().flatten()
    }

    pub fn list_installed_runners(&self) -> Vec<Value> {
        let Some(conn) = self.open_db() else { return vec![]; };
        let mut stmt = match conn.prepare("SELECT * FROM installed_runners") { Ok(stmt) => stmt, Err(_) => return vec![] };
        let rows = stmt.query_map([], |row| {
            let version = get_string(row, "version");
            Ok(json!({
                "id": get_i64(row, "id", 0),
                "runner_path": get_string(row, "runner_path"),
                "is_installed": get_bool(row, "is_installed", false),
                "version": version,
                "value": version,
                "name": get_string(row, "version")
            }))
        });
        rows.map(|mapped| mapped.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn steamrt_installed(&self) -> bool {
        if cfg!(target_os = "windows") { return true; }
        let runner_root = self.get_settings().get("default_runner_path").and_then(Value::as_str).unwrap_or("").to_string();
        if runner_root.is_empty() { return false; }
        Path::new(&runner_root).join("steamrt").exists()
    }

    fn open_db(&self) -> Option<Connection> {
        let db_path = self.data_dir.join("storage.db");
        if !db_path.exists() { return None; }
        Connection::open(db_path).ok()
    }

    fn manifests_dir(&self) -> PathBuf { self.data_dir.join("manifests") }

    fn manifest_rows(&self) -> Vec<ManifestRow> {
        let Some(conn) = self.open_db() else { return vec![]; };
        let mut stmt = match conn.prepare("SELECT * FROM manifest") { Ok(stmt) => stmt, Err(_) => return vec![] };
        let rows = stmt.query_map([], |row| Ok(ManifestRow {
            repository_id: get_string(row, "repository_id"),
            filename: get_string(row, "filename"),
        }));
        rows.map(|mapped| mapped.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    fn repository_rows(&self) -> Vec<RepositoryRow> {
        let Some(conn) = self.open_db() else { return vec![]; };
        let mut stmt = match conn.prepare("SELECT * FROM repository") { Ok(stmt) => stmt, Err(_) => return vec![] };
        let rows = stmt.query_map([], |row| Ok(RepositoryRow {
            id: get_string(row, "id"),
            github_id: get_string(row, "github_id"),
        }));
        rows.map(|mapped| mapped.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    fn list_manifest_files(&self) -> Vec<(String,Value)> {
        let manifests = self.manifest_rows();
        let repositories = self.repository_rows().into_iter().map(|repo| (repo.id, repo.github_id)).collect::<HashMap<_,_>>();
        let mut values = vec![];

        for manifest in manifests {
            let path = repositories.get(&manifest.repository_id).and_then(|github_id| self.manifest_path_for_repo(github_id, &manifest.filename));
            let Some(path) = path else { continue; };
            let Some(value) = read_json_file(&path) else { continue; };
            values.push((manifest.filename, value));
        }

        if values.is_empty() {
            values = self.scan_manifest_tree();
        }

        values
    }

    fn scan_manifest_tree(&self) -> Vec<(String,Value)> {
        let root = self.manifests_dir();
        let mut values = vec![];
        let Ok(users) = fs::read_dir(root) else { return values; };
        for user in users.flatten() {
            let Ok(repos) = fs::read_dir(user.path()) else { continue; };
            for repo in repos.flatten() {
                let Ok(entries) = fs::read_dir(repo.path()) else { continue; };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|ext| ext.to_str()) != Some("json") { continue; }
                    if path.file_name().and_then(|name| name.to_str()) == Some("repository.json") { continue; }
                    if let Some(value) = read_json_file(&path) {
                        let filename = path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string();
                        values.push((filename, value));
                    }
                }
            }
        }
        values
    }

    fn manifest_path_for_repo(&self, github_id: &str, filename: &str) -> Option<PathBuf> {
        let mut segments = github_id.split('/');
        let user = segments.next()?;
        let repo = segments.next()?;
        Some(self.manifests_dir().join(user).join(repo).join(filename))
    }

    fn load_manifest_json(&self, filename: &str) -> Option<Value> {
        for (manifest_filename, manifest) in self.list_manifest_files() {
            if manifest_filename == filename {
                return Some(manifest);
            }
        }
        None
    }

    fn execute_update_1(&self, sql: &str, params: [&dyn rusqlite::ToSql; 1]) -> Option<bool> {
        let conn = self.open_db()?;
        conn.execute(sql, params).ok().map(|changed| changed >= 1)
    }

    fn execute_update_2(&self, sql: &str, params: [&dyn rusqlite::ToSql; 2]) -> Option<bool> {
        let conn = self.open_db()?;
        conn.execute(sql, params).ok().map(|changed| changed >= 1)
    }
}

fn manifest_row_to_value(row: &Row<'_>) -> Value {
    json!({
        "id": get_string(row, "id"),
        "repository_id": get_string(row, "repository_id"),
        "display_name": get_string(row, "display_name"),
        "filename": get_string(row, "filename"),
        "enabled": get_bool(row, "enabled", false)
    })
}

fn install_row_to_value(row: &Row<'_>) -> Value {
    let xxmi_config = parse_json_object(get_string(row, "xxmi_config"), default_xxmi_config());
    json!({
        "id": get_string(row, "id"),
        "manifest_id": get_string(row, "manifest_id"),
        "version": get_string(row, "version"),
        "audio_langs": get_string(row, "audio_langs"),
        "name": get_string(row, "name"),
        "directory": get_string(row, "directory"),
        "runner_path": get_string(row, "runner_path"),
        "dxvk_path": get_string(row, "dxvk_path"),
        "runner_version": get_string(row, "runner_version"),
        "dxvk_version": get_string(row, "dxvk_version"),
        "game_icon": get_string(row, "game_icon"),
        "game_background": get_string(row, "game_background"),
        "ignore_updates": get_bool(row, "ignore_updates", false),
        "skip_hash_check": get_bool(row, "skip_hash_check", false),
        "use_jadeite": get_bool(row, "use_jadeite", false),
        "use_xxmi": get_bool(row, "use_xxmi", false),
        "use_fps_unlock": get_bool(row, "use_fps_unlock", false),
        "env_vars": get_string(row, "env_vars"),
        "pre_launch_command": get_string(row, "pre_launch_command"),
        "launch_command": get_string(row, "launch_command"),
        "fps_value": get_string(row, "fps_value"),
        "runner_prefix": get_string(row, "runner_prefix_path"),
        "launch_args": get_string(row, "launch_args"),
        "use_gamemode": get_bool(row, "use_gamemode", false),
        "use_mangohud": get_bool(row, "use_mangohud", false),
        "mangohud_config_path": get_string(row, "mangohud_config_path"),
        "shortcut_is_steam": get_bool(row, "shortcut_is_steam", false),
        "shortcut_path": get_string(row, "shortcut_path"),
        "region_code": fallback_string(get_string(row, "region_code"), "glb_official"),
        "xxmi_config": xxmi_config,
        "sort_order": get_i64(row, "sort_order", 0),
        "last_played_time": fallback_string(get_string(row, "last_played_time"), "0"),
        "total_playtime": get_i64(row, "total_playtime", 0),
        "show_discord_rpc": get_bool(row, "show_discord_rpc", false),
        "disable_system_idle": get_bool(row, "disable_system_idle", false),
        "steam_imported": get_bool(row, "steam_imported", false),
        "graphics_api": get_string(row, "graphics_api")
    })
}


fn read_json_file(path: &Path) -> Option<Value> {
    let file = fs::File::open(path).ok()?;
    serde_json::from_reader(file).ok()
}

fn is_game_manifest(value: &Value) -> bool { value.get("biz").is_some() }
fn is_runner_manifest(value: &Value) -> bool { value.get("paths").and_then(Value::as_object).map(|paths| paths.contains_key("wine64")).unwrap_or(false) }

fn get_string(row: &Row<'_>, column: &str) -> String { row.get::<_, String>(column).unwrap_or_default() }
fn get_i64(row: &Row<'_>, column: &str, default: i64) -> i64 { row.get::<_, i64>(column).unwrap_or(default) }
fn get_bool(row: &Row<'_>, column: &str, default: bool) -> bool { row.get::<_, bool>(column).ok().or_else(|| row.get::<_, i64>(column).ok().map(|v| v != 0)).unwrap_or(default) }
fn fallback_string(value: String, fallback: &str) -> String { if value.is_empty() { fallback.to_string() } else { value } }

fn default_xxmi_config() -> Value {
    json!({
        "hunting_mode": 0,
        "require_admin": true,
        "dll_init_delay": 500,
        "close_delay": 20,
        "show_warnings": 0,
        "dump_shaders": false
    })
}

fn parse_json_object(raw: String, fallback: Value) -> Value {
    if raw.is_empty() { return fallback; }
    serde_json::from_str::<Value>(&raw).unwrap_or(fallback)
}


