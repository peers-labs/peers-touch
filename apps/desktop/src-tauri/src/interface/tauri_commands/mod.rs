pub mod admin;
pub mod auth;
pub mod chat;
pub mod profile;
pub mod settings;
pub mod timeline;

use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::StubPayload;

pub fn not_implemented(command: &str) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::NotImplemented,
        "command not implemented",
        Some(serde_json::json!({ "command": command })),
    )
}
