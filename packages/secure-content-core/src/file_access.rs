//! Presentation-safe filenames and byte-verified copying.
//!
//! Hosts own paths, destination selection, atomic promotion and cleanup. The
//! kernel only operates on streams and never authorizes a Chat attachment.

use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};

const MAX_FILENAME_BYTES: usize = 180;

/// Keep the final basename and extension without admitting path syntax,
/// control characters, bidi overrides or platform-reserved names.
pub fn safe_filename(filename: &str) -> String {
    let basename = filename.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = basename
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
                || matches!(character, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        return "attachment".to_string();
    }
    let (stem, extension) = match trimmed.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && extension.len() <= 24 => {
            (stem, format!(".{extension}"))
        }
        _ => (trimmed, String::new()),
    };
    let reserved = matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    let prefix = if reserved { "_" } else { "" };
    let budget = MAX_FILENAME_BYTES - prefix.len() - extension.len();
    let mut boundary = stem.len().min(budget);
    while !stem.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{prefix}{}{extension}", &stem[..boundary])
}

/// Copy exactly the immutable commitment. The Host must discard the
/// destination on any error and publish it only after this function succeeds.
pub fn copy_verified(
    mut source: impl Read,
    mut destination: impl Write,
    expected_size: u64,
    expected_sha256: &[u8; 32],
) -> io::Result<u64> {
    let mut hash = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = source.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        copied = copied
            .checked_add(count as u64)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "file size overflow"))?;
        if copied > expected_size {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "file size mismatch",
            ));
        }
        hash.update(&buffer[..count]);
        destination.write_all(&buffer[..count])?;
    }
    let actual_sha256: [u8; 32] = hash.finalize().into();
    if copied != expected_size || actual_sha256 != *expected_sha256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file integrity mismatch",
        ));
    }
    destination.flush()?;
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn filename_preserves_extension_without_path_or_platform_escape() {
        assert_eq!(safe_filename("../../report.pdf"), "report.pdf");
        assert_eq!(safe_filename("C:\\folder\\report.docx"), "report.docx");
        assert_eq!(safe_filename("CON.txt"), "_CON.txt");
        assert_eq!(safe_filename(" .. "), "attachment");
        assert_eq!(safe_filename("invoice\u{202e}.exe"), "invoice_.exe");
        let long = safe_filename(&format!("{}.xlsx", "中".repeat(200)));
        assert!(long.len() <= MAX_FILENAME_BYTES);
        assert!(long.ends_with(".xlsx"));
    }

    #[test]
    fn copied_bytes_are_independent_and_match_size_and_digest() {
        let source = b"immutable attachment";
        let hash = Sha256::digest(source).into();
        let mut copy = Vec::new();
        assert_eq!(
            copy_verified(Cursor::new(source), &mut copy, source.len() as u64, &hash).unwrap(),
            source.len() as u64,
        );
        copy[0] = b'X';
        assert_eq!(source, b"immutable attachment");
        assert!(copy_verified(Cursor::new(source), Vec::new(), 1, &hash).is_err());
        assert!(copy_verified(
            Cursor::new(source),
            Vec::new(),
            source.len() as u64,
            &[0; 32]
        )
        .is_err());
        assert!(copy_verified(
            Cursor::new(source),
            Vec::new(),
            source.len() as u64 + 1,
            &hash
        )
        .is_err());
    }
}
