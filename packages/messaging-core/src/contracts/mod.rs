pub type ConversationId = String;
pub type MessageId = String;
pub type AttachmentId = String;
pub type DeviceId = String;
pub type Ptid = String;
pub type CachePath = String;

#[derive(Debug, Clone)]
pub struct CryptoEndpoint {
    pub ptid: Ptid,
    pub device_id: DeviceId,
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

#[derive(Debug, Clone)]
pub struct ConversationProjection {
    pub conversation_id: ConversationId,
    pub authority_station_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: Ptid,
    pub member_ptids: Vec<Ptid>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
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
    Edit {
        edited_text: &'a str,
        edited_at_unix_ms: i64,
    },
    Retract,
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
