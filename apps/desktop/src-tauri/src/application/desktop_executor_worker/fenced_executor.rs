use super::receipt_ledger::{ReceiptLedger, ReceiptRecord};
use super::recovery_signer::sign_terminal_recovery;
use super::resource_registry::{LocalResource, ResourceRegistry};
use crate::model::agent::{
    ClientCapabilityReceipt, ClientCapabilityReceiptStatus, ClientCapabilityRequest,
    ClientExecutionReplayPolicy, ClientResourceRef, ReceiptRecoveryScopePayload,
};
use prost::Message;
use sha2::{Digest, Sha256};

const INVALID_RESOURCE_REFERENCE_ERROR: &str = "CLIENT_INVALID_RESOURCE_REFERENCE";

#[derive(Debug, Clone)]
pub struct ExecutionLease {
    pub station_url: String,
    pub actor_ptid: String,
    pub device_id: String,
    pub capability_session_id: String,
    pub executor_lease_id: String,
    pub lease_revision: u64,
    pub expires_at_ms: i64,
    pub revoked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityContract {
    pub capability_id: String,
    pub schema_version: String,
    pub max_argument_bytes: usize,
    pub max_result_bytes: usize,
    pub supports_external_idempotency: bool,
}

pub trait CapabilityExecutor {
    fn contract(&self, capability_id: &str) -> Option<CapabilityContract>;

    fn execute(
        &self,
        request: &ClientCapabilityRequest,
        resources: &[LocalResource],
        external_idempotency_key: Option<&str>,
        record_side_effect_start: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<Vec<u8>, String>;
}

pub trait ReceiptReporter {
    fn submit(&self, receipt: &ClientCapabilityReceipt) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConsumeOutcome {
    pub receipt: ClientCapabilityReceipt,
    pub duplicate: bool,
    pub side_effect_executed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InvalidResourceReference {
    resource_kind: String,
    resource_ref_hash: String,
}

enum ResourceResolutionError {
    Invalid(InvalidResourceReference),
    Internal(String),
}

pub struct FencedExecutor<'a> {
    lease: &'a ExecutionLease,
    ledger: &'a ReceiptLedger,
    resources: &'a ResourceRegistry,
    signing_key_id: &'a str,
    signing_key: &'a ed25519_dalek::SigningKey,
    executor: &'a dyn CapabilityExecutor,
    reporter: &'a dyn ReceiptReporter,
}

impl<'a> FencedExecutor<'a> {
    pub fn new(
        lease: &'a ExecutionLease,
        ledger: &'a ReceiptLedger,
        resources: &'a ResourceRegistry,
        signing_key_id: &'a str,
        signing_key: &'a ed25519_dalek::SigningKey,
        executor: &'a dyn CapabilityExecutor,
        reporter: &'a dyn ReceiptReporter,
    ) -> Self {
        Self {
            lease,
            ledger,
            resources,
            signing_key_id,
            signing_key,
            executor,
            reporter,
        }
    }

    pub fn consume(&self, envelope: ClientCapabilityRequest) -> Result<ConsumeOutcome, String> {
        self.consume_at(envelope, now_unix_ms())
    }

    pub(crate) fn consume_at(
        &self,
        envelope: ClientCapabilityRequest,
        now_ms: i64,
    ) -> Result<ConsumeOutcome, String> {
        let contract = self.validate_envelope(&envelope, now_ms)?;

        if let Some(existing) = self
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)?
        {
            ensure_identical_envelope(&existing, &envelope, &self.lease.station_url)?;
            return self.resume_existing(&envelope, existing, now_ms);
        }

        if self.lease.revoked || self.lease.expires_at_ms <= now_ms {
            return Err("CLIENT_CAPABILITY_LEASE_INACTIVE".to_string());
        }
        if timestamp_ms(required_timestamp(
            envelope.execution_deadline.as_ref(),
            "execution_deadline",
        )?)? <= now_ms
        {
            return Err("CLIENT_CAPABILITY_EXECUTION_DEADLINE_EXPIRED".to_string());
        }

        let prepared = prepared_receipt(&envelope, now_ms);
        self.ledger
            .prepare(&self.lease.station_url, &envelope, &prepared)?;
        self.reporter.submit(&prepared).map_err(|error| {
            format!("submit PREPARED receipt before local side effect: {error}")
        })?;

        let resolved_resources = match self.resolve_resources(&envelope, now_ms) {
            Ok(resources) => resources,
            Err(ResourceResolutionError::Invalid(invalid)) => {
                let bounded_result = invalid.bounded_result()?;
                return self.commit_and_submit_terminal(
                    &envelope,
                    terminal_receipt(
                        &envelope,
                        prepared.side_effect_receipt_id,
                        ClientCapabilityReceiptStatus::Failed,
                        bounded_result,
                        INVALID_RESOURCE_REFERENCE_ERROR,
                        now_ms,
                    ),
                    false,
                    false,
                    now_ms,
                );
            }
            Err(ResourceResolutionError::Internal(error)) => return Err(error),
        };

