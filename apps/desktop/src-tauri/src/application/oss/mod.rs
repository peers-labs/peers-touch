// OSS application service — attachment upload & federated URI resolution.
//
// Two responsibilities, kept in this module so the Tauri layer never has
// to think about Station's wire shape:
//
//   1. `upload_attachment(file_path, token, consumer)` — pushes a local
//      file to Station via the existing `/sub-oss/upload` endpoint and
//      returns the canonical attachment payload (`cid`, `key`, `host`,
//      `mime`, `size`, `filename`). The `cid` is the federated URI
//      that should be embedded in `MessageAttachment.cid` (chat) or
//      `CreateImagePostRequest.image_ids` (Moments). Older Station
//      builds that pre-date the URI work return only `key`/`url`; we
//      synthesize a `cid` from `station_base_url` so older deployments
//      continue to function.
//      The `consumer` label is for log correlation only — the wire
//      contract is identical across modules.
//
//   2. `resolve_url(uri)` — turns a `cid` (URI form or bare key) into
//      something the renderer can display:
//        * For local-backend stations we ensure the bytes are mirrored
//          to the on-disk attachment cache and return a
//          `file://` path the WebView can load via `convertFileSrc`.
//        * For backends that require signed URLs we return the absolute
//          HTTPS endpoint and let the renderer fetch directly. The
//          caller is responsible for supplying any signing material;
//          the resolver never holds Station credentials.
//
// Both functions are deliberately blocking — Tauri commands run on a
// worker thread and our station_client helpers are blocking too.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::oss_cache::{self, OssCacheError, OssUri};
use crate::infrastructure::station_client;

/// Result returned by `upload_attachment` to the frontend. The shape
/// mirrors `MessageAttachment` / `ImageAttachment` proto fields so the
/// renderer can pass it straight into a direct message send /
/// group send / Moments createPost without further mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatAttachmentUploaded {
    /// Federated URI: `oss://{host}/{key}` — store this in the message.
    pub cid: String,
    /// Bare object key, useful for older receivers that have not yet
    /// learnt about `oss://` URIs.
    pub key: String,
    /// Externally-reachable origin advertised by the OSS subserver.
    pub host: String,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    /// Absolute URL the renderer can use to display *immediately* (no
    /// roundtrip through `oss_resolve_url`). Only set for unsigned
    /// backends; for signed backends the renderer must call
    /// `oss_resolve_url`.
    pub preview_url: Option<String>,
    /// Hex-encoded sha256 of the uploaded bytes when the Station
    /// runs the CAS strategy. Empty for `random` keying or for
    /// older Station builds that pre-date the field.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sha256: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub visibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OssResolved {
    /// Local cached file path (when the file has been mirrored to disk)
    /// or `None` when only a remote URL is available.
    pub local_path: Option<String>,
    /// Absolute URL suitable for `<img src>` / `window.open`. Always
    /// populated. For local-backend stations this points back at
    /// `host + file_endpoint`; for signed backends it carries the
    /// signed query.
    pub url: String,
    /// Inline image data for renderer previews when the local cache
    /// path cannot be served with a reliable image content type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    pub host: String,
    pub key: String,
}

const INLINE_IMAGE_MAX_BYTES: u64 = 8 * 1024 * 1024;

pub struct TempFileCleanup {
    path: PathBuf,
    label: &'static str,
    active: bool,
}

impl TempFileCleanup {
    pub fn new(path: PathBuf, label: &'static str) -> Self {
        Self {
            path,
            label,
            active: true,
        }
    }

    pub fn remove_now(mut self) {
        self.remove();
    }

    fn remove(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        if let Err(error) = std::fs::remove_file(&self.path) {
            tracing::warn!(error = %error, path = %self.path.display(), label = self.label, "Failed to remove temp file");
        }
    }
}

impl Drop for TempFileCleanup {
    fn drop(&mut self) {
        self.remove();
    }
}

