//! Tauri command layer for OSS attachment workflows.
//!
//! Generic OSS tools own local file selection/upload. Agent owns its
//! encrypted attachment-byte upload. Messaging Engine owns Social IM
//! attachment transfer and does not use this module.
//!
//! ## Social consumer (Moments)
//! * `oss_pick_image_social` — picker scoped to image MIME types,
//!   supports multi-select up to a caller-supplied cap (Moments uses
//!   9). Returns the absolute paths.
//! * `oss_upload_attachment_social` — uploads Moments media through
//!   the Social-owned OSS path.
//!
//! ## Generic
//! * `oss_resolve_url` — given a stored `cid` (federated URI or bare
//!   key), returns the local cached path and an absolute fallback URL
//!   so the renderer can display the attachment. No consumer suffix —
//!   the resolution logic is identical across modules.
//!
//! See `application::oss` for the pure logic and
//! `infrastructure::oss_cache` for capability/file caching.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{State, Window};
use ulid::Ulid;

use crate::application::oss as application_oss;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

/// Wire shape shared by both the chat and social upload commands.
///
/// `bucket` / `visibility` are optional so the Moments variant — which
/// only sends `{file_path}` — deserializes cleanly. The chat handler
/// validates that they are present and well-formed; the social handler
/// applies its own defaults (`bucket="moments"`, `visibility="public"`).
#[derive(Debug, Deserialize)]
pub struct OssUploadAttachmentInput {
    pub file_path: String,
    #[serde(default)]
    pub bucket: String,
    #[serde(default)]
    pub visibility: String,
    #[serde(default)]
    pub chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OssUploadAttachmentBytesInput {
    pub filename: String,
    #[serde(default)]
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub conversation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct OssUploadAttachmentSocialBytesInput {
    pub filename: String,
    #[serde(default)]
    pub mime_type: String,
    pub bytes: Vec<u8>,
    #[serde(default)]
    pub bucket: String,
}

#[derive(Debug, Deserialize)]
pub struct OssPickImageSocialInput {
    /// Maximum number of files the picker is allowed to return.
    /// Moments enforces 9; the picker truncates silently if the user
    /// selects more so the renderer never has to think about the cap.
    pub max_count: u32,
}

#[derive(Debug, Deserialize)]
pub struct OssResolveUrlInput {
    /// Either a full `oss://{host}/{key}` URI or a bare key for the
    /// caller's bound station.
    pub uri: String,
    /// The DID of the caller as known to the BOUND station. Used to
    /// stamp `&owner=…` on the foreign GET so the receiving station
    /// resolves the correct per-actor FileMeta row. Optional —
    /// renderers calling for purely-public local files may omit
    /// it; foreign-origin URIs need it for federation to succeed.
    #[serde(default)]
    pub actor_ptid: String,
}

#[derive(Debug, Deserialize)]
pub struct OssListMyFilesInput {
    #[serde(default)]
    pub bucket: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub include_deleted: bool,
    #[serde(default)]
    pub page: Option<i32>,
    #[serde(default)]
    pub page_size: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct OssKeyInput {
    pub key: String,
}

#[derive(Debug, Deserialize)]
pub struct OssPatchFileInput {
    pub key: String,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub chat_session_id: Option<String>,
    #[serde(default)]
    pub bucket: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub clear_expires_at: bool,
}

#[derive(Debug, Deserialize)]
pub struct OssInvalidateCacheInput {
    pub uri: String,
}

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

pub(crate) fn validate_oss_upload_scope<'a>(
    bucket: &'a str,
    visibility: &'a str,
    chat_session_id: &'a Option<String>,
) -> Result<(&'a str, &'a str, Option<&'a str>), AppResult<StubPayload>> {
    if bucket.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "bucket is required",
            None,
        ));
    }
    let vis = visibility.trim();
    if vis != "public" && vis != "chat" && vis != "private" {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "visibility must be one of: public, chat, private",
            None,
        ));
    }
    let chat_sid = chat_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if vis == "chat" && chat_sid.is_none() {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "chat_session_id is required when visibility is chat",
            None,
        ));
    }
    Ok((
        bucket.trim(),
        vis,
        if vis == "chat" { chat_sid } else { None },
    ))
}

