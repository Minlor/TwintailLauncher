use serde::{Deserialize, Serialize};

pub mod download;
pub mod preload;
pub mod queue;
pub mod repair;
#[cfg(target_os = "linux")]
pub mod runner;
#[cfg(target_os = "linux")]
pub mod steamrt;
pub mod update;
pub mod xxmi;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadGamePayload {
    pub install: String,
    pub biz: String,
    pub lang: String,
    pub region: String,
    pub is_latest: Option<String>,
}

/// Payload for runner downloads (Linux only)
#[cfg(target_os = "linux")]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RunnerDownloadPayload {
    pub runner_version: String,
    pub runner_url: String,
    pub runner_path: String,
}

/// Payload for SteamRT downloads (Linux only)
#[cfg(target_os = "linux")]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SteamrtDownloadPayload {
    pub steamrt_path: String,
    pub is_update: bool,
}

/// Payload for XXMI downloads
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct XXMIDownloadPayload {
    pub xxmi_path: String,
    pub install_id: Option<String>,
    pub is_update: bool,
}

/// Unified payload enum for all queue job types
#[derive(Debug, Clone)]
pub enum QueueJobPayload {
    Game(DownloadGamePayload),
    #[cfg(target_os = "linux")]
    Runner(RunnerDownloadPayload),
    #[cfg(target_os = "linux")]
    Steamrt(SteamrtDownloadPayload),
    XXMI(XXMIDownloadPayload),
}

impl QueueJobPayload {
    /// Returns the unique identifier for this job (install_id for games, version for runners, "steamrt" for steamrt)
    pub fn get_id(&self) -> String {
        match self {
            QueueJobPayload::Game(p) => p.install.clone(),
            #[cfg(target_os = "linux")]
            QueueJobPayload::Runner(p) => p.runner_version.clone(),
            #[cfg(target_os = "linux")]
            QueueJobPayload::Steamrt(_) => "steamrt".to_string(),
            QueueJobPayload::XXMI(_) => "xxmi".to_string(),
        }
    }

    /// Returns a display name for this job
    pub fn get_name(&self) -> String {
        match self {
            QueueJobPayload::Game(p) => p.install.clone(),
            #[cfg(target_os = "linux")]
            QueueJobPayload::Runner(p) => p.runner_version.clone(),
            #[cfg(target_os = "linux")]
            QueueJobPayload::Steamrt(_) => "SteamLinuxRuntime 3".to_string(),
            QueueJobPayload::XXMI(p) => {
                if p.is_update {
                    "XXMI Update".to_string()
                } else {
                    "XXMI Modding Tool".to_string()
                }
            }
        }
    }
}
