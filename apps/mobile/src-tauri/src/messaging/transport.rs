use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use messaging_core::attachment::{
    AttachmentTransferFailure, AttachmentTransferRecord, AttachmentTransferTransport,
    PreparedAttachmentUpload,
};
use messaging_core::crypto::prekeys::PreKeyTransport;
use messaging_core::identity::{DeviceEnrollmentTransport, DeviceSigningKey};
use messaging_core::inbox::QueueTransport;
use messaging_core::mls::key_packages::MlsKeyPackageTransport;
use messaging_core::mls::membership_transition::MembershipTransitionIntentInput;
use messaging_core::outbox::{CommandSubmitFailure, CommandTransport, KeyBundleTransport};
use messaging_core::proto::actor::{
    ActorDeviceRef, EnrollActorDeviceRequest, EnrollActorDeviceResponse,
};
use messaging_core::proto::chat::{
    chat_command, submit_conversation_authority_command_request,
    transfer_conversation_ownership_request, update_conversation_member_request,
    AcknowledgeDeviceInboxItemRequest, AcknowledgeDeviceInboxItemResponse, AttachmentTransferError,
    AttachmentTransferErrorCode, AttachmentTransferState, BeginAttachmentUploadRequest,
    BeginAttachmentUploadResponse, CancelAttachmentUploadRequest, CancelAttachmentUploadResponse,
    ChatCommand, ClaimDeviceInboxRequest, ClaimDeviceInboxResponse,
    CompleteAttachmentUploadRequest, CompleteAttachmentUploadResponse, Conversation,
    ConversationCommandKind, ConversationCommandProposal, ConversationCommandProposalSigningInput,
    ConversationCommandRejectCode, ConversationEvent, ConversationKind,
    ConversationMemberAuthorityAction, ConversationMemberAuthorityCommand,
    ConversationMembershipAction, ConversationPublicHead, ConversationPublicHeadSource,
    CreateDirectConversationRequest, CreateDirectConversationResponse,
    CreateGroupConversationRequest, CreateGroupConversationResponse, CryptoEndpoint,
    DeviceConsumptionReceipt, EncryptedObjectDescriptor, GetConversationPublicHeadRequest,
    GetConversationPublicHeadResponse, GetConversationRequest, GetConversationResponse,
    ListConversationsRequest, ListConversationsResponse, MemberRole, MessagingMembershipAction,
    PrepareConversationCommandRequest, PrepareConversationCommandResponse,
    PrepareConversationGroupRequest, PrepareConversationGroupResponse,
    PrepareConversationMembershipRequest, PrepareConversationMembershipResponse,
    PutAttachmentChunkRequest, PutAttachmentChunkResponse,
    SubmitConversationAuthorityCommandRequest, SubmitConversationAuthorityCommandResponse,
    SubmitConversationDeliveryReceiptRequest, SubmitConversationDeliveryReceiptResponse,
    SubmitConversationReadCursorRequest, SubmitConversationReadCursorResponse,
    SubmitConversationTypingRequest, SubmitConversationTypingResponse,
    TransferConversationOwnershipRequest, TransferConversationOwnershipResponse,
    UpdateConversationMemberRequest, UpdateConversationMemberResponse,
};
use messaging_core::proto::key_exchange::{
    DirectKeyBundle, FetchDirectKeyBundlesRequest, FetchDirectKeyBundlesResponse,
    UploadDirectKeyBundleRequest, UploadDirectKeyBundleResponse, UploadMlsKeyPackageRequest,
    UploadMlsKeyPackageResponse,
};
use messaging_core::proto::social::{
    AcceptSocialFriendRequestRequest, AcceptSocialFriendRequestResponse, BlockSocialActorRequest,
    BlockSocialActorResponse, FriendRequestCommand, LookupFriendRequestCommandResultRequest,
    LookupFriendRequestCommandResultResponse, LookupSocialRelationshipCommandResultRequest,
    LookupSocialRelationshipCommandResultResponse, RejectSocialFriendRequestRequest,
    RejectSocialFriendRequestResponse, SendSocialFriendRequestRequest,
    SendSocialFriendRequestResponse, SocialRelationshipCommand, UnblockSocialActorRequest,
    UnblockSocialActorResponse,
};
use messaging_core::proto::{actor_device_ptid, actor_device_ref, actor_ref};
use prost::Message;
use reqwest::blocking::{Client, Response};
use reqwest::header::{
    HeaderMap, ACCEPT, AUTHORIZATION, CONTENT_TYPE, IF_MATCH, RANGE, RETRY_AFTER,
};
use secure_content_core::object::{
    EncryptedObjectChunk as EncryptedAttachmentChunk, OBJECT_TAG_SIZE as ATTACHMENT_TAG_SIZE,
};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const GROUP_CREATION_PATH: &str = "/conversation/group";
const AUTHORITY_COMMAND_PATH: &str = "/conversation/command";
const COMMAND_PROPOSAL_FORMAT_VERSION: u32 = 1;
const COMMAND_PROPOSAL_LIFETIME_MS: i64 = 5 * 60 * 1_000;
const MEMBER_AUTHORITY_ERROR_HEADER: &str = "X-Peers-Error-Code";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MemberAuthorityTransportError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for MemberAuthorityTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for MemberAuthorityTransportError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StationTransportError {
    Deadline,
    Network,
    HttpStatus {
        status: u16,
        code: Option<String>,
        details: Option<String>,
        body: Option<String>,
    },
    Decode,
    Invalid,
}

impl std::fmt::Display for StationTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Deadline => {
                formatter.write_str("mobile messaging Station request exceeded its deadline")
            }
            Self::Network => formatter.write_str("mobile messaging Station network request failed"),
            Self::HttpStatus {
                status,
                code,
                details,
                body,
            } => {
                write!(formatter, "mobile messaging Station returned HTTP {status}")?;
                if let Some(code) = code {
                    write!(formatter, " [{code}]")?;
                }
                if let Some(details) = details {
                    write!(formatter, ": {details}")?;
                } else if let Some(body) = body {
                    write!(formatter, ": {body}")?;
                }
                Ok(())
            }
            Self::Decode => formatter.write_str("mobile messaging Station response is invalid"),
            Self::Invalid => formatter.write_str("mobile messaging Station request is invalid"),
        }
    }
}

impl StationTransportError {
    #[cfg(test)]
    fn http_status(status: u16) -> Self {
        Self::HttpStatus {
            status,
            code: None,
            details: None,
            body: None,
        }
    }
}

fn station_http_error(status: u16, headers: &HeaderMap, body: &[u8]) -> StationTransportError {
    const MAX_ERROR_CONTEXT_CHARS: usize = 2048;

    let header = |name: &'static str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(MAX_ERROR_CONTEXT_CHARS).collect())
    };
    let body = String::from_utf8_lossy(body);
    let body = body.trim();
    StationTransportError::HttpStatus {
        status,
        code: header("X-Peers-Error-Code"),
        details: header("X-Peers-Error-Details"),
        body: (!body.is_empty()).then(|| body.chars().take(MAX_ERROR_CONTEXT_CHARS).collect()),
    }
}

pub struct StationAttachmentTransferTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
    endpoint: CryptoEndpoint,
    client: Client,
}

impl StationAttachmentTransferTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
        endpoint: CryptoEndpoint,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        if endpoint.ptid.trim().is_empty() || endpoint.device_id != device_id {
            return Err(
                "mobile messaging attachment transport endpoint binding mismatch".to_string(),
            );
        }
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
            endpoint,
            client: Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .map_err(|error| format!("build mobile messaging attachment transport: {error}"))?,
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(
                method,
                format!("{}{path}", self.station_origin.trim_end_matches('/')),
            )
            .header(
                AUTHORIZATION,
                format!("Bearer {}", self.access_token.as_str()),
            )
            .header("X-Device-ID", &self.device_id)
    }

    fn require_success(response: Response) -> Result<Vec<u8>, AttachmentTransferFailure> {
        let status = response.status();
        let retry_after_ms = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
            .map(|seconds| seconds.saturating_mul(1_000));
        let body = response
            .bytes()
            .map_err(|error| attachment_transport_error(error.to_string()))?;
        if !status.is_success() {
            if let Some(failure) = decode_typed_transfer_failure(&body, retry_after_ms) {
                return Err(failure);
            }
            return Err(classify_attachment_status(status.as_u16(), retry_after_ms));
        }
        Ok(body.to_vec())
    }

    fn download_chunk_request(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        start: u64,
        end: u64,
    ) -> Result<reqwest::blocking::RequestBuilder, AttachmentTransferFailure> {
        let url = reqwest::Url::parse(&format!(
            "{}/conversation/attachments/objects/{}",
            self.station_origin.trim_end_matches('/'),
            descriptor.object_id
        ))
        .map_err(|error| {
            AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                format!("build mobile messaging attachment download URL: {error}"),
            )
        })?;
        Ok(self
            .client
            .get(url)
            .header(
                AUTHORIZATION,
                format!("Bearer {}", self.access_token.as_str()),
            )
            .header("X-Device-ID", &self.device_id)
            .header("X-Peers-Conversation-ID", &transfer.conversation_id)
            .header(
                "X-Peers-Authority-Station-ID",
                &transfer.authority_station_id,
            )
            .header(
                IF_MATCH,
                format!("\"{}\"", hex_bytes(&descriptor.ciphertext_sha256)),
            )
            .header(RANGE, format!("bytes={start}-{end}")))
    }
}

