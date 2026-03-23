use crate::error::AppResult;
use crate::interface::contracts::{StubPayload, TimelineActionInput, TimelineListInput};

#[path = "../../domain/timeline/mod.rs"]
mod domain_timeline;
#[path = "../../application/timeline/mod.rs"]
mod application_timeline;

#[tauri::command]
pub fn timeline_list(input: TimelineListInput) -> AppResult<StubPayload> {
    application_timeline::timeline_list(input)
}

#[tauri::command]
pub fn timeline_like(input: TimelineActionInput) -> AppResult<StubPayload> {
    application_timeline::timeline_like(input)
}

#[tauri::command]
pub fn timeline_comment(input: TimelineActionInput) -> AppResult<StubPayload> {
    application_timeline::timeline_comment(input)
}

#[tauri::command]
pub fn timeline_repost(input: TimelineActionInput) -> AppResult<StubPayload> {
    application_timeline::timeline_repost(input)
}
