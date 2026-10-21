use std::sync::Arc;

use prost::Message;
use secure_content_core::operation::{
    classify_content_prekey_publish, decide_committed_readback, decide_unknown_outcome,
    plan_content_prekey_maintenance, prepare_content_prekey_publication, ContentPreKeyInventory,
    ContentPreKeyMaintenancePlan, ContentPreKeyPoolKind, ContentPreKeyPublicationPlan,
    ContentPreKeyPublishDisposition, ContentPreKeyPublisher, DispatchCause, OperationCompletion,
    OperationErrorCode, OperationFailure, OperationOutcome, OperationState, ReadbackDecision,
    ReadbackObservation,
};
use secure_content_core::ports::{ContentKeyMaterial, OperationClock};
use secure_content_core::recovery::RecoveryMaster;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::secure_content::adapter::{
    projection_for_state, verify_submit_readback, PrivateMomentProjection, PrivatePublishState,
};
use crate::secure_content::proto::{secure_content::v1 as wire, social::v1 as social};
use crate::secure_content::store::{AcquiredSubmission, PrivateSocialStore, StoredSubmission};
use crate::secure_content::transport::{
    NativeSocialTransport, TransportDisposition, TransportError,
};
use crate::secure_content::NativeSocialSession;

const DEFAULT_RETRY_DELAY_MS: u64 = 1_000;
const MAX_RETRY_DELAY_MS: u64 = 300_000;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialReconciliationReport {
    pub endpoint_prekeys_available: u32,
    pub recovery_prekeys_available: Option<u32>,
    pub submissions_processed: usize,
    pub submissions_unknown: usize,
    pub submissions_terminal: usize,
}

pub struct PrivateSocialRuntime {
    session: Arc<NativeSocialSession>,
    store: Arc<PrivateSocialStore>,
    transport: NativeSocialTransport,
}

impl PrivateSocialRuntime {
    pub fn new(
        session: Arc<NativeSocialSession>,
        store: Arc<PrivateSocialStore>,
    ) -> Result<Self, String> {
        Ok(Self {
            transport: NativeSocialTransport::new(session.clone())?,
            session,
            store,
        })
    }

    pub fn reconcile(&self) -> Result<PrivateSocialReconciliationReport, String> {
        self.reconcile_prekey_publications()?;
        let endpoint_prekeys_available =
            self.maintain_prekey_pool(ContentPreKeyPoolKind::Endpoint)?;
        let recovery_prekeys_available = self
            .store
            .latest_recovery_epoch(&self.session.scope.actor_ptid)?
            .map(|_| self.maintain_prekey_pool(ContentPreKeyPoolKind::ActorRecovery))
            .transpose()?;
        let mut report = PrivateSocialReconciliationReport {
            endpoint_prekeys_available,
            recovery_prekeys_available,
            submissions_processed: 0,
            submissions_unknown: 0,
            submissions_terminal: 0,
        };
        for command in self.store.pending_submissions()? {
            let projection = self.dispatch_submission(&command.command_id)?;
            report.submissions_processed += 1;
            match projection.state {
                PrivatePublishState::UnknownOutcome => report.submissions_unknown += 1,
                PrivatePublishState::PublishFailed => report.submissions_terminal += 1,
                _ => {}
            }
        }
        Ok(report)
    }

