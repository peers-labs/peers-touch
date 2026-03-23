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

pub fn issue_session(account: &str, password: &str) -> Result<AuthSession, AuthDomainError> {
    let account = account.trim();
    let password = password.trim();
    if account.is_empty() {
        return Err(AuthDomainError::InvalidArgument("account is required".to_string()));
    }
    if password.is_empty() {
        return Err(AuthDomainError::InvalidArgument("password is required".to_string()));
    }
    let now = now_epoch_seconds();
    let expires_at = now + TOKEN_TTL_SECONDS;
    let actor_id = normalize_actor_id(account);
    let token = format!("pt.{}.{}", actor_id, expires_at);
    Ok(AuthSession {
        actor_id,
        token,
        expires_at,
    })
}

pub fn validate_token(token: &str) -> Result<AuthSession, AuthDomainError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AuthDomainError::Unauthorized("missing token".to_string()));
    }
    let (actor_id, expires_at) = parse_token(token)?;
    let now = now_epoch_seconds();
    if expires_at <= now {
        return Err(AuthDomainError::Unauthorized("token expired".to_string()));
    }
    Ok(AuthSession {
        actor_id,
        token: token.to_string(),
        expires_at,
    })
}

fn parse_token(token: &str) -> Result<(String, u64), AuthDomainError> {
    let mut parts = token.split('.');
    let prefix = parts.next().unwrap_or_default();
    let actor_id = parts.next().unwrap_or_default();
    let expires_raw = parts.next().unwrap_or_default();
    if prefix != "pt" || actor_id.is_empty() || expires_raw.is_empty() || parts.next().is_some() {
        return Err(AuthDomainError::Unauthorized("invalid token format".to_string()));
    }
    let expires_at = expires_raw
        .parse::<u64>()
        .map_err(|_| AuthDomainError::Unauthorized("invalid token expiry".to_string()))?;
    Ok((actor_id.to_string(), expires_at))
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn normalize_actor_id(input: &str) -> String {
    let normalized: String = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    normalized.trim_matches('_').to_string()
}

#[cfg(test)]
mod tests {
    use super::{issue_session, validate_token};

    #[test]
    fn issue_and_validate_token() {
        let session = issue_session("Alice", "secret").expect("session should be created");
        let validated = validate_token(&session.token).expect("token should be valid");
        assert_eq!(validated.actor_id, "alice");
    }
}