        self.execute_after_prepared(&envelope, &resolved_resources, &contract, false, now_ms)
    }

    fn resume_existing(
        &self,
        envelope: &ClientCapabilityRequest,
        existing: ReceiptRecord,
        now_ms: i64,
    ) -> Result<ConsumeOutcome, String> {
        if existing.receipt.status != ClientCapabilityReceiptStatus::Prepared as i32 {
            let outbound = self.receipt_for_submission(envelope, existing.receipt, now_ms)?;
            self.reporter.submit(&outbound)?;
            if outbound.error_code != INVALID_RESOURCE_REFERENCE_ERROR {
                self.cleanup_resources(envelope)?;
            }
            return Ok(ConsumeOutcome {
                receipt: outbound,
                duplicate: true,
                side_effect_executed: false,
            });
        }

        match ClientExecutionReplayPolicy::try_from(envelope.replay_policy)
            .unwrap_or(ClientExecutionReplayPolicy::Unspecified)
        {
            ClientExecutionReplayPolicy::NoReplayAfterPrepared => self.commit_and_submit_terminal(
                envelope,
                terminal_receipt(
                    envelope,
                    existing.receipt.side_effect_receipt_id,
                    ClientCapabilityReceiptStatus::ReconciledUnknown,
                    Vec::new(),
                    "CLIENT_CAPABILITY_SIDE_EFFECT_UNKNOWN",
                    now_ms,
                ),
                true,
                false,
                now_ms,
            ),
            ClientExecutionReplayPolicy::WithExternalIdempotency => {
                self.ensure_execution_authority(envelope, now_ms)?;
                Err("CLIENT_CAPABILITY_STATION_TAKEOVER_REQUIRED".to_string())
            }
            ClientExecutionReplayPolicy::Unspecified => {
                Err("CLIENT_CAPABILITY_REPLAY_POLICY_UNSPECIFIED".to_string())
            }
        }
    }

    fn ensure_execution_authority(
        &self,
        envelope: &ClientCapabilityRequest,
        now_ms: i64,
    ) -> Result<(), String> {
        if self.lease.revoked || self.lease.expires_at_ms <= now_ms {
            return Err("CLIENT_CAPABILITY_LEASE_INACTIVE".to_string());
        }
        if timestamp_ms(required_timestamp(
            envelope.execution_deadline.as_ref(),
            "execution_deadline",
        )?)? <= now_ms
        {
            return Err("CLIENT_CAPABILITY_EXECUTION_DEADLINE_EXPIRED".to_string());
        }
        Ok(())
    }

    fn execute_after_prepared(
        &self,
        envelope: &ClientCapabilityRequest,
        resources: &[LocalResource],
        contract: &CapabilityContract,
        duplicate: bool,
        prepared_at_ms: i64,
    ) -> Result<ConsumeOutcome, String> {
        let idempotency_key = match ClientExecutionReplayPolicy::try_from(envelope.replay_policy)
            .unwrap_or(ClientExecutionReplayPolicy::Unspecified)
        {
            ClientExecutionReplayPolicy::WithExternalIdempotency => {
                if !contract.supports_external_idempotency {
                    return Err("CLIENT_CAPABILITY_EXTERNAL_IDEMPOTENCY_UNSUPPORTED".to_string());
                }
                Some(envelope.external_idempotency_key.as_str())
            }
            ClientExecutionReplayPolicy::NoReplayAfterPrepared => None,
            ClientExecutionReplayPolicy::Unspecified => {
                return Err("CLIENT_CAPABILITY_REPLAY_POLICY_UNSPECIFIED".to_string())
            }
        };
        let side_effect_receipt_id = self
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)?
            .ok_or_else(|| "CLIENT_CAPABILITY_PREPARED_RECEIPT_MISSING".to_string())?
            .receipt
            .side_effect_receipt_id;
        let mut record_side_effect_start = || self.ledger.record_side_effect_start(envelope);
        let executed = self.executor.execute(
            envelope,
            resources,
            idempotency_key,
            &mut record_side_effect_start,
        );
        let terminal_at_ms = now_unix_ms().max(prepared_at_ms);
        let receipt = match executed {
            Ok(result) if result.len() <= contract.max_result_bytes => terminal_receipt(
                envelope,
                side_effect_receipt_id,
                ClientCapabilityReceiptStatus::Applied,
                result,
                "",
                terminal_at_ms,
            ),
            Ok(_) => terminal_receipt(
                envelope,
                side_effect_receipt_id,
                ClientCapabilityReceiptStatus::Failed,
                Vec::new(),
                "CLIENT_CAPABILITY_RESULT_TOO_LARGE",
                terminal_at_ms,
            ),
            Err(error_code) => terminal_receipt(
                envelope,
                side_effect_receipt_id,
                ClientCapabilityReceiptStatus::Failed,
                Vec::new(),
                &error_code,
                terminal_at_ms,
            ),
        };
        self.commit_and_submit_terminal(envelope, receipt, duplicate, true, terminal_at_ms)
    }

