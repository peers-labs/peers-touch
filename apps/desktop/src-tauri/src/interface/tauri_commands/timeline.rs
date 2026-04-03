use crate::error::AppResult;
use crate::contracts::{StubPayload, TimelineActionInput, TimelineListInput};

use crate::application::timeline as application_timeline;

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
