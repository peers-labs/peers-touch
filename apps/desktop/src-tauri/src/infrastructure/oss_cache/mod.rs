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
///
/// Versions:
///   - `1`: initial public shape (host, backend, key_strategy, …).
///   - `2`: presigned upload — adds `presigned_upload`,
///     `presigned_threshold`, `presigned_endpoints`. Older clients keep
///     working because they ignore unknown fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OssCapabilities {
    pub version: i32,
    pub host: String,
    #[serde(default)]
    pub path_base: String,
    #[serde(default)]
    pub backend: String,
    /// Active key strategy on the server. `random` means each
    /// upload gets a fresh per-day key (legacy); `cas` means the
    /// server deduplicates by sha256 and returns the canonical
    /// `cas/<shard>/<hash>.<ext>` key. Empty when talking to an
    /// older Station that pre-dates this field.
    #[serde(default)]
    pub key_strategy: String,
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

    // ── v2 fields ────────────────────────────────────────────────
    /// True when the active backend implements the `PresignedBackend`
    /// capability AND the operator enabled a non-zero threshold.
    /// The desktop client routes files at or above
    /// `presigned_threshold` through the direct-PUT path when this is
    /// set. False (or missing) on Stations that pre-date v2 — the
    /// client transparently falls back to multipart.
    #[serde(default)]
    pub presigned_upload: bool,
    /// Byte threshold at or above which the client switches from the
    /// multipart `/upload` endpoint to the direct presigned PUT. Zero
    /// disables the fast lane regardless of `presigned_upload`.
    #[serde(default)]
    pub presigned_threshold: i64,
    /// Endpoint paths for the presigned upload session. Sent only
    /// when `presigned_upload` is true; otherwise `None` and the
    /// client must not attempt the path.
    #[serde(default)]
    pub presigned_endpoints: Option<PresignedEndpoints>,
}

/// Path pair for the presigned upload data flow. Both paths are
/// relative to `host` — the client joins them itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresignedEndpoints {
    #[serde(default)]
    pub presign: String,
    #[serde(default)]
    pub complete: String,
}

impl OssCapabilities {
    /// Backend identifiers that are non-mirrorable from the desktop
    /// client's point of view. For these the renderer fetches bytes
    /// directly from the backend (transparently via Station's 302),
    /// so caching them under `cache/files/oss` is wasted disk: S3
    /// itself is the distributed cache.
    pub fn skip_local_mirror(&self) -> bool {
        if self.signed_url {
            return true;
        }
        matches!(self.backend.as_str(), "s3")
    }

    /// Predicate the upload path uses to decide whether a given
    /// file size should route through the presigned PUT. Encodes
    /// the version gate so older Stations never accidentally
    /// trigger the fast lane.
    pub fn supports_presigned_upload(&self, size: i64) -> bool {
        self.version >= 2
            && self.presigned_upload
            && self.presigned_threshold > 0
            && size >= self.presigned_threshold
            && self.presigned_endpoints.is_some()
    }
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
    let resp = reqwest::blocking::get(&url).map_err(|e| OssCacheError::Network(e.to_string()))?;
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

    let mut url = format!(
        "{}{}?key={}",
        caps.host,
        caps.file_endpoint,
        urlencode(&uri.key)
    );
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

    let resp = reqwest::blocking::get(&url).map_err(|e| OssCacheError::Network(e.to_string()))?;
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

// ── garbage collection ──────────────────────────────────────────────

/// Default cache budget — 256 MiB. Picked to be:
///   - large enough that a typical chat session doesn't churn,
///   - small enough that a household NAS won't notice if it doubles
///     transiently mid-eviction.
/// The actual budget is operator-configurable via
/// `OSS_CACHE_BUDGET_BYTES` env var, read on first call.
pub const DEFAULT_CACHE_BUDGET_BYTES: u64 = 256 * 1024 * 1024;

fn cache_budget_bytes() -> u64 {
    std::env::var("OSS_CACHE_BUDGET_BYTES")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_CACHE_BUDGET_BYTES)
}

/// Outcome of a GC pass — exposed so observability layers (presence
/// supervisor, future metrics) can record what happened.
#[derive(Debug, Clone, Copy, Default)]
pub struct GcReport {
    pub scanned: u64,
    pub evicted: u64,
    pub bytes_before: u64,
    pub bytes_after: u64,
}

