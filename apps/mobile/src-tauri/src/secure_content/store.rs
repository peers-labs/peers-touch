use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::secure_content::proto::secure_content::v1::ContentPreKeyKind;

const ENDPOINT_PREKEY_KIND: i64 = ContentPreKeyKind::ContentPrekeyKindEndpoint as i32 as i64;
const RECOVERY_PREKEY_KIND: i64 = ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32 as i64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i64)]
pub enum DurableState {
    Pending = 1,
    InFlight = 2,
    UnknownOutcome = 3,
    Committed = 4,
    Terminal = 5,
    Prepared = 6,
}

impl TryFrom<i64> for DurableState {
    type Error = String;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Pending),
            2 => Ok(Self::InFlight),
            3 => Ok(Self::UnknownOutcome),
            4 => Ok(Self::Committed),
            5 => Ok(Self::Terminal),
            6 => Ok(Self::Prepared),
            _ => Err("private Social durable state is invalid".to_string()),
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
    pub state: DurableState,
    pub lease_generation: u64,
    pub session_generation: u64,
    pub post_id: Option<String>,
    pub last_error_code: Option<i32>,
}

impl Drop for StoredSubmission {
    fn drop(&mut self) {
        self.root_key.zeroize();
    }
}

#[derive(Clone, Debug)]
pub struct AcquiredSubmission {
    pub command: StoredSubmission,
    pub reconciles_unknown_outcome: bool,
}

