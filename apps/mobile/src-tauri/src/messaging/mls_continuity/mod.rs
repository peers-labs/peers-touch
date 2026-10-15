use std::sync::Arc;

mod backup;
mod store;

pub(crate) use backup::StorageMlsContinuityBackup;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsContinuityScope {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub device_id: String,
}

impl MlsContinuityScope {
    pub fn new(
        station_peer_id: impl Into<String>,
        actor_ptid: impl Into<String>,
        device_id: impl Into<String>,
    ) -> Result<Self, String> {
        let scope = Self {
            station_peer_id: station_peer_id.into(),
            actor_ptid: actor_ptid.into(),
            device_id: device_id.into(),
        };
        if scope.station_peer_id.trim().is_empty()
            || !scope.actor_ptid.starts_with("ptid:")
            || scope.device_id.trim().is_empty()
        {
            return Err("mobile messaging MLS continuity scope is invalid".to_string());
        }
        Ok(scope)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsContinuityProviderPool {
    pub state: Vec<u8>,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsContinuityKeyPackage {
    pub package_id: String,
    pub data: Vec<u8>,
    pub state: String,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsContinuityPendingGenesis {
    pub conversation_id: String,
    pub transition_id: String,
    pub command_id: String,
    pub state: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsContinuityState {
    pub scope: MlsContinuityScope,
    pub actor_identity_state: Vec<u8>,
    pub provider_pool: Option<MlsContinuityProviderPool>,
    pub key_packages: Vec<MlsContinuityKeyPackage>,
    pub pending_genesis_transitions: Vec<MlsContinuityPendingGenesis>,
}

pub trait MlsContinuityBackup: Send + Sync {
    fn load(&self) -> Result<Option<MlsContinuityState>, String>;

    fn store(&self, state: &MlsContinuityState) -> Result<(), String>;
}

pub(super) struct MlsContinuityBinding {
    pub(super) scope: MlsContinuityScope,
    pub(super) backup: Arc<dyn MlsContinuityBackup>,
}

struct NoopMlsContinuityBackup;

impl MlsContinuityBackup for NoopMlsContinuityBackup {
    fn load(&self) -> Result<Option<MlsContinuityState>, String> {
        Ok(None)
    }

    fn store(&self, _state: &MlsContinuityState) -> Result<(), String> {
        Ok(())
    }
}

pub fn noop_mls_continuity_backup() -> Arc<dyn MlsContinuityBackup> {
    Arc::new(NoopMlsContinuityBackup)
}
