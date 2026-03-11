use std::sync::atomic::Ordering;
use crate::runtime::{LauncherContext, Manager};
use crate::DownloadState;

pub fn pause_game_download(app: LauncherContext, install_id: String) -> bool {
    let state = app.state::<DownloadState>();

    // Mark the install as "pausing" in the queue state
    {
        let queue_guard = state.queue.lock().unwrap();
        if let Some(ref queue_handle) = *queue_guard {
            queue_handle.set_pausing(install_id.clone(), true);
        }
    }

    // Set the cancel token to trigger the pause
    let tokens = state.tokens.lock().unwrap();
    if let Some(token) = tokens.get(&install_id) {
        token.store(true, Ordering::Relaxed);
        return true;
    }
    false
}

pub fn queue_move_up(app: LauncherContext, job_id: String) -> bool {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard { return queue_handle.move_up(job_id); }
    false
}

pub fn queue_move_down(app: LauncherContext, job_id: String) -> bool {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard { return queue_handle.move_down(job_id); }
    false
}

pub fn queue_remove(app: LauncherContext, job_id: String) -> bool {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard { return queue_handle.remove(job_id); }
    false
}

pub fn queue_set_paused(app: LauncherContext, paused: bool) {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard { queue_handle.set_paused(paused); }
}

pub fn queue_activate_job(app: LauncherContext, job_id: String) -> bool {
    let state = app.state::<DownloadState>();

    // First, activate the job in the queue - this sets the `activating` flag
    // so that when we cancel the running job, it knows to go back to queue
    let activated_install_id = {
        let queue_guard = state.queue.lock().unwrap();
        if let Some(ref queue_handle) = *queue_guard { queue_handle.activate_job(job_id) } else { None }
    };

    if let Some(skip_id) = activated_install_id {
        // Now pause all currently running downloads by setting their cancel tokens
        // EXCEPT the one we just activated (if it already started).
        // The `activating` flag is already set, so cancelled jobs will go back to queue
        let tokens = state.tokens.lock().unwrap();
        for (install_id, token) in tokens.iter() {
            if install_id != &skip_id { token.store(true, Ordering::Relaxed); }
        }
        return true;
    }
    false
}

pub fn queue_reorder(app: LauncherContext, job_id: String, new_position: usize) -> bool {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard { return queue_handle.reorder(job_id, new_position); }
    false
}

pub fn queue_resume_job(app: LauncherContext, install_id: String) -> bool {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard { return queue_handle.resume_job(install_id); }
    false
}

pub fn get_download_queue_state(app: LauncherContext) -> Option<String> {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard {
        if let Some(payload) = queue_handle.get_state() { return serde_json::to_string(&payload).ok(); }
    }
    None
}

pub fn queue_clear_completed(app: LauncherContext) {
    let state = app.state::<DownloadState>();
    let queue_guard = state.queue.lock().unwrap();
    if let Some(ref queue_handle) = *queue_guard { queue_handle.clear_completed(); }
}

