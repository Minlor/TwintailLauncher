use serde::{Deserialize, Serialize};

pub mod preload;
pub mod repair;
pub mod update;
pub mod download;
pub mod queue;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadGamePayload {
    pub install: String,
    pub biz: String,
    pub lang: String,
    pub region: String,
    pub is_latest: Option<String>,
}