impl AttachmentTransferTransport for StationAttachmentTransferTransport {
    fn begin_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
        let request = BeginAttachmentUploadRequest {
            conversation_id: transfer.conversation_id.clone(),
            message_id: transfer.message_id.clone(),
            attachment_id: transfer.attachment_id.clone(),
            uploader: Some(self.endpoint.clone()),
            object: Some(prepared.object.clone()),
            descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
            idempotency_key: transfer.attachment_id.clone(),
            authority_station_id: transfer.authority_station_id.clone(),
        };
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                "/conversation/attachments/uploads:begin",
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| attachment_transport_error(error.to_string()))?,
        )?;
        let response = BeginAttachmentUploadResponse::decode(body.as_slice()).map_err(|error| {
            AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                format!("decode mobile messaging attachment begin response: {error}"),
            )
        })?;
        if response.authority_station_id != transfer.authority_station_id
            || response.upload_id.trim().is_empty()
            || response.generation == 0
            || response.accepted_chunk_size != prepared.object.chunk_size
        {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                "mobile messaging attachment begin response binding mismatch".to_string(),
            ));
        }
        Ok((
            response.upload_id,
            response.generation,
            response.received_chunk_bitmap,
        ))
    }

    fn put_upload_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        chunk: &EncryptedAttachmentChunk,
    ) -> Result<(), AttachmentTransferFailure> {
        let metadata = PutAttachmentChunkRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            chunk_index: chunk.chunk_index,
            byte_offset: u64::from(chunk.chunk_index)
                * u64::from(transfer.chunk_size + ATTACHMENT_TAG_SIZE),
            ciphertext_size: chunk.ciphertext.len() as u64,
            ciphertext_sha256: chunk.ciphertext_sha256.to_vec(),
            idempotency_key: format!("{}:{}", transfer.attachment_id, chunk.chunk_index),
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let body = Self::require_success(
            self.request(
                reqwest::Method::PUT,
                &format!(
                    "/conversation/attachments/uploads/{}/chunks/{}",
                    transfer.upload_id, chunk.chunk_index
                ),
            )
            .header(CONTENT_TYPE, "application/octet-stream")
            .header(ACCEPT, "application/x-protobuf")
            .header(
                "X-Peers-Attachment-Metadata-Bin",
                B64.encode(metadata.encode_to_vec()),
            )
            .body(chunk.ciphertext.clone())
            .send()
            .map_err(|error| attachment_transport_error(error.to_string()))?,
        )?;
        let response = PutAttachmentChunkResponse::decode(body.as_slice()).map_err(|error| {
            AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                format!("decode mobile messaging attachment chunk response: {error}"),
            )
        })?;
        let chunk_recorded = response
            .received_chunk_bitmap
            .get(chunk.chunk_index as usize / 8)
            .is_some_and(|byte| byte & (1 << (chunk.chunk_index % 8)) != 0);
        if response.chunk_index != chunk.chunk_index || !chunk_recorded {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                "mobile messaging attachment chunk response binding mismatch".to_string(),
            ));
        }
        Ok(())
    }

    fn complete_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
        let request = CompleteAttachmentUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                &format!(
                    "/conversation/attachments/uploads/{}/complete",
                    transfer.upload_id
                ),
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| attachment_transport_error(error.to_string()))?,
        )?;
        CompleteAttachmentUploadResponse::decode(body.as_slice())
            .map_err(|error| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    format!("decode mobile messaging attachment completion response: {error}"),
                )
            })?
            .object
            .ok_or_else(|| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    "mobile messaging attachment completion omitted descriptor".to_string(),
                )
            })
    }

    fn get_download_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        _chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, AttachmentTransferFailure> {
        let response = self
            .download_chunk_request(transfer, descriptor, start, end)?
            .send()
            .map_err(|error| attachment_transport_error(error.to_string()))?;
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Self::require_success(response).and_then(|_| {
                Err(AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::RangeInvalid,
                    "mobile messaging attachment range response was not partial".to_string(),
                ))
            });
        }
        let body = Self::require_success(response)?;
        let expected_length = end
            .checked_sub(start)
            .and_then(|length| length.checked_add(1))
            .and_then(|length| usize::try_from(length).ok())
            .ok_or_else(|| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::RangeInvalid,
                    "mobile messaging attachment response range is invalid".to_string(),
                )
            })?;
        if body.len() != expected_length {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::RangeInvalid,
                "mobile messaging attachment range response length mismatch".to_string(),
            ));
        }
        Ok(body)
    }

    fn cancel_upload(
        &self,
        transfer: &AttachmentTransferRecord,
    ) -> Result<(), AttachmentTransferFailure> {
        let request = CancelAttachmentUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                &format!(
                    "/conversation/attachments/uploads/{}/cancel",
                    transfer.upload_id
                ),
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| attachment_transport_error(error.to_string()))?,
        )?;
        let response =
            CancelAttachmentUploadResponse::decode(body.as_slice()).map_err(|error| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    format!("decode mobile messaging attachment cancellation response: {error}"),
                )
            })?;
        if response.state != AttachmentTransferState::Cancelled as i32 {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                "mobile messaging attachment cancellation state mismatch".to_string(),
            ));
        }
        Ok(())
    }
}

fn decode_typed_transfer_failure(
    body: &[u8],
    header_retry_after_ms: Option<i64>,
) -> Option<AttachmentTransferFailure> {
    let typed = AttachmentTransferError::decode(body).ok()?;
    let code = AttachmentTransferErrorCode::try_from(typed.code).ok()?;
    if code == AttachmentTransferErrorCode::Unspecified {
        return None;
    }
    let typed_retry_after_ms = typed.retry_after.and_then(|duration| {
        if duration.seconds < 0 || !(0..1_000_000_000).contains(&duration.nanos) {
            return None;
        }
        duration.seconds.checked_mul(1_000).and_then(|millis| {
            millis.checked_add(i64::from(duration.nanos).saturating_add(999_999) / 1_000_000)
        })
    });
    let detail = format!(
        "mobile messaging attachment Station error {}",
        code.as_str_name()
    );
    Some(
        if matches!(
            code,
            AttachmentTransferErrorCode::QuotaExceeded | AttachmentTransferErrorCode::RetryLater
        ) {
            AttachmentTransferFailure::retryable(
                code,
                typed_retry_after_ms.or(header_retry_after_ms),
                detail,
            )
        } else {
            AttachmentTransferFailure::terminal(code, detail)
        },
    )
}

fn classify_attachment_status(
    status: u16,
    retry_after_ms: Option<i64>,
) -> AttachmentTransferFailure {
    let detail = format!("mobile messaging attachment Station returned HTTP {status}");
    match status {
        401 | 403 => {
            AttachmentTransferFailure::terminal(AttachmentTransferErrorCode::NotGranted, detail)
        }
        409 => {
            AttachmentTransferFailure::terminal(AttachmentTransferErrorCode::PartConflict, detail)
        }
        412 => AttachmentTransferFailure::terminal(
            AttachmentTransferErrorCode::DescriptorMismatch,
            detail,
        ),
        416 => {
            AttachmentTransferFailure::terminal(AttachmentTransferErrorCode::RangeInvalid, detail)
        }
        408 | 429 | 500..=599 => AttachmentTransferFailure::retryable(
            if status == 429 {
                AttachmentTransferErrorCode::QuotaExceeded
            } else {
                AttachmentTransferErrorCode::RetryLater
            },
            retry_after_ms,
            detail,
        ),
        _ => AttachmentTransferFailure::terminal(
            AttachmentTransferErrorCode::DescriptorMismatch,
            detail,
        ),
    }
}

fn attachment_transport_error(detail: String) -> AttachmentTransferFailure {
    AttachmentTransferFailure::retryable(AttachmentTransferErrorCode::RetryLater, None, detail)
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

pub struct StationDeviceTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

impl StationDeviceTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }
}

impl DeviceEnrollmentTransport for StationDeviceTransport {
    fn enroll(
        &self,
        request: &EnrollActorDeviceRequest,
    ) -> Result<EnrollActorDeviceResponse, String> {
        let certificate = request
            .certificate
            .as_ref()
            .ok_or_else(|| "mobile messaging device certificate is required".to_string())?;
        if certificate
            .device
            .as_ref()
            .map(|device| device.device_id.as_str())
            != Some(self.device_id.as_str())
        {
            return Err(
                "mobile messaging enrollment device does not match engine endpoint".to_string(),
            );
        }
        let result = post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/device/enroll",
            request,
        );
        result.map_err(|error| error.to_string())
    }
}

