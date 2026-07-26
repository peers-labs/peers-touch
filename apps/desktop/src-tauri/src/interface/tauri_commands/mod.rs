pub mod account;
pub mod actor;
pub mod admin;
pub mod agent_growth;
pub mod agent_orchestration;
pub mod agent_scheduler;
pub mod agent_turn;
pub mod agents;
pub mod applets;
pub mod auth;
pub mod channels;
pub mod chat;
pub mod conversation;
pub mod cron;
pub mod crypto;
pub mod desktop_capture;
pub mod federation;
pub mod friend_chat;
pub mod frontend_log;
pub mod frontend_telemetry;
pub mod group_chat;
pub mod host_events;
pub mod i18n;
pub mod ice;
pub mod key_exchange;
pub mod mcp;
pub mod memory;
pub mod mls;
pub mod model_config;
pub mod notebook;
pub mod notification;
pub mod oauth2;
pub mod oss;
pub mod presence;
pub mod profile;
pub mod provider;
pub mod realtime;
pub mod search;
pub mod settings;
pub mod skills;
pub mod skills_market;
pub mod social;
pub mod station;
pub mod system;
pub mod tools;
pub mod tts;

use crate::contracts::StubPayload;
use crate::contracts::CONTRACT_VERSION;
use crate::error::{AppResult, ErrorCode};

pub fn not_implemented(command: &str) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::NotImplemented,
        "error.command.notImplemented",
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
