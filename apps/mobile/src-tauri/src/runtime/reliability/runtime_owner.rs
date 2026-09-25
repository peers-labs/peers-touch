use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;

use crate::runtime::command_ledger::{
    CommandLedger, CommandScope, LedgerActivation, LedgerError, LedgerPaths, ScopeKeyMetadata,
    TrustedCommandKey,
};
use crate::runtime::draft_store::DraftStore;
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::MobileDraftEnvelopeV2;

use super::{
    CanonicalReliabilityRoot, ExactScope, KeyVault, LegacyQuarantine, LegacyQuarantineState,
    ReliabilityError, ReliabilityErrorKind, ReliabilityKeyManager, ReliabilityResult,
    ReliabilityStoreCloser,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DraftDisposition {
    Retain,
    Discard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityRuntimeStatus {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_peer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_ptid: Option<String>,
    pub runtime_generation: u64,
    pub admission_open: bool,
    pub pending_commands: u64,
    pub unknown_commands: u64,
    pub draft_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_state: Option<&'static str>,
    pub archived_legacy_files: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityScopeCloseResult {
    pub closed: bool,
    pub draft_disposition: &'static str,
    pub retained_drafts: u64,
    pub records_absent: bool,
    pub secure_physical_deletion_proven: bool,
}

pub(crate) struct ActiveReliabilityScope {
    pub(crate) scope: ExactScope,
    pub(crate) ledger: CommandLedger,
    pub(crate) drafts: DraftStore,
    runtime_generation: AtomicU64,
    admission_open: AtomicBool,
    draft_writes_open: Mutex<bool>,
}

#[derive(Default)]
pub struct ReliabilityRuntime {
    active: Mutex<Option<Arc<ActiveReliabilityScope>>>,
}

impl ReliabilityRuntime {
    pub fn activate<V: KeyVault>(
        &self,
        app_data_root: &Path,
        vault: &V,
        station_peer_id: String,
        actor_ptid: String,
        runtime_generation: u64,
        now_ms: i64,
    ) -> ReliabilityResult<ReliabilityRuntimeStatus> {
        let scope = ExactScope::new(station_peer_id, actor_ptid)?;
        let mut active = self.lock()?;
        if let Some(current) = active.as_ref() {
            if current.scope != scope {
                return Err(ReliabilityError::new(
                    ReliabilityErrorKind::AuthenticationFailed,
                    "reliability runtime is already bound to another Station/PTID scope",
                ));
            }
            current.rebind_generation(runtime_generation)?;
            return current.status();
        }

        let root = CanonicalReliabilityRoot::from_trusted_app_data(app_data_root)?;
        if let super::ReliabilityResetStatus::RecoveryRequired { .. } =
            super::ReliabilityReset::status(&root)?
        {
            return Ok(ReliabilityRuntimeStatus {
                active: false,
                station_peer_id: Some(scope.station_peer_id().to_string()),
                actor_ptid: Some(scope.actor_ptid().to_string()),
                runtime_generation,
                admission_open: false,
                pending_commands: 0,
                unknown_commands: 0,
                draft_count: 0,
                recovery_state: Some("reset-incomplete"),
                archived_legacy_files: 0,
            });
        }
        match LegacyQuarantine::recover(&root)? {
            LegacyQuarantineState::Clean => {}
            LegacyQuarantineState::DispositionRequired { archived_files, .. } => {
                return Ok(ReliabilityRuntimeStatus {
                    active: false,
                    station_peer_id: Some(scope.station_peer_id().to_string()),
                    actor_ptid: Some(scope.actor_ptid().to_string()),
                    runtime_generation,
                    admission_open: false,
                    pending_commands: 0,
                    unknown_commands: 0,
                    draft_count: 0,
                    recovery_state: Some("legacy-disposition-required"),
                    archived_legacy_files: archived_files as u64,
                });
            }
        }

        let key_manager = ReliabilityKeyManager::initialize(&root, vault)?;
        let activation = key_manager.activate_scope(scope.clone())?;
        let ledger = CommandLedger::new();
        ledger
            .activate(LedgerActivation {
                paths: LedgerPaths {
                    database_path: activation.paths().command_database().to_path_buf(),
                    legacy_v1: None,
                },
                scope: CommandScope::new(scope.station_peer_id(), scope.actor_ptid())
                    .map_err(map_ledger_error)?,
                trusted_command_key: TrustedCommandKey::new(
                    *activation.command_key(),
                    ScopeKeyMetadata {
                        kek_id: encode_hex(activation.context().kek_id()),
                        install_epoch: activation.context().install_epoch().to_vec(),
                        command_key_id: format!("command-v2-{}", scope.stable_token()),
                    },
                )
                .map_err(map_ledger_error)?,
                runtime_generation,
                now_ms,
            })
            .map_err(map_ledger_error)?;
        let drafts = match DraftStore::open(&activation) {
            Ok(store) => store,
            Err(error) => {
                let _ = ledger.deactivate();
                return Err(error);
            }
        };
        let activated = Arc::new(ActiveReliabilityScope {
            scope,
            ledger,
            drafts,
            runtime_generation: AtomicU64::new(runtime_generation),
            admission_open: AtomicBool::new(false),
            draft_writes_open: Mutex::new(false),
        });
        let status = activated.status()?;
        *active = Some(activated);
        Ok(status)
    }

    pub fn rebind_generation(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
        runtime_generation: u64,
    ) -> ReliabilityResult<ReliabilityRuntimeStatus> {
        let active = self.active_for_scope(station_peer_id, actor_ptid)?;
        active.rebind_generation(runtime_generation)?;
        active.status()
    }

    pub fn status(&self) -> ReliabilityResult<ReliabilityRuntimeStatus> {
        match self.lock()?.as_ref() {
            Some(active) => active.status(),
            None => Ok(ReliabilityRuntimeStatus::inactive()),
        }
    }

    pub fn suspend_scope(&self) -> ReliabilityResult<ReliabilityRuntimeStatus> {
        let active = self.lock()?.as_ref().cloned().ok_or_else(|| {
            ReliabilityError::new(
                ReliabilityErrorKind::StoreClosed,
                "no reliability scope is active",
            )
        })?;
        active.admission_open.store(false, Ordering::Release);
        *active.lock_draft_writes()? = false;
        active.status()
    }

    pub fn prepare_scope_exit(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
        runtime_generation: u64,
    ) -> ReliabilityResult<ReliabilityRuntimeStatus> {
        let active = self.active_for_scope(station_peer_id, actor_ptid)?;
        if active.runtime_generation() != runtime_generation {
            return Err(ReliabilityError::authentication(
                "scope-exit generation does not match the active reliability generation",
            ));
        }
        active.admission_open.store(false, Ordering::Release);
        let mut draft_writes_open = active.lock_draft_writes()?;
        *draft_writes_open = false;
        active.status()
    }

    pub fn open_admission(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
        runtime_generation: u64,
    ) -> ReliabilityResult<ReliabilityRuntimeStatus> {
        let active = self.active_for_scope(station_peer_id, actor_ptid)?;
        active.rebind_generation(runtime_generation)?;
        *active.lock_draft_writes()? = true;
        active.admission_open.store(true, Ordering::Release);
        active.status()
    }

    pub fn close_scope(
        &self,
        disposition: DraftDisposition,
    ) -> ReliabilityResult<ReliabilityScopeCloseResult> {
        let mut active = self.lock()?;
        let Some(current) = active.as_ref().cloned() else {
            return Ok(ReliabilityScopeCloseResult {
                closed: false,
                draft_disposition: disposition.as_str(),
                retained_drafts: 0,
                records_absent: true,
                secure_physical_deletion_proven: false,
            });
        };
        current.admission_open.store(false, Ordering::Release);
        let mut draft_writes_open = current.lock_draft_writes()?;
        *draft_writes_open = false;
        let mut records_absent = false;
        if disposition == DraftDisposition::Discard {
            let result = current.drafts.discard_scope()?;
            if !result.records_absent {
                return Err(ReliabilityError::new(
                    ReliabilityErrorKind::Io,
                    "draft discard did not remove every exact-scope record",
                ));
            }
            records_absent = true;
        }
        let retained = current.drafts.close_retaining()?;
        let ledger_result = current.ledger.deactivate().map_err(map_ledger_error);
        drop(draft_writes_open);
        ledger_result?;
        *active = None;
        Ok(ReliabilityScopeCloseResult {
            closed: true,
            draft_disposition: disposition.as_str(),
            retained_drafts: retained.retained_records,
            records_absent,
            secure_physical_deletion_proven: false,
        })
    }

    pub(crate) fn active_for_scope(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> ReliabilityResult<Arc<ActiveReliabilityScope>> {
        let active = self.lock()?.as_ref().cloned().ok_or_else(|| {
            ReliabilityError::new(
                ReliabilityErrorKind::StoreClosed,
                "no reliability scope is active",
            )
        })?;
        if active.scope.station_peer_id() != station_peer_id
            || active.scope.actor_ptid() != actor_ptid
        {
            return Err(ReliabilityError::authentication(
                "requested Station/PTID does not match the active reliability scope",
            ));
        }
        Ok(active)
    }

    pub(crate) fn active_for_generation(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
        runtime_generation: u64,
    ) -> ReliabilityResult<Arc<ActiveReliabilityScope>> {
        let active = self.active_for_scope(station_peer_id, actor_ptid)?;
        if active.runtime_generation() != runtime_generation {
            return Err(ReliabilityError::authentication(
                "reliability generation does not match the active runtime",
            ));
        }
        Ok(active)
    }

    pub(crate) fn active_for_admission(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> ReliabilityResult<Arc<ActiveReliabilityScope>> {
        let active = self.active_for_scope(station_peer_id, actor_ptid)?;
        if !active.admission_open.load(Ordering::Acquire) {
            return Err(ReliabilityError::new(
                ReliabilityErrorKind::StoreClosed,
                "reliability command admission is closed",
            ));
        }
        Ok(active)
    }

    fn lock(&self) -> ReliabilityResult<MutexGuard<'_, Option<Arc<ActiveReliabilityScope>>>> {
        self.active
            .lock()
            .map_err(|_| ReliabilityError::corrupt("reliability runtime lock poisoned"))
    }
}

impl DraftDisposition {
    fn as_str(self) -> &'static str {
        match self {
            Self::Retain => "retain",
            Self::Discard => "discard",
        }
    }
}

impl ActiveReliabilityScope {
    pub(crate) fn runtime_generation(&self) -> u64 {
        self.runtime_generation.load(Ordering::Acquire)
    }

    fn rebind_generation(&self, runtime_generation: u64) -> ReliabilityResult<()> {
        let current = self.runtime_generation();
        if runtime_generation < current {
            return Err(ReliabilityError::authentication(
                "new reliability generation is older than the active generation",
            ));
        }
        self.ledger
            .rebind_runtime_generation(runtime_generation)
            .map_err(map_ledger_error)?;
        self.runtime_generation
            .store(runtime_generation, Ordering::Release);
        Ok(())
    }

    fn status(&self) -> ReliabilityResult<ReliabilityRuntimeStatus> {
        let (pending_commands, unknown_commands) =
            self.ledger.recovery_counts().map_err(map_ledger_error)?;
        Ok(ReliabilityRuntimeStatus {
            active: true,
            station_peer_id: Some(self.scope.station_peer_id().to_string()),
            actor_ptid: Some(self.scope.actor_ptid().to_string()),
            runtime_generation: self.runtime_generation(),
            admission_open: self.admission_open.load(Ordering::Acquire),
            pending_commands,
            unknown_commands,
            draft_count: self.drafts.count()?,
            recovery_state: None,
            archived_legacy_files: 0,
        })
    }

    pub(crate) fn save_draft(&self, envelope: &MobileDraftEnvelopeV2) -> ReliabilityResult<()> {
        let draft_writes_open = self.lock_draft_writes()?;
        if !*draft_writes_open {
            return Err(ReliabilityError::new(
                ReliabilityErrorKind::StoreClosed,
                "reliability draft writes are closed",
            ));
        }
        self.drafts.save(envelope)
    }

    fn lock_draft_writes(&self) -> ReliabilityResult<MutexGuard<'_, bool>> {
        self.draft_writes_open
            .lock()
            .map_err(|_| ReliabilityError::corrupt("reliability draft admission lock poisoned"))
    }
}

impl ReliabilityStoreCloser for ReliabilityRuntime {
    fn close_reliability_stores(&self) -> ReliabilityResult<()> {
        let mut active = self.lock()?;
        let Some(current) = active.as_ref().cloned() else {
            return Ok(());
        };
        let mut draft_writes_open = current.lock_draft_writes()?;
        *draft_writes_open = false;
        let draft_result = current.drafts.close_retaining();
        let ledger_result = current.ledger.deactivate().map_err(map_ledger_error);
        drop(draft_writes_open);
        draft_result?;
        ledger_result?;
        *active = None;
        Ok(())
    }
}

impl ReliabilityRuntimeStatus {
    fn inactive() -> Self {
        Self {
            active: false,
            station_peer_id: None,
            actor_ptid: None,
            runtime_generation: 0,
            admission_open: false,
            pending_commands: 0,
            unknown_commands: 0,
            draft_count: 0,
            recovery_state: None,
            archived_legacy_files: 0,
        }
    }
}

fn map_ledger_error(error: LedgerError) -> ReliabilityError {
    ReliabilityError::new(
        ReliabilityErrorKind::CorruptState,
        format!("command ledger: {error}"),
    )
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;

    use zeroize::Zeroizing;

    use super::*;
    use crate::runtime::reliability::codec::{atomic_write, Encoder};
    use crate::runtime::reliability::ReliabilityReset;
    use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
        mobile_draft_envelope_v2, ChatDraftPayload, MobileDraftEnvelopeV2, MobileDraftSurfaceKind,
    };

    #[derive(Default)]
    struct MemoryVault {
        records: Mutex<BTreeMap<String, Vec<u8>>>,
    }

    impl KeyVault for MemoryVault {
        fn load(&self, record_id: &str) -> ReliabilityResult<Option<Zeroizing<Vec<u8>>>> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .get(record_id)
                .cloned()
                .map(Zeroizing::new))
        }

        fn store(&self, record_id: &str, value: &[u8]) -> ReliabilityResult<()> {
            self.records
                .lock()
                .unwrap()
                .insert(record_id.to_string(), value.to_vec());
            Ok(())
        }

        fn delete(&self, record_id: &str) -> ReliabilityResult<()> {
            self.records.lock().unwrap().remove(record_id);
            Ok(())
        }

        fn list(&self, prefix: &str) -> ReliabilityResult<Vec<String>> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect())
        }
    }

    #[test]
    fn activation_binds_one_scope_and_generation() {
        let app_data = std::env::temp_dir().join(format!(
            "pt-reliability-runtime-{}-{}",
            std::process::id(),
            ulid::Ulid::new()
        ));
        let runtime = ReliabilityRuntime::default();
        let vault = MemoryVault::default();
        let status = runtime
            .activate(
                &app_data,
                &vault,
                "station-a".to_string(),
                "ptid:a".to_string(),
                7,
                1_000,
            )
            .unwrap();
        assert!(status.active);
        assert_eq!(status.runtime_generation, 7);
        assert!(runtime
            .activate(
                &app_data,
                &vault,
                "station-b".to_string(),
                "ptid:a".to_string(),
                8,
                2_000,
            )
            .is_err());
        let closed = runtime.close_scope(DraftDisposition::Retain).unwrap();
        assert!(closed.closed);
        assert_eq!(closed.draft_disposition, "retain");
        assert!(!runtime.status().unwrap().active);
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn generation_bound_reads_reject_stale_callers() {
        let app_data = std::env::temp_dir().join(format!(
            "pt-reliability-runtime-generation-{}-{}",
            std::process::id(),
            ulid::Ulid::new()
        ));
        let runtime = ReliabilityRuntime::default();
        let vault = MemoryVault::default();
        runtime
            .activate(
                &app_data,
                &vault,
                "station-a".to_string(),
                "ptid:a".to_string(),
                7,
                1_000,
            )
            .unwrap();

        assert!(runtime
            .active_for_generation("station-a", "ptid:a", 7)
            .is_ok());
        let stale_error = match runtime.active_for_generation("station-a", "ptid:a", 6) {
            Ok(_) => panic!("stale generation unexpectedly resolved"),
            Err(error) => error,
        };
        assert_eq!(
            stale_error.kind(),
            ReliabilityErrorKind::AuthenticationFailed
        );

        runtime.close_scope(DraftDisposition::Discard).unwrap();
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn exact_scope_reauthentication_reopens_retained_drafts() {
        let app_data = std::env::temp_dir().join(format!(
            "pt-reliability-runtime-reauth-{}-{}",
            std::process::id(),
            ulid::Ulid::new()
        ));
        let runtime = ReliabilityRuntime::default();
        let vault = MemoryVault::default();
        runtime
            .activate(
                &app_data,
                &vault,
                "station-a".to_string(),
                "ptid:a".to_string(),
                7,
                1_000,
            )
            .unwrap();
        let active = runtime.active_for_scope("station-a", "ptid:a").unwrap();
        active
            .drafts
            .save(&MobileDraftEnvelopeV2 {
                schema_revision: super::super::RELIABILITY_SCHEMA_REVISION,
                station_peer_id: "station-a".to_string(),
                actor_ptid: "ptid:a".to_string(),
                surface_kind: MobileDraftSurfaceKind::ChatComposer as i32,
                target_id: "conversation-a".to_string(),
                updated_at: Some(prost_types::Timestamp {
                    seconds: 1,
                    nanos: 0,
                }),
                payload: Some(mobile_draft_envelope_v2::Payload::Chat(ChatDraftPayload {
                    text: "retained".to_string(),
                    reply_to_message_id: String::new(),
                    attachment_refs: Vec::new(),
                })),
            })
            .unwrap();
        drop(active);

        let closed = runtime.close_scope(DraftDisposition::Retain).unwrap();
        assert_eq!(closed.retained_drafts, 1);
        let reopened = runtime
            .activate(
                &app_data,
                &vault,
                "station-a".to_string(),
                "ptid:a".to_string(),
                8,
                2_000,
            )
            .unwrap();
        assert!(reopened.active);
        assert_eq!(reopened.runtime_generation, 8);
        assert_eq!(reopened.draft_count, 1);
        runtime.close_scope(DraftDisposition::Discard).unwrap();
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn scope_exit_fences_and_drains_draft_writes_before_counting() {
        let app_data = std::env::temp_dir().join(format!(
            "pt-reliability-runtime-scope-exit-{}-{}",
            std::process::id(),
            ulid::Ulid::new()
        ));
        let runtime = ReliabilityRuntime::default();
        let vault = MemoryVault::default();
        runtime
            .activate(
                &app_data,
                &vault,
                "station-a".to_string(),
                "ptid:a".to_string(),
                7,
                1_000,
            )
            .unwrap();
        runtime.open_admission("station-a", "ptid:a", 7).unwrap();
        let active = runtime.active_for_scope("station-a", "ptid:a").unwrap();
        let draft = MobileDraftEnvelopeV2 {
            schema_revision: super::super::RELIABILITY_SCHEMA_REVISION,
            station_peer_id: "station-a".to_string(),
            actor_ptid: "ptid:a".to_string(),
            surface_kind: MobileDraftSurfaceKind::ChatComposer as i32,
            target_id: "conversation-a".to_string(),
            updated_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            payload: Some(mobile_draft_envelope_v2::Payload::Chat(ChatDraftPayload {
                text: "retained".to_string(),
                reply_to_message_id: String::new(),
                attachment_refs: Vec::new(),
            })),
        };
        active.save_draft(&draft).unwrap();

        let fenced = runtime
            .prepare_scope_exit("station-a", "ptid:a", 7)
            .unwrap();
        assert!(!fenced.admission_open);
        assert_eq!(fenced.draft_count, 1);
        assert_eq!(
            active.save_draft(&draft).unwrap_err().kind(),
            ReliabilityErrorKind::StoreClosed
        );

        runtime.open_admission("station-a", "ptid:a", 7).unwrap();
        active.save_draft(&draft).unwrap();
        runtime.close_scope(DraftDisposition::Discard).unwrap();
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn activation_projects_an_interrupted_reset_for_explicit_recovery() {
        let app_data = std::env::temp_dir().join(format!(
            "pt-reliability-runtime-reset-recovery-{}-{}",
            std::process::id(),
            ulid::Ulid::new()
        ));
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data).unwrap();
        let mut journal = Encoder::new(b"PTRJ");
        journal.u16(1);
        journal.u8(1);
        journal.u32(0);
        atomic_write(&root.reset_journal_path(), &journal.finish()).unwrap();
        let runtime = ReliabilityRuntime::default();
        let vault = MemoryVault::default();

        let status = runtime
            .activate(
                &app_data,
                &vault,
                "station-a".to_string(),
                "ptid:a".to_string(),
                7,
                1_000,
            )
            .unwrap();

        assert!(!status.active);
        assert_eq!(status.recovery_state, Some("reset-incomplete"));
        ReliabilityReset::reset_all(&root, &vault, &runtime).unwrap();
        fs::remove_dir_all(app_data).unwrap();
    }
}
