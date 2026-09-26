use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime, State};
use zeroize::Zeroizing;

use crate::error::{MobileError, MobileResult};
use crate::messaging::engine::SecureContentRuntimeIdentity;
use crate::messaging::lifecycle::MobileMessagingRuntime;
use crate::platform::media_picker::{
    consume_private_moment_media_handle, discard_private_moment_ciphertext,
    materialize_private_moment_media, prepare_private_moment_media,
    purge_private_moment_media_cache,
};
use crate::platform::secure_storage::SecureStorage;
use crate::secure_content::adapter::{
    build_moment_submission, build_text_submission, prepare_moment_request, prepare_request,
    projection_for_state, reserve_draft, reserve_moment_draft, PreparedPrivateAttachment,
    PrivateMomentIntent, PrivateMomentProjection, PrivatePublishState, PrivateRepostSourceMaterial,
    PrivateTextMomentIntent,
};
use crate::secure_content::private_comment::{
    draft_projection as private_comment_draft_projection, list as list_private_comments,
    submit as submit_private_comment, PrivateCommentDraftProjection, PrivateCommentIntent,
    PrivateCommentPage, PrivateCommentProjection, PrivateCommentSubmitResult,
};
use crate::secure_content::proto::{secure_content::v1 as wire, social::v1 as social_wire};
use crate::secure_content::receiver::{
    attachment_for_object, decrypt_text_projection, decrypt_text_projection_with_recovery,
    projection_for_read_failure, purges_private_material, recovery_key_unavailable_projection,
    repost_source_material_from_response, sender_key_requirement, set_media_projection,
    terminal_projection_for_transport_error, transport_error_is_retryable, DecryptedPrivateMoment,
    PrivateMediaState, PrivateMomentReadProjection, PrivateReadError, PrivateReadFailureKind,
};
use crate::secure_content::recovery::{
    store_recovery_phrase, INITIAL_SECURE_CONTENT_RECOVERY_EPOCH,
};
use crate::secure_content::store::{DurableState, PrivateSocialStore};
use crate::secure_content::transport::{
    jwt_session_id, resolve_trusted_station_signing_key, NativeSocialTransport,
    SenderSigningKeyError, SenderSigningKeyErrorKind, TransportError,
};
use crate::secure_content::worker::{PrivateSocialWorker, PrivateSocialWorkerReport};
use crate::secure_content::{NativeSocialSession, PrivateSocialScope};

