// Command entry types for the Mobile InteractionAdmission ledger.
//
// Each user interaction that mutates server state is wrapped in a
// `CommandEntry` before being persisted to the encrypted ledger.
// The `TypedCommandEnvelope` carries domain-specific payloads while
// the ledger itself only sees opaque serialized bytes.

use serde::{Deserialize, Serialize};

/// Categories that partition the fair-scheduling queues.
/// Each category gets equal dispatch opportunity under the four-key
/// fairness policy (see `fairness.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandCategory {
    Chat,
    Social,
    Moments,
    System,
}

impl CommandCategory {
    /// All categories in scheduling order.
    pub const ALL: [CommandCategory; 4] = [
        CommandCategory::Chat,
        CommandCategory::Social,
        CommandCategory::Moments,
        CommandCategory::System,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            CommandCategory::Chat => "chat",
            CommandCategory::Social => "social",
            CommandCategory::Moments => "moments",
            CommandCategory::System => "system",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "chat" => Some(CommandCategory::Chat),
            "social" => Some(CommandCategory::Social),
            "moments" => Some(CommandCategory::Moments),
            "system" => Some(CommandCategory::System),
            _ => None,
        }
    }
}

/// Lifecycle states for a command in the ledger.
///
/// - `Pending`   — admitted but not yet confirmed by Station.
/// - `Committed` — Station acknowledged successful processing.
/// - `Failed`    — Station returned a terminal error; the UI should
///                 surface recovery options.
/// - `Unknown`   — the app crashed or was killed before receiving a
///                 response; crash-recovery marks these on startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Pending,
    Committed,
    Failed,
    Unknown,
}

impl CommandStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            CommandStatus::Pending => "pending",
            CommandStatus::Committed => "committed",
            CommandStatus::Failed => "failed",
            CommandStatus::Unknown => "unknown",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(CommandStatus::Pending),
            "committed" => Some(CommandStatus::Committed),
            "failed" => Some(CommandStatus::Failed),
            "unknown" => Some(CommandStatus::Unknown),
            _ => None,
        }
    }
}

/// A single command persisted in the ledger.
///
/// `ordering_key` provides per-conversation (or per-entity) ordering
/// so that commands targeting the same resource are dispatched in
/// submission order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEntry {
    pub id: String,
    pub category: CommandCategory,
    pub command_type: String,
    pub ordering_key: String,
    pub status: CommandStatus,
    /// Opaque serialized payload (encrypted at rest).
    pub payload_json: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    /// Number of dispatch attempts so far.
    pub attempt_count: u32,
    /// Human-readable failure reason when status is `Failed`.
    pub failure_reason: Option<String>,
}

/// Typed command envelope used by the TypeScript layer to submit
/// commands with domain-specific structure (MS-P06).
///
/// The `payload` is validated on the TS side and arrives as a
/// JSON string; the Rust layer treats it as opaque bytes for
/// storage but validates the outer envelope fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypedCommandEnvelope {
    pub command_type: String,
    pub category: CommandCategory,
    pub ordering_key: String,
    pub payload_json: String,
    /// Optional idempotency token provided by the caller.
    pub idempotency_key: Option<String>,
}

/// Projection of a command entry visible to the UI layer.
/// Stripped of internal bookkeeping fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandProjection {
    pub id: String,
    pub category: CommandCategory,
    pub command_type: String,
    pub ordering_key: String,
    pub status: CommandStatus,
    pub created_at_ms: u64,
    pub attempt_count: u32,
    pub failure_reason: Option<String>,
}

impl From<&CommandEntry> for CommandProjection {
    fn from(entry: &CommandEntry) -> Self {
        Self {
            id: entry.id.clone(),
            category: entry.category,
            command_type: entry.command_type.clone(),
            ordering_key: entry.ordering_key.clone(),
            status: entry.status,
            created_at_ms: entry.created_at_ms,
            attempt_count: entry.attempt_count,
            failure_reason: entry.failure_reason.clone(),
        }
    }
}
