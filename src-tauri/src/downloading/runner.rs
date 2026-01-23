use crate::downloading::queue::{QueueJobKind, QueueJobOutcome};
use crate::downloading::{QueueJobPayload, RunnerDownloadPayload};
use crate::utils::db_manager::{
    create_installed_runner, get_installed_runner_info_by_version,
    update_installed_runner_is_installed_by_version,
};
use crate::utils::{prevent_exit, run_async_command, send_notification, show_dialog};
use crate::DownloadState;
use fischl::compat::Compat;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager};

pub fn register_runner_download_handler(app: &AppHandle) {
    let a = app.clone();
    app.listen("start_runner_download", move |event| {
        let payload: RunnerDownloadPayload = serde_json::from_str(event.payload()).unwrap();
        let state = a.state::<DownloadState>();
        let q = state.queue.lock().unwrap().clone();
        if let Some(queue) = q {
            queue.enqueue(QueueJobKind::RunnerDownload, QueueJobPayload::Runner(payload));
        } else {
            let h = a.clone();
            std::thread::spawn(move || {
                let job_id = format!(
                    "direct_runner_{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                );
                let _ = run_runner_download(h, payload, job_id);
            });
        }
    });
}

pub fn run_runner_download(
    app: AppHandle,
    payload: RunnerDownloadPayload,
    job_id: String,
) -> QueueJobOutcome {
    let job_id = Arc::new(job_id);
    let runner_version = payload.runner_version.clone();
    let runner_url = payload.runner_url.clone();
    let runner_path = Path::new(&payload.runner_path).to_path_buf();

    // Ensure directory exists
    if !runner_path.exists() {
        if let Err(e) = fs::create_dir_all(&runner_path) {
            send_notification(
                &app,
                &format!("Failed to create runner directory: {}", e),
                None,
            );
            return QueueJobOutcome::Failed;
        }
    }

    // Check if already downloaded (non-empty directory)
    if let Ok(mut entries) = fs::read_dir(&runner_path) {
        if entries.next().is_some() {
            send_notification(
                &app,
                &format!("Runner {} already installed!", runner_version),
                None,
            );
            return QueueJobOutcome::Completed;
        }
    }

    let mut dlp = HashMap::new();
    dlp.insert("job_id", job_id.to_string());
    dlp.insert("name", runner_version.clone());
    dlp.insert("progress", "0".to_string());
    dlp.insert("total", "1000".to_string());
    app.emit("download_progress", dlp.clone()).unwrap();
    prevent_exit(&app, true);

    let r = run_async_command(async {
        Compat::download_runner(
            runner_url.clone(),
            runner_path.to_str().unwrap().to_string(),
            true,
            {
                let app = app.clone();
                let job_id = job_id.clone();
                let runner_version = runner_version.clone();
                move |current, total, net_speed, disk_speed| {
                    let mut dlp = HashMap::new();
                    dlp.insert("job_id", job_id.to_string());
                    dlp.insert("name", runner_version.clone());
                    dlp.insert("progress", current.to_string());
                    dlp.insert("total", total.to_string());
                    dlp.insert("speed", net_speed.to_string());
                    dlp.insert("disk", disk_speed.to_string());
                    app.emit("download_progress", dlp).unwrap();
                }
            },
        )
        .await
    });

    if r {
        // Update database state BEFORE emitting download_complete
        // This ensures fetchInstalledRunners() gets the updated state
        let ir = get_installed_runner_info_by_version(&app, runner_version.clone());
        if ir.is_some() {
            update_installed_runner_is_installed_by_version(&app, runner_version.clone(), true);
        } else {
            let _ = create_installed_runner(
                &app,
                runner_version.clone(),
                true,
                runner_path.to_str().unwrap().to_string(),
            );
        }

        app.emit("download_complete", job_id.to_string()).unwrap();
        prevent_exit(&app, false);

        send_notification(
            &app,
            &format!("Download of {} complete.", runner_version),
            None,
        );
        QueueJobOutcome::Completed
    } else {
        show_dialog(
            &app,
            "error",
            "TwintailLauncher",
            &format!(
                "Error occurred while trying to download {} runner! Please retry later.",
                runner_version
            ),
            None,
        );
        prevent_exit(&app, false);
        app.emit("download_complete", job_id.to_string()).unwrap();

        // Clean up failed download
        if runner_path.exists() {
            let _ = fs::remove_dir_all(&runner_path);
            update_installed_runner_is_installed_by_version(&app, runner_version.clone(), false);
        }

        QueueJobOutcome::Failed
    }
}
