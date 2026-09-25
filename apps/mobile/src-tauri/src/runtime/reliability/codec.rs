use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use super::error::{ReliabilityError, ReliabilityResult};

pub(crate) struct Encoder {
    bytes: Vec<u8>,
}

impl Encoder {
    pub(crate) fn new(magic: &[u8; 4]) -> Self {
        Self {
            bytes: magic.to_vec(),
        }
    }

    pub(crate) fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    pub(crate) fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }

    pub(crate) fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }

    pub(crate) fn fixed(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }

    pub(crate) fn bytes(&mut self, value: &[u8]) -> ReliabilityResult<()> {
        let length = u32::try_from(value.len())
            .map_err(|_| ReliabilityError::invalid("binary field exceeds u32 length"))?;
        self.u32(length);
        self.fixed(value);
        Ok(())
    }

    pub(crate) fn string(&mut self, value: &str) -> ReliabilityResult<()> {
        self.bytes(value.as_bytes())
    }

    pub(crate) fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

pub(crate) struct Decoder<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Decoder<'a> {
    pub(crate) fn new(bytes: &'a [u8], magic: &[u8; 4]) -> ReliabilityResult<Self> {
        if bytes.get(..4) != Some(magic.as_slice()) {
            return Err(ReliabilityError::corrupt("binary record magic mismatch"));
        }
        Ok(Self { bytes, cursor: 4 })
    }

    pub(crate) fn u8(&mut self) -> ReliabilityResult<u8> {
        let value = *self
            .bytes
            .get(self.cursor)
            .ok_or_else(|| ReliabilityError::corrupt("truncated u8 field"))?;
        self.cursor += 1;
        Ok(value)
    }

    pub(crate) fn u16(&mut self) -> ReliabilityResult<u16> {
        let value = self.take_fixed::<2>()?;
        Ok(u16::from_be_bytes(value))
    }

    pub(crate) fn u32(&mut self) -> ReliabilityResult<u32> {
        let value = self.take_fixed::<4>()?;
        Ok(u32::from_be_bytes(value))
    }

    pub(crate) fn take_fixed<const N: usize>(&mut self) -> ReliabilityResult<[u8; N]> {
        let end = self
            .cursor
            .checked_add(N)
            .ok_or_else(|| ReliabilityError::corrupt("binary cursor overflow"))?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or_else(|| ReliabilityError::corrupt("truncated fixed-size field"))?;
        self.cursor = end;
        value
            .try_into()
            .map_err(|_| ReliabilityError::corrupt("invalid fixed-size field"))
    }

    pub(crate) fn bytes(&mut self, maximum: usize) -> ReliabilityResult<Vec<u8>> {
        let length = usize::try_from(self.u32()?)
            .map_err(|_| ReliabilityError::corrupt("invalid binary field length"))?;
        if length > maximum {
            return Err(ReliabilityError::corrupt(
                "binary field exceeds its maximum length",
            ));
        }
        let end = self
            .cursor
            .checked_add(length)
            .ok_or_else(|| ReliabilityError::corrupt("binary cursor overflow"))?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or_else(|| ReliabilityError::corrupt("truncated byte field"))?;
        self.cursor = end;
        Ok(value.to_vec())
    }

    pub(crate) fn string(&mut self, maximum: usize) -> ReliabilityResult<String> {
        String::from_utf8(self.bytes(maximum)?)
            .map_err(|_| ReliabilityError::corrupt("binary string is not UTF-8"))
    }

    pub(crate) fn finish(self) -> ReliabilityResult<()> {
        if self.cursor != self.bytes.len() {
            return Err(ReliabilityError::corrupt(
                "binary record contains trailing bytes",
            ));
        }
        Ok(())
    }
}

pub(crate) fn read_file(path: &Path, maximum: usize) -> ReliabilityResult<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| ReliabilityError::io("inspect reliability file", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ReliabilityError::corrupt(format!(
            "reliability path is not a regular file: {}",
            path.display()
        )));
    }
    if metadata.len() > maximum as u64 {
        return Err(ReliabilityError::corrupt(format!(
            "reliability file exceeds size limit: {}",
            path.display()
        )));
    }
    let mut file =
        File::open(path).map_err(|error| ReliabilityError::io("open reliability file", error))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| ReliabilityError::io("read reliability file", error))?;
    Ok(bytes)
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> ReliabilityResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| ReliabilityError::invalid("reliability path has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|error| ReliabilityError::io("create reliability directory", error))?;
    reject_symlink(parent)?;

    let temporary = temporary_path(path)?;
    remove_regular_file_if_exists(&temporary)?;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| ReliabilityError::io("create reliability temporary file", error))?;
    file.write_all(bytes)
        .map_err(|error| ReliabilityError::io("write reliability temporary file", error))?;
    file.sync_all()
        .map_err(|error| ReliabilityError::io("sync reliability temporary file", error))?;
    drop(file);
    fs::rename(&temporary, path)
        .map_err(|error| ReliabilityError::io("commit reliability file", error))?;
    sync_directory(parent)
}

pub(crate) fn remove_regular_file_if_exists(path: &Path) -> ReliabilityResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(ReliabilityError::corrupt(format!(
                    "refusing to remove non-regular reliability path: {}",
                    path.display()
                )));
            }
            fs::remove_file(path)
                .map_err(|error| ReliabilityError::io("remove reliability file", error))?;
            if let Some(parent) = path.parent() {
                sync_directory(parent)?;
            }
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ReliabilityError::io(
            "inspect reliability file for removal",
            error,
        )),
    }
}

pub(crate) fn reject_symlink(path: &Path) -> ReliabilityResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| ReliabilityError::io("inspect reliability directory", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ReliabilityError::corrupt(format!(
            "reliability directory is not a real directory: {}",
            path.display()
        )));
    }
    Ok(())
}

pub(crate) fn sync_directory(path: &Path) -> ReliabilityResult<()> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| ReliabilityError::io("sync reliability directory", error))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn temporary_path(path: &Path) -> ReliabilityResult<PathBuf> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ReliabilityError::invalid("reliability filename is not UTF-8"))?;
    Ok(path.with_file_name(format!(".{name}.tmp")))
}
