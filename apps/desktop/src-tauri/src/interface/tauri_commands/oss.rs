//! Tauri command layer: chat attachment upload + OSS URI resolution.
//!
//! Exposed surface:
//!
//! * `pick_chat_attachment` — opens the native file picker (no MIME
//!   restriction) and returns the absolute path of the selected file.
//!   Mirrors `pick_image_file` but allows arbitrary documents.
//!
//! * `chat_upload_attachment` — pushes a local file to the bound
//!   Station's OSS subserver and returns a `ChatAttachmentUploaded`
//!   payload. The frontend embeds the returned `cid` in the friend or
//!   group message attachment.
//!
//! * `oss_resolve_url` — given a stored `cid` (federated URI or bare
//!   key), returns the local cached path and an absolute fallback URL
//!   so the renderer can display the attachment.
//!
//! See `application::oss` for the pure logic and `infrastructure::oss_cache`
//! for capability/file caching.

use std::sync::Arc;

use serde::Deserialize;
use tauri::{State, Window};

use crate::application::oss as application_oss;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ChatUploadAttachmentInput {
    pub file_path: String,
    pub bucket: String,
    pub visibility: String,
    pub chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OssResolveUrlInput {
    /// Either a full `oss://{host}/{key}` URI or a bare key for the
    /// caller's bound station.
    pub uri: String,
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

#[tauri::command]
pub async fn pick_chat_attachment(window: Window) -> AppResult<StubPayload> {
    let _ = window;
    tracing::info!("Opening file picker dialog for chat attachment");
    let dialog = rfd::AsyncFileDialog::new().set_title("Select File");
    match dialog.pick_file().await {
        Some(handle) => {
            let path_str = handle.path().to_string_lossy().to_string();
            tracing::info!(path = %path_str, "Chat attachment selected");
            AppResult::success(StubPayload {
                command: "pick_chat_attachment".to_string(),
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
pub fn chat_upload_attachment(
    input: ChatUploadAttachmentInput,
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
    if input.bucket.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "bucket is required", None);
    }
    let vis = input.visibility.trim().to_ascii_lowercase();
    if vis != "public" && vis != "chat" && vis != "private" {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "visibility must be one of: public, chat, private",
            None,
        );
    }
    if vis == "chat" {
        let sid = input
            .chat_session_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if sid.is_none() {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "chat_session_id is required when visibility is chat",
                None,
            );
        }
    }
    let chat_sid = if vis == "chat" {
        input
            .chat_session_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    application_oss::chat_upload_attachment(
        &input.file_path,
        &token,
        input.bucket.trim(),
        vis.as_str(),
        chat_sid,
    )
}

#[tauri::command]
pub fn oss_resolve_url(input: OssResolveUrlInput) -> AppResult<StubPayload> {
    application_oss::oss_resolve_url(&input.uri)
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
    application_oss::oss_list_my_files(&token, &query)
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
    application_oss::oss_delete_file(&token, &input.key)
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
    application_oss::oss_restore_file(&token, &input.key)
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
    application_oss::oss_patch_file(&token, &input.key, &body)
}

#[tauri::command]
pub fn oss_invalidate_cache(input: OssInvalidateCacheInput) -> AppResult<StubPayload> {
    application_oss::oss_invalidate_cache(&input.uri)
}
