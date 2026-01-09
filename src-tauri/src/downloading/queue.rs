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
    pub running: Vec<QueueJobView>,
    pub queued: Vec<QueueJobView>,
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
}

pub enum QueueCommand {
    Enqueue(QueueJob),
    SetMaxConcurrent(usize),
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
    active: &HashMap<String, QueueJobView>,
    queued: &VecDeque<QueueJobView>,
) {
    let payload = QueueStatePayload {
        max_concurrent,
        running: active.values().cloned().collect(),
        queued: queued.iter().cloned().collect(),
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
        let mut queued: VecDeque<QueueJob> = VecDeque::new();
        let mut queued_views: VecDeque<QueueJobView> = VecDeque::new();
        let mut active: HashMap<String, QueueJobView> = HashMap::new();

        loop {
            while let Ok((job_id, outcome)) = done_rx.try_recv() {
                if let Some(mut view) = active.remove(&job_id) {
                    view.status = match outcome {
                        QueueJobOutcome::Completed => QueueJobStatus::Completed,
                        QueueJobOutcome::Failed => QueueJobStatus::Failed,
                        QueueJobOutcome::Cancelled => QueueJobStatus::Cancelled,
                    };
                    // For now, we just drop completed jobs from state; UI can rely on completion events.
                }
                emit_queue_state(&app, max_concurrent, &active, &queued_views);
            }

            while active.len() < max_concurrent {
                let Some(job) = queued.pop_front() else { break; };
                let Some(mut view) = queued_views.pop_front() else { break; };

                view.status = QueueJobStatus::Running;
                let job_id = job.id.clone();
                active.insert(job_id.clone(), view);

                emit_queue_state(&app, max_concurrent, &active, &queued_views);

                let app2 = app.clone();
                let done_tx2 = done_tx.clone();
                let runner = run_job;

                // run_job is blocking-heavy (downloads + extraction), so we keep it in a dedicated OS thread.
                std::thread::spawn(move || {
                    let outcome = runner(app2, job);
                    let _ = done_tx2.send((job_id, outcome));
                });
            }

            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(cmd) => match cmd {
                    QueueCommand::Enqueue(job) => {
                        let name = job
                            .payload
                            .install
                            .clone();
                        // UI-visible name will be improved by the job runner via progress events.
                        queued_views.push_back(QueueJobView {
                            id: job.id.clone(),
                            kind: job.kind,
                            install_id: job.payload.install.clone(),
                            name,
                            status: QueueJobStatus::Queued,
                        });
                        queued.push_back(job);
                        emit_queue_state(&app, max_concurrent, &active, &queued_views);
                    }
                    QueueCommand::SetMaxConcurrent(n) => {
                        max_concurrent = n.max(1);
                        emit_queue_state(&app, max_concurrent, &active, &queued_views);
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
