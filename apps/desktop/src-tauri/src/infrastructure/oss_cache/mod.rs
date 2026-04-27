// OSS cache infrastructure.
//
// Single source of truth for two artefacts the desktop client keeps about
// remote OSS endpoints:
//
//   1. **Capabilities** — the JSON document returned by
//      `GET {origin}/sub-oss/capabilities`. Cached in-memory for the
//      process lifetime, refreshed lazily on first use per origin and
//      whenever a caller explicitly requests an `invalidate`. The
//      capabilities payload tells us where to upload, what limits to
//      pre-validate against, and whether `signed_url` is required to
//      fetch bytes.
//
//   2. **File bytes** — local on-disk mirror of remote attachments,
//      keyed by `(origin, key)` so two stations holding the same key
//      remain isolated. Mirrors the layout of `avatar_cache` but lives
//      under `cache/files/<origin>/<key>` because attachments can be
//      large and the user may legitimately want to evict them without
//      losing identity-critical avatar files.
//
// Architectural notes:
//
//   * The capabilities map is keyed by the *advertised origin* returned
//     by the server (`capabilities.host`), not by the URL we used to
//     fetch it. This is important for federation: when station A holds
//     a `oss://B/key` URI we resolve B's capabilities, not A's.
//
//   * We do not persist capabilities to disk. The payload is small,
//     refreshes cheaply, and keeping it in-process avoids stale-cache
//     surprises after operators change `host-override` or limits.
//
//   * Attachments are stored as opaque bytes; we never decode them.
//     The renderer takes the local path and lets Tauri's
//     `convertFileSrc` / `asset:` protocol serve it.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

use serde::{Deserialize, Serialize};

use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind};

/// Mirrors the JSON shape returned by `/sub-oss/capabilities`. Field
/// names are in lock-step with `apps/station/app/subserver/oss/handler.go`
/// — bump `version` on any breaking change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OssCapabilities {
    pub version: i32,
    pub host: String,
    #[serde(default)]
    pub path_base: String,
    #[serde(default)]
    pub backend: String,
    #[serde(default)]
    pub max_file_size: i64,
    #[serde(default)]
    pub max_files_per_message: i32,
    #[serde(default)]
    pub signed_url: bool,
    #[serde(default)]
    pub upload_endpoint: String,
    #[serde(default)]
    pub file_endpoint: String,
    #[serde(default)]
    pub meta_endpoint: String,
}

#[derive(Debug)]
pub enum OssCacheError {
    InvalidUri(String),
    Network(String),
    Decode(String),
    Io(String),
    Storage(String),
}

impl std::fmt::Display for OssCacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidUri(m) => write!(f, "invalid oss uri: {m}"),
            Self::Network(m) => write!(f, "oss network error: {m}"),
            Self::Decode(m) => write!(f, "oss decode error: {m}"),
            Self::Io(m) => write!(f, "oss io error: {m}"),
            Self::Storage(m) => write!(f, "oss storage error: {m}"),
        }
    }
}

/// Parsed `oss://{origin}/{key}` URI.
///
/// We accept both `oss://` and a bare `key` form (when the caller just
/// has a key from a legacy upload response) — the latter resolves
/// against Station's own origin via `station_client::station_base_url`.
/// `host` is normalized to *not* carry a trailing slash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OssUri {
    pub origin: String,
    pub key: String,
}

impl OssUri {
    pub fn parse(input: &str) -> Result<Self, OssCacheError> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(OssCacheError::InvalidUri("empty input".into()));
        }
        if let Some(rest) = trimmed.strip_prefix("oss://") {
            // We must split scheme://host/key while tolerating the host
            // itself containing a scheme (`https://example.com`). The
            // host segment is everything up to the *first* `/` that is
            // not part of the embedded scheme separator.
            let (host_part, key_part) = split_origin_and_key(rest)
                .ok_or_else(|| OssCacheError::InvalidUri(format!("missing key: {input}")))?;
            return Ok(Self {
                origin: normalize_origin(host_part),
                key: key_part.to_string(),
            });
        }
        // Treat a leading `/` form as bare key against the local Station.
        let key = trimmed.trim_start_matches('/').to_string();
        Ok(Self {
            origin: normalize_origin(&station_client::station_base_url()),
            key,
        })
    }

    /// Render back to canonical `oss://{origin}/{key}`.
    pub fn to_uri(&self) -> String {
        format!("oss://{}/{}", self.origin, self.key)
    }
}

