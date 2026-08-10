use super::identity::{FreshDeviceEnrollment, FreshDeviceIdentityState};
use super::recovery::{
    MessagingRecoveryArchive, RecoveryAttachmentMetadata, RecoveryConversationProjection,
    RecoveryMessageProjection, RecoveryTrustRecord,
};
use crate::domain::crypto::double_ratchet::{DrSessionState, DrSkippedMessageKey};
use crate::domain::crypto::{CryptoEndpoint, DirectSession, DirectSessionKey};
use crate::domain::storage::database::DatabaseOpenSpec;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::infrastructure::storage::open_database;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
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
pub struct MessageProjection {
    pub conversation_id: String,
    pub event_id: String,
    pub event_sequence: i64,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub committed_at_unix_ms: i64,
}

pub struct PendingSenderProjection<'a> {
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub message_id: &'a str,
    pub sender_ptid: &'a str,
    pub sender_device_id: &'a str,
    pub plaintext: &'a str,
    pub delivery_plan_sha256: &'a [u8],
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMessageDraft {
    pub conversation_id: String,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingPreKeyBundle {
    pub signed_prekey_id: i32,
    pub signed_prekey_private: [u8; 32],
    pub one_time_prekeys: Vec<(i32, [u8; 32])>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMlsKeyPackage {
    pub package_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationMessageProjection {
    pub event_id: Option<String>,
    pub event_sequence: Option<i64>,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub state: String,
    pub timestamp_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationProjection {
    pub conversation_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: String,
    pub member_ptids: Vec<String>,
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
    pub advanced_sessions: &'a [DirectSession],
    pub session_inits: &'a [(String, Vec<u8>)],
    pub projection: PendingSenderProjection<'a>,
}

pub struct MlsSendCommit<'a> {
    pub command_bytes: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub projection: PendingSenderProjection<'a>,
}

pub struct MlsTransitionSendCommit<'a> {
    pub logical_intent_id: Option<&'a str>,
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub transition_id: &'a str,
    pub delivery_plan_sha256: &'a [u8],
    pub command_bytes: &'a [u8],
    pub pending_transition_state: &'a [u8],
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
    pub committed_at_unix_ms: i64,
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

    pub fn persist_mls_transition(
        &self,
        input: &MlsTransitionSendCommit<'_>,
    ) -> Result<(), String> {
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
        if local_changed != 1
            || outbox_changed != 1
            || attempt_changed != 1
            || !pending_owner_transition_is_valid(&transaction, command_id, pending_changed)?
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
        if attempt_changed != 1
            || !pending_owner_transition_is_valid(&transaction, command_id, pending_changed)?
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
        if local_changed != 1
            || outbox_changed != 1
            || attempt_changed != 1
            || !pending_owner_transition_is_valid(&transaction, command_id, pending_changed)?
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
                "UPDATE messaging_pending_messages AS p SET state = 'pending'
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
            || !(pending_owner_transition_is_valid(&transaction, command_id, pending_changed)?
                || (membership_intent_changed == 1 && pending_transition_deleted == 1))
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
        self.connection()?
            .query_row(
                "SELECT event_id, event_sequence, sender_ptid, sender_device_id,
                        plaintext, delivery_state, committed_at_unix_ms
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
                            committed_at_unix_ms: row.get(6)?,
                        },
                        delivery_state,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())
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
                "SELECT event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms
                 FROM messaging_message_projections
                 WHERE conversation_id = ?1
                 UNION ALL
                 SELECT NULL, NULL, pending.message_id,
                        pending.sender_ptid, pending.sender_device_id,
                        pending.plaintext, pending.state, pending.created_at_unix_ms
                 FROM messaging_pending_messages pending
                 WHERE pending.conversation_id = ?1
                   AND NOT EXISTS (
                       SELECT 1 FROM messaging_message_projections committed
                       WHERE committed.conversation_id = pending.conversation_id
                         AND committed.message_id = pending.message_id
                   )
                 ORDER BY 8 ASC, 3 ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![conversation_id], |row| {
                Ok(ConversationMessageProjection {
                    event_id: row.get(0)?,
                    event_sequence: row.get(1)?,
                    message_id: row.get(2)?,
                    sender_ptid: row.get(3)?,
                    sender_device_id: row.get(4)?,
                    plaintext: row.get(5)?,
                    state: row.get(6)?,
                    timestamp_unix_ms: row.get(7)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn conversation_projections(&self) -> Result<Vec<ConversationProjection>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, kind, name, owner_ptid,
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
                    row.get::<_, i32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, bool>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows.into_iter()
            .map(
                |(
                    conversation_id,
                    kind,
                    name,
                    owner_ptid,
                    membership_epoch,
                    mls_epoch,
                    active,
                    updated_at_unix_ms,
                )| {
                    let mut members = connection
                        .prepare(
                            "SELECT ptid FROM messaging_conversation_members
                             WHERE conversation_id = ?1 AND active = 1
                             ORDER BY ptid",
                        )
                        .map_err(|error| error.to_string())?;
                    let member_ptids = members
                        .query_map(params![conversation_id], |row| row.get::<_, String>(0))
                        .map_err(|error| error.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|error| error.to_string())?;
                    Ok(ConversationProjection {
                        conversation_id,
                        kind,
                        name,
                        owner_ptid,
                        member_ptids,
                        membership_epoch,
                        mls_epoch,
                        active,
                        updated_at_unix_ms,
                    })
                },
            )
            .collect()
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
                    conversation_id, kind, name, owner_ptid,
                    membership_epoch, mls_epoch, active, updated_at_unix_ms
                 ) VALUES (?1, 2, 'test group', 'ptid:alice', ?2, ?3, 1, 1)",
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

    pub fn superseded_message_draft(
        &self,
        command_id: &str,
    ) -> Result<PendingMessageDraft, String> {
        if command_id.trim().is_empty() {
            return Err("messaging superseded command ID is required".to_string());
        }
        self.connection()?
            .query_row(
                "SELECT p.conversation_id, p.message_id, p.sender_ptid,
                        p.sender_device_id, p.plaintext
                 FROM messaging_command_attempts a
                 JOIN messaging_pending_messages p
                   ON p.conversation_id = a.conversation_id
                  AND p.message_id = a.message_id
                 WHERE a.command_id = ?1 AND a.state = 'superseded'",
                params![command_id],
                |row| {
                    Ok(PendingMessageDraft {
                        conversation_id: row.get(0)?,
                        message_id: row.get(1)?,
                        sender_ptid: row.get(2)?,
                        sender_device_id: row.get(3)?,
                        plaintext: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "messaging superseded draft is unavailable".to_string())
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
                "SELECT conversation_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                 FROM messaging_conversations
                 ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let conversation_rows = conversation_statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, bool>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let mut conversations = Vec::with_capacity(conversation_rows.len());
        for row in conversation_rows {
            let mut member_statement = connection
                .prepare(
                    "SELECT ptid FROM messaging_conversation_members
                     WHERE conversation_id = ?1 AND active = 1
                     ORDER BY ptid",
                )
                .map_err(|error| error.to_string())?;
            let member_ptids = member_statement
                .query_map(params![row.0], |member| member.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            conversations.push(RecoveryConversationProjection {
                conversation_id: row.0,
                kind: row.1,
                name: row.2,
                owner_ptid: row.3,
                member_ptids,
                membership_epoch: row.4,
                mls_epoch: row.5,
                active: row.6,
                updated_at_unix_ms: row.7,
            });
        }
        let mut message_statement = connection
            .prepare(
                "SELECT conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext, committed_at_unix_ms
                 FROM messaging_message_projections
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
                "SELECT message_id, attachment_id, metadata
                 FROM messaging_attachment_metadata
                 ORDER BY message_id, attachment_id",
            )
            .map_err(|error| error.to_string())?;
        let attachments = attachment_statement
            .query_map([], |row| {
                Ok(RecoveryAttachmentMetadata {
                    message_id: row.get(0)?,
                    attachment_id: row.get(1)?,
                    metadata: row.get(2)?,
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
                 DELETE FROM messaging_attachment_metadata;
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
                        conversation_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        conversation.conversation_id,
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
                transaction
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, active
                         ) VALUES (?1, ?2, 1)",
                        params![conversation.conversation_id, member_ptid],
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
                        delivery_state, committed_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'restored', ?8)",
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
            transaction
                .execute(
                    "INSERT INTO messaging_attachment_metadata(
                        message_id, attachment_id, metadata
                     ) VALUES (?1, ?2, ?3)",
                    params![
                        attachment.message_id,
                        attachment.attachment_id,
                        attachment.metadata
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
        if certificate.ptid.trim().is_empty()
            || certificate.device_id.trim().is_empty()
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
                    certificate.ptid,
                    certificate.device_id,
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
            transaction
                .execute(
                    "INSERT INTO messaging_message_projections(
                        conversation_id, event_id, event_sequence, message_id,
                        sender_ptid, sender_device_id, plaintext,
                        delivery_state, committed_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'accepted', ?8)",
                    params![
                        input.conversation_id,
                        input.event_id,
                        input.event_sequence,
                        input.message_id,
                        input.sender_ptid,
                        input.sender_device_id,
                        pending.4,
                        input.committed_at_unix_ms
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
                        conversation_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        kind=excluded.kind,
                        name=excluded.name,
                        owner_ptid=excluded.owner_ptid,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        active=excluded.active,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        input.projection.conversation_id,
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
            for ptid in &input.projection.member_ptids {
                transaction
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, active
                         ) VALUES (?1, ?2, 1)
                         ON CONFLICT(conversation_id, ptid) DO UPDATE SET active=1",
                        params![input.conversation_id, ptid],
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
                    || projection.member_ptids.is_empty()
                {
                    return Err("messaging MLS join projection binding mismatch".to_string());
                }
                transaction
                    .execute(
                        "INSERT INTO messaging_conversations(
                            conversation_id, kind, name, owner_ptid,
                            membership_epoch, mls_epoch, active, updated_at_unix_ms
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
                         ON CONFLICT(conversation_id) DO UPDATE SET
                            kind=excluded.kind,
                            name=excluded.name,
                            owner_ptid=excluded.owner_ptid,
                            membership_epoch=excluded.membership_epoch,
                            mls_epoch=excluded.mls_epoch,
                            active=1,
                            updated_at_unix_ms=excluded.updated_at_unix_ms",
                        params![
                            projection.conversation_id,
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
                for ptid in &projection.member_ptids {
                    transaction
                        .execute(
                            "INSERT INTO messaging_conversation_members(
                                conversation_id, ptid, active
                             ) VALUES (?1, ?2, 1)",
                            params![projection.conversation_id, ptid],
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
            || input.projection.membership_epoch != input.membership_epoch
            || input.projection.mls_epoch != input.mls_epoch
            || input.projection.member_ptids.is_empty()
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
                        conversation_id, kind, name, owner_ptid,
                        membership_epoch, mls_epoch, active, updated_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(conversation_id) DO UPDATE SET
                        kind=excluded.kind,
                        name=excluded.name,
                        owner_ptid=excluded.owner_ptid,
                        membership_epoch=excluded.membership_epoch,
                        mls_epoch=excluded.mls_epoch,
                        active=excluded.active,
                        updated_at_unix_ms=excluded.updated_at_unix_ms",
                    params![
                        input.projection.conversation_id,
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
            for ptid in &input.projection.member_ptids {
                transaction
                    .execute(
                        "INSERT INTO messaging_conversation_members(
                            conversation_id, ptid, active
                         ) VALUES (?1, ?2, 1)",
                        params![input.conversation_id, ptid],
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
            certificate: crate::model::chat::MessagingDeviceCertificate {
                format_version: super::identity::MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION,
                ptid: row.0,
                device_id: row.1,
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

    pub fn has_mls_key_packages(&self) -> Result<bool, String> {
        self.connection()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messaging_mls_key_packages)",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())
    }

    pub fn install_fresh_mls_key_packages(
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

    pub fn pending_mls_key_packages(&self) -> Result<Vec<PendingMlsKeyPackage>, String> {
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

    pub fn complete_mls_key_package_publication(&self, package_id: &str) -> Result<(), String> {
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
                let existing: i64 = transaction
                    .query_row(
                        "SELECT
                            (SELECT COUNT(*) FROM messaging_conversations WHERE conversation_id = ?1)
                          + (SELECT COUNT(*) FROM messaging_mls_groups WHERE conversation_id = ?1)
                          + (SELECT COUNT(*) FROM messaging_consumption_markers WHERE conversation_id = ?1)",
                        params![input.conversation_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                if existing != 0 {
                    return Err(
                        "messaging MLS join checkpoint requires empty local conversation state"
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
                        delivery_state, committed_at_unix_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'consumed', ?8)
                     ON CONFLICT(conversation_id, event_id) DO NOTHING",
                    params![
                        projection.conversation_id,
                        projection.event_id,
                        projection.event_sequence,
                        projection.message_id,
                        projection.sender_ptid,
                        projection.sender_device_id,
                        projection.plaintext,
                        projection.committed_at_unix_ms
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err(
                    "messaging projection identity already exists without marker".to_string(),
                );
            }
        }
        if fail_point == ReceiveFailPoint::AfterProjection {
            return Err("injected receive failure after projection".to_string());
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

    #[cfg(test)]
    pub(super) fn in_memory() -> Result<Self, String> {
        Self::from_connection(Connection::open_in_memory().map_err(|error| error.to_string())?)
    }
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
    if projection.conversation_id != input.conversation_id
        || projection.kind == 0
        || projection.owner_ptid.trim().is_empty()
        || projection.member_ptids.len() < 2
        || projection.membership_epoch < 0
        || projection.mls_epoch < 0
        || projection.updated_at_unix_ms <= 0
        || !projection.active
    {
        return Err("messaging conversation-state receive input is incomplete".to_string());
    }
    let mut previous = None;
    for ptid in &projection.member_ptids {
        if ptid.trim().is_empty()
            || previous
                .as_ref()
                .is_some_and(|value: &&String| value.as_str() >= ptid.as_str())
        {
            return Err("messaging conversation members are not strictly sorted".to_string());
        }
        previous = Some(ptid);
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
        || projection.plaintext.is_empty()
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
        (pending_message_changes, transition_count),
        (1, 0) | (0, 1)
    ))
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
                conversation_id, message_id, sender_ptid,
                sender_device_id, plaintext, state, created_at_unix_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)
             ON CONFLICT(conversation_id, message_id) DO UPDATE SET
                state='pending'
             WHERE messaging_pending_messages.sender_ptid = excluded.sender_ptid
               AND messaging_pending_messages.sender_device_id = excluded.sender_device_id
               AND messaging_pending_messages.plaintext = excluded.plaintext",
            params![
                projection.conversation_id,
                projection.message_id,
                projection.sender_ptid,
                projection.sender_device_id,
                projection.plaintext,
                projection.created_at_unix_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    if pending_changed != 1 {
        return Err("messaging pending logical message conflicts with existing draft".to_string());
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

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS messaging_device_identity (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                ptid TEXT NOT NULL,
                device_id TEXT NOT NULL,
                device_signing_seed BLOB NOT NULL CHECK(length(device_signing_seed) = 32),
                actor_identity_public_key BLOB NOT NULL CHECK(length(actor_identity_public_key) = 32),
                actor_identity_key_fingerprint BLOB NOT NULL CHECK(length(actor_identity_key_fingerprint) = 32),
                device_signing_public_key BLOB NOT NULL CHECK(length(device_signing_public_key) = 32),
                actor_cross_signature BLOB NOT NULL CHECK(length(actor_cross_signature) = 64),
                signing_key_id TEXT NOT NULL,
                profile_version INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_recovery_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                status TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_conversations (
                conversation_id TEXT PRIMARY KEY,
                kind INTEGER NOT NULL,
                name TEXT NOT NULL,
                owner_ptid TEXT NOT NULL,
                membership_epoch INTEGER NOT NULL,
                mls_epoch INTEGER NOT NULL,
                active INTEGER NOT NULL,
                updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_conversation_members (
                conversation_id TEXT NOT NULL,
                ptid TEXT NOT NULL,
                active INTEGER NOT NULL,
                PRIMARY KEY(conversation_id, ptid),
                FOREIGN KEY(conversation_id)
                    REFERENCES messaging_conversations(conversation_id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS messaging_prekey_bundle (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                signed_prekey_id INTEGER NOT NULL,
                signed_prekey_private BLOB NOT NULL CHECK(length(signed_prekey_private) = 32),
                state TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_one_time_prekeys (
                prekey_id INTEGER PRIMARY KEY,
                private_key BLOB NOT NULL CHECK(length(private_key) = 32),
                state TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS direct_sessions (
                session_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                self_ptid TEXT NOT NULL,
                self_device_id TEXT NOT NULL,
                peer_ptid TEXT NOT NULL,
                peer_device_id TEXT NOT NULL,
                generation INTEGER NOT NULL,
                protocol_version INTEGER NOT NULL,
                established INTEGER NOT NULL,
                peer_identity_key BLOB NOT NULL CHECK(length(peer_identity_key) = 32),
                root_key BLOB NOT NULL CHECK(length(root_key) = 32),
                self_private_key BLOB NOT NULL CHECK(length(self_private_key) = 32),
                self_public_key BLOB NOT NULL CHECK(length(self_public_key) = 32),
                peer_ratchet_public_key BLOB,
                send_chain_key BLOB,
                receive_chain_key BLOB,
                send_counter INTEGER NOT NULL,
                receive_counter INTEGER NOT NULL,
                previous_counter INTEGER NOT NULL,
                updated_at_unix_ms INTEGER NOT NULL,
                UNIQUE(
                    conversation_id, self_ptid, self_device_id,
                    peer_ptid, peer_device_id, generation
                )
             );
             CREATE TABLE IF NOT EXISTS direct_skipped_message_keys (
                session_id TEXT NOT NULL,
                peer_ratchet_public_key BLOB NOT NULL CHECK(length(peer_ratchet_public_key) = 32),
                counter INTEGER NOT NULL,
                message_key BLOB NOT NULL CHECK(length(message_key) = 32),
                PRIMARY KEY(session_id, peer_ratchet_public_key, counter),
                FOREIGN KEY(session_id) REFERENCES direct_sessions(session_id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS direct_session_bootstraps (
                session_id TEXT PRIMARY KEY,
                init_bytes BLOB NOT NULL,
                FOREIGN KEY(session_id) REFERENCES direct_sessions(session_id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS messaging_mls_groups (
                conversation_id TEXT PRIMARY KEY,
                session_state BLOB NOT NULL,
                membership_epoch INTEGER NOT NULL,
                mls_epoch INTEGER NOT NULL,
                updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_mls_retired_checkpoints (
                conversation_id TEXT PRIMARY KEY,
                transition_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                retirement_sequence INTEGER NOT NULL,
                retirement_hash BLOB NOT NULL CHECK(length(retirement_hash) = 32),
                endpoint_ptid TEXT NOT NULL,
                endpoint_device_id TEXT NOT NULL,
                membership_epoch INTEGER NOT NULL,
                mls_epoch INTEGER NOT NULL,
                retired_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_mls_pending_transitions (
                conversation_id TEXT PRIMARY KEY,
                transition_id TEXT NOT NULL,
                command_id TEXT NOT NULL,
                transition_state BLOB NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_mls_actor_identity (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                ptid TEXT NOT NULL,
                device_id TEXT NOT NULL,
                identity_state BLOB NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_mls_join_provider_pool (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                provider_pool_state BLOB NOT NULL,
                updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_mls_key_packages (
                package_id TEXT PRIMARY KEY,
                data BLOB NOT NULL,
                state TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_mls_applied_transitions (
                conversation_id TEXT NOT NULL,
                transition_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                event_sequence INTEGER NOT NULL,
                transition_kind INTEGER NOT NULL,
                from_membership_epoch INTEGER NOT NULL,
                to_membership_epoch INTEGER NOT NULL,
                from_mls_epoch INTEGER NOT NULL,
                to_mls_epoch INTEGER NOT NULL,
                applied_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(conversation_id, transition_id),
                UNIQUE(conversation_id, event_sequence)
             );
             CREATE TABLE IF NOT EXISTS messaging_local_commands (
                command_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                command_bytes BLOB NOT NULL,
                state TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_membership_intents (
                intent_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                action INTEGER NOT NULL,
                target_ptid TEXT NOT NULL,
                target_device_id TEXT NOT NULL,
                role TEXT NOT NULL,
                state TEXT NOT NULL,
                command_id TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_messaging_membership_intents_pending
                ON messaging_membership_intents(state, created_at_unix_ms);
             CREATE UNIQUE INDEX IF NOT EXISTS uidx_messaging_membership_intents_active_conversation
                ON messaging_membership_intents(conversation_id)
                WHERE state IN ('pending_plan', 'prepared', 'superseded');
             CREATE TABLE IF NOT EXISTS messaging_pending_messages (
                conversation_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                sender_ptid TEXT NOT NULL,
                sender_device_id TEXT NOT NULL,
                plaintext TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(conversation_id, message_id)
             );
             CREATE TABLE IF NOT EXISTS messaging_command_attempts (
                command_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                delivery_plan_sha256 BLOB NOT NULL CHECK(length(delivery_plan_sha256) = 32),
                state TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL,
                FOREIGN KEY(command_id) REFERENCES messaging_local_commands(command_id)
             );
             CREATE TABLE IF NOT EXISTS messaging_command_outbox (
                command_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                command_bytes BLOB NOT NULL,
                state TEXT NOT NULL,
                attempt_count INTEGER NOT NULL,
                next_attempt_at_unix_ms INTEGER NOT NULL,
                last_error_code TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL,
                FOREIGN KEY(command_id) REFERENCES messaging_local_commands(command_id)
             );
             CREATE INDEX IF NOT EXISTS idx_messaging_command_outbox_due
                ON messaging_command_outbox(state, next_attempt_at_unix_ms);
             CREATE TABLE IF NOT EXISTS messaging_inbox_items (
                item_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                lane_sequence INTEGER NOT NULL,
                consumer_epoch INTEGER NOT NULL,
                payload_sha256 BLOB NOT NULL CHECK(length(payload_sha256) = 32),
                payload BLOB NOT NULL,
                state TEXT NOT NULL,
                claimed_at_unix_ms INTEGER NOT NULL
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_inbox_lane
                ON messaging_inbox_items(lane_sequence);
             CREATE TABLE IF NOT EXISTS messaging_consumption_markers (
                item_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                payload_sha256 BLOB NOT NULL CHECK(length(payload_sha256) = 32),
                consumed_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_lane_cursor (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                lane_sequence INTEGER NOT NULL,
                consumer_epoch INTEGER NOT NULL,
                updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_authority_heads (
                conversation_id TEXT PRIMARY KEY,
                event_sequence INTEGER NOT NULL,
                event_hash BLOB NOT NULL CHECK(length(event_hash) = 32),
                updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_message_projections (
                conversation_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                event_sequence INTEGER NOT NULL,
                message_id TEXT NOT NULL,
                sender_ptid TEXT NOT NULL,
                sender_device_id TEXT NOT NULL,
                plaintext TEXT NOT NULL,
                delivery_state TEXT NOT NULL,
                committed_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(conversation_id, event_id)
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_projection_message
                ON messaging_message_projections(conversation_id, message_id);
             CREATE TABLE IF NOT EXISTS messaging_attachment_metadata (
                message_id TEXT NOT NULL,
                attachment_id TEXT NOT NULL,
                metadata BLOB NOT NULL,
                PRIMARY KEY(message_id, attachment_id)
             );
             CREATE TABLE IF NOT EXISTS messaging_trust (
                peer_ptid TEXT PRIMARY KEY,
                fingerprint TEXT NOT NULL,
                verified_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messaging_receipt_outbox (
                receipt_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                receipt_bytes BLOB NOT NULL,
                state TEXT NOT NULL,
                created_at_unix_ms INTEGER NOT NULL
             );",
        )
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        store.persist_direct_send(&DirectSendCommit {
            command_bytes,
            advanced_sessions: &[direct_session(0)],
            session_inits: &[],
            projection: PendingSenderProjection {
                command_id,
                conversation_id: "conversation-1",
                message_id: command_id,
                sender_ptid: "ptid:alice",
                sender_device_id: "alice-device",
                plaintext: "sender plaintext",
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
            committed_at_unix_ms: 100,
        }
    }

    fn recovery_archive() -> MessagingRecoveryArchive {
        MessagingRecoveryArchive {
            ptid: "ptid:alice".to_string(),
            actor_identity_seed: [42; 32],
            actor_profile_version: 3,
            conversations: vec![RecoveryConversationProjection {
                conversation_id: "restored-conversation".to_string(),
                kind: 1,
                name: String::new(),
                owner_ptid: "ptid:alice".to_string(),
                member_ptids: vec!["ptid:alice".to_string(), "ptid:bob".to_string()],
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
                metadata: b"metadata".to_vec(),
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
        let result = store.persist_direct_send(&DirectSendCommit {
            command_bytes: b"exact bytes",
            advanced_sessions: &[session],
            session_inits: &[],
            projection: PendingSenderProjection {
                command_id: "command-overflow",
                conversation_id: "conversation-1",
                message_id: "message-overflow",
                sender_ptid: "ptid:alice",
                sender_device_id: "alice-device",
                plaintext: "must roll back",
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
        store
            .persist_mls_send(&MlsSendCommit {
                command_bytes: b"exact MLS command",
                session_state: b"advanced OpenMLS session",
                membership_epoch: 3,
                mls_epoch: 7,
                projection: PendingSenderProjection {
                    command_id: "group-command",
                    conversation_id: "group-1",
                    message_id: "group-message",
                    sender_ptid: "ptid:alice",
                    sender_device_id: "alice-device",
                    plaintext: "group plaintext",
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
        let projection = projection();
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
            assert_eq!(count, 1, "table {table}");
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
            let projection = projection();
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
