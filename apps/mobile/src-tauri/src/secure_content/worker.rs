use std::sync::Arc;

use prost::Message;
use secure_content_core::prekey::{
    ContentPreKeyEndpoint, ContentPreKeyKind as CorePreKeyKind, ContentPreKeyPair,
    ContentPreKeyPrincipal, ContentPreKeySigningInput, CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use ulid::Ulid;
use zeroize::Zeroizing;

use crate::secure_content::adapter::{
    projection_for_state, verify_submit_readback, PrivateMomentProjection, PrivatePublishState,
};
use crate::secure_content::proto::{
    actor::v1 as actor, secure_content::v1 as wire, social::v1 as social,
};
use crate::secure_content::store::{
    DurableState, PrivateSocialStore, StoredPreKeyPublication, StoredSubmission,
};
use crate::secure_content::transport::{
    publication_command_id, NativeSocialTransport, TransportDisposition, TransportError,
};
use crate::secure_content::NativeSocialSession;

const CONTENT_PREKEY_BATCH_LIMIT: u32 = 100;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialWorkerReport {
    pub endpoint_prekeys_available: u32,
    pub submissions_processed: usize,
    pub submissions_unknown: usize,
    pub submissions_terminal: usize,
}

pub struct PrivateSocialWorker {
    session: Arc<NativeSocialSession>,
    store: Arc<PrivateSocialStore>,
    transport: NativeSocialTransport,
}

impl PrivateSocialWorker {
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

    pub fn reconcile(&self) -> Result<PrivateSocialWorkerReport, String> {
        let endpoint_prekeys_available = self.maintain_endpoint_prekeys()?;
        let mut report = PrivateSocialWorkerReport {
            endpoint_prekeys_available,
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
        let acquired = self.store.acquire_submission(command_id)?;
        let command = acquired.command;
        let request =
            match social::SubmitPrivateMomentRequest::decode(command.request_bytes.as_slice()) {
                Ok(request) => request,
                Err(_) => {
                    return self.finish_submission(
                        &command,
                        DurableState::Terminal,
                        PrivatePublishState::PublishFailed,
                        None,
                        Some(20005),
                    )
                }
            };
        match self.transport.submit_private_moment(&request) {
            Ok(submitted) => {
                let readback = self.transport.get_private_moment(&command.content_id);
                match readback.and_then(|readback| {
                    verify_submit_readback(
                        self.session.as_ref(),
                        &command,
                        &request,
                        &submitted,
                        &readback,
                    )
                    .map_err(|_| TransportError {
                        http_status: None,
                        stable_code: 20005,
                        typed_error: false,
                        retry_after_seconds: None,
                        disposition: TransportDisposition::UnknownOutcome,
                    })
                }) {
                    Ok(post_id) => self.finish_submission(
                        &command,
                        DurableState::Committed,
                        PrivatePublishState::Published,
                        Some(post_id),
                        None,
                    ),
                    Err(error) => self.finish_submission(
                        &command,
                        DurableState::UnknownOutcome,
                        PrivatePublishState::UnknownOutcome,
                        None,
                        Some(error.stable_code),
                    ),
                }
            }
            Err(error)
                if matches!(
                    error.disposition,
                    TransportDisposition::Retryable | TransportDisposition::UnknownOutcome
                ) || preserves_unknown_after_auth_rejection(
                    acquired.reconciles_unknown_outcome,
                    &error,
                ) =>
            {
                self.finish_submission(
                    &command,
                    DurableState::UnknownOutcome,
                    PrivatePublishState::UnknownOutcome,
                    None,
                    Some(error.stable_code),
                )
            }
            Err(error) => self.finish_submission(
                &command,
                DurableState::Terminal,
                PrivatePublishState::PublishFailed,
                None,
                Some(error.stable_code),
            ),
        }
    }

    fn finish_submission(
        &self,
        command: &StoredSubmission,
        durable_state: DurableState,
        projection_state: PrivatePublishState,
        post_id: Option<String>,
        error_code: Option<i32>,
    ) -> Result<PrivateMomentProjection, String> {
        let projection =
            projection_for_state(command, projection_state, post_id.clone(), error_code)?;
        if !self.store.finish_submission(
            command,
            durable_state,
            post_id.as_deref(),
            error_code,
            &projection.encode()?,
        )? {
            return Err("private Social submission lost its generation fence".to_string());
        }
        Ok(projection)
    }

    fn maintain_endpoint_prekeys(&self) -> Result<u32, String> {
        for pending in self.store.pending_prekey_publications()? {
            self.dispatch_prekey_publication(&pending.command_id)?;
        }
        let kind = wire::ContentPreKeyKind::ContentPrekeyKindEndpoint;
        let inventory = match self.transport.inventory(kind) {
            Ok(inventory) => Some(inventory),
            Err(error) if error.disposition == TransportDisposition::PoolNotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        if let Some(inventory) = inventory.as_ref() {
            if !inventory.needs_replenishment {
                return Ok(inventory.available);
            }
        }
        let available = inventory.as_ref().map_or(0, |value| value.available);
        let capacity = inventory
            .as_ref()
            .map(|value| value.capacity)
            .filter(|capacity| *capacity > 0)
            .unwrap_or(CONTENT_PREKEY_BATCH_LIMIT);
        let expected_pool_epoch = inventory.as_ref().map_or(0, |value| value.current_epoch);
        let count = capacity
            .saturating_sub(available)
            .clamp(1, CONTENT_PREKEY_BATCH_LIMIT);
        let command_id = self.create_endpoint_prekey_publication(expected_pool_epoch, count)?;
        self.dispatch_prekey_publication(&command_id)?;
        self.transport
            .inventory(kind)
            .map(|fresh| fresh.available)
            .map_err(|error| error.to_string())
    }

    fn create_endpoint_prekey_publication(
        &self,
        expected_pool_epoch: u64,
        count: u32,
    ) -> Result<String, String> {
        let publisher = self.publisher();
        let pool_epoch = self.session.profile_version;
        let mut generated = (0..count)
            .map(|_| {
                (
                    format!("mobile-content-endpoint-{}", Ulid::new()),
                    ContentPreKeyPair::generate(),
                )
            })
            .collect::<Vec<_>>();
        generated.sort_by(|left, right| left.0.cmp(&right.0));
        let mut prekeys = Vec::with_capacity(generated.len());
        let mut private_material = Zeroizing::new(Vec::with_capacity(generated.len()));
        for (key_id, pair) in generated {
            let signing_input = ContentPreKeySigningInput {
                format_version: CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
                kind: CorePreKeyKind::Endpoint,
                key_id: key_id.clone(),
                x25519_public_key: pair.public(),
                principal: ContentPreKeyPrincipal::Endpoint(ContentPreKeyEndpoint::new(
                    &self.session.scope.actor_ptid,
                    &self.session.scope.device_id,
                )),
                pool_epoch,
                expected_pool_epoch,
                publisher: ContentPreKeyEndpoint::new(
                    &self.session.scope.actor_ptid,
                    &self.session.scope.device_id,
                ),
                publisher_signing_key_id: self.session.signing_key_id.clone(),
                publisher_profile_version: self.session.profile_version,
            };
            let signature = self.session.sign(
                &signing_input
                    .signing_bytes()
                    .map_err(|error| error.to_string())?,
            );
            prekeys.push(wire::ContentOneTimePreKey {
                kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
                key_id: key_id.clone(),
                x25519_public_key: pair.public().as_bytes().to_vec(),
                principal: Some(wire::content_one_time_pre_key::Principal::Endpoint(
                    publisher.clone(),
                )),
                profile_or_recovery_epoch: pool_epoch,
                issuer_signature: signature,
            });
            private_material.push((
                key_id,
                pair.private().to_bytes(),
                pair.public().as_bytes().to_owned(),
            ));
        }
        let mut request = wire::PublishContentPreKeysRequest {
            publisher: Some(publisher),
            publisher_signing_key_id: self.session.signing_key_id.clone(),
            publisher_profile_version: self.session.profile_version,
            expected_pool_epoch,
            prekeys,
            command_id: String::new(),
            proof: None,
        };
        request.command_id = publication_command_id(&request);
        let request_bytes = request.encode_to_vec();
        let command = StoredPreKeyPublication {
            command_id: request.command_id.clone(),
            key_kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
            pool_epoch,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            state: DurableState::Pending,
            lease_generation: 0,
            session_generation: 0,
        };
        self.store
            .persist_prekey_publication(&command, private_material.as_slice())?;
        Ok(command.command_id)
    }

    fn dispatch_prekey_publication(&self, command_id: &str) -> Result<(), String> {
        let (command, reconciles_unknown_outcome) =
            self.store.acquire_prekey_publication(command_id)?;
        match self.transport.publish_prekeys(&command.request_bytes) {
            Ok(_) => {
                if !self
                    .store
                    .finish_prekey_publication(&command, DurableState::Committed)?
                {
                    return Err(
                        "private Social PreKey publication lost its generation fence".to_string(),
                    );
                }
                Ok(())
            }
            Err(error)
                if matches!(
                    error.disposition,
                    TransportDisposition::Retryable | TransportDisposition::UnknownOutcome
                ) || preserves_unknown_after_auth_rejection(
                    reconciles_unknown_outcome,
                    &error,
                ) =>
            {
                self.store
                    .finish_prekey_publication(&command, DurableState::UnknownOutcome)?;
                Err(error.to_string())
            }
            Err(error) => {
                self.store
                    .finish_prekey_publication(&command, DurableState::Terminal)?;
                Err(error.to_string())
            }
        }
    }

    fn publisher(&self) -> actor::ActorDeviceRef {
        actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: self.session.scope.actor_ptid.clone(),
                ..Default::default()
            }),
            device_id: self.session.scope.device_id.clone(),
        }
    }
}

fn preserves_unknown_after_auth_rejection(
    reconciles_unknown_outcome: bool,
    error: &TransportError,
) -> bool {
    reconciles_unknown_outcome
        && error.disposition == TransportDisposition::Terminal
        && matches!(error.http_status, Some(401 | 403))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_rejection_never_reclassifies_a_first_attempt_as_unknown() {
        let error = TransportError {
            http_status: Some(401),
            stable_code: 20001,
            typed_error: true,
            retry_after_seconds: None,
            disposition: TransportDisposition::Terminal,
        };
        assert!(!preserves_unknown_after_auth_rejection(false, &error));
        assert!(preserves_unknown_after_auth_rejection(true, &error));
    }
}
