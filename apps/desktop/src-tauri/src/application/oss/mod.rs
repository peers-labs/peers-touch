// OSS application service — chat attachment upload & federated URI resolution.
//
// Two responsibilities, kept in this module so the Tauri layer never has
// to think about Station's wire shape:
//
//   1. `upload_attachment(file_path, token)` — pushes a local file to
//      Station via the existing `/sub-oss/upload` endpoint and returns
//      the canonical attachment payload (`cid`, `key`, `host`, `mime`,
//      `size`, `filename`). The `cid` is the federated URI that should
//      be embedded in `MessageAttachment.cid`. Older Station builds
//      that pre-date the URI work return only `key`/`url`; we
//      synthesize a `cid` from `station_base_url` so older deployments
//      continue to function.
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

use serde::{Deserialize, Serialize};

use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::oss_cache::{self, OssCacheError, OssUri};
use crate::infrastructure::station_client;

/// Result returned by `chat_upload_attachment` to the frontend. The
/// shape mirrors `MessageAttachment` proto fields so the renderer can
/// pass it straight into a `friend_chat.send_message` / group send
/// without further mapping.
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
    pub host: String,
    pub key: String,
}

pub fn chat_upload_attachment(
    file_path: &str,
    token: &str,
    bucket: &str,
    visibility: &str,
    chat_session_id: Option<&str>,
) -> AppResult<StubPayload> {
    if file_path.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "file_path is required",
            None,
        );
    }
    tracing::info!(file_path = %file_path, "Chat attachment upload start");

    let resp = match station_client::upload_multipart(
        "/sub-oss/upload",
        token,
        file_path,
        bucket,
        visibility,
        if visibility == "chat" { chat_session_id } else { None },
    ) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "Chat attachment upload failed");
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
    let url_rel = resp.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
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
        filename: resp.get("filename").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        mime_type: resp.get("mime").and_then(|v| v.as_str()).unwrap_or("").to_string(),
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
        command: "chat_upload_attachment".to_string(),
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
        if caps.file_endpoint.is_empty() { "/sub-oss/file" } else { caps.file_endpoint.as_str() },
        urlencode(&uri.key),
    );

    // For signed backends we cannot pre-mirror — the URL the caller
    // already has is authoritative.
    if caps.signed_url {
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
    AppResult::fail(ErrorCode::InternalError, format!("oss resolve failed: {err}"), None)
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