const DATABASE_KEY_PREFIX: &str = "secure-content.social.v1.sqlcipher";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialActivationInput {
    station_peer_id: String,
    actor_ptid: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialAccountInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialPublishTextInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    #[serde(flatten)]
    intent: PrivateTextMomentIntent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialPublishInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    #[serde(flatten)]
    intent: PrivateMomentIntent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialReadTextInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    post_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialOpenMediaInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    post_id: String,
    object_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialCommentInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    #[serde(flatten)]
    intent: PrivateCommentIntent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialCommentListInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    post_id: String,
    #[serde(default)]
    cursor: String,
    #[serde(default = "default_comment_limit")]
    limit: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialRecoveryPhraseInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    recovery_phrase: String,
    #[serde(default = "initial_recovery_epoch")]
    recovery_epoch: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialRecoverTextInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    post_id: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialRuntimeStatus {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_peer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_ptid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    pub activation_generation: u64,
    pub worker_mode: &'static str,
}

impl PrivateSocialRuntimeStatus {
    fn inactive() -> Self {
        Self {
            active: false,
            profile_id: None,
            station_peer_id: None,
            actor_ptid: None,
            device_id: None,
            activation_generation: 0,
            worker_mode: "on_demand",
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSocialSnapshot {
    pub publish_projections: Vec<PrivateMomentProjection>,
    pub read_projections: Vec<PrivateMomentReadProjection>,
    pub comment_drafts: Vec<PrivateCommentDraftProjection>,
    pub comments: Vec<PrivateCommentProjection>,
}

struct PrivateSocialEngine {
    session: Arc<NativeSocialSession>,
    store: Arc<PrivateSocialStore>,
    worker: PrivateSocialWorker,
    operation_lock: Mutex<()>,
    activation_generation: u64,
}

impl PrivateSocialEngine {
    fn new(
        session: NativeSocialSession,
        store: PrivateSocialStore,
        activation_generation: u64,
    ) -> Result<Self, String> {
        let session = Arc::new(session);
        let store = Arc::new(store);
        Ok(Self {
            worker: PrivateSocialWorker::new(session.clone(), store.clone())?,
            session,
            store,
            operation_lock: Mutex::new(()),
            activation_generation,
        })
    }

    fn publish_text(
        &self,
        activation_generation: u64,
        intent: &PrivateTextMomentIntent,
    ) -> Result<PrivateMomentProjection, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.ensure_activation_generation(activation_generation)?;
        self.ensure_current()?;
        let draft = self.store.reserve_draft(&reserve_draft(intent)?)?;
        if let Some(existing) = self
            .store
            .submission(&intent.draft_id, intent.draft_revision)?
        {
            if existing.content_id != draft.content_id {
                return Err("private Social submission replay conflict".to_string());
            }
            return match existing.state {
                DurableState::Pending | DurableState::UnknownOutcome => {
                    self.worker.dispatch_submission(&existing.command_id)
                }
                DurableState::Committed => projection_for_state(
                    &existing,
                    PrivatePublishState::Published,
                    existing.post_id.clone(),
                    None,
                ),
                DurableState::InFlight => projection_for_state(
                    &existing,
                    PrivatePublishState::UnknownOutcome,
                    existing.post_id.clone(),
                    existing.last_error_code,
                ),
                DurableState::Terminal => projection_for_state(
                    &existing,
                    PrivatePublishState::PublishFailed,
                    existing.post_id.clone(),
                    existing.last_error_code,
                ),
            };
        }
        let prepare = prepare_request(&self.session.scope.actor_ptid, &draft, intent)?;
        let plan = NativeSocialTransport::new(self.session.clone())?
            .prepare_private_moment(&prepare)
            .map_err(|error| error.to_string())?
            .plan
            .ok_or_else(|| "private Social prepare response omitted its plan".to_string())?;
        let prepared = build_text_submission(&self.session, &draft, intent, plan)?;
        self.store.persist_submission(&prepared.command)?;
        self.worker
            .dispatch_submission(&prepared.command.command_id)
    }

    fn publish_moment<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        activation_generation: u64,
        intent: &PrivateMomentIntent,
    ) -> Result<PrivateMomentProjection, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.ensure_activation_generation(activation_generation)?;
        self.ensure_current()?;
        let draft = self.store.reserve_draft(&reserve_moment_draft(intent)?)?;
        if let Some(existing) = self
            .store
            .submission(&intent.draft_id, intent.draft_revision)?
        {
            if existing.content_id != draft.content_id {
                return Err("private Social submission replay conflict".to_string());
            }
            let projection = match existing.state {
                DurableState::Pending | DurableState::UnknownOutcome => {
                    self.worker.dispatch_submission(&existing.command_id)
                }
                DurableState::Committed => projection_for_state(
                    &existing,
                    PrivatePublishState::Published,
                    existing.post_id.clone(),
                    None,
                ),
                DurableState::InFlight => projection_for_state(
                    &existing,
                    PrivatePublishState::UnknownOutcome,
                    existing.post_id.clone(),
                    existing.last_error_code,
                ),
                DurableState::Terminal => projection_for_state(
                    &existing,
                    PrivatePublishState::PublishFailed,
                    existing.post_id.clone(),
                    existing.last_error_code,
                ),
            }?;
            self.consume_published_media_handles(app, intent, &projection)?;
            return Ok(projection);
        }
        let transport = NativeSocialTransport::new(self.session.clone())?;
        let repost = self.load_repost_source_material(intent, &draft, &transport)?;
        let (prepare, poll) = prepare_moment_request(
            &self.session.scope.actor_ptid,
            &draft,
            intent,
            repost.as_ref(),
        )?;
        let plan = transport
            .prepare_private_moment(&prepare)
            .map_err(|error| error.to_string())?
            .plan
            .ok_or_else(|| "private Social prepare response omitted its plan".to_string())?;
        self.ensure_current()?;
        let resource = plan
            .resource
            .as_ref()
            .ok_or_else(|| "private Social prepare plan omitted its resource".to_string())?;
        if plan.object_ids.len() != intent.files.len() {
            return Err("private Social prepare plan object count mismatched".to_string());
        }
        if !intent.files.is_empty() && draft.object_material_seed.is_none() {
            return Err("private Social object material seed is unavailable".to_string());
        }
        let object_material_seed = draft.object_material_seed.unwrap_or_default();
        let mut attachments = Vec::with_capacity(intent.files.len());
        for (file, object_id) in intent.files.iter().zip(&plan.object_ids) {
            attachments.push(self.upload_private_attachment(
                app,
                &transport,
                &plan.plan_id,
                resource,
                object_id,
                &object_material_seed,
                file,
            )?);
        }
        let prepared = build_moment_submission(
            &self.session,
            &draft,
            intent,
            plan,
            attachments,
            poll,
            repost,
        )?;
        self.store.persist_submission(&prepared.command)?;
        let projection = self
            .worker
            .dispatch_submission(&prepared.command.command_id)?;
        self.consume_published_media_handles(app, intent, &projection)?;
        Ok(projection)
    }

    fn consume_published_media_handles<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        intent: &PrivateMomentIntent,
        projection: &PrivateMomentProjection,
    ) -> Result<(), String> {
        if projection.state != PrivatePublishState::Published {
            return Ok(());
        }
        for file in &intent.files {
            consume_private_moment_media_handle(
                app,
                &self.session.scope.station_peer_id,
                &self.session.scope.actor_ptid,
                &file.handle,
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn upload_private_attachment<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        transport: &NativeSocialTransport,
        plan_id: &str,
        resource: &wire::SecureResourceRef,
        object_id: &str,
        object_material_seed: &[u8; 32],
        file: &crate::secure_content::adapter::PrivateMomentFileIntent,
    ) -> Result<PreparedPrivateAttachment, String> {
        let prepared = prepare_private_moment_media(
            app,
            &self.session.scope.station_peer_id,
            &self.session.scope.actor_ptid,
            &file.handle,
            object_id,
            object_material_seed,
        )
        .map_err(|error| error.to_string())?;
        let result = (|| {
            let upload_spec = prepared.upload_spec(resource, object_id);
            let descriptor_commitment_sha256 =
                prepared.descriptor_commitment_sha256(resource, object_id);
            let begin = transport
                .begin_private_object_upload(&wire::BeginEncryptedObjectUploadRequest {
                    format_version: 1,
                    plan_id: plan_id.to_string(),
                    resource: Some(resource.clone()),
                    object_id: object_id.to_string(),
                    upload_spec: Some(upload_spec.clone()),
                    descriptor_commitment_sha256: descriptor_commitment_sha256.to_vec(),
                    command_id: format!("mobile-object-begin:{object_id}"),
                })
                .map_err(|error| error.to_string())?;
            if begin.upload_id.trim().is_empty() || begin.generation == 0 {
                return Err("private Social object begin response is incomplete".to_string());
            }
            for chunk_index in 0..prepared.chunk_count() {
                self.ensure_current()?;
                let ciphertext = prepared
                    .ciphertext_chunk(chunk_index)
                    .map_err(|error| error.to_string())?;
                let chunk_hash = prepared
                    .chunk_sha256(chunk_index)
                    .map_err(|error| error.to_string())?;
                if Sha256::digest(&ciphertext).as_slice() != chunk_hash {
                    return Err("private Social object chunk changed before upload".to_string());
                }
                let chunk = transport
                    .put_private_object_chunk(
                        &begin.upload_id,
                        begin.generation,
                        object_id,
                        chunk_index,
                        u64::from(chunk_index).saturating_mul(prepared.chunk_stride()),
                        &ciphertext,
                        &chunk_hash,
                    )
                    .map_err(|error| error.to_string())?;
                if chunk.upload_id != begin.upload_id
                    || chunk.generation != begin.generation
                    || chunk.chunk_index != chunk_index
                {
                    return Err("private Social object chunk response mismatched".to_string());
                }
            }
            let complete = transport
                .complete_private_object_upload(
                    &begin.upload_id,
                    &wire::CompleteEncryptedObjectUploadRequest {
                        upload_id: begin.upload_id.clone(),
                        generation: begin.generation,
                        descriptor_commitment_sha256: descriptor_commitment_sha256.to_vec(),
                        command_id: format!("mobile-object-complete:{object_id}"),
                    },
                )
                .map_err(|error| error.to_string())?;
            if complete.state != wire::EncryptedObjectTransferState::CompleteUnattached as i32 {
                return Err("private Social object completion was not durable".to_string());
            }
            let descriptor = complete
                .descriptor
                .ok_or_else(|| "private Social object completion omitted descriptor".to_string())?;
            if descriptor.resource.as_ref() != Some(resource)
                || descriptor.object_id != object_id
                || descriptor.storage_ref.trim().is_empty()
                || descriptor.commitment.as_ref() != Some(&upload_spec)
            {
                return Err("private Social object descriptor mismatched".to_string());
            }
            let metadata = prepared.attachment_metadata(
                &file.attachment_id,
                descriptor.clone(),
                file.width,
                file.height,
                file.duration_ms,
                file.alt_text.clone(),
            );
            Ok(PreparedPrivateAttachment {
                metadata,
                descriptor,
            })
        })();
        discard_private_moment_ciphertext(&prepared);
        result
    }

    fn load_repost_source_material(
        &self,
        intent: &PrivateMomentIntent,
        draft: &crate::secure_content::store::StoredDraft,
        transport: &NativeSocialTransport,
    ) -> Result<Option<PrivateRepostSourceMaterial>, String> {
        let Some(repost) = intent.repost.as_ref() else {
            return Ok(None);
        };
        let commitment_salt = draft
            .repost_commitment_salt
            .as_ref()
            .ok_or_else(|| "private repost commitment salt is unavailable".to_string())?;
        let response = transport
            .get_private_moment(&repost.source_post_id)
            .map_err(|error| error.to_string())?;
        let decrypted = if response.resource.as_ref().is_some_and(|resource| {
            matches!(
                resource.body.as_ref(),
                Some(social_wire::post_resource::Body::PrivateContent(_))
            )
        }) {
            Some(self.decrypt_response(&repost.source_post_id, &response, transport)?)
        } else {
            None
        };
        repost_source_material_from_response(
            &repost.source_post_id,
            &response,
            decrypted.as_ref(),
            commitment_salt,
        )
        .map(Some)
    }

    fn decrypt_response(
        &self,
        post_id: &str,
        response: &social_wire::GetMomentResourceResponse,
        transport: &NativeSocialTransport,
    ) -> Result<DecryptedPrivateMoment, String> {
        let requirement = sender_key_requirement(post_id, response)?;
        let sender_key = requirement
            .signing_key_id
            .as_deref()
            .map(|signing_key_id| {
                transport.sender_signing_key(
                    &requirement.sender,
                    signing_key_id,
                    requirement.committed_at_unix_ms,
                )
            })
            .transpose()
            .map_err(|error| error.to_string())?;
        decrypt_text_projection(
            self.session.as_ref(),
            self.store.as_ref(),
            post_id,
            response,
            sender_key.as_ref(),
        )
        .map_err(|error| error.to_string())
    }

    fn submit_comment(
        &self,
        activation_generation: u64,
        intent: &PrivateCommentIntent,
    ) -> Result<PrivateCommentSubmitResult, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.ensure_activation_generation(activation_generation)?;
        self.ensure_current()?;
        let transport = NativeSocialTransport::new(self.session.clone())?;
        submit_private_comment(
            self.session.as_ref(),
            self.store.as_ref(),
            &transport,
            activation_generation,
            intent,
        )
    }

    fn list_comments(
        &self,
        activation_generation: u64,
        post_id: &str,
        cursor: &str,
        limit: u32,
    ) -> Result<PrivateCommentPage, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.ensure_activation_generation(activation_generation)?;
        self.ensure_current()?;
        let transport = NativeSocialTransport::new(self.session.clone())?;
        list_private_comments(
            self.session.as_ref(),
            self.store.as_ref(),
            &transport,
            activation_generation,
            post_id,
            cursor,
            limit,
        )
    }

    fn reconcile(&self, activation_generation: u64) -> Result<PrivateSocialWorkerReport, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.ensure_activation_generation(activation_generation)?;
        self.ensure_current()?;
        self.worker.reconcile()
    }

    fn read_text(
        &self,
        activation_generation: u64,
        post_id: &str,
    ) -> MobileResult<PrivateMomentReadProjection> {
        self.ensure_activation_generation(activation_generation)
            .map_err(MobileError::social)?;
        if post_id.trim().is_empty() || post_id != post_id.trim() {
            return Err(MobileError::social("private Social post ID is invalid"));
        }
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| MobileError::social("private Social operation lock poisoned"))?;
        self.ensure_current().map_err(MobileError::social)?;
        let transport =
            NativeSocialTransport::new(self.session.clone()).map_err(MobileError::social)?;
        let response = match transport.get_private_moment(post_id) {
            Err(error) => {
                return handle_transport_read_error(
                    self.store.as_ref(),
                    self.activation_generation,
                    post_id,
                    &error,
                )
            }
            Ok(response) => {
                self.ensure_current().map_err(MobileError::social)?;
                response
            }
        };
        let requirement = match sender_key_requirement(post_id, &response) {
            Ok(requirement) => requirement,
            Err(error) => {
                return persist_private_read_error(
                    self.store.as_ref(),
                    self.activation_generation,
                    post_id,
                    PrivateReadError::from(error),
                );
            }
        };
        let sender_key = match requirement.signing_key_id.as_deref() {
            Some(signing_key_id) => match transport.sender_signing_key(
                &requirement.sender,
                signing_key_id,
                requirement.committed_at_unix_ms,
            ) {
                Ok(key) => Some(key),
                Err(error) => {
                    self.ensure_current().map_err(MobileError::social)?;
                    return handle_sender_key_error(
                        self.store.as_ref(),
                        self.activation_generation,
                        post_id,
                        error,
                    );
                }
            },
            None => None,
        };
        self.ensure_current().map_err(MobileError::social)?;
        let decrypted = match decrypt_text_projection(
            self.session.as_ref(),
            self.store.as_ref(),
            post_id,
            &response,
            sender_key.as_ref(),
        ) {
            Ok(decrypted) => decrypted,
            Err(error) => {
                self.ensure_current().map_err(MobileError::social)?;
                return persist_private_read_error(
                    self.store.as_ref(),
                    self.activation_generation,
                    post_id,
                    error,
                );
            }
        };
        self.ensure_current().map_err(MobileError::social)?;
        let generation = decrypted
            .projection
            .generation
            .parse::<u64>()
            .map_err(|_| MobileError::social("private Social receiver generation is invalid"))?;
        self.store
            .commit_receiver_projection(
                self.activation_generation,
                &decrypted.projection.content_id,
                generation,
                &decrypted.projection.post_id,
                decrypted.content_key.as_bytes(),
                decrypted.consumed_prekey_id.as_deref(),
                &decrypted.projection.encode().map_err(MobileError::social)?,
            )
            .map_err(MobileError::social)?;
        Ok(decrypted.projection)
    }

    fn open_media<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        activation_generation: u64,
        post_id: &str,
        object_id: &str,
    ) -> MobileResult<PrivateMomentReadProjection> {
        self.ensure_activation_generation(activation_generation)
            .map_err(MobileError::social)?;
        if post_id.trim().is_empty()
            || post_id != post_id.trim()
            || object_id.trim().is_empty()
            || object_id != object_id.trim()
        {
            return Err(MobileError::social(
                "private Social media identity is invalid",
            ));
        }
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| MobileError::social("private Social operation lock poisoned"))?;
        self.ensure_current().map_err(MobileError::social)?;
        let transport =
            NativeSocialTransport::new(self.session.clone()).map_err(MobileError::social)?;
        let response = match transport.get_private_moment(post_id) {
            Ok(response) => response,
            Err(error) => {
                let projection = handle_transport_read_error(
                    self.store.as_ref(),
                    self.activation_generation,
                    post_id,
                    &error,
                )?;
                if purges_private_material(&projection.state) {
                    purge_private_moment_media_cache(
                        app,
                        &self.session.scope.station_peer_id,
                        &self.session.scope.actor_ptid,
                    )?;
                }
                return Ok(projection);
            }
        };
        let mut decrypted = self
            .decrypt_response(post_id, &response, &transport)
            .map_err(MobileError::social)?;
        let resource = response
            .resource
            .as_ref()
            .and_then(|resource| match resource.body.as_ref() {
                Some(social_wire::post_resource::Body::PrivateContent(private)) => Some(private),
                _ => None,
            })
            .ok_or_else(|| MobileError::social("private Social media resource is unavailable"))?;
        let metadata = attachment_for_object(&decrypted.plaintext, object_id)
            .ok_or_else(|| MobileError::social("private Social media metadata is unavailable"))?;
        let descriptor = resource
            .objects
            .iter()
            .find(|descriptor| descriptor.object_id == object_id)
            .ok_or_else(|| MobileError::social("private Social media descriptor is unavailable"))?;
        let generation = decrypted
            .projection
            .generation
            .parse::<u64>()
            .map_err(|_| MobileError::social("private Social receiver generation is invalid"))?;
        self.store
            .commit_receiver_projection(
                activation_generation,
                &decrypted.projection.content_id,
                generation,
                &decrypted.projection.post_id,
                decrypted.content_key.as_bytes(),
                decrypted.consumed_prekey_id.as_deref(),
                &decrypted.projection.encode().map_err(MobileError::social)?,
            )
            .map_err(MobileError::social)?;
        let mut transport_failure = None;
        let materialized = materialize_private_moment_media(
            app,
            &self.session.scope.station_peer_id,
            &self.session.scope.actor_ptid,
            metadata,
            descriptor,
            |_, start, end, descriptor_sha256| {
                transport
                    .download_private_object_chunk(object_id, descriptor_sha256, start, end)
                    .map_err(|error| {
                        transport_failure = Some(error.clone());
                        error.to_string()
                    })
            },
        );
        let (state, local_path, plaintext_sha256, plaintext_size, error_code) = match materialized {
            Ok(path) => (
                PrivateMediaState::MediaReady,
                Some(path),
                Some(B64.encode(&metadata.plaintext_sha256)),
                Some(metadata.plaintext_size),
                None,
            ),
            Err(error) => {
                let state = match transport_failure.as_ref() {
                    Some(failure) if matches!(failure.http_status, Some(401 | 403 | 404)) => {
                        PrivateMediaState::MediaAccessDenied
                    }
                    Some(failure) if transport_error_is_retryable(failure) => {
                        PrivateMediaState::MediaOfflineRetryable
                    }
                    _ => PrivateMediaState::MediaIntegrityFailure,
                };
                if state == PrivateMediaState::MediaAccessDenied {
                    purge_private_moment_media_cache(
                        app,
                        &self.session.scope.station_peer_id,
                        &self.session.scope.actor_ptid,
                    )?;
                }
                (state, None, None, None, Some(error.to_string()))
            }
        };
        set_media_projection(
            &mut decrypted.projection,
            object_id,
            state,
            local_path,
            plaintext_sha256,
            plaintext_size,
            error_code,
        )
        .map_err(MobileError::social)?;
        self.store
            .commit_receiver_projection(
                activation_generation,
                &decrypted.projection.content_id,
                generation,
                &decrypted.projection.post_id,
                decrypted.content_key.as_bytes(),
                None,
                &decrypted.projection.encode().map_err(MobileError::social)?,
            )
            .map_err(MobileError::social)?;
        Ok(decrypted.projection)
    }

    fn store_recovery_phrase(
        &self,
        activation_generation: u64,
        recovery_epoch: u64,
        phrase: &str,
    ) -> Result<(), String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.ensure_activation_generation(activation_generation)?;
        self.ensure_current()?;
        store_recovery_phrase(
            self.store.as_ref(),
            &self.session.scope.actor_ptid,
            recovery_epoch,
            phrase,
        )
    }

    fn recover_text(
        &self,
        activation_generation: u64,
        post_id: &str,
    ) -> MobileResult<PrivateMomentReadProjection> {
        self.ensure_activation_generation(activation_generation)
            .map_err(MobileError::social)?;
        if post_id.trim().is_empty() || post_id != post_id.trim() {
            return Err(MobileError::social("private Social post ID is invalid"));
        }
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| MobileError::social("private Social operation lock poisoned"))?;
        self.ensure_current().map_err(MobileError::social)?;
        let transport =
            NativeSocialTransport::new(self.session.clone()).map_err(MobileError::social)?;
        let mut cursor = String::new();
        loop {
            let recoverable = match transport.list_recoverable(&cursor, 100) {
                Ok(recoverable) => recoverable,
                Err(error) => {
                    return handle_transport_read_error(
                        self.store.as_ref(),
                        self.activation_generation,
                        post_id,
                        &error,
                    )
                }
            };
            self.ensure_current().map_err(MobileError::social)?;
            for item in recoverable.resources {
                let matches_post = item
                    .locator
                    .as_ref()
                    .and_then(|locator| locator.resource.as_ref())
                    .is_some_and(|resource| {
                        matches!(
                            resource,
                            social_wire::social_private_content_locator::Resource::PostId(id)
                                if id == post_id
                        )
                    });
                if !matches_post {
                    continue;
                }
                let envelope = match item.recovery_envelope.as_ref() {
                    Some(envelope) => envelope,
                    None => {
                        return persist_terminal_read_projection(
                            self.store.as_ref(),
                            self.activation_generation,
                            post_id,
                            recovery_key_unavailable_projection(post_id),
                        );
                    }
                };
                if self
                    .store
                    .recovery_master(&self.session.scope.actor_ptid, envelope.principal_epoch)
                    .map_err(MobileError::social)?
                    .is_none()
                {
                    return persist_terminal_read_projection(
                        self.store.as_ref(),
                        self.activation_generation,
                        post_id,
                        recovery_key_unavailable_projection(post_id),
                    );
                }
                let point = match transport.get_private_moment(post_id) {
                    Ok(point) => point,
                    Err(error) => {
                        return handle_transport_read_error(
                            self.store.as_ref(),
                            self.activation_generation,
                            post_id,
                            &error,
                        )
                    }
                };
                let point_payload =
                    point
                        .resource
                        .as_ref()
                        .and_then(|resource| match resource.body.as_ref() {
                            Some(social_wire::post_resource::Body::PrivateContent(private)) => {
                                private.payload.as_ref()
                            }
                            _ => None,
                        });
                if point_payload.is_none_or(|payload| {
                    item.resource.as_ref() != payload.resource.as_ref()
                        || item.payload_ciphertext_sha256 != payload.ciphertext_sha256
                }) {
                    return persist_private_read_failure(
                        self.store.as_ref(),
                        self.activation_generation,
                        post_id,
                        PrivateReadFailureKind::IntegrityFailure,
                    );
                }
                let requirement =
                    sender_key_requirement(post_id, &point).map_err(MobileError::social)?;
                let binding = envelope.binding.as_ref().ok_or_else(|| {
                    MobileError::social("private Social recovery binding is missing")
                })?;
                let sender_key = match transport.sender_signing_key(
                    &requirement.sender,
                    &binding.sender_signing_key_id,
                    requirement.committed_at_unix_ms,
                ) {
                    Ok(key) => key,
                    Err(error) => {
                        return handle_sender_key_error(
                            self.store.as_ref(),
                            self.activation_generation,
                            post_id,
                            error,
                        )
                    }
                };
                let decrypted = match decrypt_text_projection_with_recovery(
                    self.session.as_ref(),
                    self.store.as_ref(),
                    post_id,
                    &point,
                    envelope,
                    &sender_key,
                ) {
                    Ok(decrypted) => decrypted,
                    Err(error) => {
                        return persist_private_read_error(
                            self.store.as_ref(),
                            self.activation_generation,
                            post_id,
                            error,
                        )
                    }
                };
                let generation = decrypted
                    .projection
                    .generation
                    .parse::<u64>()
                    .map_err(|_| {
                        MobileError::social("private Social recovery generation is invalid")
                    })?;
                self.store
                    .commit_receiver_projection(
                        self.activation_generation,
                        &decrypted.projection.content_id,
                        generation,
                        &decrypted.projection.post_id,
                        decrypted.content_key.as_bytes(),
                        None,
                        &decrypted.projection.encode().map_err(MobileError::social)?,
                    )
                    .map_err(MobileError::social)?;
                return Ok(decrypted.projection);
            }
            if !recoverable.has_more {
                return match transport.get_private_moment(post_id) {
                    Ok(_) => persist_terminal_read_projection(
                        self.store.as_ref(),
                        self.activation_generation,
                        post_id,
                        recovery_key_unavailable_projection(post_id),
                    ),
                    Err(error) => handle_transport_read_error(
                        self.store.as_ref(),
                        self.activation_generation,
                        post_id,
                        &error,
                    ),
                };
            }
            if recoverable.next_cursor.trim().is_empty() || recoverable.next_cursor == cursor {
                return Err(MobileError::social(
                    "private Social recovery pagination did not advance",
                ));
            }
            cursor = recoverable.next_cursor;
        }
    }

    fn snapshot(&self, activation_generation: u64) -> Result<PrivateSocialSnapshot, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.ensure_activation_generation(activation_generation)?;
        self.ensure_current()?;
        let publish_projections = self
            .store
            .projections()?
            .into_iter()
            .map(|projection| PrivateMomentProjection::decode(&projection))
            .collect::<Result<Vec<_>, _>>()?;
        let read_projections = self
            .store
            .read_projections()?
            .into_iter()
            .map(|projection| PrivateMomentReadProjection::decode(&projection))
            .collect::<Result<Vec<_>, _>>()?;
        let comment_drafts = self
            .store
            .comment_drafts()?
            .iter()
            .map(private_comment_draft_projection)
            .collect::<Result<Vec<_>, _>>()?;
        let comments = self
            .store
            .all_comment_projections()?
            .iter()
            .map(|projection| PrivateCommentProjection::decode(projection))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(PrivateSocialSnapshot {
            publish_projections,
            read_projections,
            comment_drafts,
            comments,
        })
    }

    fn ensure_current(&self) -> Result<(), String> {
        self.store
            .ensure_session_generation(self.activation_generation)
    }

    fn ensure_activation_generation(&self, expected: u64) -> Result<(), String> {
        if expected == self.activation_generation {
            Ok(())
        } else {
            Err("private Social activation generation is stale".to_string())
        }
    }

    fn invalidate(&self) -> Result<(), String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "private Social operation lock poisoned".to_string())?;
        self.store
            .invalidate_session_generation(self.activation_generation)
    }
}

