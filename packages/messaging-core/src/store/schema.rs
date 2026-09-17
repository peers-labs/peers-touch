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
    created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messaging_attachment_drafts_message
    ON messaging_attachment_drafts(message_id, attachment_id);
DROP TABLE IF EXISTS messaging_attachment_metadata;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RequiredColumn {
    pub table: &'static str,
    pub column: &'static str,
    pub definition: &'static str,
}

pub const REQUIRED_COLUMNS: &[RequiredColumn] = &[
    RequiredColumn {
        table: "messaging_conversations",
        column: "authority_station_id",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_conversations",
        column: "federation_id",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_conversations",
        column: "recovery_ready",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_conversation_members",
        column: "role",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_conversation_members",
        column: "active",
        definition: "INTEGER NOT NULL DEFAULT 1",
    },
    RequiredColumn {
        table: "messaging_membership_intents",
        column: "action",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_membership_intents",
        column: "target_ptid",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_membership_intents",
        column: "target_device_id",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_membership_intents",
        column: "role",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_pending_messages",
        column: "conversation_kind",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_pending_messages",
        column: "attempt_count",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_pending_messages",
        column: "next_attempt_at_unix_ms",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_pending_messages",
        column: "last_error_code",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_pending_messages",
        column: "reply_to_message_id",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_pending_messages",
        column: "thread_root_message_id",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_command_outbox",
        column: "conversation_id",
        definition: "TEXT NOT NULL DEFAULT ''",
    },
    RequiredColumn {
        table: "messaging_command_outbox",
        column: "created_at_unix_ms",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_message_projections",
        column: "reply_to_message_id",
        definition: "TEXT",
    },
    RequiredColumn {
        table: "messaging_message_projections",
        column: "thread_root_message_id",
        definition: "TEXT",
    },
    RequiredColumn {
        table: "messaging_message_projections",
        column: "edited_text",
        definition: "TEXT",
    },
    RequiredColumn {
        table: "messaging_message_projections",
        column: "edited_at_unix_ms",
        definition: "INTEGER",
    },
    RequiredColumn {
        table: "messaging_message_projections",
        column: "retracted",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
    RequiredColumn {
        table: "messaging_interaction_intents",
        column: "edited_text",
        definition: "TEXT",
    },
    RequiredColumn {
        table: "messaging_prekey_bundle",
        column: "one_time_prekey_high_watermark",
        definition: "INTEGER NOT NULL DEFAULT 0",
    },
];

pub const POST_COLUMN_MIGRATION_SQL: &str = r#"
UPDATE messaging_prekey_bundle
SET one_time_prekey_high_watermark = -1
WHERE one_time_prekey_high_watermark = 0;
UPDATE messaging_conversation_members
SET role = 3
WHERE role = 0
  AND ptid = (
      SELECT owner_ptid
      FROM messaging_conversations
      WHERE messaging_conversations.conversation_id =
            messaging_conversation_members.conversation_id
  );
UPDATE messaging_pending_messages
SET conversation_kind = COALESCE(
    NULLIF(conversation_kind, 0),
    (
        SELECT kind
        FROM messaging_conversations
        WHERE messaging_conversations.conversation_id =
              messaging_pending_messages.conversation_id
    ),
    0
);
UPDATE messaging_command_outbox
SET conversation_id = COALESCE(
        NULLIF(conversation_id, ''),
        (
            SELECT conversation_id
            FROM messaging_local_commands
            WHERE messaging_local_commands.command_id =
                  messaging_command_outbox.command_id
        ),
        ''
    ),
    created_at_unix_ms = COALESCE(
        NULLIF(created_at_unix_ms, 0),
        (
            SELECT created_at_unix_ms
            FROM messaging_local_commands
            WHERE messaging_local_commands.command_id =
                  messaging_command_outbox.command_id
        ),
        0
    );
"#;

pub trait MessagingSchemaBackend {
    fn execute_batch(&self, sql: &str) -> Result<(), String>;
    fn table_columns(&self, table: &str) -> Result<Vec<String>, String>;
    fn table_exists(&self, table: &str) -> Result<bool, String>;
    fn query_i64(&self, sql: &str) -> Result<i64, String>;
    fn migrate_legacy_attachment_rows(&self) -> Result<(), String>;
}

pub fn migrate_messaging_schema<B: MessagingSchemaBackend>(backend: &B) -> Result<(), String> {
    backend.execute_batch("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;")?;
    let migration = (|| {
        backend.execute_batch(MESSAGING_SCHEMA_SQL)?;
        for required in REQUIRED_COLUMNS {
            if !backend
                .table_columns(required.table)?
                .iter()
                .any(|column| column == required.column)
            {
                backend.execute_batch(&format!(
                    "ALTER TABLE {} ADD COLUMN {} {};",
                    required.table, required.column, required.definition
                ))?;
            }
        }
        backend.execute_batch(POST_COLUMN_MIGRATION_SQL)?;
        migrate_legacy_mobile_schema(backend)?;
        validate_migrated_schema(backend)
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

fn migrate_legacy_mobile_schema<B: MessagingSchemaBackend>(backend: &B) -> Result<(), String> {
    if backend.table_exists("messaging_read_cursors")? {
        backend.execute_batch(
            "INSERT INTO read_cursors(
                conversation_id, actor_ptid, last_read_sequence, updated_at_unix_ms
             )
             SELECT conversation_id, actor_ptid, last_read_sequence, updated_at_unix_ms
             FROM messaging_read_cursors
             WHERE true
             ON CONFLICT(conversation_id, actor_ptid) DO UPDATE SET
                last_read_sequence=MAX(
                    read_cursors.last_read_sequence,
                    excluded.last_read_sequence
                ),
                updated_at_unix_ms=CASE
                    WHEN excluded.last_read_sequence > read_cursors.last_read_sequence
                    THEN excluded.updated_at_unix_ms
                    ELSE read_cursors.updated_at_unix_ms
                END;
             DROP TABLE messaging_read_cursors;",
        )?;
    }

    if backend.table_exists("messaging_prekeys")? {
        let invalid_kinds = backend.query_i64(
            "SELECT COUNT(*) FROM messaging_prekeys
             WHERE kind NOT IN ('signed', 'one_time')",
        )?;
        let signed_count =
            backend.query_i64("SELECT COUNT(*) FROM messaging_prekeys WHERE kind = 'signed'")?;
        if invalid_kinds != 0 || signed_count > 1 {
            return Err("legacy Mobile messaging prekey state is ambiguous".to_string());
        }
        backend.execute_batch(
            "INSERT INTO messaging_prekey_bundle(
                id, signed_prekey_id, signed_prekey_private, state,
                created_at_unix_ms, one_time_prekey_high_watermark
             )
             SELECT 1, prekey_id, private_key, 'published', 1,
                    -1
             FROM messaging_prekeys
             WHERE kind = 'signed'
             ON CONFLICT(id) DO NOTHING;
             INSERT INTO messaging_one_time_prekeys(prekey_id, private_key, state)
             SELECT prekey_id, private_key, 'available'
             FROM messaging_prekeys
             WHERE kind = 'one_time'
             ON CONFLICT(prekey_id) DO NOTHING;
             DROP TABLE messaging_prekeys;",
        )?;
    }

    if backend.table_exists("messaging_pending_attachments")?
        || backend.table_exists("messaging_message_attachments")?
    {
        backend.migrate_legacy_attachment_rows()?;
        backend.execute_batch(
            "DROP TABLE IF EXISTS messaging_pending_attachments;
             DROP TABLE IF EXISTS messaging_message_attachments;",
        )?;
    }
    Ok(())
}

fn validate_migrated_schema<B: MessagingSchemaBackend>(backend: &B) -> Result<(), String> {
    let incomplete_membership = backend.query_i64(
        "SELECT COUNT(*) FROM messaging_membership_intents
         WHERE state <> '' AND (
             action <= 0 OR target_ptid = '' OR role = ''
         )",
    )?;
    if incomplete_membership != 0 {
        return Err("messaging membership intent migration is incomplete".to_string());
    }
    let orphan_outbox = backend.query_i64(
        "SELECT COUNT(*) FROM messaging_command_outbox
         WHERE conversation_id = '' OR created_at_unix_ms <= 0",
    )?;
    if orphan_outbox != 0 {
        return Err("messaging command outbox migration is incomplete".to_string());
    }
    Ok(())
}
