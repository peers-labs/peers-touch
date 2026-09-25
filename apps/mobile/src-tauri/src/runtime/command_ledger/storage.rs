use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::Duration;

use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use prost::Message;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

use super::entry::{
    allows_transition, decode_persisted, encode_envelope, millis_to_timestamp, state_of,
    timestamp_to_millis, CommandScope, ScopeKeyMetadata, TrustedCommandKey, ValidatedCommand,
    MAX_ACTIVE_ORDERING_KEYS, MAX_PARTITION_BYTES, MAX_TRANSPORT_ATTEMPTS, MAX_UNRESOLVED_COMMANDS,
    SCHEMA_REVISION,
};
use super::error::{LedgerCapacityExhaustionCause, LedgerError, LedgerErrorCode, LedgerResult};
use super::fairness::DispatchCandidate;
use super::migration;
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    mobile_durable_command_envelope_v2, MobileDurableCommandErrorCode, MobileDurableCommandState,
};
use crate::runtime::reliability_proto::peers_touch::model::social::v1::{
    LookupFriendRequestCommandResultResponse, LookupSocialRelationshipCommandResultResponse,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionOutcome {
    Inserted,
    AlreadyPresent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct LedgerCapacityUsage {
    pub record_count: u64,
    pub byte_usage: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FenceOutcome {
    Dispatch(ValidatedCommand),
    NotDispatchable(ValidatedCommand),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectionCheckpoint {
    pub command_id: String,
    pub payload_sha256: Vec<u8>,
    pub authoritative_lookup: LookupFriendRequestCommandResultResponse,
    pub social_relationship_lookup: Option<LookupSocialRelationshipCommandResultResponse>,
    pub exact_lookup_bytes: Vec<u8>,
    pub created_at_ms: i64,
}

pub struct LedgerStorage {
    connection: Connection,
    cipher: Aes256Gcm,
    scope: CommandScope,
}

impl LedgerStorage {
    pub fn open(
        database_path: &Path,
        scope: CommandScope,
        trusted_key: TrustedCommandKey,
        now_ms: i64,
    ) -> LedgerResult<Self> {
        scope_key_parent(database_path)?;
        let existed = database_path.exists();
        let mut connection = Connection::open(database_path)
            .map_err(|error| LedgerError::storage("open command ledger database", error))?;
        apply_sqlcipher_key(&connection, trusted_key.bytes())?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| LedgerError::storage("configure command ledger timeout", error))?;
        let cipher = Aes256Gcm::new_from_slice(trusted_key.bytes()).map_err(|_| {
            LedgerError::new(
                LedgerErrorCode::InvalidConfiguration,
                "initialize command ledger cipher",
                "trusted command key has an invalid length",
            )
        })?;

        let has_metadata = match migration::has_scope_metadata(&connection) {
            Ok(value) => value,
            Err(error) if existed => {
                return Err(LedgerError::new(
                    LedgerErrorCode::AuthenticationFailed,
                    "authenticate command ledger database",
                    error.to_string(),
                ));
            }
            Err(error) => return Err(error),
        };
        if has_metadata {
            verify_metadata(&connection, &cipher, &scope, &trusted_key.metadata)?;
        } else {
            if migration::has_user_tables(&connection)? {
                return Err(LedgerError::new(
                    LedgerErrorCode::SchemaMismatch,
                    "open command ledger database",
                    "existing database is not an authenticated v2 partition",
                ));
            }
            initialize_schema_and_metadata(
                &mut connection,
                &cipher,
                &scope,
                &trusted_key.metadata,
            )?;
        }
        verify_schema_revision(&connection)?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(|error| LedgerError::storage("configure command ledger database", error))?;

        let mut storage = Self {
            connection,
            cipher,
            scope,
        };
        storage.recover_from_crash(now_ms)?;
        Ok(storage)
    }

    pub fn admit(&mut self, command: &ValidatedCommand) -> LedgerResult<AdmissionOutcome> {
        let cipher = &self.cipher;
        let scope = &self.scope;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| LedgerError::storage("begin command admission", error))?;

        if let Some(existing) = load_raw_command(&transaction, command.command_id())? {
            let existing = decrypt_command(cipher, scope, existing)?;
            if existing.envelope.payload_sha256 == command.envelope.payload_sha256
                && existing.payload_bytes == command.payload_bytes
            {
                transaction
                    .commit()
                    .map_err(|error| LedgerError::storage("finish idempotent admission", error))?;
                return Ok(AdmissionOutcome::AlreadyPresent);
            }
            return Err(LedgerError::for_command(
                LedgerErrorCode::CommandConflict,
                "admit generated command",
                command.command_id(),
                "command ID is already bound to different generated bytes",
            ));
        }

        let usage = read_capacity_usage(&transaction)?;
        let mut exhaustion_causes = Vec::new();
        if usage.record_count >= MAX_UNRESOLVED_COMMANDS {
            exhaustion_causes.push(LedgerCapacityExhaustionCause::RecordCount);
        }
        if usage
            .byte_usage
            .saturating_add(command.payload_size() as u64)
            > MAX_PARTITION_BYTES
        {
            exhaustion_causes.push(LedgerCapacityExhaustionCause::ByteCapacity);
        }
        if !exhaustion_causes.is_empty() {
            let detail = match exhaustion_causes.as_slice() {
                [LedgerCapacityExhaustionCause::RecordCount] => {
                    "exact Station/PTID record-count capacity is exhausted"
                }
                [LedgerCapacityExhaustionCause::ByteCapacity] => {
                    "exact Station/PTID byte capacity is exhausted"
                }
                _ => "exact Station/PTID record-count and byte capacity are exhausted",
            };
            return Err(LedgerError::capacity_exceeded(
                "admit generated command",
                command.command_id(),
                exhaustion_causes,
                detail,
            ));
        }

        let sealed = seal_command(cipher, scope, command)?;
        transaction
            .execute(
                "INSERT INTO command_entries (
                    command_id, ordering_key, state, attempt_count, payload_sha256,
                    payload_size, created_at_ms, updated_at_ms, expires_at_ms,
                    dispatch_started_at_ms, next_attempt_at_ms, envelope_nonce,
                    envelope_ciphertext
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
                 )",
                command_params(&sealed),
            )
            .map_err(|error| LedgerError::storage("insert generated command", error))?;
        transaction
            .commit()
            .map_err(|error| LedgerError::storage("commit command admission", error))?;
        Ok(AdmissionOutcome::Inserted)
    }

    pub fn get(&self, command_id: &str) -> LedgerResult<Option<ValidatedCommand>> {
        load_raw_command(&self.connection, command_id)?
            .map(|raw| decrypt_command(&self.cipher, &self.scope, raw))
            .transpose()
    }

    pub fn list(&self) -> LedgerResult<Vec<ValidatedCommand>> {
        let rows = load_all_raw_commands(&self.connection)?;
        rows.into_iter()
            .map(|raw| decrypt_command(&self.cipher, &self.scope, raw))
            .collect()
    }

    pub(super) fn capacity_usage(&self) -> LedgerResult<LedgerCapacityUsage> {
        read_capacity_usage(&self.connection)
    }

    pub fn dispatch_candidates(&self, now_ms: i64) -> LedgerResult<Vec<DispatchCandidate>> {
        if active_ordering_key_count(&self.connection)? >= MAX_ACTIVE_ORDERING_KEYS {
            return Ok(Vec::new());
        }
        let mut statement = self
            .connection
            .prepare(
                "SELECT command_id, ordering_key, state, created_at_ms, next_attempt_at_ms
                 FROM command_entries
                 ORDER BY ordering_key, created_at_ms, command_id",
            )
            .map_err(|error| LedgerError::storage("prepare dispatch candidates", error))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .map_err(|error| LedgerError::storage("query dispatch candidates", error))?;

        let mut seen_keys = HashSet::new();
        let mut candidates = Vec::new();
        for row in rows {
            let (command_id, ordering_key, state, created_at_ms, next_attempt_at_ms) =
                row.map_err(|error| LedgerError::storage("read dispatch candidate", error))?;
            if !seen_keys.insert(ordering_key.clone()) {
                continue;
            }
            let state = decode_state(state, &command_id)?;
            let eligible = state == MobileDurableCommandState::Queued
                || (state == MobileDurableCommandState::RetryWait
                    && next_attempt_at_ms
                        .map(|next_attempt| next_attempt <= now_ms)
                        .unwrap_or(false));
            if eligible {
                candidates.push(DispatchCandidate {
                    command_id,
                    ordering_key,
                    created_at_ms,
                    expected_state: state,
                });
            }
        }
        Ok(candidates)
    }

    pub fn fence_dispatch(
        &mut self,
        command_id: &str,
        expected_state: MobileDurableCommandState,
        now_ms: i64,
    ) -> LedgerResult<FenceOutcome> {
        if !matches!(
            expected_state,
            MobileDurableCommandState::Queued | MobileDurableCommandState::RetryWait
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "fence command dispatch",
                command_id,
                "dispatch fence requires queued or retry_wait expected state",
            ));
        }
        let cipher = &self.cipher;
        let scope = &self.scope;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| LedgerError::storage("begin dispatch fence", error))?;
        let raw = load_raw_command(&transaction, command_id)?.ok_or_else(|| {
            LedgerError::for_command(
                LedgerErrorCode::CommandNotFound,
                "fence command dispatch",
                command_id,
                "command does not exist",
            )
        })?;
        let current_state = decode_state(raw.state, command_id)?;
        if current_state != expected_state {
            return Err(state_conflict(
                "fence command dispatch",
                command_id,
                expected_state,
                current_state,
            ));
        }
        if active_ordering_key_count(&transaction)? >= MAX_ACTIVE_ORDERING_KEYS {
            return Err(LedgerError::for_command(
                LedgerErrorCode::InflightLimit,
                "fence command dispatch",
                command_id,
                "four ordering keys are already active",
            ));
        }
        let earlier: u64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM command_entries
                 WHERE ordering_key = ?1
                   AND (created_at_ms < ?2 OR (created_at_ms = ?2 AND command_id < ?3))",
                params![raw.ordering_key, raw.created_at_ms, raw.command_id],
                |row| row.get(0),
            )
            .map_err(|error| LedgerError::storage("verify per-key ordering", error))?;
        if earlier > 0 {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "fence command dispatch",
                command_id,
                "an earlier command still owns the ordering key",
            ));
        }
        let active_same_key: u64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM command_entries
                 WHERE ordering_key = ?1 AND state IN (?2, ?3, ?4)",
                params![
                    raw.ordering_key,
                    MobileDurableCommandState::DispatchFenced as i32,
                    MobileDurableCommandState::Submitting as i32,
                    MobileDurableCommandState::Reconciling as i32,
                ],
                |row| row.get(0),
            )
            .map_err(|error| LedgerError::storage("verify ordering-key fence", error))?;
        if active_same_key > 0 {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "fence command dispatch",
                command_id,
                "ordering key already has an active command",
            ));
        }
        if expected_state == MobileDurableCommandState::RetryWait
            && raw
                .next_attempt_at_ms
                .map(|next_attempt| next_attempt > now_ms)
                .unwrap_or(true)
        {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "fence command dispatch",
                command_id,
                "retry_wait command is not due",
            ));
        }

        let command = decrypt_command(cipher, scope, raw.clone())?;
        let expires_at_ms = timestamp_to_millis(
            command.envelope.expires_at.as_ref(),
            "expires_at",
            command_id,
        )?;
        if command.envelope.attempt_count >= MAX_TRANSPORT_ATTEMPTS || now_ms >= expires_at_ms {
            let error = if now_ms >= expires_at_ms {
                MobileDurableCommandErrorCode::DomainExpired
            } else {
                MobileDurableCommandErrorCode::AttemptExhausted
            };
            let terminal_state = if expected_state == MobileDurableCommandState::Queued {
                MobileDurableCommandState::FailedTerminal
            } else {
                MobileDurableCommandState::Unresolved
            };
            let command = transition_in_transaction(
                &transaction,
                cipher,
                scope,
                raw,
                &[expected_state],
                terminal_state,
                error,
                now_ms,
                None,
            )?;
            transaction
                .commit()
                .map_err(|error| LedgerError::storage("commit exhausted dispatch", error))?;
            return Ok(FenceOutcome::NotDispatchable(command));
        }

        let fenced = transition_in_transaction(
            &transaction,
            cipher,
            scope,
            raw,
            &[expected_state],
            MobileDurableCommandState::DispatchFenced,
            MobileDurableCommandErrorCode::Unspecified,
            now_ms,
            None,
        )?;
        let mut fenced = fenced;
        fenced.envelope.attempt_count = fenced.envelope.attempt_count.saturating_add(1);
        fenced.envelope.dispatch_started_at = Some(millis_to_timestamp(now_ms));
        fenced.envelope.next_attempt_at = None;
        write_command_cas(
            &transaction,
            cipher,
            scope,
            &fenced,
            MobileDurableCommandState::DispatchFenced,
            fenced.envelope.attempt_count.saturating_sub(1),
        )?;
        transaction
            .commit()
            .map_err(|error| LedgerError::storage("commit dispatch fence", error))?;
        Ok(FenceOutcome::Dispatch(fenced))
    }

    pub fn transition(
        &mut self,
        command_id: &str,
        expected_states: &[MobileDurableCommandState],
        next_state: MobileDurableCommandState,
        typed_error: MobileDurableCommandErrorCode,
        now_ms: i64,
        next_attempt_at_ms: Option<i64>,
    ) -> LedgerResult<ValidatedCommand> {
        let cipher = &self.cipher;
        let scope = &self.scope;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| LedgerError::storage("begin command transition", error))?;
        let raw = load_raw_command(&transaction, command_id)?.ok_or_else(|| {
            LedgerError::for_command(
                LedgerErrorCode::CommandNotFound,
                "transition command",
                command_id,
                "command does not exist",
            )
        })?;
        let command = transition_in_transaction(
            &transaction,
            cipher,
            scope,
            raw,
            expected_states,
            next_state,
            typed_error,
            now_ms,
            next_attempt_at_ms,
        )?;
        transaction
            .commit()
            .map_err(|error| LedgerError::storage("commit command transition", error))?;
        Ok(command)
    }

    pub fn persist_checkpoint_and_remove(
        &mut self,
        command_id: &str,
        exact_lookup_bytes: &[u8],
        now_ms: i64,
    ) -> LedgerResult<ProjectionCheckpoint> {
        let cipher = &self.cipher;
        let scope = &self.scope;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| LedgerError::storage("begin projection checkpoint", error))?;
        if let Some(existing) = load_raw_checkpoint(&transaction, command_id)? {
            let checkpoint = decrypt_checkpoint(cipher, scope, existing)?;
            if checkpoint.exact_lookup_bytes == exact_lookup_bytes {
                transaction
                    .commit()
                    .map_err(|error| LedgerError::storage("finish checkpoint replay", error))?;
                return Ok(checkpoint);
            }
            return Err(LedgerError::for_command(
                LedgerErrorCode::CommandConflict,
                "persist projection checkpoint",
                command_id,
                "checkpoint ID is bound to different authoritative bytes",
            ));
        }

        let raw = load_raw_command(&transaction, command_id)?.ok_or_else(|| {
            LedgerError::for_command(
                LedgerErrorCode::CommandNotFound,
                "persist projection checkpoint",
                command_id,
                "accepted or committed command does not exist",
            )
        })?;
        let command = decrypt_command(cipher, scope, raw.clone())?;
        let state = command.state();
        if !matches!(
            state,
            MobileDurableCommandState::AcceptedPending
                | MobileDurableCommandState::Committed
                | MobileDurableCommandState::Checkpointing
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "persist projection checkpoint",
                command_id,
                "only accepted or committed commands can create a checkpoint",
            ));
        }
        let lookup = super::decode_lookup(&command, exact_lookup_bytes)?;
        validate_checkpoint_lookup(&lookup, &command, state)?;
        let (friend_request_lookup, social_relationship_lookup) =
            decode_typed_checkpoint_lookup(&command, exact_lookup_bytes)?;

        let checkpoint = ProjectionCheckpoint {
            command_id: command_id.to_string(),
            payload_sha256: command.envelope.payload_sha256.clone(),
            authoritative_lookup: friend_request_lookup,
            social_relationship_lookup,
            exact_lookup_bytes: exact_lookup_bytes.to_vec(),
            created_at_ms: now_ms,
        };
        let sealed = seal_checkpoint(cipher, scope, &checkpoint)?;
        transaction
            .execute(
                "INSERT INTO projection_checkpoints (
                    command_id, payload_sha256, created_at_ms, lookup_nonce,
                    lookup_ciphertext
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    sealed.command_id,
                    sealed.payload_sha256,
                    sealed.created_at_ms,
                    sealed.lookup_nonce,
                    sealed.lookup_ciphertext,
                ],
            )
            .map_err(|error| LedgerError::storage("insert projection checkpoint", error))?;
        let deleted = transaction
            .execute(
                "DELETE FROM command_entries WHERE command_id = ?1 AND state = ?2",
                params![command_id, raw.state],
            )
            .map_err(|error| {
                LedgerError::storage("remove checkpointed command atomically", error)
            })?;
        if deleted != 1 {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "persist projection checkpoint",
                command_id,
                "command changed while checkpointing",
            ));
        }
        transaction
            .commit()
            .map_err(|error| LedgerError::storage("commit projection checkpoint", error))?;
        Ok(checkpoint)
    }

    pub fn list_checkpoints(&self) -> LedgerResult<Vec<ProjectionCheckpoint>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT command_id, payload_sha256, created_at_ms, lookup_nonce,
                        lookup_ciphertext
                 FROM projection_checkpoints
                 ORDER BY created_at_ms, command_id",
            )
            .map_err(|error| LedgerError::storage("prepare projection checkpoints", error))?;
        let rows = statement
            .query_map([], checkpoint_row)
            .map_err(|error| LedgerError::storage("query projection checkpoints", error))?;
        let mut checkpoints = Vec::new();
        for row in rows {
            checkpoints.push(decrypt_checkpoint(
                &self.cipher,
                &self.scope,
                row.map_err(|error| LedgerError::storage("read projection checkpoint", error))?,
            )?);
        }
        Ok(checkpoints)
    }

    pub fn acknowledge_checkpoint(
        &mut self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> LedgerResult<()> {
        let affected = self
            .connection
            .execute(
                "DELETE FROM projection_checkpoints
                 WHERE command_id = ?1 AND payload_sha256 = ?2",
                params![command_id, payload_sha256],
            )
            .map_err(|error| LedgerError::storage("acknowledge projection checkpoint", error))?;
        if affected != 1 {
            return Err(LedgerError::for_command(
                LedgerErrorCode::CommandNotFound,
                "acknowledge projection checkpoint",
                command_id,
                "matching projection checkpoint does not exist",
            ));
        }
        Ok(())
    }

    pub fn purge_terminal(
        &mut self,
        command_id: &str,
        expected_state: MobileDurableCommandState,
    ) -> LedgerResult<()> {
        if !matches!(
            expected_state,
            MobileDurableCommandState::Cancelled
                | MobileDurableCommandState::Acknowledged
                | MobileDurableCommandState::Discarded
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "purge terminal command",
                command_id,
                "state is not locally purgeable",
            ));
        }
        let affected = self
            .connection
            .execute(
                "DELETE FROM command_entries WHERE command_id = ?1 AND state = ?2",
                params![command_id, expected_state as i32],
            )
            .map_err(|error| LedgerError::storage("purge terminal command", error))?;
        if affected != 1 {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "purge terminal command",
                command_id,
                "command is missing or no longer has the expected state",
            ));
        }
        Ok(())
    }

    pub fn count_states(&self, states: &[MobileDurableCommandState]) -> LedgerResult<u64> {
        let entries = self.list()?;
        Ok(entries
            .iter()
            .filter(|entry| states.contains(&entry.state()))
            .count() as u64)
    }

    fn recover_from_crash(&mut self, now_ms: i64) -> LedgerResult<()> {
        let cipher = &self.cipher;
        let scope = &self.scope;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| LedgerError::storage("begin command crash recovery", error))?;
        let rows = load_all_raw_commands(&transaction)?;
        let mut recovered = 0_u64;
        for raw in rows {
            let state = decode_state(raw.state, &raw.command_id)?;
            if matches!(
                state,
                MobileDurableCommandState::DispatchFenced
                    | MobileDurableCommandState::Submitting
                    | MobileDurableCommandState::Reconciling
            ) {
                let (next_state, typed_error) = if state == MobileDurableCommandState::Reconciling {
                    (
                        MobileDurableCommandState::Unresolved,
                        MobileDurableCommandErrorCode::LocalUnavailable,
                    )
                } else {
                    (
                        MobileDurableCommandState::UnknownOutcome,
                        MobileDurableCommandErrorCode::Transport,
                    )
                };
                transition_in_transaction(
                    &transaction,
                    cipher,
                    scope,
                    raw,
                    &[state],
                    next_state,
                    typed_error,
                    now_ms,
                    None,
                )?;
                recovered += 1;
            }
        }
        transaction
            .commit()
            .map_err(|error| LedgerError::storage("commit command crash recovery", error))?;
        if recovered > 0 {
            log::warn!(
                "command_ledger: recovered {recovered} interrupted commands into fail-closed states"
            );
        }
        Ok(())
    }
}

