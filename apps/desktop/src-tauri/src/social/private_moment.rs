use std::path::{Path, PathBuf};

use ed25519_dalek::VerifyingKey;
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use secure_content_core::codec::CanonicalMessageEncoder;
use secure_content_core::envelope::ContentKey;
use secure_content_core::object::{
    ObjectCryptoMaterial, ObjectTransferDirection, ObjectTransferErrorCode, ObjectTransferFailure,
    ObjectTransferProgress,
};
use secure_content_core::payload::{
    derive_payload_key, encrypt_payload, PayloadKeyContext, PAYLOAD_FORMAT_VERSION,
};
use secure_content_core::ports::{ObjectBlob, ObjectTransferRepository};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::{actor, secure_content as wire, social};
use crate::secure_content::adapter::{NativeErrorDisposition, SecureContentTransport};
use crate::secure_content::recovery::open_recovery_content_key;
use crate::secure_content::station_trust::{
    current_session_sender_signing_key, verify_profile_actor_device_signing_key,
};
use crate::secure_content::store::{
    PublicationState, StoredMomentCommand, StoredMomentDraft, StoredObjectTransfer,
};
use crate::secure_content::worker::{
    media_type, new_download_record, new_download_worker, new_object_worker, new_upload_record,
    secure_cache_root, secure_ciphertext_checkpoint_path, secure_media_cache_path,
    FilesystemObjectBlob,
};
use crate::secure_content::{SecureContentLease, SecureContentSupervisor};

