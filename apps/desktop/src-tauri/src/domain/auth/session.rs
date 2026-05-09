use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

const TOKEN_TTL_SECONDS: u64 = 60 * 60;

#[derive(Debug, Clone, Serialize)]
pub struct AuthSession {
    pub actor_id: String,
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

pub fn from_station_response(actor_id: String, token: String) -> AuthSession {
    // Attempt to read `exp` from the JWT payload for accurate expiry tracking.
    // Falls back to a default 1-hour TTL when the token has no `exp` claim.
    let expires_at = token
        .split('.')
        .nth(1)
        .and_then(decode_jwt_exp)
        .unwrap_or_else(|| now_epoch_seconds() + TOKEN_TTL_SECONDS);
    AuthSession {
        actor_id,
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
    // - Decode subject for display/identity wiring
    // - If `exp` exists, enforce expiry so we don't offer "Continue" on an expired session.
    let actor_id = decode_jwt_subject(parts[1]).unwrap_or_default();
    if let Some(exp) = decode_jwt_exp(parts[1]) {
        let now = now_epoch_seconds();
        if exp <= now {
            return Err(AuthDomainError::Unauthorized(
                "Token is invalid or expired".to_string(),
            ));
        }
    }

    Ok(AuthSession {
        actor_id,
        token: token.to_string(),
        expires_at: decode_jwt_exp(parts[1])
            .unwrap_or_else(|| now_epoch_seconds() + TOKEN_TTL_SECONDS),
    })
}

fn decode_jwt_subject(payload_b64: &str) -> Option<String> {
    let mut b64 = payload_b64.replace('-', "+").replace('_', "/");
    let pad = (4 - b64.len() % 4) % 4;
    b64.extend(std::iter::repeat('=').take(pad));

    let decoded = base64_decode(&b64)?;
    let text = String::from_utf8(decoded).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("subject_id")
        .or_else(|| v.get("sub"))
        .and_then(|s| s.as_str())
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
    use super::{from_station_response, validate_token};

    #[test]
    fn station_jwt_validate() {
        let session = from_station_response(
            "12345".to_string(),
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmnopqrstuvwxyz".to_string(),
        );
        let validated = validate_token(&session.token).expect("JWT should be accepted");
        assert_eq!(validated.token, session.token);
    }
}
