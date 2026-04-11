use std::sync::Arc;
// Tauri command layer: i18n resource loading exposed to frontend.
// Delegates to I18nService held in AppState for filesystem scanning.
// 2026-04-09: Initial creation for i18n architecture landing.
// 2026-04-09: Refactored to use I18nService via AppState.

use tauri::State;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::i18n::I18nResources;
use crate::state::AppState;

#[tauri::command]
pub fn i18n_load_resources(state: State<Arc<AppState>>) -> AppResult<I18nResources> {
    match state.i18n.load_resources() {
        Ok(resources) => AppResult::success(resources),
        Err(e) => {
            tracing::error!(error = %e, "Failed to load i18n resources");
            AppResult::fail(
                ErrorCode::InternalError,
                "error.storage.readFailed",
                Some(serde_json::json!({ "detail": e })),
            )
        }
    }
}
