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
//! * `oss_upload_attachment_bytes_chat` — writes pasted / recorded
//!   renderer bytes to a scoped temp file, preserving the renderer MIME
//!   type before uploading through the same chat attachment path.
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

use std::io::{Read, Write};
use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{State, Window};
use ulid::Ulid;

use crate::application::oss as application_oss;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

const MEDIA_CHUNK_SIZE: usize = 1024 * 1024;
const MEDIA_GCM_TAG_SIZE: usize = 16;
const MEDIA_CHUNKING_FIXED_V1: &str = "fixed-v1";
const MEDIA_NONCE_STRATEGY_COUNTER32_BE: &str = "prefix-counter32-be";

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
    #[serde(default)]
    pub bucket: String,
    #[serde(default)]
    pub visibility: String,
    #[serde(default)]
    pub chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OssCaptureScreenshotInput {
    #[serde(default)]
    pub bucket: String,
    #[serde(default)]
    pub visibility: String,
    #[serde(default)]
    pub chat_session_id: Option<String>,
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
    pub actor_did: String,
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

pub(crate) fn validate_chat_upload_scope<'a>(
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

fn media_chunk_nonce(base_nonce: &[u8; 12], chunk_index: u32) -> [u8; 12] {
    let mut nonce = *base_nonce;
    nonce[8..12].copy_from_slice(&chunk_index.to_be_bytes());
    nonce
}

fn media_chunk_aad(chunk_index: u32, plaintext_size: u64, chunk_size: usize) -> Vec<u8> {
    format!("peers-touch-media:v2:{chunk_index}:{plaintext_size}:{chunk_size}").into_bytes()
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
    if input.file_path.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "file_path is required", None);
    }
    let vis = input.visibility.trim().to_ascii_lowercase();
    let (bucket, visibility, chat_sid) = match validate_chat_upload_scope(
        input.bucket.as_str(),
        vis.as_str(),
        &input.chat_session_id,
    ) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    application_oss::upload_attachment(
        &input.file_path,
        &token,
        "chat",
        bucket,
        visibility,
        chat_sid,
    )
}

#[tauri::command]
pub fn oss_upload_attachment_bytes_chat(
    input: OssUploadAttachmentBytesInput,
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
    let vis = input.visibility.trim().to_ascii_lowercase();
    let (bucket, visibility, chat_sid) = match validate_chat_upload_scope(
        input.bucket.as_str(),
        vis.as_str(),
        &input.chat_session_id,
    ) {
        Ok(scope) => scope,
        Err(error) => return error,
    };

    let filename = safe_temp_filename(input.filename.as_str());
    let temp_path = std::env::temp_dir().join(format!("peers-chat-{}-{}", Ulid::new(), filename));
    if let Err(error) = std::fs::write(&temp_path, input.bytes) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("write temp chat attachment: {error}"),
            None,
        );
    }
    let cleanup = application_oss::TempFileCleanup::new(temp_path.clone(), "chat attachment");

    let mime_override = input.mime_type.trim();
    let result = application_oss::upload_attachment_with_mime(
        temp_path.to_string_lossy().as_ref(),
        &token,
        "chat",
        bucket,
        visibility,
        chat_sid,
        if mime_override.is_empty() {
            None
        } else {
            Some(mime_override)
        },
    );
    cleanup.remove_now();
    result
}

#[cfg(target_os = "macos")]
pub(crate) fn capture_screenshot_to_temp_file() -> Result<std::path::PathBuf, AppResult<StubPayload>>
{
    let path = std::env::temp_dir().join(format!("peers-chat-screenshot-{}.png", Ulid::new()));
    let status = std::process::Command::new("screencapture")
        .arg("-i")
        .arg("-x")
        .arg(&path)
        .status()
        .map_err(|error| {
            AppResult::fail(
                ErrorCode::InternalError,
                format!("start screenshot tool: {error}"),
                None,
            )
        })?;

    if !status.success() {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "screenshot cancelled",
            None,
        ));
    }

    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() > 0 => Ok(path),
        _ => Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "screenshot cancelled",
            None,
        )),
    }
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

