use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

const TOKEN_TTL_SECONDS: u64 = 60 * 60;

#[derive(Debug, Clone, Serialize)]
pub struct AuthSession {
    pub actor_ptid: String,
    pub token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
pub enum AuthDomainError {
    InvalidArgument(String),
    Unauthorized(String),
}

pub fn validate_login_input(account: &str, password: &str) -> Result<(), AuthDomainError> {
    if account.trim().is_empty() {
        return Err(AuthDomainError::InvalidArgument(
            "Account is required".to_string(),
        ));
    }
    if password.trim().is_empty() {
        return Err(AuthDomainError::InvalidArgument(
            "Password is required".to_string(),
        ));
    }
    Ok(())
}

pub fn from_station_response(actor_ptid: String, token: String) -> AuthSession {
    // Attempt to read `exp` from the JWT payload for accurate expiry tracking.
    // Falls back to a default 1-hour TTL when the token has no `exp` claim.
    let expires_at = token
        .split('.')
        .nth(1)
        .and_then(decode_jwt_exp)
        .unwrap_or_else(|| now_epoch_seconds() + TOKEN_TTL_SECONDS);
    AuthSession {
        actor_ptid,
        token,
        expires_at,
    }
}

pub fn validate_token(token: &str) -> Result<AuthSession, AuthDomainError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AuthDomainError::Unauthorized(
            "Token is missing".to_string(),
        ));
    }

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 || !token.starts_with("eyJ") {
        return Err(AuthDomainError::Unauthorized(
            "Token is invalid or expired".to_string(),
        ));
    }

    // Best-effort local validation:
    // - Decode the Station's canonical actor subject for identity wiring
    // - If `exp` exists, enforce expiry so we don't offer "Continue" on an expired session.
    let actor_ptid = decode_jwt_subject_ptid(parts[1]).ok_or_else(|| {
        AuthDomainError::Unauthorized("Token subject is not a canonical PTID".to_string())
    })?;
    if let Some(exp) = decode_jwt_exp(parts[1]) {
        let now = now_epoch_seconds();
        if exp <= now {
            return Err(AuthDomainError::Unauthorized(
                "Token is invalid or expired".to_string(),
            ));
        }
    }

    Ok(AuthSession {
        actor_ptid,
        token: token.to_string(),
        expires_at: decode_jwt_exp(parts[1])
            .unwrap_or_else(|| now_epoch_seconds() + TOKEN_TTL_SECONDS),
    })
}

fn decode_jwt_subject_ptid(payload_b64: &str) -> Option<String> {
    let mut b64 = payload_b64.replace('-', "+").replace('_', "/");
    let pad = (4 - b64.len() % 4) % 4;
    b64.extend(std::iter::repeat('=').take(pad));

    let decoded = base64_decode(&b64)?;
    let text = String::from_utf8(decoded).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("subject_ptid")
        .and_then(|s| s.as_str())
        .filter(|subject| subject.starts_with("ptid:"))
        .map(|s| s.to_string())
}

fn decode_jwt_exp(payload_b64: &str) -> Option<u64> {
    let mut b64 = payload_b64.replace('-', "+").replace('_', "/");
    let pad = (4 - b64.len() % 4) % 4;
    b64.extend(std::iter::repeat('=').take(pad));

    let decoded = base64_decode(&b64)?;
    let text = String::from_utf8(decoded).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("exp").and_then(|e| e.as_u64())
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let table: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, &c) in table.iter().enumerate() {
        lookup[c as usize] = i as u8;
    }

    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &b in bytes {
        if b == b'=' {
            break;
        }
        let val = lookup[b as usize];
        if val == 255 {
            return None;
        }
        buf = (buf << 6) | val as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{from_station_response, validate_token, AuthDomainError};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    fn jwt_with_claims(claims: serde_json::Value) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256"}"#);
        let payload = URL_SAFE_NO_PAD.encode(claims.to_string());
        format!("{header}.{payload}.signature")
    }

    #[test]
    fn station_jwt_accepts_canonical_subject_ptid() {
        let token = jwt_with_claims(serde_json::json!({
            "subject_ptid": "ptid:test:12345",
        }));
        let session = from_station_response("ptid:test:12345".to_string(), token);
        let validated = validate_token(&session.token).expect("JWT should be accepted");
        assert_eq!(validated.actor_ptid, "ptid:test:12345");
        assert_eq!(validated.token, session.token);
    }

    #[test]
    fn station_jwt_rejects_legacy_sub_only_identity() {
        let token = jwt_with_claims(serde_json::json!({
            "sub": "ptid:test:12345",
        }));

        assert!(matches!(
            validate_token(&token),
            Err(AuthDomainError::Unauthorized(_))
        ));
    }
}
