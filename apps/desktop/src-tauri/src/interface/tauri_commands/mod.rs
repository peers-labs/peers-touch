pub mod admin;
pub mod agents;
pub mod applets;
pub mod auth;
pub mod channels;
pub mod chat;
pub mod cron;
pub mod mcp;
pub mod memory;
pub mod model_config;
pub mod models;
pub mod notebook;
pub mod oauth2;
pub mod provider;
pub mod profile;
pub mod search;
pub mod settings;
pub mod skills;
pub mod skills_market;
pub mod system;
pub mod timeline;
pub mod tools;
pub mod tts;

use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::CONTRACT_VERSION;
use crate::interface::contracts::StubPayload;

pub fn not_implemented(command: &str) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::NotImplemented,
        "command not implemented",
        Some(serde_json::json!({ "command": command })),
    )
}

#[tauri::command]
pub fn meta_contract_version() -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: "meta_contract_version".to_string(),
        status: serde_json::json!({
            "version": CONTRACT_VERSION
        })
        .to_string(),
    })
}
