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
            "account is required".to_string(),
        ));
    }
    if password.trim().is_empty() {
        return Err(AuthDomainError::InvalidArgument(
            "password is required".to_string(),
        ));
    }
    Ok(())
}

pub fn from_station_response(actor_id: String, token: String) -> AuthSession {
    let expires_at = now_epoch_seconds() + TOKEN_TTL_SECONDS;
    AuthSession {
        actor_id,
        token,
        expires_at,
    }
}

pub fn validate_token(token: &str) -> Result<AuthSession, AuthDomainError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AuthDomainError::Unauthorized("missing token".to_string()));
    }

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() == 3 && token.starts_with("eyJ") {
        return Ok(AuthSession {
            actor_id: String::new(),
            token: token.to_string(),
            expires_at: now_epoch_seconds() + TOKEN_TTL_SECONDS,
        });
    }

    Err(AuthDomainError::Unauthorized("invalid token: station login required".to_string()))
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