    fn commit_and_submit_terminal(
        &self,
        envelope: &ClientCapabilityRequest,
        receipt: ClientCapabilityReceipt,
        duplicate: bool,
        side_effect_executed: bool,
        now_ms: i64,
    ) -> Result<ConsumeOutcome, String> {
        let stored = self.ledger.commit_terminal(envelope, &receipt)?.receipt;
        let outbound = self.receipt_for_submission(envelope, stored, now_ms)?;
        self.reporter.submit(&outbound)?;
        if outbound.error_code != INVALID_RESOURCE_REFERENCE_ERROR {
            self.cleanup_resources(envelope)?;
        }
        Ok(ConsumeOutcome {
            receipt: outbound,
            duplicate,
            side_effect_executed,
        })
    }

    fn receipt_for_submission(
        &self,
        envelope: &ClientCapabilityRequest,
        mut receipt: ClientCapabilityReceipt,
        now_ms: i64,
    ) -> Result<ClientCapabilityReceipt, String> {
        let execution_deadline = timestamp_ms(required_timestamp(
            envelope.execution_deadline.as_ref(),
            "execution_deadline",
        )?)?;
        if self.lease.revoked || self.lease.expires_at_ms <= now_ms || execution_deadline <= now_ms
        {
            let reconciliation_deadline = timestamp_ms(required_timestamp(
                envelope.reconciliation_deadline.as_ref(),
                "reconciliation_deadline",
            )?)?;
            if reconciliation_deadline <= now_ms {
                return Err("CLIENT_CAPABILITY_RECONCILIATION_DEADLINE_EXPIRED".to_string());
            }
            sign_terminal_recovery(
                self.signing_key_id,
                self.signing_key,
                envelope,
                &mut receipt,
            )?;
        }
        Ok(receipt)
    }

    fn validate_envelope(
        &self,
        envelope: &ClientCapabilityRequest,
        now_ms: i64,
    ) -> Result<CapabilityContract, String> {
        for (name, value) in [
            ("request_id", envelope.request_id.as_str()),
            ("turn_id", envelope.turn_id.as_str()),
            ("tool_call_id", envelope.tool_call_id.as_str()),
            (
                "capability_session_id",
                envelope.capability_session_id.as_str(),
            ),
            ("capability_id", envelope.capability_id.as_str()),
            ("schema_version", envelope.schema_version.as_str()),
            ("approval_id", envelope.approval_id.as_str()),
            ("attempt_id", envelope.attempt_id.as_str()),
            ("target_device_id", envelope.target_device_id.as_str()),
            ("decision_id", envelope.decision_id.as_str()),
            ("execution_claim_id", envelope.execution_claim_id.as_str()),
            ("executor_lease_id", envelope.executor_lease_id.as_str()),
            ("payload_hash", envelope.payload_hash.as_str()),
            ("tool_batch_id", envelope.tool_batch_id.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(format!("CLIENT_CAPABILITY_{name}_REQUIRED").to_ascii_uppercase());
            }
        }
        if envelope.capability_session_id != self.lease.capability_session_id
            || envelope.target_device_id != self.lease.device_id
            || envelope.executor_lease_id != self.lease.executor_lease_id
            || envelope.capability_lease_revision != self.lease.lease_revision
        {
            return Err("CLIENT_CAPABILITY_AUTHORITY_MISMATCH".to_string());
        }
        if envelope.decision_revision == 0
            || envelope.capability_lease_revision == 0
            || envelope.fencing_token == 0
            || envelope.sequence == 0
            || envelope.dispatch_sequence == 0
            || envelope.sequence != envelope.dispatch_sequence
        {
            return Err("CLIENT_CAPABILITY_FENCE_OR_SEQUENCE_INVALID".to_string());
        }
        let execution_deadline = timestamp_ms(required_timestamp(
            envelope.execution_deadline.as_ref(),
            "execution_deadline",
        )?)?;
        let reconciliation_deadline = timestamp_ms(required_timestamp(
            envelope.reconciliation_deadline.as_ref(),
            "reconciliation_deadline",
        )?)?;
        if reconciliation_deadline <= execution_deadline || reconciliation_deadline <= now_ms {
            return Err("CLIENT_CAPABILITY_DEADLINE_INVALID".to_string());
        }

        let contract = self
            .executor
            .contract(&envelope.capability_id)
            .ok_or_else(|| "CLIENT_CAPABILITY_NOT_REGISTERED".to_string())?;
        if contract.capability_id != envelope.capability_id
            || contract.schema_version != envelope.schema_version
            || envelope.bounded_arguments.len() > contract.max_argument_bytes
        {
            return Err("CLIENT_CAPABILITY_SCHEMA_MISMATCH".to_string());
        }
        validate_replay_policy(envelope, &contract)?;
        validate_payload_hash(envelope)?;
        validate_recovery_scope(envelope, &self.lease.actor_ptid, now_ms)?;
        Ok(contract)
    }

