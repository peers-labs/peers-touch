use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use secure_content_core::object::{
    ObjectDescriptor, ObjectTransferDirection, ObjectTransferErrorCode, ObjectTransferFailure,
    ObjectTransferRecord, ObjectTransferState,
};
use secure_content_core::operation::{
    acquire_operation, apply_readback_decision, complete_operation, recover_interrupted_operation,
    DispatchCause, OperationCompletion, OperationKind, OperationLease, OperationRecord,
    OperationState, PreparedContentPreKeyPublication, ReadbackDecision,
};
use secure_content_core::ports::{LifecycleCancellation, ObjectTransferRepository};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::secure_content::proto::secure_content::v1::ContentPreKeyKind;

const ENDPOINT_PREKEY_KIND: i64 = ContentPreKeyKind::ContentPrekeyKindEndpoint as i32 as i64;
const RECOVERY_PREKEY_KIND: i64 = ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32 as i64;
const MAX_REACTION_RETRY_AFTER_SECONDS: u64 = 300;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i64)]
pub enum ReactionCommandState {
    Pending = 1,
    InFlight = 2,
    UnknownOutcome = 3,
    Committed = 4,
    Retrying = 5,
    Rejected = 6,
}

impl ReactionCommandState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "REACTION_PENDING",
            Self::InFlight | Self::Retrying => "REACTION_RETRYING",
            Self::UnknownOutcome => "REACTION_UNKNOWN_OUTCOME",
            Self::Committed => "REACTION_COMMITTED",
            Self::Rejected => "REACTION_REJECTED",
        }
    }
}

impl TryFrom<i64> for ReactionCommandState {
    type Error = String;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Pending),
            2 => Ok(Self::InFlight),
            3 => Ok(Self::UnknownOutcome),
            4 => Ok(Self::Committed),
            5 => Ok(Self::Retrying),
            6 => Ok(Self::Rejected),
            _ => Err("private Reaction command state is invalid".to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i64)]
pub enum CommentState {
    Editing = 1,
    Encrypting = 2,
    Submitting = 3,
    Posted = 4,
    Failed = 5,
    RateLimited = 6,
    ParentUnavailable = 7,
}

impl CommentState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Editing => "COMMENT_EDITING",
            Self::Encrypting => "COMMENT_ENCRYPTING",
            Self::Submitting => "COMMENT_SUBMITTING",
            Self::Posted => "COMMENT_POSTED",
            Self::Failed => "COMMENT_FAILED",
            Self::RateLimited => "COMMENT_RATE_LIMITED",
            Self::ParentUnavailable => "COMMENT_PARENT_UNAVAILABLE",
        }
    }
}

impl TryFrom<i64> for CommentState {
    type Error = String;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Editing),
            2 => Ok(Self::Encrypting),
            3 => Ok(Self::Submitting),
            4 => Ok(Self::Posted),
            5 => Ok(Self::Failed),
            6 => Ok(Self::RateLimited),
            7 => Ok(Self::ParentUnavailable),
            _ => Err("private Comment durable state is invalid".to_string()),
        }
    }
}

#[derive(Clone, Debug)]
pub struct StoredDraft {
    pub draft_id: String,
    pub draft_revision: u64,
    pub intent_sha256: [u8; 32],
    pub content_id: String,
    pub prepare_command_id: String,
    pub mention_commitment_salt: Option<[u8; 32]>,
    pub repost_commitment_salt: Option<[u8; 32]>,
    pub object_material_seed: Option<[u8; 32]>,
}

#[derive(Clone, Debug)]
pub struct StoredCommentDraft {
    pub draft_id: String,
    pub draft_revision: u64,
    pub post_id: String,
    pub reply_to_comment_id: String,
    pub text: String,
    pub mention_intent_json: String,
    pub mention_commitment_salt: Option<[u8; 32]>,
    pub intent_sha256: [u8; 32],
    pub content_id: String,
    pub prepare_command_id: String,
    pub submit_command_id: Option<String>,
    pub request_bytes: Option<Vec<u8>>,
    pub request_sha256: Option<[u8; 32]>,
    pub root_key: Option<[u8; 32]>,
    pub generation: u64,
    pub publication_state: Option<OperationState>,
    pub lease_generation: u64,
    pub session_generation: u64,
    pub attempt_count: u32,
    pub next_attempt_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub state: CommentState,
    pub comment_id: Option<String>,
    pub error_code: Option<String>,
    pub retry_after_seconds: Option<u64>,
}

impl Drop for StoredCommentDraft {
    fn drop(&mut self) {
        if let Some(root_key) = self.root_key.as_mut() {
            root_key.zeroize();
        }
    }
}

#[derive(Clone, Debug)]
pub struct AcquiredCommentSubmission {
    pub draft: StoredCommentDraft,
    pub lease: OperationLease,
}

impl StoredCommentDraft {
    pub(crate) fn operation_record(&self) -> Result<OperationRecord, String> {
        let command_id = self
            .submit_command_id
            .as_ref()
            .ok_or_else(|| "private Comment command ID is unavailable".to_string())?;
        let command_bytes = self
            .request_bytes
            .as_deref()
            .ok_or_else(|| "private Comment command bytes are unavailable".to_string())?;
        let command_sha256 = self
            .request_sha256
            .ok_or_else(|| "private Comment command hash is unavailable".to_string())?;
        let state = self
            .publication_state
            .ok_or_else(|| "private Comment operation state is unavailable".to_string())?;
        let record = OperationRecord {
            operation_id: command_id.clone(),
            command_id: command_id.clone(),
            kind: OperationKind::OwnerSubmission,
            state,
            command_sha256,
            session_generation: self.session_generation,
            lease_generation: self.lease_generation,
            attempt_count: self.attempt_count,
            next_attempt_at_unix_ms: self.next_attempt_at_unix_ms,
            updated_at_unix_ms: self.updated_at_unix_ms,
        };
        record
            .validate_command_bytes(command_bytes)
            .map_err(|error| error.to_string())?;
        Ok(record)
    }
}

#[derive(Clone, Debug)]
pub struct StoredSubmission {
    pub command_id: String,
    pub draft_id: String,
    pub draft_revision: u64,
    pub content_id: String,
    pub generation: u64,
    pub request_bytes: Vec<u8>,
    pub request_sha256: [u8; 32],
    pub root_key: [u8; 32],
    pub projection_json: Vec<u8>,
    pub state: OperationState,
    pub lease_generation: u64,
    pub session_generation: u64,
    pub attempt_count: u32,
    pub next_attempt_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub post_id: Option<String>,
    pub last_error_code: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredReactionCommand {
    pub command_id: String,
    pub post_id: String,
    pub kind: i32,
    pub remove: bool,
    pub request_sha256: [u8; 32],
    pub request_bytes: Vec<u8>,
    pub result_sha256: Option<[u8; 32]>,
    pub result_bytes: Option<Vec<u8>>,
    pub state: ReactionCommandState,
    pub session_generation: u64,
    pub lease_generation: u64,
    pub attempt_count: u32,
    pub projection_revision: u64,
    pub error_code: Option<String>,
    pub retry_after_seconds: Option<u64>,
    pub retry_not_before_unix_ms: Option<i64>,
}

impl Drop for StoredSubmission {
    fn drop(&mut self) {
        self.root_key.zeroize();
    }
}

#[derive(Clone, Debug)]
pub struct AcquiredSubmission {
    pub command: StoredSubmission,
    pub lease: OperationLease,
}

#[derive(Clone, Debug)]
pub struct StoredPreKeyPublication {
    pub command_id: String,
    pub key_kind: i32,
    pub pool_epoch: u64,
    pub request_bytes: Vec<u8>,
    pub request_sha256: [u8; 32],
    pub state: OperationState,
    pub lease_generation: u64,
    pub session_generation: u64,
    pub attempt_count: u32,
    pub next_attempt_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Clone, Debug)]
pub struct AcquiredPreKeyPublication {
    pub command: StoredPreKeyPublication,
    pub lease: OperationLease,
}

impl StoredSubmission {
    pub(crate) fn operation_record_for_runtime(&self) -> Result<OperationRecord, String> {
        let record = OperationRecord {
            operation_id: self.command_id.clone(),
            command_id: self.command_id.clone(),
            kind: OperationKind::OwnerSubmission,
            state: self.state,
            command_sha256: self.request_sha256,
            session_generation: self.session_generation,
            lease_generation: self.lease_generation,
            attempt_count: self.attempt_count,
            next_attempt_at_unix_ms: self.next_attempt_at_unix_ms,
            updated_at_unix_ms: self.updated_at_unix_ms,
        };
        record
            .validate_command_bytes(&self.request_bytes)
            .map_err(|error| error.to_string())?;
        Ok(record)
    }

    fn operation_record(&self) -> Result<OperationRecord, String> {
        self.operation_record_for_runtime()
    }
}

impl StoredPreKeyPublication {
    fn operation_record(&self) -> Result<OperationRecord, String> {
        let record = OperationRecord {
            operation_id: self.command_id.clone(),
            command_id: self.command_id.clone(),
            kind: OperationKind::ContentPreKeyPublication,
            state: self.state,
            command_sha256: self.request_sha256,
            session_generation: self.session_generation,
            lease_generation: self.lease_generation,
            attempt_count: self.attempt_count,
            next_attempt_at_unix_ms: self.next_attempt_at_unix_ms,
            updated_at_unix_ms: self.updated_at_unix_ms,
        };
        record
            .validate_command_bytes(&self.request_bytes)
            .map_err(|error| error.to_string())?;
        Ok(record)
    }
}

#[derive(Clone, Debug)]
pub struct StoredEndpointPreKey {
    pub key_id: String,
    pub pool_epoch: u64,
    pub private_key: [u8; 32],
}

impl Drop for StoredEndpointPreKey {
    fn drop(&mut self) {
        self.private_key.zeroize();
    }
}

pub struct PrivateSocialStore {
    connection: Mutex<Connection>,
    session_generation: AtomicU64,
}

impl LifecycleCancellation for PrivateSocialStore {
    fn is_cancelled(&self) -> bool {
        self.session_generation.load(Ordering::Acquire) == 0
    }
}