/// Unified OSS upload entry point used by both the chat and Moments
/// consumers. `consumer` is a log-correlation label only ("chat",
/// "social", …); the wire contract is identical regardless. The
/// chat-scope parameters (`bucket`, `visibility`, `chat_session_id`)
/// are forwarded to the OSS subserver — Moments callers should pass
/// `bucket="moments"`, `visibility="public"`, `chat_session_id=None`.
pub fn upload_attachment(
    file_path: &str,
    token: &str,
    consumer: &str,
    bucket: &str,
    visibility: &str,
    chat_session_id: Option<&str>,
) -> AppResult<StubPayload> {
    upload_attachment_with_mime(
        file_path,
        token,
        consumer,
        bucket,
        visibility,
        chat_session_id,
        None,
    )
}

pub fn upload_attachment_with_mime(
    file_path: &str,
    token: &str,
    consumer: &str,
    bucket: &str,
    visibility: &str,
    chat_session_id: Option<&str>,
    mime_override: Option<&str>,
) -> AppResult<StubPayload> {
    if file_path.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "file_path is required", None);
    }
    tracing::info!(file_path = %file_path, consumer = %consumer, "OSS attachment upload start");

    // Capability lookup is best-effort — if it fails we still want the
    // legacy multipart path to work, which is the safe default for
    // home stations that have not yet updated to the v2 capabilities
    // shape. We probe the home station ("self") because uploads
    // *always* go to the user's own station; cross-station uploads
    // are handled at the chat layer, not here.
    let caps = oss_cache::capabilities_ensure("self").ok();

    // Pre-flight the file size so we can route per-file instead of
    // per-session. We resolve metadata via `std::fs` to avoid pulling
    // a second open later.
    let file_meta = match std::fs::metadata(file_path) {
        Ok(m) => m,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("stat {file_path}: {e}"),
                None,
            );
        }
    };
    let file_size = file_meta.len() as i64;
    let filename = std::path::Path::new(file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let mime = mime_override
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| guess_mime_from_path(file_path));

    if let Some(c) = caps.as_ref() {
        if c.supports_presigned_upload(file_size) {
            // TODO(post-merge): the presigned fast path doesn't yet
            // propagate `bucket`, `visibility`, or `chat_session_id`.
            // For chat attachments today it almost never fires — chat
            // images are typically small enough that they fall under
            // `presigned_threshold` (~5MB) and route through the
            // multipart path below. Plumbing the chat-scope fields
            // into `/sub-oss/presign-upload` is a separate
            // server+client contract change tracked outside this
            // merge.
            match upload_via_presigned(file_path, token, &filename, &mime, file_size, c) {
                Ok(payload) => {
                    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
                    return AppResult::success(StubPayload {
                        command: format!("oss_upload_attachment_{}", consumer),
                        status: body,
                    });
                }
                Err(e) => {
                    // Presigned upload is the optional fast path —
                    // any failure (network, signature drift, etc.)
                    // falls back to the multipart path so the user's
                    // upload still completes. The error is surfaced
                    // via tracing but does not break the UX.
                    tracing::warn!(error = %e, "Presigned upload failed; falling back to multipart");
                }
            }
        }
    }

    let resp = match station_client::upload_multipart(
        "/sub-oss/upload",
        token,
        file_path,
        bucket,
        visibility,
        if visibility == "chat" {
            chat_session_id
        } else {
            None
        },
    ) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, consumer = %consumer, "OSS attachment upload failed");
            return e.into_app_result("Failed to upload attachment");
        }
    };

    let key = resp
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if key.is_empty() {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Upload succeeded but storage returned no key",
            None,
        );
    }
    let host = resp
        .get("host")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| station_client::station_base_url());
    let cid = resp
        .get("cid")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("oss://{}/{}", host.trim_end_matches('/'), key));
    let url_rel = resp
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let preview_url = if url_rel.starts_with('/') {
        Some(format!("{}{}", host.trim_end_matches('/'), url_rel))
    } else if url_rel.is_empty() {
        None
    } else {
        Some(url_rel)
    };

    let payload = ChatAttachmentUploaded {
        cid,
        key,
        host,
        filename: resp
            .get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        mime_type: resp
            .get("mime")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        size: resp.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
        preview_url,
        sha256: resp
            .get("sha256")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        visibility: resp
            .get("visibility")
            .and_then(|v| v.as_str())
            .unwrap_or(visibility)
            .to_string(),
    };

    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    AppResult::success(StubPayload {
        command: format!("oss_upload_attachment_{}", consumer),
        status: body,
    })
}