pub struct StationPreKeyTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

impl StationPreKeyTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }
}

impl PreKeyTransport for StationPreKeyTransport {
    fn upload(&self, request: &UploadDirectKeyBundleRequest) -> Result<(), String> {
        if request
            .device
            .as_ref()
            .map(|device| device.device_id.as_str())
            != Some(self.device_id.as_str())
        {
            return Err("mobile messaging prekey upload endpoint mismatch".to_string());
        }
        post_proto::<_, UploadDirectKeyBundleResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/key-exchange/keys/bundle",
            request,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

pub struct StationMlsKeyPackageTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

impl StationMlsKeyPackageTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }
}

impl MlsKeyPackageTransport for StationMlsKeyPackageTransport {
    fn upload(&self, request: &UploadMlsKeyPackageRequest) -> Result<(), String> {
        if request
            .device
            .as_ref()
            .map(|device| device.device_id.as_str())
            != Some(self.device_id.as_str())
            || request.key_package.is_empty()
        {
            return Err("mobile messaging MLS KeyPackage endpoint binding mismatch".to_string());
        }
        post_proto::<_, UploadMlsKeyPackageResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/key-exchange/mls/key-package/upload",
            request,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

pub struct StationDeliveryReceiptTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

impl StationDeliveryReceiptTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }
}

impl StationDeliveryReceiptTransport {
    pub fn submit(&self, receipt: &DeviceConsumptionReceipt) -> Result<(), String> {
        if receipt.conversation_id.trim().is_empty()
            || receipt.event_id.trim().is_empty()
            || receipt.receipt_id.trim().is_empty()
            || receipt.payload_sha256.is_empty()
            || receipt.consumed_at.is_none()
            || receipt
                .consumer
                .as_ref()
                .map(|consumer| consumer.device_id.as_str())
                != Some(self.device_id.as_str())
        {
            return Err("mobile messaging delivery receipt endpoint mismatch".to_string());
        }
        post_proto::<_, SubmitConversationDeliveryReceiptResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/delivery/receipt",
            &SubmitConversationDeliveryReceiptRequest {
                receipt: Some(receipt.clone()),
            },
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

pub struct StationQueueTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

impl StationQueueTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }
}

impl QueueTransport for StationQueueTransport {
    fn claim(&self, request: ClaimDeviceInboxRequest) -> Result<ClaimDeviceInboxResponse, String> {
        if request
            .device
            .as_ref()
            .map(|device| device.device_id.as_str())
            != Some(self.device_id.as_str())
        {
            return Err("mobile messaging queue claim endpoint mismatch".to_string());
        }
        let result = post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/device/inbox/claim",
            &request,
        );
        result.map_err(|error| error.to_string())
    }

    fn acknowledge(&self, request: AcknowledgeDeviceInboxItemRequest) -> Result<(), String> {
        if request
            .device
            .as_ref()
            .map(|device| device.device_id.as_str())
            != Some(self.device_id.as_str())
        {
            return Err("mobile messaging queue acknowledgement endpoint mismatch".to_string());
        }
        post_proto::<_, AcknowledgeDeviceInboxItemResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/device/inbox/ack",
            &request,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

pub struct StationSocialTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

impl StationSocialTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }

    pub(crate) fn send_friend_request(
        &self,
        request: &SendSocialFriendRequestRequest,
    ) -> Result<SendSocialFriendRequestResponse, StationTransportError> {
        self.validate_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/friend-request/send",
            request,
        )
    }

    pub(crate) fn accept_friend_request(
        &self,
        request: &AcceptSocialFriendRequestRequest,
    ) -> Result<AcceptSocialFriendRequestResponse, StationTransportError> {
        self.validate_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/friend-request/accept",
            request,
        )
    }

    pub(crate) fn reject_friend_request(
        &self,
        request: &RejectSocialFriendRequestRequest,
    ) -> Result<RejectSocialFriendRequestResponse, StationTransportError> {
        self.validate_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/friend-request/reject",
            request,
        )
    }

    pub(crate) fn lookup_friend_request_command_result(
        &self,
        request: &LookupFriendRequestCommandResultRequest,
    ) -> Result<LookupFriendRequestCommandResultResponse, StationTransportError> {
        if request.command_id.trim().is_empty() || request.command_payload_sha256.len() != 32 {
            return Err(StationTransportError::Invalid);
        }
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/friend-request/result",
            request,
        )
    }

    pub(crate) fn block_actor(
        &self,
        request: &BlockSocialActorRequest,
    ) -> Result<BlockSocialActorResponse, StationTransportError> {
        self.validate_relationship_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/relationships/block",
            request,
        )
    }

    pub(crate) fn unblock_actor(
        &self,
        request: &UnblockSocialActorRequest,
    ) -> Result<UnblockSocialActorResponse, StationTransportError> {
        self.validate_relationship_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/relationships/unblock",
            request,
        )
    }

    pub(crate) fn lookup_relationship_command_result(
        &self,
        request: &LookupSocialRelationshipCommandResultRequest,
    ) -> Result<LookupSocialRelationshipCommandResultResponse, StationTransportError> {
        if request.command_id.trim().is_empty() || request.command_payload_sha256.len() != 32 {
            return Err(StationTransportError::Invalid);
        }
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/relationships/result",
            request,
        )
    }

    fn validate_command(
        &self,
        command: Option<&FriendRequestCommand>,
    ) -> Result<(), StationTransportError> {
        let command = command.ok_or(StationTransportError::Invalid)?;
        let body = command
            .body
            .as_ref()
            .ok_or(StationTransportError::Invalid)?;
        if body
            .authorizing_device
            .as_ref()
            .map(|device| device.device_id.as_str())
            != Some(self.device_id.as_str())
            || body.sender_home_station_peer_id.trim().is_empty()
            || body.receiver_home_station_peer_id.trim().is_empty()
            || body.federation_id.trim().is_empty()
            || command.signing_key_id.trim().is_empty()
            || command.actor_device_signature.len() != 64
        {
            return Err(StationTransportError::Invalid);
        }
        Ok(())
    }

    fn validate_relationship_command(
        &self,
        command: Option<&SocialRelationshipCommand>,
    ) -> Result<(), StationTransportError> {
        let command = command.ok_or(StationTransportError::Invalid)?;
        let body = command
            .body
            .as_ref()
            .ok_or(StationTransportError::Invalid)?;
        if body
            .authorizing_device
            .as_ref()
            .map(|device| device.device_id.as_str())
            != Some(self.device_id.as_str())
            || body.actor_home_station_peer_id.trim().is_empty()
            || body.target_home_station_peer_id.trim().is_empty()
            || command.signing_key_id.trim().is_empty()
            || command.actor_device_signature.len() != 64
        {
            return Err(StationTransportError::Invalid);
        }
        Ok(())
    }
}

pub struct StationConversationTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
    endpoint: CryptoEndpoint,
}

