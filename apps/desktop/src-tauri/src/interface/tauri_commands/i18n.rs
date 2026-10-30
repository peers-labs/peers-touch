use std::sync::Arc;
// Tauri command layer: i18n resource loading exposed to frontend.
// Delegates to I18nService held in AppState for filesystem scanning.
// 2026-04-09: Initial creation for i18n architecture landing.
// 2026-04-09: Refactored to use I18nService via AppState.
// 2026-10-29: Filesystem scan moved off the main thread. A synchronous
//             command blocks the whole IPC queue for the duration of the read;
//             a slow authorization round-trip on a protected source path
//             previously froze every command (not just i18n) for minutes.

use tauri::State;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::i18n::I18nResources;
use crate::state::AppState;

#[tauri::command]
pub async fn i18n_load_resources(
    state: State<'_, Arc<AppState>>,
) -> Result<AppResult<I18nResources>, String> {
    let i18n = state.i18n.clone();
    let result = tauri::async_runtime::spawn_blocking(move || i18n.load_resources())
        .await
        .map_err(|join_error| format!("i18n resource task failed to join: {join_error}"))?;

    match result {
        Ok(resources) => Ok(AppResult::success(resources)),
        Err(error) => {
            tracing::error!(%error, "Failed to load i18n resources");
            Ok(AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to read i18n resources from storage: {error}"),
                None,
            ))
        }
    }
}
