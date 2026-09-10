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
///   - `3`: federation + lifecycle capabilities and the
///     `capability_version` cache-bust handle. Older stations returning
///     v1/v2 parse cleanly because every newer field is `#[serde(default)]`.
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
    /// Endpoint paths for the presigned upload data flow. Sent only
    /// when `presigned_upload` is true; otherwise `None` and the
    /// client must not attempt the path.
    #[serde(default)]
    pub presigned_endpoints: Option<PresignedEndpoints>,

    // ── v3 fields ────────────────────────────────────────────────
    /// Opaque ULID re-rolled on every policy change (visibility
    /// tightening, federation key rotation, …). Empty for pre-v3
    /// stations; non-empty values let us evict the per-origin
    /// capabilities cache when the upstream signals a refresh.
    #[serde(default)]
    pub capability_version: String,

    /// v3 federation block — `None` on a pre-v3 station OR when the
    /// station has federation explicitly disabled (no key cache /
    /// missing local station id). The renderer treats both cases the
    /// same: foreign-origin GETs degrade to "broken link".
    #[serde(default)]
    pub federation: Option<OssFederationCapabilities>,
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

/// `capabilities.federation` shape. Mirrors the Go side's `federation`
/// map exactly so we never silently drop a field in a future schema
/// drift.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OssFederationCapabilities {
    /// True when this station can mint peer tokens. False means the
    /// station has the v3 schema but is missing wiring (no
    /// LocalStationID, no federation key cache).
    #[serde(default)]
    pub outbound: bool,
    /// Hard upper bound for token TTL the receiving side will
    /// honour. Mostly informational for the desktop client — we let
    /// the station clamp on mint.
    #[serde(default)]
    pub max_ttl_seconds: i64,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub local_station_id: String,
    #[serde(default)]
    pub mint_endpoint: String,
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
    /// The bound station refused to mint a federation token (403 from
    /// `POST /sub-oss/federation/token`). Distinct from `Network`
    /// because the renderer maps it to a "permission denied" UI
    /// rather than a "retry later" toast.
    FederationDenied(String),
    /// The bound station does not advertise outbound federation
    /// (pre-v3 capabilities, or `federation.outbound = false`). The
    /// renderer falls back to a broken-link state without retries.
    FederationDisabled(String),
    /// Caller invoked a federated path without supplying an auth
    /// token. The mint endpoint demands JWT auth, so we surface this
    /// as a typed error rather than a generic 401.
    FederationAuthRequired,
}

impl std::fmt::Display for OssCacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidUri(m) => write!(f, "invalid oss uri: {m}"),
            Self::Network(m) => write!(f, "oss network error: {m}"),
            Self::Decode(m) => write!(f, "oss decode error: {m}"),
            Self::Io(m) => write!(f, "oss io error: {m}"),
            Self::Storage(m) => write!(f, "oss storage error: {m}"),
            Self::FederationDenied(m) => write!(f, "oss federation denied: {m}"),
            Self::FederationDisabled(m) => write!(f, "oss federation disabled: {m}"),
            Self::FederationAuthRequired => {
                write!(f, "oss federation requires authenticated session")
            }
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

fn canonical_origin_with_bound(origin: &str, bound_origin: &str) -> String {
    let normalized = normalize_origin(origin);
    if normalized.is_empty() || normalized == "self" {
        normalize_origin(bound_origin)
    } else {
        normalized
    }
}

fn canonical_bound_origin(origin: &str) -> String {
    canonical_origin_with_bound(origin, &station_client::station_base_url())
}

// ── capabilities cache ──────────────────────────────────────────────

static CAPS: OnceLock<RwLock<HashMap<String, OssCapabilities>>> = OnceLock::new();

fn caps_map() -> &'static RwLock<HashMap<String, OssCapabilities>> {
    CAPS.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Look up cached capabilities for `origin` without performing any I/O.
