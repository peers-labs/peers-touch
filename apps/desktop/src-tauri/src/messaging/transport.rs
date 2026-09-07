use super::{CommandSubmitFailure, CommandTransport, QueueAcknowledger, QueueTransport};
use crate::infrastructure::station_client::{self, StationClientErrorKind};
use crate::model::chat::{
    submit_conversation_authority_command_request, AcknowledgeDeviceInboxItemRequest,
    AcknowledgeDeviceInboxItemResponse, ChatCommand, ClaimDeviceInboxRequest,
    ClaimDeviceInboxResponse, ConversationCommandRejectCode, DeviceConsumptionReceipt,
    PrepareConversationCommandRequest, PrepareConversationCommandResponse,
    SubmitConversationAuthorityCommandRequest, SubmitConversationAuthorityCommandResponse,
    SubmitConversationDeliveryReceiptRequest, SubmitConversationDeliveryReceiptResponse,
    SubmitConversationTypingRequest, SubmitConversationTypingResponse,
};
use messaging_core::identity::DeviceEnrollmentTransport;
use messaging_core::proto::actor::{
    ActorDeviceRef, EnrollActorDeviceRequest, EnrollActorDeviceResponse,
};
use messaging_core::proto::actor_device_ptid;
use prost::Message;
use reqwest::Method;

pub struct StationQueueTransport {
    token: String,
    device: ActorDeviceRef,
}

impl StationQueueTransport {
    pub fn new(token: String, device: ActorDeviceRef) -> Result<Self, String> {
        if token.trim().is_empty()
            || actor_device_ptid(&device).is_err()
            || device.device_id.trim().is_empty()
        {
            return Err("messaging queue transport requires token and device ID".to_string());
        }
        Ok(Self { token, device })
    }
}

pub struct StationDeviceTransport {
    token: String,
    device_id: String,
}

pub struct StationCommandTransport {
    token: String,
    device_id: String,
}

pub struct StationDeliveryReceiptTransport {
    token: String,
    device_id: String,
}

