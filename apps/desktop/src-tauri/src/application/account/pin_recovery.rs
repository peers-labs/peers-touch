use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const GRANT_TTL: Duration = Duration::from_secs(300);

static GRANTS: LazyLock<Mutex<HashMap<String, PinRecoveryGrant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone)]
pub struct PinRecoveryGrant {
    pub recovery_id: String,
    pub window_label: String,
    pub target_local_account_id: String,
    pub provider: String,
    pub state: GrantState,
    pub fresh_token: Option<String>,
    pub created_at: Instant,
    pub consumed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GrantState {
    AwaitingAuth,
    Authorized,
}

impl PinRecoveryGrant {
    pub fn is_expired(&self) -> bool {
        self.created_at.elapsed() > GRANT_TTL
    }

    pub fn is_valid_for_reset(&self, window_label: &str) -> bool {
        self.state == GrantState::Authorized
            && !self.consumed
            && !self.is_expired()
            && self.window_label == window_label
            && self.fresh_token.is_some()
    }
}

pub fn begin_recovery(
    window_label: &str,
    target_local_account_id: &str,
    provider: &str,
) -> String {
    let recovery_id = ulid::Ulid::new().to_string();
    let grant = PinRecoveryGrant {
        recovery_id: recovery_id.clone(),
        window_label: window_label.to_string(),
        target_local_account_id: target_local_account_id.to_string(),
        provider: provider.to_string(),
        state: GrantState::AwaitingAuth,
        fresh_token: None,
        created_at: Instant::now(),
        consumed: false,
    };
    let mut grants = GRANTS.lock().unwrap();
    grants.retain(|_, g| !g.is_expired());
    grants.insert(recovery_id.clone(), grant);
    recovery_id
}

pub fn authorize_grant(
    recovery_id: &str,
    window_label: &str,
    authenticated_account_id: &str,
    fresh_token: &str,
) -> Result<(), RecoveryGrantError> {
    let mut grants = GRANTS.lock().unwrap();
    let grant = grants
        .get_mut(recovery_id)
        .ok_or(RecoveryGrantError::GrantInvalid)?;

    if grant.is_expired() {
        return Err(RecoveryGrantError::GrantInvalid);
    }
    if grant.window_label != window_label {
        return Err(RecoveryGrantError::GrantInvalid);
    }
    if grant.state != GrantState::AwaitingAuth {
        return Err(RecoveryGrantError::GrantInvalid);
    }
    if grant.target_local_account_id != authenticated_account_id {
        return Err(RecoveryGrantError::AccountMismatch);
    }

    grant.state = GrantState::Authorized;
    grant.fresh_token = Some(fresh_token.to_string());
    Ok(())
}

pub fn consume_grant(
    recovery_id: &str,
    window_label: &str,
) -> Result<(String, String), RecoveryGrantError> {
    let mut grants = GRANTS.lock().unwrap();
    let grant = grants
        .get_mut(recovery_id)
        .ok_or(RecoveryGrantError::GrantInvalid)?;

    if !grant.is_valid_for_reset(window_label) {
        return Err(RecoveryGrantError::GrantInvalid);
    }

    grant.consumed = true;
    let account_id = grant.target_local_account_id.clone();
    let token = grant.fresh_token.clone().unwrap();
    Ok((account_id, token))
}

pub fn cancel_grant(recovery_id: &str) {
    let mut grants = GRANTS.lock().unwrap();
    grants.remove(recovery_id);
}

#[derive(Debug)]
pub enum RecoveryGrantError {
    GrantInvalid,
    AccountMismatch,
}
