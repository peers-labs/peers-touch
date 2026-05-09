// Domain model for local user profile management.
//
// Aggregates user identity metadata and local media asset paths into a single
// domain concept, replacing the scattered avatar_url-only approach.
//
// 2026-04-21: Created as part of "用户资料与媒体资产" data domain architecture completion.

use std::path::{Path, PathBuf};

/// Represents the locally-cached user profile, combining identity metadata
/// with local file paths for media assets (avatar, header, etc.).
#[derive(Debug, Clone)]
pub struct LocalUserProfile {
    pub account_id: String,
    pub name: String,
    pub email: String,
    /// Remote avatar URL from Station or OAuth provider.
    pub avatar_remote_url: String,
    /// Local file path for the cached avatar image (if downloaded).
    pub avatar_local_path: Option<PathBuf>,
    pub profile_url: String,
    pub provider: String,
}

impl LocalUserProfile {
    /// Returns the best available avatar source: local path first, remote URL fallback.
    pub fn effective_avatar(&self) -> Option<AvatarSource> {
        if let Some(ref local) = self.avatar_local_path {
            if local.exists() {
                return Some(AvatarSource::Local(local.clone()));
            }
        }
        if !self.avatar_remote_url.is_empty() {
            return Some(AvatarSource::Remote(self.avatar_remote_url.clone()));
        }
        None
    }

    /// Whether the avatar needs to be downloaded (remote URL exists but no valid local file).
    pub fn needs_avatar_download(&self) -> bool {
        if self.avatar_remote_url.is_empty() {
            return false;
        }
        match &self.avatar_local_path {
            Some(p) => !p.exists(),
            None => true,
        }
    }
}

/// Describes where an avatar image should be loaded from.
#[derive(Debug, Clone)]
pub enum AvatarSource {
    /// Absolute path to a locally cached file.
    Local(PathBuf),
    /// Remote URL (Station OSS or OAuth provider).
    Remote(String),
}

/// Derives a deterministic local filename from a remote URL.
/// Uses SHA-256 hash of the URL to avoid path conflicts and special characters.
pub fn avatar_local_filename(remote_url: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = hex::encode(Sha256::digest(remote_url.as_bytes()));
    // Attempt to preserve the original file extension.
    let ext = Path::new(remote_url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("img");
    // Clean extension: only keep alphanumeric chars, max 4 chars.
    let clean_ext: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(4)
        .collect();
    let ext_final = if clean_ext.is_empty() {
        "img"
    } else {
        &clean_ext
    };
    format!("{}.{}", &hash[..16], ext_final)
}
