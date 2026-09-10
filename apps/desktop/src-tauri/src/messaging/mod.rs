mod attachment;
mod attachment_transfer;
mod command_outbox;
mod command_result;
mod consumer;
mod conversation_state;
mod direct;
mod direct_session;
mod drain;
mod engine;
mod group_genesis;
mod inbox;
mod lifecycle;
mod membership_transition;
mod mls_key_packages;
mod mls_leave_intent;
mod prekeys;
mod private_content;
mod public_event;
mod receipt;
mod recovery;
mod send;
mod store;
mod transport;
mod verification;

pub(crate) fn actor_ref(ptid: &str) -> messaging_core::proto::actor::ActorRef {
    messaging_core::proto::actor::ActorRef {
        ptid: ptid.to_string(),
        ..Default::default()
    }
}

pub(crate) fn actor_device_ref(
    ptid: &str,
    device_id: &str,
) -> messaging_core::proto::actor::ActorDeviceRef {
    messaging_core::proto::actor::ActorDeviceRef {
        actor: Some(actor_ref(ptid)),
        device_id: device_id.to_string(),
    }
}

pub(crate) fn actor_device_parts(
    device: &messaging_core::proto::actor::ActorDeviceRef,
) -> Option<(&str, &str)> {
    let ptid = device.actor.as_ref()?.ptid.as_str();
    if ptid.trim().is_empty() || device.device_id.trim().is_empty() {
        return None;
    }
    Some((ptid, device.device_id.as_str()))
}

pub(crate) fn crypto_endpoint_from_actor_device_ref(
    device: &messaging_core::proto::actor::ActorDeviceRef,
) -> Option<crate::model::chat::CryptoEndpoint> {
    let (ptid, device_id) = actor_device_parts(device)?;
    Some(crate::model::chat::CryptoEndpoint {
        ptid: ptid.to_string(),
        device_id: device_id.to_string(),
    })
}

pub(crate) fn crypto_endpoints_from_actor_device_refs(
    devices: &[messaging_core::proto::actor::ActorDeviceRef],
) -> Option<Vec<crate::model::chat::CryptoEndpoint>> {
    devices
        .iter()
        .map(crypto_endpoint_from_actor_device_ref)
        .collect()
}

pub use attachment::{
    attachment_chunk_aad, attachment_chunk_nonce, decrypt_attachment_chunk,
    encrypt_attachment_chunk, validate_encrypted_object_descriptor,
    validate_encrypted_object_upload_spec, AttachmentCryptoMaterial, EncryptedAttachmentChunk,
};
pub use attachment_transfer::{
    AttachmentRetryPolicy, AttachmentTransferControl, AttachmentTransferFailure,
    AttachmentTransferProgress, AttachmentTransferRecord, AttachmentTransferTransport,
    AttachmentTransferWorker, PreparedAttachmentUpload, StationAttachmentTransferTransport,
    ATTACHMENT_TRANSFER_MEMORY_OVERHEAD,
};
pub use command_outbox::{
    CommandDispatchProgress, CommandOutboxWorker, CommandRetryPolicy, CommandSubmitFailure,
    CommandTransport,
};
pub use command_result::CommandResultProcessor;
pub use consumer::MessagingItemConsumer;
pub use conversation_state::ConversationStateProcessor;
pub use direct::DirectMessageProcessor;
pub use direct_session::{
    DirectSessionBootstrapper, KeyBundleTransport, StationKeyBundleTransport,
};
pub use drain::{
    AcknowledgedItemObserver, ClaimedItemConsumer, ConsumerEpochObserver, DrainProgress,
    QueueDrain, QueueTransport,
};
pub(crate) use engine::now_unix_ms;
pub use engine::{
    EngineEndpoint, EngineRegistry, LocalAttachmentIntent, MessagingEngine,
    MessagingProjectionChange, MessagingProjectionNotifier, MetadataInteraction,
    PreparedGroupConversation, SubmitMessageOutcome,
};
pub use group_genesis::StationGroupGenesisTransport;
pub use inbox::{InboxWorker, QueueAcknowledger};
pub use lifecycle::MessagingLifecycleWorker;
pub use membership_transition::StationMembershipTransitionTransport;
pub use messaging_core::codec::private_content::{
    decode_message_private_content, encode_message_private_content,
    validate_attachment_plaintext_metadata, validate_message_private_content,
    MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
};
pub use messaging_core::crypto::prekeys::PendingPreKeyBundle;
pub use messaging_core::identity::{FreshDeviceEnrollment, INITIAL_ACTOR_IDENTITY_PROFILE_VERSION};
pub use mls_key_packages::StationMlsKeyPackageTransport;
pub use mls_leave_intent::StationMlsLeaveIntentTransport;
pub use prekeys::{PreKeyPublisher, PreKeyTransport, StationPreKeyTransport};
pub use public_event::PublicEventProcessor;
pub use receipt::DeliveryReceiptProcessor;
pub use recovery::{
    decode_recovery_revision, encode_recovery_revision, EncodedRecoveryRevision,
    MessagingRecoveryArchive, RecoveryAttachmentMetadata, RecoveryConversationProjection,
    RecoveryMessageProjection, RecoveryTrustRecord,
};
pub use send::{DirectSessionBootstrap, EditTextIntent, SendPreparer, SendTextIntent};
pub use store::{
    ActorReadReceiveCommit, AttachmentDownloadProjection, CommandOutboxEntry,
    CommandResultDisposition, CommandResultReceiveCommit, CommandStatusProjection,
    ConversationMemberProjection, ConversationMessageProjection, ConversationProjection,
    ConversationStateReceiveCommit, DeliveryReceiptReceiveCommit, DirectEditCommit,
    DirectReceiveCommit, DirectSendCommit, InteractionCommandCommit, MessageProjection,
    MessagingStore, MlsReceiveCommit, MlsRetirementReceiveCommit, MlsSendCommit,
    MlsSenderTransitionReceiveCommit, MlsTransitionReceiveCommit, PendingAttachmentUpload,
    PendingMembershipIntent, PendingMessageDraft, PendingMlsTransitionState,
    PendingSenderProjection, PublicEventReceiveCommit, ReceiveCommitResult, ThreadCountProjection,
};
pub use transport::{
    StationCommandTransport, StationDeliveryReceiptTransport, StationDeviceTransport,
    StationQueueTransport,
};
pub use verification::verify_device_event_delivery;
