pub type ConversationId = String;
pub type MessageId = String;
pub type AttachmentId = String;
pub type DeviceId = String;
pub type Ptid = String;
pub type CachePath = String;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CryptoEndpoint {
    pub ptid: Ptid,
    pub device_id: DeviceId,
}

impl CryptoEndpoint {
    pub fn new(ptid: impl Into<String>, device_id: impl Into<String>) -> Result<Self, String> {
        let endpoint = Self {
            ptid: ptid.into(),
            device_id: device_id.into(),
        };
        endpoint.validate()?;
        Ok(endpoint)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.ptid.trim().is_empty() || self.device_id.trim().is_empty() {
            return Err("crypto endpoint requires PTID and device ID".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub endpoint: CryptoEndpoint,
    pub max_drain_batch: u32,
}

#[derive(Debug, Clone)]
pub struct DrainProgress {
    pub drained_count: u32,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversationKind {
    Direct = 1,
    Group = 2,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationAuthorityMemberProjection {
    pub ptid: Ptid,
    pub role: i32,
    pub home_station_peer_id: String,
    pub muted: bool,
    pub muted_until_unix_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ConversationProjection {
    pub conversation_id: ConversationId,
    pub authority_station_id: String,
    pub federation_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: Ptid,
    pub members: Vec<ConversationAuthorityMemberProjection>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandStatusProjection {
    pub command_id: String,
    pub conversation_id: String,
    pub state: String,
    pub last_error_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationMessageProjection {
    pub event_id: Option<String>,
    pub event_sequence: Option<i64>,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub attachments: Vec<crate::proto::chat::AttachmentPlaintextMetadata>,
    pub state: String,
    pub timestamp_unix_ms: i64,
    pub reply_to_message_id: Option<String>,
    pub thread_root_message_id: Option<String>,
    pub edited_text: Option<String>,
    pub edited_at_unix_ms: Option<i64>,
    pub retracted: bool,
    pub moderated: bool,
    pub moderation_reason_code: Option<String>,
    pub reactions: Vec<(String, String, i64)>,
    pub pinned_by_ptid: Option<String>,
    pub pinned_at_unix_ms: Option<i64>,
    pub read_by_ptids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ConversationStateReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub projection: &'a ConversationProjection,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

#[derive(Debug, Clone)]
pub struct MemberAuthorityReceiveCommit<'a> {
    pub state: ConversationStateReceiveCommit<'a>,
    pub command_id: &'a str,
    pub operator_ptid: &'a str,
    pub operator_device_id: &'a str,
    pub action: i32,
    pub target_ptid: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiveCommitResult {
    Committed,
    AlreadyCommitted,
}

#[derive(Debug, Clone)]
pub struct DeliveryReceiptReceiveCommit<'a> {
    pub item_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub delivery_state: &'a str,
    pub consumed_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandResultDisposition {
    Accepted,
    Failed(String),
    Superseded(String),
}

pub struct CommandResultReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub command_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub disposition: CommandResultDisposition,
    pub consumed_at_unix_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ActorReadReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub reader_ptid: &'a str,
    pub last_read_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct PublicEventReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub sender_ptid: &'a str,
    pub sender_device_id: &'a str,
    pub attachments: &'a [crate::proto::chat::EncryptedObjectDescriptor],
    pub reply_to_message_id: Option<&'a str>,
    pub thread_root_message_id: Option<&'a str>,
    pub committed_at_unix_ms: i64,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub enum InteractionMutation<'a> {
    ObserveOnly,
    Edit {
        edited_text: &'a str,
        edited_at_unix_ms: i64,
    },
    Retract,
    HideForActor,
    Moderate {
        moderator_ptid: &'a str,
        reason_code: &'a str,
        moderated_at_unix_ms: i64,
    },
    Reaction {
        actor_ptid: &'a str,
        reaction: &'a str,
        removed: bool,
        created_at_unix_ms: i64,
    },
    Pin {
        actor_ptid: &'a str,
        removed: bool,
        pinned_at_unix_ms: i64,
    },
}

pub struct InteractionReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub message_id: &'a str,
    pub mutation: InteractionMutation<'a>,
    pub mls_session_state: Option<&'a [u8]>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsConversationProjection {
    pub conversation_id: String,
    pub authority_station_id: String,
    pub federation_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: String,
    pub members: Vec<ConversationAuthorityMemberProjection>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsMessageProjection {
    pub conversation_id: String,
    pub event_id: String,
    pub event_sequence: i64,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub attachments: Vec<crate::proto::chat::AttachmentPlaintextMetadata>,
    pub committed_at_unix_ms: i64,
    pub reply_to_message_id: Option<String>,
    pub thread_root_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMlsTransitionState {
    pub transition_id: String,
    pub command_id: String,
    pub state: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMlsKeyPackage {
    pub package_id: String,
    pub data: Vec<u8>,
}

pub struct MlsApplicationReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub projection: &'a MlsMessageProjection,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct MlsTransitionReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub transition_id: &'a str,
    pub transition_kind: i32,
    pub session_state: &'a [u8],
    pub provider_pool_state: Option<&'a [u8]>,
    pub from_membership_epoch: i64,
    pub to_membership_epoch: i64,
    pub from_mls_epoch: i64,
    pub to_mls_epoch: i64,
    pub authority_projection: &'a MlsConversationProjection,
    pub allow_join_checkpoint: bool,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct MlsSenderTransitionReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub command_id: &'a str,
    pub transition_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub authority_projection: &'a MlsConversationProjection,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct MlsRetirementReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub event_sequence: i64,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub transition_id: &'a str,
    pub endpoint_ptid: &'a str,
    pub endpoint_device_id: &'a str,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub projection: &'a MlsConversationProjection,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

#[derive(Debug, Clone)]
pub struct MessageProjection {
    pub message_id: MessageId,
    pub conversation_id: ConversationId,
    pub kind: ConversationKind,
    pub sender_ptid: Ptid,
    pub sender_device_id: DeviceId,
    pub plaintext: String,
    pub timestamp_unix_ms: i64,
    pub event_id: String,
    pub event_sequence: i64,
    pub state: MessageState,
    pub attachments: Vec<AttachmentProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageState {
    Delivered,
    Restored,
    Pending,
    Failed,
}

#[derive(Debug, Clone)]
pub struct AttachmentProjection {
    pub attachment_id: AttachmentId,
    pub filename: String,
    pub mime_type: String,
    pub plaintext_size: u64,
    pub ciphertext_size: u64,
    pub availability_state: AttachmentAvailability,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentAvailability {
    Local,
    Remote,
    Downloading,
    Failed,
}

#[derive(Debug, Clone)]
pub struct DirectMessageContent {
    pub conversation_id: ConversationId,
    pub event_id: String,
    pub event_sequence: i64,
    pub message_id: MessageId,
    pub sender_ptid: Ptid,
    pub sender_device_id: DeviceId,
    pub plaintext: String,
    pub attachments: Vec<crate::proto::chat::AttachmentPlaintextMetadata>,
    pub committed_at_unix_ms: i64,
    pub reply_to_message_id: Option<String>,
    pub thread_root_message_id: Option<String>,
}

pub struct DirectReceiveCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub session: &'a crate::crypto::session::DirectSession,
    pub new_skipped: &'a [crate::crypto::double_ratchet::DrSkippedMessageKey],
    pub consumed_skipped: Option<([u8; 32], u32)>,
    pub consumed_one_time_prekey_id: Option<i32>,
    pub projection: &'a DirectMessageContent,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub delivery_receipt_id: &'a str,
    pub delivery_receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}

pub struct DirectEditCommit<'a> {
    pub item_id: &'a str,
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub payload_sha256: &'a [u8],
    pub event_hash: &'a [u8],
    pub previous_event_hash: &'a [u8],
    pub event_sequence: i64,
    pub session: &'a crate::crypto::session::DirectSession,
    pub new_skipped: &'a [crate::crypto::double_ratchet::DrSkippedMessageKey],
    pub consumed_skipped: Option<([u8; 32], u32)>,
    pub consumed_one_time_prekey_id: Option<i32>,
    pub message_id: &'a str,
    pub edited_text: &'a str,
    pub edited_at_unix_ms: i64,
    pub receipt_id: &'a str,
    pub receipt_bytes: &'a [u8],
    pub delivery_receipt_id: &'a str,
    pub delivery_receipt_bytes: &'a [u8],
    pub consumed_at_unix_ms: i64,
}