impl StationConversationTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
        endpoint: CryptoEndpoint,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        if endpoint.ptid.trim().is_empty() || endpoint.device_id != device_id {
            return Err(
                "mobile messaging conversation transport endpoint binding mismatch".to_string(),
            );
        }
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
            endpoint,
        })
    }

    pub fn list_conversations(&self) -> Result<ListConversationsResponse, String> {
        get_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/list",
            &ListConversationsRequest {},
        )
        .map_err(|error| error.to_string())
    }

    pub fn get_conversation(&self, conversation_id: &str) -> Result<Conversation, String> {
        if conversation_id.trim().is_empty() {
            return Err("mobile messaging Conversation ID is required".to_string());
        }
        let response: GetConversationResponse = get_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/get",
            &GetConversationRequest {
                conversation_id: conversation_id.to_string(),
            },
        )
        .map_err(|error| error.to_string())?;
        let conversation = response
            .conversation
            .ok_or_else(|| "mobile messaging Station returned no Conversation".to_string())?;
        if conversation.conversation_id != conversation_id {
            return Err("mobile messaging Station returned another Conversation".to_string());
        }
        Ok(conversation)
    }

    pub fn create_direct(
        &self,
        peer_ptid: &str,
        federation_id: &str,
        command_id: &str,
    ) -> Result<CreateDirectConversationResponse, String> {
        if peer_ptid.trim().is_empty()
            || peer_ptid == self.endpoint.ptid
            || federation_id.trim().is_empty()
            || command_id.trim().is_empty()
        {
            return Err("mobile messaging direct peer identity is invalid".to_string());
        }
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/direct",
            &CreateDirectConversationRequest {
                peer_ptid: peer_ptid.to_string(),
                federation_id: federation_id.to_string(),
                creator: Some(actor_device_ref(
                    self.endpoint.ptid.clone(),
                    self.endpoint.device_id.clone(),
                )),
                command_id: command_id.to_string(),
            },
        )
        .map_err(|error| error.to_string())
    }

    pub fn prepare_group_genesis(
        &self,
        conversation_id: &str,
        name: &str,
        member_ptids: &[String],
        federation_id: &str,
    ) -> Result<PrepareConversationGroupResponse, String> {
        if conversation_id.trim().is_empty()
            || name.trim().is_empty()
            || member_ptids.is_empty()
            || member_ptids.iter().any(|ptid| ptid.trim().is_empty())
            || federation_id.trim().is_empty()
        {
            return Err("mobile messaging group genesis intent is incomplete".to_string());
        }
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/group/prepare",
            &PrepareConversationGroupRequest {
                conversation_id: conversation_id.to_string(),
                name: name.to_string(),
                members: member_ptids
                    .iter()
                    .map(|ptid| messaging_core::proto::actor_ref(ptid.clone()))
                    .collect(),
                creator: Some(actor_device_ref(
                    self.endpoint.ptid.clone(),
                    self.endpoint.device_id.clone(),
                )),
                federation_id: federation_id.to_string(),
            },
        )
        .map_err(|error| error.to_string())
    }

    pub fn prepare_membership_transition(
        &self,
        input: &MembershipTransitionIntentInput,
    ) -> Result<PrepareConversationMembershipResponse, String> {
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/membership/prepare",
            &PrepareConversationMembershipRequest {
                conversation_id: input.conversation_id.clone(),
                sender: Some(actor_device_ref(
                    self.endpoint.ptid.clone(),
                    self.endpoint.device_id.clone(),
                )),
                action: canonical_membership_action(input.action) as i32,
                target_actor: Some(actor_ref(input.target_ptid.clone())),
                target_device_id: input.target_device_id.clone(),
                role: canonical_member_role(&input.role)? as i32,
            },
        )
        .map_err(|error| error.to_string())
    }
}

fn validate_member_authority_command(
    command: &ConversationMemberAuthorityCommand,
    endpoint: &CryptoEndpoint,
    expected_action: ConversationMemberAuthorityAction,
) -> Result<(), MemberAuthorityTransportError> {
    if command.version != 1
        || command.command_id.trim().is_empty()
        || command.conversation_id.trim().is_empty()
        || command.operator.as_ref() != Some(endpoint)
        || !command.target_ptid.starts_with("ptid:")
        || command.action != expected_action as i32
        || command.federation_id.trim().is_empty()
        || command.authority_station_peer_id.trim().is_empty()
        || command.authority_epoch <= 0
        || command.authority_sequence <= 0
        || command.authority_hash.len() != 32
        || command.observed_membership_epoch <= 0
        || command.observed_mls_epoch <= 0
        || command.client_timestamp.is_none()
        || command.deadline.is_none()
    {
        return Err(member_authority_invalid("command"));
    }
    Ok(())
}

fn validate_member_authority_event(
    command: &ConversationMemberAuthorityCommand,
    event: &ConversationEvent,
) -> Result<(), MemberAuthorityTransportError> {
    let fact = member_authority_fact(event)?;
    let snapshot = fact
        .post_state
        .as_ref()
        .ok_or_else(|| member_authority_invalid("event_snapshot"))?;
    if event.command_id != command.command_id
        || event.conversation_id != command.conversation_id
        || event.actor != command.operator
        || event.authority_station_peer_id != command.authority_station_peer_id
        || event.sequence != command.authority_sequence.saturating_add(1)
        || event.previous_hash != command.authority_hash
        || event.event_hash.len() != 32
        || event.membership_epoch != command.observed_membership_epoch.saturating_add(1)
        || event.mls_epoch != command.observed_mls_epoch
        || fact.action != command.action
        || fact.target_ptid != command.target_ptid
        || fact.from_membership_epoch != command.observed_membership_epoch
        || fact.to_membership_epoch != event.membership_epoch
        || snapshot.membership_epoch != event.membership_epoch
        || snapshot.mls_epoch != event.mls_epoch
        || snapshot.federation_id != command.federation_id
        || snapshot.authority_epoch != command.authority_epoch
    {
        return Err(member_authority_invalid("event_binding"));
    }
    Ok(())
}

fn validate_member_authority_submission_response(
    command: &ConversationMemberAuthorityCommand,
    accepted_for_forwarding: bool,
    event: Option<&ConversationEvent>,
    remote: bool,
) -> Result<(), CommandSubmitFailure> {
    if remote {
        if !accepted_for_forwarding || event.is_some() {
            return Err(CommandSubmitFailure::Terminal {
                code: "member_authority_forwarding_response_invalid".to_string(),
            });
        }
        return Ok(());
    }
    if accepted_for_forwarding {
        return Err(CommandSubmitFailure::Terminal {
            code: "member_authority_local_response_invalid".to_string(),
        });
    }
    validate_member_authority_event(
        command,
        event.ok_or_else(|| CommandSubmitFailure::Terminal {
            code: "missing_member_authority_event".to_string(),
        })?,
    )
    .map_err(classify_member_authority_error)
}

fn member_authority_fact(
    event: &ConversationEvent,
) -> Result<
    &messaging_core::proto::chat::ConversationMemberAuthorityCommittedFact,
    MemberAuthorityTransportError,
> {
    match event.payload.as_ref() {
        Some(
            messaging_core::proto::chat::conversation_event::Payload::MemberAuthorityCommitted(
                fact,
            ),
        ) => Ok(fact),
        _ => Err(member_authority_invalid("event_payload")),
    }
}

fn member_authority_invalid(field: &str) -> MemberAuthorityTransportError {
    MemberAuthorityTransportError {
        code: "MOBILE_MEMBER_AUTHORITY_RESPONSE_INVALID".to_string(),
        message: format!("mobile member-authority {field} is invalid"),
    }
}

fn canonical_membership_action(action: MessagingMembershipAction) -> ConversationMembershipAction {
    match action {
        MessagingMembershipAction::AddActor => ConversationMembershipAction::AddActor,
        MessagingMembershipAction::RemoveActor => ConversationMembershipAction::RemoveActor,
        MessagingMembershipAction::Leave => ConversationMembershipAction::Leave,
        MessagingMembershipAction::ChangeRole => ConversationMembershipAction::ChangeRole,
        MessagingMembershipAction::AddDevice => ConversationMembershipAction::AddDevice,
        MessagingMembershipAction::RemoveDevice => ConversationMembershipAction::RemoveDevice,
        MessagingMembershipAction::Unspecified => ConversationMembershipAction::Unspecified,
    }
}

fn canonical_member_role(role: &str) -> Result<MemberRole, String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "" => Ok(MemberRole::Unspecified),
        "member" => Ok(MemberRole::Member),
        "admin" => Ok(MemberRole::Admin),
        "owner" => Ok(MemberRole::Owner),
        _ => Err("mobile messaging membership role is invalid".to_string()),
    }
}

pub struct StationCommandTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
    remote_identity: Option<RemoteCommandIdentity>,
}

struct RemoteCommandIdentity {
    actor_ptid: String,
    home_station_peer_id: String,
    signing_key_id: String,
    signing_key: DeviceSigningKey,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandSubmissionKind {
    LocalAuthority,
    RemoteAuthority,
}

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

impl StationCommandTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
            remote_identity: None,
        })
    }

    pub fn with_remote_command_identity(
        mut self,
        actor_ptid: String,
        home_station_peer_id: String,
        signing_key_id: String,
        signing_key: DeviceSigningKey,
    ) -> Result<Self, String> {
        let expected_signing_key_id =
            hex_bytes(&Sha256::digest(signing_key.verifying_key().as_bytes()));
        if !actor_ptid.starts_with("ptid:")
            || home_station_peer_id.trim().is_empty()
            || signing_key.device_id() != self.device_id
            || signing_key_id != expected_signing_key_id
        {
            return Err("mobile messaging remote command identity is invalid".to_string());
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
            return Err("mobile messaging send preparation endpoint mismatch".to_string());
        }
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/command/prepare",
            request,
        )
        .map_err(|error| error.to_string())
    }

    pub fn submit_read_cursor(
        &self,
        request: &SubmitConversationReadCursorRequest,
    ) -> Result<(), String> {
        let actor_read = request
            .cursor
            .as_ref()
            .ok_or_else(|| "mobile messaging actor read cursor is required".to_string())?;
        if actor_read.conversation_id.trim().is_empty()
            || actor_read.reader_ptid.trim().is_empty()
            || actor_read.last_read_sequence <= 0
        {
            return Err("mobile messaging actor read cursor is incomplete".to_string());
        }
        post_proto::<_, SubmitConversationReadCursorResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/read-cursor",
            request,
        )
        .map(|_| ())
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
            return Err("mobile messaging typing endpoint binding mismatch".to_string());
        }
        post_proto::<_, SubmitConversationTypingResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/typing",
            request,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }

    fn submit_group_creation(&self, command: &ChatCommand) -> Result<(), CommandSubmitFailure> {
        let response = post_proto::<_, CreateGroupConversationResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            CommandSubmissionRoute::GroupCreation.path(),
            &CreateGroupConversationRequest {
                command: Some(command.clone()),
            },
        )
        .map_err(classify_command_error)?;
        validate_group_creation_response(command, response)
    }

    fn build_remote_command_proposal(
        &self,
        command: &ChatCommand,
        identity: &RemoteCommandIdentity,
    ) -> Result<ConversationCommandProposal, CommandSubmitFailure> {
        let response = get_proto::<_, GetConversationPublicHeadResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/public-head",
            &GetConversationPublicHeadRequest {
                conversation_id: command.conversation_id.clone(),
            },
        )
        .map_err(classify_command_error)?;
        let head = response
            .head
            .ok_or_else(|| CommandSubmitFailure::Terminal {
                code: "missing_conversation_public_head".to_string(),
            })?;
        build_remote_command_proposal(command, identity, &head)
    }
}

