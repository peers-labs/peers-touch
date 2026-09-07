use messaging_core::attachment::{ATTACHMENT_CHUNK_SIZE, ATTACHMENT_MAX_PLAINTEXT_SIZE};
use messaging_core::ports::AttachmentBlob;
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

pub struct FilesystemAttachmentBlob {
    root: PathBuf,
}

impl FilesystemAttachmentBlob {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        let root = normalize_absolute_path(root.as_ref())?;
        fs::create_dir_all(&root)
            .map_err(|error| format!("create mobile messaging attachment blob root: {error}"))?;
        let root = fs::canonicalize(root).map_err(|error| {
            format!("canonicalize mobile messaging attachment blob root: {error}")
        })?;
        if !root.is_dir() {
            return Err("mobile messaging attachment blob root is not a directory".to_string());
        }
        Ok(Self { root })
    }

    fn path(&self, blob_ref: &str) -> Result<PathBuf, String> {
        let requested = Path::new(blob_ref);
        if blob_ref.trim().is_empty() || !requested.is_absolute() {
            return Err(
                "mobile messaging attachment blob requires an app-data-rooted absolute ref"
                    .to_string(),
            );
        }
        let resolved = resolve_allow_missing(requested)?;
        if !resolved.starts_with(&self.root) {
            return Err("mobile messaging attachment blob ref escapes its bound root".to_string());
        }
        Ok(resolved)
    }
}

impl AttachmentBlob for FilesystemAttachmentBlob {
    fn exists(&self, blob_ref: &str) -> Result<bool, String> {
        self.path(blob_ref)?
            .try_exists()
            .map_err(|error| format!("check mobile messaging attachment blob: {error}"))
    }

    fn len(&self, blob_ref: &str) -> Result<u64, String> {
        fs::metadata(self.path(blob_ref)?)
            .map(|metadata| metadata.len())
            .map_err(|error| format!("stat mobile messaging attachment blob: {error}"))
    }

    fn read_chunk(&self, blob_ref: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        validate_random_access(offset, length)?;
        let mut file = File::open(self.path(blob_ref)?)
            .map_err(|error| format!("open mobile messaging attachment blob: {error}"))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| format!("seek mobile messaging attachment blob: {error}"))?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes)
            .map_err(|error| format!("read mobile messaging attachment blob chunk: {error}"))?;
        Ok(bytes)
    }

    fn write_chunk(&self, blob_ref: &str, offset: u64, data: &[u8]) -> Result<(), String> {
        validate_random_access(offset, data.len())?;
        let path = self.path(blob_ref)?;
        let parent = path
            .parent()
            .ok_or_else(|| "mobile messaging attachment blob parent is unavailable".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!("create mobile messaging attachment blob directory: {error}")
        })?;
        if !resolve_allow_missing(parent)?.starts_with(&self.root) {
            return Err(
                "mobile messaging attachment blob parent escapes its bound root".to_string(),
            );
        }
        let mut options = OpenOptions::new();
        options.create(true).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(path)
            .map_err(|error| format!("open writable mobile messaging attachment blob: {error}"))?;
        file.seek(SeekFrom::Start(offset))
            .and_then(|_| file.write_all(data))
            .and_then(|_| file.sync_data())
            .map_err(|error| format!("write mobile messaging attachment blob chunk: {error}"))
    }

    fn truncate(&self, blob_ref: &str, length: u64) -> Result<(), String> {
        if length > ATTACHMENT_MAX_PLAINTEXT_SIZE {
            return Err("mobile messaging attachment blob length exceeds policy".to_string());
        }
        let file = OpenOptions::new()
            .write(true)
            .open(self.path(blob_ref)?)
            .map_err(|error| {
                format!("open mobile messaging attachment blob for truncate: {error}")
            })?;
        file.set_len(length)
            .and_then(|_| file.sync_data())
            .map_err(|error| format!("truncate mobile messaging attachment blob: {error}"))
    }

    fn sha256(&self, blob_ref: &str) -> Result<[u8; 32], String> {
        let mut file = File::open(self.path(blob_ref)?).map_err(|error| {
            format!("open mobile messaging attachment blob for hashing: {error}")
        })?;
        let mut hash = Sha256::new();
        let mut buffer = vec![0; ATTACHMENT_CHUNK_SIZE as usize];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("hash mobile messaging attachment blob: {error}"))?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
        }
        Ok(hash.finalize().into())
    }

    fn promote(&self, source_ref: &str, target_ref: &str) -> Result<(), String> {
        let source = self.path(source_ref)?;
        let target = self.path(target_ref)?;
        let parent = target.parent().ok_or_else(|| {
            "mobile messaging attachment blob target parent is unavailable".to_string()
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            format!("create mobile messaging attachment blob directory: {error}")
        })?;
        if !resolve_allow_missing(parent)?.starts_with(&self.root) {
            return Err(
                "mobile messaging attachment blob parent escapes its bound root".to_string(),
            );
        }
        File::open(&source)
            .and_then(|file| file.sync_all())
            .map_err(|error| {
                format!("sync mobile messaging attachment blob before promotion: {error}")
            })?;
        fs::rename(source, &target)
            .map_err(|error| format!("promote mobile messaging attachment blob: {error}"))?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("sync mobile messaging attachment blob directory: {error}"))?;
        Ok(())
    }

    fn remove(&self, blob_ref: &str) -> Result<(), String> {
        match fs::remove_file(self.path(blob_ref)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("remove mobile messaging attachment blob: {error}")),
        }
    }
}

