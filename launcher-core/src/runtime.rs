use anyhow::{Result,anyhow};
use arboard::Clipboard;
use serde::Serialize;
use serde_json::Value;
use std::any::{Any,TypeId};
use std::collections::HashMap;
use std::path::{Path,PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool,AtomicU64,Ordering};
use std::sync::{Arc,Mutex,RwLock};

pub type Error = anyhow::Error;

#[derive(Clone)]
pub struct LauncherContext {
    inner: Arc<AppInner>,
}

struct AppInner {
    config: AppConfig,
    paths: AppPaths,
    states: RwLock<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>,
    listeners: RwLock<HashMap<String, Vec<ListenerEntry>>>,
    next_listener_id: AtomicU64,
    exit_requested: AtomicBool,
}

#[derive(Clone)]
struct ListenerEntry {
    id: u64,
    callback: Arc<dyn Fn(Event) + Send + Sync>,
}

#[derive(Clone)]
pub struct Event {
    name: String,
    payload: String,
}

#[derive(Clone)]
struct AppPaths {
    app_data_dir: PathBuf,
    app_local_data_dir: PathBuf,
    app_cache_dir: PathBuf,
    resource_dir: PathBuf,
    home_dir: PathBuf,
    desktop_dir: PathBuf,
}

#[derive(Clone)]
pub struct AppConfig {
    pub version: Option<String>,
}

pub struct PathResolver {
    paths: AppPaths,
}

pub struct WindowHandle;
pub struct OpenerHandle;
pub struct ClipboardHandle;

pub trait Manager {}
pub trait Emitter {}
pub trait Listener {}

impl Manager for LauncherContext {}
impl Emitter for LauncherContext {}
impl Listener for LauncherContext {}

impl Event {
    pub fn payload(&self) -> &str { &self.payload }
    pub fn event(&self) -> &str { &self.name }
}

impl LauncherContext {
    pub fn new() -> Self {
        let app_data_dir = std::env::var("TTL_DATA_DIR").ok().filter(|v| !v.is_empty()).map(PathBuf::from).or_else(default_app_data_dir).unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let resource_dir = std::env::var("TTL_RESOURCE_DIR").ok().filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let home_dir = dirs::home_dir().unwrap_or_else(|| app_data_dir.clone());
        let desktop_dir = dirs::desktop_dir().unwrap_or_else(|| home_dir.clone());
        let app_local_data_dir = default_local_data_dir().unwrap_or_else(|| app_data_dir.clone());
        let app_cache_dir = default_cache_dir().unwrap_or_else(|| app_data_dir.join("cache"));
        Self {
            inner: Arc::new(AppInner {
                config: AppConfig { version: Some(std::env::var("TTL_APP_VERSION").unwrap_or_else(|_| "2.0.0".to_string())) },
                paths: AppPaths { app_data_dir, app_local_data_dir, app_cache_dir, resource_dir, home_dir, desktop_dir },
                states: RwLock::new(HashMap::new()),
                listeners: RwLock::new(HashMap::new()),
                next_listener_id: AtomicU64::new(1),
                exit_requested: AtomicBool::new(false),
            }),
        }
    }

    pub fn manage<T: Send + Sync + 'static>(&self, state: T) {
        self.inner.states.write().unwrap().insert(TypeId::of::<T>(), Arc::new(state));
    }

    pub fn state<T: Send + Sync + 'static>(&self) -> Arc<T> {
        self.inner.states.read().unwrap().get(&TypeId::of::<T>()).unwrap_or_else(|| panic!("Missing managed state for {}", std::any::type_name::<T>())).clone().downcast::<T>().unwrap_or_else(|_| panic!("Managed state type mismatch for {}", std::any::type_name::<T>()))
    }

    pub fn emit<S: Serialize>(&self, event_name: &str, payload: S) -> Result<()> {
        let payload_json = serde_json::to_string(&payload)?;
        let event = Event { name: event_name.to_string(), payload: payload_json };
        let listeners = self.inner.listeners.read().unwrap().get(event_name).cloned().unwrap_or_default();
        for listener in listeners { (listener.callback)(event.clone()); }
        Ok(())
    }

    pub fn listen<F>(&self, event_name: &str, callback: F) -> u64 where F: Fn(Event) + Send + Sync + 'static {
        let id = self.inner.next_listener_id.fetch_add(1, Ordering::Relaxed);
        self.inner.listeners.write().unwrap().entry(event_name.to_string()).or_default().push(ListenerEntry { id, callback: Arc::new(callback) });
        id
    }

    pub fn listen_any<F>(&self, event_name: &str, callback: F) -> u64 where F: Fn(Event) + Send + Sync + 'static {
        self.listen(event_name, callback)
    }

    pub fn unlisten(&self, event_name: &str, id: u64) {
        if let Some(entries) = self.inner.listeners.write().unwrap().get_mut(event_name) { entries.retain(|entry| entry.id != id); }
    }

    pub fn path(&self) -> PathResolver { PathResolver { paths: self.inner.paths.clone() } }
    pub fn config(&self) -> AppConfig { self.inner.config.clone() }
    pub fn get_window(&self, name: &str) -> Option<WindowHandle> { if name == "main" { Some(WindowHandle) } else { None } }
    pub fn opener(&self) -> OpenerHandle { OpenerHandle }
    pub fn clipboard(&self) -> ClipboardHandle { ClipboardHandle }
    pub fn cleanup_before_exit(&self) {}
    pub fn exit(&self, _code: i32) { self.inner.exit_requested.store(true, Ordering::Relaxed); }
    pub fn exit_requested(&self) -> bool { self.inner.exit_requested.load(Ordering::Relaxed) }
}