use super::crypto::{
    bounded_command_id, now_unix_ms, seal_content_envelopes, validate_content_plan,
};
use super::private_media::{verify_descriptor_binding, PrivateMediaOpenError};
use super::private_mention::{
    build_signed_mention_routing, canonical_private_mentions, PrivateMentionIntent,
};
use super::projection::{
    decrypt_projection_from_response, object_descriptor_set_hash, private_poll_option_set_hash,
    repost_source_material_from_response, sender_key_requirement,
    verify_recovery_envelope_for_response, DecryptedPrivateMoment, PrivateMediaState,
    PrivateMomentContentProjection, PrivateMomentProjection, PrivateMomentPublishResult,
    PrivateMomentsSnapshot, PrivateProjectionFailureKind, PrivateRepostSourceMaterial,
};

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateMomentFileIntent {
    pub intent_id: String,
    pub file_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateMomentLinkIntent {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub image_url: String,
    #[serde(default)]
    pub site_name: String,
    #[serde(default)]
    pub favicon_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateMomentLocationIntent {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub place_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateMomentPollIntent {
    pub question: String,
    pub options: Vec<String>,
    pub min_choices: u32,
    pub max_choices: u32,
    pub expires_at_seconds: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateMomentRepostIntent {
    pub source_post_id: String,
}

#[derive(Clone, Debug)]
struct PrivateMomentPollMaterial {
    authority: social::PrivatePollAuthority,
    options: Vec<social::PrivatePollOption>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMomentAudienceIntent {
    pub kind: String,
    #[serde(default)]
    pub circle_id: Option<String>,
    #[serde(default)]
    pub group_conversation_id: Option<String>,
    #[serde(default)]
    pub actor_ptids: Vec<String>,
    #[serde(default)]
    pub base_kind: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateMomentPublishIntent {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub draft_id: String,
    pub draft_revision: u64,
    pub audience: PrivateMomentAudienceIntent,
    #[serde(default)]
    pub moment_kind: String,
    pub text: String,
    #[serde(default)]
    pub mentions: Vec<PrivateMentionIntent>,
    #[serde(default)]
    pub files: Vec<PrivateMomentFileIntent>,
    #[serde(default)]
    pub link: Option<PrivateMomentLinkIntent>,
    #[serde(default)]
    pub location: Option<PrivateMomentLocationIntent>,
    #[serde(default)]
    pub poll: Option<PrivateMomentPollIntent>,
    #[serde(default)]
    pub repost: Option<PrivateMomentRepostIntent>,
    #[serde(default)]
    pub admission_only: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMomentAdmissionResult {
    pub state: &'static str,
    pub draft_id: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMomentPublishRejectionEvidence {
    pub publish_phase: &'static str,
    pub prepare_succeeded: bool,
    pub received_prepare_plan_count: usize,
    pub desktop_local_durable_row_count: usize,
    pub local_draft_row_count: usize,
    pub local_command_row_count: usize,
    pub local_projection_row_count: usize,
    pub local_upload_row_count: usize,
    pub claim_count_scope: &'static str,
    pub partial_row_scope: &'static str,
    pub server_write_proof: &'static str,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMomentPublishRejection {
    pub state: &'static str,
    pub draft_id: String,
    pub error_code: &'static str,
    pub station_error_code: String,
    pub evidence: PrivateMomentPublishRejectionEvidence,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum PrivateMomentPublishOutcome {
    Ready(PrivateMomentAdmissionResult),
    Published(PrivateMomentPublishResult),
    Rejected(PrivateMomentPublishRejection),
}

impl From<PrivateMomentPublishResult> for PrivateMomentPublishOutcome {
    fn from(result: PrivateMomentPublishResult) -> Self {
        Self::Published(result)
    }
}

pub struct PrivateMomentOrchestrator<'a> {
    supervisor: &'a SecureContentSupervisor,
    lease: SecureContentLease,
    transport: SecureContentTransport,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrivateRecoveryFailureKind {
    KeyUnavailable,
    NotAuthorized,
    AuthenticationRequired,
    Retryable,
    IntegrityFailure,
}

#[derive(Debug)]
pub struct PrivateRecoveryError {
    pub kind: PrivateRecoveryFailureKind,
    pub message: String,
}

enum PrivateRecoveryAttemptError {
    Transport(crate::secure_content::adapter::NativeTransportError),
    KeyUnavailable(String),
    Integrity(String),
}

#[derive(Debug)]
enum PrivatePublishFailure {
    Preserve(String),
    Cleanup(String),
    RejectedBeforePrepare { station_error_code: String },
    RecipientUnavailable,
}

impl PrivatePublishFailure {
    fn preserve(message: impl Into<String>) -> Self {
        Self::Preserve(message.into())
    }

    fn cleanup(message: impl Into<String>) -> Self {
        Self::Cleanup(message.into())
    }

    fn from_transport(error: crate::secure_content::adapter::NativeTransportError) -> Self {
        if matches!(
            error.disposition,
            NativeErrorDisposition::Retryable | NativeErrorDisposition::UnknownCommit
        ) {
            Self::preserve(error.to_string())
        } else {
            Self::cleanup(error.to_string())
        }
    }

    fn from_prepare_transport(error: crate::secure_content::adapter::NativeTransportError) -> Self {
        if matches!(error.stable_code, 30203 | 30206 | 30209) {
            return Self::RecipientUnavailable;
        }
        if error.http_status == Some(400)
            && error.stable_code == crate::model::error::ErrorCode::InvalidRequest as i32
            && error.disposition == NativeErrorDisposition::Terminal
            && error.message == "SOCIAL_PRIVATE_UNSUPPORTED"
        {
            return Self::RejectedBeforePrepare {
                station_error_code: error.message,
            };
        }
        Self::from_transport(error)
    }

    fn from_transfer(error: ObjectTransferFailure) -> Self {
        if error.retryable {
            Self::preserve(error.to_string())
        } else {
            Self::cleanup(error.to_string())
        }
    }

    fn into_parts(self) -> (String, bool) {
        match self {
            Self::Preserve(message) => (message, false),
            Self::Cleanup(message) => (message, true),
            Self::RejectedBeforePrepare { station_error_code } => (
                format!("private Moment prepare was rejected: {station_error_code}"),
                true,
            ),
            Self::RecipientUnavailable => ("RECIPIENT_KEY_UNAVAILABLE".to_string(), false),
        }
    }
}

impl From<String> for PrivateRecoveryAttemptError {
    fn from(message: String) -> Self {
        if message.contains("DESIGN_AMENDMENT_REQUIRED") {
            Self::KeyUnavailable(message)
        } else {
            Self::Integrity(message)
        }
    }
}

impl<'a> PrivateMomentOrchestrator<'a> {
    pub fn new(
        supervisor: &'a SecureContentSupervisor,
        lease: SecureContentLease,
    ) -> Result<Self, String> {
        let transport = SecureContentTransport::new(lease.session.clone())?;
        Ok(Self {
            supervisor,
            lease,
            transport,
        })
    }

    pub fn snapshot(&self) -> Result<PrivateMomentsSnapshot, String> {
        let projections = self
            .lease
            .store
            .projections()?
            .into_iter()
            .map(|bytes| PrivateMomentProjection::decode_local(&bytes))
            .map(|projection| projection.map(scrub_persisted_media_projection))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(PrivateMomentsSnapshot {
            actor_ptid: self.lease.session.key.actor_ptid.clone(),
            device_id: self.lease.session.key.device_id.clone(),
            session_generation: self.lease.session.key.session_generation.to_string(),
            projections,
        })
    }

    pub fn reconcile(
        &self,
        post_ids: &[String],
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<PrivateMomentsSnapshot, String> {
        for transfer_id in self.lease.store.abandoned_upload_transfer_ids()? {
            if let Err(error) = self.purge_abandoned_upload(&transfer_id) {
                tracing::warn!(
                    transfer_id,
                    error = %error,
                    "abandoned private Moment upload cleanup remains pending"
                );
            }
        }
        for post_id in self.lease.store.pending_private_resource_purges()? {
            self.purge_private_resource(&post_id, revoke_media)?;
        }
        for command in self.lease.store.reconcilable_moment_commands()? {
            let Some(_publish_guard) = self.supervisor.try_begin_private_publish(
                &self.lease.session.key,
                &command.draft_id,
                command.draft_revision,
            )?
            else {
                continue;
            };
            self.replay_submit(command)?;
        }
        for post_id in post_ids {
            if !post_id.trim().is_empty() {
                self.read(post_id, revoke_media)?;
            }
        }
        self.snapshot()
    }

    pub fn publish(
        &self,
        intent: &PrivateMomentPublishIntent,
    ) -> Result<PrivateMomentPublishOutcome, String> {
        validate_publish_intent(intent)?;
        let _publish_guard = self.supervisor.begin_private_publish(
            &self.lease.session.key,
            &intent.draft_id,
            intent.draft_revision,
        )?;
        if let Some(existing) = self.existing_publish_result(intent)? {
            return Ok(existing.into());
        }
        let mut upload_transfer_ids = Vec::new();
        let mut content_id = None;
        match self.publish_new(intent, &mut upload_transfer_ids, &mut content_id) {
            Ok(result) => Ok(result),
            Err(failure) => {
                self.finish_publish_failure(intent, failure, content_id, upload_transfer_ids)
            }
        }
    }

    fn publish_new(
        &self,
        intent: &PrivateMomentPublishIntent,
        upload_transfer_ids: &mut Vec<String>,
        cleanup_content_id: &mut Option<String>,
    ) -> Result<PrivateMomentPublishOutcome, PrivatePublishFailure> {
        let prepare_command_id =
            bounded_command_id("moment-prepare", &intent.draft_id, intent.draft_revision);
        let kind =
            resolve_moment_kind(&intent.moment_kind).map_err(PrivatePublishFailure::cleanup)?;
        let mention_commitment_salt = if intent.mentions.is_empty() {
            None
        } else {
            let mut salt = [0u8; 32];
            OsRng.fill_bytes(&mut salt);
            Some(salt)
        };
        let repost_commitment_salt = if kind == social::PrivateMomentKind::Repost {
            let mut salt = [0u8; 32];
            OsRng.fill_bytes(&mut salt);
            Some(salt)
        } else {
            None
        };
        let reservation = self
            .lease
            .store
            .reserve_moment_draft(&StoredMomentDraft {
                draft_id: intent.draft_id.clone(),
                draft_revision: intent.draft_revision,
                intent_sha256: private_moment_intent_hash(intent)
                    .map_err(PrivatePublishFailure::cleanup)?,
                content_id: ulid::Ulid::new().to_string(),
                prepare_command_id: prepare_command_id.clone(),
                mention_commitment_salt,
                repost_commitment_salt,
            })
            .map_err(PrivatePublishFailure::preserve)?;
        let content_id = reservation.content_id;
        *cleanup_content_id = Some(content_id.clone());
        let audience = private_audience(intent).map_err(PrivatePublishFailure::cleanup)?;
        let poll_material = private_poll_material(intent, &content_id, kind)
            .map_err(PrivatePublishFailure::cleanup)?;
        let repost_material = self.load_repost_source_material(
            intent,
            kind,
            reservation.repost_commitment_salt.as_ref(),
        )?;
        let subtype_prepare_authority_sha256 = poll_material
            .as_ref()
            .map(|poll| poll.authority.encode_to_vec())
            .or_else(|| {
                repost_material
                    .as_ref()
                    .map(|repost| repost.authority.encode_to_vec())
            })
            .map(|authority| Sha256::digest(authority).to_vec())
            .unwrap_or_default();
        let prepare = social::PreparePrivateMomentRequest {
            content_id: content_id.clone(),
            audience: Some(audience),
            object_count: intent.files.len() as u32,
            command_id: prepare_command_id,
            kind: kind as i32,
            repost_authority: repost_material
                .as_ref()
                .map(|repost| repost.authority.clone()),
            poll_authority: poll_material.as_ref().map(|poll| poll.authority.clone()),
        };
        let plan = self
            .transport
            .prepare_private_moment(&prepare)
            .map_err(PrivatePublishFailure::from_prepare_transport)?
            .plan
            .ok_or_else(|| {
                PrivatePublishFailure::cleanup("private Moment prepare response omitted its plan")
            })?;
        self.ensure_current()
            .map_err(PrivatePublishFailure::preserve)?;
        validate_plan(
            &plan,
            &self.lease,
            &content_id,
            kind,
            intent.files.len(),
            &subtype_prepare_authority_sha256,
        )
        .map_err(PrivatePublishFailure::cleanup)?;
        if intent.admission_only {
            return Ok(PrivateMomentPublishOutcome::Ready(
                PrivateMomentAdmissionResult {
                    state: "READY_PRIVATE",
                    draft_id: intent.draft_id.clone(),
                },
            ));
        }

        let mut attachment_metadata = Vec::with_capacity(intent.files.len());
        let mut descriptors = Vec::with_capacity(intent.files.len());
        if !intent.files.is_empty() {
            let worker = new_object_worker(&self.lease).map_err(PrivatePublishFailure::preserve)?;
            for (file, object_id) in intent.files.iter().zip(&plan.object_ids) {
                if file.intent_id.trim().is_empty() || file.file_path.trim().is_empty() {
                    return Err(PrivatePublishFailure::cleanup(
                        "private Moment file intent is incomplete",
                    ));
                }
                let path = Path::new(&file.file_path);
                let mime = media_type(path);
                let (candidate, _) =
                    new_upload_record(&content_id, object_id, &plan.plan_id, path, mime)
                        .map_err(PrivatePublishFailure::cleanup)?;
                let record = self
                    .lease
                    .store
                    .ensure_object_upload_transfer(&candidate, mime)
                    .map_err(PrivatePublishFailure::preserve)?;
                upload_transfer_ids.push(record.transfer_id.clone());
                let material = ObjectCryptoMaterial::from_parts(
                    record.object_key.as_slice().try_into().map_err(|_| {
                        PrivatePublishFailure::cleanup("private Moment object key is invalid")
                    })?,
                    record.base_nonce.as_slice().try_into().map_err(|_| {
                        PrivatePublishFailure::cleanup("private Moment object nonce is invalid")
                    })?,
                    record.plaintext_size,
                    record.chunk_size,
                )
                .map_err(PrivatePublishFailure::cleanup)?;
                let progress = worker
                    .run_upload_once(&record.transfer_id, now_unix_ms())
                    .map_err(PrivatePublishFailure::from_transfer)?;
                self.ensure_current()
                    .map_err(PrivatePublishFailure::preserve)?;
                match progress {
                    ObjectTransferProgress::Complete => {}
                    ObjectTransferProgress::Deferred { .. }
                    | ObjectTransferProgress::RetryScheduled { .. } => {
                        return Err(PrivatePublishFailure::preserve(
                            "private Moment object upload remains retryable",
                        ));
                    }
                    ObjectTransferProgress::Terminal { code } => {
                        return Err(PrivatePublishFailure::cleanup(format!(
                            "private Moment object upload was rejected: {}",
                            code.as_str()
                        )));
                    }
                }
                let descriptor_bytes = self
                    .lease
                    .store
                    .object_descriptor_bytes(&record.transfer_id)
                    .map_err(PrivatePublishFailure::preserve)?
                    .ok_or_else(|| {
                        PrivatePublishFailure::cleanup(
                            "private Moment object descriptor was not persisted",
                        )
                    })?;
                let descriptor = wire::EncryptedObjectDescriptor::decode(
                    descriptor_bytes.as_slice(),
                )
                .map_err(|_| {
                    PrivatePublishFailure::cleanup("private Moment object descriptor is malformed")
                })?;
                let plaintext_sha256 =
                    FilesystemObjectBlob
                        .sha256(&file.file_path)
                        .map_err(|error| {
                            PrivatePublishFailure::cleanup(format!(
                                "hash private Moment media: {error}"
                            ))
                        })?;
                attachment_metadata.push(social::PrivateAttachmentMetadata {
                    attachment_id: file.intent_id.clone(),
                    filename: path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("attachment")
                        .to_string(),
                    mime_type: mime.to_string(),
                    plaintext_size: material.plaintext_size(),
                    plaintext_sha256: plaintext_sha256.to_vec(),
                    object_key: material.object_key().to_vec(),
                    base_nonce: material.base_nonce().to_vec(),
                    object: Some(descriptor.clone()),
                    width: 0,
                    height: 0,
                    duration_ms: 0,
                    alt_text: String::new(),
                });
                descriptors.push(descriptor);
            }
        }

        let mentions = canonical_private_mentions(&intent.text, &intent.mentions, "private Moment")
            .map_err(PrivatePublishFailure::cleanup)?;
        let plaintext = private_payload(
            intent,
            kind,
            attachment_metadata,
            poll_material.as_ref(),
            repost_material.as_ref(),
            &mentions,
            reservation.mention_commitment_salt.as_ref(),
            reservation.repost_commitment_salt.as_ref(),
        )?
        .encode_to_vec();
        let domain_binding = social::PrivateMomentDomainBinding {
            format_version: PAYLOAD_FORMAT_VERSION,
            kind: kind as i32,
            subtype_prepare_authority_sha256: subtype_prepare_authority_sha256.clone(),
        }
        .encode_to_vec();
        if Sha256::digest(&domain_binding).as_slice() != plan.domain_binding_sha256 {
            return Err(PrivatePublishFailure::cleanup(
                "private Moment plan domain binding is invalid",
            ));
        }
        let authorization_snapshot: [u8; 32] = plan
            .authorization_snapshot_sha256
            .as_slice()
            .try_into()
            .map_err(|_| {
                PrivatePublishFailure::cleanup("private Moment authorization snapshot is invalid")
            })?;
        let resource = plan.resource.as_ref().ok_or_else(|| {
            PrivatePublishFailure::cleanup("private Moment plan resource is unavailable")
        })?;
        let root = ContentKey::generate();
        let payload_key = derive_payload_key(
            root.as_bytes(),
            &authorization_snapshot,
            &PayloadKeyContext {
                protocol_version: PAYLOAD_FORMAT_VERSION,
                owner_domain: resource.owner_domain as u32,
                content_id: &resource.content_id,
                generation: resource.generation,
                payload_kind: kind as u32,
            },
        )
        .map_err(PrivatePublishFailure::cleanup)?;
        let encrypted = encrypt_payload(&payload_key, &plaintext, &domain_binding)
            .map_err(PrivatePublishFailure::cleanup)?;
        let payload = wire::EncryptedPayload {
            format_version: PAYLOAD_FORMAT_VERSION,
            resource: Some(resource.clone()),
            suite: wire::PayloadEncryptionSuite::Aes256Gcm as i32,
            nonce: encrypted.nonce.to_vec(),
            ciphertext: encrypted.ciphertext,
            ciphertext_sha256: encrypted.ciphertext_sha256.to_vec(),
            aad_sha256: encrypted.aad_sha256.to_vec(),
        };
        let mention_routing = build_signed_mention_routing(
            &mentions,
            reservation.mention_commitment_salt.as_ref(),
            &plan,
            &payload,
            self.lease.session.as_ref(),
            "private Moment",
        )
        .map_err(PrivatePublishFailure::cleanup)?;
        let object_set_hash =
            object_descriptor_set_hash(&descriptors).map_err(PrivatePublishFailure::cleanup)?;
        let envelopes = seal_content_envelopes(
            self.lease.session.as_ref(),
            &plan,
            &payload,
            object_set_hash,
            &root,
            "private Moment",
        )
        .map_err(PrivatePublishFailure::cleanup)?;
        let submit_command_id =
            bounded_command_id("moment-submit", &intent.draft_id, intent.draft_revision);
        let request = social::SubmitPrivateMomentRequest {
            plan: Some(plan.clone()),
            payload: Some(payload),
            envelopes,
            objects: descriptors,
            mention_routing,
            poll_authority: poll_material.map(|poll| poll.authority),
            repost_authority: repost_material.map(|repost| repost.authority),
            command_id: submit_command_id.clone(),
        };
        let request_bytes = request.encode_to_vec();
        let command = StoredMomentCommand {
            draft_id: intent.draft_id.clone(),
            draft_revision: intent.draft_revision,
            content_id,
            generation: resource.generation,
            submit_command_id,
            plan_bytes: plan.encode_to_vec(),
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            root_key: root.to_bytes(),
            state: PublicationState::PendingPublication,
            session_generation: self.lease.session.key.session_generation,
            post_id: None,
        };
        self.lease
            .store
            .persist_moment_command(&command)
            .map_err(PrivatePublishFailure::preserve)?;
        self.replay_submit(command)
            .map(PrivateMomentPublishOutcome::from)
            .map_err(PrivatePublishFailure::preserve)
    }

    fn finish_publish_failure(
        &self,
        intent: &PrivateMomentPublishIntent,
        failure: PrivatePublishFailure,
        content_id: Option<String>,
        upload_transfer_ids: Vec<String>,
    ) -> Result<PrivateMomentPublishOutcome, String> {
        if intent.admission_only {
            return Err(match failure {
                PrivatePublishFailure::RejectedBeforePrepare { .. } => {
                    "PRIVATE_UNSUPPORTED".to_string()
                }
                PrivatePublishFailure::RecipientUnavailable => {
                    "RECIPIENT_KEY_UNAVAILABLE".to_string()
                }
                PrivatePublishFailure::Preserve(message)
                | PrivatePublishFailure::Cleanup(message) => message,
            });
        }
        let station_error_code = match &failure {
            PrivatePublishFailure::RejectedBeforePrepare { station_error_code } => {
                Some(station_error_code.clone())
            }
            _ => None,
        };
        let (error, should_cleanup) = failure.into_parts();
        if !should_cleanup {
            return Err(error);
        }
        let content_id = content_id
            .ok_or_else(|| format!("{error}; private Moment cleanup content ID is unavailable"))?;
        self.lease.store.delete_moment_draft(&content_id)?;
        let mut cleanup_errors = Vec::new();
        for transfer_id in upload_transfer_ids {
            if let Err(cleanup_error) = self.purge_abandoned_upload(&transfer_id) {
                cleanup_errors.push(cleanup_error);
            }
        }
        if !cleanup_errors.is_empty() {
            return Err(format!(
                "{error}; cleanup abandoned private Moment uploads: {}",
                cleanup_errors.join("; ")
            ));
        }
        let local_command_row_count = usize::from(
            self.lease
                .store
                .moment_command(&intent.draft_id, intent.draft_revision)?
                .is_some(),
        );
        let local_projection_row_count =
            usize::from(self.lease.store.projection(&content_id)?.is_some());
        let local_upload_row_count = self
            .lease
            .store
            .upload_transfer_ids_for_content(&content_id)?
            .len();
        let local_draft_row_count = 0;
        let desktop_local_durable_row_count = local_draft_row_count
            + local_command_row_count
            + local_projection_row_count
            + local_upload_row_count;
        if desktop_local_durable_row_count != 0 {
            return Err(format!(
                "{error}; private Moment rejection left {desktop_local_durable_row_count} local durable rows"
            ));
        }
        if let Some(station_error_code) = station_error_code {
            let evidence = PrivateMomentPublishRejectionEvidence {
                publish_phase: "PREPARE_REJECTED",
                prepare_succeeded: false,
                received_prepare_plan_count: 0,
                desktop_local_durable_row_count,
                local_draft_row_count,
                local_command_row_count,
                local_projection_row_count,
                local_upload_row_count,
                claim_count_scope: "NATIVE_RECEIVED_PREPARE_PLAN",
                partial_row_scope: "DESKTOP_LOCAL_DURABLE_STATE",
                server_write_proof: "STATION_SOURCE_TEST_REQUIRED",
            };
            return Ok(PrivateMomentPublishOutcome::Rejected(
                PrivateMomentPublishRejection {
                    state: "PRIVATE_UNSUPPORTED",
                    draft_id: intent.draft_id.clone(),
                    error_code: "PRIVATE_UNSUPPORTED",
                    station_error_code,
                    evidence,
                },
            ));
        }
        Err(error)
    }

    fn load_repost_source_material(
        &self,
        intent: &PrivateMomentPublishIntent,
        kind: social::PrivateMomentKind,
        commitment_salt: Option<&[u8; 32]>,
    ) -> Result<Option<PrivateRepostSourceMaterial>, PrivatePublishFailure> {
        if kind != social::PrivateMomentKind::Repost {
            return Ok(None);
        }
        let source_post_id = intent
            .repost
            .as_ref()
            .map(|repost| repost.source_post_id.as_str())
            .ok_or_else(|| {
                PrivatePublishFailure::cleanup("private repost source intent is unavailable")
            })?;
        let commitment_salt = commitment_salt.ok_or_else(|| {
            PrivatePublishFailure::cleanup("private repost commitment salt is unavailable")
        })?;
        self.repost_source_material(source_post_id, commitment_salt)
            .map(Some)
            .map_err(PrivatePublishFailure::cleanup)
    }

    fn repost_source_material(
        &self,
        source_post_id: &str,
        commitment_salt: &[u8; 32],
    ) -> Result<PrivateRepostSourceMaterial, String> {
        let response = self
            .transport
            .get_private_moment(source_post_id)
            .map_err(|error| error.to_string())?;
        self.ensure_current()?;
        let is_private = response
            .resource
            .as_ref()
            .and_then(|resource| resource.body.as_ref())
            .is_some_and(|body| matches!(body, social::post_resource::Body::PrivateContent(_)));
        let decrypted = if is_private {
            let sender_signing_key = self
                .sender_signing_key(source_post_id, &response)?
                .ok_or_else(|| {
                    "private repost source sender signing key is unavailable".to_string()
                })?;
            self.ensure_current()?;
            Some(
                decrypt_projection_from_response(
                    self.lease.session.as_ref(),
                    self.lease.store.as_ref(),
                    source_post_id,
                    &response,
                    Some(&sender_signing_key),
                    None,
                    None,
                )
                .map_err(|error| error.message)?,
            )
        } else {
            None
        };
        let material = repost_source_material_from_response(
            source_post_id,
            &response,
            decrypted.as_ref(),
            commitment_salt,
        )?;
        if let Some(decrypted) = decrypted.as_ref() {
            self.persist_decrypted_projection(decrypted)?;
        }
        Ok(material)
    }

    fn verify_repost_source_current(
        &self,
        response: &social::GetMomentResourceResponse,
        decrypted: &DecryptedPrivateMoment,
    ) -> Result<(), String> {
        let Some(social::private_moment_content::Body::Repost(repost)) =
            decrypted.plaintext.body.as_ref()
        else {
            return Ok(());
        };
        let authority = response
            .resource
            .as_ref()
            .and_then(|resource| resource.body.as_ref())
            .and_then(|body| match body {
                social::post_resource::Body::PrivateContent(private) => {
                    private.verification.as_ref()
                }
                _ => None,
            })
            .and_then(|verification| verification.subtype_authority.as_ref())
            .and_then(|authority| match authority {
                social::private_content_verification::SubtypeAuthority::RepostAuthority(
                    authority,
                ) => Some(authority),
                _ => None,
            })
            .ok_or_else(|| "private repost authority is unavailable".to_string())?;
        let source_post_id = repost
            .original_source
            .as_ref()
            .map(|source| source.post_id.as_str())
            .ok_or_else(|| "private repost source identity is unavailable".to_string())?;
        if source_post_id == decrypted.projection.post_id {
            return Err("private repost cannot reference itself".to_string());
        }
        let commitment_salt: [u8; 32] = repost
            .rendered_source_commitment_salt
            .as_slice()
            .try_into()
            .map_err(|_| "private repost commitment salt is invalid".to_string())?;
        let current = self.repost_source_material(source_post_id, &commitment_salt)?;
        if current.authority != *authority
            || repost.rendered_source.as_ref() != Some(&current.rendered_source)
        {
            return Err("private repost source changed or is no longer authorized".to_string());
        }
        Ok(())
    }

    pub fn read(
        &self,
        post_id: &str,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<PrivateMomentProjection, String> {
        let projection = match self.transport.get_private_moment(post_id) {
            Ok(response) => {
                self.ensure_current()?;
                let sender_signing_key = match self.sender_signing_key(post_id, &response) {
                    Ok(key) => key,
                    Err(_) => {
                        self.ensure_current()?;
                        return self.persist_read_failure(
                            post_id,
                            PrivateProjectionFailureKind::IntegrityFailure,
                            revoke_media,
                        );
                    }
                };
                self.ensure_current()?;
                match decrypt_projection_from_response(
                    self.lease.session.as_ref(),
                    self.lease.store.as_ref(),
                    post_id,
                    &response,
                    sender_signing_key.as_ref(),
                    None,
                    None,
                ) {
                    Ok(decrypted) => {
                        if self
                            .verify_repost_source_current(&response, &decrypted)
                            .is_err()
                        {
                            self.purge_private_resource(post_id, revoke_media)?;
                            private_read_projection(
                                post_id,
                                PrivateProjectionFailureKind::IntegrityFailure,
                                "PRIVATE_REPOST_SOURCE_VERIFICATION_FAILED",
                                None,
                            )
                        } else {
                            self.persist_decrypted_projection(&decrypted)?;
                            return Ok(decrypted.projection);
                        }
                    }
                    Err(error) => {
                        if error.kind == PrivateProjectionFailureKind::IntegrityFailure {
                            self.purge_private_resource(post_id, revoke_media)?;
                        }
                        private_read_projection(
                            post_id,
                            error.kind,
                            "PRIVATE_CONTENT_VERIFICATION_FAILED",
                            None,
                        )
                    }
                }
            }
            Err(error) => {
                self.ensure_current()?;
                if requires_private_resource_purge(&error) {
                    self.purge_private_resource(post_id, revoke_media)?;
                }
                private_transport_failure_projection(post_id, &error)
            }
        };
        self.save_projection_if_current(post_id, &projection.encode_local()?)?;
        Ok(projection)
    }

    pub fn recover(
        &self,
        post_id: &str,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<PrivateMomentProjection, PrivateRecoveryError> {
        match self.recover_verified(post_id) {
            Ok(projection) => Ok(projection),
            Err(attempt) => {
                let (kind, message, purge) = classify_recovery_attempt(attempt);
                if purge {
                    if let Err(purge_error) = self.purge_private_resource(post_id, revoke_media) {
                        return Err(PrivateRecoveryError {
                            kind: PrivateRecoveryFailureKind::IntegrityFailure,
                            message: format!("{message}; purge failed: {purge_error}"),
                        });
                    }
                }
                Err(PrivateRecoveryError { kind, message })
            }
        }
    }

    fn recover_verified(
        &self,
        post_id: &str,
    ) -> Result<PrivateMomentProjection, PrivateRecoveryAttemptError> {
        let mut cursor = String::new();
        loop {
            let response = self
                .transport
                .list_recoverable(&cursor, 100)
                .map_err(PrivateRecoveryAttemptError::Transport)?;
            self.ensure_current()?;
            for recoverable in response.resources {
                let is_post = recoverable
                    .locator
                    .as_ref()
                    .and_then(|locator| locator.resource.as_ref())
                    .is_some_and(|resource| {
                        matches!(
                            resource,
                            social::social_private_content_locator::Resource::PostId(id)
                                if id == post_id
                        )
                    });
                if !is_post {
                    continue;
                }
                let envelope = recoverable
                    .recovery_envelope
                    .as_ref()
                    .ok_or_else(|| "private Moment recovery envelope is unavailable".to_string())?;
                let mut point = self
                    .transport
                    .get_private_moment(post_id)
                    .map_err(PrivateRecoveryAttemptError::Transport)?;
                self.ensure_current()?;
                attach_recovery_envelope(&mut point, envelope)?;
                let sender_signing_key = self.sender_signing_key(post_id, &point)?;
                let sender_signing_key = sender_signing_key.ok_or_else(|| {
                    "private Moment recovery sender signing key is unavailable".to_string()
                })?;
                self.ensure_current()?;
                verify_recovery_envelope_for_response(
                    self.lease.session.as_ref(),
                    post_id,
                    &point,
                    envelope,
                    envelope.principal_epoch,
                    &sender_signing_key,
                )?;
                let root = open_recovery_content_key(
                    self.lease.store.as_ref(),
                    &self.lease.session.key.actor_ptid,
                    envelope,
                )
                .map_err(|error| PrivateRecoveryAttemptError::KeyUnavailable(error))?;
                let decrypted = decrypt_projection_from_response(
                    self.lease.session.as_ref(),
                    self.lease.store.as_ref(),
                    post_id,
                    &point,
                    Some(&sender_signing_key),
                    Some(root),
                    Some(envelope.principal_epoch),
                )
                .map_err(|error| error.message)?;
                self.verify_repost_source_current(&point, &decrypted)?;
                self.persist_decrypted_projection(&decrypted)?;
                return Ok(decrypted.projection);
            }
            if !response.has_more {
                let point = self.transport.get_private_moment(post_id);
                self.ensure_current()?;
                return Err(classify_missing_recovery_target(point));
            }
            if response.next_cursor.trim().is_empty() || response.next_cursor == cursor {
                return Err(PrivateRecoveryAttemptError::Integrity(
                    "private Moment recovery pagination did not advance".to_string(),
                ));
            }
            cursor = response.next_cursor;
        }
    }

    pub fn open_media(
        &self,
        post_id: &str,
        object_id: &str,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<PrivateMomentProjection, PrivateMediaOpenError> {
        let response = match self.transport.get_private_moment(post_id) {
            Ok(response) => response,
            Err(error) => {
                self.ensure_current()
                    .map_err(PrivateMediaOpenError::cancelled)?;
                if requires_private_resource_purge(&error) {
                    self.purge_private_resource(post_id, revoke_media)?;
                }
                if matches!(error.http_status, Some(401 | 403 | 404 | 410)) {
                    return Ok(private_transport_failure_projection(post_id, &error));
                }
                return Err(PrivateMediaOpenError::dependency(
                    error.to_string(),
                    error.retry_after_seconds,
                ));
            }
        };
        self.ensure_current()
            .map_err(PrivateMediaOpenError::cancelled)?;
        let private = response
            .resource
            .as_ref()
            .and_then(|resource| match resource.body.as_ref() {
                Some(social::post_resource::Body::PrivateContent(private)) => Some(private),
                _ => None,
            })
            .ok_or_else(|| "private Moment media resource is unavailable".to_string())?;
        let resource = private
            .payload
            .as_ref()
            .and_then(|payload| payload.resource.as_ref())
            .ok_or_else(|| "private Moment media resource identity is unavailable".to_string())?
            .clone();
        let sender_signing_key = match self.sender_signing_key(post_id, &response) {
            Ok(key) => key,
            Err(error) => {
                self.ensure_current()?;
                self.purge_private_resource(post_id, revoke_media)?;
                return Ok(private_read_projection(
                    post_id,
                    PrivateProjectionFailureKind::IntegrityFailure,
                    &error,
                    None,
                ));
            }
        };
        self.ensure_current()?;
        let mut decrypted = match decrypt_projection_from_response(
            self.lease.session.as_ref(),
            self.lease.store.as_ref(),
            post_id,
            &response,
            sender_signing_key.as_ref(),
            None,
            None,
        ) {
            Ok(decrypted) => decrypted,
            Err(error) => {
                if error.kind == PrivateProjectionFailureKind::IntegrityFailure {
                    self.purge_private_resource(post_id, revoke_media)?;
                }
                return Ok(private_read_projection(
                    post_id,
                    error.kind,
                    &error.message,
                    None,
                ));
            }
        };
        self.verify_repost_source_current(&response, &decrypted)?;
        self.persist_decrypted_projection(&decrypted)?;
        let attachment = match decrypted.plaintext.body.as_ref() {
            Some(social::private_moment_content::Body::Image(image)) => image
                .images
                .iter()
                .find(|attachment| {
                    attachment
                        .object
                        .as_ref()
                        .is_some_and(|descriptor| descriptor.object_id == object_id)
                })
                .ok_or_else(|| {
                    PrivateMediaOpenError::access_denied(
                        "private Moment media object is unavailable",
                    )
                })?,
            Some(social::private_moment_content::Body::Video(video)) => video
                .source
                .iter()
                .chain(video.poster.iter())
                .chain(
                    video
                        .variants
                        .iter()
                        .filter_map(|variant| variant.media.as_ref()),
                )
                .find(|attachment| {
                    attachment
                        .object
                        .as_ref()
                        .is_some_and(|descriptor| descriptor.object_id == object_id)
                })
                .ok_or_else(|| {
                    PrivateMediaOpenError::access_denied(
                        "private Moment media object is unavailable",
                    )
                })?,
            _ => {
                return Err(PrivateMediaOpenError::access_denied(
                    "private Moment has no encrypted media",
                ))
            }
        };
        if !(attachment.mime_type.starts_with("image/")
            || attachment.mime_type.starts_with("video/"))
        {
            return Err(PrivateMediaOpenError::integrity(
                "private Moment media type is invalid",
            ));
        }
        let descriptor_wire = attachment
            .object
            .as_ref()
            .ok_or_else(|| "private Moment media descriptor is unavailable".to_string())?;
        let descriptor =
            crate::secure_content::adapter::SocialObjectCodec::descriptor_to_core(descriptor_wire)
                .map_err(|error| error.to_string())?;
        let expected_plaintext_sha256: [u8; 32] = attachment
            .plaintext_sha256
            .as_slice()
            .try_into()
            .map_err(|_| "private Moment media plaintext hash is invalid".to_string())?;
        let (record, cache_path) = new_download_record(
            &self.lease.session.key.actor_ptid,
            self.lease.session.key.session_generation,
            post_id,
            &resource,
            attachment,
        )?;
        verify_descriptor_binding(descriptor_wire, &record.descriptor_sha256)?;
        self.lease
            .store
            .ensure_object_download_transfer(&record, &attachment.mime_type, &cache_path)
            .map_err(|error| PrivateMediaOpenError::dependency(error, None))?;
        let worker = new_download_worker(&self.lease, descriptor_wire)
            .map_err(|error| PrivateMediaOpenError::dependency(error, None))?;
        let progress = worker.run_download_once(
            &record.transfer_id,
            &descriptor,
            &expected_plaintext_sha256,
            &cache_path.display().to_string(),
            now_unix_ms(),
        );
        let projection = &mut decrypted.projection;
        let media = match projection.content.as_mut() {
            Some(PrivateMomentContentProjection::Image { media, .. })
            | Some(PrivateMomentContentProjection::Video { media, .. }) => media,
            _ => {
                return Err(PrivateMediaOpenError::integrity(
                    "private Moment has no encrypted media",
                ))
            }
        };
        let item = media
            .iter_mut()
            .find(|item| item.object_id == object_id)
            .ok_or_else(|| "private Moment media object is unavailable".to_string())?;
        match progress {
            Ok(ObjectTransferProgress::Complete) => {
                self.ensure_current()
                    .map_err(PrivateMediaOpenError::cancelled)?;
                if !cache_path.is_file() {
                    return Err(PrivateMediaOpenError::integrity(
                        "private Moment media cache is unavailable",
                    ));
                }
                apply_ready_media(
                    item,
                    &cache_path,
                    &expected_plaintext_sha256,
                    attachment.plaintext_size,
                );
            }
            Ok(ObjectTransferProgress::Deferred { .. })
            | Ok(ObjectTransferProgress::RetryScheduled { .. }) => {
                item.state = PrivateMediaState::MediaOfflineRetryable;
                item.local_path = None;
                item.render_url = None;
                item.plaintext_sha256 = None;
                item.plaintext_size = None;
                item.error_code = Some("MEDIA_OFFLINE_RETRYABLE".to_string());
                item.retryable = true;
            }
            Ok(ObjectTransferProgress::Terminal { code }) => {
                if code == ObjectTransferErrorCode::NotGranted {
                    self.purge_private_resource(post_id, revoke_media)?;
                    return Ok(private_revoked_projection(post_id, "MEDIA_ACCESS_DENIED"));
                } else {
                    self.purge_private_media_download(
                        &StoredObjectTransfer {
                            record: record.clone(),
                            media_type: attachment.mime_type.clone(),
                        },
                        revoke_media,
                    )?;
                }
                apply_terminal_media_failure(item, code);
            }
            Err(error) => {
                if !error.retryable {
                    if error.code == ObjectTransferErrorCode::NotGranted {
                        self.purge_private_resource(post_id, revoke_media)?;
                        return Ok(private_revoked_projection(post_id, "MEDIA_ACCESS_DENIED"));
                    } else {
                        self.purge_private_media_download(
                            &StoredObjectTransfer {
                                record: record.clone(),
                                media_type: attachment.mime_type.clone(),
                            },
                            revoke_media,
                        )?;
                    }
                }
                apply_media_failure(item, &error);
            }
        }
        let persisted = scrub_persisted_media_projection(decrypted.projection.clone());
        let encoded = persisted.encode_local()?;
        self.save_projection_if_current(post_id, &encoded)
            .map_err(|error| PrivateMediaOpenError::dependency(error, None))?;
        Ok(decrypted.projection)
    }

    pub fn purge(
        &self,
        post_id: &str,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
        self.ensure_current()?;
        self.purge_private_resource(post_id, revoke_media)
    }

    fn existing_publish_result(
        &self,
        intent: &PrivateMomentPublishIntent,
    ) -> Result<Option<PrivateMomentPublishResult>, String> {
        if intent.admission_only {
            return Ok(None);
        }
        let existing = self
            .lease
            .store
            .moment_command(&intent.draft_id, intent.draft_revision)?;
        match existing {
            Some(command)
                if matches!(
                    command.state,
                    PublicationState::PendingPublication | PublicationState::UnknownCommit
                ) =>
            {
                self.replay_submit(command).map(Some)
            }
            Some(command) if command.state == PublicationState::InFlight => {
                Ok(Some(PrivateMomentPublishResult {
                    state: "UNKNOWN_COMMIT".to_string(),
                    draft_id: command.draft_id,
                    post_id: None,
                    projection: None,
                }))
            }
            Some(command) if command.state == PublicationState::Published => {
                let post_id = command
                    .post_id
                    .ok_or_else(|| "published private Moment has no post ID".to_string())?;
                let projection = self
                    .lease
                    .store
                    .projection(&post_id)?
                    .ok_or_else(|| "published private Moment projection is unavailable".to_string())
                    .and_then(|bytes| PrivateMomentProjection::decode_local(&bytes))?;
                Ok(Some(PrivateMomentPublishResult {
                    state: "PUBLISHED".to_string(),
                    draft_id: command.draft_id,
                    post_id: Some(post_id),
                    projection: Some(projection),
                }))
            }
            Some(_) => Err("private Moment command is terminal".to_string()),
            None => Ok(None),
        }
    }

    fn replay_submit(
        &self,
        command: StoredMomentCommand,
    ) -> Result<PrivateMomentPublishResult, String> {
        let reconciles_unknown_commit = command.state == PublicationState::UnknownCommit;
        let command = self.lease.store.acquire_moment_command(
            &command.draft_id,
            command.draft_revision,
            self.lease.session.key.session_generation,
        )?;
        self.submit_command(command, reconciles_unknown_commit)
    }

    fn submit_command(
        &self,
        command: StoredMomentCommand,
        reconciles_unknown_commit: bool,
    ) -> Result<PrivateMomentPublishResult, String> {
        let request =
            match social::SubmitPrivateMomentRequest::decode(command.request_bytes.as_slice()) {
                Ok(request) => request,
                Err(_) => {
                    self.lease.store.mark_moment_terminal(
                        &command.draft_id,
                        command.draft_revision,
                        command.session_generation,
                    )?;
                    self.lease.store.delete_moment_draft(&command.content_id)?;
                    for transfer_id in self
                        .lease
                        .store
                        .upload_transfer_ids_for_content(&command.content_id)?
                    {
                        self.purge_abandoned_upload(&transfer_id)?;
                    }
                    return Err("stored private Moment submit request is malformed".to_string());
                }
            };
        match self.transport.submit_private_moment(&request) {
            Ok(response) => {
                let observed_post_id = response
                    .post
                    .as_ref()
                    .and_then(|post| post.metadata.as_ref())
                    .map(|metadata| metadata.post_id.clone())
                    .filter(|post_id| !post_id.is_empty() && *post_id == command.content_id);
                let verified = (|| -> Result<PrivateMomentProjection, String> {
                    self.ensure_current()?;
                    let post_id = observed_post_id.as_ref().ok_or_else(|| {
                        "private Moment submit response changed the resource identity".to_string()
                    })?;
                    let response = self
                        .transport
                        .get_private_moment(post_id)
                        .map_err(|error| error.to_string())?;
                    self.ensure_current()?;
                    let sender_signing_key =
                        self.sender_signing_key(&command.content_id, &response)?;
                    let sender_signing_key = sender_signing_key.ok_or_else(|| {
                        "private Moment publish sender signing key is unavailable".to_string()
                    })?;
                    self.ensure_current()?;
                    let decrypted = decrypt_projection_from_response(
                        self.lease.session.as_ref(),
                        self.lease.store.as_ref(),
                        &command.content_id,
                        &response,
                        Some(&sender_signing_key),
                        Some(ContentKey::from_bytes(command.root_key)),
                        None,
                    )
                    .map_err(|error| error.message)?;
                    self.verify_repost_source_current(&response, &decrypted)?;
                    self.persist_decrypted_projection(&decrypted)?;
                    self.cleanup_published_upload_files(&command.content_id)?;
                    if !self.lease.store.mark_moment_published(
                        &command.draft_id,
                        command.draft_revision,
                        command.session_generation,
                        &decrypted.projection.post_id,
                    )? {
                        return Err(
                            "private Moment completion lost its generation fence".to_string()
                        );
                    }
                    Ok(decrypted.projection)
                })();
                match verified {
                    Ok(projection) => Ok(PrivateMomentPublishResult {
                        state: "PUBLISHED".to_string(),
                        draft_id: command.draft_id,
                        post_id: Some(projection.post_id.clone()),
                        projection: Some(projection),
                    }),
                    Err(_) => {
                        self.lease.store.mark_moment_unknown(
                            &command.draft_id,
                            command.draft_revision,
                            command.session_generation,
                        )?;
                        Ok(PrivateMomentPublishResult {
                            state: "UNKNOWN_COMMIT".to_string(),
                            draft_id: command.draft_id,
                            post_id: observed_post_id,
                            projection: None,
                        })
                    }
                }
            }
            Err(error)
                if matches!(
                    error.disposition,
                    NativeErrorDisposition::Retryable | NativeErrorDisposition::UnknownCommit
                ) || preserves_unknown_moment_after_auth_rejection(
                    reconciles_unknown_commit,
                    &error,
                ) =>
            {
                self.lease.store.mark_moment_unknown(
                    &command.draft_id,
                    command.draft_revision,
                    command.session_generation,
                )?;
                Ok(PrivateMomentPublishResult {
                    state: "UNKNOWN_COMMIT".to_string(),
                    draft_id: command.draft_id,
                    post_id: None,
                    projection: None,
                })
            }
            Err(error) => {
                self.lease.store.mark_moment_terminal(
                    &command.draft_id,
                    command.draft_revision,
                    command.session_generation,
                )?;
                self.lease.store.delete_moment_draft(&command.content_id)?;
                for transfer_id in self
                    .lease
                    .store
                    .upload_transfer_ids_for_content(&command.content_id)?
                {
                    self.purge_abandoned_upload(&transfer_id)?;
                }
                Err(error.to_string())
            }
        }
    }

    fn sender_signing_key(
        &self,
        expected_post_id: &str,
        response: &social::GetMomentResourceResponse,
    ) -> Result<Option<VerifyingKey>, String> {
        let requirement = sender_key_requirement(expected_post_id, response)?;
        let signing_key_id = match requirement.signing_key_id.as_deref() {
            Some(signing_key_id) => signing_key_id,
            None => return Ok(None),
        };
        if let Some(key) = current_session_sender_signing_key(
            self.lease.session.as_ref(),
            &requirement.sender,
            signing_key_id,
        )? {
            return Ok(Some(key));
        }
        if let Some(key) = receiver_verified_sender_signing_key(
            response,
            &requirement.sender,
            signing_key_id,
            requirement.committed_at_unix_ms,
        )? {
            return Ok(Some(key));
        }
        let source_station_peer_id = response
            .explanation
            .as_ref()
            .and_then(|explanation| explanation.source.as_ref())
            .map(|source| source.station_peer_id.as_str())
            .unwrap_or_default();
        if !source_station_peer_id.is_empty()
            && source_station_peer_id != self.lease.session.key.station_peer_id
        {
            return Err("remote private Moment sender signing key is unavailable".to_string());
        }
        let profile = self
            .transport
            .get_actor_federation_profile(
                requirement
                    .sender
                    .actor
                    .as_ref()
                    .ok_or_else(|| "private Moment sender actor is unavailable".to_string())?,
            )
            .map_err(|error| error.to_string())?;
        verify_profile_actor_device_signing_key(
            &profile,
            &self.lease.session.trusted_station_signing_key,
            &profile.federated_handle,
            &self.lease.session.key.station_peer_id,
            &requirement.sender,
            signing_key_id,
            requirement.committed_at_unix_ms,
            now_unix_ms(),
        )
        .map(Some)
    }

    fn persist_read_failure(
        &self,
        post_id: &str,
        kind: PrivateProjectionFailureKind,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<PrivateMomentProjection, String> {
        let projection =
            private_read_projection(post_id, kind, "PRIVATE_CONTENT_VERIFICATION_FAILED", None);
        if kind == PrivateProjectionFailureKind::IntegrityFailure {
            self.purge_private_resource(post_id, revoke_media)?;
        }
        self.save_projection_if_current(post_id, &projection.encode_local()?)?;
        Ok(projection)
    }

    fn persist_decrypted_projection(
        &self,
        decrypted: &DecryptedPrivateMoment,
    ) -> Result<(), String> {
        let generation = decrypted
            .projection
            .generation
            .parse::<u64>()
            .map_err(|_| "private Moment projection generation is invalid".to_string())?;
        let projection_bytes = decrypted.projection.encode_local()?;
        self.supervisor.with_current(&self.lease.session.key, |_| {
            self.lease.store.commit_content_root(
                &decrypted.projection.content_id,
                generation,
                &decrypted.projection.post_id,
                decrypted.content_key.as_bytes(),
                decrypted.consumed_prekey.as_deref(),
                &projection_bytes,
            )
        })
    }

    fn save_projection_if_current(
        &self,
        post_id: &str,
        projection_bytes: &[u8],
    ) -> Result<(), String> {
        self.supervisor.with_current(&self.lease.session.key, |_| {
            self.lease.store.save_projection(post_id, projection_bytes)
        })
    }

    fn purge_private_resource(
        &self,
        post_id: &str,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
        self.supervisor.with_current(&self.lease.session.key, |_| {
            self.lease
                .store
                .mark_private_resource_purge_pending(post_id)
        })?;
        let transfers = self.lease.store.object_transfers_for_resource(post_id)?;
        let mut cleanup_error = None;
        for transfer in &transfers {
            if let Err(error) = self.purge_private_transfer_files(transfer, revoke_media) {
                cleanup_error.get_or_insert(error);
            }
        }
        if let Some(cleanup) = cleanup_error {
            return Err(format!("purge private Moment media: {cleanup}"));
        }
        self.lease
            .store
            .purge_private_resource_material(post_id)
            .map_err(|error| format!("purge local private Moment material: {error}"))
    }

    fn purge_private_media_download(
        &self,
        download: &StoredObjectTransfer,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
        self.purge_private_transfer_files(download, revoke_media)
            .map_err(|error| format!("purge private Moment media: {error}"))?;
        self.lease
            .store
            .purge_object_download(&download.record.transfer_id)
            .map_err(|error| format!("purge private Moment transfer: {error}"))
    }

    fn purge_private_transfer_files(
        &self,
        transfer: &StoredObjectTransfer,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
        if transfer.record.direction == ObjectTransferDirection::Upload {
            let source_path = Path::new(&transfer.record.source_local_ref);
            let file_name = format!(".{}.partial", transfer.record.operation_id);
            let expected_partial = source_path.with_file_name(file_name);
            if Path::new(&transfer.record.partial_local_ref) != expected_partial {
                return Err("private Moment upload checkpoint path is invalid".to_string());
            }
            return remove_file_if_exists(&expected_partial);
        }
        if transfer.record.direction != ObjectTransferDirection::Download {
            return Err("private Moment transfer direction is invalid".to_string());
        }
        let cache_path = PathBuf::from(&transfer.record.source_local_ref);
        let expected_file_name = secure_media_cache_path(
            &self.lease.session.key.actor_ptid,
            self.lease.session.key.session_generation,
            &transfer.record.operation_id,
            &transfer.media_type,
        )?
        .file_name()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "private Moment media cache path is invalid".to_string())?;
        let cache_root = secure_cache_root(&self.lease.session.key.actor_ptid)?.join("generations");
        if !cache_path.starts_with(&cache_root)
            || cache_path.file_name() != Some(expected_file_name.as_os_str())
        {
            return Err("private Moment media cache path is invalid".to_string());
        }
        let expected_partial = secure_ciphertext_checkpoint_path(
            &self.lease.session.key.actor_ptid,
            &transfer.record.operation_id,
            &transfer.media_type,
        )?;
        if Path::new(&transfer.record.partial_local_ref) != expected_partial {
            return Err("private Moment media checkpoint path is invalid".to_string());
        }
        let plaintext_staging =
            PathBuf::from(format!("{}.decrypting", cache_path.to_string_lossy()));
        let mut first_error = None;
        if let Err(error) = revoke_media(&cache_path) {
            first_error.get_or_insert(error);
        }
        for path in [&cache_path, &plaintext_staging, &expected_partial] {
            if let Err(error) = remove_file_if_exists(path) {
                first_error.get_or_insert(error);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn purge_abandoned_upload(&self, transfer_id: &str) -> Result<(), String> {
        if self
            .lease
            .store
            .object_transfer(transfer_id)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(());
        }
        let worker = new_object_worker(&self.lease)?;
        worker
            .cancel(transfer_id, now_unix_ms())
            .map_err(|error| format!("cancel abandoned private Moment upload: {error}"))?;
        self.lease
            .store
            .purge_upload_transfer(transfer_id)
            .map_err(|error| format!("purge abandoned private Moment upload journal: {error}"))
    }

    fn cleanup_published_upload_files(&self, content_id: &str) -> Result<(), String> {
        for transfer in self.lease.store.object_transfers_for_resource(content_id)? {
            if transfer.record.direction == ObjectTransferDirection::Upload {
                self.purge_private_transfer_files(&transfer, &|_| Ok(()))?;
            }
        }
        Ok(())
    }

    fn ensure_current(&self) -> Result<(), String> {
        if self.supervisor.is_current(&self.lease.session.key) {
            Ok(())
        } else {
            Err("secure content session generation is stale".to_string())
        }
    }
}

pub(super) fn receiver_verified_sender_signing_key(
    response: &social::GetMomentResourceResponse,
    expected_sender: &actor::ActorDeviceRef,
    expected_signing_key_id: &str,
    committed_at_unix_ms: i64,
) -> Result<Option<VerifyingKey>, String> {
    let key = match response
        .resource
        .as_ref()
        .and_then(|resource| resource.body.as_ref())
        .and_then(|body| match body {
            social::post_resource::Body::PrivateContent(private) => private.verification.as_ref(),
            _ => None,
        })
        .and_then(|verification| verification.receiver_verified_sender_signing_key.as_ref())
    {
        Some(key) => key,
        None => return Ok(None),
    };
    let expected_actor_ptid = expected_sender
        .actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .unwrap_or_default();
    let source_station_peer_id = response
        .explanation
        .as_ref()
        .and_then(|explanation| explanation.source.as_ref())
        .map(|source| source.station_peer_id.as_str())
        .unwrap_or_default();
    if expected_actor_ptid.is_empty()
        || expected_sender.device_id.is_empty()
        || expected_signing_key_id.is_empty()
        || source_station_peer_id.is_empty()
        || key.actor_ptid != expected_actor_ptid
        || key.actor_device_id != expected_sender.device_id
        || key.home_station_peer_id != source_station_peer_id
        || key.signing_key_id != expected_signing_key_id
        || key.ed25519_public_key.len() != 32
        || key.profile_version <= 0
        || key.valid_from_unix_ms <= 0
        || key.valid_from_unix_ms > committed_at_unix_ms
        || (key.revoked_at_unix_ms != 0
            && (key.revoked_at_unix_ms <= key.valid_from_unix_ms
                || committed_at_unix_ms >= key.revoked_at_unix_ms))
        || !matches!(
            actor::ActorSigningKeyVerificationSource::try_from(key.verification_source).ok(),
            Some(actor::ActorSigningKeyVerificationSource::VerifiedProfile)
                | Some(actor::ActorSigningKeyVerificationSource::VerifiedLocator)
        )
    {
        return Err("receiver-verified private Moment sender signing key is invalid".to_string());
    }
    VerifyingKey::from_bytes(key.ed25519_public_key.as_slice().try_into().map_err(|_| {
        "receiver-verified private Moment sender signing key is invalid".to_string()
    })?)
    .map(Some)
    .map_err(|_| "receiver-verified private Moment sender signing key is invalid".to_string())
}

fn private_moment_intent_hash(intent: &PrivateMomentPublishIntent) -> Result<[u8; 32], String> {
    let mut encoder = CanonicalMessageEncoder::new();
    encoder
        .singular_bytes(1, intent.actor_ptid.as_bytes())
        .map_err(|error| error.to_string())?;
    encoder
        .singular_bytes(2, intent.draft_id.as_bytes())
        .map_err(|error| error.to_string())?;
    encoder
        .singular_varint(3, intent.draft_revision)
        .map_err(|error| error.to_string())?;
    encoder
        .singular_bytes(4, intent.audience.kind.as_bytes())
        .map_err(|error| error.to_string())?;
    encoder
        .singular_bytes(5, intent.text.as_bytes())
        .map_err(|error| error.to_string())?;
    match private_audience(intent)?.target {
        Some(social::audience::Target::CircleId(circle_id)) => {
            encoder
                .singular_varint(7, circle_id)
                .map_err(|error| error.to_string())?;
        }
        Some(social::audience::Target::GroupConversationId(conversation_id)) => {
            encoder
                .singular_bytes(11, conversation_id.as_bytes())
                .map_err(|error| error.to_string())?;
        }
        None => {}
    }
    if let Some(base_kind) = intent.audience.base_kind.as_deref() {
        encoder
            .singular_bytes(8, base_kind.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    for actor_ptid in &intent.audience.actor_ptids {
        encoder
            .repeated_bytes(9, actor_ptid.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    encoder
        .singular_bytes(10, intent.moment_kind.as_bytes())
        .map_err(|error| error.to_string())?;
    for file in &intent.files {
        let mut file_encoder = CanonicalMessageEncoder::new();
        file_encoder
            .singular_bytes(1, file.intent_id.as_bytes())
            .map_err(|error| error.to_string())?;
        file_encoder
            .singular_bytes(2, file.file_path.as_bytes())
            .map_err(|error| error.to_string())?;
        let file_hash = FilesystemObjectBlob
            .sha256(&file.file_path)
            .map_err(|error| format!("hash private Moment media: {error}"))?;
        file_encoder
            .singular_bytes(3, &file_hash)
            .map_err(|error| error.to_string())?;
        encoder
            .repeated_bytes(6, &file_encoder.finish())
            .map_err(|error| error.to_string())?;
    }
    if let Some(link) = intent.link.as_ref() {
        encoder
            .singular_bytes(
                12,
                &serde_json::to_vec(link).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
    }
    if let Some(location) = intent.location.as_ref() {
        encoder
            .singular_bytes(
                13,
                &serde_json::to_vec(location).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
    }
    if let Some(poll) = intent.poll.as_ref() {
        encoder
            .singular_bytes(
                14,
                &serde_json::to_vec(poll).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
    }
    if let Some(repost) = intent.repost.as_ref() {
        encoder
            .singular_bytes(
                15,
                &serde_json::to_vec(repost).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
    }
    for mention in canonical_private_mentions(&intent.text, &intent.mentions, "private Moment")? {
        encoder
            .repeated_bytes(16, &mention.encode_to_vec())
            .map_err(|error| error.to_string())?;
    }
    Ok(Sha256::digest(encoder.finish()).into())
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "remove private Moment media artifact {}: {error}",
            path.display()
        )),
    }
}

fn apply_ready_media(
    media: &mut super::projection::PrivateMomentMediaProjection,
    cache_path: &Path,
    plaintext_sha256: &[u8; 32],
    plaintext_size: u64,
) {
    media.state = PrivateMediaState::MediaReady;
    media.local_path = Some(cache_path.display().to_string());
    media.render_url = None;
    media.plaintext_sha256 = Some(hex::encode(plaintext_sha256));
    media.plaintext_size = Some(plaintext_size);
    media.error_code = None;
    media.retryable = false;
}

fn apply_terminal_media_failure(
    media: &mut super::projection::PrivateMomentMediaProjection,
    code: ObjectTransferErrorCode,
) {
    media.local_path = None;
    media.render_url = None;
    media.plaintext_sha256 = None;
    media.plaintext_size = None;
    media.error_code = Some(code.as_str().to_string());
    media.retryable = false;
    media.state = if code == ObjectTransferErrorCode::NotGranted {
        PrivateMediaState::MediaAccessDenied
    } else {
        PrivateMediaState::MediaIntegrityFailure
    };
}

fn scrub_persisted_media_projection(
    mut projection: PrivateMomentProjection,
) -> PrivateMomentProjection {
    match projection.content.as_mut() {
        Some(PrivateMomentContentProjection::Image { media, .. })
        | Some(PrivateMomentContentProjection::Video { media, .. }) => {
            for item in media {
                item.local_path = None;
                item.render_url = None;
                item.plaintext_sha256 = None;
                item.plaintext_size = None;
                if item.state == PrivateMediaState::MediaReady {
                    item.state = PrivateMediaState::MediaPlaceholder;
                }
                item.retryable = false;
            }
        }
        _ => {}
    }
    projection
}

fn apply_media_failure(
    media: &mut super::projection::PrivateMomentMediaProjection,
    failure: &ObjectTransferFailure,
) {
    if failure.retryable {
        media.state = PrivateMediaState::MediaOfflineRetryable;
        media.plaintext_sha256 = None;
        media.plaintext_size = None;
        media.error_code = Some("MEDIA_OFFLINE_RETRYABLE".to_string());
        media.retryable = true;
    } else {
        apply_terminal_media_failure(media, failure.code);
    }
}

fn private_transport_failure_projection(
    post_id: &str,
    error: &crate::secure_content::adapter::NativeTransportError,
) -> PrivateMomentProjection {
    let state = match error.http_status {
        Some(401) => super::projection::PrivateReadState::AuthenticationRequired,
        Some(403 | 404) => super::projection::PrivateReadState::NotFoundOrNotAuthorized,
        Some(410) => super::projection::PrivateReadState::DeletedOrRevoked,
        _ => super::projection::PrivateReadState::IntegrityFailure,
    };
    PrivateMomentProjection {
        post_id: post_id.to_string(),
        content_id: format!("unavailable:{post_id}"),
        generation: "0".to_string(),
        author_ptid: String::new(),
        audience_kind: "UNKNOWN".to_string(),
        state,
        mentions: Vec::new(),
        content: None,
        error_code: Some(error.message.clone()),
        retry_after_seconds: error.retry_after_seconds,
        created_at_millis: None,
        updated_at_millis: None,
    }
}

fn attach_recovery_envelope(
    response: &mut social::GetMomentResourceResponse,
    envelope: &wire::ViewerContentKeyEnvelope,
) -> Result<(), String> {
    let private = response
        .resource
        .as_mut()
        .and_then(|resource| match resource.body.as_mut() {
            Some(social::post_resource::Body::PrivateContent(private)) => Some(private),
            _ => None,
        })
        .ok_or_else(|| "private Moment recovery point response is not private".to_string())?;
    private.viewer_envelope = Some(envelope.clone());
    Ok(())
}

fn requires_private_resource_purge(
    error: &crate::secure_content::adapter::NativeTransportError,
) -> bool {
    error.http_status == Some(404)
        && error.stable_code == crate::model::error::ErrorCode::PostNotFound as i32
}

fn recovery_transport_failure(
    error: &crate::secure_content::adapter::NativeTransportError,
) -> (PrivateRecoveryFailureKind, bool) {
    if requires_private_resource_purge(error) {
        (PrivateRecoveryFailureKind::NotAuthorized, true)
    } else if error.http_status == Some(401) {
        (PrivateRecoveryFailureKind::AuthenticationRequired, false)
    } else {
        (PrivateRecoveryFailureKind::Retryable, false)
    }
}

fn classify_missing_recovery_target(
    point: Result<
        social::GetMomentResourceResponse,
        crate::secure_content::adapter::NativeTransportError,
    >,
) -> PrivateRecoveryAttemptError {
    match point {
        Ok(_) => PrivateRecoveryAttemptError::KeyUnavailable(
            "private Moment recovery envelope is unavailable".to_string(),
        ),
        Err(error) => PrivateRecoveryAttemptError::Transport(error),
    }
}

fn classify_recovery_attempt(
    attempt: PrivateRecoveryAttemptError,
) -> (PrivateRecoveryFailureKind, String, bool) {
    match attempt {
        PrivateRecoveryAttemptError::Transport(error) => {
            let (kind, purge) = recovery_transport_failure(&error);
            (kind, error.to_string(), purge)
        }
        PrivateRecoveryAttemptError::KeyUnavailable(message) => {
            (PrivateRecoveryFailureKind::KeyUnavailable, message, false)
        }
        PrivateRecoveryAttemptError::Integrity(message) => {
            (PrivateRecoveryFailureKind::IntegrityFailure, message, true)
        }
    }
}

fn preserves_unknown_moment_after_auth_rejection(
    reconciles_unknown_commit: bool,
    error: &crate::secure_content::adapter::NativeTransportError,
) -> bool {
    reconciles_unknown_commit
        && error.disposition == NativeErrorDisposition::Terminal
        && matches!(error.http_status, Some(401 | 403))
}

fn private_read_projection(
    post_id: &str,
    kind: PrivateProjectionFailureKind,
    error_code: &str,
    retry_after_seconds: Option<u64>,
) -> PrivateMomentProjection {
    PrivateMomentProjection {
        post_id: post_id.to_string(),
        content_id: format!("unavailable:{post_id}"),
        generation: "0".to_string(),
        author_ptid: String::new(),
        audience_kind: "UNKNOWN".to_string(),
        state: match kind {
            PrivateProjectionFailureKind::RecoveryRequired => {
                super::projection::PrivateReadState::RecoveryRequired
            }
            PrivateProjectionFailureKind::IntegrityFailure => {
                super::projection::PrivateReadState::IntegrityFailure
            }
        },
        mentions: Vec::new(),
        content: None,
        error_code: Some(error_code.to_string()),
        retry_after_seconds,
        created_at_millis: None,
        updated_at_millis: None,
    }
}

pub(super) fn pending_device_recovery_projection(post_id: &str) -> PrivateMomentProjection {
    private_read_projection(
        post_id,
        PrivateProjectionFailureKind::RecoveryRequired,
        "RECOVERY_REQUIRED",
        None,
    )
}

fn private_revoked_projection(post_id: &str, error_code: &str) -> PrivateMomentProjection {
    let mut projection = private_read_projection(
        post_id,
        PrivateProjectionFailureKind::IntegrityFailure,
        error_code,
        None,
    );
    projection.state = super::projection::PrivateReadState::DeletedOrRevoked;
    projection
}

fn validate_publish_intent(intent: &PrivateMomentPublishIntent) -> Result<(), String> {
    if intent.actor_ptid.trim().is_empty()
        || intent.renderer_generation == 0
        || intent.draft_id.trim().is_empty()
        || intent.draft_revision == 0
        || !matches!(
            intent.audience.kind.as_str(),
            "FRIENDS" | "FOLLOWERS" | "CIRCLE" | "GROUP" | "SELF" | "CUSTOM_ALLOW" | "CUSTOM_DENY"
        )
        || intent.text.trim().is_empty()
        || intent.files.len() > 10
    {
        return Err("private Moment publish intent is invalid".to_string());
    }
    canonical_private_mentions(&intent.text, &intent.mentions, "private Moment")?;
    private_audience(intent)?;
    let kind = resolve_moment_kind(&intent.moment_kind)?;
    match kind {
        social::PrivateMomentKind::Text
            if !intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some() =>
        {
            return Err("private text Moment contains subtype fields".to_string());
        }
        social::PrivateMomentKind::Image
            if intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some() =>
        {
            return Err("private image Moment requires a file".to_string());
        }
        social::PrivateMomentKind::Video
            if intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some() =>
        {
            return Err("private video Moment requires media files".to_string());
        }
        social::PrivateMomentKind::Link
            if !intent.files.is_empty()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some()
                || intent.link.as_ref().is_none_or(|link| {
                    link.url.trim() != link.url
                        || !(link.url.starts_with("https://") || link.url.starts_with("http://"))
                        || link.title.trim().is_empty()
                }) =>
        {
            return Err("private link Moment metadata is invalid".to_string());
        }
        social::PrivateMomentKind::Location
            if !intent.files.is_empty()
                || intent.link.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some()
                || intent.location.as_ref().is_none_or(|location| {
                    location.name.trim().is_empty()
                        || !location.latitude.is_finite()
                        || !location.longitude.is_finite()
                        || !(-90.0..=90.0).contains(&location.latitude)
                        || !(-180.0..=180.0).contains(&location.longitude)
                }) =>
        {
            return Err("private location Moment metadata is invalid".to_string());
        }
        social::PrivateMomentKind::Poll
            if !intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.repost.is_some()
                || intent.poll.as_ref().is_none_or(|poll| {
                    poll.question.trim().is_empty()
                        || poll.question.trim() != poll.question
                        || !(2..=20).contains(&poll.options.len())
                        || poll
                            .options
                            .iter()
                            .any(|option| option.trim().is_empty() || option.trim() != option)
                        || poll.min_choices < 1
                        || poll.min_choices > poll.max_choices
                        || poll.max_choices > poll.options.len() as u32
                        || poll.expires_at_seconds <= super::projection::current_unix_seconds()
                }) =>
        {
            return Err("private poll Moment metadata is invalid".to_string());
        }
        social::PrivateMomentKind::Repost
            if !intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.as_ref().is_none_or(|repost| {
                    repost.source_post_id.trim().is_empty()
                        || repost.source_post_id.trim() != repost.source_post_id
                        || repost.source_post_id.len() > 128
                        || repost.source_post_id.as_bytes().contains(&0)
                }) =>
        {
            return Err("private repost Moment source is invalid".to_string());
        }
        social::PrivateMomentKind::Text
        | social::PrivateMomentKind::Image
        | social::PrivateMomentKind::Video
        | social::PrivateMomentKind::Link
        | social::PrivateMomentKind::Poll
        | social::PrivateMomentKind::Repost
        | social::PrivateMomentKind::Location => {}
        social::PrivateMomentKind::Unspecified => {
            return Err("private Moment subtype is invalid".to_string());
        }
    }
    Ok(())
}

fn validate_plan(
    plan: &wire::ContentEncryptionPlan,
    lease: &SecureContentLease,
    content_id: &str,
    kind: social::PrivateMomentKind,
    object_count: usize,
    subtype_prepare_authority_sha256: &[u8],
) -> Result<(), String> {
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: 1,
        kind: kind as i32,
        subtype_prepare_authority_sha256: subtype_prepare_authority_sha256.to_vec(),
    }
    .encode_to_vec();
    validate_content_plan(
        plan,
        lease,
        content_id,
        object_count,
        &domain_binding,
        "private Moment",
    )
}

fn private_payload(
    intent: &PrivateMomentPublishIntent,
    kind: social::PrivateMomentKind,
    images: Vec<social::PrivateAttachmentMetadata>,
    poll_material: Option<&PrivateMomentPollMaterial>,
    repost_material: Option<&PrivateRepostSourceMaterial>,
    mentions: &[social::Mention],
    mention_commitment_salt: Option<&[u8; 32]>,
    repost_commitment_salt: Option<&[u8; 32]>,
) -> Result<social::PrivateMomentContent, PrivatePublishFailure> {
    let body = match kind {
        social::PrivateMomentKind::Text => {
            social::private_moment_content::Body::Text(social::PrivateTextContent {
                text: intent.text.clone(),
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Image => {
            social::private_moment_content::Body::Image(social::PrivateImageContent {
                text: intent.text.clone(),
                images,
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Video => {
            social::private_moment_content::Body::Video(social::PrivateVideoContent {
                text: intent.text.clone(),
                source: images.first().cloned(),
                poster: images.get(1).cloned(),
                variants: images
                    .iter()
                    .skip(2)
                    .enumerate()
                    .map(|(index, media)| social::PrivateVideoVariant {
                        variant_id: format!("variant-{}", index + 1),
                        bitrate: 0,
                        codec: String::new(),
                        width: media.width,
                        height: media.height,
                        media: Some(media.clone()),
                    })
                    .collect(),
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Link => {
            let link = intent.link.as_ref().ok_or_else(|| {
                PrivatePublishFailure::cleanup("private link Moment metadata is unavailable")
            })?;
            social::private_moment_content::Body::Link(social::PrivateLinkContent {
                text: intent.text.clone(),
                link: Some(social::LinkPreview {
                    url: link.url.clone(),
                    title: link.title.clone(),
                    description: link.description.clone(),
                    image_url: link.image_url.clone(),
                    site_name: link.site_name.clone(),
                    favicon_url: link.favicon_url.clone(),
                }),
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Poll => {
            let poll_intent = intent.poll.as_ref().ok_or_else(|| {
                PrivatePublishFailure::cleanup("private poll Moment metadata is unavailable")
            })?;
            let poll = poll_material.ok_or_else(|| {
                PrivatePublishFailure::cleanup("private poll Moment authority is unavailable")
            })?;
            social::private_moment_content::Body::Poll(social::PrivatePollContent {
                text: intent.text.clone(),
                question: poll_intent.question.clone(),
                options: poll.options.clone(),
                option_set_sha256: poll.authority.option_set_sha256.clone(),
                min_choices: poll.authority.min_choices,
                max_choices: poll.authority.max_choices,
                expires_at: poll.authority.expires_at.clone(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Repost => {
            let repost = repost_material.ok_or_else(|| {
                PrivatePublishFailure::cleanup("private repost source material is unavailable")
            })?;
            let commitment_salt = repost_commitment_salt.ok_or_else(|| {
                PrivatePublishFailure::cleanup("private repost commitment salt is unavailable")
            })?;
            social::private_moment_content::Body::Repost(social::PrivateRepostContent {
                comment: intent.text.clone(),
                original_source: repost.authority.source.clone(),
                rendered_source: Some(repost.rendered_source.clone()),
                mentions: mentions.to_vec(),
                rendered_source_commitment_salt: commitment_salt.to_vec(),
            })
        }
        social::PrivateMomentKind::Location => {
            let location = intent.location.as_ref().ok_or_else(|| {
                PrivatePublishFailure::cleanup("private location Moment metadata is unavailable")
            })?;
            social::private_moment_content::Body::Location(social::PrivateLocationContent {
                text: intent.text.clone(),
                location: Some(social::Location {
                    name: location.name.clone(),
                    latitude: location.latitude,
                    longitude: location.longitude,
                    address: location.address.clone(),
                    place_id: location.place_id.clone(),
                }),
                images,
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Unspecified => {
            return Err(PrivatePublishFailure::cleanup(
                "private Moment subtype is invalid",
            ))
        }
    };
    Ok(social::PrivateMomentContent {
        format_version: 1,
        body: Some(body),
        mention_commitment_salt: mention_commitment_salt
            .map(|salt| salt.to_vec())
            .unwrap_or_default(),
    })
}

fn private_poll_material(
    intent: &PrivateMomentPublishIntent,
    content_id: &str,
    kind: social::PrivateMomentKind,
) -> Result<Option<PrivateMomentPollMaterial>, String> {
    if kind != social::PrivateMomentKind::Poll {
        return Ok(None);
    }
    let poll = intent
        .poll
        .as_ref()
        .ok_or_else(|| "private poll Moment metadata is unavailable".to_string())?;
    let options = poll
        .options
        .iter()
        .enumerate()
        .map(|(index, label)| {
            let mut encoder = CanonicalMessageEncoder::new();
            encoder
                .singular_bytes(1, b"peers-touch:secure-content:poll-option:v1")
                .map_err(|error| error.to_string())?;
            encoder
                .singular_bytes(2, content_id.as_bytes())
                .map_err(|error| error.to_string())?;
            encoder
                .singular_varint(3, (index + 1) as u64)
                .map_err(|error| error.to_string())?;
            Ok(social::PrivatePollOption {
                opaque_option_id: Sha256::digest(encoder.finish()).to_vec(),
                label: label.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut opaque_option_ids = options
        .iter()
        .map(|option| option.opaque_option_id.clone())
        .collect::<Vec<_>>();
    opaque_option_ids.sort();
    let option_set_sha256 = private_poll_option_set_hash(&opaque_option_ids)?.to_vec();
    Ok(Some(PrivateMomentPollMaterial {
        authority: social::PrivatePollAuthority {
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: content_id.to_string(),
                generation: 1,
            }),
            opaque_option_ids,
            option_set_sha256,
            min_choices: poll.min_choices,
            max_choices: poll.max_choices,
            expires_at: Some(prost_types::Timestamp {
                seconds: poll.expires_at_seconds,
                nanos: 0,
            }),
        },
        options,
    }))
}

fn resolve_moment_kind(kind_str: &str) -> Result<social::PrivateMomentKind, String> {
    match kind_str {
        "IMAGE" => Ok(social::PrivateMomentKind::Image),
        "VIDEO" => Ok(social::PrivateMomentKind::Video),
        "LINK" => Ok(social::PrivateMomentKind::Link),
        "POLL" => Ok(social::PrivateMomentKind::Poll),
        "REPOST" => Ok(social::PrivateMomentKind::Repost),
        "LOCATION" => Ok(social::PrivateMomentKind::Location),
        "TEXT" => Ok(social::PrivateMomentKind::Text),
        _ => Err("private Moment subtype is not source-complete".to_string()),
    }
}

fn private_audience(intent: &PrivateMomentPublishIntent) -> Result<social::Audience, String> {
    let audience = &intent.audience;
    let mut actor_ptids = audience.actor_ptids.clone();
    actor_ptids.sort();
    if actor_ptids
        .iter()
        .any(|ptid| ptid.is_empty() || ptid.trim() != ptid || ptid == &intent.actor_ptid)
        || actor_ptids.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err("private Moment audience actor list is invalid".to_string());
    }
    let kind = match audience.kind.as_str() {
        "FRIENDS" => social::audience::Kind::Friends,
        "FOLLOWERS" => social::audience::Kind::Followers,
        "CIRCLE" => social::audience::Kind::Circle,
        "GROUP" => social::audience::Kind::Group,
        "SELF" => social::audience::Kind::Self_,
        "CUSTOM_ALLOW" => social::audience::Kind::CustomAllow,
        "CUSTOM_DENY" => social::audience::Kind::CustomDeny,
        _ => return Err("private Moment audience is invalid".to_string()),
    };
    let target = match kind {
        social::audience::Kind::Circle if audience.group_conversation_id.is_none() => {
            let raw = audience
                .circle_id
                .as_deref()
                .ok_or_else(|| "private Moment circle audience is invalid".to_string())?;
            let circle_id = raw
                .parse::<u64>()
                .map_err(|_| "private Moment circle audience is invalid".to_string())?;
            if circle_id == 0 || circle_id.to_string() != raw {
                return Err("private Moment circle audience is invalid".to_string());
            }
            Some(social::audience::Target::CircleId(circle_id))
        }
        social::audience::Kind::Group if audience.circle_id.is_none() => {
            let conversation_id = audience
                .group_conversation_id
                .as_deref()
                .ok_or_else(|| "private Moment Group audience is invalid".to_string())?;
            if conversation_id.is_empty()
                || conversation_id.trim() != conversation_id
                || conversation_id.as_bytes().contains(&0)
            {
                return Err("private Moment Group audience is invalid".to_string());
            }
            Some(social::audience::Target::GroupConversationId(
                conversation_id.to_string(),
            ))
        }
        social::audience::Kind::Circle | social::audience::Kind::Group => {
            return Err("private Moment audience fields are inconsistent".to_string())
        }
        _ if audience.circle_id.is_none() && audience.group_conversation_id.is_none() => None,
        _ => return Err("private Moment audience fields are inconsistent".to_string()),
    };
    let has_actor_list = !actor_ptids.is_empty();
    let requires_actor_list = matches!(
        kind,
        social::audience::Kind::CustomAllow | social::audience::Kind::CustomDeny
    );
    if has_actor_list != requires_actor_list {
        return Err("private Moment audience fields are inconsistent".to_string());
    }
    let base_kind = match (kind, audience.base_kind.as_deref()) {
        (social::audience::Kind::CustomDeny, Some("PUBLIC")) => {
            social::audience::Kind::Public as i32
        }
        (social::audience::Kind::CustomDeny, Some("FOLLOWERS")) => {
            social::audience::Kind::Followers as i32
        }
        (social::audience::Kind::CustomDeny, _) => {
            return Err("private Moment custom deny base is invalid".to_string());
        }
        _ if audience.base_kind.is_none() => social::audience::Kind::Unspecified as i32,
        _ => return Err("private Moment audience fields are inconsistent".to_string()),
    };
    Ok(social::Audience {
        kind: kind as i32,
        actor_ptids,
        base_kind,
        target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_content::station_trust::TrustedStationSigningKey;
    use crate::secure_content::{SecureContentSession, SecureContentSessionKey};
    use ed25519_dalek::{Signer, SigningKey};
    use secure_content_core::object::ObjectTransferControl;
    use std::sync::Arc;

    fn lease(station_key: &SigningKey) -> SecureContentLease {
        SecureContentLease {
            session: Arc::new(SecureContentSession::new(
                SecureContentSessionKey {
                    station_peer_id: "station-1".to_string(),
                    actor_ptid: "ptid:alice".to_string(),
                    device_id: "device-1".to_string(),
                    jwt_session_id: "session-1".to_string(),
                    window_label: "main".to_string(),
                    session_generation: 1,
                },
                "account-1".to_string(),
                "https://station.test".to_string(),
                "token".to_string(),
                "device-key-1".to_string(),
                1,
                SigningKey::from_bytes(&[7; 32]),
                TrustedStationSigningKey {
                    key_id: "station-key-current".to_string(),
                    verifying_key: station_key.verifying_key(),
                },
            )),
            store: Arc::new(crate::secure_content::store::SecureContentStore::in_memory().unwrap()),
            transfer_control: Arc::new(ObjectTransferControl::new()),
            renderer_generation: 1,
        }
    }

    fn publish_intent(draft_id: &str, draft_revision: u64) -> PrivateMomentPublishIntent {
        PrivateMomentPublishIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: draft_id.to_string(),
            draft_revision,
            audience: PrivateMomentAudienceIntent {
                kind: "FRIENDS".to_string(),
                circle_id: None,
                group_conversation_id: None,
                actor_ptids: Vec::new(),
                base_kind: None,
            },
            moment_kind: "TEXT".to_string(),
            text: "private".to_string(),
            mentions: Vec::new(),
            files: Vec::new(),
            link: None,
            location: None,
            poll: None,
            repost: None,
            admission_only: false,
        }
    }

    fn signed_plan(station_key: &SigningKey) -> wire::ContentEncryptionPlan {
        let mut plan = wire::ContentEncryptionPlan {
            format_version: 1,
            plan_id: "plan-1".to_string(),
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: "content-1".to_string(),
                generation: 1,
            }),
            author: Some(crate::model::actor::ActorDeviceRef {
                actor: Some(crate::model::actor::ActorRef {
                    ptid: "ptid:alice".to_string(),
                    ..Default::default()
                }),
                device_id: "device-1".to_string(),
            }),
            authorization_snapshot_sha256: vec![1; 32],
            required_slots: vec![wire::RequiredContentRecipientSlot {
                recipient_slot_id: "slot-1".to_string(),
                ..Default::default()
            }],
            object_ids: Vec::new(),
            expires_at: Some(prost_types::Timestamp {
                seconds: now_unix_ms() / 1_000 + 240,
                nanos: 0,
            }),
            canonical_plan_sha256: Vec::new(),
            station_signing_key_id: "station-key-current".to_string(),
            station_signature: Vec::new(),
            domain_binding_sha256: Sha256::digest(
                social::PrivateMomentDomainBinding {
                    format_version: 1,
                    kind: social::PrivateMomentKind::Text as i32,
                    subtype_prepare_authority_sha256: Vec::new(),
                }
                .encode_to_vec(),
            )
            .to_vec(),
        };
        let mut hash_input = plan.clone();
        hash_input.canonical_plan_sha256.clear();
        hash_input.station_signature.clear();
        plan.canonical_plan_sha256 = Sha256::digest(hash_input.encode_to_vec()).to_vec();
        let mut signing_input = plan.clone();
        signing_input.station_signature.clear();
        plan.station_signature = station_key
            .sign(&signing_input.encode_to_vec())
            .to_bytes()
            .to_vec();
        plan
    }

    #[test]
    fn remote_sender_key_uses_receiver_verified_historical_projection() {
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let committed_at_unix_ms = 1_900_000_000_000;
        let sender = actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: "ptid:alice".to_string(),
                kind: actor::ActorKind::Person as i32,
                ..Default::default()
            }),
            device_id: "alice-device".to_string(),
        };
        let mut response = social::GetMomentResourceResponse {
            explanation: Some(social::FeedObjectExplanation {
                source: Some(social::ActivitySource {
                    kind: social::activity_source::Kind::ActivitySourceRemote as i32,
                    station_peer_id: "station-a".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            resource: Some(social::PostResource {
                body: Some(social::post_resource::Body::PrivateContent(
                    social::PrivateContentAccess {
                        verification: Some(social::PrivateContentVerification {
                            receiver_verified_sender_signing_key: Some(
                                actor::VerifiedActorDeviceSigningKey {
                                    actor_ptid: "ptid:alice".to_string(),
                                    actor_device_id: "alice-device".to_string(),
                                    home_station_peer_id: "station-a".to_string(),
                                    signing_key_id: "alice-signing-key".to_string(),
                                    ed25519_public_key: sender_key
                                        .verifying_key()
                                        .to_bytes()
                                        .to_vec(),
                                    profile_version: 7,
                                    verification_source:
                                        actor::ActorSigningKeyVerificationSource::VerifiedProfile
                                            as i32,
                                    valid_from_unix_ms: committed_at_unix_ms - 60_000,
                                    revoked_at_unix_ms: committed_at_unix_ms + 1,
                                },
                            ),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                )),
                ..Default::default()
            }),
            ..Default::default()
        };

        let resolved = receiver_verified_sender_signing_key(
            &response,
            &sender,
            "alice-signing-key",
            committed_at_unix_ms,
        )
        .unwrap()
        .unwrap();
        assert_eq!(resolved, sender_key.verifying_key());

        response
            .resource
            .as_mut()
            .and_then(|resource| resource.body.as_mut())
            .and_then(|body| match body {
                social::post_resource::Body::PrivateContent(private) => {
                    private.verification.as_mut()
                }
                _ => None,
            })
            .and_then(|verification| verification.receiver_verified_sender_signing_key.as_mut())
            .unwrap()
            .revoked_at_unix_ms = committed_at_unix_ms;
        assert!(receiver_verified_sender_signing_key(
            &response,
            &sender,
            "alice-signing-key",
            committed_at_unix_ms,
        )
        .is_err());
    }

    #[test]
    fn secure_content_private_publish_intent_validates_audience_kinds() {
        let valid = PrivateMomentPublishIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: "draft-1".to_string(),
            draft_revision: 1,
            audience: PrivateMomentAudienceIntent {
                kind: "FRIENDS".to_string(),
                circle_id: None,
                group_conversation_id: None,
                actor_ptids: Vec::new(),
                base_kind: None,
            },
            moment_kind: "TEXT".to_string(),
            text: "private".to_string(),
            mentions: Vec::new(),
            files: Vec::new(),
            link: None,
            location: None,
            poll: None,
            repost: None,
            admission_only: false,
        };
        assert!(validate_publish_intent(&valid).is_ok());
        for kind in &["FOLLOWERS", "SELF"] {
            let mut variant = valid.clone();
            variant.audience.kind = kind.to_string();
            assert!(validate_publish_intent(&variant).is_ok());
        }
        let mut circle = valid.clone();
        circle.audience.kind = "CIRCLE".to_string();
        circle.audience.circle_id = Some("42".to_string());
        assert_eq!(
            private_audience(&circle).unwrap().target,
            Some(social::audience::Target::CircleId(42))
        );
        let mut group = valid.clone();
        group.audience.kind = "GROUP".to_string();
        group.audience.group_conversation_id = Some("01J9Z7Y6M5N4P3Q2R1S0TUVWXY".to_string());
        assert_eq!(
            private_audience(&group).unwrap().target,
            Some(social::audience::Target::GroupConversationId(
                "01J9Z7Y6M5N4P3Q2R1S0TUVWXY".to_string()
            ))
        );
        let mut mismatched_target = circle;
        mismatched_target.audience.group_conversation_id =
            Some("01J9Z7Y6M5N4P3Q2R1S0TUVWXY".to_string());
        assert!(validate_publish_intent(&mismatched_target).is_err());
        let mut custom_allow = valid.clone();
        custom_allow.audience.kind = "CUSTOM_ALLOW".to_string();
        custom_allow.audience.actor_ptids = vec!["ptid:bob".to_string()];
        assert!(validate_publish_intent(&custom_allow).is_ok());
        let mut custom_deny = custom_allow;
        custom_deny.audience.kind = "CUSTOM_DENY".to_string();
        custom_deny.audience.base_kind = Some("FOLLOWERS".to_string());
        assert!(validate_publish_intent(&custom_deny).is_ok());
        custom_deny.audience.base_kind = Some("PUBLIC".to_string());
        assert!(validate_publish_intent(&custom_deny).is_ok());
        let mut repost = valid.clone();
        repost.moment_kind = "REPOST".to_string();
        repost.repost = Some(PrivateMomentRepostIntent {
            source_post_id: "source-post".to_string(),
        });
        assert!(validate_publish_intent(&repost).is_ok());
        repost.repost.as_mut().unwrap().source_post_id = " source-post".to_string();
        assert!(validate_publish_intent(&repost).is_err());
        let mut invalid = valid.clone();
        invalid.audience.kind = "PUBLIC".to_string();
        assert!(validate_publish_intent(&invalid).is_err());
        let mut invalid_subtype = valid;
        invalid_subtype.moment_kind = "BOGUS".to_string();
        assert!(validate_publish_intent(&invalid_subtype).is_err());
    }

    #[test]
    fn secure_content_private_publish_intent_rejects_unknown_audience_fields() {
        let current = serde_json::from_value::<PrivateMomentPublishIntent>(serde_json::json!({
            "actor_ptid": "ptid:alice",
            "renderer_generation": 1,
            "draft_id": "draft-1",
            "draft_revision": 1,
            "audience": {
                "kind": "GROUP",
                "groupConversationId": "01J9Z7Y6M5N4P3Q2R1S0TUVWXY"
            },
            "moment_kind": "TEXT",
            "text": "private",
            "files": []
        }))
        .unwrap();
        assert!(validate_publish_intent(&current).is_ok());

        let legacy = serde_json::from_value::<PrivateMomentPublishIntent>(serde_json::json!({
            "actor_ptid": "ptid:alice",
            "renderer_generation": 1,
            "draft_id": "draft-1",
            "draft_revision": 1,
            "audience": {
                "kind": "CIRCLE",
                "circleId": "42"
            },
            "unexpected_audience_field": "42",
            "moment_kind": "TEXT",
            "text": "private",
            "files": []
        }));
        assert!(legacy.is_err());
    }

    #[test]
    fn secure_content_private_poll_binds_opaque_options_to_authority_and_payload() {
        let mut intent = publish_intent("draft-poll", 1);
        intent.moment_kind = "POLL".to_string();
        intent.poll = Some(PrivateMomentPollIntent {
            question: "Choose one".to_string(),
            options: vec!["First".to_string(), "Second".to_string()],
            min_choices: 1,
            max_choices: 1,
            expires_at_seconds: 4_000_000_000,
        });

        assert!(validate_publish_intent(&intent).is_ok());
        let first = private_poll_material(&intent, "content-poll", social::PrivateMomentKind::Poll)
            .unwrap()
            .unwrap();
        let second =
            private_poll_material(&intent, "content-poll", social::PrivateMomentKind::Poll)
                .unwrap()
                .unwrap();
        assert_eq!(first.authority, second.authority);
        assert_eq!(first.options, second.options);
        assert!(first
            .authority
            .opaque_option_ids
            .windows(2)
            .all(|pair| pair[0] < pair[1]));
        assert_eq!(
            first.authority.option_set_sha256,
            private_poll_option_set_hash(&first.authority.opaque_option_ids)
                .unwrap()
                .to_vec()
        );

        let payload = private_payload(
            &intent,
            social::PrivateMomentKind::Poll,
            Vec::new(),
            Some(&first),
            None,
            &[],
            None,
            None,
        )
        .unwrap();
        let social::private_moment_content::Body::Poll(poll) = payload.body.unwrap() else {
            panic!("poll intent must produce a poll payload");
        };
        assert_eq!(poll.question, "Choose one");
        assert_eq!(
            poll.options
                .iter()
                .map(|option| option.label.as_str())
                .collect::<Vec<_>>(),
            vec!["First", "Second"]
        );
        assert_eq!(poll.option_set_sha256, first.authority.option_set_sha256);
        assert_eq!(poll.expires_at, first.authority.expires_at);
    }

    #[test]
    fn secure_content_private_poll_rejects_invalid_bounds_before_prepare() {
        let mut intent = publish_intent("draft-poll-bounds", 1);
        intent.moment_kind = "POLL".to_string();
        intent.poll = Some(PrivateMomentPollIntent {
            question: "Choose one".to_string(),
            options: vec!["Only".to_string()],
            min_choices: 1,
            max_choices: 1,
            expires_at_seconds: 4_000_000_000,
        });
        assert!(validate_publish_intent(&intent).is_err());

        intent
            .poll
            .as_mut()
            .unwrap()
            .options
            .push("Second".to_string());
        intent.poll.as_mut().unwrap().min_choices = 2;
        intent.poll.as_mut().unwrap().max_choices = 1;
        assert!(validate_publish_intent(&intent).is_err());

        intent.poll.as_mut().unwrap().min_choices = 1;
        intent.poll.as_mut().unwrap().expires_at_seconds = 1;
        assert!(validate_publish_intent(&intent).is_err());
    }

    #[test]
    fn secure_content_private_draft_hash_is_stable_until_content_changes() {
        let intent = PrivateMomentPublishIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: "draft-1".to_string(),
            draft_revision: 3,
            audience: PrivateMomentAudienceIntent {
                kind: "FRIENDS".to_string(),
                circle_id: None,
                group_conversation_id: None,
                actor_ptids: Vec::new(),
                base_kind: None,
            },
            moment_kind: "TEXT".to_string(),
            text: "private".to_string(),
            mentions: Vec::new(),
            files: Vec::new(),
            link: None,
            location: None,
            poll: None,
            repost: None,
            admission_only: false,
        };
        assert_eq!(
            private_moment_intent_hash(&intent).unwrap(),
            private_moment_intent_hash(&intent).unwrap()
        );
        let mut admission = intent.clone();
        admission.admission_only = true;
        assert_eq!(
            private_moment_intent_hash(&intent).unwrap(),
            private_moment_intent_hash(&admission).unwrap(),
            "admission and publish must reuse one durable draft identity"
        );

        let mut changed = intent;
        changed.text = "changed".to_string();
        assert_ne!(
            private_moment_intent_hash(&changed).unwrap(),
            private_moment_intent_hash(&PrivateMomentPublishIntent {
                text: "private".to_string(),
                ..changed.clone()
            })
            .unwrap()
        );
    }

    #[test]
    fn remote_prekey_unavailable_preserves_the_admission_draft() {
        let failure = PrivatePublishFailure::from_prepare_transport(
            crate::secure_content::adapter::NativeTransportError {
                http_status: Some(409),
                stable_code: 30206,
                retry_after_seconds: None,
                disposition: NativeErrorDisposition::Terminal,
                message: "CONTENT_PREKEY_POOL_DEPLETED".to_string(),
            },
        );
        let (message, should_cleanup) = failure.into_parts();
        assert_eq!(message, "RECIPIENT_KEY_UNAVAILABLE");
        assert!(!should_cleanup);
    }

    #[test]
    fn remote_prekey_admission_returns_only_typed_readiness() {
        let value = serde_json::to_value(PrivateMomentPublishOutcome::Ready(
            PrivateMomentAdmissionResult {
                state: "READY_PRIVATE",
                draft_id: "draft-remote".to_string(),
            },
        ))
        .unwrap();
        assert_eq!(value["state"], "READY_PRIVATE");
        assert_eq!(value["draftId"], "draft-remote");
        assert!(value.get("plan").is_none());
        assert!(value.get("claims").is_none());
    }

    #[test]
    fn remote_prekey_admission_never_replays_a_pending_publish() {
        let station_key = SigningKey::from_bytes(&[8; 32]);
        let lease = lease(&station_key);
        let store = lease.store.clone();
        let request_bytes = b"pending-private-publication".to_vec();
        store
            .persist_moment_command(&StoredMomentCommand {
                draft_id: "draft-pending".to_string(),
                draft_revision: 1,
                content_id: "content-pending".to_string(),
                generation: 1,
                submit_command_id: "submit-pending".to_string(),
                plan_bytes: vec![1],
                request_sha256: Sha256::digest(&request_bytes).into(),
                request_bytes,
                root_key: [2; 32],
                state: PublicationState::PendingPublication,
                session_generation: lease.session.key.session_generation,
                post_id: None,
            })
            .unwrap();
        let supervisor = SecureContentSupervisor::new();
        let orchestrator = PrivateMomentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let mut admission = publish_intent("draft-pending", 1);
        admission.admission_only = true;

        assert!(orchestrator
            .existing_publish_result(&admission)
            .unwrap()
            .is_none());
        assert_eq!(
            store
                .moment_command("draft-pending", 1)
                .unwrap()
                .unwrap()
                .state,
            PublicationState::PendingPublication,
        );
    }

    #[test]
    fn secure_content_private_read_failure_is_persistable_and_typed() {
        let error = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(404),
            stable_code: crate::model::error::ErrorCode::Undefined as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "ERROR_CODE_NOT_FOUND".to_string(),
        };

        let projection = private_transport_failure_projection("post-1", &error);

        assert_eq!(
            projection.state,
            super::super::projection::PrivateReadState::NotFoundOrNotAuthorized
        );
        assert!(projection.content.is_none());
        assert!(projection.encode_local().is_ok());
    }

    #[test]
    fn pending_device_projects_recovery_required_without_plaintext() {
        let projection = pending_device_recovery_projection("post-1");

        assert_eq!(
            projection.state,
            super::super::projection::PrivateReadState::RecoveryRequired
        );
        assert_eq!(projection.error_code.as_deref(), Some("RECOVERY_REQUIRED"));
        assert!(projection.content.is_none());
        assert!(projection.author_ptid.is_empty());
        assert_eq!(projection.audience_kind, "UNKNOWN");
        assert!(projection.encode_local().is_ok());
    }

    #[test]
    fn secure_content_private_purge_requires_trusted_post_not_found_code() {
        for http_status in [404, 410] {
            let untyped = crate::secure_content::adapter::NativeTransportError {
                http_status: Some(http_status),
                stable_code: crate::model::error::ErrorCode::Undefined as i32,
                retry_after_seconds: None,
                disposition: NativeErrorDisposition::Terminal,
                message: "untyped not found".to_string(),
            };
            assert!(!requires_private_resource_purge(&untyped));
            assert_ne!(
                recovery_transport_failure(&untyped),
                (PrivateRecoveryFailureKind::NotAuthorized, true)
            );
        }

        let typed = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(404),
            stable_code: crate::model::error::ErrorCode::PostNotFound as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "ERROR_CODE_POST_NOT_FOUND".to_string(),
        };
        assert!(requires_private_resource_purge(&typed));
        assert_eq!(
            recovery_transport_failure(&typed),
            (PrivateRecoveryFailureKind::NotAuthorized, true)
        );

        let mismatched = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(500),
            ..typed
        };
        assert!(!requires_private_resource_purge(&mismatched));
    }

    #[test]
    fn secure_content_unknown_moment_auth_rejection_stays_reconcilable() {
        let rejected = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(401),
            stable_code: 20001,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "UNAUTHORIZED".to_string(),
        };
        assert!(preserves_unknown_moment_after_auth_rejection(
            true, &rejected
        ));
        assert!(!preserves_unknown_moment_after_auth_rejection(
            false, &rejected
        ));
        assert!(!requires_private_resource_purge(&rejected));
    }

    #[test]
    fn secure_content_retryable_publish_failure_preserves_draft_and_upload_journal() {
        let station_key = SigningKey::from_bytes(&[8; 32]);
        let lease = lease(&station_key);
        let store = lease.store.clone();
        let draft = StoredMomentDraft {
            draft_id: "draft-retryable".to_string(),
            draft_revision: 1,
            intent_sha256: [3; 32],
            content_id: "content-retryable".to_string(),
            prepare_command_id: "prepare-retryable".to_string(),
            mention_commitment_salt: None,
            repost_commitment_salt: None,
        };
        store.reserve_moment_draft(&draft).unwrap();
        let transfer = secure_content_core::object::ObjectTransferRecord {
            transfer_id: "upload-retryable".to_string(),
            owner_scope_id: draft.content_id.clone(),
            operation_id: "object-retryable".to_string(),
            authority_id: "plan-retryable".to_string(),
            direction: ObjectTransferDirection::Upload,
            state: secure_content_core::object::ObjectTransferState::Queued,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: "/tmp/retryable-source.jpg".to_string(),
            partial_local_ref: "/tmp/.object-retryable.partial".to_string(),
            object_key: vec![7; 32],
            base_nonce: vec![0; 12],
            plaintext_size: 128,
            chunk_size: 128,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error: None,
            updated_at_unix_ms: 1,
        };
        store
            .ensure_object_upload_transfer(&transfer, "image/jpeg")
            .unwrap();
        let supervisor = SecureContentSupervisor::new();
        let orchestrator = PrivateMomentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let retryable = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(503),
            stable_code: 20008,
            retry_after_seconds: Some(1),
            disposition: NativeErrorDisposition::Retryable,
            message: "UNAVAILABLE".to_string(),
        };

        assert!(orchestrator
            .finish_publish_failure(
                &publish_intent(&draft.draft_id, draft.draft_revision),
                PrivatePublishFailure::from_transport(retryable),
                Some(draft.content_id.clone()),
                vec![transfer.transfer_id.clone()],
            )
            .is_err());

        let replay = store
            .reserve_moment_draft(&StoredMomentDraft {
                content_id: "replacement-must-not-win".to_string(),
                ..draft.clone()
            })
            .unwrap();
        assert_eq!(replay, draft);
        let persisted = store
            .object_transfer(&transfer.transfer_id)
            .unwrap()
            .unwrap();
        assert_eq!(persisted.object_key, transfer.object_key);
        assert_eq!(persisted.base_nonce, transfer.base_nonce);
    }

    #[test]
    fn secure_content_prepare_rejection_reports_observed_zero_claims_and_local_rows() {
        let station_key = SigningKey::from_bytes(&[8; 32]);
        let lease = lease(&station_key);
        let store = lease.store.clone();
        let draft = StoredMomentDraft {
            draft_id: "draft-unsupported".to_string(),
            draft_revision: 1,
            intent_sha256: [3; 32],
            content_id: "content-unsupported".to_string(),
            prepare_command_id: "prepare-unsupported".to_string(),
            mention_commitment_salt: None,
            repost_commitment_salt: None,
        };
        store.reserve_moment_draft(&draft).unwrap();
        let supervisor = SecureContentSupervisor::new();
        let orchestrator = PrivateMomentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let rejection = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(400),
            stable_code: crate::model::error::ErrorCode::InvalidRequest as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "SOCIAL_PRIVATE_UNSUPPORTED".to_string(),
        };

        let outcome = orchestrator
            .finish_publish_failure(
                &publish_intent(&draft.draft_id, draft.draft_revision),
                PrivatePublishFailure::from_prepare_transport(rejection),
                Some(draft.content_id.clone()),
                Vec::new(),
            )
            .unwrap();
        let PrivateMomentPublishOutcome::Rejected(result) = outcome else {
            panic!("prepare rejection must return typed rejection evidence");
        };

        assert_eq!(result.state, "PRIVATE_UNSUPPORTED");
        assert_eq!(result.error_code, "PRIVATE_UNSUPPORTED");
        assert_eq!(result.evidence.publish_phase, "PREPARE_REJECTED");
        assert!(!result.evidence.prepare_succeeded);
        assert_eq!(result.evidence.received_prepare_plan_count, 0);
        assert_eq!(result.evidence.desktop_local_durable_row_count, 0);
        assert_eq!(result.evidence.local_draft_row_count, 0);
        assert_eq!(result.evidence.local_command_row_count, 0);
        assert_eq!(result.evidence.local_projection_row_count, 0);
        assert_eq!(result.evidence.local_upload_row_count, 0);
        assert!(store
            .moment_command(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .is_none());
        assert!(store.projection(&draft.content_id).unwrap().is_none());
        assert!(store
            .upload_transfer_ids_for_content(&draft.content_id)
            .unwrap()
            .is_empty());

        let replacement = StoredMomentDraft {
            intent_sha256: [4; 32],
            content_id: "replacement-content".to_string(),
            prepare_command_id: "replacement-prepare".to_string(),
            ..draft
        };
        assert_eq!(
            store.reserve_moment_draft(&replacement).unwrap(),
            replacement
        );
        store.delete_moment_draft(&replacement.content_id).unwrap();
    }

    #[test]
    fn secure_content_terminal_upload_cleanup_removes_the_owner_journal() {
        let station_key = SigningKey::from_bytes(&[8; 32]);
        let lease = lease(&station_key);
        let store = lease.store.clone();
        let root = std::env::temp_dir().join(format!(
            "secure-content-terminal-upload-cleanup-{}",
            ulid::Ulid::new()
        ));
        let source = root.join("source.jpg");
        let partial = root.join("partial.ciphertext");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&source, [1_u8; 128]).unwrap();
        std::fs::write(&partial, [2_u8; 64]).unwrap();
        let transfer = secure_content_core::object::ObjectTransferRecord {
            transfer_id: "upload-terminal-cleanup".to_string(),
            owner_scope_id: "content-terminal-cleanup".to_string(),
            operation_id: "object-terminal-cleanup".to_string(),
            authority_id: "plan-terminal-cleanup".to_string(),
            direction: ObjectTransferDirection::Upload,
            state: secure_content_core::object::ObjectTransferState::Terminal,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: source.display().to_string(),
            partial_local_ref: partial.display().to_string(),
            object_key: vec![7; 32],
            base_nonce: vec![0; 12],
            plaintext_size: 128,
            chunk_size: 128,
            attempt_count: 1,
            next_attempt_at_unix_ms: 0,
            last_error: Some(ObjectTransferErrorCode::IntegrityFailed),
            updated_at_unix_ms: 1,
        };
        store
            .ensure_object_upload_transfer(&transfer, "image/jpeg")
            .unwrap();
        let supervisor = SecureContentSupervisor::new();
        let orchestrator = PrivateMomentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };

        orchestrator
            .purge_abandoned_upload(&transfer.transfer_id)
            .unwrap();

        assert!(store
            .object_transfer(&transfer.transfer_id)
            .unwrap()
            .is_none());
        assert!(!partial.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn secure_content_deterministic_publish_failure_cleans_draft_reservation() {
        let station_key = SigningKey::from_bytes(&[8; 32]);
        let lease = lease(&station_key);
        let store = lease.store.clone();
        let draft = StoredMomentDraft {
            draft_id: "draft-terminal".to_string(),
            draft_revision: 1,
            intent_sha256: [3; 32],
            content_id: "content-terminal".to_string(),
            prepare_command_id: "prepare-terminal".to_string(),
            mention_commitment_salt: None,
            repost_commitment_salt: None,
        };
        store.reserve_moment_draft(&draft).unwrap();
        let supervisor = SecureContentSupervisor::new();
        let orchestrator = PrivateMomentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };

        assert!(orchestrator
            .finish_publish_failure(
                &publish_intent(&draft.draft_id, draft.draft_revision),
                PrivatePublishFailure::cleanup("malformed prepare plan"),
                Some(draft.content_id.clone()),
                Vec::new(),
            )
            .is_err());

        let replacement = StoredMomentDraft {
            draft_id: draft.draft_id,
            draft_revision: draft.draft_revision,
            intent_sha256: [4; 32],
            content_id: "replacement-content".to_string(),
            prepare_command_id: draft.prepare_command_id,
            mention_commitment_salt: None,
            repost_commitment_salt: None,
        };
        assert_eq!(
            store.reserve_moment_draft(&replacement).unwrap(),
            replacement
        );
    }

    #[test]
    fn secure_content_recovery_transport_failure_does_not_purge_transient_errors() {
        let retryable = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(503),
            stable_code: 20008,
            retry_after_seconds: Some(1),
            disposition: NativeErrorDisposition::Retryable,
            message: "UNAVAILABLE".to_string(),
        };
        assert_eq!(
            recovery_transport_failure(&retryable),
            (PrivateRecoveryFailureKind::Retryable, false)
        );
        let revoked = crate::secure_content::adapter::NativeTransportError {
            http_status: Some(404),
            stable_code: crate::model::error::ErrorCode::PostNotFound as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "ERROR_CODE_POST_NOT_FOUND".to_string(),
        };
        assert_eq!(
            recovery_transport_failure(&revoked),
            (PrivateRecoveryFailureKind::NotAuthorized, true)
        );
    }

    #[test]
    fn secure_content_recovery_exhaustion_uses_point_read_authority() {
        let authorized = classify_recovery_attempt(classify_missing_recovery_target(Ok(
            social::GetMomentResourceResponse::default(),
        )));
        assert_eq!(authorized.0, PrivateRecoveryFailureKind::KeyUnavailable);
        assert!(!authorized.2);

        let revoked = classify_recovery_attempt(classify_missing_recovery_target(Err(
            crate::secure_content::adapter::NativeTransportError {
                http_status: Some(404),
                stable_code: crate::model::error::ErrorCode::PostNotFound as i32,
                retry_after_seconds: None,
                disposition: NativeErrorDisposition::Terminal,
                message: "ERROR_CODE_POST_NOT_FOUND".to_string(),
            },
        )));
        assert_eq!(revoked.0, PrivateRecoveryFailureKind::NotAuthorized);
        assert!(revoked.2);
    }

    #[test]
    fn secure_content_recovery_envelope_replaces_point_read_envelope() {
        let mut response = social::GetMomentResourceResponse {
            resource: Some(social::PostResource {
                body: Some(social::post_resource::Body::PrivateContent(
                    social::PrivateContentAccess::default(),
                )),
                ..Default::default()
            }),
            ..Default::default()
        };

        let recovery_envelope = wire::ViewerContentKeyEnvelope {
            principal_epoch: 7,
            ..Default::default()
        };
        attach_recovery_envelope(&mut response, &recovery_envelope).unwrap();
        assert_eq!(
            response
                .resource
                .as_ref()
                .and_then(|resource| match resource.body.as_ref() {
                    Some(social::post_resource::Body::PrivateContent(private)) => {
                        private.viewer_envelope.as_ref()
                    }
                    _ => None,
                })
                .map(|envelope| envelope.principal_epoch),
            Some(7)
        );
    }

    #[test]
    fn secure_content_object_set_hash_uses_repeated_message_framing() {
        let descriptor = wire::EncryptedObjectDescriptor {
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: "content-1".to_string(),
                generation: 1,
            }),
            object_id: "object-1".to_string(),
            storage_ref: "social-object:1".to_string(),
            commitment: Some(wire::EncryptedObjectUploadSpec {
                resource: Some(wire::SecureResourceRef {
                    owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                    content_id: "content-1".to_string(),
                    generation: 1,
                }),
                object_id: "object-1".to_string(),
                ciphertext_size: 17,
                ciphertext_sha256: vec![1; 32],
                chunk_size: 1_048_576,
                chunk_count: 1,
                encryption_suite: wire::ObjectEncryptionSuite::Aes256GcmChunked as i32,
                tag_size: 16,
                nonce_strategy: wire::ObjectNonceStrategy::Counter32Be as i32,
                chunk_ciphertext_sha256: vec![vec![2; 32]],
            }),
        };
        let mut framed = vec![0x0a];
        let encoded = descriptor.encode_to_vec();
        let mut length = encoded.len() as u64;
        while length >= 0x80 {
            framed.push((length as u8 & 0x7f) | 0x80);
            length >>= 7;
        }
        framed.push(length as u8);
        framed.extend_from_slice(&encoded);
        assert_eq!(
            object_descriptor_set_hash(&[descriptor]).unwrap(),
            Sha256::digest(framed).as_slice()
        );
    }

    #[test]
    fn secure_content_private_plan_requires_current_station_signature() {
        let station_key = SigningKey::from_bytes(&[8; 32]);
        let lease = lease(&station_key);
        let plan = signed_plan(&station_key);

        assert!(validate_plan(
            &plan,
            &lease,
            "content-1",
            social::PrivateMomentKind::Text,
            0,
            &[],
        )
        .is_ok());

        let mut substituted = plan.clone();
        substituted.station_signing_key_id = "attacker-key".to_string();
        assert!(validate_plan(
            &substituted,
            &lease,
            "content-1",
            social::PrivateMomentKind::Text,
            0,
            &[],
        )
        .is_err());

        let mut tampered = plan;
        tampered.authorization_snapshot_sha256[0] ^= 1;
        assert!(validate_plan(
            &tampered,
            &lease,
            "content-1",
            social::PrivateMomentKind::Text,
            0,
            &[],
        )
        .is_err());
    }

    #[test]
    fn ready_media_projects_native_verified_plaintext_evidence() {
        let mut media = super::super::projection::PrivateMomentMediaProjection {
            object_id: "object-1".to_string(),
            state: PrivateMediaState::MediaDownloading,
            access_path:
                super::super::private_media::PrivateMediaAccessPath::HomeStationLocalObject,
            retryable: false,
            render_url: None,
            local_path: None,
            plaintext_sha256: None,
            plaintext_size: None,
            mime_type: Some("image/png".to_string()),
            width: None,
            height: None,
            alt_text: None,
            error_code: Some("PENDING".to_string()),
        };
        let digest = [0xab; 32];
        let expected_digest = "ab".repeat(32);

        apply_ready_media(&mut media, Path::new("/tmp/private-media"), &digest, 17);

        assert_eq!(media.state, PrivateMediaState::MediaReady);
        assert_eq!(media.local_path.as_deref(), Some("/tmp/private-media"));
        assert_eq!(
            media.plaintext_sha256.as_deref(),
            Some(expected_digest.as_str())
        );
        assert_eq!(media.plaintext_size, Some(17));
        assert_eq!(media.error_code, None);
    }
}
