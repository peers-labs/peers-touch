// Tauri command layer: profile operations.
//
// 2026-04-09: Rewritten to add OSS upload commands, pick_image_file,
//             and account_sync_avatar. State-dependent commands use
//             state.inner() to bridge tauri::State -> &AppState.

use crate::application::profile as application_profile;
use crate::application::session_resolver;
use crate::contracts::{
    AccountSyncAvatarInput, AvatarResolveLocalInput, FileUploadInput, PeerProfileGetInput,
    ProfilePrivacyInput, ProfileUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{Manager, State, Window};

fn require_token(state: &Arc<AppState>, window: &Window) -> Result<String, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state, window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

#[tauri::command]
pub fn profile_get(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    application_profile::profile_get(&token)
}

/// Fetch a peer actor's public profile by DID. Used by Contacts and Chat
/// detail panels to render the peer's public information consistently.
#[tauri::command]
pub fn peer_profile_get(
    state: State<'_, Arc<AppState>>,
    input: PeerProfileGetInput,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    application_profile::peer_profile_get(&token, &input.did)
}

#[tauri::command]
pub fn profile_update(
    state: State<'_, Arc<AppState>>,
    input: ProfileUpdateInput,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    application_profile::profile_update(input, &token)
}

#[tauri::command]
pub fn profile_upload_avatar(
    state: State<'_, Arc<AppState>>,
    input: FileUploadInput,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_profile::profile_upload_avatar(&actor_id, input, &token)
}

#[tauri::command]
pub fn profile_upload_header(
    state: State<'_, Arc<AppState>>,
    input: FileUploadInput,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_profile::profile_upload_header(&actor_id, input, &token)
}

// 2026-04-25: Changed from sync to async with spawn_blocking.
// The sync variant blocks the Tauri main thread on macOS while making
// multiple sequential HTTP requests (OSS upload + profile update + profile get
// + avatar download), which can deadlock or timeout — same class of issue
// that was fixed for pick_image_file (see below).
// Uses AppHandle instead of State to avoid lifetime issues in async commands.
#[tauri::command]
pub async fn profile_upload_avatar_oss(
    app: tauri::AppHandle,
    input: FileUploadInput,
    window: Window,
) -> AppResult<StubPayload> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let token = match require_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    tokio::task::spawn_blocking(move || {
        application_profile::profile_upload_avatar_oss(input, &token)
    })
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "profile_upload_avatar_oss task panicked");
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Avatar upload task failed: {}", e),
            None,
        )
    })
}

#[tauri::command]
pub async fn profile_upload_header_oss(
    app: tauri::AppHandle,
    input: FileUploadInput,
    window: Window,
) -> AppResult<StubPayload> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let token = match require_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    tokio::task::spawn_blocking(move || {
        application_profile::profile_upload_header_oss(input, &token)
    })
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "profile_upload_header_oss task panicked");
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Header upload task failed: {}", e),
            None,
        )
    })
}

#[tauri::command]
pub fn profile_update_privacy(
    state: State<'_, Arc<AppState>>,
    input: ProfilePrivacyInput,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_profile::profile_update_privacy(&actor_id, &token, input)
}

// 2026-04-21: Changed from sync rfd::FileDialog to async rfd::AsyncFileDialog.
// The sync variant deadlocks on macOS under Tauri 2 because the command handler
// blocks the main thread while NSOpenPanel also needs the main run-loop.
#[tauri::command]
pub async fn pick_image_file(window: Window) -> AppResult<StubPayload> {
    let _ = window;
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
            AppResult::fail(
                ErrorCode::InvalidArgument,
                "No file selected for upload",
                None,
            )
        }
    }
}

/// Sync avatar URL to local auth identity and download to local cache.
/// Called by frontend after profile avatar is loaded or changed on Station.
#[tauri::command]
pub fn account_sync_avatar(
    state: State<'_, Arc<AppState>>,
    input: AccountSyncAvatarInput,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    application_profile::account_sync_avatar(&input, &token)
}

/// Fetch profile from Station and sync all user data (metadata + avatar) to local storage.
// 2026-04-21: New aggregated sync command for user profile local caching.
// 2026-04-26: Pass the per-window actor_id so the application layer writes
//             into the correct LocalAccount record and does not rely on the
//             volatile `active_account_id` pointer.
#[tauri::command]
pub fn sync_user_profile(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let session = match state.sessions.get(window.label()) {
        Some(session)
            if !session.jwt.trim().is_empty()
                && !session.account_id.trim().is_empty()
                && session.actor.ptid.starts_with("ptid:") =>
        {
            session
        }
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "sync_user_profile: window has no complete bound identity",
                None,
            )
        }
    };
    if session.actor.actor_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "sync_user_profile: window has no bound local actor",
            None,
        );
    }
    application_profile::sync_user_profile(
        &session.jwt,
        &session.actor.ptid,
    )
}

/// Resolve a remote avatar URL to a local cache file, downloading it on miss.
/// Wrapped in `spawn_blocking` because the worst case performs a synchronous
/// HTTP download from Station (must not block the Tauri main thread).
// 2026-04-25: Single backend entry point for the unified UserSquareAvatar
//             component (replaces ad-hoc avatar_local_path plumbing).
#[tauri::command]
pub async fn avatar_resolve_local(
    input: AvatarResolveLocalInput,
    window: Window,
) -> AppResult<StubPayload> {
    let _ = window;
    let url = input.url.unwrap_or_default();
    let resolved =
        tokio::task::spawn_blocking(move || application_profile::avatar_resolve_local(&url))
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error = %e, "avatar_resolve_local task panicked");
                None
            });

    let payload = serde_json::json!({ "local_path": resolved });
    AppResult::success(StubPayload {
        command: "avatar_resolve_local".to_string(),
        status: payload.to_string(),
    })
}
