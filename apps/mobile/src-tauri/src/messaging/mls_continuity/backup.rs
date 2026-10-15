use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::platform::secure_storage::SecureStorage;

use super::{
    MlsContinuityBackup, MlsContinuityKeyPackage, MlsContinuityPendingGenesis,
    MlsContinuityProviderPool, MlsContinuityScope, MlsContinuityState,
};

const MLS_CONTINUITY_PREFIX: &str = "messaging.v1.mls-continuity";
const MLS_CONTINUITY_VERSION: u32 = 1;

pub(crate) struct StorageMlsContinuityBackup {
    storage: SecureStorage,
    key: String,
    last_payload_sha256: Mutex<Option<String>>,
}

#[derive(Serialize, Deserialize)]
struct PersistedMlsContinuityEnvelope {
    version: u32,
    payload: PersistedMlsContinuityPayload,
    payload_sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMlsContinuityPayload {
    station_peer_id: String,
    actor_ptid: String,
    device_id: String,
    actor_identity_state: String,
    provider_pool: Option<PersistedMlsContinuityProviderPool>,
    key_packages: Vec<PersistedMlsContinuityKeyPackage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pending_genesis_transitions: Vec<PersistedMlsContinuityPendingGenesis>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMlsContinuityProviderPool {
    state: String,
    updated_at_unix_ms: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMlsContinuityKeyPackage {
    package_id: String,
    data: String,
    state: String,
    created_at_unix_ms: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMlsContinuityPendingGenesis {
    conversation_id: String,
    transition_id: String,
    command_id: String,
    state: String,
}

impl StorageMlsContinuityBackup {
    pub(crate) fn new(
        storage: SecureStorage,
        station_peer_id: &str,
        actor_ptid: &str,
        device_id: &str,
    ) -> Arc<Self> {
        let mut hasher = Sha256::new();
        hasher.update(station_peer_id.as_bytes());
        hasher.update([0x1f]);
        hasher.update(actor_ptid.as_bytes());
        hasher.update([0x1f]);
        hasher.update(device_id.as_bytes());
        let digest = hasher.finalize();
        let suffix: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
        Arc::new(Self {
            storage,
            key: format!("{MLS_CONTINUITY_PREFIX}.{suffix}"),
            last_payload_sha256: Mutex::new(None),
        })
    }
}

impl MlsContinuityBackup for StorageMlsContinuityBackup {
    fn load(&self) -> Result<Option<MlsContinuityState>, String> {
        let stored = self
            .storage
            .get(&self.key)
            .map_err(|error| format!("read MLS continuity backup: {error}"))?;
        let Some(stored) = stored else {
            return Ok(None);
        };
        let envelope: PersistedMlsContinuityEnvelope = serde_json::from_str(stored.trim())
            .map_err(|error| format!("MLS continuity backup is invalid: {error}"))?;
        if envelope.version != MLS_CONTINUITY_VERSION {
            return Err("MLS continuity backup version is unsupported".to_string());
        }
        let payload_bytes = serde_json::to_vec(&envelope.payload)
            .map_err(|error| format!("encode MLS continuity backup payload: {error}"))?;
        if hex::encode(Sha256::digest(&payload_bytes)) != envelope.payload_sha256 {
            return Err("MLS continuity backup payload checksum mismatch".to_string());
        }
        *self
            .last_payload_sha256
            .lock()
            .map_err(|_| "MLS continuity backup checksum lock poisoned".to_string())? =
            Some(envelope.payload_sha256.clone());
        envelope.payload.into_state().map(Some)
    }

    fn store(&self, state: &MlsContinuityState) -> Result<(), String> {
        let payload = PersistedMlsContinuityPayload::from_state(state);
        let payload_bytes = serde_json::to_vec(&payload)
            .map_err(|error| format!("encode MLS continuity backup payload: {error}"))?;
        let payload_sha256 = hex::encode(Sha256::digest(payload_bytes));
        if self
            .last_payload_sha256
            .lock()
            .map_err(|_| "MLS continuity backup checksum lock poisoned".to_string())?
            .as_deref()
            == Some(payload_sha256.as_str())
        {
            return Ok(());
        }
        let encoded = serde_json::to_string(&PersistedMlsContinuityEnvelope {
            version: MLS_CONTINUITY_VERSION,
            payload,
            payload_sha256: payload_sha256.clone(),
        })
        .map_err(|error| format!("encode MLS continuity backup: {error}"))?;
        self.storage
            .set(&self.key, &encoded)
            .map_err(|error| format!("write MLS continuity backup: {error}"))?;
        *self
            .last_payload_sha256
            .lock()
            .map_err(|_| "MLS continuity backup checksum lock poisoned".to_string())? =
            Some(payload_sha256);
        Ok(())
    }
}

impl PersistedMlsContinuityPayload {
    fn from_state(state: &MlsContinuityState) -> Self {
        Self {
            station_peer_id: state.scope.station_peer_id.clone(),
            actor_ptid: state.scope.actor_ptid.clone(),
            device_id: state.scope.device_id.clone(),
            actor_identity_state: B64.encode(&state.actor_identity_state),
            provider_pool: state.provider_pool.as_ref().map(|pool| {
                PersistedMlsContinuityProviderPool {
                    state: B64.encode(&pool.state),
                    updated_at_unix_ms: pool.updated_at_unix_ms,
                }
            }),
            key_packages: state
                .key_packages
                .iter()
                .map(|package| PersistedMlsContinuityKeyPackage {
                    package_id: package.package_id.clone(),
                    data: B64.encode(&package.data),
                    state: package.state.clone(),
                    created_at_unix_ms: package.created_at_unix_ms,
                })
                .collect(),
            pending_genesis_transitions: state
                .pending_genesis_transitions
                .iter()
                .map(|transition| PersistedMlsContinuityPendingGenesis {
                    conversation_id: transition.conversation_id.clone(),
                    transition_id: transition.transition_id.clone(),
                    command_id: transition.command_id.clone(),
                    state: B64.encode(&transition.state),
                })
                .collect(),
        }
    }

    fn into_state(self) -> Result<MlsContinuityState, String> {
        let scope = MlsContinuityScope::new(self.station_peer_id, self.actor_ptid, self.device_id)?;
        let actor_identity_state =
            decode_mls_continuity_bytes("actor identity", &self.actor_identity_state)?;
        let provider_pool = self
            .provider_pool
            .map(|pool| -> Result<MlsContinuityProviderPool, String> {
                Ok(MlsContinuityProviderPool {
                    state: decode_mls_continuity_bytes("provider pool", &pool.state)?,
                    updated_at_unix_ms: pool.updated_at_unix_ms,
                })
            })
            .transpose()?;
        let key_packages = self
            .key_packages
            .into_iter()
            .map(|package| {
                Ok(MlsContinuityKeyPackage {
                    package_id: package.package_id,
                    data: decode_mls_continuity_bytes("KeyPackage", &package.data)?,
                    state: package.state,
                    created_at_unix_ms: package.created_at_unix_ms,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let pending_genesis_transitions = self
            .pending_genesis_transitions
            .into_iter()
            .map(|transition| {
                Ok(MlsContinuityPendingGenesis {
                    conversation_id: transition.conversation_id,
                    transition_id: transition.transition_id,
                    command_id: transition.command_id,
                    state: decode_mls_continuity_bytes(
                        "pending genesis transition",
                        &transition.state,
                    )?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(MlsContinuityState {
            scope,
            actor_identity_state,
            provider_pool,
            key_packages,
            pending_genesis_transitions,
        })
    }
}

fn decode_mls_continuity_bytes(label: &str, encoded: &str) -> Result<Vec<u8>, String> {
    B64.decode(encoded.trim())
        .map_err(|error| format!("MLS continuity backup {label} is not base64: {error}"))
}