pub struct StationKeyBundleTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

pub fn fetch_actor_identity_key(
    station_origin: &str,
    access_token: &str,
    requester_ptid: &str,
    requester_device_id: &str,
    peer_ptid: &str,
) -> Result<String, String> {
    let peer_ptid = peer_ptid.trim();
    if peer_ptid.is_empty() || peer_ptid == requester_ptid.trim() {
        return Err("mobile signaling peer identity is invalid".to_string());
    }
    let response = post_proto::<_, FetchDirectKeyBundlesResponse>(
        station_origin,
        access_token,
        requester_device_id,
        "/key-exchange/keys/bundle/fetch",
        &FetchDirectKeyBundlesRequest {
            actor: Some(actor_ref(peer_ptid)),
            target_device_id: String::new(),
            home_station_peer_id: String::new(),
            request_id: ulid::Ulid::new().to_string(),
            requester: Some(actor_device_ref(requester_ptid, requester_device_id)),
        },
    )
    .map_err(|error| error.to_string())?;
    let mut bundles = response.bundles.into_iter();
    let first = bundles
        .next()
        .ok_or_else(|| "mobile signaling peer identity is unavailable".to_string())?;
    let identity_key = first.identity_key_public.trim().to_string();
    if identity_key.is_empty()
        || first.device.as_ref().map(actor_device_ptid).transpose()? != Some(peer_ptid)
    {
        return Err("mobile signaling peer identity binding mismatch".to_string());
    }
    for bundle in bundles {
        if bundle.identity_key_public.trim() != identity_key {
            return Err("mobile signaling peer identity is ambiguous".to_string());
        }
    }
    Ok(identity_key)
}

impl StationKeyBundleTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }
}

impl KeyBundleTransport for StationKeyBundleTransport {
    fn fetch(
        &self,
        request_id: &str,
        requester: &ActorDeviceRef,
        endpoint: &ActorDeviceRef,
    ) -> Result<DirectKeyBundle, String> {
        let endpoint_ptid = actor_device_ptid(endpoint)?;
        if endpoint.device_id.trim().is_empty()
            || request_id.trim().is_empty()
            || requester.device_id != self.device_id
            || actor_device_ptid(requester).is_err()
        {
            return Err("mobile messaging key bundle endpoint is incomplete".to_string());
        }
        let response = post_proto::<_, FetchDirectKeyBundlesResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/key-exchange/keys/bundle/fetch",
            &FetchDirectKeyBundlesRequest {
                actor: endpoint.actor.clone(),
                target_device_id: endpoint.device_id.clone(),
                home_station_peer_id: String::new(),
                request_id: request_id.to_string(),
                requester: Some(requester.clone()),
            },
        )
        .map_err(|error| error.to_string())?;
        if response.bundles.len() != 1 {
            return Err(
                "mobile messaging endpoint key bundle is unavailable or ambiguous".to_string(),
            );
        }
        let bundle = response
            .bundles
            .into_iter()
            .next()
            .ok_or_else(|| "mobile messaging endpoint key bundle is unavailable".to_string())?;
        let bundle_device = bundle
            .device
            .as_ref()
            .ok_or_else(|| "mobile messaging endpoint key bundle has no device".to_string())?;
        if actor_device_ptid(bundle_device)? != endpoint_ptid
            || bundle_device.device_id != endpoint.device_id
        {
            return Err("mobile messaging endpoint key bundle binding mismatch".to_string());
        }
        Ok(bundle)
    }
}

impl CommandTransport for StationCommandTransport {
    fn submit(&self, exact_command_bytes: &[u8]) -> Result<(), CommandSubmitFailure> {
        if let Ok(command) = ChatCommand::decode(exact_command_bytes) {
            if command.encode_to_vec() == exact_command_bytes {
                return self.submit_chat_command(&command);
            }
        }
        let command =
            ConversationMemberAuthorityCommand::decode(exact_command_bytes).map_err(|_| {
                CommandSubmitFailure::Terminal {
                    code: "invalid_command".to_string(),
                }
            })?;
        if command.encode_to_vec() != exact_command_bytes {
            return Err(CommandSubmitFailure::Terminal {
                code: "non_canonical_command".to_string(),
            });
        }
        self.submit_member_authority_command(&command)
    }
}

