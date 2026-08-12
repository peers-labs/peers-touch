use serde::{Deserialize, Serialize};

pub const MESSAGING_RECOVERY_FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryMessageProjection {
    pub conversation_id: String,
    pub event_id: String,
    pub event_sequence: i64,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub committed_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryConversationProjection {
    pub conversation_id: String,
    pub authority_station_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: String,
    pub member_ptids: Vec<String>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryAttachmentMetadata {
    pub message_id: String,
    pub attachment_id: String,
    pub metadata: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryTrustRecord {
    pub peer_ptid: String,
    pub fingerprint: String,
    pub verified_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessagingRecoveryArchive {
    pub ptid: String,
    pub actor_identity_seed: [u8; 32],
    pub actor_profile_version: u64,
    pub conversations: Vec<RecoveryConversationProjection>,
    pub messages: Vec<RecoveryMessageProjection>,
    pub attachments: Vec<RecoveryAttachmentMetadata>,
    pub trust: Vec<RecoveryTrustRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedRecoveryRevision {
    pub revision_id: String,
    pub format_version: u32,
    pub bytes: Vec<u8>,
    pub sha256: [u8; 32],
}
