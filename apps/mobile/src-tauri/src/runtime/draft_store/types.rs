// Draft types for the encrypted draft store (MS-P08).
//
// Drafts are transient user-authored content (unsent messages,
// unfinished moment posts) that must survive app restarts but are
// not commands — they have no submission lifecycle.

use serde::{Deserialize, Serialize};

/// Envelope kind so the store can discriminate draft payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraftKind {
    Chat,
    Moments,
}

impl DraftKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            DraftKind::Chat => "chat",
            DraftKind::Moments => "moments",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "chat" => Some(DraftKind::Chat),
            "moments" => Some(DraftKind::Moments),
            _ => None,
        }
    }
}

/// A chat draft tied to a specific conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDraft {
    /// Conversation identifier (e.g. "friend:<ulid>" or "group:<ulid>").
    pub conversation_key: String,
    /// Draft text content.
    pub text: String,
    /// Optional reply-to message ID.
    pub reply_to_message_id: Option<String>,
    /// Serialized attachment metadata (opaque JSON array).
    pub attachments_json: Option<String>,
    pub updated_at_ms: u64,
}

/// A moments draft for a post in progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MomentsDraft {
    /// Client-generated draft identifier.
    pub draft_id: String,
    /// Post text content.
    pub text: String,
    /// Serialized media references (opaque JSON array).
    pub media_json: Option<String>,
    /// Visibility setting key.
    pub visibility: String,
    pub updated_at_ms: u64,
}

/// Unified draft entry stored in the database.
///
/// The `payload_json` holds the serialized `ChatDraft` or
/// `MomentsDraft`, encrypted at rest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftEntry {
    /// Composite key: `{kind}:{domain_key}`.
    pub key: String,
    pub kind: DraftKind,
    pub payload_json: String,
    pub updated_at_ms: u64,
}

/// Projection returned to the TypeScript layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftProjection {
    pub key: String,
    pub kind: DraftKind,
    pub payload_json: String,
    pub updated_at_ms: u64,
}

impl From<&DraftEntry> for DraftProjection {
    fn from(entry: &DraftEntry) -> Self {
        Self {
            key: entry.key.clone(),
            kind: entry.kind,
            payload_json: entry.payload_json.clone(),
            updated_at_ms: entry.updated_at_ms,
        }
    }
}
