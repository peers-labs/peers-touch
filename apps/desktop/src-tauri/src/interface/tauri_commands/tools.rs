use std::sync::Arc;

use tauri::{State, Window};

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

use crate::application::tools as application_tools;

#[tauri::command]
pub fn tools_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), &window).unwrap_or_default();
    if !actor_ptid.starts_with("ptid:") {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_tools::tools_list(&actor_ptid)
}
