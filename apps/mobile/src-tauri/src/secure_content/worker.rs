use std::sync::Arc;

use prost::Message;
use secure_content_core::prekey::{
    ContentPreKeyActorRef, ContentPreKeyEndpoint, ContentPreKeyKind as CorePreKeyKind,
    ContentPreKeyPair, ContentPreKeyPrincipal, ContentPreKeySigningInput,
    CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
};
use secure_content_core::recovery::{derive_recovery_prekey, RecoveryMaster};
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
    canonical_publication_bytes, publication_command_id, NativeSocialTransport,
    TransportDisposition, TransportError,
};
use crate::secure_content::NativeSocialSession;

const CONTENT_PREKEY_BATCH_LIMIT: u32 = 100;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialWorkerReport {
    pub endpoint_prekeys_available: u32,
    pub recovery_prekeys_available: Option<u32>,
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
        self.reconcile_prekey_publications()?;
        let endpoint_prekeys_available =
            self.maintain_prekey_pool(wire::ContentPreKeyKind::ContentPrekeyKindEndpoint)?;
        let recovery_prekeys_available = if self
            .store
            .latest_recovery_epoch(&self.session.scope.actor_ptid)?
            .is_some()
        {
            Some(
                self.maintain_prekey_pool(wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery)?,
            )
        } else {
            None
        };
        let mut report = PrivateSocialWorkerReport {
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
        if let Some(Ok(readback)) = unknown_submission_readback(
            &command,
            acquired.reconciles_unknown_outcome,
            |content_id| self.transport.get_private_moment(content_id),
        ) {
            let submitted = social::SubmitPrivateMomentResponse {
                post: readback.resource.clone(),
                exact_replay: true,
            };
            return match verify_submit_readback(
                self.session.as_ref(),
                &command,
                &request,
                &submitted,
                &readback,
            ) {
                Ok(post_id) => self.finish_submission(
                    &command,
                    DurableState::Committed,
                    PrivatePublishState::Published,
                    Some(post_id),
                    None,
                ),
                Err(_) => self.finish_submission(
                    &command,
                    DurableState::Terminal,
                    PrivatePublishState::PublishFailed,
                    None,
                    Some(20005),
                ),
            };
        }
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
                        private_content_code: None,
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

    fn reconcile_prekey_publications(&self) -> Result<(), String> {
        for pending in self.store.pending_prekey_publications()? {
            self.dispatch_prekey_publication(&pending.command_id)?;
        }
        Ok(())
    }

    fn maintain_prekey_pool(&self, kind: wire::ContentPreKeyKind) -> Result<u32, String> {
        let inventory = match self.transport.inventory(kind) {
            Ok(inventory) => Some(inventory),
            Err(error) if error.disposition == TransportDisposition::PoolNotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        let expected_pool_epoch = inventory.as_ref().map_or(0, |value| value.current_epoch);
        let latest_recovery_epoch =
            if kind == wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery {
                self.store
                    .latest_recovery_epoch(&self.session.scope.actor_ptid)?
            } else {
                None
            };
        let rotation_pending =
            latest_recovery_epoch.is_some_and(|epoch| epoch > expected_pool_epoch);
        if let Some(inventory) = inventory.as_ref() {
            if !inventory.needs_replenishment && !rotation_pending {
                return Ok(inventory.available);
            }
        }
        let pool_epoch = match kind {
            wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => self.session.profile_version,
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                let latest = latest_recovery_epoch
                    .ok_or_else(|| "private Social recovery master is unavailable".to_string())?;
                if expected_pool_epoch == 0 {
                    1
                } else if latest > expected_pool_epoch {
                    expected_pool_epoch
                        .checked_add(1)
                        .ok_or_else(|| "private Social recovery epoch is exhausted".to_string())?
                } else {
                    expected_pool_epoch
                }
            }
            wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => {
                return Err("private Social PreKey kind is required".to_string())
            }
        };
        let available = inventory.as_ref().map_or(0, |value| value.available);
        let capacity = inventory
            .as_ref()
            .map(|value| value.capacity)
            .filter(|capacity| *capacity > 0)
            .unwrap_or(CONTENT_PREKEY_BATCH_LIMIT);
        let count = if pool_epoch != expected_pool_epoch {
            capacity
        } else {
            capacity.saturating_sub(available)
        }
        .clamp(1, CONTENT_PREKEY_BATCH_LIMIT);
        let command_id =
            self.create_prekey_publication(kind, pool_epoch, expected_pool_epoch, count)?;
        self.dispatch_prekey_publication(&command_id)?;
        self.transport
            .inventory(kind)
            .map(|fresh| fresh.available)
            .map_err(|error| error.to_string())
    }

    fn create_prekey_publication(
        &self,
        kind: wire::ContentPreKeyKind,
        pool_epoch: u64,
        expected_pool_epoch: u64,
        count: u32,
    ) -> Result<String, String> {
        let publisher = self.publisher();
        let recovery_master = if kind == wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery {
            let bytes = self
                .store
                .recovery_master(&self.session.scope.actor_ptid, pool_epoch)?
                .ok_or_else(|| {
                    "private Social recovery master is unavailable for epoch".to_string()
                })?;
            Some(RecoveryMaster::from_bytes(bytes))
        } else {
            None
        };
        let mut generated = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let prefix = match kind {
                wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => "mobile-content-endpoint",
                wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                    "mobile-content-recovery"
                }
                wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => {
                    return Err("private Social PreKey kind is required".to_string())
                }
            };
            let key_id = format!("{prefix}-{}", Ulid::new());
            let pair = match recovery_master.as_ref() {
                Some(master) => derive_recovery_prekey(
                    master,
                    &self.session.scope.actor_ptid,
                    pool_epoch,
                    &key_id,
                )?,
                None => ContentPreKeyPair::generate(),
            };
            generated.push((key_id, pair));
        }
        generated.sort_by(|left, right| left.0.cmp(&right.0));
        let mut prekeys = Vec::with_capacity(generated.len());
        let mut private_material = Zeroizing::new(Vec::with_capacity(generated.len()));
        for (key_id, pair) in generated {
            let principal = match kind {
                wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => {
                    ContentPreKeyPrincipal::Endpoint(ContentPreKeyEndpoint::new(
                        &self.session.scope.actor_ptid,
                        &self.session.scope.device_id,
                    ))
                }
                wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                    ContentPreKeyPrincipal::RecoveryActor(ContentPreKeyActorRef::new(
                        &self.session.scope.actor_ptid,
                    ))
                }
                wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => unreachable!(),
            };
            let signing_input = ContentPreKeySigningInput {
                format_version: CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
                kind: match kind {
                    wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => CorePreKeyKind::Endpoint,
                    wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                        CorePreKeyKind::ActorRecovery
                    }
                    wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => unreachable!(),
                },
                key_id: key_id.clone(),
                x25519_public_key: pair.public(),
                principal,
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
            let principal = match kind {
                wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => {
                    wire::content_one_time_pre_key::Principal::Endpoint(publisher.clone())
                }
                wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                    wire::content_one_time_pre_key::Principal::RecoveryActor(
                        publisher.actor.clone().unwrap_or_default(),
                    )
                }
                wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => unreachable!(),
            };
            prekeys.push(wire::ContentOneTimePreKey {
                kind: kind as i32,
                key_id: key_id.clone(),
                x25519_public_key: pair.public().as_bytes().to_vec(),
                principal: Some(principal),
                profile_or_recovery_epoch: pool_epoch,
                issuer_signature: signature,
            });
            if kind == wire::ContentPreKeyKind::ContentPrekeyKindEndpoint {
                private_material.push((
                    key_id,
                    pair.private().to_bytes(),
                    pair.public().as_bytes().to_owned(),
                ));
            }
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
        request.command_id = publication_command_id(&request)?;
        let request_bytes = canonical_publication_bytes(&request)?;
        let command = StoredPreKeyPublication {
            command_id: request.command_id.clone(),
            key_kind: kind as i32,
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

fn unknown_submission_readback<F>(
    command: &StoredSubmission,
    reconciles_unknown_outcome: bool,
    fetch: F,
) -> Option<Result<social::GetMomentResourceResponse, TransportError>>
where
    F: FnOnce(&str) -> Result<social::GetMomentResourceResponse, TransportError>,
{
    reconciles_unknown_outcome.then(|| fetch(&command.content_id))
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
    use std::cell::RefCell;

    use ed25519_dalek::{Signature, SigningKey};
    use messaging_core::identity::DeviceSigningKey;

    use crate::secure_content::recovery::store_recovery_phrase;
    use crate::secure_content::{PrivateSocialScope, TrustedStationSigningKey};

    const RECOVERY_PHRASE: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    fn session(station_key: &SigningKey) -> Arc<NativeSocialSession> {
        Arc::new(
            NativeSocialSession::new(
                PrivateSocialScope {
                    profile_id: "profile-1".to_string(),
                    station_peer_id: "station-1".to_string(),
                    station_origin: "https://station.test".to_string(),
                    actor_ptid: "ptid:alice".to_string(),
                    device_id: "device-alice".to_string(),
                },
                Zeroizing::new("header.payload.signature".to_string()),
                "session-1".to_string(),
                "alice-signing-key".to_string(),
                7,
                DeviceSigningKey::from_parts(
                    &[9; 32],
                    Signature::from_bytes(&[0; 64]),
                    "device-alice".to_string(),
                ),
                TrustedStationSigningKey {
                    key_id: "station-key-current".to_string(),
                    verifying_key: station_key.verifying_key(),
                },
            )
            .unwrap(),
        )
    }

    #[test]
    fn auth_rejection_never_reclassifies_a_first_attempt_as_unknown() {
        let error = TransportError {
            http_status: Some(401),
            stable_code: 20001,
            typed_error: true,
            private_content_code: None,
            retry_after_seconds: None,
            disposition: TransportDisposition::Terminal,
        };
        assert!(!preserves_unknown_after_auth_rejection(false, &error));
        assert!(preserves_unknown_after_auth_rejection(true, &error));
    }

    #[test]
    fn unknown_submission_reads_authoritative_resource_before_retry() {
        let observed_content_id = RefCell::new(String::new());
        let command = StoredSubmission {
            command_id: "command-1".to_string(),
            draft_id: "draft-1".to_string(),
            draft_revision: 1,
            content_id: "content-1".to_string(),
            generation: 1,
            request_bytes: vec![1],
            request_sha256: [2; 32],
            root_key: [3; 32],
            projection_json: vec![4],
            state: DurableState::InFlight,
            lease_generation: 1,
            session_generation: 1,
            post_id: None,
            last_error_code: Some(20005),
        };

        let readback = unknown_submission_readback(&command, true, |content_id| {
            observed_content_id.replace(content_id.to_string());
            Ok(social::GetMomentResourceResponse::default())
        });

        assert_eq!(observed_content_id.into_inner(), "content-1");
        assert!(matches!(readback, Some(Ok(_))));
    }

    #[test]
    fn first_submission_does_not_probe_authoritative_readback() {
        let command = StoredSubmission {
            command_id: "command-1".to_string(),
            draft_id: "draft-1".to_string(),
            draft_revision: 1,
            content_id: "content-1".to_string(),
            generation: 1,
            request_bytes: vec![1],
            request_sha256: [2; 32],
            root_key: [3; 32],
            projection_json: vec![4],
            state: DurableState::InFlight,
            lease_generation: 1,
            session_generation: 1,
            post_id: None,
            last_error_code: None,
        };

        let readback = unknown_submission_readback(&command, false, |_| {
            panic!("first submission must not query authoritative readback")
        });

        assert!(readback.is_none());
    }

    #[test]
    fn recovery_publication_derives_keys_without_persisting_private_material() {
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let session = session(&station_key);
        let store = Arc::new(PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap());
        store.bind_session_generation(1).unwrap();
        store_recovery_phrase(store.as_ref(), "ptid:alice", 1, RECOVERY_PHRASE).unwrap();
        let worker = PrivateSocialWorker::new(session, store.clone()).unwrap();

        let command_id = worker
            .create_prekey_publication(
                wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery,
                1,
                0,
                2,
            )
            .unwrap();

        let command = store
            .pending_prekey_publications()
            .unwrap()
            .into_iter()
            .find(|command| command.command_id == command_id)
            .unwrap();
        let request =
            wire::PublishContentPreKeysRequest::decode(command.request_bytes.as_slice()).unwrap();
        let master =
            RecoveryMaster::from_bytes(store.recovery_master("ptid:alice", 1).unwrap().unwrap());
        assert_eq!(request.prekeys.len(), 2);
        for prekey in request.prekeys {
            assert_eq!(
                prekey.kind,
                wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32
            );
            assert!(matches!(
                prekey.principal.as_ref(),
                Some(wire::content_one_time_pre_key::Principal::RecoveryActor(actor))
                    if actor.ptid == "ptid:alice"
            ));
            let expected =
                derive_recovery_prekey(&master, "ptid:alice", 1, &prekey.key_id).unwrap();
            assert_eq!(
                prekey.x25519_public_key,
                expected.public().as_bytes().as_slice()
            );
            assert!(store.endpoint_prekey(&prekey.key_id).unwrap().is_none());
        }
    }
}
