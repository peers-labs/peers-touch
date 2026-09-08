use super::{
    ClaimedItemConsumer, ConversationStateProcessor, DeliveryReceiptProcessor,
    DirectMessageProcessor, EngineEndpoint, MessagingStore, PublicEventProcessor,
};
use crate::domain::crypto::IdentityKeyPair;
use crate::model::chat::{
    DeviceEventDelivery, DeviceInboxPayloadType, DurableDeviceInboxItem,
    PreparedEndpointPayloadKind,
};
use messaging_core::contracts::CryptoEndpoint as CoreCryptoEndpoint;
use messaging_core::inbox::{
    is_mls_sender_public_event, ClaimedItemConsumer as CoreClaimedItemConsumer,
};
use messaging_core::mls::group::MlsGroupManager;
use messaging_core::mls::{
    MlsApplicationProcessor, MlsRetirementProcessor, MlsSenderTransitionProcessor,
    MlsTransitionProcessor,
};
use prost::Message;
use std::sync::Arc;

pub struct MessagingItemConsumer {
    direct: DirectMessageProcessor,
    mls_application: MlsApplicationProcessor<MessagingStore>,
    mls_transition: MlsTransitionProcessor<MessagingStore>,
    mls_retirement: MlsRetirementProcessor<MessagingStore>,
    public_event: PublicEventProcessor,
    conversation_state: ConversationStateProcessor,
    mls_sender_transition: MlsSenderTransitionProcessor<MessagingStore>,
    delivery_receipt: DeliveryReceiptProcessor,
}

impl MessagingItemConsumer {
    pub fn new(
        store: Arc<MessagingStore>,
        mls_manager: Arc<MlsGroupManager>,
        endpoint: EngineEndpoint,
        actor_identity: Option<Arc<IdentityKeyPair>>,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        let mls_endpoint = CoreCryptoEndpoint {
            ptid: endpoint.ptid.clone(),
            device_id: endpoint.device_id.clone(),
        };
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
                mls_endpoint.clone(),
                clock,
            )?,
            mls_transition: MlsTransitionProcessor::new(
                mls_manager.clone(),
                store.clone(),
                mls_endpoint.clone(),
                clock,
            )?,
            mls_retirement: MlsRetirementProcessor::new(
                mls_manager.clone(),
                store.clone(),
                mls_endpoint.clone(),
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
                mls_endpoint,
                clock,
            )?,
            delivery_receipt: DeliveryReceiptProcessor::new(store, endpoint, clock)?,
        })
    }
}

impl ClaimedItemConsumer for MessagingItemConsumer {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        let payload_type = DeviceInboxPayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging queue payload type is invalid".to_string())?;
        if payload_type == DeviceInboxPayloadType::DeviceReceipt {
            return self.delivery_receipt.consume(item, consumer_epoch);
        }
        if payload_type != DeviceInboxPayloadType::ConversationEvent {
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
                if is_mls_sender_public_event(&delivery) {
                    self.mls_sender_transition.consume(item, consumer_epoch)
                } else {
                    self.public_event.consume(item, consumer_epoch)
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