struct ActivePrivateSocialRuntime {
    engine: Arc<PrivateSocialEngine>,
    activation_generation: u64,
}

#[derive(Default)]
pub struct MobilePrivateSocialRuntime {
    active: Mutex<Option<ActivePrivateSocialRuntime>>,
    activation_lock: Mutex<()>,
    next_activation_generation: AtomicU64,
}

impl MobilePrivateSocialRuntime {
    fn activate(
        &self,
        data_root: &Path,
        storage: &SecureStorage,
        identity: SecureContentRuntimeIdentity,
    ) -> MobileResult<PrivateSocialRuntimeStatus> {
        let _activation = self
            .activation_lock
            .lock()
            .map_err(|_| MobileError::social("private Social activation lock poisoned"))?;
        let scope = PrivateSocialScope {
            profile_id: private_social_profile_id(
                &identity.scope.station_peer_id,
                &identity.scope.actor_ptid,
            ),
            station_peer_id: identity.scope.station_peer_id,
            station_origin: identity.scope.station_origin,
            actor_ptid: identity.scope.actor_ptid,
            device_id: identity.scope.device_id,
        };
        let trusted_station_signing_key =
            resolve_trusted_station_signing_key(&scope, identity.access_token.as_str(), storage)
                .map_err(MobileError::social)?;
        let jwt_session_id =
            jwt_session_id(identity.access_token.as_str()).map_err(MobileError::social)?;
        let database_key =
            load_or_create_database_key(storage, &scope.profile_id).map_err(MobileError::social)?;
        let database_path = private_social_database_path(data_root, &scope.profile_id)
            .map_err(MobileError::social)?;
        let generation = allocate_activation_generation(&self.next_activation_generation)
            .map_err(MobileError::social)?;
        let store = PrivateSocialStore::open(
            &database_path,
            &database_key,
            &scope.station_peer_id,
            &scope.actor_ptid,
        )
        .map_err(MobileError::social)?;
        store
            .bind_session_generation(generation)
            .map_err(MobileError::social)?;
        let session = NativeSocialSession::new(
            scope,
            identity.access_token,
            jwt_session_id,
            identity.signing_key_id,
            identity.profile_version,
            identity.device_signing_key,
            trusted_station_signing_key,
        )
        .map_err(MobileError::social)?;
        let engine = Arc::new(
            PrivateSocialEngine::new(session, store, generation).map_err(MobileError::social)?,
        );
        let status = status_for_engine(&engine, generation);
        let mut active = self
            .active
            .lock()
            .map_err(|_| MobileError::social("private Social runtime lock poisoned"))?;
        if !candidate_activation_is_newer(
            active.as_ref().map(|runtime| runtime.activation_generation),
            generation,
        ) {
            engine.invalidate().map_err(MobileError::social)?;
            return Err(MobileError::social(
                "private Social activation generation is stale",
            ));
        }
        if let Some(previous) = active.as_ref() {
            previous.engine.invalidate().map_err(MobileError::social)?;
        }
        *active = Some(ActivePrivateSocialRuntime {
            engine,
            activation_generation: generation,
        });
        Ok(status)
    }

