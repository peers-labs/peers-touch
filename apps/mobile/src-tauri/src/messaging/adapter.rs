use std::path::Path;
use std::sync::{Arc, Mutex};

use messaging_core::attachment::{
    upload_commitment_fields, validate_attachment_transfer_record, AttachmentTransferRecord,
    AttachmentTransferRepository,
};
use messaging_core::contracts::CryptoEndpoint;
use messaging_core::contracts::{
    ActorReadReceiveCommit, CommandStatusProjection, ConversationMessageProjection,
    ConversationProjection, ConversationStateReceiveCommit, DeliveryReceiptReceiveCommit,
    DirectEditCommit, DirectReceiveCommit, InteractionMutation, InteractionReceiveCommit,
    MlsApplicationReceiveCommit, MlsConversationProjection, MlsRetirementReceiveCommit,
    MlsSenderTransitionReceiveCommit, MlsTransitionReceiveCommit, PendingMlsKeyPackage,
    PendingMlsTransitionState, PublicEventReceiveCommit, ReceiveCommitResult,
};
use messaging_core::crypto::double_ratchet::{DrSessionState, DrSkippedMessageKey};
use messaging_core::crypto::prekeys::{PendingPreKeyBundle, PreKeyRepository};
use messaging_core::crypto::session::{DirectSession, DirectSessionKey};
use messaging_core::identity::{
    DeviceEnrollmentRepository, DeviceSigningKey, FreshDeviceEnrollment, FreshDeviceIdentityState,
    MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION,
};
use messaging_core::outbox::{
    CommandOutboxEntry, MetadataInteractionCommit, MetadataInteractionRepository, OutboxStore,
};
use messaging_core::proto::chat::{
    AttachmentPlaintextMetadata, AttachmentTransferState, DeviceConsumptionReceipt,
    EncryptedObjectDescriptor, EncryptedObjectUploadSpec,
};
use messaging_core::store::{
    migrate_messaging_schema, DirectOutboundEditCommit, DirectOutboundRepository,
    DirectOutboundSendCommit, DirectOutboundSession, DirectSessionAdvance, MessagingRepository,
    MessagingSchemaBackend, MlsInboundRepository, MlsKeyPackageRepository, MlsOutboundEditCommit,
    MlsOutboundRepository, MlsOutboundSendCommit, MlsStartupRepository, MlsTransitionRepository,
    MlsTransitionSendCommit, PendingSenderProjection,
};
use prost::Message;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};

struct RusqliteMessagingSchema<'a>(&'a Connection);

impl MessagingSchemaBackend for RusqliteMessagingSchema<'_> {
    fn execute_batch(&self, sql: &str) -> Result<(), String> {
        self.0.execute_batch(sql).map_err(|error| error.to_string())
    }

    fn table_columns(&self, table: &str) -> Result<Vec<String>, String> {
        self.0
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|error| error.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    fn table_exists(&self, table: &str) -> Result<bool, String> {
        self.0
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
                 )",
                params![table],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    fn query_i64(&self, sql: &str) -> Result<i64, String> {
        self.0
            .query_row(sql, [], |row| row.get(0))
            .map_err(|error| error.to_string())
    }

    fn migrate_legacy_attachment_rows(&self) -> Result<(), String> {
        for table in [
            "messaging_pending_attachments",
            "messaging_message_attachments",
        ] {
            if !self.table_exists(table)? {
                continue;
            }
            let mut statement = self
                .0
                .prepare(&format!(
                    "SELECT message_id, metadata_bytes FROM {table} ORDER BY message_id, attachment_id"
                ))
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            for (message_id, bytes) in rows {
                let metadata = messaging_core::proto::chat::AttachmentPlaintextMetadata::decode(
                    bytes.as_slice(),
                )
                .map_err(|_| {
                    "legacy Mobile messaging attachment metadata is invalid".to_string()
                })?;
                persist_received_message_attachments(self.0, &message_id, &[metadata])?;
            }
        }
        Ok(())
    }
}