#[derive(Clone)]
struct RawCommandRow {
    command_id: String,
    ordering_key: String,
    state: i32,
    attempt_count: u32,
    payload_sha256: Vec<u8>,
    payload_size: u64,
    created_at_ms: i64,
    updated_at_ms: i64,
    expires_at_ms: i64,
    dispatch_started_at_ms: Option<i64>,
    next_attempt_at_ms: Option<i64>,
    envelope_nonce: Vec<u8>,
    envelope_ciphertext: Vec<u8>,
}

struct SealedCommand {
    raw: RawCommandRow,
}

struct RawCheckpointRow {
    command_id: String,
    payload_sha256: Vec<u8>,
    created_at_ms: i64,
    lookup_nonce: Vec<u8>,
    lookup_ciphertext: Vec<u8>,
}

fn initialize_schema_and_metadata(
    connection: &mut Connection,
    cipher: &Aes256Gcm,
    scope: &CommandScope,
    key_metadata: &ScopeKeyMetadata,
) -> LedgerResult<()> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| LedgerError::storage("begin command ledger initialization", error))?;
    migration::create_v2_schema(&transaction)?;
    let aad = metadata_aad(
        SCHEMA_REVISION,
        scope,
        &key_metadata.kek_id,
        &key_metadata.install_epoch,
        &key_metadata.command_key_id,
    );
    let (nonce, tag) = seal(cipher, &[], &aad, "authenticate scope metadata")?;
    transaction
        .execute(
            "INSERT INTO command_scope_metadata (
                singleton, schema_revision, station_peer_id, actor_ptid, kek_id,
                install_epoch, command_key_id, auth_nonce, auth_tag
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                SCHEMA_REVISION,
                scope.station_peer_id,
                scope.actor_ptid,
                key_metadata.kek_id,
                key_metadata.install_epoch,
                key_metadata.command_key_id,
                nonce,
                tag,
            ],
        )
        .map_err(|error| LedgerError::storage("persist scope metadata", error))?;
    transaction
        .commit()
        .map_err(|error| LedgerError::storage("commit command ledger initialization", error))
}