/// LRU-evict the on-disk attachment cache until total bytes fit under
/// `max_bytes`. "Recency" is approximated by file `mtime` — we do not
/// track access timestamps in a sidecar to keep the implementation
/// crash-safe and dependency-free. Walking is bounded by the attachment
/// directory so we never touch other Tauri caches.
///
/// Errors are *swallowed per file* so a permission-denied entry cannot
/// stop the eviction sweep from making progress on the rest of the
/// cache. Aggregate stats are logged at info level.
pub fn gc(max_bytes: u64) -> GcReport {
    let dir = match attachments_dir() {
        Ok(d) => d,
        Err(err) => {
            tracing::debug!(error = %err, "oss_cache.gc: cache dir unavailable, skipping");
            return GcReport::default();
        }
    };
    if !dir.exists() {
        return GcReport::default();
    }

    let mut entries: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    if let Err(err) = walk_files(&dir, &mut entries) {
        tracing::warn!(error = %err, "oss_cache.gc: walk failed (partial result)");
    }
    let scanned = entries.len() as u64;
    let bytes_before: u64 = entries.iter().map(|(_, len, _)| *len).sum();

    if bytes_before <= max_bytes {
        return GcReport {
            scanned,
            evicted: 0,
            bytes_before,
            bytes_after: bytes_before,
        };
    }

    // Oldest-first eviction.
    entries.sort_by_key(|(_, _, mtime)| *mtime);

    let mut bytes_after = bytes_before;
    let mut evicted = 0u64;
    for (path, len, _) in entries {
        if bytes_after <= max_bytes {
            break;
        }
        if let Err(err) = fs::remove_file(&path) {
            tracing::debug!(error = %err, path = %path.display(), "oss_cache.gc: remove failed");
            continue;
        }
        bytes_after = bytes_after.saturating_sub(len);
        evicted += 1;
    }

    // Best-effort: prune empty directories left behind by the eviction.
    prune_empty_dirs(&dir);

    let report = GcReport {
        scanned,
        evicted,
        bytes_before,
        bytes_after,
    };
    tracing::info!(
        scanned = report.scanned,
        evicted = report.evicted,
        bytes_before = report.bytes_before,
        bytes_after = report.bytes_after,
        budget = max_bytes,
        "oss_cache.gc: pass complete"
    );
    report
}

/// Convenience wrapper that uses the operator-configured budget. Safe
/// to call from any thread; performs only filesystem I/O.
pub fn gc_with_default_budget() -> GcReport {
    gc(cache_budget_bytes())
}

fn walk_files(
    root: &std::path::Path,
    out: &mut Vec<(PathBuf, u64, std::time::SystemTime)>,
) -> std::io::Result<()> {
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => return Err(err),
        };
        for entry in read {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_dir() {
                stack.push(path);
                continue;
            }
            if !ft.is_file() {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime = meta
                .modified()
                .unwrap_or_else(|_| std::time::SystemTime::UNIX_EPOCH);
            out.push((path, meta.len(), mtime));
        }
    }
    Ok(())
}

fn prune_empty_dirs(root: &std::path::Path) {
    // Single non-recursive pass — collect all directories first, then
    // try to remove them depth-last. `remove_dir` only succeeds on an
    // empty directory, which is exactly what we want.
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        let read = match fs::read_dir(&d) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            let path = entry.path();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push(path.clone());
                dirs.push(path);
            }
        }
    }
    // Deepest first.
    dirs.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for d in dirs {
        let _ = fs::remove_dir(&d);
    }
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

    // ── GC ─────────────────────────────────────────────────────────

    fn touch_with_size(dir: &std::path::Path, name: &str, bytes: usize, _age_secs: u64) {
        // We approximate "older" via write order — `gc` sorts by
        // mtime and the OS bumps mtime on every write, so a tiny
        // sleep between writes is enough to make the sort
        // deterministic. We avoid pulling in `filetime` for this.
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, vec![0u8; bytes]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(15));
    }

    #[test]
    fn gc_noop_when_under_budget() {
        let dir = std::env::temp_dir().join(format!("oss_cache_gc_under_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.bin"), vec![0u8; 1024]).unwrap();
        std::fs::write(dir.join("b.bin"), vec![0u8; 1024]).unwrap();

        let mut entries = Vec::new();
        walk_files(&dir, &mut entries).unwrap();
        let total: u64 = entries.iter().map(|(_, l, _)| *l).sum();
        assert_eq!(total, 2048);

        // Don't go through `gc` because that talks to the desktop
        // storage layout. The piece we want to prove is the
        // walk + sort + retain logic; exercise it directly.
        entries.sort_by_key(|(_, _, m)| *m);
        let mut after = total;
        let mut evicted = 0u64;
        let budget = 4096u64;
        for (p, l, _) in entries {
            if after <= budget {
                break;
            }
            std::fs::remove_file(&p).unwrap();
            after -= l;
            evicted += 1;
        }
        assert_eq!(evicted, 0, "no eviction when under budget");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gc_evicts_oldest_first_until_under_budget() {
        let dir = std::env::temp_dir().join(format!("oss_cache_gc_evict_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Three 1KiB files written in order — `a` oldest, `c` newest.
        touch_with_size(&dir, "a.bin", 1024, 30);
        touch_with_size(&dir, "b.bin", 1024, 20);
        touch_with_size(&dir, "c.bin", 1024, 10);

        let mut entries = Vec::new();
        walk_files(&dir, &mut entries).unwrap();
        let total: u64 = entries.iter().map(|(_, l, _)| *l).sum();
        assert_eq!(total, 3072);

        entries.sort_by_key(|(_, _, m)| *m);
        let budget = 1500u64;
        let mut after = total;
        let mut evicted_names = Vec::new();
        for (p, l, _) in entries {
            if after <= budget {
                break;
            }
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            std::fs::remove_file(&p).unwrap();
            after -= l;
            evicted_names.push(name);
        }
        // Two oldest gone, newest survives.
        assert_eq!(evicted_names, vec!["a.bin", "b.bin"]);
        assert!(dir.join("c.bin").exists());
        assert!(after <= budget);
        std::fs::remove_dir_all(&dir).ok();
    }
}
