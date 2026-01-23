use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::downloading::{QueueJobPayload, SteamrtDownloadPayload};
use crate::utils::{empty_dir, prevent_exit, run_async_command, show_dialog};
use crate::DownloadState;
use fischl::compat::download_steamrt;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager};

pub fn register_steamrt_download_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_steamrt_download", move |event| {
        let payload: SteamrtDownloadPayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::SteamrtDownload, QueueJobPayload::Steamrt(payload));
        } else {
            let h = a.clone();
            std::thread::spawn(move || {
                let job_id = format!(
                    "direct_steamrt_{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                );
                let _ = run_steamrt_download(h, payload, job_id);
            });
        }
    });
}

pub fn run_steamrt_download(
    app: AppHandle,
    payload: SteamrtDownloadPayload,
    job_id: String,
) -> QueueJobOutcome {
    let job_id = Arc::new(job_id);
    let steamrt_path = Path::new(&payload.steamrt_path).to_path_buf();
    let is_update = payload.is_update;

    let event_name = if is_update {
        "update_progress"
    } else {
        "download_progress"
    };
    let complete_event = if is_update {
        "update_complete"
    } else {
        "download_complete"
    };

    let mut dlp = HashMap::new();
    dlp.insert("job_id", job_id.to_string());
    dlp.insert("name", "SteamLinuxRuntime 3".to_string());
    dlp.insert("progress", "0".to_string());
    dlp.insert("total", "1000".to_string());
    app.emit(event_name, dlp.clone()).unwrap();
    prevent_exit(&app, true);

    let r = run_async_command(async {
        download_steamrt(
            steamrt_path.clone(),
            steamrt_path.clone(),
            "steamrt3".to_string(),
            "latest-public-beta".to_string(),
            {
                let app = app.clone();
                let job_id = job_id.clone();
                let event_name = event_name.to_string();
                move |current, total, net_speed, disk_speed| {
                    let mut dlp = HashMap::new();
                    dlp.insert("job_id", job_id.to_string());
                    dlp.insert("name", "SteamLinuxRuntime 3".to_string());
                    dlp.insert("progress", current.to_string());
                    dlp.insert("total", total.to_string());
                    dlp.insert("speed", net_speed.to_string());
                    dlp.insert("disk", disk_speed.to_string());
                    app.emit(&event_name, dlp).unwrap();
                }
            },
        )
        .await
    });

    if r {
        app.emit(complete_event, job_id.to_string()).unwrap();
        prevent_exit(&app, false);
        QueueJobOutcome::Completed
    } else {
        let action = if is_update { "update" } else { "download" };
        show_dialog(
            &app,
            "error",
            "TwintailLauncher",
            &format!(
                "Error occurred while trying to {} SteamLinuxRuntime! Please restart the application to retry.",
                action
            ),
            None,
        );
        prevent_exit(&app, false);
        app.emit(complete_event, job_id.to_string()).unwrap();

        // Clean up failed download
        let _ = empty_dir(steamrt_path.as_path());

        QueueJobOutcome::Failed
    }
}
