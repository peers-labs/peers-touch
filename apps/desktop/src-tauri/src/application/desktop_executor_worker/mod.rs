use crate::model::agent::ErrorPayload;
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;

pub(crate) mod fenced_executor;
pub(crate) mod local_executor;
pub(crate) mod receipt_ledger;
pub(crate) mod recovery_signer;
pub(crate) mod resource_registry;
pub(crate) mod station_transport;
pub(crate) mod supervisor;

pub use supervisor::CapabilityWorkerSupervisor;

const CANVAS_READINESS_ERROR_CODE: &str = "AGENT_CANVAS_SINGLE_AGENT_NOT_READY";
const CANVAS_READINESS_LOCALE_KEY: &str = "agent.errors.canvasSingleAgentNotReady";
const CANVAS_READINESS_REQUIRED_GATE: &str = "agent-v2-kernel-foundation-e2e";

// The snake_case name is the cross-runtime D11 audit marker.
fn enforce_canvas_single_agent_readiness() -> Result<(), ErrorPayload> {
    Err(ErrorPayload {
        error: CANVAS_READINESS_LOCALE_KEY.to_string(),
        error_type: CANVAS_READINESS_ERROR_CODE.to_string(),
        locale_key: CANVAS_READINESS_LOCALE_KEY.to_string(),
        retryable: false,
        terminal: true,
        details: HashMap::from([(
            "required_gate".to_string(),
            CANVAS_READINESS_REQUIRED_GATE.to_string(),
        )]),
    })
}