fn verify_metadata(
    connection: &Connection,
    cipher: &Aes256Gcm,
    expected_scope: &CommandScope,
    expected_key: &ScopeKeyMetadata,
) -> LedgerResult<()> {
    let stored = connection
        .query_row(
            "SELECT schema_revision, station_peer_id, actor_ptid, kek_id,
                    install_epoch, command_key_id, auth_nonce, auth_tag
             FROM command_scope_metadata WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Vec<u8>>(6)?,
                    row.get::<_, Vec<u8>>(7)?,
                ))
            },
        )
        .map_err(|error| LedgerError::storage("read authenticated scope metadata", error))?;
    let stored_scope = CommandScope {
        station_peer_id: stored.1,
        actor_ptid: stored.2,
    };
    let aad = metadata_aad(stored.0, &stored_scope, &stored.3, &stored.4, &stored.5);
    open_sealed(
        cipher,
        &stored.6,
        &stored.7,
        &aad,
        "authenticate scope metadata",
    )
    .map_err(|_| {
        LedgerError::new(
            LedgerErrorCode::AuthenticationFailed,
            "authenticate scope metadata",
            "scope metadata authentication failed",
        )
    })?;
    if stored.0 != SCHEMA_REVISION {
        return Err(LedgerError::new(
            LedgerErrorCode::SchemaMismatch,
            "verify scope metadata",
            "scope metadata has an unsupported schema revision",
        ));
    }
    if stored_scope != *expected_scope {
        return Err(LedgerError::new(
            LedgerErrorCode::InvalidScope,
            "verify scope metadata",
            "database belongs to a different Station/PTID scope",
        ));
    }
    if stored.3 != expected_key.kek_id
        || stored.4 != expected_key.install_epoch
        || stored.5 != expected_key.command_key_id
    {
        return Err(LedgerError::new(
            LedgerErrorCode::KeyMetadataMismatch,
            "verify scope metadata",
            "trusted key identity does not match the authenticated database metadata",
        ));
    }
    Ok(())
}