    fn resolve_resources(
        &self,
        envelope: &ClientCapabilityRequest,
        now_ms: i64,
    ) -> Result<Vec<LocalResource>, ResourceResolutionError> {
        if envelope.resource_refs.is_empty()
            && required_resource_kind(&envelope.capability_id).is_some()
        {
            return Err(ResourceResolutionError::Invalid(
                invalid_resource_reference(envelope, None),
            ));
        }

        let mut resolved = Vec::with_capacity(envelope.resource_refs.len());
        for reference in &envelope.resource_refs {
            match self.resources.resolve(
                reference,
                &envelope.capability_session_id,
                &envelope.capability_id,
                now_ms,
            ) {
                Ok(resource) => resolved.push(resource),
                Err(error) if is_invalid_resource_resolution(&error) => {
                    return Err(ResourceResolutionError::Invalid(
                        invalid_resource_reference(envelope, Some(reference)),
                    ));
                }
                Err(error) => return Err(ResourceResolutionError::Internal(error)),
            }
        }
        Ok(resolved)
    }

    fn cleanup_resources(&self, envelope: &ClientCapabilityRequest) -> Result<(), String> {
        let opaque_refs = envelope
            .resource_refs
            .iter()
            .map(|reference| reference.resource_ref.clone())
            .collect::<Vec<_>>();
        self.resources.delete(&opaque_refs)
    }
}

impl InvalidResourceReference {
    fn bounded_result(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&serde_json::json!({
            "resource_kind": self.resource_kind,
            "resource_ref_hash": self.resource_ref_hash,
        }))
        .map_err(|error| format!("encode invalid resource reference details: {error}"))
    }
}

fn required_resource_kind(capability_id: &str) -> Option<&'static str> {
    match capability_id {
        "filesystem.read" => Some("file"),
        "filesystem.list" => Some("folder"),
        "shell.execute" => Some("workspace"),
        _ => None,
    }
}

fn invalid_resource_reference(
    envelope: &ClientCapabilityRequest,
    reference: Option<&ClientResourceRef>,
) -> InvalidResourceReference {
    let opaque_ref = reference
        .map(|reference| reference.resource_ref.as_str())
        .filter(|resource_ref| !resource_ref.is_empty())
        .map(str::to_owned)
        .or_else(|| resource_ref_from_arguments(&envelope.bounded_arguments))
        .unwrap_or_default();
    InvalidResourceReference {
        resource_kind: required_resource_kind(&envelope.capability_id)
            .unwrap_or("resource")
            .to_string(),
        resource_ref_hash: hex::encode(Sha256::digest(opaque_ref.as_bytes())),
    }
}

fn resource_ref_from_arguments(arguments: &[u8]) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(arguments)
        .ok()?
        .as_object()?
        .get("resource_ref")?
        .as_str()
        .map(str::to_owned)
}

fn is_invalid_resource_resolution(error: &str) -> bool {
    matches!(
        error,
        "CLIENT_RESOURCE_REF_NOT_FOUND"
            | "CLIENT_RESOURCE_REF_EXPIRY_REQUIRED"
            | "CLIENT_RESOURCE_REF_SCOPE_MISMATCH"
            | "CLIENT_RESOURCE_REF_TIMESTAMP_INVALID"
    )
}

fn validate_replay_policy(
    envelope: &ClientCapabilityRequest,
    contract: &CapabilityContract,
) -> Result<(), String> {
    match ClientExecutionReplayPolicy::try_from(envelope.replay_policy)
        .unwrap_or(ClientExecutionReplayPolicy::Unspecified)
    {
        ClientExecutionReplayPolicy::NoReplayAfterPrepared => {
            if !envelope.external_idempotency_key.is_empty() {
                return Err("CLIENT_CAPABILITY_IDEMPOTENCY_KEY_FORBIDDEN".to_string());
            }
        }
        ClientExecutionReplayPolicy::WithExternalIdempotency => {
            if envelope.external_idempotency_key.trim().is_empty()
                || !contract.supports_external_idempotency
            {
                return Err("CLIENT_CAPABILITY_EXTERNAL_IDEMPOTENCY_INVALID".to_string());
            }
        }
        ClientExecutionReplayPolicy::Unspecified => {
            return Err("CLIENT_CAPABILITY_REPLAY_POLICY_UNSPECIFIED".to_string());
        }
    }
    Ok(())
}

