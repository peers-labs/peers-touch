use std::path::{Path, PathBuf};

use ed25519_dalek::VerifyingKey;
use prost::Message;
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
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::model::{secure_content as wire, social};
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
use super::projection::{
    decrypt_projection_from_response, object_descriptor_set_hash, sender_key_requirement,
    verify_recovery_envelope_for_response, DecryptedPrivateMoment, PrivateMediaState,
    PrivateMomentContentProjection, PrivateMomentProjection, PrivateMomentPublishResult,
    PrivateMomentsSnapshot, PrivateProjectionFailureKind,
};

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateMomentFileIntent {
    pub intent_id: String,
    pub file_path: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateMomentPublishIntent {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub draft_id: String,
    pub draft_revision: u64,
    pub audience_kind: String,
    #[serde(default)]
    pub audience_target_id: Option<String>,
    #[serde(default)]
    pub audience_base_kind: Option<String>,
    #[serde(default)]
    pub audience_actor_ptids: Vec<String>,
    #[serde(default)]
    pub moment_kind: String,
    pub text: String,
    #[serde(default)]
    pub files: Vec<PrivateMomentFileIntent>,
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
    ) -> Result<PrivateMomentPublishResult, String> {
        validate_publish_intent(intent)?;
        let _publish_guard = self.supervisor.begin_private_publish(
            &self.lease.session.key,
            &intent.draft_id,
            intent.draft_revision,
        )?;
        if let Some(existing) = self.existing_publish_result(intent)? {
            return Ok(existing);
        }
        let mut upload_transfer_ids = Vec::new();
        let mut content_id = None;
        match self.publish_new(intent, &mut upload_transfer_ids, &mut content_id) {
            Ok(result) => Ok(result),
            Err(failure) => self.finish_publish_failure(failure, content_id, upload_transfer_ids),
        }
    }

    fn publish_new(
        &self,
        intent: &PrivateMomentPublishIntent,
        upload_transfer_ids: &mut Vec<String>,
        cleanup_content_id: &mut Option<String>,
    ) -> Result<PrivateMomentPublishResult, PrivatePublishFailure> {
        let prepare_command_id =
            bounded_command_id("moment-prepare", &intent.draft_id, intent.draft_revision);
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
            })
            .map_err(PrivatePublishFailure::preserve)?;
        let content_id = reservation.content_id;
        *cleanup_content_id = Some(content_id.clone());
        let kind =
            resolve_moment_kind(&intent.moment_kind).map_err(PrivatePublishFailure::cleanup)?;
        let audience = private_audience(intent).map_err(PrivatePublishFailure::cleanup)?;
        let prepare = social::PreparePrivateMomentRequest {
            content_id: content_id.clone(),
            audience: Some(audience),
            object_count: intent.files.len() as u32,
            command_id: prepare_command_id,
            kind: kind as i32,
            repost_authority: None,
            poll_authority: None,
        };
        let plan = self
            .transport
            .prepare_private_moment(&prepare)
            .map_err(PrivatePublishFailure::from_transport)?
            .plan
            .ok_or_else(|| {
                PrivatePublishFailure::cleanup("private Moment prepare response omitted its plan")
            })?;
        self.ensure_current()
            .map_err(PrivatePublishFailure::preserve)?;
        validate_plan(&plan, &self.lease, &content_id, kind, intent.files.len())
            .map_err(PrivatePublishFailure::cleanup)?;

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

        let plaintext = private_payload(kind, &intent.text, attachment_metadata).encode_to_vec();
        let domain_binding = social::PrivateMomentDomainBinding {
            format_version: PAYLOAD_FORMAT_VERSION,
            kind: kind as i32,
            subtype_prepare_authority_sha256: Vec::new(),
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
            mention_routing: None,
            poll_authority: None,
            repost_authority: None,
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
            .map_err(PrivatePublishFailure::preserve)
    }

    fn finish_publish_failure(
        &self,
        failure: PrivatePublishFailure,
        content_id: Option<String>,
        upload_transfer_ids: Vec<String>,
    ) -> Result<PrivateMomentPublishResult, String> {
        let (error, should_cleanup) = failure.into_parts();
        if !should_cleanup {
            return Err(error);
        }
        if let Some(content_id) = content_id.as_deref() {
            self.lease.store.delete_moment_draft(content_id)?;
        }
        let mut cleanup_errors = Vec::new();
        for transfer_id in upload_transfer_ids {
            if let Err(cleanup_error) = self.purge_abandoned_upload(&transfer_id) {
                cleanup_errors.push(cleanup_error);
            }
        }
        if cleanup_errors.is_empty() {
            Err(error)
        } else {
            Err(format!(
                "{error}; cleanup abandoned private Moment uploads: {}",
                cleanup_errors.join("; ")
            ))
        }
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
                        self.persist_decrypted_projection(&decrypted)?;
                        return Ok(decrypted.projection);
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
                let (kind, message, purge) = match attempt {
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
                };
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
                self.persist_decrypted_projection(&decrypted)?;
                return Ok(decrypted.projection);
            }
            if !response.has_more {
                return Err(PrivateRecoveryAttemptError::KeyUnavailable(
                    "private Moment recovery envelope is unavailable".to_string(),
                ));
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
    ) -> Result<PrivateMomentProjection, String> {
        let response = match self.transport.get_private_moment(post_id) {
            Ok(response) => response,
            Err(error) => {
                self.ensure_current()?;
                if requires_private_resource_purge(&error) {
                    self.purge_private_resource(post_id, revoke_media)?;
                }
                if matches!(error.http_status, Some(401 | 403 | 404 | 410)) {
                    return Ok(private_transport_failure_projection(post_id, &error));
                }
                return Err(error.to_string());
            }
        };
        self.ensure_current()?;
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
                .ok_or_else(|| "private Moment media object is unavailable".to_string())?,
            _ => return Err("private Moment has no encrypted image media".to_string()),
        };
        if !attachment.mime_type.starts_with("image/") {
            return Err("private Moment image media type is invalid".to_string());
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
        self.lease.store.ensure_object_download_transfer(
            &record,
            &attachment.mime_type,
            &cache_path,
        )?;
        let worker = new_download_worker(&self.lease, descriptor_wire)?;
        let progress = worker.run_download_once(
            &record.transfer_id,
            &descriptor,
            &expected_plaintext_sha256,
            &cache_path.display().to_string(),
            now_unix_ms(),
        );
        let projection = &mut decrypted.projection;
        let media = match projection.content.as_mut() {
            Some(PrivateMomentContentProjection::Image { media, .. }) => media,
            _ => return Err("private Moment has no encrypted image media".to_string()),
        };
        let item = media
            .iter_mut()
            .find(|item| item.object_id == object_id)
            .ok_or_else(|| "private Moment media object is unavailable".to_string())?;
        match progress {
            Ok(ObjectTransferProgress::Complete) => {
                self.ensure_current()?;
                if !cache_path.is_file() {
                    return Err("private Moment media cache is unavailable".to_string());
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
        self.save_projection_if_current(post_id, &persisted.encode_local()?)?;
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
        self.supervisor.with_current_renderer(
            &self.lease.session.key,
            self.lease.renderer_generation,
            |_| {
                self.lease.store.commit_content_root(
                    &decrypted.projection.content_id,
                    generation,
                    &decrypted.projection.post_id,
                    decrypted.content_key.as_bytes(),
                    decrypted.consumed_prekey.as_deref(),
                    &projection_bytes,
                )
            },
        )
    }

    fn save_projection_if_current(
        &self,
        post_id: &str,
        projection_bytes: &[u8],
    ) -> Result<(), String> {
        self.supervisor.with_current_renderer(
            &self.lease.session.key,
            self.lease.renderer_generation,
            |_| self.lease.store.save_projection(post_id, projection_bytes),
        )
    }

    fn purge_private_resource(
        &self,
        post_id: &str,
        revoke_media: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
        self.supervisor.with_current_renderer(
            &self.lease.session.key,
            self.lease.renderer_generation,
            |_| {
                self.lease
                    .store
                    .mark_private_resource_purge_pending(post_id)
            },
        )?;
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
        .singular_bytes(4, intent.audience_kind.as_bytes())
        .map_err(|error| error.to_string())?;
    encoder
        .singular_bytes(5, intent.text.as_bytes())
        .map_err(|error| error.to_string())?;
    if let Some(target_id) = intent.audience_target_id.as_deref() {
        encoder
            .singular_bytes(7, target_id.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    if let Some(base_kind) = intent.audience_base_kind.as_deref() {
        encoder
            .singular_bytes(8, base_kind.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    for actor_ptid in &intent.audience_actor_ptids {
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
    media.state = if code == ObjectTransferErrorCode::NotGranted {
        PrivateMediaState::MediaAccessDenied
    } else {
        PrivateMediaState::MediaIntegrityFailure
    };
}

fn scrub_persisted_media_projection(
    mut projection: PrivateMomentProjection,
) -> PrivateMomentProjection {
    if let Some(PrivateMomentContentProjection::Image { media, .. }) = projection.content.as_mut() {
        for item in media {
            item.local_path = None;
            item.render_url = None;
            item.plaintext_sha256 = None;
            item.plaintext_size = None;
            if item.state == PrivateMediaState::MediaReady {
                item.state = PrivateMediaState::MediaPlaceholder;
            }
        }
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
        content: None,
        error_code: Some(error_code.to_string()),
        retry_after_seconds,
        created_at_millis: None,
        updated_at_millis: None,
    }
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
            intent.audience_kind.as_str(),
            "FRIENDS" | "FOLLOWERS" | "CIRCLE" | "GROUP" | "SELF" | "CUSTOM_ALLOW" | "CUSTOM_DENY"
        )
        || intent.text.trim().is_empty()
        || intent.files.len() > 10
    {
        return Err("private Moment publish intent is invalid".to_string());
    }
    private_audience(intent)?;
    let kind = resolve_moment_kind(&intent.moment_kind)?;
    match kind {
        social::PrivateMomentKind::Text if !intent.files.is_empty() => {
            return Err("private text Moment cannot contain files".to_string())
        }
        social::PrivateMomentKind::Image if intent.files.is_empty() => {
            return Err("private image Moment requires a file".to_string())
        }
        social::PrivateMomentKind::Text | social::PrivateMomentKind::Image => {}
        _ => return Err("private Moment subtype is not source-complete".to_string()),
    }
    Ok(())
}

fn validate_plan(
    plan: &wire::ContentEncryptionPlan,
    lease: &SecureContentLease,
    content_id: &str,
    kind: social::PrivateMomentKind,
    object_count: usize,
) -> Result<(), String> {
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: 1,
        kind: kind as i32,
        subtype_prepare_authority_sha256: Vec::new(),
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
    kind: social::PrivateMomentKind,
    text: &str,
    images: Vec<social::PrivateAttachmentMetadata>,
) -> social::PrivateMomentContent {
    let body = match kind {
        social::PrivateMomentKind::Text => {
            social::private_moment_content::Body::Text(social::PrivateTextContent {
                text: text.to_string(),
                hashtags: Vec::new(),
                mentions: Vec::new(),
            })
        }
        social::PrivateMomentKind::Image => {
            social::private_moment_content::Body::Image(social::PrivateImageContent {
                text: text.to_string(),
                images,
                hashtags: Vec::new(),
                mentions: Vec::new(),
            })
        }
        social::PrivateMomentKind::Video => {
            social::private_moment_content::Body::Video(social::PrivateVideoContent {
                text: text.to_string(),
                source: images.first().cloned(),
                poster: images.get(1).cloned(),
                variants: Vec::new(),
                hashtags: Vec::new(),
                mentions: Vec::new(),
            })
        }
        social::PrivateMomentKind::Link => {
            social::private_moment_content::Body::Link(social::PrivateLinkContent {
                text: text.to_string(),
                link: None,
                hashtags: Vec::new(),
                mentions: Vec::new(),
            })
        }
        social::PrivateMomentKind::Poll => {
            social::private_moment_content::Body::Poll(social::PrivatePollContent {
                text: text.to_string(),
                question: String::new(),
                options: Vec::new(),
                option_set_sha256: Vec::new(),
                min_choices: 0,
                max_choices: 0,
                expires_at: None,
                mentions: Vec::new(),
            })
        }
        social::PrivateMomentKind::Repost => {
            social::private_moment_content::Body::Repost(social::PrivateRepostContent {
                comment: text.to_string(),
                original_source: None,
                rendered_source: None,
                mentions: Vec::new(),
                rendered_source_commitment_salt: Vec::new(),
            })
        }
        social::PrivateMomentKind::Location => {
            social::private_moment_content::Body::Location(social::PrivateLocationContent {
                text: text.to_string(),
                location: None,
                images,
                hashtags: Vec::new(),
                mentions: Vec::new(),
            })
        }
        _ => social::private_moment_content::Body::Text(social::PrivateTextContent {
            text: text.to_string(),
            hashtags: Vec::new(),
            mentions: Vec::new(),
        }),
    };
    social::PrivateMomentContent {
        format_version: 1,
        body: Some(body),
        mention_commitment_salt: Vec::new(),
    }
}

fn resolve_moment_kind(kind_str: &str) -> Result<social::PrivateMomentKind, String> {
    match kind_str {
        "IMAGE" => Ok(social::PrivateMomentKind::Image),
        "TEXT" => Ok(social::PrivateMomentKind::Text),
        _ => Err("private Moment subtype is not source-complete".to_string()),
    }
}

fn private_audience(intent: &PrivateMomentPublishIntent) -> Result<social::Audience, String> {
    let mut actor_ptids = intent.audience_actor_ptids.clone();
    actor_ptids.sort();
    if actor_ptids
        .iter()
        .any(|ptid| ptid.is_empty() || ptid.trim() != ptid || ptid == &intent.actor_ptid)
        || actor_ptids.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err("private Moment audience actor list is invalid".to_string());
    }
    let target_id = match intent.audience_target_id.as_deref() {
        Some(value) if !value.is_empty() => value
            .parse::<u64>()
            .map_err(|_| "private Moment audience target is invalid".to_string())?,
        _ => 0,
    };
    let (kind, base_kind) = match intent.audience_kind.as_str() {
        "FRIENDS" => (social::audience::Kind::Friends, None),
        "FOLLOWERS" => (social::audience::Kind::Followers, None),
        "CIRCLE" if target_id > 0 => (social::audience::Kind::Circle, None),
        "GROUP" if target_id > 0 => (social::audience::Kind::Group, None),
        "SELF" => (social::audience::Kind::Self_, None),
        "CUSTOM_ALLOW" if !actor_ptids.is_empty() => (social::audience::Kind::CustomAllow, None),
        "CUSTOM_DENY" if !actor_ptids.is_empty() => {
            let base = match intent.audience_base_kind.as_deref() {
                Some("PUBLIC") => social::audience::Kind::Public,
                Some("FOLLOWERS") => social::audience::Kind::Followers,
                _ => return Err("private Moment custom deny base is invalid".to_string()),
            };
            (social::audience::Kind::CustomDeny, Some(base))
        }
        _ => return Err("private Moment audience is invalid".to_string()),
    };
    if !matches!(
        kind,
        social::audience::Kind::Circle | social::audience::Kind::Group
    ) && target_id != 0
        || !matches!(
            kind,
            social::audience::Kind::CustomAllow | social::audience::Kind::CustomDeny
        ) && !actor_ptids.is_empty()
        || kind != social::audience::Kind::CustomDeny && intent.audience_base_kind.is_some()
    {
        return Err("private Moment audience fields are inconsistent".to_string());
    }
    Ok(social::Audience {
        kind: kind as i32,
        target_id,
        actor_ptids,
        base_kind: base_kind.map_or(0, |value| value as i32),
        ..Default::default()
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
    fn secure_content_private_publish_intent_validates_audience_kinds() {
        let valid = PrivateMomentPublishIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: "draft-1".to_string(),
            draft_revision: 1,
            audience_kind: "FRIENDS".to_string(),
            audience_target_id: None,
            audience_base_kind: None,
            audience_actor_ptids: Vec::new(),
            moment_kind: "TEXT".to_string(),
            text: "private".to_string(),
            files: Vec::new(),
        };
        assert!(validate_publish_intent(&valid).is_ok());
        for kind in &["FOLLOWERS", "SELF"] {
            let mut variant = valid.clone();
            variant.audience_kind = kind.to_string();
            assert!(validate_publish_intent(&variant).is_ok());
        }
        for kind in &["CIRCLE", "GROUP"] {
            let mut variant = valid.clone();
            variant.audience_kind = kind.to_string();
            variant.audience_target_id = Some("42".to_string());
            assert!(validate_publish_intent(&variant).is_ok());
        }
        let mut custom_allow = valid.clone();
        custom_allow.audience_kind = "CUSTOM_ALLOW".to_string();
        custom_allow.audience_actor_ptids = vec!["ptid:bob".to_string()];
        assert!(validate_publish_intent(&custom_allow).is_ok());
        let mut custom_deny = custom_allow;
        custom_deny.audience_kind = "CUSTOM_DENY".to_string();
        custom_deny.audience_base_kind = Some("FOLLOWERS".to_string());
        assert!(validate_publish_intent(&custom_deny).is_ok());
        let mut invalid = valid.clone();
        invalid.audience_kind = "PUBLIC".to_string();
        assert!(validate_publish_intent(&invalid).is_err());
        let mut invalid_subtype = valid;
        invalid_subtype.moment_kind = "BOGUS".to_string();
        assert!(validate_publish_intent(&invalid_subtype).is_err());
    }

    #[test]
    fn secure_content_private_draft_hash_is_stable_until_content_changes() {
        let intent = PrivateMomentPublishIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: "draft-1".to_string(),
            draft_revision: 3,
            audience_kind: "FRIENDS".to_string(),
            audience_target_id: None,
            audience_base_kind: None,
            audience_actor_ptids: Vec::new(),
            moment_kind: "TEXT".to_string(),
            text: "private".to_string(),
            files: Vec::new(),
        };
        assert_eq!(
            private_moment_intent_hash(&intent).unwrap(),
            private_moment_intent_hash(&intent).unwrap()
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
                PrivatePublishFailure::cleanup("malformed prepare plan"),
                Some(draft.content_id),
                Vec::new(),
            )
            .is_err());

        let replacement = StoredMomentDraft {
            draft_id: draft.draft_id,
            draft_revision: draft.draft_revision,
            intent_sha256: [4; 32],
            content_id: "replacement-content".to_string(),
            prepare_command_id: draft.prepare_command_id,
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
        )
        .is_err());
    }

    #[test]
    fn ready_media_projects_native_verified_plaintext_evidence() {
        let mut media = super::super::projection::PrivateMomentMediaProjection {
            object_id: "object-1".to_string(),
            state: PrivateMediaState::MediaDownloading,
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