pub(crate) fn safe_temp_filename(filename: &str) -> String {
    let leaf = std::path::Path::new(filename)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("attachment.bin");
    let cleaned: String = leaf
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('_');
    if cleaned.is_empty() {
        "attachment.bin".to_string()
    } else {
        cleaned.to_string()
    }
}

// ── Generic OSS and Agent consumers ────────────────────────────────

#[tauri::command]
pub async fn oss_pick_local_file(window: Window) -> AppResult<StubPayload> {
    let _ = window;
    tracing::info!("Opening local file picker for OSS");
    let dialog = rfd::AsyncFileDialog::new().set_title("Select File");
    match dialog.pick_file().await {
        Some(handle) => {
            let path_str = handle.path().to_string_lossy().to_string();
            tracing::info!(path = %path_str, "OSS local file selected");
            AppResult::success(StubPayload {
                command: "oss_pick_local_file".to_string(),
                status: path_str,
            })
        }
        None => {
            tracing::debug!("Chat attachment picker cancelled by user");
            AppResult::fail(ErrorCode::InvalidArgument, "No file selected", None)
        }
    }
}

#[tauri::command]
pub async fn oss_pick_local_folder(window: Window) -> AppResult<StubPayload> {
    let _ = window;
    tracing::info!("Opening local folder picker");
    let dialog = rfd::AsyncFileDialog::new().set_title("Select Folder");
    match dialog.pick_folder().await {
        Some(handle) => {
            let path_str = handle.path().to_string_lossy().to_string();
            tracing::info!(path = %path_str, "Local folder selected");
            AppResult::success(StubPayload {
                command: "oss_pick_local_folder".to_string(),
                status: path_str,
            })
        }
        None => AppResult::fail(ErrorCode::InvalidArgument, "No folder selected", None),
    }
}

#[tauri::command]
pub fn oss_upload_local_file(
    input: OssUploadAttachmentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.file_path.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "file_path is required", None);
    }
    let vis = input.visibility.trim().to_ascii_lowercase();
    let (bucket, visibility, chat_sid) = match validate_oss_upload_scope(
        input.bucket.as_str(),
        vis.as_str(),
        &input.chat_session_id,
    ) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    application_oss::upload_attachment(
        state.station.resources(),
        &input.file_path,
        &token,
        "local_file",
        bucket,
        visibility,
        chat_sid,
    )
}

fn upload_agent_attachment_bytes_impl(
    input: OssUploadAttachmentBytesInput,
    state: &Arc<AppState>,
    window: &Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state, window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.bytes.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "bytes is required", None);
    }
    let filename = safe_temp_filename(input.filename.as_str());
    let temp_path = std::env::temp_dir().join(format!("peers-agent-{}-{filename}", Ulid::new()));
    if let Err(error) = std::fs::write(&temp_path, input.bytes) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("write temp Agent attachment: {error}"),
            None,
        );
    }
    let cleanup = application_oss::TempFileCleanup::new(temp_path.clone(), "byte attachment");

    let mime_override = input.mime_type.trim();
    let result = application_oss::upload_agent_attachment(
        state.station.resources(),
        temp_path.to_string_lossy().as_ref(),
        &token,
        &input.conversation_id,
        &filename,
        mime_override,
    );
    cleanup.remove_now();
    result
}

#[tauri::command]
pub fn oss_upload_agent_attachment_bytes(
    input: OssUploadAttachmentBytesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    upload_agent_attachment_bytes_impl(input, state.inner(), &window)
}