#[tauri::command]
pub fn oss_capture_screenshot_chat(
    input: OssCaptureScreenshotInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let vis = input.visibility.trim().to_ascii_lowercase();
    let (bucket, visibility, chat_sid) = match validate_chat_upload_scope(
        input.bucket.as_str(),
        vis.as_str(),
        &input.chat_session_id,
    ) {
        Ok(scope) => scope,
        Err(error) => return error,
    };

    let path = match capture_screenshot_to_temp_file() {
        Ok(path) => path,
        Err(error) => return error,
    };
    let cleanup = application_oss::TempFileCleanup::new(path.clone(), "chat screenshot");

    let result = application_oss::upload_attachment_with_mime(
        path.to_string_lossy().as_ref(),
        &token,
        "chat",
        bucket,
        visibility,
        chat_sid,
        Some("image/png"),
    );
    cleanup.remove_now();
    result
}

// ── Social consumer (Moments) ──────────────────────────────────────

#[tauri::command]
pub async fn oss_pick_image_social(
    input: OssPickImageSocialInput,
    window: Window,
) -> AppResult<StubPayload> {
    let _ = window;
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
            &["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"],
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
    application_oss::upload_attachment(&input.file_path, &token, "social", bucket, "public", None)
}

fn upload_encrypted_attachment(
    input: OssUploadAttachmentInput,
    token: &str,
    consumer: &str,
    bucket: &str,
    visibility: &str,
    chat_sid: Option<&str>,
    fallback_name: &str,
    command: &str,
) -> AppResult<StubPayload> {
    if input.file_path.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "file_path is required", None);
    }

    let plaintext_size = match std::fs::metadata(&input.file_path) {
        Ok(meta) if meta.len() > 0 => meta.len(),
        Ok(_) => return AppResult::fail(ErrorCode::InvalidArgument, "file is empty", None),
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("stat encrypted attachment: {error}"),
                None,
            )
        }
    };
    let chunk_count_u64 = plaintext_size.div_ceil(MEDIA_CHUNK_SIZE as u64);
    if chunk_count_u64 > u32::MAX as u64 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "file exceeds encrypted media chunk index capacity",
            None,
        );
    }
    let chunk_count = chunk_count_u64 as u32;

    let mut key = [0u8; 32];
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut key);
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce[8..12].fill(0);
    let cipher = match Aes256Gcm::new_from_slice(&key) {
        Ok(cipher) => cipher,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("initialise media cipher: {error:?}"),
                None,
            )
        }
    };

    let original_name = std::path::Path::new(&input.file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback_name)
        .to_string();
    let safe_name = safe_temp_filename(&original_name);
    let temp_path = std::env::temp_dir().join(format!(
        "peers-{consumer}-enc-{}-{}",
        Ulid::new(),
        safe_name
    ));

    let mut input_file = match std::fs::File::open(&input.file_path) {
        Ok(file) => file,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("open encrypted attachment: {error}"),
                None,
            )
        }
    };
    let mut output_file = match std::fs::File::create(&temp_path) {
        Ok(file) => file,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("create encrypted attachment: {error}"),
                None,
            )
        }
    };
    let cleanup = application_oss::TempFileCleanup::new(temp_path.clone(), "encrypted attachment");

    let mut plaintext_hasher = Sha256::new();
    let mut ciphertext_hasher = Sha256::new();
    let mut ciphertext_size: u64 = 0;
    let mut buffer = vec![0u8; MEDIA_CHUNK_SIZE];
    for chunk_index in 0..chunk_count {
        let read = match input_file.read(&mut buffer) {
            Ok(n) if n > 0 => n,
            Ok(_) => break,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("read encrypted attachment chunk: {error}"),
                    None,
                )
            }
        };
        let plaintext_chunk = &buffer[..read];
        plaintext_hasher.update(plaintext_chunk);
        let chunk_nonce = media_chunk_nonce(&nonce, chunk_index);
        let aad = media_chunk_aad(chunk_index, plaintext_size, MEDIA_CHUNK_SIZE);
        let ciphertext_chunk = match cipher.encrypt(
            Nonce::from_slice(&chunk_nonce),
            Payload {
                msg: plaintext_chunk,
                aad: aad.as_slice(),
            },
        ) {
            Ok(bytes) => bytes,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("encrypt attachment chunk: {error:?}"),
                    None,
                )
            }
        };
        ciphertext_hasher.update(&ciphertext_chunk);
        ciphertext_size += ciphertext_chunk.len() as u64;
        if let Err(error) = output_file.write_all(&ciphertext_chunk) {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("write encrypted attachment chunk: {error}"),
                None,
            );
        }
    }
    if let Err(error) = output_file.flush() {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("flush encrypted attachment: {error}"),
            None,
        );
    }

    let plaintext_sha = B64.encode(plaintext_hasher.finalize());
    let ciphertext_sha = B64.encode(ciphertext_hasher.finalize());

    let upload = application_oss::upload_attachment_with_mime(
        temp_path.to_string_lossy().as_ref(),
        token,
        consumer,
        bucket,
        visibility,
        chat_sid,
        Some("application/octet-stream"),
    );
    cleanup.remove_now();
    if !upload.ok {
        return upload;
    }

    let mut payload = match upload
        .data
        .as_ref()
        .and_then(|data| serde_json::from_str::<serde_json::Value>(&data.status).ok())
    {
        Some(serde_json::Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    payload.insert(
        "filename".to_string(),
        serde_json::Value::String(original_name),
    );
    payload.insert(
        "mime_type".to_string(),
        serde_json::Value::String("application/octet-stream".to_string()),
    );
    payload.insert(
        "media_encryption".to_string(),
        serde_json::json!({
            "encrypted": true,
            "version": 2,
            "suite": "AES-256-GCM-CHUNKED",
            "key_b64": B64.encode(key),
            "nonce_b64": B64.encode(nonce),
            "plaintext_sha256_b64": plaintext_sha,
            "ciphertext_sha256_b64": ciphertext_sha,
            "plaintext_size": plaintext_size,
            "ciphertext_size": ciphertext_size,
            "chunking": MEDIA_CHUNKING_FIXED_V1,
            "chunk_size": MEDIA_CHUNK_SIZE,
            "chunk_count": chunk_count,
            "tag_size": MEDIA_GCM_TAG_SIZE,
            "nonce_strategy": MEDIA_NONCE_STRATEGY_COUNTER32_BE
        }),
    );
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: serde_json::Value::Object(payload).to_string(),
    })
}

