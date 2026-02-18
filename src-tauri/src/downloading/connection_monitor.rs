use crate::DownloadState;
use crate::downloading::queue::DownloadQueueHandle;
use std::time::Duration;
use tauri::{AppHandle,Emitter,Manager};

pub fn start_connection_monitor(app: AppHandle) {
    let app_handle = app.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let mut was_offline = false;
        let mut consecutive_failures = 0;

        loop {
            std::thread::sleep(Duration::from_secs(5));

            // Get the queue handle
            let queue: Option<DownloadQueueHandle> = {
                let state = app_handle.state::<DownloadState>();
                let q = state.queue.lock().unwrap();
                q.clone()
            };

            let Some(queue) = queue else { continue; };

            // Check connectivity
            let is_online = rt.block_on(check_connectivity());

            if !is_online {
                consecutive_failures += 1;
                // Only auto-pause after 3 consecutive failures (15 seconds of offline)
                if consecutive_failures >= 3 && !was_offline {
                    was_offline = true;
                    queue.auto_pause();
                    let _ = app_handle.emit("connection_status", "offline");
                    eprintln!("[Connection Monitor] Internet connection lost, auto-pausing downloads");
                }
            } else {
                consecutive_failures = 0;
                if was_offline {
                    was_offline = false;
                    // Only auto-resume if we were the ones who paused (auto_paused flag)
                    if queue.is_auto_paused() {
                        queue.auto_resume();
                        let _ = app_handle.emit("connection_status", "online");
                        eprintln!("[Connection Monitor] Internet connection restored, auto-resuming downloads");
                    }
                }
            }
        }
    });
}

/// Check if we have internet connectivity by trying multiple endpoints
async fn check_connectivity() -> bool {
    let endpoints = ["https://store.steampowered.com", "https://one.one.one.one", "https://twintaillauncher.app"];

    let client = match reqwest::Client::builder().timeout(Duration::from_secs(10)).build() {
        Ok(c) => c,
        Err(_) => return false,
    };

    for endpoint in endpoints {
        match client.head(endpoint).send().await {
            Ok(response) => { if response.status().is_success() || response.status().as_u16() == 204 { return true; } }
            Err(_) => continue,
        }
    }
    false
}
