pub const MESSAGING_SCHEMA_SQL: &str = r#"
PRAGMA foreign_keys = ON;
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
    authority_station_id TEXT NOT NULL,
    federation_id TEXT NOT NULL,
    kind INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_ptid TEXT NOT NULL,
    membership_epoch INTEGER NOT NULL,
    mls_epoch INTEGER NOT NULL,
    active INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    recovery_ready INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messaging_conversation_members (
    conversation_id TEXT NOT NULL,
    ptid TEXT NOT NULL,
    role INTEGER NOT NULL,
    home_station_peer_id TEXT NOT NULL DEFAULT '',
    muted INTEGER NOT NULL DEFAULT 0,
    muted_until_unix_ms INTEGER,
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
    created_at_unix_ms INTEGER NOT NULL,
    one_time_prekey_high_watermark INTEGER NOT NULL DEFAULT 0
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
CREATE UNIQUE INDEX IF NOT EXISTS uidx_direct_sessions_endpoint_generation
    ON direct_sessions(
        conversation_id, self_ptid, self_device_id,
        peer_ptid, peer_device_id, generation
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
    conversation_kind INTEGER NOT NULL,
    command_kind INTEGER NOT NULL DEFAULT 1,
    message_id TEXT NOT NULL,
    sender_ptid TEXT NOT NULL,
    sender_device_id TEXT NOT NULL,
    plaintext TEXT NOT NULL,
    reply_to_message_id TEXT NOT NULL DEFAULT '',
    thread_root_message_id TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL,
    attempt_count INTEGER NOT NULL,
    next_attempt_at_unix_ms INTEGER NOT NULL,
    last_error_code TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_messaging_pending_messages_thread
    ON messaging_pending_messages(
        conversation_id, thread_root_message_id, created_at_unix_ms, message_id
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
CREATE TABLE IF NOT EXISTS messaging_interaction_intents (
    command_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    target_message_id TEXT NOT NULL,
    interaction_kind TEXT NOT NULL,
    edited_text TEXT,
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
CREATE TABLE IF NOT EXISTS messaging_authority_events (
    conversation_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_sequence INTEGER NOT NULL,
    event_hash BLOB NOT NULL CHECK(length(event_hash) = 32),
    committed_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, event_sequence),
    UNIQUE(conversation_id, event_id)
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
    reply_to_message_id TEXT,
    thread_root_message_id TEXT,
    edited_text TEXT,
    edited_at_unix_ms INTEGER,
    retracted INTEGER NOT NULL DEFAULT 0,
    hidden_for_actor INTEGER NOT NULL DEFAULT 0,
    moderated INTEGER NOT NULL DEFAULT 0,
    moderation_reason_code TEXT,
    PRIMARY KEY(conversation_id, event_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_projection_message
    ON messaging_message_projections(conversation_id, message_id);
CREATE INDEX IF NOT EXISTS idx_messaging_message_projections_thread
    ON messaging_message_projections(
        conversation_id, thread_root_message_id, event_sequence
    );
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL,
    actor_ptid TEXT NOT NULL,
    reaction TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(message_id, actor_ptid, reaction)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS message_pins (
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    actor_ptid TEXT NOT NULL,
    pinned_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, message_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS read_cursors (
    conversation_id TEXT NOT NULL,
    actor_ptid TEXT NOT NULL,
    last_read_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, actor_ptid)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS messaging_attachment_transfers (
    attachment_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    authority_station_id TEXT NOT NULL,
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
    plaintext_size INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL,
    next_attempt_at_unix_ms INTEGER NOT NULL,
    last_error_code INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messaging_attachment_transfers_due
    ON messaging_attachment_transfers(state, next_attempt_at_unix_ms);
CREATE TABLE IF NOT EXISTS messaging_attachment_drafts (
    attachment_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    plaintext_sha256 BLOB NOT NULL CHECK(length(plaintext_sha256) = 32),
    descriptor_bytes BLOB,
    voice_note_bytes BLOB NOT NULL DEFAULT X'',
    created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messaging_attachment_drafts_message
    ON messaging_attachment_drafts(message_id, attachment_id);
CREATE TABLE IF NOT EXISTS messaging_attachment_projections (
    message_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    storage_ref TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    plaintext_size INTEGER NOT NULL,
    plaintext_sha256 BLOB NOT NULL CHECK(length(plaintext_sha256) = 32),
    object_key BLOB NOT NULL CHECK(length(object_key) = 32),
    base_nonce BLOB NOT NULL CHECK(length(base_nonce) = 12),
    descriptor_bytes BLOB NOT NULL,
    voice_note_bytes BLOB NOT NULL DEFAULT X'',
    availability_state TEXT NOT NULL,
    local_cache_path TEXT,
    PRIMARY KEY(message_id, attachment_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS messaging_message_search_fts USING fts5(
    conversation_id UNINDEXED,
    message_id UNINDEXED,
    plaintext,
    attachment_filenames,
    tokenize = 'unicode61'
);
CREATE TABLE IF NOT EXISTS chat_storage_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    station_peer_id TEXT NOT NULL,
    actor_ptid TEXT NOT NULL,
    device_id TEXT NOT NULL,
    retention_preset INTEGER NOT NULL CHECK(retention_preset IN (1, 2, 3, 4)),
    updated_at_unix_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_retention_floor (
    station_peer_id TEXT NOT NULL,
    actor_ptid TEXT NOT NULL,
    device_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    pruned_through_sequence INTEGER NOT NULL,
    authority_event_hash BLOB NOT NULL CHECK(length(authority_event_hash) = 32),
    policy_cutoff_unix_ms INTEGER,
    reason TEXT NOT NULL CHECK (reason IN ('policy', 'manual_clear')),
    updated_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(station_peer_id, actor_ptid, device_id, conversation_id)
);
CREATE TABLE IF NOT EXISTS message_redaction_tombstones (
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('hidden_for_actor', 'retracted')),
    authority_sequence INTEGER NOT NULL,
    authority_event_hash BLOB NOT NULL CHECK(length(authority_event_hash) = 32),
    applied_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, message_id, kind)
);
CREATE TABLE IF NOT EXISTS chat_cleanup_journal (
    operation_id TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL CHECK (
        scope_kind IN ('cache', 'conversation', 'retention', 'actor_hide', 'retract')
    ),
    conversation_id TEXT,
    scope_revision TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN (
            'planned', 'deleting_rows', 'deleting_files',
            'compacting', 'compaction_pending', 'paused_scope_inactive',
            'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled'
        )
    ),
    estimated_reclaimable_bytes INTEGER NOT NULL,
    physical_bytes_before INTEGER NOT NULL,
    physical_bytes_after INTEGER,
    retention_preset INTEGER,
    policy_cutoff_unix_ms INTEGER,
    last_error_code TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_cleanup_journal_resume
    ON chat_cleanup_journal(scope_kind, scope_revision, updated_at_unix_ms DESC);
CREATE TABLE IF NOT EXISTS chat_cleanup_items (
    operation_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_kind TEXT NOT NULL CHECK (
        item_kind IN ('projection', 'fts', 'interaction', 'transfer', 'file')
    ),
    target_ref TEXT NOT NULL,
    expected_size_bytes INTEGER NOT NULL,
    expected_digest BLOB CHECK(expected_digest IS NULL OR length(expected_digest) = 32),
    state TEXT NOT NULL CHECK (
        state IN (
            'pending', 'deleted', 'skipped_protected',
            'failed_retryable', 'failed_terminal'
        )
    ),
    last_error_code TEXT,
    updated_at_unix_ms INTEGER NOT NULL,
    PRIMARY KEY(operation_id, item_id),
    FOREIGN KEY(operation_id) REFERENCES chat_cleanup_journal(operation_id) ON DELETE CASCADE
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
);
"#;

pub trait MessagingSchemaBackend {
    fn execute_batch(&self, sql: &str) -> Result<(), String>;
}

pub fn migrate_messaging_schema<B: MessagingSchemaBackend>(backend: &B) -> Result<(), String> {
    backend.execute_batch("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;")?;
    let migration = (|| {
        backend.execute_batch(MESSAGING_SCHEMA_SQL)?;
        Ok(())
    })();
    match migration {
        Ok(()) => backend.execute_batch("COMMIT;"),
        Err(error) => {
            let rollback = backend.execute_batch("ROLLBACK;");
            match rollback {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error}; rollback shared messaging schema migration: {rollback_error}"
                )),
            }
        }
    }
}