impl PrivateSocialStore {
    pub fn open(
        path: &Path,
        database_key: &[u8; 32],
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> Result<Self, String> {
        if station_peer_id.trim().is_empty() || actor_ptid.trim().is_empty() {
            return Err("private Social store scope is incomplete".to_string());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create private Social store directory: {error}"))?;
        }
        let connection = Connection::open(path)
            .map_err(|error| format!("open private Social SQLCipher store: {error}"))?;
        connection
            .pragma_update(None, "key", format!("x'{}'", hex(database_key)))
            .map_err(|error| format!("unlock private Social SQLCipher store: {error}"))?;
        connection
            .execute_batch(
                "PRAGMA cipher_memory_security = ON;
                 PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;",
            )
            .map_err(|error| format!("configure private Social SQLCipher store: {error}"))?;
        Self::from_connection(connection, station_peer_id, actor_ptid)
    }

    #[cfg(test)]
    pub fn in_memory(station_peer_id: &str, actor_ptid: &str) -> Result<Self, String> {
        Self::from_connection(
            Connection::open_in_memory().map_err(|error| error.to_string())?,
            station_peer_id,
            actor_ptid,
        )
    }

    fn from_connection(
        mut connection: Connection,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> Result<Self, String> {
        migrate(&mut connection)?;
        bind_scope(&connection, station_peer_id, actor_ptid)?;
        let store = Self {
            connection: Mutex::new(connection),
            session_generation: AtomicU64::new(0),
        };
        store.recover_interrupted_dispatches()?;
        Ok(store)
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "private Social store lock poisoned".to_string())
    }

    pub fn bind_session_generation(&self, generation: u64) -> Result<(), String> {
        if generation == 0 {
            return Err("private Social session generation is required".to_string());
        }
        self.connection()?
            .execute(
                "UPDATE mobile_private_social_object_transfers
                 SET session_generation = ?1",
                params![to_i64(generation, "session generation")?],
            )
            .map_err(|error| error.to_string())?;
        self.session_generation.store(generation, Ordering::Release);
        Ok(())
    }

    pub fn ensure_session_generation(&self, expected: u64) -> Result<(), String> {
        if expected != 0 && self.session_generation.load(Ordering::Acquire) == expected {
            Ok(())
        } else {
            Err("private Social session generation is stale".to_string())
        }
    }

    pub fn invalidate_session_generation(&self, expected: u64) -> Result<(), String> {
        let _connection = self.connection()?;
        self.session_generation
            .compare_exchange(expected, 0, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| "private Social session generation is stale".to_string())
    }

    fn generation(&self) -> Result<u64, String> {
        let generation = self.session_generation.load(Ordering::Acquire);
        if generation == 0 {
            Err("private Social store is not bound to a session generation".to_string())
        } else {
            Ok(generation)
        }
    }

    pub fn recover_interrupted_dispatches(&self) -> Result<usize, String> {
        let now = now_unix_ms();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let submissions = {
            let mut statement = transaction
                .prepare(
                    "SELECT command_id, draft_id, draft_revision, content_id, generation,
                            request_bytes, request_sha256, root_key, projection_json, state,
                            lease_generation, session_generation, attempt_count,
                            next_attempt_at_unix_ms, updated_at_unix_ms, post_id, last_error_code
                     FROM mobile_private_social_submissions WHERE state = ?1",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(
                    params![OperationState::InFlight as i64],
                    submission_from_row,
                )
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        let comments = {
            let mut statement = transaction
                .prepare(
                    "SELECT draft_id, draft_revision, post_id, reply_to_comment_id, text,
                            mention_intent_json, mention_commitment_salt, intent_sha256,
                            content_id, prepare_command_id, submit_command_id, request_bytes,
                            request_sha256, root_key, generation, publication_state,
                            lease_generation, session_generation, attempt_count,
                            next_attempt_at_unix_ms, updated_at_unix_ms, state, comment_id,
                            error_code, retry_after_seconds
                     FROM mobile_private_social_comment_drafts
                     WHERE publication_state = ?1",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(
                    params![OperationState::InFlight as i64],
                    comment_draft_from_row,
                )
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        let prekeys = {
            let mut statement = transaction
                .prepare(
                    "SELECT command_id, key_kind, pool_epoch, request_bytes, request_sha256,
                            state, lease_generation, session_generation, attempt_count,
                            next_attempt_at_unix_ms, updated_at_unix_ms
                     FROM mobile_private_social_prekey_commands WHERE state = ?1",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(
                    params![OperationState::InFlight as i64],
                    prekey_publication_from_row,
                )
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        let mut recovered = 0;
        for command in submissions {
            let current = command.operation_record()?;
            let next =
                recover_interrupted_operation(&current, now).map_err(|error| error.to_string())?;
            recovered += transaction
                .execute(
                    "UPDATE mobile_private_social_submissions
                     SET state = ?1, next_attempt_at_unix_ms = ?2, updated_at_unix_ms = ?3
                     WHERE command_id = ?4 AND state = ?5
                       AND lease_generation = ?6 AND session_generation = ?7",
                    params![
                        next.state as i64,
                        next.next_attempt_at_unix_ms,
                        next.updated_at_unix_ms,
                        command.command_id,
                        current.state as i64,
                        to_i64(current.lease_generation, "lease generation")?,
                        to_i64(current.session_generation, "session generation")?,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        for draft in comments {
            let current = draft.operation_record()?;
            let next =
                recover_interrupted_operation(&current, now).map_err(|error| error.to_string())?;
            recovered += transaction
                .execute(
                    "UPDATE mobile_private_social_comment_drafts
                     SET publication_state = ?1, state = ?2, error_code = ?3,
                         next_attempt_at_unix_ms = ?4, updated_at_unix_ms = ?5
                     WHERE draft_id = ?6 AND draft_revision = ?7
                       AND publication_state = ?8
                       AND lease_generation = ?9 AND session_generation = ?10",
                    params![
                        next.state as i64,
                        CommentState::Failed as i64,
                        "SOCIAL_PRIVATE_COMMENT_RESULT_UNKNOWN",
                        next.next_attempt_at_unix_ms,
                        next.updated_at_unix_ms,
                        draft.draft_id,
                        to_i64(draft.draft_revision, "comment draft revision")?,
                        current.state as i64,
                        to_i64(current.lease_generation, "comment lease generation")?,
                        to_i64(current.session_generation, "comment session generation")?,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        for command in prekeys {
            let current = command.operation_record()?;
            let next =
                recover_interrupted_operation(&current, now).map_err(|error| error.to_string())?;
            recovered += transaction
                .execute(
                    "UPDATE mobile_private_social_prekey_commands
                     SET state = ?1, next_attempt_at_unix_ms = ?2, updated_at_unix_ms = ?3
                     WHERE command_id = ?4 AND state = ?5
                       AND lease_generation = ?6 AND session_generation = ?7",
                    params![
                        next.state as i64,
                        next.next_attempt_at_unix_ms,
                        next.updated_at_unix_ms,
                        command.command_id,
                        current.state as i64,
                        to_i64(current.lease_generation, "lease generation")?,
                        to_i64(current.session_generation, "session generation")?,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        recovered += transaction
            .execute(
                "UPDATE mobile_private_social_reaction_commands
                 SET state = ?1, updated_at_unix_ms = ?2 WHERE state = ?3",
                params![
                    ReactionCommandState::UnknownOutcome as i64,
                    now,
                    ReactionCommandState::InFlight as i64
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(recovered)
    }

    pub fn reserve_draft(&self, candidate: &StoredDraft) -> Result<StoredDraft, String> {
        validate_draft(candidate)?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO mobile_private_social_drafts(
                   draft_id, draft_revision, intent_sha256, content_id,
                   prepare_command_id, mention_commitment_salt,
                   repost_commitment_salt, object_material_seed, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(draft_id, draft_revision) DO NOTHING",
                params![
                    candidate.draft_id,
                    to_i64(candidate.draft_revision, "draft revision")?,
                    candidate.intent_sha256.as_slice(),
                    candidate.content_id,
                    candidate.prepare_command_id,
                    candidate
                        .mention_commitment_salt
                        .as_ref()
                        .map(|salt| salt.as_slice()),
                    candidate
                        .repost_commitment_salt
                        .as_ref()
                        .map(|salt| salt.as_slice()),
                    candidate
                        .object_material_seed
                        .as_ref()
                        .map(|seed| seed.as_slice()),
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored = connection
            .query_row(
                "SELECT draft_id, draft_revision, intent_sha256, content_id,
                        prepare_command_id, mention_commitment_salt,
                        repost_commitment_salt, object_material_seed
                 FROM mobile_private_social_drafts
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![
                    candidate.draft_id,
                    to_i64(candidate.draft_revision, "draft revision")?
                ],
                draft_from_row,
            )
            .map_err(|error| error.to_string())?;
        if stored.intent_sha256 != candidate.intent_sha256
            || stored.prepare_command_id != candidate.prepare_command_id
        {
            return Err("private Social draft replay conflict".to_string());
        }
        Ok(stored)
    }

    pub fn reserve_comment_draft(
        &self,
        candidate: &StoredCommentDraft,
    ) -> Result<StoredCommentDraft, String> {
        if candidate.draft_id.trim().is_empty()
            || candidate.draft_revision == 0
            || candidate.post_id.trim().is_empty()
            || candidate.content_id.trim().is_empty()
            || candidate.prepare_command_id.trim().is_empty()
        {
            return Err("private Comment draft reservation is invalid".to_string());
        }
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO mobile_private_social_comment_drafts(
                   draft_id, draft_revision, post_id, reply_to_comment_id, text,
                   mention_intent_json, mention_commitment_salt, intent_sha256,
                   content_id, prepare_command_id, state, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(draft_id, draft_revision) DO NOTHING",
                params![
                    candidate.draft_id,
                    to_i64(candidate.draft_revision, "comment draft revision")?,
                    candidate.post_id,
                    candidate.reply_to_comment_id,
                    candidate.text,
                    candidate.mention_intent_json,
                    candidate
                        .mention_commitment_salt
                        .as_ref()
                        .map(|salt| salt.as_slice()),
                    candidate.intent_sha256.as_slice(),
                    candidate.content_id,
                    candidate.prepare_command_id,
                    candidate.state as i64,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored = connection
            .query_row(
                "SELECT draft_id, draft_revision, post_id, reply_to_comment_id, text,
                        mention_intent_json, mention_commitment_salt, intent_sha256,
                        content_id, prepare_command_id, submit_command_id, request_bytes,
                        request_sha256, root_key, generation, publication_state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, state, comment_id,
                        error_code, retry_after_seconds
                 FROM mobile_private_social_comment_drafts
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![
                    candidate.draft_id,
                    to_i64(candidate.draft_revision, "comment draft revision")?
                ],
                comment_draft_from_row,
            )
            .map_err(|error| error.to_string())?;
        if stored.intent_sha256 != candidate.intent_sha256
            || stored.prepare_command_id != candidate.prepare_command_id
        {
            return Err("private Comment draft replay conflict".to_string());
        }
        Ok(stored)
    }

    pub fn comment_draft(
        &self,
        draft_id: &str,
        draft_revision: u64,
    ) -> Result<Option<StoredCommentDraft>, String> {
        self.connection()?
            .query_row(
                "SELECT draft_id, draft_revision, post_id, reply_to_comment_id, text,
                        mention_intent_json, mention_commitment_salt, intent_sha256,
                        content_id, prepare_command_id, submit_command_id, request_bytes,
                        request_sha256, root_key, generation, publication_state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, state, comment_id,
                        error_code, retry_after_seconds
                 FROM mobile_private_social_comment_drafts
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "comment draft revision")?],
                comment_draft_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn comment_drafts(&self) -> Result<Vec<StoredCommentDraft>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT draft_id, draft_revision, post_id, reply_to_comment_id, text,
                        mention_intent_json, mention_commitment_salt, intent_sha256,
                        content_id, prepare_command_id, submit_command_id, request_bytes,
                        request_sha256, root_key, generation, publication_state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, state, comment_id,
                        error_code, retry_after_seconds
                 FROM mobile_private_social_comment_drafts
                 ORDER BY updated_at_unix_ms DESC, draft_id, draft_revision",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], comment_draft_from_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn persist_comment_request(
        &self,
        draft_id: &str,
        draft_revision: u64,
        generation: u64,
        submit_command_id: &str,
        request_bytes: &[u8],
        request_sha256: &[u8; 32],
        root_key: &[u8; 32],
        session_generation: u64,
    ) -> Result<(), String> {
        if request_bytes.is_empty()
            || Sha256::digest(request_bytes).as_slice() != request_sha256
            || generation == 0
            || submit_command_id.trim().is_empty()
            || session_generation == 0
        {
            return Err("private Comment prepared request is invalid".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "UPDATE mobile_private_social_comment_drafts
                 SET generation = ?1, submit_command_id = ?2, request_bytes = ?3,
                     request_sha256 = ?4, root_key = ?5, state = ?6,
                     publication_state = ?7, lease_generation = 0,
                     session_generation = ?8, attempt_count = 0,
                     next_attempt_at_unix_ms = 0,
                     error_code = NULL, retry_after_seconds = NULL,
                     updated_at_unix_ms = ?9
                 WHERE draft_id = ?10 AND draft_revision = ?11
                   AND intent_sha256 = (
                     SELECT intent_sha256 FROM mobile_private_social_comment_drafts
                     WHERE draft_id = ?10 AND draft_revision = ?11
                   )",
                params![
                    to_i64(generation, "comment generation")?,
                    submit_command_id,
                    request_bytes,
                    request_sha256.as_slice(),
                    root_key.as_slice(),
                    CommentState::Submitting as i64,
                    OperationState::Pending as i64,
                    to_i64(session_generation, "comment session generation")?,
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "comment draft revision")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            Ok(())
        } else {
            Err("private Comment draft is unavailable".to_string())
        }
    }

    pub fn acquire_comment_submission(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        cause: DispatchCause,
    ) -> Result<AcquiredCommentSubmission, String> {
        self.ensure_session_generation(session_generation)?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut draft = transaction
            .query_row(
                "SELECT draft_id, draft_revision, post_id, reply_to_comment_id, text,
                        mention_intent_json, mention_commitment_salt, intent_sha256,
                        content_id, prepare_command_id, submit_command_id, request_bytes,
                        request_sha256, root_key, generation, publication_state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, state, comment_id,
                        error_code, retry_after_seconds
                 FROM mobile_private_social_comment_drafts
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "comment draft revision")?],
                comment_draft_from_row,
            )
            .map_err(|error| error.to_string())?;
        let current = draft.operation_record()?;
        let lease = acquire_operation(&current, session_generation, cause, now_unix_ms())
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_comment_drafts
                 SET publication_state = ?1, lease_generation = ?2,
                     session_generation = ?3, attempt_count = ?4,
                     next_attempt_at_unix_ms = ?5, state = ?6,
                     error_code = NULL, retry_after_seconds = NULL,
                     updated_at_unix_ms = ?7
                 WHERE draft_id = ?8 AND draft_revision = ?9
                   AND publication_state = ?10
                   AND lease_generation = ?11 AND session_generation = ?12",
                params![
                    lease.record.state as i64,
                    to_i64(lease.record.lease_generation, "comment lease generation")?,
                    to_i64(
                        lease.record.session_generation,
                        "comment session generation"
                    )?,
                    i64::from(lease.record.attempt_count),
                    lease.record.next_attempt_at_unix_ms,
                    CommentState::Submitting as i64,
                    lease.record.updated_at_unix_ms,
                    draft_id,
                    to_i64(draft_revision, "comment draft revision")?,
                    current.state as i64,
                    to_i64(current.lease_generation, "comment lease generation")?,
                    to_i64(current.session_generation, "comment session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("private Comment submission lost its operation fence".to_string());
        }
        apply_operation_record_to_comment(&mut draft, &lease.record);
        draft.state = CommentState::Submitting;
        draft.error_code = None;
        draft.retry_after_seconds = None;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(AcquiredCommentSubmission { draft, lease })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn complete_comment_submission(
        &self,
        acquired: &AcquiredCommentSubmission,
        completion: OperationCompletion,
        state: CommentState,
        comment_id: Option<&str>,
        error_code: Option<&str>,
        retry_after_seconds: Option<u64>,
    ) -> Result<bool, String> {
        let current = acquired.draft.operation_record()?;
        let completed = complete_operation(
            &current,
            acquired.lease.record.fence(),
            completion,
            now_unix_ms(),
        )
        .map_err(|error| error.to_string())?;
        self.connection()?
            .execute(
                "UPDATE mobile_private_social_comment_drafts
                 SET publication_state = ?1,
                     comment_id = COALESCE(?2, comment_id),
                     state = ?3, error_code = ?4, retry_after_seconds = ?5,
                     next_attempt_at_unix_ms = ?6, updated_at_unix_ms = ?7
                 WHERE draft_id = ?8 AND draft_revision = ?9
                   AND publication_state = ?10
                   AND lease_generation = ?11 AND session_generation = ?12",
                params![
                    completed.state as i64,
                    comment_id,
                    state as i64,
                    error_code,
                    retry_after_seconds.map(|value| value.min(i64::MAX as u64) as i64),
                    completed.next_attempt_at_unix_ms,
                    completed.updated_at_unix_ms,
                    acquired.draft.draft_id,
                    to_i64(acquired.draft.draft_revision, "comment draft revision")?,
                    OperationState::InFlight as i64,
                    to_i64(acquired.draft.lease_generation, "comment lease generation")?,
                    to_i64(
                        acquired.draft.session_generation,
                        "comment session generation"
                    )?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn apply_comment_readback(
        &self,
        draft: &StoredCommentDraft,
        decision: &ReadbackDecision,
        state: CommentState,
        comment_id: Option<&str>,
        error_code: Option<&str>,
        retry_after_seconds: Option<u64>,
    ) -> Result<bool, String> {
        let current = draft.operation_record()?;
        let advanced = apply_readback_decision(&current, current.fence(), decision, now_unix_ms())
            .map_err(|error| error.to_string())?;
        self.connection()?
            .execute(
                "UPDATE mobile_private_social_comment_drafts
                 SET publication_state = ?1,
                     comment_id = COALESCE(?2, comment_id),
                     state = ?3, error_code = ?4, retry_after_seconds = ?5,
                     next_attempt_at_unix_ms = ?6, updated_at_unix_ms = ?7
                 WHERE draft_id = ?8 AND draft_revision = ?9
                   AND publication_state = ?10
                   AND lease_generation = ?11 AND session_generation = ?12",
                params![
                    advanced.state as i64,
                    comment_id,
                    state as i64,
                    error_code,
                    retry_after_seconds.map(|value| value.min(i64::MAX as u64) as i64),
                    advanced.next_attempt_at_unix_ms,
                    advanced.updated_at_unix_ms,
                    draft.draft_id,
                    to_i64(draft.draft_revision, "comment draft revision")?,
                    current.state as i64,
                    to_i64(current.lease_generation, "comment lease generation")?,
                    to_i64(current.session_generation, "comment session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn finish_comment(
        &self,
        draft_id: &str,
        draft_revision: u64,
        state: CommentState,
        comment_id: Option<&str>,
        error_code: Option<&str>,
        retry_after_seconds: Option<u64>,
    ) -> Result<(), String> {
        let changed = self
            .connection()?
            .execute(
                "UPDATE mobile_private_social_comment_drafts
                 SET state = ?1, comment_id = COALESCE(?2, comment_id), error_code = ?3,
                     retry_after_seconds = ?4, updated_at_unix_ms = ?5
                 WHERE draft_id = ?6 AND draft_revision = ?7",
                params![
                    state as i64,
                    comment_id,
                    error_code,
                    retry_after_seconds.map(|value| value.min(i64::MAX as u64) as i64),
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "comment draft revision")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            Ok(())
        } else {
            Err("private Comment draft is unavailable".to_string())
        }
    }

    pub fn persist_comment_projection(
        &self,
        comment_id: &str,
        post_id: &str,
        projection_json: &[u8],
    ) -> Result<(), String> {
        if comment_id.trim().is_empty() || post_id.trim().is_empty() || projection_json.is_empty() {
            return Err("private Comment projection is invalid".to_string());
        }
        self.connection()?
            .execute(
                "INSERT INTO mobile_private_social_comment_projections(
                   comment_id, post_id, projection_json, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(comment_id) DO UPDATE SET
                   post_id = excluded.post_id,
                   projection_json = excluded.projection_json,
                   updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![comment_id, post_id, projection_json, now_unix_ms()],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn comment_projections(&self, post_id: &str) -> Result<Vec<Vec<u8>>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT projection_json FROM mobile_private_social_comment_projections
                 WHERE post_id = ?1 ORDER BY updated_at_unix_ms, comment_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![post_id], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn comment_projection(&self, comment_id: &str) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT projection_json FROM mobile_private_social_comment_projections
                 WHERE comment_id = ?1",
                params![comment_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn all_comment_projections(&self) -> Result<Vec<Vec<u8>>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT projection_json FROM mobile_private_social_comment_projections
                 ORDER BY updated_at_unix_ms DESC, comment_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn persist_submission(&self, command: &StoredSubmission) -> Result<(), String> {
        validate_submission(command)?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO mobile_private_social_submissions(
                   command_id, draft_id, draft_revision, content_id, generation,
                   request_bytes, request_sha256, root_key, projection_json, state,
                   lease_generation, session_generation, attempt_count,
                   next_attempt_at_unix_ms, post_id, last_error_code, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, 0, 0,
                          NULL, NULL, ?12)
                 ON CONFLICT(command_id) DO NOTHING",
                params![
                    command.command_id,
                    command.draft_id,
                    to_i64(command.draft_revision, "draft revision")?,
                    command.content_id,
                    to_i64(command.generation, "content generation")?,
                    command.request_bytes,
                    command.request_sha256.as_slice(),
                    command.root_key.as_slice(),
                    command.projection_json,
                    command.state as i64,
                    to_i64(self.generation()?, "session generation")?,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored_hash: Vec<u8> = connection
            .query_row(
                "SELECT request_sha256 FROM mobile_private_social_submissions
                 WHERE command_id = ?1",
                params![command.command_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if stored_hash != command.request_sha256 {
            return Err("private Social submission replay conflict".to_string());
        }
        Ok(())
    }

    pub fn submission(
        &self,
        draft_id: &str,
        draft_revision: u64,
    ) -> Result<Option<StoredSubmission>, String> {
        self.connection()?
            .query_row(
                "SELECT command_id, draft_id, draft_revision, content_id, generation,
                        request_bytes, request_sha256, root_key, projection_json, state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, post_id, last_error_code
                 FROM mobile_private_social_submissions
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "draft revision")?],
                submission_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn submission_by_command_id(
        &self,
        command_id: &str,
    ) -> Result<Option<StoredSubmission>, String> {
        self.connection()?
            .query_row(
                "SELECT command_id, draft_id, draft_revision, content_id, generation,
                        request_bytes, request_sha256, root_key, projection_json, state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, post_id, last_error_code
                 FROM mobile_private_social_submissions WHERE command_id = ?1",
                params![command_id],
                submission_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn pending_submissions(&self) -> Result<Vec<StoredSubmission>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT command_id, draft_id, draft_revision, content_id, generation,
                        request_bytes, request_sha256, root_key, projection_json, state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, post_id, last_error_code
                 FROM mobile_private_social_submissions
                 WHERE state IN (?1, ?2, ?3)
                    OR (state = ?4 AND next_attempt_at_unix_ms <= ?5)
                 ORDER BY updated_at_unix_ms, command_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![
                    OperationState::Pending as i64,
                    OperationState::UnknownOutcome as i64,
                    OperationState::CommittedPendingReadback as i64,
                    OperationState::RetryWait as i64,
                    now_unix_ms(),
                ],
                submission_from_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn acquire_submission(
        &self,
        command_id: &str,
        cause: DispatchCause,
    ) -> Result<AcquiredSubmission, String> {
        let generation = self.generation()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut command = transaction
            .query_row(
                "SELECT command_id, draft_id, draft_revision, content_id, generation,
                        request_bytes, request_sha256, root_key, projection_json, state,
                        lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms, post_id, last_error_code
                 FROM mobile_private_social_submissions WHERE command_id = ?1",
                params![command_id],
                submission_from_row,
            )
            .map_err(|error| error.to_string())?;
        let current = command.operation_record()?;
        let lease = acquire_operation(&current, generation, cause, now_unix_ms())
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_submissions
                 SET state = ?1, lease_generation = ?2, session_generation = ?3,
                     attempt_count = ?4, next_attempt_at_unix_ms = ?5,
                     updated_at_unix_ms = ?6
                 WHERE command_id = ?7 AND state = ?8
                   AND lease_generation = ?9 AND session_generation = ?10",
                params![
                    lease.record.state as i64,
                    to_i64(lease.record.lease_generation, "lease generation")?,
                    to_i64(lease.record.session_generation, "session generation")?,
                    i64::from(lease.record.attempt_count),
                    lease.record.next_attempt_at_unix_ms,
                    lease.record.updated_at_unix_ms,
                    command_id,
                    current.state as i64,
                    to_i64(current.lease_generation, "lease generation")?,
                    to_i64(current.session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("private Social submission lost its operation fence".to_string());
        }
        apply_operation_record_to_submission(&mut command, &lease.record);
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(AcquiredSubmission { command, lease })
    }

    pub fn complete_submission(
        &self,
        acquired: &AcquiredSubmission,
        completion: OperationCompletion,
        post_id: Option<&str>,
        error_code: Option<i32>,
        projection_json: &[u8],
    ) -> Result<bool, String> {
        let current = acquired.command.operation_record()?;
        let completed = complete_operation(
            &current,
            acquired.lease.record.fence(),
            completion,
            now_unix_ms(),
        )
        .map_err(|error| error.to_string())?;
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE mobile_private_social_submissions
                 SET state = ?1, post_id = COALESCE(?2, post_id), last_error_code = ?3,
                     projection_json = ?4, next_attempt_at_unix_ms = ?5,
                     updated_at_unix_ms = ?6
                 WHERE command_id = ?7 AND state = ?8
                   AND lease_generation = ?9 AND session_generation = ?10",
                params![
                    completed.state as i64,
                    post_id,
                    error_code,
                    projection_json,
                    completed.next_attempt_at_unix_ms,
                    completed.updated_at_unix_ms,
                    acquired.command.command_id,
                    OperationState::InFlight as i64,
                    to_i64(acquired.command.lease_generation, "lease generation")?,
                    to_i64(acquired.command.session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn apply_submission_readback(
        &self,
        command: &StoredSubmission,
        decision: &ReadbackDecision,
        post_id: Option<&str>,
        error_code: Option<i32>,
        projection_json: &[u8],
    ) -> Result<bool, String> {
        let current = command.operation_record()?;
        let advanced = apply_readback_decision(&current, current.fence(), decision, now_unix_ms())
            .map_err(|error| error.to_string())?;
        self.connection()?
            .execute(
                "UPDATE mobile_private_social_submissions
                 SET state = ?1, post_id = COALESCE(?2, post_id), last_error_code = ?3,
                     projection_json = ?4, next_attempt_at_unix_ms = ?5,
                     updated_at_unix_ms = ?6
                 WHERE command_id = ?7 AND state = ?8
                   AND lease_generation = ?9 AND session_generation = ?10",
                params![
                    advanced.state as i64,
                    post_id,
                    error_code,
                    projection_json,
                    advanced.next_attempt_at_unix_ms,
                    advanced.updated_at_unix_ms,
                    command.command_id,
                    current.state as i64,
                    to_i64(current.lease_generation, "lease generation")?,
                    to_i64(current.session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn projections(&self) -> Result<Vec<Vec<u8>>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT projection_json FROM mobile_private_social_submissions
                 ORDER BY updated_at_unix_ms DESC, command_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn persist_prekey_publication(
        &self,
        command: &StoredPreKeyPublication,
        keys: &[(String, [u8; 32], [u8; 32])],
    ) -> Result<(), String> {
        let key_kind = i64::from(command.key_kind);
        let key_material_matches_kind = match key_kind {
            ENDPOINT_PREKEY_KIND => !keys.is_empty(),
            RECOVERY_PREKEY_KIND => keys.is_empty(),
            _ => false,
        };
        if command.command_id.trim().is_empty()
            || command.request_bytes.is_empty()
            || keys.len() > 100
            || !key_material_matches_kind
            || Sha256::digest(&command.request_bytes).as_slice() != command.request_sha256
        {
            return Err("private Social PreKey publication is invalid".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO mobile_private_social_prekey_commands(
                   command_id, key_kind, pool_epoch, request_bytes, request_sha256,
                   state, lease_generation, session_generation, attempt_count,
                   next_attempt_at_unix_ms, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, 0, ?7)
                 ON CONFLICT(command_id) DO NOTHING",
                params![
                    command.command_id,
                    command.key_kind,
                    to_i64(command.pool_epoch, "pool epoch")?,
                    command.request_bytes,
                    command.request_sha256.as_slice(),
                    OperationState::Pending as i64,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        for (key_id, private_key, public_key) in keys {
            transaction
                .execute(
                    "INSERT INTO mobile_private_social_prekeys(
                       key_id, key_kind, pool_epoch, private_key, public_key,
                       command_id, published, created_at_unix_ms
                     ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)
                     ON CONFLICT(key_id) DO NOTHING",
                    params![
                        key_id,
                        command.key_kind,
                        to_i64(command.pool_epoch, "pool epoch")?,
                        private_key.as_slice(),
                        public_key.as_slice(),
                        command.command_id,
                        now_unix_ms(),
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn persist_prepared_prekey_publication(
        &self,
        prepared: &PreparedContentPreKeyPublication,
    ) -> Result<(), String> {
        let command = StoredPreKeyPublication {
            command_id: prepared.operation.command_id.clone(),
            key_kind: match prepared.kind {
                secure_content_core::operation::ContentPreKeyPoolKind::Endpoint => {
                    ContentPreKeyKind::ContentPrekeyKindEndpoint as i32
                }
                secure_content_core::operation::ContentPreKeyPoolKind::ActorRecovery => {
                    ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32
                }
            },
            pool_epoch: prepared.pool_epoch,
            request_bytes: prepared.proof_free_request_bytes.clone(),
            request_sha256: prepared.operation.command_sha256,
            state: prepared.operation.state,
            lease_generation: prepared.operation.lease_generation,
            session_generation: prepared.operation.session_generation,
            attempt_count: prepared.operation.attempt_count,
            next_attempt_at_unix_ms: prepared.operation.next_attempt_at_unix_ms,
            updated_at_unix_ms: prepared.operation.updated_at_unix_ms,
        };
        let keys = zeroize::Zeroizing::new(
            prepared
                .endpoint_keys
                .iter()
                .map(|key| (key.key_id.clone(), key.private_key, key.public_key))
                .collect::<Vec<_>>(),
        );
        self.persist_prekey_publication(&command, keys.as_slice())
    }

    pub fn pending_prekey_publications(&self) -> Result<Vec<StoredPreKeyPublication>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT command_id, key_kind, pool_epoch, request_bytes, request_sha256,
                        state, lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms
                 FROM mobile_private_social_prekey_commands
                 WHERE state IN (?1, ?2)
                    OR (state = ?3 AND next_attempt_at_unix_ms <= ?4)
                 ORDER BY updated_at_unix_ms, command_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![
                    OperationState::Pending as i64,
                    OperationState::UnknownOutcome as i64,
                    OperationState::RetryWait as i64,
                    now_unix_ms(),
                ],
                prekey_publication_from_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn acquire_prekey_publication(
        &self,
        command_id: &str,
        cause: DispatchCause,
    ) -> Result<AcquiredPreKeyPublication, String> {
        let generation = self.generation()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut command = transaction
            .query_row(
                "SELECT command_id, key_kind, pool_epoch, request_bytes, request_sha256,
                        state, lease_generation, session_generation, attempt_count,
                        next_attempt_at_unix_ms, updated_at_unix_ms
                 FROM mobile_private_social_prekey_commands WHERE command_id = ?1",
                params![command_id],
                prekey_publication_from_row,
            )
            .map_err(|error| error.to_string())?;
        let current = command.operation_record()?;
        let lease = acquire_operation(&current, generation, cause, now_unix_ms())
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_prekey_commands
                 SET state = ?1, lease_generation = ?2, session_generation = ?3,
                     attempt_count = ?4, next_attempt_at_unix_ms = ?5,
                     updated_at_unix_ms = ?6
                 WHERE command_id = ?7 AND state = ?8
                   AND lease_generation = ?9 AND session_generation = ?10",
                params![
                    lease.record.state as i64,
                    to_i64(lease.record.lease_generation, "lease generation")?,
                    to_i64(lease.record.session_generation, "session generation")?,
                    i64::from(lease.record.attempt_count),
                    lease.record.next_attempt_at_unix_ms,
                    lease.record.updated_at_unix_ms,
                    command_id,
                    current.state as i64,
                    to_i64(current.lease_generation, "lease generation")?,
                    to_i64(current.session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("private Social PreKey publication lost its operation fence".to_string());
        }
        apply_operation_record_to_prekey(&mut command, &lease.record);
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(AcquiredPreKeyPublication { command, lease })
    }

    pub fn complete_prekey_publication(
        &self,
        acquired: &AcquiredPreKeyPublication,
        completion: OperationCompletion,
    ) -> Result<bool, String> {
        let current = acquired.command.operation_record()?;
        let completed = complete_operation(
            &current,
            acquired.lease.record.fence(),
            completion,
            now_unix_ms(),
        )
        .map_err(|error| error.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_prekey_commands
                 SET state = ?1, next_attempt_at_unix_ms = ?2, updated_at_unix_ms = ?3
                 WHERE command_id = ?4 AND state = ?5
                   AND lease_generation = ?6 AND session_generation = ?7",
                params![
                    completed.state as i64,
                    completed.next_attempt_at_unix_ms,
                    completed.updated_at_unix_ms,
                    acquired.command.command_id,
                    OperationState::InFlight as i64,
                    to_i64(acquired.command.lease_generation, "lease generation")?,
                    to_i64(acquired.command.session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 && completed.state == OperationState::Committed {
            transaction
                .execute(
                    "UPDATE mobile_private_social_prekeys SET published = 1
                     WHERE command_id = ?1",
                    params![acquired.command.command_id],
                )
                .map_err(|error| error.to_string())?;
        } else if changed == 1 && completed.state == OperationState::Terminal {
            transaction
                .execute(
                    "DELETE FROM mobile_private_social_prekeys
                     WHERE command_id = ?1 AND published = 0",
                    params![acquired.command.command_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(changed == 1)
    }

    pub fn endpoint_prekey(&self, key_id: &str) -> Result<Option<StoredEndpointPreKey>, String> {
        self.connection()?
            .query_row(
                "SELECT key_id, pool_epoch, private_key
                 FROM mobile_private_social_prekeys
                 WHERE key_id = ?1 AND key_kind = ?2 AND published = 1",
                params![key_id, ENDPOINT_PREKEY_KIND],
                |row| {
                    Ok(StoredEndpointPreKey {
                        key_id: row.get(0)?,
                        pool_epoch: from_i64(row.get(1)?, "pool epoch")?,
                        private_key: fixed_32(row.get(2)?, "endpoint PreKey")?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn store_recovery_master(
        &self,
        actor_ptid: &str,
        recovery_epoch: u64,
        master: &[u8; 32],
    ) -> Result<(), String> {
        if actor_ptid.trim().is_empty() || recovery_epoch == 0 {
            return Err("private Social recovery master identity is invalid".to_string());
        }
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO mobile_private_social_recovery_masters(
                   actor_ptid, recovery_epoch, master_key, created_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(actor_ptid, recovery_epoch) DO NOTHING",
                params![
                    actor_ptid,
                    to_i64(recovery_epoch, "recovery epoch")?,
                    master.as_slice(),
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored: Vec<u8> = connection
            .query_row(
                "SELECT master_key FROM mobile_private_social_recovery_masters
                 WHERE actor_ptid = ?1 AND recovery_epoch = ?2",
                params![actor_ptid, to_i64(recovery_epoch, "recovery epoch")?],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if stored.as_slice() != master {
            return Err("private Social recovery master epoch conflict".to_string());
        }
        Ok(())
    }

    pub fn recovery_master(
        &self,
        actor_ptid: &str,
        recovery_epoch: u64,
    ) -> Result<Option<[u8; 32]>, String> {
        self.connection()?
            .query_row(
                "SELECT master_key FROM mobile_private_social_recovery_masters
                 WHERE actor_ptid = ?1 AND recovery_epoch = ?2",
                params![actor_ptid, to_i64(recovery_epoch, "recovery epoch")?],
                |row| fixed_32(row.get(0)?, "recovery master"),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn latest_recovery_epoch(&self, actor_ptid: &str) -> Result<Option<u64>, String> {
        self.connection()?
            .query_row(
                "SELECT MAX(recovery_epoch)
                 FROM mobile_private_social_recovery_masters
                 WHERE actor_ptid = ?1",
                params![actor_ptid],
                |row| row.get::<_, Option<i64>>(0),
            )
            .map_err(|error| error.to_string())?
            .map(|epoch| from_i64(epoch, "recovery epoch"))
            .transpose()
            .map_err(|error| error.to_string())
    }

    pub fn content_root(
        &self,
        content_id: &str,
        generation: u64,
    ) -> Result<Option<[u8; 32]>, String> {
        self.connection()?
            .query_row(
                "SELECT root_key FROM mobile_private_social_roots
                 WHERE content_id = ?1 AND generation = ?2",
                params![content_id, to_i64(generation, "content generation")?],
                |row| fixed_32(row.get(0)?, "content root key"),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn commit_receiver_projection(
        &self,
        expected_session_generation: u64,
        content_id: &str,
        generation: u64,
        post_id: &str,
        root_key: &[u8; 32],
        endpoint_prekey_id: Option<&str>,
        projection_json: &[u8],
    ) -> Result<(), String> {
        if content_id.trim().is_empty()
            || generation == 0
            || post_id.trim().is_empty()
            || projection_json.is_empty()
        {
            return Err("private Social receiver projection is invalid".to_string());
        }
        let mut connection = self.connection()?;
        self.ensure_session_generation(expected_session_generation)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO mobile_private_social_roots(
                   content_id, generation, post_id, root_key, committed_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(content_id, generation) DO NOTHING",
                params![
                    content_id,
                    to_i64(generation, "content generation")?,
                    post_id,
                    root_key.as_slice(),
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let (stored_post_id, stored_root): (String, Vec<u8>) = transaction
            .query_row(
                "SELECT post_id, root_key FROM mobile_private_social_roots
                 WHERE content_id = ?1 AND generation = ?2",
                params![content_id, to_i64(generation, "content generation")?],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| error.to_string())?;
        if stored_post_id != post_id || stored_root.as_slice() != root_key {
            return Err("private Social receiver root replay conflict".to_string());
        }
        transaction
            .execute(
                "INSERT INTO mobile_private_social_read_projections(
                   post_id, content_id, generation, projection_json, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(post_id) DO UPDATE SET
                   content_id = excluded.content_id,
                   generation = excluded.generation,
                   projection_json = excluded.projection_json,
                   updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![
                    post_id,
                    content_id,
                    to_i64(generation, "content generation")?,
                    projection_json,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        if let Some(key_id) = endpoint_prekey_id {
            let consumed = transaction
                .execute(
                    "DELETE FROM mobile_private_social_prekeys
                     WHERE key_id = ?1 AND key_kind = ?2 AND published = 1",
                    params![key_id, ENDPOINT_PREKEY_KIND],
                )
                .map_err(|error| error.to_string())?;
            if consumed != 1 {
                return Err(
                    "private Social root commit did not consume the exact endpoint PreKey"
                        .to_string(),
                );
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn commit_comment_receiver_projection(
        &self,
        expected_session_generation: u64,
        content_id: &str,
        generation: u64,
        post_id: &str,
        comment_id: &str,
        root_key: &[u8; 32],
        endpoint_prekey_id: Option<&str>,
        projection_json: &[u8],
    ) -> Result<(), String> {
        if content_id.trim().is_empty()
            || generation == 0
            || post_id.trim().is_empty()
            || comment_id.trim().is_empty()
            || projection_json.is_empty()
        {
            return Err("private Comment receiver projection is invalid".to_string());
        }
        let mut connection = self.connection()?;
        self.ensure_session_generation(expected_session_generation)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO mobile_private_social_roots(
                   content_id, generation, post_id, root_key, committed_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(content_id, generation) DO NOTHING",
                params![
                    content_id,
                    to_i64(generation, "comment generation")?,
                    post_id,
                    root_key.as_slice(),
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let (stored_post_id, stored_root): (String, Vec<u8>) = transaction
            .query_row(
                "SELECT post_id, root_key FROM mobile_private_social_roots
                 WHERE content_id = ?1 AND generation = ?2",
                params![content_id, to_i64(generation, "comment generation")?],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| error.to_string())?;
        if stored_post_id != post_id || stored_root.as_slice() != root_key {
            return Err("private Comment receiver root replay conflict".to_string());
        }
        transaction
            .execute(
                "INSERT INTO mobile_private_social_comment_projections(
                   comment_id, post_id, projection_json, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(comment_id) DO UPDATE SET
                   post_id = excluded.post_id,
                   projection_json = excluded.projection_json,
                   updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![comment_id, post_id, projection_json, now_unix_ms()],
            )
            .map_err(|error| error.to_string())?;
        if let Some(key_id) = endpoint_prekey_id {
            let consumed = transaction
                .execute(
                    "DELETE FROM mobile_private_social_prekeys
                     WHERE key_id = ?1 AND key_kind = ?2 AND published = 1",
                    params![key_id, ENDPOINT_PREKEY_KIND],
                )
                .map_err(|error| error.to_string())?;
            if consumed != 1 {
                return Err(
                    "private Comment root commit did not consume the exact endpoint PreKey"
                        .to_string(),
                );
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn persist_reaction_command(
        &self,
        command: &StoredReactionCommand,
    ) -> Result<StoredReactionCommand, String> {
        if command.command_id.trim().is_empty()
            || command.post_id.trim().is_empty()
            || command.kind <= 0
            || command.request_bytes.is_empty()
            || Sha256::digest(&command.request_bytes).as_slice() != command.request_sha256
            || command.state != ReactionCommandState::Pending
            || command.result_bytes.is_some()
            || command.result_sha256.is_some()
            || command.session_generation == 0
        {
            return Err("private Reaction command journal input is invalid".to_string());
        }
        let mut connection = self.connection()?;
        self.ensure_session_generation(command.session_generation)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let active: Option<String> = transaction
            .query_row(
                "SELECT command_id FROM mobile_private_social_reaction_commands
                 WHERE post_id = ?1 AND state IN (?2, ?3, ?4, ?5)
                 ORDER BY updated_at_unix_ms DESC LIMIT 1",
                params![
                    command.post_id,
                    ReactionCommandState::Pending as i64,
                    ReactionCommandState::InFlight as i64,
                    ReactionCommandState::UnknownOutcome as i64,
                    ReactionCommandState::Retrying as i64,
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if active
            .as_deref()
            .is_some_and(|command_id| command_id != command.command_id)
        {
            return Err("private Reaction command is already pending".to_string());
        }
        transaction
            .execute(
                "INSERT INTO mobile_private_social_reaction_commands(
                    command_id, post_id, kind, remove_reaction, request_sha256,
                    request_bytes, result_sha256, result_bytes, state,
                    session_generation, lease_generation, attempt_count,
                    projection_revision, error_code, retry_after_seconds,
                    retry_not_before_unix_ms, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?8, 0, 0, 0,
                          NULL, NULL, NULL, ?9)
                 ON CONFLICT(command_id) DO NOTHING",
                params![
                    command.command_id,
                    command.post_id,
                    command.kind,
                    command.remove,
                    command.request_sha256.as_slice(),
                    command.request_bytes,
                    ReactionCommandState::Pending as i64,
                    to_i64(command.session_generation, "session generation")?,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored = transaction
            .query_row(
                "SELECT command_id, post_id, kind, remove_reaction, request_sha256,
                        request_bytes, result_sha256, result_bytes, state,
                        session_generation, lease_generation, attempt_count,
                        projection_revision, error_code, retry_after_seconds,
                        retry_not_before_unix_ms
                 FROM mobile_private_social_reaction_commands WHERE command_id = ?1",
                params![command.command_id],
                reaction_command_from_row,
            )
            .map_err(|error| error.to_string())?;
        if stored.post_id != command.post_id
            || stored.kind != command.kind
            || stored.remove != command.remove
            || stored.request_sha256 != command.request_sha256
            || stored.request_bytes != command.request_bytes
        {
            return Err("private Reaction command replay conflict".to_string());
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(stored)
    }

    pub fn reaction_command(
        &self,
        command_id: &str,
    ) -> Result<Option<StoredReactionCommand>, String> {
        self.connection()?
            .query_row(
                "SELECT command_id, post_id, kind, remove_reaction, request_sha256,
                        request_bytes, result_sha256, result_bytes, state,
                        session_generation, lease_generation, attempt_count,
                        projection_revision, error_code, retry_after_seconds,
                        retry_not_before_unix_ms
                 FROM mobile_private_social_reaction_commands WHERE command_id = ?1",
                params![command_id],
                reaction_command_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn reaction_commands(&self) -> Result<Vec<StoredReactionCommand>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT command_id, post_id, kind, remove_reaction, request_sha256,
                        request_bytes, result_sha256, result_bytes, state,
                        session_generation, lease_generation, attempt_count,
                        projection_revision, error_code, retry_after_seconds,
                        retry_not_before_unix_ms
                 FROM mobile_private_social_reaction_commands AS command
                 WHERE command.rowid = (
                    SELECT MAX(latest.rowid)
                    FROM mobile_private_social_reaction_commands AS latest
                    WHERE latest.post_id = command.post_id
                 )
                 ORDER BY command.updated_at_unix_ms DESC, command.rowid DESC",
            )
            .map_err(|error| error.to_string())?;
        let commands = statement
            .query_map([], reaction_command_from_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(commands)
    }

    pub fn acquire_reaction_command(
        &self,
        command_id: &str,
        session_generation: u64,
    ) -> Result<StoredReactionCommand, String> {
        let mut connection = self.connection()?;
        self.ensure_session_generation(session_generation)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let now = now_unix_ms();
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_reaction_commands
                 SET state = ?1, session_generation = ?2,
                     lease_generation = lease_generation + 1,
                     attempt_count = attempt_count + 1,
                     retry_after_seconds = NULL, retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?3
                 WHERE command_id = ?4 AND state IN (?5, ?6, ?7)
                   AND (retry_not_before_unix_ms IS NULL OR retry_not_before_unix_ms <= ?3)",
                params![
                    ReactionCommandState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                    now,
                    command_id,
                    ReactionCommandState::Pending as i64,
                    ReactionCommandState::UnknownOutcome as i64,
                    ReactionCommandState::Retrying as i64,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("private Reaction command is not retryable yet".to_string());
        }
        let command = transaction
            .query_row(
                "SELECT command_id, post_id, kind, remove_reaction, request_sha256,
                        request_bytes, result_sha256, result_bytes, state,
                        session_generation, lease_generation, attempt_count,
                        projection_revision, error_code, retry_after_seconds,
                        retry_not_before_unix_ms
                 FROM mobile_private_social_reaction_commands WHERE command_id = ?1",
                params![command_id],
                reaction_command_from_row,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(command)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn mark_reaction_failure(
        &self,
        command_id: &str,
        lease_generation: u64,
        session_generation: u64,
        state: ReactionCommandState,
        error_code: &str,
        retry_after_seconds: Option<u64>,
    ) -> Result<bool, String> {
        if !matches!(
            state,
            ReactionCommandState::UnknownOutcome
                | ReactionCommandState::Retrying
                | ReactionCommandState::Rejected
        ) || error_code.trim().is_empty()
        {
            return Err("private Reaction failure transition is invalid".to_string());
        }
        self.ensure_session_generation(session_generation)?;
        let retry_after_seconds =
            retry_after_seconds.map(|seconds| seconds.min(MAX_REACTION_RETRY_AFTER_SECONDS));
        let updated_at_unix_ms = now_unix_ms();
        let retry_not_before_unix_ms = retry_after_seconds
            .and_then(|seconds| {
                i64::try_from(seconds)
                    .ok()
                    .and_then(|seconds| seconds.checked_mul(1_000))
            })
            .and_then(|delay| updated_at_unix_ms.checked_add(delay));
        self.connection()?
            .execute(
                "UPDATE mobile_private_social_reaction_commands
                 SET state = ?1, error_code = ?2, retry_after_seconds = ?3,
                     retry_not_before_unix_ms = ?4, updated_at_unix_ms = ?5
                 WHERE command_id = ?6 AND state = ?7
                   AND lease_generation = ?8 AND session_generation = ?9",
                params![
                    state as i64,
                    error_code,
                    retry_after_seconds
                        .map(|value| to_i64(value, "Reaction retry after"))
                        .transpose()?,
                    retry_not_before_unix_ms,
                    updated_at_unix_ms,
                    command_id,
                    ReactionCommandState::InFlight as i64,
                    to_i64(lease_generation, "Reaction lease generation")?,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn mark_reaction_committed(
        &self,
        command_id: &str,
        lease_generation: u64,
        session_generation: u64,
        result_bytes: &[u8],
        result_sha256: &[u8; 32],
        projection_revision: u64,
        post_id: &str,
        projection_json: &[u8],
    ) -> Result<bool, String> {
        if result_bytes.is_empty()
            || Sha256::digest(result_bytes).as_slice() != result_sha256
            || projection_revision == 0
            || post_id.trim().is_empty()
            || projection_json.is_empty()
        {
            return Err("private Reaction completion is invalid".to_string());
        }
        let mut connection = self.connection()?;
        self.ensure_session_generation(session_generation)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_reaction_commands
                 SET result_sha256 = ?1, result_bytes = ?2, state = ?3,
                     projection_revision = ?4, error_code = NULL,
                     retry_after_seconds = NULL, retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?5
                 WHERE command_id = ?6 AND post_id = ?7 AND state = ?8
                   AND lease_generation = ?9 AND session_generation = ?10",
                params![
                    result_sha256.as_slice(),
                    result_bytes,
                    ReactionCommandState::Committed as i64,
                    to_i64(projection_revision, "Reaction projection revision")?,
                    now_unix_ms(),
                    command_id,
                    post_id,
                    ReactionCommandState::InFlight as i64,
                    to_i64(lease_generation, "Reaction lease generation")?,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            let projection_changed = transaction
                .execute(
                    "UPDATE mobile_private_social_read_projections
                     SET projection_json = ?1, updated_at_unix_ms = ?2
                     WHERE post_id = ?3",
                    params![projection_json, now_unix_ms(), post_id],
                )
                .map_err(|error| error.to_string())?;
            if projection_changed != 1 {
                return Err(
                    "private Reaction completion has no private Moment projection".to_string(),
                );
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(changed == 1)
    }

    pub fn persist_receiver_failure(
        &self,
        expected_session_generation: u64,
        post_id: &str,
        projection_json: &[u8],
        purge_private_material: bool,
    ) -> Result<(), String> {
        if post_id.trim().is_empty() || projection_json.is_empty() {
            return Err("private Social receiver failure projection is invalid".to_string());
        }
        let mut connection = self.connection()?;
        self.ensure_session_generation(expected_session_generation)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        if purge_private_material {
            transaction
                .execute(
                    "DELETE FROM mobile_private_social_roots WHERE post_id = ?1",
                    params![post_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM mobile_private_social_comment_projections WHERE post_id = ?1",
                    params![post_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM mobile_private_social_comment_drafts WHERE post_id = ?1",
                    params![post_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM mobile_private_social_reaction_commands WHERE post_id = ?1",
                    params![post_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "INSERT INTO mobile_private_social_read_projections(
                   post_id, content_id, generation, projection_json, updated_at_unix_ms
                 ) VALUES(?1, ?2, 0, ?3, ?4)
                 ON CONFLICT(post_id) DO UPDATE SET
                   content_id = excluded.content_id,
                   generation = 0,
                   projection_json = excluded.projection_json,
                   updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![
                    post_id,
                    format!("unavailable:{post_id}"),
                    projection_json,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn read_projection(&self, post_id: &str) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT projection_json FROM mobile_private_social_read_projections
                 WHERE post_id = ?1",
                params![post_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn read_projections(&self) -> Result<Vec<Vec<u8>>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT projection_json FROM mobile_private_social_read_projections
                 ORDER BY updated_at_unix_ms DESC, post_id",
            )
            .map_err(|error| error.to_string())?;
        let projections = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(projections)
    }

    pub fn ensure_object_upload_transfer(
        &self,
        record: &ObjectTransferRecord,
        media_type: &str,
    ) -> Result<ObjectTransferRecord, String> {
        secure_content_core::object::validate_object_transfer_record(record)?;
        if record.direction != ObjectTransferDirection::Upload || media_type.trim().is_empty() {
            return Err("private Social object upload journal is invalid".to_string());
        }
        let session_generation = self.generation()?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO mobile_private_social_object_transfers(
                   transfer_id, owner_scope_id, operation_id, authority_id,
                   direction, state, upload_id, generation, descriptor_sha256,
                   completed_chunk_bitmap, source_local_ref, partial_local_ref,
                   object_key, base_nonce, plaintext_size, chunk_size, media_type,
                   attempt_count, next_attempt_at_unix_ms, last_error,
                   descriptor_bytes, updated_at_unix_ms, session_generation
                 ) VALUES(
                   ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                   ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, NULL, ?21, ?22
                 ) ON CONFLICT(transfer_id) DO NOTHING",
                params![
                    record.transfer_id,
                    record.owner_scope_id,
                    record.operation_id,
                    record.authority_id,
                    record.direction as i32,
                    record.state as i32,
                    record.upload_id,
                    to_i64(record.generation, "object upload generation")?,
                    record.descriptor_sha256,
                    record.completed_chunk_bitmap,
                    record.source_local_ref,
                    record.partial_local_ref,
                    record.object_key,
                    record.base_nonce,
                    to_i64(record.plaintext_size, "object plaintext size")?,
                    record.chunk_size,
                    media_type,
                    i64::from(record.attempt_count),
                    record.next_attempt_at_unix_ms,
                    record.last_error.map(|value| value as i32),
                    record.updated_at_unix_ms,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        let existing = connection
            .query_row(
                "SELECT transfer_id, owner_scope_id, operation_id, authority_id,
                        direction, state, upload_id, generation, descriptor_sha256,
                        completed_chunk_bitmap, source_local_ref, partial_local_ref,
                        object_key, base_nonce, plaintext_size, chunk_size,
                        attempt_count, next_attempt_at_unix_ms, last_error,
                        updated_at_unix_ms
                 FROM mobile_private_social_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![
                    record.transfer_id,
                    to_i64(session_generation, "session generation")?
                ],
                object_transfer_from_row,
            )
            .map_err(|error| error.to_string())?;
        let stored_media_type: String = connection
            .query_row(
                "SELECT media_type FROM mobile_private_social_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![
                    record.transfer_id,
                    to_i64(session_generation, "session generation")?
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if existing.owner_scope_id != record.owner_scope_id
            || existing.operation_id != record.operation_id
            || existing.authority_id != record.authority_id
            || existing.direction != record.direction
            || existing.source_local_ref != record.source_local_ref
            || existing.partial_local_ref != record.partial_local_ref
            || existing.object_key != record.object_key
            || existing.base_nonce != record.base_nonce
            || existing.plaintext_size != record.plaintext_size
            || existing.chunk_size != record.chunk_size
            || stored_media_type != media_type
        {
            return Err("private Social object upload replay conflict".to_string());
        }
        Ok(existing)
    }

    pub fn persist_object_descriptor(
        &self,
        transfer_id: &str,
        descriptor_bytes: &[u8],
    ) -> Result<(), String> {
        if transfer_id.trim().is_empty() || descriptor_bytes.is_empty() {
            return Err("private Social object descriptor is invalid".to_string());
        }
        let connection = self.connection()?;
        let existing: Option<Vec<u8>> = connection
            .query_row(
                "SELECT descriptor_bytes FROM mobile_private_social_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![
                    transfer_id,
                    to_i64(self.generation()?, "session generation")?
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if existing
            .as_ref()
            .is_some_and(|stored| stored.as_slice() != descriptor_bytes)
        {
            return Err("private Social object descriptor replay conflict".to_string());
        }
        connection
            .execute(
                "UPDATE mobile_private_social_object_transfers
                 SET descriptor_bytes = ?1
                 WHERE transfer_id = ?2 AND session_generation = ?3
                   AND state NOT IN (?4, ?5)",
                params![
                    descriptor_bytes,
                    transfer_id,
                    to_i64(self.generation()?, "session generation")?,
                    ObjectTransferState::Cancelled as i32,
                    ObjectTransferState::Terminal as i32,
                ],
            )
            .map_err(|error| error.to_string())
            .and_then(|changed| {
                if changed == 1 {
                    Ok(())
                } else {
                    Err("private Social object transfer generation is stale".to_string())
                }
            })
    }

    pub fn object_descriptor_bytes(&self, transfer_id: &str) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT descriptor_bytes FROM mobile_private_social_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![
                    transfer_id,
                    to_i64(self.generation()?, "session generation")?
                ],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.flatten())
            .map_err(|error| error.to_string())
    }

    pub fn delete_completed_uploads_for_owner(&self, owner_scope_id: &str) -> Result<(), String> {
        self.connection()?
            .execute(
                "DELETE FROM mobile_private_social_object_transfers
                 WHERE owner_scope_id = ?1 AND direction = ?2 AND state = ?3
                   AND session_generation = ?4",
                params![
                    owner_scope_id,
                    ObjectTransferDirection::Upload as i32,
                    ObjectTransferState::Complete as i32,
                    to_i64(self.generation()?, "session generation")?,
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

impl ObjectTransferRepository for PrivateSocialStore {
    fn object_transfer(
        &self,
        transfer_id: &str,
    ) -> Result<Option<ObjectTransferRecord>, ObjectTransferFailure> {
        self.connection()
            .map_err(transfer_error)?
            .query_row(
                "SELECT transfer_id, owner_scope_id, operation_id, authority_id,
                        direction, state, upload_id, generation, descriptor_sha256,
                        completed_chunk_bitmap, source_local_ref, partial_local_ref,
                        object_key, base_nonce, plaintext_size, chunk_size,
                        attempt_count, next_attempt_at_unix_ms, last_error,
                        updated_at_unix_ms
                 FROM mobile_private_social_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![
                    transfer_id,
                    to_i64(
                        self.generation().map_err(transfer_error)?,
                        "session generation"
                    )
                    .map_err(transfer_error)?
                ],
                object_transfer_from_row,
            )
            .optional()
            .map_err(|error| transfer_error(error.to_string()))
    }

    fn upload_media_type(
        &self,
        transfer_id: &str,
    ) -> Result<Option<String>, ObjectTransferFailure> {
        self.connection()
            .map_err(transfer_error)?
            .query_row(
                "SELECT media_type FROM mobile_private_social_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![
                    transfer_id,
                    to_i64(
                        self.generation().map_err(transfer_error)?,
                        "session generation"
                    )
                    .map_err(transfer_error)?
                ],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.flatten())
            .map_err(|error| transfer_error(error.to_string()))
    }

    fn update_transfer_prepared(
        &self,
        transfer_id: &str,
        descriptor_sha256: &[u8],
        partial_local_ref: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure> {
        let connection = self.connection().map_err(transfer_error)?;
        let current: Vec<u8> = connection
            .query_row(
                "SELECT descriptor_sha256 FROM mobile_private_social_object_transfers
                 WHERE transfer_id = ?1",
                params![transfer_id],
                |row| row.get(0),
            )
            .map_err(|error| transfer_error(error.to_string()))?;
        if current != vec![0; 32] && current != descriptor_sha256 {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "private Social object descriptor changed",
            ));
        }
        let changed = connection
            .execute(
                "UPDATE mobile_private_social_object_transfers
                 SET descriptor_sha256 = ?1, partial_local_ref = ?2,
                     updated_at_unix_ms = ?3
                 WHERE transfer_id = ?4 AND session_generation = ?5
                   AND state NOT IN (?6, ?7, ?8)",
                params![
                    descriptor_sha256,
                    partial_local_ref,
                    updated_at_unix_ms,
                    transfer_id,
                    to_i64(
                        self.generation().map_err(transfer_error)?,
                        "session generation"
                    )
                    .map_err(transfer_error)?,
                    ObjectTransferState::Cancelled as i32,
                    ObjectTransferState::Terminal as i32,
                    ObjectTransferState::Complete as i32,
                ],
            )
            .map_err(|error| transfer_error(error.to_string()))?;
        if changed == 1 {
            Ok(())
        } else {
            Err(transfer_error(
                "private Social object transfer generation is stale",
            ))
        }
    }

    fn update_transfer_progress(
        &self,
        transfer_id: &str,
        state: ObjectTransferState,
        upload_id: &str,
        generation: u64,
        completed_chunk_bitmap: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        last_error: Option<ObjectTransferErrorCode>,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure> {
        let changed = self
            .connection()
            .map_err(transfer_error)?
            .execute(
                "UPDATE mobile_private_social_object_transfers
                 SET state = ?1, upload_id = ?2, generation = ?3,
                     completed_chunk_bitmap = ?4, attempt_count = ?5,
                     next_attempt_at_unix_ms = ?6, last_error = ?7,
                     updated_at_unix_ms = ?8
                 WHERE transfer_id = ?9 AND session_generation = ?10
                   AND state NOT IN (?11, ?12)",
                params![
                    state as i32,
                    upload_id,
                    to_i64(generation, "object upload generation").map_err(transfer_error)?,
                    completed_chunk_bitmap,
                    i64::from(attempt_count),
                    next_attempt_at_unix_ms,
                    last_error.map(|value| value as i32),
                    updated_at_unix_ms,
                    transfer_id,
                    to_i64(
                        self.generation().map_err(transfer_error)?,
                        "session generation"
                    )
                    .map_err(transfer_error)?,
                    ObjectTransferState::Cancelled as i32,
                    ObjectTransferState::Terminal as i32,
                ],
            )
            .map_err(|error| transfer_error(error.to_string()))?;
        if changed == 1 {
            Ok(())
        } else {
            Err(transfer_error(
                "private Social object transfer generation is stale",
            ))
        }
    }

    fn complete_upload(
        &self,
        transfer: &ObjectTransferRecord,
        _descriptor: &ObjectDescriptor,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure> {
        self.update_transfer_progress(
            &transfer.transfer_id,
            ObjectTransferState::Complete,
            &transfer.upload_id,
            transfer.generation,
            &transfer.completed_chunk_bitmap,
            transfer.attempt_count,
            0,
            None,
            updated_at_unix_ms,
        )
    }

    fn complete_download(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        _cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure> {
        self.complete_upload(transfer, descriptor, updated_at_unix_ms)
    }
}

fn validate_draft(draft: &StoredDraft) -> Result<(), String> {
    if draft.draft_id.trim().is_empty()
        || draft.draft_revision == 0
        || draft.content_id.trim().is_empty()
        || draft.prepare_command_id.trim().is_empty()
    {
        Err("private Social draft reservation is invalid".to_string())
    } else {
        Ok(())
    }
}

fn validate_submission(command: &StoredSubmission) -> Result<(), String> {
    if command.command_id.trim().is_empty()
        || command.draft_id.trim().is_empty()
        || command.draft_revision == 0
        || command.content_id.trim().is_empty()
        || command.generation == 0
        || command.request_bytes.is_empty()
        || command.projection_json.is_empty()
        || Sha256::digest(&command.request_bytes).as_slice() != command.request_sha256
        || command.lease_generation != 0
        || command.attempt_count != 0
        || command.next_attempt_at_unix_ms != 0
        || !matches!(
            command.state,
            OperationState::Prepared | OperationState::Pending
        )
    {
        Err("private Social submission is invalid".to_string())
    } else {
        Ok(())
    }
}

fn apply_operation_record_to_submission(command: &mut StoredSubmission, record: &OperationRecord) {
    command.state = record.state;
    command.lease_generation = record.lease_generation;
    command.session_generation = record.session_generation;
    command.attempt_count = record.attempt_count;
    command.next_attempt_at_unix_ms = record.next_attempt_at_unix_ms;
    command.updated_at_unix_ms = record.updated_at_unix_ms;
}

fn apply_operation_record_to_comment(draft: &mut StoredCommentDraft, record: &OperationRecord) {
    draft.publication_state = Some(record.state);
    draft.lease_generation = record.lease_generation;
    draft.session_generation = record.session_generation;
    draft.attempt_count = record.attempt_count;
    draft.next_attempt_at_unix_ms = record.next_attempt_at_unix_ms;
    draft.updated_at_unix_ms = record.updated_at_unix_ms;
}

fn apply_operation_record_to_prekey(
    command: &mut StoredPreKeyPublication,
    record: &OperationRecord,
) {
    command.state = record.state;
    command.lease_generation = record.lease_generation;
    command.session_generation = record.session_generation;
    command.attempt_count = record.attempt_count;
    command.next_attempt_at_unix_ms = record.next_attempt_at_unix_ms;
    command.updated_at_unix_ms = record.updated_at_unix_ms;
}

fn bind_scope(
    connection: &Connection,
    station_peer_id: &str,
    actor_ptid: &str,
) -> Result<(), String> {
    for (key, value) in [
        ("station_peer_id", station_peer_id),
        ("actor_ptid", actor_ptid),
    ] {
        connection
            .execute(
                "INSERT INTO mobile_private_social_metadata(key, value)
                 VALUES(?1, ?2) ON CONFLICT(key) DO NOTHING",
                params![key, value],
            )
            .map_err(|error| error.to_string())?;
        let stored: String = connection
            .query_row(
                "SELECT value FROM mobile_private_social_metadata WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if stored != value {
            return Err(format!("private Social store {key} binding mismatch"));
        }
    }
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS mobile_private_social_metadata (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_drafts (
               draft_id TEXT NOT NULL,
               draft_revision INTEGER NOT NULL CHECK(draft_revision > 0),
               intent_sha256 BLOB NOT NULL CHECK(length(intent_sha256) = 32),
               content_id TEXT NOT NULL,
               prepare_command_id TEXT NOT NULL,
               mention_commitment_salt BLOB CHECK(
                  mention_commitment_salt IS NULL
                  OR length(mention_commitment_salt) = 32
               ),
               repost_commitment_salt BLOB CHECK(
                  repost_commitment_salt IS NULL
                  OR length(repost_commitment_salt) = 32
               ),
               object_material_seed BLOB CHECK(
                  object_material_seed IS NULL
                  OR length(object_material_seed) = 32
               ),
               updated_at_unix_ms INTEGER NOT NULL,
               PRIMARY KEY(draft_id, draft_revision)
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_comment_drafts (
               draft_id TEXT NOT NULL,
               draft_revision INTEGER NOT NULL CHECK(draft_revision > 0),
               post_id TEXT NOT NULL,
               reply_to_comment_id TEXT NOT NULL,
               text TEXT NOT NULL,
               mention_intent_json TEXT NOT NULL,
               mention_commitment_salt BLOB CHECK(
                  mention_commitment_salt IS NULL OR length(mention_commitment_salt) = 32
               ),
               intent_sha256 BLOB NOT NULL CHECK(length(intent_sha256) = 32),
               content_id TEXT NOT NULL,
               prepare_command_id TEXT NOT NULL,
               submit_command_id TEXT,
               request_bytes BLOB,
               request_sha256 BLOB CHECK(request_sha256 IS NULL OR length(request_sha256) = 32),
               root_key BLOB CHECK(root_key IS NULL OR length(root_key) = 32),
               generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
               publication_state INTEGER,
               lease_generation INTEGER NOT NULL DEFAULT 0,
               session_generation INTEGER NOT NULL DEFAULT 0,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               next_attempt_at_unix_ms INTEGER NOT NULL DEFAULT 0,
               state INTEGER NOT NULL,
               comment_id TEXT,
               error_code TEXT,
               retry_after_seconds INTEGER,
               updated_at_unix_ms INTEGER NOT NULL,
               PRIMARY KEY(draft_id, draft_revision)
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_comment_projections (
               comment_id TEXT PRIMARY KEY,
               post_id TEXT NOT NULL,
               projection_json BLOB NOT NULL,
               updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_submissions (
               command_id TEXT PRIMARY KEY,
               draft_id TEXT NOT NULL,
               draft_revision INTEGER NOT NULL CHECK(draft_revision > 0),
               content_id TEXT NOT NULL,
               generation INTEGER NOT NULL CHECK(generation > 0),
               request_bytes BLOB NOT NULL,
               request_sha256 BLOB NOT NULL CHECK(length(request_sha256) = 32),
               root_key BLOB NOT NULL CHECK(length(root_key) = 32),
               projection_json BLOB NOT NULL,
               state INTEGER NOT NULL,
               lease_generation INTEGER NOT NULL DEFAULT 0,
               session_generation INTEGER NOT NULL,
               post_id TEXT,
               last_error_code INTEGER,
               updated_at_unix_ms INTEGER NOT NULL,
               UNIQUE(draft_id, draft_revision)
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_prekey_commands (
               command_id TEXT PRIMARY KEY,
               key_kind INTEGER NOT NULL,
               pool_epoch INTEGER NOT NULL CHECK(pool_epoch > 0),
               request_bytes BLOB NOT NULL,
               request_sha256 BLOB NOT NULL CHECK(length(request_sha256) = 32),
               state INTEGER NOT NULL,
               lease_generation INTEGER NOT NULL DEFAULT 0,
               session_generation INTEGER NOT NULL DEFAULT 0,
               updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_prekeys (
               key_id TEXT PRIMARY KEY,
               key_kind INTEGER NOT NULL,
               pool_epoch INTEGER NOT NULL CHECK(pool_epoch > 0),
               private_key BLOB NOT NULL CHECK(length(private_key) = 32),
               public_key BLOB NOT NULL CHECK(length(public_key) = 32),
               command_id TEXT NOT NULL REFERENCES mobile_private_social_prekey_commands(command_id),
               published INTEGER NOT NULL CHECK(published IN (0, 1)),
               created_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_recovery_masters (
               actor_ptid TEXT NOT NULL,
               recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch > 0),
               master_key BLOB NOT NULL CHECK(length(master_key) = 32),
               created_at_unix_ms INTEGER NOT NULL,
               PRIMARY KEY(actor_ptid, recovery_epoch)
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_roots (
               content_id TEXT NOT NULL,
               generation INTEGER NOT NULL CHECK(generation > 0),
               post_id TEXT NOT NULL,
               root_key BLOB NOT NULL CHECK(length(root_key) = 32),
               committed_at_unix_ms INTEGER NOT NULL,
               PRIMARY KEY(content_id, generation)
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_read_projections (
               post_id TEXT PRIMARY KEY,
               content_id TEXT NOT NULL,
               generation INTEGER NOT NULL CHECK(generation >= 0),
               projection_json BLOB NOT NULL,
               updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_reaction_commands (
               command_id TEXT PRIMARY KEY,
               post_id TEXT NOT NULL,
               kind INTEGER NOT NULL CHECK(kind > 0),
               remove_reaction INTEGER NOT NULL CHECK(remove_reaction IN (0, 1)),
               request_sha256 BLOB NOT NULL CHECK(length(request_sha256) = 32),
               request_bytes BLOB NOT NULL,
               result_sha256 BLOB CHECK(result_sha256 IS NULL OR length(result_sha256) = 32),
               result_bytes BLOB,
               state INTEGER NOT NULL,
               session_generation INTEGER NOT NULL,
               lease_generation INTEGER NOT NULL DEFAULT 0,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               projection_revision INTEGER NOT NULL DEFAULT 0,
               error_code TEXT,
               retry_after_seconds INTEGER,
               retry_not_before_unix_ms INTEGER,
               updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS mobile_private_social_object_transfers (
               transfer_id TEXT PRIMARY KEY,
               owner_scope_id TEXT NOT NULL,
               operation_id TEXT NOT NULL,
               authority_id TEXT NOT NULL,
               direction INTEGER NOT NULL,
               state INTEGER NOT NULL,
               upload_id TEXT NOT NULL,
               generation INTEGER NOT NULL,
               descriptor_sha256 BLOB NOT NULL CHECK(length(descriptor_sha256) = 32),
               completed_chunk_bitmap BLOB NOT NULL,
               source_local_ref TEXT NOT NULL,
               partial_local_ref TEXT NOT NULL,
               object_key BLOB NOT NULL CHECK(length(object_key) = 32),
               base_nonce BLOB NOT NULL CHECK(length(base_nonce) = 12),
               plaintext_size INTEGER NOT NULL CHECK(plaintext_size > 0),
               chunk_size INTEGER NOT NULL CHECK(chunk_size > 0),
               media_type TEXT NOT NULL,
               attempt_count INTEGER NOT NULL,
               next_attempt_at_unix_ms INTEGER NOT NULL,
               last_error INTEGER,
               descriptor_bytes BLOB,
               updated_at_unix_ms INTEGER NOT NULL,
               session_generation INTEGER NOT NULL DEFAULT 0
             );",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_mobile_private_social_reactions_post
             ON mobile_private_social_reaction_commands(post_id, updated_at_unix_ms DESC)",
            [],
        )
        .map_err(|error| error.to_string())?;
    for column in [
        "mention_commitment_salt",
        "repost_commitment_salt",
        "object_material_seed",
    ] {
        let exists = {
            let mut statement = connection
                .prepare("PRAGMA table_info(mobile_private_social_drafts)")
                .map_err(|error| error.to_string())?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            columns.iter().any(|candidate| candidate == column)
        };
        if !exists {
            connection
                .execute(
                    &format!(
                        "ALTER TABLE mobile_private_social_drafts
                         ADD COLUMN {column} BLOB
                         CHECK({column} IS NULL OR length({column}) = 32)"
                    ),
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    for (table, column, definition) in [
        (
            "mobile_private_social_comment_drafts",
            "publication_state",
            "INTEGER",
        ),
        (
            "mobile_private_social_comment_drafts",
            "lease_generation",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "mobile_private_social_comment_drafts",
            "session_generation",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "mobile_private_social_comment_drafts",
            "attempt_count",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "mobile_private_social_comment_drafts",
            "next_attempt_at_unix_ms",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "mobile_private_social_submissions",
            "attempt_count",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "mobile_private_social_submissions",
            "next_attempt_at_unix_ms",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "mobile_private_social_prekey_commands",
            "attempt_count",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "mobile_private_social_prekey_commands",
            "next_attempt_at_unix_ms",
            "INTEGER NOT NULL DEFAULT 0",
        ),
    ] {
        let exists = {
            let mut statement = connection
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(|error| error.to_string())?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            columns.iter().any(|candidate| candidate == column)
        };
        if !exists {
            connection
                .execute(
                    &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    let operation_schema: Option<String> = connection
        .query_row(
            "SELECT value FROM mobile_private_social_metadata
             WHERE key = 'secure_content_operation_schema'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match operation_schema.as_deref() {
        Some("secure-content-operation-v1") => {}
        Some(value) if value != "mobile-private-social-legacy" => {
            return Err("private Social operation schema marker is invalid".to_string());
        }
        Some("mobile-private-social-legacy") | None => {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| error.to_string())?;
            for table in [
                "mobile_private_social_submissions",
                "mobile_private_social_prekey_commands",
            ] {
                transaction
                    .execute(
                        &format!(
                            "UPDATE {table}
                             SET state = CASE state
                               WHEN 1 THEN 2
                               WHEN 2 THEN 3
                               WHEN 3 THEN 4
                               WHEN 4 THEN 6
                               WHEN 5 THEN 8
                               WHEN 6 THEN 1
                               ELSE state
                             END"
                        ),
                        [],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "INSERT INTO mobile_private_social_metadata(key, value)
                     VALUES('secure_content_operation_schema', 'secure-content-operation-v1')
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value
                     WHERE mobile_private_social_metadata.value =
                           'mobile-private-social-legacy'",
                    [],
                )
                .map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())?;
        }
        Some(_) => unreachable!(),
    }
    Ok(())
}

fn draft_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredDraft> {
    Ok(StoredDraft {
        draft_id: row.get(0)?,
        draft_revision: from_i64(row.get(1)?, "draft revision")?,
        intent_sha256: fixed_32(row.get(2)?, "draft intent hash")?,
        content_id: row.get(3)?,
        prepare_command_id: row.get(4)?,
        mention_commitment_salt: row
            .get::<_, Option<Vec<u8>>>(5)?
            .map(|value| fixed_32(value, "mention commitment salt"))
            .transpose()?,
        repost_commitment_salt: row
            .get::<_, Option<Vec<u8>>>(6)?
            .map(|value| fixed_32(value, "repost commitment salt"))
            .transpose()?,
        object_material_seed: row
            .get::<_, Option<Vec<u8>>>(7)?
            .map(|value| fixed_32(value, "object material seed"))
            .transpose()?,
    })
}

fn comment_draft_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredCommentDraft> {
    Ok(StoredCommentDraft {
        draft_id: row.get(0)?,
        draft_revision: from_i64(row.get(1)?, "comment draft revision")?,
        post_id: row.get(2)?,
        reply_to_comment_id: row.get(3)?,
        text: row.get(4)?,
        mention_intent_json: row.get(5)?,
        mention_commitment_salt: row
            .get::<_, Option<Vec<u8>>>(6)?
            .map(|value| fixed_32(value, "comment mention commitment salt"))
            .transpose()?,
        intent_sha256: fixed_32(row.get(7)?, "comment intent hash")?,
        content_id: row.get(8)?,
        prepare_command_id: row.get(9)?,
        submit_command_id: row.get(10)?,
        request_bytes: row.get(11)?,
        request_sha256: row
            .get::<_, Option<Vec<u8>>>(12)?
            .map(|value| fixed_32(value, "comment request hash"))
            .transpose()?,
        root_key: row
            .get::<_, Option<Vec<u8>>>(13)?
            .map(|value| fixed_32(value, "comment root key"))
            .transpose()?,
        generation: from_i64(row.get(14)?, "comment generation")?,
        publication_state: row
            .get::<_, Option<i64>>(15)?
            .map(operation_state_from_i64)
            .transpose()
            .map_err(conversion_error)?,
        lease_generation: from_i64(row.get(16)?, "comment lease generation")?,
        session_generation: from_i64(row.get(17)?, "comment session generation")?,
        attempt_count: u32::try_from(row.get::<_, i64>(18)?)
            .map_err(|_| conversion_error("comment attempt count is invalid"))?,
        next_attempt_at_unix_ms: row.get(19)?,
        updated_at_unix_ms: row.get(20)?,
        state: CommentState::try_from(row.get::<_, i64>(21)?).map_err(conversion_error)?,
        comment_id: row.get(22)?,
        error_code: row.get(23)?,
        retry_after_seconds: row
            .get::<_, Option<i64>>(24)?
            .map(|value| from_i64(value, "comment retry after"))
            .transpose()?,
    })
}

fn submission_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredSubmission> {
    Ok(StoredSubmission {
        command_id: row.get(0)?,
        draft_id: row.get(1)?,
        draft_revision: from_i64(row.get(2)?, "draft revision")?,
        content_id: row.get(3)?,
        generation: from_i64(row.get(4)?, "content generation")?,
        request_bytes: row.get(5)?,
        request_sha256: fixed_32(row.get(6)?, "submission request hash")?,
        root_key: fixed_32(row.get(7)?, "content root key")?,
        projection_json: row.get(8)?,
        state: operation_state_from_i64(row.get(9)?).map_err(conversion_error)?,
        lease_generation: from_i64(row.get(10)?, "lease generation")?,
        session_generation: from_i64(row.get(11)?, "session generation")?,
        attempt_count: u32::try_from(row.get::<_, i64>(12)?)
            .map_err(|_| conversion_error("submission attempt count is invalid"))?,
        next_attempt_at_unix_ms: row.get(13)?,
        updated_at_unix_ms: row.get(14)?,
        post_id: row.get(15)?,
        last_error_code: row.get(16)?,
    })
}

fn prekey_publication_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<StoredPreKeyPublication> {
    Ok(StoredPreKeyPublication {
        command_id: row.get(0)?,
        key_kind: row.get(1)?,
        pool_epoch: from_i64(row.get(2)?, "pool epoch")?,
        request_bytes: row.get(3)?,
        request_sha256: fixed_32(row.get(4)?, "PreKey request hash")?,
        state: operation_state_from_i64(row.get(5)?).map_err(conversion_error)?,
        lease_generation: from_i64(row.get(6)?, "lease generation")?,
        session_generation: from_i64(row.get(7)?, "session generation")?,
        attempt_count: u32::try_from(row.get::<_, i64>(8)?)
            .map_err(|_| conversion_error("PreKey attempt count is invalid"))?,
        next_attempt_at_unix_ms: row.get(9)?,
        updated_at_unix_ms: row.get(10)?,
    })
}

fn reaction_command_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredReactionCommand> {
    Ok(StoredReactionCommand {
        command_id: row.get(0)?,
        post_id: row.get(1)?,
        kind: row.get(2)?,
        remove: row.get(3)?,
        request_sha256: fixed_32(row.get(4)?, "Reaction request hash")?,
        request_bytes: row.get(5)?,
        result_sha256: row
            .get::<_, Option<Vec<u8>>>(6)?
            .map(|value| fixed_32(value, "Reaction result hash"))
            .transpose()?,
        result_bytes: row.get(7)?,
        state: ReactionCommandState::try_from(row.get::<_, i64>(8)?).map_err(conversion_error)?,
        session_generation: from_i64(row.get(9)?, "session generation")?,
        lease_generation: from_i64(row.get(10)?, "Reaction lease generation")?,
        attempt_count: u32::try_from(row.get::<_, i64>(11)?)
            .map_err(|_| conversion_error("Reaction attempt count is invalid"))?,
        projection_revision: from_i64(row.get(12)?, "Reaction projection revision")?,
        error_code: row.get(13)?,
        retry_after_seconds: row
            .get::<_, Option<i64>>(14)?
            .map(|value| from_i64(value, "Reaction retry after"))
            .transpose()?,
        retry_not_before_unix_ms: row.get(15)?,
    })
}

fn object_transfer_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ObjectTransferRecord> {
    let last_error = row
        .get::<_, Option<i32>>(18)?
        .map(|value| ObjectTransferErrorCode::try_from(value).map_err(conversion_error))
        .transpose()?;
    Ok(ObjectTransferRecord {
        transfer_id: row.get(0)?,
        owner_scope_id: row.get(1)?,
        operation_id: row.get(2)?,
        authority_id: row.get(3)?,
        direction: ObjectTransferDirection::try_from(row.get::<_, i32>(4)?)
            .map_err(conversion_error)?,
        state: ObjectTransferState::try_from(row.get::<_, i32>(5)?).map_err(conversion_error)?,
        upload_id: row.get(6)?,
        generation: from_i64(row.get(7)?, "object upload generation")?,
        descriptor_sha256: row.get(8)?,
        completed_chunk_bitmap: row.get(9)?,
        source_local_ref: row.get(10)?,
        partial_local_ref: row.get(11)?,
        object_key: row.get(12)?,
        base_nonce: row.get(13)?,
        plaintext_size: from_i64(row.get(14)?, "object plaintext size")?,
        chunk_size: row.get(15)?,
        attempt_count: u32::try_from(row.get::<_, i64>(16)?)
            .map_err(|_| conversion_error("object attempt count is invalid"))?,
        next_attempt_at_unix_ms: row.get(17)?,
        last_error,
        updated_at_unix_ms: row.get(19)?,
    })
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn to_i64(value: u64, field: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("private Social {field} exceeds storage range"))
}

fn from_i64(value: i64, field: &str) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|_| conversion_error(format!("{field} is negative")))
}

fn fixed_32(value: Vec<u8>, field: &str) -> rusqlite::Result<[u8; 32]> {
    value
        .try_into()
        .map_err(|_| conversion_error(format!("{field} is not 32 bytes")))
}

fn conversion_error(error: impl ToString) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Blob,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            error.to_string(),
        )),
    )
}

fn operation_state_from_i64(value: i64) -> Result<OperationState, String> {
    let value = i32::try_from(value)
        .map_err(|_| "private Social operation state is invalid".to_string())?;
    OperationState::try_from(value).map_err(|error| error.to_string())
}

fn transfer_error(error: impl Into<String>) -> ObjectTransferFailure {
    ObjectTransferFailure::retryable(ObjectTransferErrorCode::RetryLater, None, error)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object_upload() -> ObjectTransferRecord {
        ObjectTransferRecord {
            transfer_id: "mobile-social-object-1".to_string(),
            owner_scope_id: "content-1".to_string(),
            operation_id: "object-1".to_string(),
            authority_id: "plan-1".to_string(),
            direction: ObjectTransferDirection::Upload,
            state: ObjectTransferState::Queued,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: "/tmp/mobile-social-source".to_string(),
            partial_local_ref: "/tmp/mobile-social-partial".to_string(),
            object_key: vec![7; 32],
            base_nonce: vec![0; 12],
            plaintext_size: 1024,
            chunk_size: 1024,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            last_error: None,
            updated_at_unix_ms: 1,
        }
    }

    fn draft(hash: u8) -> StoredDraft {
        StoredDraft {
            draft_id: "draft-1".to_string(),
            draft_revision: 1,
            intent_sha256: [hash; 32],
            content_id: "content-1".to_string(),
            object_material_seed: Some([8; 32]),
            prepare_command_id: "prepare-1".to_string(),
            mention_commitment_salt: Some([6; 32]),
            repost_commitment_salt: Some([7; 32]),
        }
    }

    fn submission(hash: u8) -> StoredSubmission {
        let request_bytes = vec![hash; 4];
        StoredSubmission {
            command_id: "submit-1".to_string(),
            draft_id: "draft-1".to_string(),
            draft_revision: 1,
            content_id: "content-1".to_string(),
            generation: 1,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            root_key: [9; 32],
            projection_json: br#"{"state":"PUBLISHING"}"#.to_vec(),
            state: OperationState::Pending,
            lease_generation: 0,
            session_generation: 1,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            post_id: None,
            last_error_code: None,
        }
    }

    #[test]
    fn object_upload_checkpoint_is_generation_fenced_and_resumable() {
        let store = PrivateSocialStore::in_memory("station-a", "ptid:alice").unwrap();
        store.bind_session_generation(7).unwrap();
        let record = object_upload();
        store
            .ensure_object_upload_transfer(&record, "image/png")
            .unwrap();
        store
            .update_transfer_prepared(&record.transfer_id, &[8; 32], &record.partial_local_ref, 2)
            .unwrap();
        store
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Transferring,
                "upload-1",
                3,
                &[1],
                1,
                0,
                None,
                3,
            )
            .unwrap();
        store
            .persist_object_descriptor(&record.transfer_id, b"descriptor")
            .unwrap();

        let checkpoint = store.object_transfer(&record.transfer_id).unwrap().unwrap();
        assert_eq!(checkpoint.state, ObjectTransferState::Transferring);
        assert_eq!(checkpoint.completed_chunk_bitmap, vec![1]);
        assert_eq!(checkpoint.upload_id, "upload-1");
        assert_eq!(
            store
                .object_descriptor_bytes(&record.transfer_id)
                .unwrap()
                .unwrap(),
            b"descriptor",
        );

        store.bind_session_generation(8).unwrap();
        assert!(store
            .object_transfer(&record.transfer_id)
            .unwrap()
            .is_some());
    }

    #[test]
    fn operation_schema_migrates_legacy_states_atomically() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute(
                "UPDATE mobile_private_social_metadata
                 SET value = 'mobile-private-social-legacy'
                 WHERE key = 'secure_content_operation_schema'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO mobile_private_social_submissions(
                   command_id, draft_id, draft_revision, content_id, generation,
                   request_bytes, request_sha256, root_key, projection_json, state,
                   lease_generation, session_generation, attempt_count,
                   next_attempt_at_unix_ms, updated_at_unix_ms
                 ) VALUES('submit-legacy', 'draft-legacy', 1, 'content-legacy', 1,
                          X'01', zeroblob(32), zeroblob(32), X'01', 6, 0, 1, 0, 0, 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO mobile_private_social_prekey_commands(
                   command_id, key_kind, pool_epoch, request_bytes, request_sha256,
                   state, lease_generation, session_generation, attempt_count,
                   next_attempt_at_unix_ms, updated_at_unix_ms
                 ) VALUES('prekey-legacy', 1, 1, X'01', zeroblob(32), 2, 1, 1, 1, 0, 1)",
                [],
            )
            .unwrap();

        migrate(&mut connection).unwrap();

        let submission_state: i64 = connection
            .query_row(
                "SELECT state FROM mobile_private_social_submissions
                 WHERE command_id = 'submit-legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let prekey_state: i64 = connection
            .query_row(
                "SELECT state FROM mobile_private_social_prekey_commands
                 WHERE command_id = 'prekey-legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let marker: String = connection
            .query_row(
                "SELECT value FROM mobile_private_social_metadata
                 WHERE key = 'secure_content_operation_schema'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(submission_state, OperationState::Prepared as i64);
        assert_eq!(prekey_state, OperationState::InFlight as i64);
        assert_eq!(marker, "secure-content-operation-v1");
    }

    #[test]
    fn draft_reservation_is_exact_replay_only() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        let first = store.reserve_draft(&draft(1)).unwrap();
        assert_eq!(first.content_id, "content-1");
        assert_eq!(first.mention_commitment_salt, Some([6; 32]));
        assert_eq!(first.repost_commitment_salt, Some([7; 32]));
        assert_eq!(first.object_material_seed, Some([8; 32]));
        let mut replay = draft(1);
        replay.mention_commitment_salt = Some([9; 32]);
        replay.repost_commitment_salt = Some([10; 32]);
        replay.object_material_seed = Some([11; 32]);
        let replayed = store.reserve_draft(&replay).unwrap();
        assert_eq!(
            replayed.mention_commitment_salt,
            first.mention_commitment_salt
        );
        assert_eq!(
            replayed.repost_commitment_salt,
            first.repost_commitment_salt
        );
        assert_eq!(replayed.object_material_seed, first.object_material_seed);
        assert!(store.reserve_draft(&draft(2)).is_err());
    }

    #[test]
    fn comment_draft_replay_preserves_the_original_salt() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        let candidate = StoredCommentDraft {
            draft_id: "comment-draft-1".to_string(),
            draft_revision: 1,
            post_id: "post-1".to_string(),
            reply_to_comment_id: String::new(),
            text: "private reply".to_string(),
            mention_intent_json: "[]".to_string(),
            mention_commitment_salt: Some([5; 32]),
            intent_sha256: [4; 32],
            content_id: "comment-content-1".to_string(),
            prepare_command_id: "comment-prepare-1".to_string(),
            submit_command_id: None,
            request_bytes: None,
            request_sha256: None,
            root_key: None,
            generation: 0,
            publication_state: None,
            lease_generation: 0,
            session_generation: 0,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            state: CommentState::Editing,
            comment_id: None,
            error_code: None,
            retry_after_seconds: None,
        };
        let first = store.reserve_comment_draft(&candidate).unwrap();
        let mut replay = candidate.clone();
        replay.mention_commitment_salt = Some([6; 32]);
        let replayed = store.reserve_comment_draft(&replay).unwrap();
        assert_eq!(first.mention_commitment_salt, Some([5; 32]));
        assert_eq!(
            replayed.mention_commitment_salt,
            first.mention_commitment_salt
        );
        let mut conflict = candidate;
        conflict.intent_sha256 = [8; 32];
        assert!(store.reserve_comment_draft(&conflict).is_err());
    }

    #[test]
    fn comment_unknown_outcome_requires_readback_before_exact_retry() {
        use secure_content_core::operation::{decide_unknown_outcome, ReadbackObservation};

        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(7).unwrap();
        let candidate = StoredCommentDraft {
            draft_id: "comment-draft-unknown".to_string(),
            draft_revision: 1,
            post_id: "post-1".to_string(),
            reply_to_comment_id: String::new(),
            text: "private reply".to_string(),
            mention_intent_json: "[]".to_string(),
            mention_commitment_salt: None,
            intent_sha256: [4; 32],
            content_id: "comment-content-unknown".to_string(),
            prepare_command_id: "comment-prepare-unknown".to_string(),
            submit_command_id: None,
            request_bytes: None,
            request_sha256: None,
            root_key: None,
            generation: 0,
            publication_state: None,
            lease_generation: 0,
            session_generation: 7,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            state: CommentState::Editing,
            comment_id: None,
            error_code: None,
            retry_after_seconds: None,
        };
        store.reserve_comment_draft(&candidate).unwrap();
        let request = b"canonical-comment-request";
        let request_sha256: [u8; 32] = Sha256::digest(request).into();
        store
            .persist_comment_request(
                &candidate.draft_id,
                candidate.draft_revision,
                1,
                "comment-submit-unknown",
                request,
                &request_sha256,
                &[9; 32],
                7,
            )
            .unwrap();
        let acquired = store
            .acquire_comment_submission(
                &candidate.draft_id,
                candidate.draft_revision,
                7,
                DispatchCause::ExplicitUserAction,
            )
            .unwrap();
        assert!(store
            .complete_comment_submission(
                &acquired,
                OperationCompletion::UnknownOutcome,
                CommentState::Failed,
                None,
                Some("SOCIAL_PRIVATE_COMMENT_RESULT_UNKNOWN"),
                None,
            )
            .unwrap());
        assert!(store
            .acquire_comment_submission(
                &candidate.draft_id,
                candidate.draft_revision,
                7,
                DispatchCause::ExplicitUserAction,
            )
            .is_err());

        let unknown = store
            .comment_draft(&candidate.draft_id, candidate.draft_revision)
            .unwrap()
            .unwrap();
        let decision = decide_unknown_outcome(
            &unknown.operation_record().unwrap(),
            ReadbackObservation::AuthoritativeAbsent,
        )
        .unwrap();
        assert_eq!(decision, ReadbackDecision::RetryExactCommand);
        assert!(store
            .apply_comment_readback(
                &unknown,
                &decision,
                CommentState::Failed,
                None,
                Some("SOCIAL_PRIVATE_COMMENT_RESULT_UNKNOWN"),
                None,
            )
            .unwrap());
        let retry = store
            .acquire_comment_submission(
                &candidate.draft_id,
                candidate.draft_revision,
                7,
                DispatchCause::ReadbackAuthorizedRetry,
            )
            .unwrap();
        assert!(retry.lease.reconciles_unknown_outcome);
        assert_eq!(retry.draft.attempt_count, 2);
    }

    #[test]
    fn submission_is_persisted_before_generation_fenced_dispatch() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(7).unwrap();
        store.persist_submission(&submission(3)).unwrap();
        let acquired = store
            .acquire_submission("submit-1", DispatchCause::InitialReconciliation)
            .unwrap();
        assert_eq!(acquired.command.state, OperationState::InFlight);
        assert_eq!(acquired.command.session_generation, 7);
        assert_eq!(acquired.command.lease_generation, 1);
        assert!(store
            .complete_submission(
                &acquired,
                OperationCompletion::Committed,
                Some("content-1"),
                None,
                br#"{"state":"PUBLISHED"}"#,
            )
            .unwrap());
        assert_eq!(
            store.submission("draft-1", 1).unwrap().unwrap().state,
            OperationState::Committed
        );
    }

    #[test]
    fn prepared_submission_waits_for_explicit_dispatch() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(7).unwrap();
        let mut prepared = submission(3);
        prepared.state = OperationState::Prepared;

        store.persist_submission(&prepared).unwrap();

        assert!(store.pending_submissions().unwrap().is_empty());
        let acquired = store
            .acquire_submission("submit-1", DispatchCause::ExplicitUserAction)
            .unwrap();
        assert_eq!(acquired.command.state, OperationState::InFlight);
        assert!(!acquired.lease.reconciles_unknown_outcome);
    }

    #[test]
    fn interrupted_dispatch_becomes_unknown_outcome() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(2).unwrap();
        store.persist_submission(&submission(4)).unwrap();
        store
            .acquire_submission("submit-1", DispatchCause::InitialReconciliation)
            .unwrap();
        assert_eq!(store.recover_interrupted_dispatches().unwrap(), 1);
        assert_eq!(
            store.submission("draft-1", 1).unwrap().unwrap().state,
            OperationState::UnknownOutcome
        );
    }

    #[test]
    fn private_social_reaction_command_retries_exact_bytes_and_commits_with_projection() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(7).unwrap();
        store
            .persist_receiver_failure(7, "post-1", br#"{"state":"CONTENT_READY"}"#, false)
            .unwrap();
        let request_bytes = vec![1, 2, 3, 4];
        let command = StoredReactionCommand {
            command_id: "reaction-1".to_string(),
            post_id: "post-1".to_string(),
            kind: 2,
            remove: false,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes: request_bytes.clone(),
            result_sha256: None,
            result_bytes: None,
            state: ReactionCommandState::Pending,
            session_generation: 7,
            lease_generation: 0,
            attempt_count: 0,
            projection_revision: 0,
            error_code: None,
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        };
        store.persist_reaction_command(&command).unwrap();
        let first = store.acquire_reaction_command("reaction-1", 7).unwrap();
        assert_eq!(first.request_bytes, request_bytes);
        assert!(store
            .mark_reaction_failure(
                "reaction-1",
                first.lease_generation,
                7,
                ReactionCommandState::UnknownOutcome,
                "REACTION_RESULT_UNKNOWN",
                None,
            )
            .unwrap());
        assert_eq!(
            store.reaction_command("reaction-1").unwrap().unwrap().state,
            ReactionCommandState::UnknownOutcome
        );

        let retry = store.acquire_reaction_command("reaction-1", 7).unwrap();
        let result_bytes = vec![9, 8, 7];
        let result_sha256: [u8; 32] = Sha256::digest(&result_bytes).into();
        let projection = br#"{"state":"CONTENT_READY","reactionRevision":"2"}"#;
        assert!(store
            .mark_reaction_committed(
                "reaction-1",
                retry.lease_generation,
                7,
                &result_bytes,
                &result_sha256,
                2,
                "post-1",
                projection,
            )
            .unwrap());
        let committed = store.reaction_command("reaction-1").unwrap().unwrap();
        assert_eq!(committed.state, ReactionCommandState::Committed);
        assert_eq!(committed.attempt_count, 2);
        assert_eq!(
            store.read_projection("post-1").unwrap().unwrap(),
            projection
        );
    }

    #[test]
    fn recovery_publication_persists_only_the_command() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        let request_bytes = vec![1, 2, 3];
        let command = StoredPreKeyPublication {
            command_id: "recovery-publication-1".to_string(),
            key_kind: ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32,
            pool_epoch: 1,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            state: OperationState::Pending,
            lease_generation: 0,
            session_generation: 0,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            updated_at_unix_ms: 0,
        };

        assert!(store
            .persist_prekey_publication(
                &command,
                &[("recovery-key-1".to_string(), [7; 32], [8; 32])],
            )
            .is_err());
        store.persist_prekey_publication(&command, &[]).unwrap();

        let pending = store.pending_prekey_publications().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].command_id, command.command_id);
        assert!(store.endpoint_prekey("recovery-key-1").unwrap().is_none());
    }

    #[test]
    fn endpoint_publication_requires_durable_private_material() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        let request_bytes = vec![1, 2, 3];
        let command = StoredPreKeyPublication {
            command_id: "endpoint-publication-1".to_string(),
            key_kind: ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
            pool_epoch: 1,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            state: OperationState::Pending,
            lease_generation: 0,
            session_generation: 0,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            updated_at_unix_ms: 0,
        };

        assert!(store.persist_prekey_publication(&command, &[]).is_err());
    }

    #[test]
    fn receiver_commit_rolls_back_when_the_selected_prekey_is_not_consumable() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();

        assert!(store
            .commit_receiver_projection(
                1,
                "content-1",
                1,
                "post-1",
                &[4; 32],
                Some("missing-prekey"),
                br#"{"state":"CONTENT_READY"}"#,
            )
            .is_err());
        assert!(store.content_root("content-1", 1).unwrap().is_none());
        assert!(store.read_projection("post-1").unwrap().is_none());
    }

    #[test]
    fn stale_receiver_generation_cannot_commit_plaintext_or_consume_keys() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();
        store.invalidate_session_generation(1).unwrap();

        assert!(store
            .commit_receiver_projection(
                1,
                "content-1",
                1,
                "post-1",
                &[4; 32],
                None,
                br#"{"state":"CONTENT_READY"}"#,
            )
            .is_err());
        assert!(store.content_root("content-1", 1).unwrap().is_none());
        assert!(store.read_projection("post-1").unwrap().is_none());
    }
    #[test]
    fn recovery_masters_are_epoch_bound_and_replay_safe() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store
            .store_recovery_master("ptid:alice", 3, &[3; 32])
            .unwrap();
        store
            .store_recovery_master("ptid:alice", 4, &[4; 32])
            .unwrap();
        store
            .store_recovery_master("ptid:alice", 4, &[4; 32])
            .unwrap();

        assert!(store
            .store_recovery_master("ptid:alice", 4, &[5; 32])
            .is_err());
        assert_eq!(
            store.recovery_master("ptid:alice", 3).unwrap(),
            Some([3; 32])
        );
        assert_eq!(
            store.recovery_master("ptid:alice", 4).unwrap(),
            Some([4; 32])
        );
        assert_eq!(store.latest_recovery_epoch("ptid:alice").unwrap(), Some(4));
    }
}