    pub fn dispatch_submission(&self, command_id: &str) -> Result<PrivateMomentProjection, String> {
        let stored = self
            .store
            .submission_by_command_id(command_id)?
            .ok_or_else(|| "private Social submission is unavailable".to_string())?;
        let request = social::SubmitPrivateMomentRequest::decode(stored.request_bytes.as_slice())
            .map_err(|_| "private Social submission request is malformed".to_string())?;

        if matches!(
            stored.state,
            OperationState::UnknownOutcome | OperationState::CommittedPendingReadback
        ) {
            if let Some(projection) = self.reconcile_submission_readback(&stored, &request)? {
                return Ok(projection);
            }
        }

        let cause = match stored.state {
            OperationState::Prepared => DispatchCause::ExplicitUserAction,
            OperationState::Pending => DispatchCause::InitialReconciliation,
            OperationState::UnknownOutcome => DispatchCause::ReadbackAuthorizedRetry,
            OperationState::RetryWait => DispatchCause::RetryDeadlineReached,
            _ => return Err("private Social submission is not dispatchable".to_string()),
        };
        let acquired = self.store.acquire_submission(command_id, cause)?;
        match self.transport.submit_private_moment(&request) {
            Ok(_) => {
                let pending_readback = projection_for_state(
                    &acquired.command,
                    PrivatePublishState::UnknownOutcome,
                    None,
                    None,
                )?;
                if !self.store.complete_submission(
                    &acquired,
                    OperationCompletion::CommittedPendingReadback,
                    None,
                    None,
                    &pending_readback.encode()?,
                )? {
                    return Err("private Social submission lost its operation fence".to_string());
                }
                let committed = self
                    .store
                    .submission_by_command_id(command_id)?
                    .ok_or_else(|| "private Social submission disappeared".to_string())?;
                self.reconcile_submission_readback(&committed, &request)?
                    .ok_or_else(|| {
                        "committed private Social submission cannot retry submit".to_string()
                    })
            }
            Err(error) => self.finish_transport_failure(&acquired, error),
        }
    }

    fn reconcile_submission_readback(
        &self,
        command: &StoredSubmission,
        request: &social::SubmitPrivateMomentRequest,
    ) -> Result<Option<PrivateMomentProjection>, String> {
        let readback = self.transport.get_private_moment(&command.content_id);
        let (observation, post_id) = match readback {
            Ok(readback) => {
                let submitted = social::SubmitPrivateMomentResponse {
                    post: readback.resource.clone(),
                    exact_replay: true,
                };
                match verify_submit_readback(
                    self.session.as_ref(),
                    command,
                    request,
                    &submitted,
                    &readback,
                ) {
                    Ok(post_id) => (
                        ReadbackObservation::Committed {
                            receipt_sha256: Sha256::digest(readback.encode_to_vec()).into(),
                        },
                        Some(post_id),
                    ),
                    Err(detail) => (ReadbackObservation::Invalid { detail }, None),
                }
            }
            Err(error) if error.http_status == Some(404) => {
                (ReadbackObservation::AuthoritativeAbsent, None)
            }
            Err(error) => (
                ReadbackObservation::Unavailable {
                    retry_after_unix_ms: retry_deadline(&error, &SystemClock),
                },
                None,
            ),
        };
        let operation = command.operation_record_for_runtime()?;
        let decision = match command.state {
            OperationState::UnknownOutcome => decide_unknown_outcome(&operation, observation),
            OperationState::CommittedPendingReadback => {
                decide_committed_readback(&operation, observation)
            }
            _ => return Err("private Social readback requires an unresolved operation".to_string()),
        }
        .map_err(|error| error.to_string())?;
        if decision == ReadbackDecision::RetryExactCommand {
            let projection = projection_for_state(
                command,
                PrivatePublishState::UnknownOutcome,
                None,
                command.last_error_code,
            )?;
            if !self.store.apply_submission_readback(
                command,
                &decision,
                None,
                command.last_error_code,
                &projection.encode()?,
            )? {
                return Err("private Social readback lost its operation fence".to_string());
            }
            return Ok(None);
        }
        let (projection_state, error_code) = match decision {
            ReadbackDecision::CommitFromReadback { .. } => (PrivatePublishState::Published, None),
            ReadbackDecision::TerminalIntegrityFailure { .. } => {
                (PrivatePublishState::PublishFailed, Some(20005))
            }
            ReadbackDecision::KeepUnknown { .. }
            | ReadbackDecision::KeepCommittedPendingReadback { .. } => {
                (PrivatePublishState::UnknownOutcome, command.last_error_code)
            }
            ReadbackDecision::RetryExactCommand => unreachable!(),
        };
        let projection =
            projection_for_state(command, projection_state, post_id.clone(), error_code)?;
        if !self.store.apply_submission_readback(
            command,
            &decision,
            post_id.as_deref(),
            error_code,
            &projection.encode()?,
        )? {
            return Err("private Social readback lost its operation fence".to_string());
        }
        Ok(Some(projection))
    }