impl StationCommandTransport {
    fn submit_chat_command(&self, command: &ChatCommand) -> Result<(), CommandSubmitFailure> {
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
        if command_submission_route(&command) == CommandSubmissionRoute::GroupCreation {
            return self.submit_group_creation(&command);
        }
        let identity =
            self.remote_identity
                .as_ref()
                .ok_or_else(|| CommandSubmitFailure::Terminal {
                    code: "missing_remote_command_identity".to_string(),
                })?;
        let submission = match command_submission_kind(&command, identity)? {
            CommandSubmissionKind::LocalAuthority => {
                submit_conversation_authority_command_request::Submission::Command(command.clone())
            }
            CommandSubmissionKind::RemoteAuthority => {
                submit_conversation_authority_command_request::Submission::Proposal(
                    self.build_remote_command_proposal(&command, identity)?,
                )
            }
        };
        let response = post_proto::<_, SubmitConversationAuthorityCommandResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            CommandSubmissionRoute::AuthorityCommand.path(),
            &SubmitConversationAuthorityCommandRequest {
                submission: Some(submission),
            },
        )
        .map_err(classify_command_error)?;
        let reject_code =
            ConversationCommandRejectCode::try_from(response.reject_code).map_err(|_| {
                CommandSubmitFailure::Terminal {
                    code: "invalid_reject_code".to_string(),
                }
            })?;
        if reject_code != ConversationCommandRejectCode::Unspecified {
            return match reject_code {
                ConversationCommandRejectCode::StaleDeliveryPlan => {
                    Err(CommandSubmitFailure::StaleDeliveryPlan {
                        current_plan: response.current_plan.ok_or_else(|| {
                            CommandSubmitFailure::Terminal {
                                code: "missing_stale_plan".to_string(),
                            }
                        })?,
                    })
                }
                ConversationCommandRejectCode::AuthorityPlanStale => {
                    Err(CommandSubmitFailure::StaleAuthorityPlan { expired: false })
                }
                ConversationCommandRejectCode::AuthorityPlanExpired => {
                    Err(CommandSubmitFailure::StaleAuthorityPlan { expired: true })
                }
                ConversationCommandRejectCode::RateLimited => {
                    Err(CommandSubmitFailure::Retryable {
                        code: "rate_limited".to_string(),
                    })
                }
                ConversationCommandRejectCode::Unspecified => unreachable!(),
                terminal => Err(CommandSubmitFailure::Terminal {
                    code: terminal
                        .as_str_name()
                        .trim_start_matches("CONVERSATION_COMMAND_REJECT_CODE_")
                        .to_ascii_lowercase(),
                }),
            };
        }
        if response.accepted_for_forwarding {
            return Ok(());
        }
        validate_committed_event(&command, response.event)
    }

    fn submit_member_authority_command(
        &self,
        command: &ConversationMemberAuthorityCommand,
    ) -> Result<(), CommandSubmitFailure> {
        let identity =
            self.remote_identity
                .as_ref()
                .ok_or_else(|| CommandSubmitFailure::Terminal {
                    code: "missing_remote_command_identity".to_string(),
                })?;
        let expected_action =
            ConversationMemberAuthorityAction::try_from(command.action).map_err(|_| {
                CommandSubmitFailure::Terminal {
                    code: "invalid_member_authority_action".to_string(),
                }
            })?;
        validate_member_authority_command(
            command,
            &CryptoEndpoint {
                ptid: identity.actor_ptid.clone(),
                device_id: self.device_id.clone(),
            },
            expected_action,
        )
        .map_err(classify_member_authority_error)?;
        let remote = command.authority_station_peer_id != identity.home_station_peer_id;
        let proposal = if remote {
            let response = get_proto::<_, GetConversationPublicHeadResponse>(
                &self.station_origin,
                self.access_token.as_str(),
                &self.device_id,
                "/conversation/public-head",
                &GetConversationPublicHeadRequest {
                    conversation_id: command.conversation_id.clone(),
                },
            )
            .map_err(classify_command_error)?;
            Some(build_remote_member_authority_proposal(
                command,
                identity,
                response
                    .head
                    .as_ref()
                    .ok_or_else(|| CommandSubmitFailure::Terminal {
                        code: "missing_conversation_public_head".to_string(),
                    })?,
            )?)
        } else {
            None
        };
        match expected_action {
            ConversationMemberAuthorityAction::UpdateMember => {
                let submission = match proposal {
                    Some(proposal) => {
                        update_conversation_member_request::Submission::Proposal(proposal)
                    }
                    None => {
                        update_conversation_member_request::Submission::Command(command.clone())
                    }
                };
                let response: UpdateConversationMemberResponse = post_member_authority_proto(
                    &self.station_origin,
                    self.access_token.as_str(),
                    &self.device_id,
                    "/conversation/member/update",
                    &UpdateConversationMemberRequest {
                        submission: Some(submission),
                    },
                )
                .map_err(classify_member_authority_error)?;
                validate_member_authority_submission_response(
                    command,
                    response.accepted_for_forwarding,
                    response.event.as_ref(),
                    remote,
                )
            }
            ConversationMemberAuthorityAction::TransferOwnership => {
                let submission = match proposal {
                    Some(proposal) => {
                        transfer_conversation_ownership_request::Submission::Proposal(proposal)
                    }
                    None => transfer_conversation_ownership_request::Submission::Command(
                        command.clone(),
                    ),
                };
                let response: TransferConversationOwnershipResponse = post_member_authority_proto(
                    &self.station_origin,
                    self.access_token.as_str(),
                    &self.device_id,
                    "/conversation/ownership/transfer",
                    &TransferConversationOwnershipRequest {
                        submission: Some(submission),
                    },
                )
                .map_err(classify_member_authority_error)?;
                validate_member_authority_submission_response(
                    command,
                    response.accepted_for_forwarding,
                    response.event.as_ref(),
                    remote,
                )
            }
            ConversationMemberAuthorityAction::Unspecified => Err(CommandSubmitFailure::Terminal {
                code: "invalid_member_authority_action".to_string(),
            }),
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

fn command_submission_kind(
    command: &ChatCommand,
    identity: &RemoteCommandIdentity,
) -> Result<CommandSubmissionKind, CommandSubmitFailure> {
    if command.authority_station_peer_id.trim().is_empty()
        || identity.home_station_peer_id.trim().is_empty()
    {
        return Err(CommandSubmitFailure::Terminal {
            code: "remote_route_binding".to_string(),
        });
    }
    if command.authority_station_peer_id == identity.home_station_peer_id {
        Ok(CommandSubmissionKind::LocalAuthority)
    } else {
        Ok(CommandSubmissionKind::RemoteAuthority)
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
        || sender.device_id != identity.signing_key.device_id()
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
    let command_sha256 = Sha256::digest(command.encode_to_vec()).to_vec();
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
        member_authority_command: None,
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

fn build_remote_member_authority_proposal(
    command: &ConversationMemberAuthorityCommand,
    identity: &RemoteCommandIdentity,
    head: &ConversationPublicHead,
) -> Result<ConversationCommandProposal, CommandSubmitFailure> {
    let operator = command
        .operator
        .as_ref()
        .ok_or_else(|| CommandSubmitFailure::Terminal {
            code: "missing_operator".to_string(),
        })?;
    let created_at_unix_ms =
        timestamp_unix_ms(command.client_timestamp.as_ref()).ok_or_else(|| {
            CommandSubmitFailure::Terminal {
                code: "invalid_command_timestamp".to_string(),
            }
        })?;
    let expires_at_unix_ms = timestamp_unix_ms(command.deadline.as_ref()).ok_or_else(|| {
        CommandSubmitFailure::Terminal {
            code: "invalid_command_deadline".to_string(),
        }
    })?;
    if operator.ptid != identity.actor_ptid
        || operator.device_id != identity.signing_key.device_id()
        || command.federation_id != head.federation_id
        || command.authority_station_peer_id != head.authority_station_peer_id
        || command.authority_epoch != head.authority_epoch
        || command.authority_sequence != head.group_seq
        || command.authority_hash != head.event_hash
        || command.observed_membership_epoch != head.membership_epoch
        || command.observed_mls_epoch != head.mls_epoch
        || head.conversation_id != command.conversation_id
        || head.authority_station_peer_id == identity.home_station_peer_id
        || ConversationPublicHeadSource::try_from(head.source).ok()
            != Some(ConversationPublicHeadSource::Follower)
        || expires_at_unix_ms <= created_at_unix_ms
    {
        return Err(CommandSubmitFailure::Terminal {
            code: "remote_route_binding".to_string(),
        });
    }
    let command_sha256 = Sha256::digest(command.encode_to_vec()).to_vec();
    let signing_input = ConversationCommandProposalSigningInput {
        version: COMMAND_PROPOSAL_FORMAT_VERSION,
        federation_id: command.federation_id.clone(),
        authority_station_peer_id: command.authority_station_peer_id.clone(),
        authority_epoch: command.authority_epoch,
        home_station_peer_id: identity.home_station_peer_id.clone(),
        conversation_id: command.conversation_id.clone(),
        command_id: command.command_id.clone(),
        command_kind: ConversationCommandKind::MemberAuthority as i32,
        actor_ptid: identity.actor_ptid.clone(),
        actor_device_id: operator.device_id.clone(),
        actor_signing_key_id: identity.signing_key_id.clone(),
        command_sha256: command_sha256.clone(),
        created_at_unix_ms,
        expires_at_unix_ms,
    };
    Ok(ConversationCommandProposal {
        version: COMMAND_PROPOSAL_FORMAT_VERSION,
        federation_id: command.federation_id.clone(),
        authority_station_peer_id: command.authority_station_peer_id.clone(),
        authority_epoch: command.authority_epoch,
        home_station_peer_id: identity.home_station_peer_id.clone(),
        actor_ptid: identity.actor_ptid.clone(),
        actor_device_id: operator.device_id.clone(),
        actor_signing_key_id: identity.signing_key_id.clone(),
        command: None,
        command_sha256,
        actor_signature: identity
            .signing_key
            .sign(&signing_input.encode_to_vec())
            .to_bytes()
            .to_vec(),
        created_at_unix_ms,
        expires_at_unix_ms,
        member_authority_command: Some(command.clone()),
    })
}

fn command_kind(command: &ChatCommand) -> Option<ConversationCommandKind> {
    match command.payload.as_ref()? {
        chat_command::Payload::SendMessage(_) => Some(ConversationCommandKind::SendMessage),
        chat_command::Payload::EditMessage(_) => Some(ConversationCommandKind::EditMessage),
        chat_command::Payload::RetractMessage(_) => Some(ConversationCommandKind::RetractMessage),
        chat_command::Payload::HideMessageForActor(_) => {
            Some(ConversationCommandKind::HideMessageForActor)
        }
        chat_command::Payload::ModerateMessage(_) => Some(ConversationCommandKind::ModerateMessage),
        chat_command::Payload::ForwardMessage(_) => Some(ConversationCommandKind::ForwardMessage),
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
    timestamp_unix_ms(command.client_timestamp.as_ref())
}

fn timestamp_unix_ms(timestamp: Option<&prost_types::Timestamp>) -> Option<i64> {
    let timestamp = timestamp?;
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
    event: Option<messaging_core::proto::chat::ConversationEvent>,
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

pub(super) fn get_proto<Request, Response>(
    station_origin: &str,
    access_token: &str,
    device_id: &str,
    path: &str,
    request: &Request,
) -> Result<Response, StationTransportError>
where
    Request: Message,
    Response: Message + Default,
{
    let client = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(classify_request_error)?;
    let response = client
        .get(format!("{}{path}", station_origin.trim_end_matches('/')))
        .bearer_auth(access_token)
        .header("X-Device-ID", device_id)
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf")
        .body(request.encode_to_vec())
        .send()
        .map_err(classify_request_error)?;
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.bytes().map_err(classify_response_error)?;
    if !status.is_success() {
        return Err(station_http_error(status.as_u16(), &headers, &bytes));
    }
    Response::decode(bytes.as_ref()).map_err(|_| StationTransportError::Decode)
}

pub(super) fn post_proto<Request, Response>(
    station_origin: &str,
    access_token: &str,
    device_id: &str,
    path: &str,
    request: &Request,
) -> Result<Response, StationTransportError>
where
    Request: Message,
    Response: Message + Default,
{
    let client = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(classify_request_error)?;
    let response = client
        .post(format!("{}{path}", station_origin.trim_end_matches('/')))
        .bearer_auth(access_token)
        .header("X-Device-ID", device_id)
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf")
        .body(request.encode_to_vec())
        .send()
        .map_err(classify_request_error)?;
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.bytes().map_err(classify_response_error)?;
    if !status.is_success() {
        return Err(station_http_error(status.as_u16(), &headers, &bytes));
    }
    Response::decode(bytes.as_ref()).map_err(|_| StationTransportError::Decode)
}

fn post_member_authority_proto<Request, Response>(
    station_origin: &str,
    access_token: &str,
    device_id: &str,
    path: &str,
    request: &Request,
) -> Result<Response, MemberAuthorityTransportError>
where
    Request: Message,
    Response: Message + Default,
{
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| MemberAuthorityTransportError {
            code: "MOBILE_MEMBER_AUTHORITY_NETWORK".to_string(),
            message: "build mobile member-authority transport".to_string(),
        })?;
    let response = client
        .post(format!("{}{path}", station_origin.trim_end_matches('/')))
        .bearer_auth(access_token)
        .header("X-Device-ID", device_id)
        .header(CONTENT_TYPE, "application/protobuf")
        .header(ACCEPT, "application/protobuf")
        .body(request.encode_to_vec())
        .send()
        .map_err(|error| MemberAuthorityTransportError {
            code: if error.is_timeout() {
                "MOBILE_MEMBER_AUTHORITY_DEADLINE"
            } else {
                "MOBILE_MEMBER_AUTHORITY_NETWORK"
            }
            .to_string(),
            message: error.to_string(),
        })?;
    let status = response.status();
    let error_code = response
        .headers()
        .get(MEMBER_AUTHORITY_ERROR_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .map_err(|error| MemberAuthorityTransportError {
            code: "MOBILE_MEMBER_AUTHORITY_RESPONSE_INVALID".to_string(),
            message: error.to_string(),
        })?;
    if !status.is_success() {
        return Err(MemberAuthorityTransportError {
            code: error_code
                .filter(|code| !code.trim().is_empty())
                .unwrap_or_else(|| format!("MOBILE_MEMBER_AUTHORITY_HTTP_{}", status.as_u16())),
            message: String::from_utf8_lossy(bytes.as_ref()).into_owned(),
        });
    }
    Response::decode(bytes.as_ref()).map_err(|_| member_authority_invalid("response_decode"))
}

pub(super) fn validate_transport_scope(
    station_origin: &str,
    access_token: &str,
    device_id: &str,
) -> Result<(), String> {
    if station_origin.trim().is_empty()
        || access_token.trim().is_empty()
        || device_id.trim().is_empty()
    {
        return Err("mobile messaging transport scope is incomplete".to_string());
    }
    Ok(())
}

fn classify_command_error(error: StationTransportError) -> CommandSubmitFailure {
    match error {
        StationTransportError::Deadline => CommandSubmitFailure::Retryable {
            code: "deadline".to_string(),
        },
        StationTransportError::Network => CommandSubmitFailure::Retryable {
            code: "network".to_string(),
        },
        StationTransportError::HttpStatus { status, .. }
            if status == 408 || status == 429 || status >= 500 =>
        {
            CommandSubmitFailure::Retryable {
                code: format!("http_{status}"),
            }
        }
        StationTransportError::HttpStatus { status, .. } => CommandSubmitFailure::Terminal {
            code: format!("http_{status}"),
        },
        StationTransportError::Decode => CommandSubmitFailure::Terminal {
            code: "invalid_response".to_string(),
        },
        StationTransportError::Invalid => CommandSubmitFailure::Terminal {
            code: "invalid_request".to_string(),
        },
    }
}

fn classify_member_authority_error(error: MemberAuthorityTransportError) -> CommandSubmitFailure {
    match error.code.as_str() {
        "MOBILE_MEMBER_AUTHORITY_NETWORK" | "MOBILE_MEMBER_AUTHORITY_DEADLINE" => {
            CommandSubmitFailure::Retryable { code: error.code }
        }
        _ => CommandSubmitFailure::Terminal { code: error.code },
    }
}

fn classify_request_error(error: reqwest::Error) -> StationTransportError {
    if error.is_timeout() {
        StationTransportError::Deadline
    } else {
        StationTransportError::Network
    }
}

fn classify_response_error(error: reqwest::Error) -> StationTransportError {
    if error.is_timeout() {
        StationTransportError::Deadline
    } else {
        StationTransportError::Decode
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};
    use messaging_core::identity::IdentityKeyPair;
    use messaging_core::proto::chat::{Conversation, MembershipTransitionIntent, ReactionIntent};

    fn remote_command_identity() -> RemoteCommandIdentity {
        let actor_identity = IdentityKeyPair::from_seed(&[6; 32]);
        let signing_key =
            DeviceSigningKey::generate_cross_signed(&actor_identity, "device-1", |_| Vec::new());
        RemoteCommandIdentity {
            actor_ptid: "ptid:bob".to_string(),
            home_station_peer_id: "station-five".to_string(),
            signing_key_id: hex_bytes(&Sha256::digest(signing_key.verifying_key().as_bytes())),
            signing_key,
        }
    }

    fn reaction_command(authority_station_peer_id: &str) -> ChatCommand {
        ChatCommand {
            command_id: "command-reaction".to_string(),
            conversation_id: "conversation-1".to_string(),
            sender: Some(CryptoEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "device-1".to_string(),
            }),
            observed_membership_epoch: 1,
            observed_mls_epoch: 0,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: 1_800_000_000,
                nanos: 0,
            }),
            delivery_plan_sha256: vec![7; 32],
            authority_station_peer_id: authority_station_peer_id.to_string(),
            payload: Some(chat_command::Payload::Reaction(ReactionIntent {
                message_id: "message-1".to_string(),
                reaction: "ack".to_string(),
                remove: false,
            })),
        }
    }

    fn member_authority_command() -> ConversationMemberAuthorityCommand {
        ConversationMemberAuthorityCommand {
            version: 1,
            command_id: "command-member-authority".to_string(),
            conversation_id: "conversation-1".to_string(),
            operator: Some(CryptoEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "device-1".to_string(),
            }),
            target_ptid: "ptid:alice".to_string(),
            action: ConversationMemberAuthorityAction::UpdateMember as i32,
            role: Some(MemberRole::Admin as i32),
            muted: Some(true),
            muted_until: None,
            federation_id: "federation-1".to_string(),
            authority_station_peer_id: "station-four".to_string(),
            authority_epoch: 3,
            authority_sequence: 2,
            authority_hash: vec![8; 32],
            observed_membership_epoch: 1,
            observed_mls_epoch: 1,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: 1_800_000_000,
                nanos: 0,
            }),
            deadline: Some(prost_types::Timestamp {
                seconds: 1_800_000_300,
                nanos: 0,
            }),
        }
    }

    fn prepared_group_genesis_command() -> ChatCommand {
        ChatCommand {
            command_id: "command-group".to_string(),
            conversation_id: "group-1".to_string(),
            sender: Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "device-1".to_string(),
            }),
            observed_membership_epoch: 0,
            observed_mls_epoch: 0,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: 1_800_000_000,
                nanos: 0,
            }),
            delivery_plan_sha256: vec![7; 32],
            authority_station_peer_id: "station-four".to_string(),
            payload: Some(chat_command::Payload::MembershipTransition(
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
            )),
        }
    }

    #[test]
    fn station_requests_use_the_ms_d15_thirty_second_deadline() {
        assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(30));
    }

    #[test]
    fn attachment_transport_requires_device_bound_endpoint() {
        assert!(StationAttachmentTransferTransport::new(
            "https://station.example".to_string(),
            "token".to_string(),
            "device-1".to_string(),
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "device-2".to_string(),
            },
        )
        .is_err());
    }

    #[test]
    fn canonical_attachment_error_preserves_retry_after() {
        let body = AttachmentTransferError {
            code: AttachmentTransferErrorCode::RetryLater as i32,
            retry_after: Some(prost_types::Duration {
                seconds: 1,
                nanos: 250_000_000,
            }),
        }
        .encode_to_vec();
        assert_eq!(
            decode_typed_transfer_failure(&body, Some(5_000)),
            Some(AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::RetryLater,
                Some(1_250),
                "mobile messaging attachment Station error \
                 ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER"
                    .to_string(),
            ))
        );
        assert_eq!(decode_typed_transfer_failure(b"not protobuf", None), None);
    }

    #[test]
    fn attachment_http_status_classification_is_bounded() {
        assert_eq!(
            classify_attachment_status(429, Some(2_000)),
            AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::QuotaExceeded,
                Some(2_000),
                "mobile messaging attachment Station returned HTTP 429".to_string(),
            )
        );
        assert_eq!(
            classify_attachment_status(416, None),
            AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::RangeInvalid,
                "mobile messaging attachment Station returned HTTP 416".to_string(),
            )
        );
    }

    #[test]
    fn attachment_download_request_uses_canonical_conversation_header() {
        let transport = StationAttachmentTransferTransport::new(
            "http://127.0.0.1:18080".to_string(),
            "token".to_string(),
            "bob-1".to_string(),
            CryptoEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "bob-1".to_string(),
            },
        )
        .unwrap();
        let transfer = AttachmentTransferRecord {
            attachment_id: "attachment-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            authority_station_id: "station:local".to_string(),
            direction: 2,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: String::new(),
            partial_local_ref: "attachment-1.part".to_string(),
            object_key: vec![1; 32],
            base_nonce: vec![2; 12],
            plaintext_size: 4,
            chunk_size: 4,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error_code: 0,
            updated_at_unix_ms: 1,
        };
        let descriptor = EncryptedObjectDescriptor {
            object_id: "object-1".to_string(),
            storage_ref: "storage-1".to_string(),
            ciphertext_size: 20,
            ciphertext_sha256: vec![3; 32],
            media_type: "application/octet-stream".to_string(),
            chunk_size: 4,
            chunk_count: 1,
            encryption_suite: 1,
            tag_size: 16,
            nonce_strategy: 1,
            chunk_ciphertext_sha256: vec![vec![4; 32]],
        };

        let request = transport
            .download_chunk_request(&transfer, &descriptor, 0, 19)
            .unwrap()
            .build()
            .unwrap();

        assert_eq!(
            request.url().as_str(),
            "http://127.0.0.1:18080/conversation/attachments/objects/object-1"
        );
        assert_eq!(
            request.headers()["X-Peers-Conversation-ID"],
            "conversation-1"
        );
        assert_eq!(
            request.headers()["X-Peers-Authority-Station-ID"],
            "station:local"
        );
        assert_eq!(
            request.headers()[IF_MATCH],
            format!("\"{}\"", "03".repeat(32))
        );
        assert_eq!(request.headers()[RANGE], "bytes=0-19");
    }

    #[test]
    fn transport_scope_rejects_missing_credentials() {
        assert!(StationQueueTransport::new(
            "https://station.example".to_string(),
            String::new(),
            "device-1".to_string(),
        )
        .is_err());
        assert!(StationCommandTransport::new(
            String::new(),
            "token".to_string(),
            "device-1".to_string(),
        )
        .is_err());
    }

    #[test]
    fn command_submission_selects_signed_proposal_for_remote_authority() {
        let identity = remote_command_identity();
        let remote = reaction_command("station-four");
        let local = reaction_command("station-five");

        assert_eq!(
            command_submission_kind(&remote, &identity),
            Ok(CommandSubmissionKind::RemoteAuthority)
        );
        assert_eq!(
            command_submission_kind(&local, &identity),
            Ok(CommandSubmissionKind::LocalAuthority)
        );
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
    fn established_membership_transition_uses_authority_command_route() {
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
    fn group_creation_response_requires_bound_group_and_event() {
        let command = prepared_group_genesis_command();
        let response = CreateGroupConversationResponse {
            conversation: Some(Conversation {
                conversation_id: command.conversation_id.clone(),
                kind: ConversationKind::Group as i32,
                ..Default::default()
            }),
            event: Some(messaging_core::proto::chat::ConversationEvent {
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

    #[test]
    fn remote_command_proposal_is_device_signed_and_exactly_repeatable() {
        let identity = remote_command_identity();
        let command = reaction_command("station-four");
        let head = ConversationPublicHead {
            conversation_id: command.conversation_id.clone(),
            source: ConversationPublicHeadSource::Follower as i32,
            federation_id: "federation-1".to_string(),
            authority_station_peer_id: command.authority_station_peer_id.clone(),
            authority_epoch: 3,
            group_seq: 2,
            event_hash: vec![8; 32],
            membership_epoch: 1,
            mls_epoch: 0,
            status: "active".to_string(),
            ..Default::default()
        };

        let first = build_remote_command_proposal(&command, &identity, &head).unwrap();
        let second = build_remote_command_proposal(&command, &identity, &head).unwrap();

        assert_eq!(first.encode_to_vec(), second.encode_to_vec());
        assert_eq!(first.command.as_ref(), Some(&command));
        assert_eq!(first.created_at_unix_ms, 1_800_000_000_000);
        assert_eq!(first.expires_at_unix_ms, 1_800_000_300_000);
        let signing_input = ConversationCommandProposalSigningInput {
            version: first.version,
            federation_id: first.federation_id.clone(),
            authority_station_peer_id: first.authority_station_peer_id.clone(),
            authority_epoch: first.authority_epoch,
            home_station_peer_id: first.home_station_peer_id.clone(),
            conversation_id: command.conversation_id.clone(),
            command_id: command.command_id.clone(),
            command_kind: ConversationCommandKind::React as i32,
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
    fn remote_member_authority_proposal_is_device_signed_and_exactly_bound() {
        let identity = remote_command_identity();
        let command = member_authority_command();
        let head = ConversationPublicHead {
            conversation_id: command.conversation_id.clone(),
            source: ConversationPublicHeadSource::Follower as i32,
            federation_id: command.federation_id.clone(),
            authority_station_peer_id: command.authority_station_peer_id.clone(),
            authority_epoch: command.authority_epoch,
            group_seq: command.authority_sequence,
            event_hash: command.authority_hash.clone(),
            membership_epoch: command.observed_membership_epoch,
            mls_epoch: command.observed_mls_epoch,
            status: "active".to_string(),
            ..Default::default()
        };

        let first = build_remote_member_authority_proposal(&command, &identity, &head).unwrap();
        let second = build_remote_member_authority_proposal(&command, &identity, &head).unwrap();

        assert_eq!(first.encode_to_vec(), second.encode_to_vec());
        assert!(first.command.is_none());
        assert_eq!(first.member_authority_command.as_ref(), Some(&command));
        assert_eq!(first.created_at_unix_ms, 1_800_000_000_000);
        assert_eq!(first.expires_at_unix_ms, 1_800_000_300_000);
        let signing_input = ConversationCommandProposalSigningInput {
            version: first.version,
            federation_id: first.federation_id.clone(),
            authority_station_peer_id: first.authority_station_peer_id.clone(),
            authority_epoch: first.authority_epoch,
            home_station_peer_id: first.home_station_peer_id.clone(),
            conversation_id: command.conversation_id.clone(),
            command_id: command.command_id.clone(),
            command_kind: ConversationCommandKind::MemberAuthority as i32,
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
    fn remote_command_proposal_rejects_non_follower_head() {
        let identity = remote_command_identity();
        let command = reaction_command("station-four");
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
    fn social_result_lookup_requires_exact_command_identity() {
        let transport = StationSocialTransport::new(
            "https://station.example".to_string(),
            "token".to_string(),
            "device-1".to_string(),
        )
        .unwrap();
        assert!(transport
            .lookup_friend_request_command_result(&LookupFriendRequestCommandResultRequest {
                command_id: String::new(),
                command_payload_sha256: vec![7; 32],
            },)
            .is_err());
        assert!(transport
            .lookup_friend_request_command_result(&LookupFriendRequestCommandResultRequest {
                command_id: "command-1".to_string(),
                command_payload_sha256: vec![7; 31],
            },)
            .is_err());
    }

    #[test]
    fn command_error_classification_is_bounded() {
        assert!(matches!(
            classify_command_error(StationTransportError::Network),
            CommandSubmitFailure::Retryable { .. }
        ));
        assert!(matches!(
            classify_command_error(StationTransportError::http_status(503)),
            CommandSubmitFailure::Retryable { .. }
        ));
        assert!(matches!(
            classify_command_error(StationTransportError::http_status(403)),
            CommandSubmitFailure::Terminal { .. }
        ));
    }

    #[test]
    fn station_http_error_preserves_public_error_context() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "X-Peers-Error-Code",
            reqwest::header::HeaderValue::from_static("CONVERSATION_CONFLICT"),
        );
        headers.insert(
            "X-Peers-Error-Details",
            reqwest::header::HeaderValue::from_static(
                r#"{"operation":"create_direct","reason":"conflict"}"#,
            ),
        );

        let error = station_http_error(409, &headers, b"fallback body");

        assert_eq!(
            error.to_string(),
            "mobile messaging Station returned HTTP 409 [CONVERSATION_CONFLICT]: \
             {\"operation\":\"create_direct\",\"reason\":\"conflict\"}"
        );
        assert!(matches!(
            error,
            StationTransportError::HttpStatus {
                status: 409,
                code: Some(_),
                details: Some(_),
                body: Some(_),
            }
        ));
    }
}