    fn active_engine_at_generation(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
        activation_generation: u64,
    ) -> MobileResult<Arc<PrivateSocialEngine>> {
        let active = self
            .active
            .lock()
            .map_err(|_| MobileError::social("private Social runtime lock poisoned"))?;
        let runtime = active
            .as_ref()
            .ok_or_else(|| MobileError::social("private Social runtime is not active"))?;
        require_active_scope(
            &runtime.engine.session.scope.station_peer_id,
            &runtime.engine.session.scope.actor_ptid,
            runtime.activation_generation,
            station_peer_id,
            actor_ptid,
            activation_generation,
        )?;
        Ok(runtime.engine.clone())
    }

    fn status(&self) -> MobileResult<PrivateSocialRuntimeStatus> {
        let active = self
            .active
            .lock()
            .map_err(|_| MobileError::social("private Social runtime lock poisoned"))?;
        Ok(active
            .as_ref()
            .map(|runtime| status_for_engine(&runtime.engine, runtime.activation_generation))
            .unwrap_or_else(PrivateSocialRuntimeStatus::inactive))
    }

    fn teardown(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
        activation_generation: u64,
    ) -> MobileResult<PrivateSocialRuntimeStatus> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| MobileError::social("private Social runtime lock poisoned"))?;
        if let Some(runtime) = active.as_ref() {
            require_active_scope(
                &runtime.engine.session.scope.station_peer_id,
                &runtime.engine.session.scope.actor_ptid,
                runtime.activation_generation,
                station_peer_id,
                actor_ptid,
                activation_generation,
            )?;
            runtime.engine.invalidate().map_err(MobileError::social)?;
        }
        *active = None;
        Ok(PrivateSocialRuntimeStatus::inactive())
    }
}

