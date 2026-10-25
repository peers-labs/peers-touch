//! Native byte access after the owning Engine has authorized private metadata.
//! Grants belong to one Engine activation and one presentation owner. Paths
//! never cross the presentation boundary.

use secure_content_core::file_access::{copy_verified, safe_filename};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use ulid::Ulid;

const GRANT_LIFETIME: Duration = Duration::from_secs(60 * 60);
const MAX_GRANTS: usize = 256;
const MAX_ASSET_READ: u64 = 8 * 1024 * 1024;
const HANDOFF_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_HANDOFF_COPIES: usize = 32;

pub fn attachment_asset_url(handle: &str) -> String {
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        format!("http://chat-file.localhost/{handle}")
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        format!("chat-file://localhost/{handle}")
    }
}

#[derive(Clone)]
struct Grant {
    owner: String,
    attachment_id: String,
    root: PathBuf,
    filename: String,
    mime_type: String,
    size: u64,
    sha256: [u8; 32],
    touched: Instant,
    file: Arc<Mutex<File>>,
    revoked: Arc<AtomicBool>,
}

/// An Engine owns this registry; replacing or suspending it revokes access.
#[derive(Default)]
pub struct AttachmentFileAccess {
    grants: Mutex<HashMap<String, Grant>>,
    disabled: AtomicBool,
    epoch: AtomicU64,
    staging: Mutex<()>,
}

pub struct AttachmentAsset {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub total: u64,
    pub start: u64,
    pub end: u64,
    pub partial: bool,
}

impl AttachmentFileAccess {
    #[allow(clippy::too_many_arguments)]
    pub fn grant(
        &self,
        owner: &str,
        attachment_id: &str,
        root: &Path,
        path: &Path,
        filename: &str,
        mime_type: &str,
        size: u64,
        sha256: &[u8],
    ) -> Result<String, String> {
        let epoch = self.epoch();
        if self.disabled.load(Ordering::Acquire) {
            return Err("FILE_ACCESS_STALE".into());
        }
        let sha256: [u8; 32] = sha256.try_into().map_err(|_| "FILE_COMMITMENT_INVALID")?;
        let root = root.canonicalize().map_err(|_| "FILE_ROOT_UNAVAILABLE")?;
        let path = owned_file(&root, path)?;
        // Slow disk verification never holds the registry/revocation mutex.
        let mut file = open_cache_file(&path)?;
        let verified = copy_verified(
            ScopedCacheReader { file: &mut file, access: self, epoch },
            std::io::sink(), size, &sha256,
        );
        if !self.epoch_is_current(epoch) {
            return Err("FILE_ACCESS_STALE".into());
        }
        verified.map_err(|_| "FILE_INTEGRITY_FAILED")?;
        file.rewind().map_err(|_| "FILE_READ_FAILED")?;
        let mut grants = self.grants.lock().map_err(|_| "FILE_ACCESS_UNAVAILABLE")?;
        if !self.epoch_is_current(epoch) {
            return Err("FILE_ACCESS_STALE".into());
        }
        grants.retain(|_, grant| {
            let current = grant.touched.elapsed() < GRANT_LIFETIME;
            if !current {
                grant.revoked.store(true, Ordering::Release);
            }
            current
        });
        // A fresh read has a distinct grant. Revoking a late read must never
        // invalidate a newer preview or system action for the same attachment.
        if grants.len() >= MAX_GRANTS {
            return Err("FILE_ACCESS_CAPACITY".into());
        }
        let handle = Ulid::new().to_string();
        grants.insert(
            handle.clone(),
            Grant {
                owner: owner.into(),
                attachment_id: attachment_id.into(),
                root,
                filename: safe_filename(filename),
                mime_type: preview_mime(mime_type, filename),
                size,
                sha256,
                touched: Instant::now(),
                file: Arc::new(Mutex::new(file)),
                revoked: Arc::new(AtomicBool::new(false)),
            },
        );
        Ok(handle)
    }

    pub fn release(&self, owner: &str, handle: &str) {
        if let Ok(mut grants) = self.grants.lock() {
            if grants.get(handle).is_some_and(|grant| grant.owner == owner) {
                if let Some(grant) = grants.remove(handle) {
                    grant.revoked.store(true, Ordering::Release);
                }
            }
        }
    }

