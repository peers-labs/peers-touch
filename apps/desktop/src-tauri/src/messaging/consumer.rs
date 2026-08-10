use super::{
    ClaimedItemConsumer, ConversationStateProcessor, DirectMessageProcessor, EngineEndpoint,
    MessagingStore, MlsApplicationProcessor, MlsRetirementProcessor, MlsSenderTransitionProcessor,
    MlsTransitionProcessor, PublicEventProcessor,
};
use crate::domain::crypto::IdentityKeyPair;
use crate::domain::mls_group::MlsGroupManager;
use crate::model::chat::{
    conversation_event, DeviceEventDelivery, DeviceQueueItem, DeviceQueuePayloadType,
    PreparedEndpointPayloadKind,
};
use prost::Message;
use std::sync::Arc;

pub struct MessagingItemConsumer {
    direct: DirectMessageProcessor,
    mls_application: MlsApplicationProcessor,
    mls_transition: MlsTransitionProcessor,
    mls_retirement: MlsRetirementProcessor,
    public_event: PublicEventProcessor,
    conversation_state: ConversationStateProcessor,
    mls_sender_transition: MlsSenderTransitionProcessor,
}

impl MessagingItemConsumer {
    pub fn new(
        store: Arc<MessagingStore>,
        mls_manager: Arc<MlsGroupManager>,
        endpoint: EngineEndpoint,
        actor_identity: Option<Arc<IdentityKeyPair>>,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        Ok(Self {
            direct: match actor_identity {
                Some(identity) => DirectMessageProcessor::with_actor_identity(
                    store.clone(),
                    endpoint.clone(),
                    identity,
                    clock,
                )?,
                None => DirectMessageProcessor::new(store.clone(), endpoint.clone(), clock)?,
            },
            mls_application: MlsApplicationProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                clock,
            )?,
            mls_transition: MlsTransitionProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                clock,
            )?,
            mls_retirement: MlsRetirementProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                clock,
            )?,
            public_event: PublicEventProcessor::new(store.clone(), endpoint.clone(), clock)?,
            conversation_state: ConversationStateProcessor::new(
                store.clone(),
                endpoint.clone(),
                clock,
            )?,
            mls_sender_transition: MlsSenderTransitionProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                clock,
            )?,
        })
    }
}

impl ClaimedItemConsumer for MessagingItemConsumer {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        if DeviceQueuePayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging queue payload type is invalid".to_string())?
            != DeviceQueuePayloadType::ConversationEvent
        {
            return Err("messaging consumer received unsupported queue payload type".to_string());
        }
        let delivery = DeviceEventDelivery::decode(item.opaque_payload.as_slice())
            .map_err(|_| "messaging consumer delivery payload is invalid".to_string())?;
        match PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging consumer endpoint payload kind is invalid".to_string())?
        {
            PreparedEndpointPayloadKind::DirectCiphertext => {
                self.direct.consume(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::MlsApplication => {
                self.mls_application.consume(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::MlsCommit | PreparedEndpointPayloadKind::MlsWelcome => {
                self.mls_transition.consume(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::MlsRetirement => {
                self.mls_retirement.consume(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::PublicEvent => {
                match delivery
                    .event
                    .as_ref()
                    .and_then(|event| event.payload.as_ref())
                {
                    Some(conversation_event::Payload::MembershipTransitionCommitted(_)) => {
                        self.mls_sender_transition.consume(item, consumer_epoch)
                    }
                    _ => self.public_event.consume(item, consumer_epoch),
                }
            }
            PreparedEndpointPayloadKind::ConversationState => {
                self.conversation_state.consume(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::Unspecified => {
                Err("messaging consumer endpoint payload kind is unsupported".to_string())
            }
        }
    }
}
