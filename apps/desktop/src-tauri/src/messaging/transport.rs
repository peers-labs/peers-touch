use super::{CommandSubmitFailure, CommandTransport, QueueAcknowledger, QueueTransport};
use crate::infrastructure::station_client::{self, StationClientErrorKind};
use crate::model::chat::{
    AcknowledgeDeviceQueueItemRequest, AcknowledgeDeviceQueueItemResponse, ChatCommand,
    ClaimDeviceQueueRequest, ClaimDeviceQueueResponse, EnrollMessagingDeviceRequest,
    EnrollMessagingDeviceResponse, MessageReceipt, MessagingCommandRejectCode,
    PrepareMessagingSendRequest, PrepareMessagingSendResponse, SubmitConversationReceiptRequest,
    SubmitConversationReceiptResponse, SubmitMessagingCommandRequest,
    SubmitMessagingCommandResponse,
};
use prost::Message;
use reqwest::Method;

pub struct StationQueueTransport {
    token: String,
    device_id: String,
}

impl StationQueueTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging queue transport requires token and device ID".to_string());
        }
        Ok(Self { token, device_id })
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

    pub fn submit(&self, receipt: &MessageReceipt) -> Result<(), String> {
        if receipt.conversation_id.trim().is_empty()
            || receipt.message_id.trim().is_empty()
            || receipt.ptid.trim().is_empty()
            || receipt.device_id != self.device_id
        {
            return Err("messaging delivery receipt endpoint mismatch".to_string());
        }
        station_client::request_proto_for_device::<
            SubmitConversationReceiptRequest,
            SubmitConversationReceiptResponse,
        >(
            Method::POST,
            "/messaging/receipt/delivery",
            &self.token,
            None,
            Some(&SubmitConversationReceiptRequest {
                conversation_id: receipt.conversation_id.clone(),
                message_id: receipt.message_id.clone(),
                device_id: receipt.device_id.clone(),
                receipt_type: receipt.receipt_type,
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
        request: &PrepareMessagingSendRequest,
    ) -> Result<PrepareMessagingSendResponse, String> {
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
            "/messaging/command/prepare",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
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
            SubmitMessagingCommandRequest,
            SubmitMessagingCommandResponse,
        >(
            Method::POST,
            "/messaging/command/submit",
            &self.token,
            None,
            Some(&SubmitMessagingCommandRequest {
                command: Some(command.clone()),
            }),
            &self.device_id,
        )
        .map_err(classify_command_transport_error)?;
        let reject_code =
            MessagingCommandRejectCode::try_from(response.reject_code).map_err(|_| {
                CommandSubmitFailure::Terminal {
                    code: "invalid_reject_code".to_string(),
                }
            })?;
        if reject_code != MessagingCommandRejectCode::Unspecified {
            if reject_code == MessagingCommandRejectCode::StaleDeliveryPlan {
                return Err(CommandSubmitFailure::StaleDeliveryPlan {
                    current_plan: response.current_send_plan.ok_or_else(|| {
                        CommandSubmitFailure::Terminal {
                            code: "missing_stale_plan".to_string(),
                        }
                    })?,
                });
            }
            if reject_code == MessagingCommandRejectCode::AuthorityPlanStale
                || reject_code == MessagingCommandRejectCode::AuthorityPlanExpired
            {
                return Err(CommandSubmitFailure::StaleAuthorityPlan {
                    expired: reject_code == MessagingCommandRejectCode::AuthorityPlanExpired,
                });
            }
            return Err(CommandSubmitFailure::Terminal {
                code: match reject_code {
                    MessagingCommandRejectCode::StaleDeliveryPlan => unreachable!(),
                    MessagingCommandRejectCode::AuthorityPlanStale
                    | MessagingCommandRejectCode::AuthorityPlanExpired => unreachable!(),
                    MessagingCommandRejectCode::ConversationState => {
                        "conversation_state".to_string()
                    }
                    MessagingCommandRejectCode::SenderUnauthorized => {
                        "sender_unauthorized".to_string()
                    }
                    MessagingCommandRejectCode::DeliverySet => "delivery_set".to_string(),
                    MessagingCommandRejectCode::UnsupportedCommand => {
                        "unsupported_command".to_string()
                    }
                    MessagingCommandRejectCode::Unspecified => unreachable!(),
                },
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
        request: &EnrollMessagingDeviceRequest,
    ) -> Result<EnrollMessagingDeviceResponse, String> {
        let certificate = request
            .certificate
            .as_ref()
            .ok_or_else(|| "messaging device certificate is required".to_string())?;
        if certificate.device_id != self.device_id {
            return Err("messaging enrollment device does not match engine endpoint".to_string());
        }
        station_client::request_proto_for_device(
            Method::POST,
            "/messaging/device/enroll",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map_err(|error| error.to_string())
    }
}

impl QueueTransport for StationQueueTransport {
    fn claim(
        &self,
        mut request: ClaimDeviceQueueRequest,
    ) -> Result<ClaimDeviceQueueResponse, String> {
        if request.device_id != self.device_id {
            return Err("messaging claim device does not match engine endpoint".to_string());
        }
        request.device_id = self.device_id.clone();
        station_client::request_proto_for_device(
            Method::POST,
            "/messaging/queue/claim",
            &self.token,
            None,
            Some(&request),
            &self.device_id,
        )
        .map_err(|error| error.to_string())
    }

    fn acknowledge(&self, request: AcknowledgeDeviceQueueItemRequest) -> Result<(), String> {
        if request.device_id != self.device_id {
            return Err("messaging ACK device does not match engine endpoint".to_string());
        }
        station_client::request_proto_for_device::<
            AcknowledgeDeviceQueueItemRequest,
            AcknowledgeDeviceQueueItemResponse,
        >(
            Method::POST,
            "/messaging/queue/ack",
            &self.token,
            None,
            Some(&request),
            &self.device_id,
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
            AcknowledgeDeviceQueueItemRequest {
                device_id: self.device_id.clone(),
                item_id: item_id.to_string(),
                lane_sequence,
                consumer_epoch,
                payload_sha256: payload_sha256.to_vec(),
            },
        )
    }
}
