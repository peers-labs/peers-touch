//! Tauri command layer for OSS attachment workflows.
//!
//! Naming convention — `oss_<verb>_<consumer>` (主模块_动作_消费方):
//! the OSS subserver is the cohesive home for these commands; the
//! suffix advertises which feature module consumes the command at a
//! glance.
//!
//! Exposed surface (P3, 2026-04-29):
//!
//! ## Chat consumer
//! * `oss_pick_attachment_chat` — opens the native file picker (no MIME
//!   restriction) and returns the absolute path of the selected file.
//! * `oss_upload_attachment_chat` — pushes a local file to the bound
//!   Station's OSS subserver and returns the canonical attachment
//!   payload. The frontend embeds the returned `cid` in the friend or
//!   group `MessageAttachment.cid`.
//!
//! ## Social consumer (Moments)
//! * `oss_pick_image_social` — picker scoped to image MIME types,
//!   supports multi-select up to a caller-supplied cap (Moments uses
//!   9). Returns the absolute paths.
//! * `oss_upload_attachment_social` — same wire as the chat variant;
//!   kept separate so we can evolve quotas / log labels per consumer
//!   without coupling the two domains.
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

use serde::Deserialize;
use tauri::{State, Window};

use crate::application::oss as application_oss;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct OssUploadAttachmentInput {
    pub file_path: String,
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

// ── Chat consumer ──────────────────────────────────────────────────

#[tauri::command]
pub async fn oss_pick_attachment_chat(window: Window) -> AppResult<StubPayload> {
    let _ = window;
    tracing::info!("Opening file picker dialog for chat attachment");
    let dialog = rfd::AsyncFileDialog::new().set_title("Select File");
    match dialog.pick_file().await {
        Some(handle) => {
            let path_str = handle.path().to_string_lossy().to_string();
            tracing::info!(path = %path_str, "Chat attachment selected");
            AppResult::success(StubPayload {
                command: "oss_pick_attachment_chat".to_string(),
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
pub fn oss_upload_attachment_chat(
    input: OssUploadAttachmentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    application_oss::upload_attachment(&input.file_path, &token, "chat")
}

// ── Social consumer (Moments) ──────────────────────────────────────

#[tauri::command]
pub async fn oss_pick_image_social(
    input: OssPickImageSocialInput,
    window: Window,
) -> AppResult<StubPayload> {
    let _ = window;
    let max_count = if input.max_count == 0 { 1 } else { input.max_count } as usize;
    tracing::info!(max_count, "Opening image picker dialog for Moments");
    let dialog = rfd::AsyncFileDialog::new()
        .set_title("Select Images")
        .add_filter("Images", &["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"]);

    let picked = if max_count > 1 {
        dialog.pick_files().await
    } else {
        dialog.pick_file().await.map(|h| vec![h])
    };

    match picked {
        Some(handles) if !handles.is_empty() => {
            // Truncate silently so the caller never has to defend against
            // the cap. Renderer trusts whatever this returns.
            let mut paths: Vec<String> = handles
                .into_iter()
                .take(max_count)
                .map(|h| h.path().to_string_lossy().to_string())
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
    application_oss::upload_attachment(&input.file_path, &token, "social")
}

// ── Generic ────────────────────────────────────────────────────────

#[tauri::command]
pub fn oss_resolve_url(input: OssResolveUrlInput) -> AppResult<StubPayload> {
    application_oss::oss_resolve_url(&input.uri)
}
