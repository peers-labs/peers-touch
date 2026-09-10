use super::{CommandSubmitFailure, CommandTransport, QueueAcknowledger, QueueTransport};
use crate::infrastructure::station_client::{self, StationClientErrorKind};
use crate::model::chat::{
    chat_command, submit_conversation_authority_command_request, AcknowledgeDeviceInboxItemRequest,
    AcknowledgeDeviceInboxItemResponse, ChatCommand, ClaimDeviceInboxRequest,
    ClaimDeviceInboxResponse, ConversationCommandKind, ConversationCommandProposal,
    ConversationCommandProposalSigningInput, ConversationCommandRejectCode, ConversationKind,
    ConversationPublicHead, ConversationPublicHeadSource, CreateGroupConversationRequest,
    CreateGroupConversationResponse, DeviceConsumptionReceipt, GetConversationPublicHeadRequest,
    GetConversationPublicHeadResponse, PrepareConversationCommandRequest,
    PrepareConversationCommandResponse, SubmitConversationAuthorityCommandRequest,
    SubmitConversationAuthorityCommandResponse, SubmitConversationDeliveryReceiptRequest,
    SubmitConversationDeliveryReceiptResponse, SubmitConversationTypingRequest,
    SubmitConversationTypingResponse,
};
use ed25519_dalek::{Signer, SigningKey};
use messaging_core::identity::DeviceEnrollmentTransport;
use messaging_core::proto::actor::{
    ActorDeviceRef, EnrollActorDeviceRequest, EnrollActorDeviceResponse,
};
use messaging_core::proto::actor_device_ptid;
use prost::Message;
use reqwest::Method;
use sha2::{Digest, Sha256};

const GROUP_CREATION_PATH: &str = "/conversation/group";
const AUTHORITY_COMMAND_PATH: &str = "/conversation/command";
const COMMAND_PROPOSAL_FORMAT_VERSION: u32 = 1;
const COMMAND_PROPOSAL_LIFETIME_MS: i64 = 5 * 60 * 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandSubmissionRoute {
    GroupCreation,
    AuthorityCommand,
}

impl CommandSubmissionRoute {
    fn path(self) -> &'static str {
        match self {
            Self::GroupCreation => GROUP_CREATION_PATH,
            Self::AuthorityCommand => AUTHORITY_COMMAND_PATH,
        }
    }
}

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
    remote_identity: Option<RemoteCommandIdentity>,
}

