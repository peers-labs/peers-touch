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
use serde_json::{json, Value};

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

pub fn oss_patch_file(
    token: &str,
    key: &str,
    body: &PatchFileBody,
) -> AppResult<StubPayload> {
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
        payload.insert("visibility".to_string(), Value::String(v.trim().to_string()));
    }
    if let Some(v) = body.chat_session_id.as_ref() {
        payload.insert("chat_session_id".to_string(), Value::String(v.trim().to_string()));
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
        payload.insert("expires_at".to_string(), Value::String(v.trim().to_string()));
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
            )
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