#[tauri::command]
pub fn social_private_activate<R: Runtime>(
    app: AppHandle<R>,
    social: State<'_, MobilePrivateSocialRuntime>,
    messaging: State<'_, MobileMessagingRuntime>,
    storage: State<'_, SecureStorage>,
    input: PrivateSocialActivationInput,
) -> MobileResult<PrivateSocialRuntimeStatus> {
    let identity =
        messaging.secure_content_runtime_identity(&input.station_peer_id, &input.actor_ptid)?;
    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|error| MobileError::social(format!("resolve Mobile data directory: {error}")))?;
    social.activate(&data_root, &storage, identity)
}

#[tauri::command]
pub fn social_private_status(
    social: State<'_, MobilePrivateSocialRuntime>,
) -> MobileResult<PrivateSocialRuntimeStatus> {
    social.status()
}

#[tauri::command]
pub fn social_private_publish_text(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialPublishTextInput,
) -> MobileResult<PrivateMomentProjection> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .publish_text(input.activation_generation, &input.intent)
        .map_err(MobileError::social)
}

#[tauri::command]
pub fn social_private_publish<R: Runtime>(
    app: AppHandle<R>,
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialPublishInput,
) -> MobileResult<PrivateMomentProjection> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .publish_moment(&app, input.activation_generation, &input.intent)
        .map_err(MobileError::social)
}