impl StationDeliveryReceiptTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err(
                "messaging delivery receipt transport requires token and device ID".to_string(),
            );
        }
        Ok(Self { token, device_id })
    }

    pub fn submit(&self, receipt: &DeviceConsumptionReceipt) -> Result<(), String> {
        let consumer = receipt
            .consumer
            .as_ref()
            .ok_or_else(|| "messaging delivery receipt consumer is missing".to_string())?;
        if receipt.conversation_id.trim().is_empty()
            || receipt.event_id.trim().is_empty()
            || receipt.receipt_id.trim().is_empty()
            || receipt.event_sequence <= 0
            || receipt.lane_sequence <= 0
            || receipt.payload_sha256.len() != 32
            || receipt.consumed_at.is_none()
            || consumer.ptid.trim().is_empty()
            || consumer.device_id != self.device_id
        {
            return Err("messaging delivery receipt endpoint mismatch".to_string());
        }
        station_client::request_proto_for_device::<
            SubmitConversationDeliveryReceiptRequest,
            SubmitConversationDeliveryReceiptResponse,
        >(
            Method::POST,
            "/conversation/delivery/receipt",
            &self.token,
            None,
            Some(&SubmitConversationDeliveryReceiptRequest {
                receipt: Some(receipt.clone()),
            }),
            &self.device_id,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

impl StationCommandTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging command transport requires token and device ID".to_string());
        }
        Ok(Self { token, device_id })
    }

    pub fn prepare_send(
        &self,
        request: &PrepareConversationCommandRequest,
    ) -> Result<PrepareConversationCommandResponse, String> {
        if request
            .sender
            .as_ref()
            .map(|sender| sender.device_id.as_str())
            != Some(self.device_id.as_str())
        {
            return Err("messaging send preparation endpoint mismatch".to_string());
        }
        station_client::request_proto_for_device(
            Method::POST,
            "/conversation/command/prepare",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map_err(|error| error.to_string())
    }

    pub fn submit_typing(&self, request: &SubmitConversationTypingRequest) -> Result<(), String> {
        if request.conversation_id.trim().is_empty()
            || request.pulse_generation == 0
            || request.expires_at.is_none()
            || request
                .sender
                .as_ref()
                .map(|sender| sender.device_id.as_str())
                != Some(self.device_id.as_str())
        {
            return Err("messaging typing endpoint binding mismatch".to_string());
        }
        station_client::request_proto_for_device::<
            SubmitConversationTypingRequest,
            SubmitConversationTypingResponse,
        >(
            Method::POST,
            "/conversation/typing",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

impl CommandTransport for StationCommandTransport {
    fn submit(&self, exact_command_bytes: &[u8]) -> Result<(), CommandSubmitFailure> {
        let command = ChatCommand::decode(exact_command_bytes).map_err(|_| {
            CommandSubmitFailure::Terminal {
                code: "invalid_command".to_string(),
            }
        })?;
        let sender = command
            .sender
            .as_ref()
            .ok_or_else(|| CommandSubmitFailure::Terminal {
                code: "missing_sender".to_string(),
            })?;
        if sender.device_id != self.device_id {
            return Err(CommandSubmitFailure::Terminal {
                code: "endpoint_mismatch".to_string(),
            });
        }
        let response = station_client::request_proto_for_device::<
            SubmitConversationAuthorityCommandRequest,
            SubmitConversationAuthorityCommandResponse,
        >(
            Method::POST,
            "/conversation/command",
            &self.token,
            None,
            Some(&SubmitConversationAuthorityCommandRequest {
                submission: Some(
                    submit_conversation_authority_command_request::Submission::Command(
                        command.clone(),
                    ),
                ),
            }),
            &self.device_id,
        )
        .map_err(classify_command_transport_error)?;
        let reject_code =
            ConversationCommandRejectCode::try_from(response.reject_code).map_err(|_| {
                CommandSubmitFailure::Terminal {
                    code: "invalid_reject_code".to_string(),
                }
            })?;
        if reject_code != ConversationCommandRejectCode::Unspecified {
            if reject_code == ConversationCommandRejectCode::StaleDeliveryPlan {
                return Err(CommandSubmitFailure::StaleDeliveryPlan {
                    current_plan: response.current_plan.ok_or_else(|| {
                        CommandSubmitFailure::Terminal {
                            code: "missing_stale_plan".to_string(),
                        }
                    })?,
                });
            }
            if reject_code == ConversationCommandRejectCode::AuthorityPlanStale
                || reject_code == ConversationCommandRejectCode::AuthorityPlanExpired
            {
                return Err(CommandSubmitFailure::StaleAuthorityPlan {
                    expired: reject_code == ConversationCommandRejectCode::AuthorityPlanExpired,
                });
            }
            return Err(CommandSubmitFailure::Terminal {
                code: reject_code
                    .as_str_name()
                    .strip_prefix("CONVERSATION_COMMAND_REJECT_CODE_")
                    .unwrap_or("UNKNOWN")
                    .to_ascii_lowercase(),
            });
        }
        if response.accepted_for_forwarding {
            return Ok(());
        }
        let event = response
            .event
            .ok_or_else(|| CommandSubmitFailure::Terminal {
                code: "missing_event".to_string(),
            })?;
        if event.command_id != command.command_id
            || event.conversation_id != command.conversation_id
            || event.actor != command.sender
        {
            return Err(CommandSubmitFailure::Terminal {
                code: "response_binding".to_string(),
            });
        }
        Ok(())
    }
}

fn classify_command_transport_error(
    error: crate::infrastructure::station_client::StationClientError,
) -> CommandSubmitFailure {
    match error.kind {
        StationClientErrorKind::Network => CommandSubmitFailure::Retryable {
            code: "network".to_string(),
        },
        StationClientErrorKind::HttpStatus(status)
            if status == 408 || status == 429 || status >= 500 =>
        {
            CommandSubmitFailure::Retryable {
                code: format!("http_{status}"),
            }
        }
        StationClientErrorKind::HttpStatus(status) => CommandSubmitFailure::Terminal {
            code: format!("http_{status}"),
        },
        StationClientErrorKind::SessionRevoked => CommandSubmitFailure::Terminal {
            code: "session_revoked".to_string(),
        },
        StationClientErrorKind::Decode | StationClientErrorKind::InvalidResponse => {
            CommandSubmitFailure::Terminal {
                code: "invalid_response".to_string(),
            }
        }
    }
}

impl StationDeviceTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging device transport requires token and device ID".to_string());
        }
        Ok(Self { token, device_id })
    }

    pub fn enroll(
        &self,
        request: &EnrollActorDeviceRequest,
    ) -> Result<EnrollActorDeviceResponse, String> {
        let certificate = request
            .certificate
            .as_ref()
            .ok_or_else(|| "messaging device certificate is required".to_string())?;
        let device = certificate
            .device
            .as_ref()
            .ok_or_else(|| "messaging device certificate endpoint is required".to_string())?;
        actor_device_ptid(device)?;
        if device.device_id != self.device_id {
            return Err("messaging enrollment device does not match engine endpoint".to_string());
        }
        station_client::request_proto_for_device(
            Method::POST,
            "/device/enroll",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map_err(|error| error.to_string())
    }
}

impl DeviceEnrollmentTransport for StationDeviceTransport {
    fn enroll(
        &self,
        request: &EnrollActorDeviceRequest,
    ) -> Result<EnrollActorDeviceResponse, String> {
        StationDeviceTransport::enroll(self, request)
    }
}

impl QueueTransport for StationQueueTransport {
    fn claim(&self, request: ClaimDeviceInboxRequest) -> Result<ClaimDeviceInboxResponse, String> {
        if request.device.as_ref() != Some(&self.device) {
            return Err("messaging claim device does not match engine endpoint".to_string());
        }
        station_client::request_proto_for_device(
            Method::POST,
            "/device/inbox/claim",
            &self.token,
            None,
            Some(&request),
            &self.device.device_id,
        )
        .map_err(|error| error.to_string())
    }

    fn acknowledge(&self, request: AcknowledgeDeviceInboxItemRequest) -> Result<(), String> {
        if request.device.as_ref() != Some(&self.device) {
            return Err("messaging ACK device does not match engine endpoint".to_string());
        }
        station_client::request_proto_for_device::<
            AcknowledgeDeviceInboxItemRequest,
            AcknowledgeDeviceInboxItemResponse,
        >(
            Method::POST,
            "/device/inbox/ack",
            &self.token,
            None,
            Some(&request),
            &self.device.device_id,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

impl QueueAcknowledger for StationQueueTransport {
    fn acknowledge(
        &self,
        item_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
    ) -> Result<(), String> {
        QueueTransport::acknowledge(
            self,
            AcknowledgeDeviceInboxItemRequest {
                device: Some(self.device.clone()),
                item_id: item_id.to_string(),
                lane_sequence,
                consumer_epoch,
                payload_sha256: payload_sha256.to_vec(),
            },
        )
    }
}