pub struct MobileMessagingStore {
    connection: Mutex<Connection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingMessageDraft {
    pub conversation_id: String,
    pub conversation_kind: i32,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub reply_to_message_id: String,
    pub thread_root_message_id: String,
    pub attachments: Vec<messaging_core::proto::chat::AttachmentPlaintextMetadata>,
    pub attempt_count: u32,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingAttachmentUpload {
    pub(crate) transfer: AttachmentTransferRecord,
    pub(crate) filename: String,
    pub(crate) mime_type: String,
    pub(crate) plaintext_sha256: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttachmentDownloadProjection {
    pub(crate) conversation_id: String,
    pub(crate) message_id: String,
    pub(crate) authority_station_id: String,
    pub(crate) metadata: AttachmentPlaintextMetadata,
    pub(crate) local_cache_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompletedSenderAttachmentSource {
    pub(crate) attachment_id: String,
    pub(crate) message_id: String,
    pub(crate) source_local_ref: String,
    pub(crate) plaintext_sha256: Vec<u8>,
    pub(crate) local_cache_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SupersededInteractionIntent {
    pub command_id: String,
    pub conversation_id: String,
    pub target_message_id: String,
    pub interaction_kind: String,
    pub edited_text: Option<String>,
    pub command_bytes: Vec<u8>,
    pub created_at_unix_ms: i64,
}

impl MobileMessagingStore {
    pub fn open(path: &Path, key: &[u8; 32]) -> Result<Self, String> {
        let connection = Connection::open(path)
            .map_err(|error| format!("open mobile messaging SQLCipher store: {error}"))?;
        connection
            .pragma_update(None, "key", format!("x'{}'", hex_bytes(key)))
            .map_err(|error| format!("unlock mobile messaging SQLCipher store: {error}"))?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self, String> {
        Self::from_connection(Connection::open_in_memory().map_err(|error| error.to_string())?)
    }

    pub fn active_device_signing_identity(
        &self,
    ) -> Result<(FreshDeviceEnrollment, DeviceSigningKey), String> {
        let enrollment = DeviceEnrollmentRepository::device_enrollment(self)?
            .ok_or_else(|| "mobile messaging device identity is unavailable".to_string())?;
        let certificate = &enrollment.certificate;
        let device = certificate
            .device
            .as_ref()
            .ok_or_else(|| "mobile messaging device identity has no endpoint".to_string())?;
        let seed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT identity.device_signing_seed
                 FROM messaging_device_identity AS identity
                 JOIN messaging_recovery_state AS recovery ON recovery.id = identity.id
                 WHERE identity.id = 1 AND recovery.status = 'active'",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "mobile messaging active device signing identity is unavailable".to_string()
            })?;
        let signing_key = DeviceSigningKey::from_parts(
            &fixed_key("device signing seed", seed)?,
            ed25519_dalek::Signature::from_bytes(&enrollment.actor_cross_signature),
            device.device_id.clone(),
        );
        if signing_key.verifying_key().as_bytes()
            != certificate.device_signing_public_key.as_slice()
        {
            return Err("mobile messaging device signing key continuity mismatch".to_string());
        }
        Ok((enrollment, signing_key))
    }

    fn from_connection(connection: Connection) -> Result<Self, String> {
        migrate_messaging_schema(&RusqliteMessagingSchema(&connection))?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub(crate) fn reconcile_conversation_authority_scope(
        &self,
        conversation_id: &str,
        authority_station_id: &str,
        federation_id: &str,
    ) -> Result<bool, String> {
        if conversation_id.trim().is_empty()
            || authority_station_id.trim().is_empty()
            || federation_id.trim().is_empty()
        {
            return Err("mobile messaging conversation authority scope is incomplete".to_string());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let existing = connection
            .query_row(
                "SELECT authority_station_id, federation_id
                 FROM messaging_conversations
                 WHERE conversation_id = ?1",
                params![conversation_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((stored_authority, stored_federation)) = existing else {
            return Ok(false);
        };
        if (!stored_authority.is_empty() && stored_authority != authority_station_id)
            || (!stored_federation.is_empty() && stored_federation != federation_id)
        {
            return Err(
                "mobile messaging conversation authority scope conflicts with Station".to_string(),
            );
        }
        let changed = connection
            .execute(
                "UPDATE messaging_conversations
                 SET authority_station_id = ?2, federation_id = ?3
                 WHERE conversation_id = ?1
                   AND (authority_station_id = '' OR federation_id = '')",
                params![conversation_id, authority_station_id, federation_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(changed == 1)
    }

    fn with_transaction<T>(
        &self,
        operation: impl FnOnce(&Transaction<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let result = operation(&transaction)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(result)
    }

    pub(crate) fn create_message_draft_with_uploads(
        &self,
        draft: &PendingMessageDraft,
        uploads: &[PendingAttachmentUpload],
    ) -> Result<(), String> {
        if uploads.is_empty()
            || !draft.attachments.is_empty()
            || draft.conversation_id.trim().is_empty()
            || draft.conversation_kind <= 0
            || draft.message_id.trim().is_empty()
            || draft.sender_ptid.trim().is_empty()
            || draft.sender_device_id.trim().is_empty()
            || draft.created_at_unix_ms <= 0
        {
            return Err("mobile messaging attachment draft intent is incomplete".to_string());
        }
        let mut previous_attachment_id: Option<&str> = None;
        for upload in uploads {
            validate_attachment_transfer_record(&upload.transfer)?;
            if upload.transfer.conversation_id != draft.conversation_id
                || upload.transfer.message_id != draft.message_id
                || upload.transfer.direction != 1
                || upload.transfer.state != AttachmentTransferState::Queued as i32
                || upload.filename.trim().is_empty()
                || upload.filename.len() > 1024
                || upload.mime_type.trim().is_empty()
                || upload.mime_type.len() > 255
                || upload.plaintext_sha256.len() != 32
                || previous_attachment_id
                    .is_some_and(|previous| previous >= upload.transfer.attachment_id.as_str())
            {
                return Err("mobile messaging staged attachment is invalid".to_string());
            }
            previous_attachment_id = Some(upload.transfer.attachment_id.as_str());
        }

        self.with_transaction(|transaction| {
            let changed = transaction
                .execute(
                    "INSERT INTO messaging_pending_messages(
                        conversation_id, conversation_kind, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        reply_to_message_id, thread_root_message_id, state,
                        attempt_count, next_attempt_at_unix_ms, last_error_code,
                        created_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', 0, ?9, '', ?9)
                     ON CONFLICT(conversation_id, message_id) DO NOTHING",
                    params![
                        draft.conversation_id,
                        draft.conversation_kind,
                        draft.message_id,
                        draft.sender_ptid,
                        draft.sender_device_id,
                        draft.plaintext,
                        draft.reply_to_message_id,
                        draft.thread_root_message_id,
                        draft.created_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err("mobile messaging draft identity already exists".to_string());
            }
            for upload in uploads {
                let transfer = &upload.transfer;
                let generation = i64::try_from(transfer.generation)
                    .map_err(|_| "mobile messaging attachment generation overflow")?;
                let plaintext_size = i64::try_from(transfer.plaintext_size)
                    .map_err(|_| "mobile messaging attachment plaintext size overflow")?;
                transaction
                    .execute(
                        "INSERT INTO messaging_attachment_drafts(
                            attachment_id, conversation_id, message_id, filename,
                            mime_type, plaintext_sha256, descriptor_bytes,
                            created_at_unix_ms
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
                        params![
                            transfer.attachment_id,
                            transfer.conversation_id,
                            transfer.message_id,
                            upload.filename,
                            upload.mime_type,
                            upload.plaintext_sha256,
                            draft.created_at_unix_ms,
                        ],
                    )
                    .map_err(|error| error.to_string())?;
                transaction
                    .execute(
                        "INSERT INTO messaging_attachment_transfers(
                            attachment_id, conversation_id, message_id, authority_station_id,
                            direction, state, upload_id, generation, descriptor_sha256,
                            completed_chunk_bitmap, source_local_ref, partial_local_ref,
                            object_key, base_nonce, plaintext_size, chunk_size, attempt_count,
                            next_attempt_at_unix_ms, last_error_code, updated_at_unix_ms
                         ) VALUES (
                            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                            ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
                         )",
                        params![
                            transfer.attachment_id,
                            transfer.conversation_id,
                            transfer.message_id,
                            transfer.authority_station_id,
                            transfer.direction,
                            transfer.state,
                            transfer.upload_id,
                            generation,
                            transfer.descriptor_sha256,
                            transfer.completed_chunk_bitmap,
                            transfer.source_local_ref,
                            transfer.partial_local_ref,
                            transfer.object_key,
                            transfer.base_nonce,
                            plaintext_size,
                            transfer.chunk_size,
                            transfer.attempt_count,
                            transfer.next_attempt_at_unix_ms,
                            transfer.last_error_code,
                            transfer.updated_at_unix_ms,
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    pub(crate) fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[AttachmentPlaintextMetadata],
    ) -> Result<(), String> {
        for attachment in attachments {
            messaging_core::codec::private_content::validate_attachment_plaintext_metadata(
                attachment,
            )?;
            let object = attachment
                .object
                .as_ref()
                .ok_or_else(|| "mobile messaging attachment descriptor is missing".to_string())?;
            let upload_spec = EncryptedObjectUploadSpec {
                ciphertext_size: object.ciphertext_size,
                ciphertext_sha256: object.ciphertext_sha256.clone(),
                media_type: object.media_type.clone(),
                chunk_size: object.chunk_size,
                chunk_count: object.chunk_count,
                encryption_suite: object.encryption_suite,
                tag_size: object.tag_size,
                nonce_strategy: object.nonce_strategy,
                chunk_ciphertext_sha256: object.chunk_ciphertext_sha256.clone(),
            };
            let transfer = self
                .attachment_transfer(&attachment.attachment_id)?
                .ok_or_else(|| {
                    "mobile messaging attachment is not durably complete for send".to_string()
                })?;
            let descriptor_commitment = upload_commitment_fields(
                conversation_id,
                message_id,
                &attachment.attachment_id,
                &transfer.authority_station_id,
                &upload_spec,
            );
            let bitmap_complete = transfer.completed_chunk_bitmap.len()
                == object.chunk_count.div_ceil(8) as usize
                && (0..object.chunk_count).all(|chunk_index| {
                    transfer.completed_chunk_bitmap[chunk_index as usize / 8]
                        & (1 << (chunk_index % 8))
                        != 0
                });
            if transfer.conversation_id != conversation_id
                || transfer.message_id != message_id
                || transfer.direction != 1
                || transfer.state != AttachmentTransferState::Complete as i32
                || transfer.descriptor_sha256 != descriptor_commitment
                || transfer.object_key != attachment.object_key
                || transfer.base_nonce != attachment.base_nonce
                || transfer.plaintext_size != attachment.plaintext_size
                || transfer.chunk_size != object.chunk_size
                || !bitmap_complete
            {
                return Err(
                    "mobile messaging attachment is not durably complete for send".to_string(),
                );
            }
        }
        Ok(())
    }

    pub(crate) fn create_attachment_transfer(
        &self,
        transfer: &AttachmentTransferRecord,
    ) -> Result<bool, String> {
        validate_attachment_transfer_record(transfer)?;
        let generation = i64::try_from(transfer.generation)
            .map_err(|_| "mobile messaging attachment generation overflow")?;
        let plaintext_size = i64::try_from(transfer.plaintext_size)
            .map_err(|_| "mobile messaging attachment plaintext size overflow")?;
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "INSERT INTO messaging_attachment_transfers(
                    attachment_id, conversation_id, message_id, authority_station_id,
                    direction, state, upload_id, generation, descriptor_sha256,
                    completed_chunk_bitmap, source_local_ref, partial_local_ref,
                    object_key, base_nonce, plaintext_size, chunk_size, attempt_count,
                    next_attempt_at_unix_ms, last_error_code, updated_at_unix_ms
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
                 )
                 ON CONFLICT(attachment_id) DO NOTHING",
                params![
                    transfer.attachment_id,
                    transfer.conversation_id,
                    transfer.message_id,
                    transfer.authority_station_id,
                    transfer.direction,
                    transfer.state,
                    transfer.upload_id,
                    generation,
                    transfer.descriptor_sha256,
                    transfer.completed_chunk_bitmap,
                    transfer.source_local_ref,
                    transfer.partial_local_ref,
                    transfer.object_key,
                    transfer.base_nonce,
                    plaintext_size,
                    transfer.chunk_size,
                    transfer.attempt_count,
                    transfer.next_attempt_at_unix_ms,
                    transfer.last_error_code,
                    transfer.updated_at_unix_ms,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            return Ok(true);
        }
        let existing = self
            .attachment_transfer(&transfer.attachment_id)?
            .ok_or_else(|| {
                "mobile messaging attachment transfer conflict is unavailable".to_string()
            })?;
        if existing != *transfer {
            return Err("mobile messaging attachment transfer identity conflict".to_string());
        }
        Ok(false)
    }

    pub(crate) fn replace_completed_upload_with_download(
        &self,
        download: &AttachmentTransferRecord,
    ) -> Result<(), String> {
        validate_attachment_transfer_record(download)?;
        if download.direction != 2
            || download.state != AttachmentTransferState::Queued as i32
            || download.generation != 0
            || !download.upload_id.is_empty()
            || download.descriptor_sha256 != vec![0; 32]
            || download
                .completed_chunk_bitmap
                .iter()
                .any(|byte| *byte != 0)
            || !download.source_local_ref.is_empty()
        {
            return Err("mobile messaging attachment download replacement is invalid".to_string());
        }
        let plaintext_size = i64::try_from(download.plaintext_size)
            .map_err(|_| "mobile messaging attachment plaintext size overflow")?;
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_attachment_transfers
                 SET direction = 2,
                     state = ?2,
                     upload_id = '',
                     generation = 0,
                     descriptor_sha256 = zeroblob(32),
                     completed_chunk_bitmap = ?3,
                     source_local_ref = '',
                     partial_local_ref = ?4,
                     attempt_count = 0,
                     next_attempt_at_unix_ms = ?5,
                     last_error_code = 0,
                     updated_at_unix_ms = ?5
                 WHERE attachment_id = ?1
                   AND conversation_id = ?6
                   AND message_id = ?7
                   AND authority_station_id = ?8
                   AND direction = 1
                   AND state = ?9
                   AND object_key = ?10
                   AND base_nonce = ?11
                   AND plaintext_size = ?12
                   AND chunk_size = ?13",
                params![
                    download.attachment_id,
                    AttachmentTransferState::Queued as i32,
                    download.completed_chunk_bitmap,
                    download.partial_local_ref,
                    download.updated_at_unix_ms,
                    download.conversation_id,
                    download.message_id,
                    download.authority_station_id,
                    AttachmentTransferState::Complete as i32,
                    download.object_key,
                    download.base_nonce,
                    plaintext_size,
                    download.chunk_size,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err(
                "mobile messaging completed upload could not become a download".to_string(),
            );
        }
        Ok(())
    }

    pub(crate) fn attachment_transfer(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentTransferRecord>, String> {
        if attachment_id.trim().is_empty() {
            return Err("mobile messaging attachment ID is required".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT attachment_id, conversation_id, message_id, authority_station_id,
                        direction, state, upload_id, generation, descriptor_sha256,
                        completed_chunk_bitmap, source_local_ref, partial_local_ref,
                        object_key, base_nonce, plaintext_size, chunk_size, attempt_count,
                        next_attempt_at_unix_ms, last_error_code, updated_at_unix_ms
                 FROM messaging_attachment_transfers
                 WHERE attachment_id = ?1",
                params![attachment_id],
                attachment_transfer_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn attachment_download_projection(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentDownloadProjection>, String> {
        if attachment_id.trim().is_empty() {
            return Err("mobile messaging attachment ID is required".to_string());
        }
        let projection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT message.conversation_id, attachment.message_id,
                        conversation.authority_station_id,
                        attachment.filename, attachment.mime_type,
                        attachment.plaintext_size, attachment.plaintext_sha256,
                        attachment.object_key, attachment.base_nonce,
                        attachment.descriptor_bytes, attachment.local_cache_path
                 FROM messaging_attachment_projections attachment
                 JOIN messaging_message_projections message
                   ON message.message_id = attachment.message_id
                 JOIN messaging_conversations conversation
                   ON conversation.conversation_id = message.conversation_id
                 WHERE attachment.attachment_id = ?1",
                params![attachment_id],
                |row| {
                    let descriptor_bytes = row.get::<_, Vec<u8>>(9)?;
                    let object = EncryptedObjectDescriptor::decode(descriptor_bytes.as_slice())
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                descriptor_bytes.len(),
                                rusqlite::types::Type::Blob,
                                Box::new(error),
                            )
                        })?;
                    Ok(AttachmentDownloadProjection {
                        conversation_id: row.get(0)?,
                        message_id: row.get(1)?,
                        authority_station_id: row.get(2)?,
                        metadata: AttachmentPlaintextMetadata {
                            attachment_id: attachment_id.to_string(),
                            filename: row.get(3)?,
                            mime_type: row.get(4)?,
                            plaintext_size: row.get::<_, i64>(5)?.try_into().map_err(|error| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    8,
                                    rusqlite::types::Type::Integer,
                                    Box::new(error),
                                )
                            })?,
                            plaintext_sha256: row.get(6)?,
                            object_key: row.get(7)?,
                            base_nonce: row.get(8)?,
                            object: Some(object),
                        },
                        local_cache_path: row.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(projection) = projection.as_ref() {
            messaging_core::codec::private_content::validate_attachment_plaintext_metadata(
                &projection.metadata,
            )?;
            if projection.conversation_id.trim().is_empty()
                || projection.message_id.trim().is_empty()
                || projection.authority_station_id.trim().is_empty()
            {
                return Err(
                    "mobile messaging attachment download projection is incomplete".to_string(),
                );
            }
        }
        Ok(projection)
    }

    pub(crate) fn attachment_availability_state(
        &self,
        attachment_id: &str,
    ) -> Result<Option<String>, String> {
        if attachment_id.trim().is_empty() {
            return Err("mobile messaging attachment ID is required".to_string());
        }
        let state = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT availability_state
                 FROM messaging_attachment_projections
                 WHERE attachment_id = ?1",
                params![attachment_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if state
            .as_deref()
            .is_some_and(|value| !matches!(value, "remote" | "local"))
        {
            return Err("mobile messaging attachment availability state is invalid".to_string());
        }
        Ok(state)
    }

    pub(crate) fn completed_sender_attachment_source(
        &self,
        attachment_id: &str,
    ) -> Result<Option<CompletedSenderAttachmentSource>, String> {
        if attachment_id.trim().is_empty() {
            return Err("mobile messaging attachment ID is required".to_string());
        }
        let source = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT transfer.attachment_id, transfer.message_id,
                        transfer.source_local_ref, attachment.plaintext_sha256,
                        attachment.local_cache_path
                 FROM messaging_attachment_transfers transfer
                 JOIN messaging_attachment_projections attachment
                   ON attachment.attachment_id = transfer.attachment_id
                  AND attachment.message_id = transfer.message_id
                 WHERE transfer.attachment_id = ?1
                   AND transfer.direction = 1
                   AND transfer.state = ?2
                   AND transfer.source_local_ref <> ''",
                params![attachment_id, AttachmentTransferState::Complete as i32],
                |row| {
                    Ok(CompletedSenderAttachmentSource {
                        attachment_id: row.get(0)?,
                        message_id: row.get(1)?,
                        source_local_ref: row.get(2)?,
                        plaintext_sha256: row.get(3)?,
                        local_cache_path: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if source.as_ref().is_some_and(|value| {
            value.attachment_id.trim().is_empty()
                || value.message_id.trim().is_empty()
                || value.source_local_ref.trim().is_empty()
                || value.plaintext_sha256.len() != 32
        }) {
            return Err(
                "mobile messaging completed sender attachment source is incomplete".to_string(),
            );
        }
        Ok(source)
    }

    pub(crate) fn owns_attachment_source(&self, source_local_ref: &str) -> Result<bool, String> {
        if source_local_ref.trim().is_empty() {
            return Err("mobile messaging attachment source is required".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM messaging_attachment_transfers
                    WHERE direction = 1 AND source_local_ref = ?1
                 )",
                params![source_local_ref],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn attachment_upload_media_type(
        &self,
        attachment_id: &str,
    ) -> Result<String, String> {
        if attachment_id.trim().is_empty() {
            return Err("mobile messaging attachment ID is required".to_string());
        }
        let media_type = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT mime_type FROM messaging_attachment_drafts
                 WHERE attachment_id = ?1",
                params![attachment_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        Ok(media_type.unwrap_or_else(|| "application/octet-stream".to_string()))
    }

    pub(crate) fn next_due_attachment_upload(
        &self,
        now_unix_ms: i64,
    ) -> Result<Option<String>, String> {
        self.next_due_attachment(now_unix_ms, 1)
    }

    pub(crate) fn next_due_attachment_download(
        &self,
        now_unix_ms: i64,
    ) -> Result<Option<String>, String> {
        self.next_due_attachment(now_unix_ms, 2)
    }

    fn next_due_attachment(
        &self,
        now_unix_ms: i64,
        direction: i32,
    ) -> Result<Option<String>, String> {
        if now_unix_ms <= 0 {
            return Err("mobile messaging attachment retry time is invalid".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT attachment_id
                 FROM messaging_attachment_transfers
                 WHERE direction = ?1
                   AND state IN (?2, ?3, ?4)
                   AND next_attempt_at_unix_ms <= ?5
                 ORDER BY next_attempt_at_unix_ms ASC,
                          updated_at_unix_ms ASC,
                          attachment_id ASC
                 LIMIT 1",
                params![
                    direction,
                    AttachmentTransferState::Queued as i32,
                    AttachmentTransferState::Transferring as i32,
                    AttachmentTransferState::RetryWait as i32,
                    now_unix_ms,
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn next_attachment_retry_at(&self) -> Result<Option<i64>, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT MIN(next_attempt_at_unix_ms)
                 FROM messaging_attachment_transfers
                 WHERE state IN (?1, ?2, ?3)",
                params![
                    AttachmentTransferState::Queued as i32,
                    AttachmentTransferState::Transferring as i32,
                    AttachmentTransferState::RetryWait as i32,
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn completed_attachment_sources(
        &self,
    ) -> Result<Vec<CompletedSenderAttachmentSource>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT transfer.attachment_id, transfer.message_id,
                        transfer.source_local_ref, attachment.plaintext_sha256,
                        attachment.local_cache_path
                 FROM messaging_attachment_transfers transfer
                 JOIN messaging_attachment_projections attachment
                   ON attachment.attachment_id = transfer.attachment_id
                  AND attachment.message_id = transfer.message_id
                 JOIN messaging_message_projections message
                   ON message.message_id = transfer.message_id
                  AND message.conversation_id = transfer.conversation_id
                 WHERE transfer.direction = 1
                   AND transfer.state = ?1
                   AND transfer.source_local_ref <> ''
                   AND NOT EXISTS (
                       SELECT 1 FROM messaging_pending_messages pending
                       WHERE pending.conversation_id = transfer.conversation_id
                         AND pending.message_id = transfer.message_id
                   )
                 ORDER BY transfer.attachment_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![AttachmentTransferState::Complete as i32], |row| {
                Ok(CompletedSenderAttachmentSource {
                    attachment_id: row.get(0)?,
                    message_id: row.get(1)?,
                    source_local_ref: row.get(2)?,
                    plaintext_sha256: row.get(3)?,
                    local_cache_path: row.get(4)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        if rows.iter().any(|source| {
            source.attachment_id.trim().is_empty()
                || source.message_id.trim().is_empty()
                || source.source_local_ref.trim().is_empty()
                || source.plaintext_sha256.len() != 32
        }) {
            return Err(
                "mobile messaging completed sender attachment source is incomplete".to_string(),
            );
        }
        Ok(rows)
    }

    pub(crate) fn promote_completed_upload_cache(
        &self,
        source: &CompletedSenderAttachmentSource,
        cache_path: &str,
    ) -> Result<(), String> {
        if source.attachment_id.trim().is_empty()
            || source.message_id.trim().is_empty()
            || source.source_local_ref.trim().is_empty()
            || source.plaintext_sha256.len() != 32
            || cache_path.trim().is_empty()
        {
            return Err("mobile messaging sender cache promotion is incomplete".to_string());
        }
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_attachment_projections
                 SET availability_state = 'local', local_cache_path = ?2
                 WHERE attachment_id = ?1
                   AND message_id = ?3
                   AND plaintext_sha256 = ?4
                   AND (local_cache_path IS NULL OR local_cache_path = ?2)
                   AND EXISTS (
                       SELECT 1 FROM messaging_attachment_transfers transfer
                       WHERE transfer.attachment_id = ?1
                         AND transfer.message_id = ?3
                         AND transfer.direction = 1
                         AND transfer.state = ?5
                         AND transfer.source_local_ref = ?6
                   )",
                params![
                    source.attachment_id,
                    cache_path,
                    source.message_id,
                    source.plaintext_sha256,
                    AttachmentTransferState::Complete as i32,
                    source.source_local_ref,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging sender cache promotion was not fenced".to_string());
        }
        Ok(())
    }

    pub(crate) fn clear_completed_attachment_source(
        &self,
        source: &CompletedSenderAttachmentSource,
        cache_path: &str,
    ) -> Result<(), String> {
        if source.attachment_id.trim().is_empty()
            || source.message_id.trim().is_empty()
            || source.source_local_ref.trim().is_empty()
            || source.plaintext_sha256.len() != 32
            || cache_path.trim().is_empty()
        {
            return Err("mobile messaging attachment source cleanup is incomplete".to_string());
        }
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_attachment_transfers
                 SET source_local_ref = ''
                 WHERE attachment_id = ?1
                   AND direction = 1
                   AND state = ?2
                   AND source_local_ref = ?3
                   AND NOT EXISTS (
                       SELECT 1 FROM messaging_pending_messages pending
                       WHERE pending.conversation_id =
                             messaging_attachment_transfers.conversation_id
                         AND pending.message_id =
                             messaging_attachment_transfers.message_id
                   )
                   AND EXISTS (
                       SELECT 1 FROM messaging_attachment_projections attachment
                       WHERE attachment.attachment_id = ?1
                         AND attachment.message_id = ?4
                         AND attachment.plaintext_sha256 = ?5
                         AND attachment.availability_state = 'local'
                         AND attachment.local_cache_path = ?6
                   )",
                params![
                    source.attachment_id,
                    AttachmentTransferState::Complete as i32,
                    source.source_local_ref,
                    source.message_id,
                    source.plaintext_sha256,
                    cache_path,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging attachment source cleanup was not fenced".to_string());
        }
        Ok(())
    }

    pub(crate) fn reconcile_completed_attachment_uploads(&self) -> Result<usize, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_attachment_transfers AS transfer
                 SET state = ?1,
                     next_attempt_at_unix_ms = 0,
                     last_error_code = 0
                 WHERE transfer.direction = 1
                   AND transfer.state != ?1
                   AND EXISTS (
                     SELECT 1
                     FROM messaging_attachment_drafts AS draft
                     WHERE draft.attachment_id = transfer.attachment_id
                       AND draft.message_id = transfer.message_id
                       AND draft.descriptor_bytes IS NOT NULL
                   )",
                params![AttachmentTransferState::Complete as i32],
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn complete_attachment_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        messaging_core::attachment::validate_encrypted_object_descriptor(descriptor)?;
        validate_attachment_transfer_record(transfer)?;
        if updated_at_unix_ms <= 0 {
            return Err("mobile messaging attachment completion time is invalid".to_string());
        }
        let upload_spec = EncryptedObjectUploadSpec {
            ciphertext_size: descriptor.ciphertext_size,
            ciphertext_sha256: descriptor.ciphertext_sha256.clone(),
            media_type: descriptor.media_type.clone(),
            chunk_size: descriptor.chunk_size,
            chunk_count: descriptor.chunk_count,
            encryption_suite: descriptor.encryption_suite,
            tag_size: descriptor.tag_size,
            nonce_strategy: descriptor.nonce_strategy,
            chunk_ciphertext_sha256: descriptor.chunk_ciphertext_sha256.clone(),
        };
        let expected_commitment = upload_commitment_fields(
            &transfer.conversation_id,
            &transfer.message_id,
            &transfer.attachment_id,
            &transfer.authority_station_id,
            &upload_spec,
        );
        if transfer.descriptor_sha256 != expected_commitment {
            return Err("mobile messaging attachment completion descriptor mismatch".to_string());
        }
        let generation = i64::try_from(transfer.generation)
            .map_err(|_| "mobile messaging attachment generation overflow")?;
        self.with_transaction(|transaction| {
            let draft_media_type = transaction
                .query_row(
                    "SELECT mime_type FROM messaging_attachment_drafts
                     WHERE attachment_id = ?1
                       AND conversation_id = ?2
                       AND message_id = ?3",
                    params![
                        transfer.attachment_id,
                        transfer.conversation_id,
                        transfer.message_id
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let mime_type = draft_media_type
                .as_deref()
                .unwrap_or(descriptor.media_type.as_str());
            if mime_type != descriptor.media_type {
                return Err(
                    "mobile messaging attachment completion media type mismatch".to_string()
                );
            }
            let transfer_changed = transaction
                .execute(
                    "UPDATE messaging_attachment_transfers
                     SET state = ?2,
                         upload_id = ?3,
                         generation = ?4,
                         completed_chunk_bitmap = ?5,
                         attempt_count = ?6,
                         next_attempt_at_unix_ms = 0,
                         last_error_code = 0,
                         updated_at_unix_ms = ?7
                     WHERE attachment_id = ?1
                       AND descriptor_sha256 = ?8
                       AND state IN (?9, ?10)",
                    params![
                        transfer.attachment_id,
                        AttachmentTransferState::Complete as i32,
                        transfer.upload_id,
                        generation,
                        transfer.completed_chunk_bitmap,
                        transfer.attempt_count,
                        updated_at_unix_ms,
                        expected_commitment.as_slice(),
                        AttachmentTransferState::Transferring as i32,
                        AttachmentTransferState::Verifying as i32,
                    ],
                )
                .map_err(|error| error.to_string())?;
            let descriptor_bytes = descriptor.encode_to_vec();
            let draft_changed = transaction
                .execute(
                    "UPDATE messaging_attachment_drafts
                     SET descriptor_bytes = ?2
                     WHERE attachment_id = ?1
                       AND (descriptor_bytes IS NULL OR descriptor_bytes = ?2)",
                    params![transfer.attachment_id, descriptor_bytes],
                )
                .map_err(|error| error.to_string())?;
            let draft_fenced = match draft_media_type {
                Some(_) => draft_changed == 1,
                None => draft_changed == 0,
            };
            if transfer_changed != 1 || !draft_fenced {
                return Err("mobile messaging attachment completion was not fenced".to_string());
            }
            Ok(())
        })
    }

    pub(crate) fn complete_attachment_download(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        messaging_core::attachment::validate_encrypted_object_descriptor(descriptor)?;
        validate_attachment_transfer_record(transfer)?;
        if transfer.direction != 2
            || cache_path.trim().is_empty()
            || updated_at_unix_ms <= 0
            || transfer.completed_chunk_bitmap.len() != descriptor.chunk_count.div_ceil(8) as usize
            || !(0..descriptor.chunk_count).all(|chunk_index| {
                transfer.completed_chunk_bitmap[chunk_index as usize / 8] & (1 << (chunk_index % 8))
                    != 0
            })
        {
            return Err(
                "mobile messaging attachment download completion is incomplete".to_string(),
            );
        }
        let descriptor_bytes = descriptor.encode_to_vec();
        let descriptor_sha256: [u8; 32] = Sha256::digest(&descriptor_bytes).into();
        if transfer.descriptor_sha256 != descriptor_sha256 {
            return Err("mobile messaging attachment download descriptor mismatch".to_string());
        }
        let generation = i64::try_from(transfer.generation)
            .map_err(|_| "mobile messaging attachment generation overflow")?;
        self.with_transaction(|transaction| {
            let projection_exists = transaction
                .query_row(
                    "SELECT 1 FROM messaging_attachment_projections
                     WHERE attachment_id = ?1
                       AND message_id = ?2
                       AND descriptor_bytes = ?3",
                    params![
                        transfer.attachment_id,
                        transfer.message_id,
                        descriptor_bytes
                    ],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .is_some();
            let transfer_changed = transaction
                .execute(
                    "UPDATE messaging_attachment_transfers
                     SET state = ?2,
                         completed_chunk_bitmap = ?3,
                         attempt_count = ?4,
                         next_attempt_at_unix_ms = 0,
                         last_error_code = 0,
                         updated_at_unix_ms = ?5
                     WHERE attachment_id = ?1
                       AND direction = 2
                       AND generation = ?6
                       AND descriptor_sha256 = ?7
                       AND state IN (?8, ?9, ?10, ?11)",
                    params![
                        transfer.attachment_id,
                        AttachmentTransferState::Complete as i32,
                        transfer.completed_chunk_bitmap,
                        transfer.attempt_count,
                        updated_at_unix_ms,
                        generation,
                        descriptor_sha256.as_slice(),
                        AttachmentTransferState::Queued as i32,
                        AttachmentTransferState::Transferring as i32,
                        AttachmentTransferState::Verifying as i32,
                        AttachmentTransferState::Complete as i32,
                    ],
                )
                .map_err(|error| error.to_string())?;
            let projection_changed = transaction
                .execute(
                    "UPDATE messaging_attachment_projections
                     SET availability_state = 'local', local_cache_path = ?2
                     WHERE attachment_id = ?1
                       AND message_id = ?3
                       AND descriptor_bytes = ?4",
                    params![
                        transfer.attachment_id,
                        cache_path,
                        transfer.message_id,
                        descriptor_bytes
                    ],
                )
                .map_err(|error| error.to_string())?;
            if transfer_changed != 1 || projection_changed != usize::from(projection_exists) {
                return Err(
                    "mobile messaging attachment download completion was not fenced".to_string(),
                );
            }
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update_attachment_transfer_progress(
        &self,
        attachment_id: &str,
        state: i32,
        upload_id: &str,
        generation: u64,
        completed_chunk_bitmap: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        last_error_code: i32,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        if attachment_id.trim().is_empty()
            || state <= 0
            || completed_chunk_bitmap.is_empty()
            || next_attempt_at_unix_ms < 0
            || updated_at_unix_ms <= 0
        {
            return Err("mobile messaging attachment progress is incomplete".to_string());
        }
        let generation = i64::try_from(generation)
            .map_err(|_| "mobile messaging attachment generation overflow")?;
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_attachment_transfers
                 SET state = ?2,
                     upload_id = ?3,
                     generation = ?4,
                     completed_chunk_bitmap = ?5,
                     attempt_count = ?6,
                     next_attempt_at_unix_ms = ?7,
                     last_error_code = ?8,
                     updated_at_unix_ms = ?9
                 WHERE attachment_id = ?1",
                params![
                    attachment_id,
                    state,
                    upload_id,
                    generation,
                    completed_chunk_bitmap,
                    attempt_count,
                    next_attempt_at_unix_ms,
                    last_error_code,
                    updated_at_unix_ms,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging attachment progress target is unavailable".to_string());
        }
        Ok(())
    }

    pub(crate) fn update_attachment_transfer_prepared(
        &self,
        attachment_id: &str,
        descriptor_sha256: &[u8],
        partial_local_ref: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        if attachment_id.trim().is_empty()
            || descriptor_sha256.len() != 32
            || partial_local_ref.trim().is_empty()
            || updated_at_unix_ms <= 0
        {
            return Err("mobile messaging attachment preparation is incomplete".to_string());
        }
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_attachment_transfers
                 SET descriptor_sha256 = ?2,
                     partial_local_ref = ?3,
                     updated_at_unix_ms = ?4
                 WHERE attachment_id = ?1
                   AND (descriptor_sha256 = zeroblob(32) OR descriptor_sha256 = ?2)",
                params![
                    attachment_id,
                    descriptor_sha256,
                    partial_local_ref,
                    updated_at_unix_ms,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging attachment descriptor commitment changed".to_string());
        }
        Ok(())
    }

    pub(crate) fn load_mls_actor_identity(
        &self,
    ) -> Result<Option<(String, String, Vec<u8>)>, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT ptid, device_id, identity_state
                 FROM messaging_mls_actor_identity WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn save_mls_actor_identity(
        &self,
        ptid: &str,
        device_id: &str,
        identity_state: &[u8],
    ) -> Result<(), String> {
        if ptid.trim().is_empty() || device_id.trim().is_empty() || identity_state.is_empty() {
            return Err("mobile messaging MLS actor-device identity is incomplete".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "INSERT INTO messaging_mls_actor_identity(
                    id, ptid, device_id, identity_state
                 ) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET
                    ptid=excluded.ptid,
                    device_id=excluded.device_id,
                    identity_state=excluded.identity_state",
                params![ptid, device_id, identity_state],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn command_status(
        &self,
        command_id: &str,
    ) -> Result<Option<CommandStatusProjection>, String> {
        if command_id.trim().is_empty() {
            return Err("mobile messaging command status requires command ID".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT command_id, conversation_id, state, last_error_code
                 FROM messaging_command_outbox
                 WHERE command_id = ?1",
                params![command_id],
                |row| {
                    Ok(CommandStatusProjection {
                        command_id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        state: row.get(2)?,
                        last_error_code: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn message_sender(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<Option<String>, String> {
        if conversation_id.trim().is_empty() || message_id.trim().is_empty() {
            return Err("mobile messaging projection identity is required".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT sender_ptid
                 FROM messaging_message_projections
                 WHERE conversation_id = ?1 AND message_id = ?2",
                params![conversation_id, message_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn conversation_authority_station_id(
        &self,
        conversation_id: &str,
    ) -> Result<String, String> {
        if conversation_id.trim().is_empty() {
            return Err("mobile messaging conversation ID is required".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT authority_station_id
                 FROM messaging_conversations
                 WHERE conversation_id = ?1 AND active = 1",
                params![conversation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .filter(|authority_station_id| !authority_station_id.trim().is_empty())
            .ok_or_else(|| "mobile messaging conversation authority is unavailable".to_string())
    }

    pub fn conversation_message_projections(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        if conversation_id.trim().is_empty() {
            return Err("mobile messaging projection conversation ID is required".to_string());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "WITH conversation_messages AS (
                    SELECT event_id, event_sequence, message_id,
                           sender_ptid, sender_device_id, plaintext,
                           delivery_state, committed_at_unix_ms,
                           reply_to_message_id, thread_root_message_id,
                           edited_text, edited_at_unix_ms, retracted,
                           0 AS pending_rank
                    FROM messaging_message_projections
                    WHERE conversation_id = ?1
                    UNION ALL
                    SELECT NULL, NULL, pending.message_id,
                           pending.sender_ptid, pending.sender_device_id,
                           pending.plaintext, pending.state, pending.created_at_unix_ms,
                           NULLIF(pending.reply_to_message_id, ''),
                           NULLIF(pending.thread_root_message_id, ''),
                           NULL, NULL, 0,
                           1
                    FROM messaging_pending_messages pending
                    WHERE pending.conversation_id = ?1
                      AND NOT EXISTS (
                          SELECT 1 FROM messaging_message_projections committed
                          WHERE committed.conversation_id = pending.conversation_id
                            AND committed.message_id = pending.message_id
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM messaging_attachment_drafts attachment
                          WHERE attachment.message_id = pending.message_id
                            AND attachment.descriptor_bytes IS NULL
                      )
                 )
                 SELECT event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms,
                        reply_to_message_id, thread_root_message_id,
                        edited_text, edited_at_unix_ms, retracted
                 FROM conversation_messages
                 ORDER BY pending_rank ASC,
                          event_sequence ASC,
                          committed_at_unix_ms ASC,
                          message_id ASC",
            )
            .map_err(|error| error.to_string())?;
        let mut messages = statement
            .query_map(params![conversation_id], conversation_message_from_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        enrich_message_projections(&connection, conversation_id, &mut messages)?;
        Ok(messages)
    }

    pub fn thread_message_projections(
        &self,
        conversation_id: &str,
        thread_root_message_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        if conversation_id.trim().is_empty() || thread_root_message_id.trim().is_empty() {
            return Err("mobile messaging thread projection identity is required".to_string());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "WITH thread_messages AS (
                    SELECT event_id, event_sequence, message_id,
                           sender_ptid, sender_device_id, plaintext,
                           delivery_state, committed_at_unix_ms,
                           reply_to_message_id, thread_root_message_id,
                           edited_text, edited_at_unix_ms, retracted,
                           CASE WHEN message_id = ?2 THEN 0 ELSE 1 END AS root_rank,
                           0 AS pending_rank
                    FROM messaging_message_projections
                    WHERE conversation_id = ?1
                      AND (message_id = ?2 OR thread_root_message_id = ?2)
                    UNION ALL
                    SELECT NULL, NULL, pending.message_id,
                           pending.sender_ptid, pending.sender_device_id,
                           pending.plaintext, pending.state, pending.created_at_unix_ms,
                           NULLIF(pending.reply_to_message_id, ''),
                           NULLIF(pending.thread_root_message_id, ''),
                           NULL, NULL, 0,
                           CASE WHEN pending.message_id = ?2 THEN 0 ELSE 1 END,
                           1
                    FROM messaging_pending_messages pending
                    WHERE pending.conversation_id = ?1
                      AND (
                        pending.message_id = ?2
                        OR pending.thread_root_message_id = ?2
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM messaging_message_projections committed
                          WHERE committed.conversation_id = pending.conversation_id
                            AND committed.message_id = pending.message_id
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM messaging_attachment_drafts attachment
                          WHERE attachment.message_id = pending.message_id
                            AND attachment.descriptor_bytes IS NULL
                      )
                 )
                 SELECT event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms,
                        reply_to_message_id, thread_root_message_id,
                        edited_text, edited_at_unix_ms, retracted
                 FROM thread_messages
                 ORDER BY root_rank ASC,
                          pending_rank ASC,
                          event_sequence ASC,
                          committed_at_unix_ms ASC,
                          message_id ASC",
            )
            .map_err(|error| error.to_string())?;
        let mut messages = statement
            .query_map(
                params![conversation_id, thread_root_message_id],
                conversation_message_from_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        enrich_message_projections(&connection, conversation_id, &mut messages)?;
        Ok(messages)
    }

    pub fn search_message_projections(
        &self,
        conversation_id: &str,
        query: &str,
        before: Option<(i64, &str)>,
        limit: usize,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        if conversation_id.trim().is_empty()
            || limit == 0
            || limit > 100
            || before.is_some_and(|(timestamp, message_id)| {
                timestamp <= 0 || message_id.trim().is_empty()
            })
        {
            return Err("mobile messaging search input is invalid".to_string());
        }
        let search_query = fts_phrase_query(query)?;
        let (before_timestamp, before_message_id) = before.unwrap_or((i64::MAX, "\u{10ffff}"));
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT message.event_id, message.event_sequence, message.message_id,
                        message.sender_ptid, message.sender_device_id, message.plaintext,
                        message.delivery_state, message.committed_at_unix_ms,
                        message.reply_to_message_id, message.thread_root_message_id,
                        message.edited_text, message.edited_at_unix_ms, message.retracted
                 FROM messaging_message_search_fts
                 JOIN messaging_message_projections message
                   ON message.conversation_id = messaging_message_search_fts.conversation_id
                  AND message.message_id = messaging_message_search_fts.message_id
                 WHERE messaging_message_search_fts MATCH ?1
                   AND messaging_message_search_fts.conversation_id = ?2
                   AND message.retracted = 0
                   AND (
                     message.committed_at_unix_ms < ?3
                     OR (
                       message.committed_at_unix_ms = ?3
                       AND message.message_id < ?4
                     )
                   )
                 ORDER BY message.committed_at_unix_ms DESC, message.message_id DESC
                 LIMIT ?5",
            )
            .map_err(|error| error.to_string())?;
        let mut messages = statement
            .query_map(
                params![
                    search_query,
                    conversation_id,
                    before_timestamp,
                    before_message_id,
                    i64::try_from(limit)
                        .map_err(|_| "mobile messaging search limit exceeds i64")?
                ],
                conversation_message_from_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        enrich_message_projections(&connection, conversation_id, &mut messages)?;
        Ok(messages)
    }

    pub(crate) fn next_due_message_draft(
        &self,
        now_unix_ms: i64,
    ) -> Result<Option<PendingMessageDraft>, String> {
        if now_unix_ms <= 0 {
            return Err("mobile messaging draft retry time is invalid".to_string());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let draft = connection
            .query_row(
                "SELECT conversation_id, conversation_kind, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        reply_to_message_id, thread_root_message_id,
                        attempt_count, created_at_unix_ms
                 FROM messaging_pending_messages pending
                 WHERE state = 'draft'
                   AND next_attempt_at_unix_ms <= ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM messaging_attachment_drafts attachment
                     WHERE attachment.message_id = pending.message_id
                       AND attachment.descriptor_bytes IS NULL
                   )
                 ORDER BY next_attempt_at_unix_ms, created_at_unix_ms, message_id
                 LIMIT 1",
                params![now_unix_ms],
                |row| {
                    Ok(PendingMessageDraft {
                        conversation_id: row.get(0)?,
                        conversation_kind: row.get(1)?,
                        message_id: row.get(2)?,
                        sender_ptid: row.get(3)?,
                        sender_device_id: row.get(4)?,
                        plaintext: row.get(5)?,
                        reply_to_message_id: row.get(6)?,
                        thread_root_message_id: row.get(7)?,
                        attachments: Vec::new(),
                        attempt_count: row.get(8)?,
                        created_at_unix_ms: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(mut draft) = draft else {
            return Ok(None);
        };
        draft.attachments = load_pending_message_attachments(&connection, &draft.message_id)?;
        messaging_core::codec::private_content::encode_message_private_content(
            &draft.plaintext,
            &draft.attachments,
        )?;
        Ok(Some(draft))
    }

    pub(crate) fn schedule_message_draft_retry(
        &self,
        draft: &PendingMessageDraft,
        next_attempt_at_unix_ms: i64,
        error_code: &str,
    ) -> Result<(), String> {
        if next_attempt_at_unix_ms <= 0 || error_code.trim().is_empty() {
            return Err("mobile messaging draft retry is incomplete".to_string());
        }
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_pending_messages
                 SET attempt_count = attempt_count + 1,
                     next_attempt_at_unix_ms = ?3,
                     last_error_code = ?4
                 WHERE conversation_id = ?1
                   AND message_id = ?2
                   AND state = 'draft'
                   AND attempt_count = ?5",
                params![
                    draft.conversation_id,
                    draft.message_id,
                    next_attempt_at_unix_ms,
                    error_code,
                    i64::from(draft.attempt_count)
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging draft retry was not fenced".to_string());
        }
        Ok(())
    }

    pub(crate) fn next_superseded_interaction(
        &self,
    ) -> Result<Option<SupersededInteractionIntent>, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT intent.command_id, intent.conversation_id,
                        intent.target_message_id, intent.interaction_kind,
                        intent.edited_text, command.command_bytes,
                        intent.created_at_unix_ms
                 FROM messaging_interaction_intents intent
                 JOIN messaging_local_commands command
                   ON command.command_id = intent.command_id
                 WHERE intent.state = 'superseded'
                   AND command.state = 'superseded'
                 ORDER BY intent.created_at_unix_ms, intent.command_id
                 LIMIT 1",
                [],
                |row| {
                    Ok(SupersededInteractionIntent {
                        command_id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        target_message_id: row.get(2)?,
                        interaction_kind: row.get(3)?,
                        edited_text: row.get(4)?,
                        command_bytes: row.get(5)?,
                        created_at_unix_ms: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn mark_interaction_reprepared(
        &self,
        superseded_command_id: &str,
        replacement_command_id: &str,
    ) -> Result<(), String> {
        if superseded_command_id.trim().is_empty() || replacement_command_id.trim().is_empty() {
            return Err(
                "mobile messaging interaction replacement identity is incomplete".to_string(),
            );
        }
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_interaction_intents
                 SET state = 'reprepared'
                 WHERE command_id = ?1
                   AND state = 'superseded'
                   AND EXISTS (
                     SELECT 1 FROM messaging_local_commands replacement
                     WHERE replacement.command_id = ?2
                       AND replacement.conversation_id =
                           messaging_interaction_intents.conversation_id
                       AND replacement.state IN ('prepared', 'submitted', 'committed')
                   )",
                params![superseded_command_id, replacement_command_id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging interaction replacement was not fenced".to_string());
        }
        Ok(())
    }

    pub(crate) fn next_scheduled_work_at(&self) -> Result<Option<i64>, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT MIN(next_attempt_at_unix_ms)
                 FROM (
                    SELECT next_attempt_at_unix_ms
                    FROM messaging_command_outbox
                    WHERE state IN ('pending', 'retry_wait')
                    UNION ALL
                    SELECT pending.next_attempt_at_unix_ms
                    FROM messaging_pending_messages pending
                    WHERE pending.state = 'draft'
                      AND NOT EXISTS (
                        SELECT 1 FROM messaging_attachment_drafts attachment
                        WHERE attachment.message_id = pending.message_id
                          AND attachment.descriptor_bytes IS NULL
                      )
                    UNION ALL
                    SELECT 0
                    FROM messaging_interaction_intents
                    WHERE state = 'superseded'
                 )",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    pub fn update_read_cursor(
        &self,
        conversation_id: &str,
        actor_ptid: &str,
        last_read_sequence: i64,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        if conversation_id.trim().is_empty()
            || actor_ptid.trim().is_empty()
            || last_read_sequence <= 0
            || updated_at_unix_ms <= 0
        {
            return Err("mobile messaging read cursor is incomplete".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "INSERT INTO read_cursors(
                    conversation_id, actor_ptid, last_read_sequence, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(conversation_id, actor_ptid) DO UPDATE SET
                    last_read_sequence=MAX(
                        read_cursors.last_read_sequence,
                        excluded.last_read_sequence
                    ),
                    updated_at_unix_ms=CASE
                        WHEN excluded.last_read_sequence > read_cursors.last_read_sequence
                        THEN excluded.updated_at_unix_ms
                        ELSE read_cursors.updated_at_unix_ms
                    END",
                params![
                    conversation_id,
                    actor_ptid,
                    last_read_sequence,
                    updated_at_unix_ms
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn commit_claimed_item(
        transaction: &Transaction<'_>,
        item_id: &str,
        event_id: &str,
        conversation_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
        consumed_at_unix_ms: i64,
    ) -> Result<ReceiveCommitResult, String> {
        if let Some(existing) = transaction
            .query_row(
                "SELECT payload_sha256 FROM messaging_consumption_markers WHERE item_id = ?1",
                params![item_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
        {
            return if existing == payload_sha256 {
                Ok(ReceiveCommitResult::AlreadyCommitted)
            } else {
                Err("mobile messaging replay payload hash mismatch".to_string())
            };
        }

        let claimed = transaction
            .query_row(
                "SELECT event_id, conversation_id, lane_sequence, consumer_epoch, payload_sha256
                 FROM messaging_inbox_items WHERE item_id = ?1 AND state = 'claimed'",
                params![item_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Vec<u8>>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "mobile messaging claimed item is unavailable".to_string())?;
        let epoch = i64::try_from(consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?;
        if claimed
            != (
                event_id.to_string(),
                conversation_id.to_string(),
                lane_sequence,
                epoch,
                payload_sha256.to_vec(),
            )
        {
            return Err("mobile messaging claimed item binding mismatch".to_string());
        }

        let cursor = transaction
            .query_row(
                "SELECT lane_sequence, consumer_epoch FROM messaging_lane_cursor WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if lane_sequence != cursor.map(|value| value.0 + 1).unwrap_or(1)
            || cursor.map(|value| epoch < value.1).unwrap_or(false)
        {
            return Err("mobile messaging lane item is not next or is stale".to_string());
        }

        transaction
            .execute(
                "INSERT INTO messaging_consumption_markers(
                    item_id, event_id, conversation_id, payload_sha256, consumed_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    item_id,
                    event_id,
                    conversation_id,
                    payload_sha256,
                    consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_lane_cursor(
                    id, lane_sequence, consumer_epoch, updated_at_unix_ms
                 ) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET
                    lane_sequence=excluded.lane_sequence,
                    consumer_epoch=excluded.consumer_epoch,
                    updated_at_unix_ms=excluded.updated_at_unix_ms",
                params![lane_sequence, epoch, consumed_at_unix_ms],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE messaging_inbox_items SET state = 'consumed' WHERE item_id = ?1",
                params![item_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(ReceiveCommitResult::Committed)
    }

    #[cfg(test)]
    fn insert_command(&self, id: &str, bytes: &[u8], due: i64) {
        let connection = self.connection.lock().unwrap();
        connection
            .execute(
                "INSERT INTO messaging_local_commands(
                    command_id, conversation_id, command_bytes, state, created_at_unix_ms
                 ) VALUES (?1, 'conversation-1', ?2, 'prepared', ?3)",
                params![id, bytes, due],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_pending_messages(
                    conversation_id, conversation_kind, message_id, sender_ptid,
                    sender_device_id, plaintext, reply_to_message_id,
                    thread_root_message_id, state, attempt_count,
                    next_attempt_at_unix_ms, last_error_code, created_at_unix_ms
                 ) VALUES (
                    'conversation-1', 1, 'message-1', 'ptid:alice',
                    'alice-device', 'hello', '', '', 'pending', 0, ?1, '', ?1
                 )",
                params![due],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_command_attempts(
                    command_id, conversation_id, message_id,
                    delivery_plan_sha256, state, created_at_unix_ms
                 ) VALUES (?1, 'conversation-1', 'message-1', ?2, 'prepared', ?3)",
                params![id, vec![7u8; 32], due],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_command_outbox(
                    command_id, conversation_id, command_bytes, state, attempt_count,
                    next_attempt_at_unix_ms, last_error_code, created_at_unix_ms
                 ) VALUES (?1, 'conversation-1', ?2, 'pending', 0, ?3, '', ?3)",
                params![id, bytes, due],
            )
            .unwrap();
    }
}

impl DeviceEnrollmentRepository for MobileMessagingStore {
    fn device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String> {
        let row = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT ptid, device_id, actor_identity_public_key,
                        actor_identity_key_fingerprint, device_signing_public_key,
                        actor_cross_signature, signing_key_id, profile_version
                 FROM messaging_device_identity WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                        row.get::<_, Vec<u8>>(4)?,
                        row.get::<_, Vec<u8>>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(FreshDeviceEnrollment {
            certificate: messaging_core::proto::actor::ActorDeviceCertificate {
                format_version: MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION,
                device: Some(messaging_core::proto::actor_device_ref(row.0, row.1)),
                actor_identity_public_key: row.2,
                actor_identity_key_fingerprint: row.3,
                device_signing_public_key: row.4,
                signing_key_id: row.6,
                observed_profile_version: u64::try_from(row.7)
                    .map_err(|_| "mobile messaging profile version is invalid")?,
            },
            actor_cross_signature: row
                .5
                .try_into()
                .map_err(|_| "mobile messaging actor cross signature must be 64 bytes")?,
        }))
    }

    fn install_fresh_device_identity(
        &self,
        state: &FreshDeviceIdentityState,
    ) -> Result<(), String> {
        let enrollment = &state.enrollment;
        let certificate = &enrollment.certificate;
        let device = certificate
            .device
            .as_ref()
            .ok_or_else(|| "fresh mobile messaging device identity has no endpoint".to_string())?;
        let ptid = messaging_core::proto::actor_device_ptid(device)?;
        if device.device_id.trim().is_empty()
            || certificate.signing_key_id.trim().is_empty()
            || certificate.actor_identity_public_key.len() != 32
            || certificate.actor_identity_key_fingerprint.len() != 32
            || certificate.device_signing_public_key.len() != 32
            || certificate.observed_profile_version == 0
        {
            return Err("fresh mobile messaging device identity is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            transaction
                .execute(
                    "INSERT INTO messaging_device_identity(
                        id, ptid, device_id, device_signing_seed,
                        actor_identity_public_key, actor_identity_key_fingerprint,
                        device_signing_public_key, actor_cross_signature,
                        signing_key_id, profile_version
                     ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        ptid,
                        device.device_id,
                        state.device_signing_seed.as_slice(),
                        certificate.actor_identity_public_key,
                        certificate.actor_identity_key_fingerprint,
                        certificate.device_signing_public_key,
                        enrollment.actor_cross_signature.as_slice(),
                        certificate.signing_key_id,
                        i64::try_from(certificate.observed_profile_version)
                            .map_err(|_| "fresh mobile messaging profile version is invalid")?,
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO messaging_recovery_state(id, status)
                     VALUES (1, 'awaiting_device_enrollment')",
                    [],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    fn pending_device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String> {
        let status = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT status FROM messaging_recovery_state WHERE id = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if status.as_deref() != Some("awaiting_device_enrollment") {
            return Ok(None);
        }
        self.device_enrollment()
    }

    fn complete_device_enrollment(&self, device_id: &str) -> Result<(), String> {
        if device_id.trim().is_empty() {
            return Err("mobile messaging enrollment device ID is required".to_string());
        }
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_recovery_state SET status = 'active'
                 WHERE id = 1
                   AND status = 'awaiting_device_enrollment'
                   AND EXISTS (
                       SELECT 1 FROM messaging_device_identity
                       WHERE id = 1 AND device_id = ?1
                   )",
                params![device_id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging enrollment state transition was not applied".to_string());
        }
        Ok(())
    }

    fn reset_device_enrollment(&self) -> Result<bool, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_recovery_state
                 SET status = 'awaiting_device_enrollment'
                 WHERE id = 1 AND status = 'active'",
                [],
            )
            .map(|changed| changed > 0)
            .map_err(|error| error.to_string())
    }
}

impl PreKeyRepository for MobileMessagingStore {
    fn has_prekey_bundle(&self) -> Result<bool, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messaging_prekey_bundle WHERE id = 1)",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    fn install_fresh_prekey_bundle(
        &self,
        signed_prekey_id: i32,
        signed_prekey_private: &[u8; 32],
        one_time_prekeys: &[(i32, [u8; 32])],
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        if signed_prekey_id <= 0 || one_time_prekeys.is_empty() || created_at_unix_ms <= 0 {
            return Err("mobile messaging fresh prekey bundle is incomplete".to_string());
        }
        let mut seen = std::collections::HashSet::with_capacity(one_time_prekeys.len());
        if one_time_prekeys
            .iter()
            .any(|(id, _)| *id <= 0 || !seen.insert(*id))
        {
            return Err("mobile messaging one-time prekey IDs are invalid".to_string());
        }
        self.with_transaction(|transaction| {
            let active = transaction
                .query_row(
                    "SELECT status = 'active' FROM messaging_recovery_state WHERE id = 1",
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .unwrap_or(false);
            if !active {
                return Err("mobile messaging prekeys require active device enrollment".to_string());
            }
            transaction
                .execute(
                    "INSERT INTO messaging_prekey_bundle(
                        id, signed_prekey_id, signed_prekey_private,
                        state, created_at_unix_ms
                     ) VALUES (1, ?1, ?2, 'awaiting_publication', ?3)",
                    params![
                        signed_prekey_id,
                        signed_prekey_private.as_slice(),
                        created_at_unix_ms,
                    ],
                )
                .map_err(|error| error.to_string())?;
            for (id, private_key) in one_time_prekeys {
                transaction
                    .execute(
                        "INSERT INTO messaging_one_time_prekeys(
                            prekey_id, private_key, state
                         ) VALUES (?1, ?2, 'awaiting_publication')",
                        params![id, private_key.as_slice()],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    fn pending_prekey_bundle(&self) -> Result<Option<PendingPreKeyBundle>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let signed = connection
            .query_row(
                "SELECT signed_prekey_id, signed_prekey_private
                 FROM messaging_prekey_bundle
                 WHERE id = 1 AND state = 'awaiting_publication'",
                [],
                |row| Ok((row.get::<_, i32>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((signed_prekey_id, signed_prekey_private)) = signed else {
            return Ok(None);
        };
        let mut statement = connection
            .prepare(
                "SELECT prekey_id, private_key
                 FROM messaging_one_time_prekeys
                 WHERE state = 'awaiting_publication'
                 ORDER BY prekey_id",
            )
            .map_err(|error| error.to_string())?;
        let one_time_prekeys = statement
            .query_map([], |row| {
                Ok((row.get::<_, i32>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|error| error.to_string())?
            .map(|row| {
                let (id, key) = row.map_err(|error| error.to_string())?;
                Ok((id, fixed_key("one-time prekey", key)?))
            })
            .collect::<Result<Vec<_>, String>>()?;
        if one_time_prekeys.is_empty() {
            return Err("mobile messaging pending prekey bundle has no OPKs".to_string());
        }
        Ok(Some(PendingPreKeyBundle {
            signed_prekey_id,
            signed_prekey_private: fixed_key("signed prekey", signed_prekey_private)?,
            one_time_prekeys,
        }))
    }

    fn complete_prekey_publication(&self, signed_prekey_id: i32) -> Result<(), String> {
        self.with_transaction(|transaction| {
            let bundle_changed = transaction
                .execute(
                    "UPDATE messaging_prekey_bundle SET state = 'published'
                     WHERE id = 1
                       AND signed_prekey_id = ?1
                       AND state = 'awaiting_publication'",
                    params![signed_prekey_id],
                )
                .map_err(|error| error.to_string())?;
            let opks_changed = transaction
                .execute(
                    "UPDATE messaging_one_time_prekeys SET state = 'available'
                     WHERE state = 'awaiting_publication'",
                    [],
                )
                .map_err(|error| error.to_string())?;
            if bundle_changed != 1 || opks_changed == 0 {
                return Err(
                    "mobile messaging prekey publication transition was not applied".to_string(),
                );
            }
            Ok(())
        })
    }
}

impl MobileMessagingStore {
    pub fn next_device_consumption_receipt(
        &self,
    ) -> Result<Option<(String, Vec<u8>, DeviceConsumptionReceipt)>, String> {
        let entry = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT receipt_id, receipt_bytes
                 FROM messaging_receipt_outbox
                 WHERE state = 'pending'
                   AND receipt_id LIKE 'device-consumed:%'
                 ORDER BY created_at_unix_ms ASC, receipt_id ASC
                 LIMIT 1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        entry
            .map(|(receipt_id, receipt_bytes)| {
                let receipt = DeviceConsumptionReceipt::decode(receipt_bytes.as_slice()).map_err(
                    |error| format!("decode mobile messaging device consumption receipt: {error}"),
                )?;
                Ok((receipt_id, receipt_bytes, receipt))
            })
            .transpose()
    }

    pub fn mark_device_consumption_receipt_submitted(
        &self,
        receipt_id: &str,
        receipt_bytes: &[u8],
    ) -> Result<(), String> {
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_receipt_outbox SET state = 'submitted'
                 WHERE receipt_id = ?1
                   AND receipt_bytes = ?2
                   AND state = 'pending'",
                params![receipt_id, receipt_bytes],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err(
                "mobile messaging device consumption receipt transition mismatch".to_string(),
            );
        }
        Ok(())
    }
}

impl MetadataInteractionRepository for MobileMessagingStore {
    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingRepository::authority_head(self, conversation_id)
    }

    fn message_sender(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<Option<String>, String> {
        MobileMessagingStore::message_sender(self, conversation_id, message_id)
    }

    fn persist_metadata_interaction(
        &self,
        commit: &MetadataInteractionCommit<'_>,
    ) -> Result<(), String> {
        self.with_transaction(|transaction| {
            validate_expected_authority_head(
                transaction,
                commit.conversation_id,
                commit.expected_authority_sequence,
                commit.expected_authority_hash,
            )?;
            persist_interaction_command(
                transaction,
                commit.command_id,
                commit.conversation_id,
                commit.target_message_id,
                commit.interaction_kind,
                None,
                commit.command_bytes,
                commit.delivery_plan_sha256,
                commit.created_at_unix_ms,
            )
        })
    }
}

impl MessagingRepository for MobileMessagingStore {
    fn persist_claimed_item(
        &self,
        item_id: &str,
        event_id: &str,
        conversation_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
        opaque_payload: &[u8],
        now_unix_ms: i64,
    ) -> Result<(), String> {
        if item_id.is_empty()
            || event_id.is_empty()
            || conversation_id.is_empty()
            || lane_sequence <= 0
            || consumer_epoch == 0
            || payload_sha256.len() != 32
            || opaque_payload.is_empty()
            || now_unix_ms <= 0
        {
            return Err("mobile messaging claimed item is incomplete".to_string());
        }
        let epoch = i64::try_from(consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let changed = connection
            .execute(
                "INSERT INTO messaging_inbox_items(
                    item_id, event_id, conversation_id, lane_sequence, consumer_epoch,
                    payload_sha256, payload, state, claimed_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'claimed', ?8)
                 ON CONFLICT(item_id) DO NOTHING",
                params![
                    item_id,
                    event_id,
                    conversation_id,
                    lane_sequence,
                    epoch,
                    payload_sha256,
                    opaque_payload,
                    now_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            let existing = connection
                .query_row(
                    "SELECT event_id, conversation_id, lane_sequence, consumer_epoch,
                            payload_sha256, payload
                     FROM messaging_inbox_items WHERE item_id = ?1",
                    params![item_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, Vec<u8>>(4)?,
                            row.get::<_, Vec<u8>>(5)?,
                        ))
                    },
                )
                .map_err(|error| error.to_string())?;
            if existing
                != (
                    event_id.to_string(),
                    conversation_id.to_string(),
                    lane_sequence,
                    epoch,
                    payload_sha256.to_vec(),
                    opaque_payload.to_vec(),
                )
            {
                return Err("mobile messaging claimed item replay conflict".to_string());
            }
        }
        Ok(())
    }

    fn consumption_marker_matches(
        &self,
        item_id: &str,
        payload_sha256: &[u8],
    ) -> Result<bool, String> {
        Ok(self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT payload_sha256 = ?2 FROM messaging_consumption_markers WHERE item_id = ?1",
                params![item_id, payload_sha256],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or(false))
    }

    fn lane_checkpoint(&self) -> Result<(i64, u64), String> {
        let value = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT lane_sequence, consumer_epoch FROM messaging_lane_cursor WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or((0, 0));
        Ok((
            value.0,
            u64::try_from(value.1).map_err(|_| "negative consumer epoch")?,
        ))
    }

    fn commit_conversation_state(
        &self,
        commit: &ConversationStateReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        self.with_transaction(|transaction| {
            let result = Self::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            let projection = commit.projection;
            transaction
                .execute(
                    "INSERT INTO messaging_conversations(
                        conversation_id, authority_station_id, federation_id,
                        kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        authority_station_id=excluded.authority_station_id,
                        federation_id=excluded.federation_id,
                        kind=excluded.kind, name=excluded.name,
                        owner_ptid=excluded.owner_ptid,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch, active=excluded.active,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        projection.conversation_id,
                        projection.authority_station_id,
                        projection.federation_id,
                        projection.kind,
                        projection.name,
                        projection.owner_ptid,
                        projection.membership_epoch,
                        projection.mls_epoch,
                        projection.active,
                        projection.updated_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM messaging_conversation_members WHERE conversation_id = ?1",
                    params![projection.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            for ptid in &projection.member_ptids {
                transaction
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, role, active
                         ) VALUES (?1, ?2, 0, 1)",
                        params![projection.conversation_id, ptid],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "INSERT INTO messaging_authority_heads(
                        conversation_id, event_sequence, event_hash, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        event_sequence=excluded.event_sequence,
                        event_hash=excluded.event_hash,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        commit.conversation_id,
                        commit.event_sequence,
                        commit.event_hash,
                        commit.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO messaging_receipt_outbox(
                        receipt_id, event_id, receipt_bytes, state, created_at_unix_ms
                     ) VALUES (?1, ?2, ?3, 'pending', ?4)",
                    params![
                        commit.receipt_id,
                        commit.event_id,
                        commit.receipt_bytes,
                        commit.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            Ok(result)
        })
    }

    fn conversation_projections(&self) -> Result<Vec<ConversationProjection>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, authority_station_id, federation_id,
                        kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                 FROM messaging_conversations ORDER BY updated_at_unix_ms DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, bool>(8)?,
                    row.get::<_, i64>(9)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows.into_iter()
            .map(|row| {
                let mut members = connection
                    .prepare(
                        "SELECT ptid FROM messaging_conversation_members
                         WHERE conversation_id = ?1 ORDER BY ptid",
                    )
                    .map_err(|error| error.to_string())?;
                let member_ptids = members
                    .query_map(params![row.0], |member| member.get(0))
                    .map_err(|error| error.to_string())?
                    .collect::<Result<Vec<String>, _>>()
                    .map_err(|error| error.to_string())?;
                Ok(ConversationProjection {
                    conversation_id: row.0,
                    authority_station_id: row.1,
                    federation_id: row.2,
                    kind: row.3,
                    name: row.4,
                    owner_ptid: row.5,
                    member_ptids,
                    membership_epoch: row.6,
                    mls_epoch: row.7,
                    active: row.8,
                    updated_at_unix_ms: row.9,
                })
            })
            .collect()
    }

    fn commit_public_event(
        &self,
        commit: &PublicEventReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        if commit.item_id.trim().is_empty()
            || commit.event_id.trim().is_empty()
            || commit.conversation_id.trim().is_empty()
            || commit.command_id.trim().is_empty()
            || commit.message_id.trim().is_empty()
            || commit.sender_ptid.trim().is_empty()
            || commit.sender_device_id.trim().is_empty()
            || commit.event_sequence <= 0
            || commit.event_hash.len() != 32
            || commit.receipt_id.trim().is_empty()
            || commit.receipt_bytes.is_empty()
            || commit.committed_at_unix_ms <= 0
            || commit.consumed_at_unix_ms <= 0
        {
            return Err("mobile messaging public event is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            let result = Self::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            let pending = transaction
                .query_row(
                    "SELECT p.conversation_id, p.message_id, p.sender_ptid,
                            p.sender_device_id, p.plaintext,
                            p.reply_to_message_id, p.thread_root_message_id
                     FROM messaging_command_attempts a
                     JOIN messaging_pending_messages p
                       ON p.conversation_id = a.conversation_id
                      AND p.message_id = a.message_id
                     WHERE a.command_id = ?1",
                    params![commit.command_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "mobile messaging pending sender projection is unavailable".to_string()
                })?;
            if pending.0 != commit.conversation_id
                || pending.1 != commit.message_id
                || pending.2 != commit.sender_ptid
                || pending.3 != commit.sender_device_id
                || pending.5 != commit.reply_to_message_id.unwrap_or_default()
                || pending.6 != commit.thread_root_message_id.unwrap_or_default()
            {
                return Err("mobile messaging public-event pending projection mismatch".to_string());
            }
            let attachments = load_pending_attachments(transaction, commit.message_id)?;
            let descriptors = attachments
                .iter()
                .map(|attachment| attachment.object.clone())
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| {
                    "mobile messaging pending attachment descriptor is missing".to_string()
                })?;
            if descriptors != commit.attachments {
                return Err(
                    "mobile messaging public-event attachment descriptor mismatch".to_string(),
                );
            }
            transaction
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext, delivery_state,
                        committed_at_unix_ms, reply_to_message_id, thread_root_message_id
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'accepted', ?8, ?9, ?10)",
                    params![
                        commit.conversation_id,
                        commit.event_id,
                        commit.event_sequence,
                        commit.message_id,
                        commit.sender_ptid,
                        commit.sender_device_id,
                        pending.4,
                        commit.committed_at_unix_ms,
                        commit.reply_to_message_id,
                        commit.thread_root_message_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            persist_sender_message_attachments(transaction, commit.message_id, &attachments)?;
            index_message_search(
                transaction,
                commit.conversation_id,
                commit.message_id,
                &pending.4,
                &attachments,
            )?;
            let pending_changed = transaction
                .execute(
                    "DELETE FROM messaging_pending_messages
                     WHERE conversation_id = ?1 AND message_id = ?2",
                    params![commit.conversation_id, commit.message_id],
                )
                .map_err(|error| error.to_string())?;
            for table in [
                "messaging_command_attempts",
                "messaging_local_commands",
                "messaging_command_outbox",
            ] {
                let changed = transaction
                    .execute(
                        &format!("UPDATE {table} SET state = 'committed' WHERE command_id = ?1"),
                        params![commit.command_id],
                    )
                    .map_err(|error| error.to_string())?;
                if changed != 1 {
                    return Err(
                        "mobile messaging public-event command transition mismatch".to_string()
                    );
                }
            }
            if pending_changed != 1 {
                return Err("mobile messaging public-event pending transition mismatch".to_string());
            }
            finish_authority_receive(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }

    fn commit_interaction_event(
        &self,
        commit: &InteractionReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        if commit.item_id.trim().is_empty()
            || commit.event_id.trim().is_empty()
            || commit.conversation_id.trim().is_empty()
            || commit.message_id.trim().is_empty()
            || commit.event_sequence <= 0
            || commit.event_hash.len() != 32
            || commit.receipt_id.trim().is_empty()
            || commit.receipt_bytes.is_empty()
            || commit.consumed_at_unix_ms <= 0
        {
            return Err("mobile messaging interaction event is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            let result = Self::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            if let Some(session_state) = commit.mls_session_state {
                persist_mls_session(
                    transaction,
                    commit.conversation_id,
                    session_state,
                    commit.membership_epoch,
                    commit.mls_epoch,
                    commit.consumed_at_unix_ms,
                )?;
            }
            let message_exists = transaction
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM messaging_message_projections
                        WHERE conversation_id = ?1 AND message_id = ?2
                     )",
                    params![commit.conversation_id, commit.message_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|error| error.to_string())?;
            if !message_exists {
                return Err("mobile messaging interaction target message not found".to_string());
            }
            match &commit.mutation {
                InteractionMutation::Edit {
                    edited_text,
                    edited_at_unix_ms,
                } => {
                    if *edited_at_unix_ms <= 0 {
                        return Err("mobile messaging edit timestamp is invalid".to_string());
                    }
                    let durable_text = if edited_text.is_empty() {
                        transaction
                            .query_row(
                                "SELECT edited_text FROM messaging_interaction_intents
                                 WHERE command_id = ?1 AND interaction_kind = 'edit'",
                                params![commit.command_id],
                                |row| row.get::<_, Option<String>>(0),
                            )
                            .optional()
                            .map_err(|error| error.to_string())?
                            .flatten()
                    } else {
                        Some((*edited_text).to_string())
                    }
                    .ok_or_else(|| {
                        "mobile messaging sender edit content is unavailable".to_string()
                    })?;
                    let changed = transaction
                        .execute(
                            "UPDATE messaging_message_projections
                             SET edited_text = ?1, edited_at_unix_ms = ?2
                             WHERE conversation_id = ?3 AND message_id = ?4",
                            params![
                                durable_text,
                                edited_at_unix_ms,
                                commit.conversation_id,
                                commit.message_id
                            ],
                        )
                        .map_err(|error| error.to_string())?;
                    if changed != 1 {
                        return Err(
                            "mobile messaging interaction target message not found".to_string()
                        );
                    }
                    let attachments = load_pending_attachments(transaction, commit.message_id)?;
                    index_message_search(
                        transaction,
                        commit.conversation_id,
                        commit.message_id,
                        &durable_text,
                        &attachments,
                    )?;
                }
                InteractionMutation::Retract => {
                    let changed = transaction
                        .execute(
                            "UPDATE messaging_message_projections
                             SET retracted = 1
                             WHERE conversation_id = ?1 AND message_id = ?2",
                            params![commit.conversation_id, commit.message_id],
                        )
                        .map_err(|error| error.to_string())?;
                    if changed != 1 {
                        return Err(
                            "mobile messaging interaction target message not found".to_string()
                        );
                    }
                    transaction
                        .execute(
                            "DELETE FROM messaging_message_search_fts
                             WHERE conversation_id = ?1 AND message_id = ?2",
                            params![commit.conversation_id, commit.message_id],
                        )
                        .map_err(|error| error.to_string())?;
                }
                InteractionMutation::Reaction {
                    actor_ptid,
                    reaction,
                    removed,
                    created_at_unix_ms,
                } => {
                    if actor_ptid.trim().is_empty()
                        || reaction.trim().is_empty()
                        || *created_at_unix_ms <= 0
                    {
                        return Err("mobile messaging reaction is incomplete".to_string());
                    }
                    if *removed {
                        transaction.execute(
                            "DELETE FROM message_reactions
                             WHERE message_id = ?1 AND actor_ptid = ?2 AND reaction = ?3",
                            params![commit.message_id, actor_ptid, reaction],
                        )
                    } else {
                        transaction.execute(
                            "INSERT OR IGNORE INTO message_reactions(
                                message_id, actor_ptid, reaction, created_at_unix_ms
                             ) VALUES (?1, ?2, ?3, ?4)",
                            params![commit.message_id, actor_ptid, reaction, created_at_unix_ms],
                        )
                    }
                    .map_err(|error| error.to_string())?;
                }
                InteractionMutation::Pin {
                    actor_ptid,
                    removed,
                    pinned_at_unix_ms,
                } => {
                    if actor_ptid.trim().is_empty() || *pinned_at_unix_ms <= 0 {
                        return Err("mobile messaging pin is incomplete".to_string());
                    }
                    if *removed {
                        transaction.execute(
                            "DELETE FROM message_pins
                             WHERE conversation_id = ?1 AND message_id = ?2",
                            params![commit.conversation_id, commit.message_id],
                        )
                    } else {
                        transaction.execute(
                            "INSERT OR REPLACE INTO message_pins(
                                conversation_id, message_id, actor_ptid, pinned_at_unix_ms
                             ) VALUES (?1, ?2, ?3, ?4)",
                            params![
                                commit.conversation_id,
                                commit.message_id,
                                actor_ptid,
                                pinned_at_unix_ms
                            ],
                        )
                    }
                    .map_err(|error| error.to_string())?;
                }
            }
            let local_intent = !commit.command_id.is_empty()
                && transaction
                    .query_row(
                        "SELECT EXISTS(
                            SELECT 1 FROM messaging_interaction_intents WHERE command_id = ?1
                         )",
                        params![commit.command_id],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(|error| error.to_string())?;
            if local_intent {
                for table in [
                    "messaging_local_commands",
                    "messaging_command_outbox",
                    "messaging_command_attempts",
                    "messaging_interaction_intents",
                ] {
                    let changed = transaction
                        .execute(
                            &format!(
                                "UPDATE {table} SET state = 'committed' WHERE command_id = ?1"
                            ),
                            params![commit.command_id],
                        )
                        .map_err(|error| error.to_string())?;
                    if changed != 1 {
                        return Err(
                            "mobile messaging interaction command transition mismatch".to_string()
                        );
                    }
                }
            }
            finish_authority_receive(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }

    fn commit_delivery_receipt(&self, commit: &DeliveryReceiptReceiveCommit) -> Result<(), String> {
        let rank = match commit.delivery_state {
            "delivered" => 1,
            "read" => 2,
            _ => return Err("mobile messaging delivery state is invalid".to_string()),
        };
        self.with_transaction(|transaction| {
            let result = Self::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.message_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(());
            }
            let changed = transaction
                .execute(
                    "UPDATE messaging_message_projections
                     SET delivery_state = ?1
                     WHERE conversation_id = ?2 AND message_id = ?3
                       AND CASE delivery_state
                             WHEN 'read' THEN 2
                             WHEN 'delivered' THEN 1
                             ELSE 0
                           END < ?4",
                    params![
                        commit.delivery_state,
                        commit.conversation_id,
                        commit.message_id,
                        rank
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed == 0 {
                let exists = transaction
                    .query_row(
                        "SELECT 1 FROM messaging_message_projections
                         WHERE conversation_id = ?1 AND message_id = ?2",
                        params![commit.conversation_id, commit.message_id],
                        |_| Ok(()),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?
                    .is_some();
                if !exists {
                    return Err("mobile messaging receipt references unknown message".to_string());
                }
            }
            Ok(())
        })
    }

    fn commit_actor_read_cursor(&self, commit: &ActorReadReceiveCommit) -> Result<(), String> {
        if commit.reader_ptid.is_empty() || commit.last_read_sequence <= 0 {
            return Err("mobile messaging actor read cursor is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            let result = Self::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(());
            }
            transaction
                .execute(
                    "INSERT INTO read_cursors(
                        conversation_id, actor_ptid, last_read_sequence, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(conversation_id, actor_ptid) DO UPDATE SET
                        last_read_sequence=MAX(
                            read_cursors.last_read_sequence,
                            excluded.last_read_sequence
                        ),
                        updated_at_unix_ms=CASE
                            WHEN excluded.last_read_sequence >
                                 read_cursors.last_read_sequence
                            THEN excluded.updated_at_unix_ms
                            ELSE read_cursors.updated_at_unix_ms
                        END",
                    params![
                        commit.conversation_id,
                        commit.reader_ptid,
                        commit.last_read_sequence,
                        commit.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE messaging_message_projections
                     SET delivery_state = 'read'
                     WHERE conversation_id = ?1
                       AND event_sequence <= ?2
                       AND sender_ptid <> ?3
                       AND delivery_state <> 'failed'",
                    params![
                        commit.conversation_id,
                        commit.last_read_sequence,
                        commit.reader_ptid
                    ],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    fn next_command(&self, now_unix_ms: i64) -> Result<Option<CommandOutboxEntry>, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT command_id, command_bytes, attempt_count
                 FROM messaging_command_outbox
                 WHERE state IN ('pending', 'retry_wait') AND next_attempt_at_unix_ms <= ?1
                 ORDER BY next_attempt_at_unix_ms, command_id LIMIT 1",
                params![now_unix_ms],
                |row| {
                    Ok(CommandOutboxEntry {
                        command_id: row.get(0)?,
                        command_bytes: row.get(1)?,
                        attempt_count: row.get::<_, u32>(2)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn mark_command_submitted(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
    ) -> Result<(), String> {
        self.with_transaction(|transaction| {
            let state = load_command_transition_state(transaction, command_id, command_bytes)?;
            if state.local_state == "committed" && state.outbox_state == "committed" {
                return Ok(());
            }
            if state.attempt_count != attempt_count
                || !matches!(state.local_state.as_str(), "prepared" | "submitted")
                || !matches!(
                    state.outbox_state.as_str(),
                    "pending" | "retry_wait" | "submitted"
                )
            {
                return Err("mobile messaging command submission transition mismatch".to_string());
            }
            let local_changed = transaction
                .execute(
                    "UPDATE messaging_local_commands
                     SET state = 'submitted'
                     WHERE command_id = ?1 AND state IN ('prepared', 'submitted')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let outbox_changed = transaction
                .execute(
                    "UPDATE messaging_command_outbox
                     SET state = 'submitted', last_error_code = ''
                     WHERE command_id = ?1
                       AND attempt_count = ?2
                       AND state IN ('pending', 'retry_wait', 'submitted')",
                    params![command_id, i64::from(attempt_count)],
                )
                .map_err(|error| error.to_string())?;
            let attempt_changed = transaction
                .execute(
                    "UPDATE messaging_command_attempts SET state = 'submitted'
                     WHERE command_id = ?1
                       AND state IN ('prepared', 'retry_wait', 'submitted')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let pending_changed = transaction
                .execute(
                    "UPDATE messaging_pending_messages AS pending
                     SET state = 'submitted'
                     WHERE EXISTS (
                        SELECT 1 FROM messaging_command_attempts attempt
                        WHERE attempt.command_id = ?1
                          AND attempt.conversation_id = pending.conversation_id
                          AND attempt.message_id = pending.message_id
                     )",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let interaction_changed = transaction
                .execute(
                    "UPDATE messaging_interaction_intents SET state = 'submitted'
                     WHERE command_id = ?1
                       AND state IN ('prepared', 'retry_wait', 'submitted')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            if local_changed != 1
                || outbox_changed != 1
                || attempt_changed != 1
                || !pending_owner_transition_is_valid(
                    transaction,
                    command_id,
                    pending_changed,
                    interaction_changed,
                )?
            {
                return Err("mobile messaging command submission was not fenced".to_string());
            }
            Ok(())
        })
    }

    fn mark_command_retry(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        error_code: &str,
    ) -> Result<(), String> {
        if next_attempt_at_unix_ms <= 0 || error_code.trim().is_empty() {
            return Err("mobile messaging command retry metadata is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            let state = load_command_transition_state(transaction, command_id, command_bytes)?;
            if state.attempt_count != attempt_count
                || !matches!(state.local_state.as_str(), "prepared" | "submitted")
                || !matches!(state.outbox_state.as_str(), "pending" | "retry_wait")
            {
                return Err("mobile messaging command retry transition mismatch".to_string());
            }
            let outbox_changed = transaction
                .execute(
                    "UPDATE messaging_command_outbox
                     SET state = 'retry_wait',
                         attempt_count = attempt_count + 1,
                         next_attempt_at_unix_ms = ?2,
                         last_error_code = ?3
                     WHERE command_id = ?1
                       AND attempt_count = ?4
                       AND state IN ('pending', 'retry_wait')",
                    params![
                        command_id,
                        next_attempt_at_unix_ms,
                        error_code,
                        i64::from(attempt_count)
                    ],
                )
                .map_err(|error| error.to_string())?;
            let attempt_changed = transaction
                .execute(
                    "UPDATE messaging_command_attempts SET state = 'retry_wait'
                     WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let pending_changed = transaction
                .execute(
                    "UPDATE messaging_pending_messages AS pending
                     SET state = 'retry_wait',
                         attempt_count = attempt_count + 1,
                         next_attempt_at_unix_ms = ?2,
                         last_error_code = ?3
                     WHERE EXISTS (
                        SELECT 1 FROM messaging_command_attempts attempt
                        WHERE attempt.command_id = ?1
                          AND attempt.conversation_id = pending.conversation_id
                          AND attempt.message_id = pending.message_id
                     )",
                    params![command_id, next_attempt_at_unix_ms, error_code],
                )
                .map_err(|error| error.to_string())?;
            let interaction_changed = transaction
                .execute(
                    "UPDATE messaging_interaction_intents SET state = 'retry_wait'
                     WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            if outbox_changed != 1
                || attempt_changed != 1
                || !pending_owner_transition_is_valid(
                    transaction,
                    command_id,
                    pending_changed,
                    interaction_changed,
                )?
            {
                return Err("mobile messaging command retry was not fenced".to_string());
            }
            Ok(())
        })
    }

    fn mark_command_failed(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
        error_code: &str,
    ) -> Result<(), String> {
        if error_code.trim().is_empty() {
            return Err("mobile messaging command failure code is required".to_string());
        }
        self.with_transaction(|transaction| {
            let state = load_command_transition_state(transaction, command_id, command_bytes)?;
            if state.attempt_count != attempt_count
                || !matches!(state.local_state.as_str(), "prepared" | "submitted")
                || !matches!(state.outbox_state.as_str(), "pending" | "retry_wait")
            {
                return Err("mobile messaging command failure transition mismatch".to_string());
            }
            let local_changed = transaction
                .execute(
                    "UPDATE messaging_local_commands SET state = 'failed'
                     WHERE command_id = ?1 AND state IN ('prepared', 'submitted')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let outbox_changed = transaction
                .execute(
                    "UPDATE messaging_command_outbox
                     SET state = 'failed', last_error_code = ?2
                     WHERE command_id = ?1
                       AND attempt_count = ?3
                       AND state IN ('pending', 'retry_wait')",
                    params![command_id, error_code, i64::from(attempt_count)],
                )
                .map_err(|error| error.to_string())?;
            let attempt_changed = transaction
                .execute(
                    "UPDATE messaging_command_attempts SET state = 'failed'
                     WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let pending_changed = transaction
                .execute(
                    "UPDATE messaging_pending_messages AS pending
                     SET state = 'failed', last_error_code = ?2
                     WHERE EXISTS (
                        SELECT 1 FROM messaging_command_attempts attempt
                        WHERE attempt.command_id = ?1
                          AND attempt.conversation_id = pending.conversation_id
                          AND attempt.message_id = pending.message_id
                     )",
                    params![command_id, error_code],
                )
                .map_err(|error| error.to_string())?;
            let interaction_changed = transaction
                .execute(
                    "UPDATE messaging_interaction_intents SET state = 'failed'
                     WHERE command_id = ?1
                       AND state IN ('prepared', 'retry_wait')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let membership_intent_changed = transaction
                .execute(
                    "UPDATE messaging_membership_intents
                     SET state = 'failed'
                     WHERE command_id = ?1 AND state = 'prepared'",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let pending_transition_deleted = transaction
                .execute(
                    "DELETE FROM messaging_mls_pending_transitions
                     WHERE command_id = ?1",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            if local_changed != 1
                || outbox_changed != 1
                || attempt_changed != 1
                || !(pending_owner_transition_is_valid(
                    transaction,
                    command_id,
                    pending_changed,
                    interaction_changed,
                )? || (pending_transition_deleted == 1 && membership_intent_changed <= 1))
            {
                return Err("mobile messaging command failure was not fenced".to_string());
            }
            Ok(())
        })
    }

    fn mark_command_superseded(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
    ) -> Result<(), String> {
        self.with_transaction(|transaction| {
            let state = load_command_transition_state(transaction, command_id, command_bytes)?;
            if state.attempt_count != attempt_count
                || !matches!(state.local_state.as_str(), "prepared" | "submitted")
                || !matches!(state.outbox_state.as_str(), "pending" | "retry_wait")
            {
                return Err("mobile messaging command supersede transition mismatch".to_string());
            }
            let local_changed = transaction
                .execute(
                    "UPDATE messaging_local_commands SET state = 'superseded'
                     WHERE command_id = ?1 AND state IN ('prepared', 'submitted')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let outbox_changed = transaction
                .execute(
                    "UPDATE messaging_command_outbox
                     SET state = 'superseded', last_error_code = 'stale_delivery_plan'
                     WHERE command_id = ?1
                       AND attempt_count = ?2
                       AND state IN ('pending', 'retry_wait')",
                    params![command_id, i64::from(attempt_count)],
                )
                .map_err(|error| error.to_string())?;
            let attempt_changed = transaction
                .execute(
                    "UPDATE messaging_command_attempts SET state = 'superseded'
                     WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let pending_changed = transaction
                .execute(
                    "UPDATE messaging_pending_messages AS pending
                     SET state = 'draft', last_error_code = 'stale_delivery_plan'
                     WHERE EXISTS (
                        SELECT 1 FROM messaging_command_attempts attempt
                        WHERE attempt.command_id = ?1
                          AND attempt.conversation_id = pending.conversation_id
                          AND attempt.message_id = pending.message_id
                     )",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let interaction_changed = transaction
                .execute(
                    "UPDATE messaging_interaction_intents SET state = 'superseded'
                     WHERE command_id = ?1
                       AND state IN ('prepared', 'retry_wait')",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let membership_intent_changed = transaction
                .execute(
                    "UPDATE messaging_membership_intents
                     SET state = 'superseded', command_id = ''
                     WHERE command_id = ?1 AND state = 'prepared'",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            let pending_transition_deleted = transaction
                .execute(
                    "DELETE FROM messaging_mls_pending_transitions
                     WHERE command_id = ?1",
                    params![command_id],
                )
                .map_err(|error| error.to_string())?;
            if local_changed != 1
                || outbox_changed != 1
                || attempt_changed != 1
                || !(pending_owner_transition_is_valid(
                    transaction,
                    command_id,
                    pending_changed,
                    interaction_changed,
                )? || (pending_transition_deleted == 1 && membership_intent_changed <= 1))
            {
                return Err("mobile messaging command supersede was not fenced".to_string());
            }
            Ok(())
        })
    }

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        Ok(self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT event_sequence, event_hash FROM messaging_authority_heads
                 WHERE conversation_id = ?1",
                params![conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or((0, Vec::new())))
    }

    fn load_direct_session(&self, session_id: &str) -> Result<Option<DirectSession>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        load_direct_session(&connection, session_id)
    }

    fn load_direct_skipped_keys(
        &self,
        session_id: &str,
    ) -> Result<Vec<DrSkippedMessageKey>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT peer_ratchet_public_key, counter, message_key
                 FROM direct_skipped_message_keys
                 WHERE session_id = ?1 ORDER BY counter, peer_ratchet_public_key",
            )
            .map_err(|error| error.to_string())?;
        let keys = statement
            .query_map(params![session_id], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .map(|row| {
                let (peer_pub, counter, message_key) = row.map_err(|error| error.to_string())?;
                Ok(DrSkippedMessageKey {
                    session_id: session_id.to_string(),
                    peer_pub: fixed_key("peer ratchet public key", peer_pub)?,
                    counter: u32::try_from(counter).map_err(|_| "invalid skipped-key counter")?,
                    message_key: fixed_key("skipped message key", message_key)?,
                })
            })
            .collect();
        keys
    }

    fn commit_direct_receive(
        &self,
        commit: &DirectReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        self.with_transaction(|transaction| {
            let result = Self::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.projection.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            persist_direct_crypto(
                transaction,
                commit.session,
                commit.new_skipped,
                commit.consumed_skipped,
                commit.consumed_one_time_prekey_id,
            )?;
            transaction
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext, delivery_state,
                        committed_at_unix_ms, reply_to_message_id, thread_root_message_id
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'consumed', ?8, ?9, ?10)",
                    params![
                        commit.projection.conversation_id,
                        commit.projection.event_id,
                        commit.projection.event_sequence,
                        commit.projection.message_id,
                        commit.projection.sender_ptid,
                        commit.projection.sender_device_id,
                        commit.projection.plaintext,
                        commit.projection.committed_at_unix_ms,
                        commit.projection.reply_to_message_id,
                        commit.projection.thread_root_message_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            persist_received_message_attachments(
                transaction,
                &commit.projection.message_id,
                &commit.projection.attachments,
            )?;
            index_message_search(
                transaction,
                commit.conversation_id,
                &commit.projection.message_id,
                &commit.projection.plaintext,
                &commit.projection.attachments,
            )?;
            finish_direct_receive(
                transaction,
                commit.conversation_id,
                commit.projection.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.delivery_receipt_id,
                commit.delivery_receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }

    fn commit_direct_edit(&self, commit: &DirectEditCommit) -> Result<ReceiveCommitResult, String> {
        self.with_transaction(|transaction| {
            let result = Self::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            persist_direct_crypto(
                transaction,
                commit.session,
                commit.new_skipped,
                commit.consumed_skipped,
                commit.consumed_one_time_prekey_id,
            )?;
            let changed = transaction
                .execute(
                    "UPDATE messaging_message_projections
                     SET edited_text = ?1, edited_at_unix_ms = ?2
                     WHERE conversation_id = ?3 AND message_id = ?4",
                    params![
                        commit.edited_text,
                        commit.edited_at_unix_ms,
                        commit.conversation_id,
                        commit.message_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err("mobile messaging Direct edit target is unavailable".to_string());
            }
            let attachments = load_pending_attachments(transaction, commit.message_id)?;
            index_message_search(
                transaction,
                commit.conversation_id,
                commit.message_id,
                commit.edited_text,
                &attachments,
            )?;
            finish_direct_receive(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.delivery_receipt_id,
                commit.delivery_receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }

    fn load_signed_prekey(&self, id: i32) -> Result<[u8; 32], String> {
        let bytes = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT signed_prekey_private
                 FROM messaging_prekey_bundle
                 WHERE id = 1 AND signed_prekey_id = ?1",
                params![id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "mobile messaging signed prekey is unavailable".to_string())?;
        fixed_key("signed prekey", bytes)
    }

    fn load_one_time_prekey(&self, id: i32) -> Result<[u8; 32], String> {
        let bytes = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT private_key
                 FROM messaging_one_time_prekeys
                 WHERE prekey_id = ?1 AND state = 'available'",
                params![id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "mobile messaging one-time prekey is unavailable".to_string())?;
        fixed_key("one-time prekey", bytes)
    }

    fn validate_integrity(&self) -> Result<(), String> {
        let result: String = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if result != "ok" {
            return Err(format!("mobile messaging integrity check failed: {result}"));
        }
        Ok(())
    }

    fn prepare_for_atomic_replace(&self) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| error.to_string())
    }
}

impl AttachmentTransferRepository for MobileMessagingStore {
    fn attachment_transfer(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentTransferRecord>, String> {
        MobileMessagingStore::attachment_transfer(self, attachment_id)
    }

    fn attachment_upload_media_type(&self, attachment_id: &str) -> Result<String, String> {
        MobileMessagingStore::attachment_upload_media_type(self, attachment_id)
    }

    fn update_attachment_transfer_prepared(
        &self,
        attachment_id: &str,
        descriptor_sha256: &[u8],
        partial_local_ref: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        MobileMessagingStore::update_attachment_transfer_prepared(
            self,
            attachment_id,
            descriptor_sha256,
            partial_local_ref,
            updated_at_unix_ms,
        )
    }

    fn update_attachment_transfer_progress(
        &self,
        attachment_id: &str,
        state: i32,
        upload_id: &str,
        generation: u64,
        completed_chunk_bitmap: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        last_error_code: i32,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        MobileMessagingStore::update_attachment_transfer_progress(
            self,
            attachment_id,
            state,
            upload_id,
            generation,
            completed_chunk_bitmap,
            attempt_count,
            next_attempt_at_unix_ms,
            last_error_code,
            updated_at_unix_ms,
        )
    }

    fn complete_attachment_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        MobileMessagingStore::complete_attachment_upload(
            self,
            transfer,
            descriptor,
            updated_at_unix_ms,
        )
    }

    fn complete_attachment_download(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        MobileMessagingStore::complete_attachment_download(
            self,
            transfer,
            descriptor,
            cache_path,
            updated_at_unix_ms,
        )
    }
}

impl DirectOutboundRepository for MobileMessagingStore {
    fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[messaging_core::proto::chat::AttachmentPlaintextMetadata],
    ) -> Result<(), String> {
        MobileMessagingStore::validate_sender_attachments_ready(
            self,
            conversation_id,
            message_id,
            attachments,
        )
    }

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingRepository::authority_head(self, conversation_id)
    }

    fn load_direct_outbound_session(
        &self,
        conversation_id: &str,
        peer: &CryptoEndpoint,
    ) -> Result<Option<DirectOutboundSession>, String> {
        peer.validate()?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let session_id = connection
            .query_row(
                "SELECT session_id FROM direct_sessions
                 WHERE conversation_id = ?1
                   AND peer_ptid = ?2
                   AND peer_device_id = ?3
                   AND established = 1
                 ORDER BY generation DESC
                 LIMIT 1",
                params![conversation_id, peer.ptid, peer.device_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(session_id) = session_id else {
            return Ok(None);
        };
        let session = load_direct_session(&connection, &session_id)?
            .ok_or_else(|| "mobile messaging Direct session disappeared".to_string())?;
        let session_init = connection
            .query_row(
                "SELECT init_bytes FROM direct_session_bootstraps WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        Ok(Some(DirectOutboundSession {
            session,
            session_init,
        }))
    }

    fn next_direct_session_generation(
        &self,
        conversation_id: &str,
        peer: &CryptoEndpoint,
    ) -> Result<u64, String> {
        if conversation_id.trim().is_empty() {
            return Err("mobile messaging Direct conversation ID is required".to_string());
        }
        peer.validate()?;
        let generation = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT COALESCE(MAX(generation), 0) + 1 FROM direct_sessions
                 WHERE conversation_id = ?1
                   AND peer_ptid = ?2
                   AND peer_device_id = ?3",
                params![conversation_id, peer.ptid, peer.device_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        u64::try_from(generation)
            .map_err(|_| "mobile messaging Direct session generation is invalid".to_string())
    }

    fn persist_direct_outbound_send(
        &self,
        commit: &DirectOutboundSendCommit<'_>,
    ) -> Result<(), String> {
        validate_pending_sender(&commit.projection, commit.command_bytes)?;
        if commit.session_advances.is_empty() {
            return Err("mobile messaging Direct send requires sessions".to_string());
        }
        self.with_transaction(|transaction| {
            validate_expected_authority_head(
                transaction,
                commit.projection.conversation_id,
                commit.expected_authority_sequence,
                commit.expected_authority_hash,
            )?;
            persist_pending_sender(transaction, commit.command_bytes, &commit.projection)?;
            persist_direct_session_advances(
                transaction,
                commit.session_advances,
                commit.projection.conversation_id,
                commit.projection.sender_ptid,
                commit.projection.sender_device_id,
            )
        })
    }

    fn persist_direct_outbound_edit(
        &self,
        commit: &DirectOutboundEditCommit<'_>,
    ) -> Result<(), String> {
        if commit.session_advances.is_empty() {
            return Err("mobile messaging Direct edit requires sessions".to_string());
        }
        let local = &commit.session_advances[0].advanced.key.local;
        self.with_transaction(|transaction| {
            validate_expected_authority_head(
                transaction,
                commit.conversation_id,
                commit.expected_authority_sequence,
                commit.expected_authority_hash,
            )?;
            persist_interaction_command(
                transaction,
                commit.command_id,
                commit.conversation_id,
                commit.target_message_id,
                "edit",
                Some(commit.edited_text),
                commit.command_bytes,
                commit.delivery_plan_sha256,
                commit.created_at_unix_ms,
            )?;
            persist_direct_session_advances(
                transaction,
                commit.session_advances,
                commit.conversation_id,
                &local.ptid,
                &local.device_id,
            )
        })
    }
}

#[derive(Clone)]
pub(crate) struct MobileOutboxStore(pub Arc<MobileMessagingStore>);

impl OutboxStore for MobileOutboxStore {
    fn next_command(&self, now_unix_ms: i64) -> Result<Option<CommandOutboxEntry>, String> {
        MessagingRepository::next_command(self.0.as_ref(), now_unix_ms)
    }

    fn mark_command_submitted(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
    ) -> Result<(), String> {
        MessagingRepository::mark_command_submitted(
            self.0.as_ref(),
            command_id,
            command_bytes,
            attempt_count,
        )
    }

    fn mark_command_retry(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        error_code: &str,
    ) -> Result<(), String> {
        MessagingRepository::mark_command_retry(
            self.0.as_ref(),
            command_id,
            command_bytes,
            attempt_count,
            next_attempt_at_unix_ms,
            error_code,
        )
    }

    fn mark_command_failed(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
        error_code: &str,
    ) -> Result<(), String> {
        MessagingRepository::mark_command_failed(
            self.0.as_ref(),
            command_id,
            command_bytes,
            attempt_count,
            error_code,
        )
    }

    fn mark_command_superseded(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
    ) -> Result<(), String> {
        MessagingRepository::mark_command_superseded(
            self.0.as_ref(),
            command_id,
            command_bytes,
            attempt_count,
        )
    }
}

impl MlsOutboundRepository for MobileMessagingStore {
    fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[messaging_core::proto::chat::AttachmentPlaintextMetadata],
    ) -> Result<(), String> {
        MobileMessagingStore::validate_sender_attachments_ready(
            self,
            conversation_id,
            message_id,
            attachments,
        )
    }

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingRepository::authority_head(self, conversation_id)
    }

    fn persist_mls_outbound_send(&self, commit: &MlsOutboundSendCommit<'_>) -> Result<(), String> {
        validate_pending_sender(&commit.projection, commit.command_bytes)?;
        MlsOutboundRepository::validate_sender_attachments_ready(
            self,
            commit.projection.conversation_id,
            commit.projection.message_id,
            commit.projection.attachments,
        )?;
        if commit.session_state.is_empty() || commit.membership_epoch < 0 || commit.mls_epoch < 0 {
            return Err("mobile messaging MLS send state is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            validate_expected_authority_head(
                transaction,
                commit.projection.conversation_id,
                commit.expected_authority_sequence,
                commit.expected_authority_hash,
            )?;
            persist_pending_sender(transaction, commit.command_bytes, &commit.projection)?;
            persist_mls_session(
                transaction,
                commit.projection.conversation_id,
                commit.session_state,
                commit.membership_epoch,
                commit.mls_epoch,
                commit.projection.created_at_unix_ms,
            )
        })
    }

    fn persist_mls_outbound_edit(&self, commit: &MlsOutboundEditCommit<'_>) -> Result<(), String> {
        if commit.command_id.trim().is_empty()
            || commit.conversation_id.trim().is_empty()
            || commit.target_message_id.trim().is_empty()
            || commit.edited_text.trim().is_empty()
            || commit.command_bytes.is_empty()
            || commit.delivery_plan_sha256.len() != 32
            || commit.session_state.is_empty()
            || commit.membership_epoch < 0
            || commit.mls_epoch < 0
            || commit.created_at_unix_ms <= 0
        {
            return Err("mobile messaging MLS edit state is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            validate_expected_authority_head(
                transaction,
                commit.conversation_id,
                commit.expected_authority_sequence,
                commit.expected_authority_hash,
            )?;
            persist_interaction_command(
                transaction,
                commit.command_id,
                commit.conversation_id,
                commit.target_message_id,
                "edit",
                Some(commit.edited_text),
                commit.command_bytes,
                commit.delivery_plan_sha256,
                commit.created_at_unix_ms,
            )?;
            persist_mls_session(
                transaction,
                commit.conversation_id,
                commit.session_state,
                commit.membership_epoch,
                commit.mls_epoch,
                commit.created_at_unix_ms,
            )
        })
    }
}

impl MlsTransitionRepository for MobileMessagingStore {
    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingRepository::authority_head(self, conversation_id)
    }

    fn persist_mls_transition(&self, commit: &MlsTransitionSendCommit<'_>) -> Result<(), String> {
        if commit.command_id.trim().is_empty()
            || commit.conversation_id.trim().is_empty()
            || commit.transition_id.trim().is_empty()
            || commit.delivery_plan_sha256.len() != 32
            || commit.command_bytes.is_empty()
            || commit.pending_transition_state.is_empty()
            || commit.created_at_unix_ms <= 0
        {
            return Err("mobile messaging MLS transition state is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            if let Some(intent_id) = commit.logical_intent_id {
                let changed = transaction
                    .execute(
                        "UPDATE messaging_membership_intents
                         SET state = 'prepared', command_id = ?2
                         WHERE intent_id = ?1 AND conversation_id = ?3
                           AND state IN ('pending_plan', 'superseded')",
                        params![intent_id, commit.command_id, commit.conversation_id],
                    )
                    .map_err(|error| error.to_string())?;
                if changed != 1 {
                    return Err(
                        "mobile messaging logical membership intent is not pending".to_string()
                    );
                }
            }
            persist_local_command(
                transaction,
                commit.command_id,
                commit.conversation_id,
                commit.command_bytes,
                commit.created_at_unix_ms,
            )?;
            transaction
                .execute(
                    "INSERT INTO messaging_command_attempts(
                        command_id, conversation_id, message_id,
                        delivery_plan_sha256, state, created_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, 'prepared', ?5)",
                    params![
                        commit.command_id,
                        commit.conversation_id,
                        commit.transition_id,
                        commit.delivery_plan_sha256,
                        commit.created_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO messaging_mls_pending_transitions(
                        conversation_id, transition_id, command_id, transition_state
                     ) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        commit.conversation_id,
                        commit.transition_id,
                        commit.command_id,
                        commit.pending_transition_state
                    ],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }
}

impl MlsKeyPackageRepository for MobileMessagingStore {
    fn has_mls_key_packages(&self) -> Result<bool, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messaging_mls_key_packages)",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    fn install_fresh_mls_key_packages(
        &self,
        packages: &[Vec<u8>],
        provider_pool_state: &[u8],
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        if packages.is_empty()
            || packages.iter().any(Vec::is_empty)
            || provider_pool_state.is_empty()
            || created_at_unix_ms <= 0
        {
            return Err("mobile messaging MLS KeyPackage batch is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            let active = transaction
                .query_row(
                    "SELECT status = 'active' FROM messaging_recovery_state WHERE id = 1",
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .unwrap_or(false);
            if !active {
                return Err(
                    "mobile messaging MLS KeyPackages require active device enrollment".to_string(),
                );
            }
            persist_mls_provider_pool(transaction, provider_pool_state, created_at_unix_ms)?;
            let mut package_ids = std::collections::HashSet::with_capacity(packages.len());
            for package in packages {
                let package_id = hex_bytes(Sha256::digest(package).as_slice());
                if !package_ids.insert(package_id.clone()) {
                    return Err(
                        "mobile messaging MLS KeyPackage batch contains duplicates".to_string()
                    );
                }
                transaction
                    .execute(
                        "INSERT INTO messaging_mls_key_packages(
                            package_id, data, state, created_at_unix_ms
                         ) VALUES (?1, ?2, 'awaiting_publication', ?3)",
                        params![package_id, package, created_at_unix_ms],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    fn pending_mls_key_packages(&self) -> Result<Vec<PendingMlsKeyPackage>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT package_id, data FROM messaging_mls_key_packages
                 WHERE state = 'awaiting_publication' ORDER BY package_id",
            )
            .map_err(|error| error.to_string())?;
        let packages = statement
            .query_map([], |row| {
                Ok(PendingMlsKeyPackage {
                    package_id: row.get(0)?,
                    data: row.get(1)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(packages)
    }

    fn complete_mls_key_package_publication(&self, package_id: &str) -> Result<(), String> {
        if package_id.trim().is_empty() {
            return Err("mobile messaging MLS KeyPackage ID is required".to_string());
        }
        let changed = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .execute(
                "UPDATE messaging_mls_key_packages SET state = 'published'
                 WHERE package_id = ?1 AND state = 'awaiting_publication'",
                params![package_id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging MLS KeyPackage publication was not applied".to_string());
        }
        Ok(())
    }
}

impl MlsStartupRepository for MobileMessagingStore {
    fn list_mls_session_states(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, session_state
                 FROM messaging_mls_groups ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let states = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(states)
    }

    fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String> {
        load_mls_provider_pool(&self.connection)
    }

    fn list_pending_mls_transitions(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, transition_state
                 FROM messaging_mls_pending_transitions ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let transitions = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(transitions)
    }
}

impl MlsInboundRepository for MobileMessagingStore {
    fn persist_claimed_item(
        &self,
        item_id: &str,
        event_id: &str,
        conversation_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
        opaque_payload: &[u8],
        now_unix_ms: i64,
    ) -> Result<(), String> {
        MessagingRepository::persist_claimed_item(
            self,
            item_id,
            event_id,
            conversation_id,
            lane_sequence,
            consumer_epoch,
            payload_sha256,
            opaque_payload,
            now_unix_ms,
        )
    }

    fn consumption_marker_matches(
        &self,
        item_id: &str,
        payload_sha256: &[u8],
    ) -> Result<bool, String> {
        MessagingRepository::consumption_marker_matches(self, item_id, payload_sha256)
    }

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingRepository::authority_head(self, conversation_id)
    }

    fn load_mls_session_state(&self, conversation_id: &str) -> Result<Option<Vec<u8>>, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT session_state FROM messaging_mls_groups WHERE conversation_id = ?1",
                params![conversation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String> {
        load_mls_provider_pool(&self.connection)
    }

    fn has_mls_retired_checkpoint(&self, conversation_id: &str) -> Result<bool, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM messaging_mls_retired_checkpoints
                    WHERE conversation_id = ?1
                 )",
                params![conversation_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    fn pending_mls_transition(
        &self,
        conversation_id: &str,
    ) -> Result<Option<PendingMlsTransitionState>, String> {
        self.connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?
            .query_row(
                "SELECT transition_id, command_id, transition_state
                 FROM messaging_mls_pending_transitions WHERE conversation_id = ?1",
                params![conversation_id],
                |row| {
                    Ok(PendingMlsTransitionState {
                        transition_id: row.get(0)?,
                        command_id: row.get(1)?,
                        state: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn commit_interaction_event(
        &self,
        commit: &InteractionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        MessagingRepository::commit_interaction_event(self, commit)
    }

    fn commit_mls_application(
        &self,
        commit: &MlsApplicationReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        if commit.session_state.is_empty()
            || commit.membership_epoch < 0
            || commit.mls_epoch < 0
            || commit.projection.conversation_id != commit.conversation_id
            || commit.projection.event_id != commit.event_id
            || commit.projection.message_id.trim().is_empty()
            || commit.projection.sender_ptid.trim().is_empty()
            || commit.projection.sender_device_id.trim().is_empty()
            || commit.projection.committed_at_unix_ms <= 0
        {
            return Err("mobile messaging MLS application is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            let result = MobileMessagingStore::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.projection.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            persist_mls_session(
                transaction,
                commit.conversation_id,
                commit.session_state,
                commit.membership_epoch,
                commit.mls_epoch,
                commit.consumed_at_unix_ms,
            )?;
            transaction
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext, delivery_state,
                        committed_at_unix_ms, reply_to_message_id, thread_root_message_id
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'consumed', ?8, ?9, ?10)",
                    params![
                        commit.projection.conversation_id,
                        commit.projection.event_id,
                        commit.projection.event_sequence,
                        commit.projection.message_id,
                        commit.projection.sender_ptid,
                        commit.projection.sender_device_id,
                        commit.projection.plaintext,
                        commit.projection.committed_at_unix_ms,
                        commit.projection.reply_to_message_id,
                        commit.projection.thread_root_message_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            persist_received_message_attachments(
                transaction,
                &commit.projection.message_id,
                &commit.projection.attachments,
            )?;
            index_message_search(
                transaction,
                commit.conversation_id,
                &commit.projection.message_id,
                &commit.projection.plaintext,
                &commit.projection.attachments,
            )?;
            finish_authority_receive(
                transaction,
                commit.conversation_id,
                commit.projection.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }

    fn commit_mls_transition_receive(
        &self,
        commit: &MlsTransitionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        if commit.transition_id.trim().is_empty()
            || commit.session_state.is_empty()
            || commit.from_membership_epoch < 0
            || commit.to_membership_epoch < commit.from_membership_epoch
            || commit.from_mls_epoch < 0
            || commit.to_mls_epoch < commit.from_mls_epoch
        {
            return Err("mobile messaging MLS transition is incomplete".to_string());
        }
        let projection = commit.authority_projection;
        if !projection.active {
            return Err("mobile messaging MLS authority projection must be active".to_string());
        }
        validate_mls_projection(
            projection,
            commit.conversation_id,
            commit.to_membership_epoch,
            commit.to_mls_epoch,
        )?;
        self.with_transaction(|transaction| {
            let result = MobileMessagingStore::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                commit.allow_join_checkpoint,
            )?;
            persist_mls_session(
                transaction,
                commit.conversation_id,
                commit.session_state,
                commit.to_membership_epoch,
                commit.to_mls_epoch,
                commit.consumed_at_unix_ms,
            )?;
            if let Some(provider_pool) = commit.provider_pool_state {
                persist_mls_provider_pool(transaction, provider_pool, commit.consumed_at_unix_ms)?;
            }
            persist_mls_conversation(transaction, projection, commit.consumed_at_unix_ms)?;
            if commit.allow_join_checkpoint {
                transaction
                    .execute(
                        "DELETE FROM messaging_mls_retired_checkpoints
                         WHERE conversation_id = ?1",
                        params![commit.conversation_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "INSERT INTO messaging_mls_applied_transitions(
                        conversation_id, transition_id, event_id, event_sequence,
                        transition_kind, from_membership_epoch, to_membership_epoch,
                        from_mls_epoch, to_mls_epoch, applied_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        commit.conversation_id,
                        commit.transition_id,
                        commit.event_id,
                        commit.event_sequence,
                        commit.transition_kind,
                        commit.from_membership_epoch,
                        commit.to_membership_epoch,
                        commit.from_mls_epoch,
                        commit.to_mls_epoch,
                        commit.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            finish_authority_receive(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }

    fn commit_mls_sender_transition(
        &self,
        commit: &MlsSenderTransitionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        if commit.command_id.trim().is_empty()
            || commit.transition_id.trim().is_empty()
            || commit.session_state.is_empty()
            || commit.membership_epoch < 0
            || commit.mls_epoch < 0
        {
            return Err("mobile messaging MLS sender transition is incomplete".to_string());
        }
        let projection = commit.authority_projection;
        if !projection.active {
            return Err(
                "mobile messaging MLS sender authority projection must be active".to_string(),
            );
        }
        validate_mls_projection(
            projection,
            commit.conversation_id,
            commit.membership_epoch,
            commit.mls_epoch,
        )?;
        self.with_transaction(|transaction| {
            let result = MobileMessagingStore::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            let pending = transaction
                .query_row(
                    "SELECT transition_id, command_id
                     FROM messaging_mls_pending_transitions
                     WHERE conversation_id = ?1",
                    params![commit.conversation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "mobile messaging MLS pending transition is unavailable".to_string()
                })?;
            if pending
                != (
                    commit.transition_id.to_string(),
                    commit.command_id.to_string(),
                )
            {
                return Err("mobile messaging MLS pending transition binding mismatch".to_string());
            }
            persist_mls_session(
                transaction,
                commit.conversation_id,
                commit.session_state,
                commit.membership_epoch,
                commit.mls_epoch,
                commit.consumed_at_unix_ms,
            )?;
            persist_mls_conversation(transaction, projection, commit.consumed_at_unix_ms)?;
            for table in [
                "messaging_local_commands",
                "messaging_command_outbox",
                "messaging_command_attempts",
            ] {
                let changed = transaction
                    .execute(
                        &format!("UPDATE {table} SET state = 'committed' WHERE command_id = ?1"),
                        params![commit.command_id],
                    )
                    .map_err(|error| error.to_string())?;
                if changed != 1 {
                    return Err(
                        "mobile messaging MLS sender command transition mismatch".to_string()
                    );
                }
            }
            transaction
                .execute(
                    "UPDATE messaging_membership_intents SET state = 'committed'
                     WHERE command_id = ?1 AND state = 'prepared'",
                    params![commit.command_id],
                )
                .map_err(|error| error.to_string())?;
            let deleted = transaction
                .execute(
                    "DELETE FROM messaging_mls_pending_transitions
                     WHERE conversation_id = ?1 AND transition_id = ?2 AND command_id = ?3",
                    params![
                        commit.conversation_id,
                        commit.transition_id,
                        commit.command_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            if deleted != 1 {
                return Err("mobile messaging MLS pending transition was not consumed".to_string());
            }
            finish_authority_receive(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }

    fn commit_mls_retirement(
        &self,
        commit: &MlsRetirementReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        validate_mls_projection(
            commit.projection,
            commit.conversation_id,
            commit.membership_epoch,
            commit.mls_epoch,
        )?;
        if commit.transition_id.trim().is_empty()
            || commit.endpoint_ptid.trim().is_empty()
            || commit.endpoint_device_id.trim().is_empty()
        {
            return Err("mobile messaging MLS retirement is incomplete".to_string());
        }
        self.with_transaction(|transaction| {
            let result = MobileMessagingStore::commit_claimed_item(
                transaction,
                commit.item_id,
                commit.event_id,
                commit.conversation_id,
                commit.lane_sequence,
                commit.consumer_epoch,
                commit.payload_sha256,
                commit.consumed_at_unix_ms,
            )?;
            if result == ReceiveCommitResult::AlreadyCommitted {
                return Ok(result);
            }
            validate_authority_event(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.previous_event_hash,
                false,
            )?;
            transaction
                .execute(
                    "DELETE FROM messaging_mls_groups WHERE conversation_id = ?1",
                    params![commit.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM messaging_mls_pending_transitions WHERE conversation_id = ?1",
                    params![commit.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO messaging_mls_retired_checkpoints(
                        conversation_id, transition_id, event_id,
                        retirement_sequence, retirement_hash,
                        endpoint_ptid, endpoint_device_id,
                        membership_epoch, mls_epoch, retired_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        transition_id=excluded.transition_id,
                        event_id=excluded.event_id,
                        retirement_sequence=excluded.retirement_sequence,
                        retirement_hash=excluded.retirement_hash,
                        endpoint_ptid=excluded.endpoint_ptid,
                        endpoint_device_id=excluded.endpoint_device_id,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        retired_at_unix_ms=excluded.retired_at_unix_ms",
                    params![
                        commit.conversation_id,
                        commit.transition_id,
                        commit.event_id,
                        commit.event_sequence,
                        commit.event_hash,
                        commit.endpoint_ptid,
                        commit.endpoint_device_id,
                        commit.membership_epoch,
                        commit.mls_epoch,
                        commit.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            persist_mls_conversation(transaction, commit.projection, commit.consumed_at_unix_ms)?;
            finish_authority_receive(
                transaction,
                commit.conversation_id,
                commit.event_sequence,
                commit.event_hash,
                commit.event_id,
                commit.receipt_id,
                commit.receipt_bytes,
                commit.consumed_at_unix_ms,
            )?;
            Ok(result)
        })
    }
}

fn persist_local_command(
    transaction: &Transaction<'_>,
    command_id: &str,
    conversation_id: &str,
    command_bytes: &[u8],
    created_at_unix_ms: i64,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO messaging_local_commands(
                command_id, conversation_id, command_bytes, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'prepared', ?4)",
            params![
                command_id,
                conversation_id,
                command_bytes,
                created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO messaging_command_outbox(
                command_id, conversation_id, command_bytes, state, attempt_count,
                next_attempt_at_unix_ms, last_error_code, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'pending', 0, ?4, '', ?4)",
            params![
                command_id,
                conversation_id,
                command_bytes,
                created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_pending_sender(
    projection: &PendingSenderProjection<'_>,
    command_bytes: &[u8],
) -> Result<(), String> {
    if projection.command_id.trim().is_empty()
        || projection.conversation_id.trim().is_empty()
        || projection.conversation_kind <= 0
        || projection.message_id.trim().is_empty()
        || projection.sender_ptid.trim().is_empty()
        || projection.sender_device_id.trim().is_empty()
        || projection.delivery_plan_sha256.len() != 32
        || projection.private_content.is_empty()
        || projection.created_at_unix_ms <= 0
        || command_bytes.is_empty()
    {
        return Err("mobile messaging pending sender projection is incomplete".to_string());
    }
    let private_content = messaging_core::codec::private_content::decode_message_private_content(
        projection.private_content,
    )?;
    if private_content.text != projection.plaintext
        || private_content.attachments != projection.attachments
    {
        return Err(
            "mobile messaging pending sender private content does not match projection".to_string(),
        );
    }
    Ok(())
}

fn persist_pending_sender(
    transaction: &Transaction<'_>,
    command_bytes: &[u8],
    projection: &PendingSenderProjection<'_>,
) -> Result<(), String> {
    persist_local_command(
        transaction,
        projection.command_id,
        projection.conversation_id,
        command_bytes,
        projection.created_at_unix_ms,
    )?;
    let changed = transaction
        .execute(
            "INSERT INTO messaging_pending_messages(
                conversation_id, conversation_kind, message_id, sender_ptid,
                sender_device_id, plaintext, reply_to_message_id,
                thread_root_message_id, state, attempt_count,
                next_attempt_at_unix_ms, last_error_code, created_at_unix_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', 0, ?9, '', ?9
             )
             ON CONFLICT(conversation_id, message_id) DO UPDATE SET
                state='pending',
                conversation_kind=excluded.conversation_kind,
                last_error_code=''
             WHERE messaging_pending_messages.sender_ptid = excluded.sender_ptid
               AND messaging_pending_messages.sender_device_id = excluded.sender_device_id
               AND messaging_pending_messages.plaintext = excluded.plaintext
               AND messaging_pending_messages.reply_to_message_id = excluded.reply_to_message_id
               AND messaging_pending_messages.thread_root_message_id = excluded.thread_root_message_id",
            params![
                projection.conversation_id,
                projection.conversation_kind,
                projection.message_id,
                projection.sender_ptid,
                projection.sender_device_id,
                projection.plaintext,
                projection.reply_to_message_id,
                projection.thread_root_message_id,
                projection.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err(
            "mobile messaging pending logical message conflicts with existing draft".to_string(),
        );
    }
    persist_sender_message_attachments(transaction, projection.message_id, projection.attachments)?;
    let staged_count = transaction
        .query_row(
            "SELECT COUNT(*) FROM messaging_attachment_drafts WHERE message_id = ?1",
            params![projection.message_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let staged_deleted = transaction
        .execute(
            "DELETE FROM messaging_attachment_drafts WHERE message_id = ?1",
            params![projection.message_id],
        )
        .map_err(|error| error.to_string())?;
    if staged_count > 0
        && (staged_count as usize != projection.attachments.len()
            || staged_deleted != projection.attachments.len())
    {
        return Err("mobile messaging staged attachment promotion mismatch".to_string());
    }
    transaction
        .execute(
            "INSERT INTO messaging_command_attempts(
                command_id, conversation_id, message_id,
                delivery_plan_sha256, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, 'prepared', ?5)",
            params![
                projection.command_id,
                projection.conversation_id,
                projection.message_id,
                projection.delivery_plan_sha256,
                projection.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn persist_interaction_command(
    transaction: &Transaction<'_>,
    command_id: &str,
    conversation_id: &str,
    target_message_id: &str,
    interaction_kind: &str,
    edited_text: Option<&str>,
    command_bytes: &[u8],
    delivery_plan_sha256: &[u8],
    created_at_unix_ms: i64,
) -> Result<(), String> {
    if command_id.trim().is_empty()
        || conversation_id.trim().is_empty()
        || target_message_id.trim().is_empty()
        || interaction_kind.trim().is_empty()
        || command_bytes.is_empty()
        || delivery_plan_sha256.len() != 32
        || created_at_unix_ms <= 0
        || (interaction_kind == "edit" && edited_text.is_none_or(|value| value.trim().is_empty()))
        || (interaction_kind != "edit" && edited_text.is_some())
    {
        return Err("mobile messaging interaction command is incomplete".to_string());
    }
    persist_local_command(
        transaction,
        command_id,
        conversation_id,
        command_bytes,
        created_at_unix_ms,
    )?;
    transaction
        .execute(
            "INSERT INTO messaging_command_attempts(
                command_id, conversation_id, message_id,
                delivery_plan_sha256, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, 'prepared', ?5)",
            params![
                command_id,
                conversation_id,
                target_message_id,
                delivery_plan_sha256,
                created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO messaging_interaction_intents(
                command_id, conversation_id, target_message_id,
                interaction_kind, edited_text, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'prepared', ?6)",
            params![
                command_id,
                conversation_id,
                target_message_id,
                interaction_kind,
                edited_text,
                created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn persist_mls_provider_pool(
    transaction: &Transaction<'_>,
    provider_pool_state: &[u8],
    updated_at_unix_ms: i64,
) -> Result<(), String> {
    if provider_pool_state.is_empty() || updated_at_unix_ms <= 0 {
        return Err("mobile messaging MLS provider pool is incomplete".to_string());
    }
    transaction
        .execute(
            "INSERT INTO messaging_mls_join_provider_pool(
                id, provider_pool_state, updated_at_unix_ms
             ) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
                provider_pool_state=excluded.provider_pool_state,
                updated_at_unix_ms=excluded.updated_at_unix_ms",
            params![provider_pool_state, updated_at_unix_ms],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_mls_provider_pool(connection: &Mutex<Connection>) -> Result<Option<Vec<u8>>, String> {
    connection
        .lock()
        .map_err(|_| "mobile messaging store lock poisoned".to_string())?
        .query_row(
            "SELECT provider_pool_state FROM messaging_mls_join_provider_pool WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn validate_mls_projection(
    projection: &MlsConversationProjection,
    conversation_id: &str,
    membership_epoch: i64,
    mls_epoch: i64,
) -> Result<(), String> {
    if projection.conversation_id != conversation_id
        || projection.authority_station_id.trim().is_empty()
        || projection.federation_id.trim().is_empty()
        || projection.owner_ptid.trim().is_empty()
        || projection.membership_epoch != membership_epoch
        || projection.mls_epoch != mls_epoch
        || projection.members.is_empty()
        || membership_epoch < 0
        || mls_epoch < 0
    {
        return Err("mobile messaging MLS conversation projection is invalid".to_string());
    }
    Ok(())
}

fn persist_mls_conversation(
    transaction: &Transaction<'_>,
    projection: &MlsConversationProjection,
    updated_at_unix_ms: i64,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO messaging_conversations(
                conversation_id, authority_station_id, federation_id,
                kind, name, owner_ptid,
                membership_epoch, mls_epoch, active, updated_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(conversation_id) DO UPDATE SET
                authority_station_id=excluded.authority_station_id,
                federation_id=excluded.federation_id,
                kind=excluded.kind,
                name=excluded.name,
                owner_ptid=excluded.owner_ptid,
                membership_epoch=excluded.membership_epoch,
                mls_epoch=excluded.mls_epoch,
                active=excluded.active,
                updated_at_unix_ms=excluded.updated_at_unix_ms",
            params![
                projection.conversation_id,
                projection.authority_station_id,
                projection.federation_id,
                projection.kind,
                projection.name,
                projection.owner_ptid,
                projection.membership_epoch,
                projection.mls_epoch,
                projection.active,
                updated_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM messaging_conversation_members WHERE conversation_id = ?1",
            params![projection.conversation_id],
        )
        .map_err(|error| error.to_string())?;
    for member in &projection.members {
        if member.ptid.trim().is_empty() {
            return Err("mobile messaging MLS conversation member is invalid".to_string());
        }
        transaction
            .execute(
                "INSERT INTO messaging_conversation_members(
                    conversation_id, ptid, role, active
                 ) VALUES (?1, ?2, ?3, 1)",
                params![projection.conversation_id, member.ptid, member.role],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn persist_direct_crypto(
    transaction: &Transaction<'_>,
    session: &DirectSession,
    new_skipped: &[DrSkippedMessageKey],
    consumed_skipped: Option<([u8; 32], u32)>,
    consumed_one_time_prekey_id: Option<i32>,
) -> Result<(), String> {
    session.key.validate()?;
    if let Some(prekey_id) = consumed_one_time_prekey_id {
        let changed = transaction
            .execute(
                "UPDATE messaging_one_time_prekeys
                 SET state = 'consumed'
                 WHERE prekey_id = ?1 AND state = 'available'",
                params![prekey_id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging one-time prekey was not consumed".to_string());
        }
    }
    upsert_direct_session(transaction, session)?;
    for skipped in new_skipped {
        if skipped.session_id != session.session_id {
            return Err("mobile messaging skipped key belongs to another session".to_string());
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO direct_skipped_message_keys(
                    session_id, peer_ratchet_public_key, counter, message_key
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    skipped.session_id,
                    skipped.peer_pub.as_slice(),
                    i64::from(skipped.counter),
                    skipped.message_key.as_slice()
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    if let Some((peer_pub, counter)) = consumed_skipped {
        transaction
            .execute(
                "DELETE FROM direct_skipped_message_keys
                 WHERE session_id = ?1 AND peer_ratchet_public_key = ?2 AND counter = ?3",
                params![session.session_id, peer_pub.as_slice(), i64::from(counter)],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn finish_direct_receive(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    event_sequence: i64,
    event_hash: &[u8],
    event_id: &str,
    receipt_id: &str,
    receipt_bytes: &[u8],
    _delivery_receipt_id: &str,
    _delivery_receipt_bytes: &[u8],
    now_unix_ms: i64,
) -> Result<(), String> {
    finish_authority_receive(
        transaction,
        conversation_id,
        event_sequence,
        event_hash,
        event_id,
        receipt_id,
        receipt_bytes,
        now_unix_ms,
    )?;
    Ok(())
}

fn finish_authority_receive(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    event_sequence: i64,
    event_hash: &[u8],
    event_id: &str,
    receipt_id: &str,
    receipt_bytes: &[u8],
    now_unix_ms: i64,
) -> Result<(), String> {
    if receipt_id.trim().is_empty() || receipt_bytes.is_empty() {
        return Err("mobile messaging consumption receipt is incomplete".to_string());
    }
    transaction
        .execute(
            "INSERT INTO messaging_authority_heads(
                conversation_id, event_sequence, event_hash, updated_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(conversation_id) DO UPDATE SET
                event_sequence=excluded.event_sequence,
                event_hash=excluded.event_hash,
                updated_at_unix_ms=excluded.updated_at_unix_ms",
            params![conversation_id, event_sequence, event_hash, now_unix_ms],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO messaging_receipt_outbox(
                receipt_id, event_id, receipt_bytes, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'pending', ?4)",
            params![receipt_id, event_id, receipt_bytes, now_unix_ms],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn persist_mls_session(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    session_state: &[u8],
    membership_epoch: i64,
    mls_epoch: i64,
    updated_at_unix_ms: i64,
) -> Result<(), String> {
    if conversation_id.trim().is_empty()
        || session_state.is_empty()
        || membership_epoch < 0
        || mls_epoch < 0
        || updated_at_unix_ms <= 0
    {
        return Err("mobile messaging MLS session state is incomplete".to_string());
    }
    transaction
        .execute(
            "INSERT INTO messaging_mls_groups(
                conversation_id, session_state, membership_epoch, mls_epoch, updated_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(conversation_id) DO UPDATE SET
                session_state=excluded.session_state,
                membership_epoch=excluded.membership_epoch,
                mls_epoch=excluded.mls_epoch,
                updated_at_unix_ms=excluded.updated_at_unix_ms",
            params![
                conversation_id,
                session_state,
                membership_epoch,
                mls_epoch,
                updated_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_expected_authority_head(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    expected_sequence: i64,
    expected_hash: &[u8],
) -> Result<(), String> {
    if conversation_id.trim().is_empty()
        || expected_sequence < 0
        || (expected_sequence == 0 && !expected_hash.is_empty())
        || (expected_sequence > 0 && expected_hash.len() != 32)
    {
        return Err("mobile messaging expected authority head is invalid".to_string());
    }
    let actual = transaction
        .query_row(
            "SELECT event_sequence, event_hash FROM messaging_authority_heads
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or((0, Vec::new()));
    if actual != (expected_sequence, expected_hash.to_vec()) {
        return Err("mobile messaging authority head changed during send preparation".to_string());
    }
    Ok(())
}

struct CommandTransitionState {
    local_state: String,
    outbox_state: String,
    attempt_count: u32,
}

fn load_command_transition_state(
    transaction: &Transaction<'_>,
    command_id: &str,
    command_bytes: &[u8],
) -> Result<CommandTransitionState, String> {
    if command_id.trim().is_empty() || command_bytes.is_empty() {
        return Err("mobile messaging command transition identity is incomplete".to_string());
    }
    let row = transaction
        .query_row(
            "SELECT local.command_bytes, local.state,
                    outbox.command_bytes, outbox.state, outbox.attempt_count
             FROM messaging_local_commands local
             JOIN messaging_command_outbox outbox
               ON outbox.command_id = local.command_id
             WHERE local.command_id = ?1",
            params![command_id],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "mobile messaging command transition state is unavailable".to_string())?;
    if row.0 != command_bytes || row.2 != command_bytes {
        return Err("mobile messaging command transition bytes mismatch".to_string());
    }
    Ok(CommandTransitionState {
        local_state: row.1,
        outbox_state: row.3,
        attempt_count: u32::try_from(row.4)
            .map_err(|_| "mobile messaging command attempt count is invalid".to_string())?,
    })
}

fn pending_owner_transition_is_valid(
    transaction: &Transaction<'_>,
    command_id: &str,
    pending_message_changes: usize,
    interaction_changes: usize,
) -> Result<bool, String> {
    let transition_count = transaction
        .query_row(
            "SELECT COUNT(*) FROM messaging_mls_pending_transitions
             WHERE command_id = ?1",
            params![command_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(matches!(
        (
            pending_message_changes,
            transition_count,
            interaction_changes
        ),
        (1, 0, 0) | (0, 1, 0) | (0, 0, 1)
    ))
}

fn persist_direct_session_advances(
    transaction: &Transaction<'_>,
    advances: &[DirectSessionAdvance],
    conversation_id: &str,
    sender_ptid: &str,
    sender_device_id: &str,
) -> Result<(), String> {
    let mut session_ids = std::collections::HashSet::with_capacity(advances.len());
    let mut peer_keys = std::collections::HashSet::with_capacity(advances.len());
    for advance in advances {
        let advanced = &advance.advanced;
        advanced.key.validate()?;
        if !advanced.established
            || advanced.key.conversation_id != conversation_id
            || advanced.key.local.ptid != sender_ptid
            || advanced.key.local.device_id != sender_device_id
            || !session_ids.insert(advanced.session_id.as_str())
            || !peer_keys.insert((
                advanced.key.peer.ptid.as_str(),
                advanced.key.peer.device_id.as_str(),
            ))
        {
            return Err("mobile messaging Direct session advance binding mismatch".to_string());
        }

        match advance.previous.as_ref() {
            Some(previous) => {
                if previous.session_id != advanced.session_id
                    || previous.key != advanced.key
                    || !previous.established
                {
                    return Err(
                        "mobile messaging Direct previous session binding mismatch".to_string()
                    );
                }
                let current =
                    load_direct_session(transaction, &advanced.session_id)?.ok_or_else(|| {
                        "mobile messaging Direct previous session disappeared".to_string()
                    })?;
                if !direct_session_state_matches(&current, previous) {
                    return Err(
                        "mobile messaging Direct session changed during send preparation"
                            .to_string(),
                    );
                }
            }
            None => {
                if advance.session_init.is_none() {
                    return Err(
                        "mobile messaging Direct new session requires bootstrap bytes".to_string(),
                    );
                }
                let conflict = transaction
                    .query_row(
                        "SELECT EXISTS(
                            SELECT 1 FROM direct_sessions
                            WHERE session_id = ?1 OR (
                                conversation_id = ?2
                                AND self_ptid = ?3
                                AND self_device_id = ?4
                                AND peer_ptid = ?5
                                AND peer_device_id = ?6
                                AND generation = ?7
                            )
                         )",
                        params![
                            advanced.session_id,
                            advanced.key.conversation_id,
                            advanced.key.local.ptid,
                            advanced.key.local.device_id,
                            advanced.key.peer.ptid,
                            advanced.key.peer.device_id,
                            i64::try_from(advanced.key.generation)
                                .map_err(|_| "session generation exceeds i64")?
                        ],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(|error| error.to_string())?;
                if conflict {
                    return Err(
                        "mobile messaging Direct new session conflicts with durable state"
                            .to_string(),
                    );
                }
            }
        }

        upsert_direct_session(transaction, advanced)?;
        if let Some(init_bytes) = advance.session_init.as_ref() {
            if init_bytes.is_empty() {
                return Err("mobile messaging Direct session init is empty".to_string());
            }
            let changed = transaction
                .execute(
                    "INSERT INTO direct_session_bootstraps(session_id, init_bytes)
                     VALUES (?1, ?2)
                     ON CONFLICT(session_id) DO UPDATE SET init_bytes=excluded.init_bytes
                     WHERE direct_session_bootstraps.init_bytes = excluded.init_bytes",
                    params![advanced.session_id, init_bytes],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err(
                    "mobile messaging Direct session init conflicts with stored bytes".to_string(),
                );
            }
        }
    }
    Ok(())
}

fn direct_session_state_matches(actual: &DirectSession, expected: &DirectSession) -> bool {
    actual.session_id == expected.session_id
        && actual.key == expected.key
        && actual.protocol_version == expected.protocol_version
        && actual.established == expected.established
        && actual.peer_identity_key == expected.peer_identity_key
        && actual.ratchet.session_id == expected.ratchet.session_id
        && actual.ratchet.root_key == expected.ratchet.root_key
        && actual.ratchet.self_priv == expected.ratchet.self_priv
        && actual.ratchet.self_pub == expected.ratchet.self_pub
        && actual.ratchet.peer_pub == expected.ratchet.peer_pub
        && actual.ratchet.send_chain_key == expected.ratchet.send_chain_key
        && actual.ratchet.recv_chain_key == expected.ratchet.recv_chain_key
        && actual.ratchet.n_send == expected.ratchet.n_send
        && actual.ratchet.n_recv == expected.ratchet.n_recv
        && actual.ratchet.n_prev == expected.ratchet.n_prev
        && actual.updated_at_unix_ms == expected.updated_at_unix_ms
}

fn attachment_transfer_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AttachmentTransferRecord> {
    Ok(AttachmentTransferRecord {
        attachment_id: row.get(0)?,
        conversation_id: row.get(1)?,
        message_id: row.get(2)?,
        authority_station_id: row.get(3)?,
        direction: row.get(4)?,
        state: row.get(5)?,
        upload_id: row.get(6)?,
        generation: row.get(7)?,
        descriptor_sha256: row.get(8)?,
        completed_chunk_bitmap: row.get(9)?,
        source_local_ref: row.get(10)?,
        partial_local_ref: row.get(11)?,
        object_key: row.get(12)?,
        base_nonce: row.get(13)?,
        plaintext_size: row.get(14)?,
        chunk_size: row.get(15)?,
        attempt_count: row.get(16)?,
        next_attempt_at_unix_ms: row.get(17)?,
        last_error_code: row.get(18)?,
        updated_at_unix_ms: row.get(19)?,
    })
}

fn persist_received_message_attachments(
    transaction: &Connection,
    message_id: &str,
    attachments: &[AttachmentPlaintextMetadata],
) -> Result<(), String> {
    persist_message_attachments(transaction, message_id, attachments, "remote")
}

fn persist_sender_message_attachments(
    transaction: &Connection,
    message_id: &str,
    attachments: &[AttachmentPlaintextMetadata],
) -> Result<(), String> {
    persist_message_attachments(transaction, message_id, attachments, "local")
}

fn persist_message_attachments(
    transaction: &Connection,
    message_id: &str,
    attachments: &[AttachmentPlaintextMetadata],
    initial_availability_state: &str,
) -> Result<(), String> {
    if !matches!(initial_availability_state, "remote" | "local") {
        return Err("mobile messaging attachment availability state is invalid".to_string());
    }
    for attachment in attachments {
        messaging_core::codec::private_content::validate_attachment_plaintext_metadata(attachment)?;
        let object = attachment
            .object
            .as_ref()
            .ok_or_else(|| "mobile messaging attachment descriptor is missing".to_string())?;
        let changed = transaction
            .execute(
                "INSERT INTO messaging_attachment_projections(
                    message_id, attachment_id, object_id, storage_ref,
                    filename, mime_type, plaintext_size, plaintext_sha256,
                    object_key, base_nonce, descriptor_bytes,
                    availability_state, local_cache_path
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    ?12, NULL
                 )
                 ON CONFLICT(message_id, attachment_id) DO UPDATE SET
                    availability_state=messaging_attachment_projections.availability_state
                 WHERE messaging_attachment_projections.object_id = excluded.object_id
                   AND messaging_attachment_projections.storage_ref = excluded.storage_ref
                   AND messaging_attachment_projections.filename = excluded.filename
                   AND messaging_attachment_projections.mime_type = excluded.mime_type
                   AND messaging_attachment_projections.plaintext_size = excluded.plaintext_size
                   AND messaging_attachment_projections.plaintext_sha256 = excluded.plaintext_sha256
                   AND messaging_attachment_projections.object_key = excluded.object_key
                   AND messaging_attachment_projections.base_nonce = excluded.base_nonce
                   AND messaging_attachment_projections.descriptor_bytes = excluded.descriptor_bytes",
                params![
                    message_id,
                    attachment.attachment_id,
                    object.object_id,
                    object.storage_ref,
                    attachment.filename,
                    attachment.mime_type,
                    i64::try_from(attachment.plaintext_size)
                        .map_err(|_| "mobile messaging attachment size exceeds i64")?,
                    attachment.plaintext_sha256,
                    attachment.object_key,
                    attachment.base_nonce,
                    object.encode_to_vec(),
                    initial_availability_state,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("mobile messaging attachment projection conflicts".to_string());
        }
    }
    Ok(())
}

fn index_message_search(
    connection: &Connection,
    conversation_id: &str,
    message_id: &str,
    plaintext: &str,
    attachments: &[messaging_core::proto::chat::AttachmentPlaintextMetadata],
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM messaging_message_search_fts
             WHERE conversation_id = ?1 AND message_id = ?2",
            params![conversation_id, message_id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO messaging_message_search_fts(
                conversation_id, message_id, plaintext, attachment_filenames
             ) VALUES (?1, ?2, ?3, ?4)",
            params![
                conversation_id,
                message_id,
                plaintext,
                attachments
                    .iter()
                    .map(|attachment| attachment.filename.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn load_pending_attachments(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<AttachmentPlaintextMetadata>, String> {
    let mut statement = connection
        .prepare(
            "SELECT attachment_id, filename, mime_type, plaintext_size,
                    plaintext_sha256, object_key, base_nonce, descriptor_bytes
             FROM messaging_attachment_projections
             WHERE message_id = ?1 ORDER BY attachment_id",
        )
        .map_err(|error| error.to_string())?;
    let attachments = statement
        .query_map(params![message_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Vec<u8>>(4)?,
                row.get::<_, Vec<u8>>(5)?,
                row.get::<_, Vec<u8>>(6)?,
                row.get::<_, Vec<u8>>(7)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .map(|row| {
            let row = row.map_err(|error| error.to_string())?;
            Ok(AttachmentPlaintextMetadata {
                attachment_id: row.0,
                filename: row.1,
                mime_type: row.2,
                plaintext_size: u64::try_from(row.3)
                    .map_err(|_| "mobile messaging attachment size is invalid")?,
                plaintext_sha256: row.4,
                object_key: row.5,
                base_nonce: row.6,
                object: Some(
                    messaging_core::proto::chat::EncryptedObjectDescriptor::decode(
                        row.7.as_slice(),
                    )
                    .map_err(|_| "mobile messaging attachment descriptor is invalid".to_string())?,
                ),
            })
        })
        .collect();
    attachments
}

fn load_staged_attachment_metadata(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<AttachmentPlaintextMetadata>, String> {
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM messaging_attachment_drafts WHERE message_id = ?1",
            params![message_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if total == 0 {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare(
            "SELECT draft.attachment_id, draft.filename, draft.mime_type,
                    transfer.plaintext_size, draft.plaintext_sha256,
                    transfer.object_key, transfer.base_nonce, draft.descriptor_bytes
             FROM messaging_attachment_drafts draft
             JOIN messaging_attachment_transfers transfer
               ON transfer.attachment_id = draft.attachment_id
             WHERE draft.message_id = ?1
               AND draft.descriptor_bytes IS NOT NULL
               AND transfer.state = ?2
             ORDER BY draft.attachment_id",
        )
        .map_err(|error| error.to_string())?;
    let attachments = statement
        .query_map(
            params![message_id, AttachmentTransferState::Complete as i32],
            |row| {
                let descriptor_bytes = row.get::<_, Vec<u8>>(7)?;
                let object = EncryptedObjectDescriptor::decode(descriptor_bytes.as_slice())
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            descriptor_bytes.len(),
                            rusqlite::types::Type::Blob,
                            Box::new(error),
                        )
                    })?;
                Ok(AttachmentPlaintextMetadata {
                    attachment_id: row.get(0)?,
                    filename: row.get(1)?,
                    mime_type: row.get(2)?,
                    plaintext_size: row.get::<_, i64>(3)?.try_into().map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            8,
                            rusqlite::types::Type::Integer,
                            Box::new(error),
                        )
                    })?,
                    plaintext_sha256: row.get(4)?,
                    object_key: row.get(5)?,
                    base_nonce: row.get(6)?,
                    object: Some(object),
                })
            },
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if attachments.len() != total as usize {
        return Err("mobile messaging attachment uploads are not complete".to_string());
    }
    for attachment in &attachments {
        messaging_core::codec::private_content::validate_attachment_plaintext_metadata(attachment)?;
    }
    Ok(attachments)
}

fn load_pending_message_attachments(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<AttachmentPlaintextMetadata>, String> {
    let canonical = load_pending_attachments(connection, message_id)?;
    if !canonical.is_empty() {
        return Ok(canonical);
    }
    load_staged_attachment_metadata(connection, message_id)
}

fn fts_phrase_query(query: &str) -> Result<String, String> {
    let normalized = query.trim();
    if normalized.is_empty() || normalized.chars().count() > 256 {
        return Err("mobile messaging search query exceeds policy".to_string());
    }
    Ok(format!("\"{}\"", normalized.replace('"', "\"\"")))
}

fn conversation_message_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ConversationMessageProjection> {
    let retracted = row.get::<_, i64>(12)? != 0;
    Ok(ConversationMessageProjection {
        event_id: row.get(0)?,
        event_sequence: row.get(1)?,
        message_id: row.get(2)?,
        sender_ptid: row.get(3)?,
        sender_device_id: row.get(4)?,
        plaintext: if retracted {
            String::new()
        } else {
            row.get(5)?
        },
        attachments: Vec::new(),
        state: row.get(6)?,
        timestamp_unix_ms: row.get(7)?,
        reply_to_message_id: row.get(8)?,
        thread_root_message_id: row.get(9)?,
        edited_text: if retracted { None } else { row.get(10)? },
        edited_at_unix_ms: if retracted { None } else { row.get(11)? },
        retracted,
        reactions: Vec::new(),
        pinned_by_ptid: None,
        pinned_at_unix_ms: None,
        read_by_ptids: Vec::new(),
    })
}

fn enrich_message_projections(
    connection: &Connection,
    conversation_id: &str,
    messages: &mut [ConversationMessageProjection],
) -> Result<(), String> {
    let pins = load_pins_for_conversation(connection, conversation_id)?;
    for message in messages {
        if !message.retracted {
            message.attachments =
                load_pending_message_attachments(connection, &message.message_id)?;
        }
        message.reactions = load_reactions_for_message(connection, &message.message_id)?;
        message.read_by_ptids = load_readers_for_message(
            connection,
            conversation_id,
            message.event_sequence,
            &message.sender_ptid,
        )?;
        if let Some((_, actor_ptid, pinned_at_unix_ms)) = pins
            .iter()
            .find(|(message_id, _, _)| message_id == &message.message_id)
        {
            message.pinned_by_ptid = Some(actor_ptid.clone());
            message.pinned_at_unix_ms = Some(*pinned_at_unix_ms);
        }
    }
    Ok(())
}

fn load_reactions_for_message(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<(String, String, i64)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT actor_ptid, reaction, created_at_unix_ms
             FROM message_reactions
             WHERE message_id = ?1
             ORDER BY created_at_unix_ms ASC, actor_ptid ASC, reaction ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![message_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

fn load_pins_for_conversation(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<(String, String, i64)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT message_id, actor_ptid, pinned_at_unix_ms
             FROM message_pins
             WHERE conversation_id = ?1
             ORDER BY pinned_at_unix_ms ASC, message_id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

fn load_readers_for_message(
    connection: &Connection,
    conversation_id: &str,
    event_sequence: Option<i64>,
    sender_ptid: &str,
) -> Result<Vec<String>, String> {
    let Some(event_sequence) = event_sequence else {
        return Ok(Vec::new());
    };
    let mut statement = connection
        .prepare(
            "SELECT actor_ptid
             FROM read_cursors
             WHERE conversation_id = ?1
               AND last_read_sequence >= ?2
               AND actor_ptid <> ?3
             ORDER BY actor_ptid",
        )
        .map_err(|error| error.to_string())?;
    let readers = statement
        .query_map(
            params![conversation_id, event_sequence, sender_ptid],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(readers)
}

fn upsert_direct_session(connection: &Connection, session: &DirectSession) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO direct_sessions(
                session_id, conversation_id, self_ptid, self_device_id,
                peer_ptid, peer_device_id, generation, protocol_version,
                established, peer_identity_key, root_key, self_private_key,
                self_public_key, peer_ratchet_public_key, send_chain_key,
                receive_chain_key, send_counter, receive_counter,
                previous_counter, updated_at_unix_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
             )
             ON CONFLICT(session_id) DO UPDATE SET
                root_key=excluded.root_key,
                self_private_key=excluded.self_private_key,
                self_public_key=excluded.self_public_key,
                peer_ratchet_public_key=excluded.peer_ratchet_public_key,
                send_chain_key=excluded.send_chain_key,
                receive_chain_key=excluded.receive_chain_key,
                send_counter=excluded.send_counter,
                receive_counter=excluded.receive_counter,
                previous_counter=excluded.previous_counter,
                established=excluded.established,
                updated_at_unix_ms=excluded.updated_at_unix_ms",
            params![
                session.session_id,
                session.key.conversation_id,
                session.key.local.ptid,
                session.key.local.device_id,
                session.key.peer.ptid,
                session.key.peer.device_id,
                i64::try_from(session.key.generation)
                    .map_err(|_| "session generation exceeds i64")?,
                i64::from(session.protocol_version),
                session.established,
                session.peer_identity_key.as_slice(),
                session.ratchet.root_key.as_slice(),
                session.ratchet.self_priv.as_slice(),
                session.ratchet.self_pub.as_slice(),
                session
                    .ratchet
                    .peer_pub
                    .as_ref()
                    .map(|value| value.as_slice()),
                session
                    .ratchet
                    .send_chain_key
                    .as_ref()
                    .map(|value| value.as_slice()),
                session
                    .ratchet
                    .recv_chain_key
                    .as_ref()
                    .map(|value| value.as_slice()),
                i64::from(session.ratchet.n_send),
                i64::from(session.ratchet.n_recv),
                i64::from(session.ratchet.n_prev),
                session.updated_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_direct_session(
    connection: &Connection,
    session_id: &str,
) -> Result<Option<DirectSession>, String> {
    let row = connection
        .query_row(
            "SELECT conversation_id, self_ptid, self_device_id, peer_ptid,
                    peer_device_id, generation, protocol_version, established,
                    peer_identity_key, root_key, self_private_key, self_public_key,
                    peer_ratchet_public_key, send_chain_key, receive_chain_key,
                    send_counter, receive_counter, previous_counter, updated_at_unix_ms
             FROM direct_sessions WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, bool>(7)?,
                    row.get::<_, Vec<u8>>(8)?,
                    row.get::<_, Vec<u8>>(9)?,
                    row.get::<_, Vec<u8>>(10)?,
                    row.get::<_, Vec<u8>>(11)?,
                    row.get::<_, Option<Vec<u8>>>(12)?,
                    row.get::<_, Option<Vec<u8>>>(13)?,
                    row.get::<_, Option<Vec<u8>>>(14)?,
                    row.get::<_, i64>(15)?,
                    row.get::<_, i64>(16)?,
                    row.get::<_, i64>(17)?,
                    row.get::<_, i64>(18)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(row) = row else {
        return Ok(None);
    };
    let optional_key = |label: &str, value: Option<Vec<u8>>| {
        value.map(|bytes| fixed_key(label, bytes)).transpose()
    };
    Ok(Some(DirectSession {
        session_id: session_id.to_string(),
        key: DirectSessionKey::new(
            row.0,
            CryptoEndpoint {
                ptid: row.1,
                device_id: row.2,
            },
            CryptoEndpoint {
                ptid: row.3,
                device_id: row.4,
            },
            u64::try_from(row.5).map_err(|_| "invalid session generation")?,
        )?,
        protocol_version: u32::try_from(row.6).map_err(|_| "invalid protocol version")?,
        established: row.7,
        peer_identity_key: fixed_key("peer identity key", row.8)?,
        ratchet: DrSessionState {
            session_id: session_id.to_string(),
            root_key: fixed_key("root key", row.9)?,
            self_priv: fixed_key("self private key", row.10)?,
            self_pub: fixed_key("self public key", row.11)?,
            peer_pub: optional_key("peer ratchet public key", row.12)?,
            send_chain_key: optional_key("send chain key", row.13)?,
            recv_chain_key: optional_key("receive chain key", row.14)?,
            n_send: u32::try_from(row.15).map_err(|_| "invalid send counter")?,
            n_recv: u32::try_from(row.16).map_err(|_| "invalid receive counter")?,
            n_prev: u32::try_from(row.17).map_err(|_| "invalid previous counter")?,
        },
        updated_at_unix_ms: row.18,
    }))
}

fn fixed_key(label: &str, value: Vec<u8>) -> Result<[u8; 32], String> {
    value
        .try_into()
        .map_err(|_| format!("mobile messaging {label} has invalid length"))
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn validate_authority_event(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    event_sequence: i64,
    event_hash: &[u8],
    previous_event_hash: &[u8],
    allow_join_checkpoint: bool,
) -> Result<(), String> {
    if event_sequence <= 0 || event_hash.len() != 32 {
        return Err("mobile messaging authority event is incomplete".to_string());
    }
    let head = transaction
        .query_row(
            "SELECT event_sequence, event_hash FROM messaging_authority_heads
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match head {
        None if (event_sequence == 1 && previous_event_hash.is_empty())
            || allow_join_checkpoint =>
        {
            Ok(())
        }
        Some((sequence, hash))
            if event_sequence == sequence + 1 && previous_event_hash == hash.as_slice() =>
        {
            Ok(())
        }
        _ => Err("mobile messaging authority event chain is not contiguous".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use messaging_core::codec::private_content::encode_message_private_content;
    use messaging_core::contracts::{
        DirectMessageContent, MlsConversationMemberProjection, MlsMessageProjection,
    };
    use messaging_core::identity::generate_fresh_device_identity;
    use messaging_core::proto::chat::{
        AttachmentEncryptionSuite, AttachmentNonceStrategy, ConversationKind,
        DeviceConsumptionReceipt, MemberRole,
    };

    fn store() -> MobileMessagingStore {
        MobileMessagingStore::in_memory().unwrap()
    }

    fn activate_device(store: &MobileMessagingStore) -> FreshDeviceEnrollment {
        let identity = generate_fresh_device_identity("ptid:alice", [42; 32], 1).unwrap();
        DeviceEnrollmentRepository::install_fresh_device_identity(store, &identity).unwrap();
        let device_id = identity
            .enrollment
            .certificate
            .device
            .as_ref()
            .unwrap()
            .device_id
            .as_str();
        DeviceEnrollmentRepository::complete_device_enrollment(store, device_id).unwrap();
        identity.enrollment
    }

    fn direct_session(receive_counter: u32) -> DirectSession {
        DirectSession {
            session_id: "session-1".into(),
            key: DirectSessionKey::new(
                "conversation-1",
                CryptoEndpoint {
                    ptid: "ptid:alice".into(),
                    device_id: "alice-device".into(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".into(),
                    device_id: "bob-device".into(),
                },
                1,
            )
            .unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [2; 32],
            ratchet: DrSessionState {
                session_id: "session-1".into(),
                root_key: [3; 32],
                self_priv: [4; 32],
                self_pub: [5; 32],
                peer_pub: Some([6; 32]),
                send_chain_key: Some([7; 32]),
                recv_chain_key: Some([8; 32]),
                n_send: 1,
                n_recv: receive_counter,
                n_prev: 0,
            },
            updated_at_unix_ms: 20,
        }
    }

    fn attachment_descriptor() -> EncryptedObjectDescriptor {
        EncryptedObjectDescriptor {
            object_id: "object-1".to_string(),
            storage_ref: "oss://messaging/object-1".to_string(),
            ciphertext_size: 33,
            ciphertext_sha256: vec![5; 32],
            media_type: "text/plain".to_string(),
            chunk_size: messaging_core::attachment::ATTACHMENT_CHUNK_SIZE,
            chunk_count: 1,
            encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: messaging_core::attachment::ATTACHMENT_TAG_SIZE,
            nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![vec![6; 32]],
        }
    }

    fn attachment_metadata() -> AttachmentPlaintextMetadata {
        AttachmentPlaintextMetadata {
            attachment_id: "attachment-1".to_string(),
            filename: "proof.txt".to_string(),
            mime_type: "text/plain".to_string(),
            plaintext_size: 17,
            plaintext_sha256: vec![7; 32],
            object_key: vec![8; 32],
            base_nonce: vec![0; 12],
            object: Some(attachment_descriptor()),
        }
    }

    fn attachment_upload_transfer() -> AttachmentTransferRecord {
        AttachmentTransferRecord {
            attachment_id: "attachment-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-attachment".to_string(),
            authority_station_id: "station-authority".to_string(),
            direction: 1,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: "/tmp/mobile-attachment-source".to_string(),
            partial_local_ref: "/tmp/mobile-attachment-upload.part".to_string(),
            object_key: vec![8; 32],
            base_nonce: vec![0; 12],
            plaintext_size: 17,
            chunk_size: messaging_core::attachment::ATTACHMENT_CHUNK_SIZE,
            attempt_count: 0,
            next_attempt_at_unix_ms: 10,
            last_error_code: 0,
            updated_at_unix_ms: 10,
        }
    }

    fn seed_pending_public_message(store: &MobileMessagingStore) {
        let connection = store.connection.lock().unwrap();
        connection
            .execute(
                "INSERT INTO messaging_local_commands(
                    command_id, conversation_id, command_bytes, state, created_at_unix_ms
                 ) VALUES ('command-public', 'conversation-1', X'01', 'prepared', 10)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_command_outbox(
                    command_id, conversation_id, command_bytes, state, attempt_count,
                    next_attempt_at_unix_ms, last_error_code, created_at_unix_ms
                 ) VALUES (
                    'command-public', 'conversation-1', X'01', 'submitted', 0, 10, '', 10
                 )",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_pending_messages(
                    conversation_id, conversation_kind, message_id, sender_ptid,
                    sender_device_id, plaintext, reply_to_message_id,
                    thread_root_message_id, state, attempt_count,
                    next_attempt_at_unix_ms, last_error_code, created_at_unix_ms
                 ) VALUES (
                    'conversation-1', 1, 'message-public', 'ptid:alice',
                    'alice-device', 'hello', '', '', 'submitted', 0, 10, '', 10
                 )",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_command_attempts(
                    command_id, conversation_id, message_id,
                    delivery_plan_sha256, state, created_at_unix_ms
                 ) VALUES (
                    'command-public', 'conversation-1', 'message-public',
                    zeroblob(32), 'submitted', 10
                 )",
                [],
            )
            .unwrap();
    }

    fn commit_public_message(store: &MobileMessagingStore) -> [u8; 32] {
        let hash = [13u8; 32];
        MessagingRepository::persist_claimed_item(
            store,
            "item-public",
            "event-public",
            "conversation-1",
            1,
            1,
            &hash,
            b"public-marker",
            10,
        )
        .unwrap();
        let commit = PublicEventReceiveCommit {
            item_id: "item-public",
            event_id: "event-public",
            conversation_id: "conversation-1",
            command_id: "command-public",
            message_id: "message-public",
            event_sequence: 1,
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &hash,
            event_hash: &hash,
            previous_event_hash: &[],
            sender_ptid: "ptid:alice",
            sender_device_id: "alice-device",
            attachments: &[],
            reply_to_message_id: None,
            thread_root_message_id: None,
            committed_at_unix_ms: 20,
            receipt_id: "receipt-public",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 20,
        };
        assert_eq!(
            store.commit_public_event(&commit).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            store.commit_public_event(&commit).unwrap(),
            ReceiveCommitResult::AlreadyCommitted
        );
        hash
    }

    #[test]
    fn conversation_commit_is_atomic_and_replay_safe() {
        let store = store();
        let hash = [7u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-1",
            "event-1",
            "conversation-1",
            1,
            1,
            &hash,
            b"payload",
            10,
        )
        .unwrap();
        let projection = ConversationProjection {
            conversation_id: "conversation-1".into(),
            authority_station_id: "station-1".into(),
            federation_id: "federation-1".into(),
            kind: 2,
            name: "Group".into(),
            owner_ptid: "ptid:alice".into(),
            member_ptids: vec!["ptid:alice".into(), "ptid:bob".into()],
            membership_epoch: 1,
            mls_epoch: 1,
            active: true,
            updated_at_unix_ms: 10,
        };
        let commit = ConversationStateReceiveCommit {
            item_id: "item-1",
            event_id: "event-1",
            conversation_id: "conversation-1",
            event_sequence: 1,
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &hash,
            event_hash: &hash,
            previous_event_hash: &[],
            projection: &projection,
            receipt_id: "receipt-1",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 11,
        };
        assert_eq!(
            store.commit_conversation_state(&commit).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            store.commit_conversation_state(&commit).unwrap(),
            ReceiveCommitResult::AlreadyCommitted
        );
        assert!(MessagingRepository::consumption_marker_matches(&store, "item-1", &hash).unwrap());
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 1));
        assert_eq!(
            store.conversation_projections().unwrap()[0].federation_id,
            "federation-1"
        );
        assert_eq!(
            store.conversation_projections().unwrap()[0].member_ptids,
            vec!["ptid:alice", "ptid:bob"]
        );
    }

    #[test]
    fn failed_binding_rolls_back_projection_and_cursor() {
        let store = store();
        let hash = [9u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-1",
            "event-1",
            "conversation-1",
            1,
            1,
            &hash,
            b"payload",
            10,
        )
        .unwrap();
        let projection = ConversationProjection {
            conversation_id: "conversation-1".into(),
            authority_station_id: "station-1".into(),
            federation_id: "federation-1".into(),
            kind: 1,
            name: String::new(),
            owner_ptid: "ptid:alice".into(),
            member_ptids: vec![],
            membership_epoch: 1,
            mls_epoch: 0,
            active: true,
            updated_at_unix_ms: 10,
        };
        let commit = ConversationStateReceiveCommit {
            item_id: "item-1",
            event_id: "wrong-event",
            conversation_id: "conversation-1",
            event_sequence: 1,
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &hash,
            event_hash: &hash,
            previous_event_hash: &[],
            projection: &projection,
            receipt_id: "receipt-1",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 11,
        };
        assert!(store.commit_conversation_state(&commit).is_err());
        assert!(store.conversation_projections().unwrap().is_empty());
        assert_eq!(store.lane_checkpoint().unwrap(), (0, 0));
    }

    #[test]
    fn command_transition_is_exact_byte_and_attempt_bound() {
        let store = store();
        store.insert_command("command-1", b"command", 10);
        let next = store.next_command(10).unwrap().unwrap();
        assert_eq!(next.command_id, "command-1");
        assert!(store
            .mark_command_retry("command-1", b"wrong", 0, 20, "timeout")
            .is_err());
        store
            .mark_command_retry("command-1", b"command", 0, 20, "timeout")
            .unwrap();
        assert!(store.next_command(19).unwrap().is_none());
        assert_eq!(store.next_command(20).unwrap().unwrap().attempt_count, 1);
        assert_eq!(store.next_scheduled_work_at().unwrap(), Some(20));
        {
            let connection = store.connection.lock().unwrap();
            let states = connection
                .query_row(
                    "SELECT local.state, outbox.state, attempt.state, pending.state,
                            outbox.attempt_count, pending.attempt_count
                     FROM messaging_local_commands local
                     JOIN messaging_command_outbox outbox USING(command_id)
                     JOIN messaging_command_attempts attempt USING(command_id)
                     JOIN messaging_pending_messages pending
                       ON pending.conversation_id = attempt.conversation_id
                      AND pending.message_id = attempt.message_id
                     WHERE local.command_id = 'command-1'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )
                .unwrap();
            assert_eq!(
                states,
                (
                    "prepared".to_string(),
                    "retry_wait".to_string(),
                    "retry_wait".to_string(),
                    "retry_wait".to_string(),
                    1,
                    1,
                )
            );
        }
        store
            .mark_command_submitted("command-1", b"command", 1)
            .unwrap();
        let connection = store.connection.lock().unwrap();
        let states = connection
            .query_row(
                "SELECT local.state, outbox.state, attempt.state, pending.state
                 FROM messaging_local_commands local
                 JOIN messaging_command_outbox outbox USING(command_id)
                 JOIN messaging_command_attempts attempt USING(command_id)
                 JOIN messaging_pending_messages pending
                   ON pending.conversation_id = attempt.conversation_id
                  AND pending.message_id = attempt.message_id
                 WHERE local.command_id = 'command-1'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            states,
            (
                "submitted".to_string(),
                "submitted".to_string(),
                "submitted".to_string(),
                "submitted".to_string(),
            )
        );
        drop(connection);
        assert_eq!(store.next_scheduled_work_at().unwrap(), None);
    }

    #[test]
    fn superseded_send_reuses_logical_message_with_fresh_attempt() {
        let store = store();
        store.insert_command("command-old", b"command-old", 10);
        store
            .mark_command_superseded("command-old", b"command-old", 0)
            .unwrap();
        let private_content =
            messaging_core::codec::private_content::encode_message_private_content("hello", &[])
                .unwrap();
        store
            .with_transaction(|transaction| {
                persist_pending_sender(
                    transaction,
                    b"command-new",
                    &PendingSenderProjection {
                        command_id: "command-new",
                        conversation_id: "conversation-1",
                        conversation_kind: 1,
                        message_id: "message-1",
                        sender_ptid: "ptid:alice",
                        sender_device_id: "alice-device",
                        plaintext: "hello",
                        reply_to_message_id: "",
                        thread_root_message_id: "",
                        attachments: &[],
                        private_content: &private_content,
                        delivery_plan_sha256: &[8; 32],
                        created_at_unix_ms: 20,
                    },
                )
            })
            .unwrap();

        let connection = store.connection.lock().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT state FROM messaging_pending_messages
                     WHERE conversation_id = 'conversation-1' AND message_id = 'message-1'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "pending"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM messaging_command_attempts
                     WHERE conversation_id = 'conversation-1' AND message_id = 'message-1'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT state FROM messaging_command_attempts
                     WHERE command_id = 'command-old'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "superseded"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT state FROM messaging_command_attempts
                     WHERE command_id = 'command-new'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "prepared"
        );
    }

    #[test]
    fn superseded_interaction_is_recovered_once_by_a_durable_replacement() {
        let store = store();
        store
            .with_transaction(|transaction| {
                persist_local_command(
                    transaction,
                    "interaction-old",
                    "conversation-1",
                    b"interaction-old",
                    10,
                )?;
                transaction
                    .execute(
                        "INSERT INTO messaging_command_attempts(
                            command_id, conversation_id, message_id,
                            delivery_plan_sha256, state, created_at_unix_ms
                         ) VALUES (
                            'interaction-old', 'conversation-1', 'message-1',
                            ?1, 'prepared', 10
                         )",
                        params![vec![7u8; 32]],
                    )
                    .map_err(|error| error.to_string())?;
                transaction
                    .execute(
                        "INSERT INTO messaging_interaction_intents(
                            command_id, conversation_id, target_message_id,
                            interaction_kind, edited_text, state, created_at_unix_ms
                         ) VALUES (
                            'interaction-old', 'conversation-1', 'message-1',
                            'retract', NULL, 'prepared', 10
                         )",
                        [],
                    )
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();
        store
            .mark_command_superseded("interaction-old", b"interaction-old", 0)
            .unwrap();
        assert_eq!(
            store
                .next_superseded_interaction()
                .unwrap()
                .unwrap()
                .command_id,
            "interaction-old"
        );
        assert_eq!(store.next_scheduled_work_at().unwrap(), Some(0));

        store
            .with_transaction(|transaction| {
                persist_local_command(
                    transaction,
                    "interaction-new",
                    "conversation-1",
                    b"interaction-new",
                    20,
                )
            })
            .unwrap();
        store
            .mark_interaction_reprepared("interaction-old", "interaction-new")
            .unwrap();
        assert!(store.next_superseded_interaction().unwrap().is_none());
    }

    #[test]
    fn terminal_membership_failure_cleans_durable_pending_transition() {
        let store = store();
        store.insert_command("membership-command", b"membership", 10);
        let connection = store.connection.lock().unwrap();
        connection
            .execute(
                "DELETE FROM messaging_pending_messages
                 WHERE conversation_id = 'conversation-1' AND message_id = 'message-1'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_membership_intents(
                    intent_id, conversation_id, action, target_ptid,
                    target_device_id, role, state, command_id, created_at_unix_ms
                 ) VALUES (
                    'intent-1', 'conversation-1', 1, 'ptid:bob',
                    'bob-device', 'member', 'prepared', 'membership-command', 10
                 )",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_mls_pending_transitions(
                    conversation_id, transition_id, command_id, transition_state
                 ) VALUES ('conversation-1', 'transition-1', 'membership-command', ?1)",
                params![b"state".as_slice()],
            )
            .unwrap();
        drop(connection);

        store
            .mark_command_failed("membership-command", b"membership", 0, "authority_rejected")
            .unwrap();

        let connection = store.connection.lock().unwrap();
        for table in [
            "messaging_local_commands",
            "messaging_command_outbox",
            "messaging_command_attempts",
            "messaging_membership_intents",
        ] {
            let state = connection
                .query_row(
                    &format!(
                        "SELECT state FROM {table}
                         WHERE command_id = 'membership-command'"
                    ),
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap();
            assert_eq!(state, "failed", "table {table}");
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM messaging_mls_pending_transitions
                     WHERE command_id = 'membership-command'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn claimed_item_replay_rejects_different_payload() {
        let store = store();
        MessagingRepository::persist_claimed_item(
            &store,
            "item-1",
            "event-1",
            "conversation-1",
            1,
            1,
            &[1; 32],
            b"payload",
            10,
        )
        .unwrap();
        assert!(MessagingRepository::persist_claimed_item(
            &store,
            "item-1",
            "event-1",
            "conversation-1",
            1,
            1,
            &[2; 32],
            b"different",
            10,
        )
        .is_err());
    }

    #[test]
    fn non_contiguous_authority_event_rolls_back_receive_state() {
        let store = store();
        let hash = [4u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-2",
            "event-2",
            "conversation-1",
            1,
            1,
            &hash,
            b"payload",
            10,
        )
        .unwrap();
        let projection = ConversationProjection {
            conversation_id: "conversation-1".into(),
            authority_station_id: "station-1".into(),
            federation_id: "federation-1".into(),
            kind: 1,
            name: String::new(),
            owner_ptid: "ptid:alice".into(),
            member_ptids: vec!["ptid:alice".into()],
            membership_epoch: 1,
            mls_epoch: 0,
            active: true,
            updated_at_unix_ms: 10,
        };
        let commit = ConversationStateReceiveCommit {
            item_id: "item-2",
            event_id: "event-2",
            conversation_id: "conversation-1",
            event_sequence: 2,
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &hash,
            event_hash: &hash,
            previous_event_hash: &[3; 32],
            projection: &projection,
            receipt_id: "receipt-2",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 11,
        };
        assert!(store.commit_conversation_state(&commit).is_err());
        assert!(!MessagingRepository::consumption_marker_matches(&store, "item-2", &hash).unwrap());
        assert!(store.conversation_projections().unwrap().is_empty());
        assert_eq!(store.lane_checkpoint().unwrap(), (0, 0));
    }

    #[test]
    fn direct_receive_atomically_persists_ratchet_projection_and_skipped_key() {
        let store = store();
        let hash = [9u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-direct",
            "event-direct",
            "conversation-1",
            1,
            1,
            &hash,
            b"ciphertext",
            10,
        )
        .unwrap();
        let session = direct_session(1);
        let skipped = DrSkippedMessageKey {
            session_id: session.session_id.clone(),
            peer_pub: [6; 32],
            counter: 0,
            message_key: [10; 32],
        };
        let projection = DirectMessageContent {
            conversation_id: "conversation-1".into(),
            event_id: "event-direct".into(),
            event_sequence: 1,
            message_id: "message-1".into(),
            sender_ptid: "ptid:bob".into(),
            sender_device_id: "bob-device".into(),
            plaintext: "hello".into(),
            attachments: vec![],
            committed_at_unix_ms: 20,
            reply_to_message_id: None,
            thread_root_message_id: None,
        };
        let commit = DirectReceiveCommit {
            item_id: "item-direct",
            event_id: "event-direct",
            conversation_id: "conversation-1",
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &hash,
            event_hash: &hash,
            previous_event_hash: &[],
            session: &session,
            new_skipped: &[skipped],
            consumed_skipped: None,
            consumed_one_time_prekey_id: None,
            projection: &projection,
            receipt_id: "consume-receipt",
            receipt_bytes: b"consume",
            delivery_receipt_id: "delivery-receipt",
            delivery_receipt_bytes: b"delivery",
            consumed_at_unix_ms: 20,
        };
        assert_eq!(
            store.commit_direct_receive(&commit).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            store
                .load_direct_session("session-1")
                .unwrap()
                .unwrap()
                .ratchet
                .n_recv,
            1
        );
        assert_eq!(
            store.load_direct_skipped_keys("session-1").unwrap().len(),
            1
        );
        assert_eq!(
            MessagingRepository::authority_head(&store, "conversation-1").unwrap(),
            (1, hash.to_vec())
        );
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 1));
    }

    #[test]
    fn public_event_commits_pending_sender_and_exact_command_atomically() {
        let store = store();
        seed_pending_public_message(&store);

        let hash = commit_public_message(&store);
        let connection = store.connection.lock().unwrap();
        let projection = connection
            .query_row(
                "SELECT plaintext, delivery_state FROM messaging_message_projections
                 WHERE conversation_id = 'conversation-1' AND message_id = 'message-public'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap();
        assert_eq!(projection, ("hello".to_string(), "accepted".to_string()));
        assert_eq!(
            connection
                .query_row(
                    "SELECT state FROM messaging_command_outbox
                     WHERE command_id = 'command-public'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "committed"
        );
        drop(connection);
        assert_eq!(
            MessagingRepository::authority_head(&store, "conversation-1").unwrap(),
            (1, hash.to_vec())
        );
    }

    #[test]
    fn interaction_commit_updates_projection_and_rolls_back_unknown_target() {
        let store = store();
        seed_pending_public_message(&store);
        let first_hash = commit_public_message(&store);
        let reaction_hash = [14u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-reaction",
            "event-reaction",
            "conversation-1",
            2,
            1,
            &reaction_hash,
            b"reaction",
            21,
        )
        .unwrap();
        let reaction = InteractionReceiveCommit {
            item_id: "item-reaction",
            event_id: "event-reaction",
            command_id: "remote-command",
            conversation_id: "conversation-1",
            event_sequence: 2,
            lane_sequence: 2,
            consumer_epoch: 1,
            payload_sha256: &reaction_hash,
            event_hash: &reaction_hash,
            previous_event_hash: &first_hash,
            message_id: "message-public",
            mutation: InteractionMutation::Reaction {
                actor_ptid: "ptid:bob",
                reaction: "thumbs-up",
                removed: false,
                created_at_unix_ms: 22,
            },
            mls_session_state: None,
            membership_epoch: 1,
            mls_epoch: 0,
            receipt_id: "receipt-reaction",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 22,
        };
        assert_eq!(
            MessagingRepository::commit_interaction_event(&store, &reaction).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            store
                .connection
                .lock()
                .unwrap()
                .query_row(
                    "SELECT reaction FROM message_reactions
                     WHERE message_id = 'message-public' AND actor_ptid = 'ptid:bob'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "thumbs-up"
        );

        let missing_hash = [15u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-missing",
            "event-missing",
            "conversation-1",
            3,
            1,
            &missing_hash,
            b"missing",
            23,
        )
        .unwrap();
        let missing = InteractionReceiveCommit {
            item_id: "item-missing",
            event_id: "event-missing",
            command_id: "remote-command-2",
            conversation_id: "conversation-1",
            event_sequence: 3,
            lane_sequence: 3,
            consumer_epoch: 1,
            payload_sha256: &missing_hash,
            event_hash: &missing_hash,
            previous_event_hash: &reaction_hash,
            message_id: "missing-message",
            mutation: InteractionMutation::Retract,
            mls_session_state: None,
            membership_epoch: 1,
            mls_epoch: 0,
            receipt_id: "receipt-missing",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 23,
        };
        assert!(MessagingRepository::commit_interaction_event(&store, &missing).is_err());
        assert_eq!(store.lane_checkpoint().unwrap(), (2, 1));
        assert!(!MessagingRepository::consumption_marker_matches(
            &store,
            "item-missing",
            &missing_hash
        )
        .unwrap());
        assert_eq!(
            MessagingRepository::authority_head(&store, "conversation-1").unwrap(),
            (2, reaction_hash.to_vec())
        );
        let projection = store
            .conversation_message_projections("conversation-1")
            .unwrap();
        assert_eq!(projection.len(), 1);
        assert_eq!(
            projection[0].reactions,
            vec![("ptid:bob".to_string(), "thumbs-up".to_string(), 22)]
        );
        assert_eq!(
            store
                .search_message_projections("conversation-1", "hello", None, 10)
                .unwrap()[0]
                .message_id,
            "message-public"
        );
    }

    #[test]
    fn retract_hides_plaintext_and_removes_search_projection() {
        let store = store();
        seed_pending_public_message(&store);
        let first_hash = commit_public_message(&store);
        let retract_hash = [17u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-retract",
            "event-retract",
            "conversation-1",
            2,
            1,
            &retract_hash,
            b"retract",
            21,
        )
        .unwrap();
        let retract = InteractionReceiveCommit {
            item_id: "item-retract",
            event_id: "event-retract",
            command_id: "remote-retract-command",
            conversation_id: "conversation-1",
            event_sequence: 2,
            lane_sequence: 2,
            consumer_epoch: 1,
            payload_sha256: &retract_hash,
            event_hash: &retract_hash,
            previous_event_hash: &first_hash,
            message_id: "message-public",
            mutation: InteractionMutation::Retract,
            mls_session_state: None,
            membership_epoch: 1,
            mls_epoch: 0,
            receipt_id: "receipt-retract",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 22,
        };

        assert_eq!(
            MessagingRepository::commit_interaction_event(&store, &retract).unwrap(),
            ReceiveCommitResult::Committed
        );
        let messages = store
            .conversation_message_projections("conversation-1")
            .unwrap();
        assert_eq!(messages.len(), 1);
        assert!(messages[0].retracted);
        assert!(messages[0].plaintext.is_empty());
        assert!(messages[0].edited_text.is_none());
        assert!(messages[0].attachments.is_empty());
        assert!(store
            .search_message_projections("conversation-1", "hello", None, 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn metadata_outbound_commit_rejects_stale_authority_without_partial_writes() {
        let store = store();
        seed_pending_public_message(&store);
        commit_public_message(&store);
        let error = MetadataInteractionRepository::persist_metadata_interaction(
            &store,
            &MetadataInteractionCommit {
                command_id: "stale-interaction",
                conversation_id: "conversation-1",
                target_message_id: "message-public",
                interaction_kind: "pin",
                command_bytes: b"stale-command",
                delivery_plan_sha256: &[16; 32],
                expected_authority_sequence: 0,
                expected_authority_hash: &[],
                created_at_unix_ms: 24,
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            "mobile messaging authority head changed during send preparation"
        );
        let connection = store.connection.lock().unwrap();
        for table in [
            "messaging_local_commands",
            "messaging_command_outbox",
            "messaging_command_attempts",
            "messaging_interaction_intents",
        ] {
            let count = connection
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE command_id = 'stale-interaction'"),
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            assert_eq!(count, 0, "table {table}");
        }
    }

    #[test]
    fn mls_outbound_key_packages_and_startup_state_are_durable() {
        let store = store();
        activate_device(&store);
        let private_content = encode_message_private_content("hello group", &[]).unwrap();
        let stale_projection = PendingSenderProjection {
            command_id: "stale-mls-send",
            conversation_id: "group-1",
            conversation_kind: 2,
            message_id: "stale-message",
            sender_ptid: "ptid:alice",
            sender_device_id: "alice-device",
            plaintext: "stale group message",
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: &[],
            private_content: &private_content,
            delivery_plan_sha256: &[20; 32],
            created_at_unix_ms: 29,
        };
        assert!(MlsOutboundRepository::persist_mls_outbound_send(
            &store,
            &MlsOutboundSendCommit {
                command_bytes: b"stale-mls-command",
                expected_authority_sequence: 1,
                expected_authority_hash: &[19; 32],
                session_state: b"stale-mls-session",
                membership_epoch: 1,
                mls_epoch: 1,
                projection: stale_projection,
            },
        )
        .is_err());
        assert!(MessagingRepository::next_command(&store, 29)
            .unwrap()
            .is_none());
        let projection = PendingSenderProjection {
            command_id: "command-mls-send",
            conversation_id: "group-1",
            conversation_kind: 2,
            message_id: "message-mls-send",
            sender_ptid: "ptid:alice",
            sender_device_id: "alice-device",
            plaintext: "hello group",
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: &[],
            private_content: &private_content,
            delivery_plan_sha256: &[21; 32],
            created_at_unix_ms: 30,
        };
        MlsOutboundRepository::persist_mls_outbound_send(
            &store,
            &MlsOutboundSendCommit {
                command_bytes: b"mls-command",
                expected_authority_sequence: 0,
                expected_authority_hash: &[],
                session_state: b"mls-session",
                membership_epoch: 1,
                mls_epoch: 1,
                projection,
            },
        )
        .unwrap();
        assert_eq!(
            MlsStartupRepository::list_mls_session_states(&store).unwrap(),
            vec![("group-1".to_string(), b"mls-session".to_vec())]
        );
        assert_eq!(
            MessagingRepository::next_command(&store, 30)
                .unwrap()
                .unwrap()
                .command_id,
            "command-mls-send"
        );

        MlsTransitionRepository::persist_mls_transition(
            &store,
            &MlsTransitionSendCommit {
                logical_intent_id: None,
                command_id: "command-transition",
                conversation_id: "group-2",
                transition_id: "transition-1",
                delivery_plan_sha256: &[22; 32],
                command_bytes: b"transition-command",
                pending_transition_state: b"pending-transition",
                created_at_unix_ms: 31,
            },
        )
        .unwrap();
        assert_eq!(
            MlsStartupRepository::list_pending_mls_transitions(&store).unwrap(),
            vec![("group-2".to_string(), b"pending-transition".to_vec())]
        );

        MlsKeyPackageRepository::install_fresh_mls_key_packages(
            &store,
            &[b"package-1".to_vec(), b"package-2".to_vec()],
            b"provider-pool",
            32,
        )
        .unwrap();
        let packages = MlsKeyPackageRepository::pending_mls_key_packages(&store).unwrap();
        assert_eq!(packages.len(), 2);
        MlsKeyPackageRepository::complete_mls_key_package_publication(
            &store,
            &packages[0].package_id,
        )
        .unwrap();
        assert_eq!(
            MlsKeyPackageRepository::pending_mls_key_packages(&store)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            MlsStartupRepository::load_mls_join_provider_pool(&store).unwrap(),
            Some(b"provider-pool".to_vec())
        );
    }

    #[test]
    fn mls_join_application_and_retirement_commit_atomically() {
        let store = store();
        let join_hash = [31u8; 32];
        MlsInboundRepository::persist_claimed_item(
            &store,
            "item-join",
            "event-join",
            "group-1",
            1,
            1,
            &[30; 32],
            b"welcome",
            40,
        )
        .unwrap();
        let joined = MlsConversationProjection {
            conversation_id: "group-1".into(),
            authority_station_id: "station-1".into(),
            federation_id: "federation-1".into(),
            kind: 2,
            name: "Group".into(),
            owner_ptid: "ptid:alice".into(),
            members: vec![
                MlsConversationMemberProjection {
                    ptid: "ptid:alice".into(),
                    role: 1,
                },
                MlsConversationMemberProjection {
                    ptid: "ptid:bob".into(),
                    role: 2,
                },
            ],
            membership_epoch: 3,
            mls_epoch: 3,
            active: true,
            updated_at_unix_ms: 40,
        };
        assert_eq!(
            MlsInboundRepository::commit_mls_transition_receive(
                &store,
                &MlsTransitionReceiveCommit {
                    item_id: "item-join",
                    event_id: "event-join",
                    conversation_id: "group-1",
                    event_sequence: 9,
                    lane_sequence: 1,
                    consumer_epoch: 1,
                    payload_sha256: &[30; 32],
                    event_hash: &join_hash,
                    previous_event_hash: &[29; 32],
                    transition_id: "transition-join",
                    transition_kind: 2,
                    session_state: b"joined-session",
                    provider_pool_state: Some(b"joined-provider-pool"),
                    from_membership_epoch: 2,
                    to_membership_epoch: 3,
                    from_mls_epoch: 2,
                    to_mls_epoch: 3,
                    authority_projection: &joined,
                    allow_join_checkpoint: true,
                    receipt_id: "receipt-join",
                    receipt_bytes: b"receipt",
                    consumed_at_unix_ms: 41,
                },
            )
            .unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            MlsInboundRepository::load_mls_session_state(&store, "group-1").unwrap(),
            Some(b"joined-session".to_vec())
        );

        let application_hash = [32u8; 32];
        MlsInboundRepository::persist_claimed_item(
            &store,
            "item-application",
            "event-application",
            "group-1",
            2,
            1,
            &[32; 32],
            b"application",
            42,
        )
        .unwrap();
        let message = MlsMessageProjection {
            conversation_id: "group-1".into(),
            event_id: "event-application".into(),
            event_sequence: 10,
            message_id: "message-mls".into(),
            sender_ptid: "ptid:bob".into(),
            sender_device_id: "bob-device".into(),
            plaintext: "hello".into(),
            attachments: vec![],
            committed_at_unix_ms: 43,
            reply_to_message_id: None,
            thread_root_message_id: None,
        };
        MlsInboundRepository::commit_mls_application(
            &store,
            &MlsApplicationReceiveCommit {
                item_id: "item-application",
                event_id: "event-application",
                conversation_id: "group-1",
                lane_sequence: 2,
                consumer_epoch: 1,
                payload_sha256: &[32; 32],
                event_hash: &application_hash,
                previous_event_hash: &join_hash,
                session_state: b"application-session",
                membership_epoch: 3,
                mls_epoch: 3,
                projection: &message,
                receipt_id: "receipt-application",
                receipt_bytes: b"receipt",
                consumed_at_unix_ms: 43,
            },
        )
        .unwrap();

        let retirement_hash = [33u8; 32];
        MlsInboundRepository::persist_claimed_item(
            &store,
            "item-retirement",
            "event-retirement",
            "group-1",
            3,
            1,
            &[33; 32],
            b"retirement",
            44,
        )
        .unwrap();
        let retired = MlsConversationProjection {
            active: false,
            membership_epoch: 4,
            mls_epoch: 4,
            members: vec![MlsConversationMemberProjection {
                ptid: "ptid:bob".into(),
                role: 1,
            }],
            updated_at_unix_ms: 44,
            ..joined
        };
        MlsInboundRepository::commit_mls_retirement(
            &store,
            &MlsRetirementReceiveCommit {
                item_id: "item-retirement",
                event_id: "event-retirement",
                conversation_id: "group-1",
                event_sequence: 11,
                lane_sequence: 3,
                consumer_epoch: 1,
                payload_sha256: &[33; 32],
                event_hash: &retirement_hash,
                previous_event_hash: &application_hash,
                transition_id: "transition-retire",
                endpoint_ptid: "ptid:alice",
                endpoint_device_id: "alice-device",
                membership_epoch: 4,
                mls_epoch: 4,
                projection: &retired,
                receipt_id: "receipt-retirement",
                receipt_bytes: b"receipt",
                consumed_at_unix_ms: 44,
            },
        )
        .unwrap();
        assert!(
            MlsInboundRepository::load_mls_session_state(&store, "group-1")
                .unwrap()
                .is_none()
        );
        assert!(MlsInboundRepository::has_mls_retired_checkpoint(&store, "group-1").unwrap());
        assert!(!MessagingRepository::conversation_projections(&store).unwrap()[0].active);
        assert_eq!(
            MessagingRepository::lane_checkpoint(&store).unwrap(),
            (3, 1)
        );
    }

    #[test]
    fn mls_sender_transition_consumes_exact_pending_state() {
        let store = store();
        let initial_hash = [41u8; 32];
        MessagingRepository::persist_claimed_item(
            &store,
            "item-conversation",
            "event-conversation",
            "group-1",
            1,
            1,
            &[40; 32],
            b"conversation",
            50,
        )
        .unwrap();
        let conversation = ConversationProjection {
            conversation_id: "group-1".into(),
            authority_station_id: "station-1".into(),
            federation_id: "federation-1".into(),
            kind: 2,
            name: "Group".into(),
            owner_ptid: "ptid:alice".into(),
            member_ptids: vec![
                "ptid:alice".into(),
                "ptid:bob".into(),
                "ptid:charlie".into(),
            ],
            membership_epoch: 1,
            mls_epoch: 1,
            active: true,
            updated_at_unix_ms: 50,
        };
        MessagingRepository::commit_conversation_state(
            &store,
            &ConversationStateReceiveCommit {
                item_id: "item-conversation",
                event_id: "event-conversation",
                conversation_id: "group-1",
                event_sequence: 1,
                lane_sequence: 1,
                consumer_epoch: 1,
                payload_sha256: &[40; 32],
                event_hash: &initial_hash,
                previous_event_hash: &[],
                projection: &conversation,
                receipt_id: "receipt-conversation",
                receipt_bytes: b"receipt",
                consumed_at_unix_ms: 50,
            },
        )
        .unwrap();
        MlsTransitionRepository::persist_mls_transition(
            &store,
            &MlsTransitionSendCommit {
                logical_intent_id: None,
                command_id: "command-transition",
                conversation_id: "group-1",
                transition_id: "transition-1",
                delivery_plan_sha256: &[42; 32],
                command_bytes: b"transition-command",
                pending_transition_state: b"pending-transition",
                created_at_unix_ms: 51,
            },
        )
        .unwrap();
        let committed_hash = [43u8; 32];
        MlsInboundRepository::persist_claimed_item(
            &store,
            "item-transition",
            "event-transition",
            "group-1",
            2,
            1,
            &[43; 32],
            b"transition-marker",
            52,
        )
        .unwrap();
        let authority_projection = MlsConversationProjection {
            conversation_id: "group-1".into(),
            authority_station_id: "station-1".into(),
            federation_id: "federation-1".into(),
            kind: ConversationKind::Group as i32,
            name: "Group".into(),
            owner_ptid: "ptid:alice".into(),
            members: vec![
                MlsConversationMemberProjection {
                    ptid: "ptid:alice".into(),
                    role: MemberRole::Owner as i32,
                },
                MlsConversationMemberProjection {
                    ptid: "ptid:bob".into(),
                    role: MemberRole::Member as i32,
                },
            ],
            membership_epoch: 2,
            mls_epoch: 2,
            active: true,
            updated_at_unix_ms: 52,
        };
        assert_eq!(
            MlsInboundRepository::commit_mls_sender_transition(
                &store,
                &MlsSenderTransitionReceiveCommit {
                    item_id: "item-transition",
                    event_id: "event-transition",
                    conversation_id: "group-1",
                    command_id: "command-transition",
                    transition_id: "transition-1",
                    event_sequence: 2,
                    lane_sequence: 2,
                    consumer_epoch: 1,
                    payload_sha256: &[43; 32],
                    event_hash: &committed_hash,
                    previous_event_hash: &initial_hash,
                    session_state: b"committed-session",
                    membership_epoch: 2,
                    mls_epoch: 2,
                    authority_projection: &authority_projection,
                    receipt_id: "receipt-transition",
                    receipt_bytes: b"receipt",
                    consumed_at_unix_ms: 52,
                },
            )
            .unwrap(),
            ReceiveCommitResult::Committed
        );
        assert!(
            MlsInboundRepository::pending_mls_transition(&store, "group-1")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            MlsInboundRepository::load_mls_session_state(&store, "group-1").unwrap(),
            Some(b"committed-session".to_vec())
        );
        let members = store
            .connection
            .lock()
            .unwrap()
            .prepare(
                "SELECT ptid FROM messaging_conversation_members
                 WHERE conversation_id = ?1 ORDER BY ptid",
            )
            .unwrap()
            .query_map(params!["group-1"], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            members,
            vec!["ptid:alice".to_string(), "ptid:bob".to_string()]
        );
    }

    #[test]
    fn mls_sender_genesis_atomically_commits_projection_session_and_marker() {
        let store = store();
        MlsTransitionRepository::persist_mls_transition(
            &store,
            &MlsTransitionSendCommit {
                logical_intent_id: None,
                command_id: "genesis-command",
                conversation_id: "group-genesis",
                transition_id: "genesis-transition",
                delivery_plan_sha256: &[7; 32],
                command_bytes: b"genesis-command-bytes",
                pending_transition_state: b"pending-genesis-state",
                created_at_unix_ms: 100,
            },
        )
        .unwrap();
        MlsInboundRepository::persist_claimed_item(
            &store,
            "genesis-item",
            "genesis-event",
            "group-genesis",
            1,
            1,
            &[8; 32],
            b"genesis-delivery",
            101,
        )
        .unwrap();
        let projection = MlsConversationProjection {
            conversation_id: "group-genesis".to_string(),
            authority_station_id: "station-authority".to_string(),
            federation_id: "federation-1".to_string(),
            kind: ConversationKind::Group as i32,
            name: "Genesis group".to_string(),
            owner_ptid: "ptid:alice".to_string(),
            members: vec![
                MlsConversationMemberProjection {
                    ptid: "ptid:alice".to_string(),
                    role: MemberRole::Owner as i32,
                },
                MlsConversationMemberProjection {
                    ptid: "ptid:bob".to_string(),
                    role: MemberRole::Member as i32,
                },
            ],
            membership_epoch: 1,
            mls_epoch: 1,
            active: true,
            updated_at_unix_ms: 101,
        };
        let commit = MlsSenderTransitionReceiveCommit {
            item_id: "genesis-item",
            event_id: "genesis-event",
            conversation_id: "group-genesis",
            command_id: "genesis-command",
            transition_id: "genesis-transition",
            event_sequence: 1,
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &[8; 32],
            event_hash: &[9; 32],
            previous_event_hash: &[],
            session_state: b"committed-genesis-state",
            membership_epoch: 1,
            mls_epoch: 1,
            authority_projection: &projection,
            receipt_id: "genesis-receipt",
            receipt_bytes: b"genesis-receipt-bytes",
            consumed_at_unix_ms: 101,
        };

        assert_eq!(
            MlsInboundRepository::commit_mls_sender_transition(&store, &commit).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            MlsInboundRepository::commit_mls_sender_transition(&store, &commit).unwrap(),
            ReceiveCommitResult::AlreadyCommitted
        );
        assert_eq!(
            MlsInboundRepository::load_mls_session_state(&store, "group-genesis").unwrap(),
            Some(b"committed-genesis-state".to_vec())
        );
        assert!(
            MlsInboundRepository::pending_mls_transition(&store, "group-genesis")
                .unwrap()
                .is_none()
        );
        let conversations = MessagingRepository::conversation_projections(&store).unwrap();
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].conversation_id, "group-genesis");
        assert_eq!(conversations[0].federation_id, "federation-1");
        assert_eq!(
            MessagingRepository::lane_checkpoint(&store).unwrap(),
            (1, 1)
        );
        let roles = store
            .connection
            .lock()
            .unwrap()
            .prepare(
                "SELECT ptid, role FROM messaging_conversation_members
                 WHERE conversation_id = ?1 ORDER BY ptid",
            )
            .unwrap()
            .query_map(params!["group-genesis"], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            roles,
            vec![
                ("ptid:alice".to_string(), MemberRole::Owner as i32),
                ("ptid:bob".to_string(), MemberRole::Member as i32),
            ]
        );
    }

    #[test]
    fn direct_outbound_commit_rejects_stale_ratchet_state_atomically() {
        let store = store();
        let previous = direct_session(0);
        upsert_direct_session(&store.connection.lock().unwrap(), &previous).unwrap();
        let private_content = encode_message_private_content("hello", &[]).unwrap();
        let mut advanced = previous.clone();
        advanced.ratchet.n_send = 1;
        advanced.updated_at_unix_ms = 30;
        let first_projection = PendingSenderProjection {
            command_id: "command-direct-1",
            conversation_id: "conversation-1",
            conversation_kind: 1,
            message_id: "message-direct-1",
            sender_ptid: "ptid:alice",
            sender_device_id: "alice-device",
            plaintext: "hello",
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: &[],
            private_content: &private_content,
            delivery_plan_sha256: &[61; 32],
            created_at_unix_ms: 30,
        };
        DirectOutboundRepository::persist_direct_outbound_send(
            &store,
            &DirectOutboundSendCommit {
                command_bytes: b"command-direct-1",
                expected_authority_sequence: 0,
                expected_authority_hash: &[],
                session_advances: &[DirectSessionAdvance {
                    previous: Some(previous.clone()),
                    advanced: advanced.clone(),
                    session_init: None,
                }],
                projection: first_projection,
            },
        )
        .unwrap();

        let stale_projection = PendingSenderProjection {
            command_id: "command-direct-2",
            conversation_id: "conversation-1",
            conversation_kind: 1,
            message_id: "message-direct-2",
            sender_ptid: "ptid:alice",
            sender_device_id: "alice-device",
            plaintext: "hello",
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: &[],
            private_content: &private_content,
            delivery_plan_sha256: &[62; 32],
            created_at_unix_ms: 31,
        };
        let error = DirectOutboundRepository::persist_direct_outbound_send(
            &store,
            &DirectOutboundSendCommit {
                command_bytes: b"command-direct-2",
                expected_authority_sequence: 0,
                expected_authority_hash: &[],
                session_advances: &[DirectSessionAdvance {
                    previous: Some(previous),
                    advanced,
                    session_init: None,
                }],
                projection: stale_projection,
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            "mobile messaging Direct session changed during send preparation"
        );
        assert_eq!(
            store
                .connection
                .lock()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM messaging_local_commands
                     WHERE command_id = 'command-direct-2'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn enrollment_gates_prekeys_and_receipt_dispatch_state_is_exact_byte_bound() {
        let store = store();
        let identity = generate_fresh_device_identity("ptid:alice", [42; 32], 1).unwrap();
        let device = identity
            .enrollment
            .certificate
            .device
            .as_ref()
            .unwrap()
            .clone();
        DeviceEnrollmentRepository::install_fresh_device_identity(&store, &identity).unwrap();
        assert_eq!(
            DeviceEnrollmentRepository::pending_device_enrollment(&store)
                .unwrap()
                .unwrap(),
            identity.enrollment
        );
        assert!(PreKeyRepository::install_fresh_prekey_bundle(
            &store,
            7,
            &[8; 32],
            &[(9, [10; 32])],
            20,
        )
        .is_err());

        DeviceEnrollmentRepository::complete_device_enrollment(&store, &device.device_id).unwrap();
        let (active_enrollment, active_signing_key) =
            store.active_device_signing_identity().unwrap();
        assert_eq!(active_enrollment, identity.enrollment);
        assert_eq!(active_signing_key.device_id(), device.device_id);
        assert_eq!(
            active_signing_key.verifying_key().as_bytes(),
            active_enrollment
                .certificate
                .device_signing_public_key
                .as_slice()
        );
        PreKeyRepository::install_fresh_prekey_bundle(&store, 7, &[8; 32], &[(9, [10; 32])], 20)
            .unwrap();
        let bundle = PreKeyRepository::pending_prekey_bundle(&store)
            .unwrap()
            .unwrap();
        assert_eq!(bundle.signed_prekey_id, 7);
        assert_eq!(bundle.one_time_prekeys, vec![(9, [10; 32])]);
        PreKeyRepository::complete_prekey_publication(&store, 7).unwrap();
        assert!(PreKeyRepository::pending_prekey_bundle(&store)
            .unwrap()
            .is_none());

        let receipt = DeviceConsumptionReceipt {
            receipt_id: "device-consumed:item-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            event_id: "event-1".to_string(),
            consumer: Some(messaging_core::proto::chat::CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: device.device_id,
            }),
            event_sequence: 1,
            lane_sequence: 1,
            payload_sha256: vec![1; 32],
            consumed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 30_000_000,
            }),
        };
        let receipt_bytes = receipt.encode_to_vec();
        store
            .connection
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO messaging_receipt_outbox(
                    receipt_id, event_id, receipt_bytes, state, created_at_unix_ms
                 ) VALUES ('device-consumed:item-1', 'event-1', ?1, 'pending', 30)",
                params![receipt_bytes],
            )
            .unwrap();
        let (receipt_id, pending_bytes, pending) =
            store.next_device_consumption_receipt().unwrap().unwrap();
        assert_eq!(pending, receipt);
        assert!(store
            .mark_device_consumption_receipt_submitted(&receipt_id, b"wrong")
            .is_err());
        store
            .mark_device_consumption_receipt_submitted(&receipt_id, &pending_bytes)
            .unwrap();
        assert!(store.next_device_consumption_receipt().unwrap().is_none());
    }

    #[test]
    fn attachment_backed_draft_promotes_only_completed_upload_metadata() {
        let store = store();
        let draft = PendingMessageDraft {
            conversation_id: "conversation-1".to_string(),
            conversation_kind: 1,
            message_id: "message-attachment".to_string(),
            sender_ptid: "ptid:alice".to_string(),
            sender_device_id: "alice-device".to_string(),
            plaintext: "attachment".to_string(),
            reply_to_message_id: String::new(),
            thread_root_message_id: String::new(),
            attachments: Vec::new(),
            attempt_count: 0,
            created_at_unix_ms: 10,
        };
        let upload = PendingAttachmentUpload {
            transfer: attachment_upload_transfer(),
            filename: "proof.txt".to_string(),
            mime_type: "text/plain".to_string(),
            plaintext_sha256: vec![7; 32],
        };
        store
            .create_message_draft_with_uploads(&draft, &[upload.clone()])
            .unwrap();
        assert_eq!(
            store.next_due_attachment_upload(10).unwrap().as_deref(),
            Some("attachment-1")
        );
        assert!(store.next_due_message_draft(10).unwrap().is_none());
        assert!(store
            .conversation_message_projections("conversation-1")
            .unwrap()
            .is_empty());

        let descriptor = attachment_descriptor();
        let upload_spec = EncryptedObjectUploadSpec {
            ciphertext_size: descriptor.ciphertext_size,
            ciphertext_sha256: descriptor.ciphertext_sha256.clone(),
            media_type: descriptor.media_type.clone(),
            chunk_size: descriptor.chunk_size,
            chunk_count: descriptor.chunk_count,
            encryption_suite: descriptor.encryption_suite,
            tag_size: descriptor.tag_size,
            nonce_strategy: descriptor.nonce_strategy,
            chunk_ciphertext_sha256: descriptor.chunk_ciphertext_sha256.clone(),
        };
        let commitment = upload_commitment_fields(
            "conversation-1",
            "message-attachment",
            "attachment-1",
            "station-authority",
            &upload_spec,
        );
        store
            .update_attachment_transfer_prepared(
                "attachment-1",
                &commitment,
                "/tmp/mobile-attachment-upload.part",
                11,
            )
            .unwrap();
        store
            .update_attachment_transfer_progress(
                "attachment-1",
                AttachmentTransferState::Transferring as i32,
                "upload-1",
                1,
                &[1],
                0,
                0,
                0,
                12,
            )
            .unwrap();
        let transferring = store.attachment_transfer("attachment-1").unwrap().unwrap();
        store
            .complete_attachment_upload(&transferring, &descriptor, 13)
            .unwrap();

        assert_eq!(store.next_attachment_retry_at().unwrap(), None);
        let completed_draft = store
            .conversation_message_projections("conversation-1")
            .unwrap();
        assert_eq!(completed_draft.len(), 1);
        assert_eq!(completed_draft[0].state, "draft");
        assert_eq!(completed_draft[0].attachments, vec![attachment_metadata()]);
        let ready = store.next_due_message_draft(13).unwrap().unwrap();
        assert_eq!(ready.attachments, vec![attachment_metadata()]);
        store
            .validate_sender_attachments_ready(
                &ready.conversation_id,
                &ready.message_id,
                &ready.attachments,
            )
            .unwrap();
        let private_content =
            encode_message_private_content(&ready.plaintext, &ready.attachments).unwrap();
        store
            .with_transaction(|transaction| {
                persist_pending_sender(
                    transaction,
                    b"attachment-command",
                    &PendingSenderProjection {
                        command_id: "attachment-command",
                        conversation_id: &ready.conversation_id,
                        conversation_kind: ready.conversation_kind,
                        message_id: &ready.message_id,
                        sender_ptid: &ready.sender_ptid,
                        sender_device_id: &ready.sender_device_id,
                        plaintext: &ready.plaintext,
                        reply_to_message_id: &ready.reply_to_message_id,
                        thread_root_message_id: &ready.thread_root_message_id,
                        attachments: &ready.attachments,
                        private_content: &private_content,
                        delivery_plan_sha256: &[9; 32],
                        created_at_unix_ms: ready.created_at_unix_ms,
                    },
                )
            })
            .unwrap();
        assert_eq!(
            store
                .attachment_availability_state("attachment-1")
                .unwrap()
                .as_deref(),
            Some("local")
        );
        let source = store
            .completed_sender_attachment_source("attachment-1")
            .unwrap()
            .unwrap();
        assert!(store
            .owns_attachment_source(&source.source_local_ref)
            .unwrap());
        assert!(store
            .connection
            .lock()
            .unwrap()
            .query_row(
                "SELECT NOT EXISTS(
                    SELECT 1 FROM messaging_attachment_drafts
                    WHERE message_id = 'message-attachment'
                 )",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap());

        store
            .promote_completed_upload_cache(&source, "/tmp/mobile-attachment-cache")
            .unwrap();
        assert!(store
            .clear_completed_attachment_source(&source, "/tmp/mobile-attachment-cache")
            .is_err());
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext, delivery_state,
                        committed_at_unix_ms
                     ) VALUES (
                        'conversation-1', 'event-attachment', 1, 'message-attachment',
                        'ptid:alice', 'alice-device', 'attachment', 'accepted', 14
                     )",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "DELETE FROM messaging_pending_messages
                     WHERE conversation_id = 'conversation-1'
                       AND message_id = 'message-attachment'",
                    [],
                )
                .unwrap();
        }
        assert_eq!(
            store.completed_attachment_sources().unwrap(),
            vec![CompletedSenderAttachmentSource {
                local_cache_path: Some("/tmp/mobile-attachment-cache".to_string()),
                ..source.clone()
            }]
        );
        store
            .clear_completed_attachment_source(&source, "/tmp/mobile-attachment-cache")
            .unwrap();
        assert!(!store
            .owns_attachment_source(&source.source_local_ref)
            .unwrap());

        let download = AttachmentTransferRecord {
            direction: 2,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: String::new(),
            partial_local_ref: "/tmp/mobile-attachment-redownload.part".to_string(),
            attempt_count: 0,
            next_attempt_at_unix_ms: 20,
            last_error_code: 0,
            updated_at_unix_ms: 20,
            ..attachment_upload_transfer()
        };
        store
            .replace_completed_upload_with_download(&download)
            .unwrap();
        assert_eq!(
            store.attachment_transfer("attachment-1").unwrap(),
            Some(download)
        );
        assert_eq!(store.next_attachment_retry_at().unwrap(), Some(20));
    }

    #[test]
    fn received_attachment_remains_remote_until_verified_download_completion() {
        let store = store();
        let metadata = attachment_metadata();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO messaging_conversations(
                        conversation_id, authority_station_id, federation_id,
                        kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (
                        'conversation-1', 'station-authority', 'federation-1',
                        1, '', 'ptid:alice',
                        1, 0, 1, 10
                     )",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext, delivery_state,
                        committed_at_unix_ms
                     ) VALUES (
                        'conversation-1', 'event-1', 1, 'message-attachment',
                        'ptid:bob', 'bob-device', '', 'consumed', 10
                     )",
                    [],
                )
                .unwrap();
            persist_received_message_attachments(
                &connection,
                "message-attachment",
                std::slice::from_ref(&metadata),
            )
            .unwrap();
        }
        assert_eq!(
            store
                .attachment_availability_state("attachment-1")
                .unwrap()
                .as_deref(),
            Some("remote")
        );
        let descriptor = metadata.object.as_ref().unwrap();
        let mut download = attachment_upload_transfer();
        download.direction = 2;
        download.source_local_ref.clear();
        download.partial_local_ref = "/tmp/mobile-attachment-download.part".to_string();
        store.create_attachment_transfer(&download).unwrap();
        assert_eq!(
            store.next_due_attachment_download(10).unwrap().as_deref(),
            Some("attachment-1")
        );
        let descriptor_hash: [u8; 32] = Sha256::digest(descriptor.encode_to_vec()).into();
        store
            .update_attachment_transfer_prepared(
                "attachment-1",
                &descriptor_hash,
                &download.partial_local_ref,
                11,
            )
            .unwrap();
        store
            .update_attachment_transfer_progress(
                "attachment-1",
                AttachmentTransferState::Transferring as i32,
                "",
                0,
                &[1],
                0,
                0,
                0,
                12,
            )
            .unwrap();
        let transferring = store.attachment_transfer("attachment-1").unwrap().unwrap();
        store
            .complete_attachment_download(
                &transferring,
                descriptor,
                "/tmp/mobile-attachment-cache",
                13,
            )
            .unwrap();
        assert_eq!(
            store
                .attachment_availability_state("attachment-1")
                .unwrap()
                .as_deref(),
            Some("local")
        );
        assert_eq!(
            store
                .attachment_download_projection("attachment-1")
                .unwrap()
                .unwrap()
                .local_cache_path
                .as_deref(),
            Some("/tmp/mobile-attachment-cache")
        );
    }

    #[test]
    fn shared_schema_migrates_mobile_cursor_and_prekey_tables() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE messaging_conversations (
                    conversation_id TEXT PRIMARY KEY,
                    authority_station_id TEXT NOT NULL,
                    kind INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    owner_ptid TEXT NOT NULL,
                    membership_epoch INTEGER NOT NULL,
                    mls_epoch INTEGER NOT NULL,
                    active INTEGER NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                 );
                 INSERT INTO messaging_conversations VALUES (
                    'conversation-legacy', 'station-authority', 1, '', 'ptid:alice',
                    1, 0, 1, 10
                 );
                 CREATE TABLE messaging_read_cursors (
                    conversation_id TEXT NOT NULL,
                    actor_ptid TEXT NOT NULL,
                    last_read_sequence INTEGER NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL,
                    PRIMARY KEY(conversation_id, actor_ptid)
                 );
                 INSERT INTO messaging_read_cursors
                    VALUES ('conversation-1', 'ptid:alice', 7, 10);
                 CREATE TABLE messaging_prekeys (
                    kind TEXT NOT NULL,
                    prekey_id INTEGER NOT NULL,
                    private_key BLOB NOT NULL,
                    PRIMARY KEY(kind, prekey_id)
                 );
                 INSERT INTO messaging_prekeys VALUES ('signed', 3, zeroblob(32));
                 INSERT INTO messaging_prekeys VALUES ('one_time', 9, zeroblob(32));
                 CREATE TABLE messaging_pending_attachments (
                    message_id TEXT NOT NULL,
                    attachment_id TEXT NOT NULL,
                    metadata_bytes BLOB NOT NULL,
                    PRIMARY KEY(message_id, attachment_id)
                 );
                 CREATE TABLE messaging_message_attachments (
                    message_id TEXT NOT NULL,
                    attachment_id TEXT NOT NULL,
                    metadata_bytes BLOB NOT NULL,
                    PRIMARY KEY(message_id, attachment_id)
                 );",
            )
            .unwrap();
        let store = MobileMessagingStore::from_connection(connection).unwrap();
        assert!(store
            .reconcile_conversation_authority_scope(
                "conversation-legacy",
                "station-authority",
                "federation-1",
            )
            .unwrap());
        let connection = store.connection.lock().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT federation_id FROM messaging_conversations
                     WHERE conversation_id = 'conversation-legacy'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "federation-1"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT last_read_sequence FROM read_cursors
                     WHERE conversation_id = 'conversation-1' AND actor_ptid = 'ptid:alice'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            7
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT signed_prekey_id FROM messaging_prekey_bundle WHERE id = 1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            3
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT state FROM messaging_one_time_prekeys WHERE prekey_id = 9",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "available"
        );
        for retired in [
            "messaging_read_cursors",
            "messaging_prekeys",
            "messaging_pending_attachments",
            "messaging_message_attachments",
        ] {
            assert!(!connection
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
                     )",
                    params![retired],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap());
        }
    }

    #[test]
    fn sqlcipher_store_reopens_only_with_the_original_key() {
        let path = std::env::temp_dir().join(format!(
            "peers-mobile-messaging-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let key = [11u8; 32];
        MobileMessagingStore::open(&path, &key)
            .unwrap()
            .validate_integrity()
            .unwrap();
        MobileMessagingStore::open(&path, &key)
            .unwrap()
            .validate_integrity()
            .unwrap();
        assert!(MobileMessagingStore::open(&path, &[12u8; 32]).is_err());
        let _ = std::fs::remove_file(path);
    }
}
