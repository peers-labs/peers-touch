use secure_content_core::operation::{
    classify_content_prekey_publish, plan_content_prekey_maintenance,
    prepare_content_prekey_publication, ContentPreKeyInventory, ContentPreKeyMaintenancePlan,
    ContentPreKeyPoolKind, ContentPreKeyPublishDisposition, ContentPreKeyPublisher,
    OperationCompletion, OperationOutcome,
};
use secure_content_core::ports::OperationClock;

use crate::model::secure_content as wire;

use super::adapter::{NativeErrorDisposition, NativeTransportError, SecureContentTransport};
use super::{SecureContentLease, SecureContentSupervisor};

const DEFAULT_PREKEY_RETRY_DELAY_MS: u64 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MaintenanceSummary {
    pub endpoint_available: u32,
    pub recovery_available: Option<u32>,
}

pub fn maintain_content_prekeys(
    supervisor: &SecureContentSupervisor,
    lease: &SecureContentLease,
) -> Result<MaintenanceSummary, String> {
    let transport = SecureContentTransport::new(lease.session.clone())?;
    for command in lease.store.publications_requiring_reconciliation()? {
        publish_command(supervisor, lease, &transport, &command.command_id)?;
    }
    let endpoint_available = maintain_pool(
        supervisor,
        lease,
        &transport,
        ContentPreKeyPoolKind::Endpoint,
    )?;
    let recovery_available = lease
        .store
        .latest_recovery_epoch(&lease.session.key.actor_ptid)?
        .map(|_| {
            maintain_pool(
                supervisor,
                lease,
                &transport,
                ContentPreKeyPoolKind::ActorRecovery,
            )
        })
        .transpose()?;
    Ok(MaintenanceSummary {
        endpoint_available,
        recovery_available,
    })
}