fn resolve_allow_missing(path: &Path) -> Result<PathBuf, String> {
    let normalized = normalize_absolute_path(path)?;
    let mut existing = normalized.as_path();
    let mut missing = Vec::<OsString>::new();
    loop {
        match fs::symlink_metadata(existing) {
            Ok(_) => {
                let mut resolved = fs::canonicalize(existing).map_err(|error| {
                    format!("resolve mobile messaging attachment blob ref: {error}")
                })?;
                for component in missing.iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let component = existing.file_name().ok_or_else(|| {
                    "mobile messaging attachment blob ref has no existing ancestor".to_string()
                })?;
                missing.push(component.to_os_string());
                existing = existing.parent().ok_or_else(|| {
                    "mobile messaging attachment blob ref has no existing ancestor".to_string()
                })?;
            }
            Err(error) => {
                return Err(format!(
                    "inspect mobile messaging attachment blob ref: {error}"
                ))
            }
        }
    }
}

fn normalize_absolute_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("mobile messaging attachment blob path must be absolute".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new(std::path::MAIN_SEPARATOR_STR)),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(
                        "mobile messaging attachment blob path escapes filesystem root".to_string(),
                    );
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    Ok(normalized)
}

fn validate_random_access(offset: u64, length: usize) -> Result<(), String> {
    if length == 0 || length > ATTACHMENT_CHUNK_SIZE as usize {
        return Err("mobile messaging attachment blob chunk exceeds policy".to_string());
    }
    let end = offset
        .checked_add(length as u64)
        .ok_or_else(|| "mobile messaging attachment blob range overflow".to_string())?;
    if end > ATTACHMENT_MAX_PLAINTEXT_SIZE {
        return Err("mobile messaging attachment blob range exceeds policy".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ulid::Ulid;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("pt-mobile-attachment-blob-{}", Ulid::new()))
    }

    #[test]
    fn filesystem_blob_supports_bounded_random_access_hash_and_promotion() {
        let root = temp_root();
        let blobs = FilesystemAttachmentBlob::new(&root).unwrap();
        let partial = root.join("partial/blob.part");
        let cache = root.join("cache/blob");
        let partial_ref = partial.to_string_lossy();
        let cache_ref = cache.to_string_lossy();
        let expected_hash: [u8; 32] = Sha256::digest(b"abcdef").into();

        blobs.write_chunk(&partial_ref, 3, b"def").unwrap();
        blobs.write_chunk(&partial_ref, 0, b"abc").unwrap();
        assert_eq!(blobs.len(&partial_ref).unwrap(), 6);
        assert_eq!(blobs.read_chunk(&partial_ref, 1, 4).unwrap(), b"bcde");
        assert_eq!(blobs.sha256(&partial_ref).unwrap(), expected_hash);

        blobs.truncate(&partial_ref, 5).unwrap();
        blobs.promote(&partial_ref, &cache_ref).unwrap();
        assert!(!blobs.exists(&partial_ref).unwrap());
        assert_eq!(blobs.read_chunk(&cache_ref, 0, 5).unwrap(), b"abcde");

        blobs.remove(&cache_ref).unwrap();
        blobs.remove(&cache_ref).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn filesystem_blob_rejects_unrooted_outside_or_unbounded_access() {
        let root = temp_root();
        let blobs = FilesystemAttachmentBlob::new(&root).unwrap();
        let outside = root
            .parent()
            .unwrap()
            .join(format!("outside-{}", Ulid::new()));
        assert!(blobs.exists("relative/blob").is_err());
        assert!(blobs.exists(outside.to_string_lossy().as_ref()).is_err());
        assert!(blobs
            .exists(root.join("nested/../../outside").to_string_lossy().as_ref())
            .is_err());
        assert!(blobs
            .read_chunk(
                root.join("blob").to_string_lossy().as_ref(),
                0,
                ATTACHMENT_CHUNK_SIZE as usize + 1,
            )
            .is_err());
        assert!(blobs
            .write_chunk(
                root.join("blob").to_string_lossy().as_ref(),
                ATTACHMENT_MAX_PLAINTEXT_SIZE,
                &[1],
            )
            .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn filesystem_blob_rejects_existing_symlink_escape_for_missing_target() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = temp_root();
        fs::create_dir_all(&outside).unwrap();
        let blobs = FilesystemAttachmentBlob::new(&root).unwrap();
        symlink(&outside, root.join("link")).unwrap();

        let escaped = root.join("link/missing/blob");
        assert!(blobs
            .write_chunk(escaped.to_string_lossy().as_ref(), 0, b"blocked")
            .is_err());
        assert!(!outside.join("missing/blob").exists());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
