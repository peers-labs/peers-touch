// Tauri command layer: profile operations.
//
// 2026-04-09: Rewritten to add OSS upload commands, pick_image_file,
//             and account_sync_avatar. State-dependent commands use
//             state.inner() to bridge tauri::State -> &AppState.

use std::sync::Arc;
use crate::error::{AppResult, ErrorCode};
use crate::contracts::{
    AccountSyncAvatarInput, FileUploadInput, ProfilePrivacyInput, ProfileUpdateInput, StubPayload,
};
use crate::application::profile as application_profile;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn profile_get(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    application_profile::profile_get(state.inner())
}

#[tauri::command]
pub fn profile_update(state: State<'_, Arc<AppState>>, input: ProfileUpdateInput) -> AppResult<StubPayload> {
    application_profile::profile_update(state.inner(), input)
}

#[tauri::command]
pub fn profile_upload_avatar(input: FileUploadInput) -> AppResult<StubPayload> {
    application_profile::profile_upload_avatar(input)
}

#[tauri::command]
pub fn profile_upload_header(input: FileUploadInput) -> AppResult<StubPayload> {
    application_profile::profile_upload_header(input)
}

#[tauri::command]
pub fn profile_upload_avatar_oss(state: State<'_, Arc<AppState>>, input: FileUploadInput) -> AppResult<StubPayload> {
    application_profile::profile_upload_avatar_oss(state.inner(), input)
}

#[tauri::command]
pub fn profile_upload_header_oss(state: State<'_, Arc<AppState>>, input: FileUploadInput) -> AppResult<StubPayload> {
    application_profile::profile_upload_header_oss(state.inner(), input)
}

#[tauri::command]
pub fn profile_update_privacy(input: ProfilePrivacyInput) -> AppResult<StubPayload> {
    application_profile::profile_update_privacy(input)
}

#[tauri::command]
pub fn pick_image_file() -> AppResult<StubPayload> {
    let dialog = rfd::FileDialog::new()
        .set_title("Select Image")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"]);

    match dialog.pick_file() {
        Some(path) => {
            let path_str = path.to_string_lossy().to_string();
            AppResult::success(StubPayload {
                command: "pick_image_file".to_string(),
                status: path_str,
            })
        }
        None => AppResult::fail(ErrorCode::InvalidArgument, "No file selected for upload", None),
    }
}

/// Sync avatar URL to local auth identity so the sidebar avatar stays up-to-date.
/// Called by frontend after profile avatar is loaded or changed on Station.
#[tauri::command]
pub fn account_sync_avatar(input: AccountSyncAvatarInput) -> AppResult<StubPayload> {
    match crate::infrastructure::auth_identity::update_active_avatar(&input.avatar_url) {
        Ok(()) => AppResult::success(StubPayload {
            command: "account_sync_avatar".to_string(),
            status: "synced".to_string(),
        }),
        Err(e) => {
            tracing::error!(error = %e, "Failed to sync avatar to local identity");
            AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to sync avatar to station: {}", e),
                None,
            )
        }
    }
}
