use crate::inbox::{
    ClaimedItemConsumer, CommandResultLifecycle, CommandResultProcessor, CommandResultRepository,
    ConversationStateProcessor, DeliveryReceiptProcessor, DirectMessageProcessor,
    PublicEventProcessor,
};
use crate::proto::chat::{
    conversation_event, DeviceEventDelivery, DeviceInboxPayloadType, DurableDeviceInboxItem,
    PreparedEndpointPayloadKind,
};
use crate::store::MessagingRepository;
use prost::Message;
use std::sync::Arc;

pub fn is_mls_sender_public_event(delivery: &DeviceEventDelivery) -> bool {
    matches!(
        delivery
            .event
            .as_ref()
            .and_then(|event| event.payload.as_ref()),
        Some(
            conversation_event::Payload::MembershipTransitionCommitted(_)
                | conversation_event::Payload::ConversationCreated(_)
        )
    )
}

pub trait MlsItemConsumer: Send + Sync {
    fn consume_application(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String>;
    fn consume_transition(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String>;
    fn consume_retirement(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String>;
    fn consume_sender_transition(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String>;
}

pub struct MessagingItemConsumer<
    R: MessagingRepository + CommandResultRepository,
    M: MlsItemConsumer + CommandResultLifecycle,
> {
    direct: DirectMessageProcessor<R>,
    mls: Arc<M>,
    public_event: PublicEventProcessor<R>,
    conversation_state: ConversationStateProcessor<R>,
    command_result: CommandResultProcessor<R, M>,
    delivery_receipt: DeliveryReceiptProcessor<R>,
}

impl<R, M> MessagingItemConsumer<R, M>
where
    R: MessagingRepository + CommandResultRepository,
    M: MlsItemConsumer + CommandResultLifecycle,
{
    pub fn new(
        direct: DirectMessageProcessor<R>,
        mls: Arc<M>,
        public_event: PublicEventProcessor<R>,
        conversation_state: ConversationStateProcessor<R>,
        command_result: CommandResultProcessor<R, M>,
        delivery_receipt: DeliveryReceiptProcessor<R>,
    ) -> Self {
        Self {
            direct,
            mls,
            public_event,
            conversation_state,
            command_result,
            delivery_receipt,
        }
    }
}

impl<R, M> ClaimedItemConsumer for MessagingItemConsumer<R, M>
where
    R: MessagingRepository + CommandResultRepository,
    M: MlsItemConsumer + CommandResultLifecycle,
{
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        let payload_type = DeviceInboxPayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging queue payload type is invalid".to_string())?;
        if payload_type == DeviceInboxPayloadType::DeviceReceipt {
            return self.delivery_receipt.consume(item, consumer_epoch);
        }
        if payload_type == DeviceInboxPayloadType::CommandResult {
            return self.command_result.consume(item, consumer_epoch);
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
                self.mls.consume_application(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::MlsCommit | PreparedEndpointPayloadKind::MlsWelcome => {
                self.mls.consume_transition(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::MlsRetirement => {
                self.mls.consume_retirement(item, consumer_epoch)
            }
            PreparedEndpointPayloadKind::PublicEvent => {
                if is_mls_sender_public_event(&delivery) {
                    self.mls.consume_sender_transition(item, consumer_epoch)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::chat::{
        ConversationCreatedFact, ConversationEvent, MembershipTransitionCommittedFact,
        MessageCommittedFact,
    };

    #[test]
    fn group_creation_and_membership_events_use_mls_sender_processing() {
        for payload in [
            conversation_event::Payload::ConversationCreated(ConversationCreatedFact::default()),
            conversation_event::Payload::MembershipTransitionCommitted(
                MembershipTransitionCommittedFact::default(),
            ),
        ] {
            let delivery = DeviceEventDelivery {
                event: Some(ConversationEvent {
                    payload: Some(payload),
                    ..Default::default()
                }),
                ..Default::default()
            };
            assert!(is_mls_sender_public_event(&delivery));
        }

        let message = DeviceEventDelivery {
            event: Some(ConversationEvent {
                payload: Some(conversation_event::Payload::MessageCommitted(
                    MessageCommittedFact::default(),
                )),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(!is_mls_sender_public_event(&message));
    }
}
