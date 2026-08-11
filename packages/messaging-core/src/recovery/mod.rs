pub mod codec;
pub mod types;

pub use codec::{decode_recovery_revision, encode_recovery_revision, validate_archive};
pub use types::{
    EncodedRecoveryRevision, MessagingRecoveryArchive, RecoveryAttachmentMetadata,
    RecoveryConversationProjection, RecoveryMessageProjection, RecoveryTrustRecord,
    MESSAGING_RECOVERY_FORMAT_VERSION,
};
