use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Serialize, Clone)]
pub struct NetworkStatus {
    pub status: String, // "online", "slow", "offline"
    pub latency_ms: Option<u64>,
    pub message: String,
}

/// Check network connectivity by attempting to reach a reliable endpoint.
/// Returns status: "online" (< 2s), "slow" (2-10s), or "offline" (failed/timeout)
#[tauri::command]
pub async fn check_network_connectivity() -> NetworkStatus {
    // Use a small, reliable endpoint - GitHub's raw content or similar
    // We'll try multiple endpoints in case one is blocked
    let endpoints = [
        "https://raw.githubusercontent.com/nicewrld/tw/refs/heads/stable/README.md",
        "https://api.github.com/zen",
        "https://www.google.com/generate_204",
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    for endpoint in endpoints {
        let start = Instant::now();

        match client.head(endpoint).send().await {
            Ok(response) => {
                let latency = start.elapsed().as_millis() as u64;

                if response.status().is_success() || response.status().as_u16() == 204 {
                    // Determine status based on latency
                    if latency < 2000 {
                        return NetworkStatus {
                            status: "online".to_string(),
                            latency_ms: Some(latency),
                            message: "Connection is good".to_string(),
                        };
                    } else if latency < 10000 {
                        return NetworkStatus {
                            status: "slow".to_string(),
                            latency_ms: Some(latency),
                            message: format!("Connection is slow ({}ms)", latency),
                        };
                    }
                }
            }
            Err(_) => {
                // Try next endpoint
                continue;
            }
        }
    }

    // All endpoints failed
    NetworkStatus {
        status: "offline".to_string(),
        latency_ms: None,
        message: "Unable to connect to the internet".to_string(),
    }
}