#[cfg(target_os = "macos")]
pub(crate) fn capture_screenshot_to_temp_file() -> Result<std::path::PathBuf, AppResult<StubPayload>>
{
    let path = std::env::temp_dir().join(format!("peers-chat-screenshot-{}.png", Ulid::new()));
    let output = std::process::Command::new("screencapture")
        .arg("-i")
        .arg("-x")
        .arg(&path)
        .output()
        .map_err(|error| {
            AppResult::fail(
                ErrorCode::InternalError,
                format!("start screenshot tool: {error}"),
                Some(serde_json::json!({ "reason": "command_start_failed" })),
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let reason = if stderr.contains("could not create image from display")
            || stderr.to_ascii_lowercase().contains("screen")
        {
            "capture_permission_or_display_failed"
        } else {
            "capture_cancelled_or_failed"
        };
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            if stderr.is_empty() {
                "screenshot capture failed".to_string()
            } else {
                format!("screenshot capture failed: {stderr}")
            },
            Some(serde_json::json!({
                "reason": reason,
                "exit_code": output.status.code(),
                "stderr": stderr,
            })),
        ));
    }

    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() > 0 => Ok(path),
        _ => Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "screenshot produced no image",
            Some(serde_json::json!({ "reason": "empty_output" })),
        )),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn capture_screenshot_with_window_hidden(
    window: &Window,
) -> Result<std::path::PathBuf, AppResult<StubPayload>> {
    let was_visible = window.is_visible().unwrap_or(true);
    let outer_position = window.outer_position().ok();
    let outer_size = window.outer_size().ok();
    let preserve_freeform_geometry =
        !window.is_maximized().unwrap_or(false) && !window.is_fullscreen().unwrap_or(false);
    if was_visible {
        if let Err(error) = window.hide() {
            tracing::warn!(error = %error, "Failed to hide window before screenshot capture");
        }
        thread::sleep(Duration::from_millis(180));
    }

    let result = capture_screenshot_to_temp_file();

    if was_visible {
        if preserve_freeform_geometry {
            if let Some(size) = outer_size {
                if let Err(error) = window.set_size(size) {
                    tracing::warn!(error = %error, "Failed to restore window size after screenshot capture");
                }
            }
            if let Some(position) = outer_position {
                if let Err(error) = window.set_position(position) {
                    tracing::warn!(error = %error, "Failed to restore window position after screenshot capture");
                }
            }
        }
        if let Err(error) = window.show() {
            tracing::warn!(error = %error, "Failed to restore window after screenshot capture");
        }
        if let Err(error) = window.set_focus() {
            tracing::warn!(error = %error, "Failed to focus window after screenshot capture");
        }
    }

    result
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn capture_screenshot_with_window_hidden(
    window: &Window,
) -> Result<std::path::PathBuf, AppResult<StubPayload>> {
    let _ = window;
    capture_screenshot_to_temp_file()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn capture_screenshot_to_temp_file() -> Result<std::path::PathBuf, AppResult<StubPayload>>
{
    Err(AppResult::fail(
        ErrorCode::NotImplemented,
        "native screenshot selection is not available on this platform",
        None,
    ))
}

// ── Social consumer (Moments) ──────────────────────────────────────

#[tauri::command]
pub async fn oss_pick_image_social(
    input: OssPickImageSocialInput,
    window: Window,
) -> AppResult<StubPayload> {
    let max_count = if input.max_count == 0 {
        1
    } else {
        input.max_count
    } as usize;
    tracing::info!(max_count, "Opening image picker dialog for Moments");
    let dialog = rfd::AsyncFileDialog::new()
        .set_title("Select Images")
        .add_filter(
            "Images",
            // HEIC/HEIF is intentionally absent: this runtime has no
            // native transcoder and the renderer cannot decode it.
            // The composer re-checks magic bytes and decoder support.
            &["jpg", "jpeg", "png", "gif", "webp", "bmp"],
        );

    let picked = if max_count > 1 {
        dialog.pick_files().await
    } else {
        dialog.pick_file().await.map(|h| vec![h])
    };

    match picked {
        Some(handles) if !handles.is_empty() => {
            // Truncate silently so the caller never has to defend against
            // the cap. Renderer trusts whatever this returns.
            let picked_paths: Vec<std::path::PathBuf> = handles
                .into_iter()
                .take(max_count)
                .map(|h| h.path().to_path_buf())
                .collect();
            // Grant the asset protocol exactly the files the user
            // picked. Sibling files in the same directory stay
            // unreadable; the renderer cannot widen this scope.
            if let Err(error) =
                super::asset_preview::allow_selected_file_previews(&window, &picked_paths)
            {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("grant selected social image preview: {error}"),
                    None,
                );
            }
            let mut paths: Vec<String> = picked_paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            paths.sort();
            tracing::info!(count = paths.len(), "Image picker returned");
            // We pass the paths via JSON in `status` to keep the
            // existing `StubPayload` envelope. The TS layer parses it
            // back into `string[]`.
            let body = serde_json::to_string(&paths).unwrap_or_else(|_| "[]".to_string());
            AppResult::success(StubPayload {
                command: "oss_pick_image_social".to_string(),
                status: body,
            })
        }
        _ => {
            tracing::debug!("Image picker cancelled by user");
            AppResult::fail(ErrorCode::InvalidArgument, "No image selected", None)
        }
    }
}

#[tauri::command]
pub fn oss_upload_attachment_social(
    input: OssUploadAttachmentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.file_path.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "file_path is required", None);
    }
    // Moments uploads are public-readable images, never chat-scoped.
    // Bucket override from the renderer is honoured for forward-compat
    // (e.g. future "drafts" bucket); falls back to the canonical
    // "moments" bucket so the OSS subserver applies the right quota
    // class. `visibility` is fixed to "public" — Moments posts are by
    // definition shareable links.
    let bucket = if input.bucket.trim().is_empty() {
        "moments"
    } else {
        input.bucket.trim()
    };
    application_oss::upload_attachment(
        state.station.resources(),
        &input.file_path,
        &token,
        "social",
        bucket,
        "public",
        None,
    )
}

