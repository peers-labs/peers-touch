use serde::Deserialize;
use serde_json::json;

use crate::application::native_surface;
use crate::contracts::StubPayload;
use crate::error::AppResult;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockBadgeInput {
    /// Number of conversations with unread messages (BOT-D13). Deliberately a
    /// conversation count rather than a raw message count.
    unread_conversation_count: Option<i64>,
}

/// Set the native dock / taskbar badge to the unread-conversation count.
#[tauri::command]
pub fn native_dock_set_badge(input: DockBadgeInput) -> AppResult<StubPayload> {
    let count = input.unread_conversation_count.unwrap_or(0).max(0) as u64;
    native_surface::set_dock_badge(count);
    AppResult::success(StubPayload {
        command: "native_dock_set_badge".to_string(),
        status: json!({ "applied": true, "unreadConversationCount": count }).to_string(),
    })
}
