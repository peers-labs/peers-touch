use crate::inbox::{
    ClaimedItemConsumer, ConversationStateProcessor, DeliveryReceiptProcessor,
    DirectMessageProcessor, PublicEventProcessor,
};
use crate::proto::chat::{
    conversation_event, DeviceEventDelivery, DeviceQueueItem, DeviceQueuePayloadType,
    PreparedEndpointPayloadKind,
};
use crate::store::MessagingRepository;
use prost::Message;
use std::sync::Arc;

pub trait MlsItemConsumer: Send + Sync {
    fn consume_application(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String>;
    fn consume_transition(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String>;
    fn consume_retirement(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String>;
    fn consume_sender_transition(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String>;
}

pub struct MessagingItemConsumer<R: MessagingRepository, M: MlsItemConsumer> {
    direct: DirectMessageProcessor<R>,
    mls: Arc<M>,
    public_event: PublicEventProcessor<R>,
    conversation_state: ConversationStateProcessor<R>,
    delivery_receipt: DeliveryReceiptProcessor<R>,
}

impl<R: MessagingRepository, M: MlsItemConsumer> MessagingItemConsumer<R, M> {
    pub fn new(
        direct: DirectMessageProcessor<R>,
        mls: Arc<M>,
        public_event: PublicEventProcessor<R>,
        conversation_state: ConversationStateProcessor<R>,
        delivery_receipt: DeliveryReceiptProcessor<R>,
    ) -> Self {
        Self {
            direct,
            mls,
            public_event,
            conversation_state,
            delivery_receipt,
        }
    }
}

impl<R: MessagingRepository, M: MlsItemConsumer> ClaimedItemConsumer
    for MessagingItemConsumer<R, M>
{
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        let payload_type = DeviceQueuePayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging queue payload type is invalid".to_string())?;
        if payload_type == DeviceQueuePayloadType::DeviceReceipt {
            return self.delivery_receipt.consume(item, consumer_epoch);
        }
        if payload_type != DeviceQueuePayloadType::ConversationEvent {
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
                self.mls.consume_application(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::MlsCommit | PreparedEndpointPayloadKind::MlsWelcome => {
                self.mls.consume_transition(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::MlsRetirement => {
                self.mls.consume_retirement(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::PublicEvent => {
                match delivery
                    .event
                    .as_ref()
                    .and_then(|event| event.payload.as_ref())
                {
                    Some(conversation_event::Payload::MembershipTransitionCommitted(_)) => {
                        self.mls.consume_sender_transition(item, consumer_epoch)
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