fn verify_schema_revision(connection: &Connection) -> LedgerResult<()> {
    let revision: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| LedgerError::storage("read command ledger schema revision", error))?;
    if revision != SCHEMA_REVISION {
        return Err(LedgerError::new(
            LedgerErrorCode::SchemaMismatch,
            "verify command ledger schema",
            "database user_version does not match the generated contract",
        ));
    }
    Ok(())
}

fn load_raw_command(
    connection: &Connection,
    command_id: &str,
) -> LedgerResult<Option<RawCommandRow>> {
    connection
        .query_row(
            "SELECT command_id, ordering_key, state, attempt_count, payload_sha256,
                    payload_size, created_at_ms, updated_at_ms, expires_at_ms,
                    dispatch_started_at_ms, next_attempt_at_ms, envelope_nonce,
                    envelope_ciphertext
             FROM command_entries WHERE command_id = ?1",
            [command_id],
            command_row,
        )
        .optional()
        .map_err(|error| LedgerError::storage("load generated command", error))
}

fn load_all_raw_commands(connection: &Connection) -> LedgerResult<Vec<RawCommandRow>> {
    let mut statement = connection
        .prepare(
            "SELECT command_id, ordering_key, state, attempt_count, payload_sha256,
                    payload_size, created_at_ms, updated_at_ms, expires_at_ms,
                    dispatch_started_at_ms, next_attempt_at_ms, envelope_nonce,
                    envelope_ciphertext
             FROM command_entries
             ORDER BY created_at_ms, command_id",
        )
        .map_err(|error| LedgerError::storage("prepare generated commands", error))?;
    let rows = statement
        .query_map([], command_row)
        .map_err(|error| LedgerError::storage("query generated commands", error))?;
    rows.map(|row| row.map_err(|error| LedgerError::storage("read generated command", error)))
        .collect()
}