/// Resolve an OSS URI into renderer-displayable form.
///
/// Decision tree:
///
/// ```text
///   uri.origin == bound_station OR origin in {"", "self"}
///       → local flow (existing capabilities + bound-station fetch)
///
///   uri.origin != bound_station
///       AND home token + actor DID supplied
///       → federation flow:
///           1. mint peer JWT at bound station
///           2. GET bytes from foreign station with that JWT
///           3. cache by (foreign_origin, key)
///       Failure (denied / disabled) → renderer sees broken-link
///       state via FederationDenied / FederationDisabled.
///
///   uri.origin != bound_station AND no token
///       → return absolute URL only; cache lookup may still succeed
///         from a previous federated fetch.
/// ```
///
/// `home_token` is the desktop user's HS256 session JWT for the
/// bound station; `home_actor_did` is the same caller's DID. Both
/// are required for federation; either being empty downgrades the
/// resolve to a no-token best-effort.
pub fn oss_resolve_url(
    input: &str,
    home_token: &str,
    home_actor_did: &str,
) -> AppResult<StubPayload> {
    let uri = match OssUri::parse(input) {
        Ok(u) => u,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid oss uri: {e}"),
                None,
            );
        }
    };

    let bound_station = oss_cache::is_bound_station(&uri.origin);
    let caps = match oss_cache::capabilities_ensure(&uri.origin) {
        Ok(c) => c,
        Err(e) => return resolve_error(e),
    };

    // Build the canonical absolute URL once; we always return it so
    // that even if the local mirror fails, the renderer has a
    // network-fetch option.
    let url = format!(
        "{}{}?key={}",
        caps.host.trim_end_matches('/'),
        if caps.file_endpoint.is_empty() {
            "/sub-oss/file"
        } else {
            caps.file_endpoint.as_str()
        },
        urlencode(&uri.key),
    );

    // For backends that should not be mirrored locally (signed URLs,
    // S3-protocol stores) the absolute URL is the authoritative
    // address. The Station's `/sub-oss/file` 302-redirects to the
    // underlying bucket so the renderer is offloaded transparently;
    // caching bytes again locally would just waste disk.
    if caps.skip_local_mirror() {
        return success(OssResolved {
            local_path: None,
            url,
            data_url: None,
            host: caps.host,
            key: uri.key,
        });
    }

    // Best-effort cache to disk. Errors do not break the response —
    // the renderer can still show the file via the absolute URL.
    // Federation failures are mapped explicitly so the UI can
    // distinguish "couldn't reach the network" from "denied by
    // policy" (the badge component renders different states).
    let local_path = if bound_station {
        match oss_cache::attachment_ensure(&uri, None) {
            Ok(p) => Some(p.to_string_lossy().to_string()),
            Err(err) => {
                tracing::warn!(error = %err, uri = %input, "OSS attachment cache miss (local)");
                None
            }
        }
    } else if !home_token.trim().is_empty() && !home_actor_did.trim().is_empty() {
        match oss_cache::attachment_ensure_federated(&uri, home_token, home_actor_did) {
            Ok(p) => Some(p.to_string_lossy().to_string()),
            Err(err) => {
                tracing::warn!(error = %err, uri = %input, "OSS attachment cache miss (federated)");
                None
            }
        }
    } else {
        // Foreign origin without auth — we cannot mint, so don't
        // attempt the foreign GET (which would 401 anyway). Surface
        // the cache lookup so a previously-federated file still
        // renders without re-minting.
        oss_cache::attachment_lookup(&uri).map(|p| p.to_string_lossy().to_string())
    };

    success(OssResolved {
        data_url: local_path.as_deref().and_then(data_url_for_cached_image),
        local_path,
        url,
        host: caps.host,
        key: uri.key,
    })
}