#[tauri::command]
pub fn social_private_read_text<R: Runtime>(
    app: AppHandle<R>,
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialReadTextInput,
) -> MobileResult<PrivateMomentReadProjection> {
    let projection = social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .read_text(input.activation_generation, &input.post_id)?;
    if purges_private_material(&projection.state) {
        purge_private_moment_media_cache(&app, &input.station_peer_id, &input.actor_ptid)?;
    }
    Ok(projection)
}

#[tauri::command]
pub fn social_private_read<R: Runtime>(
    app: AppHandle<R>,
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialReadTextInput,
) -> MobileResult<PrivateMomentReadProjection> {
    let projection = social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .read_text(input.activation_generation, &input.post_id)?;
    if purges_private_material(&projection.state) {
        purge_private_moment_media_cache(&app, &input.station_peer_id, &input.actor_ptid)?;
    }
    Ok(projection)
}

#[tauri::command]
pub fn social_private_open_media<R: Runtime>(
    app: AppHandle<R>,
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialOpenMediaInput,
) -> MobileResult<PrivateMomentReadProjection> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .open_media(
            &app,
            input.activation_generation,
            &input.post_id,
            &input.object_id,
        )
}

#[tauri::command]
pub fn social_private_store_recovery_phrase(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialRecoveryPhraseInput,
) -> MobileResult<()> {
    let recovery_phrase = Zeroizing::new(input.recovery_phrase);
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .store_recovery_phrase(
            input.activation_generation,
            input.recovery_epoch,
            recovery_phrase.as_str(),
        )
        .map_err(MobileError::social)
}

#[tauri::command]
pub fn social_private_recover_text(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialRecoverTextInput,
) -> MobileResult<PrivateMomentReadProjection> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .recover_text(input.activation_generation, &input.post_id)
}

#[tauri::command]
pub fn social_private_recover(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialRecoverTextInput,
) -> MobileResult<PrivateMomentReadProjection> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .recover_text(input.activation_generation, &input.post_id)
}

#[tauri::command]
pub fn social_private_comment_submit(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialCommentInput,
) -> MobileResult<PrivateCommentSubmitResult> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .submit_comment(input.activation_generation, &input.intent)
        .map_err(MobileError::social)
}

#[tauri::command]
pub fn social_private_comments(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialCommentListInput,
) -> MobileResult<PrivateCommentPage> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .list_comments(
            input.activation_generation,
            &input.post_id,
            &input.cursor,
            input.limit,
        )
        .map_err(MobileError::social)
}

#[tauri::command]
pub fn social_private_reconcile(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialAccountInput,
) -> MobileResult<PrivateSocialWorkerReport> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .reconcile(input.activation_generation)
        .map_err(MobileError::social)
}

#[tauri::command]
pub fn social_private_snapshot(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialAccountInput,
) -> MobileResult<PrivateSocialSnapshot> {
    social
        .active_engine_at_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.activation_generation,
        )?
        .snapshot(input.activation_generation)
        .map_err(MobileError::social)
}

