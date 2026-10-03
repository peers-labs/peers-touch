use crate::infrastructure::{station_client, storage};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalScope {
    pub station_scope: String,
    pub actor_scope: String,
}

impl LocalScope {
    pub fn from_actor_ptid(actor_ptid: &str) -> Self {
        Self {
            station_scope: active_station_scope(),
            actor_scope: storage::resolve_user_scope(actor_ptid),
        }
    }

    pub fn user_scope(&self) -> String {
        format!("{}__{}", self.station_scope, self.actor_scope)
    }

    pub fn account_id(&self, provider: &str, provider_user_id: &str) -> String {
        let provider = storage::sanitize_storage_segment(provider);
        let provider_user = storage::sanitize_storage_segment(provider_user_id);
        format!(
            "station:{}:{}:{}",
            self.station_scope, provider, provider_user
        )
    }

    pub fn identity_key_ref(&self) -> String {
        format!("{}/{}", self.station_scope, self.actor_scope)
    }
}

pub fn active_station_scope() -> String {
    let station_url = station_client::station_base_url();
    station_scope_for_identity(
        station_client::active_station_peer_id().as_deref(),
        &station_url,
    )
}

pub(crate) fn station_scope_for_identity(
    station_peer_id: Option<&str>,
    station_url: &str,
) -> String {
    if let Some(peer_id) = station_peer_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!(
            "station_peer_{}",
            storage::sanitize_storage_segment(peer_id)
        );
    }
    let digest = Sha256::digest(station_url.trim().as_bytes());
    format!("station_url_{}", hex::encode(&digest[..12]))
}

pub fn user_scope_for_actor_ptid(actor_ptid: &str) -> String {
    LocalScope::from_actor_ptid(actor_ptid).user_scope()
}

pub(crate) fn user_scope_for_actor_at_station(
    actor_ptid: &str,
    station_peer_id: Option<&str>,
    station_url: &str,
) -> String {
    LocalScope {
        station_scope: station_scope_for_identity(station_peer_id, station_url),
        actor_scope: storage::resolve_user_scope(actor_ptid),
    }
    .user_scope()
}

pub fn account_id_for_password_ptid(actor_ptid: &str) -> String {
    LocalScope::from_actor_ptid(actor_ptid).account_id("password", actor_ptid)
}