fn data_url_for_cached_image(path: &str) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > INLINE_IMAGE_MAX_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let mime = image_mime_from_bytes(&bytes)?;
    Some(format!("data:{};base64,{}", mime, B64.encode(bytes)))
}

fn image_mime_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    None
}

fn success(payload: OssResolved) -> AppResult<StubPayload> {
    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    AppResult::success(StubPayload {
        command: "oss_resolve_url".to_string(),
        status: body,
    })
}

fn resolve_error(err: OssCacheError) -> AppResult<StubPayload> {
    let (code, prefix) = match &err {
        OssCacheError::FederationDenied(_) => (ErrorCode::Forbidden, "oss federation denied"),
        OssCacheError::FederationDisabled(_) => {
            (ErrorCode::NotImplemented, "oss federation disabled")
        }
        OssCacheError::FederationAuthRequired => (ErrorCode::Unauthorized, "oss federation auth"),
        OssCacheError::InvalidUri(_) => (ErrorCode::InvalidArgument, "oss invalid uri"),
        _ => (ErrorCode::InternalError, "oss resolve failed"),
    };
    AppResult::fail(code, format!("{prefix}: {err}"), None)
}

/// Drive the three-step presigned upload data path:
///   1. SHA-256 the file (CAS contract — required by the server when
///      `key_strategy = cas`; harmless when `random` because the
///      Station ignores the field).
///   2. POST `/sub-oss/presign-upload` with size + sha256. Server
///      either returns a CAS dedup hit (no PUT needed) or a
///      pre-signed URL bound to the bytes we are about to send.
///   3. PUT the file to the returned URL with the headers the server
///      told us to echo (notably `x-amz-checksum-sha256`).
///   4. POST `/sub-oss/upload-complete` so the Station registers a
///      `FileMeta` row and returns the canonical `cid`/`host`.
///
/// Any failure short-circuits the whole sequence — we do not partial-
/// commit. The caller is responsible for falling back to multipart
/// when this returns `Err`.
fn upload_via_presigned(
    file_path: &str,
    token: &str,
    filename: &str,
    mime: &str,
    size: i64,
    caps: &oss_cache::OssCapabilities,
) -> Result<ChatAttachmentUploaded, String> {
    let sha = sha256_file_hex(file_path).map_err(|e| format!("sha256: {e}"))?;
    let endpoints = caps
        .presigned_endpoints
        .as_ref()
        .ok_or_else(|| "presigned endpoints missing from capabilities".to_string())?;

    // Step 1 — open the session.
    let presign_resp = station_client::request_json(
        Method::POST,
        &endpoints.presign,
        token,
        None,
        Some(serde_json::json!({
            "filename": filename,
            "mime": mime,
            "size": size,
            "sha256": sha,
        })),
    )
    .map_err(|e| format!("presign-upload: {e}"))?;

    let already = presign_resp
        .get("already_uploaded")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if already {
        // CAS dedup hit — bytes are already on the Station, no PUT
        // necessary. The server returned the canonical `cid`/`host`
        // so we just shape it into our wire payload and return.
        return Ok(presign_response_to_payload(&presign_resp, sha, caps));
    }

    let url = presign_resp
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "presign response missing url".to_string())?;

    let mut headers: HashMap<String, String> = HashMap::new();
    if let Some(obj) = presign_resp.get("headers").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                headers.insert(k.clone(), s.to_string());
            }
        }
    }

    // Step 2 — direct PUT to the storage endpoint.
    station_client::put_presigned_url(url, &headers, file_path)
        .map_err(|e| format!("presigned put: {e}"))?;

    // Step 3 — register the row.
    let key = presign_resp
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "presign response missing key".to_string())?;
    let complete_resp = station_client::request_json(
        Method::POST,
        &endpoints.complete,
        token,
        None,
        Some(serde_json::json!({
            "key": key,
            "filename": filename,
            "mime": mime,
            "size": size,
            "sha256": sha,
        })),
    )
    .map_err(|e| format!("upload-complete: {e}"))?;

    Ok(complete_response_to_payload(&complete_resp, sha, caps))
}