#[tauri::command]
pub fn social_private_teardown<R: Runtime>(
    app: AppHandle<R>,
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialAccountInput,
) -> MobileResult<PrivateSocialRuntimeStatus> {
    let status = social.teardown(
        &input.station_peer_id,
        &input.actor_ptid,
        input.activation_generation,
    )?;
    purge_private_moment_media_cache(&app, &input.station_peer_id, &input.actor_ptid)?;
    Ok(status)
}

fn initial_recovery_epoch() -> u64 {
    INITIAL_SECURE_CONTENT_RECOVERY_EPOCH
}

fn default_comment_limit() -> u32 {
    20
}

fn status_for_engine(engine: &PrivateSocialEngine, generation: u64) -> PrivateSocialRuntimeStatus {
    PrivateSocialRuntimeStatus {
        active: true,
        profile_id: Some(engine.session.scope.profile_id.clone()),
        station_peer_id: Some(engine.session.scope.station_peer_id.clone()),
        actor_ptid: Some(engine.session.scope.actor_ptid.clone()),
        device_id: Some(engine.session.scope.device_id.clone()),
        activation_generation: generation,
        worker_mode: "on_demand",
    }
}

fn require_active_scope(
    active_station_peer_id: &str,
    active_actor_ptid: &str,
    active_generation: u64,
    station_peer_id: &str,
    actor_ptid: &str,
    activation_generation: u64,
) -> MobileResult<()> {
    if active_station_peer_id != station_peer_id || active_actor_ptid != actor_ptid {
        return Err(MobileError::social(
            "private Social account scope does not match the active runtime",
        ));
    }
    if activation_generation != active_generation {
        return Err(MobileError::social(
            "private Social activation generation is stale",
        ));
    }
    Ok(())
}

fn allocate_activation_generation(counter: &AtomicU64) -> Result<u64, String> {
    counter
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |generation| {
            generation.checked_add(1)
        })
        .map(|generation| generation + 1)
        .map_err(|_| "private Social activation generation overflow".to_string())
}

fn candidate_activation_is_newer(active_generation: Option<u64>, candidate: u64) -> bool {
    candidate != 0 && active_generation.is_none_or(|active| candidate > active)
}

fn handle_transport_read_error(
    store: &PrivateSocialStore,
    activation_generation: u64,
    post_id: &str,
    error: &TransportError,
) -> MobileResult<PrivateMomentReadProjection> {
    if let Some(projection) = terminal_projection_for_transport_error(post_id, error) {
        return persist_terminal_read_projection(store, activation_generation, post_id, projection);
    }
    if transport_error_is_retryable(error) {
        return Err(MobileError::social_retryable(error.to_string()));
    }
    Err(MobileError::social(error.to_string()))
}

fn handle_sender_key_error(
    store: &PrivateSocialStore,
    activation_generation: u64,
    post_id: &str,
    error: SenderSigningKeyError,
) -> MobileResult<PrivateMomentReadProjection> {
    match error.kind {
        SenderSigningKeyErrorKind::Retryable => {
            Err(MobileError::social_retryable(error.to_string()))
        }
        SenderSigningKeyErrorKind::Integrity => persist_private_read_failure(
            store,
            activation_generation,
            post_id,
            PrivateReadFailureKind::IntegrityFailure,
        ),
    }
}

fn persist_private_read_error(
    store: &PrivateSocialStore,
    activation_generation: u64,
    post_id: &str,
    error: PrivateReadError,
) -> MobileResult<PrivateMomentReadProjection> {
    if error.kind == PrivateReadFailureKind::Retryable {
        return Err(MobileError::social_retryable(error.to_string()));
    }
    persist_private_read_failure(store, activation_generation, post_id, error.kind)
}

fn persist_private_read_failure(
    store: &PrivateSocialStore,
    activation_generation: u64,
    post_id: &str,
    failure: PrivateReadFailureKind,
) -> MobileResult<PrivateMomentReadProjection> {
    let projection = projection_for_read_failure(post_id, failure)
        .ok_or_else(|| MobileError::social_retryable("private Social read is retryable"))?;
    persist_terminal_read_projection(store, activation_generation, post_id, projection)
}

fn persist_terminal_read_projection(
    store: &PrivateSocialStore,
    activation_generation: u64,
    post_id: &str,
    projection: PrivateMomentReadProjection,
) -> MobileResult<PrivateMomentReadProjection> {
    store
        .persist_receiver_failure(
            activation_generation,
            post_id,
            &projection.encode().map_err(MobileError::social)?,
            purges_private_material(&projection.state),
        )
        .map_err(MobileError::social)?;
    Ok(projection)
}

fn private_social_profile_id(station_peer_id: &str, actor_ptid: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(station_peer_id.as_bytes());
    hasher.update([0x1f]);
    hasher.update(actor_ptid.as_bytes());
    hex(&hasher.finalize())
}

fn private_social_database_path(data_root: &Path, profile_id: &str) -> Result<PathBuf, String> {
    let directory = data_root.join("secure-content").join("social");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("create private Social data directory: {error}"))?;
    Ok(directory.join(format!("{profile_id}.sqlite3")))
}

