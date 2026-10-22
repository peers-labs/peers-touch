//! Authenticated, expiring continuations. The host supplies an incarnation key
//! and time; the portable codec performs no I/O and stores no query sessions.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Sha256;

use super::CursorError;

const MAX_CURSOR_BYTES: usize = 4096;
const LIFETIME_MS: u64 = 5 * 60 * 1000;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Continuation<T> {
    binding: String,
    expires_at: u64,
    value: T,
}

pub struct AuthenticatedCursorCodec {
    key: [u8; 32],
}

impl AuthenticatedCursorCodec {
    /// Keys must be unpredictable and replaced for each host incarnation.
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    pub fn encode<T: Serialize>(
        &self, value: T, binding: &str, now_ms: u64,
    ) -> Result<String, CursorError> {
        let expires_at = now_ms.checked_add(LIFETIME_MS).ok_or(CursorError::Malformed)?;
        let payload = serde_json::to_vec(&Continuation {
            binding: binding.to_owned(), expires_at, value,
        }).map_err(|_| CursorError::Malformed)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key)
            .map_err(|_| CursorError::Malformed)?;
        mac.update(&payload);
        let opaque = format!("{}.{}", URL_SAFE_NO_PAD.encode(payload),
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()));
        if opaque.len() > MAX_CURSOR_BYTES { return Err(CursorError::Malformed); }
        Ok(opaque)
    }

    pub fn decode<T: DeserializeOwned>(
        &self, opaque: &str, binding: &str, now_ms: u64,
    ) -> Result<T, CursorError> {
        if opaque.len() > MAX_CURSOR_BYTES { return Err(CursorError::Malformed); }
        let (payload, signature) = opaque.split_once('.').ok_or(CursorError::Malformed)?;
        let payload = URL_SAFE_NO_PAD.decode(payload).map_err(|_| CursorError::Malformed)?;
        let signature = URL_SAFE_NO_PAD.decode(signature).map_err(|_| CursorError::Malformed)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key)
            .map_err(|_| CursorError::Malformed)?;
        mac.update(&payload);
        mac.verify_slice(&signature).map_err(|_| CursorError::Malformed)?;
        let continuation: Continuation<T> = serde_json::from_slice(&payload)
            .map_err(|_| CursorError::Malformed)?;
        if continuation.binding != binding || now_ms >= continuation.expires_at
            || continuation.expires_at - now_ms > LIFETIME_MS {
            return Err(CursorError::Malformed);
        }
        Ok(continuation.value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_tampering_context_change_expiry_and_new_incarnation() {
        let codec = AuthenticatedCursorCodec::new([1; 32]);
        let opaque = codec.encode(42_u64, "actor/window/engine/query", 1000).unwrap();
        assert_eq!(codec.decode::<u64>(&opaque, "actor/window/engine/query", 1001).unwrap(), 42);
        assert!(codec.decode::<u64>(&opaque, "other-context", 1001).is_err());
        assert!(codec.decode::<u64>(&opaque, "actor/window/engine/query", 1000 + LIFETIME_MS).is_err());
        assert!(codec.decode::<u64>(&opaque, "actor/window/engine/query", 999).is_err());
        let restarted = AuthenticatedCursorCodec::new([2; 32]);
        assert!(restarted.decode::<u64>(&opaque, "actor/window/engine/query", 1001).is_err());

        let (payload, signature) = opaque.split_once('.').unwrap();
        let mut changed: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
        changed["value"] = serde_json::json!(u64::MAX);
        let forged = format!("{}.{}", URL_SAFE_NO_PAD.encode(serde_json::to_vec(&changed).unwrap()), signature);
        assert!(codec.decode::<u64>(&forged, "actor/window/engine/query", 1001).is_err());
        assert!(codec.decode::<u64>(&"x".repeat(MAX_CURSOR_BYTES + 1), "", 1001).is_err());
    }
}