#[tauri::command]
pub fn oss_upload_encrypted_attachment_chat(
    input: OssUploadAttachmentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match require_token(state.inner(), &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let vis = input.visibility.trim().to_ascii_lowercase();
    let (bucket, visibility, chat_sid) = match validate_chat_upload_scope(
        input.bucket.as_str(),
        vis.as_str(),
        &input.chat_session_id,
    ) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let bucket = bucket.to_string();
    let visibility = visibility.to_string();
    let chat_sid = chat_sid.map(str::to_string);
    upload_encrypted_attachment(
        input,
        &token,
        "chat",
        bucket.as_str(),
        visibility.as_str(),
        chat_sid.as_deref(),
        "attachment.bin",
        "oss_upload_encrypted_attachment_chat",
    )
}

#[tauri::command]
pub fn oss_upload_encrypted_attachment_social(
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

    let plaintext_size = match std::fs::metadata(&input.file_path) {
        Ok(meta) if meta.len() > 0 => meta.len(),
        Ok(_) => return AppResult::fail(ErrorCode::InvalidArgument, "file is empty", None),
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("stat social attachment: {error}"),
                None,
            )
        }
    };
    let chunk_count_u64 = plaintext_size.div_ceil(MEDIA_CHUNK_SIZE as u64);
    if chunk_count_u64 > u32::MAX as u64 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "file exceeds encrypted media chunk index capacity",
            None,
        );
    }
    let chunk_count = chunk_count_u64 as u32;

    let mut key = [0u8; 32];
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut key);
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce[8..12].fill(0);
    let cipher = match Aes256Gcm::new_from_slice(&key) {
        Ok(cipher) => cipher,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("initialise social media cipher: {error:?}"),
                None,
            )
        }
    };
    let original_name = std::path::Path::new(&input.file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("moment-image.bin")
        .to_string();
    let safe_name = safe_temp_filename(&original_name);
    let temp_path =
        std::env::temp_dir().join(format!("peers-social-enc-{}-{}", Ulid::new(), safe_name));
    let mut input_file = match std::fs::File::open(&input.file_path) {
        Ok(file) => file,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("open social attachment: {error}"),
                None,
            )
        }
    };
    let mut output_file = match std::fs::File::create(&temp_path) {
        Ok(file) => file,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("create encrypted social attachment: {error}"),
                None,
            )
        }
    };
    let cleanup = application_oss::TempFileCleanup::new(temp_path.clone(), "encrypted social attachment");
    let mut plaintext_hasher = Sha256::new();
    let mut ciphertext_hasher = Sha256::new();
    let mut ciphertext_size: u64 = 0;
    let mut buffer = vec![0u8; MEDIA_CHUNK_SIZE];
    for chunk_index in 0..chunk_count {
        let read = match input_file.read(&mut buffer) {
            Ok(n) if n > 0 => n,
            Ok(_) => break,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("read social attachment chunk: {error}"),
                    None,
                )
            }
        };
        let plaintext_chunk = &buffer[..read];
        plaintext_hasher.update(plaintext_chunk);
        let chunk_nonce = media_chunk_nonce(&nonce, chunk_index);
        let aad = media_chunk_aad(chunk_index, plaintext_size, MEDIA_CHUNK_SIZE);
        let ciphertext_chunk = match cipher.encrypt(
            Nonce::from_slice(&chunk_nonce),
            Payload {
                msg: plaintext_chunk,
                aad: aad.as_slice(),
            },
        ) {
            Ok(bytes) => bytes,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("encrypt social attachment chunk: {error:?}"),
                    None,
                )
            }
        };
        ciphertext_hasher.update(&ciphertext_chunk);
        ciphertext_size += ciphertext_chunk.len() as u64;
        if let Err(error) = output_file.write_all(&ciphertext_chunk) {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("write encrypted social attachment chunk: {error}"),
                None,
            );
        }
    }
    if let Err(error) = output_file.flush() {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("flush encrypted social attachment: {error}"),
            None,
        );
    }

    let plaintext_sha = B64.encode(plaintext_hasher.finalize());
    let ciphertext_sha = B64.encode(ciphertext_hasher.finalize());

    let bucket = if input.bucket.trim().is_empty() {
        "moments"
    } else {
        input.bucket.trim()
    };
    let upload = application_oss::upload_attachment_with_mime(
        temp_path.to_string_lossy().as_ref(),
        &token,
        "social",
        bucket,
        "public",
        None,
        Some("application/octet-stream"),
    );
    cleanup.remove_now();
    if !upload.ok {
        return upload;
    }

    let mut payload = match upload
        .data
        .as_ref()
        .and_then(|data| serde_json::from_str::<serde_json::Value>(&data.status).ok())
    {
        Some(serde_json::Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    payload.insert(
        "filename".to_string(),
        serde_json::Value::String(original_name),
    );
    payload.insert(
        "mime_type".to_string(),
        serde_json::Value::String("application/octet-stream".to_string()),
    );
    payload.insert(
        "media_encryption".to_string(),
        serde_json::json!({
            "encrypted": true,
            "version": 2,
            "suite": "AES-256-GCM-CHUNKED",
            "key_b64": B64.encode(key),
            "nonce_b64": B64.encode(nonce),
            "plaintext_sha256_b64": plaintext_sha,
            "ciphertext_sha256_b64": ciphertext_sha,
            "plaintext_size": plaintext_size,
            "ciphertext_size": ciphertext_size,
            "chunking": MEDIA_CHUNKING_FIXED_V1,
            "chunk_size": MEDIA_CHUNK_SIZE,
            "chunk_count": chunk_count,
            "tag_size": MEDIA_GCM_TAG_SIZE,
            "nonce_strategy": MEDIA_NONCE_STRATEGY_COUNTER32_BE
        }),
    );
    AppResult::success(StubPayload {
        command: "oss_upload_encrypted_attachment_social".to_string(),
        status: serde_json::Value::Object(payload).to_string(),
    })
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
    application_oss::oss_resolve_url(&input.uri, &token, &input.actor_did)
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