fn validate_payload_hash(envelope: &ClientCapabilityRequest) -> Result<(), String> {
    let mut canonical = envelope.clone();
    canonical.payload_hash.clear();
    canonical.recovery_credential = None;
    let expected = hex::encode(Sha256::digest(canonical.encode_to_vec()));
    if envelope.payload_hash != expected {
        return Err("CLIENT_CAPABILITY_PAYLOAD_HASH_MISMATCH".to_string());
    }
    Ok(())
}

fn validate_recovery_scope(
    envelope: &ClientCapabilityRequest,
    actor_ptid: &str,
    now_ms: i64,
) -> Result<(), String> {
    let credential = envelope
        .recovery_credential
        .as_ref()
        .ok_or_else(|| "CLIENT_CAPABILITY_RECOVERY_CREDENTIAL_REQUIRED".to_string())?;
    if credential.credential_id.trim().is_empty()
        || credential.device_signing_key_id.trim().is_empty()
        || credential.nonce.len() != 32
        || credential.scope_hash.len() != 64
    {
        return Err("CLIENT_CAPABILITY_RECOVERY_CREDENTIAL_INVALID".to_string());
    }
    let credential_expiry = timestamp_ms(required_timestamp(
        credential.expires_at.as_ref(),
        "recovery_credential.expires_at",
    )?)?;
    let reconciliation_deadline = timestamp_ms(required_timestamp(
        envelope.reconciliation_deadline.as_ref(),
        "reconciliation_deadline",
    )?)?;
    if credential_expiry != reconciliation_deadline || credential_expiry <= now_ms {
        return Err("CLIENT_CAPABILITY_RECOVERY_CREDENTIAL_EXPIRED".to_string());
    }
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
    let expected = hex::encode(Sha256::digest(scope.encode_to_vec()));
    if credential.scope_hash != expected {
        return Err("CLIENT_CAPABILITY_RECOVERY_SCOPE_MISMATCH".to_string());
    }
    Ok(())
}

fn ensure_identical_envelope(
    existing: &ReceiptRecord,
    envelope: &ClientCapabilityRequest,
    station_url: &str,
) -> Result<(), String> {
    if existing.station_url != station_url.trim_end_matches('/')
        || existing.envelope.encode_to_vec() != envelope.encode_to_vec()
    {
        return Err("CLIENT_CAPABILITY_ENVELOPE_CONFLICT".to_string());
    }
    Ok(())
}

fn prepared_receipt(envelope: &ClientCapabilityRequest, now_ms: i64) -> ClientCapabilityReceipt {
    receipt_base(
        envelope,
        format!("receipt_{}", ulid::Ulid::new()),
        ClientCapabilityReceiptStatus::Prepared,
        now_ms,
    )
}

fn terminal_receipt(
    envelope: &ClientCapabilityRequest,
    side_effect_receipt_id: String,
    status: ClientCapabilityReceiptStatus,
    bounded_result: Vec<u8>,
    error_code: &str,
    now_ms: i64,
) -> ClientCapabilityReceipt {
    let mut receipt = receipt_base(envelope, side_effect_receipt_id, status, now_ms);
    receipt.bounded_result = bounded_result;
    receipt.error_code = error_code.to_string();
    receipt.result_id = format!("result_{}", ulid::Ulid::new());
    receipt
}

fn receipt_base(
    envelope: &ClientCapabilityRequest,
    side_effect_receipt_id: String,
    status: ClientCapabilityReceiptStatus,
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
        side_effect_receipt_id,
        status: status as i32,
        bounded_result: Vec::new(),
        error_code: String::new(),
        sequence: match status {
            ClientCapabilityReceiptStatus::Prepared => envelope.sequence,
            _ => envelope.sequence.saturating_add(1),
        },
        occurred_at: Some(timestamp_from_ms(now_ms)),
        result_id: String::new(),
        tool_batch_id: envelope.tool_batch_id.clone(),
        recovery_proof: None,
    }
}

fn required_timestamp<'a>(
    value: Option<&'a prost_types::Timestamp>,
    name: &str,
) -> Result<&'a prost_types::Timestamp, String> {
    value.ok_or_else(|| format!("CLIENT_CAPABILITY_{}_REQUIRED", name.to_ascii_uppercase()))
}

