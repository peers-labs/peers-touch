use messaging_core::ports::AttachmentBlob;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

pub struct FilesystemAttachmentBlob;

impl AttachmentBlob for FilesystemAttachmentBlob {
    fn exists(&self, blob_ref: &str) -> Result<bool, String> {
        Path::new(blob_ref)
            .try_exists()
            .map_err(|error| format!("check messaging attachment blob: {error}"))
    }

    fn len(&self, blob_ref: &str) -> Result<u64, String> {
        fs::metadata(blob_ref)
            .map(|metadata| metadata.len())
            .map_err(|error| format!("stat messaging attachment blob: {error}"))
    }

    fn read_chunk(&self, blob_ref: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        let mut file = File::open(blob_ref)
            .map_err(|error| format!("open messaging attachment blob: {error}"))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| format!("seek messaging attachment blob: {error}"))?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes)
            .map_err(|error| format!("read messaging attachment blob chunk: {error}"))?;
        Ok(bytes)
    }

    fn write_chunk(&self, blob_ref: &str, offset: u64, data: &[u8]) -> Result<(), String> {
        let path = Path::new(blob_ref);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create messaging attachment blob directory: {error}"))?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|error| format!("open writable messaging attachment blob: {error}"))?;
        file.seek(SeekFrom::Start(offset))
            .and_then(|_| file.write_all(data))
            .and_then(|_| file.sync_data())
            .map_err(|error| format!("write messaging attachment blob chunk: {error}"))
    }

    fn truncate(&self, blob_ref: &str, length: u64) -> Result<(), String> {
        let file = OpenOptions::new()
            .write(true)
            .open(blob_ref)
            .map_err(|error| format!("open messaging attachment blob for truncate: {error}"))?;
        file.set_len(length)
            .and_then(|_| file.sync_data())
            .map_err(|error| format!("truncate messaging attachment blob: {error}"))
    }

    fn sha256(&self, blob_ref: &str) -> Result<[u8; 32], String> {
        let mut file = File::open(blob_ref)
            .map_err(|error| format!("open messaging attachment blob for hashing: {error}"))?;
        let mut hash = Sha256::new();
        let mut buffer = vec![0; 1024 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("hash messaging attachment blob: {error}"))?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
        }
        Ok(hash.finalize().into())
    }

    fn promote(&self, source_ref: &str, target_ref: &str) -> Result<(), String> {
        let target = Path::new(target_ref);
        let parent = target
            .parent()
            .ok_or_else(|| "messaging attachment blob target parent is unavailable".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("create messaging attachment blob directory: {error}"))?;
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(source_ref)
            .and_then(|source| source.sync_all())
            .map_err(|error| format!("sync messaging attachment blob before promotion: {error}"))?;
        fs::rename(source_ref, target)
            .map_err(|error| format!("promote messaging attachment blob: {error}"))?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("sync messaging attachment blob directory: {error}"))?;
        Ok(())
    }

    fn remove(&self, blob_ref: &str) -> Result<(), String> {
        match fs::remove_file(blob_ref) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("remove messaging attachment blob: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ulid::Ulid;

    fn temp_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!("pt-attachment-blob-{}", Ulid::new()))
            .join(label)
    }

    #[test]
    fn filesystem_blob_supports_random_access_hash_and_promotion() {
        let blobs = FilesystemAttachmentBlob;
        let partial = temp_path("partial/blob.part");
        let cache = temp_path("cache/blob");
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
    }
}