fn command_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawCommandRow> {
    Ok(RawCommandRow {
        command_id: row.get(0)?,
        ordering_key: row.get(1)?,
        state: row.get(2)?,
        attempt_count: row.get(3)?,
        payload_sha256: row.get(4)?,
        payload_size: row.get(5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
        expires_at_ms: row.get(8)?,
        dispatch_started_at_ms: row.get(9)?,
        next_attempt_at_ms: row.get(10)?,
        envelope_nonce: row.get(11)?,
        envelope_ciphertext: row.get(12)?,
    })
}

fn checkpoint_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawCheckpointRow> {
    Ok(RawCheckpointRow {
        command_id: row.get(0)?,
        payload_sha256: row.get(1)?,
        created_at_ms: row.get(2)?,
        lookup_nonce: row.get(3)?,
        lookup_ciphertext: row.get(4)?,
    })
}

fn load_raw_checkpoint(
    connection: &Connection,
    command_id: &str,
) -> LedgerResult<Option<RawCheckpointRow>> {
    connection
        .query_row(
            "SELECT command_id, payload_sha256, created_at_ms, lookup_nonce,
                    lookup_ciphertext
             FROM projection_checkpoints WHERE command_id = ?1",
            [command_id],
            checkpoint_row,
        )
        .optional()
        .map_err(|error| LedgerError::storage("load projection checkpoint", error))
}

fn decrypt_command(
    cipher: &Aes256Gcm,
    scope: &CommandScope,
    raw: RawCommandRow,
) -> LedgerResult<ValidatedCommand> {
    let aad = command_aad(scope, &raw);
    let encoded = open_sealed(
        cipher,
        &raw.envelope_nonce,
        &raw.envelope_ciphertext,
        &aad,
        "decrypt generated command",
    )?;
    let command = decode_persisted(&encoded, scope)?;
    let envelope = &command.envelope;
    let state = state_of(envelope)?;
    let created_at_ms =
        timestamp_to_millis(envelope.created_at.as_ref(), "created_at", &raw.command_id)?;
    let updated_at_ms =
        timestamp_to_millis(envelope.updated_at.as_ref(), "updated_at", &raw.command_id)?;
    let expires_at_ms =
        timestamp_to_millis(envelope.expires_at.as_ref(), "expires_at", &raw.command_id)?;
    let dispatch_started_at_ms = envelope
        .dispatch_started_at
        .as_ref()
        .map(|timestamp| {
            timestamp_to_millis(Some(timestamp), "dispatch_started_at", &raw.command_id)
        })
        .transpose()?;
    let next_attempt_at_ms = envelope
        .next_attempt_at
        .as_ref()
        .map(|timestamp| timestamp_to_millis(Some(timestamp), "next_attempt_at", &raw.command_id))
        .transpose()?;
    if envelope.command_id != raw.command_id
        || envelope.ordering_key != raw.ordering_key
        || state as i32 != raw.state
        || envelope.attempt_count != raw.attempt_count
        || envelope.payload_sha256 != raw.payload_sha256
        || command.payload_size() as u64 != raw.payload_size
        || created_at_ms != raw.created_at_ms
        || updated_at_ms != raw.updated_at_ms
        || expires_at_ms != raw.expires_at_ms
        || dispatch_started_at_ms != raw.dispatch_started_at_ms
        || next_attempt_at_ms != raw.next_attempt_at_ms
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::AuthenticationFailed,
            "authenticate generated command row",
            raw.command_id,
            "authenticated envelope and indexed row metadata differ",
        ));
    }
    Ok(command)
}

