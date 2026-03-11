use std::collections::HashMap;
use std::sync::{Arc,Mutex};
use std::sync::atomic::AtomicBool;

use downloading::queue::{QueueJob,QueueJobKind,QueueJobOutcome,start_download_queue_worker};
use downloading::QueueJobPayload;
use runtime::LauncherContext;
use utils::db_manager::{DbInstances,init_db};
use utils::repo_manager::{ManifestLoader,ManifestLoaders,load_manifests};

pub mod bridge;
pub mod commands;
pub mod downloading;
pub mod protocol;
pub mod runtime;
pub mod utils;

pub use protocol::{RpcError,RpcEventNotification,RpcRequest,RpcResponse};

pub struct DownloadState {
    pub tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub queue: Mutex<Option<downloading::queue::DownloadQueueHandle>>,
    pub verified_files: Mutex<HashMap<String, Arc<Mutex<std::collections::HashSet<String>>>>>,
}

pub fn create_app() -> LauncherContext {
    #[cfg(target_os = "linux")]
    {
        utils::gpu::fuck_nvidia();
        utils::raise_fd_limit(999999);
    }

    let app = LauncherContext::new();
    app.manage(DownloadState { tokens: Mutex::new(HashMap::new()), queue: Mutex::new(None), verified_files: Mutex::new(HashMap::new()) });
    #[cfg(target_os = "linux")]
    app.manage(ManifestLoaders { game: ManifestLoader::default(), runner: utils::repo_manager::RunnerLoader::default() });
    #[cfg(target_os = "windows")]
    app.manage(ManifestLoaders { game: ManifestLoader::default() });

    utils::run_async_command(async { init_db(&app).await; });

    fn run_queued_job(app: LauncherContext, job: QueueJob) -> QueueJobOutcome {
        match (&job.kind, job.payload) {
            (QueueJobKind::GameDownload, QueueJobPayload::Game(p)) => downloading::download::run_game_download(app, p, job.id),
            (QueueJobKind::GameUpdate, QueueJobPayload::Game(p)) => downloading::update::run_game_update(app, p, job.id),
            (QueueJobKind::GamePreload, QueueJobPayload::Game(p)) => downloading::preload::run_game_preload(app, p, job.id),
            (QueueJobKind::GameRepair, QueueJobPayload::Game(p)) => downloading::repair::run_game_repair(app, p, job.id),
            #[cfg(target_os = "linux")]
            (QueueJobKind::RunnerDownload, QueueJobPayload::Runner(p)) => downloading::misc::run_runner_download(app, p, job.id),
            #[cfg(target_os = "linux")]
            (QueueJobKind::SteamrtDownload, QueueJobPayload::Steamrt(p)) => downloading::misc::run_steamrt3_download(app, p, job.id),
            #[cfg(target_os = "linux")]
            (QueueJobKind::Steamrt4Download, QueueJobPayload::Steamrt4(p)) => downloading::misc::run_steamrt4_download(app, p, job.id),
            (QueueJobKind::ExtrasDownload, QueueJobPayload::Extras(p)) => {
                let path = std::path::PathBuf::from(&p.path);
                if downloading::misc::download_or_update_extra(&app, path, p.package_id, p.package_type, p.update_mode, Some(job.id)) { QueueJobOutcome::Completed } else { QueueJobOutcome::Failed }
            }
            _ => QueueJobOutcome::Failed,
        }
    }

    let queue_handle = start_download_queue_worker(app.clone(), 1, run_queued_job);
    {
        let state = app.state::<DownloadState>();
        let mut queue = state.queue.lock().unwrap();
        *queue = Some(queue_handle);
    }

    downloading::connection_monitor::start_connection_monitor(app.clone());
    load_manifests(&app);
    utils::register_listeners(&app);
    downloading::download::register_download_handler(&app);
    downloading::update::register_update_handler(&app);
    downloading::repair::register_repair_handler(&app);
    downloading::preload::register_preload_handler(&app);

    #[cfg(target_os = "linux")]
    let data_dir = {
        let d = utils::resolve_app_data_dir(&app);
        if std::env::var("TTL_DATA_DIR").is_ok() { d } else if utils::is_flatpak() && std::fs::symlink_metadata("/home").map(|m| m.file_type().is_symlink()).unwrap_or(false) { std::fs::canonicalize(&d).unwrap_or(d) } else { d }
    };
    #[cfg(target_os = "windows")]
    let data_dir = utils::resolve_app_data_dir(&app);

    utils::setup_or_fix_default_paths(&app, data_dir.clone(), true);
    utils::sync_install_backgrounds(&app);
    downloading::misc::check_extras_update(&app);

    #[cfg(target_os = "linux")]
    {
        utils::fix_window_decorations(&app);
        let tmphome = data_dir.join("tmp_home/");
        if tmphome.exists() { let _ = std::fs::remove_dir_all(&tmphome); }
        utils::deprecate_jadeite(&app);
        utils::sync_installed_runners(&app);
        downloading::misc::download_or_update_steamrt3(&app);
        downloading::misc::download_or_update_steamrt4(&app);
    }

    for df in ["7zr","7zr.exe","krpatchz","krpatchz.exe","reaper","hpatchz","hpatchz.exe"] {
        let fd = data_dir.join(df);
        if fd.exists() { let _ = std::fs::remove_file(fd); }
    }

    app
}

pub fn shutdown_app(app: &LauncherContext) {
    utils::run_async_command(async {
        let state = app.state::<DbInstances>();
        if let Some(db) = state.0.lock().await.get("db").cloned() { db.close().await; }
    });
}

pub fn run_bridge_stdio() {
    bridge::start_stdio_bridge(create_app());
}


