use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use secure_content_core::object::{
    ObjectDescriptor, ObjectTransferDirection, ObjectTransferErrorCode, ObjectTransferFailure,
    ObjectTransferRecord, ObjectTransferState,
};
use secure_content_core::ports::ObjectTransferRepository;
use sha2::{Digest, Sha256};

use crate::domain::storage::database::DatabaseOpenSpec;
use crate::infrastructure::local_scope;
use crate::infrastructure::storage::{self, key_provider::PlatformKeyProvider};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i64)]
pub enum PublicationState {
    PendingPublication = 1,
    InFlight = 2,
    UnknownCommit = 3,
    Published = 4,
    Terminal = 5,
    CommittedPendingReadback = 6,
}

impl TryFrom<i64> for PublicationState {
    type Error = String;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::PendingPublication),
            2 => Ok(Self::InFlight),
            3 => Ok(Self::UnknownCommit),
            4 => Ok(Self::Published),
            5 => Ok(Self::Terminal),
            6 => Ok(Self::CommittedPendingReadback),
            _ => Err("secure content publication state is invalid".to_string()),
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
            _ => Err("secure content Comment state is invalid".to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i64)]
pub enum LocalPreKeyState {
    PendingPublication = 1,
    Published = 2,
    RootCommitted = 3,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredPublication {
    pub command_id: String,
    pub key_kind: i32,
    pub pool_epoch: u64,
    pub request_bytes: Vec<u8>,
    pub request_sha256: [u8; 32],
    pub state: PublicationState,
    pub lease_generation: u64,
    pub session_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AcquiredPublication {
    pub command: StoredPublication,
    pub reconciles_unknown_commit: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredEndpointPreKey {
    pub key_id: String,
    pub private_key: [u8; 32],
    pub public_key: [u8; 32],
    pub pool_epoch: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredMomentCommand {
    pub draft_id: String,
    pub draft_revision: u64,
    pub content_id: String,
    pub generation: u64,
    pub submit_command_id: String,
    pub plan_bytes: Vec<u8>,
    pub request_bytes: Vec<u8>,
    pub request_sha256: [u8; 32],
    pub root_key: [u8; 32],
    pub state: PublicationState,
    pub session_generation: u64,
    pub post_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredMomentDraft {
    pub draft_id: String,
    pub draft_revision: u64,
    pub intent_sha256: [u8; 32],
    pub content_id: String,
    pub prepare_command_id: String,
    pub mention_commitment_salt: Option<[u8; 32]>,
    pub repost_commitment_salt: Option<[u8; 32]>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredCommentDraft {
    pub draft_id: String,
    pub draft_revision: u64,
    pub post_id: String,
    pub content_id: String,
    pub generation: u64,
    pub reply_to_comment_id: String,
    pub text: String,
    pub mention_intent_json: String,
    pub mention_commitment_salt: Option<[u8; 32]>,
    pub intent_sha256: [u8; 32],
    pub prepare_command_id: String,
    pub submit_command_id: Option<String>,
    pub plan_bytes: Option<Vec<u8>>,
    pub request_bytes: Option<Vec<u8>>,
    pub request_sha256: Option<[u8; 32]>,
    pub root_key: Option<[u8; 32]>,
    pub publication_state: Option<PublicationState>,
    pub session_generation: u64,
    pub comment_id: Option<String>,
    pub state: CommentState,
    pub error_code: Option<String>,
    pub retry_after_seconds: Option<u64>,
    pub retry_not_before_unix_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredObjectTransfer {
    pub record: ObjectTransferRecord,
    pub media_type: String,
}

pub struct SecureContentStore {
    connection: Mutex<Connection>,
    session_generation: AtomicU64,
}

impl SecureContentStore {
    pub fn open(actor_ptid: &str) -> Result<Self, String> {
        if actor_ptid.trim().is_empty() {
            return Err("secure content store requires actor PTID".to_string());
        }
        let scope = local_scope::user_scope_for_actor_ptid(actor_ptid);
        let spec = DatabaseOpenSpec::new_secure_content_main(scope);
        let connection = storage::open_database(&spec, PlatformKeyProvider::shared())
            .map_err(|error| format!("open secure content SQLCipher store: {error}"))?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self, String> {
        let store = Self::from_connection(
            Connection::open_in_memory().map_err(|error| error.to_string())?,
        )?;
        store.bind_session_generation(1)?;
        Ok(store)
    }

    fn from_connection(connection: Connection) -> Result<Self, String> {
        migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            session_generation: AtomicU64::new(0),
        })
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "secure content store lock poisoned".to_string())
    }

    pub fn claim_session_generation(&self) -> Result<u64, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let current = transaction
            .query_row(
                "SELECT session_generation
                 FROM secure_content_runtime_state
                 WHERE singleton = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        let generation = from_i64(current, "session generation")
            .map_err(|error| error.to_string())?
            .checked_add(1)
            .ok_or_else(|| "secure content session generation overflowed".to_string())?;
        let stored_generation = to_i64(generation, "session generation")?;
        transaction
            .execute(
                "UPDATE secure_content_runtime_state
                 SET session_generation = ?1
                 WHERE singleton = 1",
                params![stored_generation],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE secure_content_object_transfers
                 SET session_generation = ?1",
                params![stored_generation],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        self.session_generation.store(generation, Ordering::Release);
        Ok(generation)
    }

    #[cfg(test)]
    pub fn bind_session_generation(&self, session_generation: u64) -> Result<(), String> {
        if session_generation == 0 {
            return Err("secure content session generation is required".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE secure_content_runtime_state
                 SET session_generation = ?1
                 WHERE singleton = 1",
                params![to_i64(session_generation, "session generation")?],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE secure_content_object_transfers
                 SET session_generation = ?1",
                params![to_i64(session_generation, "session generation")?],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        self.session_generation
            .store(session_generation, Ordering::Release);
        Ok(())
    }

    fn bound_session_generation(&self) -> Result<i64, ObjectTransferFailure> {
        let generation = self.session_generation.load(Ordering::Acquire);
        if generation == 0 {
            return Err(transfer_error(
                "secure content Store is not bound to a session generation",
            ));
        }
        to_i64(generation, "session generation").map_err(transfer_error)
    }

    pub fn recover_orphaned_leases(&self) -> Result<usize, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let publications = transaction
            .execute(
                "UPDATE secure_content_prekey_commands
                 SET state = ?1, updated_at_unix_ms = unixepoch('subsec') * 1000
                 WHERE state = ?2",
                params![
                    PublicationState::UnknownCommit as i64,
                    PublicationState::InFlight as i64
                ],
            )
            .map_err(|error| error.to_string())?;
        let moments = transaction
            .execute(
                "UPDATE secure_content_moment_commands
                 SET state = ?1, updated_at_unix_ms = unixepoch('subsec') * 1000
                 WHERE state = ?2",
                params![
                    PublicationState::UnknownCommit as i64,
                    PublicationState::InFlight as i64
                ],
            )
            .map_err(|error| error.to_string())?;
        let comments = transaction
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET publication_state = ?1, state = ?2,
                     error_code = 'COMMENT_SUBMIT_RESULT_UNKNOWN',
                     updated_at_unix_ms = unixepoch('subsec') * 1000
                 WHERE publication_state = ?3",
                params![
                    PublicationState::UnknownCommit as i64,
                    CommentState::Failed as i64,
                    PublicationState::InFlight as i64,
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM secure_content_moment_drafts
                 WHERE content_id NOT IN (
                   SELECT content_id FROM secure_content_moment_commands
                 )",
                [],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(publications + moments + comments)
    }

    pub fn checkpoint_session_generation(&self, session_generation: u64) -> Result<usize, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let session_generation = to_i64(session_generation, "session generation")?;
        let publications = transaction
            .execute(
                "UPDATE secure_content_prekey_commands
                 SET state = ?1, updated_at_unix_ms = unixepoch('subsec') * 1000
                 WHERE state = ?2 AND session_generation = ?3",
                params![
                    PublicationState::UnknownCommit as i64,
                    PublicationState::InFlight as i64,
                    session_generation,
                ],
            )
            .map_err(|error| error.to_string())?;
        let moments = transaction
            .execute(
                "UPDATE secure_content_moment_commands
                 SET state = ?1, updated_at_unix_ms = unixepoch('subsec') * 1000
                 WHERE state = ?2 AND session_generation = ?3",
                params![
                    PublicationState::UnknownCommit as i64,
                    PublicationState::InFlight as i64,
                    session_generation,
                ],
            )
            .map_err(|error| error.to_string())?;
        let comments = transaction
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET publication_state = ?1, state = ?2,
                     error_code = 'COMMENT_SUBMIT_RESULT_UNKNOWN',
                     updated_at_unix_ms = unixepoch('subsec') * 1000
                 WHERE publication_state = ?3 AND session_generation = ?4",
                params![
                    PublicationState::UnknownCommit as i64,
                    CommentState::Failed as i64,
                    PublicationState::InFlight as i64,
                    session_generation,
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(publications + moments + comments)
    }

    pub fn persist_prekey_publication(
        &self,
        command: &StoredPublication,
        keys: &[(String, Option<[u8; 32]>, [u8; 32])],
    ) -> Result<(), String> {
        if command.command_id.trim().is_empty()
            || command.request_bytes.is_empty()
            || keys.is_empty()
            || keys.len() > 100
            || Sha256::digest(&command.request_bytes).as_slice() != command.request_sha256
        {
            return Err("secure content publication journal input is invalid".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO secure_content_prekey_commands(
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
                    PublicationState::PendingPublication as i64,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored_hash: Vec<u8> = transaction
            .query_row(
                "SELECT request_sha256 FROM secure_content_prekey_commands
                 WHERE command_id = ?1",
                params![command.command_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if stored_hash != command.request_sha256 {
            return Err("secure content publication replay conflict".to_string());
        }
        for (key_id, private_key, public_key) in keys {
            transaction
                .execute(
                    "INSERT INTO secure_content_prekeys(
                        key_id, key_kind, pool_epoch, private_key, public_key,
                        command_id, state, created_at_unix_ms
                     ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(key_id) DO NOTHING",
                    params![
                        key_id,
                        command.key_kind,
                        to_i64(command.pool_epoch, "pool epoch")?,
                        private_key.as_ref().map(|key| key.as_slice()),
                        public_key.as_slice(),
                        command.command_id,
                        LocalPreKeyState::PendingPublication as i64,
                        now_unix_ms(),
                    ],
                )
                .map_err(|error| error.to_string())?;
            let existing: (Vec<u8>, String) = transaction
                .query_row(
                    "SELECT public_key, command_id FROM secure_content_prekeys WHERE key_id = ?1",
                    params![key_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|error| error.to_string())?;
            if existing.0 != *public_key || existing.1 != command.command_id {
                return Err("secure content PreKey identity conflict".to_string());
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn publications_requiring_reconciliation(&self) -> Result<Vec<StoredPublication>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT command_id, key_kind, pool_epoch, request_bytes,
                        request_sha256, state, lease_generation, session_generation
                 FROM secure_content_prekey_commands
                 WHERE state IN (?1, ?2, ?3)
                 ORDER BY updated_at_unix_ms, command_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![
                    PublicationState::PendingPublication as i64,
                    PublicationState::InFlight as i64,
                    PublicationState::UnknownCommit as i64
                ],
                publication_from_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn acquire_publication(
        &self,
        command_id: &str,
        session_generation: u64,
    ) -> Result<AcquiredPublication, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let prior_state = transaction
            .query_row(
                "SELECT state FROM secure_content_prekey_commands WHERE command_id = ?1",
                params![command_id],
                |row| PublicationState::try_from(row.get::<_, i64>(0)?).map_err(conversion_error),
            )
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE secure_content_prekey_commands
                 SET state = ?1,
                     lease_generation = lease_generation + 1,
                     session_generation = ?2,
                     updated_at_unix_ms = ?3
                 WHERE command_id = ?4 AND state IN (?5, ?6, ?7)",
                params![
                    PublicationState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                    now_unix_ms(),
                    command_id,
                    PublicationState::PendingPublication as i64,
                    PublicationState::UnknownCommit as i64,
                    PublicationState::InFlight as i64,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("secure content publication is not retryable".to_string());
        }
        let command = transaction
            .query_row(
                "SELECT command_id, key_kind, pool_epoch, request_bytes,
                        request_sha256, state, lease_generation, session_generation
                 FROM secure_content_prekey_commands WHERE command_id = ?1",
                params![command_id],
                publication_from_row,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(AcquiredPublication {
            command,
            reconciles_unknown_commit: prior_state == PublicationState::UnknownCommit,
        })
    }

    pub fn mark_publication_unknown(
        &self,
        command_id: &str,
        lease_generation: u64,
        session_generation: u64,
    ) -> Result<bool, String> {
        self.transition_publication(
            command_id,
            lease_generation,
            session_generation,
            PublicationState::UnknownCommit,
        )
    }

    pub fn mark_publication_terminal(
        &self,
        command_id: &str,
        lease_generation: u64,
        session_generation: u64,
    ) -> Result<bool, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE secure_content_prekey_commands
                 SET state = ?1, updated_at_unix_ms = ?2
                 WHERE command_id = ?3 AND state = ?4
                   AND lease_generation = ?5 AND session_generation = ?6",
                params![
                    PublicationState::Terminal as i64,
                    now_unix_ms(),
                    command_id,
                    PublicationState::InFlight as i64,
                    to_i64(lease_generation, "lease generation")?,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            transaction
                .execute(
                    "DELETE FROM secure_content_prekeys
                     WHERE command_id = ?1 AND state = ?2",
                    params![command_id, LocalPreKeyState::PendingPublication as i64],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(changed == 1)
    }

    pub fn mark_publication_published(
        &self,
        command_id: &str,
        lease_generation: u64,
        session_generation: u64,
    ) -> Result<bool, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE secure_content_prekey_commands
                 SET state = ?1, updated_at_unix_ms = ?2
                 WHERE command_id = ?3 AND state = ?4
                   AND lease_generation = ?5 AND session_generation = ?6",
                params![
                    PublicationState::Published as i64,
                    now_unix_ms(),
                    command_id,
                    PublicationState::InFlight as i64,
                    to_i64(lease_generation, "lease generation")?,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            transaction
                .execute(
                    "UPDATE secure_content_prekeys SET state = ?1
                     WHERE command_id = ?2 AND state = ?3",
                    params![
                        LocalPreKeyState::Published as i64,
                        command_id,
                        LocalPreKeyState::PendingPublication as i64
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(changed == 1)
    }

    fn transition_publication(
        &self,
        command_id: &str,
        lease_generation: u64,
        session_generation: u64,
        target: PublicationState,
    ) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE secure_content_prekey_commands
                 SET state = ?1, updated_at_unix_ms = ?2
                 WHERE command_id = ?3 AND state = ?4
                   AND lease_generation = ?5 AND session_generation = ?6",
                params![
                    target as i64,
                    now_unix_ms(),
                    command_id,
                    PublicationState::InFlight as i64,
                    to_i64(lease_generation, "lease generation")?,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn endpoint_prekey(&self, key_id: &str) -> Result<Option<StoredEndpointPreKey>, String> {
        self.connection()?
            .query_row(
                "SELECT key_id, private_key, public_key, pool_epoch
                 FROM secure_content_prekeys
                 WHERE key_id = ?1 AND key_kind = 1 AND private_key IS NOT NULL
                   AND state IN (?2, ?3)",
                params![
                    key_id,
                    LocalPreKeyState::PendingPublication as i64,
                    LocalPreKeyState::Published as i64
                ],
                |row| {
                    let private_key: Vec<u8> = row.get(1)?;
                    let public_key: Vec<u8> = row.get(2)?;
                    Ok(StoredEndpointPreKey {
                        key_id: row.get(0)?,
                        private_key: fixed_32(private_key, "endpoint private key")?,
                        public_key: fixed_32(public_key, "endpoint public key")?,
                        pool_epoch: from_i64(row.get(3)?, "pool epoch")?,
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
            return Err("secure content recovery master identity is invalid".to_string());
        }
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO secure_content_recovery_masters(
                    actor_ptid, recovery_epoch, master_key, created_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(actor_ptid, recovery_epoch) DO NOTHING",
                params![
                    actor_ptid,
                    to_i64(recovery_epoch, "recovery epoch")?,
                    master.as_slice(),
                    now_unix_ms()
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored: Vec<u8> = connection
            .query_row(
                "SELECT master_key FROM secure_content_recovery_masters
                 WHERE actor_ptid = ?1 AND recovery_epoch = ?2",
                params![actor_ptid, to_i64(recovery_epoch, "recovery epoch")?],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if stored.as_slice() != master {
            return Err("secure content recovery master epoch conflict".to_string());
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
                "SELECT master_key FROM secure_content_recovery_masters
                 WHERE actor_ptid = ?1 AND recovery_epoch = ?2",
                params![actor_ptid, to_i64(recovery_epoch, "recovery epoch")?],
                |row| fixed_32(row.get(0)?, "recovery master"),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn latest_recovery_epoch(&self, actor_ptid: &str) -> Result<Option<u64>, String> {
        let epoch = self
            .connection()?
            .query_row(
                "SELECT MAX(recovery_epoch) FROM secure_content_recovery_masters
                 WHERE actor_ptid = ?1",
                params![actor_ptid],
                |row| row.get::<_, Option<i64>>(0),
            )
            .map_err(|error| error.to_string())?
            .map(|epoch| from_i64(epoch, "recovery epoch"))
            .transpose()
            .map_err(|error| error.to_string())?;
        Ok(epoch)
    }

    pub fn persist_moment_command(&self, command: &StoredMomentCommand) -> Result<(), String> {
        if command.draft_id.trim().is_empty()
            || command.content_id.trim().is_empty()
            || command.submit_command_id.trim().is_empty()
            || command.generation == 0
            || command.plan_bytes.is_empty()
            || command.request_bytes.is_empty()
            || Sha256::digest(&command.request_bytes).as_slice() != command.request_sha256
        {
            return Err("secure content Moment command is invalid".to_string());
        }
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO secure_content_moment_commands(
                    draft_id, draft_revision, content_id, generation,
                    submit_command_id, plan_bytes, request_bytes, request_sha256,
                    root_key, state, session_generation, post_id, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(draft_id, draft_revision) DO NOTHING",
                params![
                    command.draft_id,
                    to_i64(command.draft_revision, "draft revision")?,
                    command.content_id,
                    to_i64(command.generation, "content generation")?,
                    command.submit_command_id,
                    command.plan_bytes,
                    command.request_bytes,
                    command.request_sha256.as_slice(),
                    command.root_key.as_slice(),
                    command.state as i64,
                    to_i64(command.session_generation, "session generation")?,
                    command.post_id,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored: Vec<u8> = connection
            .query_row(
                "SELECT request_sha256 FROM secure_content_moment_commands
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![
                    command.draft_id,
                    to_i64(command.draft_revision, "draft revision")?
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if stored != command.request_sha256 {
            return Err("secure content Moment command replay conflict".to_string());
        }
        Ok(())
    }

    pub fn reserve_moment_draft(
        &self,
        candidate: &StoredMomentDraft,
    ) -> Result<StoredMomentDraft, String> {
        if candidate.draft_id.trim().is_empty()
            || candidate.draft_revision == 0
            || candidate.content_id.trim().is_empty()
            || candidate.prepare_command_id.trim().is_empty()
        {
            return Err("secure content Moment draft reservation is invalid".to_string());
        }
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO secure_content_moment_drafts(
                    draft_id, draft_revision, intent_sha256, content_id,
                    prepare_command_id, mention_commitment_salt,
                    repost_commitment_salt, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
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
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        let stored = connection
            .query_row(
                "SELECT draft_id, draft_revision, intent_sha256, content_id,
                        prepare_command_id, mention_commitment_salt,
                        repost_commitment_salt
                 FROM secure_content_moment_drafts
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![
                    candidate.draft_id,
                    to_i64(candidate.draft_revision, "draft revision")?
                ],
                |row| {
                    Ok(StoredMomentDraft {
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
                    })
                },
            )
            .map_err(|error| error.to_string())?;
        if stored.intent_sha256 != candidate.intent_sha256
            || stored.prepare_command_id != candidate.prepare_command_id
        {
            return Err("secure content Moment draft reservation conflict".to_string());
        }
        Ok(stored)
    }

    pub fn moment_command(
        &self,
        draft_id: &str,
        draft_revision: u64,
    ) -> Result<Option<StoredMomentCommand>, String> {
        self.connection()?
            .query_row(
                "SELECT draft_id, draft_revision, content_id, generation,
                        submit_command_id, plan_bytes, request_bytes, request_sha256,
                        root_key, state, session_generation, post_id
                 FROM secure_content_moment_commands
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "draft revision")?],
                moment_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn acquire_moment_command(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
    ) -> Result<StoredMomentCommand, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE secure_content_moment_commands
                 SET state = ?1, session_generation = ?2, updated_at_unix_ms = ?3
                 WHERE draft_id = ?4 AND draft_revision = ?5
                   AND state IN (?6, ?7)",
                params![
                    PublicationState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "draft revision")?,
                    PublicationState::PendingPublication as i64,
                    PublicationState::UnknownCommit as i64,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("secure content Moment command is not retryable".to_string());
        }
        let command = transaction
            .query_row(
                "SELECT draft_id, draft_revision, content_id, generation,
                        submit_command_id, plan_bytes, request_bytes, request_sha256,
                        root_key, state, session_generation, post_id
                 FROM secure_content_moment_commands
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "draft revision")?],
                moment_from_row,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(command)
    }

    pub fn reconcilable_moment_commands(&self) -> Result<Vec<StoredMomentCommand>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT draft_id, draft_revision, content_id, generation,
                        submit_command_id, plan_bytes, request_bytes, request_sha256,
                        root_key, state, session_generation, post_id
                 FROM secure_content_moment_commands
                 WHERE state IN (?1, ?2) ORDER BY updated_at_unix_ms, draft_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![
                    PublicationState::PendingPublication as i64,
                    PublicationState::UnknownCommit as i64
                ],
                moment_from_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn delete_moment_draft(&self, content_id: &str) -> Result<(), String> {
        if content_id.trim().is_empty() {
            return Err("secure content content ID is required".to_string());
        }
        self.connection()?
            .execute(
                "DELETE FROM secure_content_moment_drafts WHERE content_id = ?1",
                params![content_id],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn mark_moment_unknown(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
    ) -> Result<bool, String> {
        self.transition_moment(
            draft_id,
            draft_revision,
            session_generation,
            PublicationState::UnknownCommit,
            None,
        )
    }

    pub fn mark_moment_published(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        post_id: &str,
    ) -> Result<bool, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE secure_content_moment_commands
                 SET state = ?1, post_id = ?2, updated_at_unix_ms = ?3
                 WHERE draft_id = ?4 AND draft_revision = ?5
                   AND state = ?6 AND session_generation = ?7",
                params![
                    PublicationState::Published as i64,
                    post_id,
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "draft revision")?,
                    PublicationState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            transaction
                .execute(
                    "DELETE FROM secure_content_object_transfers
                     WHERE direction = ?1 AND owner_scope_id IN (
                       SELECT content_id FROM secure_content_moment_commands
                       WHERE draft_id = ?2 AND draft_revision = ?3
                     ) AND session_generation = ?4",
                    params![
                        ObjectTransferDirection::Upload as i32,
                        draft_id,
                        to_i64(draft_revision, "draft revision")?,
                        to_i64(session_generation, "session generation")?,
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM secure_content_moment_drafts
                     WHERE draft_id = ?1 AND draft_revision = ?2",
                    params![draft_id, to_i64(draft_revision, "draft revision")?],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(changed == 1)
    }

    pub fn mark_moment_terminal(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
    ) -> Result<bool, String> {
        self.transition_moment(
            draft_id,
            draft_revision,
            session_generation,
            PublicationState::Terminal,
            None,
        )
    }

    fn transition_moment(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        target: PublicationState,
        post_id: Option<&str>,
    ) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE secure_content_moment_commands
                 SET state = ?1, post_id = COALESCE(?2, post_id), updated_at_unix_ms = ?3
                 WHERE draft_id = ?4 AND draft_revision = ?5
                   AND state = ?6 AND session_generation = ?7",
                params![
                    target as i64,
                    post_id,
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "draft revision")?,
                    PublicationState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn reserve_comment_draft(
        &self,
        candidate: &StoredCommentDraft,
    ) -> Result<StoredCommentDraft, String> {
        if candidate.draft_id.trim().is_empty()
            || candidate.draft_revision == 0
            || candidate.post_id.trim().is_empty()
            || candidate.content_id.trim().is_empty()
            || candidate.text.trim().is_empty()
            || candidate.prepare_command_id.trim().is_empty()
        {
            return Err("secure content Comment draft is invalid".to_string());
        }
        {
            let connection = self.connection()?;
            connection
                .execute(
                    "INSERT INTO secure_content_comment_drafts(
                    draft_id, draft_revision, post_id, content_id,
                    reply_to_comment_id, plaintext_text, mention_intent_json,
                    mention_commitment_salt, intent_sha256, prepare_command_id,
                    state, session_generation, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(draft_id, draft_revision) DO NOTHING",
                    params![
                        candidate.draft_id,
                        to_i64(candidate.draft_revision, "Comment draft revision")?,
                        candidate.post_id,
                        candidate.content_id,
                        candidate.reply_to_comment_id,
                        candidate.text,
                        candidate.mention_intent_json,
                        candidate
                            .mention_commitment_salt
                            .as_ref()
                            .map(|salt| salt.as_slice()),
                        candidate.intent_sha256.as_slice(),
                        candidate.prepare_command_id,
                        candidate.state as i64,
                        to_i64(candidate.session_generation, "session generation")?,
                        now_unix_ms(),
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        let stored = self
            .comment_draft(&candidate.draft_id, candidate.draft_revision)?
            .ok_or_else(|| "secure content Comment draft was not persisted".to_string())?;
        if stored.post_id != candidate.post_id
            || stored.reply_to_comment_id != candidate.reply_to_comment_id
            || stored.text != candidate.text
            || stored.mention_intent_json != candidate.mention_intent_json
            || stored.intent_sha256 != candidate.intent_sha256
        {
            return Err("secure content Comment draft replay conflict".to_string());
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
                "SELECT draft_id, draft_revision, post_id, content_id, generation,
                        reply_to_comment_id, plaintext_text, mention_intent_json,
                        mention_commitment_salt, intent_sha256, prepare_command_id,
                        submit_command_id, plan_bytes, request_bytes, request_sha256,
                        root_key, publication_state, session_generation, comment_id,
                        state, error_code, retry_after_seconds, retry_not_before_unix_ms
                 FROM secure_content_comment_drafts
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "Comment draft revision")?],
                comment_draft_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn comment_drafts(&self) -> Result<Vec<StoredCommentDraft>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT draft_id, draft_revision, post_id, content_id, generation,
                        reply_to_comment_id, plaintext_text, mention_intent_json,
                        mention_commitment_salt, intent_sha256, prepare_command_id,
                        submit_command_id, plan_bytes, request_bytes, request_sha256,
                        root_key, publication_state, session_generation, comment_id,
                        state, error_code, retry_after_seconds, retry_not_before_unix_ms
                 FROM secure_content_comment_drafts
                 ORDER BY updated_at_unix_ms DESC, draft_id",
            )
            .map_err(|error| error.to_string())?;
        let drafts = statement
            .query_map([], comment_draft_from_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(drafts)
    }

    pub fn set_comment_draft_state(
        &self,
        draft_id: &str,
        draft_revision: u64,
        state: CommentState,
        error_code: Option<&str>,
        retry_after_seconds: Option<u64>,
    ) -> Result<bool, String> {
        let updated_at_unix_ms = now_unix_ms();
        let retry_not_before_unix_ms = retry_deadline(updated_at_unix_ms, retry_after_seconds)?;
        self.connection()?
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET state = ?1, error_code = ?2, retry_after_seconds = ?3,
                     retry_not_before_unix_ms = ?4, updated_at_unix_ms = ?5
                 WHERE draft_id = ?6 AND draft_revision = ?7",
                params![
                    state as i64,
                    error_code,
                    retry_after_seconds
                        .map(|value| to_i64(value, "Comment retry after"))
                        .transpose()?,
                    retry_not_before_unix_ms,
                    updated_at_unix_ms,
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn reset_comment_submission_for_reprepare(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        content_id: &str,
        prepare_command_id: &str,
    ) -> Result<bool, String> {
        if content_id.trim().is_empty() || prepare_command_id.trim().is_empty() {
            return Err("secure content Comment reprepare identity is invalid".to_string());
        }
        let now = now_unix_ms();
        self.connection()?
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET content_id = ?1, generation = 0, prepare_command_id = ?2,
                     submit_command_id = NULL, plan_bytes = NULL,
                     request_bytes = NULL, request_sha256 = NULL, root_key = NULL,
                     publication_state = NULL, session_generation = ?3,
                     comment_id = NULL, state = ?4, error_code = NULL,
                     retry_after_seconds = NULL, retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?5
                 WHERE draft_id = ?6 AND draft_revision = ?7
                   AND publication_state = ?8
                   AND state IN (?9, ?10, ?11)
                   AND plaintext_text != ''
                   AND (
                     retry_not_before_unix_ms IS NULL
                     OR retry_not_before_unix_ms <= ?5
                   )",
                params![
                    content_id,
                    prepare_command_id,
                    to_i64(session_generation, "session generation")?,
                    CommentState::Editing as i64,
                    now,
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                    PublicationState::PendingPublication as i64,
                    CommentState::Failed as i64,
                    CommentState::RateLimited as i64,
                    CommentState::Submitting as i64,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn persist_comment_submission(
        &self,
        draft_id: &str,
        draft_revision: u64,
        generation: u64,
        submit_command_id: &str,
        plan_bytes: &[u8],
        request_bytes: &[u8],
        request_sha256: &[u8; 32],
        root_key: &[u8; 32],
        session_generation: u64,
    ) -> Result<(), String> {
        if submit_command_id.trim().is_empty()
            || plan_bytes.is_empty()
            || request_bytes.is_empty()
            || Sha256::digest(request_bytes).as_slice() != request_sha256
        {
            return Err("secure content Comment submission is invalid".to_string());
        }
        let changed = {
            let connection = self.connection()?;
            connection
                .execute(
                    "UPDATE secure_content_comment_drafts
                 SET generation = ?1, submit_command_id = ?2, plan_bytes = ?3,
                     request_bytes = ?4, request_sha256 = ?5, root_key = ?6,
                     publication_state = ?7, session_generation = ?8,
                     state = ?9, error_code = NULL, retry_after_seconds = NULL,
                     retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?10
                 WHERE draft_id = ?11 AND draft_revision = ?12
                   AND request_bytes IS NULL",
                    params![
                        to_i64(generation, "content generation")?,
                        submit_command_id,
                        plan_bytes,
                        request_bytes,
                        request_sha256.as_slice(),
                        root_key.as_slice(),
                        PublicationState::PendingPublication as i64,
                        to_i64(session_generation, "session generation")?,
                        CommentState::Submitting as i64,
                        now_unix_ms(),
                        draft_id,
                        to_i64(draft_revision, "Comment draft revision")?,
                    ],
                )
                .map_err(|error| error.to_string())?
        };
        if changed == 0 {
            let stored = self
                .comment_draft(draft_id, draft_revision)?
                .ok_or_else(|| "secure content Comment draft is unavailable".to_string())?;
            if stored.request_sha256 != Some(*request_sha256) {
                return Err("secure content Comment submission replay conflict".to_string());
            }
        }
        Ok(())
    }

    pub fn acquire_comment_submission(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
    ) -> Result<StoredCommentDraft, String> {
        let acquired_at_unix_ms = now_unix_ms();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let changed = transaction
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET publication_state = ?1, session_generation = ?2,
                     state = ?3, error_code = NULL, retry_after_seconds = NULL,
                     retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?4
                 WHERE draft_id = ?5 AND draft_revision = ?6
                   AND publication_state IN (?7, ?8)
                   AND (
                     retry_not_before_unix_ms IS NULL
                     OR retry_not_before_unix_ms <= ?9
                   )",
                params![
                    PublicationState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                    CommentState::Submitting as i64,
                    acquired_at_unix_ms,
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                    PublicationState::PendingPublication as i64,
                    PublicationState::UnknownCommit as i64,
                    acquired_at_unix_ms,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("secure content Comment submission is not retryable".to_string());
        }
        let draft = transaction
            .query_row(
                "SELECT draft_id, draft_revision, post_id, content_id, generation,
                        reply_to_comment_id, plaintext_text, mention_intent_json,
                        mention_commitment_salt, intent_sha256, prepare_command_id,
                        submit_command_id, plan_bytes, request_bytes, request_sha256,
                        root_key, publication_state, session_generation, comment_id,
                        state, error_code, retry_after_seconds, retry_not_before_unix_ms
                 FROM secure_content_comment_drafts
                 WHERE draft_id = ?1 AND draft_revision = ?2",
                params![draft_id, to_i64(draft_revision, "Comment draft revision")?],
                comment_draft_from_row,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(draft)
    }

    pub fn mark_comment_retryable(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        publication_state: PublicationState,
        state: CommentState,
        error_code: &str,
        retry_after_seconds: Option<u64>,
    ) -> Result<bool, String> {
        if !matches!(
            publication_state,
            PublicationState::PendingPublication | PublicationState::UnknownCommit
        ) || !matches!(state, CommentState::Failed | CommentState::RateLimited)
        {
            return Err("secure content Comment retry state is invalid".to_string());
        }
        let updated_at_unix_ms = now_unix_ms();
        let retry_not_before_unix_ms = retry_deadline(updated_at_unix_ms, retry_after_seconds)?;
        self.connection()?
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET publication_state = ?1, state = ?2, error_code = ?3,
                     retry_after_seconds = ?4, retry_not_before_unix_ms = ?5,
                     updated_at_unix_ms = ?6
                 WHERE draft_id = ?7 AND draft_revision = ?8
                   AND publication_state = ?9 AND session_generation = ?10",
                params![
                    publication_state as i64,
                    state as i64,
                    error_code,
                    retry_after_seconds
                        .map(|value| to_i64(value, "Comment retry after"))
                        .transpose()?,
                    retry_not_before_unix_ms,
                    updated_at_unix_ms,
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                    PublicationState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn mark_comment_terminal(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        state: CommentState,
        error_code: &str,
    ) -> Result<bool, String> {
        self.connection()?
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET publication_state = ?1, state = ?2, error_code = ?3,
                     retry_after_seconds = NULL,
                     retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?4
                 WHERE draft_id = ?5 AND draft_revision = ?6
                   AND publication_state IN (?7, ?8)
                   AND session_generation = ?9",
                params![
                    PublicationState::Terminal as i64,
                    state as i64,
                    error_code,
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                    PublicationState::InFlight as i64,
                    PublicationState::CommittedPendingReadback as i64,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn mark_comment_committed_pending_readback(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        comment_id: &str,
    ) -> Result<bool, String> {
        if comment_id.trim().is_empty() {
            return Err("secure content committed Comment ID is invalid".to_string());
        }
        self.connection()?
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET publication_state = ?1, comment_id = ?2, plaintext_text = '',
                     mention_intent_json = '[]', mention_commitment_salt = NULL,
                     state = ?3, error_code = 'COMMENT_READBACK_PENDING',
                     retry_after_seconds = NULL,
                     retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?4
                 WHERE draft_id = ?5 AND draft_revision = ?6
                   AND publication_state = ?7 AND session_generation = ?8",
                params![
                    PublicationState::CommittedPendingReadback as i64,
                    comment_id,
                    CommentState::Failed as i64,
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                    PublicationState::InFlight as i64,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn mark_comment_readback_failed(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        error_code: &str,
        retry_after_seconds: Option<u64>,
    ) -> Result<bool, String> {
        let updated_at_unix_ms = now_unix_ms();
        let retry_not_before_unix_ms = retry_deadline(updated_at_unix_ms, retry_after_seconds)?;
        self.connection()?
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET state = ?1, error_code = ?2, retry_after_seconds = ?3,
                     retry_not_before_unix_ms = ?4, updated_at_unix_ms = ?5
                 WHERE draft_id = ?6 AND draft_revision = ?7
                   AND publication_state = ?8 AND session_generation = ?9",
                params![
                    CommentState::Failed as i64,
                    error_code,
                    retry_after_seconds
                        .map(|value| to_i64(value, "Comment retry after"))
                        .transpose()?,
                    retry_not_before_unix_ms,
                    updated_at_unix_ms,
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                    PublicationState::CommittedPendingReadback as i64,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    pub fn mark_comment_posted(
        &self,
        draft_id: &str,
        draft_revision: u64,
        session_generation: u64,
        comment_id: &str,
    ) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET publication_state = ?1, comment_id = ?2, plaintext_text = '',
                     mention_intent_json = '[]', mention_commitment_salt = NULL,
                     state = ?3, error_code = NULL, retry_after_seconds = NULL,
                     retry_not_before_unix_ms = NULL,
                     updated_at_unix_ms = ?4
                 WHERE draft_id = ?5 AND draft_revision = ?6
                   AND publication_state = ?7 AND session_generation = ?8",
                params![
                    PublicationState::Published as i64,
                    comment_id,
                    CommentState::Posted as i64,
                    now_unix_ms(),
                    draft_id,
                    to_i64(draft_revision, "Comment draft revision")?,
                    PublicationState::CommittedPendingReadback as i64,
                    to_i64(session_generation, "session generation")?,
                ],
            )
            .map(|changed| changed == 1)
            .map_err(|error| error.to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn commit_comment_root(
        &self,
        content_id: &str,
        generation: u64,
        post_id: &str,
        comment_id: &str,
        root_key: &[u8; 32],
        endpoint_prekey_id: Option<&str>,
        projection_bytes: &[u8],
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO secure_content_roots(
                    content_id, generation, post_id, root_key, committed_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(content_id, generation) DO UPDATE SET
                    post_id = excluded.post_id,
                    root_key = excluded.root_key",
                params![
                    content_id,
                    to_i64(generation, "content generation")?,
                    post_id,
                    root_key.as_slice(),
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO secure_content_comment_projections(
                    post_id, comment_id, content_id, generation,
                    projection_bytes, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(post_id, comment_id) DO UPDATE SET
                    content_id = excluded.content_id,
                    generation = excluded.generation,
                    projection_bytes = excluded.projection_bytes,
                    updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![
                    post_id,
                    comment_id,
                    content_id,
                    to_i64(generation, "content generation")?,
                    projection_bytes,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        if let Some(key_id) = endpoint_prekey_id {
            let changed = transaction
                .execute(
                    "UPDATE secure_content_prekeys
                     SET state = ?1, private_key = NULL, root_content_id = ?2,
                         root_generation = ?3
                     WHERE key_id = ?4 AND key_kind = 1 AND private_key IS NOT NULL
                       AND state = ?5",
                    params![
                        LocalPreKeyState::RootCommitted as i64,
                        content_id,
                        to_i64(generation, "content generation")?,
                        key_id,
                        LocalPreKeyState::Published as i64,
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err(
                    "secure content Comment root did not consume the exact endpoint PreKey"
                        .to_string(),
                );
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn comment_projection(
        &self,
        post_id: &str,
        comment_id: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT projection_bytes FROM secure_content_comment_projections
                 WHERE post_id = ?1 AND comment_id = ?2",
                params![post_id, comment_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn comment_projections(&self) -> Result<Vec<Vec<u8>>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT projection_bytes FROM secure_content_comment_projections
                 ORDER BY updated_at_unix_ms, post_id, comment_id",
            )
            .map_err(|error| error.to_string())?;
        let projections = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(projections)
    }

    pub fn clear_comment_projections(&self, post_id: &str) -> Result<(), String> {
        self.connection()?
            .execute(
                "DELETE FROM secure_content_comment_projections WHERE post_id = ?1",
                params![post_id],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn commit_content_root(
        &self,
        content_id: &str,
        generation: u64,
        post_id: &str,
        root_key: &[u8; 32],
        endpoint_prekey_id: Option<&str>,
        projection_bytes: &[u8],
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO secure_content_roots(
                    content_id, generation, post_id, root_key, committed_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(content_id, generation) DO UPDATE SET
                    post_id = excluded.post_id,
                    root_key = excluded.root_key",
                params![
                    content_id,
                    to_i64(generation, "content generation")?,
                    post_id,
                    root_key.as_slice(),
                    now_unix_ms()
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO secure_content_moment_projections(
                    post_id, content_id, generation, projection_bytes, updated_at_unix_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(post_id) DO UPDATE SET
                    content_id = excluded.content_id,
                    generation = excluded.generation,
                    projection_bytes = excluded.projection_bytes,
                    updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![
                    post_id,
                    content_id,
                    to_i64(generation, "content generation")?,
                    projection_bytes,
                    now_unix_ms()
                ],
            )
            .map_err(|error| error.to_string())?;
        if let Some(key_id) = endpoint_prekey_id {
            let changed = transaction
                .execute(
                    "UPDATE secure_content_prekeys
                     SET state = ?1, private_key = NULL, root_content_id = ?2,
                         root_generation = ?3
                     WHERE key_id = ?4 AND key_kind = 1 AND private_key IS NOT NULL
                       AND state = ?5",
                    params![
                        LocalPreKeyState::RootCommitted as i64,
                        content_id,
                        to_i64(generation, "content generation")?,
                        key_id,
                        LocalPreKeyState::Published as i64,
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err(
                    "secure content root commit did not consume the exact endpoint PreKey"
                        .to_string(),
                );
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn content_root(
        &self,
        content_id: &str,
        generation: u64,
    ) -> Result<Option<[u8; 32]>, String> {
        self.connection()?
            .query_row(
                "SELECT root_key FROM secure_content_roots
                 WHERE content_id = ?1 AND generation = ?2",
                params![content_id, to_i64(generation, "content generation")?],
                |row| fixed_32(row.get(0)?, "content root key"),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn save_projection(&self, post_id: &str, projection_bytes: &[u8]) -> Result<(), String> {
        self.connection()?
            .execute(
                "UPDATE secure_content_moment_projections
                 SET projection_bytes = ?1, updated_at_unix_ms = ?2 WHERE post_id = ?3",
                params![projection_bytes, now_unix_ms(), post_id],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn projection(&self, post_id: &str) -> Result<Option<Vec<u8>>, String> {
        self.connection()?
            .query_row(
                "SELECT projection_bytes FROM secure_content_moment_projections
                 WHERE post_id = ?1",
                params![post_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn projections(&self) -> Result<Vec<Vec<u8>>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT projection_bytes FROM secure_content_moment_projections
                 ORDER BY updated_at_unix_ms DESC, post_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn object_transfers_for_resource(
        &self,
        post_id: &str,
    ) -> Result<Vec<StoredObjectTransfer>, String> {
        if post_id.trim().is_empty() {
            return Err("secure content resource ID is required".to_string());
        }
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT transfer_id, owner_scope_id, operation_id, authority_id,
                        direction, state, upload_id, generation, descriptor_sha256,
                        completed_chunk_bitmap, source_local_ref, partial_local_ref,
                        object_key, base_nonce, plaintext_size, chunk_size,
                        attempt_count, next_attempt_at_unix_ms, last_error,
                        updated_at_unix_ms, media_type
                 FROM secure_content_object_transfers
                 WHERE authority_id = ?1 OR owner_scope_id = ?1
                    OR owner_scope_id IN (
                      SELECT content_id FROM secure_content_roots WHERE post_id = ?1
                      UNION
                      SELECT content_id FROM secure_content_moment_projections WHERE post_id = ?1
                    )
                 ORDER BY transfer_id",
            )
            .map_err(|error| error.to_string())?;
        let downloads = statement
            .query_map(params![post_id], |row| {
                Ok(StoredObjectTransfer {
                    record: object_transfer_from_row(row)?,
                    media_type: row
                        .get::<_, Option<String>>(20)?
                        .ok_or_else(|| conversion_error("download media type is unavailable"))?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(downloads)
    }

    pub fn purge_object_download(&self, transfer_id: &str) -> Result<(), String> {
        if transfer_id.trim().is_empty() {
            return Err("secure content transfer ID is required".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "DELETE FROM secure_content_object_transfers
                 WHERE transfer_id = ?1 AND direction = ?2
                   AND session_generation = ?3",
                params![
                    transfer_id,
                    secure_content_core::object::ObjectTransferDirection::Download as i32,
                    self.bound_session_generation()
                        .map_err(|error| error.to_string())?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            Ok(())
        } else {
            Err("secure content object transfer generation is stale".to_string())
        }
    }

    pub fn abandoned_upload_transfer_ids(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT transfer_id
                 FROM secure_content_object_transfers AS transfer
                 WHERE transfer.direction = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM secure_content_moment_commands AS command
                     WHERE command.content_id = transfer.owner_scope_id
                       AND command.state IN (?2, ?3, ?4, ?5)
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM secure_content_moment_drafts AS draft
                     WHERE draft.content_id = transfer.owner_scope_id
                   )
                 ORDER BY transfer.updated_at_unix_ms, transfer.transfer_id",
            )
            .map_err(|error| error.to_string())?;
        let transfer_ids = statement
            .query_map(
                params![
                    ObjectTransferDirection::Upload as i32,
                    PublicationState::PendingPublication as i64,
                    PublicationState::InFlight as i64,
                    PublicationState::UnknownCommit as i64,
                    PublicationState::Published as i64,
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(transfer_ids)
    }

    pub fn upload_transfer_ids_for_content(&self, content_id: &str) -> Result<Vec<String>, String> {
        if content_id.trim().is_empty() {
            return Err("secure content content ID is required".to_string());
        }
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT transfer_id FROM secure_content_object_transfers
                 WHERE direction = ?1 AND owner_scope_id = ?2
                 ORDER BY transfer_id",
            )
            .map_err(|error| error.to_string())?;
        let transfer_ids = statement
            .query_map(
                params![ObjectTransferDirection::Upload as i32, content_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(transfer_ids)
    }

    pub fn purge_upload_transfer(&self, transfer_id: &str) -> Result<(), String> {
        if transfer_id.trim().is_empty() {
            return Err("secure content transfer ID is required".to_string());
        }
        let changed = self
            .connection()?
            .execute(
                "DELETE FROM secure_content_object_transfers
                 WHERE transfer_id = ?1 AND direction = ?2
                   AND session_generation = ?3",
                params![
                    transfer_id,
                    ObjectTransferDirection::Upload as i32,
                    self.bound_session_generation()
                        .map_err(|error| error.to_string())?,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            Ok(())
        } else {
            Err("secure content object transfer generation is stale".to_string())
        }
    }

    pub fn purge_private_resource_material(&self, post_id: &str) -> Result<(), String> {
        if post_id.trim().is_empty() {
            return Err("secure content post ID is required".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM secure_content_object_transfers
                 WHERE authority_id = ?1 OR owner_scope_id = ?1
                    OR owner_scope_id IN (
                      SELECT content_id FROM secure_content_roots WHERE post_id = ?1
                      UNION
                      SELECT content_id FROM secure_content_moment_projections WHERE post_id = ?1
                    )",
                params![post_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM secure_content_moment_commands
                 WHERE post_id = ?1 OR content_id = ?1
                    OR content_id IN (
                      SELECT content_id FROM secure_content_roots WHERE post_id = ?1
                      UNION
                      SELECT content_id FROM secure_content_moment_projections WHERE post_id = ?1
                    )",
                params![post_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM secure_content_moment_projections WHERE post_id = ?1",
                params![post_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM secure_content_roots WHERE post_id = ?1",
                params![post_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM secure_content_pending_purges WHERE post_id = ?1",
                params![post_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn mark_private_resource_purge_pending(&self, post_id: &str) -> Result<(), String> {
        if post_id.trim().is_empty() {
            return Err("secure content post ID is required".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO secure_content_pending_purges(post_id, updated_at_unix_ms)
                 VALUES(?1, ?2)
                 ON CONFLICT(post_id) DO UPDATE SET updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![post_id, now_unix_ms()],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM secure_content_moment_projections WHERE post_id = ?1",
                params![post_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn pending_private_resource_purges(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT post_id FROM secure_content_pending_purges
                 ORDER BY updated_at_unix_ms, post_id",
            )
            .map_err(|error| error.to_string())?;
        let post_ids = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(post_ids)
    }

    pub fn ensure_object_upload_transfer(
        &self,
        record: &ObjectTransferRecord,
        media_type: &str,
    ) -> Result<ObjectTransferRecord, String> {
        secure_content_core::object::validate_object_transfer_record(record)?;
        if record.direction != secure_content_core::object::ObjectTransferDirection::Upload
            || media_type.trim().is_empty()
        {
            return Err("secure content upload journal input is invalid".to_string());
        }
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO secure_content_object_transfers(
                    transfer_id, owner_scope_id, operation_id, authority_id,
                    direction, state, upload_id, generation, descriptor_sha256,
                    completed_chunk_bitmap, source_local_ref, partial_local_ref,
                    object_key, base_nonce, plaintext_size, chunk_size, media_type,
                    attempt_count, next_attempt_at_unix_ms, last_error,
                    descriptor_bytes, updated_at_unix_ms, session_generation
                 ) VALUES(
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, NULL, ?21, ?22
                 )
                 ON CONFLICT(transfer_id) DO NOTHING",
                params![
                    record.transfer_id,
                    record.owner_scope_id,
                    record.operation_id,
                    record.authority_id,
                    record.direction as i32,
                    record.state as i32,
                    record.upload_id,
                    to_i64(record.generation, "upload generation")?,
                    record.descriptor_sha256,
                    record.completed_chunk_bitmap,
                    record.source_local_ref,
                    record.partial_local_ref,
                    record.object_key,
                    record.base_nonce,
                    to_i64(record.plaintext_size, "plaintext size")?,
                    record.chunk_size,
                    media_type,
                    record.attempt_count,
                    record.next_attempt_at_unix_ms,
                    record.last_error.map(|value| value as i32),
                    record.updated_at_unix_ms,
                    self.bound_session_generation()
                        .map_err(|error| error.to_string())?,
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
                 FROM secure_content_object_transfers
                 WHERE transfer_id = ?1",
                params![record.transfer_id],
                object_transfer_from_row,
            )
            .map_err(|error| error.to_string())?;
        let stored_media_type: String = connection
            .query_row(
                "SELECT media_type FROM secure_content_object_transfers
                 WHERE transfer_id = ?1",
                params![record.transfer_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if existing.owner_scope_id != record.owner_scope_id
            || existing.operation_id != record.operation_id
            || existing.authority_id != record.authority_id
            || existing.direction != record.direction
            || existing.source_local_ref != record.source_local_ref
            || existing.partial_local_ref != record.partial_local_ref
            || existing.plaintext_size != record.plaintext_size
            || existing.chunk_size != record.chunk_size
            || stored_media_type != media_type
        {
            return Err("secure content upload journal replay conflict".to_string());
        }
        Ok(existing)
    }

    pub fn ensure_object_download_transfer(
        &self,
        record: &ObjectTransferRecord,
        media_type: &str,
        cache_path: &Path,
    ) -> Result<(), String> {
        secure_content_core::object::validate_object_transfer_record(record)?;
        if record.direction != secure_content_core::object::ObjectTransferDirection::Download
            || record.source_local_ref != cache_path.display().to_string()
            || media_type.trim().is_empty()
        {
            return Err("secure content download journal input is invalid".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let bound_session_generation = self
            .bound_session_generation()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO secure_content_object_transfers(
                    transfer_id, owner_scope_id, operation_id, authority_id,
                    direction, state, upload_id, generation, descriptor_sha256,
                    completed_chunk_bitmap, source_local_ref, partial_local_ref,
                    object_key, base_nonce, plaintext_size, chunk_size, media_type,
                    attempt_count, next_attempt_at_unix_ms, last_error,
                    descriptor_bytes, updated_at_unix_ms, session_generation
                 ) VALUES(
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, NULL, ?21, ?22
                 ) ON CONFLICT(transfer_id) DO NOTHING",
                params![
                    record.transfer_id,
                    record.owner_scope_id,
                    record.operation_id,
                    record.authority_id,
                    record.direction as i32,
                    record.state as i32,
                    record.upload_id,
                    to_i64(record.generation, "download generation")?,
                    record.descriptor_sha256,
                    record.completed_chunk_bitmap,
                    record.source_local_ref,
                    record.partial_local_ref,
                    record.object_key,
                    record.base_nonce,
                    to_i64(record.plaintext_size, "plaintext size")?,
                    record.chunk_size,
                    media_type,
                    record.attempt_count,
                    record.next_attempt_at_unix_ms,
                    record.last_error.map(|value| value as i32),
                    record.updated_at_unix_ms,
                    bound_session_generation,
                ],
            )
            .map_err(|error| error.to_string())?;
        let existing = transaction
            .query_row(
                "SELECT transfer_id, owner_scope_id, operation_id, authority_id,
                        direction, state, upload_id, generation, descriptor_sha256,
                        completed_chunk_bitmap, source_local_ref, partial_local_ref,
                        object_key, base_nonce, plaintext_size, chunk_size,
                        attempt_count, next_attempt_at_unix_ms, last_error,
                        updated_at_unix_ms
                 FROM secure_content_object_transfers WHERE transfer_id = ?1",
                params![record.transfer_id],
                object_transfer_from_row,
            )
            .map_err(|error| error.to_string())?;
        let existing_media_type: Option<String> = transaction
            .query_row(
                "SELECT media_type FROM secure_content_object_transfers WHERE transfer_id = ?1",
                params![record.transfer_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if existing.owner_scope_id != record.owner_scope_id
            || existing.operation_id != record.operation_id
            || existing.authority_id != record.authority_id
            || existing.direction != record.direction
            || existing.generation != record.generation
            || existing.descriptor_sha256 != record.descriptor_sha256
            || existing.partial_local_ref != record.partial_local_ref
            || existing.object_key != record.object_key
            || existing.base_nonce != record.base_nonce
            || existing.plaintext_size != record.plaintext_size
            || existing.chunk_size != record.chunk_size
            || existing_media_type.as_deref() != Some(media_type)
        {
            return Err("secure content download journal replay conflict".to_string());
        }

        if existing.source_local_ref != record.source_local_ref {
            let changed = transaction
                .execute(
                    "UPDATE secure_content_object_transfers
                     SET source_local_ref = ?1, updated_at_unix_ms = ?2
                     WHERE transfer_id = ?3 AND session_generation = ?4
                       AND state NOT IN (?5, ?6)",
                    params![
                        record.source_local_ref,
                        now_unix_ms(),
                        record.transfer_id,
                        bound_session_generation,
                        ObjectTransferState::Cancelled as i32,
                        ObjectTransferState::Terminal as i32,
                    ],
                )
                .map_err(|error| error.to_string())?;
            if changed != 1 {
                return Err("secure content object transfer generation is stale".to_string());
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn persist_object_descriptor(
        &self,
        transfer_id: &str,
        descriptor_bytes: &[u8],
    ) -> Result<(), String> {
        let changed = self
            .connection()?
            .execute(
                "UPDATE secure_content_object_transfers
                 SET descriptor_bytes = ?1
                 WHERE transfer_id = ?2 AND session_generation = ?3
                   AND state NOT IN (?4, ?5, ?6)",
                params![
                    descriptor_bytes,
                    transfer_id,
                    self.bound_session_generation()
                        .map_err(|error| error.to_string())?,
                    ObjectTransferState::Cancelled as i32,
                    ObjectTransferState::Terminal as i32,
                    ObjectTransferState::Complete as i32,
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            Ok(())
        } else {
            Err("secure content object transfer generation is stale".to_string())
        }
    }

    pub fn object_descriptor_bytes(&self, transfer_id: &str) -> Result<Option<Vec<u8>>, String> {
        let value = self
            .connection()?
            .query_row(
                "SELECT descriptor_bytes FROM secure_content_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![
                    transfer_id,
                    self.bound_session_generation()
                        .map_err(|error| error.to_string())?,
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .flatten();
        Ok(value)
    }
}

impl ObjectTransferRepository for SecureContentStore {
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
                 FROM secure_content_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![transfer_id, self.bound_session_generation()?],
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
                "SELECT media_type FROM secure_content_object_transfers
                 WHERE transfer_id = ?1 AND session_generation = ?2",
                params![transfer_id, self.bound_session_generation()?],
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
                "SELECT descriptor_sha256 FROM secure_content_object_transfers
                 WHERE transfer_id = ?1",
                params![transfer_id],
                |row| row.get(0),
            )
            .map_err(|error| transfer_error(error.to_string()))?;
        if current != vec![0; 32] && current != descriptor_sha256 {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "secure content object descriptor changed",
            ));
        }
        connection
            .execute(
                "UPDATE secure_content_object_transfers
                 SET descriptor_sha256 = ?1, partial_local_ref = ?2,
                     updated_at_unix_ms = ?3
                 WHERE transfer_id = ?4 AND session_generation = ?5
                   AND state NOT IN (?6, ?7, ?8)",
                params![
                    descriptor_sha256,
                    partial_local_ref,
                    updated_at_unix_ms,
                    transfer_id,
                    self.bound_session_generation()?,
                    ObjectTransferState::Cancelled as i32,
                    ObjectTransferState::Terminal as i32,
                    ObjectTransferState::Complete as i32,
                ],
            )
            .map_err(|error| transfer_error(error.to_string()))
            .and_then(|changed| {
                if changed == 1 {
                    Ok(())
                } else {
                    Err(transfer_error(
                        "secure content object transfer generation is stale",
                    ))
                }
            })
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
        let restarts_completed_download = state == ObjectTransferState::Queued
            && completed_chunk_bitmap.iter().all(|byte| *byte == 0)
            && attempt_count == 0
            && next_attempt_at_unix_ms == updated_at_unix_ms
            && last_error.is_none();
        let changed = self
            .connection()
            .map_err(transfer_error)?
            .execute(
                "UPDATE secure_content_object_transfers SET
                    state = ?1, upload_id = ?2, generation = ?3,
                    completed_chunk_bitmap = ?4, attempt_count = ?5,
                    next_attempt_at_unix_ms = ?6, last_error = ?7,
                    updated_at_unix_ms = ?8
                 WHERE transfer_id = ?9 AND session_generation = ?10
                   AND (
                     (?1 = ?11 AND state NOT IN (?11, ?12))
                     OR (
                       ?1 != ?11
                       AND state NOT IN (?11, ?12, ?13)
                     )
                     OR (
                       ?14 = 1
                       AND direction = ?15
                       AND state = ?13
                     )
                   )",
                params![
                    state as i32,
                    upload_id,
                    to_i64(generation, "upload generation").map_err(transfer_error)?,
                    completed_chunk_bitmap,
                    attempt_count,
                    next_attempt_at_unix_ms,
                    last_error.map(|value| value as i32),
                    updated_at_unix_ms,
                    transfer_id,
                    self.bound_session_generation()?,
                    ObjectTransferState::Cancelled as i32,
                    ObjectTransferState::Terminal as i32,
                    ObjectTransferState::Complete as i32,
                    i32::from(restarts_completed_download),
                    ObjectTransferDirection::Download as i32,
                ],
            )
            .map_err(|error| transfer_error(error.to_string()))?;
        if changed == 1 {
            Ok(())
        } else {
            Err(transfer_error(
                "secure content object transfer generation is stale",
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

fn publication_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredPublication> {
    let request_sha256: Vec<u8> = row.get(4)?;
    Ok(StoredPublication {
        command_id: row.get(0)?,
        key_kind: row.get(1)?,
        pool_epoch: from_i64(row.get(2)?, "pool epoch")?,
        request_bytes: row.get(3)?,
        request_sha256: fixed_32(request_sha256, "publication request hash")?,
        state: PublicationState::try_from(row.get::<_, i64>(5)?).map_err(conversion_error)?,
        lease_generation: from_i64(row.get(6)?, "lease generation")?,
        session_generation: from_i64(row.get(7)?, "session generation")?,
    })
}

fn moment_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredMomentCommand> {
    Ok(StoredMomentCommand {
        draft_id: row.get(0)?,
        draft_revision: from_i64(row.get(1)?, "draft revision")?,
        content_id: row.get(2)?,
        generation: from_i64(row.get(3)?, "content generation")?,
        submit_command_id: row.get(4)?,
        plan_bytes: row.get(5)?,
        request_bytes: row.get(6)?,
        request_sha256: fixed_32(row.get(7)?, "Moment request hash")?,
        root_key: fixed_32(row.get(8)?, "content root key")?,
        state: PublicationState::try_from(row.get::<_, i64>(9)?).map_err(conversion_error)?,
        session_generation: from_i64(row.get(10)?, "session generation")?,
        post_id: row.get(11)?,
    })
}

fn comment_draft_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredCommentDraft> {
    let request_sha256 = row
        .get::<_, Option<Vec<u8>>>(14)?
        .map(|value| fixed_32(value, "Comment request hash"))
        .transpose()?;
    let root_key = row
        .get::<_, Option<Vec<u8>>>(15)?
        .map(|value| fixed_32(value, "Comment root key"))
        .transpose()?;
    let mention_commitment_salt = row
        .get::<_, Option<Vec<u8>>>(8)?
        .map(|value| fixed_32(value, "Comment mention commitment salt"))
        .transpose()?;
    let publication_state = row
        .get::<_, Option<i64>>(16)?
        .map(PublicationState::try_from)
        .transpose()
        .map_err(conversion_error)?;
    let retry_after_seconds = row
        .get::<_, Option<i64>>(21)?
        .map(|value| from_i64(value, "Comment retry after"))
        .transpose()?;
    let retry_not_before_unix_ms = row.get::<_, Option<i64>>(22)?;
    Ok(StoredCommentDraft {
        draft_id: row.get(0)?,
        draft_revision: from_i64(row.get(1)?, "Comment draft revision")?,
        post_id: row.get(2)?,
        content_id: row.get(3)?,
        generation: from_i64(row.get(4)?, "content generation")?,
        reply_to_comment_id: row.get(5)?,
        text: row.get(6)?,
        mention_intent_json: row.get(7)?,
        mention_commitment_salt,
        intent_sha256: fixed_32(row.get(9)?, "Comment intent hash")?,
        prepare_command_id: row.get(10)?,
        submit_command_id: row.get(11)?,
        plan_bytes: row.get(12)?,
        request_bytes: row.get(13)?,
        request_sha256,
        root_key,
        publication_state,
        session_generation: from_i64(row.get(17)?, "session generation")?,
        comment_id: row.get(18)?,
        state: CommentState::try_from(row.get::<_, i64>(19)?).map_err(conversion_error)?,
        error_code: row.get(20)?,
        retry_after_seconds,
        retry_not_before_unix_ms,
    })
}

fn object_transfer_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ObjectTransferRecord> {
    let direction = row.get::<_, i32>(4)?.try_into().map_err(conversion_error)?;
    let state = row.get::<_, i32>(5)?.try_into().map_err(conversion_error)?;
    let last_error = row
        .get::<_, Option<i32>>(18)?
        .map(|value| value.try_into().map_err(conversion_error))
        .transpose()?;
    Ok(ObjectTransferRecord {
        transfer_id: row.get(0)?,
        owner_scope_id: row.get(1)?,
        operation_id: row.get(2)?,
        authority_id: row.get(3)?,
        direction,
        state,
        upload_id: row.get(6)?,
        generation: from_i64(row.get(7)?, "upload generation")?,
        descriptor_sha256: row.get(8)?,
        completed_chunk_bitmap: row.get(9)?,
        source_local_ref: row.get(10)?,
        partial_local_ref: row.get(11)?,
        object_key: row.get(12)?,
        base_nonce: row.get(13)?,
        plaintext_size: from_i64(row.get(14)?, "plaintext size")?,
        chunk_size: row.get(15)?,
        attempt_count: row.get(16)?,
        next_attempt_at_unix_ms: row.get(17)?,
        last_error,
        updated_at_unix_ms: row.get(19)?,
    })
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS secure_content_runtime_state (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                session_generation INTEGER NOT NULL CHECK(session_generation >= 0)
             );
             INSERT OR IGNORE INTO secure_content_runtime_state (
                singleton, session_generation
             ) VALUES (1, 0);
             CREATE TABLE IF NOT EXISTS secure_content_prekey_commands (
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
             CREATE TABLE IF NOT EXISTS secure_content_prekeys (
                key_id TEXT PRIMARY KEY,
                key_kind INTEGER NOT NULL,
                pool_epoch INTEGER NOT NULL CHECK(pool_epoch > 0),
                private_key BLOB CHECK(private_key IS NULL OR length(private_key) = 32),
                public_key BLOB NOT NULL CHECK(length(public_key) = 32),
                command_id TEXT NOT NULL REFERENCES secure_content_prekey_commands(command_id),
                state INTEGER NOT NULL,
                root_content_id TEXT,
                root_generation INTEGER,
                created_at_unix_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_secure_content_prekeys_state
               ON secure_content_prekeys(key_kind, pool_epoch, state);
             CREATE TABLE IF NOT EXISTS secure_content_recovery_masters (
                actor_ptid TEXT NOT NULL,
                recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch > 0),
                master_key BLOB NOT NULL CHECK(length(master_key) = 32),
                created_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(actor_ptid, recovery_epoch)
             );
             CREATE TABLE IF NOT EXISTS secure_content_roots (
                content_id TEXT NOT NULL,
                generation INTEGER NOT NULL CHECK(generation > 0),
                post_id TEXT NOT NULL,
                root_key BLOB NOT NULL CHECK(length(root_key) = 32),
                committed_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(content_id, generation)
             );
             CREATE TABLE IF NOT EXISTS secure_content_moment_commands (
                draft_id TEXT NOT NULL,
                draft_revision INTEGER NOT NULL,
                content_id TEXT NOT NULL,
                generation INTEGER NOT NULL CHECK(generation > 0),
                submit_command_id TEXT NOT NULL UNIQUE,
                plan_bytes BLOB NOT NULL,
                request_bytes BLOB NOT NULL,
                request_sha256 BLOB NOT NULL CHECK(length(request_sha256) = 32),
                root_key BLOB NOT NULL CHECK(length(root_key) = 32),
                state INTEGER NOT NULL,
                session_generation INTEGER NOT NULL,
                post_id TEXT,
                updated_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(draft_id, draft_revision)
             );
             CREATE TABLE IF NOT EXISTS secure_content_moment_drafts (
                draft_id TEXT NOT NULL,
                draft_revision INTEGER NOT NULL,
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
                updated_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(draft_id, draft_revision)
             );
             CREATE TABLE IF NOT EXISTS secure_content_moment_projections (
                post_id TEXT PRIMARY KEY,
                content_id TEXT NOT NULL,
                generation INTEGER NOT NULL CHECK(generation > 0),
                projection_bytes BLOB NOT NULL,
                updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS secure_content_comment_drafts (
                draft_id TEXT NOT NULL,
                draft_revision INTEGER NOT NULL,
                post_id TEXT NOT NULL,
                content_id TEXT NOT NULL,
                reply_to_comment_id TEXT NOT NULL,
                plaintext_text TEXT NOT NULL,
                mention_intent_json TEXT NOT NULL DEFAULT '[]',
                mention_commitment_salt BLOB CHECK(
                    mention_commitment_salt IS NULL
                    OR length(mention_commitment_salt) = 32
                ),
                intent_sha256 BLOB NOT NULL CHECK(length(intent_sha256) = 32),
                prepare_command_id TEXT NOT NULL,
                submit_command_id TEXT UNIQUE,
                plan_bytes BLOB,
                request_bytes BLOB,
                request_sha256 BLOB CHECK(request_sha256 IS NULL OR length(request_sha256) = 32),
                root_key BLOB CHECK(root_key IS NULL OR length(root_key) = 32),
                publication_state INTEGER,
                generation INTEGER NOT NULL DEFAULT 0,
                session_generation INTEGER NOT NULL,
                comment_id TEXT,
                state INTEGER NOT NULL,
                error_code TEXT,
                retry_after_seconds INTEGER,
                retry_not_before_unix_ms INTEGER,
                updated_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(draft_id, draft_revision)
             );
             CREATE INDEX IF NOT EXISTS idx_secure_content_comment_drafts_post
               ON secure_content_comment_drafts(post_id, updated_at_unix_ms DESC);
             CREATE TABLE IF NOT EXISTS secure_content_comment_projections (
                post_id TEXT NOT NULL,
                comment_id TEXT NOT NULL,
                content_id TEXT NOT NULL,
                generation INTEGER NOT NULL CHECK(generation > 0),
                projection_bytes BLOB NOT NULL,
                updated_at_unix_ms INTEGER NOT NULL,
                PRIMARY KEY(post_id, comment_id)
             );
             CREATE TABLE IF NOT EXISTS secure_content_pending_purges (
                post_id TEXT PRIMARY KEY,
                updated_at_unix_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS secure_content_object_transfers (
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
                media_type TEXT,
                attempt_count INTEGER NOT NULL,
                next_attempt_at_unix_ms INTEGER NOT NULL,
                last_error INTEGER,
                descriptor_bytes BLOB,
                updated_at_unix_ms INTEGER NOT NULL,
                session_generation INTEGER NOT NULL DEFAULT 0
             );",
        )
        .map_err(|error| error.to_string())?;
    let has_session_generation = {
        let mut statement = connection
            .prepare("PRAGMA table_info(secure_content_object_transfers)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        columns.iter().any(|column| column == "session_generation")
    };
    if !has_session_generation {
        connection
            .execute(
                "ALTER TABLE secure_content_object_transfers
                 ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    let has_repost_commitment_salt = {
        let mut statement = connection
            .prepare("PRAGMA table_info(secure_content_moment_drafts)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        columns
            .iter()
            .any(|column| column == "repost_commitment_salt")
    };
    if !has_repost_commitment_salt {
        connection
            .execute(
                "ALTER TABLE secure_content_moment_drafts
                 ADD COLUMN repost_commitment_salt BLOB
                 CHECK(
                    repost_commitment_salt IS NULL
                    OR length(repost_commitment_salt) = 32
                 )",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    let has_mention_commitment_salt = {
        let mut statement = connection
            .prepare("PRAGMA table_info(secure_content_moment_drafts)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        columns
            .iter()
            .any(|column| column == "mention_commitment_salt")
    };
    if !has_mention_commitment_salt {
        connection
            .execute(
                "ALTER TABLE secure_content_moment_drafts
                 ADD COLUMN mention_commitment_salt BLOB
                 CHECK(
                    mention_commitment_salt IS NULL
                    OR length(mention_commitment_salt) = 32
                 )",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    let has_comment_retry_deadline = {
        let mut statement = connection
            .prepare("PRAGMA table_info(secure_content_comment_drafts)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        columns
            .iter()
            .any(|column| column == "retry_not_before_unix_ms")
    };
    if !has_comment_retry_deadline {
        connection
            .execute(
                "ALTER TABLE secure_content_comment_drafts
                 ADD COLUMN retry_not_before_unix_ms INTEGER",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    let comment_draft_columns = {
        let mut statement = connection
            .prepare("PRAGMA table_info(secure_content_comment_drafts)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        columns
    };
    if !comment_draft_columns
        .iter()
        .any(|column| column == "mention_intent_json")
    {
        connection
            .execute(
                "ALTER TABLE secure_content_comment_drafts
                 ADD COLUMN mention_intent_json TEXT NOT NULL DEFAULT '[]'",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    if !comment_draft_columns
        .iter()
        .any(|column| column == "mention_commitment_salt")
    {
        connection
            .execute(
                "ALTER TABLE secure_content_comment_drafts
                 ADD COLUMN mention_commitment_salt BLOB
                 CHECK(
                    mention_commitment_salt IS NULL
                    OR length(mention_commitment_salt) = 32
                 )",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn retry_deadline(
    now_unix_ms: i64,
    retry_after_seconds: Option<u64>,
) -> Result<Option<i64>, String> {
    retry_after_seconds
        .map(|seconds| {
            let millis = seconds
                .checked_mul(1_000)
                .ok_or_else(|| "secure content Comment retry deadline overflowed".to_string())?;
            now_unix_ms
                .checked_add(to_i64(millis, "Comment retry delay")?)
                .ok_or_else(|| "secure content Comment retry deadline overflowed".to_string())
        })
        .transpose()
}

fn to_i64(value: u64, field: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("secure content {field} exceeds storage range"))
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

fn transfer_error(error: impl Into<String>) -> ObjectTransferFailure {
    ObjectTransferFailure::retryable(ObjectTransferErrorCode::RetryLater, None, error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_generation_remains_monotonic_after_store_reopen() {
        let path = std::env::temp_dir().join(format!(
            "secure-content-session-generation-{}-{}.sqlite",
            std::process::id(),
            now_unix_ms()
        ));
        let first = SecureContentStore::from_connection(Connection::open(&path).unwrap()).unwrap();
        assert_eq!(first.claim_session_generation().unwrap(), 1);
        assert_eq!(first.claim_session_generation().unwrap(), 2);
        drop(first);

        let reopened =
            SecureContentStore::from_connection(Connection::open(&path).unwrap()).unwrap();
        assert_eq!(reopened.claim_session_generation().unwrap(), 3);
        drop(reopened);
        let _ = std::fs::remove_file(path);
    }

    fn publication() -> StoredPublication {
        let request_bytes = b"canonical-publication".to_vec();
        StoredPublication {
            command_id: "cpk-pub-v1-test".to_string(),
            key_kind: 1,
            pool_epoch: 7,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            state: PublicationState::PendingPublication,
            lease_generation: 0,
            session_generation: 0,
        }
    }

    fn download_transfer() -> ObjectTransferRecord {
        ObjectTransferRecord {
            transfer_id: "social-download-1".to_string(),
            owner_scope_id: "content-1".to_string(),
            operation_id: "object-1".to_string(),
            authority_id: "post-1".to_string(),
            direction: secure_content_core::object::ObjectTransferDirection::Download,
            state: ObjectTransferState::Queued,
            upload_id: String::new(),
            generation: 1,
            descriptor_sha256: vec![3; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: "/tmp/secure-content-object-1.jpg".to_string(),
            partial_local_ref: "/tmp/secure-content-object-1.partial".to_string(),
            object_key: vec![4; 32],
            base_nonce: vec![0; 12],
            plaintext_size: 128,
            chunk_size: 128,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error: None,
            updated_at_unix_ms: 1,
        }
    }

    fn upload_transfer() -> ObjectTransferRecord {
        let mut record = download_transfer();
        record.transfer_id = "social-upload-1".to_string();
        record.direction = secure_content_core::object::ObjectTransferDirection::Upload;
        record.generation = 0;
        record.source_local_ref = "/tmp/secure-content-source.jpg".to_string();
        record
    }

    fn moment_draft(content_id: &str, intent_byte: u8) -> StoredMomentDraft {
        StoredMomentDraft {
            draft_id: "draft-1".to_string(),
            draft_revision: 7,
            intent_sha256: [intent_byte; 32],
            content_id: content_id.to_string(),
            prepare_command_id: "moment-prepare-1".to_string(),
            mention_commitment_salt: None,
            repost_commitment_salt: None,
        }
    }

    fn moment_command(state: PublicationState) -> StoredMomentCommand {
        StoredMomentCommand {
            draft_id: "draft-1".to_string(),
            draft_revision: 1,
            content_id: "content-1".to_string(),
            generation: 1,
            submit_command_id: "submit-1".to_string(),
            plan_bytes: vec![1],
            request_bytes: vec![2],
            request_sha256: Sha256::digest([2]).into(),
            root_key: [4; 32],
            state,
            session_generation: 1,
            post_id: None,
        }
    }

    fn comment_draft() -> StoredCommentDraft {
        StoredCommentDraft {
            draft_id: "comment-draft-1".to_string(),
            draft_revision: 1,
            post_id: "post-1".to_string(),
            content_id: "comment-content-1".to_string(),
            generation: 0,
            reply_to_comment_id: String::new(),
            text: "retained private Comment".to_string(),
            mention_intent_json: "[]".to_string(),
            mention_commitment_salt: None,
            intent_sha256: [3; 32],
            prepare_command_id: "comment-prepare-1".to_string(),
            submit_command_id: None,
            plan_bytes: None,
            request_bytes: None,
            request_sha256: None,
            root_key: None,
            publication_state: None,
            session_generation: 7,
            comment_id: None,
            state: CommentState::Editing,
            error_code: None,
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        }
    }

    #[test]
    fn secure_content_store_recovers_unknown_publication_and_fences_completion() {
        let store = SecureContentStore::in_memory().unwrap();
        let command = publication();
        store
            .persist_prekey_publication(&command, &[("key-1".to_string(), Some([7; 32]), [8; 32])])
            .unwrap();
        let leased = store.acquire_publication(&command.command_id, 11).unwrap();
        assert!(!leased.reconciles_unknown_commit);
        assert_eq!(leased.command.state, PublicationState::InFlight);
        assert_eq!(leased.command.lease_generation, 1);

        assert_eq!(store.recover_orphaned_leases().unwrap(), 1);
        let replay = store.acquire_publication(&command.command_id, 12).unwrap();
        assert!(replay.reconciles_unknown_commit);
        assert_eq!(replay.command.lease_generation, 2);
        assert!(!store
            .mark_publication_published(&command.command_id, 1, 11)
            .unwrap());
        assert!(store
            .mark_publication_published(&command.command_id, 2, 12)
            .unwrap());
    }

    #[test]
    fn secure_content_teardown_checkpoints_only_the_retiring_session_generation() {
        let store = SecureContentStore::in_memory().unwrap();
        let first = publication();
        let mut second = publication();
        second.command_id = "cpk-pub-v1-next-session".to_string();
        second.request_bytes = b"next-session-publication".to_vec();
        second.request_sha256 = Sha256::digest(&second.request_bytes).into();
        store
            .persist_prekey_publication(&first, &[("key-old".to_string(), Some([7; 32]), [8; 32])])
            .unwrap();
        store
            .persist_prekey_publication(
                &second,
                &[("key-new".to_string(), Some([9; 32]), [10; 32])],
            )
            .unwrap();
        store.acquire_publication(&first.command_id, 11).unwrap();
        store.acquire_publication(&second.command_id, 12).unwrap();

        assert_eq!(store.checkpoint_session_generation(11).unwrap(), 1);

        let pending = store.publications_requiring_reconciliation().unwrap();
        assert_eq!(
            pending
                .iter()
                .find(|command| command.command_id == first.command_id)
                .map(|command| command.state),
            Some(PublicationState::UnknownCommit),
        );
        assert_eq!(
            pending
                .iter()
                .find(|command| command.command_id == second.command_id)
                .map(|command| command.state),
            Some(PublicationState::InFlight),
        );
        assert!(store.endpoint_prekey("key-old").unwrap().is_some());
        assert!(store.endpoint_prekey("key-new").unwrap().is_some());
    }

    #[test]
    fn secure_content_store_root_commit_deletes_only_the_matching_prekey() {
        let store = SecureContentStore::in_memory().unwrap();
        let command = publication();
        store
            .persist_prekey_publication(
                &command,
                &[
                    ("key-1".to_string(), Some([7; 32]), [8; 32]),
                    ("key-2".to_string(), Some([9; 32]), [10; 32]),
                ],
            )
            .unwrap();
        let leased = store.acquire_publication(&command.command_id, 1).unwrap();
        store
            .mark_publication_published(&command.command_id, leased.command.lease_generation, 1)
            .unwrap();
        store
            .commit_content_root("content-1", 1, "post-1", &[4; 32], Some("key-1"), b"{}")
            .unwrap();

        assert!(store.endpoint_prekey("key-1").unwrap().is_none());
        assert!(store.endpoint_prekey("key-2").unwrap().is_some());
        assert_eq!(store.content_root("content-1", 1).unwrap(), Some([4; 32]));
    }

    #[test]
    fn secure_content_store_recovery_masters_are_epoch_keyed() {
        let store = SecureContentStore::in_memory().unwrap();
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
        assert_eq!(store.recovery_master("ptid:alice", 5).unwrap(), None);
        assert_eq!(store.latest_recovery_epoch("ptid:alice").unwrap(), Some(4));
    }

    #[test]
    fn secure_content_download_journal_is_idempotent_and_conflict_closed() {
        let store = SecureContentStore::in_memory().unwrap();
        let cache = std::env::temp_dir().join("secure-content-object-1.jpg");
        let mut record = download_transfer();
        record.source_local_ref = cache.display().to_string();

        store
            .ensure_object_download_transfer(&record, "image/jpeg", &cache)
            .unwrap();
        store
            .ensure_object_download_transfer(&record, "image/jpeg", &cache)
            .unwrap();

        let persisted = store.object_transfer(&record.transfer_id).unwrap().unwrap();
        assert_eq!(persisted, record);

        let mut conflicting = record;
        conflicting.object_key = vec![9; 32];
        assert!(store
            .ensure_object_download_transfer(&conflicting, "image/jpeg", &cache)
            .is_err());
    }

    #[test]
    fn secure_content_upload_journal_resumes_with_original_crypto_material() {
        let store = SecureContentStore::in_memory().unwrap();
        let original = upload_transfer();
        let mut retry = original.clone();
        retry.object_key = vec![9; 32];
        retry.base_nonce = [vec![8; 8], vec![0; 4]].concat();

        let first = store
            .ensure_object_upload_transfer(&original, "image/jpeg")
            .unwrap();
        let replay = store
            .ensure_object_upload_transfer(&retry, "image/jpeg")
            .unwrap();

        assert_eq!(first, original);
        assert_eq!(replay.object_key, original.object_key);
        assert_eq!(replay.base_nonce, original.base_nonce);

        retry.source_local_ref = "/tmp/other-source.jpg".to_string();
        assert!(store
            .ensure_object_upload_transfer(&retry, "image/jpeg")
            .is_err());
    }

    #[test]
    fn secure_content_pending_moment_and_abandoned_upload_are_recoverable() {
        let store = SecureContentStore::in_memory().unwrap();
        let upload = upload_transfer();
        store
            .ensure_object_upload_transfer(&upload, "image/jpeg")
            .unwrap();
        assert_eq!(
            store.abandoned_upload_transfer_ids().unwrap(),
            vec![upload.transfer_id.clone()]
        );
        store
            .reserve_moment_draft(&moment_draft("content-1", 1))
            .unwrap();
        assert!(store.abandoned_upload_transfer_ids().unwrap().is_empty());

        let command = moment_command(PublicationState::PendingPublication);
        store.persist_moment_command(&command).unwrap();
        assert_eq!(
            store.reconcilable_moment_commands().unwrap(),
            vec![command.clone()]
        );
        assert!(store.abandoned_upload_transfer_ids().unwrap().is_empty());

        let acquired = store
            .acquire_moment_command(&command.draft_id, command.draft_revision, 2)
            .unwrap();
        assert!(store
            .acquire_moment_command(&command.draft_id, command.draft_revision, 2)
            .is_err());
        assert!(store
            .mark_moment_terminal(
                &acquired.draft_id,
                acquired.draft_revision,
                acquired.session_generation,
            )
            .unwrap());
        store.delete_moment_draft("content-1").unwrap();
        assert_eq!(
            store.abandoned_upload_transfer_ids().unwrap(),
            vec![upload.transfer_id]
        );
    }

    #[test]
    fn secure_content_publish_atomically_removes_upload_secrets() {
        let store = SecureContentStore::in_memory().unwrap();
        let upload = upload_transfer();
        store
            .ensure_object_upload_transfer(&upload, "image/jpeg")
            .unwrap();
        let command = moment_command(PublicationState::PendingPublication);
        store.persist_moment_command(&command).unwrap();
        let acquired = store
            .acquire_moment_command(&command.draft_id, command.draft_revision, 1)
            .unwrap();

        assert!(store
            .mark_moment_published(
                &acquired.draft_id,
                acquired.draft_revision,
                acquired.session_generation,
                "post-1",
            )
            .unwrap());
        assert!(store
            .object_transfer(&upload.transfer_id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn secure_content_transfer_callbacks_are_session_generation_fenced() {
        let path = std::env::temp_dir().join(format!(
            "secure-content-transfer-fence-{}.sqlite",
            ulid::Ulid::new()
        ));
        let old = SecureContentStore::from_connection(Connection::open(&path).unwrap()).unwrap();
        old.bind_session_generation(1).unwrap();
        let record = upload_transfer();
        old.ensure_object_upload_transfer(&record, "image/jpeg")
            .unwrap();

        let current =
            SecureContentStore::from_connection(Connection::open(&path).unwrap()).unwrap();
        current.bind_session_generation(2).unwrap();
        assert!(old
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Transferring,
                "old-upload",
                1,
                &[0],
                0,
                0,
                None,
                2,
            )
            .is_err());
        current
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Transferring,
                "current-upload",
                1,
                &[0],
                0,
                0,
                None,
                3,
            )
            .unwrap();
        current
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Terminal,
                "current-upload",
                1,
                &[0],
                0,
                0,
                Some(ObjectTransferErrorCode::IntegrityFailed),
                4,
            )
            .unwrap();
        assert!(current
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Transferring,
                "late-upload",
                1,
                &[1],
                0,
                0,
                None,
                5,
            )
            .is_err());
        drop(current);
        drop(old);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn completed_download_can_restart_after_plaintext_cache_eviction() {
        let store = SecureContentStore::in_memory().unwrap();
        let record = download_transfer();
        let cache = Path::new(&record.source_local_ref);
        store
            .ensure_object_download_transfer(&record, "image/jpeg", cache)
            .unwrap();
        store
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Complete,
                &record.upload_id,
                record.generation,
                &[1],
                0,
                0,
                None,
                2,
            )
            .unwrap();

        store
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Queued,
                &record.upload_id,
                record.generation,
                &[0],
                0,
                3,
                None,
                3,
            )
            .unwrap();

        let restarted = store.object_transfer(&record.transfer_id).unwrap().unwrap();
        assert_eq!(restarted.state, ObjectTransferState::Queued);
        assert_eq!(restarted.completed_chunk_bitmap, vec![0]);
        assert_eq!(restarted.next_attempt_at_unix_ms, 3);
    }

    #[test]
    fn completed_download_rebinds_cache_path_after_session_restart() {
        let path = std::env::temp_dir().join(format!(
            "secure-content-download-cache-rebind-{}.sqlite",
            ulid::Ulid::new()
        ));
        let store = SecureContentStore::from_connection(Connection::open(&path).unwrap()).unwrap();
        assert_eq!(store.claim_session_generation().unwrap(), 1);

        let mut record = download_transfer();
        let old_cache = std::env::temp_dir().join(format!(
            "secure-content-download-cache-old-{}.jpg",
            ulid::Ulid::new()
        ));
        record.source_local_ref = old_cache.display().to_string();
        store
            .ensure_object_download_transfer(&record, "image/jpeg", &old_cache)
            .unwrap();
        store
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Complete,
                &record.upload_id,
                record.generation,
                &[1],
                0,
                0,
                None,
                2,
            )
            .unwrap();

        assert_eq!(store.claim_session_generation().unwrap(), 2);
        let new_cache = std::env::temp_dir().join(format!(
            "secure-content-download-cache-new-{}.jpg",
            ulid::Ulid::new()
        ));
        let mut rebound = record.clone();
        rebound.source_local_ref = new_cache.display().to_string();
        store
            .ensure_object_download_transfer(&rebound, "image/jpeg", &new_cache)
            .unwrap();

        let persisted = store.object_transfer(&record.transfer_id).unwrap().unwrap();
        assert_eq!(persisted.state, ObjectTransferState::Complete);
        assert_eq!(persisted.source_local_ref, rebound.source_local_ref);
        assert_eq!(persisted.descriptor_sha256, record.descriptor_sha256);
        assert_eq!(persisted.object_key, record.object_key);
        assert_eq!(persisted.base_nonce, record.base_nonce);

        drop(store);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn terminal_downloads_reject_cache_path_rebinding_after_session_restart() {
        let store = SecureContentStore::in_memory().unwrap();
        let mut records = Vec::new();
        for (suffix, state) in [
            ("cancelled", ObjectTransferState::Cancelled),
            ("terminal", ObjectTransferState::Terminal),
        ] {
            let mut record = download_transfer();
            record.transfer_id = format!("social-download-{suffix}");
            record.source_local_ref = format!("/tmp/secure-content-{suffix}-old.jpg");
            store
                .ensure_object_download_transfer(
                    &record,
                    "image/jpeg",
                    Path::new(&record.source_local_ref),
                )
                .unwrap();
            store
                .update_transfer_progress(
                    &record.transfer_id,
                    state,
                    &record.upload_id,
                    record.generation,
                    &[0],
                    0,
                    0,
                    None,
                    2,
                )
                .unwrap();
            records.push(record);
        }

        store.claim_session_generation().unwrap();
        for record in records {
            let original_cache = record.source_local_ref.clone();
            let mut rebound = record.clone();
            rebound.source_local_ref = format!("{original_cache}.new");
            assert!(store
                .ensure_object_download_transfer(
                    &rebound,
                    "image/jpeg",
                    Path::new(&rebound.source_local_ref),
                )
                .is_err());
            assert_eq!(
                store
                    .object_transfer(&record.transfer_id)
                    .unwrap()
                    .unwrap()
                    .source_local_ref,
                original_cache
            );
        }
    }

    #[test]
    fn secure_content_download_completion_cas_rejects_stale_session_generation() {
        let path = std::env::temp_dir().join(format!(
            "secure-content-download-completion-fence-{}.sqlite",
            ulid::Ulid::new()
        ));
        let old = SecureContentStore::from_connection(Connection::open(&path).unwrap()).unwrap();
        old.bind_session_generation(1).unwrap();
        let record = download_transfer();
        old.ensure_object_download_transfer(
            &record,
            "image/jpeg",
            Path::new(&record.source_local_ref),
        )
        .unwrap();

        let current =
            SecureContentStore::from_connection(Connection::open(&path).unwrap()).unwrap();
        current.bind_session_generation(2).unwrap();
        let descriptor = ObjectDescriptor {
            object_id: record.operation_id.clone(),
            storage_ref: "opaque-storage-ref".to_string(),
            commitment: secure_content_core::object::ObjectUploadSpec {
                ciphertext_size: record.plaintext_size + 16,
                ciphertext_sha256: vec![7; 32],
                media_type: None,
                chunk_size: record.chunk_size,
                chunk_count: 1,
                encryption_suite:
                    secure_content_core::object::ObjectEncryptionSuite::Aes256GcmChunked,
                tag_size: 16,
                nonce_strategy: secure_content_core::object::ObjectNonceStrategy::Counter32Be,
                chunk_ciphertext_sha256: vec![vec![8; 32]],
            },
        };

        assert!(old
            .complete_download(&record, &descriptor, &record.source_local_ref, 2)
            .is_err());
        assert_eq!(
            current
                .object_transfer(&record.transfer_id)
                .unwrap()
                .unwrap()
                .state,
            ObjectTransferState::Queued
        );

        drop(current);
        drop(old);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn secure_content_download_journal_keeps_terminal_state_immutable() {
        let store = SecureContentStore::in_memory().unwrap();
        let cache = std::env::temp_dir().join("secure-content-object-reset.jpg");
        let mut record = download_transfer();
        record.source_local_ref = cache.display().to_string();
        let _ = std::fs::remove_file(&cache);
        store
            .ensure_object_download_transfer(&record, "image/jpeg", &cache)
            .unwrap();
        store
            .update_transfer_progress(
                &record.transfer_id,
                ObjectTransferState::Terminal,
                "",
                record.generation,
                &[1],
                1,
                0,
                Some(ObjectTransferErrorCode::IntegrityFailed),
                2,
            )
            .unwrap();

        store
            .ensure_object_download_transfer(&record, "image/jpeg", &cache)
            .unwrap();
        let terminal = store.object_transfer(&record.transfer_id).unwrap().unwrap();
        assert_eq!(terminal.state, ObjectTransferState::Terminal);
        assert_eq!(terminal.completed_chunk_bitmap, vec![1]);
        assert_eq!(terminal.attempt_count, 1);
        assert_eq!(
            terminal.last_error,
            Some(ObjectTransferErrorCode::IntegrityFailed)
        );
    }

    #[test]
    fn secure_content_private_resource_purge_removes_root_and_download_secrets() {
        let store = SecureContentStore::in_memory().unwrap();
        let record = download_transfer();
        let upload = upload_transfer();
        store
            .commit_content_root("content-1", 1, "post-1", &[4; 32], None, b"{}")
            .unwrap();
        store
            .ensure_object_download_transfer(
                &record,
                "image/jpeg",
                Path::new("/tmp/secure-content-object-1.jpg"),
            )
            .unwrap();
        store
            .ensure_object_upload_transfer(&upload, "image/jpeg")
            .unwrap();
        let command = moment_command(PublicationState::UnknownCommit);
        store.persist_moment_command(&command).unwrap();

        let downloads = store.object_transfers_for_resource("post-1").unwrap();
        assert_eq!(downloads.len(), 2);
        assert!(downloads.iter().any(|transfer| transfer.record == record));
        assert!(downloads.iter().any(|transfer| transfer.record == upload));

        store.mark_private_resource_purge_pending("post-1").unwrap();
        assert_eq!(
            store.pending_private_resource_purges().unwrap(),
            vec!["post-1".to_string()]
        );
        assert_eq!(store.projection("post-1").unwrap(), None);
        assert!(store.content_root("content-1", 1).unwrap().is_some());
        assert!(store.moment_command("draft-1", 1).unwrap().is_some());

        store.purge_private_resource_material("post-1").unwrap();

        assert_eq!(store.content_root("content-1", 1).unwrap(), None);
        assert!(store
            .object_transfer(&record.transfer_id)
            .unwrap()
            .is_none());
        assert!(store
            .object_transfer(&upload.transfer_id)
            .unwrap()
            .is_none());
        assert!(store.moment_command("draft-1", 1).unwrap().is_none());
        assert!(store.pending_private_resource_purges().unwrap().is_empty());
    }

    #[test]
    fn secure_content_single_download_purge_does_not_remove_content_root() {
        let store = SecureContentStore::in_memory().unwrap();
        let record = download_transfer();
        store
            .commit_content_root("content-1", 1, "post-1", &[4; 32], None, b"{}")
            .unwrap();
        store
            .ensure_object_download_transfer(
                &record,
                "image/jpeg",
                Path::new("/tmp/secure-content-object-1.jpg"),
            )
            .unwrap();

        store.purge_object_download(&record.transfer_id).unwrap();

        assert_eq!(store.content_root("content-1", 1).unwrap(), Some([4; 32]));
        assert!(store
            .object_transfer(&record.transfer_id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn secure_content_moment_draft_reservation_reuses_content_identity() {
        let store = SecureContentStore::in_memory().unwrap();
        let mut first_candidate = moment_draft("content-first", 3);
        first_candidate.mention_commitment_salt = Some([7; 32]);
        first_candidate.repost_commitment_salt = Some([9; 32]);
        let first = store.reserve_moment_draft(&first_candidate).unwrap();
        let mut replay_candidate = moment_draft("content-candidate-ignored", 3);
        replay_candidate.mention_commitment_salt = Some([6; 32]);
        replay_candidate.repost_commitment_salt = Some([8; 32]);
        let replay = store.reserve_moment_draft(&replay_candidate).unwrap();

        assert_eq!(first.content_id, "content-first");
        assert_eq!(first.mention_commitment_salt, Some([7; 32]));
        assert_eq!(first.repost_commitment_salt, Some([9; 32]));
        assert_eq!(replay, first);
        assert!(store
            .reserve_moment_draft(&moment_draft("content-other", 4))
            .is_err());
    }

    #[test]
    fn secure_content_comment_retry_preserves_plaintext_and_submission_identity() {
        let store = SecureContentStore::in_memory().unwrap();
        let mut candidate = comment_draft();
        candidate.mention_intent_json =
            r#"[{"actor_ptid":"ptid:bob","offset":9,"length":3,"display":"Bob"}]"#.to_string();
        candidate.mention_commitment_salt = Some([6; 32]);
        let draft = store.reserve_comment_draft(&candidate).unwrap();
        let mut replay_candidate = candidate.clone();
        replay_candidate.content_id = "ignored-new-content-id".to_string();
        replay_candidate.mention_commitment_salt = Some([7; 32]);
        assert_eq!(
            store.reserve_comment_draft(&replay_candidate).unwrap(),
            draft,
        );
        assert_eq!(draft.state, CommentState::Editing);
        assert_eq!(draft.mention_commitment_salt, Some([6; 32]));
        assert!(store
            .set_comment_draft_state(
                &draft.draft_id,
                draft.draft_revision,
                CommentState::Encrypting,
                None,
                None,
            )
            .unwrap());

        let request = b"encrypted-comment-request";
        let request_sha256: [u8; 32] = Sha256::digest(request).into();
        store
            .persist_comment_submission(
                &draft.draft_id,
                draft.draft_revision,
                4,
                "comment-submit-1",
                b"comment-plan",
                request,
                &request_sha256,
                &[9; 32],
                7,
            )
            .unwrap();
        let acquired = store
            .acquire_comment_submission(&draft.draft_id, draft.draft_revision, 7)
            .unwrap();
        assert_eq!(acquired.state, CommentState::Submitting);
        assert_eq!(
            acquired.submit_command_id.as_deref(),
            Some("comment-submit-1")
        );

        assert!(store
            .mark_comment_retryable(
                &draft.draft_id,
                draft.draft_revision,
                7,
                PublicationState::PendingPublication,
                CommentState::RateLimited,
                "COMMENT_RATE_LIMITED",
                Some(17),
            )
            .unwrap());
        let retained = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(retained.text, "retained private Comment");
        assert_eq!(retained.mention_intent_json, candidate.mention_intent_json);
        assert_eq!(retained.mention_commitment_salt, Some([6; 32]));
        assert_eq!(retained.state, CommentState::RateLimited);
        assert_eq!(retained.retry_after_seconds, Some(17));
        assert!(retained
            .retry_not_before_unix_ms
            .is_some_and(|deadline| deadline > now_unix_ms()));
        assert_eq!(retained.request_sha256, Some(request_sha256));

        assert!(store
            .acquire_comment_submission(&draft.draft_id, draft.draft_revision, 7)
            .is_err());
        store
            .connection()
            .unwrap()
            .execute(
                "UPDATE secure_content_comment_drafts
                 SET retry_not_before_unix_ms = ?1
                 WHERE draft_id = ?2 AND draft_revision = ?3",
                params![
                    now_unix_ms() - 1,
                    draft.draft_id,
                    to_i64(draft.draft_revision, "Comment draft revision").unwrap(),
                ],
            )
            .unwrap();
        assert!(store
            .reset_comment_submission_for_reprepare(
                &draft.draft_id,
                draft.draft_revision,
                7,
                "comment-content-retry",
                "comment-prepare-retry",
            )
            .unwrap());
        let reset = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(reset.text, "retained private Comment");
        assert_eq!(reset.mention_intent_json, candidate.mention_intent_json);
        assert_eq!(reset.mention_commitment_salt, Some([6; 32]));
        assert_eq!(reset.content_id, "comment-content-retry");
        assert_eq!(reset.prepare_command_id, "comment-prepare-retry");
        assert_eq!(reset.state, CommentState::Editing);
        assert!(reset.plan_bytes.is_none());
        assert!(reset.request_bytes.is_none());
        assert!(reset.root_key.is_none());
        let replacement = b"replacement-encrypted-comment-request";
        let replacement_sha256: [u8; 32] = Sha256::digest(replacement).into();
        store
            .persist_comment_submission(
                &draft.draft_id,
                draft.draft_revision,
                5,
                "comment-submit-2",
                b"replacement-comment-plan",
                replacement,
                &replacement_sha256,
                &[8; 32],
                7,
            )
            .unwrap();
        let retried = store
            .acquire_comment_submission(&draft.draft_id, draft.draft_revision, 7)
            .unwrap();
        assert_eq!(
            retried.submit_command_id.as_deref(),
            Some("comment-submit-2")
        );
        assert!(!store
            .mark_comment_committed_pending_readback(
                &draft.draft_id,
                draft.draft_revision,
                8,
                "comment-1",
            )
            .unwrap());
        assert!(store
            .mark_comment_committed_pending_readback(
                &draft.draft_id,
                draft.draft_revision,
                7,
                "comment-1",
            )
            .unwrap());
        let committed = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(
            committed.publication_state,
            Some(PublicationState::CommittedPendingReadback)
        );
        assert!(committed.text.is_empty());
        assert!(store
            .acquire_comment_submission(&draft.draft_id, draft.draft_revision, 7)
            .is_err());
        assert!(store
            .mark_comment_readback_failed(
                &draft.draft_id,
                draft.draft_revision,
                7,
                "COMMENT_READBACK_FAILED",
                Some(2),
            )
            .unwrap());
        let pending_readback = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(
            pending_readback.publication_state,
            Some(PublicationState::CommittedPendingReadback)
        );
        assert_eq!(
            pending_readback.error_code.as_deref(),
            Some("COMMENT_READBACK_FAILED")
        );
        assert!(store
            .mark_comment_posted(&draft.draft_id, draft.draft_revision, 7, "comment-1",)
            .unwrap());
        let posted = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(posted.state, CommentState::Posted);
        assert!(posted.text.is_empty());
        assert_eq!(posted.mention_intent_json, "[]");
        assert!(posted.mention_commitment_salt.is_none());
        assert_eq!(posted.comment_id.as_deref(), Some("comment-1"));
    }

    #[test]
    fn secure_content_comment_reprepare_accepts_unsent_submitting_draft() {
        let store = SecureContentStore::in_memory().unwrap();
        let draft = comment_draft();
        store.reserve_comment_draft(&draft).unwrap();
        let request = b"encrypted-comment-request";
        let request_sha256: [u8; 32] = Sha256::digest(request).into();
        store
            .persist_comment_submission(
                &draft.draft_id,
                draft.draft_revision,
                4,
                "comment-submit-1",
                b"expired-comment-plan",
                request,
                &request_sha256,
                &[9; 32],
                draft.session_generation,
            )
            .unwrap();

        assert!(store
            .reset_comment_submission_for_reprepare(
                &draft.draft_id,
                draft.draft_revision,
                draft.session_generation,
                "comment-content-retry",
                "comment-prepare-retry",
            )
            .unwrap());
        let reset = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(reset.state, CommentState::Editing);
        assert_eq!(reset.text, draft.text);
        assert_eq!(reset.content_id, "comment-content-retry");
        assert!(reset.request_bytes.is_none());
        assert!(reset.root_key.is_none());
    }

    #[test]
    fn secure_content_comment_root_and_projection_commit_atomically() {
        let store = SecureContentStore::in_memory().unwrap();
        store
            .commit_comment_root(
                "comment-content-1",
                3,
                "post-1",
                "comment-1",
                &[7; 32],
                None,
                b"{\"verified\":true}",
            )
            .unwrap();

        assert_eq!(
            store.content_root("comment-content-1", 3).unwrap(),
            Some([7; 32]),
        );
        assert_eq!(
            store.comment_projection("post-1", "comment-1").unwrap(),
            Some(b"{\"verified\":true}".to_vec()),
        );
        store.clear_comment_projections("post-1").unwrap();
        assert_eq!(
            store.comment_projection("post-1", "comment-1").unwrap(),
            None,
        );
    }
}