    pub fn revoke_all(&self) {
        self.disabled.store(true, Ordering::Release);
        self.revoke_grants();
    }

    pub fn revoke_grants(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut grants) = self.grants.lock() {
            for grant in grants.values() {
                grant.revoked.store(true, Ordering::Release);
            }
            grants.clear();
        }
    }

    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    pub fn epoch_is_current(&self, epoch: u64) -> bool {
        !self.disabled.load(Ordering::Acquire) && self.epoch() == epoch
    }

    /// Only the owning Runtime may reopen admission after a suspended scope.
    pub fn resume(&self) {
        self.disabled.store(false, Ordering::Release);
    }

    pub fn attachment_id(&self, owner: &str, handle: &str) -> Result<String, String> {
        self.with_grant(owner, handle, |grant| Ok(grant.attachment_id.clone()))
    }

    pub fn filename(&self, owner: &str, handle: &str) -> Result<String, String> {
        self.with_grant(owner, handle, |grant| Ok(grant.filename.clone()))
    }

    pub fn read_asset(
        &self,
        owner: &str,
        handle: &str,
        range: Option<&str>,
        head: bool,
    ) -> Result<AttachmentAsset, String> {
        self.with_grant(owner, handle, |grant| {
            let (start, end, partial) = byte_range(range, grant.size, head)?;
            let mut file = grant.file.lock().map_err(|_| "FILE_READ_FAILED")?;
            let mut bytes = Vec::new();
            if !head && grant.size != 0 {
                file.seek(SeekFrom::Start(start))
                    .map_err(|_| "FILE_READ_FAILED")?;
                let count = end - start + 1;
                bytes.resize(count as usize, 0);
                file.read_exact(&mut bytes)
                    .map_err(|_| "FILE_READ_FAILED")?;
            }
            Ok(AttachmentAsset {
                bytes,
                mime_type: grant.mime_type.clone(),
                total: grant.size,
                start,
                end,
                partial,
            })
        })
    }

    /// OS adapters receive only an independent, byte-verified disposable copy.
    /// Successful copies remain available for external readers until retention.
    pub fn stage_copy(
        &self,
        owner: &str,
        handle: &str,
        staging_root: &Path,
    ) -> Result<PathBuf, String> {
        let _staging = self
            .staging
            .lock()
            .map_err(|_| "FILE_STAGING_UNAVAILABLE")?;
        fs::create_dir_all(staging_root).map_err(|_| "FILE_STAGING_UNAVAILABLE")?;
        let root = staging_root
            .canonicalize()
            .map_err(|_| "FILE_STAGING_UNAVAILABLE")?;
        let entries = fs::read_dir(&root).map_err(|_| "FILE_STAGING_UNAVAILABLE")?;
        let mut retained = 0;
        for entry in entries {
            let entry = entry.map_err(|_| "FILE_STAGING_UNAVAILABLE")?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.parse::<Ulid>().is_err() || !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let expired = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age > HANDOFF_LIFETIME);
            if expired {
                fs::remove_dir_all(entry.path()).map_err(|_| "FILE_STAGING_CLEANUP_FAILED")?;
            } else {
                retained += 1;
            }
        }
        if retained >= MAX_HANDOFF_COPIES {
            return Err("FILE_STAGING_CAPACITY".into());
        }
        let directory = root.join(Ulid::new().to_string());
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).map_err(|_| "FILE_STAGING_UNAVAILABLE")?;
        let result = self.with_grant(owner, handle, |grant| {
            let destination = directory.join(&grant.filename);
            verified_copy(grant, &destination)?;
            Ok(destination)
        });
        if result.is_err() {
            let _ = fs::remove_dir_all(directory);
        }
        result
    }

    /// Remove only a Host-owned copy directory, never an exported destination.
    pub fn discard_copy(staging_root: &Path, copy: &Path) -> Result<(), String> {
        let root = staging_root.canonicalize().map_err(|_| "FILE_STAGING_UNAVAILABLE")?;
        let directory = copy.parent().ok_or("FILE_STAGING_INVALID")?;
        if directory.parent() != Some(root.as_path())
            || directory.file_name().and_then(|name| name.to_str())
                .is_none_or(|name| name.parse::<Ulid>().is_err())
            || fs::symlink_metadata(directory)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err("FILE_STAGING_INVALID".into());
        }
        match fs::remove_dir_all(directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("FILE_STAGING_CLEANUP_FAILED".into()),
        }
    }

    /// Destination was selected by the OS adapter. Publish only verified bytes;
    /// failure leaves the existing destination untouched.
    pub fn save_copy(&self, owner: &str, handle: &str, destination: &Path) -> Result<(), String> {
        self.with_grant(owner, handle, |grant| {
            if fs::symlink_metadata(destination)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                return Err("FILE_DESTINATION_INVALID".into());
            }
            let parent = destination.parent().ok_or("FILE_DESTINATION_INVALID")?;
            let parent = parent
                .canonicalize()
                .map_err(|_| "FILE_DESTINATION_INVALID")?;
            if parent.starts_with(&grant.root) {
                return Err("FILE_DESTINATION_IS_CACHE".into());
            }
            let temporary = parent.join(format!(".pt-export-{}", Ulid::new()));
            let result = verified_copy(grant, &temporary).and_then(|()| {
                if grant.revoked.load(Ordering::Acquire) {
                    return Err("FILE_ACCESS_STALE".into());
                }
                fs::rename(&temporary, destination).map_err(|_| "FILE_EXPORT_FAILED".into())
            });
            if result.is_err() {
                let _ = fs::remove_file(temporary);
            }
            result
        })
    }

    fn with_grant<T>(
        &self,
        owner: &str,
        handle: &str,
        operation: impl FnOnce(&Grant) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut grants = self.grants.lock().map_err(|_| "FILE_ACCESS_UNAVAILABLE")?;
        if self.disabled.load(Ordering::Acquire) {
            return Err("FILE_ACCESS_STALE".into());
        }
        let grant = grants.get_mut(handle).ok_or("FILE_ACCESS_STALE")?;
        if grant.owner != owner || grant.touched.elapsed() >= GRANT_LIFETIME {
            return Err("FILE_ACCESS_STALE".into());
        }
        grant.touched = Instant::now();
        let grant = grant.clone();
        drop(grants);
        if grant.revoked.load(Ordering::Acquire) {
            return Err("FILE_ACCESS_STALE".into());
        }
        let result = operation(&grant)?;
        if grant.revoked.load(Ordering::Acquire) {
            return Err("FILE_ACCESS_STALE".into());
        }
        Ok(result)
    }
}

