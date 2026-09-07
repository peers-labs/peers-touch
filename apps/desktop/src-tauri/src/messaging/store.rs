use super::recovery::{
    MessagingRecoveryArchive, RecoveryAttachmentMetadata, RecoveryConversationProjection,
    RecoveryMessageProjection, RecoveryTrustRecord,
};
use crate::domain::crypto::double_ratchet::{DrSessionState, DrSkippedMessageKey};
use crate::domain::crypto::{CryptoEndpoint, DirectSession, DirectSessionKey};
use crate::domain::storage::database::DatabaseOpenSpec;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::infrastructure::storage::open_database;
use crate::model::chat::{
    chat_command, AttachmentPlaintextMetadata, AttachmentTransferState, ChatCommand,
    ConversationKind, EncryptedObjectDescriptor, EncryptedObjectUploadSpec, MemberRole,
};
pub use messaging_core::attachment::AttachmentTransferRecord;
use messaging_core::attachment::AttachmentTransferRepository;
pub use messaging_core::contracts::{CommandStatusProjection, ConversationMessageProjection};
use messaging_core::contracts::{
    CryptoEndpoint as CoreCryptoEndpoint, InteractionMutation as CoreInteractionMutation,
    InteractionReceiveCommit as CoreInteractionReceiveCommit, MlsApplicationReceiveCommit,
    MlsConversationProjection, MlsRetirementReceiveCommit as CoreMlsRetirementReceiveCommit,
    MlsSenderTransitionReceiveCommit as CoreMlsSenderTransitionReceiveCommit,
    MlsTransitionReceiveCommit as CoreMlsTransitionReceiveCommit,
    PendingMlsKeyPackage as CorePendingMlsKeyPackage,
    PendingMlsTransitionState as CorePendingMlsTransitionState,
    ReceiveCommitResult as CoreReceiveCommitResult,
};
use messaging_core::crypto::prekeys::{PendingPreKeyBundle, PreKeyRepository};
use messaging_core::identity::{
    DeviceEnrollmentRepository, FreshDeviceEnrollment, FreshDeviceIdentityState,
    MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION,
};
use messaging_core::outbox::{MetadataInteractionCommit, MetadataInteractionRepository};
use messaging_core::proto::{actor_device_ptid, actor_device_ref};
use messaging_core::store::{migrate_messaging_schema, MessagingSchemaBackend};
use messaging_core::store::{
    DirectOutboundEditCommit, DirectOutboundRepository, DirectOutboundSendCommit,
    DirectOutboundSession, DirectSessionAdvance, MlsInboundRepository, MlsKeyPackageRepository,
    MlsOutboundEditCommit, MlsOutboundRepository, MlsOutboundSendCommit, MlsStartupRepository,
    MlsTransitionRepository, MlsTransitionSendCommit,
    PendingSenderProjection as CorePendingSenderProjection,
};
use prost::Message;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::sync::{Mutex, MutexGuard};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutboxEntry {
    pub command_id: String,
    pub conversation_id: String,
    pub command_bytes: Vec<u8>,
    pub attempt_count: u32,
    pub next_attempt_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryReceiptOutboxEntry {
    pub receipt_id: String,
    pub receipt_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageProjection {
    pub conversation_id: String,
    pub event_id: String,
    pub event_sequence: i64,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub attachments: Vec<AttachmentPlaintextMetadata>,
    pub committed_at_unix_ms: i64,
    /// The message_id of the parent message this is replying to, if any.
    pub reply_to_message_id: Option<String>,
    pub thread_root_message_id: Option<String>,
    /// Latest edited plaintext content (None if never edited).
    pub edited_text: Option<String>,
    /// Timestamp of last edit in unix milliseconds (None if never edited).
    pub edited_at_unix_ms: Option<i64>,
    /// Whether the message has been retracted/deleted.
    pub retracted: bool,
}

pub struct PendingSenderProjection<'a> {
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub conversation_kind: i32,
    pub message_id: &'a str,
    pub sender_ptid: &'a str,
    pub sender_device_id: &'a str,
    pub plaintext: &'a str,
    pub reply_to_message_id: &'a str,
    pub thread_root_message_id: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub private_content: &'a [u8],
    pub delivery_plan_sha256: &'a [u8],
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMessageDraft {
    pub conversation_id: String,
    pub conversation_kind: i32,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub reply_to_message_id: String,
    pub thread_root_message_id: String,
    pub attachments: Vec<AttachmentPlaintextMetadata>,
    pub attempt_count: u32,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingAttachmentUpload {
    pub transfer: AttachmentTransferRecord,
    pub filename: String,
    pub mime_type: String,
    pub plaintext_sha256: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentDownloadProjection {
    pub conversation_id: String,
    pub message_id: String,
    pub authority_station_id: String,
    pub metadata: AttachmentPlaintextMetadata,
    pub local_cache_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletedSenderAttachmentSource {
    pub attachment_id: String,
    pub message_id: String,
    pub source_local_ref: String,
    pub plaintext_sha256: Vec<u8>,
    pub local_cache_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadCountProjection {
    pub root_message_id: String,
    pub reply_count: i64,
    pub latest_reply_id: String,
    pub latest_reply_at_unix_ms: i64,
    pub unread_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationMemberProjection {
    pub ptid: String,
    pub role: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationProjection {
    pub conversation_id: String,
    pub authority_station_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: String,
    pub members: Vec<ConversationMemberProjection>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
}

pub struct ConversationStateReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub projection: &'a ConversationProjection,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct DirectSendCommit<'a> {
    pub command_bytes: &'a [u8],
    pub expected_authority_sequence: i64,
    pub expected_authority_hash: &'a [u8],
    pub advanced_sessions: &'a [DirectSession],
    pub session_inits: &'a [(String, Vec<u8>)],
    pub projection: PendingSenderProjection<'a>,
}

pub struct MlsSendCommit<'a> {
    pub command_bytes: &'a [u8],
    pub expected_authority_sequence: i64,
    pub expected_authority_hash: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub projection: PendingSenderProjection<'a>,
}

pub struct InteractionCommandCommit<'a> {
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub target_message_id: &'a str,
    pub interaction_kind: &'a str,
    pub edited_text: Option<&'a str>,
    pub command_bytes: &'a [u8],
    pub delivery_plan_sha256: &'a [u8],
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMembershipIntent {
    pub intent_id: String,
    pub conversation_id: String,
    pub action: i32,
    pub target_ptid: String,
    pub target_device_id: String,
    pub role: String,
    pub created_at_unix_ms: i64,
}

pub struct MlsSenderTransitionReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub command_id: &'a str,
    pub transition_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMlsTransitionState {
    pub transition_id: String,
    pub command_id: String,
    pub state: Vec<u8>,
}

pub struct PublicEventReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub sender_ptid: &'a str,
    pub sender_device_id: &'a str,
    pub attachments: &'a [EncryptedObjectDescriptor],
    pub reply_to_message_id: Option<&'a str>,
    pub thread_root_message_id: Option<&'a str>,
    pub committed_at_unix_ms: i64,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub enum InteractionMutation<'a> {
    Edit {
        edited_text: &'a str,
        edited_at_unix_ms: i64,
    },
    Retract,
    Reaction {
        actor_ptid: &'a str,
        reaction: &'a str,
        removed: bool,
        created_at_unix_ms: i64,
    },
    Pin {
        actor_ptid: &'a str,
        removed: bool,
        pinned_at_unix_ms: i64,
    },
}

pub struct InteractionReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub message_id: &'a str,
    pub mutation: InteractionMutation<'a>,
    pub mls_session_state: Option<&'a [u8]>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct DirectReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub session: &'a DirectSession,
    pub new_skipped: &'a [DrSkippedMessageKey],
    pub consumed_skipped: Option<([u8; 32], u32)>,
    pub consumed_one_time_prekey_id: Option<i32>,
    pub projection: &'a MessageProjection,
    pub reply_to_message_id: Option<&'a str>,
    pub thread_root_message_id: Option<&'a str>,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct DeliveryReceiptReceiveCommit<'a> {
    pub item_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub delivery_state: &'a str,
    pub consumed_at_unix_ms: i64,
}

pub struct ActorReadReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub reader_ptid: &'a str,
    pub last_read_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

/// Atomic commit for a Direct-encrypted message edit.
/// Persists session advancement, skipped keys, consumption marker, and the
/// edit UPDATE in one transaction — same atomicity guarantee as
/// `DirectReceiveCommit` but without inserting a new message projection.
pub struct DirectEditCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub event_sequence: i64,
    pub session: &'a DirectSession,
    pub new_skipped: &'a [DrSkippedMessageKey],
    pub consumed_skipped: Option<([u8; 32], u32)>,
    pub consumed_one_time_prekey_id: Option<i32>,
    pub message_id: &'a str,
    pub edited_text: &'a str,
    pub edited_at_unix_ms: i64,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct MlsReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub projection: &'a MessageProjection,
    pub reply_to_message_id: Option<&'a str>,
    pub thread_root_message_id: Option<&'a str>,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct MlsTransitionReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub transition_id: &'a str,
    pub transition_kind: i32,
    pub session_state: &'a [u8],
    pub provider_pool_state: Option<&'a [u8]>,
    pub from_membership_epoch: i64,
    pub to_membership_epoch: i64,
    pub from_mls_epoch: i64,
    pub to_mls_epoch: i64,
    pub join_projection: Option<&'a ConversationProjection>,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct MlsRetirementReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub transition_id: &'a str,
    pub endpoint_ptid: &'a str,
    pub endpoint_device_id: &'a str,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub projection: &'a ConversationProjection,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

struct ReceiveCommitCore<'a> {
    item_id: &'a str,
    event_id: &'a str,
    conversation_id: &'a str,
    lane_sequence: i64,
    consumer_epoch: u64,
    payload_sha256: &'a [u8],
    event_hash: &'a [u8],
    previous_event_hash: &'a [u8],
    event_sequence: i64,
    allow_join_checkpoint: bool,
    projection: Option<&'a MessageProjection>,
    receipt_id: &'a str,
    receipt_bytes: &'a [u8],
    consumed_at_unix_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiveCommitResult {
    Committed,
    AlreadyCommitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReceiveFailPoint {
    None,
    AfterCrypto,
    AfterProjection,
    AfterAttachments,
    AfterSearch,
    BeforeCommit,
}

pub struct MessagingStore {
    connection: Mutex<Connection>,
}

impl MessagingStore {
    pub fn open(profile_id: &str) -> Result<Self, String> {
        if profile_id.trim().is_empty() {
            return Err("messaging store requires a profile ID".to_string());
        }
        let spec = DatabaseOpenSpec::new_chat_main(profile_id.to_string());
        let connection = open_database(&spec, PlatformKeyProvider::shared())
            .map_err(|error| format!("{error:?}"))?;
        Self::from_connection(connection)
    }

    pub(super) fn from_connection(connection: Connection) -> Result<Self, String> {
        migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "messaging store lock poisoned".to_string())
    }

    pub(super) fn validate_integrity(&self) -> Result<(), String> {
        let result: String = self
            .connection()?
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if result != "ok" {
            return Err(format!(
                "messaging recovery staging integrity failed: {result}"
            ));
        }
        Ok(())
    }

    pub(super) fn prepare_for_atomic_replace(&self) -> Result<(), String> {
        self.connection()?
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
            .map_err(|error| error.to_string())
    }

    pub fn persist_direct_send(&self, input: &DirectSendCommit<'_>) -> Result<(), String> {
        validate_pending_sender_projection(&input.projection)?;
        if input.command_bytes.is_empty() || input.advanced_sessions.is_empty() {
            return Err("messaging Direct send requires command bytes and sessions".to_string());
        }
        let mut session_ids = HashSet::with_capacity(input.advanced_sessions.len());
        for session in input.advanced_sessions {
            session.key.validate().map_err(|error| error.to_string())?;
            if !session.established
                || session.key.conversation_id != input.projection.conversation_id
                || session.key.local.ptid != input.projection.sender_ptid
                || session.key.local.device_id != input.projection.sender_device_id
                || !session_ids.insert(session.session_id.as_str())
            {
                return Err("messaging Direct send session binding mismatch".to_string());
            }
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        validate_expected_authority_head(
            &transaction,
            input.projection.conversation_id,
            input.expected_authority_sequence,
            input.expected_authority_hash,
        )?;
        persist_prepared_command(&transaction, input.command_bytes, &input.projection)?;
        for session in input.advanced_sessions {
            upsert_direct_session(&transaction, session)?;
        }
        for (session_id, init_bytes) in input.session_inits {
            if !session_ids.contains(session_id.as_str()) || init_bytes.is_empty() {
                return Err("messaging Direct session init binding mismatch".to_string());
            }
            let changed = transaction
                .execute(
                    "INSERT INTO direct_session_bootstraps(session_id, init_bytes)
                     VALUES (?1, ?2)
                     ON CONFLICT(session_id) DO UPDATE SET init_bytes=excluded.init_bytes
                     WHERE direct_session_bootstraps.init_bytes = excluded.init_bytes",
                    params![session_id, init_bytes],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err("messaging Direct session init conflicts with stored bytes".to_string());
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn persist_mls_send(&self, input: &MlsSendCommit<'_>) -> Result<(), String> {
        validate_pending_sender_projection(&input.projection)?;
        if input.command_bytes.is_empty()
            || input.session_state.is_empty()
            || input.membership_epoch < 0
            || input.mls_epoch < 0
        {
            return Err("messaging MLS send state is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        persist_prepared_command(&transaction, input.command_bytes, &input.projection)?;
        transaction
            .execute(
                "INSERT INTO messaging_mls_groups(
                    conversation_id, session_state, membership_epoch,
                    mls_epoch, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(conversation_id) DO UPDATE SET
                    session_state=excluded.session_state,
                    membership_epoch=excluded.membership_epoch,
                    mls_epoch=excluded.mls_epoch,
                    updated_at_unix_ms=excluded.updated_at_unix_ms",
                params![
                    input.projection.conversation_id,
                    input.session_state,
                    input.membership_epoch,
                    input.mls_epoch,
                    input.projection.created_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    fn persist_mls_transition(&self, input: &MlsTransitionSendCommit<'_>) -> Result<(), String> {
        if input.command_id.trim().is_empty()
            || input.conversation_id.trim().is_empty()
            || input.transition_id.trim().is_empty()
            || input.delivery_plan_sha256.len() != 32
            || input.command_bytes.is_empty()
            || input.pending_transition_state.is_empty()
            || input.created_at_unix_ms <= 0
        {
            return Err("messaging MLS genesis state is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        if let Some(intent_id) = input.logical_intent_id {
            let changed = transaction
                .execute(
                    "UPDATE messaging_membership_intents
                     SET state = 'prepared', command_id = ?2
                     WHERE intent_id = ?1 AND conversation_id = ?3
                       AND state IN ('pending_plan', 'superseded')",
                    params![intent_id, input.command_id, input.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err("messaging logical membership intent is not pending".to_string());
            }
        }
        transaction
            .execute(
                "INSERT INTO messaging_local_commands(
                    command_id, conversation_id, command_bytes, state, created_at_unix_ms
                 ) VALUES (?1, ?2, ?3, 'prepared', ?4)",
                params![
                    input.command_id,
                    input.conversation_id,
                    input.command_bytes,
                    input.created_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_command_outbox(
                    command_id, conversation_id, command_bytes, state,
                    attempt_count, next_attempt_at_unix_ms,
                    last_error_code, created_at_unix_ms
                 ) VALUES (?1, ?2, ?3, 'pending', 0, ?4, '', ?4)",
                params![
                    input.command_id,
                    input.conversation_id,
                    input.command_bytes,
                    input.created_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_command_attempts(
                    command_id, conversation_id, message_id,
                    delivery_plan_sha256, state, created_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, 'prepared', ?5)",
                params![
                    input.command_id,
                    input.conversation_id,
                    input.transition_id,
                    input.delivery_plan_sha256,
                    input.created_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_mls_pending_transitions(
                    conversation_id, transition_id, command_id, transition_state
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    input.conversation_id,
                    input.transition_id,
                    input.command_id,
                    input.pending_transition_state
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn persist_interaction_command(
        &self,
        input: &InteractionCommandCommit<'_>,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        persist_interaction_command(&transaction, input)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn persist_direct_interaction_command(
        &self,
        input: &InteractionCommandCommit<'_>,
        advanced_sessions: &[DirectSession],
        session_inits: &[(String, Vec<u8>)],
    ) -> Result<(), String> {
        if advanced_sessions.is_empty() {
            return Err("messaging Direct interaction requires sessions".to_string());
        }
        let mut session_ids = HashSet::with_capacity(advanced_sessions.len());
        for session in advanced_sessions {
            session.key.validate().map_err(|error| error.to_string())?;
            if !session.established
                || session.key.conversation_id != input.conversation_id
                || !session_ids.insert(session.session_id.as_str())
            {
                return Err("messaging Direct interaction session binding mismatch".to_string());
            }
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        persist_interaction_command(&transaction, input)?;
        for session in advanced_sessions {
            upsert_direct_session(&transaction, session)?;
        }
        for (session_id, init_bytes) in session_inits {
            if !session_ids.contains(session_id.as_str()) || init_bytes.is_empty() {
                return Err("messaging Direct interaction session init mismatch".to_string());
            }
            let changed = transaction
                .execute(
                    "INSERT INTO direct_session_bootstraps(session_id, init_bytes)
                     VALUES (?1, ?2)
                     ON CONFLICT(session_id) DO UPDATE SET init_bytes=excluded.init_bytes
                     WHERE direct_session_bootstraps.init_bytes = excluded.init_bytes",
                    params![session_id, init_bytes],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err(
                    "messaging Direct interaction session init conflicts with stored bytes"
                        .to_string(),
                );
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn persist_mls_interaction_command(
        &self,
        input: &InteractionCommandCommit<'_>,
        session_state: &[u8],
        membership_epoch: i64,
        mls_epoch: i64,
        expected_authority_sequence: i64,
        expected_authority_hash: &[u8],
    ) -> Result<(), String> {
        if session_state.is_empty() || membership_epoch < 0 || mls_epoch < 0 {
            return Err("messaging MLS interaction state is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        validate_expected_authority_head(
            &transaction,
            input.conversation_id,
            expected_authority_sequence,
            expected_authority_hash,
        )?;
        persist_interaction_command(&transaction, input)?;
        transaction
            .execute(
                "INSERT INTO messaging_mls_groups(
                    conversation_id, session_state, membership_epoch,
                    mls_epoch, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(conversation_id) DO UPDATE SET
                    session_state=excluded.session_state,
                    membership_epoch=excluded.membership_epoch,
                    mls_epoch=excluded.mls_epoch,
                    updated_at_unix_ms=excluded.updated_at_unix_ms",
                params![
                    input.conversation_id,
                    session_state,
                    membership_epoch,
                    mls_epoch,
                    input.created_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn create_membership_intent(&self, intent: &PendingMembershipIntent) -> Result<(), String> {
        if intent.intent_id.trim().is_empty()
            || intent.conversation_id.trim().is_empty()
            || intent.action <= 0
            || intent.target_ptid.trim().is_empty()
            || intent.created_at_unix_ms <= 0
        {
            return Err("messaging logical membership intent is incomplete".to_string());
        }
        self.connection()?
            .execute(
                "INSERT INTO messaging_membership_intents(
                    intent_id, conversation_id, action, target_ptid,
                    target_device_id, role, state, command_id, created_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending_plan', '', ?7)",
                params![
                    intent.intent_id,
                    intent.conversation_id,
                    intent.action,
                    intent.target_ptid,
                    intent.target_device_id,
                    intent.role,
                    intent.created_at_unix_ms
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn pending_membership_intents(&self) -> Result<Vec<PendingMembershipIntent>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT intent_id, conversation_id, action, target_ptid,
                        target_device_id, role, created_at_unix_ms
                 FROM messaging_membership_intents
                 WHERE state IN ('pending_plan', 'superseded')
                 ORDER BY created_at_unix_ms, intent_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(PendingMembershipIntent {
                    intent_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    action: row.get(2)?,
                    target_ptid: row.get(3)?,
                    target_device_id: row.get(4)?,
                    role: row.get(5)?,
                    created_at_unix_ms: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn pending_mls_transition(
        &self,
        conversation_id: &str,
    ) -> Result<Option<PendingMlsTransitionState>, String> {
        self.connection()?
            .query_row(
                "SELECT transition_id, command_id, transition_state
                 FROM messaging_mls_pending_transitions
                 WHERE conversation_id = ?1",
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

    pub fn next_command(&self, now_unix_ms: i64) -> Result<Option<CommandOutboxEntry>, String> {
        self.connection()?
            .query_row(
                "SELECT command_id, conversation_id, command_bytes,
                        attempt_count, next_attempt_at_unix_ms
                 FROM messaging_command_outbox
                 WHERE state IN ('pending', 'retry_wait')
                   AND next_attempt_at_unix_ms <= ?1
                 ORDER BY created_at_unix_ms ASC, command_id ASC
                 LIMIT 1",
                params![now_unix_ms],
                |row| {
                    Ok(CommandOutboxEntry {
                        command_id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        command_bytes: row.get(2)?,
                        attempt_count: row.get(3)?,
                        next_attempt_at_unix_ms: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn command_status(
        &self,
        command_id: &str,
    ) -> Result<Option<CommandStatusProjection>, String> {
        if command_id.trim().is_empty() {
            return Err("messaging command status requires command ID".to_string());
        }
        self.connection()?
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

    pub fn mls_transition_command_conversation(
        &self,
        command_id: &str,
    ) -> Result<Option<String>, String> {
        if command_id.trim().is_empty() {
            return Err("messaging MLS transition lookup requires command ID".to_string());
        }
        let command = self
            .connection()?
            .query_row(
                "SELECT command_bytes
                 FROM messaging_local_commands
                 WHERE command_id = ?1",
                params![command_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(command) = command else {
            return Ok(None);
        };
        let command = ChatCommand::decode(command.as_slice())
            .map_err(|error| format!("decode messaging command for MLS cleanup: {error}"))?;
        if matches!(
            command.payload,
            Some(chat_command::Payload::MembershipTransition(_))
        ) {
            return Ok(Some(command.conversation_id));
        }
        Ok(None)
    }

    pub fn next_delivery_receipt(&self) -> Result<Option<DeliveryReceiptOutboxEntry>, String> {
        self.connection()?
            .query_row(
                "SELECT receipt_id, receipt_bytes
                 FROM messaging_receipt_outbox
                 WHERE state = 'pending'
                   AND receipt_id LIKE 'device-consumed:%'
                 ORDER BY created_at_unix_ms ASC, receipt_id ASC
                 LIMIT 1",
                [],
                |row| {
                    Ok(DeliveryReceiptOutboxEntry {
                        receipt_id: row.get(0)?,
                        receipt_bytes: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn mark_delivery_receipt_submitted(
        &self,
        receipt_id: &str,
        receipt_bytes: &[u8],
    ) -> Result<(), String> {
        let changed = self
            .connection()?
            .execute(
                "UPDATE messaging_receipt_outbox
                 SET state = 'submitted'
                 WHERE receipt_id = ?1
                   AND receipt_bytes = ?2
                   AND state = 'pending'",
                params![receipt_id, receipt_bytes],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("messaging delivery receipt transition mismatch".to_string());
        }
        Ok(())
    }

    pub fn mark_command_submitted(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        expected_attempt_count: u32,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let state = load_command_transition_state(&transaction, command_id, command_bytes)?;
        if state.local_state == "committed" && state.outbox_state == "committed" {
            return Ok(());
        }
        if state.attempt_count != expected_attempt_count
            || !matches!(state.local_state.as_str(), "prepared" | "submitted")
            || !matches!(
                state.outbox_state.as_str(),
                "pending" | "retry_wait" | "submitted"
            )
        {
            return Err("messaging command submission transition mismatch".to_string());
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
                params![command_id, i64::from(expected_attempt_count)],
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
                "UPDATE messaging_pending_messages AS p SET state = 'submitted'
                 WHERE EXISTS (
                    SELECT 1 FROM messaging_command_attempts a
                    WHERE a.command_id = ?1
                      AND a.conversation_id = p.conversation_id
                      AND a.message_id = p.message_id
                 )",
                params![command_id],
            )
            .map_err(|error| error.to_string())?;
        let interaction_changed = transaction
            .execute(
                "UPDATE messaging_interaction_intents SET state = 'submitted'
                 WHERE command_id = ?1 AND state IN ('prepared', 'submitted')",
                params![command_id],
            )
            .map_err(|error| error.to_string())?;
        if local_changed != 1
            || outbox_changed != 1
            || attempt_changed != 1
            || !pending_owner_transition_is_valid(
                &transaction,
                command_id,
                pending_changed,
                interaction_changed,
            )?
        {
            return Err("messaging command submission was not fenced".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn mark_command_retry(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        expected_attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        error_code: &str,
    ) -> Result<(), String> {
        if next_attempt_at_unix_ms <= 0 || error_code.trim().is_empty() {
            return Err("messaging command retry metadata is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let state = load_command_transition_state(&transaction, command_id, command_bytes)?;
        if state.attempt_count != expected_attempt_count
            || !matches!(state.local_state.as_str(), "prepared" | "submitted")
            || !matches!(state.outbox_state.as_str(), "pending" | "retry_wait")
        {
            return Err("messaging command retry transition mismatch".to_string());
        }
        let changed = transaction
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
                    i64::from(expected_attempt_count)
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("messaging command retry was not fenced".to_string());
        }
        let attempt_changed = transaction
            .execute(
                "UPDATE messaging_command_attempts SET state = 'retry_wait'
                 WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
                params![command_id],
            )
            .map_err(|error| error.to_string())?;
        let pending_changed = transaction
            .execute(
                "UPDATE messaging_pending_messages AS p SET state = 'retry_wait'
                 WHERE EXISTS (
                    SELECT 1 FROM messaging_command_attempts a
                    WHERE a.command_id = ?1
                      AND a.conversation_id = p.conversation_id
                      AND a.message_id = p.message_id
                 )",
                params![command_id],
            )
            .map_err(|error| error.to_string())?;
        let interaction_changed = transaction
            .execute(
                "UPDATE messaging_interaction_intents SET state = 'retry_wait'
                 WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
                params![command_id],
            )
            .map_err(|error| error.to_string())?;
        if attempt_changed != 1
            || !pending_owner_transition_is_valid(
                &transaction,
                command_id,
                pending_changed,
                interaction_changed,
            )?
        {
            return Err("messaging command retry projection was not fenced".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn mark_command_failed(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        expected_attempt_count: u32,
        error_code: &str,
    ) -> Result<(), String> {
        if error_code.trim().is_empty() {
            return Err("messaging command failure code is required".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let state = load_command_transition_state(&transaction, command_id, command_bytes)?;
        if state.attempt_count != expected_attempt_count
            || !matches!(state.local_state.as_str(), "prepared" | "submitted")
            || !matches!(state.outbox_state.as_str(), "pending" | "retry_wait")
        {
            return Err("messaging command failure transition mismatch".to_string());
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
                params![command_id, error_code, i64::from(expected_attempt_count)],
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
                "UPDATE messaging_pending_messages AS p SET state = 'failed'
                 WHERE EXISTS (
                    SELECT 1 FROM messaging_command_attempts a
                    WHERE a.command_id = ?1
                      AND a.conversation_id = p.conversation_id
                      AND a.message_id = p.message_id
                 )",
                params![command_id],
            )
            .map_err(|error| error.to_string())?;
        let interaction_changed = transaction
            .execute(
                "UPDATE messaging_interaction_intents SET state = 'failed'
                 WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
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
                &transaction,
                command_id,
                pending_changed,
                interaction_changed,
            )? || (pending_transition_deleted == 1 && membership_intent_changed <= 1))
        {
            return Err("messaging command failure was not fenced".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn mark_command_superseded(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        expected_attempt_count: u32,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let state = load_command_transition_state(&transaction, command_id, command_bytes)?;
        if state.attempt_count != expected_attempt_count
            || !matches!(state.local_state.as_str(), "prepared" | "submitted")
            || !matches!(state.outbox_state.as_str(), "pending" | "retry_wait")
        {
            return Err("messaging command supersede transition mismatch".to_string());
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
                params![command_id, i64::from(expected_attempt_count)],
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
                "UPDATE messaging_pending_messages AS p
                 SET state = 'draft', last_error_code = 'stale_delivery_plan'
                 WHERE EXISTS (
                    SELECT 1 FROM messaging_command_attempts a
                    WHERE a.command_id = ?1
                      AND a.conversation_id = p.conversation_id
                      AND a.message_id = p.message_id
                 )",
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
        let interaction_changed = transaction
            .execute(
                "UPDATE messaging_interaction_intents SET state = 'superseded'
                 WHERE command_id = ?1 AND state IN ('prepared', 'retry_wait')",
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
                &transaction,
                command_id,
                pending_changed,
                interaction_changed,
            )? || (pending_transition_deleted == 1 && membership_intent_changed <= 1))
        {
            return Err("messaging command supersede was not fenced".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn persist_claimed_item(
        &self,
        item_id: &str,
        event_id: &str,
        conversation_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
        payload: &[u8],
        claimed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if item_id.trim().is_empty()
            || event_id.trim().is_empty()
            || conversation_id.trim().is_empty()
            || lane_sequence <= 0
            || consumer_epoch == 0
            || payload_sha256.len() != 32
            || payload.is_empty()
        {
            return Err("messaging claimed item is incomplete".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "INSERT INTO messaging_inbox_items(
                    item_id, event_id, conversation_id, lane_sequence,
                    consumer_epoch, payload_sha256, payload, state, claimed_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'claimed', ?8)
                 ON CONFLICT(item_id) DO UPDATE SET
                    consumer_epoch=excluded.consumer_epoch,
                    state=CASE
                        WHEN messaging_inbox_items.state = 'consumed' THEN 'consumed'
                        ELSE 'claimed'
                    END,
                    claimed_at_unix_ms=excluded.claimed_at_unix_ms
                 WHERE messaging_inbox_items.event_id = excluded.event_id
                   AND messaging_inbox_items.conversation_id = excluded.conversation_id
                   AND messaging_inbox_items.lane_sequence = excluded.lane_sequence
                   AND messaging_inbox_items.payload_sha256 = excluded.payload_sha256",
                params![
                    item_id,
                    event_id,
                    conversation_id,
                    lane_sequence,
                    i64::try_from(consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?,
                    payload_sha256,
                    payload,
                    claimed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("messaging inbox replay payload hash mismatch".to_string());
        }
        Ok(())
    }

    pub fn consumption_marker_matches(
        &self,
        item_id: &str,
        payload_sha256: &[u8],
    ) -> Result<bool, String> {
        if item_id.trim().is_empty() || payload_sha256.len() != 32 {
            return Err("messaging consumption lookup is incomplete".to_string());
        }
        let existing = self
            .connection()?
            .query_row(
                "SELECT payload_sha256 FROM messaging_consumption_markers WHERE item_id = ?1",
                params![item_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        match existing {
            Some(existing) if existing == payload_sha256 => Ok(true),
            Some(_) => Err("messaging consumption marker payload hash mismatch".to_string()),
            None => Ok(false),
        }
    }

    pub fn save_direct_session(&self, session: &DirectSession) -> Result<(), String> {
        let connection = self.connection()?;
        upsert_direct_session(&connection, session)
    }

    pub fn load_direct_session(&self, session_id: &str) -> Result<Option<DirectSession>, String> {
        let connection = self.connection()?;
        load_direct_session(&connection, session_id)
    }

    pub fn load_direct_session_bootstrap(
        &self,
        session_id: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT init_bytes FROM direct_session_bootstraps WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn load_direct_sessions_for_peers(
        &self,
        conversation_id: &str,
        peers: &[CryptoEndpoint],
    ) -> Result<Vec<DirectSession>, String> {
        if conversation_id.trim().is_empty() || peers.is_empty() {
            return Err("messaging Direct peer resolution is incomplete".to_string());
        }
        let connection = self.connection()?;
        let mut sessions = Vec::with_capacity(peers.len());
        let mut seen = HashSet::with_capacity(peers.len());
        for peer in peers {
            peer.validate().map_err(|error| error.to_string())?;
            if !seen.insert((peer.ptid.as_str(), peer.device_id.as_str())) {
                return Err("messaging Direct peer resolution contains duplicates".to_string());
            }
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
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    format!(
                        "messaging Direct session unavailable for endpoint ({}, {})",
                        peer.ptid, peer.device_id
                    )
                })?;
            sessions.push(
                load_direct_session(&connection, &session_id)?
                    .ok_or_else(|| "messaging Direct session disappeared".to_string())?,
            );
        }
        Ok(sessions)
    }

    pub fn has_established_direct_session(
        &self,
        conversation_id: &str,
        peer: &CryptoEndpoint,
    ) -> Result<bool, String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging Direct conversation ID is required".to_string());
        }
        peer.validate().map_err(|error| error.to_string())?;
        self.connection()?
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM direct_sessions
                    WHERE conversation_id = ?1
                      AND peer_ptid = ?2
                      AND peer_device_id = ?3
                      AND established = 1
                 )",
                params![conversation_id, peer.ptid, peer.device_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())
    }

    pub fn next_direct_session_generation(
        &self,
        conversation_id: &str,
        peer: &CryptoEndpoint,
    ) -> Result<u64, String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging Direct conversation ID is required".to_string());
        }
        peer.validate().map_err(|error| error.to_string())?;
        let generation = self
            .connection()?
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
            .map_err(|_| "messaging Direct session generation is invalid".to_string())
    }

    pub fn load_direct_skipped_keys(
        &self,
        session_id: &str,
    ) -> Result<Vec<DrSkippedMessageKey>, String> {
        if session_id.trim().is_empty() {
            return Err("messaging direct session ID is required".to_string());
        }
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT peer_ratchet_public_key, counter, message_key
                 FROM direct_skipped_message_keys
                 WHERE session_id = ?1
                 ORDER BY counter ASC, peer_ratchet_public_key ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![session_id], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.map(|row| {
            let (peer_public, counter, message_key) = row.map_err(|error| error.to_string())?;
            Ok(DrSkippedMessageKey {
                session_id: session_id.to_string(),
                peer_pub: fixed_key("peer ratchet public key", peer_public)?,
                counter: u32::try_from(counter).map_err(|_| "invalid skipped key counter")?,
                message_key: fixed_key("skipped message key", message_key)?,
            })
        })
        .collect()
    }

    pub fn lane_checkpoint(&self) -> Result<(i64, u64), String> {
        let checkpoint = self
            .connection()?
            .query_row(
                "SELECT lane_sequence, consumer_epoch FROM messaging_lane_cursor WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        checkpoint
            .map(|(sequence, epoch)| {
                Ok((
                    sequence,
                    u64::try_from(epoch).map_err(|_| "invalid persisted consumer epoch")?,
                ))
            })
            .unwrap_or(Ok((0, 0)))
    }

    pub fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging authority conversation ID is required".to_string());
        }
        self.connection()?
            .query_row(
                "SELECT event_sequence, event_hash
                 FROM messaging_authority_heads
                 WHERE conversation_id = ?1",
                params![conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())
            .map(|value| value.unwrap_or((0, Vec::new())))
    }

    pub fn message_projection(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<Option<(MessageProjection, String)>, String> {
        if conversation_id.trim().is_empty() || message_id.trim().is_empty() {
            return Err("messaging projection identity is required".to_string());
        }
        let connection = self.connection()?;
        let projection = connection
            .query_row(
                "SELECT event_id, event_sequence, sender_ptid, sender_device_id,
                        plaintext, delivery_state, committed_at_unix_ms,
                        reply_to_message_id, thread_root_message_id,
                        edited_text, edited_at_unix_ms, retracted
                 FROM messaging_message_projections
                 WHERE conversation_id = ?1 AND message_id = ?2",
                params![conversation_id, message_id],
                |row| {
                    let delivery_state = row.get::<_, String>(5)?;
                    Ok((
                        MessageProjection {
                            conversation_id: conversation_id.to_string(),
                            event_id: row.get(0)?,
                            event_sequence: row.get(1)?,
                            message_id: message_id.to_string(),
                            sender_ptid: row.get(2)?,
                            sender_device_id: row.get(3)?,
                            plaintext: row.get(4)?,
                            attachments: Vec::new(),
                            committed_at_unix_ms: row.get(6)?,
                            reply_to_message_id: row.get(7)?,
                            thread_root_message_id: row.get(8)?,
                            edited_text: row.get(9)?,
                            edited_at_unix_ms: row.get(10)?,
                            retracted: row.get::<_, i64>(11).unwrap_or(0) != 0,
                        },
                        delivery_state,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((mut projection, delivery_state)) = projection else {
            return Ok(None);
        };
        let mut statement = connection
            .prepare(
                "SELECT attachment_id, filename, mime_type, plaintext_size,
                        plaintext_sha256, object_key, base_nonce, descriptor_bytes
                 FROM messaging_attachment_projections
                 WHERE message_id = ?1
                 ORDER BY attachment_id",
            )
            .map_err(|error| error.to_string())?;
        projection.attachments = statement
            .query_map(params![message_id], |row| {
                let descriptor_bytes = row.get::<_, Vec<u8>>(7)?;
                let object = crate::model::chat::EncryptedObjectDescriptor::decode(
                    descriptor_bytes.as_slice(),
                )
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
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(Some((projection, delivery_state)))
    }

    #[cfg(test)]
    pub(crate) fn insert_test_message_projection(
        &self,
        conversation_id: &str,
        message_id: &str,
        delivery_state: &str,
    ) -> Result<(), String> {
        self.connection()?
            .execute(
                "INSERT INTO messaging_message_projections(
                    conversation_id, event_id, event_sequence, message_id,
                    sender_ptid, sender_device_id, plaintext,
                    delivery_state, committed_at_unix_ms
                 ) VALUES (?1, ?2, 1, ?3, 'ptid:alice', 'alice-device', 'hello', ?4, 100)",
                params![
                    conversation_id,
                    format!("event:{message_id}"),
                    message_id,
                    delivery_state
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn commit_delivery_receipt(
        &self,
        input: &DeliveryReceiptReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        let target_rank = match input.delivery_state {
            "delivered" => 1,
            "read" => 2,
            _ => return Err("messaging delivery state is invalid".to_string()),
        };
        if input.item_id.trim().is_empty()
            || input.message_id.trim().is_empty()
            || input.conversation_id.trim().is_empty()
            || input.lane_sequence <= 0
            || input.consumer_epoch == 0
            || input.payload_sha256.len() != 32
            || input.consumed_at_unix_ms <= 0
        {
            return Err("messaging delivery receipt commit is incomplete".to_string());
        }

        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let existing_hash = transaction
            .query_row(
                "SELECT payload_sha256 FROM messaging_consumption_markers WHERE item_id = ?1",
                params![input.item_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(existing_hash) = existing_hash {
            if existing_hash == input.payload_sha256 {
                return Ok(ReceiveCommitResult::AlreadyCommitted);
            }
            return Err("messaging consumption marker payload hash mismatch".to_string());
        }

        let claimed = transaction
            .query_row(
                "SELECT event_id, conversation_id, lane_sequence, consumer_epoch, payload_sha256
                 FROM messaging_inbox_items WHERE item_id = ?1 AND state = 'claimed'",
                params![input.item_id],
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
            .ok_or_else(|| "messaging claimed inbox item is unavailable".to_string())?;
        if claimed.0 != input.message_id
            || claimed.1 != input.conversation_id
            || claimed.2 != input.lane_sequence
            || claimed.3
                != i64::try_from(input.consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?
            || claimed.4 != input.payload_sha256
        {
            return Err("messaging claimed inbox item binding mismatch".to_string());
        }

        let cursor = transaction
            .query_row(
                "SELECT lane_sequence, consumer_epoch FROM messaging_lane_cursor WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let expected_sequence = cursor.map(|value| value.0 + 1).unwrap_or(1);
        if input.lane_sequence != expected_sequence
            || cursor
                .map(|value| i64::try_from(input.consumer_epoch).unwrap_or(i64::MAX) < value.1)
                .unwrap_or(false)
        {
            return Err("messaging receive is not the next fenced lane item".to_string());
        }

        let changed = transaction
            .execute(
                "UPDATE messaging_message_projections
                 SET delivery_state = ?1
                 WHERE conversation_id = ?2
                   AND message_id = ?3
                   AND CASE delivery_state
                         WHEN 'read' THEN 2
                         WHEN 'delivered' THEN 1
                         ELSE 0
                       END < ?4",
                params![
                    input.delivery_state,
                    input.conversation_id,
                    input.message_id,
                    target_rank
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            let exists = transaction
                .query_row(
                    "SELECT 1
                     FROM messaging_message_projections
                     WHERE conversation_id = ?1 AND message_id = ?2",
                    params![input.conversation_id, input.message_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .is_some();
            if !exists {
                return Err("messaging delivery receipt references an unknown message".to_string());
            }
        }

        transaction
            .execute(
                "INSERT INTO messaging_consumption_markers(
                    item_id, event_id, conversation_id, payload_sha256, consumed_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    input.item_id,
                    input.message_id,
                    input.conversation_id,
                    input.payload_sha256,
                    input.consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_lane_cursor(id, lane_sequence, consumer_epoch, updated_at_unix_ms)
                 VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET
                    lane_sequence=excluded.lane_sequence,
                    consumer_epoch=excluded.consumer_epoch,
                    updated_at_unix_ms=excluded.updated_at_unix_ms",
                params![
                    input.lane_sequence,
                    i64::try_from(input.consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?,
                    input.consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        let consumed = transaction
            .execute(
                "UPDATE messaging_inbox_items SET state = 'consumed'
                 WHERE item_id = ?1 AND state = 'claimed'",
                params![input.item_id],
            )
            .map_err(|error| error.to_string())?;
        if consumed != 1 {
            return Err("messaging delivery receipt inbox transition mismatch".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(ReceiveCommitResult::Committed)
    }

    pub fn commit_actor_read_cursor(
        &self,
        input: &ActorReadReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        if input.item_id.trim().is_empty()
            || input.event_id.trim().is_empty()
            || input.conversation_id.trim().is_empty()
            || input.reader_ptid.trim().is_empty()
            || input.last_read_sequence <= 0
            || input.lane_sequence <= 0
            || input.consumer_epoch == 0
            || input.payload_sha256.len() != 32
            || input.consumed_at_unix_ms <= 0
        {
            return Err("messaging actor read commit is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let existing_hash = transaction
            .query_row(
                "SELECT payload_sha256 FROM messaging_consumption_markers WHERE item_id = ?1",
                params![input.item_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(existing_hash) = existing_hash {
            if existing_hash == input.payload_sha256 {
                return Ok(ReceiveCommitResult::AlreadyCommitted);
            }
            return Err("messaging consumption marker payload hash mismatch".to_string());
        }
        let claimed = transaction
            .query_row(
                "SELECT event_id, conversation_id, lane_sequence, consumer_epoch, payload_sha256
                 FROM messaging_inbox_items WHERE item_id = ?1 AND state = 'claimed'",
                params![input.item_id],
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
            .ok_or_else(|| "messaging claimed inbox item is unavailable".to_string())?;
        if claimed.0 != input.event_id
            || claimed.1 != input.conversation_id
            || claimed.2 != input.lane_sequence
            || claimed.3
                != i64::try_from(input.consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?
            || claimed.4 != input.payload_sha256
        {
            return Err("messaging claimed inbox item binding mismatch".to_string());
        }
        let cursor = transaction
            .query_row(
                "SELECT lane_sequence, consumer_epoch FROM messaging_lane_cursor WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let expected_sequence = cursor.map(|value| value.0 + 1).unwrap_or(1);
        if input.lane_sequence != expected_sequence
            || cursor
                .map(|value| i64::try_from(input.consumer_epoch).unwrap_or(i64::MAX) < value.1)
                .unwrap_or(false)
        {
            return Err("messaging receive is not the next fenced lane item".to_string());
        }
        transaction
            .execute(
                "INSERT INTO read_cursors(
                    conversation_id, actor_ptid, last_read_sequence, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(conversation_id, actor_ptid) DO UPDATE SET
                    last_read_sequence = MAX(
                        read_cursors.last_read_sequence,
                        excluded.last_read_sequence
                    ),
                    updated_at_unix_ms = CASE
                        WHEN excluded.last_read_sequence > read_cursors.last_read_sequence
                        THEN excluded.updated_at_unix_ms
                        ELSE read_cursors.updated_at_unix_ms
                    END",
                params![
                    input.conversation_id,
                    input.reader_ptid,
                    input.last_read_sequence,
                    input.consumed_at_unix_ms
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
                    input.conversation_id,
                    input.last_read_sequence,
                    input.reader_ptid
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_consumption_markers(
                    item_id, event_id, conversation_id, payload_sha256, consumed_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    input.item_id,
                    input.event_id,
                    input.conversation_id,
                    input.payload_sha256,
                    input.consumed_at_unix_ms
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
                params![
                    input.lane_sequence,
                    i64::try_from(input.consumer_epoch)
                        .map_err(|_| "consumer epoch exceeds i64")?,
                    input.consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        let consumed = transaction
            .execute(
                "UPDATE messaging_inbox_items SET state = 'consumed'
                 WHERE item_id = ?1 AND state = 'claimed'",
                params![input.item_id],
            )
            .map_err(|error| error.to_string())?;
        if consumed != 1 {
            return Err("messaging actor read inbox transition mismatch".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(ReceiveCommitResult::Committed)
    }

    pub fn conversation_message_projections(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging projection conversation ID is required".to_string());
        }
        let connection = self.connection()?;
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
        let mut rows = statement
            .query_map(params![conversation_id], |row| {
                Ok(ConversationMessageProjection {
                    event_id: row.get(0)?,
                    event_sequence: row.get(1)?,
                    message_id: row.get(2)?,
                    sender_ptid: row.get(3)?,
                    sender_device_id: row.get(4)?,
                    plaintext: row.get(5)?,
                    attachments: Vec::new(),
                    state: row.get(6)?,
                    timestamp_unix_ms: row.get(7)?,
                    reply_to_message_id: row.get(8)?,
                    thread_root_message_id: row.get(9)?,
                    edited_text: row.get(10)?,
                    edited_at_unix_ms: row.get(11)?,
                    retracted: row.get::<_, i64>(12).unwrap_or(0) != 0,
                    reactions: Vec::new(),
                    pinned_by_ptid: None,
                    pinned_at_unix_ms: None,
                    read_by_ptids: Vec::new(),
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let pins = load_pins_for_conversation(&connection, conversation_id)?;
        for row in &mut rows {
            row.attachments = load_visible_message_attachments(&connection, &row.message_id)?;
            row.reactions = load_reactions_for_message(&connection, &row.message_id)?;
            row.read_by_ptids = load_readers_for_message(
                &connection,
                conversation_id,
                row.event_sequence,
                &row.sender_ptid,
            )?;
            if let Some((_, actor_ptid, pinned_at_unix_ms)) = pins
                .iter()
                .find(|(message_id, _, _)| message_id == &row.message_id)
            {
                row.pinned_by_ptid = Some(actor_ptid.clone());
                row.pinned_at_unix_ms = Some(*pinned_at_unix_ms);
            }
        }
        Ok(rows)
    }

    pub fn thread_message_projections(
        &self,
        conversation_id: &str,
        thread_root_message_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        if conversation_id.trim().is_empty() || thread_root_message_id.trim().is_empty() {
            return Err("messaging thread projection identity is required".to_string());
        }
        let connection = self.connection()?;
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
        let mut rows = statement
            .query_map(params![conversation_id, thread_root_message_id], |row| {
                Ok(ConversationMessageProjection {
                    event_id: row.get(0)?,
                    event_sequence: row.get(1)?,
                    message_id: row.get(2)?,
                    sender_ptid: row.get(3)?,
                    sender_device_id: row.get(4)?,
                    plaintext: row.get(5)?,
                    attachments: Vec::new(),
                    state: row.get(6)?,
                    timestamp_unix_ms: row.get(7)?,
                    reply_to_message_id: row.get(8)?,
                    thread_root_message_id: row.get(9)?,
                    edited_text: row.get(10)?,
                    edited_at_unix_ms: row.get(11)?,
                    retracted: row.get::<_, i64>(12).unwrap_or(0) != 0,
                    reactions: Vec::new(),
                    pinned_by_ptid: None,
                    pinned_at_unix_ms: None,
                    read_by_ptids: Vec::new(),
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let pins = load_pins_for_conversation(&connection, conversation_id)?;
        for row in &mut rows {
            row.attachments = load_visible_message_attachments(&connection, &row.message_id)?;
            row.reactions = load_reactions_for_message(&connection, &row.message_id)?;
            row.read_by_ptids = load_readers_for_message(
                &connection,
                conversation_id,
                row.event_sequence,
                &row.sender_ptid,
            )?;
            if let Some((_, actor_ptid, pinned_at_unix_ms)) = pins
                .iter()
                .find(|(message_id, _, _)| message_id == &row.message_id)
            {
                row.pinned_by_ptid = Some(actor_ptid.clone());
                row.pinned_at_unix_ms = Some(*pinned_at_unix_ms);
            }
        }
        Ok(rows)
    }

    pub fn thread_count_projections(
        &self,
        conversation_id: &str,
        root_message_ids: &[String],
        actor_ptid: &str,
    ) -> Result<Vec<ThreadCountProjection>, String> {
        if conversation_id.trim().is_empty() || actor_ptid.trim().is_empty() {
            return Err("messaging thread count scope is required".to_string());
        }
        let connection = self.connection()?;
        let read_cursor = connection
            .query_row(
                "SELECT last_read_sequence FROM read_cursors
                 WHERE conversation_id = ?1 AND actor_ptid = ?2",
                params![conversation_id, actor_ptid],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or(0);
        let mut statement = connection
            .prepare(
                "WITH thread_replies AS (
                    SELECT message_id, sender_ptid, event_sequence,
                           committed_at_unix_ms, 0 AS pending_rank
                    FROM messaging_message_projections
                    WHERE conversation_id = ?1
                      AND thread_root_message_id = ?2
                    UNION ALL
                    SELECT pending.message_id, pending.sender_ptid, NULL,
                           pending.created_at_unix_ms, 1
                    FROM messaging_pending_messages pending
                    WHERE pending.conversation_id = ?1
                      AND pending.thread_root_message_id = ?2
                      AND NOT EXISTS (
                          SELECT 1 FROM messaging_message_projections committed
                          WHERE committed.conversation_id = pending.conversation_id
                            AND committed.message_id = pending.message_id
                      )
                 )
                 SELECT message_id, sender_ptid, event_sequence,
                        committed_at_unix_ms
                 FROM thread_replies
                 ORDER BY pending_rank ASC,
                          event_sequence ASC,
                          committed_at_unix_ms ASC,
                          message_id ASC",
            )
            .map_err(|error| error.to_string())?;
        let mut seen = HashSet::new();
        let mut counts = Vec::with_capacity(root_message_ids.len());
        for root_message_id in root_message_ids {
            let root_message_id = root_message_id.trim();
            if root_message_id.is_empty() || !seen.insert(root_message_id.to_string()) {
                continue;
            }
            let replies = statement
                .query_map(params![conversation_id, root_message_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            let unread_count = replies
                .iter()
                .filter(|(_, sender_ptid, event_sequence, _)| {
                    sender_ptid != actor_ptid
                        && event_sequence
                            .map(|sequence| sequence > read_cursor)
                            .unwrap_or(false)
                })
                .count() as i64;
            let (latest_reply_id, latest_reply_at_unix_ms) = replies
                .last()
                .map(|(message_id, _, _, timestamp)| (message_id.clone(), *timestamp))
                .unwrap_or_default();
            counts.push(ThreadCountProjection {
                root_message_id: root_message_id.to_string(),
                reply_count: replies.len() as i64,
                latest_reply_id,
                latest_reply_at_unix_ms,
                unread_count,
            });
        }
        Ok(counts)
    }

    pub fn search_message_projections(
        &self,
        conversation_id: &str,
        query: &str,
        before: Option<(i64, &str)>,
        limit: usize,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        if conversation_id.trim().is_empty()
            || query.trim().is_empty()
            || limit == 0
            || limit > 100
            || before.is_some_and(|(timestamp, message_id)| {
                timestamp <= 0 || message_id.trim().is_empty()
            })
        {
            return Err("messaging search input is invalid".to_string());
        }
        let search_query = fts_phrase_query(query)?;
        let (before_timestamp, before_message_id) = before.unwrap_or((i64::MAX, "\u{10ffff}"));
        let connection = self.connection()?;
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
        let mut rows = statement
            .query_map(
                params![
                    search_query,
                    conversation_id,
                    before_timestamp,
                    before_message_id,
                    i64::try_from(limit).map_err(|_| "messaging search limit exceeds i64")?
                ],
                |row| {
                    Ok(ConversationMessageProjection {
                        event_id: Some(row.get(0)?),
                        event_sequence: Some(row.get(1)?),
                        message_id: row.get(2)?,
                        sender_ptid: row.get(3)?,
                        sender_device_id: row.get(4)?,
                        plaintext: row.get(5)?,
                        attachments: Vec::new(),
                        state: row.get(6)?,
                        timestamp_unix_ms: row.get(7)?,
                        reply_to_message_id: row.get(8)?,
                        thread_root_message_id: row.get(9)?,
                        edited_text: row.get(10)?,
                        edited_at_unix_ms: row.get(11)?,
                        retracted: row.get::<_, i64>(12).unwrap_or(0) != 0,
                        reactions: Vec::new(),
                        pinned_by_ptid: None,
                        pinned_at_unix_ms: None,
                        read_by_ptids: Vec::new(),
                    })
                },
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let pins = load_pins_for_conversation(&connection, conversation_id)?;
        for row in &mut rows {
            row.attachments = load_attachment_metadata(&connection, &row.message_id)?;
            row.reactions = load_reactions_for_message(&connection, &row.message_id)?;
            row.read_by_ptids = load_readers_for_message(
                &connection,
                conversation_id,
                row.event_sequence,
                &row.sender_ptid,
            )?;
            if let Some((_, actor_ptid, pinned_at_unix_ms)) = pins
                .iter()
                .find(|(message_id, _, _)| message_id == &row.message_id)
            {
                row.pinned_by_ptid = Some(actor_ptid.clone());
                row.pinned_at_unix_ms = Some(*pinned_at_unix_ms);
            }
        }
        Ok(rows)
    }

    pub fn conversation_projections(&self) -> Result<Vec<ConversationProjection>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, authority_station_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                 FROM messaging_conversations
                 WHERE active = 1
                 ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, bool>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows.into_iter()
            .map(
                |(
                    conversation_id,
                    authority_station_id,
                    kind,
                    name,
                    owner_ptid,
                    membership_epoch,
                    mls_epoch,
                    active,
                    updated_at_unix_ms,
                )| {
                    let mut members_statement = connection
                        .prepare(
                            "SELECT ptid, role FROM messaging_conversation_members
                             WHERE conversation_id = ?1 AND active = 1
                             ORDER BY ptid",
                        )
                        .map_err(|error| error.to_string())?;
                    let members = members_statement
                        .query_map(params![conversation_id], |row| {
                            Ok(ConversationMemberProjection {
                                ptid: row.get::<_, String>(0)?,
                                role: row.get::<_, i32>(1)?,
                            })
                        })
                        .map_err(|error| error.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|error| error.to_string())?;
                    Ok(ConversationProjection {
                        conversation_id,
                        authority_station_id,
                        kind,
                        name,
                        owner_ptid,
                        members,
                        membership_epoch,
                        mls_epoch,
                        active,
                        updated_at_unix_ms,
                    })
                },
            )
            .collect()
    }

    pub fn conversation_authority_station_id(
        &self,
        conversation_id: &str,
    ) -> Result<String, String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging conversation authority lookup requires ID".to_string());
        }
        let authority_station_id = self
            .connection()?
            .query_row(
                "SELECT authority_station_id
                 FROM messaging_conversations
                 WHERE conversation_id = ?1 AND active = 1",
                params![conversation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "messaging conversation projection is unavailable".to_string())?;
        if authority_station_id.trim().is_empty() {
            return Err("messaging conversation authority Station is unavailable".to_string());
        }
        Ok(authority_station_id)
    }

    pub fn bootstrap_conversation_projection(
        &self,
        projection: &super::ConversationProjection,
    ) -> Result<bool, String> {
        let changed = self
            .connection()?
            .execute(
                "INSERT INTO messaging_conversations(
                    conversation_id, authority_station_id, kind, name, owner_ptid,
                    membership_epoch, mls_epoch, active, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)
                 ON CONFLICT(conversation_id) DO NOTHING",
                params![
                    projection.conversation_id,
                    projection.authority_station_id,
                    projection.kind,
                    projection.name,
                    projection.owner_ptid,
                    projection.membership_epoch,
                    projection.mls_epoch,
                    projection.updated_at_unix_ms,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            let connection = self.connection()?;
            for member in &projection.members {
                connection
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, role, active
                         ) VALUES (?1, ?2, ?3, 1)
                         ON CONFLICT(conversation_id, ptid) DO UPDATE SET
                            role=excluded.role,
                            active=1",
                        params![projection.conversation_id, member.ptid, member.role],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(changed == 1)
    }

    #[cfg(test)]
    pub fn install_test_conversation_projection(
        &self,
        conversation_id: &str,
        membership_epoch: i64,
        mls_epoch: i64,
    ) -> Result<(), String> {
        self.connection()?
            .execute(
                "INSERT INTO messaging_conversations(
                    conversation_id, authority_station_id, kind, name, owner_ptid,
                    membership_epoch, mls_epoch, active, updated_at_unix_ms
                 ) VALUES (?1, 'station-local', 2, 'test group', 'ptid:alice', ?2, ?3, 1, 1)",
                params![conversation_id, membership_epoch, mls_epoch],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(test)]
    pub fn install_test_authority_head(
        &self,
        conversation_id: &str,
        event_sequence: i64,
        event_hash: &[u8],
    ) -> Result<(), String> {
        self.connection()?
            .execute(
                "INSERT INTO messaging_authority_heads(
                    conversation_id, event_sequence, event_hash, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, 1)",
                params![conversation_id, event_sequence, event_hash],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn create_message_draft(&self, draft: &PendingMessageDraft) -> Result<(), String> {
        let private_content = super::private_content::encode_message_private_content(
            &draft.plaintext,
            &draft.attachments,
        )?;
        if draft.conversation_id.trim().is_empty()
            || draft.conversation_kind <= 0
            || draft.message_id.trim().is_empty()
            || draft.sender_ptid.trim().is_empty()
            || draft.sender_device_id.trim().is_empty()
            || draft.created_at_unix_ms <= 0
        {
            return Err("messaging draft intent is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
            return Err("messaging draft identity already exists".to_string());
        }
        persist_sender_content(
            &transaction,
            &draft.conversation_id,
            &draft.message_id,
            &draft.plaintext,
            &draft.attachments,
            &private_content,
        )?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn create_message_draft_with_uploads(
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
            return Err("messaging attachment draft intent is incomplete".to_string());
        }
        let mut previous_attachment_id: Option<&str> = None;
        for upload in uploads {
            validate_attachment_transfer(&upload.transfer)?;
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
                return Err("messaging staged attachment is invalid".to_string());
            }
            previous_attachment_id = Some(upload.transfer.attachment_id.as_str());
        }

        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
            return Err("messaging draft identity already exists".to_string());
        }
        for upload in uploads {
            let transfer = &upload.transfer;
            let generation =
                i64::try_from(transfer.generation).map_err(|_| "attachment generation overflow")?;
            let plaintext_size = i64::try_from(transfer.plaintext_size)
                .map_err(|_| "attachment plaintext size overflow")?;
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
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[AttachmentPlaintextMetadata],
    ) -> Result<(), String> {
        for attachment in attachments {
            super::private_content::validate_attachment_plaintext_metadata(attachment)?;
            let object = attachment
                .object
                .as_ref()
                .ok_or_else(|| "messaging attachment descriptor is missing".to_string())?;
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
                    "messaging attachment is not durably complete for send".to_string()
                })?;
            let descriptor_commitment = super::attachment_transfer::upload_commitment_fields(
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
                return Err("messaging attachment is not durably complete for send".to_string());
            }
        }
        Ok(())
    }

    pub fn create_attachment_transfer(
        &self,
        transfer: &AttachmentTransferRecord,
    ) -> Result<bool, String> {
        validate_attachment_transfer(transfer)?;
        let generation =
            i64::try_from(transfer.generation).map_err(|_| "attachment generation overflow")?;
        let plaintext_size = i64::try_from(transfer.plaintext_size)
            .map_err(|_| "attachment plaintext size overflow")?;
        let changed = self
            .connection()?
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
            .ok_or_else(|| "messaging attachment transfer conflict is unavailable".to_string())?;
        if existing != *transfer {
            return Err("messaging attachment transfer identity conflict".to_string());
        }
        Ok(false)
    }

    pub fn replace_completed_upload_with_download(
        &self,
        download: &AttachmentTransferRecord,
    ) -> Result<(), String> {
        validate_attachment_transfer(download)?;
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
            return Err("messaging attachment download replacement is invalid".to_string());
        }
        let plaintext_size = i64::try_from(download.plaintext_size)
            .map_err(|_| "attachment plaintext size overflow")?;
        let changed = self
            .connection()?
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
            return Err("messaging completed upload could not become a download".to_string());
        }
        Ok(())
    }

    pub fn attachment_transfer(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentTransferRecord>, String> {
        if attachment_id.trim().is_empty() {
            return Err("messaging attachment ID is required".to_string());
        }
        self.connection()?
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

    pub fn attachment_download_projection(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentDownloadProjection>, String> {
        if attachment_id.trim().is_empty() {
            return Err("messaging attachment ID is required".to_string());
        }
        let projection = self
            .connection()?
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
            super::private_content::validate_attachment_plaintext_metadata(&projection.metadata)?;
            if projection.conversation_id.trim().is_empty()
                || projection.message_id.trim().is_empty()
                || projection.authority_station_id.trim().is_empty()
            {
                return Err("messaging attachment download projection is incomplete".to_string());
            }
        }
        Ok(projection)
    }

    pub fn completed_sender_attachment_source(
        &self,
        attachment_id: &str,
    ) -> Result<Option<CompletedSenderAttachmentSource>, String> {
        if attachment_id.trim().is_empty() {
            return Err("messaging attachment ID is required".to_string());
        }
        let source = self
            .connection()?
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
            return Err("messaging completed sender attachment source is incomplete".to_string());
        }
        Ok(source)
    }

    pub fn owns_attachment_source(&self, source_local_ref: &str) -> Result<bool, String> {
        if source_local_ref.trim().is_empty() {
            return Err("messaging attachment source is required".to_string());
        }
        self.connection()?
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

    pub fn attachment_upload_media_type(&self, attachment_id: &str) -> Result<String, String> {
        if attachment_id.trim().is_empty() {
            return Err("messaging attachment ID is required".to_string());
        }
        let media_type = self
            .connection()?
            .query_row(
                "SELECT mime_type FROM messaging_attachment_drafts
                 WHERE attachment_id = ?1",
                params![attachment_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(media_type) = media_type {
            return Ok(media_type);
        }
        Ok("application/octet-stream".to_string())
    }

    pub fn next_due_attachment_upload(&self, now_unix_ms: i64) -> Result<Option<String>, String> {
        if now_unix_ms <= 0 {
            return Err("messaging attachment retry time is invalid".to_string());
        }
        self.connection()?
            .query_row(
                "SELECT attachment_id
                 FROM messaging_attachment_transfers
                 WHERE direction = 1
                   AND state IN (?1, ?2, ?3)
                   AND next_attempt_at_unix_ms <= ?4
                 ORDER BY next_attempt_at_unix_ms ASC, updated_at_unix_ms ASC, attachment_id ASC
                 LIMIT 1",
                params![
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

    pub fn next_due_attachment_download(&self, now_unix_ms: i64) -> Result<Option<String>, String> {
        if now_unix_ms <= 0 {
            return Err("messaging attachment retry time is invalid".to_string());
        }
        self.connection()?
            .query_row(
                "SELECT attachment_id
                 FROM messaging_attachment_transfers
                 WHERE direction = 2
                   AND state IN (?1, ?2, ?3)
                   AND next_attempt_at_unix_ms <= ?4
                 ORDER BY next_attempt_at_unix_ms ASC, updated_at_unix_ms ASC, attachment_id ASC
                 LIMIT 1",
                params![
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

    pub fn completed_attachment_sources(
        &self,
    ) -> Result<Vec<CompletedSenderAttachmentSource>, String> {
        let connection = self.connection()?;
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
            return Err("messaging completed sender attachment source is incomplete".to_string());
        }
        Ok(rows)
    }

    pub fn promote_completed_upload_cache(
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
            return Err("messaging sender cache promotion is incomplete".to_string());
        }
        let changed = self
            .connection()?
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
            return Err("messaging sender cache promotion was not fenced".to_string());
        }
        Ok(())
    }

    pub fn clear_completed_attachment_source(
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
            return Err("messaging attachment source cleanup is incomplete".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "UPDATE messaging_attachment_transfers
                 SET source_local_ref = ''
                 WHERE attachment_id = ?1
                   AND direction = 1
                   AND state = ?2
                   AND source_local_ref = ?3
                   AND NOT EXISTS (
                       SELECT 1 FROM messaging_pending_messages pending
                       WHERE pending.conversation_id = messaging_attachment_transfers.conversation_id
                         AND pending.message_id = messaging_attachment_transfers.message_id
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
            return Err("messaging attachment source cleanup was not fenced".to_string());
        }
        Ok(())
    }

    pub fn reconcile_completed_attachment_uploads(&self) -> Result<usize, String> {
        self.connection()?
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

    pub fn complete_attachment_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        super::attachment::validate_encrypted_object_descriptor(descriptor)?;
        validate_attachment_transfer(transfer)?;
        if updated_at_unix_ms <= 0 {
            return Err("messaging attachment completion time is invalid".to_string());
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
        let expected_commitment = super::attachment_transfer::upload_commitment_fields(
            &transfer.conversation_id,
            &transfer.message_id,
            &transfer.attachment_id,
            &transfer.authority_station_id,
            &upload_spec,
        );
        if transfer.descriptor_sha256 != expected_commitment {
            return Err("messaging attachment completion descriptor mismatch".to_string());
        }
        let generation =
            i64::try_from(transfer.generation).map_err(|_| "attachment generation overflow")?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
            return Err("messaging attachment completion media type mismatch".to_string());
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
            return Err("messaging attachment completion was not fenced".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn complete_attachment_download(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        super::attachment::validate_encrypted_object_descriptor(descriptor)?;
        validate_attachment_transfer(transfer)?;
        if transfer.direction != 2
            || cache_path.trim().is_empty()
            || updated_at_unix_ms <= 0
            || transfer.completed_chunk_bitmap.len() != descriptor.chunk_count.div_ceil(8) as usize
            || !(0..descriptor.chunk_count).all(|chunk_index| {
                transfer.completed_chunk_bitmap[chunk_index as usize / 8] & (1 << (chunk_index % 8))
                    != 0
            })
        {
            return Err("messaging attachment download completion is incomplete".to_string());
        }
        let descriptor_bytes = descriptor.encode_to_vec();
        let descriptor_sha256: [u8; 32] = Sha256::digest(&descriptor_bytes).into();
        if transfer.descriptor_sha256 != descriptor_sha256 {
            return Err("messaging attachment download descriptor mismatch".to_string());
        }
        let generation =
            i64::try_from(transfer.generation).map_err(|_| "attachment generation overflow")?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
            return Err("messaging attachment download completion was not fenced".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn update_attachment_transfer_progress(
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
            || updated_at_unix_ms <= 0
        {
            return Err("messaging attachment progress is incomplete".to_string());
        }
        let generation = i64::try_from(generation).map_err(|_| "attachment generation overflow")?;
        let changed = self
            .connection()?
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
            return Err("messaging attachment progress target is unavailable".to_string());
        }
        Ok(())
    }

    pub fn update_attachment_transfer_prepared(
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
            return Err("messaging attachment preparation is incomplete".to_string());
        }
        let changed = self
            .connection()?
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
            return Err("messaging attachment descriptor commitment changed".to_string());
        }
        Ok(())
    }

    pub fn next_due_message_draft(
        &self,
        now_unix_ms: i64,
    ) -> Result<Option<PendingMessageDraft>, String> {
        if now_unix_ms <= 0 {
            return Err("messaging draft retry time is invalid".to_string());
        }
        let connection = self.connection()?;
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
                 ORDER BY next_attempt_at_unix_ms ASC, created_at_unix_ms ASC, message_id ASC
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
        super::private_content::encode_message_private_content(
            &draft.plaintext,
            &draft.attachments,
        )?;
        Ok(Some(draft))
    }

    pub fn message_draft(&self, message_id: &str) -> Result<Option<PendingMessageDraft>, String> {
        if message_id.trim().is_empty() {
            return Err("messaging draft message ID is required".to_string());
        }
        let connection = self.connection()?;
        let draft = connection
            .query_row(
                "SELECT conversation_id, conversation_kind, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        reply_to_message_id, thread_root_message_id,
                        attempt_count, created_at_unix_ms
                 FROM messaging_pending_messages pending
                 WHERE message_id = ?1
                   AND state = 'draft'
                   AND NOT EXISTS (
                     SELECT 1 FROM messaging_attachment_drafts attachment
                     WHERE attachment.message_id = pending.message_id
                       AND attachment.descriptor_bytes IS NULL
                   )",
                params![message_id],
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
        super::private_content::encode_message_private_content(
            &draft.plaintext,
            &draft.attachments,
        )?;
        Ok(Some(draft))
    }

    pub fn schedule_message_draft_retry(
        &self,
        conversation_id: &str,
        message_id: &str,
        next_attempt_at_unix_ms: i64,
        error_code: &str,
    ) -> Result<(), String> {
        if conversation_id.trim().is_empty()
            || message_id.trim().is_empty()
            || next_attempt_at_unix_ms <= 0
            || error_code.trim().is_empty()
        {
            return Err("messaging draft retry is incomplete".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "UPDATE messaging_pending_messages
                 SET attempt_count = attempt_count + 1,
                     next_attempt_at_unix_ms = ?3,
                     last_error_code = ?4
                 WHERE conversation_id = ?1 AND message_id = ?2 AND state = 'draft'",
                params![
                    conversation_id,
                    message_id,
                    next_attempt_at_unix_ms,
                    error_code
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("messaging draft retry was not applied".to_string());
        }
        Ok(())
    }

    pub fn pending_sender_projection(
        &self,
        command_id: &str,
    ) -> Result<Option<(String, String)>, String> {
        if command_id.trim().is_empty() {
            return Err("messaging pending projection command ID is required".to_string());
        }
        self.connection()?
            .query_row(
                "SELECT p.plaintext, p.state
                 FROM messaging_command_attempts a
                 JOIN messaging_pending_messages p
                   ON p.conversation_id = a.conversation_id
                  AND p.message_id = a.message_id
                 WHERE a.command_id = ?1",
                params![command_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn build_recovery_archive(
        &self,
        ptid: &str,
        actor_identity_seed: [u8; 32],
        actor_profile_version: u64,
    ) -> Result<MessagingRecoveryArchive, String> {
        if ptid.trim().is_empty() || actor_profile_version == 0 {
            return Err("messaging recovery export requires PTID and profile version".to_string());
        }
        let connection = self.connection()?;
        let mut conversation_statement = connection
            .prepare(
                "SELECT conversation_id, authority_station_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                 FROM messaging_conversations
                 WHERE authority_station_id <> ''
                 ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let conversation_rows = conversation_statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, bool>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let mut conversations = Vec::with_capacity(conversation_rows.len());
        for row in conversation_rows {
            let mut member_statement = connection
                .prepare(
                    "SELECT ptid, role FROM messaging_conversation_members
                     WHERE conversation_id = ?1 AND active = 1
                     ORDER BY ptid",
                )
                .map_err(|error| error.to_string())?;
            let members = member_statement
                .query_map(params![row.0], |member| {
                    Ok((member.get::<_, String>(0)?, member.get::<_, i32>(1)?))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            let member_ptids = members
                .iter()
                .map(|(ptid, _)| ptid.clone())
                .collect::<Vec<_>>();
            let member_roles = members.into_iter().collect::<BTreeMap<_, _>>();
            conversations.push(RecoveryConversationProjection {
                conversation_id: row.0,
                authority_station_id: row.1,
                kind: row.2,
                name: row.3,
                owner_ptid: row.4,
                member_ptids,
                member_roles,
                membership_epoch: row.5,
                mls_epoch: row.6,
                active: row.7,
                updated_at_unix_ms: row.8,
            });
        }
        let mut message_statement = connection
            .prepare(
                "SELECT conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext, committed_at_unix_ms
                 FROM messaging_message_projections
                 WHERE conversation_id IN (
                     SELECT conversation_id FROM messaging_conversations
                     WHERE authority_station_id <> ''
                 )
                 ORDER BY conversation_id, event_sequence, event_id",
            )
            .map_err(|error| error.to_string())?;
        let messages = message_statement
            .query_map([], |row| {
                Ok(RecoveryMessageProjection {
                    conversation_id: row.get(0)?,
                    event_id: row.get(1)?,
                    event_sequence: row.get(2)?,
                    message_id: row.get(3)?,
                    sender_ptid: row.get(4)?,
                    sender_device_id: row.get(5)?,
                    plaintext: row.get(6)?,
                    committed_at_unix_ms: row.get(7)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let mut attachment_statement = connection
            .prepare(
                "SELECT message_id, attachment_id, filename, mime_type,
                        plaintext_size, plaintext_sha256, object_key, base_nonce,
                        descriptor_bytes
                 FROM messaging_attachment_projections
                 WHERE message_id IN (
                     SELECT message_id FROM messaging_message_projections
                     WHERE conversation_id IN (
                         SELECT conversation_id FROM messaging_conversations
                         WHERE authority_station_id <> ''
                     )
                 )
                 ORDER BY message_id, attachment_id",
            )
            .map_err(|error| error.to_string())?;
        let attachments = attachment_statement
            .query_map([], |row| {
                let descriptor_bytes = row.get::<_, Vec<u8>>(8)?;
                let object = crate::model::chat::EncryptedObjectDescriptor::decode(
                    descriptor_bytes.as_slice(),
                )
                .map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        descriptor_bytes.len(),
                        rusqlite::types::Type::Blob,
                        Box::new(error),
                    )
                })?;
                let attachment_id = row.get::<_, String>(1)?;
                let metadata = AttachmentPlaintextMetadata {
                    attachment_id: attachment_id.clone(),
                    filename: row.get(2)?,
                    mime_type: row.get(3)?,
                    plaintext_size: row.get::<_, i64>(4)?.try_into().map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            8,
                            rusqlite::types::Type::Integer,
                            Box::new(error),
                        )
                    })?,
                    plaintext_sha256: row.get(5)?,
                    object_key: row.get(6)?,
                    base_nonce: row.get(7)?,
                    object: Some(object),
                };
                Ok(RecoveryAttachmentMetadata {
                    message_id: row.get(0)?,
                    attachment_id,
                    metadata: metadata.encode_to_vec(),
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let mut trust_statement = connection
            .prepare(
                "SELECT peer_ptid, fingerprint, verified_at_unix_ms
                 FROM messaging_trust ORDER BY peer_ptid",
            )
            .map_err(|error| error.to_string())?;
        let trust = trust_statement
            .query_map([], |row| {
                Ok(RecoveryTrustRecord {
                    peer_ptid: row.get(0)?,
                    fingerprint: row.get(1)?,
                    verified_at_unix_ms: row.get(2)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(MessagingRecoveryArchive {
            ptid: ptid.to_string(),
            actor_identity_seed,
            actor_profile_version,
            conversations,
            messages,
            attachments,
            trust,
        })
    }

    // This method must only target a temporary recovery database. The caller
    // validates it and atomically replaces the profile database afterward.
    pub fn populate_recovery_staging(
        &self,
        archive: &MessagingRecoveryArchive,
    ) -> Result<(), String> {
        super::recovery::validate_archive(archive)?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(
                "DELETE FROM messaging_receipt_outbox;
                 DELETE FROM messaging_membership_intents;
                 DELETE FROM messaging_consumption_markers;
                 DELETE FROM messaging_inbox_items;
                 DELETE FROM messaging_lane_cursor;
                 DELETE FROM messaging_authority_heads;
                 DELETE FROM messaging_command_outbox;
                 DELETE FROM messaging_interaction_intents;
                 DELETE FROM messaging_command_attempts;
                 DELETE FROM messaging_pending_messages;
                 DELETE FROM messaging_local_commands;
                 DELETE FROM messaging_one_time_prekeys;
                 DELETE FROM messaging_prekey_bundle;
                 DELETE FROM messaging_recovery_state;
                 DELETE FROM messaging_device_identity;
                 DELETE FROM direct_skipped_message_keys;
                 DELETE FROM direct_session_bootstraps;
                 DELETE FROM direct_sessions;
                 DELETE FROM messaging_mls_applied_transitions;
                 DELETE FROM messaging_mls_pending_transitions;
                 DELETE FROM messaging_mls_key_packages;
                 DELETE FROM messaging_mls_join_provider_pool;
                 DELETE FROM messaging_mls_retired_checkpoints;
                 DELETE FROM messaging_mls_groups;
                 DELETE FROM messaging_mls_actor_identity;
                 DELETE FROM messaging_attachment_transfers;
                 DELETE FROM messaging_attachment_drafts;
                 DELETE FROM messaging_attachment_projections;
                 DELETE FROM messaging_message_search_fts;
                 DELETE FROM messaging_trust;
                 DELETE FROM messaging_conversation_members;
                 DELETE FROM messaging_conversations;
                 DELETE FROM messaging_message_projections;",
            )
            .map_err(|error| error.to_string())?;
        for conversation in &archive.conversations {
            transaction
                .execute(
                    "INSERT INTO messaging_conversations(
                        conversation_id, authority_station_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms,
                        recovery_ready
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)",
                    params![
                        conversation.conversation_id,
                        conversation.authority_station_id,
                        conversation.kind,
                        conversation.name,
                        conversation.owner_ptid,
                        conversation.membership_epoch,
                        conversation.mls_epoch,
                        conversation.active,
                        conversation.updated_at_unix_ms,
                    ],
                )
                .map_err(|error| error.to_string())?;
            for member_ptid in &conversation.member_ptids {
                let role = conversation
                    .member_roles
                    .get(member_ptid)
                    .copied()
                    .unwrap_or(if member_ptid == &conversation.owner_ptid {
                        MemberRole::Owner as i32
                    } else {
                        MemberRole::Unspecified as i32
                    });
                transaction
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, role, active
                         ) VALUES (?1, ?2, ?3, 1)",
                        params![conversation.conversation_id, member_ptid, role],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        for message in &archive.messages {
            transaction
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms,
                        reply_to_message_id, edited_text, edited_at_unix_ms, retracted
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'restored', ?8,
                               NULL, NULL, NULL, 0)",
                    params![
                        message.conversation_id,
                        message.event_id,
                        message.event_sequence,
                        message.message_id,
                        message.sender_ptid,
                        message.sender_device_id,
                        message.plaintext,
                        message.committed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        for attachment in &archive.attachments {
            let metadata = AttachmentPlaintextMetadata::decode(attachment.metadata.as_slice())
                .map_err(|_| "messaging recovery attachment metadata is invalid".to_string())?;
            super::private_content::validate_attachment_plaintext_metadata(&metadata)?;
            let object = metadata
                .object
                .as_ref()
                .ok_or_else(|| "messaging recovery attachment descriptor is missing".to_string())?;
            transaction
                .execute(
                    "INSERT INTO messaging_attachment_projections(
                        message_id, attachment_id, object_id, storage_ref,
                        filename, mime_type, plaintext_size, plaintext_sha256,
                        object_key, base_nonce, descriptor_bytes,
                        availability_state, local_cache_path
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                        'remote', NULL
                     )",
                    params![
                        attachment.message_id,
                        attachment.attachment_id,
                        object.object_id,
                        object.storage_ref,
                        metadata.filename,
                        metadata.mime_type,
                        i64::try_from(metadata.plaintext_size)
                            .map_err(|_| "attachment plaintext size exceeds i64")?,
                        metadata.plaintext_sha256,
                        metadata.object_key,
                        metadata.base_nonce,
                        object.encode_to_vec(),
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        for message in &archive.messages {
            let attachment_filenames = transaction
                .query_row(
                    "SELECT COALESCE(group_concat(filename, char(10)), '')
                     FROM messaging_attachment_projections
                     WHERE message_id = ?1
                     ORDER BY attachment_id",
                    params![message.message_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO messaging_message_search_fts(
                        conversation_id, message_id, plaintext, attachment_filenames
                     ) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        message.conversation_id,
                        message.message_id,
                        message.plaintext,
                        attachment_filenames
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        for trust in &archive.trust {
            transaction
                .execute(
                    "INSERT INTO messaging_trust(
                        peer_ptid, fingerprint, verified_at_unix_ms
                     ) VALUES (?1, ?2, ?3)",
                    params![
                        trust.peer_ptid,
                        trust.fingerprint,
                        trust.verified_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub(super) fn install_fresh_device_identity(
        &self,
        state: &FreshDeviceIdentityState,
    ) -> Result<(), String> {
        let enrollment = &state.enrollment;
        let certificate = &enrollment.certificate;
        let device = certificate
            .device
            .as_ref()
            .ok_or_else(|| "fresh messaging device identity has no endpoint".to_string())?;
        let ptid = actor_device_ptid(device)?;
        if device.device_id.trim().is_empty()
            || certificate.signing_key_id.trim().is_empty()
            || certificate.actor_identity_public_key.len() != 32
            || certificate.actor_identity_key_fingerprint.len() != 32
            || certificate.device_signing_public_key.len() != 32
            || certificate.observed_profile_version == 0
        {
            return Err("fresh messaging device identity is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
                        .map_err(|_| "fresh messaging profile version is invalid")?
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
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn commit_direct_receive(
        &self,
        input: &DirectReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        self.commit_direct_receive_inner(input, ReceiveFailPoint::None)
    }

    fn commit_direct_receive_inner(
        &self,
        input: &DirectReceiveCommit<'_>,
        fail_point: ReceiveFailPoint,
    ) -> Result<ReceiveCommitResult, String> {
        validate_direct_receive(input)?;
        let core = direct_receive_core(input);
        self.commit_receive_core(&core, fail_point, |transaction| {
            if let Some(prekey_id) = input.consumed_one_time_prekey_id {
                let changed = transaction
                    .execute(
                        "UPDATE messaging_one_time_prekeys SET state = 'consumed'
                         WHERE prekey_id = ?1 AND state = 'available'",
                        params![prekey_id],
                    )
                    .map_err(|error| error.to_string())?;
                if changed != 1 {
                    return Err("messaging one-time prekey was not consumed".to_string());
                }
            }
            upsert_direct_session(transaction, input.session)?;
            for skipped in input.new_skipped {
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
            if let Some((peer_public, counter)) = input.consumed_skipped {
                transaction
                    .execute(
                        "DELETE FROM direct_skipped_message_keys
                         WHERE session_id = ?1
                           AND peer_ratchet_public_key = ?2
                           AND counter = ?3",
                        params![
                            input.session.session_id,
                            peer_public.as_slice(),
                            i64::from(counter)
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    /// Atomic commit for a Direct-encrypted message edit.
    /// Persists ratchet state advancement, skipped keys, consumption marker,
    /// and the edit UPDATE in a single transaction.
    pub fn commit_direct_edit(
        &self,
        input: &DirectEditCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        if input.message_id.trim().is_empty() || input.edited_at_unix_ms <= 0 {
            return Err(
                "messaging direct edit requires message_id and valid timestamp".to_string(),
            );
        }
        let core = ReceiveCommitCore {
            item_id: input.item_id,
            event_id: input.event_id,
            conversation_id: input.conversation_id,
            lane_sequence: input.lane_sequence,
            consumer_epoch: input.consumer_epoch,
            payload_sha256: input.payload_sha256,
            event_hash: input.event_hash,
            previous_event_hash: input.previous_event_hash,
            event_sequence: input.event_sequence,
            allow_join_checkpoint: false,
            projection: None,
            receipt_id: input.receipt_id,
            receipt_bytes: input.receipt_bytes,
            consumed_at_unix_ms: input.consumed_at_unix_ms,
        };
        self.commit_receive_core(&core, ReceiveFailPoint::None, |transaction| {
            if let Some(prekey_id) = input.consumed_one_time_prekey_id {
                let changed = transaction
                    .execute(
                        "UPDATE messaging_one_time_prekeys SET state = 'consumed'
                         WHERE prekey_id = ?1 AND state = 'available'",
                        params![prekey_id],
                    )
                    .map_err(|error| error.to_string())?;
                if changed != 1 {
                    return Err("messaging one-time prekey was not consumed".to_string());
                }
            }
            upsert_direct_session(transaction, input.session)?;
            for skipped in input.new_skipped {
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
            if let Some((peer_public, counter)) = input.consumed_skipped {
                transaction
                    .execute(
                        "DELETE FROM direct_skipped_message_keys
                         WHERE session_id = ?1
                           AND peer_ratchet_public_key = ?2
                           AND counter = ?3",
                        params![
                            input.session.session_id,
                            peer_public.as_slice(),
                            i64::from(counter)
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            // Apply the edit to the existing message projection within the same transaction.
            let changed = transaction
                .execute(
                    "UPDATE messaging_message_projections
                     SET edited_text = ?1, edited_at_unix_ms = ?2
                     WHERE message_id = ?3",
                    params![input.edited_text, input.edited_at_unix_ms, input.message_id],
                )
                .map_err(|error| error.to_string())?;
            if changed == 0 {
                return Err("messaging direct edit target message not found".to_string());
            }
            Ok(())
        })
    }

    pub fn commit_public_event(
        &self,
        input: &PublicEventReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        validate_public_event_receive(input)?;
        let core = public_event_receive_core(input);
        self.commit_receive_core(&core, ReceiveFailPoint::None, |transaction| {
            let pending = transaction
                .query_row(
                    "SELECT p.conversation_id, p.message_id, p.sender_ptid,
                            p.sender_device_id, p.plaintext
                     FROM messaging_command_attempts a
                     JOIN messaging_pending_messages p
                       ON p.conversation_id = a.conversation_id
                      AND p.message_id = a.message_id
                     WHERE a.command_id = ?1",
                    params![input.command_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "messaging pending sender projection is unavailable".to_string())?;
            if pending.0 != input.conversation_id
                || pending.1 != input.message_id
                || pending.2 != input.sender_ptid
                || pending.3 != input.sender_device_id
            {
                return Err("messaging public-event pending projection mismatch".to_string());
            }
            let attachment_metadata = load_attachment_metadata(transaction, input.message_id)?;
            let private_descriptors = attachment_metadata
                .iter()
                .map(|attachment| attachment.object.clone())
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| "messaging sender attachment descriptor is missing".to_string())?;
            if private_descriptors != input.attachments {
                return Err("messaging public-event attachment descriptor mismatch".to_string());
            }
            let private_content = super::private_content::encode_message_private_content(
                &pending.4,
                &attachment_metadata,
            )?;
            persist_sender_content(
                transaction,
                input.conversation_id,
                input.message_id,
                &pending.4,
                &attachment_metadata,
                &private_content,
            )?;
            transaction
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms,
                        reply_to_message_id, thread_root_message_id,
                        edited_text, edited_at_unix_ms, retracted
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'accepted', ?8,
                               ?9, ?10, NULL, NULL, 0)",
                    params![
                        input.conversation_id,
                        input.event_id,
                        input.event_sequence,
                        input.message_id,
                        input.sender_ptid,
                        input.sender_device_id,
                        pending.4,
                        input.committed_at_unix_ms,
                        input.reply_to_message_id,
                        input.thread_root_message_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            let deleted = transaction
                .execute(
                    "DELETE FROM messaging_pending_messages
                     WHERE conversation_id = ?1 AND message_id = ?2",
                    params![input.conversation_id, input.message_id],
                )
                .map_err(|error| error.to_string())?;
            let attempt_updated = transaction
                .execute(
                    "UPDATE messaging_command_attempts SET state = 'committed'
                     WHERE command_id = ?1",
                    params![input.command_id],
                )
                .map_err(|error| error.to_string())?;
            let command_updated = transaction
                .execute(
                    "UPDATE messaging_local_commands
                     SET state = 'committed'
                     WHERE command_id = ?1
                       AND state IN ('prepared', 'submitted', 'failed', 'superseded')",
                    params![input.command_id],
                )
                .map_err(|error| error.to_string())?;
            let outbox_updated = transaction
                .execute(
                    "UPDATE messaging_command_outbox
                     SET state = 'committed', last_error_code = ''
                     WHERE command_id = ?1
                       AND state IN ('pending', 'retry_wait', 'submitted', 'failed', 'superseded')",
                    params![input.command_id],
                )
                .map_err(|error| error.to_string())?;
            if deleted != 1 || attempt_updated != 1 || command_updated != 1 || outbox_updated != 1 {
                return Err("messaging public-event command transition mismatch".to_string());
            }
            Ok(())
        })
    }

    pub fn commit_interaction_event(
        &self,
        input: &InteractionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        if input.message_id.trim().is_empty() {
            return Err("messaging interaction target message is required".to_string());
        }
        let core = ReceiveCommitCore {
            item_id: input.item_id,
            event_id: input.event_id,
            conversation_id: input.conversation_id,
            lane_sequence: input.lane_sequence,
            consumer_epoch: input.consumer_epoch,
            payload_sha256: input.payload_sha256,
            event_hash: input.event_hash,
            previous_event_hash: input.previous_event_hash,
            event_sequence: input.event_sequence,
            allow_join_checkpoint: false,
            projection: None,
            receipt_id: input.receipt_id,
            receipt_bytes: input.receipt_bytes,
            consumed_at_unix_ms: input.consumed_at_unix_ms,
        };
        self.commit_receive_core(&core, ReceiveFailPoint::None, |transaction| {
            if let Some(session_state) = input.mls_session_state {
                if session_state.is_empty() || input.membership_epoch < 0 || input.mls_epoch < 0 {
                    return Err("messaging interaction MLS state is incomplete".to_string());
                }
                transaction
                    .execute(
                        "INSERT INTO messaging_mls_groups(
                            conversation_id, session_state, membership_epoch,
                            mls_epoch, updated_at_unix_ms
                         ) VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT(conversation_id) DO UPDATE SET
                            session_state=excluded.session_state,
                            membership_epoch=excluded.membership_epoch,
                            mls_epoch=excluded.mls_epoch,
                            updated_at_unix_ms=excluded.updated_at_unix_ms",
                        params![
                            input.conversation_id,
                            session_state,
                            input.membership_epoch,
                            input.mls_epoch,
                            input.consumed_at_unix_ms
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            let message_exists = transaction
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM messaging_message_projections
                        WHERE conversation_id = ?1 AND message_id = ?2
                    )",
                    params![input.conversation_id, input.message_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|error| error.to_string())?;
            if !message_exists {
                return Err("messaging interaction target message not found".to_string());
            }
            match &input.mutation {
                InteractionMutation::Edit {
                    edited_text,
                    edited_at_unix_ms,
                } => {
                    if *edited_at_unix_ms <= 0 {
                        return Err("messaging edit timestamp is invalid".to_string());
                    }
                    let durable_edited_text = if edited_text.is_empty() {
                        transaction
                            .query_row(
                                "SELECT edited_text FROM messaging_interaction_intents
                                 WHERE command_id = ?1 AND interaction_kind = 'edit'",
                                params![input.command_id],
                                |row| row.get::<_, Option<String>>(0),
                            )
                            .optional()
                            .map_err(|error| error.to_string())?
                            .flatten()
                    } else {
                        Some((*edited_text).to_string())
                    };
                    let edited_text = durable_edited_text.ok_or_else(|| {
                        "messaging sender edit content is unavailable".to_string()
                    })?;
                    transaction
                        .execute(
                            "UPDATE messaging_message_projections
                             SET edited_text = ?1, edited_at_unix_ms = ?2
                             WHERE conversation_id = ?3 AND message_id = ?4",
                            params![
                                edited_text,
                                edited_at_unix_ms,
                                input.conversation_id,
                                input.message_id
                            ],
                        )
                        .map_err(|error| error.to_string())?;
                }
                InteractionMutation::Retract => {
                    transaction
                        .execute(
                            "UPDATE messaging_message_projections
                             SET retracted = 1
                             WHERE conversation_id = ?1 AND message_id = ?2",
                            params![input.conversation_id, input.message_id],
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
                        return Err("messaging reaction is incomplete".to_string());
                    }
                    if *removed {
                        transaction.execute(
                            "DELETE FROM message_reactions
                             WHERE message_id = ?1 AND actor_ptid = ?2 AND reaction = ?3",
                            params![input.message_id, actor_ptid, reaction],
                        )
                    } else {
                        transaction.execute(
                            "INSERT OR IGNORE INTO message_reactions(
                                message_id, actor_ptid, reaction, created_at_unix_ms
                             ) VALUES (?1, ?2, ?3, ?4)",
                            params![input.message_id, actor_ptid, reaction, created_at_unix_ms],
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
                        return Err("messaging pin is incomplete".to_string());
                    }
                    if *removed {
                        transaction.execute(
                            "DELETE FROM message_pins
                             WHERE conversation_id = ?1 AND message_id = ?2",
                            params![input.conversation_id, input.message_id],
                        )
                    } else {
                        transaction.execute(
                            "INSERT OR REPLACE INTO message_pins(
                                conversation_id, message_id, actor_ptid, pinned_at_unix_ms
                             ) VALUES (?1, ?2, ?3, ?4)",
                            params![
                                input.conversation_id,
                                input.message_id,
                                actor_ptid,
                                pinned_at_unix_ms
                            ],
                        )
                    }
                    .map_err(|error| error.to_string())?;
                }
            }
            let local_command_exists = transaction
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM messaging_interaction_intents
                        WHERE command_id = ?1
                    )",
                    params![input.command_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|error| error.to_string())?;
            if local_command_exists {
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
                            params![input.command_id],
                        )
                        .map_err(|error| error.to_string())?;
                    if changed != 1 {
                        return Err("messaging interaction command transition mismatch".to_string());
                    }
                }
            }
            Ok(())
        })
    }

    pub fn commit_conversation_state(
        &self,
        input: &ConversationStateReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        validate_conversation_state_receive(input)?;
        let core = conversation_state_receive_core(input);
        self.commit_receive_core(&core, ReceiveFailPoint::None, |transaction| {
            transaction
                .execute(
                    "INSERT INTO messaging_conversations(
                        conversation_id, authority_station_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        authority_station_id=excluded.authority_station_id,
                        kind=excluded.kind,
                        name=excluded.name,
                        owner_ptid=excluded.owner_ptid,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        active=excluded.active,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        input.projection.conversation_id,
                        input.projection.authority_station_id,
                        input.projection.kind,
                        input.projection.name,
                        input.projection.owner_ptid,
                        input.projection.membership_epoch,
                        input.projection.mls_epoch,
                        input.projection.active,
                        input.projection.updated_at_unix_ms,
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE messaging_conversation_members SET active = 0
                     WHERE conversation_id = ?1",
                    params![input.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            for member in &input.projection.members {
                transaction
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, role, active
                         ) VALUES (?1, ?2, ?3, 1)
                         ON CONFLICT(conversation_id, ptid) DO UPDATE SET
                            role=excluded.role,
                            active=1",
                        params![input.conversation_id, member.ptid, member.role],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    pub fn commit_mls_sender_transition(
        &self,
        input: &MlsSenderTransitionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        validate_mls_sender_transition_receive(input)?;
        let core = mls_sender_transition_receive_core(input);
        self.commit_receive_core(&core, ReceiveFailPoint::None, |transaction| {
            let pending = transaction
                .query_row(
                    "SELECT transition_id, command_id
                     FROM messaging_mls_pending_transitions
                     WHERE conversation_id = ?1",
                    params![input.conversation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "messaging MLS pending transition is unavailable".to_string())?;
            if pending.0 != input.transition_id || pending.1 != input.command_id {
                return Err("messaging MLS pending transition binding mismatch".to_string());
            }
            transaction
                .execute(
                    "INSERT INTO messaging_mls_groups(
                        conversation_id, session_state,
                        membership_epoch, mls_epoch, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        session_state=excluded.session_state,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        input.conversation_id,
                        input.session_state,
                        input.membership_epoch,
                        input.mls_epoch,
                        input.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE messaging_conversations
                     SET membership_epoch = ?2, mls_epoch = ?3, updated_at_unix_ms = ?4
                     WHERE conversation_id = ?1",
                    params![
                        input.conversation_id,
                        input.membership_epoch,
                        input.mls_epoch,
                        input.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE messaging_local_commands SET state = 'committed'
                     WHERE command_id = ?1",
                    params![input.command_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE messaging_command_outbox SET state = 'committed'
                     WHERE command_id = ?1",
                    params![input.command_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE messaging_command_attempts SET state = 'committed'
                     WHERE command_id = ?1",
                    params![input.command_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE messaging_membership_intents SET state = 'committed'
                     WHERE command_id = ?1 AND state = 'prepared'",
                    params![input.command_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM messaging_mls_pending_transitions
                     WHERE conversation_id = ?1",
                    params![input.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub fn commit_mls_receive(
        &self,
        input: &MlsReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        self.commit_mls_receive_inner(input, ReceiveFailPoint::None)
    }

    fn commit_mls_receive_inner(
        &self,
        input: &MlsReceiveCommit<'_>,
        fail_point: ReceiveFailPoint,
    ) -> Result<ReceiveCommitResult, String> {
        validate_mls_receive(input)?;
        let core = mls_receive_core(input);
        self.commit_receive_core(&core, fail_point, |transaction| {
            transaction
                .execute(
                    "INSERT INTO messaging_mls_groups(
                        conversation_id, session_state, membership_epoch,
                        mls_epoch, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        session_state=excluded.session_state,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        input.conversation_id,
                        input.session_state,
                        input.membership_epoch,
                        input.mls_epoch,
                        input.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub fn commit_mls_transition(
        &self,
        input: &MlsTransitionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        validate_mls_transition_receive(input)?;
        let core = mls_transition_receive_core(input);
        self.commit_receive_core(&core, ReceiveFailPoint::None, |transaction| {
            transaction
                .execute(
                    "INSERT INTO messaging_mls_groups(
                        conversation_id, session_state, membership_epoch,
                        mls_epoch, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        session_state=excluded.session_state,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        input.conversation_id,
                        input.session_state,
                        input.to_membership_epoch,
                        input.to_mls_epoch,
                        input.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            if let Some(provider_pool_state) = input.provider_pool_state {
                transaction
                    .execute(
                        "INSERT INTO messaging_mls_join_provider_pool(
                            id, provider_pool_state, updated_at_unix_ms
                         ) VALUES (1, ?1, ?2)
                         ON CONFLICT(id) DO UPDATE SET
                            provider_pool_state=excluded.provider_pool_state,
                            updated_at_unix_ms=excluded.updated_at_unix_ms",
                        params![provider_pool_state, input.consumed_at_unix_ms],
                    )
                    .map_err(|error| error.to_string())?;
            }
            if let Some(projection) = input.join_projection {
                if projection.conversation_id != input.conversation_id
                    || projection.membership_epoch != input.to_membership_epoch
                    || projection.mls_epoch != input.to_mls_epoch
                    || !projection.active
                    || projection.members.is_empty()
                {
                    return Err("messaging MLS join projection binding mismatch".to_string());
                }
                transaction
                    .execute(
                        "INSERT INTO messaging_conversations(
                            conversation_id, authority_station_id, kind, name, owner_ptid,
                            membership_epoch, mls_epoch, active, updated_at_unix_ms,
                            recovery_ready
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, 0)
                         ON CONFLICT(conversation_id) DO UPDATE SET
                            authority_station_id=excluded.authority_station_id,
                            kind=excluded.kind,
                            name=excluded.name,
                            owner_ptid=excluded.owner_ptid,
                            membership_epoch=excluded.membership_epoch,
                            mls_epoch=excluded.mls_epoch,
                            active=1,
                            updated_at_unix_ms=excluded.updated_at_unix_ms,
                            recovery_ready=0",
                        params![
                            projection.conversation_id,
                            projection.authority_station_id,
                            projection.kind,
                            projection.name,
                            projection.owner_ptid,
                            projection.membership_epoch,
                            projection.mls_epoch,
                            input.consumed_at_unix_ms
                        ],
                    )
                    .map_err(|error| error.to_string())?;
                transaction
                    .execute(
                        "DELETE FROM messaging_conversation_members
                         WHERE conversation_id = ?1",
                        params![projection.conversation_id],
                    )
                    .map_err(|error| error.to_string())?;
                for member in &projection.members {
                    transaction
                        .execute(
                            "INSERT INTO messaging_conversation_members(
                                conversation_id, ptid, role, active
                             ) VALUES (?1, ?2, ?3, 1)",
                            params![projection.conversation_id, member.ptid, member.role],
                        )
                        .map_err(|error| error.to_string())?;
                }
                transaction
                    .execute(
                        "DELETE FROM messaging_mls_retired_checkpoints
                         WHERE conversation_id = ?1",
                        params![projection.conversation_id],
                    )
                    .map_err(|error| error.to_string())?;
            } else {
                let conversation_changed = transaction
                    .execute(
                        "UPDATE messaging_conversations
                         SET membership_epoch = ?2, mls_epoch = ?3, updated_at_unix_ms = ?4
                         WHERE conversation_id = ?1",
                        params![
                            input.conversation_id,
                            input.to_membership_epoch,
                            input.to_mls_epoch,
                            input.consumed_at_unix_ms
                        ],
                    )
                    .map_err(|error| error.to_string())?;
                if conversation_changed != 1 {
                    return Err("messaging MLS conversation projection is unavailable".to_string());
                }
            }
            transaction
                .execute(
                    "INSERT INTO messaging_mls_applied_transitions(
                        conversation_id, transition_id, event_id, event_sequence,
                        transition_kind, from_membership_epoch, to_membership_epoch,
                        from_mls_epoch, to_mls_epoch, applied_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        input.conversation_id,
                        input.transition_id,
                        input.event_id,
                        input.event_sequence,
                        input.transition_kind,
                        input.from_membership_epoch,
                        input.to_membership_epoch,
                        input.from_mls_epoch,
                        input.to_mls_epoch,
                        input.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub fn commit_mls_retirement(
        &self,
        input: &MlsRetirementReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        let core = mls_retirement_receive_core(input);
        validate_receive_core(&core)?;
        if input.transition_id.trim().is_empty()
            || input.endpoint_ptid.trim().is_empty()
            || input.endpoint_device_id.trim().is_empty()
            || input.event_sequence <= 0
            || input.membership_epoch <= 0
            || input.mls_epoch <= 0
            || input.projection.conversation_id != input.conversation_id
            || input.projection.authority_station_id.trim().is_empty()
            || input.projection.membership_epoch != input.membership_epoch
            || input.projection.mls_epoch != input.mls_epoch
            || input.projection.members.is_empty()
        {
            return Err("messaging MLS retirement binding is invalid".to_string());
        }
        self.commit_receive_core(&core, ReceiveFailPoint::None, |transaction| {
            transaction
                .execute(
                    "DELETE FROM messaging_mls_groups WHERE conversation_id = ?1",
                    params![input.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM messaging_mls_pending_transitions
                     WHERE conversation_id = ?1",
                    params![input.conversation_id],
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
                        input.conversation_id,
                        input.transition_id,
                        input.event_id,
                        input.event_sequence,
                        input.event_hash,
                        input.endpoint_ptid,
                        input.endpoint_device_id,
                        input.membership_epoch,
                        input.mls_epoch,
                        input.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO messaging_conversations(
                        conversation_id, authority_station_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        authority_station_id=excluded.authority_station_id,
                        kind=excluded.kind,
                        name=excluded.name,
                        owner_ptid=excluded.owner_ptid,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        active=excluded.active,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        input.projection.conversation_id,
                        input.projection.authority_station_id,
                        input.projection.kind,
                        input.projection.name,
                        input.projection.owner_ptid,
                        input.projection.membership_epoch,
                        input.projection.mls_epoch,
                        input.projection.active,
                        input.consumed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM messaging_conversation_members
                     WHERE conversation_id = ?1",
                    params![input.conversation_id],
                )
                .map_err(|error| error.to_string())?;
            for member in &input.projection.members {
                transaction
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, role, active
                         ) VALUES (?1, ?2, ?3, 1)",
                        params![input.conversation_id, member.ptid, member.role],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    pub fn load_mls_session_state(&self, conversation_id: &str) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT session_state FROM messaging_mls_groups WHERE conversation_id = ?1",
                params![conversation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn has_mls_retired_checkpoint(&self, conversation_id: &str) -> Result<bool, String> {
        self.connection()?
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

    pub fn list_mls_session_states(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, session_state
                 FROM messaging_mls_groups
                 ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn list_pending_mls_transition_states(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, transition_state
                 FROM messaging_mls_pending_transitions
                 ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let transitions = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(transitions)
    }

    pub fn load_mls_actor_identity(&self) -> Result<Option<(String, String, Vec<u8>)>, String> {
        self.connection()?
            .query_row(
                "SELECT ptid, device_id, identity_state
                 FROM messaging_mls_actor_identity WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String> {
        let row = self
            .connection()?
            .query_row(
                "SELECT d.ptid, d.device_id, d.actor_identity_public_key,
                        d.actor_identity_key_fingerprint, d.device_signing_public_key,
                        d.actor_cross_signature, d.signing_key_id, d.profile_version
                 FROM messaging_device_identity d
                 WHERE d.id = 1",
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
                device: Some(actor_device_ref(row.0, row.1)),
                actor_identity_public_key: row.2,
                actor_identity_key_fingerprint: row.3,
                device_signing_public_key: row.4,
                signing_key_id: row.6,
                observed_profile_version: u64::try_from(row.7)
                    .map_err(|_| "invalid pending enrollment profile version")?,
            },
            actor_cross_signature: row
                .5
                .try_into()
                .map_err(|_| "actor cross signature must be 64 bytes")?,
        }))
    }

    pub fn pending_device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String> {
        let status = self
            .connection()?
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

    pub fn complete_device_enrollment(&self, device_id: &str) -> Result<(), String> {
        if device_id.trim().is_empty() {
            return Err("messaging enrollment device ID is required".to_string());
        }
        let result = self.connection()?.execute(
            "UPDATE messaging_recovery_state
             SET status = 'active'
             WHERE id = 1
               AND status = 'awaiting_device_enrollment'
               AND EXISTS (
                   SELECT 1 FROM messaging_device_identity
                   WHERE id = 1 AND device_id = ?1
               )",
            params![device_id],
        );
        match result {
            Ok(1) => Ok(()),
            Ok(_) => Err("messaging enrollment state transition was not applied".to_string()),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn reset_device_enrollment(&self) -> Result<bool, String> {
        let result = self.connection()?.execute(
            "UPDATE messaging_recovery_state
             SET status = 'awaiting_device_enrollment'
             WHERE id = 1 AND status = 'active'",
            [],
        );
        match result {
            Ok(rows) => Ok(rows > 0),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn device_signing_seed(&self) -> Result<Option<([u8; 32], String)>, String> {
        self.connection()?
            .query_row(
                "SELECT device_signing_seed, signing_key_id
                 FROM messaging_device_identity WHERE id = 1",
                [],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|(seed, key_id)| {
                let seed: [u8; 32] = seed
                    .try_into()
                    .map_err(|_| "device signing seed is not 32 bytes".to_string())?;
                Ok((seed, key_id))
            })
            .transpose()
    }

    pub fn has_prekey_bundle(&self) -> Result<bool, String> {
        self.connection()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messaging_prekey_bundle WHERE id = 1)",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())
    }

    pub fn install_fresh_prekey_bundle(
        &self,
        signed_prekey_id: i32,
        signed_prekey_private: &[u8; 32],
        one_time_prekeys: &[(i32, [u8; 32])],
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        if signed_prekey_id <= 0 || one_time_prekeys.is_empty() || created_at_unix_ms <= 0 {
            return Err("messaging fresh prekey bundle is incomplete".to_string());
        }
        let mut seen = HashSet::with_capacity(one_time_prekeys.len());
        if one_time_prekeys
            .iter()
            .any(|(id, _)| *id <= 0 || !seen.insert(*id))
        {
            return Err("messaging one-time prekey IDs are invalid".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
            return Err("messaging prekeys require active device enrollment".to_string());
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
                    created_at_unix_ms
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
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn pending_prekey_bundle(&self) -> Result<Option<PendingPreKeyBundle>, String> {
        let connection = self.connection()?;
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
        let Some((signed_prekey_id, private_key)) = signed else {
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
            return Err("messaging pending prekey bundle has no OPKs".to_string());
        }
        Ok(Some(PendingPreKeyBundle {
            signed_prekey_id,
            signed_prekey_private: fixed_key("signed prekey", private_key)?,
            one_time_prekeys,
        }))
    }

    pub fn complete_prekey_publication(&self, signed_prekey_id: i32) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
            return Err("messaging prekey publication transition was not applied".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn load_signed_prekey(&self, signed_prekey_id: i32) -> Result<[u8; 32], String> {
        let bytes = self
            .connection()?
            .query_row(
                "SELECT signed_prekey_private FROM messaging_prekey_bundle
                 WHERE id = 1
                   AND signed_prekey_id = ?1
                   AND state = 'published'",
                params![signed_prekey_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "messaging signed prekey is unavailable".to_string())?;
        fixed_key("signed prekey", bytes)
    }

    pub fn consume_one_time_prekey(&self, prekey_id: i32) -> Result<[u8; 32], String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let bytes = transaction
            .query_row(
                "SELECT private_key FROM messaging_one_time_prekeys
                 WHERE prekey_id = ?1 AND state = 'available'",
                params![prekey_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "messaging one-time prekey is unavailable".to_string())?;
        let changed = transaction
            .execute(
                "UPDATE messaging_one_time_prekeys SET state = 'consumed'
                 WHERE prekey_id = ?1 AND state = 'available'",
                params![prekey_id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("messaging one-time prekey was not consumed".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())?;
        fixed_key("one-time prekey", bytes)
    }

    pub fn load_one_time_prekey(&self, prekey_id: i32) -> Result<[u8; 32], String> {
        let bytes = self
            .connection()?
            .query_row(
                "SELECT private_key FROM messaging_one_time_prekeys
                 WHERE prekey_id = ?1 AND state = 'available'",
                params![prekey_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "messaging one-time prekey is unavailable".to_string())?;
        fixed_key("one-time prekey", bytes)
    }

    pub fn save_mls_actor_identity(
        &self,
        ptid: &str,
        device_id: &str,
        identity_state: &[u8],
    ) -> Result<(), String> {
        if ptid.trim().is_empty() || device_id.trim().is_empty() || identity_state.is_empty() {
            return Err("messaging MLS actor-device identity is incomplete".to_string());
        }
        self.connection()?
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
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT provider_pool_state
                 FROM messaging_mls_join_provider_pool WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn save_mls_join_provider_pool(
        &self,
        provider_pool_state: &[u8],
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        if provider_pool_state.is_empty() {
            return Err("messaging MLS provider pool is empty".to_string());
        }
        self.connection()?
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

    fn has_mls_key_packages(&self) -> Result<bool, String> {
        self.connection()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messaging_mls_key_packages)",
                [],
                |row| row.get::<_, bool>(0),
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
            return Err("messaging MLS KeyPackage batch is incomplete".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
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
            return Err("messaging MLS KeyPackages require active device enrollment".to_string());
        }
        transaction
            .execute(
                "INSERT INTO messaging_mls_join_provider_pool(
                    id, provider_pool_state, updated_at_unix_ms
                 ) VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET
                    provider_pool_state=excluded.provider_pool_state,
                    updated_at_unix_ms=excluded.updated_at_unix_ms",
                params![provider_pool_state, created_at_unix_ms],
            )
            .map_err(|error| error.to_string())?;
        let mut seen = HashSet::with_capacity(packages.len());
        for package in packages {
            let package_id = hex::encode(Sha256::digest(package));
            if !seen.insert(package_id.clone()) {
                return Err("messaging MLS KeyPackage batch contains duplicates".to_string());
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
        transaction.commit().map_err(|error| error.to_string())
    }

    fn pending_mls_key_packages(&self) -> Result<Vec<CorePendingMlsKeyPackage>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT package_id, data FROM messaging_mls_key_packages
                 WHERE state = 'awaiting_publication'
                 ORDER BY package_id",
            )
            .map_err(|error| error.to_string())?;
        let packages = statement
            .query_map([], |row| {
                Ok(CorePendingMlsKeyPackage {
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
            return Err("messaging MLS KeyPackage ID is required".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "UPDATE messaging_mls_key_packages SET state = 'published'
             WHERE package_id = ?1 AND state = 'awaiting_publication'",
                params![package_id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("messaging MLS KeyPackage publication was not applied".to_string());
        }
        Ok(())
    }

    pub fn save_mls_session_state(
        &self,
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
        {
            return Err("messaging MLS session state is incomplete".to_string());
        }
        self.connection()?
            .execute(
                "INSERT INTO messaging_mls_groups(
                    conversation_id, session_state, membership_epoch,
                    mls_epoch, updated_at_unix_ms
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

    fn commit_receive_core<F>(
        &self,
        input: &ReceiveCommitCore<'_>,
        fail_point: ReceiveFailPoint,
        apply_crypto: F,
    ) -> Result<ReceiveCommitResult, String>
    where
        F: FnOnce(&Transaction<'_>) -> Result<(), String>,
    {
        validate_receive_core(input)?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;

        let existing_hash = transaction
            .query_row(
                "SELECT payload_sha256 FROM messaging_consumption_markers WHERE item_id = ?1",
                params![input.item_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(existing_hash) = existing_hash {
            if existing_hash == input.payload_sha256 {
                return Ok(ReceiveCommitResult::AlreadyCommitted);
            }
            return Err("messaging consumption marker payload hash mismatch".to_string());
        }

        let claimed = transaction
            .query_row(
                "SELECT event_id, conversation_id, lane_sequence, consumer_epoch, payload_sha256
                 FROM messaging_inbox_items WHERE item_id = ?1 AND state = 'claimed'",
                params![input.item_id],
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
            .ok_or_else(|| "messaging claimed inbox item is unavailable".to_string())?;
        if claimed.0 != input.event_id
            || claimed.1 != input.conversation_id
            || claimed.2 != input.lane_sequence
            || claimed.3
                != i64::try_from(input.consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?
            || claimed.4 != input.payload_sha256
        {
            return Err("messaging claimed inbox item binding mismatch".to_string());
        }

        let cursor = transaction
            .query_row(
                "SELECT lane_sequence, consumer_epoch FROM messaging_lane_cursor WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let expected_sequence = cursor.map(|value| value.0 + 1).unwrap_or(1);
        if input.lane_sequence != expected_sequence
            || cursor
                .map(|value| i64::try_from(input.consumer_epoch).unwrap_or(i64::MAX) < value.1)
                .unwrap_or(false)
        {
            return Err("messaging receive is not the next fenced lane item".to_string());
        }

        let authority_head = transaction
            .query_row(
                "SELECT event_sequence, event_hash
                 FROM messaging_authority_heads WHERE conversation_id = ?1",
                params![input.conversation_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some((sequence, hash)) = &authority_head {
            if input.event_sequence <= *sequence {
                if input.event_sequence == *sequence && input.event_hash != hash {
                    return Err("messaging authority event replay hash mismatch".to_string());
                }
                commit_subsumed_receive(&transaction, input)?;
                if fail_point == ReceiveFailPoint::BeforeCommit {
                    return Err("injected receive failure before commit".to_string());
                }
                transaction.commit().map_err(|error| error.to_string())?;
                return Ok(ReceiveCommitResult::Committed);
            }
        }
        match authority_head {
            Some((sequence, hash))
                if input.event_sequence == sequence + 1 && input.previous_event_hash == hash => {}
            Some((sequence, hash))
                if input.allow_join_checkpoint
                    && input.event_sequence > sequence
                    && input.previous_event_hash.len() == 32 =>
            {
                let retired: i64 = transaction
                    .query_row(
                        "SELECT COUNT(*) FROM messaging_mls_retired_checkpoints
                         WHERE conversation_id = ?1
                           AND retirement_sequence = ?2
                           AND retirement_hash = ?3",
                        params![input.conversation_id, sequence, hash],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                if retired != 1 {
                    return Err(
                        "messaging MLS rejoin checkpoint has no matching retirement".to_string()
                    );
                }
            }
            None if input.event_sequence == 1 && input.previous_event_hash.is_empty() => {}
            None if input.allow_join_checkpoint
                && input.event_sequence > 1
                && input.previous_event_hash.len() == 32 =>
            {
                let live_state: i64 = transaction
                    .query_row(
                        "SELECT
                            (SELECT COUNT(*) FROM messaging_mls_groups WHERE conversation_id = ?1)
                          + (SELECT COUNT(*) FROM messaging_consumption_markers WHERE conversation_id = ?1)",
                        params![input.conversation_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                let projection_state: Option<bool> = transaction
                    .query_row(
                        "SELECT recovery_ready FROM messaging_conversations
                         WHERE conversation_id = ?1",
                        params![input.conversation_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?;
                if live_state != 0 || projection_state == Some(false) {
                    return Err(
                        "messaging MLS join checkpoint requires empty or recovery-ready local state"
                            .to_string(),
                    );
                }
            }
            _ => return Err("messaging authority event chain is not contiguous".to_string()),
        }

        apply_crypto(&transaction)?;
        if fail_point == ReceiveFailPoint::AfterCrypto {
            return Err("injected receive failure after crypto".to_string());
        }

        if let Some(projection) = input.projection {
            let changed = transaction
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms,
                        reply_to_message_id, thread_root_message_id,
                        edited_text, edited_at_unix_ms, retracted
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'consumed', ?8,
                               ?9, ?10, NULL, NULL, 0)
                     ON CONFLICT(conversation_id, event_id) DO NOTHING",
                    params![
                        projection.conversation_id,
                        projection.event_id,
                        projection.event_sequence,
                        projection.message_id,
                        projection.sender_ptid,
                        projection.sender_device_id,
                        projection.plaintext,
                        projection.committed_at_unix_ms,
                        projection.reply_to_message_id,
                        projection.thread_root_message_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err(
                    "messaging projection identity already exists without marker".to_string(),
                );
            }
            if fail_point == ReceiveFailPoint::AfterProjection {
                return Err("injected receive failure after projection".to_string());
            }
            for attachment in &projection.attachments {
                super::private_content::validate_attachment_plaintext_metadata(attachment)?;
                let object = attachment
                    .object
                    .as_ref()
                    .ok_or_else(|| "messaging attachment descriptor is missing".to_string())?;
                transaction
                    .execute(
                        "INSERT INTO messaging_attachment_projections(
                            message_id, attachment_id, object_id, storage_ref,
                            filename, mime_type, plaintext_size, plaintext_sha256,
                            object_key, base_nonce, descriptor_bytes,
                            availability_state, local_cache_path
                         ) VALUES (
                            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                            'remote', NULL
                         )",
                        params![
                            projection.message_id,
                            attachment.attachment_id,
                            object.object_id,
                            object.storage_ref,
                            attachment.filename,
                            attachment.mime_type,
                            i64::try_from(attachment.plaintext_size)
                                .map_err(|_| "attachment plaintext size exceeds i64")?,
                            attachment.plaintext_sha256,
                            attachment.object_key,
                            attachment.base_nonce,
                            object.encode_to_vec(),
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        if fail_point == ReceiveFailPoint::AfterAttachments {
            return Err("injected receive failure after attachments".to_string());
        }

        if let Some(projection) = input.projection {
            let attachment_filenames = projection
                .attachments
                .iter()
                .map(|attachment| attachment.filename.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            transaction
                .execute(
                    "INSERT INTO messaging_message_search_fts(
                        conversation_id, message_id, plaintext, attachment_filenames
                     ) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        projection.conversation_id,
                        projection.message_id,
                        projection.plaintext,
                        attachment_filenames,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        if fail_point == ReceiveFailPoint::AfterSearch {
            return Err("injected receive failure after search index".to_string());
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
                    input.conversation_id,
                    input.event_sequence,
                    input.event_hash,
                    input.consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_consumption_markers(
                    item_id, event_id, conversation_id, payload_sha256, consumed_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    input.item_id,
                    input.event_id,
                    input.conversation_id,
                    input.payload_sha256,
                    input.consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_lane_cursor(id, lane_sequence, consumer_epoch, updated_at_unix_ms)
                 VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET
                    lane_sequence=excluded.lane_sequence,
                    consumer_epoch=excluded.consumer_epoch,
                    updated_at_unix_ms=excluded.updated_at_unix_ms",
                params![
                    input.lane_sequence,
                    i64::try_from(input.consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?,
                    input.consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE messaging_inbox_items SET state = 'consumed' WHERE item_id = ?1",
                params![input.item_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO messaging_receipt_outbox(
                    receipt_id, event_id, receipt_bytes, state, created_at_unix_ms
                 ) VALUES (?1, ?2, ?3, 'pending', ?4)",
                params![
                    input.receipt_id,
                    input.event_id,
                    input.receipt_bytes,
                    input.consumed_at_unix_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        if fail_point == ReceiveFailPoint::BeforeCommit {
            return Err("injected receive failure before commit".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(ReceiveCommitResult::Committed)
    }

    /// Update the read cursor for a participant in a conversation.
    /// Uses MAX to ensure the cursor only advances forward.
    pub fn update_read_cursor(
        &self,
        conversation_id: &str,
        actor_ptid: &str,
        sequence: i64,
        now: i64,
    ) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO read_cursors(conversation_id, actor_ptid, last_read_sequence, updated_at_unix_ms)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(conversation_id, actor_ptid) DO UPDATE SET
                    last_read_sequence = MAX(read_cursors.last_read_sequence, excluded.last_read_sequence),
                    updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![conversation_id, actor_ptid, sequence, now],
            )
            .map_err(|error| format!("messaging store update_read_cursor: {error}"))?;
        Ok(())
    }

    pub fn read_cursor(
        &self,
        conversation_id: &str,
        actor_ptid: &str,
    ) -> Result<Option<i64>, String> {
        self.connection()?
            .query_row(
                "SELECT last_read_sequence FROM read_cursors
                 WHERE conversation_id = ?1 AND actor_ptid = ?2",
                params![conversation_id, actor_ptid],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("messaging store read_cursor: {error}"))
    }

    /// Returns all reactions for a message as (actor_ptid, reaction, created_at_unix_ms).
    pub fn reactions_for_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<(String, String, i64)>, String> {
        if message_id.trim().is_empty() {
            return Err("messaging reactions query requires message_id".to_string());
        }
        let connection = self.connection()?;
        load_reactions_for_message(&connection, message_id)
    }

    /// Returns all pins for a conversation as (message_id, actor_ptid, pinned_at_unix_ms).
    pub fn pins_for_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<(String, String, i64)>, String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging pins query requires conversation_id".to_string());
        }
        let connection = self.connection()?;
        load_pins_for_conversation(&connection, conversation_id)
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn acceptance_interaction_snapshot(
        &self,
        conversation_id: &str,
        message_id: &str,
        command_id: &str,
    ) -> Result<serde_json::Value, String> {
        if conversation_id.trim().is_empty() || message_id.trim().is_empty() {
            return Err("acceptance interaction snapshot requires conversation and message".into());
        }
        let connection = self.connection()?;
        let projection = connection
            .query_row(
                "SELECT event_id, event_sequence, delivery_state,
                        reply_to_message_id, thread_root_message_id,
                        edited_text, edited_at_unix_ms, retracted
                 FROM messaging_message_projections
                 WHERE conversation_id = ?1 AND message_id = ?2",
                params![conversation_id, message_id],
                |row| {
                    Ok(serde_json::json!({
                        "eventId": row.get::<_, String>(0)?,
                        "eventSequence": row.get::<_, i64>(1)?,
                        "deliveryState": row.get::<_, String>(2)?,
                        "replyToMessageId": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        "threadRootMessageId": row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                        "editedTextSha256": row
                            .get::<_, Option<String>>(5)?
                            .map(|value| hex::encode(Sha256::digest(value.as_bytes())))
                            .unwrap_or_default(),
                        "editedAtUnixMs": row.get::<_, Option<i64>>(6)?.unwrap_or_default(),
                        "retracted": row.get::<_, i64>(7)? != 0,
                    }))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let intent = if command_id.trim().is_empty() {
            None
        } else {
            connection
                .query_row(
                    "SELECT intent.interaction_kind, intent.state, command.command_bytes
                     FROM messaging_interaction_intents intent
                     JOIN messaging_local_commands command USING(command_id)
                     WHERE intent.command_id = ?1",
                    params![command_id],
                    |row| {
                        Ok(serde_json::json!({
                            "commandId": command_id,
                            "kind": row.get::<_, String>(0)?,
                            "state": row.get::<_, String>(1)?,
                            "commandSha256": hex::encode(Sha256::digest(
                                row.get::<_, Vec<u8>>(2)?.as_slice()
                            )),
                        }))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?
        };
        let outbox = if command_id.trim().is_empty() {
            None
        } else {
            connection
                .query_row(
                    "SELECT state, attempt_count, next_attempt_at_unix_ms,
                            last_error_code, command_bytes
                     FROM messaging_command_outbox
                     WHERE command_id = ?1",
                    params![command_id],
                    |row| {
                        Ok(serde_json::json!({
                            "state": row.get::<_, String>(0)?,
                            "attemptCount": row.get::<_, i64>(1)?,
                            "nextAttemptAtUnixMs": row.get::<_, i64>(2)?,
                            "lastErrorCode": row.get::<_, String>(3)?,
                            "commandSha256": hex::encode(Sha256::digest(
                                row.get::<_, Vec<u8>>(4)?.as_slice()
                            )),
                        }))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?
        };
        let direct_sessions = {
            let mut statement = connection
                .prepare(
                    "SELECT session_id, generation, self_public_key,
                            peer_ratchet_public_key, root_key,
                            send_chain_key, receive_chain_key,
                            send_counter, receive_counter, previous_counter,
                            updated_at_unix_ms
                     FROM direct_sessions
                     WHERE conversation_id = ?1
                     ORDER BY generation DESC, session_id",
                )
                .map_err(|error| error.to_string())?;
            let sessions = statement
                .query_map(params![conversation_id], |row| {
                    let digest = |value: Option<Vec<u8>>| {
                        value
                            .map(|bytes| hex::encode(Sha256::digest(bytes)))
                            .unwrap_or_default()
                    };
                    Ok(serde_json::json!({
                        "sessionId": row.get::<_, String>(0)?,
                        "generation": row.get::<_, i64>(1)?,
                        "selfPublicKey": hex::encode(row.get::<_, Vec<u8>>(2)?),
                        "peerPublicKey": row
                            .get::<_, Option<Vec<u8>>>(3)?
                            .map(hex::encode)
                            .unwrap_or_default(),
                        "rootKeySha256": digest(Some(row.get::<_, Vec<u8>>(4)?)),
                        "sendChainSha256": digest(row.get::<_, Option<Vec<u8>>>(5)?),
                        "receiveChainSha256": digest(row.get::<_, Option<Vec<u8>>>(6)?),
                        "sendCounter": row.get::<_, i64>(7)?,
                        "receiveCounter": row.get::<_, i64>(8)?,
                        "previousCounter": row.get::<_, i64>(9)?,
                        "updatedAtUnixMs": row.get::<_, i64>(10)?,
                    }))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            sessions
        };
        let command_ledger = {
            let mut statement = connection
                .prepare(
                    "SELECT attempt.command_id, attempt.message_id, attempt.state,
                            local.state, outbox.state, outbox.attempt_count,
                            outbox.last_error_code, pending.state,
                            pending.attempt_count, pending.last_error_code,
                            pending.next_attempt_at_unix_ms
                     FROM messaging_command_attempts attempt
                     JOIN messaging_local_commands local USING(command_id)
                     JOIN messaging_command_outbox outbox USING(command_id)
                     LEFT JOIN messaging_pending_messages pending
                       ON pending.conversation_id = attempt.conversation_id
                      AND pending.message_id = attempt.message_id
                     WHERE attempt.conversation_id = ?1
                     ORDER BY attempt.created_at_unix_ms, attempt.command_id",
                )
                .map_err(|error| error.to_string())?;
            let commands = statement
                .query_map(params![conversation_id], |row| {
                    Ok(serde_json::json!({
                        "commandId": row.get::<_, String>(0)?,
                        "messageId": row.get::<_, String>(1)?,
                        "attemptState": row.get::<_, String>(2)?,
                        "localState": row.get::<_, String>(3)?,
                        "outboxState": row.get::<_, String>(4)?,
                        "outboxAttemptCount": row.get::<_, i64>(5)?,
                        "outboxErrorCode": row.get::<_, String>(6)?,
                        "draftState": row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                        "draftAttemptCount": row.get::<_, Option<i64>>(8)?.unwrap_or_default(),
                        "draftErrorCode": row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                        "draftNextAttemptAtUnixMs": row
                            .get::<_, Option<i64>>(10)?
                            .unwrap_or_default(),
                    }))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            commands
        };
        let reactions = load_reactions_for_message(&connection, message_id)?
            .into_iter()
            .map(|(actor_ptid, reaction, created_at_unix_ms)| {
                serde_json::json!({
                    "actorPtid": actor_ptid,
                    "reaction": reaction,
                    "createdAtUnixMs": created_at_unix_ms,
                })
            })
            .collect::<Vec<_>>();
        let pins = load_pins_for_conversation(&connection, conversation_id)?
            .into_iter()
            .filter(|(candidate, _, _)| candidate == message_id)
            .map(|(_, actor_ptid, pinned_at_unix_ms)| {
                serde_json::json!({
                    "actorPtid": actor_ptid,
                    "pinnedAtUnixMs": pinned_at_unix_ms,
                })
            })
            .collect::<Vec<_>>();
        let read_cursors = {
            let mut statement = connection
                .prepare(
                    "SELECT actor_ptid, last_read_sequence
                     FROM read_cursors
                     WHERE conversation_id = ?1
                     ORDER BY actor_ptid",
                )
                .map_err(|error| error.to_string())?;
            let cursors = statement
                .query_map(params![conversation_id], |row| {
                    Ok(serde_json::json!({
                        "actorPtid": row.get::<_, String>(0)?,
                        "lastReadSequence": row.get::<_, i64>(1)?,
                    }))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            cursors
        };
        let consumption_count = connection
            .query_row(
                "SELECT COUNT(*) FROM messaging_consumption_markers
                 WHERE conversation_id = ?1",
                params![conversation_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        let (lane_sequence, consumer_epoch) = connection
            .query_row(
                "SELECT lane_sequence, consumer_epoch
                 FROM messaging_lane_cursor WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        Ok(serde_json::json!({
            "conversationId": conversation_id,
            "messageId": message_id,
            "projection": projection,
            "intent": intent,
            "outbox": outbox,
            "directSessions": direct_sessions,
            "commandLedger": command_ledger,
            "reactions": reactions,
            "pins": pins,
            "readCursors": read_cursors,
            "consumptionCount": consumption_count,
            "laneSequence": lane_sequence,
            "consumerEpoch": consumer_epoch,
        }))
    }

    #[cfg(test)]
    pub(super) fn in_memory() -> Result<Self, String> {
        Self::from_connection(Connection::open_in_memory().map_err(|error| error.to_string())?)
    }
}

impl DeviceEnrollmentRepository for MessagingStore {
    fn device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String> {
        MessagingStore::device_enrollment(self)
    }

    fn install_fresh_device_identity(
        &self,
        state: &FreshDeviceIdentityState,
    ) -> Result<(), String> {
        MessagingStore::install_fresh_device_identity(self, state)
    }

    fn pending_device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String> {
        MessagingStore::pending_device_enrollment(self)
    }

    fn complete_device_enrollment(&self, device_id: &str) -> Result<(), String> {
        MessagingStore::complete_device_enrollment(self, device_id)
    }

    fn reset_device_enrollment(&self) -> Result<bool, String> {
        MessagingStore::reset_device_enrollment(self)
    }
}

impl PreKeyRepository for MessagingStore {
    fn has_prekey_bundle(&self) -> Result<bool, String> {
        MessagingStore::has_prekey_bundle(self)
    }

    fn install_fresh_prekey_bundle(
        &self,
        signed_prekey_id: i32,
        signed_prekey_private: &[u8; 32],
        one_time_prekeys: &[(i32, [u8; 32])],
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        MessagingStore::install_fresh_prekey_bundle(
            self,
            signed_prekey_id,
            signed_prekey_private,
            one_time_prekeys,
            created_at_unix_ms,
        )
    }

    fn pending_prekey_bundle(&self) -> Result<Option<PendingPreKeyBundle>, String> {
        MessagingStore::pending_prekey_bundle(self)
    }

    fn complete_prekey_publication(&self, signed_prekey_id: i32) -> Result<(), String> {
        MessagingStore::complete_prekey_publication(self, signed_prekey_id)
    }
}

impl MetadataInteractionRepository for MessagingStore {
    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingStore::authority_head(self, conversation_id)
    }

    fn message_sender(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<Option<String>, String> {
        Ok(
            MessagingStore::message_projection(self, conversation_id, message_id)?
                .map(|(projection, _)| projection.sender_ptid),
        )
    }

    fn persist_metadata_interaction(
        &self,
        commit: &MetadataInteractionCommit<'_>,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        validate_expected_authority_head(
            &transaction,
            commit.conversation_id,
            commit.expected_authority_sequence,
            commit.expected_authority_hash,
        )?;
        persist_interaction_command(
            &transaction,
            &InteractionCommandCommit {
                command_id: commit.command_id,
                conversation_id: commit.conversation_id,
                target_message_id: commit.target_message_id,
                interaction_kind: commit.interaction_kind,
                edited_text: None,
                command_bytes: commit.command_bytes,
                delivery_plan_sha256: commit.delivery_plan_sha256,
                created_at_unix_ms: commit.created_at_unix_ms,
            },
        )?;
        transaction.commit().map_err(|error| error.to_string())
    }
}

impl DirectOutboundRepository for MessagingStore {
    fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[AttachmentPlaintextMetadata],
    ) -> Result<(), String> {
        MessagingStore::validate_sender_attachments_ready(
            self,
            conversation_id,
            message_id,
            attachments,
        )
    }

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingStore::authority_head(self, conversation_id)
    }

    fn load_direct_outbound_session(
        &self,
        conversation_id: &str,
        peer: &CoreCryptoEndpoint,
    ) -> Result<Option<DirectOutboundSession>, String> {
        peer.validate()?;
        let connection = self.connection()?;
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
            .ok_or_else(|| "messaging Direct session disappeared".to_string())?;
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
        peer: &CoreCryptoEndpoint,
    ) -> Result<u64, String> {
        MessagingStore::next_direct_session_generation(self, conversation_id, peer)
    }

    fn persist_direct_outbound_send(
        &self,
        commit: &DirectOutboundSendCommit<'_>,
    ) -> Result<(), String> {
        let projection = desktop_pending_projection(&commit.projection);
        validate_pending_sender_projection(&projection)?;
        if commit.command_bytes.is_empty() || commit.session_advances.is_empty() {
            return Err("messaging Direct send requires command bytes and sessions".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        validate_expected_authority_head(
            &transaction,
            commit.projection.conversation_id,
            commit.expected_authority_sequence,
            commit.expected_authority_hash,
        )?;
        persist_prepared_command(&transaction, commit.command_bytes, &projection)?;
        persist_direct_session_advances(
            &transaction,
            commit.session_advances,
            commit.projection.conversation_id,
            commit.projection.sender_ptid,
            commit.projection.sender_device_id,
        )?;
        transaction.commit().map_err(|error| error.to_string())
    }

    fn persist_direct_outbound_edit(
        &self,
        commit: &DirectOutboundEditCommit<'_>,
    ) -> Result<(), String> {
        if commit.session_advances.is_empty() {
            return Err("messaging Direct edit requires sessions".to_string());
        }
        let interaction = InteractionCommandCommit {
            command_id: commit.command_id,
            conversation_id: commit.conversation_id,
            target_message_id: commit.target_message_id,
            interaction_kind: "edit",
            edited_text: Some(commit.edited_text),
            command_bytes: commit.command_bytes,
            delivery_plan_sha256: commit.delivery_plan_sha256,
            created_at_unix_ms: commit.created_at_unix_ms,
        };
        let first = commit
            .session_advances
            .first()
            .ok_or_else(|| "messaging Direct edit requires sessions".to_string())?;
        let local = &first.advanced.key.local;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        validate_expected_authority_head(
            &transaction,
            commit.conversation_id,
            commit.expected_authority_sequence,
            commit.expected_authority_hash,
        )?;
        persist_interaction_command(&transaction, &interaction)?;
        persist_direct_session_advances(
            &transaction,
            commit.session_advances,
            commit.conversation_id,
            &local.ptid,
            &local.device_id,
        )?;
        transaction.commit().map_err(|error| error.to_string())
    }
}

impl MlsKeyPackageRepository for MessagingStore {
    fn has_mls_key_packages(&self) -> Result<bool, String> {
        MessagingStore::has_mls_key_packages(self)
    }

    fn install_fresh_mls_key_packages(
        &self,
        packages: &[Vec<u8>],
        provider_pool_state: &[u8],
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        MessagingStore::install_fresh_mls_key_packages(
            self,
            packages,
            provider_pool_state,
            created_at_unix_ms,
        )
    }

    fn pending_mls_key_packages(&self) -> Result<Vec<CorePendingMlsKeyPackage>, String> {
        MessagingStore::pending_mls_key_packages(self)
    }

    fn complete_mls_key_package_publication(&self, package_id: &str) -> Result<(), String> {
        MessagingStore::complete_mls_key_package_publication(self, package_id)
    }
}

impl MlsTransitionRepository for MessagingStore {
    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingStore::authority_head(self, conversation_id)
    }

    fn persist_mls_transition(&self, commit: &MlsTransitionSendCommit<'_>) -> Result<(), String> {
        MessagingStore::persist_mls_transition(self, commit)
    }
}

impl MlsStartupRepository for MessagingStore {
    fn list_mls_session_states(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        MessagingStore::list_mls_session_states(self)
    }

    fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String> {
        MessagingStore::load_mls_join_provider_pool(self)
    }

    fn list_pending_mls_transitions(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        MessagingStore::list_pending_mls_transition_states(self)
    }
}

impl MlsOutboundRepository for MessagingStore {
    fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[AttachmentPlaintextMetadata],
    ) -> Result<(), String> {
        MessagingStore::validate_sender_attachments_ready(
            self,
            conversation_id,
            message_id,
            attachments,
        )
    }

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingStore::authority_head(self, conversation_id)
    }

    fn persist_mls_outbound_send(&self, commit: &MlsOutboundSendCommit<'_>) -> Result<(), String> {
        MessagingStore::persist_mls_send(
            self,
            &MlsSendCommit {
                command_bytes: commit.command_bytes,
                expected_authority_sequence: commit.expected_authority_sequence,
                expected_authority_hash: commit.expected_authority_hash,
                session_state: commit.session_state,
                membership_epoch: commit.membership_epoch,
                mls_epoch: commit.mls_epoch,
                projection: PendingSenderProjection {
                    command_id: commit.projection.command_id,
                    conversation_id: commit.projection.conversation_id,
                    conversation_kind: commit.projection.conversation_kind,
                    message_id: commit.projection.message_id,
                    sender_ptid: commit.projection.sender_ptid,
                    sender_device_id: commit.projection.sender_device_id,
                    plaintext: commit.projection.plaintext,
                    reply_to_message_id: commit.projection.reply_to_message_id,
                    thread_root_message_id: commit.projection.thread_root_message_id,
                    attachments: commit.projection.attachments,
                    private_content: commit.projection.private_content,
                    delivery_plan_sha256: commit.projection.delivery_plan_sha256,
                    created_at_unix_ms: commit.projection.created_at_unix_ms,
                },
            },
        )
    }

    fn persist_mls_outbound_edit(&self, commit: &MlsOutboundEditCommit<'_>) -> Result<(), String> {
        MessagingStore::persist_mls_interaction_command(
            self,
            &InteractionCommandCommit {
                command_id: commit.command_id,
                conversation_id: commit.conversation_id,
                target_message_id: commit.target_message_id,
                interaction_kind: "edit",
                edited_text: Some(commit.edited_text),
                command_bytes: commit.command_bytes,
                delivery_plan_sha256: commit.delivery_plan_sha256,
                created_at_unix_ms: commit.created_at_unix_ms,
            },
            commit.session_state,
            commit.membership_epoch,
            commit.mls_epoch,
            commit.expected_authority_sequence,
            commit.expected_authority_hash,
        )
    }
}

impl MlsInboundRepository for MessagingStore {
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
        MessagingStore::persist_claimed_item(
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
        MessagingStore::consumption_marker_matches(self, item_id, payload_sha256)
    }

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        MessagingStore::authority_head(self, conversation_id)
    }

    fn load_mls_session_state(&self, conversation_id: &str) -> Result<Option<Vec<u8>>, String> {
        MessagingStore::load_mls_session_state(self, conversation_id)
    }

    fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String> {
        MessagingStore::load_mls_join_provider_pool(self)
    }

    fn has_mls_retired_checkpoint(&self, conversation_id: &str) -> Result<bool, String> {
        MessagingStore::has_mls_retired_checkpoint(self, conversation_id)
    }

    fn pending_mls_transition(
        &self,
        conversation_id: &str,
    ) -> Result<Option<CorePendingMlsTransitionState>, String> {
        Ok(
            MessagingStore::pending_mls_transition(self, conversation_id)?.map(|pending| {
                CorePendingMlsTransitionState {
                    transition_id: pending.transition_id,
                    command_id: pending.command_id,
                    state: pending.state,
                }
            }),
        )
    }

    fn commit_interaction_event(
        &self,
        commit: &CoreInteractionReceiveCommit<'_>,
    ) -> Result<CoreReceiveCommitResult, String> {
        let mutation = match &commit.mutation {
            CoreInteractionMutation::Edit {
                edited_text,
                edited_at_unix_ms,
            } => InteractionMutation::Edit {
                edited_text,
                edited_at_unix_ms: *edited_at_unix_ms,
            },
            CoreInteractionMutation::Retract => InteractionMutation::Retract,
            CoreInteractionMutation::Reaction {
                actor_ptid,
                reaction,
                removed,
                created_at_unix_ms,
            } => InteractionMutation::Reaction {
                actor_ptid,
                reaction,
                removed: *removed,
                created_at_unix_ms: *created_at_unix_ms,
            },
            CoreInteractionMutation::Pin {
                actor_ptid,
                removed,
                pinned_at_unix_ms,
            } => InteractionMutation::Pin {
                actor_ptid,
                removed: *removed,
                pinned_at_unix_ms: *pinned_at_unix_ms,
            },
        };
        map_receive_result(MessagingStore::commit_interaction_event(
            self,
            &InteractionReceiveCommit {
                item_id: commit.item_id,
                event_id: commit.event_id,
                command_id: commit.command_id,
                conversation_id: commit.conversation_id,
                event_sequence: commit.event_sequence,
                lane_sequence: commit.lane_sequence,
                consumer_epoch: commit.consumer_epoch,
                payload_sha256: commit.payload_sha256,
                event_hash: commit.event_hash,
                previous_event_hash: commit.previous_event_hash,
                message_id: commit.message_id,
                mutation,
                mls_session_state: commit.mls_session_state,
                membership_epoch: commit.membership_epoch,
                mls_epoch: commit.mls_epoch,
                receipt_id: commit.receipt_id,
                receipt_bytes: commit.receipt_bytes,
                consumed_at_unix_ms: commit.consumed_at_unix_ms,
            },
        )?)
    }

    fn commit_mls_application(
        &self,
        commit: &MlsApplicationReceiveCommit<'_>,
    ) -> Result<CoreReceiveCommitResult, String> {
        let projection = MessageProjection {
            conversation_id: commit.projection.conversation_id.clone(),
            event_id: commit.projection.event_id.clone(),
            event_sequence: commit.projection.event_sequence,
            message_id: commit.projection.message_id.clone(),
            sender_ptid: commit.projection.sender_ptid.clone(),
            sender_device_id: commit.projection.sender_device_id.clone(),
            plaintext: commit.projection.plaintext.clone(),
            attachments: commit.projection.attachments.clone(),
            committed_at_unix_ms: commit.projection.committed_at_unix_ms,
            reply_to_message_id: commit.projection.reply_to_message_id.clone(),
            thread_root_message_id: commit.projection.thread_root_message_id.clone(),
            edited_text: None,
            edited_at_unix_ms: None,
            retracted: false,
        };
        map_receive_result(MessagingStore::commit_mls_receive(
            self,
            &MlsReceiveCommit {
                item_id: commit.item_id,
                event_id: commit.event_id,
                conversation_id: commit.conversation_id,
                lane_sequence: commit.lane_sequence,
                consumer_epoch: commit.consumer_epoch,
                payload_sha256: commit.payload_sha256,
                event_hash: commit.event_hash,
                previous_event_hash: commit.previous_event_hash,
                session_state: commit.session_state,
                membership_epoch: commit.membership_epoch,
                mls_epoch: commit.mls_epoch,
                projection: &projection,
                reply_to_message_id: projection.reply_to_message_id.as_deref(),
                thread_root_message_id: projection.thread_root_message_id.as_deref(),
                receipt_id: commit.receipt_id,
                receipt_bytes: commit.receipt_bytes,
                consumed_at_unix_ms: commit.consumed_at_unix_ms,
            },
        )?)
    }

    fn commit_mls_transition_receive(
        &self,
        commit: &CoreMlsTransitionReceiveCommit<'_>,
    ) -> Result<CoreReceiveCommitResult, String> {
        let projection = commit.join_projection.map(desktop_conversation_projection);
        map_receive_result(MessagingStore::commit_mls_transition(
            self,
            &MlsTransitionReceiveCommit {
                item_id: commit.item_id,
                event_id: commit.event_id,
                conversation_id: commit.conversation_id,
                event_sequence: commit.event_sequence,
                lane_sequence: commit.lane_sequence,
                consumer_epoch: commit.consumer_epoch,
                payload_sha256: commit.payload_sha256,
                event_hash: commit.event_hash,
                previous_event_hash: commit.previous_event_hash,
                transition_id: commit.transition_id,
                transition_kind: commit.transition_kind,
                session_state: commit.session_state,
                provider_pool_state: commit.provider_pool_state,
                from_membership_epoch: commit.from_membership_epoch,
                to_membership_epoch: commit.to_membership_epoch,
                from_mls_epoch: commit.from_mls_epoch,
                to_mls_epoch: commit.to_mls_epoch,
                join_projection: projection.as_ref(),
                receipt_id: commit.receipt_id,
                receipt_bytes: commit.receipt_bytes,
                consumed_at_unix_ms: commit.consumed_at_unix_ms,
            },
        )?)
    }

    fn commit_mls_sender_transition(
        &self,
        commit: &CoreMlsSenderTransitionReceiveCommit<'_>,
    ) -> Result<CoreReceiveCommitResult, String> {
        map_receive_result(MessagingStore::commit_mls_sender_transition(
            self,
            &MlsSenderTransitionReceiveCommit {
                item_id: commit.item_id,
                event_id: commit.event_id,
                conversation_id: commit.conversation_id,
                command_id: commit.command_id,
                transition_id: commit.transition_id,
                event_sequence: commit.event_sequence,
                lane_sequence: commit.lane_sequence,
                consumer_epoch: commit.consumer_epoch,
                payload_sha256: commit.payload_sha256,
                event_hash: commit.event_hash,
                previous_event_hash: commit.previous_event_hash,
                session_state: commit.session_state,
                membership_epoch: commit.membership_epoch,
                mls_epoch: commit.mls_epoch,
                receipt_id: commit.receipt_id,
                receipt_bytes: commit.receipt_bytes,
                consumed_at_unix_ms: commit.consumed_at_unix_ms,
            },
        )?)
    }

    fn commit_mls_retirement(
        &self,
        commit: &CoreMlsRetirementReceiveCommit<'_>,
    ) -> Result<CoreReceiveCommitResult, String> {
        let projection = desktop_conversation_projection(commit.projection);
        map_receive_result(MessagingStore::commit_mls_retirement(
            self,
            &MlsRetirementReceiveCommit {
                item_id: commit.item_id,
                event_id: commit.event_id,
                conversation_id: commit.conversation_id,
                event_sequence: commit.event_sequence,
                lane_sequence: commit.lane_sequence,
                consumer_epoch: commit.consumer_epoch,
                payload_sha256: commit.payload_sha256,
                event_hash: commit.event_hash,
                previous_event_hash: commit.previous_event_hash,
                transition_id: commit.transition_id,
                endpoint_ptid: commit.endpoint_ptid,
                endpoint_device_id: commit.endpoint_device_id,
                membership_epoch: commit.membership_epoch,
                mls_epoch: commit.mls_epoch,
                projection: &projection,
                receipt_id: commit.receipt_id,
                receipt_bytes: commit.receipt_bytes,
                consumed_at_unix_ms: commit.consumed_at_unix_ms,
            },
        )?)
    }
}

fn desktop_conversation_projection(
    projection: &MlsConversationProjection,
) -> ConversationProjection {
    ConversationProjection {
        conversation_id: projection.conversation_id.clone(),
        authority_station_id: projection.authority_station_id.clone(),
        kind: projection.kind,
        name: projection.name.clone(),
        owner_ptid: projection.owner_ptid.clone(),
        members: projection
            .members
            .iter()
            .map(|member| ConversationMemberProjection {
                ptid: member.ptid.clone(),
                role: member.role,
            })
            .collect(),
        membership_epoch: projection.membership_epoch,
        mls_epoch: projection.mls_epoch,
        active: projection.active,
        updated_at_unix_ms: projection.updated_at_unix_ms,
    }
}

fn map_receive_result(result: ReceiveCommitResult) -> Result<CoreReceiveCommitResult, String> {
    Ok(match result {
        ReceiveCommitResult::Committed => CoreReceiveCommitResult::Committed,
        ReceiveCommitResult::AlreadyCommitted => CoreReceiveCommitResult::AlreadyCommitted,
    })
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
             ORDER BY created_at_unix_ms ASC",
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

fn load_pins_for_conversation(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<(String, String, i64)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT message_id, actor_ptid, pinned_at_unix_ms
             FROM message_pins
             WHERE conversation_id = ?1
             ORDER BY pinned_at_unix_ms ASC",
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

fn commit_subsumed_receive(
    transaction: &Transaction<'_>,
    input: &ReceiveCommitCore<'_>,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO messaging_consumption_markers(
                item_id, event_id, conversation_id, payload_sha256, consumed_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                input.item_id,
                input.event_id,
                input.conversation_id,
                input.payload_sha256,
                input.consumed_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO messaging_lane_cursor(id, lane_sequence, consumer_epoch, updated_at_unix_ms)
             VALUES (1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                lane_sequence=excluded.lane_sequence,
                consumer_epoch=excluded.consumer_epoch,
                updated_at_unix_ms=excluded.updated_at_unix_ms",
            params![
                input.lane_sequence,
                i64::try_from(input.consumer_epoch).map_err(|_| "consumer epoch exceeds i64")?,
                input.consumed_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE messaging_inbox_items SET state = 'consumed' WHERE item_id = ?1",
            params![input.item_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO messaging_receipt_outbox(
                receipt_id, event_id, receipt_bytes, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'pending', ?4)",
            params![
                input.receipt_id,
                input.event_id,
                input.receipt_bytes,
                input.consumed_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn direct_receive_core<'a>(input: &'a DirectReceiveCommit<'a>) -> ReceiveCommitCore<'a> {
    ReceiveCommitCore {
        item_id: input.item_id,
        event_id: input.event_id,
        conversation_id: input.conversation_id,
        lane_sequence: input.lane_sequence,
        consumer_epoch: input.consumer_epoch,
        payload_sha256: input.payload_sha256,
        event_hash: input.event_hash,
        previous_event_hash: input.previous_event_hash,
        event_sequence: input.projection.event_sequence,
        allow_join_checkpoint: false,
        projection: Some(input.projection),
        receipt_id: input.receipt_id,
        receipt_bytes: input.receipt_bytes,
        consumed_at_unix_ms: input.consumed_at_unix_ms,
    }
}

fn public_event_receive_core<'a>(input: &'a PublicEventReceiveCommit<'a>) -> ReceiveCommitCore<'a> {
    ReceiveCommitCore {
        item_id: input.item_id,
        event_id: input.event_id,
        conversation_id: input.conversation_id,
        lane_sequence: input.lane_sequence,
        consumer_epoch: input.consumer_epoch,
        payload_sha256: input.payload_sha256,
        event_hash: input.event_hash,
        previous_event_hash: input.previous_event_hash,
        event_sequence: input.event_sequence,
        allow_join_checkpoint: false,
        projection: None,
        receipt_id: input.receipt_id,
        receipt_bytes: input.receipt_bytes,
        consumed_at_unix_ms: input.consumed_at_unix_ms,
    }
}

fn conversation_state_receive_core<'a>(
    input: &'a ConversationStateReceiveCommit<'a>,
) -> ReceiveCommitCore<'a> {
    ReceiveCommitCore {
        item_id: input.item_id,
        event_id: input.event_id,
        conversation_id: input.conversation_id,
        lane_sequence: input.lane_sequence,
        consumer_epoch: input.consumer_epoch,
        payload_sha256: input.payload_sha256,
        event_hash: input.event_hash,
        previous_event_hash: input.previous_event_hash,
        event_sequence: input.event_sequence,
        allow_join_checkpoint: false,
        projection: None,
        receipt_id: input.receipt_id,
        receipt_bytes: input.receipt_bytes,
        consumed_at_unix_ms: input.consumed_at_unix_ms,
    }
}

fn mls_sender_transition_receive_core<'a>(
    input: &'a MlsSenderTransitionReceiveCommit<'a>,
) -> ReceiveCommitCore<'a> {
    ReceiveCommitCore {
        item_id: input.item_id,
        event_id: input.event_id,
        conversation_id: input.conversation_id,
        lane_sequence: input.lane_sequence,
        consumer_epoch: input.consumer_epoch,
        payload_sha256: input.payload_sha256,
        event_hash: input.event_hash,
        previous_event_hash: input.previous_event_hash,
        event_sequence: input.event_sequence,
        allow_join_checkpoint: false,
        projection: None,
        receipt_id: input.receipt_id,
        receipt_bytes: input.receipt_bytes,
        consumed_at_unix_ms: input.consumed_at_unix_ms,
    }
}

fn mls_receive_core<'a>(input: &'a MlsReceiveCommit<'a>) -> ReceiveCommitCore<'a> {
    ReceiveCommitCore {
        item_id: input.item_id,
        event_id: input.event_id,
        conversation_id: input.conversation_id,
        lane_sequence: input.lane_sequence,
        consumer_epoch: input.consumer_epoch,
        payload_sha256: input.payload_sha256,
        event_hash: input.event_hash,
        previous_event_hash: input.previous_event_hash,
        event_sequence: input.projection.event_sequence,
        allow_join_checkpoint: false,
        projection: Some(input.projection),
        receipt_id: input.receipt_id,
        receipt_bytes: input.receipt_bytes,
        consumed_at_unix_ms: input.consumed_at_unix_ms,
    }
}

fn mls_transition_receive_core<'a>(
    input: &'a MlsTransitionReceiveCommit<'a>,
) -> ReceiveCommitCore<'a> {
    ReceiveCommitCore {
        item_id: input.item_id,
        event_id: input.event_id,
        conversation_id: input.conversation_id,
        lane_sequence: input.lane_sequence,
        consumer_epoch: input.consumer_epoch,
        payload_sha256: input.payload_sha256,
        event_hash: input.event_hash,
        previous_event_hash: input.previous_event_hash,
        event_sequence: input.event_sequence,
        allow_join_checkpoint: input.join_projection.is_some(),
        projection: None,
        receipt_id: input.receipt_id,
        receipt_bytes: input.receipt_bytes,
        consumed_at_unix_ms: input.consumed_at_unix_ms,
    }
}

fn mls_retirement_receive_core<'a>(
    input: &'a MlsRetirementReceiveCommit<'a>,
) -> ReceiveCommitCore<'a> {
    ReceiveCommitCore {
        item_id: input.item_id,
        event_id: input.event_id,
        conversation_id: input.conversation_id,
        lane_sequence: input.lane_sequence,
        consumer_epoch: input.consumer_epoch,
        payload_sha256: input.payload_sha256,
        event_hash: input.event_hash,
        previous_event_hash: input.previous_event_hash,
        event_sequence: input.event_sequence,
        allow_join_checkpoint: false,
        projection: None,
        receipt_id: input.receipt_id,
        receipt_bytes: input.receipt_bytes,
        consumed_at_unix_ms: input.consumed_at_unix_ms,
    }
}

fn validate_direct_receive(input: &DirectReceiveCommit<'_>) -> Result<(), String> {
    validate_receive_core(&direct_receive_core(input))?;
    input
        .session
        .key
        .validate()
        .map_err(|error| error.to_string())?;
    if input.session.key.conversation_id != input.conversation_id {
        return Err("messaging direct session conversation mismatch".to_string());
    }
    Ok(())
}

fn validate_public_event_receive(input: &PublicEventReceiveCommit<'_>) -> Result<(), String> {
    validate_receive_core(&public_event_receive_core(input))?;
    if input.command_id.trim().is_empty()
        || input.message_id.trim().is_empty()
        || input.sender_ptid.trim().is_empty()
        || input.sender_device_id.trim().is_empty()
        || input.committed_at_unix_ms <= 0
    {
        return Err("messaging public-event receive input is incomplete".to_string());
    }
    Ok(())
}

fn validate_conversation_state_receive(
    input: &ConversationStateReceiveCommit<'_>,
) -> Result<(), String> {
    validate_receive_core(&conversation_state_receive_core(input))?;
    let projection = input.projection;
    let kind = ConversationKind::try_from(projection.kind)
        .map_err(|_| "messaging conversation-state kind is invalid".to_string())?;
    if projection.conversation_id != input.conversation_id
        || projection.authority_station_id.trim().is_empty()
        || kind == ConversationKind::Unspecified
        || projection.owner_ptid.trim().is_empty()
        || projection.members.len() < 2
        || projection.membership_epoch < 0
        || projection.mls_epoch < 0
        || projection.updated_at_unix_ms <= 0
        || !projection.active
    {
        return Err("messaging conversation-state receive input is incomplete".to_string());
    }
    let mut previous = None;
    for member in &projection.members {
        if member.ptid.trim().is_empty()
            || !matches!(
                MemberRole::try_from(member.role),
                Ok(MemberRole::Member | MemberRole::Admin | MemberRole::Owner)
            )
            || previous
                .as_ref()
                .is_some_and(|value: &&String| value.as_str() >= member.ptid.as_str())
        {
            return Err("messaging conversation members are not strictly sorted".to_string());
        }
        previous = Some(&member.ptid);
    }
    match kind {
        ConversationKind::Direct => {
            if projection.members.len() != 2
                || projection.members[0].ptid != projection.owner_ptid
                || projection
                    .members
                    .iter()
                    .any(|member| member.role != MemberRole::Member as i32)
            {
                return Err(
                    "messaging Direct conversation membership projection is invalid".to_string(),
                );
            }
        }
        ConversationKind::Group => {
            if projection
                .members
                .iter()
                .filter(|member| member.role == MemberRole::Owner as i32)
                .count()
                != 1
                || !projection.members.iter().any(|member| {
                    member.ptid == projection.owner_ptid && member.role == MemberRole::Owner as i32
                })
            {
                return Err("messaging Group owner role is not projected".to_string());
            }
        }
        ConversationKind::Unspecified => unreachable!(),
    }
    Ok(())
}

fn validate_mls_receive(input: &MlsReceiveCommit<'_>) -> Result<(), String> {
    validate_receive_core(&mls_receive_core(input))?;
    if input.session_state.is_empty() || input.membership_epoch < 0 || input.mls_epoch < 0 {
        return Err("messaging MLS receive state is incomplete".to_string());
    }
    Ok(())
}

fn validate_mls_sender_transition_receive(
    input: &MlsSenderTransitionReceiveCommit<'_>,
) -> Result<(), String> {
    validate_receive_core(&mls_sender_transition_receive_core(input))?;
    if input.command_id.trim().is_empty()
        || input.transition_id.trim().is_empty()
        || input.session_state.is_empty()
        || input.membership_epoch <= 0
        || input.mls_epoch <= 0
    {
        return Err("messaging MLS sender transition input is incomplete".to_string());
    }
    Ok(())
}

fn validate_mls_transition_receive(input: &MlsTransitionReceiveCommit<'_>) -> Result<(), String> {
    validate_receive_core(&mls_transition_receive_core(input))?;
    if input.transition_id.trim().is_empty()
        || input.transition_kind == 0
        || input.session_state.is_empty()
        || input.from_membership_epoch < 0
        || input.to_membership_epoch <= input.from_membership_epoch
        || input.from_mls_epoch < 0
        || input.to_mls_epoch <= input.from_mls_epoch
    {
        return Err("messaging MLS transition state is incomplete".to_string());
    }
    Ok(())
}

fn validate_receive_core(input: &ReceiveCommitCore<'_>) -> Result<(), String> {
    let projection_invalid = input.projection.is_some_and(|projection| {
        projection.conversation_id != input.conversation_id
            || projection.event_id != input.event_id
            || projection.event_sequence != input.event_sequence
            || projection.message_id.trim().is_empty()
    });
    if input.item_id.trim().is_empty()
        || input.event_id.trim().is_empty()
        || input.conversation_id.trim().is_empty()
        || input.lane_sequence <= 0
        || input.consumer_epoch == 0
        || input.payload_sha256.len() != 32
        || input.event_hash.len() != 32
        || (!input.previous_event_hash.is_empty() && input.previous_event_hash.len() != 32)
        || input.event_sequence <= 0
        || projection_invalid
        || input.receipt_id.trim().is_empty()
        || input.receipt_bytes.is_empty()
    {
        return Err("messaging receive input is incomplete".to_string());
    }
    Ok(())
}

fn validate_pending_sender_projection(
    projection: &PendingSenderProjection<'_>,
) -> Result<(), String> {
    if projection.command_id.trim().is_empty()
        || projection.conversation_id.trim().is_empty()
        || projection.message_id.trim().is_empty()
        || projection.sender_ptid.trim().is_empty()
        || projection.sender_device_id.trim().is_empty()
        || projection.delivery_plan_sha256.len() != 32
        || projection.created_at_unix_ms <= 0
    {
        return Err("messaging pending sender projection is incomplete".to_string());
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
        return Err("messaging command transition identity is incomplete".to_string());
    }
    let row = transaction
        .query_row(
            "SELECT l.command_bytes, l.state, o.command_bytes, o.state, o.attempt_count
             FROM messaging_local_commands l
             JOIN messaging_command_outbox o ON o.command_id = l.command_id
             WHERE l.command_id = ?1",
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
        .ok_or_else(|| "messaging command transition state is unavailable".to_string())?;
    if row.0 != command_bytes || row.2 != command_bytes {
        return Err("messaging command transition bytes mismatch".to_string());
    }
    Ok(CommandTransitionState {
        local_state: row.1,
        outbox_state: row.3,
        attempt_count: u32::try_from(row.4)
            .map_err(|_| "messaging command attempt count is invalid".to_string())?,
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

fn persist_sender_content(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    message_id: &str,
    plaintext: &str,
    attachments: &[AttachmentPlaintextMetadata],
    private_content: &[u8],
) -> Result<(), String> {
    let decoded = super::private_content::decode_message_private_content(private_content)?;
    if decoded.text != plaintext || decoded.attachments != attachments {
        return Err("messaging sender private content does not match projection".to_string());
    }
    for attachment in attachments {
        let object = attachment
            .object
            .as_ref()
            .ok_or_else(|| "messaging attachment descriptor is missing".to_string())?;
        let changed = transaction
            .execute(
                "INSERT INTO messaging_attachment_projections(
                    message_id, attachment_id, object_id, storage_ref,
                    filename, mime_type, plaintext_size, plaintext_sha256,
                    object_key, base_nonce, descriptor_bytes,
                    availability_state, local_cache_path
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    'local', NULL
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
                        .map_err(|_| "attachment plaintext size exceeds i64")?,
                    attachment.plaintext_sha256,
                    attachment.object_key,
                    attachment.base_nonce,
                    object.encode_to_vec(),
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("messaging sender attachment projection conflicts".to_string());
        }
    }
    let stored_count = transaction
        .query_row(
            "SELECT COUNT(*) FROM messaging_attachment_projections WHERE message_id = ?1",
            params![message_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if stored_count
        != i64::try_from(attachments.len()).map_err(|_| "messaging attachment count exceeds i64")?
    {
        return Err("messaging sender attachment set conflicts".to_string());
    }
    transaction
        .execute(
            "DELETE FROM messaging_message_search_fts
             WHERE conversation_id = ?1 AND message_id = ?2",
            params![conversation_id, message_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
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
                    .join("\n"),
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_attachment_metadata(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<AttachmentPlaintextMetadata>, String> {
    let mut statement = connection
        .prepare(
            "SELECT attachment_id, filename, mime_type, plaintext_size,
                    plaintext_sha256, object_key, base_nonce, descriptor_bytes
             FROM messaging_attachment_projections
             WHERE message_id = ?1
             ORDER BY attachment_id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![message_id], |row| {
            let descriptor_bytes = row.get::<_, Vec<u8>>(7)?;
            let object = EncryptedObjectDescriptor::decode(descriptor_bytes.as_slice()).map_err(
                |error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        descriptor_bytes.len(),
                        rusqlite::types::Type::Blob,
                        Box::new(error),
                    )
                },
            )?;
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
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for attachment in &rows {
        super::private_content::validate_attachment_plaintext_metadata(attachment)?;
    }
    Ok(rows)
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
    let rows = statement
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
    if rows.len() != total as usize {
        return Err("messaging attachment uploads are not complete".to_string());
    }
    for attachment in &rows {
        super::private_content::validate_attachment_plaintext_metadata(attachment)?;
    }
    Ok(rows)
}

fn load_pending_message_attachments(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<AttachmentPlaintextMetadata>, String> {
    let canonical = load_attachment_metadata(connection, message_id)?;
    if !canonical.is_empty() {
        return Ok(canonical);
    }
    load_staged_attachment_metadata(connection, message_id)
}

fn load_visible_message_attachments(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<AttachmentPlaintextMetadata>, String> {
    let canonical = load_attachment_metadata(connection, message_id)?;
    if !canonical.is_empty() {
        return Ok(canonical);
    }
    let (total, complete) = connection
        .query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN descriptor_bytes IS NOT NULL THEN 1 ELSE 0 END)
             FROM messaging_attachment_drafts
             WHERE message_id = ?1",
            params![message_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    if total == 0 || total != complete {
        return Ok(Vec::new());
    }
    load_staged_attachment_metadata(connection, message_id)
}

fn persist_prepared_command(
    transaction: &Transaction<'_>,
    command_bytes: &[u8],
    projection: &PendingSenderProjection<'_>,
) -> Result<(), String> {
    let local_changed = transaction
        .execute(
            "INSERT INTO messaging_local_commands(
                command_id, conversation_id, command_bytes, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'prepared', ?4)",
            params![
                projection.command_id,
                projection.conversation_id,
                command_bytes,
                projection.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    if local_changed != 1 {
        return Err("messaging local command was not persisted".to_string());
    }
    let outbox_changed = transaction
        .execute(
            "INSERT INTO messaging_command_outbox(
                command_id, conversation_id, command_bytes, state,
                attempt_count, next_attempt_at_unix_ms, last_error_code,
                created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'pending', 0, ?4, '', ?4)",
            params![
                projection.command_id,
                projection.conversation_id,
                command_bytes,
                projection.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    if outbox_changed != 1 {
        return Err("messaging command outbox was not persisted".to_string());
    }
    let pending_changed = transaction
        .execute(
            "INSERT INTO messaging_pending_messages(
                conversation_id, conversation_kind, message_id, sender_ptid,
                sender_device_id, plaintext, reply_to_message_id,
                thread_root_message_id, state, attempt_count,
                next_attempt_at_unix_ms, last_error_code, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', 0, ?9, '', ?9)
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
    if pending_changed != 1 {
        return Err("messaging pending logical message conflicts with existing draft".to_string());
    }
    persist_sender_content(
        transaction,
        projection.conversation_id,
        projection.message_id,
        projection.plaintext,
        projection.attachments,
        projection.private_content,
    )?;
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
        return Err("messaging staged attachment promotion mismatch".to_string());
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

fn persist_interaction_command(
    transaction: &Transaction<'_>,
    input: &InteractionCommandCommit<'_>,
) -> Result<(), String> {
    if input.command_id.trim().is_empty()
        || input.conversation_id.trim().is_empty()
        || input.target_message_id.trim().is_empty()
        || input.interaction_kind.trim().is_empty()
        || input.command_bytes.is_empty()
        || input.delivery_plan_sha256.len() != 32
        || input.created_at_unix_ms <= 0
        || (input.interaction_kind == "edit"
            && input
                .edited_text
                .is_none_or(|value| value.trim().is_empty()))
        || (input.interaction_kind != "edit" && input.edited_text.is_some())
    {
        return Err("messaging interaction command is incomplete".to_string());
    }
    transaction
        .execute(
            "INSERT INTO messaging_local_commands(
                command_id, conversation_id, command_bytes, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'prepared', ?4)",
            params![
                input.command_id,
                input.conversation_id,
                input.command_bytes,
                input.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO messaging_command_outbox(
                command_id, conversation_id, command_bytes, state,
                attempt_count, next_attempt_at_unix_ms,
                last_error_code, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, 'pending', 0, ?4, '', ?4)",
            params![
                input.command_id,
                input.conversation_id,
                input.command_bytes,
                input.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO messaging_command_attempts(
                command_id, conversation_id, message_id,
                delivery_plan_sha256, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, 'prepared', ?5)",
            params![
                input.command_id,
                input.conversation_id,
                input.target_message_id,
                input.delivery_plan_sha256,
                input.created_at_unix_ms
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
                input.command_id,
                input.conversation_id,
                input.target_message_id,
                input.interaction_kind,
                input.edited_text,
                input.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn desktop_pending_projection<'a>(
    projection: &'a CorePendingSenderProjection<'a>,
) -> PendingSenderProjection<'a> {
    PendingSenderProjection {
        command_id: projection.command_id,
        conversation_id: projection.conversation_id,
        conversation_kind: projection.conversation_kind,
        message_id: projection.message_id,
        sender_ptid: projection.sender_ptid,
        sender_device_id: projection.sender_device_id,
        plaintext: projection.plaintext,
        reply_to_message_id: projection.reply_to_message_id,
        thread_root_message_id: projection.thread_root_message_id,
        attachments: projection.attachments,
        private_content: projection.private_content,
        delivery_plan_sha256: projection.delivery_plan_sha256,
        created_at_unix_ms: projection.created_at_unix_ms,
    }
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
        return Err("messaging expected authority head is invalid".to_string());
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
        return Err("messaging local authority head changed during send preparation".to_string());
    }
    Ok(())
}

fn persist_direct_session_advances(
    transaction: &Transaction<'_>,
    advances: &[DirectSessionAdvance],
    conversation_id: &str,
    sender_ptid: &str,
    sender_device_id: &str,
) -> Result<(), String> {
    let mut session_ids = HashSet::with_capacity(advances.len());
    let mut peer_keys = HashSet::with_capacity(advances.len());
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
            return Err("messaging Direct session advance binding mismatch".to_string());
        }

        match advance.previous.as_ref() {
            Some(previous) => {
                if previous.session_id != advanced.session_id
                    || previous.key != advanced.key
                    || !previous.established
                {
                    return Err("messaging Direct previous session binding mismatch".to_string());
                }
                let current = load_direct_session(transaction, &advanced.session_id)?
                    .ok_or_else(|| "messaging Direct previous session disappeared".to_string())?;
                if !direct_session_state_matches(&current, previous) {
                    return Err(
                        "messaging Direct session changed during send preparation".to_string()
                    );
                }
            }
            None => {
                if advance.session_init.is_none() {
                    return Err("messaging Direct new session requires bootstrap bytes".to_string());
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
                        "messaging Direct new session conflicts with durable state".to_string()
                    );
                }
            }
        }

        upsert_direct_session(transaction, advanced)?;
        if let Some(init_bytes) = advance.session_init.as_ref() {
            if init_bytes.is_empty() {
                return Err("messaging Direct session init is empty".to_string());
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
                return Err("messaging Direct session init conflicts with stored bytes".to_string());
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

fn optional_key(value: &Option<[u8; 32]>) -> Option<&[u8]> {
    value.as_ref().map(|bytes| bytes.as_slice())
}

fn fixed_key(label: &str, value: Vec<u8>) -> Result<[u8; 32], String> {
    value
        .try_into()
        .map_err(|value: Vec<u8>| format!("{label}: expected 32 bytes, got {}", value.len()))
}

fn upsert_direct_session(connection: &Connection, session: &DirectSession) -> Result<(), String> {
    session.key.validate().map_err(|error| error.to_string())?;
    let ratchet = &session.ratchet;
    connection
        .execute(
            "INSERT INTO direct_sessions(
                session_id, conversation_id,
                self_ptid, self_device_id, peer_ptid, peer_device_id, generation,
                protocol_version, established, peer_identity_key,
                root_key, self_private_key, self_public_key, peer_ratchet_public_key,
                send_chain_key, receive_chain_key, send_counter, receive_counter,
                previous_counter, updated_at_unix_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
             )
             ON CONFLICT(session_id) DO UPDATE SET
                conversation_id=excluded.conversation_id,
                self_ptid=excluded.self_ptid,
                self_device_id=excluded.self_device_id,
                peer_ptid=excluded.peer_ptid,
                peer_device_id=excluded.peer_device_id,
                generation=excluded.generation,
                protocol_version=excluded.protocol_version,
                established=excluded.established,
                peer_identity_key=excluded.peer_identity_key,
                root_key=excluded.root_key,
                self_private_key=excluded.self_private_key,
                self_public_key=excluded.self_public_key,
                peer_ratchet_public_key=excluded.peer_ratchet_public_key,
                send_chain_key=excluded.send_chain_key,
                receive_chain_key=excluded.receive_chain_key,
                send_counter=excluded.send_counter,
                receive_counter=excluded.receive_counter,
                previous_counter=excluded.previous_counter,
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
                session.established as i64,
                session.peer_identity_key.as_slice(),
                ratchet.root_key.as_slice(),
                ratchet.self_priv.as_slice(),
                ratchet.self_pub.as_slice(),
                optional_key(&ratchet.peer_pub),
                optional_key(&ratchet.send_chain_key),
                optional_key(&ratchet.recv_chain_key),
                i64::from(ratchet.n_send),
                i64::from(ratchet.n_recv),
                i64::from(ratchet.n_prev),
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
            "SELECT conversation_id,
                    self_ptid, self_device_id, peer_ptid, peer_device_id, generation,
                    protocol_version, established, peer_identity_key,
                    root_key, self_private_key, self_public_key, peer_ratchet_public_key,
                    send_chain_key, receive_chain_key, send_counter, receive_counter,
                    previous_counter, updated_at_unix_ms
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
                    row.get::<_, i64>(7)?,
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
    let optional_fixed = |label: &str, value: Option<Vec<u8>>| {
        value.map(|bytes| fixed_key(label, bytes)).transpose()
    };
    let key = DirectSessionKey::new(
        row.0,
        CryptoEndpoint::new(row.1, row.2).map_err(|error| error.to_string())?,
        CryptoEndpoint::new(row.3, row.4).map_err(|error| error.to_string())?,
        u64::try_from(row.5).map_err(|_| "invalid session generation")?,
    )
    .map_err(|error| error.to_string())?;
    Ok(Some(DirectSession {
        session_id: session_id.to_string(),
        key,
        protocol_version: u32::try_from(row.6).map_err(|_| "invalid protocol version")?,
        established: row.7 != 0,
        peer_identity_key: fixed_key("peer identity key", row.8)?,
        ratchet: DrSessionState {
            session_id: session_id.to_string(),
            root_key: fixed_key("root key", row.9)?,
            self_priv: fixed_key("self private key", row.10)?,
            self_pub: fixed_key("self public key", row.11)?,
            peer_pub: optional_fixed("peer ratchet public key", row.12)?,
            send_chain_key: optional_fixed("send chain key", row.13)?,
            recv_chain_key: optional_fixed("receive chain key", row.14)?,
            n_send: u32::try_from(row.15).map_err(|_| "invalid send counter")?,
            n_recv: u32::try_from(row.16).map_err(|_| "invalid receive counter")?,
            n_prev: u32::try_from(row.17).map_err(|_| "invalid previous counter")?,
        },
        updated_at_unix_ms: row.18,
    }))
}

impl AttachmentTransferRepository for MessagingStore {
    fn attachment_transfer(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentTransferRecord>, String> {
        MessagingStore::attachment_transfer(self, attachment_id)
    }

    fn attachment_upload_media_type(&self, attachment_id: &str) -> Result<String, String> {
        MessagingStore::attachment_upload_media_type(self, attachment_id)
    }

    fn update_attachment_transfer_prepared(
        &self,
        attachment_id: &str,
        descriptor_sha256: &[u8],
        partial_local_ref: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        MessagingStore::update_attachment_transfer_prepared(
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
        MessagingStore::update_attachment_transfer_progress(
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
        MessagingStore::complete_attachment_upload(self, transfer, descriptor, updated_at_unix_ms)
    }

    fn complete_attachment_download(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String> {
        MessagingStore::complete_attachment_download(
            self,
            transfer,
            descriptor,
            cache_path,
            updated_at_unix_ms,
        )
    }
}

fn fts_phrase_query(query: &str) -> Result<String, String> {
    let normalized = query.trim();
    if normalized.is_empty() || normalized.chars().count() > 256 {
        return Err("messaging search query exceeds policy".to_string());
    }
    Ok(format!("\"{}\"", normalized.replace('"', "\"\"")))
}

fn validate_attachment_transfer(transfer: &AttachmentTransferRecord) -> Result<(), String> {
    messaging_core::attachment::validate_attachment_transfer_record(transfer)
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
        Err("legacy Mobile attachment metadata cannot exist in a Desktop profile".to_string())
    }
}

fn migrate(connection: &Connection) -> Result<(), String> {
    migrate_messaging_schema(&RusqliteMessagingSchema(connection))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::crypto::IdentityKeyPair;
    use crate::messaging::private_content::test_attachment_metadata;
    use crate::model::chat::AttachmentTransferErrorCode;
    use messaging_core::identity::generate_fresh_device_identity;

    #[test]
    fn mls_key_package_repository_requires_enrollment_and_tracks_publication() {
        let store = MessagingStore::in_memory().unwrap();
        let packages = vec![b"package-a".to_vec(), b"package-b".to_vec()];
        let error = MlsKeyPackageRepository::install_fresh_mls_key_packages(
            &store,
            &packages,
            b"provider-pool",
            100,
        )
        .unwrap_err();
        assert_eq!(
            error,
            "messaging MLS KeyPackages require active device enrollment"
        );

        let identity = IdentityKeyPair::from_seed(&[12; 32]);
        let fresh = generate_fresh_device_identity("ptid:alice", identity.seed_bytes(), 1).unwrap();
        store.install_fresh_device_identity(&fresh).unwrap();
        let device_id = fresh
            .enrollment
            .certificate
            .device
            .as_ref()
            .unwrap()
            .device_id
            .clone();
        store.complete_device_enrollment(&device_id).unwrap();
        MlsKeyPackageRepository::install_fresh_mls_key_packages(
            &store,
            &packages,
            b"provider-pool",
            100,
        )
        .unwrap();

        let pending = MlsKeyPackageRepository::pending_mls_key_packages(&store).unwrap();
        assert_eq!(pending.len(), 2);
        MlsKeyPackageRepository::complete_mls_key_package_publication(
            &store,
            &pending[0].package_id,
        )
        .unwrap();
        assert_eq!(
            MlsKeyPackageRepository::pending_mls_key_packages(&store)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn conversation_projection_round_trip_preserves_member_roles() {
        let store = MessagingStore::in_memory().unwrap();
        let projection = ConversationProjection {
            conversation_id: "group-role-projection".to_string(),
            authority_station_id: "station-local".to_string(),
            kind: 2,
            name: "Role group".to_string(),
            owner_ptid: "ptid:alice".to_string(),
            members: vec![
                ConversationMemberProjection {
                    ptid: "ptid:alice".to_string(),
                    role: MemberRole::Owner as i32,
                },
                ConversationMemberProjection {
                    ptid: "ptid:bob".to_string(),
                    role: MemberRole::Admin as i32,
                },
            ],
            membership_epoch: 1,
            mls_epoch: 1,
            active: true,
            updated_at_unix_ms: 100,
        };

        assert!(store
            .bootstrap_conversation_projection(&projection)
            .unwrap());
        assert_eq!(
            store.conversation_projections().unwrap()[0].members,
            projection.members
        );
    }

    #[test]
    fn command_status_projects_terminal_outbox_state() {
        let store = MessagingStore::in_memory().unwrap();
        let connection = store.connection().unwrap();
        connection
            .execute(
                "INSERT INTO messaging_local_commands(
                    command_id, conversation_id, command_bytes, state, created_at_unix_ms
                 ) VALUES ('group-command', 'group-1', X'01', 'failed', 100)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_command_outbox(
                    command_id, conversation_id, command_bytes, state,
                    attempt_count, next_attempt_at_unix_ms, last_error_code,
                    created_at_unix_ms
                 ) VALUES ('group-command', 'group-1', X'01', 'failed', 1, 0,
                           'authority_rejected', 100)",
                [],
            )
            .unwrap();
        drop(connection);

        let status = store.command_status("group-command").unwrap().unwrap();
        assert_eq!(status.conversation_id, "group-1");
        assert_eq!(status.state, "failed");
        assert_eq!(status.last_error_code, "authority_rejected");
    }

    #[test]
    fn mls_transition_repository_persists_pending_state_and_command_atomically() {
        let store = MessagingStore::in_memory().unwrap();
        store
            .create_membership_intent(&PendingMembershipIntent {
                intent_id: "intent-1".to_string(),
                conversation_id: "group-1".to_string(),
                action: 1,
                target_ptid: "ptid:bob".to_string(),
                target_device_id: String::new(),
                role: "member".to_string(),
                created_at_unix_ms: 100,
            })
            .unwrap();

        MlsTransitionRepository::persist_mls_transition(
            &store,
            &MlsTransitionSendCommit {
                logical_intent_id: Some("intent-1"),
                command_id: "command-1",
                conversation_id: "group-1",
                transition_id: "transition-1",
                delivery_plan_sha256: &[7; 32],
                command_bytes: b"command",
                pending_transition_state: b"pending-state",
                created_at_unix_ms: 100,
            },
        )
        .unwrap();

        assert!(store.pending_membership_intents().unwrap().is_empty());
        assert_eq!(
            store.next_command(100).unwrap().unwrap().command_bytes,
            b"command"
        );
        let pending = store.pending_mls_transition("group-1").unwrap().unwrap();
        assert_eq!(pending.transition_id, "transition-1");
        assert_eq!(pending.command_id, "command-1");
        assert_eq!(pending.state, b"pending-state");
    }

    #[test]
    fn terminal_membership_failure_removes_durable_pending_transition() {
        let store = MessagingStore::in_memory().unwrap();
        store
            .create_membership_intent(&PendingMembershipIntent {
                intent_id: "intent-1".to_string(),
                conversation_id: "group-1".to_string(),
                action: 1,
                target_ptid: "ptid:bob".to_string(),
                target_device_id: String::new(),
                role: "member".to_string(),
                created_at_unix_ms: 100,
            })
            .unwrap();
        MlsTransitionRepository::persist_mls_transition(
            &store,
            &MlsTransitionSendCommit {
                logical_intent_id: Some("intent-1"),
                command_id: "command-1",
                conversation_id: "group-1",
                transition_id: "transition-1",
                delivery_plan_sha256: &[7; 32],
                command_bytes: b"command",
                pending_transition_state: b"pending-state",
                created_at_unix_ms: 100,
            },
        )
        .unwrap();

        store
            .mark_command_failed("command-1", b"command", 0, "authority_rejected")
            .unwrap();

        assert!(store.pending_mls_transition("group-1").unwrap().is_none());
        let connection = store.connection().unwrap();
        let intent_state: String = connection
            .query_row(
                "SELECT state FROM messaging_membership_intents
                 WHERE intent_id = 'intent-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(intent_state, "failed");
    }

    #[test]
    fn stale_genesis_removes_durable_pending_transition_without_logical_intent() {
        let store = MessagingStore::in_memory().unwrap();
        MlsTransitionRepository::persist_mls_transition(
            &store,
            &MlsTransitionSendCommit {
                logical_intent_id: None,
                command_id: "genesis-command",
                conversation_id: "group-1",
                transition_id: "genesis-transition",
                delivery_plan_sha256: &[7; 32],
                command_bytes: b"genesis-command-bytes",
                pending_transition_state: b"pending-genesis-state",
                created_at_unix_ms: 100,
            },
        )
        .unwrap();

        store
            .mark_command_superseded("genesis-command", b"genesis-command-bytes", 0)
            .unwrap();

        assert!(store.pending_mls_transition("group-1").unwrap().is_none());
    }

    fn attachment_transfer() -> AttachmentTransferRecord {
        AttachmentTransferRecord {
            attachment_id: "attachment-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            authority_station_id: "station-authority".to_string(),
            direction: 1,
            state: 1,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![1; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: "source-ref".to_string(),
            partial_local_ref: String::new(),
            object_key: vec![2; 32],
            base_nonce: vec![0; 12],
            plaintext_size: 17,
            chunk_size: 16,
            attempt_count: 0,
            next_attempt_at_unix_ms: 10,
            last_error_code: 0,
            updated_at_unix_ms: 10,
        }
    }

    fn direct_session(receive_counter: u32) -> DirectSession {
        let session_id = "session-1".to_string();
        DirectSession {
            session_id: session_id.clone(),
            key: DirectSessionKey::new(
                "conversation-1",
                CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
                CryptoEndpoint::new("ptid:bob", "bob-device").unwrap(),
                1,
            )
            .unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [1; 32],
            ratchet: DrSessionState {
                session_id,
                root_key: [2; 32],
                self_priv: [3; 32],
                self_pub: [4; 32],
                peer_pub: Some([5; 32]),
                send_chain_key: Some([6; 32]),
                recv_chain_key: Some([7; 32]),
                n_send: 2,
                n_recv: receive_counter,
                n_prev: 1,
            },
            updated_at_unix_ms: 100,
        }
    }

    fn persist_direct_command(
        store: &MessagingStore,
        command_id: &str,
        command_bytes: &[u8],
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        let private_content =
            crate::messaging::encode_message_private_content("sender plaintext", &[])?;
        store.persist_direct_send(&DirectSendCommit {
            command_bytes,
            expected_authority_sequence: 0,
            expected_authority_hash: &[],
            advanced_sessions: &[direct_session(0)],
            session_inits: &[],
            projection: PendingSenderProjection {
                command_id,
                conversation_id: "conversation-1",
                conversation_kind: 1,
                message_id: command_id,
                sender_ptid: "ptid:alice",
                sender_device_id: "alice-device",
                plaintext: "sender plaintext",
                reply_to_message_id: "",
                thread_root_message_id: "",
                attachments: &[],
                private_content: &private_content,
                delivery_plan_sha256: &[1; 32],
                created_at_unix_ms,
            },
        })
    }

    fn projection() -> MessageProjection {
        MessageProjection {
            conversation_id: "conversation-1".to_string(),
            event_id: "event-1".to_string(),
            event_sequence: 1,
            message_id: "message-1".to_string(),
            sender_ptid: "ptid:bob".to_string(),
            sender_device_id: "bob-device".to_string(),
            plaintext: "exact plaintext".to_string(),
            attachments: Vec::new(),
            committed_at_unix_ms: 100,
            reply_to_message_id: None,
            thread_root_message_id: None,
            edited_text: None,
            edited_at_unix_ms: None,
            retracted: false,
        }
    }

    fn recovery_archive() -> MessagingRecoveryArchive {
        MessagingRecoveryArchive {
            ptid: "ptid:alice".to_string(),
            actor_identity_seed: [42; 32],
            actor_profile_version: 3,
            conversations: vec![RecoveryConversationProjection {
                conversation_id: "restored-conversation".to_string(),
                authority_station_id: "station-local".to_string(),
                kind: 1,
                name: String::new(),
                owner_ptid: "ptid:alice".to_string(),
                member_ptids: vec!["ptid:alice".to_string(), "ptid:bob".to_string()],
                member_roles: BTreeMap::from([
                    ("ptid:alice".to_string(), MemberRole::Owner as i32),
                    ("ptid:bob".to_string(), MemberRole::Member as i32),
                ]),
                membership_epoch: 1,
                mls_epoch: 0,
                active: true,
                updated_at_unix_ms: 77,
            }],
            messages: vec![RecoveryMessageProjection {
                conversation_id: "restored-conversation".to_string(),
                event_id: "restored-event".to_string(),
                event_sequence: 7,
                message_id: "restored-message".to_string(),
                sender_ptid: "ptid:bob".to_string(),
                sender_device_id: "bob-device".to_string(),
                plaintext: "restored plaintext".to_string(),
                committed_at_unix_ms: 77,
            }],
            attachments: vec![RecoveryAttachmentMetadata {
                message_id: "restored-message".to_string(),
                attachment_id: "attachment-1".to_string(),
                metadata: test_attachment_metadata("attachment-1").encode_to_vec(),
            }],
            trust: vec![RecoveryTrustRecord {
                peer_ptid: "ptid:bob".to_string(),
                fingerprint: "abcd".to_string(),
                verified_at_unix_ms: 78,
            }],
        }
    }

    #[test]
    fn command_and_outbox_are_one_transaction() {
        let store = MessagingStore::in_memory().unwrap();
        persist_direct_command(&store, "command-1", b"exact bytes", 10).unwrap();
        let next = store.next_command(10).unwrap().unwrap();
        assert_eq!(next.command_id, "command-1");
        assert_eq!(next.command_bytes, b"exact bytes");

        assert!(persist_direct_command(&store, "command-1", b"different", 11).is_err());
        let next = store.next_command(11).unwrap().unwrap();
        assert_eq!(next.command_bytes, b"exact bytes");
        let connection = store.connection().unwrap();
        for table in [
            "direct_sessions",
            "messaging_local_commands",
            "messaging_command_outbox",
            "messaging_pending_messages",
            "messaging_command_attempts",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 1, "table {table}");
        }
    }

    #[test]
    fn conversation_projection_orders_committed_messages_by_authority_sequence() {
        let store = MessagingStore::in_memory().unwrap();
        let connection = store.connection().unwrap();
        for (event_id, event_sequence, message_id, committed_at_unix_ms) in [
            ("event-third", 3, "message-third", 100),
            ("event-first", 1, "message-first", 900),
            ("event-second", 2, "message-second", 500),
        ] {
            connection
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms
                     ) VALUES (
                        'conversation-1', ?1, ?2, ?3,
                        'ptid:alice', 'alice-device', ?3,
                        'consumed', ?4
                     )",
                    params![event_id, event_sequence, message_id, committed_at_unix_ms],
                )
                .unwrap();
        }
        for (message_id, created_at_unix_ms) in
            [("pending-z", 50), ("pending-a", 50), ("message-second", 25)]
        {
            connection
                .execute(
                    "INSERT INTO messaging_pending_messages(
                        conversation_id, conversation_kind, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        reply_to_message_id, thread_root_message_id, state,
                        attempt_count, next_attempt_at_unix_ms, last_error_code,
                        created_at_unix_ms
                     ) VALUES (
                        'conversation-1', 1, ?1,
                        'ptid:alice', 'alice-device', ?1,
                        '', '', 'pending',
                        0, ?2, '', ?2
                     )",
                    params![message_id, created_at_unix_ms],
                )
                .unwrap();
        }
        drop(connection);

        let transcript = store
            .conversation_message_projections("conversation-1")
            .unwrap();

        assert_eq!(
            transcript
                .iter()
                .map(|message| message.message_id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "message-first",
                "message-second",
                "message-third",
                "pending-a",
                "pending-z"
            ]
        );
        assert_eq!(
            transcript
                .iter()
                .map(|message| message.event_sequence)
                .collect::<Vec<_>>(),
            vec![Some(1), Some(2), Some(3), None, None]
        );
    }

    #[test]
    fn thread_projection_orders_root_committed_replies_and_pending_replies() {
        let store = MessagingStore::in_memory().unwrap();
        let connection = store.connection().unwrap();
        for (event_id, event_sequence, message_id, committed_at_unix_ms, thread_root_message_id) in [
            ("event-root", 10, "root", 500, None),
            ("event-reply-late", 13, "reply-late", 100, Some("root")),
            ("event-reply-early", 11, "reply-early", 900, Some("root")),
            ("event-unrelated", 12, "unrelated", 600, None),
        ] {
            connection
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms,
                        reply_to_message_id, thread_root_message_id
                     ) VALUES (
                        'conversation-1', ?1, ?2, ?3,
                        'ptid:alice', 'alice-device', ?3,
                        'consumed', ?4, NULL, ?5
                     )",
                    params![
                        event_id,
                        event_sequence,
                        message_id,
                        committed_at_unix_ms,
                        thread_root_message_id
                    ],
                )
                .unwrap();
        }
        for (message_id, created_at_unix_ms, thread_root_message_id) in [
            ("pending-z", 50, "root"),
            ("pending-a", 50, "root"),
            ("reply-early", 25, "root"),
            ("pending-other-thread", 1, "other-root"),
        ] {
            connection
                .execute(
                    "INSERT INTO messaging_pending_messages(
                        conversation_id, conversation_kind, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        reply_to_message_id, thread_root_message_id, state,
                        attempt_count, next_attempt_at_unix_ms, last_error_code,
                        created_at_unix_ms
                     ) VALUES (
                        'conversation-1', 1, ?1,
                        'ptid:alice', 'alice-device', ?1,
                        'root', ?3, 'pending',
                        0, ?2, '', ?2
                     )",
                    params![message_id, created_at_unix_ms, thread_root_message_id],
                )
                .unwrap();
        }
        drop(connection);

        let thread = store
            .thread_message_projections("conversation-1", "root")
            .unwrap();

        assert_eq!(
            thread
                .iter()
                .map(|message| message.message_id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "root",
                "reply-early",
                "reply-late",
                "pending-a",
                "pending-z"
            ]
        );
        assert_eq!(
            thread
                .iter()
                .map(|message| message.event_sequence)
                .collect::<Vec<_>>(),
            vec![Some(10), Some(11), Some(13), None, None]
        );

        store
            .update_read_cursor("conversation-1", "ptid:bob", 11, 1_000)
            .unwrap();
        let counts = store
            .thread_count_projections(
                "conversation-1",
                &[
                    "root".to_string(),
                    "missing-root".to_string(),
                    "root".to_string(),
                ],
                "ptid:bob",
            )
            .unwrap();
        assert_eq!(
            counts,
            vec![
                ThreadCountProjection {
                    root_message_id: "root".to_string(),
                    reply_count: 4,
                    latest_reply_id: "pending-z".to_string(),
                    latest_reply_at_unix_ms: 50,
                    unread_count: 1,
                },
                ThreadCountProjection {
                    root_message_id: "missing-root".to_string(),
                    reply_count: 0,
                    latest_reply_id: String::new(),
                    latest_reply_at_unix_ms: 0,
                    unread_count: 0,
                },
            ]
        );
    }

    #[test]
    fn interaction_command_uses_the_shared_durable_outbox_owner() {
        let store = MessagingStore::in_memory().unwrap();
        store
            .persist_interaction_command(&InteractionCommandCommit {
                command_id: "interaction-1",
                conversation_id: "conversation-1",
                target_message_id: "message-1",
                interaction_kind: "reaction-add",
                edited_text: None,
                command_bytes: b"exact interaction bytes",
                delivery_plan_sha256: &[7; 32],
                created_at_unix_ms: 10,
            })
            .unwrap();
        let next = store.next_command(10).unwrap().unwrap();
        assert_eq!(next.command_id, "interaction-1");
        assert_eq!(next.command_bytes, b"exact interaction bytes");

        store
            .mark_command_submitted("interaction-1", b"exact interaction bytes", 0)
            .unwrap();
        let connection = store.connection().unwrap();
        for table in [
            "messaging_local_commands",
            "messaging_command_outbox",
            "messaging_command_attempts",
            "messaging_interaction_intents",
        ] {
            let state: String = connection
                .query_row(
                    &format!("SELECT state FROM {table} WHERE command_id = 'interaction-1'"),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(state, "submitted", "table {table}");
        }
    }

    #[test]
    fn attachment_transfer_checkpoint_is_exact_and_durable() {
        let store = MessagingStore::in_memory().unwrap();
        let transfer = attachment_transfer();
        assert!(store.create_attachment_transfer(&transfer).unwrap());
        assert!(!store.create_attachment_transfer(&transfer).unwrap());

        let mut conflicting = transfer.clone();
        conflicting.message_id = "message-conflict".to_string();
        assert!(store.create_attachment_transfer(&conflicting).is_err());

        store
            .update_attachment_transfer_progress(
                &transfer.attachment_id,
                2,
                "upload-1",
                7,
                &[1],
                1,
                20,
                8,
                11,
            )
            .unwrap();
        let persisted = store
            .attachment_transfer(&transfer.attachment_id)
            .unwrap()
            .unwrap();
        assert_eq!(persisted.state, 2);
        assert_eq!(persisted.upload_id, "upload-1");
        assert_eq!(persisted.generation, 7);
        assert_eq!(persisted.completed_chunk_bitmap, vec![1]);
        assert_eq!(persisted.object_key, vec![2; 32]);
        assert_eq!(persisted.base_nonce, vec![0; 12]);
        assert_eq!(persisted.attempt_count, 1);
        assert_eq!(persisted.next_attempt_at_unix_ms, 20);
        assert_eq!(persisted.last_error_code, 8);
    }

    #[test]
    fn completed_sender_attachment_source_requires_projection_and_completed_upload() {
        let store = MessagingStore::in_memory().unwrap();
        let transfer = attachment_transfer();
        let plaintext_sha256 = vec![3_u8; 32];
        let connection = store.connection().unwrap();
        connection
            .execute(
                "INSERT INTO messaging_pending_messages(
                    conversation_id, conversation_kind, message_id,
                    sender_ptid, sender_device_id, plaintext,
                    reply_to_message_id, thread_root_message_id, state,
                    attempt_count, next_attempt_at_unix_ms, last_error_code,
                    created_at_unix_ms
                 ) VALUES (
                    ?1, 2, ?2, 'ptid:alice', 'alice-device', '',
                    '', '', 'submitted', 0, 0, '', 10
                 )",
                params![transfer.conversation_id, transfer.message_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO messaging_attachment_drafts(
                    attachment_id, conversation_id, message_id, filename,
                    mime_type, plaintext_sha256, descriptor_bytes, created_at_unix_ms
                 ) VALUES (?1, ?2, ?3, 'proof.txt', 'text/plain', ?4, X'01', 10)",
                params![
                    transfer.attachment_id,
                    transfer.conversation_id,
                    transfer.message_id,
                    plaintext_sha256,
                ],
            )
            .unwrap();
        drop(connection);
        assert!(store.create_attachment_transfer(&transfer).unwrap());
        assert!(store
            .completed_sender_attachment_source(&transfer.attachment_id)
            .unwrap()
            .is_none());
        store
            .connection()
            .unwrap()
            .execute(
                "UPDATE messaging_attachment_transfers SET state = ?2
                 WHERE attachment_id = ?1",
                params![
                    transfer.attachment_id,
                    AttachmentTransferState::Complete as i32,
                ],
            )
            .unwrap();

        assert!(store
            .completed_sender_attachment_source(&transfer.attachment_id)
            .unwrap()
            .is_none());

        store
            .connection()
            .unwrap()
            .execute(
                "DELETE FROM messaging_pending_messages
                 WHERE conversation_id = ?1 AND message_id = ?2",
                params![transfer.conversation_id, transfer.message_id],
            )
            .unwrap();
    }

    #[test]
    fn descriptor_backed_upload_reconciles_stale_terminal_state() {
        let store = MessagingStore::in_memory().unwrap();
        let mut transfer = attachment_transfer();
        transfer.state = AttachmentTransferState::Terminal as i32;
        transfer.next_attempt_at_unix_ms = 20;
        transfer.last_error_code = AttachmentTransferErrorCode::PartConflict as i32;
        assert!(store.create_attachment_transfer(&transfer).unwrap());
        store
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO messaging_attachment_drafts(
                    attachment_id, conversation_id, message_id, filename,
                    mime_type, plaintext_sha256, descriptor_bytes, created_at_unix_ms
                 ) VALUES (?1, ?2, ?3, 'proof.txt', 'text/plain', ?4, ?5, 10)",
                params![
                    transfer.attachment_id,
                    transfer.conversation_id,
                    transfer.message_id,
                    vec![3_u8; 32],
                    vec![4_u8],
                ],
            )
            .unwrap();

        assert_eq!(store.reconcile_completed_attachment_uploads().unwrap(), 1);
        let reconciled = store
            .attachment_transfer(&transfer.attachment_id)
            .unwrap()
            .unwrap();
        assert_eq!(reconciled.state, AttachmentTransferState::Complete as i32);
        assert_eq!(reconciled.next_attempt_at_unix_ms, 0);
        assert_eq!(reconciled.last_error_code, 0);
        assert_eq!(store.reconcile_completed_attachment_uploads().unwrap(), 0);
    }

    #[test]
    fn direct_send_failure_rolls_back_command_projection_and_ratchet() {
        let store = MessagingStore::in_memory().unwrap();
        let mut session = direct_session(0);
        session.session_id = "overflow-session".to_string();
        session.ratchet.session_id = session.session_id.clone();
        session.key = DirectSessionKey::new(
            "conversation-1",
            CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
            CryptoEndpoint::new("ptid:bob", "bob-device").unwrap(),
            u64::MAX,
        )
        .unwrap();
        let private_content =
            crate::messaging::encode_message_private_content("must roll back", &[]).unwrap();
        let result = store.persist_direct_send(&DirectSendCommit {
            command_bytes: b"exact bytes",
            expected_authority_sequence: 0,
            expected_authority_hash: &[],
            advanced_sessions: &[session],
            session_inits: &[],
            projection: PendingSenderProjection {
                command_id: "command-overflow",
                conversation_id: "conversation-1",
                conversation_kind: 1,
                message_id: "message-overflow",
                sender_ptid: "ptid:alice",
                sender_device_id: "alice-device",
                plaintext: "must roll back",
                reply_to_message_id: "",
                thread_root_message_id: "",
                attachments: &[],
                private_content: &private_content,
                delivery_plan_sha256: &[1; 32],
                created_at_unix_ms: 10,
            },
        });
        assert!(result.is_err());
        let connection = store.connection().unwrap();
        for table in [
            "direct_sessions",
            "messaging_local_commands",
            "messaging_command_outbox",
            "messaging_pending_messages",
            "messaging_command_attempts",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "table {table}");
        }
    }

    #[test]
    fn mls_send_persists_state_command_and_pending_projection_atomically() {
        let store = MessagingStore::in_memory().unwrap();
        let private_content =
            crate::messaging::encode_message_private_content("group plaintext", &[]).unwrap();
        store
            .persist_mls_send(&MlsSendCommit {
                command_bytes: b"exact MLS command",
                expected_authority_sequence: 0,
                expected_authority_hash: &[],
                session_state: b"advanced OpenMLS session",
                membership_epoch: 3,
                mls_epoch: 7,
                projection: PendingSenderProjection {
                    command_id: "group-command",
                    conversation_id: "group-1",
                    conversation_kind: 2,
                    message_id: "group-message",
                    sender_ptid: "ptid:alice",
                    sender_device_id: "alice-device",
                    plaintext: "group plaintext",
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments: &[],
                    private_content: &private_content,
                    delivery_plan_sha256: &[1; 32],
                    created_at_unix_ms: 10,
                },
            })
            .unwrap();
        assert_eq!(
            store.load_mls_session_state("group-1").unwrap().unwrap(),
            b"advanced OpenMLS session"
        );
        assert_eq!(
            store.next_command(10).unwrap().unwrap().command_bytes,
            b"exact MLS command"
        );
        let connection = store.connection().unwrap();
        let pending: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM messaging_command_attempts
                 WHERE command_id = 'group-command'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, 1);
    }

    #[test]
    fn draft_intent_is_projected_and_retried_with_durable_backoff() {
        let store = MessagingStore::in_memory().unwrap();
        let draft = PendingMessageDraft {
            conversation_id: "group-1".to_string(),
            conversation_kind: 2,
            message_id: "message-draft".to_string(),
            sender_ptid: "ptid:alice".to_string(),
            sender_device_id: "alice-device".to_string(),
            plaintext: "survives prepare failure".to_string(),
            reply_to_message_id: String::new(),
            thread_root_message_id: String::new(),
            attachments: Vec::new(),
            attempt_count: 0,
            created_at_unix_ms: 100,
        };
        store.create_message_draft(&draft).unwrap();
        assert_eq!(
            store.next_due_message_draft(100).unwrap(),
            Some(draft.clone())
        );
        let projection = store.conversation_message_projections("group-1").unwrap();
        assert_eq!(projection.len(), 1);
        assert_eq!(projection[0].message_id, "message-draft");
        assert_eq!(projection[0].state, "draft");
        assert_eq!(projection[0].plaintext, "survives prepare failure");

        store
            .schedule_message_draft_retry("group-1", "message-draft", 1_100, "prepare_failed")
            .unwrap();
        assert_eq!(store.next_due_message_draft(1_099).unwrap(), None);
        let retried = store.next_due_message_draft(1_100).unwrap().unwrap();
        assert_eq!(retried.attempt_count, 1);
        assert_eq!(retried.message_id, draft.message_id);
    }

    #[test]
    fn recovery_export_excludes_pre_cut_conversations_and_messages() {
        let store = MessagingStore::in_memory().unwrap();
        let connection = store.connection().unwrap();
        for (conversation_id, authority_station_id, message_id) in [
            ("legacy-conversation", "", "legacy-message"),
            (
                "canonical-conversation",
                "station-authority",
                "canonical-message",
            ),
        ] {
            connection
                .execute(
                    "INSERT INTO messaging_conversations(
                        conversation_id, authority_station_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (?1, ?2, 1, '', 'ptid:alice', 1, 0, 1, 100)",
                    params![conversation_id, authority_station_id],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO messaging_conversation_members(conversation_id, ptid, role, active)
                     VALUES (?1, 'ptid:alice', 3, 1), (?1, 'ptid:bob', 1, 1)",
                    params![conversation_id],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms,
                        reply_to_message_id, edited_text, edited_at_unix_ms, retracted
                     ) VALUES (?1, ?2, 1, ?3, 'ptid:alice', 'alice-device',
                               'plaintext', 'consumed', 100,
                               NULL, NULL, NULL, 0)",
                    params![conversation_id, format!("event-{message_id}"), message_id],
                )
                .unwrap();
        }
        drop(connection);

        let archive = store
            .build_recovery_archive("ptid:alice", [42; 32], 1)
            .unwrap();
        assert_eq!(archive.conversations.len(), 1);
        assert_eq!(
            archive.conversations[0].conversation_id,
            "canonical-conversation"
        );
        assert_eq!(archive.messages.len(), 1);
        assert_eq!(archive.messages[0].message_id, "canonical-message");
    }

    #[test]
    fn claimed_item_replay_requires_same_payload_hash() {
        let store = MessagingStore::in_memory().unwrap();
        let hash = [1_u8; 32];
        store
            .persist_claimed_item(
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
        store
            .persist_claimed_item(
                "item-1",
                "event-1",
                "conversation-1",
                1,
                2,
                &hash,
                b"payload",
                20,
            )
            .unwrap();
        let changed = [2_u8; 32];
        let result = store.persist_claimed_item(
            "item-1",
            "event-1",
            "conversation-1",
            1,
            2,
            &changed,
            b"tampered",
            20,
        );
        assert!(result.is_err());
        let connection = store.connection().unwrap();
        let stored: Vec<u8> = connection
            .query_row(
                "SELECT payload_sha256 FROM messaging_inbox_items WHERE item_id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, hash);
    }

    #[test]
    fn direct_session_survives_store_round_trip() {
        let store = MessagingStore::in_memory().unwrap();
        let session = direct_session(9);
        store.save_direct_session(&session).unwrap();
        let loaded = store
            .load_direct_session(&session.session_id)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.key, session.key);
        assert_eq!(loaded.ratchet.n_recv, 9);
        assert_eq!(loaded.ratchet.root_key, session.ratchet.root_key);
        assert_eq!(
            loaded.ratchet.recv_chain_key,
            session.ratchet.recv_chain_key
        );
    }

    #[test]
    fn receive_commit_is_atomic_and_duplicate_is_idempotent() {
        let store = MessagingStore::in_memory().unwrap();
        let payload_hash = [8_u8; 32];
        store
            .persist_claimed_item(
                "item-1",
                "event-1",
                "conversation-1",
                1,
                3,
                &payload_hash,
                b"delivery",
                90,
            )
            .unwrap();
        let session = direct_session(4);
        let mut projection = projection();
        projection.attachments = vec![test_attachment_metadata("attachment-1")];
        let input = DirectReceiveCommit {
            item_id: "item-1",
            event_id: "event-1",
            conversation_id: "conversation-1",
            lane_sequence: 1,
            consumer_epoch: 3,
            payload_sha256: &payload_hash,
            event_hash: &[11; 32],
            previous_event_hash: &[],
            session: &session,
            new_skipped: &[],
            consumed_skipped: None,
            consumed_one_time_prekey_id: None,
            projection: &projection,
            reply_to_message_id: None,
            thread_root_message_id: None,
            receipt_id: "receipt-1",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 100,
        };
        assert_eq!(
            store.commit_direct_receive(&input).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            store.commit_direct_receive(&input).unwrap(),
            ReceiveCommitResult::AlreadyCommitted
        );

        let connection = store.connection().unwrap();
        for table in [
            "direct_sessions",
            "messaging_message_projections",
            "messaging_attachment_projections",
            "messaging_message_search_fts",
            "messaging_consumption_markers",
            "messaging_lane_cursor",
            "messaging_authority_heads",
            "messaging_receipt_outbox",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            let expected = if table == "messaging_receipt_outbox" {
                2
            } else {
                1
            };
            assert_eq!(count, expected, "table {table}");
        }
        let state: String = connection
            .query_row(
                "SELECT state FROM messaging_inbox_items WHERE item_id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "consumed");
    }

    #[test]
    fn receive_failpoints_roll_back_crypto_projection_marker_cursor_and_receipt() {
        for fail_point in [
            ReceiveFailPoint::AfterCrypto,
            ReceiveFailPoint::AfterProjection,
            ReceiveFailPoint::AfterAttachments,
            ReceiveFailPoint::AfterSearch,
            ReceiveFailPoint::BeforeCommit,
        ] {
            let store = MessagingStore::in_memory().unwrap();
            store
                .connection()
                .unwrap()
                .execute(
                    "INSERT INTO messaging_one_time_prekeys(
                        prekey_id, private_key, state
                     ) VALUES (7, ?1, 'available')",
                    params![[7_u8; 32].as_slice()],
                )
                .unwrap();
            let payload_hash = [9_u8; 32];
            store
                .persist_claimed_item(
                    "item-1",
                    "event-1",
                    "conversation-1",
                    1,
                    1,
                    &payload_hash,
                    b"delivery",
                    90,
                )
                .unwrap();
            let session = direct_session(5);
            let mut projection = projection();
            projection.attachments = vec![test_attachment_metadata("attachment-1")];
            let input = DirectReceiveCommit {
                item_id: "item-1",
                event_id: "event-1",
                conversation_id: "conversation-1",
                lane_sequence: 1,
                consumer_epoch: 1,
                payload_sha256: &payload_hash,
                event_hash: &[11; 32],
                previous_event_hash: &[],
                session: &session,
                new_skipped: &[],
                consumed_skipped: None,
                consumed_one_time_prekey_id: Some(7),
                projection: &projection,
                reply_to_message_id: None,
                thread_root_message_id: None,
                receipt_id: "receipt-1",
                receipt_bytes: b"receipt",
                consumed_at_unix_ms: 100,
            };
            assert!(store
                .commit_direct_receive_inner(&input, fail_point)
                .is_err());
            let connection = store.connection().unwrap();
            for table in [
                "direct_sessions",
                "messaging_message_projections",
                "messaging_attachment_projections",
                "messaging_message_search_fts",
                "messaging_consumption_markers",
                "messaging_lane_cursor",
                "messaging_authority_heads",
                "messaging_receipt_outbox",
            ] {
                let count: i64 = connection
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(count, 0, "fail point {fail_point:?}, table {table}");
            }
            let state: String = connection
                .query_row(
                    "SELECT state FROM messaging_inbox_items WHERE item_id = 'item-1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(state, "claimed");
            let prekey_state: String = connection
                .query_row(
                    "SELECT state FROM messaging_one_time_prekeys WHERE prekey_id = 7",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(prekey_state, "available");
        }
    }

    #[test]
    fn subsumed_event_advances_lane_without_replaying_crypto_or_projection() {
        let store = MessagingStore::in_memory().unwrap();
        let payload_hash = [13_u8; 32];
        store
            .persist_claimed_item(
                "subsumed-item-1",
                "event-1",
                "conversation-1",
                1,
                1,
                &payload_hash,
                b"subsumed delivery",
                90,
            )
            .unwrap();
        store
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO messaging_authority_heads(
                    conversation_id, event_sequence, event_hash, updated_at_unix_ms
                 ) VALUES ('conversation-1', 2, ?1, 90)",
                params![[22_u8; 32].as_slice()],
            )
            .unwrap();
        let session = direct_session(5);
        let projection = projection();
        let input = DirectReceiveCommit {
            item_id: "subsumed-item-1",
            event_id: "event-1",
            conversation_id: "conversation-1",
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &payload_hash,
            event_hash: &[11; 32],
            previous_event_hash: &[],
            session: &session,
            new_skipped: &[],
            consumed_skipped: None,
            consumed_one_time_prekey_id: None,
            projection: &projection,
            reply_to_message_id: None,
            thread_root_message_id: None,
            receipt_id: "subsumed-receipt-1",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 100,
        };

        assert_eq!(
            store.commit_direct_receive(&input).unwrap(),
            ReceiveCommitResult::Committed
        );
        let connection = store.connection().unwrap();
        for table in ["direct_sessions", "messaging_message_projections"] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "subsumed event mutated {table}");
        }
        for table in [
            "messaging_consumption_markers",
            "messaging_lane_cursor",
            "messaging_receipt_outbox",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 1, "subsumed event omitted {table}");
        }
        let head: (i64, Vec<u8>) = connection
            .query_row(
                "SELECT event_sequence, event_hash
                 FROM messaging_authority_heads WHERE conversation_id = 'conversation-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(head, (2, vec![22_u8; 32]));
    }

    #[test]
    fn mls_receive_uses_same_atomic_projection_and_ack_boundary() {
        let store = MessagingStore::in_memory().unwrap();
        let payload_hash = [13_u8; 32];
        store
            .persist_claimed_item(
                "mls-item-1",
                "event-1",
                "conversation-1",
                1,
                1,
                &payload_hash,
                b"mls delivery",
                90,
            )
            .unwrap();
        let projection = projection();
        let input = MlsReceiveCommit {
            item_id: "mls-item-1",
            event_id: "event-1",
            conversation_id: "conversation-1",
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &payload_hash,
            event_hash: &[14; 32],
            previous_event_hash: &[],
            session_state: b"openmls session state",
            membership_epoch: 2,
            mls_epoch: 3,
            projection: &projection,
            reply_to_message_id: None,
            thread_root_message_id: None,
            receipt_id: "mls-receipt-1",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 100,
        };
        assert_eq!(
            store.commit_mls_receive(&input).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(
            store.commit_mls_receive(&input).unwrap(),
            ReceiveCommitResult::AlreadyCommitted
        );
        assert_eq!(
            store
                .load_mls_session_state("conversation-1")
                .unwrap()
                .unwrap(),
            b"openmls session state"
        );
    }

    #[test]
    fn mls_receive_failure_rolls_back_session_and_common_receive_state() {
        let store = MessagingStore::in_memory().unwrap();
        let payload_hash = [15_u8; 32];
        store
            .persist_claimed_item(
                "mls-item-1",
                "event-1",
                "conversation-1",
                1,
                1,
                &payload_hash,
                b"mls delivery",
                90,
            )
            .unwrap();
        let projection = projection();
        let input = MlsReceiveCommit {
            item_id: "mls-item-1",
            event_id: "event-1",
            conversation_id: "conversation-1",
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &payload_hash,
            event_hash: &[16; 32],
            previous_event_hash: &[],
            session_state: b"openmls session state",
            membership_epoch: 2,
            mls_epoch: 3,
            projection: &projection,
            reply_to_message_id: None,
            thread_root_message_id: None,
            receipt_id: "mls-receipt-1",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 100,
        };
        assert!(store
            .commit_mls_receive_inner(&input, ReceiveFailPoint::AfterCrypto)
            .is_err());
        let connection = store.connection().unwrap();
        for table in [
            "messaging_mls_groups",
            "messaging_message_projections",
            "messaging_consumption_markers",
            "messaging_lane_cursor",
            "messaging_authority_heads",
            "messaging_receipt_outbox",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "table {table}");
        }
    }

    #[test]
    fn recovery_staging_restores_history_and_clears_all_live_state() {
        let store = MessagingStore::in_memory().unwrap();
        persist_direct_command(&store, "old-command", b"command", 1).unwrap();
        store.save_direct_session(&direct_session(3)).unwrap();
        store
            .save_mls_actor_identity("ptid:alice", "alice-device", b"live MLS identity")
            .unwrap();
        store
            .populate_recovery_staging(&recovery_archive())
            .unwrap();

        let exported = store
            .build_recovery_archive("ptid:alice", [42; 32], 3)
            .unwrap();
        assert_eq!(exported, recovery_archive());
        let restored = store
            .message_projection("restored-conversation", "restored-message")
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(
            restored.attachments,
            vec![test_attachment_metadata("attachment-1")]
        );
        assert_eq!(
            store
                .search_message_projections(
                    "restored-conversation",
                    "restored plaintext",
                    None,
                    10,
                )
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            store
                .search_message_projections("restored-conversation", "report.txt", None, 10,)
                .unwrap()
                .len(),
            1
        );
        assert!(store
            .search_message_projections("other-conversation", "report.txt", None, 10)
            .unwrap()
            .is_empty());
        let connection = store.connection().unwrap();
        for table in [
            "direct_sessions",
            "direct_skipped_message_keys",
            "messaging_mls_actor_identity",
            "messaging_mls_groups",
            "messaging_mls_join_provider_pool",
            "messaging_mls_applied_transitions",
            "messaging_local_commands",
            "messaging_command_outbox",
            "messaging_pending_messages",
            "messaging_command_attempts",
            "messaging_inbox_items",
            "messaging_consumption_markers",
            "messaging_lane_cursor",
            "messaging_authority_heads",
            "messaging_receipt_outbox",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "live table {table}");
        }
    }

    #[test]
    fn completed_download_atomically_promotes_recipient_cache_projection() {
        let store = MessagingStore::in_memory().unwrap();
        store
            .populate_recovery_staging(&recovery_archive())
            .unwrap();
        let projection = store
            .attachment_download_projection("attachment-1")
            .unwrap()
            .unwrap();
        let descriptor = projection.metadata.object.clone().unwrap();
        let descriptor_sha256 = Sha256::digest(descriptor.encode_to_vec()).to_vec();
        let transfer = AttachmentTransferRecord {
            attachment_id: "attachment-1".to_string(),
            conversation_id: projection.conversation_id,
            message_id: projection.message_id,
            authority_station_id: projection.authority_station_id,
            direction: 2,
            state: AttachmentTransferState::Transferring as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256,
            completed_chunk_bitmap: vec![0xff; descriptor.chunk_count.div_ceil(8) as usize],
            source_local_ref: String::new(),
            partial_local_ref: "/tmp/attachment-1.part".to_string(),
            object_key: projection.metadata.object_key,
            base_nonce: projection.metadata.base_nonce,
            plaintext_size: projection.metadata.plaintext_size,
            chunk_size: descriptor.chunk_size,
            attempt_count: 0,
            next_attempt_at_unix_ms: 100,
            last_error_code: 0,
            updated_at_unix_ms: 100,
        };
        store.create_attachment_transfer(&transfer).unwrap();
        store
            .complete_attachment_download(&transfer, &descriptor, "/tmp/attachment-1.cache", 101)
            .unwrap();

        let promoted = store
            .attachment_download_projection("attachment-1")
            .unwrap()
            .unwrap();
        assert_eq!(
            promoted.local_cache_path.as_deref(),
            Some("/tmp/attachment-1.cache")
        );
        assert_eq!(
            store
                .attachment_transfer("attachment-1")
                .unwrap()
                .unwrap()
                .state,
            AttachmentTransferState::Complete as i32
        );
    }

    #[test]
    fn completed_upload_becomes_fenced_sender_download_checkpoint() {
        let store = MessagingStore::in_memory().unwrap();
        store
            .populate_recovery_staging(&recovery_archive())
            .unwrap();
        let projection = store
            .attachment_download_projection("attachment-1")
            .unwrap()
            .unwrap();
        let descriptor = projection.metadata.object.as_ref().unwrap();
        let upload = AttachmentTransferRecord {
            attachment_id: projection.metadata.attachment_id.clone(),
            conversation_id: projection.conversation_id.clone(),
            message_id: projection.message_id.clone(),
            authority_station_id: projection.authority_station_id.clone(),
            direction: 1,
            state: AttachmentTransferState::Complete as i32,
            upload_id: "upload-1".to_string(),
            generation: 7,
            descriptor_sha256: Sha256::digest(descriptor.encode_to_vec()).to_vec(),
            completed_chunk_bitmap: vec![0xff; descriptor.chunk_count.div_ceil(8) as usize],
            source_local_ref: "/tmp/completed-upload-source".to_string(),
            partial_local_ref: String::new(),
            object_key: projection.metadata.object_key.clone(),
            base_nonce: projection.metadata.base_nonce.clone(),
            plaintext_size: projection.metadata.plaintext_size,
            chunk_size: descriptor.chunk_size,
            attempt_count: 2,
            next_attempt_at_unix_ms: 0,
            last_error_code: 0,
            updated_at_unix_ms: 100,
        };
        store.create_attachment_transfer(&upload).unwrap();
        assert!(store
            .owns_attachment_source(&upload.source_local_ref)
            .unwrap());
        store
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO messaging_pending_messages(
                    conversation_id, conversation_kind, message_id,
                    sender_ptid, sender_device_id, plaintext,
                    reply_to_message_id, thread_root_message_id, state,
                    attempt_count, next_attempt_at_unix_ms, last_error_code,
                    created_at_unix_ms
                 ) VALUES (
                    ?1, 2, ?2, 'ptid:alice', 'alice-device', '',
                    '', '', 'pending', 0, 0, '', 100
                 )",
                params![upload.conversation_id, upload.message_id],
            )
            .unwrap();
        let source = CompletedSenderAttachmentSource {
            attachment_id: upload.attachment_id.clone(),
            message_id: upload.message_id.clone(),
            source_local_ref: upload.source_local_ref.clone(),
            plaintext_sha256: projection.metadata.plaintext_sha256.clone(),
            local_cache_path: None,
        };
        assert_eq!(
            store
                .completed_sender_attachment_source(&upload.attachment_id)
                .unwrap(),
            Some(source.clone())
        );
        assert!(store.completed_attachment_sources().unwrap().is_empty());
        assert!(store
            .clear_completed_attachment_source(&source, "/tmp/sender-cache")
            .is_err());
        store
            .promote_completed_upload_cache(&source, "/tmp/sender-cache")
            .unwrap();
        store
            .promote_completed_upload_cache(&source, "/tmp/sender-cache")
            .unwrap();
        assert!(store
            .promote_completed_upload_cache(&source, "/tmp/other-sender-cache")
            .is_err());
        assert!(store
            .clear_completed_attachment_source(&source, "/tmp/sender-cache")
            .is_err());
        store
            .connection()
            .unwrap()
            .execute(
                "DELETE FROM messaging_pending_messages
                 WHERE conversation_id = ?1 AND message_id = ?2",
                params![upload.conversation_id, upload.message_id],
            )
            .unwrap();
        assert_eq!(
            store.completed_attachment_sources().unwrap(),
            vec![CompletedSenderAttachmentSource {
                local_cache_path: Some("/tmp/sender-cache".to_string()),
                ..source.clone()
            }]
        );
        assert_eq!(
            store
                .attachment_download_projection(&upload.attachment_id)
                .unwrap()
                .unwrap()
                .local_cache_path
                .as_deref(),
            Some("/tmp/sender-cache")
        );
        store
            .clear_completed_attachment_source(&source, "/tmp/sender-cache")
            .unwrap();
        assert!(store.completed_attachment_sources().unwrap().is_empty());
        assert!(!store
            .owns_attachment_source(&upload.source_local_ref)
            .unwrap());

        let download = AttachmentTransferRecord {
            direction: 2,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0; descriptor.chunk_count.div_ceil(8) as usize],
            source_local_ref: String::new(),
            partial_local_ref: "/tmp/sender-cache.part".to_string(),
            attempt_count: 0,
            next_attempt_at_unix_ms: 101,
            updated_at_unix_ms: 101,
            ..upload.clone()
        };
        store
            .replace_completed_upload_with_download(&download)
            .unwrap();

        assert_eq!(
            store.attachment_transfer("attachment-1").unwrap().unwrap(),
            download
        );
        assert!(store
            .replace_completed_upload_with_download(&download)
            .is_err());
    }

    #[test]
    fn failed_recovery_staging_preserves_existing_database() {
        let store = MessagingStore::in_memory().unwrap();
        persist_direct_command(&store, "keep-command", b"command", 1).unwrap();
        let mut invalid = recovery_archive();
        invalid.messages.push(invalid.messages[0].clone());
        assert!(store.populate_recovery_staging(&invalid).is_err());
        assert_eq!(
            store.next_command(1).unwrap().unwrap().command_id,
            "keep-command"
        );
        let connection = store.connection().unwrap();
        let restored_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM messaging_message_projections",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restored_count, 0);
    }
}
