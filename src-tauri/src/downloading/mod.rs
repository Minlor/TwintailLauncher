use serde::{Deserialize, Serialize};

pub mod connection_monitor;
pub mod download;
pub mod misc;
pub mod preload;
pub mod queue;
pub mod repair;
pub mod update;

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

/// Payload for extras downloads (jadeite, fps unlock, xxmi variants)
#[derive(Debug, Clone)]
pub struct ExtrasDownloadPayload {
    pub path: String,
    pub package_id: String,
    pub package_type: String,
    pub update_mode: bool,
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
    Extras(ExtrasDownloadPayload),
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
            QueueJobPayload::Extras(p) => p.package_type.clone(),
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
            QueueJobPayload::XXMI(_) => "XXMI Modding Tool".to_string(),
            QueueJobPayload::Extras(p) => {
                match p.package_type.as_str() {
                    "v5.0.1-hotfix" | "jadeite" => "Jadeite".to_string(),
                    "keqing_unlock" => "FPS Unlocker".to_string(),
                    "xxmi" => "XXMI".to_string(),
                    "gimi" => "XXMI - GIMI".to_string(),
                    "srmi" => "XXMI - SRMI".to_string(),
                    "zzmi" => "XXMI - ZZMI".to_string(),
                    "himi" => "XXMI - HIMI".to_string(),
                    "wwmi" => "XXMI - WWMI".to_string(),
                    "ssmi" => "XXMI - SSMI".to_string(),
                    "efmi" => "XXMI - EFMI".to_string(),
                    _ => p.package_type.clone(),
                }
            }
        }
    }
}
