use super::receipt_ledger::{ReceiptLedger, ReceiptRecord};
use super::recovery_signer::sign_terminal_recovery;
use super::resource_registry::{LocalResource, ResourceRegistry};
use crate::model::agent::{
    ClientCapabilityReceipt, ClientCapabilityReceiptStatus, ClientCapabilityRequest,
    ClientExecutionReplayPolicy, ReceiptRecoveryScopePayload,
};
use prost::Message;
use sha2::{Digest, Sha256};

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
        let resolved_resources = self.resolve_resources(&envelope, now_ms)?;

        let prepared = prepared_receipt(&envelope, now_ms);
        self.ledger
            .prepare(&self.lease.station_url, &envelope, &prepared)?;
        self.reporter.submit(&prepared).map_err(|error| {
            format!("submit PREPARED receipt before local side effect: {error}")
        })?;

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
            self.cleanup_resources(envelope)?;
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
        let executed = self.executor.execute(envelope, resources, idempotency_key);
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
        self.cleanup_resources(envelope)?;
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
            sign_terminal_recovery(self.signing_key_id, self.signing_key, envelope, &mut receipt)?;
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
    ) -> Result<Vec<LocalResource>, String> {
        envelope
            .resource_refs
            .iter()
            .map(|reference| {
                self.resources.resolve(
                    reference,
                    &envelope.capability_session_id,
                    &envelope.capability_id,
                    now_ms,
                )
            })
            .collect()
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