fn seal_command(
    cipher: &Aes256Gcm,
    scope: &CommandScope,
    command: &ValidatedCommand,
) -> LedgerResult<SealedCommand> {
    let envelope = &command.envelope;
    let raw = RawCommandRow {
        command_id: envelope.command_id.clone(),
        ordering_key: envelope.ordering_key.clone(),
        state: state_of(envelope)? as i32,
        attempt_count: envelope.attempt_count,
        payload_sha256: envelope.payload_sha256.clone(),
        payload_size: command.payload_size() as u64,
        created_at_ms: timestamp_to_millis(
            envelope.created_at.as_ref(),
            "created_at",
            &envelope.command_id,
        )?,
        updated_at_ms: timestamp_to_millis(
            envelope.updated_at.as_ref(),
            "updated_at",
            &envelope.command_id,
        )?,
        expires_at_ms: timestamp_to_millis(
            envelope.expires_at.as_ref(),
            "expires_at",
            &envelope.command_id,
        )?,
        dispatch_started_at_ms: envelope
            .dispatch_started_at
            .as_ref()
            .map(|timestamp| {
                timestamp_to_millis(Some(timestamp), "dispatch_started_at", &envelope.command_id)
            })
            .transpose()?,
        next_attempt_at_ms: envelope
            .next_attempt_at
            .as_ref()
            .map(|timestamp| {
                timestamp_to_millis(Some(timestamp), "next_attempt_at", &envelope.command_id)
            })
            .transpose()?,
        envelope_nonce: Vec::new(),
        envelope_ciphertext: Vec::new(),
    };
    let aad = command_aad(scope, &raw);
    let (nonce, ciphertext) = seal(
        cipher,
        &encode_envelope(envelope),
        &aad,
        "encrypt generated command",
    )?;
    Ok(SealedCommand {
        raw: RawCommandRow {
            envelope_nonce: nonce,
            envelope_ciphertext: ciphertext,
            ..raw
        },
    })
}

fn transition_in_transaction(
    transaction: &Transaction<'_>,
    cipher: &Aes256Gcm,
    scope: &CommandScope,
    raw: RawCommandRow,
    expected_states: &[MobileDurableCommandState],
    next_state: MobileDurableCommandState,
    typed_error: MobileDurableCommandErrorCode,
    now_ms: i64,
    next_attempt_at_ms: Option<i64>,
) -> LedgerResult<ValidatedCommand> {
    let current_state = decode_state(raw.state, &raw.command_id)?;
    if !expected_states.contains(&current_state) {
        return Err(LedgerError::for_command(
            LedgerErrorCode::StateConflict,
            "compare-and-swap command state",
            &raw.command_id,
            "persisted state does not match the expected state",
        ));
    }
    if !allows_transition(current_state, next_state) {
        return Err(LedgerError::for_command(
            LedgerErrorCode::StateConflict,
            "compare-and-swap command state",
            &raw.command_id,
            "requested state transition is not accepted by MS-D15",
        ));
    }
    if next_state == MobileDurableCommandState::RetryWait && next_attempt_at_ms.is_none() {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidConfiguration,
            "compare-and-swap command state",
            &raw.command_id,
            "retry_wait requires next_attempt_at",
        ));
    }

    let mut command = decrypt_command(cipher, scope, raw.clone())?;
    command.envelope.state = next_state as i32;
    command.envelope.typed_last_error = typed_error as i32;
    command.envelope.updated_at = Some(millis_to_timestamp(now_ms));
    command.envelope.next_attempt_at = next_attempt_at_ms.map(millis_to_timestamp);
    command.encoded_envelope = encode_envelope(&command.envelope);
    write_command_cas(
        transaction,
        cipher,
        scope,
        &command,
        current_state,
        raw.attempt_count,
    )?;
    Ok(command)
}

fn write_command_cas(
    transaction: &Transaction<'_>,
    cipher: &Aes256Gcm,
    scope: &CommandScope,
    command: &ValidatedCommand,
    expected_state: MobileDurableCommandState,
    expected_attempt_count: u32,
) -> LedgerResult<()> {
    let sealed = seal_command(cipher, scope, command)?;
    let raw = &sealed.raw;
    let affected = transaction
        .execute(
            "UPDATE command_entries SET
                ordering_key = ?1, state = ?2, attempt_count = ?3,
                payload_sha256 = ?4, payload_size = ?5, created_at_ms = ?6,
                updated_at_ms = ?7, expires_at_ms = ?8,
                dispatch_started_at_ms = ?9, next_attempt_at_ms = ?10,
                envelope_nonce = ?11, envelope_ciphertext = ?12
             WHERE command_id = ?13 AND state = ?14 AND attempt_count = ?15",
            params![
                raw.ordering_key,
                raw.state,
                raw.attempt_count,
                raw.payload_sha256,
                raw.payload_size,
                raw.created_at_ms,
                raw.updated_at_ms,
                raw.expires_at_ms,
                raw.dispatch_started_at_ms,
                raw.next_attempt_at_ms,
                raw.envelope_nonce,
                raw.envelope_ciphertext,
                raw.command_id,
                expected_state as i32,
                expected_attempt_count,
            ],
        )
        .map_err(|error| LedgerError::storage("persist command state transition", error))?;
    if affected != 1 {
        return Err(LedgerError::for_command(
            LedgerErrorCode::StateConflict,
            "compare-and-swap command state",
            &raw.command_id,
            "command changed before the state transaction committed",
        ));
    }
    Ok(())
}

fn validate_checkpoint_lookup(
    lookup: &super::AuthoritativeLookup,
    command: &ValidatedCommand,
    state: MobileDurableCommandState,
) -> LedgerResult<()> {
    if lookup.command_id != command.envelope.command_id
        || lookup.command_payload_sha256 != command.envelope.payload_sha256
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::CommandConflict,
            "validate projection checkpoint",
            command.command_id(),
            "authoritative lookup identity or payload hash differs",
        ));
    }
    let valid = match (state, lookup.state) {
        (
            MobileDurableCommandState::AcceptedPending,
            super::AuthoritativeLookupState::AcceptedPending,
        ) => lookup.result_kind.is_none(),
        (MobileDurableCommandState::Committed, super::AuthoritativeLookupState::TerminalResult) => {
            matches!(
                lookup.result_kind,
                Some(
                    super::AuthoritativeResultKind::Committed
                        | super::AuthoritativeResultKind::Duplicate
                )
            )
        }
        (MobileDurableCommandState::Checkpointing, _) => true,
        _ => false,
    };
    if !valid {
        return Err(LedgerError::for_command(
            LedgerErrorCode::StateConflict,
            "validate projection checkpoint",
            command.command_id(),
            "lookup result does not authorize checkpointing this state",
        ));
    }
    Ok(())
}