fn presign_response_to_payload(
    resp: &serde_json::Value,
    sha: String,
    caps: &oss_cache::OssCapabilities,
) -> ChatAttachmentUploaded {
    // CAS dedup short-circuit: we never PUT, and the Station
    // returned the existing meta fields directly on the presign
    // response.
    let key = resp
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let host = resp
        .get("host")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| caps.host.clone());
    let cid = resp
        .get("cid")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("oss://{}/{}", host.trim_end_matches('/'), key));

    ChatAttachmentUploaded {
        cid,
        key,
        host,
        filename: resp
            .get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        mime_type: resp
            .get("mime")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        size: resp.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
        // Presigned + S3 path: bytes live in the bucket, the
        // Station 302-redirects on GET. We do not synthesise a
        // local preview URL because the renderer's `oss_resolve_url`
        // pass will follow the 302 itself.
        preview_url: None,
        sha256: resp
            .get("sha256")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or(sha),
        // Presigned dedup hits don't carry a visibility echo today
        // (see TODO above on `chat_upload_attachment`). Empty string
        // here means "trust the server-side default for the bucket"
        // — the renderer side branches on `visibility.is_empty()`.
        visibility: resp
            .get("visibility")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default(),
    }
}

fn complete_response_to_payload(
    resp: &serde_json::Value,
    sha: String,
    caps: &oss_cache::OssCapabilities,
) -> ChatAttachmentUploaded {
    let key = resp
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let host = resp
        .get("host")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| caps.host.clone());
    let cid = resp
        .get("cid")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("oss://{}/{}", host.trim_end_matches('/'), key));
    ChatAttachmentUploaded {
        cid,
        key,
        host,
        filename: resp
            .get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        mime_type: resp
            .get("mime")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        size: resp.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
        preview_url: None,
        sha256: resp
            .get("sha256")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or(sha),
        visibility: resp
            .get("visibility")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default(),
    }
}

