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

use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::oss_cache::{self, OssCacheError, OssUri};
use crate::infrastructure::station_client;

/// Result returned by `upload_attachment` to the frontend. The shape
/// mirrors `MessageAttachment` / `ImageAttachment` proto fields so the
/// renderer can pass it straight into a `friend_chat.send_message` /
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
    pub host: String,
    pub key: String,
}

pub fn upload_attachment(
    file_path: &str,
    token: &str,
    consumer: &str,
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
    let mime = guess_mime_from_path(file_path);

    if let Some(c) = caps.as_ref() {
        if c.supports_presigned_upload(file_size) {
            match upload_via_presigned(file_path, token, &filename, &mime, file_size, c) {
                Ok(payload) => {
                    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
                    return AppResult::success(StubPayload {
                        command: "chat_upload_attachment".to_string(),
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

    let resp = match station_client::upload_multipart("/sub-oss/upload", token, file_path) {
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
    };

    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    AppResult::success(StubPayload {
        command: format!("oss_upload_attachment_{}", consumer),
        status: body,
    })
}

pub fn oss_resolve_url(input: &str) -> AppResult<StubPayload> {
    let uri = match OssUri::parse(input) {
        Ok(u) => u,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid oss uri: {e}"),
                None,
            )
        }
    };

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
            host: caps.host,
            key: uri.key,
        });
    }

    // Best-effort cache to disk. Errors do not break the response —
    // the renderer can still show the file via the absolute URL.
    let local_path = match oss_cache::attachment_ensure(&uri, None) {
        Ok(p) => Some(p.to_string_lossy().to_string()),
        Err(err) => {
            tracing::warn!(error = %err, uri = %input, "OSS attachment cache miss");
            None
        }
    };

    success(OssResolved {
        local_path,
        url,
        host: caps.host,
        key: uri.key,
    })
}

fn success(payload: OssResolved) -> AppResult<StubPayload> {
    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    AppResult::success(StubPayload {
        command: "oss_resolve_url".to_string(),
        status: body,
    })
}

fn resolve_error(err: OssCacheError) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::InternalError,
        format!("oss resolve failed: {err}"),
        None,
    )
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