fn seal_checkpoint(
    cipher: &Aes256Gcm,
    scope: &CommandScope,
    checkpoint: &ProjectionCheckpoint,
) -> LedgerResult<RawCheckpointRow> {
    let aad = checkpoint_aad(
        scope,
        &checkpoint.command_id,
        &checkpoint.payload_sha256,
        checkpoint.created_at_ms,
    );
    let (lookup_nonce, lookup_ciphertext) = seal(
        cipher,
        &checkpoint.exact_lookup_bytes,
        &aad,
        "encrypt projection checkpoint",
    )?;
    Ok(RawCheckpointRow {
        command_id: checkpoint.command_id.clone(),
        payload_sha256: checkpoint.payload_sha256.clone(),
        created_at_ms: checkpoint.created_at_ms,
        lookup_nonce,
        lookup_ciphertext,
    })
}

fn decrypt_checkpoint(
    cipher: &Aes256Gcm,
    scope: &CommandScope,
    raw: RawCheckpointRow,
) -> LedgerResult<ProjectionCheckpoint> {
    let aad = checkpoint_aad(
        scope,
        &raw.command_id,
        &raw.payload_sha256,
        raw.created_at_ms,
    );
    let bytes = open_sealed(
        cipher,
        &raw.lookup_nonce,
        &raw.lookup_ciphertext,
        &aad,
        "decrypt projection checkpoint",
    )?;
    let (lookup, social_relationship_lookup) =
        decode_stored_checkpoint_lookup(&raw.command_id, &raw.payload_sha256, &bytes)?;
    Ok(ProjectionCheckpoint {
        command_id: raw.command_id,
        payload_sha256: raw.payload_sha256,
        authoritative_lookup: lookup,
        social_relationship_lookup,
        exact_lookup_bytes: bytes,
        created_at_ms: raw.created_at_ms,
    })
}

fn decode_typed_checkpoint_lookup(
    command: &ValidatedCommand,
    bytes: &[u8],
) -> LedgerResult<(
    LookupFriendRequestCommandResultResponse,
    Option<LookupSocialRelationshipCommandResultResponse>,
)> {
    match command.envelope.payload.as_ref() {
        Some(mobile_durable_command_envelope_v2::Payload::FriendRequest(_)) => {
            let lookup =
                LookupFriendRequestCommandResultResponse::decode(bytes).map_err(|error| {
                    LedgerError::for_command(
                        LedgerErrorCode::Serialization,
                        "decode Friend Request projection checkpoint",
                        command.command_id(),
                        error.to_string(),
                    )
                })?;
            if lookup.encode_to_vec() != bytes {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::InvalidEnvelope,
                    "decode Friend Request projection checkpoint",
                    command.command_id(),
                    "lookup bytes are not canonical",
                ));
            }
            Ok((lookup, None))
        }
        Some(mobile_durable_command_envelope_v2::Payload::SocialRelationship(_)) => {
            let lookup =
                LookupSocialRelationshipCommandResultResponse::decode(bytes).map_err(|error| {
                    LedgerError::for_command(
                        LedgerErrorCode::Serialization,
                        "decode Social relationship projection checkpoint",
                        command.command_id(),
                        error.to_string(),
                    )
                })?;
            if lookup.encode_to_vec() != bytes {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::InvalidEnvelope,
                    "decode Social relationship projection checkpoint",
                    command.command_id(),
                    "lookup bytes are not canonical",
                ));
            }
            Ok((
                LookupFriendRequestCommandResultResponse::default(),
                Some(lookup),
            ))
        }
        None => Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode projection checkpoint",
            command.command_id(),
            "generated command payload is missing",
        )),
    }
}

fn decode_stored_checkpoint_lookup(
    command_id: &str,
    payload_sha256: &[u8],
    bytes: &[u8],
) -> LedgerResult<(
    LookupFriendRequestCommandResultResponse,
    Option<LookupSocialRelationshipCommandResultResponse>,
)> {
    if let Ok(lookup) = LookupFriendRequestCommandResultResponse::decode(bytes) {
        if lookup.encode_to_vec() == bytes
            && lookup.command_id == command_id
            && lookup.command_payload_sha256 == payload_sha256
        {
            return Ok((lookup, None));
        }
    }
    if let Ok(lookup) = LookupSocialRelationshipCommandResultResponse::decode(bytes) {
        if lookup.encode_to_vec() == bytes
            && lookup.command_id == command_id
            && lookup.command_payload_sha256 == payload_sha256
        {
            return Ok((
                LookupFriendRequestCommandResultResponse::default(),
                Some(lookup),
            ));
        }
    }
    Err(LedgerError::for_command(
        LedgerErrorCode::AuthenticationFailed,
        "authenticate projection checkpoint",
        command_id,
        "checkpoint metadata differs from its generated lookup bytes",
    ))
}

fn active_ordering_key_count(connection: &Connection) -> LedgerResult<u64> {
    connection
        .query_row(
            "SELECT COUNT(DISTINCT ordering_key) FROM command_entries
             WHERE state IN (?1, ?2, ?3)",
            params![
                MobileDurableCommandState::DispatchFenced as i32,
                MobileDurableCommandState::Submitting as i32,
                MobileDurableCommandState::Reconciling as i32,
            ],
            |row| row.get(0),
        )
        .map_err(|error| LedgerError::storage("count active ordering keys", error))
}

fn read_capacity_usage(connection: &Connection) -> LedgerResult<LedgerCapacityUsage> {
    connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(payload_size), 0) FROM command_entries",
            [],
            |row| {
                Ok(LedgerCapacityUsage {
                    record_count: row.get(0)?,
                    byte_usage: row.get(1)?,
                })
            },
        )
        .map_err(|error| LedgerError::storage("read command ledger capacity", error))
}

