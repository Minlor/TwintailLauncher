use serde::{Deserialize,Serialize};
use serde_json::Value;

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct RpcRequest {
    #[serde(default = "default_jsonrpc")]
    pub jsonrpc: String,
    pub id: Option<u64>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct RpcResponse {
    #[serde(default = "default_jsonrpc")]
    pub jsonrpc: String,
    pub id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct RpcEventNotification {
    #[serde(default = "default_jsonrpc")]
    pub jsonrpc: String,
    pub method: String,
    pub params: EventParams,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct EventParams {
    pub event_name: String,
    #[serde(default)]
    pub payload: Value,
}

pub fn default_jsonrpc() -> String { "2.0".to_string() }

impl RpcResponse {
    pub fn ok(id: Option<u64>, result: Value) -> Self { Self { jsonrpc: default_jsonrpc(), id, result: Some(result), error: None } }
    pub fn err(id: Option<u64>, code: i64, message: impl Into<String>) -> Self { Self { jsonrpc: default_jsonrpc(), id, result: None, error: Some(RpcError { code, message: message.into() }) } }
}

impl RpcEventNotification {
    pub fn new(event_name: impl Into<String>, payload: Value) -> Self { Self { jsonrpc: default_jsonrpc(), method: "event".to_string(), params: EventParams { event_name: event_name.into(), payload } } }
}