struct ScopedCacheReader<'a> {
    file: &'a mut File,
    access: &'a AttachmentFileAccess,
    epoch: u64,
}

impl Read for ScopedCacheReader<'_> {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        if !self.access.epoch_is_current(self.epoch) {
            return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "file access revoked"));
        }
        self.file.read(bytes)
    }
}

fn owned_file(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "FILE_CACHE_UNAVAILABLE")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("FILE_CACHE_INVALID".into());
    }
    let canonical = path.canonicalize().map_err(|_| "FILE_CACHE_UNAVAILABLE")?;
    if !canonical.starts_with(root) {
        return Err("FILE_CACHE_OUTSIDE_SCOPE".into());
    }
    Ok(canonical)
}

fn open_cache_file(path: &Path) -> Result<File, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
            .open(path)
            .map_err(|_| "FILE_CACHE_UNAVAILABLE".into())
    }
    #[cfg(not(unix))]
    {
        File::open(path).map_err(|_| "FILE_CACHE_UNAVAILABLE".into())
    }
}

fn verified_copy(grant: &Grant, destination: &Path) -> Result<(), String> {
    let mut source = grant.file.lock().map_err(|_| "FILE_READ_FAILED")?;
    source.rewind().map_err(|_| "FILE_READ_FAILED")?;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut target = options.open(destination)
        .map_err(|_| "FILE_COPY_FAILED")?;
    copy_verified(&mut *source, &mut target, grant.size, &grant.sha256)
        .and_then(|_| target.sync_all())
        .map_err(|_| "FILE_INTEGRITY_FAILED".to_string())
}