fn command_params(sealed: &SealedCommand) -> [&dyn rusqlite::ToSql; 13] {
    let raw = &sealed.raw;
    [
        &raw.command_id,
        &raw.ordering_key,
        &raw.state,
        &raw.attempt_count,
        &raw.payload_sha256,
        &raw.payload_size,
        &raw.created_at_ms,
        &raw.updated_at_ms,
        &raw.expires_at_ms,
        &raw.dispatch_started_at_ms,
        &raw.next_attempt_at_ms,
        &raw.envelope_nonce,
        &raw.envelope_ciphertext,
    ]
}

fn command_aad(scope: &CommandScope, raw: &RawCommandRow) -> Vec<u8> {
    let mut aad = Vec::new();
    push_bytes(&mut aad, b"peers-touch/mobile/command-ledger/v2/row");
    push_u32(&mut aad, SCHEMA_REVISION);
    push_bytes(&mut aad, scope.station_peer_id.as_bytes());
    push_bytes(&mut aad, scope.actor_ptid.as_bytes());
    push_bytes(&mut aad, raw.command_id.as_bytes());
    push_bytes(&mut aad, raw.ordering_key.as_bytes());
    push_i64(&mut aad, i64::from(raw.state));
    push_u32(&mut aad, raw.attempt_count);
    push_bytes(&mut aad, &raw.payload_sha256);
    push_u64(&mut aad, raw.payload_size);
    push_i64(&mut aad, raw.created_at_ms);
    push_i64(&mut aad, raw.updated_at_ms);
    push_i64(&mut aad, raw.expires_at_ms);
    push_optional_i64(&mut aad, raw.dispatch_started_at_ms);
    push_optional_i64(&mut aad, raw.next_attempt_at_ms);
    aad
}

fn metadata_aad(
    schema_revision: u32,
    scope: &CommandScope,
    kek_id: &str,
    install_epoch: &[u8],
    command_key_id: &str,
) -> Vec<u8> {
    let mut aad = Vec::new();
    push_bytes(&mut aad, b"peers-touch/mobile/command-ledger/v2/metadata");
    push_u32(&mut aad, schema_revision);
    push_bytes(&mut aad, scope.station_peer_id.as_bytes());
    push_bytes(&mut aad, scope.actor_ptid.as_bytes());
    push_bytes(&mut aad, kek_id.as_bytes());
    push_bytes(&mut aad, install_epoch);
    push_bytes(&mut aad, command_key_id.as_bytes());
    aad
}

fn checkpoint_aad(
    scope: &CommandScope,
    command_id: &str,
    payload_sha256: &[u8],
    created_at_ms: i64,
) -> Vec<u8> {
    let mut aad = Vec::new();
    push_bytes(&mut aad, b"peers-touch/mobile/command-ledger/v2/checkpoint");
    push_u32(&mut aad, SCHEMA_REVISION);
    push_bytes(&mut aad, scope.station_peer_id.as_bytes());
    push_bytes(&mut aad, scope.actor_ptid.as_bytes());
    push_bytes(&mut aad, command_id.as_bytes());
    push_bytes(&mut aad, payload_sha256);
    push_i64(&mut aad, created_at_ms);
    aad
}

fn seal(
    cipher: &Aes256Gcm,
    plaintext: &[u8],
    aad: &[u8],
    operation: &'static str,
) -> LedgerResult<(Vec<u8>, Vec<u8>)> {
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| {
            LedgerError::new(
                LedgerErrorCode::Crypto,
                operation,
                "AES-256-GCM sealing failed",
            )
        })?;
    Ok((nonce.to_vec(), ciphertext))
}

fn open_sealed(
    cipher: &Aes256Gcm,
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
    operation: &'static str,
) -> LedgerResult<Vec<u8>> {
    if nonce.len() != 12 {
        return Err(LedgerError::new(
            LedgerErrorCode::AuthenticationFailed,
            operation,
            "authenticated nonce has an invalid length",
        ));
    }
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| {
            LedgerError::new(
                LedgerErrorCode::AuthenticationFailed,
                operation,
                "AES-256-GCM authentication failed",
            )
        })
}

fn apply_sqlcipher_key(connection: &Connection, key: &[u8; 32]) -> LedgerResult<()> {
    let mut hex = String::with_capacity(64);
    for byte in key {
        use std::fmt::Write;
        write!(&mut hex, "{byte:02x}").expect("write to String");
    }
    connection
        .execute_batch(&format!("PRAGMA key = \"x'{hex}'\";"))
        .map_err(|error| LedgerError::storage("configure encrypted command database", error))
}

fn scope_key_parent(database_path: &Path) -> LedgerResult<()> {
    let parent = database_path.parent().ok_or_else(|| {
        LedgerError::new(
            LedgerErrorCode::InvalidConfiguration,
            "open command ledger database",
            "database path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| LedgerError::io("create command ledger directory", error))
}

fn decode_state(value: i32, command_id: &str) -> LedgerResult<MobileDurableCommandState> {
    MobileDurableCommandState::try_from(value).map_err(|_| {
        LedgerError::for_command(
            LedgerErrorCode::AuthenticationFailed,
            "decode indexed command state",
            command_id,
            "indexed state is not generated",
        )
    })
}

fn state_conflict(
    operation: &'static str,
    command_id: &str,
    expected: MobileDurableCommandState,
    actual: MobileDurableCommandState,
) -> LedgerError {
    LedgerError::for_command(
        LedgerErrorCode::StateConflict,
        operation,
        command_id,
        format!("expected {expected:?}, found {actual:?}"),
    )
}

fn push_bytes(target: &mut Vec<u8>, value: &[u8]) {
    push_u64(target, value.len() as u64);
    target.extend_from_slice(value);
}

fn push_u32(target: &mut Vec<u8>, value: u32) {
    target.extend_from_slice(&value.to_be_bytes());
}

fn push_u64(target: &mut Vec<u8>, value: u64) {
    target.extend_from_slice(&value.to_be_bytes());
}

fn push_i64(target: &mut Vec<u8>, value: i64) {
    target.extend_from_slice(&value.to_be_bytes());
}

fn push_optional_i64(target: &mut Vec<u8>, value: Option<i64>) {
    match value {
        Some(value) => {
            target.push(1);
            push_i64(target, value);
        }
        None => target.push(0),
    }
}