fn load_or_create_database_key(
    storage: &SecureStorage,
    profile_id: &str,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let key_name = format!("{DATABASE_KEY_PREFIX}.{profile_id}");
    if let Some(encoded) = storage.get(&key_name).map_err(|error| error.to_string())? {
        let decoded = B64
            .decode(encoded.trim())
            .map_err(|_| "private Social database key is malformed".to_string())?;
        let key = decoded.try_into().map_err(|value: Vec<u8>| {
            format!(
                "private Social database key has invalid length: {}",
                value.len()
            )
        })?;
        return Ok(Zeroizing::new(key));
    }
    let mut key = Zeroizing::new([0; 32]);
    OsRng.fill_bytes(key.as_mut());
    storage
        .set(&key_name, &B64.encode(key.as_slice()))
        .map_err(|error| error.to_string())?;
    Ok(key)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_with_ready_receiver_projection() -> PrivateSocialStore {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();
        store
            .commit_receiver_projection(
                1,
                "post-1",
                2,
                "post-1",
                &[9; 32],
                None,
                br#"{"postId":"post-1","contentId":"post-1","generation":"2","authorPtid":"ptid:bob","audienceKind":"FRIENDS","state":"CONTENT_READY","content":{"kind":"TEXT","text":"cached"}}"#,
            )
            .unwrap();
        store
    }

    #[test]
    fn private_social_profile_is_scoped_to_station_and_actor() {
        assert_eq!(
            private_social_profile_id("station-1", "ptid:alice"),
            private_social_profile_id("station-1", "ptid:alice")
        );
        assert_ne!(
            private_social_profile_id("station-1", "ptid:alice"),
            private_social_profile_id("station-2", "ptid:alice")
        );
        assert_ne!(
            private_social_profile_id("station-1", "ptid:alice"),
            private_social_profile_id("station-1", "ptid:bob")
        );
    }

    #[test]
    fn retryable_read_transport_error_preserves_cached_receiver_material() {
        let store = store_with_ready_receiver_projection();
        let before = store.read_projection("post-1").unwrap().unwrap();
        let error = TransportError {
            http_status: Some(503),
            stable_code: 1,
            typed_error: false,
            retry_after_seconds: Some(2),
            disposition: crate::secure_content::transport::TransportDisposition::UnknownOutcome,
        };

        let result = handle_transport_read_error(&store, 1, "post-1", &error);

        assert_eq!(result.unwrap_err().code, "MOBILE_PRIVATE_SOCIAL_RETRYABLE");
        assert_eq!(store.read_projection("post-1").unwrap().unwrap(), before);
        assert_eq!(store.content_root("post-1", 2).unwrap(), Some([9; 32]));
    }

    #[test]
    fn retryable_sender_key_error_preserves_cached_receiver_material() {
        let store = store_with_ready_receiver_projection();
        let before = store.read_projection("post-1").unwrap().unwrap();
        let error = SenderSigningKeyError::retryable(
            "DESIGN_AMENDMENT_REQUIRED: retained remote key surface",
        );

        let result = handle_sender_key_error(&store, 1, "post-1", error);

        assert_eq!(result.unwrap_err().code, "MOBILE_PRIVATE_SOCIAL_RETRYABLE");
        assert_eq!(store.read_projection("post-1").unwrap().unwrap(), before);
        assert_eq!(store.content_root("post-1", 2).unwrap(), Some([9; 32]));
    }

    #[test]
    fn untyped_proxy_terminal_statuses_preserve_cached_receiver_material() {
        for status in [401, 403, 404, 410] {
            let store = store_with_ready_receiver_projection();
            let before = store.read_projection("post-1").unwrap().unwrap();
            let error = TransportError {
                http_status: Some(status),
                stable_code: if status == 401 {
                    crate::secure_content::proto::error::v1::ErrorCode::Unauthorized as i32
                } else {
                    crate::secure_content::proto::error::v1::ErrorCode::PostNotFound as i32
                },
                typed_error: false,
                retry_after_seconds: None,
                disposition: crate::secure_content::transport::TransportDisposition::Terminal,
            };

            assert!(handle_transport_read_error(&store, 1, "post-1", &error).is_err());
            assert_eq!(store.read_projection("post-1").unwrap().unwrap(), before);
            assert_eq!(store.content_root("post-1", 2).unwrap(), Some([9; 32]));
        }
    }

    #[test]
    fn trusted_unauthorized_replaces_projection_without_purging_cached_root() {
        let store = store_with_ready_receiver_projection();
        let error = TransportError {
            http_status: Some(401),
            stable_code: crate::secure_content::proto::error::v1::ErrorCode::Unauthorized as i32,
            typed_error: true,
            retry_after_seconds: None,
            disposition: crate::secure_content::transport::TransportDisposition::Terminal,
        };

        let projection = handle_transport_read_error(&store, 1, "post-1", &error).unwrap();

        assert_eq!(
            projection.state,
            crate::secure_content::receiver::PrivateReadState::AuthenticationRequired
        );
        assert_eq!(store.content_root("post-1", 2).unwrap(), Some([9; 32]));
        let persisted =
            PrivateMomentReadProjection::decode(&store.read_projection("post-1").unwrap().unwrap())
                .unwrap();
        assert_eq!(persisted, projection);
    }

    #[test]
    fn integrity_failure_replaces_projection_without_purging_cached_root() {
        let store = store_with_ready_receiver_projection();

        let projection = persist_private_read_failure(
            &store,
            1,
            "post-1",
            PrivateReadFailureKind::IntegrityFailure,
        )
        .unwrap();

        assert_eq!(
            projection.state,
            crate::secure_content::receiver::PrivateReadState::IntegrityFailure
        );
        assert_eq!(store.content_root("post-1", 2).unwrap(), Some([9; 32]));
        let persisted =
            PrivateMomentReadProjection::decode(&store.read_projection("post-1").unwrap().unwrap())
                .unwrap();
        assert_eq!(persisted, projection);
    }

    #[test]
    fn recovery_key_unavailable_preserves_cached_receiver_material() {
        let store = store_with_ready_receiver_projection();

        let projection = persist_terminal_read_projection(
            &store,
            1,
            "post-1",
            recovery_key_unavailable_projection("post-1"),
        )
        .unwrap();

        assert_eq!(
            projection.state,
            crate::secure_content::receiver::PrivateReadState::RecoveryKeyUnavailable
        );
        assert_eq!(store.content_root("post-1", 2).unwrap(), Some([9; 32]));
    }

    #[test]
    fn trusted_post_not_found_replaces_and_purges_cached_receiver_material() {
        let store = store_with_ready_receiver_projection();
        let error = TransportError {
            http_status: Some(404),
            stable_code: crate::secure_content::proto::error::v1::ErrorCode::PostNotFound as i32,
            typed_error: true,
            retry_after_seconds: None,
            disposition: crate::secure_content::transport::TransportDisposition::Terminal,
        };

        let projection = handle_transport_read_error(&store, 1, "post-1", &error).unwrap();

        assert_eq!(
            projection.state,
            crate::secure_content::receiver::PrivateReadState::NotFoundOrNotAuthorized
        );
        assert!(store.content_root("post-1", 2).unwrap().is_none());
        let persisted =
            PrivateMomentReadProjection::decode(&store.read_projection("post-1").unwrap().unwrap())
                .unwrap();
        assert_eq!(persisted, projection);
    }

    #[test]
    fn same_ptid_stale_activation_generation_is_rejected() {
        let error =
            require_active_scope("station-1", "ptid:alice", 2, "station-1", "ptid:alice", 1)
                .unwrap_err();

        assert_eq!(error.code, "MOBILE_PRIVATE_SOCIAL");
        assert!(error.message.contains("generation is stale"));
    }

    #[test]
    fn concurrent_activation_generation_allocation_is_unique_and_monotonic() {
        let counter = Arc::new(AtomicU64::new(0));
        let mut threads = Vec::new();
        for _ in 0..32 {
            let counter = counter.clone();
            threads.push(std::thread::spawn(move || {
                allocate_activation_generation(&counter).unwrap()
            }));
        }
        let mut generations = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>();
        generations.sort_unstable();

        assert_eq!(generations, (1..=32).collect::<Vec<_>>());
    }

    #[test]
    fn older_activation_cannot_replace_a_newer_generation() {
        assert!(candidate_activation_is_newer(None, 1));
        assert!(candidate_activation_is_newer(Some(1), 2));
        assert!(!candidate_activation_is_newer(Some(2), 2));
        assert!(!candidate_activation_is_newer(Some(2), 1));
    }
}