/// Stream-hash the file in 64 KiB blocks. We deliberately do not
/// `mmap` because the station-bound file may live on networked
/// storage where the kernel's read-ahead path is faster + safer
/// than a mapping that can SIGBUS on truncation.
fn sha256_file_hex(path: &str) -> Result<String, std::io::Error> {
    let f = File::open(path)?;
    let mut reader = BufReader::with_capacity(64 * 1024, f);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Best-effort MIME guess from the file extension. Mirrors the
/// `getMimeTypeByExtension` table on the Station — keeping the two
/// in sync is intentional so the UI shows the same icon whether the
/// file came back via multipart or presigned upload.
fn guess_mime_from_path(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "xml" => "application/xml",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' => out.push(ch),
            other => {
                let mut buf = [0u8; 4];
                for byte in other.encode_utf8(&mut buf).as_bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// User-owned file lifecycle (S16)
//
// These wrappers call the v3 lifecycle endpoints on the bound Station
// and return the raw JSON envelope verbatim — the renderer wants the
// full server shape (incl. server-timestamps) and re-typing it on the
// Rust side would be lossy without buying us much.
//
// Every mutation also calls `attachment_invalidate` so the on-disk
// cache cannot resurrect bytes the server has just retired or
// re-classified. The invalidation is best-effort: a missing cache
// file is not an error, and a filesystem failure (rare) is logged
// but does not fail the IPC call — the server-side state is the
// source of truth and will re-issue 403 / 410 on next fetch.
// ---------------------------------------------------------------------------

/// Filter envelope for `oss_list_my_files`. All fields are
/// optional; the empty `Default` corresponds to "first page,
/// default page-size, no predicates, exclude tombstones", which
/// matches the server's defaults verbatim.
#[derive(Debug, Default, Deserialize, Serialize)]
pub struct ListMyFilesQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bucket: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    /// Server uses `LIKE '<prefix>%'` after escaping LIKE
    /// metacharacters; pass plain prefixes like "image/".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(default)]
    pub include_deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<i32>,
}

/// PATCH envelope. Each field is double-optional in JSON terms:
///
///   - `Option::None` → not sent (server leaves the column alone).
///   - `Some(value)` → sent, server applies the new value.
///
/// `expires_at` requires extra care: a `null` body field means
/// "clear the column", which is distinct from "leave alone". The
/// `clear_expires_at` boolean explicitly carries that intent and is
/// translated to a JSON `null` on the wire.
#[derive(Debug, Default, Deserialize, Serialize)]
pub struct PatchFileBody {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bucket: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub clear_expires_at: bool,
}

pub fn oss_list_my_files(token: &str, query: &ListMyFilesQuery) -> AppResult<StubPayload> {
    let mut params: Vec<(&str, String)> = Vec::new();
    if let Some(v) = query.bucket.as_ref().filter(|s| !s.trim().is_empty()) {
        params.push(("bucket", v.trim().to_string()));
    }
    if let Some(v) = query.visibility.as_ref().filter(|s| !s.trim().is_empty()) {
        params.push(("visibility", v.trim().to_string()));
    }
    if let Some(v) = query.mime.as_ref().filter(|s| !s.trim().is_empty()) {
        params.push(("mime", v.trim().to_string()));
    }
    if query.include_deleted {
        params.push(("include_deleted", "1".to_string()));
    }
    if let Some(p) = query.page {
        if p > 0 {
            params.push(("page", p.to_string()));
        }
    }
    if let Some(ps) = query.page_size {
        if ps > 0 {
            params.push(("page_size", ps.to_string()));
        }
    }

    match station_client::request_json_auth(
        reqwest::Method::GET,
        "/sub-oss/my-files",
        token,
        Some(&params),
        None,
    ) {
        Ok(v) => json_payload("oss_list_my_files", &v),
        Err(e) => {
            tracing::error!(error = %e, "oss list_my_files failed");
            e.into_app_result("Failed to list files")
        }
    }
}

pub fn oss_delete_file(token: &str, key: &str) -> AppResult<StubPayload> {
    if key.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "key is required", None);
    }
    let key_owned = key.trim().to_string();
    let params: [(&str, String); 1] = [("key", key_owned.clone())];

    match station_client::request_json_auth(
        reqwest::Method::DELETE,
        "/sub-oss/file",
        token,
        Some(&params),
        None,
    ) {
        Ok(v) => {
            invalidate_local_cache(&key_owned, "delete");
            json_payload("oss_delete_file", &v)
        }
        Err(e) => {
            tracing::error!(error = %e, key = %key_owned, "oss delete_file failed");
            e.into_app_result("Failed to delete file")
        }
    }
}

pub fn oss_restore_file(token: &str, key: &str) -> AppResult<StubPayload> {
    if key.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "key is required", None);
    }
    let key_owned = key.trim().to_string();
    let params: [(&str, String); 1] = [("key", key_owned.clone())];

    match station_client::request_json_auth(
        reqwest::Method::POST,
        "/sub-oss/file/restore",
        token,
        Some(&params),
        None,
    ) {
        Ok(v) => {
            // A successful restore re-publishes the row — drop any
            // stale cached copy that might have been retained out of
            // band (e.g. the file was force-deleted and then
            // restored within the same session).
            invalidate_local_cache(&key_owned, "restore");
            json_payload("oss_restore_file", &v)
        }
        Err(e) => {
            tracing::error!(error = %e, key = %key_owned, "oss restore_file failed");
            e.into_app_result("Failed to restore file")
        }
    }
}

