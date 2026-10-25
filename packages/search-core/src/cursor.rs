//! Opaque pagination cursor.
//!
//! The cursor carries an offset within a stable source ordering. It is
//! serialized as base64 JSON so callers treat it as opaque and never parse
//! it; a malformed/expired cursor fails closed instead of restarting at an
//! arbitrary position.

use base64::Engine;
use serde::{Deserialize, Serialize};

pub mod authenticated;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageCursor {
    /// Schema marker; bump when the cursor payload meaning changes.
    pub v: u8,
    pub offset: u64,
}

impl PageCursor {
    pub fn new(offset: u64) -> Self {
        Self { v: 1, offset }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CursorError {
    #[error("search cursor is malformed")]
    Malformed,
    #[error("search cursor uses an unsupported version")]
    UnsupportedVersion,
}

pub fn encode_cursor(cursor: &PageCursor) -> String {
    let json = serde_json::to_vec(cursor).expect("PageCursor always serializes");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
}

pub fn decode_cursor(opaque: &str) -> Result<PageCursor, CursorError> {
    if opaque.is_empty() {
        return Err(CursorError::Malformed);
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(opaque.as_bytes())
        .map_err(|_| CursorError::Malformed)?;
    let cursor: PageCursor = serde_json::from_slice(&bytes).map_err(|_| CursorError::Malformed)?;
    if cursor.v != 1 {
        return Err(CursorError::UnsupportedVersion);
    }
    Ok(cursor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_offset() {
        let cursor = PageCursor::new(42);
        let opaque = encode_cursor(&cursor);
        assert!(opaque
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(decode_cursor(&opaque).unwrap(), cursor);
    }

    #[test]
    fn malformed_input_fails_closed() {
        assert_eq!(decode_cursor("").unwrap_err(), CursorError::Malformed);
        assert_eq!(
            decode_cursor("!!!not-base64").unwrap_err(),
            CursorError::Malformed
        );
        assert_eq!(decode_cursor("bnVsbA").unwrap_err(), CursorError::Malformed);
    }

    #[test]
    fn unknown_version_is_rejected() {
        let future =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"v":9,"offset":1}"#);
        assert_eq!(
            decode_cursor(&future).unwrap_err(),
            CursorError::UnsupportedVersion
        );
    }
}