fn timestamp_ms(value: &prost_types::Timestamp) -> Result<i64, String> {
    if value.seconds < 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err("CLIENT_CAPABILITY_TIMESTAMP_INVALID".to_string());
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(value.nanos) / 1_000_000))
        .ok_or_else(|| "CLIENT_CAPABILITY_TIMESTAMP_INVALID".to_string())
}

fn timestamp_from_ms(value: i64) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: value.div_euclid(1_000),
        nanos: (value.rem_euclid(1_000) * 1_000_000) as i32,
    }
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::super::resource_registry::RegisterResource;
    use super::*;
    use crate::model::agent::ReceiptRecoveryCredential;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    const TEST_NOW_MS: i64 = 1_900_000_000_000;
    const ACTOR_PTID: &str = "ptid:test-actor";
    const DEVICE_ID: &str = "device-1";
    const SESSION_ID: &str = "session-1";
    const CAPABILITY_ID: &str = "filesystem.read";

    #[derive(Default)]
    struct RecordingExecutor {
        execution_count: AtomicUsize,
    }

    impl CapabilityExecutor for RecordingExecutor {
        fn contract(&self, capability_id: &str) -> Option<CapabilityContract> {
            (capability_id == CAPABILITY_ID).then(|| CapabilityContract {
                capability_id: CAPABILITY_ID.to_string(),
                schema_version: "1".to_string(),
                max_argument_bytes: 1024,
                max_result_bytes: 1024,
                supports_external_idempotency: false,
            })
        }

        fn execute(
            &self,
            _request: &ClientCapabilityRequest,
            _resources: &[LocalResource],
            _external_idempotency_key: Option<&str>,
            _record_side_effect_start: &mut dyn FnMut() -> Result<(), String>,
        ) -> Result<Vec<u8>, String> {
            self.execution_count.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        }
    }

    #[derive(Default)]
    struct RecordingReporter {
        receipts: Mutex<Vec<ClientCapabilityReceipt>>,
    }

    impl RecordingReporter {
        fn receipts(&self) -> Vec<ClientCapabilityReceipt> {
            self.receipts.lock().unwrap().clone()
        }
    }

    impl ReceiptReporter for RecordingReporter {
        fn submit(&self, receipt: &ClientCapabilityReceipt) -> Result<(), String> {
            self.receipts.lock().unwrap().push(receipt.clone());
            Ok(())
        }
    }

    struct TestStorage {
        root: PathBuf,
    }

    impl TestStorage {
        fn new() -> Self {
            Self {
                root: std::env::temp_dir()
                    .join(format!("peers-fenced-executor-{}", ulid::Ulid::new())),
            }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for TestStorage {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn lease() -> ExecutionLease {
        ExecutionLease {
            station_url: "https://station.test".to_string(),
            actor_ptid: ACTOR_PTID.to_string(),
            device_id: DEVICE_ID.to_string(),
            capability_session_id: SESSION_ID.to_string(),
            executor_lease_id: "lease-1".to_string(),
            lease_revision: 1,
            expires_at_ms: TEST_NOW_MS + 60_000,
            revoked: false,
        }
    }

    fn resource_reference(resource_ref: &str) -> ClientResourceRef {
        ClientResourceRef {
            resource_ref: resource_ref.to_string(),
            ptid: ACTOR_PTID.to_string(),
            device_id: DEVICE_ID.to_string(),
            capability_session_id: SESSION_ID.to_string(),
            capability_id: CAPABILITY_ID.to_string(),
            expires_at: Some(timestamp_from_ms(TEST_NOW_MS + 30_000)),
            permission_grant_id: "grant-1".to_string(),
            integrity_hash: "sha256:content".to_string(),
        }
    }

    fn envelope(
        tool_call_id: &str,
        resource_refs: Vec<ClientResourceRef>,
        bounded_arguments: &[u8],
    ) -> ClientCapabilityRequest {
        let execution_deadline = timestamp_from_ms(TEST_NOW_MS + 10_000);
        let reconciliation_deadline = timestamp_from_ms(TEST_NOW_MS + 20_000);
        let mut envelope = ClientCapabilityRequest {
            request_id: format!("request-{tool_call_id}"),
            turn_id: "turn-1".to_string(),
            tool_call_id: tool_call_id.to_string(),
            capability_session_id: SESSION_ID.to_string(),
            capability_id: CAPABILITY_ID.to_string(),
            schema_version: "1".to_string(),
            resource_refs,
            bounded_arguments: bounded_arguments.to_vec(),
            approval_id: "approval-1".to_string(),
            sequence: 1,
            attempt_id: "attempt-1".to_string(),
            target_device_id: DEVICE_ID.to_string(),
            decision_id: "decision-1".to_string(),
            decision_revision: 1,
            execution_claim_id: "claim-1".to_string(),
            executor_lease_id: "lease-1".to_string(),
            fencing_token: 1,
            dispatch_sequence: 1,
            payload_hash: String::new(),
            execution_deadline: Some(execution_deadline.clone()),
            tool_batch_id: "batch-1".to_string(),
            replay_policy: ClientExecutionReplayPolicy::NoReplayAfterPrepared as i32,
            external_idempotency_key: String::new(),
            recovery_credential: None,
            reconciliation_deadline: Some(reconciliation_deadline.clone()),
            capability_lease_revision: 1,
        };
        envelope.payload_hash = hex::encode(Sha256::digest(envelope.encode_to_vec()));

        let mut credential = ReceiptRecoveryCredential {
            credential_id: "credential-1".to_string(),
            device_signing_key_id: "signing-key-1".to_string(),
            nonce: vec![7; 32],
            scope_hash: String::new(),
            expires_at: Some(reconciliation_deadline.clone()),
        };
        let scope = ReceiptRecoveryScopePayload {
            actor_ptid: ACTOR_PTID.to_string(),
            device_id: DEVICE_ID.to_string(),
            request_id: envelope.request_id.clone(),
            tool_call_id: envelope.tool_call_id.clone(),
            execution_claim_id: envelope.execution_claim_id.clone(),
            capability_lease_revision: envelope.capability_lease_revision,
            fencing_token: envelope.fencing_token,
            payload_hash: envelope.payload_hash.clone(),
            replay_policy: envelope.replay_policy,
            execution_deadline: Some(execution_deadline),
            reconciliation_deadline: Some(reconciliation_deadline),
            credential_id: credential.credential_id.clone(),
            device_signing_key_id: credential.device_signing_key_id.clone(),
            nonce: credential.nonce.clone(),
        };
        credential.scope_hash = hex::encode(Sha256::digest(scope.encode_to_vec()));
        envelope.recovery_credential = Some(credential);
        envelope
    }

    fn open_stores(storage: &TestStorage) -> (ReceiptLedger, ResourceRegistry) {
        (
            ReceiptLedger::open_test(&storage.path("receipts.sqlite")).unwrap(),
            ResourceRegistry::open_test(&storage.path("resources.sqlite"), ACTOR_PTID, DEVICE_ID)
                .unwrap(),
        )
    }

    fn executor<'a>(
        lease: &'a ExecutionLease,
        ledger: &'a ReceiptLedger,
        resources: &'a ResourceRegistry,
        signing_key: &'a ed25519_dalek::SigningKey,
        capability_executor: &'a RecordingExecutor,
        reporter: &'a RecordingReporter,
    ) -> FencedExecutor<'a> {
        FencedExecutor::new(
            lease,
            ledger,
            resources,
            "signing-key-1",
            signing_key,
            capability_executor,
            reporter,
        )
    }

    fn assert_invalid_details(
        receipt: &ClientCapabilityReceipt,
        expected_ref: &str,
    ) -> serde_json::Value {
        assert_eq!(receipt.status, ClientCapabilityReceiptStatus::Failed as i32);
        assert_eq!(receipt.error_code, INVALID_RESOURCE_REFERENCE_ERROR);
        let details: serde_json::Value = serde_json::from_slice(&receipt.bounded_result).unwrap();
        let object = details.as_object().unwrap();
        assert_eq!(object.len(), 2);
        assert_eq!(object["resource_kind"], "file");
        assert_eq!(
            object["resource_ref_hash"],
            hex::encode(Sha256::digest(expected_ref.as_bytes()))
        );
        details
    }

    #[test]
    fn invalid_resource_is_prepared_then_failed_without_executor_call() {
        let storage = TestStorage::new();
        let (ledger, resources) = open_stores(&storage);
        let lease = lease();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&[3; 32]);
        let capability_executor = RecordingExecutor::default();
        let reporter = RecordingReporter::default();
        let fenced = executor(
            &lease,
            &ledger,
            &resources,
            &signing_key,
            &capability_executor,
            &reporter,
        );
        let request = envelope(
            "missing-resource",
            vec![resource_reference("opaque-missing")],
            br#"{"path":"safe.txt"}"#,
        );

        let outcome = fenced.consume_at(request.clone(), TEST_NOW_MS).unwrap();

        assert!(!outcome.duplicate);
        assert!(!outcome.side_effect_executed);
        assert_eq!(
            capability_executor.execution_count.load(Ordering::SeqCst),
            0
        );
        let details = assert_invalid_details(&outcome.receipt, "opaque-missing");
        assert!(!details.to_string().contains("opaque-missing"));
        let submitted = reporter.receipts();
        assert_eq!(submitted.len(), 2);
        assert_eq!(
            submitted[0].status,
            ClientCapabilityReceiptStatus::Prepared as i32
        );
        assert_eq!(submitted[1], outcome.receipt);
        let persisted = ledger
            .load(&request.tool_call_id, request.fencing_token)
            .unwrap()
            .unwrap();
        assert_eq!(persisted.receipt, outcome.receipt);
    }

    #[test]
    fn argument_only_resource_ref_fails_safely_without_raw_path_output() {
        let storage = TestStorage::new();
        let (ledger, resources) = open_stores(&storage);
        let lease = lease();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&[4; 32]);
        let capability_executor = RecordingExecutor::default();
        let reporter = RecordingReporter::default();
        let fenced = executor(
            &lease,
            &ledger,
            &resources,
            &signing_key,
            &capability_executor,
            &reporter,
        );
        let request = envelope(
            "argument-resource",
            Vec::new(),
            br#"{"resource_ref":"argument-only-ref","path":"/private/alice/secret.txt"}"#,
        );

        let outcome = fenced.consume_at(request, TEST_NOW_MS).unwrap();

        assert!(!outcome.side_effect_executed);
        assert_eq!(
            capability_executor.execution_count.load(Ordering::SeqCst),
            0
        );
        assert_invalid_details(&outcome.receipt, "argument-only-ref");
        let encoded = String::from_utf8(outcome.receipt.bounded_result).unwrap();
        assert!(!encoded.contains("argument-only-ref"));
        assert!(!encoded.contains("/private/alice"));
    }

    #[test]
    fn expired_resource_ref_produces_the_same_typed_terminal_failure() {
        let storage = TestStorage::new();
        let (ledger, resources) = open_stores(&storage);
        let lease = lease();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&[5; 32]);
        let capability_executor = RecordingExecutor::default();
        let reporter = RecordingReporter::default();
        let fenced = executor(
            &lease,
            &ledger,
            &resources,
            &signing_key,
            &capability_executor,
            &reporter,
        );
        let mut expired = resource_reference("expired-ref");
        expired.expires_at = Some(timestamp_from_ms(TEST_NOW_MS - 1));
        let request = envelope("expired-resource", vec![expired], br#"{}"#);

        let outcome = fenced.consume_at(request, TEST_NOW_MS).unwrap();

        assert!(!outcome.side_effect_executed);
        assert_eq!(
            capability_executor.execution_count.load(Ordering::SeqCst),
            0
        );
        assert_invalid_details(&outcome.receipt, "expired-ref");
    }

    #[test]
    fn scope_mismatch_replays_terminal_receipt_without_deleting_valid_entry() {
        let storage = TestStorage::new();
        let (ledger, resources) = open_stores(&storage);
        let valid_reference = resource_reference("scope-bound-ref");
        resources
            .register(RegisterResource {
                opaque_ref: &valid_reference.resource_ref,
                capability_session_id: &valid_reference.capability_session_id,
                capability_id: &valid_reference.capability_id,
                permission_grant_id: &valid_reference.permission_grant_id,
                integrity_hash: &valid_reference.integrity_hash,
                locator: "/private/alice/workspace",
                expires_at_ms: TEST_NOW_MS + 30_000,
            })
            .unwrap();
        let mut mismatched_reference = valid_reference.clone();
        mismatched_reference.permission_grant_id = "different-grant".to_string();
        let request = envelope(
            "scope-mismatch",
            vec![mismatched_reference],
            br#"{"path":"secret.txt"}"#,
        );
        let lease = lease();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&[6; 32]);
        let capability_executor = RecordingExecutor::default();
        let reporter = RecordingReporter::default();
        let fenced = executor(
            &lease,
            &ledger,
            &resources,
            &signing_key,
            &capability_executor,
            &reporter,
        );

        let first = fenced.consume_at(request.clone(), TEST_NOW_MS).unwrap();
        let replay = fenced.consume_at(request, TEST_NOW_MS + 1).unwrap();

        assert!(!first.duplicate);
        assert!(replay.duplicate);
        assert!(!first.side_effect_executed);
        assert!(!replay.side_effect_executed);
        assert_eq!(first.receipt, replay.receipt);
        assert_eq!(ledger.list().unwrap().len(), 1);
        assert_eq!(
            capability_executor.execution_count.load(Ordering::SeqCst),
            0
        );
        let submitted = reporter.receipts();
        assert_eq!(submitted.len(), 3);
        assert_eq!(submitted[1], submitted[2]);
        assert_eq!(
            resources
                .resolve(&valid_reference, SESSION_ID, CAPABILITY_ID, TEST_NOW_MS + 1,)
                .unwrap()
                .locator,
            "/private/alice/workspace"
        );
    }
}
