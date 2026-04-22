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

// 2026-04-21: Changed from sync rfd::FileDialog to async rfd::AsyncFileDialog.
// The sync variant deadlocks on macOS under Tauri 2 because the command handler
// blocks the main thread while NSOpenPanel also needs the main run-loop.
#[tauri::command]
pub async fn pick_image_file() -> AppResult<StubPayload> {
    tracing::info!("Opening file picker dialog for image selection");
    let dialog = rfd::AsyncFileDialog::new()
        .set_title("Select Image")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"]);

    match dialog.pick_file().await {
        Some(handle) => {
            let path_str = handle.path().to_string_lossy().to_string();
            tracing::info!(path = %path_str, "Image file selected");
            AppResult::success(StubPayload {
                command: "pick_image_file".to_string(),
                status: path_str,
            })
        }
        None => {
            tracing::warn!("Image file picker cancelled by user");
            AppResult::fail(ErrorCode::InvalidArgument, "No file selected for upload", None)
        }
    }
}

/// Sync avatar URL to local auth identity and download to local cache.
/// Called by frontend after profile avatar is loaded or changed on Station.
#[tauri::command]
pub fn account_sync_avatar(input: AccountSyncAvatarInput) -> AppResult<StubPayload> {
    match application_profile::sync_avatar_with_download(&input.avatar_url) {
        Ok(local_path) => {
            let status = match local_path {
                Some(p) => format!("synced_local:{}", p),
                None => "synced_remote_only".to_string(),
            };
            AppResult::success(StubPayload {
                command: "account_sync_avatar".to_string(),
                status,
            })
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to sync avatar");
            AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to sync avatar: {}", e),
                None,
            )
        }
    }
}

/// Fetch profile from Station and sync all user data (metadata + avatar) to local storage.
// 2026-04-21: New aggregated sync command for user profile local caching.
#[tauri::command]
pub fn sync_user_profile(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    application_profile::sync_user_profile(state.inner())
}