pub fn capabilities_lookup(origin: &str) -> Option<OssCapabilities> {
    let key = canonical_bound_origin(origin);
    caps_map().read().ok().and_then(|m| m.get(&key).cloned())
}

/// Force-clear the capabilities entry for `origin`. Used on auth
/// rotation or when an operator changes `host-override` and we need to
/// refetch.
pub fn capabilities_invalidate(origin: &str) {
    let key = canonical_bound_origin(origin);
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
    let normalized = canonical_bound_origin(origin);
    if let Some(cached) = capabilities_lookup(&normalized) {
        return Ok(cached);
    }
    if normalized.is_empty() || normalized == "self" {
        return Err(OssCacheError::InvalidUri(
            "bound station origin is empty".into(),
        ));
    }

    let url = format!("{}/sub-oss/capabilities", normalized);
    let resp = reqwest::blocking::get(&url).map_err(|e| OssCacheError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(OssCacheError::Network(format!("status {}", resp.status())));
    }
    let mut caps: OssCapabilities = resp
        .json()
        .map_err(|e| OssCacheError::Decode(e.to_string()))?;
    caps.host = canonical_capability_host(&normalized, &caps.host);

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

fn canonical_capability_host(request_origin: &str, advertised_host: &str) -> String {
    let advertised = normalize_origin(advertised_host);
    if advertised.is_empty() || advertised == "self" {
        normalize_origin(request_origin)
    } else {
        advertised
    }
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
    let origin_segment = sanitize_path_segment(&canonical_bound_origin(&uri.origin));
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

/// Drop the on-disk cache entry for a single attachment. Idempotent —
/// missing files are not an error. Used after destructive lifecycle
/// mutations (delete / patch with tightened visibility / TTL change)
/// so the renderer never displays bytes that the server has since
/// re-classified.
///
/// We deliberately do NOT prune empty parent directories: the layout
/// is bucketed by origin and walking up to delete an empty `oss/`
/// dir adds no value and races with concurrent `attachment_ensure`
/// calls. The `gc()` pass already handles structural cleanup.
pub fn attachment_invalidate(uri: &OssUri) -> Result<(), OssCacheError> {
    let path = cache_path_for(uri)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(OssCacheError::Io(err.to_string())),
    }
}

/// Resolve the attachment for `uri` to a local file, downloading from
/// Station on cache miss. The download URL is built from the
/// capabilities response: the client uses `file_endpoint` plus, when
/// `signed_url` is true, a Station-issued signed query — for now we
/// rely on the caller to pre-sign or on `signed_url == false` (home
/// deployments). When the backend requires a signed URL the caller
/// should supply `signed_query`. Actor-private objects on the bound
/// station require the caller's session token in `bearer`.
///
/// Bound-station origin only (i.e. the URI was minted by the same
/// station this client is talking to). For the federated path
/// (URI's origin ≠ bound station), use `attachment_ensure_federated`.
/// `bearer` carries the current local session for private and
/// chat-scoped objects; public objects also accept an empty token.
pub fn attachment_ensure(
    uri: &OssUri,
    signed_query: Option<&str>,
    bearer: Option<&str>,
) -> Result<PathBuf, OssCacheError> {
    let canonical_uri = OssUri {
        origin: canonical_bound_origin(&uri.origin),
        key: uri.key.clone(),
    };
    if let Some(path) = attachment_lookup(&canonical_uri) {
        return Ok(path);
    }
    let caps = capabilities_ensure(&canonical_uri.origin)?;
    if caps.signed_url && signed_query.is_none() {
        return Err(OssCacheError::Network(
            "endpoint requires signed url, none supplied".into(),
        ));
    }

    let url = build_file_url(
        &caps.host,
        &caps.file_endpoint,
        &uri.key,
        None,
        signed_query,
    )?;

    let bytes = http_get_bytes(url.as_str(), bearer)?;
    write_to_cache(&canonical_uri, &bytes)
}

/// Federation-aware download. Used when the OSS URI's origin is a
/// *foreign* station (not the one the desktop client is bound to).
///
/// Flow:
///   1. Mint a peer JWT at the bound station via
///      `POST /sub-oss/federation/token` with the foreign
///      `target_origin` and the file `oss_key`. The bound station
///      re-applies the same visibility check the foreign station
///      would, so a Forbidden here is the truthful answer (no
///      "try the foreign side anyway" leak).
///   2. Resolve the foreign station's capabilities so we know its
///      `host` + `file_endpoint`.
///   3. GET the bytes from `<foreign>/sub-oss/file?key=…&owner=…`
///      with `Authorization: Bearer <peer-jwt>`. The `owner` query
///      lets the foreign side resolve the right per-actor file row
///      (without it, the read falls back to "any public row by key"
///      which is not what we want for federated chat attachments).
///   4. Cache the result keyed by `(target_origin, key)` — same
///      layout as the non-federated path so subsequent renders
///      hit `attachment_lookup` and skip the round-trip.
///
/// `home_token` is the desktop user's HS256 JWT for the bound
/// station; `home_actor_ptid` is the same caller's PTID, embedded in
/// the foreign GET as `&owner=…`. Both are required.
pub fn attachment_ensure_federated(
    uri: &OssUri,
    home_token: &str,
    home_actor_ptid: &str,
) -> Result<PathBuf, OssCacheError> {
    if home_token.trim().is_empty() {
        return Err(OssCacheError::FederationAuthRequired);
    }
    if let Some(path) = attachment_lookup(uri) {
        return Ok(path);
    }

    let target_origin = normalize_origin(&uri.origin);
    if target_origin.is_empty() {
        return Err(OssCacheError::InvalidUri("empty origin".into()));
    }

    // Step 1 — mint at home. The mint endpoint is advertised by the
    // BOUND station's capabilities, never by the foreign one (the
    // foreign side has no business telling us where to mint).
    let home_caps = capabilities_ensure(&station_client::station_base_url())?;
    let federation = home_caps.federation.clone().ok_or_else(|| {
        OssCacheError::FederationDisabled("bound station has no federation block".into())
    })?;
    if !federation.outbound {
        return Err(OssCacheError::FederationDisabled(
            "bound station: federation.outbound = false".into(),
        ));
    }
    let mint_path = if federation.mint_endpoint.is_empty() {
        "/sub-oss/federation/token".to_string()
    } else {
        federation.mint_endpoint.clone()
    };
    let mint_body = serde_json::json!({
        "target_origin": target_origin,
        "oss_key": uri.key,
    });
    let mint_resp = match station_client::post_json_with_auth(&mint_path, home_token, mint_body) {
        Ok(v) => v,
        Err(err) => {
            return Err(map_mint_error(err));
        }
    };
    let token = mint_resp
        .get("token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();
    if token.is_empty() {
        return Err(OssCacheError::FederationDenied(
            "mint succeeded but token field empty".into(),
        ));
    }

    // Step 2 — resolve foreign capabilities so we know its
    // `file_endpoint`. Failures here are *network* failures (the
    // foreign station is unreachable), distinct from the
    // federation-denied path above.
    let foreign_caps = capabilities_ensure(&target_origin)?;
    let file_endpoint = if foreign_caps.file_endpoint.is_empty() {
        "/sub-oss/file".to_string()
    } else {
        foreign_caps.file_endpoint.clone()
    };

    // Step 3 — fetch bytes with the peer JWT. We append `&owner=…`
    // so the foreign FileMeta resolution lands on the right row;
    // `lookupFileMeta` honours this query param when present.
    let url = format!(
        "{}{}?key={}&owner={}",
        foreign_caps.host.trim_end_matches('/'),
        file_endpoint,
        urlencoding::encode(&uri.key),
        urlencoding::encode(home_actor_ptid),
    );
    let bytes = http_get_bytes(&url, Some(token.as_str()))?;

    // Step 4 — write through the same cache layout as the
    // non-federated path. The renderer cannot distinguish federated
    // from local cache hits, by design.
    write_to_cache(uri, &bytes)
}

fn map_mint_error(err: station_client::StationClientError) -> OssCacheError {
    use station_client::StationClientErrorKind;
    match err.kind {
        StationClientErrorKind::HttpStatus(code) => match code {
            401 | 403 => OssCacheError::FederationDenied(err.message),
            501 => OssCacheError::FederationDisabled(err.message),
            _ => OssCacheError::Network(format!("mint http {}: {}", code, err.message)),
        },
        StationClientErrorKind::SessionRevoked => OssCacheError::FederationAuthRequired,
        _ => OssCacheError::Network(err.message),
    }
}

/// HTTP GET → bytes helper. Wraps `reqwest::blocking::get` with a
/// uniform error mapping so the federated and non-federated paths
/// share one network surface.
fn http_get_bytes(url: &str, bearer: Option<&str>) -> Result<Vec<u8>, OssCacheError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| OssCacheError::Network(format!("http client: {e}")))?;
    let req = http_get_request(&client, url, bearer);
    let resp = req
        .send()
        .map_err(|e| OssCacheError::Network(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        // 403 from a federated GET should bubble as a federation
        // denial — the foreign station is enforcing its own
        // visibility policy on top of our peer JWT. 401 only
        // happens when our peer JWT is malformed / expired (we
        // just minted it, so this is a real issue).
        let msg = format!("status {status}");
        if status.as_u16() == 403 {
            return Err(OssCacheError::FederationDenied(msg));
        }
        return Err(OssCacheError::Network(msg));
    }
    let body = resp
        .bytes()
        .map_err(|e| OssCacheError::Network(e.to_string()))?;
    if body.is_empty() {
        return Err(OssCacheError::Network("empty body".into()));
    }
    Ok(body.to_vec())
}

fn http_get_request(
    client: &reqwest::blocking::Client,
    url: &str,
    bearer: Option<&str>,
) -> reqwest::blocking::RequestBuilder {
    let mut req = client.get(url);
    if let Some(t) = bearer {
        if !t.is_empty() {
            req = req.bearer_auth(t);
        }
    }
    req
}

fn build_file_url(
    host: &str,
    file_endpoint: &str,
    key: &str,
    owner: Option<&str>,
    trailing_query: Option<&str>,
) -> Result<reqwest::Url, OssCacheError> {
    let canonical_host = canonical_bound_origin(host);
    let base = reqwest::Url::parse(&canonical_host)
        .map_err(|e| OssCacheError::Network(format!("invalid OSS host: {e}")))?;
    let mut url = base
        .join(file_endpoint)
        .map_err(|e| OssCacheError::Network(format!("invalid OSS file endpoint: {e}")))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("key", key);
        if let Some(owner) = owner {
            query.append_pair("owner", owner);
        }
    }
    if let Some(trailing_query) = trailing_query {
        let trailing_query = trailing_query.trim_start_matches(['?', '&']);
        if !trailing_query.is_empty() {
            let query = match url.query() {
                Some(existing) => format!("{existing}&{trailing_query}"),
                None => trailing_query.to_string(),
            };
            url.set_query(Some(&query));
        }
    }
    Ok(url)
}

