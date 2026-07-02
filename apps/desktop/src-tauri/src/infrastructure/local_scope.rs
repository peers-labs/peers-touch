use crate::infrastructure::{station_client, storage};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalScope {
    pub station_scope: String,
    pub actor_scope: String,
}

impl LocalScope {
    pub fn from_actor(actor_id: &str) -> Self {
        Self {
            station_scope: active_station_scope(),
            actor_scope: storage::resolve_user_scope(Some(actor_id)),
        }
    }

    pub fn user_scope(&self) -> String {
        format!("{}__{}", self.station_scope, self.actor_scope)
    }

    pub fn account_id(&self, provider: &str, provider_user_id: &str) -> String {
        let provider = storage::resolve_user_scope(Some(provider));
        let provider_user = storage::resolve_user_scope(Some(provider_user_id));
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
    if let Some(peer_id) = station_client::active_station_peer_id() {
        let peer = peer_id.trim();
        if !peer.is_empty() {
            return format!("station_peer_{}", storage::resolve_user_scope(Some(peer)));
        }
    }
    let url = canonical_station_url(&station_client::station_base_url());
    format!("station_url_{}", sha256_short(&url))
}

pub fn user_scope_for_actor(actor_id: Option<&str>) -> String {
    match actor_id {
        Some(id) if !id.trim().is_empty() => LocalScope::from_actor(id).user_scope(),
        _ => LocalScope {
            station_scope: active_station_scope(),
            actor_scope: "__default__".to_string(),
        }
        .user_scope(),
    }
}

pub fn account_id_for_password_actor(actor_id: &str) -> String {
    LocalScope::from_actor(actor_id).account_id("password", actor_id)
}

pub fn actor_id_from_account_id(account_id: &str) -> String {
    account_id
        .rsplit_once(':')
        .map(|(_, id)| id.to_string())
        .unwrap_or_else(|| account_id.to_string())
}

fn canonical_station_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    let Ok(mut url) = reqwest::Url::parse(trimmed) else {
        return trimmed.to_ascii_lowercase();
    };
    let scheme = url.scheme().to_ascii_lowercase();
    let _ = url.set_scheme(&scheme);
    if let Some(host) = url.host_str().map(|host| host.to_ascii_lowercase()) {
        let _ = url.set_host(Some(&host));
    }
    url.to_string().trim_end_matches('/').to_string()
}

fn sha256_short(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    hex::encode(&digest[..12])
}