fn maintain_pool(
    supervisor: &SecureContentSupervisor,
    lease: &SecureContentLease,
    transport: &SecureContentTransport,
    kind: ContentPreKeyPoolKind,
) -> Result<u32, String> {
    let inventory = match transport.inventory(wire_kind(kind)) {
        Ok(inventory) => Some(ContentPreKeyInventory {
            current_epoch: inventory.current_epoch,
            available: inventory.available,
            capacity: inventory.capacity,
            needs_replenishment: inventory.needs_replenishment,
        }),
        Err(error) if error.disposition == NativeErrorDisposition::PoolNotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let plan = plan_content_prekey_maintenance(
        kind,
        inventory,
        lease.session.profile_version,
        match kind {
            ContentPreKeyPoolKind::Endpoint => None,
            ContentPreKeyPoolKind::ActorRecovery => lease
                .store
                .latest_recovery_epoch(&lease.session.key.actor_ptid)?,
        },
    )
    .map_err(|error| error.to_string())?;
    let ContentPreKeyMaintenancePlan::Publish(plan) = plan else {
        return match plan {
            ContentPreKeyMaintenancePlan::Ready { available } => Ok(available),
            ContentPreKeyMaintenancePlan::Publish(_) => unreachable!(),
        };
    };
    let prepared = prepare_content_prekey_publication(
        plan,
        &ContentPreKeyPublisher {
            actor_ptid: lease.session.key.actor_ptid.clone(),
            device_id: lease.session.key.device_id.clone(),
            signing_key_id: lease.session.signing_key_id.clone(),
            profile_version: lease.session.profile_version,
        },
        lease,
        &SystemClock,
    )
    .map_err(|error| error.to_string())?;
    let command_id = prepared.operation.command_id.clone();
    lease.store.persist_prepared_prekey_publication(&prepared)?;
    publish_command(supervisor, lease, transport, &command_id)?;
    transport
        .inventory(wire_kind(kind))
        .map(|fresh| fresh.available)
        .map_err(|error| error.to_string())
}

fn publish_command(
    supervisor: &SecureContentSupervisor,
    lease: &SecureContentLease,
    transport: &SecureContentTransport,
    command_id: &str,
) -> Result<(), String> {
    let acquired = lease
        .store
        .acquire_publication(command_id, lease.session.key.session_generation)?;

    #[cfg(feature = "acceptance-webdriver")]
    if let Some(controller) = supervisor.barrier_controller() {
        use super::barrier::BarrierName;
        let token = controller.arm(
            BarrierName::PersistedBeforeSend,
            command_id,
            lease.session.key.session_generation,
            &acquired.command.request_bytes,
        )?;
        controller.wait(&token)?;
    }

    let transport_result = transport.publish_proof_free(&acquired.command.request_bytes);

    #[cfg(feature = "acceptance-webdriver")]
    if let Some(controller) = supervisor.barrier_controller() {
        use super::barrier::BarrierName;
        let observation = match &transport_result {
            Ok(_) => b"ok" as &[u8],
            Err(error) => error.message.as_bytes(),
        };
        let token = controller.arm(
            BarrierName::SentBeforeResponse,
            command_id,
            lease.session.key.session_generation,
            observation,
        )?;
        controller.wait(&token)?;
    }

    if !supervisor.is_current(&lease.session.key) {
        lease
            .store
            .complete_publication(&acquired, OperationCompletion::UnknownOutcome)?;
        return Err("secure content publication response crossed a session fence".to_string());
    }
    let (disposition, transport_error) = match transport_result {
        Ok(_) => (ContentPreKeyPublishDisposition::Committed, None),
        Err(error) => (publish_disposition(&error), Some(error)),
    };
    let classification = classify_content_prekey_publish(
        disposition,
        acquired.lease.reconciles_unknown_outcome,
        &SystemClock,
        DEFAULT_PREKEY_RETRY_DELAY_MS,
    )
    .map_err(|error| error.to_string())?;

    #[cfg(feature = "acceptance-webdriver")]
    if matches!(classification.outcome, OperationOutcome::Committed { .. }) {
        if let Some(controller) = supervisor.barrier_controller() {
            use super::barrier::BarrierName;
            let token = controller.arm(
                BarrierName::ResponseBeforeLocalCommit,
                command_id,
                lease.session.key.session_generation,
                command_id.as_bytes(),
            )?;
            controller.wait(&token)?;
        }
    }

    if !lease
        .store
        .complete_publication(&acquired, classification.completion)?
    {
        return Err("secure content publication lost its operation fence".to_string());
    }
    match classification.outcome {
        OperationOutcome::Committed { .. } => Ok(()),
        _ => Err(transport_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "secure content publication did not commit".to_string())),
    }
}

fn publish_disposition(error: &NativeTransportError) -> ContentPreKeyPublishDisposition {
    let code = error.stable_code.to_string();
    match error.disposition {
        NativeErrorDisposition::Retryable => ContentPreKeyPublishDisposition::Retryable {
            retry_after_ms: error
                .retry_after_seconds
                .map(|seconds| seconds.saturating_mul(1_000)),
            detail: error.message.clone(),
        },
        NativeErrorDisposition::UnknownCommit => ContentPreKeyPublishDisposition::UnknownOutcome {
            detail: error.message.clone(),
        },
        NativeErrorDisposition::Terminal if matches!(error.http_status, Some(401 | 403)) => {
            ContentPreKeyPublishDisposition::AuthorizationRejected {
                code,
                detail: error.message.clone(),
            }
        }
        NativeErrorDisposition::Terminal | NativeErrorDisposition::PoolNotFound => {
            ContentPreKeyPublishDisposition::Rejected {
                code,
                detail: error.message.clone(),
            }
        }
    }
}

fn wire_kind(kind: ContentPreKeyPoolKind) -> wire::ContentPreKeyKind {
    match kind {
        ContentPreKeyPoolKind::Endpoint => wire::ContentPreKeyKind::ContentPrekeyKindEndpoint,
        ContentPreKeyPoolKind::ActorRecovery => {
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery
        }
    }
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
