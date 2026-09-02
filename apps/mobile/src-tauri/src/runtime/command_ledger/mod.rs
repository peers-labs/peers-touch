// Command Ledger — Mobile InteractionAdmission persistence layer.
//
// The ledger is the single durable store for all user-initiated
// commands that mutate server state.  It provides:
//
// 1. **Per-key ordering** — commands with the same `ordering_key`
//    are dispatched in submission order.
// 2. **Four-key fairness** — round-robin across Chat / Social /
//    Moments / System categories prevents starvation.
// 3. **Capacity limits** — hard cap on total entries to bound
//    storage and memory usage.
// 4. **Crash recovery** — pending entries are promoted to `Unknown`
//    on startup so the UI can surface recovery prompts.
// 5. **Encrypted at rest** — payloads are AES-256-GCM encrypted
//    with a key derived from the actor's session secret.
//
// The TypeScript `commandRuntime` interacts with this module
// exclusively through Tauri commands registered in `commands/ledger.rs`.

pub mod entry;
pub mod fairness;
mod migration;
pub mod storage;

use std::path::PathBuf;
use std::sync::Mutex;

use self::entry::{
    CommandEntry, CommandProjection, CommandStatus, TypedCommandEnvelope,
};
use self::fairness::FairScheduler;
use self::storage::LedgerStorage;
use crate::error::{MobileError, MobileResult};

/// Top-level command ledger managed as Tauri application state.
///
/// Thread-safety: the inner `Mutex` serializes all access.  This is
/// acceptable because ledger operations are fast (single SQLite writes)
/// and contention is low (UI thread + background dispatch thread).
pub struct CommandLedger {
    inner: Mutex<Option<LedgerInner>>,
}

struct LedgerInner {
    storage: LedgerStorage,
    scheduler: FairScheduler,
}

impl CommandLedger {
    /// Create an uninitialized ledger.
    ///
    /// Call `initialize` after the actor session is established and an
    /// encryption secret is available.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Initialize the ledger with a database path and encryption secret.
    ///
    /// Opens (or creates) the SQLite database, runs migrations,
    /// performs crash recovery, and loads pending entries into the
    /// fair scheduler.
    pub fn initialize(&self, db_dir: &PathBuf, encryption_secret: &[u8]) -> MobileResult<()> {
        let db_path = db_dir.join("command_ledger.db");

        let storage = LedgerStorage::open(&db_path, encryption_secret)?;

        // Load pending and unknown entries into the fair scheduler
        // so they are visible to dispatch immediately.
        let mut scheduler = FairScheduler::new();
        for entry in storage.list_by_status(CommandStatus::Pending)? {
            scheduler.enqueue(entry);
        }
        for entry in storage.list_by_status(CommandStatus::Unknown)? {
            scheduler.enqueue(entry);
        }

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        *guard = Some(LedgerInner { storage, scheduler });

        log::info!("command_ledger: initialized");
        Ok(())
    }

    /// Admit a new command into the ledger.
    ///
    /// Assigns a unique ID, persists the entry, and enqueues it for
    /// fair dispatch.  Returns the assigned command ID.
    pub fn admit(&self, envelope: TypedCommandEnvelope) -> MobileResult<String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        let inner = guard
            .as_mut()
            .ok_or_else(|| MobileError::ledger("ledger not initialized".to_string()))?;

        let now_ms = current_time_ms();
        let id = generate_command_id();

        let entry = CommandEntry {
            id: id.clone(),
            category: envelope.category,
            command_type: envelope.command_type,
            ordering_key: envelope.ordering_key,
            status: CommandStatus::Pending,
            payload_json: envelope.payload_json,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
            attempt_count: 0,
            failure_reason: None,
        };

        inner.storage.insert(&entry)?;
        inner.scheduler.enqueue(entry);

        log::info!("command_ledger: admitted command {id}");
        Ok(id)
    }

    /// Mark a command as successfully committed by the Station.
    pub fn mark_committed(&self, id: &str) -> MobileResult<()> {
        self.update_status(id, CommandStatus::Committed, None)
    }

    /// Mark a command as failed with a reason.
    pub fn mark_failed(&self, id: &str, reason: &str) -> MobileResult<()> {
        self.update_status(id, CommandStatus::Failed, Some(reason))
    }

    /// Readback: return projections of all non-committed entries
    /// for a given ordering key.
    ///
    /// Used by the UI to overlay pending/failed/unknown indicators
    /// on the conversation timeline.
    pub fn readback(&self, ordering_key: &str) -> MobileResult<Vec<CommandProjection>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::ledger("ledger not initialized".to_string()))?;

        let entries = inner.storage.list_by_ordering_key(ordering_key, None)?;
        Ok(entries
            .iter()
            .filter(|e| e.status != CommandStatus::Committed)
            .map(CommandProjection::from)
            .collect())
    }

    /// Readback all entries with a specific status.
    pub fn readback_by_status(&self, status: CommandStatus) -> MobileResult<Vec<CommandProjection>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::ledger("ledger not initialized".to_string()))?;

        let entries = inner.storage.list_by_status(status)?;
        Ok(entries.iter().map(CommandProjection::from).collect())
    }

    /// Dequeue the next command for dispatch using fair scheduling.
    pub fn next_for_dispatch(&self) -> MobileResult<Option<CommandEntry>> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        let inner = guard
            .as_mut()
            .ok_or_else(|| MobileError::ledger("ledger not initialized".to_string()))?;

        Ok(inner.scheduler.next())
    }

    /// Purge all committed entries to reclaim storage.
    pub fn purge_committed(&self) -> MobileResult<usize> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::ledger("ledger not initialized".to_string()))?;

        inner.storage.purge_by_status(CommandStatus::Committed)
    }

    /// Shutdown the ledger, releasing the database connection.
    pub fn shutdown(&self) -> MobileResult<()> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        *guard = None;
        log::info!("command_ledger: shut down");
        Ok(())
    }

    /// Count entries with a given status string.
    ///
    /// Used by the background reconciliation bridge to build a report
    /// without materializing full entries.
    pub fn count_by_status(&self, status_str: &str) -> MobileResult<u64> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        let inner = match guard.as_ref() {
            Some(inner) => inner,
            // Ledger not initialized — report zero counts
            None => return Ok(0),
        };

        let status = match CommandStatus::from_str(status_str) {
            Some(s) => s,
            None => return Ok(0),
        };

        let entries = inner.storage.list_by_status(status)?;
        Ok(entries.len() as u64)
    }

    fn update_status(
        &self,
        id: &str,
        status: CommandStatus,
        reason: Option<&str>,
    ) -> MobileResult<()> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::ledger("ledger lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::ledger("ledger not initialized".to_string()))?;

        inner.storage.update_status(id, status, reason)?;
        log::info!(
            "command_ledger: command {id} transitioned to {}",
            status.as_str(),
        );
        Ok(())
    }
}

fn generate_command_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
