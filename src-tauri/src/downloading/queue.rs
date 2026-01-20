use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::downloading::DownloadGamePayload;

static JOB_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueJobKind {
    GameDownload,
    GameUpdate,
    GamePreload,
    GameRepair,
}

#[derive(Debug)]
pub struct QueueJob {
    pub id: String,
    pub kind: QueueJobKind,
    pub payload: DownloadGamePayload,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueJobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueJobView {
    pub id: String,
    pub kind: QueueJobKind,
    pub install_id: String,
    pub name: String,
    pub status: QueueJobStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatePayload {
    pub max_concurrent: usize,
    pub paused: bool,
    pub running: Vec<QueueJobView>,
    pub queued: Vec<QueueJobView>,
    pub completed: Vec<QueueJobView>,
}

#[derive(Clone)]
pub struct DownloadQueueHandle {
    tx: mpsc::Sender<QueueCommand>,
}

impl DownloadQueueHandle {
    pub fn enqueue(&self, kind: QueueJobKind, payload: DownloadGamePayload) -> String {
        let job_id = format!("job_{}", JOB_COUNTER.fetch_add(1, Ordering::Relaxed));
        let _ = self.tx.send(QueueCommand::Enqueue(QueueJob {
            id: job_id.clone(),
            kind,
            payload,
        }));
        job_id
    }

    /// Move a queued job up in the queue (towards position 0 = next to run)
    pub fn move_up(&self, job_id: String) -> bool {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = self.tx.send(QueueCommand::MoveUp(job_id, tx));
        rx.recv().unwrap_or(false)
    }

    /// Move a queued job down in the queue (towards the back)
    pub fn move_down(&self, job_id: String) -> bool {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = self.tx.send(QueueCommand::MoveDown(job_id, tx));
        rx.recv().unwrap_or(false)
    }

    /// Remove a job from the queue (only works for queued, not running jobs)
    pub fn remove(&self, job_id: String) -> bool {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = self.tx.send(QueueCommand::Remove(job_id, tx));
        rx.recv().unwrap_or(false)
    }

    /// Remove all jobs for an install_id from the queue (only queued, not running)
    pub fn remove_by_install_id(&self, install_id: String) -> bool {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = self
            .tx
            .send(QueueCommand::RemoveByInstallId(install_id, tx));
        rx.recv().unwrap_or(false)
    }

    /// Pause/unpause the queue (when paused, completed jobs don't auto-start next)
    pub fn set_paused(&self, paused: bool) {
        let _ = self.tx.send(QueueCommand::SetPaused(paused));
    }

    /// Move a queued job to the front and start it, pausing any currently running job
    pub fn activate_job(&self, job_id: String) -> Option<String> {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = self.tx.send(QueueCommand::ActivateJob(job_id, tx));
        rx.recv().unwrap_or(None)
    }

    /// Reorder by moving a job to a specific position (0 = front of queue)
    pub fn reorder(&self, job_id: String, new_position: usize) -> bool {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = self
            .tx
            .send(QueueCommand::Reorder(job_id, new_position, tx));
        rx.recv().unwrap_or(false)
    }

    /// Get the current queue state (for initial sync after frontend refresh)
    pub fn get_state(&self) -> Option<QueueStatePayload> {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = self.tx.send(QueueCommand::GetState(tx));
        rx.recv().ok()
    }
}

pub enum QueueCommand {
    Enqueue(QueueJob),
    SetMaxConcurrent(usize),
    SetPaused(bool),
    MoveUp(String, mpsc::Sender<bool>),
    MoveDown(String, mpsc::Sender<bool>),
    Remove(String, mpsc::Sender<bool>),
    RemoveByInstallId(String, mpsc::Sender<bool>),
    ActivateJob(String, mpsc::Sender<Option<String>>),
    Reorder(String, usize, mpsc::Sender<bool>),
    GetState(mpsc::Sender<QueueStatePayload>),
    Shutdown,
}

#[derive(Clone, Debug)]
pub enum QueueJobOutcome {
    Completed,
    Failed,
    Cancelled,
}

fn emit_queue_state(
    app: &AppHandle,
    max_concurrent: usize,
    paused: bool,
    active: &HashMap<String, QueueJobView>,
    queued: &VecDeque<QueueJobView>,
    completed: &VecDeque<QueueJobView>,
) {
    let payload = QueueStatePayload {
        max_concurrent,
        paused,
        running: active.values().cloned().collect(),
        queued: queued.iter().cloned().collect(),
        completed: completed.iter().cloned().collect(),
    };
    let _ = app.emit("download_queue_state", payload);
}

pub fn start_download_queue_worker(
    app: AppHandle,
    initial_max_concurrent: usize,
    run_job: fn(AppHandle, QueueJob) -> QueueJobOutcome,
) -> DownloadQueueHandle {
    let (tx, rx) = mpsc::channel::<QueueCommand>();
    let (done_tx, done_rx) = mpsc::channel::<(String, QueueJobOutcome)>();

    std::thread::spawn(move || {
        let mut max_concurrent = initial_max_concurrent.max(1);
        let mut paused = false;
        let mut activating = false; // Flag to prevent auto-pause during job activation
        let mut queued: VecDeque<QueueJob> = VecDeque::new();
        let mut queued_views: VecDeque<QueueJobView> = VecDeque::new();
        let mut active: HashMap<String, QueueJobView> = HashMap::new();
        let mut active_jobs: HashMap<String, QueueJob> = HashMap::new(); // Keep job data for potential requeueing
        let mut completed_views: VecDeque<QueueJobView> = VecDeque::new();

        loop {
            while let Ok((job_id, outcome)) = done_rx.try_recv() {
                if let Some(mut view) = active.remove(&job_id) {
                    let removed_job = active_jobs.remove(&job_id);

                    match outcome {
                        QueueJobOutcome::Completed => {
                            view.status = QueueJobStatus::Completed;
                            completed_views.push_front(view);
                            while completed_views.len() > 25 {
                                completed_views.pop_back();
                            }
                        }
                        QueueJobOutcome::Failed => {
                            view.status = QueueJobStatus::Failed;
                            completed_views.push_front(view);
                            while completed_views.len() > 25 {
                                completed_views.pop_back();
                            }
                        }
                        QueueJobOutcome::Cancelled => {
                            // When cancelled during activation, put the job back in queue
                            if activating {
                                if let Some(job) = removed_job {
                                    // Put the cancelled job back at the front of the queue (after the activating job)
                                    view.status = QueueJobStatus::Queued;
                                    queued.insert(1.min(queued.len()), job);
                                    queued_views.insert(1.min(queued_views.len()), view);
                                }
                            } else {
                                // Normal pause - go to completed and pause the queue
                                paused = true;
                                view.status = QueueJobStatus::Cancelled;
                                completed_views.push_front(view);
                                while completed_views.len() > 25 {
                                    completed_views.pop_back();
                                }
                            }
                        }
                    };
                }
                emit_queue_state(
                    &app,
                    max_concurrent,
                    paused,
                    &active,
                    &queued_views,
                    &completed_views,
                );
            }

            // Only auto-start next job if not paused
            if !paused {
                while active.len() < max_concurrent {
                    let Some(job) = queued.pop_front() else {
                        break;
                    };
                    let Some(mut view) = queued_views.pop_front() else {
                        break;
                    };

                    view.status = QueueJobStatus::Running;
                    let job_id = job.id.clone();
                    active.insert(job_id.clone(), view);
                    active_jobs.insert(
                        job_id.clone(),
                        QueueJob {
                            id: job.id.clone(),
                            kind: job.kind,
                            payload: job.payload.clone(),
                        },
                    );

                    // Clear the activating flag since the new job is now starting
                    activating = false;

                    emit_queue_state(
                        &app,
                        max_concurrent,
                        paused,
                        &active,
                        &queued_views,
                        &completed_views,
                    );

                    let app2 = app.clone();
                    let done_tx2 = done_tx.clone();
                    let runner = run_job;

                    // run_job is blocking-heavy (downloads + extraction), so we keep it in a dedicated OS thread.
                    std::thread::spawn(move || {
                        let outcome = runner(app2, job);
                        let _ = done_tx2.send((job_id, outcome));
                    });
                }
            }

            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(cmd) => match cmd {
                    QueueCommand::Enqueue(job) => {
                        let name = job.payload.install.clone();
                        // UI-visible name will be improved by the job runner via progress events.
                        queued_views.push_back(QueueJobView {
                            id: job.id.clone(),
                            kind: job.kind,
                            install_id: job.payload.install.clone(),
                            name,
                            status: QueueJobStatus::Queued,
                        });
                        queued.push_back(job);
                        emit_queue_state(
                            &app,
                            max_concurrent,
                            paused,
                            &active,
                            &queued_views,
                            &completed_views,
                        );
                    }
                    QueueCommand::SetMaxConcurrent(n) => {
                        max_concurrent = n.max(1);
                        emit_queue_state(
                            &app,
                            max_concurrent,
                            paused,
                            &active,
                            &queued_views,
                            &completed_views,
                        );
                    }
                    QueueCommand::SetPaused(p) => {
                        paused = p;
                        emit_queue_state(
                            &app,
                            max_concurrent,
                            paused,
                            &active,
                            &queued_views,
                            &completed_views,
                        );
                    }
                    QueueCommand::MoveUp(job_id, reply) => {
                        let mut success = false;
                        if let Some(idx) = queued.iter().position(|j| j.id == job_id) {
                            if idx > 0 {
                                queued.swap(idx, idx - 1);
                                queued_views.swap(idx, idx - 1);
                                success = true;
                                emit_queue_state(
                                    &app,
                                    max_concurrent,
                                    paused,
                                    &active,
                                    &queued_views,
                                    &completed_views,
                                );
                            }
                        }
                        let _ = reply.send(success);
                    }
                    QueueCommand::MoveDown(job_id, reply) => {
                        let mut success = false;
                        if let Some(idx) = queued.iter().position(|j| j.id == job_id) {
                            if idx < queued.len().saturating_sub(1) {
                                queued.swap(idx, idx + 1);
                                queued_views.swap(idx, idx + 1);
                                success = true;
                                emit_queue_state(
                                    &app,
                                    max_concurrent,
                                    paused,
                                    &active,
                                    &queued_views,
                                    &completed_views,
                                );
                            }
                        }
                        let _ = reply.send(success);
                    }
                    QueueCommand::Remove(job_id, reply) => {
                        let mut success = false;
                        if let Some(idx) = queued.iter().position(|j| j.id == job_id) {
                            queued.remove(idx);
                            queued_views.remove(idx);
                            success = true;
                            emit_queue_state(
                                &app,
                                max_concurrent,
                                paused,
                                &active,
                                &queued_views,
                                &completed_views,
                            );
                        }
                        let _ = reply.send(success);
                    }
                    QueueCommand::RemoveByInstallId(install_id, reply) => {
                        let mut removed_any = false;
                        // Remove all queued jobs matching this install_id
                        let mut i = 0;
                        while i < queued.len() {
                            if queued[i].payload.install == install_id {
                                queued.remove(i);
                                queued_views.remove(i);
                                removed_any = true;
                            } else {
                                i += 1;
                            }
                        }
                        if removed_any {
                            emit_queue_state(
                                &app,
                                max_concurrent,
                                paused,
                                &active,
                                &queued_views,
                                &completed_views,
                            );
                        }
                        let _ = reply.send(removed_any);
                    }
                    QueueCommand::Reorder(job_id, new_position, reply) => {
                        let mut success = false;
                        if let Some(idx) = queued.iter().position(|j| j.id == job_id) {
                            let job = queued.remove(idx).unwrap();
                            let view = queued_views.remove(idx).unwrap();
                            let insert_pos = new_position.min(queued.len());
                            queued.insert(insert_pos, job);
                            queued_views.insert(insert_pos, view);
                            success = true;
                            emit_queue_state(
                                &app,
                                max_concurrent,
                                paused,
                                &active,
                                &queued_views,
                                &completed_views,
                            );
                        }
                        let _ = reply.send(success);
                    }
                    QueueCommand::ActivateJob(job_id, reply) => {
                        // Find the job in queue and move it to front, then unpause
                        let mut install_id = None;
                        if let Some(idx) = queued.iter().position(|j| j.id == job_id) {
                            let job = queued.remove(idx).unwrap();
                            let view = queued_views.remove(idx).unwrap();
                            install_id = Some(view.install_id.clone());
                            queued.push_front(job);
                            queued_views.push_front(view);
                            activating = true; // Prevent auto-pause when current job is cancelled
                            paused = false; // Unpause to start this job
                            emit_queue_state(
                                &app,
                                max_concurrent,
                                paused,
                                &active,
                                &queued_views,
                                &completed_views,
                            );
                        }
                        let _ = reply.send(install_id);
                    }
                    QueueCommand::GetState(reply) => {
                        // Return current queue state for initial sync
                        let payload = QueueStatePayload {
                            max_concurrent,
                            paused,
                            running: active.values().cloned().collect(),
                            queued: queued_views.iter().cloned().collect(),
                            completed: completed_views.iter().cloned().collect(),
                        };
                        let _ = reply.send(payload);
                    }
                    QueueCommand::Shutdown => break,
                },
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    DownloadQueueHandle { tx }
}