pub fn oss_patch_file(token: &str, key: &str, body: &PatchFileBody) -> AppResult<StubPayload> {
    if key.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "key is required", None);
    }
    if body.visibility.is_none()
        && body.chat_session_id.is_none()
        && body.bucket.is_none()
        && body.filename.is_none()
        && body.expires_at.is_none()
        && !body.clear_expires_at
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "patch body has no changes",
            None,
        );
    }
    if let Some(v) = body.visibility.as_deref() {
        let lc = v.trim().to_ascii_lowercase();
        if lc != "public" && lc != "chat" && lc != "private" {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "visibility must be one of: public, chat, private",
                None,
            );
        }
    }

    let mut payload = serde_json::Map::<String, Value>::new();
    if let Some(v) = body.visibility.as_ref() {
        payload.insert(
            "visibility".to_string(),
            Value::String(v.trim().to_string()),
        );
    }
    if let Some(v) = body.chat_session_id.as_ref() {
        payload.insert(
            "chat_session_id".to_string(),
            Value::String(v.trim().to_string()),
        );
    }
    if let Some(v) = body.bucket.as_ref() {
        payload.insert("bucket".to_string(), Value::String(v.trim().to_string()));
    }
    if let Some(v) = body.filename.as_ref() {
        payload.insert("filename".to_string(), Value::String(v.trim().to_string()));
    }
    // `clear_expires_at` wins over `expires_at` — sending both would
    // be a client bug, but the explicit "clear" intent is the safer
    // tiebreaker (otherwise a UI that toggles a checkbox could leak
    // a stale stamp onto the wire).
    if body.clear_expires_at {
        payload.insert("expires_at".to_string(), Value::Null);
    } else if let Some(v) = body.expires_at.as_ref() {
        payload.insert(
            "expires_at".to_string(),
            Value::String(v.trim().to_string()),
        );
    }
    let body_json: Value = Value::Object(payload);

    let key_owned = key.trim().to_string();
    let params: [(&str, String); 1] = [("key", key_owned.clone())];

    match station_client::request_json_auth(
        reqwest::Method::PATCH,
        "/sub-oss/file",
        token,
        Some(&params),
        Some(&body_json),
    ) {
        Ok(v) => {
            // Any visibility tighten / chat-scope change can flip
            // who is allowed to fetch the bytes; our local cache
            // outlives that decision and would serve stale content
            // to receivers if not flushed.
            invalidate_local_cache(&key_owned, "patch");
            json_payload("oss_patch_file", &v)
        }
        Err(e) => {
            tracing::error!(error = %e, key = %key_owned, "oss patch_file failed");
            e.into_app_result("Failed to patch file")
        }
    }
}

/// Renderer-driven cache eviction. Used after the bound Station
/// changes a file's lifecycle out-of-band (e.g. the operator
/// force-deleted from the dashboard) so the next view does not
/// surface the stale copy.
pub fn oss_invalidate_cache(uri: &str) -> AppResult<StubPayload> {
    let parsed = match OssUri::parse(uri) {
        Ok(u) => u,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid oss uri: {e}"),
                None,
            );
        }
    };
    if let Err(err) = oss_cache::attachment_invalidate(&parsed) {
        tracing::warn!(error = %err, uri = %uri, "oss cache invalidate failed");
        // We deliberately do NOT propagate cache errors: the call
        // is advisory. The renderer should not see "delete failed
        // because the cache evict couldn't take a write lock".
    }
    AppResult::success(StubPayload {
        command: "oss_invalidate_cache".to_string(),
        status: json!({ "ok": true, "uri": parsed.to_uri() }).to_string(),
    })
}

fn invalidate_local_cache(key: &str, op: &str) {
    // The user's own files always live on the bound Station; we
    // build the canonical OssUri from the local origin so the cache
    // path matches whatever `attachment_ensure` would write.
    let origin = station_client::station_base_url();
    let uri = OssUri {
        origin,
        key: key.to_string(),
    };
    if let Err(err) = oss_cache::attachment_invalidate(&uri) {
        tracing::warn!(error = %err, key = %key, op = %op, "post-mutation cache invalidate failed");
    }
}

fn json_payload(command: &'static str, value: &Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()),
    })
}