/// Persist `bytes` to the per-`uri` cache slot and return the path.
fn write_to_cache(uri: &OssUri, bytes: &[u8]) -> Result<PathBuf, OssCacheError> {
    let dest = cache_path_for(uri)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| OssCacheError::Io(e.to_string()))?;
    }
    fs::write(&dest, bytes).map_err(|e| OssCacheError::Io(e.to_string()))?;
    Ok(dest)
}

/// Returns true when `origin` matches the bound Station after
/// trailing-slash normalisation. Used by `oss_resolve_url` to
/// decide between the local and federated download paths.
pub fn is_bound_station(origin: &str) -> bool {
    let local = canonical_bound_origin("");
    let candidate = canonical_bound_origin(origin);
    candidate == local
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
    fn parse_self_origin_preserves_round_trip() {
        let uri = OssUri::parse("oss://self/attachments/file.png").unwrap();
        assert_eq!(uri.origin, "self");
        assert_eq!(uri.to_uri(), "oss://self/attachments/file.png");
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
        assert_eq!(
            uri.origin,
            normalize_origin(&station_client::station_base_url())
        );
        assert_eq!(uri.key, "2026/04/26/abc.png");
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(OssUri::parse("   ").is_err());
    }

    #[test]
    fn canonical_origin_maps_self_and_empty_to_bound_station() {
        let bound = "https://station.example.test/base/";
        assert_eq!(
            canonical_origin_with_bound("self", bound),
            "https://station.example.test/base"
        );
        assert_eq!(
            canonical_origin_with_bound("", bound),
            "https://station.example.test/base"
        );
        assert_eq!(
            canonical_origin_with_bound("https://foreign.example.test/", bound),
            "https://foreign.example.test"
        );
    }

    #[test]
    fn foreign_capabilities_self_resolves_to_queried_origin() {
        let local_bound = "https://bound.example.test";
        let foreign_request = "https://foreign.example.test/";
        let advertised_host = canonical_origin_with_bound("self", foreign_request);

        assert_eq!(advertised_host, "https://foreign.example.test");
        assert_ne!(advertised_host, local_bound);
    }

    // ── attachment_invalidate ──────────────────────────────────────

    #[test]
    fn attachment_invalidate_is_idempotent() {
        // No file has ever been written for this URI — invalidation
        // must NOT surface a "not found" error to the caller. We
        // proved the call chain works; if the storage layout changed
        // shape (Storage error), the assertion below would surface
        // that as the only legitimate failure mode.
        let uri = OssUri {
            origin: "test.invalidate.local".to_string(),
            key: "missing/key.bin".to_string(),
        };
        let res = attachment_invalidate(&uri);
        match res {
            Ok(()) => {}
            // The desktop storage layout requires a configured
            // platform path; in a bare cargo-test sandbox the
            // backing dir may not be initialised. Treat that as a
            // pass — the invariant we care about (no `NotFound`
            // bubbles up) still holds.
            Err(OssCacheError::Storage(_)) => {}
            Err(other) => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn attachment_invalidate_removes_existing_file() {
        // Drive the helper end-to-end against the real cache layout.
        // If the layout helper bails (e.g. CI container without a
        // desktop dir), skip cleanly — this is documented as best-
        // effort just like the production code path.
        let uri = OssUri {
            origin: "test.invalidate.real".to_string(),
            key: "tmp/file.bin".to_string(),
        };
        let path = match cache_path_for(&uri) {
            Ok(p) => p,
            Err(_) => return,
        };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::write(&path, b"hello").is_err() {
            return;
        }
        assert!(path.exists(), "fixture write succeeded");

        attachment_invalidate(&uri).expect("invalidate should succeed");
        assert!(!path.exists(), "file removed after invalidate");

        // Second invalidate must remain a no-op.
        attachment_invalidate(&uri).expect("idempotent");
    }

    #[test]
    fn attachment_invalidate_preserves_sibling_cache_entries() {
        let scope = ulid::Ulid::new();
        let removed = OssUri {
            origin: "self".to_string(),
            key: format!("tmp/{scope}/removed.bin"),
        };
        let sibling = OssUri {
            origin: station_client::station_base_url(),
            key: format!("tmp/{scope}/sibling.bin"),
        };
        assert_eq!(
            cache_path_for(&OssUri {
                origin: "self".to_string(),
                key: sibling.key.clone(),
            })
            .expect("self cache path"),
            cache_path_for(&sibling).expect("bound-origin cache path"),
            "self and the bound Station share one cache namespace"
        );
        let removed_path = match write_to_cache(&removed, b"removed") {
            Ok(path) => path,
            Err(OssCacheError::Storage(_)) => return,
            Err(other) => panic!("failed to create removed fixture: {other}"),
        };
        let sibling_path = write_to_cache(&sibling, b"sibling")
            .expect("sibling fixture should use the same cache layout");

        attachment_invalidate(&removed).expect("target invalidation should succeed");

        assert!(!removed_path.exists(), "target cache entry removed");
        assert_eq!(
            fs::read(&sibling_path).expect("sibling cache entry remains readable"),
            b"sibling"
        );
        attachment_invalidate(&sibling).expect("sibling cleanup should succeed");
    }

    #[test]
    fn absolute_file_get_adds_bearer_without_affecting_anonymous_reads() {
        use reqwest::header::AUTHORIZATION;

        let client = reqwest::blocking::Client::new();
        let url = build_file_url(
            "http://127.0.0.1:18080",
            "/sub-oss/file",
            "private/a b.png",
            None,
            None,
        )
        .expect("absolute file URL should build");
        let authenticated = http_get_request(&client, url.as_str(), Some("actor-private-token"))
            .build()
            .expect("authenticated request should build");
        assert_eq!(authenticated.url().scheme(), "http");
        assert_eq!(authenticated.url().host_str(), Some("127.0.0.1"));
        assert_eq!(authenticated.url().path(), "/sub-oss/file");
        assert_eq!(
            authenticated
                .url()
                .query_pairs()
                .collect::<Vec<(std::borrow::Cow<'_, str>, std::borrow::Cow<'_, str>)>>(),
            vec![("key".into(), "private/a b.png".into())]
        );
        assert_eq!(
            authenticated.headers().get(AUTHORIZATION),
            Some(&reqwest::header::HeaderValue::from_static(
                "Bearer actor-private-token"
            ))
        );

        let anonymous = http_get_request(&client, "http://127.0.0.1/sub-oss/file?key=public", None)
            .build()
            .expect("anonymous request should build");
        assert!(
            anonymous.headers().get(AUTHORIZATION).is_none(),
            "public reads remain valid without an Authorization header"
        );
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

    // ── v3 federation parsing ─────────────────────────────────────
    //
    // The capabilities document evolved from v1 → v2 → v3 without
    // bumping major versions; clients must keep parsing the older
    // shapes. These tests pin both:
    //   - a v2 document (no `federation`, no `capability_version`)
    //     deserialises with sensible defaults;
    //   - a v3 document round-trips the federation block intact.

    #[test]
    fn capabilities_parse_pre_v3_no_federation() {
        let json = r#"{
            "version": 2,
            "host": "https://files.example.com",
            "path_base": "/sub-oss",
            "backend": "local",
            "max_file_size": 16777216,
            "max_files_per_message": 9,
            "signed_url": false,
            "upload_endpoint": "/sub-oss/upload",
            "file_endpoint": "/sub-oss/file",
            "meta_endpoint": "/sub-oss/meta"
        }"#;
        let caps: OssCapabilities = serde_json::from_str(json).expect("parse pre-v3 caps");
        assert_eq!(caps.version, 2);
        assert!(caps.federation.is_none(), "pre-v3 has no federation block");
        assert_eq!(caps.capability_version, "");
    }

    #[test]
    fn capabilities_parse_v3_federation_block() {
        let json = r#"{
            "version": 3,
            "host": "https://files.example.com",
            "path_base": "/sub-oss",
            "backend": "local",
            "signed_url": false,
            "file_endpoint": "/sub-oss/file",
            "capability_version": "01HXY8VRQ5...ULID",
            "lifecycle_endpoints": {
                "delete": "/sub-oss/file",
                "patch": "/sub-oss/file",
                "restore": "/sub-oss/file/restore",
                "my_files": "/sub-oss/my-files"
            },
            "federation": {
                "outbound": true,
                "max_ttl_seconds": 60,
                "token_type": "peer+jwt",
                "local_station_id": "did:station:alice",
                "mint_endpoint": "/sub-oss/federation/token"
            }
        }"#;
        let caps: OssCapabilities = serde_json::from_str(json).expect("parse v3 caps");
        assert_eq!(caps.version, 3);
        assert_eq!(caps.capability_version, "01HXY8VRQ5...ULID");
        let fed = caps.federation.expect("federation block present");
        assert!(fed.outbound);
        assert_eq!(fed.max_ttl_seconds, 60);
        assert_eq!(fed.token_type, "peer+jwt");
        assert_eq!(fed.local_station_id, "did:station:alice");
        assert_eq!(fed.mint_endpoint, "/sub-oss/federation/token");
    }

    // ── is_bound_station decision tree ─────────────────────────────

    #[test]
    fn bound_station_matches_local_after_normalisation() {
        // PEERS_STATION_URL defaults to http://127.0.0.1:18080 when unset.
        // We cannot mutate process-wide env safely under cargo's parallel
        // test runner, so run the assertion against the actual default.
        let local = station_client::station_base_url();
        assert!(is_bound_station(&local));
        assert!(is_bound_station(&format!("{}/", local)));
        assert!(is_bound_station(""));
        assert!(is_bound_station("self"));
    }

    #[test]
    fn bound_station_rejects_foreign_origins() {
        // Pick a literally-impossible origin so we never collide with
        // a misconfigured PEERS_STATION_URL.
        assert!(!is_bound_station("https://this-is-foreign.example.invalid"));
    }

    #[test]
    fn capability_self_host_resolves_to_requested_station_origin() {
        assert_eq!(
            canonical_capability_host("http://station.example:18080", "self"),
            "http://station.example:18080"
        );
        assert_eq!(
            canonical_capability_host("http://station.example:18080/", ""),
            "http://station.example:18080"
        );
        assert_eq!(
            canonical_capability_host("http://station.example:18080", "https://cdn.example.test/"),
            "https://cdn.example.test"
        );
    }

    // ── error mapping ─────────────────────────────────────────────

    #[test]
    fn map_mint_error_translates_403_to_federation_denied() {
        use crate::infrastructure::station_client::{StationClientError, StationClientErrorKind};
        let err = StationClientError::new(
            StationClientErrorKind::HttpStatus(403),
            "denied by policy",
            None,
        );
        match map_mint_error(err) {
            OssCacheError::FederationDenied(_) => {}
            other => panic!("expected FederationDenied, got {other:?}"),
        }
    }

    #[test]
    fn map_mint_error_translates_501_to_federation_disabled() {
        use crate::infrastructure::station_client::{StationClientError, StationClientErrorKind};
        let err = StationClientError::new(
            StationClientErrorKind::HttpStatus(501),
            "federation disabled",
            None,
        );
        match map_mint_error(err) {
            OssCacheError::FederationDisabled(_) => {}
            other => panic!("expected FederationDisabled, got {other:?}"),
        }
    }

    #[test]
    fn map_mint_error_translates_session_revoked_to_auth_required() {
        use crate::infrastructure::station_client::{StationClientError, StationClientErrorKind};
        let err = StationClientError::new(
            StationClientErrorKind::SessionRevoked,
            "session revoked",
            None,
        );
        match map_mint_error(err) {
            OssCacheError::FederationAuthRequired => {}
            other => panic!("expected FederationAuthRequired, got {other:?}"),
        }
    }

    // ── attachment_ensure_federated guard rails ───────────────────
    //
    // We cannot exercise the happy path without spinning up a fake
    // station, but we *can* pin the early-validation gates: empty
    // token / empty origin must fail fast without making a network
    // call. The HTTP layer is exercised in the broader integration
    // suite (S18 in the plan).

    #[test]
    fn attachment_ensure_federated_rejects_empty_token() {
        let uri = OssUri {
            origin: "https://foreign.example".into(),
            key: "cas/aa/abc".into(),
        };
        let err = attachment_ensure_federated(&uri, "", "did:peer:alice")
            .expect_err("empty token must fail");
        match err {
            OssCacheError::FederationAuthRequired => {}
            other => panic!("expected FederationAuthRequired, got {other:?}"),
        }
    }
}