pub fn start(_state: Arc<AppState>) {
    if let Err(blocker) = enforce_canvas_single_agent_readiness() {
        tracing::info!(
            code = %blocker.error_type,
            required_gate = %blocker.details.get("required_gate").map_or("", String::as_str),
            "desktop executor worker blocked by single-Agent readiness"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::actor_device_identity::ActorDeviceIdentity;
    use crate::model::agent::{
        ClientCapabilityReceipt, ClientCapabilityReceiptStatus, ClientCapabilityRequest,
        ClientExecutionReplayPolicy, ClientResourceRef, ReceiptRecoveryCredential,
        ReceiptRecoveryScopePayload, ReceiptRecoverySigningPayload,
    };
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use fenced_executor::{
        CapabilityContract, CapabilityExecutor, ExecutionLease, FencedExecutor, ReceiptReporter,
    };
    use prost::Message;
    use receipt_ledger::ReceiptLedger;
    use resource_registry::{LocalResource, RegisterResource, ResourceRegistry};
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    #[test]
    fn desktop_executor_worker_fails_before_starting_any_runtime_effect() {
        let blocker =
            enforce_canvas_single_agent_readiness().expect_err("guard must remain closed");
        assert_eq!(blocker.error_type, CANVAS_READINESS_ERROR_CODE);
        assert_eq!(
            blocker.details.get("required_gate").map(String::as_str),
            Some(CANVAS_READINESS_REQUIRED_GATE),
        );
    }

    #[test]
    fn client_capability_persists_prepared_before_side_effect_and_replays_terminal() {
        let fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let kernel = fixture.kernel(&executor, &reporter);

        let first = kernel
            .consume_at(envelope.clone(), fixture.now_ms)
            .expect("first delivery");
        assert_eq!(
            first.receipt.status,
            ClientCapabilityReceiptStatus::Applied as i32
        );
        assert!(first.side_effect_executed);
        assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            reporter.statuses(),
            vec![
                ClientCapabilityReceiptStatus::Prepared as i32,
                ClientCapabilityReceiptStatus::Applied as i32,
            ]
        );

        let duplicate = kernel
            .consume_at(envelope, fixture.now_ms + 1)
            .expect("duplicate delivery");
        assert!(duplicate.duplicate);
        assert!(!duplicate.side_effect_executed);
        assert_eq!(duplicate.receipt.result_id, first.receipt.result_id);
        assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn tool_receipt_restart_without_replay_settles_unknown_without_side_effect() {
        let fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        let prepared = prepared_for_test(&envelope, fixture.now_ms);
        fixture
            .ledger
            .prepare(&fixture.lease.station_url, &envelope, &prepared)
            .expect("persist crash barrier");
        let persisted = fixture.ledger.list().expect("scan persisted receipts");
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].station_url, fixture.lease.station_url);

        let reopened = ReceiptLedger::open_test(&fixture.ledger_path).expect("reopen ledger");
        let executor = RecordingExecutor::new(
            reopened.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let kernel = FencedExecutor::new(
            &fixture.lease,
            &reopened,
            &fixture.resources,
            &fixture.identity,
            &executor,
            &reporter,
        );
        let recovered = kernel
            .consume_at(envelope, fixture.now_ms + 1)
            .expect("recover PREPARED receipt");

        assert_eq!(
            recovered.receipt.status,
            ClientCapabilityReceiptStatus::ReconciledUnknown as i32
        );
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn client_capability_same_fence_prepared_requires_station_takeover() {
        let fixture = Fixture::new(true);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::WithExternalIdempotency);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist crash barrier");
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            true,
        );
        let reporter = RecordingReporter::default();
        let kernel = fixture.kernel(&executor, &reporter);

        let error = kernel
            .consume_at(envelope.clone(), fixture.now_ms + 1)
            .expect_err("same-fence PREPARED replay must require Station takeover");

        assert_eq!(error, "CLIENT_CAPABILITY_STATION_TAKEOVER_REQUIRED");
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
        let stored = fixture
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)
            .expect("load PREPARED receipt")
            .expect("PREPARED receipt remains durable");
        assert_eq!(
            stored.receipt.status,
            ClientCapabilityReceiptStatus::Prepared as i32
        );
    }

    #[test]
    fn client_capability_station_takeover_uses_a_distinct_higher_fence_attempt() {
        let mut fixture = Fixture::new(true);
        let original = fixture.envelope(ClientExecutionReplayPolicy::WithExternalIdempotency);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &original,
                &prepared_for_test(&original, fixture.now_ms),
            )
            .expect("persist original PREPARED attempt");

        fixture.lease.capability_session_id = "session-2".to_string();
        fixture.lease.executor_lease_id = "lease-2".to_string();
        fixture.lease.lease_revision += 1;
        let mut takeover = original.clone();
        takeover.request_id = "request-2".to_string();
        takeover.capability_session_id = fixture.lease.capability_session_id.clone();
        takeover.executor_lease_id = fixture.lease.executor_lease_id.clone();
        takeover.capability_lease_revision = fixture.lease.lease_revision;
        takeover.fencing_token += 1;
        takeover.dispatch_sequence += 1;
        takeover.sequence = takeover.dispatch_sequence;
        refresh_hashes(&mut takeover, &fixture.lease.actor_ptid);

        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            takeover.tool_call_id.clone(),
            takeover.fencing_token,
            true,
        );
        let reporter = RecordingReporter::default();
        let consumed = fixture
            .kernel(&executor, &reporter)
            .consume_at(takeover.clone(), fixture.now_ms + 1)
            .expect("consume Station takeover envelope");

        assert!(consumed.side_effect_executed);
        assert_eq!(
            executor.idempotency_keys.lock().unwrap().as_slice(),
            [original.external_idempotency_key]
        );
        assert!(fixture
            .ledger
            .load(&original.tool_call_id, original.fencing_token)
            .unwrap()
            .is_some());
        assert!(fixture
            .ledger
            .load(&takeover.tool_call_id, takeover.fencing_token)
            .unwrap()
            .is_some());
    }

    #[test]
    fn client_capability_rejects_stale_authority_before_prepared() {
        let fixture = Fixture::new(false);
        let mut envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        envelope.capability_lease_revision += 1;
        refresh_hashes(&mut envelope, &fixture.lease.actor_ptid);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope.clone(), fixture.now_ms)
            .expect_err("stale revision must fail");

        assert_eq!(error, "CLIENT_CAPABILITY_AUTHORITY_MISMATCH");
        assert!(fixture
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)
            .unwrap()
            .is_none());
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn client_capability_rejects_receipt_from_another_station() {
        let mut fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist first Station receipt");
        fixture.lease.station_url = "https://other-station.example".to_string();
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();

        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope, fixture.now_ms + 1)
            .expect_err("receipt authority must remain Station-scoped");

        assert_eq!(error, "CLIENT_CAPABILITY_ENVELOPE_CONFLICT");
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
        assert!(reporter.statuses().is_empty());
    }

    #[test]
    fn client_capability_revoke_stops_before_prepared() {
        let mut fixture = Fixture::new(false);
        fixture.lease.revoked = true;
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();

        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope.clone(), fixture.now_ms)
            .expect_err("revoked lease must stop before PREPARED");

        assert_eq!(error, "CLIENT_CAPABILITY_LEASE_INACTIVE");
        assert!(fixture
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)
            .unwrap()
            .is_none());
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn client_capability_expiry_stops_restart_replay_before_side_effect() {
        let mut fixture = Fixture::new(true);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::WithExternalIdempotency);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist crash barrier");
        fixture.lease.expires_at_ms = fixture.now_ms;
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            true,
        );
        let reporter = RecordingReporter::default();

        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope, fixture.now_ms + 1)
            .expect_err("expired lease must not replay a side effect");

        assert_eq!(error, "CLIENT_CAPABILITY_LEASE_INACTIVE");
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn client_capability_resolves_actor_device_scoped_opaque_resource() {
        let fixture = Fixture::new(false);
        fixture
            .resources
            .register(RegisterResource {
                opaque_ref: "resource-1",
                capability_session_id: &fixture.lease.capability_session_id,
                capability_id: "filesystem.read",
                permission_grant_id: "grant-1",
                integrity_hash: "sha256:file",
                locator: "/private/device/alice/workspace",
                expires_at_ms: fixture.now_ms + 120_000,
            })
            .expect("register opaque resource");
        let mut envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        envelope.resource_refs = vec![ClientResourceRef {
            resource_ref: "resource-1".to_string(),
            ptid: fixture.lease.actor_ptid.clone(),
            device_id: fixture.lease.device_id.clone(),
            capability_session_id: fixture.lease.capability_session_id.clone(),
            capability_id: envelope.capability_id.clone(),
            expires_at: Some(timestamp(fixture.now_ms + 120_000)),
            permission_grant_id: "grant-1".to_string(),
            integrity_hash: "sha256:file".to_string(),
        }];
        refresh_hashes(&mut envelope, &fixture.lease.actor_ptid);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();

        fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope, fixture.now_ms)
            .expect("consume opaque resource");

        let resources = executor.resources.lock().unwrap();
        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].opaque_ref, "resource-1");
        assert_eq!(resources[0].locator, "/private/device/alice/workspace");
    }

    #[test]
    fn tool_receipt_late_recovery_is_signed_and_terminal_only() {
        let mut fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist crash barrier");
        fixture.lease.revoked = true;
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let recovered = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope.clone(), fixture.now_ms + 61_000)
            .expect("signed terminal recovery");
        let proof = recovered
            .receipt
            .recovery_proof
            .as_ref()
            .expect("recovery proof");
        let credential = envelope.recovery_credential.as_ref().unwrap();
        let payload = ReceiptRecoverySigningPayload {
            domain: recovery_signer::RECEIPT_RECOVERY_DOMAIN.to_string(),
            credential_id: credential.credential_id.clone(),
            nonce: credential.nonce.clone(),
            device_signing_key_id: credential.device_signing_key_id.clone(),
            scope_hash: credential.scope_hash.clone(),
            receipt_digest: recovery_signer::receipt_digest(&recovered.receipt),
        };
        let (_, public_key) = fixture.identity.signing_identity().unwrap();
        let public_key: [u8; 32] = public_key.try_into().expect("Ed25519 public key");
        let signature: [u8; 64] = proof
            .signature
            .clone()
            .try_into()
            .expect("Ed25519 signature");
        VerifyingKey::from_bytes(&public_key)
            .unwrap()
            .verify(&payload.encode_to_vec(), &Signature::from_bytes(&signature))
            .expect("valid recovery signature");
        assert_eq!(
            recovered.receipt.status,
            ClientCapabilityReceiptStatus::ReconciledUnknown as i32
        );
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    struct Fixture {
        now_ms: i64,
        ledger_path: std::path::PathBuf,
        ledger: ReceiptLedger,
        resources: ResourceRegistry,
        identity: ActorDeviceIdentity,
        lease: ExecutionLease,
    }

    impl Fixture {
        fn new(_supports_external_idempotency: bool) -> Self {
            let now_ms = current_time_ms();
            let root = std::env::temp_dir().join(format!("g1-c-{}", ulid::Ulid::new()));
            std::fs::create_dir_all(&root).unwrap();
            let ledger_path = root.join("receipts.db");
            let actor_ptid = "ptid:test:alice";
            let device_id = "alice-device";
            let identity = ActorDeviceIdentity::new();
            identity.init(actor_ptid, device_id).unwrap();
            Self {
                now_ms,
                ledger: ReceiptLedger::open_test(&ledger_path).unwrap(),
                ledger_path,
                resources: ResourceRegistry::open_test(
                    &root.join("resources.db"),
                    actor_ptid,
                    device_id,
                )
                .unwrap(),
                identity,
                lease: ExecutionLease {
                    station_url: "https://station.example".to_string(),
                    actor_ptid: actor_ptid.to_string(),
                    device_id: device_id.to_string(),
                    capability_session_id: "session-1".to_string(),
                    executor_lease_id: "lease-1".to_string(),
                    lease_revision: 7,
                    expires_at_ms: now_ms + 60_000,
                    revoked: false,
                },
            }
        }

        fn envelope(&self, replay_policy: ClientExecutionReplayPolicy) -> ClientCapabilityRequest {
            let (signing_key_id, _) = self.identity.signing_identity().unwrap();
            let mut envelope = ClientCapabilityRequest {
                request_id: "request-1".to_string(),
                turn_id: "turn-1".to_string(),
                tool_call_id: "tool-call-1".to_string(),
                capability_session_id: self.lease.capability_session_id.clone(),
                capability_id: "filesystem.read".to_string(),
                schema_version: "1".to_string(),
                resource_refs: Vec::new(),
                bounded_arguments: br#"{"path":"note.txt"}"#.to_vec(),
                approval_id: "approval-1".to_string(),
                sequence: 11,
                attempt_id: "attempt-1".to_string(),
                target_device_id: self.lease.device_id.clone(),
                decision_id: "decision-1".to_string(),
                decision_revision: 3,
                execution_claim_id: "claim-1".to_string(),
                executor_lease_id: self.lease.executor_lease_id.clone(),
                fencing_token: 5,
                dispatch_sequence: 11,
                payload_hash: String::new(),
                execution_deadline: Some(timestamp(self.now_ms + 30_000)),
                tool_batch_id: "batch-1".to_string(),
                replay_policy: replay_policy as i32,
                external_idempotency_key: if replay_policy
                    == ClientExecutionReplayPolicy::WithExternalIdempotency
                {
                    "station-issued-key".to_string()
                } else {
                    String::new()
                },
                recovery_credential: None,
                reconciliation_deadline: Some(timestamp(self.now_ms + 120_000)),
                capability_lease_revision: self.lease.lease_revision,
            };
            envelope.payload_hash = payload_hash(&envelope);
            envelope.recovery_credential = Some(ReceiptRecoveryCredential {
                credential_id: "credential-1".to_string(),
                device_signing_key_id: signing_key_id,
                nonce: vec![7; 32],
                scope_hash: String::new(),
                expires_at: envelope.reconciliation_deadline.clone(),
            });
            refresh_hashes(&mut envelope, &self.lease.actor_ptid);
            envelope
        }

        fn kernel<'a>(
            &'a self,
            executor: &'a dyn CapabilityExecutor,
            reporter: &'a dyn ReceiptReporter,
        ) -> FencedExecutor<'a> {
            FencedExecutor::new(
                &self.lease,
                &self.ledger,
                &self.resources,
                &self.identity,
                executor,
                reporter,
            )
        }
    }

    struct RecordingExecutor {
        ledger: ReceiptLedger,
        tool_call_id: String,
        fencing_token: u64,
        supports_external_idempotency: bool,
        calls: AtomicUsize,
        idempotency_keys: Mutex<Vec<String>>,
        resources: Mutex<Vec<LocalResource>>,
    }

    impl RecordingExecutor {
        fn new(
            ledger: ReceiptLedger,
            tool_call_id: String,
            fencing_token: u64,
            supports_external_idempotency: bool,
        ) -> Self {
            Self {
                ledger,
                tool_call_id,
                fencing_token,
                supports_external_idempotency,
                calls: AtomicUsize::new(0),
                idempotency_keys: Mutex::new(Vec::new()),
                resources: Mutex::new(Vec::new()),
            }
        }
    }

    impl CapabilityExecutor for RecordingExecutor {
        fn contract(&self, capability_id: &str) -> Option<CapabilityContract> {
            Some(CapabilityContract {
                capability_id: capability_id.to_string(),
                schema_version: "1".to_string(),
                max_argument_bytes: 4096,
                max_result_bytes: 4096,
                supports_external_idempotency: self.supports_external_idempotency,
            })
        }

        fn execute(
            &self,
            _request: &ClientCapabilityRequest,
            resources: &[LocalResource],
            external_idempotency_key: Option<&str>,
        ) -> Result<Vec<u8>, String> {
            let persisted = self
                .ledger
                .load(&self.tool_call_id, self.fencing_token)?
                .ok_or_else(|| "PREPARED was not durable before side effect".to_string())?;
            if persisted.receipt.status != ClientCapabilityReceiptStatus::Prepared as i32 {
                return Err("PREPARED was not durable before side effect".to_string());
            }
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(key) = external_idempotency_key {
                self.idempotency_keys.lock().unwrap().push(key.to_string());
            }
            self.resources.lock().unwrap().extend_from_slice(resources);
            Ok(br#"{"ok":true}"#.to_vec())
        }
    }

    #[derive(Default)]
    struct RecordingReporter {
        receipts: Mutex<Vec<ClientCapabilityReceipt>>,
    }

    impl RecordingReporter {
        fn statuses(&self) -> Vec<i32> {
            self.receipts
                .lock()
                .unwrap()
                .iter()
                .map(|receipt| receipt.status)
                .collect()
        }
    }

    impl ReceiptReporter for RecordingReporter {
        fn submit(&self, receipt: &ClientCapabilityReceipt) -> Result<(), String> {
            self.receipts.lock().unwrap().push(receipt.clone());
            Ok(())
        }
    }

    fn prepared_for_test(
        envelope: &ClientCapabilityRequest,
        now_ms: i64,
    ) -> ClientCapabilityReceipt {
        ClientCapabilityReceipt {
            request_id: envelope.request_id.clone(),
            turn_id: envelope.turn_id.clone(),
            tool_call_id: envelope.tool_call_id.clone(),
            capability_session_id: envelope.capability_session_id.clone(),
            target_device_id: envelope.target_device_id.clone(),
            decision_id: envelope.decision_id.clone(),
            decision_revision: envelope.decision_revision,
            execution_claim_id: envelope.execution_claim_id.clone(),
            executor_lease_id: envelope.executor_lease_id.clone(),
            fencing_token: envelope.fencing_token,
            dispatch_sequence: envelope.dispatch_sequence,
            payload_hash: envelope.payload_hash.clone(),
            side_effect_receipt_id: "receipt-crash".to_string(),
            status: ClientCapabilityReceiptStatus::Prepared as i32,
            bounded_result: Vec::new(),
            error_code: String::new(),
            sequence: envelope.sequence,
            occurred_at: Some(timestamp(now_ms)),
            result_id: String::new(),
            tool_batch_id: envelope.tool_batch_id.clone(),
            recovery_proof: None,
        }
    }

    fn refresh_hashes(envelope: &mut ClientCapabilityRequest, actor_ptid: &str) {
        envelope.payload_hash = payload_hash(envelope);
        let credential = envelope.recovery_credential.as_ref().unwrap();
        let scope = ReceiptRecoveryScopePayload {
            actor_ptid: actor_ptid.to_string(),
            device_id: envelope.target_device_id.clone(),
            request_id: envelope.request_id.clone(),
            tool_call_id: envelope.tool_call_id.clone(),
            execution_claim_id: envelope.execution_claim_id.clone(),
            capability_lease_revision: envelope.capability_lease_revision,
            fencing_token: envelope.fencing_token,
            payload_hash: envelope.payload_hash.clone(),
            replay_policy: envelope.replay_policy,
            execution_deadline: envelope.execution_deadline.clone(),
            reconciliation_deadline: envelope.reconciliation_deadline.clone(),
            credential_id: credential.credential_id.clone(),
            device_signing_key_id: credential.device_signing_key_id.clone(),
            nonce: credential.nonce.clone(),
        };
        envelope.recovery_credential.as_mut().unwrap().scope_hash =
            hex::encode(Sha256::digest(scope.encode_to_vec()));
    }

    fn payload_hash(envelope: &ClientCapabilityRequest) -> String {
        let mut canonical = envelope.clone();
        canonical.payload_hash.clear();
        canonical.recovery_credential = None;
        hex::encode(Sha256::digest(canonical.encode_to_vec()))
    }

    fn timestamp(milliseconds: i64) -> prost_types::Timestamp {
        prost_types::Timestamp {
            seconds: milliseconds / 1_000,
            nanos: ((milliseconds % 1_000) * 1_000_000) as i32,
        }
    }

    fn current_time_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }
}