struct RemoteCommandIdentity {
    actor_ptid: String,
    home_station_peer_id: String,
    signing_key_id: String,
    signing_key: SigningKey,
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
        Ok(Self {
            token,
            device_id,
            remote_identity: None,
        })
    }

    pub fn with_remote_command_identity(
        mut self,
        actor_ptid: String,
        home_station_peer_id: String,
        signing_key_id: String,
        signing_key: SigningKey,
    ) -> Result<Self, String> {
        let expected_signing_key_id =
            hex::encode(Sha256::digest(signing_key.verifying_key().as_bytes()));
        if actor_ptid.trim().is_empty()
            || home_station_peer_id.trim().is_empty()
            || signing_key_id != expected_signing_key_id
        {
            return Err("messaging remote command identity is invalid".to_string());
        }
        self.remote_identity = Some(RemoteCommandIdentity {
            actor_ptid,
            home_station_peer_id,
            signing_key_id,
            signing_key,
        });
        Ok(self)
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

    fn submit_group_creation(&self, command: &ChatCommand) -> Result<(), CommandSubmitFailure> {
        let response = station_client::request_proto_for_device::<
            CreateGroupConversationRequest,
            CreateGroupConversationResponse,
        >(
            Method::POST,
            CommandSubmissionRoute::GroupCreation.path(),
            &self.token,
            None,
            Some(&CreateGroupConversationRequest {
                command: Some(command.clone()),
            }),
            &self.device_id,
        )
        .map_err(classify_command_transport_error)?;
        validate_group_creation_response(command, response)
    }

    fn submit_authority_command(&self, command: &ChatCommand) -> Result<(), CommandSubmitFailure> {
        let identity =
            self.remote_identity
                .as_ref()
                .ok_or_else(|| CommandSubmitFailure::Terminal {
                    code: "missing_remote_command_identity".to_string(),
                })?;
        let submission = if command.authority_station_peer_id == identity.home_station_peer_id {
            submit_conversation_authority_command_request::Submission::Command(command.clone())
        } else {
            submit_conversation_authority_command_request::Submission::Proposal(
                self.build_remote_command_proposal(command, identity)?,
            )
        };
        let response = station_client::request_proto_for_device::<
            SubmitConversationAuthorityCommandRequest,
            SubmitConversationAuthorityCommandResponse,
        >(
            Method::POST,
            CommandSubmissionRoute::AuthorityCommand.path(),
            &self.token,
            None,
            Some(&SubmitConversationAuthorityCommandRequest {
                submission: Some(submission),
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
        validate_committed_event(command, response.event)
    }

    fn build_remote_command_proposal(
        &self,
        command: &ChatCommand,
        identity: &RemoteCommandIdentity,
    ) -> Result<ConversationCommandProposal, CommandSubmitFailure> {
        let query = [("conversation_id", command.conversation_id.clone())];
        let response = station_client::request_proto_for_device::<
            GetConversationPublicHeadRequest,
            GetConversationPublicHeadResponse,
        >(
            Method::GET,
            "/conversation/public-head",
            &self.token,
            Some(&query),
            None,
            &self.device_id,
        )
        .map_err(classify_command_transport_error)?;
        let head = response
            .head
            .ok_or_else(|| CommandSubmitFailure::Terminal {
                code: "missing_conversation_public_head".to_string(),
            })?;
        build_remote_command_proposal(command, identity, &head)
    }
}

impl CommandTransport for StationCommandTransport {
    fn submit(&self, exact_command_bytes: &[u8]) -> Result<(), CommandSubmitFailure> {
        let command = ChatCommand::decode(exact_command_bytes).map_err(|_| {
            CommandSubmitFailure::Terminal {
                code: "invalid_command".to_string(),
            }
        })?;
        if command.encode_to_vec() != exact_command_bytes {
            return Err(CommandSubmitFailure::Terminal {
                code: "non_canonical_command".to_string(),
            });
        }
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
        match command_submission_route(&command) {
            CommandSubmissionRoute::GroupCreation => self.submit_group_creation(&command),
            CommandSubmissionRoute::AuthorityCommand => self.submit_authority_command(&command),
        }
    }
}

fn command_submission_route(command: &ChatCommand) -> CommandSubmissionRoute {
    let Some(chat_command::Payload::MembershipTransition(transition)) = command.payload.as_ref()
    else {
        return CommandSubmissionRoute::AuthorityCommand;
    };
    if command.observed_membership_epoch == 0
        && command.observed_mls_epoch == 0
        && transition.from_membership_epoch == 0
        && transition.from_mls_epoch == 0
        && transition.to_mls_epoch == 1
        && !transition.authority_plan_id.trim().is_empty()
        && !transition.authority_plan_sha256.is_empty()
    {
        CommandSubmissionRoute::GroupCreation
    } else {
        CommandSubmissionRoute::AuthorityCommand
    }
}

fn build_remote_command_proposal(
    command: &ChatCommand,
    identity: &RemoteCommandIdentity,
    head: &ConversationPublicHead,
) -> Result<ConversationCommandProposal, CommandSubmitFailure> {
    let sender = command
        .sender
        .as_ref()
        .ok_or_else(|| CommandSubmitFailure::Terminal {
            code: "missing_sender".to_string(),
        })?;
    if sender.ptid != identity.actor_ptid
        || sender.device_id.is_empty()
        || head.conversation_id != command.conversation_id
        || head.federation_id.trim().is_empty()
        || head.authority_station_peer_id != command.authority_station_peer_id
        || head.authority_station_peer_id == identity.home_station_peer_id
        || head.authority_epoch <= 0
        || ConversationPublicHeadSource::try_from(head.source)
            .ok()
            .filter(|source| *source == ConversationPublicHeadSource::Follower)
            .is_none()
    {
        return Err(CommandSubmitFailure::Terminal {
            code: "remote_route_binding".to_string(),
        });
    }
    let command_kind = command_kind(command).ok_or_else(|| CommandSubmitFailure::Terminal {
        code: "unsupported_command".to_string(),
    })?;
    let created_at_unix_ms =
        command_timestamp_unix_ms(command).ok_or_else(|| CommandSubmitFailure::Terminal {
            code: "invalid_command_timestamp".to_string(),
        })?;
    let expires_at_unix_ms = created_at_unix_ms
        .checked_add(COMMAND_PROPOSAL_LIFETIME_MS)
        .ok_or_else(|| CommandSubmitFailure::Terminal {
            code: "invalid_command_timestamp".to_string(),
        })?;
    let command_bytes = command.encode_to_vec();
    let command_sha256 = Sha256::digest(&command_bytes).to_vec();
    let signing_input = ConversationCommandProposalSigningInput {
        version: COMMAND_PROPOSAL_FORMAT_VERSION,
        federation_id: head.federation_id.clone(),
        authority_station_peer_id: head.authority_station_peer_id.clone(),
        authority_epoch: head.authority_epoch,
        home_station_peer_id: identity.home_station_peer_id.clone(),
        conversation_id: command.conversation_id.clone(),
        command_id: command.command_id.clone(),
        command_kind: command_kind as i32,
        actor_ptid: identity.actor_ptid.clone(),
        actor_device_id: sender.device_id.clone(),
        actor_signing_key_id: identity.signing_key_id.clone(),
        command_sha256: command_sha256.clone(),
        created_at_unix_ms,
        expires_at_unix_ms,
    };
    Ok(ConversationCommandProposal {
        version: COMMAND_PROPOSAL_FORMAT_VERSION,
        federation_id: head.federation_id.clone(),
        authority_station_peer_id: head.authority_station_peer_id.clone(),
        authority_epoch: head.authority_epoch,
        home_station_peer_id: identity.home_station_peer_id.clone(),
        actor_ptid: identity.actor_ptid.clone(),
        actor_device_id: sender.device_id.clone(),
        actor_signing_key_id: identity.signing_key_id.clone(),
        command: Some(command.clone()),
        command_sha256,
        actor_signature: identity
            .signing_key
            .sign(&signing_input.encode_to_vec())
            .to_bytes()
            .to_vec(),
        created_at_unix_ms,
        expires_at_unix_ms,
    })
}

fn command_kind(command: &ChatCommand) -> Option<ConversationCommandKind> {
    match command.payload.as_ref()? {
        chat_command::Payload::SendMessage(_) => Some(ConversationCommandKind::SendMessage),
        chat_command::Payload::EditMessage(_) => Some(ConversationCommandKind::EditMessage),
        chat_command::Payload::RetractMessage(_) => Some(ConversationCommandKind::RetractMessage),
        chat_command::Payload::Reaction(_) => Some(ConversationCommandKind::React),
        chat_command::Payload::PinMessage(_) => Some(ConversationCommandKind::PinMessage),
        chat_command::Payload::UpdateConversation(_) => {
            Some(ConversationCommandKind::UpdateSettings)
        }
        chat_command::Payload::MembershipTransition(_) => {
            Some(ConversationCommandKind::MembershipTransition)
        }
        chat_command::Payload::DissolveConversation(_) => Some(ConversationCommandKind::Dissolve),
    }
}

fn command_timestamp_unix_ms(command: &ChatCommand) -> Option<i64> {
    let timestamp = command.client_timestamp.as_ref()?;
    if timestamp.seconds < 0
        || timestamp.nanos < 0
        || timestamp.nanos >= 1_000_000_000
        || timestamp.nanos % 1_000_000 != 0
    {
        return None;
    }
    timestamp
        .seconds
        .checked_mul(1_000)?
        .checked_add(i64::from(timestamp.nanos) / 1_000_000)
        .filter(|value| *value > 0)
}

fn validate_committed_event(
    command: &ChatCommand,
    event: Option<crate::model::chat::ConversationEvent>,
) -> Result<(), CommandSubmitFailure> {
    let event = event.ok_or_else(|| CommandSubmitFailure::Terminal {
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

fn validate_group_creation_response(
    command: &ChatCommand,
    response: CreateGroupConversationResponse,
) -> Result<(), CommandSubmitFailure> {
    let conversation = response
        .conversation
        .ok_or_else(|| CommandSubmitFailure::Terminal {
            code: "missing_conversation".to_string(),
        })?;
    if conversation.conversation_id != command.conversation_id
        || conversation.kind != ConversationKind::Group as i32
    {
        return Err(CommandSubmitFailure::Terminal {
            code: "response_binding".to_string(),
        });
    }
    validate_committed_event(command, response.event)
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
        StationClientErrorKind::SessionRevoked => CommandSubmitFailure::Retryable {
            code: "session_revoked".to_string(),
        },
        StationClientErrorKind::Decode | StationClientErrorKind::InvalidResponse => {
            CommandSubmitFailure::Retryable {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::chat::{
        chat_command, Conversation, ConversationEvent, ConversationPublicHead, CryptoEndpoint,
        MembershipTransitionIntent, SendMessageIntent,
    };
    use ed25519_dalek::{Signature, Verifier};

    fn command(payload: chat_command::Payload) -> ChatCommand {
        ChatCommand {
            command_id: "command-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            sender: Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            observed_membership_epoch: 0,
            observed_mls_epoch: 0,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_plan_sha256: vec![7; 32],
            authority_station_peer_id: "station-four".to_string(),
            payload: Some(payload),
        }
    }

    fn prepared_group_genesis_command() -> ChatCommand {
        command(chat_command::Payload::MembershipTransition(
            MembershipTransitionIntent {
                transition_id: "transition-1".to_string(),
                from_membership_epoch: 0,
                from_mls_epoch: 0,
                to_mls_epoch: 1,
                changes: Vec::new(),
                mls_commit: vec![1],
                mls_commit_sha256: vec![2; 32],
                welcome_payloads: Vec::new(),
                leave_intent_id: String::new(),
                authority_plan_id: "plan-1".to_string(),
                authority_plan_sha256: vec![7; 32],
            },
        ))
    }

    #[test]
    fn prepared_epoch_zero_group_genesis_uses_group_creation_route() {
        let command = prepared_group_genesis_command();

        assert_eq!(
            command_submission_route(&command),
            CommandSubmissionRoute::GroupCreation
        );
        assert_eq!(
            command_submission_route(&command).path(),
            "/conversation/group"
        );
    }

    #[test]
    fn ordinary_commands_use_authority_command_route() {
        let command = command(chat_command::Payload::SendMessage(SendMessageIntent {
            message_id: "message-1".to_string(),
            ..Default::default()
        }));

        assert_eq!(
            command_submission_route(&command),
            CommandSubmissionRoute::AuthorityCommand
        );
        assert_eq!(
            command_submission_route(&command).path(),
            "/conversation/command"
        );
    }

    #[test]
    fn remote_command_proposal_is_device_signed_and_exactly_repeatable() {
        let command = command(chat_command::Payload::SendMessage(SendMessageIntent {
            message_id: "message-1".to_string(),
            ..Default::default()
        }));
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let identity = RemoteCommandIdentity {
            actor_ptid: "ptid:alice".to_string(),
            home_station_peer_id: "station-five".to_string(),
            signing_key_id: hex::encode(Sha256::digest(signing_key.verifying_key().as_bytes())),
            signing_key,
        };
        let head = ConversationPublicHead {
            conversation_id: command.conversation_id.clone(),
            source: ConversationPublicHeadSource::Follower as i32,
            federation_id: "federation-1".to_string(),
            authority_station_peer_id: command.authority_station_peer_id.clone(),
            authority_epoch: 3,
            group_seq: 7,
            event_hash: vec![8; 32],
            membership_epoch: 1,
            mls_epoch: 1,
            status: "active".to_string(),
            ..Default::default()
        };

        let first = build_remote_command_proposal(&command, &identity, &head).unwrap();
        let second = build_remote_command_proposal(&command, &identity, &head).unwrap();

        assert_eq!(first.encode_to_vec(), second.encode_to_vec());
        assert_eq!(first.command.as_ref(), Some(&command));
        assert_eq!(first.created_at_unix_ms, 1_000);
        assert_eq!(first.expires_at_unix_ms, 301_000);
        let signing_input = ConversationCommandProposalSigningInput {
            version: first.version,
            federation_id: first.federation_id.clone(),
            authority_station_peer_id: first.authority_station_peer_id.clone(),
            authority_epoch: first.authority_epoch,
            home_station_peer_id: first.home_station_peer_id.clone(),
            conversation_id: command.conversation_id.clone(),
            command_id: command.command_id.clone(),
            command_kind: ConversationCommandKind::SendMessage as i32,
            actor_ptid: first.actor_ptid.clone(),
            actor_device_id: first.actor_device_id.clone(),
            actor_signing_key_id: first.actor_signing_key_id.clone(),
            command_sha256: first.command_sha256.clone(),
            created_at_unix_ms: first.created_at_unix_ms,
            expires_at_unix_ms: first.expires_at_unix_ms,
        };
        identity
            .signing_key
            .verifying_key()
            .verify(
                &signing_input.encode_to_vec(),
                &Signature::from_slice(&first.actor_signature).unwrap(),
            )
            .unwrap();
    }

    #[test]
    fn remote_command_proposal_rejects_non_follower_route() {
        let command = command(chat_command::Payload::SendMessage(SendMessageIntent {
            message_id: "message-1".to_string(),
            ..Default::default()
        }));
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let identity = RemoteCommandIdentity {
            actor_ptid: "ptid:alice".to_string(),
            home_station_peer_id: "station-five".to_string(),
            signing_key_id: hex::encode(Sha256::digest(signing_key.verifying_key().as_bytes())),
            signing_key,
        };
        let head = ConversationPublicHead {
            conversation_id: command.conversation_id.clone(),
            source: ConversationPublicHeadSource::Authority as i32,
            federation_id: "federation-1".to_string(),
            authority_station_peer_id: command.authority_station_peer_id.clone(),
            authority_epoch: 3,
            ..Default::default()
        };

        assert_eq!(
            build_remote_command_proposal(&command, &identity, &head),
            Err(CommandSubmitFailure::Terminal {
                code: "remote_route_binding".to_string(),
            })
        );
    }

    #[test]
    fn ambiguous_transport_failure_remains_retryable() {
        for (kind, code) in [
            (StationClientErrorKind::SessionRevoked, "session_revoked"),
            (StationClientErrorKind::Decode, "invalid_response"),
            (StationClientErrorKind::InvalidResponse, "invalid_response"),
        ] {
            assert_eq!(
                classify_command_transport_error(
                    crate::infrastructure::station_client::StationClientError {
                        kind,
                        message: "ambiguous response".to_string(),
                        details: None,
                    },
                ),
                CommandSubmitFailure::Retryable {
                    code: code.to_string(),
                }
            );
        }
    }

    #[test]
    fn established_membership_transitions_use_authority_command_route() {
        let mut command = prepared_group_genesis_command();
        command.observed_membership_epoch = 1;
        command.observed_mls_epoch = 1;
        let transition = match command.payload.as_mut() {
            Some(chat_command::Payload::MembershipTransition(transition)) => transition,
            _ => panic!("expected membership transition"),
        };
        transition.from_membership_epoch = 1;
        transition.from_mls_epoch = 1;
        transition.to_mls_epoch = 2;

        assert_eq!(
            command_submission_route(&command),
            CommandSubmissionRoute::AuthorityCommand
        );
    }

    #[test]
    fn group_creation_request_preserves_exact_command_bytes() {
        let command = prepared_group_genesis_command();
        let exact_command_bytes = command.encode_to_vec();
        let request = CreateGroupConversationRequest {
            command: Some(command),
        };

        assert_eq!(
            request.command.expect("group command").encode_to_vec(),
            exact_command_bytes
        );
    }

    #[test]
    fn group_creation_response_requires_bound_group_and_event() {
        let command = prepared_group_genesis_command();
        let response = CreateGroupConversationResponse {
            conversation: Some(Conversation {
                conversation_id: command.conversation_id.clone(),
                kind: ConversationKind::Group as i32,
                ..Default::default()
            }),
            event: Some(ConversationEvent {
                command_id: command.command_id.clone(),
                conversation_id: command.conversation_id.clone(),
                actor: command.sender.clone(),
                ..Default::default()
            }),
        };

        assert_eq!(
            validate_group_creation_response(&command, response.clone()),
            Ok(())
        );

        let mut wrong_kind = response;
        wrong_kind
            .conversation
            .as_mut()
            .expect("group conversation")
            .kind = ConversationKind::Direct as i32;
        assert_eq!(
            validate_group_creation_response(&command, wrong_kind),
            Err(CommandSubmitFailure::Terminal {
                code: "response_binding".to_string(),
            })
        );
    }
}
