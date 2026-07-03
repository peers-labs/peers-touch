//! Session persistence policy.
//!
//! This is the only layer that decides whether a Station token may be stored
//! or restored from the raw per-actor session store. PIN-protected accounts
//! must never be restorable from raw tokens; their recoverable session lives
//! only in `auth_identity.encrypted_session` and requires PIN verification.

use crate::infrastructure::auth_identity::{self, AccountIdentity};
use crate::infrastructure::local_scope;
use crate::infrastructure::session_store::{
    self, PersistedSession, SessionSource, SessionStoreError,
};

#[derive(Debug)]
pub enum SessionVaultError {
    PinRequired {
        account_id: String,
        actor_id: String,
    },
    Store(SessionStoreError),
}

impl std::fmt::Display for SessionVaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionVaultError::PinRequired { account_id, .. } => {
                write!(f, "pin required for account {account_id}")
            }
            SessionVaultError::Store(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for SessionVaultError {}

impl From<SessionStoreError> for SessionVaultError {
    fn from(value: SessionStoreError) -> Self {
        SessionVaultError::Store(value)
    }
}

pub fn actor_id_from_account_id(account_id: &str) -> String {
    local_scope::actor_id_from_account_id(account_id)
}

pub fn active_account_id() -> Option<String> {
    auth_identity::read_state()
        .ok()
        .and_then(|state| state.active_account_id)
}

pub fn account_requires_pin(account_id: &str) -> bool {
    auth_identity::read_state()
        .ok()
        .and_then(|state| {
            state
                .accounts
                .into_iter()
                .find(|account| account.id == account_id)
        })
        .map(|account| account.pin_protection.is_some())
        .unwrap_or(false)
}

pub fn account_has_restorable_session(account: &AccountIdentity) -> bool {
    if account.pin_protection.is_some() {
        account.has_session && account.encrypted_session.is_some()
    } else {
        account.has_session
    }
}

pub fn purge_raw_session_for_account(account_id: &str) {
    let _ = session_store::delete(account_id);
}

pub fn purge_raw_session_for_actor(actor_id: &str) {
    let account_id = local_scope::account_id_for_password_actor(actor_id);
    let _ = session_store::delete(&account_id);
}

pub fn purge_raw_sessions_for_pin_accounts(accounts: &[AccountIdentity]) {
    for account in accounts {
        if account.pin_protection.is_some() {
            purge_raw_session_for_account(&account.id);
        }
    }
}

pub fn persist_raw_session_for_account(
    account_id: &str,
    actor_id: &str,
    token: &str,
    source: SessionSource,
) -> Result<(), SessionVaultError> {
    if account_requires_pin(account_id) {
        purge_raw_session_for_account(account_id);
        return Ok(());
    }

    session_store::save(account_id, actor_id, token, source).map_err(SessionVaultError::from)
}

pub fn load_raw_session_for_account(
    account_id: &str,
    expected_source: Option<SessionSource>,
) -> Result<Option<PersistedSession>, SessionVaultError> {
    if account_requires_pin(account_id) {
        purge_raw_session_for_account(account_id);
        return Err(SessionVaultError::PinRequired {
            account_id: account_id.to_string(),
            actor_id: actor_id_from_account_id(account_id),
        });
    }

    let Some(blob) = session_store::load(account_id) else {
        return Ok(None);
    };
    if let Some(source) = expected_source {
        if blob.source != source {
            return Ok(None);
        }
    }
    Ok(Some(blob))
}

pub fn save_encrypted_session_and_purge_raw(
    account_id: &str,
    pin: &str,
    token: &str,
) -> Result<(), String> {
    auth_identity::save_encrypted_session(account_id, pin, token)?;
    purge_raw_session_for_account(account_id);
    Ok(())
}