#[tauri::command]
pub fn oss_upload_attachment_social_bytes(
    input: OssUploadAttachmentSocialBytesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.bytes.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "bytes is required", None);
    }
    let filename = safe_temp_filename(input.filename.as_str());
    if filename.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "filename is required", None);
    }
    // Downsampled images are re-encoded in the renderer; the temp file only
    // bridges bytes into the same social upload path used for picked paths.
    let temp_path =
        std::env::temp_dir().join(format!("peers-social-{}-{filename}", Ulid::new()));
    if let Err(error) = std::fs::write(&temp_path, input.bytes) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("write temp social attachment: {error}"),
            None,
        );
    }
    let cleanup = application_oss::TempFileCleanup::new(temp_path.clone(), "social byte attachment");

    let bucket = if input.bucket.trim().is_empty() {
        "moments"
    } else {
        input.bucket.trim()
    };
    let mime_override = input.mime_type.trim();
    let result = application_oss::upload_attachment_with_mime(
        state.station.resources(),
        temp_path.to_string_lossy().as_ref(),
        &token,
        "social",
        bucket,
        "public",
        None,
        if mime_override.is_empty() {
            None
        } else {
            Some(mime_override)
        },
    );
    cleanup.remove_now();
    result
}

// ── Generic ────────────────────────────────────────────────────────

#[tauri::command]
pub fn oss_resolve_url(
    input: OssResolveUrlInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    // Token is optional for the local public-file case but required
    // for federated GETs against foreign origins. We resolve it
    // best-effort and let the application layer decide whether the
    // current request actually needs it.
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    application_oss::oss_resolve_url(
        state.station.resources(),
        &input.uri,
        &token,
        &input.actor_ptid,
    )
}

#[tauri::command]
pub fn oss_list_my_files(
    input: OssListMyFilesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = application_oss::ListMyFilesQuery {
        bucket: input.bucket,
        visibility: input.visibility,
        mime: input.mime,
        include_deleted: input.include_deleted,
        page: input.page,
        page_size: input.page_size,
    };
    application_oss::oss_list_my_files(state.station.client(), &token, &query)
}

#[tauri::command]
pub fn oss_delete_file(
    input: OssKeyInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    application_oss::oss_delete_file(state.station.client(), &token, &input.key)
}

#[tauri::command]
pub fn oss_restore_file(
    input: OssKeyInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    application_oss::oss_restore_file(state.station.client(), &token, &input.key)
}

#[tauri::command]
pub fn oss_patch_file(
    input: OssPatchFileInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = application_oss::PatchFileBody {
        visibility: input.visibility,
        chat_session_id: input.chat_session_id,
        bucket: input.bucket,
        filename: input.filename,
        expires_at: input.expires_at,
        clear_expires_at: input.clear_expires_at,
    };
    application_oss::oss_patch_file(state.station.client(), &token, &input.key, &body)
}

#[tauri::command]
pub fn oss_invalidate_cache(
    input: OssInvalidateCacheInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    application_oss::oss_invalidate_cache(state.station.client(), &input.uri)
}