    fn finish_transport_failure(
        &self,
        acquired: &AcquiredSubmission,
        error: TransportError,
    ) -> Result<PrivateMomentProjection, String> {
        let completion = match error.disposition {
            TransportDisposition::Retryable => OperationCompletion::RetryAt(
                retry_deadline(&error, &SystemClock)
                    .ok_or_else(|| "private Social retry deadline overflowed".to_string())?,
            ),
            TransportDisposition::UnknownOutcome => OperationCompletion::UnknownOutcome,
            TransportDisposition::Terminal
                if acquired.lease.reconciles_unknown_outcome
                    && matches!(error.http_status, Some(401 | 403)) =>
            {
                OperationCompletion::UnknownOutcome
            }
            TransportDisposition::Terminal | TransportDisposition::PoolNotFound => {
                OperationCompletion::Terminal
            }
        };
        let projection_state = if completion == OperationCompletion::Terminal {
            PrivatePublishState::PublishFailed
        } else {
            PrivatePublishState::UnknownOutcome
        };
        let projection = projection_for_state(
            &acquired.command,
            projection_state,
            None,
            Some(error.stable_code),
        )?;
        if !self.store.complete_submission(
            acquired,
            completion,
            None,
            Some(error.stable_code),
            &projection.encode()?,
        )? {
            return Err("private Social submission lost its operation fence".to_string());
        }
        Ok(projection)
    }

    fn reconcile_prekey_publications(&self) -> Result<(), String> {
        for pending in self.store.pending_prekey_publications()? {
            self.dispatch_prekey_publication(&pending.command_id)?;
        }
        Ok(())
    }

    fn maintain_prekey_pool(&self, kind: ContentPreKeyPoolKind) -> Result<u32, String> {
        let wire_kind = wire_prekey_kind(kind);
        let inventory = match self.transport.inventory(wire_kind) {
            Ok(inventory) => Some(ContentPreKeyInventory {
                current_epoch: inventory.current_epoch,
                available: inventory.available,
                capacity: inventory.capacity,
                needs_replenishment: inventory.needs_replenishment,
            }),
            Err(error) if error.disposition == TransportDisposition::PoolNotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        let plan = plan_content_prekey_maintenance(
            kind,
            inventory,
            self.session.profile_version,
            match kind {
                ContentPreKeyPoolKind::Endpoint => None,
                ContentPreKeyPoolKind::ActorRecovery => self
                    .store
                    .latest_recovery_epoch(&self.session.scope.actor_ptid)?,
            },
        )
        .map_err(|error| error.to_string())?;
        let ContentPreKeyMaintenancePlan::Publish(plan) = plan else {
            return match plan {
                ContentPreKeyMaintenancePlan::Ready { available } => Ok(available),
                ContentPreKeyMaintenancePlan::Publish(_) => unreachable!(),
            };
        };
        let command_id = self.create_prekey_publication(plan)?;
        self.dispatch_prekey_publication(&command_id)?;
        self.transport
            .inventory(wire_kind)
            .map(|fresh| fresh.available)
            .map_err(|error| error.to_string())
    }

    fn create_prekey_publication(
        &self,
        plan: ContentPreKeyPublicationPlan,
    ) -> Result<String, String> {
        let prepared = prepare_content_prekey_publication(
            plan,
            &ContentPreKeyPublisher {
                actor_ptid: self.session.scope.actor_ptid.clone(),
                device_id: self.session.scope.device_id.clone(),
                signing_key_id: self.session.signing_key_id.clone(),
                profile_version: self.session.profile_version,
            },
            self,
            &SystemClock,
        )
        .map_err(|error| error.to_string())?;
        let command_id = prepared.operation.command_id.clone();
        self.store.persist_prepared_prekey_publication(&prepared)?;
        Ok(command_id)
    }

    fn dispatch_prekey_publication(&self, command_id: &str) -> Result<(), String> {
        let pending = self
            .store
            .pending_prekey_publications()?
            .into_iter()
            .find(|command| command.command_id == command_id)
            .ok_or_else(|| "private Social PreKey publication is unavailable".to_string())?;
        let cause = match pending.state {
            OperationState::Pending => DispatchCause::InitialReconciliation,
            OperationState::UnknownOutcome => DispatchCause::ReadbackAuthorizedRetry,
            OperationState::RetryWait => DispatchCause::RetryDeadlineReached,
            _ => return Err("private Social PreKey publication is not dispatchable".to_string()),
        };
        let acquired = self.store.acquire_prekey_publication(command_id, cause)?;
        let result = self
            .transport
            .publish_prekeys(&acquired.command.request_bytes);
        let (disposition, transport_error) = match result {
            Ok(_) => (ContentPreKeyPublishDisposition::Committed, None),
            Err(error) => (prekey_publish_disposition(&error), Some(error)),
        };
        let classified = classify_content_prekey_publish(
            disposition,
            acquired.lease.reconciles_unknown_outcome,
            &SystemClock,
            DEFAULT_RETRY_DELAY_MS,
        )
        .map_err(|error| error.to_string())?;
        if !self
            .store
            .complete_prekey_publication(&acquired, classified.completion)?
        {
            return Err("private Social PreKey publication lost its operation fence".to_string());
        }
        match classified.outcome {
            OperationOutcome::Committed { .. } => Ok(()),
            _ => Err(transport_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "private Social PreKey publication did not commit".to_string())),
        }
    }
}