fn split_origin_and_key(rest: &str) -> Option<(&str, &str)> {
    // Cases we must support for `rest`:
    //   "files.example.com:8080/2026/04/26/abc.png"
    //   "https://files.example.com/2026/04/26/abc.png"
    //   "https://files.example.com:8443/key"
    //   "self/key"
    if let Some(after_scheme) = rest.find("://") {
        let scheme_end = after_scheme + 3;
        let after = &rest[scheme_end..];
        let slash = after.find('/')?;
        let split = scheme_end + slash;
        let host = &rest[..split];
        let key = &rest[split + 1..];
        if key.is_empty() {
            return None;
        }
        return Some((host, key));
    }
    let slash = rest.find('/')?;
    let key = &rest[slash + 1..];
    if key.is_empty() {
        return None;
    }
    Some((&rest[..slash], key))
}

fn normalize_origin(host: &str) -> String {
    host.trim().trim_end_matches('/').to_string()
}

// ── capabilities cache ──────────────────────────────────────────────

static CAPS: OnceLock<RwLock<HashMap<String, OssCapabilities>>> = OnceLock::new();

fn caps_map() -> &'static RwLock<HashMap<String, OssCapabilities>> {
    CAPS.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Look up cached capabilities for `origin` without performing any I/O.
pub fn capabilities_lookup(origin: &str) -> Option<OssCapabilities> {
    let key = normalize_origin(origin);
    caps_map().read().ok().and_then(|m| m.get(&key).cloned())
}

/// Force-clear the capabilities entry for `origin`. Used on auth
/// rotation or when an operator changes `host-override` and we need to
/// refetch.
pub fn capabilities_invalidate(origin: &str) {
    let key = normalize_origin(origin);
    if let Ok(mut m) = caps_map().write() {
        m.remove(&key);
    }
}

/// Resolve capabilities for `origin`, fetching them from the network on
/// cache miss. The returned `OssCapabilities.host` may differ from the
/// requested `origin` when an operator has set `host-override` —
/// callers should re-key any persistent state on `host` rather than the
/// origin they queried.
pub fn capabilities_ensure(origin: &str) -> Result<OssCapabilities, OssCacheError> {
    if let Some(cached) = capabilities_lookup(origin) {
        return Ok(cached);
    }
    let normalized = normalize_origin(origin);
    if normalized.is_empty() || normalized == "self" {
        // `self` means "the station this client is bound to" — route
        // through station_client's configured base.
        return capabilities_ensure(&station_client::station_base_url());
    }

    let url = format!("{}/sub-oss/capabilities", normalized);
    let resp = reqwest::blocking::get(&url)
        .map_err(|e| OssCacheError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(OssCacheError::Network(format!("status {}", resp.status())));
    }
    let caps: OssCapabilities = resp
        .json()
        .map_err(|e| OssCacheError::Decode(e.to_string()))?;

    if let Ok(mut m) = caps_map().write() {
        m.insert(normalized.clone(), caps.clone());
        // Index by the *advertised* host too so `oss://override/key`
        // and `oss://probe-origin/key` resolve to the same entry once
        // the server reports its canonical host.
        if !caps.host.is_empty() && caps.host != normalized {
            m.insert(normalize_origin(&caps.host), caps.clone());
        }
    }
    Ok(caps)
}

// ── attachment file cache ───────────────────────────────────────────

/// Returns the directory that holds locally cached attachment bytes.
pub fn attachments_dir() -> Result<PathBuf, OssCacheError> {
    storage::app_file_path("desktop", StorageKind::Cache, &["files", "oss"])
        .map_err(|err| OssCacheError::Storage(format!("{err:?}")))
}

fn cache_path_for(uri: &OssUri) -> Result<PathBuf, OssCacheError> {
    let dir = attachments_dir()?;
    // Bucket by sanitized origin so identical keys from two stations do
    // not collide. The key itself may already contain `/` segments
    // ("2026/04/26/file.png") — those become real subdirectories on
    // disk, which is intentional: the layout is human-debuggable.
    let origin_segment = sanitize_path_segment(&uri.origin);
    Ok(dir.join(origin_segment).join(&uri.key))
}