#[derive(Clone, Debug)]
pub struct StoredPreKeyPublication {
    pub command_id: String,
    pub key_kind: i32,
    pub pool_epoch: u64,
    pub request_bytes: Vec<u8>,
    pub request_sha256: [u8; 32],
    pub state: DurableState,
    pub lease_generation: u64,
    pub session_generation: u64,
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
        connection: Connection,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> Result<Self, String> {
        migrate(&connection)?;
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
        let connection = self.connection()?;
        let prekeys = connection
            .execute(
                "UPDATE mobile_private_social_prekey_commands
                 SET state = ?1, updated_at_unix_ms = ?2 WHERE state = ?3",
                params![
                    DurableState::UnknownOutcome as i64,
                    now,
                    DurableState::InFlight as i64
                ],
            )
            .map_err(|error| error.to_string())?;
        let submissions = connection
            .execute(
                "UPDATE mobile_private_social_submissions
                 SET state = ?1, updated_at_unix_ms = ?2 WHERE state = ?3",
                params![
                    DurableState::UnknownOutcome as i64,
                    now,
                    DurableState::InFlight as i64
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(prekeys + submissions)
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
                        request_sha256, root_key, generation, state, comment_id,
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
                        request_sha256, root_key, generation, state, comment_id,
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
                        request_sha256, root_key, generation, state, comment_id,
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
    ) -> Result<(), String> {
        if request_bytes.is_empty()
            || Sha256::digest(request_bytes).as_slice() != request_sha256
            || generation == 0
            || submit_command_id.trim().is_empty()
        {
            return Err("private Comment prepared request is invalid".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "UPDATE mobile_private_social_comment_drafts
                 SET generation = ?1, submit_command_id = ?2, request_bytes = ?3,
                     request_sha256 = ?4, root_key = ?5, state = ?6,
                     error_code = NULL, retry_after_seconds = NULL,
                     updated_at_unix_ms = ?7
                 WHERE draft_id = ?8 AND draft_revision = ?9
                   AND intent_sha256 = (
                     SELECT intent_sha256 FROM mobile_private_social_comment_drafts
                     WHERE draft_id = ?8 AND draft_revision = ?9
                   )",
                params![
                    to_i64(generation, "comment generation")?,
                    submit_command_id,
                    request_bytes,
                    request_sha256.as_slice(),
                    root_key.as_slice(),
                    CommentState::Submitting as i64,
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
                   lease_generation, session_generation, post_id, last_error_code,
                   updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, NULL, NULL, ?12)
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
                        lease_generation, session_generation, post_id, last_error_code
                 FROM mobile_private_social_submissions
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "draft revision")?],
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
                        lease_generation, session_generation, post_id, last_error_code
                 FROM mobile_private_social_submissions
                 WHERE state IN (?1, ?2)
                 ORDER BY updated_at_unix_ms, command_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![
                    DurableState::Pending as i64,
                    DurableState::UnknownOutcome as i64
                ],
                submission_from_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn acquire_submission(&self, command_id: &str) -> Result<AcquiredSubmission, String> {
        let generation = self.generation()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let prior = transaction
            .query_row(
                "SELECT state FROM mobile_private_social_submissions WHERE command_id = ?1",
                params![command_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        let prior = DurableState::try_from(prior)?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_submissions
                 SET state = ?1, lease_generation = lease_generation + 1,
                     session_generation = ?2, updated_at_unix_ms = ?3
                 WHERE command_id = ?4 AND state IN (?5, ?6, ?7)",
                params![
                    DurableState::InFlight as i64,
                    to_i64(generation, "session generation")?,
                    now_unix_ms(),
                    command_id,
                    DurableState::Prepared as i64,
                    DurableState::Pending as i64,
                    DurableState::UnknownOutcome as i64,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("private Social submission is not dispatchable".to_string());
        }
        let command = transaction
            .query_row(
                "SELECT command_id, draft_id, draft_revision, content_id, generation,
                        request_bytes, request_sha256, root_key, projection_json, state,
                        lease_generation, session_generation, post_id, last_error_code
                 FROM mobile_private_social_submissions WHERE command_id = ?1",
                params![command_id],
                submission_from_row,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(AcquiredSubmission {
            command,
            reconciles_unknown_outcome: prior == DurableState::UnknownOutcome,
        })
    }

    pub fn finish_submission(
        &self,
        command: &StoredSubmission,
        target: DurableState,
        post_id: Option<&str>,
        error_code: Option<i32>,
        projection_json: &[u8],
    ) -> Result<bool, String> {
        if !matches!(
            target,
            DurableState::UnknownOutcome | DurableState::Committed | DurableState::Terminal
        ) {
            return Err("private Social submission target state is invalid".to_string());
        }
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE mobile_private_social_submissions
                 SET state = ?1, post_id = COALESCE(?2, post_id), last_error_code = ?3,
                     projection_json = ?4, updated_at_unix_ms = ?5
                 WHERE command_id = ?6 AND state = ?7
                   AND lease_generation = ?8 AND session_generation = ?9",
                params![
                    target as i64,
                    post_id,
                    error_code,
                    projection_json,
                    now_unix_ms(),
                    command.command_id,
                    DurableState::InFlight as i64,
                    to_i64(command.lease_generation, "lease generation")?,
                    to_i64(command.session_generation, "session generation")?,
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
                   state, lease_generation, session_generation, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7)
                 ON CONFLICT(command_id) DO NOTHING",
                params![
                    command.command_id,
                    command.key_kind,
                    to_i64(command.pool_epoch, "pool epoch")?,
                    command.request_bytes,
                    command.request_sha256.as_slice(),
                    DurableState::Pending as i64,
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

    pub fn pending_prekey_publications(&self) -> Result<Vec<StoredPreKeyPublication>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT command_id, key_kind, pool_epoch, request_bytes, request_sha256,
                        state, lease_generation, session_generation
                 FROM mobile_private_social_prekey_commands
                 WHERE state IN (?1, ?2) ORDER BY updated_at_unix_ms, command_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![
                    DurableState::Pending as i64,
                    DurableState::UnknownOutcome as i64
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
    ) -> Result<(StoredPreKeyPublication, bool), String> {
        let generation = self.generation()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let prior = transaction
            .query_row(
                "SELECT state FROM mobile_private_social_prekey_commands WHERE command_id = ?1",
                params![command_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        let prior = DurableState::try_from(prior)?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_prekey_commands
                 SET state = ?1, lease_generation = lease_generation + 1,
                     session_generation = ?2, updated_at_unix_ms = ?3
                 WHERE command_id = ?4 AND state IN (?5, ?6)",
                params![
                    DurableState::InFlight as i64,
                    to_i64(generation, "session generation")?,
                    now_unix_ms(),
                    command_id,
                    DurableState::Pending as i64,
                    DurableState::UnknownOutcome as i64,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("private Social PreKey publication is not dispatchable".to_string());
        }
        let command = transaction
            .query_row(
                "SELECT command_id, key_kind, pool_epoch, request_bytes, request_sha256,
                        state, lease_generation, session_generation
                 FROM mobile_private_social_prekey_commands WHERE command_id = ?1",
                params![command_id],
                prekey_publication_from_row,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok((command, prior == DurableState::UnknownOutcome))
    }

    pub fn finish_prekey_publication(
        &self,
        command: &StoredPreKeyPublication,
        target: DurableState,
    ) -> Result<bool, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE mobile_private_social_prekey_commands
                 SET state = ?1, updated_at_unix_ms = ?2
                 WHERE command_id = ?3 AND state = ?4
                   AND lease_generation = ?5 AND session_generation = ?6",
                params![
                    target as i64,
                    now_unix_ms(),
                    command.command_id,
                    DurableState::InFlight as i64,
                    to_i64(command.lease_generation, "lease generation")?,
                    to_i64(command.session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 && target == DurableState::Committed {
            transaction
                .execute(
                    "UPDATE mobile_private_social_prekeys SET published = 1
                     WHERE command_id = ?1",
                    params![command.command_id],
                )
                .map_err(|error| error.to_string())?;
        } else if changed == 1 && target == DurableState::Terminal {
            transaction
                .execute(
                    "DELETE FROM mobile_private_social_prekeys
                     WHERE command_id = ?1 AND published = 0",
                    params![command.command_id],
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
        || !matches!(
            command.state,
            DurableState::Prepared | DurableState::Pending
        )
    {
        Err("private Social submission is invalid".to_string())
    } else {
        Ok(())
    }
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

fn migrate(connection: &Connection) -> Result<(), String> {
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
             );",
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
        state: CommentState::try_from(row.get::<_, i64>(15)?).map_err(conversion_error)?,
        comment_id: row.get(16)?,
        error_code: row.get(17)?,
        retry_after_seconds: row
            .get::<_, Option<i64>>(18)?
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
        state: DurableState::try_from(row.get::<_, i64>(9)?).map_err(conversion_error)?,
        lease_generation: from_i64(row.get(10)?, "lease generation")?,
        session_generation: from_i64(row.get(11)?, "session generation")?,
        post_id: row.get(12)?,
        last_error_code: row.get(13)?,
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
        state: DurableState::try_from(row.get::<_, i64>(5)?).map_err(conversion_error)?,
        lease_generation: from_i64(row.get(6)?, "lease generation")?,
        session_generation: from_i64(row.get(7)?, "session generation")?,
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

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

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
            state: DurableState::Pending,
            lease_generation: 0,
            session_generation: 1,
            post_id: None,
            last_error_code: None,
        }
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
    fn submission_is_persisted_before_generation_fenced_dispatch() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(7).unwrap();
        store.persist_submission(&submission(3)).unwrap();
        let acquired = store.acquire_submission("submit-1").unwrap();
        assert_eq!(acquired.command.state, DurableState::InFlight);
        assert_eq!(acquired.command.session_generation, 7);
        assert_eq!(acquired.command.lease_generation, 1);
        assert!(store
            .finish_submission(
                &acquired.command,
                DurableState::Committed,
                Some("content-1"),
                None,
                br#"{"state":"PUBLISHED"}"#,
            )
            .unwrap());
        assert_eq!(
            store.submission("draft-1", 1).unwrap().unwrap().state,
            DurableState::Committed
        );
    }

    #[test]
    fn prepared_submission_waits_for_explicit_dispatch() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(7).unwrap();
        let mut prepared = submission(3);
        prepared.state = DurableState::Prepared;

        store.persist_submission(&prepared).unwrap();

        assert!(store.pending_submissions().unwrap().is_empty());
        let acquired = store.acquire_submission("submit-1").unwrap();
        assert_eq!(acquired.command.state, DurableState::InFlight);
        assert!(!acquired.reconciles_unknown_outcome);
    }

    #[test]
    fn interrupted_dispatch_becomes_unknown_outcome() {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(2).unwrap();
        store.persist_submission(&submission(4)).unwrap();
        store.acquire_submission("submit-1").unwrap();
        assert_eq!(store.recover_interrupted_dispatches().unwrap(), 1);
        assert_eq!(
            store.submission("draft-1", 1).unwrap().unwrap().state,
            DurableState::UnknownOutcome
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
            state: DurableState::Pending,
            lease_generation: 0,
            session_generation: 0,
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
            state: DurableState::Pending,
            lease_generation: 0,
            session_generation: 0,
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