impl PathResolver {
    pub fn app_data_dir(&self) -> Option<PathBuf> { Some(self.paths.app_data_dir.clone()) }
    pub fn app_local_data_dir(&self) -> Option<PathBuf> { Some(self.paths.app_local_data_dir.clone()) }
    pub fn app_cache_dir(&self) -> Option<PathBuf> { Some(self.paths.app_cache_dir.clone()) }
    pub fn resource_dir(&self) -> Option<PathBuf> { Some(self.paths.resource_dir.clone()) }
    pub fn home_dir(&self) -> Option<PathBuf> { Some(self.paths.home_dir.clone()) }
    pub fn desktop_dir(&self) -> Option<PathBuf> { Some(self.paths.desktop_dir.clone()) }
}

impl WindowHandle {
    pub fn hide(&self) -> Result<()> { Ok(()) }
    pub fn minimize(&self) -> Result<()> { Ok(()) }
    pub fn show(&self) -> Result<()> { Ok(()) }
    pub fn set_focus(&self) -> Result<()> { Ok(()) }
    pub fn set_decorations(&self, _enabled: bool) -> Result<()> { Ok(()) }
    pub fn set_icon<T>(&self, _icon: T) -> Result<()> { Ok(()) }
}

impl OpenerHandle {
    pub fn reveal_item_in_dir(&self, path: &Path) -> Result<()> {
        if cfg!(target_os = "windows") {
            let arg = format!("/select,{}", path.display());
            let _ = Command::new("explorer").arg(arg).spawn()?;
            return Ok(());
        }
        let target = if path.is_dir() { path } else { path.parent().unwrap_or(path) };
        let _ = Command::new("xdg-open").arg(target).spawn()?;
        Ok(())
    }

    pub fn open_url(&self, url: String, _with: Option<&str>) -> Result<()> {
        if cfg!(target_os = "windows") {
            let _ = Command::new("cmd").args(["/C", "start", "", &url]).spawn()?;
            return Ok(());
        }
        let _ = Command::new("xdg-open").arg(url).spawn()?;
        Ok(())
    }
}

impl ClipboardHandle {
    pub fn write_text(&self, text: String) -> Result<()> {
        let mutex = clipboard_mutex();
        let _guard = mutex.lock().unwrap();
        let mut clipboard = Clipboard::new().map_err(|err| anyhow!(err.to_string()))?;
        clipboard.set_text(text).map_err(|err| anyhow!(err.to_string()))
    }
}

fn clipboard_mutex() -> &'static Mutex<()> {
    static CLIPBOARD_MUTEX: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    CLIPBOARD_MUTEX.get_or_init(|| Mutex::new(()))
}

fn default_app_data_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return dirs::data_dir().map(|dir| dir.join("twintaillauncher"));
    }
    dirs::data_dir().map(|dir| dir.join("twintaillauncher"))
}

fn default_local_data_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") { return dirs::data_local_dir().map(|dir| dir.join("twintaillauncher")); }
    default_app_data_dir()
}

fn default_cache_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") { return dirs::cache_dir().map(|dir| dir.join("twintaillauncher")); }
    dirs::cache_dir().map(|dir| dir.join("twintaillauncher"))
}


