// Schema migration for the command ledger SQLite database.
//
// Each migration is an idempotent SQL block guarded by a version
// number in the `schema_version` table.  New migrations are appended
// to the `MIGRATIONS` array; the runner applies them in order and
// is safe to call on every startup.

use rusqlite::Connection;

use crate::error::{MobileError, MobileResult};

/// A single migration step.
struct Migration {
    version: u32,
    description: &'static str,
    sql: &'static str,
}

/// Ordered list of all schema migrations.
/// Append-only: never reorder or delete entries.
const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    description: "initial command ledger schema",
    sql: "
        CREATE TABLE IF NOT EXISTS command_entries (
            id              TEXT PRIMARY KEY NOT NULL,
            category        TEXT NOT NULL,
            command_type    TEXT NOT NULL,
            ordering_key    TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            payload_blob    BLOB NOT NULL,
            created_at_ms   INTEGER NOT NULL,
            updated_at_ms   INTEGER NOT NULL,
            attempt_count   INTEGER NOT NULL DEFAULT 0,
            failure_reason  TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_command_entries_status
            ON command_entries(status);

        CREATE INDEX IF NOT EXISTS idx_command_entries_category_status
            ON command_entries(category, status);

        CREATE INDEX IF NOT EXISTS idx_command_entries_ordering_key
            ON command_entries(ordering_key, created_at_ms);
    ",
}];

/// Run all pending migrations against `conn`.
///
/// Creates the `schema_version` tracking table if it does not exist,
/// then applies each migration whose version is higher than the
/// current stored version.
pub fn run_migrations(conn: &Connection) -> MobileResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            id      INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);",
    )
    .map_err(|e| MobileError::ledger(format!("failed to create schema_version table: {e}")))?;

    let current_version: u32 = conn
        .query_row(
            "SELECT version FROM schema_version WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| MobileError::ledger(format!("failed to read schema version: {e}")))?;

    for migration in MIGRATIONS {
        if migration.version <= current_version {
            continue;
        }

        log::info!(
            "command_ledger: applying migration v{} — {}",
            migration.version,
            migration.description,
        );

        conn.execute_batch(migration.sql).map_err(|e| {
            MobileError::ledger(format!("migration v{} failed: {e}", migration.version,))
        })?;

        conn.execute(
            "UPDATE schema_version SET version = ?1 WHERE id = 1",
            [migration.version],
        )
        .map_err(|e| {
            MobileError::ledger(format!(
                "failed to update schema version to {}: {e}",
                migration.version,
            ))
        })?;
    }

    Ok(())
}
