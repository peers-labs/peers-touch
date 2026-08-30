// Avatar cache infrastructure.
//
// Single source of truth for the local on-disk cache of user avatar images.
// Other modules (auth_identity, application::profile, interface commands) MUST
// go through this module instead of duplicating download / path logic.
//
// 2026-04-25: Extracted from auth_identity to honor single-responsibility
//             — identity stores *who*, this module stores *files*.

use std::fs;
use std::path::PathBuf;

use crate::domain::user_profile;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind};

/// Errors surfaced by the avatar cache layer.
#[derive(Debug)]
pub enum AvatarCacheError {
    /// Caller passed an empty / blank URL — nothing to fetch.
    EmptyUrl,
    /// Local filesystem failure (could not create dir, write file, etc.).
    Io(String),
    /// Network or HTTP failure while downloading from Station.
    Download(String),
    /// Failed to resolve the cache directory path.
    Storage(String),
}

impl std::fmt::Display for AvatarCacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyUrl => write!(f, "empty avatar URL"),
            Self::Io(msg) => write!(f, "avatar io failure: {msg}"),
            Self::Download(msg) => write!(f, "avatar download failure: {msg}"),
            Self::Storage(msg) => write!(f, "avatar storage failure: {msg}"),
        }
    }
}

/// Returns the directory that holds locally cached avatar images.
/// Caller is responsible for creating the directory if it does not yet exist
/// (the cache module does so before any write).
pub fn avatars_dir() -> Result<PathBuf, AvatarCacheError> {
    storage::app_file_path("desktop", StorageKind::Data, &["files", "avatars"])
        .map_err(|err| AvatarCacheError::Storage(format!("{err:?}")))
}

/// Look up the cached file for `remote_url` *without* attempting any download.
///
/// Returns `Some(path)` only when the file exists on disk and is non-empty.
pub fn lookup(remote_url: &str) -> Option<PathBuf> {
    let identity = canonical_remote_identity(remote_url).ok()?;
    let dir = avatars_dir().ok()?;
    let path = dir.join(user_profile::avatar_local_filename(&identity));
    if path_is_present(&path) {
        Some(path)
    } else {
        None
    }
}

/// Resolve the local file for `remote_url`, downloading it from Station if
/// it is not yet cached.
///
/// Behavior:
/// 1. Empty URL → `EmptyUrl`.
/// 2. Cache hit  → returned immediately.
/// 3. Cache miss → fetch via HTTP and persist; return the new path.
///
/// Honors the project rule: the avatar component should *always* render a
/// local file. Network or filesystem failures bubble up so the caller can
/// either fall back to the unified placeholder or retry later.
pub fn ensure_local(remote_url: &str) -> Result<PathBuf, AvatarCacheError> {
    let identity = canonical_remote_identity(remote_url)?;
    let url = absolute_url(&identity)?;

    if let Some(path) = lookup(&identity) {
        return Ok(path);
    }

    let dir = avatars_dir()?;
    fs::create_dir_all(&dir).map_err(|e| AvatarCacheError::Io(e.to_string()))?;

    let dest = dir.join(user_profile::avatar_local_filename(&identity));

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AvatarCacheError::Download(e.to_string()))?;
    let response = client
        .get(&url)
        .send()
        .map_err(|e| AvatarCacheError::Download(e.to_string()))?;
    if !response.status().is_success() {
        return Err(AvatarCacheError::Download(format!(
            "status {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .map_err(|e| AvatarCacheError::Download(e.to_string()))?;
    if bytes.is_empty() {
        return Err(AvatarCacheError::Download("empty body".to_string()));
    }

    fs::write(&dest, &bytes).map_err(|e| AvatarCacheError::Io(e.to_string()))?;
    Ok(dest)
}

/// Convenience wrapper for callers that prefer a string path and accept
/// silent failure (avatar will fall back to placeholder).
pub fn try_ensure_local_string(remote_url: &str) -> Option<String> {
    match ensure_local(remote_url) {
        Ok(path) => Some(path.to_string_lossy().to_string()),
        Err(AvatarCacheError::EmptyUrl) => None,
        Err(err) => {
            tracing::warn!(error = %err, url = %remote_url, "Avatar cache miss");
            None
        }
    }
}

fn path_is_present(path: &PathBuf) -> bool {
    path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

/// Preserve Station-owned media as a transport-independent path. A temporary
/// proxy or alternate Station route must not become part of avatar identity or
/// its content-addressed cache key.
pub fn canonical_remote_identity(remote_url: &str) -> Result<String, AvatarCacheError> {
    canonical_remote_identity_for_base(remote_url, &station_client::station_base_url())
}

fn canonical_remote_identity_for_base(
    remote_url: &str,
    station_base_url: &str,
) -> Result<String, AvatarCacheError> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty() {
        return Err(AvatarCacheError::EmptyUrl);
    }
    if trimmed.starts_with("/sub-oss/") {
        return Ok(trimmed.to_string());
    }

    let base = station_base_url.trim().trim_end_matches('/');
    if let Some(path) = trimmed.strip_prefix(base) {
        if path.starts_with("/sub-oss/") {
            return Ok(path.to_string());
        }
    }

    Ok(trimmed.to_string())
}

/// Normalize a possibly-relative Station URL (e.g. `/sub-oss/file?key=...`)
/// to an absolute URL so `reqwest` can issue the request.
fn absolute_url(remote_url: &str) -> Result<String, AvatarCacheError> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty() {
        return Err(AvatarCacheError::EmptyUrl);
    }
    if trimmed.starts_with('/') {
        Ok(format!("{}{}", station_client::station_base_url(), trimmed))
    } else {
        Ok(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::canonical_remote_identity_for_base;

    #[test]
    fn station_media_identity_does_not_include_the_active_transport_origin() {
        let path = "/sub-oss/file?key=avatars%2Falice.png";

        assert_eq!(
            canonical_remote_identity_for_base(path, "http://station.example")
                .expect("relative Station media identity"),
            path
        );
        assert_eq!(
            canonical_remote_identity_for_base(
                "http://127.0.0.1:49675/sub-oss/file?key=avatars%2Falice.png",
                "http://127.0.0.1:49675",
            )
            .expect("proxied Station media identity"),
            path
        );
    }

    #[test]
    fn external_media_identity_preserves_its_origin() {
        let url = "https://cdn.example.test/avatar/alice.png";

        assert_eq!(
            canonical_remote_identity_for_base(url, "http://station.example")
                .expect("external media identity"),
            url
        );
    }
}