fn sanitize_path_segment(segment: &str) -> String {
    segment
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

/// Look up a cached attachment file *without* downloading. Returns
/// `Some(path)` only when the file is present and non-empty.
pub fn attachment_lookup(uri: &OssUri) -> Option<PathBuf> {
    let path = cache_path_for(uri).ok()?;
    let meta = fs::metadata(&path).ok()?;
    if meta.is_file() && meta.len() > 0 {
        Some(path)
    } else {
        None
    }
}

/// Resolve the attachment for `uri` to a local file, downloading from
/// Station on cache miss. The download URL is built from the
/// capabilities response: the client uses `file_endpoint` plus, when
/// `signed_url` is true, a Station-issued signed query — for now we
/// rely on the caller to pre-sign or on `signed_url == false` (home
/// deployments). When the backend requires a signed URL the caller
/// should supply `signed_query`.
pub fn attachment_ensure(
    uri: &OssUri,
    signed_query: Option<&str>,
) -> Result<PathBuf, OssCacheError> {
    if let Some(path) = attachment_lookup(uri) {
        return Ok(path);
    }
    let caps = capabilities_ensure(&uri.origin)?;
    if caps.signed_url && signed_query.is_none() {
        return Err(OssCacheError::Network(
            "endpoint requires signed url, none supplied".into(),
        ));
    }

    let mut url = format!("{}{}?key={}", caps.host, caps.file_endpoint, urlencode(&uri.key));
    if let Some(q) = signed_query {
        if !q.is_empty() {
            url.push('&');
            url.push_str(q.trim_start_matches('&'));
        }
    }

    let dest = cache_path_for(uri)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| OssCacheError::Io(e.to_string()))?;
    }

    let resp = reqwest::blocking::get(&url)
        .map_err(|e| OssCacheError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(OssCacheError::Network(format!("status {}", resp.status())));
    }
    let bytes = resp
        .bytes()
        .map_err(|e| OssCacheError::Network(e.to_string()))?;
    if bytes.is_empty() {
        return Err(OssCacheError::Network("empty body".into()));
    }
    fs::write(&dest, &bytes).map_err(|e| OssCacheError::Io(e.to_string()))?;
    Ok(dest)
}

fn urlencode(input: &str) -> String {
    // Minimal percent-encoding for path segments inside a query value.
    // We keep `/` because Station's `key` is already a forward-slash
    // path; both `key=2026/04/26/file.png` and the encoded form work,
    // but the unencoded form is friendlier in logs.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_full_uri() {
        let uri = OssUri::parse("oss://https://files.example.com/2026/04/26/abc.png").unwrap();
        assert_eq!(uri.origin, "https://files.example.com");
        assert_eq!(uri.key, "2026/04/26/abc.png");
        assert_eq!(
            uri.to_uri(),
            "oss://https://files.example.com/2026/04/26/abc.png"
        );
    }

    #[test]
    fn parse_origin_without_scheme() {
        let uri = OssUri::parse("oss://station.local:9090/key123").unwrap();
        assert_eq!(uri.origin, "station.local:9090");
        assert_eq!(uri.key, "key123");
    }

    #[test]
    fn parse_strips_trailing_slash_in_origin() {
        let uri = OssUri::parse("oss://https://files.example.com/k").unwrap();
        assert_eq!(uri.origin, "https://files.example.com");
        let uri2 = OssUri::parse("oss://https://files.example.com//k").unwrap();
        // A double slash means the origin still has trailing material;
        // we only normalise the *outer* origin string, not the embedded
        // scheme. The resulting key is `/k` which the file endpoint
        // will reject — that's acceptable, parse stays lossless.
        assert_eq!(uri2.key, "/k");
    }

    #[test]
    fn parse_rejects_missing_key() {
        let err = OssUri::parse("oss://files.example.com").unwrap_err();
        match err {
            OssCacheError::InvalidUri(_) => {}
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn parse_bare_key_uses_local_station() {
        let uri = OssUri::parse("2026/04/26/abc.png").unwrap();
        assert!(!uri.origin.is_empty());
        assert_eq!(uri.key, "2026/04/26/abc.png");
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(OssUri::parse("   ").is_err());
    }

    #[test]
    fn urlencode_keeps_slashes_and_safe_chars() {
        assert_eq!(urlencode("2026/04/26/abc.png"), "2026/04/26/abc.png");
        assert_eq!(urlencode("a b"), "a%20b");
    }
}