impl ContentKeyMaterial for PrivateSocialRuntime {
    fn recovery_master(
        &self,
        actor_ptid: &str,
        recovery_epoch: u64,
    ) -> Result<Option<RecoveryMaster>, OperationFailure> {
        self.store
            .recovery_master(actor_ptid, recovery_epoch)
            .map(|master| master.map(RecoveryMaster::from_bytes))
            .map_err(|detail| {
                OperationFailure::terminal(OperationErrorCode::StoreUnavailable, detail)
            })
    }

    fn sign_device_payload(&self, payload: &[u8]) -> Result<Vec<u8>, OperationFailure> {
        Ok(self.session.sign(payload))
    }
}

fn wire_prekey_kind(kind: ContentPreKeyPoolKind) -> wire::ContentPreKeyKind {
    match kind {
        ContentPreKeyPoolKind::Endpoint => wire::ContentPreKeyKind::ContentPrekeyKindEndpoint,
        ContentPreKeyPoolKind::ActorRecovery => {
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery
        }
    }
}

fn prekey_publish_disposition(error: &TransportError) -> ContentPreKeyPublishDisposition {
    let code = error.stable_code.to_string();
    match error.disposition {
        TransportDisposition::Retryable => ContentPreKeyPublishDisposition::Retryable {
            retry_after_ms: error
                .retry_after_seconds
                .map(|seconds| seconds.saturating_mul(1_000)),
            detail: error.to_string(),
        },
        TransportDisposition::UnknownOutcome => ContentPreKeyPublishDisposition::UnknownOutcome {
            detail: error.to_string(),
        },
        TransportDisposition::Terminal if matches!(error.http_status, Some(401 | 403)) => {
            ContentPreKeyPublishDisposition::AuthorizationRejected {
                code,
                detail: error.to_string(),
            }
        }
        TransportDisposition::Terminal | TransportDisposition::PoolNotFound => {
            ContentPreKeyPublishDisposition::Rejected {
                code,
                detail: error.to_string(),
            }
        }
    }
}

fn retry_deadline(error: &TransportError, clock: &dyn OperationClock) -> Option<i64> {
    let delay_ms = error
        .retry_after_seconds
        .map(|seconds| seconds.saturating_mul(1_000))
        .unwrap_or(DEFAULT_RETRY_DELAY_MS)
        .clamp(1, MAX_RETRY_DELAY_MS);
    let delay_ms = i64::try_from(delay_ms).ok()?;
    clock.now_unix_ms().checked_add(delay_ms)
}

struct SystemClock;

impl OperationClock for SystemClock {
    fn now_unix_ms(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
            .unwrap_or_default()
    }
}