fn preview_mime(mime: &str, filename: &str) -> String {
    let declared = mime.split(';').next().unwrap_or("").trim().to_lowercase();
    let normalized = match declared.as_str() {
        "audio/m4a" | "audio/x-m4a" => "audio/mp4",
        "audio/x-wav" => "audio/wav",
        _ => declared.as_str(),
    };
    let extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let inferred = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    };
    let mime = if normalized.is_empty() || normalized == "application/octet-stream" {
        inferred
    } else {
        normalized
    };
    match mime {
        "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" | "audio/mpeg"
        | "audio/mp4" | "audio/ogg" | "audio/wav" | "audio/webm" | "video/mp4" | "video/webm"
        | "video/ogg" | "application/pdf" => mime,
        _ if mime.starts_with("text/") => "text/plain",
        _ => "application/octet-stream",
    }
    .into()
}

fn byte_range(range: Option<&str>, size: u64, head: bool) -> Result<(u64, u64, bool), String> {
    if head || size == 0 {
        return Ok((0, size.saturating_sub(1), false));
    }
    let (start, requested_end) = match range {
        Some(range) => {
            let (start, end) = range
                .strip_prefix("bytes=")
                .and_then(|value| value.split_once('-'))
                .ok_or("FILE_RANGE_INVALID")?;
            if start.is_empty() {
                let suffix: u64 = end.parse().map_err(|_| "FILE_RANGE_INVALID")?;
                if suffix == 0 {
                    return Err("FILE_RANGE_INVALID".into());
                }
                (size.saturating_sub(suffix), size - 1)
            } else {
                (
                    start.parse().map_err(|_| "FILE_RANGE_INVALID")?,
                    if end.is_empty() {
                        size - 1
                    } else {
                        end.parse().map_err(|_| "FILE_RANGE_INVALID")?
                    },
                )
            }
        }
        None => (0, size - 1),
    };
    if start >= size || requested_end < start {
        return Err("FILE_RANGE_INVALID".into());
    }
    let end = requested_end
        .min(size - 1)
        .min(start.saturating_add(MAX_ASSET_READ - 1));
    Ok((start, end, range.is_some() || start != 0 || end != size - 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("pt-file-access-{}", Ulid::new()));
            fs::create_dir_all(root.join("cache")).unwrap();
            Self(root)
        }
        fn grant(&self, access: &AttachmentFileAccess, owner: &str) -> String {
            let bytes = b"immutable report bytes";
            let path = self.0.join("cache/file");
            fs::write(&path, bytes).unwrap();
            access
                .grant(
                    owner,
                    "attachment",
                    &self.0.join("cache"),
                    &path,
                    "../Report.txt",
                    "text/html",
                    bytes.len() as u64,
                    &Sha256::digest(bytes),
                )
                .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn copies_are_independent_and_exports_survive_cache_removal() {
        let fixture = Fixture::new();
        let access = AttachmentFileAccess::default();
        let handle = fixture.grant(&access, "window:activation");
        let staged = access
            .stage_copy("window:activation", &handle, &fixture.0.join("handoff"))
            .unwrap();
        assert_eq!(staged.file_name().unwrap(), "Report.txt");
        fs::write(&staged, b"external edits").unwrap();
        assert_eq!(
            fs::read(fixture.0.join("cache/file")).unwrap(),
            b"immutable report bytes"
        );
        let saved = fixture.0.join("saved.txt");
        access
            .save_copy("window:activation", &handle, &saved)
            .unwrap();
        assert!(access
            .save_copy(
                "window:activation",
                &handle,
                &fixture.0.join("cache/overwrite.txt")
            )
            .is_err());
        fs::remove_dir_all(fixture.0.join("cache")).unwrap();
        assert_eq!(fs::read(saved).unwrap(), b"immutable report bytes");
    }

    #[test]
    fn stale_scope_and_integrity_mismatch_cannot_publish_a_copy() {
        let fixture = Fixture::new();
        let access = AttachmentFileAccess::default();
        let handle = fixture.grant(&access, "window:activation");
        assert!(access
            .read_asset("window:new-activation", &handle, None, false)
            .is_err());
        fs::write(fixture.0.join("cache/file"), b"corrupt").unwrap();
        let saved = fixture.0.join("existing.txt");
        fs::write(&saved, b"keep existing").unwrap();
        assert!(access
            .save_copy("window:activation", &handle, &saved)
            .is_err());
        assert_eq!(fs::read(&saved).unwrap(), b"keep existing");
        access.revoke_all();
        assert!(access
            .read_asset("window:activation", &handle, None, false)
            .is_err());
        assert!(access
            .grant(
                "window:activation",
                "attachment",
                &fixture.0,
                &saved,
                "a.txt",
                "text/plain",
                13,
                &Sha256::digest(b"keep existing")
            )
            .is_err());
    }

    #[test]
    fn asset_ranges_are_bounded_and_active_content_is_plain_text() {
        let fixture = Fixture::new();
        let access = AttachmentFileAccess::default();
        let handle = fixture.grant(&access, "window");
        let asset = access
            .read_asset("window", &handle, Some("bytes=2-5"), false)
            .unwrap();
        assert_eq!(asset.bytes, b"muta");
        assert_eq!(asset.mime_type, "text/plain");
        assert_eq!(preview_mime("audio/m4a", "sound.m4a"), "audio/mp4");
        assert_eq!(preview_mime("audio/x-m4a", "sound.m4a"), "audio/mp4");
        assert_eq!(preview_mime("audio/x-wav", "sound.wav"), "audio/wav");
        assert_eq!(
            byte_range(None, 100 * 1024 * 1024, false).unwrap(),
            (0, MAX_ASSET_READ - 1, true)
        );
        assert!(byte_range(Some("bytes=99-100"), 10, false).is_err());
        assert!(byte_range(Some("bytes=0-2,4-6"), 10, false).is_err());
        access.release("window", &handle);
        assert!(access.read_asset("window", &handle, None, false).is_err());
    }

    #[test]
    fn late_release_is_scoped_to_its_own_read_grant() {
        let fixture = Fixture::new();
        let access = AttachmentFileAccess::default();
        let old = fixture.grant(&access, "window");
        let current = fixture.grant(&access, "window");
        assert_ne!(old, current);
        access.release("other-window", &current);
        access.release("window", &old);
        assert!(access.read_asset("window", &old, None, false).is_err());
        assert_eq!(
            access.read_asset("window", &current, None, false).unwrap().bytes,
            b"immutable report bytes"
        );
        access.revoke_grants();
        assert!(access.read_asset("window", &current, None, false).is_err());
        let renewed = fixture.grant(&access, "window");
        assert!(access.read_asset("window", &renewed, None, false).is_ok());
    }

    #[test]
    fn discarded_handoff_is_private_and_cannot_remove_an_export() {
        let fixture = Fixture::new();
        let access = AttachmentFileAccess::default();
        let handle = fixture.grant(&access, "window");
        let root = fixture.0.join("handoff");
        let staged = access.stage_copy("window", &handle, &root).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&staged).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(staged.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
        }
        let export = fixture.0.join("saved.txt");
        access.save_copy("window", &handle, &export).unwrap();
        assert!(AttachmentFileAccess::discard_copy(&root, &export).is_err());
        AttachmentFileAccess::discard_copy(&root, &staged).unwrap();
        assert!(!staged.parent().unwrap().exists());
        assert_eq!(fs::read(&export).unwrap(), b"immutable report bytes");
        assert_eq!(fs::read(fixture.0.join("cache/file")).unwrap(), b"immutable report bytes");
    }

    #[test]
    fn suspension_revokes_verification_and_preserves_the_epoch_fence_after_resume() {
        let fixture = Fixture::new();
        let access = AttachmentFileAccess::default();
        let handle = fixture.grant(&access, "window");
        let epoch = access.epoch();
        let mut file = File::open(fixture.0.join("cache/file")).unwrap();
        let mut reader = ScopedCacheReader { file: &mut file, access: &access, epoch };
        access.revoke_all();
        assert!(reader.read(&mut [0; 8]).is_err());
        assert!(access.read_asset("window", &handle, None, false).is_err());
        access.resume();
        assert!(!access.epoch_is_current(epoch));
        assert!(reader.read(&mut [0; 8]).is_err());
        let current = fixture.grant(&access, "window");
        assert!(access.read_asset("window", &current, None, false).is_ok());
    }
}
