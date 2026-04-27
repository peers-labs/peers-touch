use std::sync::Arc;

use crate::error::AppResult;
use crate::contracts::{StubPayload, TimelineActionInput, TimelineListInput};

use crate::application::timeline as application_timeline;
use crate::application::session_resolver;
use crate::state::AppState;
use tauri::{State, Window};

#[tauri::command]
pub fn timeline_list(
    state: State<'_, Arc<AppState>>,
    input: TimelineListInput,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_timeline::timeline_list(&actor_id, input)
}

#[tauri::command]
pub fn timeline_like(
    state: State<'_, Arc<AppState>>,
    input: TimelineActionInput,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_timeline::timeline_like(&actor_id, input)
}

#[tauri::command]
pub fn timeline_comment(
    state: State<'_, Arc<AppState>>,
    input: TimelineActionInput,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_timeline::timeline_comment(&actor_id, input)
}

#[tauri::command]
pub fn timeline_repost(
    state: State<'_, Arc<AppState>>,
    input: TimelineActionInput,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_timeline::timeline_repost(&actor_id, input)
}
