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
}

#[derive(Debug, Deserialize)]
pub struct OssResolveUrlInput {
    /// Either a full `oss://{host}/{key}` URI or a bare key for the
    /// caller's bound station.
    pub uri: String,
}

fn require_token(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
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
    application_oss::chat_upload_attachment(&input.file_path, &token)
}

#[tauri::command]
pub fn oss_resolve_url(input: OssResolveUrlInput) -> AppResult<StubPayload> {
    application_oss::oss_resolve_url(&input.uri)
}
