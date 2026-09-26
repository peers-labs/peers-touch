use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const MESSAGING_RECOVERY_FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
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
    #[serde(default)]
    pub federation_id: String,
    pub kind: i32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub avatar_object_id: String,
    pub owner_ptid: String,
    pub member_ptids: Vec<String>,
    #[serde(default)]
    pub member_roles: BTreeMap<String, i32>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
}

impl Zeroize for RecoveryConversationProjection {
    fn zeroize(&mut self) {
        self.conversation_id.zeroize();
        self.authority_station_id.zeroize();
        self.federation_id.zeroize();
        self.kind.zeroize();
        self.name.zeroize();
        self.description.zeroize();
        self.avatar_object_id.zeroize();
        self.owner_ptid.zeroize();
        self.member_ptids.zeroize();
        for (mut ptid, mut role) in std::mem::take(&mut self.member_roles) {
            ptid.zeroize();
            role.zeroize();
        }
        self.membership_epoch.zeroize();
        self.mls_epoch.zeroize();
        self.active.zeroize();
        self.updated_at_unix_ms.zeroize();
    }
}

impl Drop for RecoveryConversationProjection {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl ZeroizeOnDrop for RecoveryConversationProjection {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryAttachmentMetadata {
    pub message_id: String,
    pub attachment_id: String,
    pub metadata: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryTrustRecord {
    pub peer_ptid: String,
    pub fingerprint: String,
    pub verified_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
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
    pub recovery_epoch: u64,
    pub bytes: Vec<u8>,
    pub sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedRecoveryRevision {
    pub recovery_epoch: u64,
    pub archive: MessagingRecoveryArchive,
}
