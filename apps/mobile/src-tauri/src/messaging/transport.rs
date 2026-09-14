use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use messaging_core::attachment::{
    AttachmentTransferFailure, AttachmentTransferRecord, AttachmentTransferTransport,
    PreparedAttachmentUpload,
};
use messaging_core::crypto::prekeys::PreKeyTransport;
use messaging_core::identity::DeviceEnrollmentTransport;
use messaging_core::inbox::QueueTransport;
use messaging_core::mls::key_packages::MlsKeyPackageTransport;
use messaging_core::outbox::{CommandSubmitFailure, CommandTransport, KeyBundleTransport};
use messaging_core::proto::actor::{
    ActorDeviceRef, EnrollActorDeviceRequest, EnrollActorDeviceResponse,
};
use messaging_core::proto::chat::{
    submit_conversation_authority_command_request, AcknowledgeDeviceInboxItemRequest,
    AcknowledgeDeviceInboxItemResponse, AttachmentTransferError, AttachmentTransferErrorCode,
    AttachmentTransferState, BeginAttachmentUploadRequest, BeginAttachmentUploadResponse,
    CancelAttachmentUploadRequest, CancelAttachmentUploadResponse, ChatCommand,
    ClaimDeviceInboxRequest, ClaimDeviceInboxResponse, CompleteAttachmentUploadRequest,
    CompleteAttachmentUploadResponse, ConversationCommandRejectCode,
    CreateDirectConversationRequest, CreateDirectConversationResponse, CryptoEndpoint,
    DeviceConsumptionReceipt, EncryptedObjectDescriptor, ListConversationsRequest,
    ListConversationsResponse, PrepareConversationCommandRequest,
    PrepareConversationCommandResponse, PrepareConversationGroupRequest,
    PrepareConversationGroupResponse, PutAttachmentChunkRequest, PutAttachmentChunkResponse,
    SubmitConversationAuthorityCommandRequest, SubmitConversationAuthorityCommandResponse,
    SubmitConversationDeliveryReceiptRequest, SubmitConversationDeliveryReceiptResponse,
    SubmitConversationReadCursorRequest, SubmitConversationReadCursorResponse,
    SubmitConversationTypingRequest, SubmitConversationTypingResponse,
};
use messaging_core::proto::key_exchange::{
    DirectKeyBundle, FetchDirectKeyBundlesRequest, FetchDirectKeyBundlesResponse,
    UploadDirectKeyBundleRequest, UploadDirectKeyBundleResponse, UploadMlsKeyPackageRequest,
    UploadMlsKeyPackageResponse,
};
use messaging_core::proto::social::{
    AcceptSocialFriendRequestRequest, AcceptSocialFriendRequestResponse, FriendRequestCommand,
    RejectSocialFriendRequestRequest, RejectSocialFriendRequestResponse,
    SendSocialFriendRequestRequest, SendSocialFriendRequestResponse,
};
use messaging_core::proto::{actor_device_ptid, actor_device_ref};
use prost::Message;
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, IF_MATCH, RANGE, RETRY_AFTER};
use secure_content_core::object::{
    EncryptedObjectChunk as EncryptedAttachmentChunk, OBJECT_TAG_SIZE as ATTACHMENT_TAG_SIZE,
};
use zeroize::Zeroizing;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

enum StationTransportError {
    Network,
    HttpStatus(u16),
    Decode,
}

impl std::fmt::Display for StationTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network => formatter.write_str("mobile messaging Station network request failed"),
            Self::HttpStatus(status) => {
                write!(formatter, "mobile messaging Station returned HTTP {status}")
            }
            Self::Decode => formatter.write_str("mobile messaging Station response is invalid"),
        }
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
        let mut url = reqwest::Url::parse(&format!(
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
        url.query_pairs_mut()
            .append_pair("conversation_id", &transfer.conversation_id);
        let response = self
            .client
            .get(url)
            .header(
                AUTHORIZATION,
                format!("Bearer {}", self.access_token.as_str()),
            )
            .header("X-Device-ID", &self.device_id)
            .header(
                "X-Peers-Authority-Station-ID",
                &transfer.authority_station_id,
            )
            .header(
                IF_MATCH,
                format!("\"{}\"", hex_bytes(&descriptor.ciphertext_sha256)),
            )
            .header(RANGE, format!("bytes={start}-{end}"))
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
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/device/enroll",
            request,
        )
        .map_err(|error| error.to_string())
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
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/device/inbox/claim",
            &request,
        )
        .map_err(|error| error.to_string())
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

    pub fn send_friend_request(
        &self,
        request: &SendSocialFriendRequestRequest,
    ) -> Result<SendSocialFriendRequestResponse, String> {
        self.validate_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/friend-request/send",
            request,
        )
        .map_err(|error| error.to_string())
    }

    pub fn accept_friend_request(
        &self,
        request: &AcceptSocialFriendRequestRequest,
    ) -> Result<AcceptSocialFriendRequestResponse, String> {
        self.validate_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/friend-request/accept",
            request,
        )
        .map_err(|error| error.to_string())
    }

    pub fn reject_friend_request(
        &self,
        request: &RejectSocialFriendRequestRequest,
    ) -> Result<RejectSocialFriendRequestResponse, String> {
        self.validate_command(request.command.as_ref())?;
        post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/api/v1/social/friend-request/reject",
            request,
        )
        .map_err(|error| error.to_string())
    }

    fn validate_command(&self, command: Option<&FriendRequestCommand>) -> Result<(), String> {
        let command = command
            .ok_or_else(|| "mobile Social Friend Request command is required".to_string())?;
        let body = command
            .body
            .as_ref()
            .ok_or_else(|| "mobile Social Friend Request command body is required".to_string())?;
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
            return Err("mobile Social Friend Request command binding is incomplete".to_string());
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
}

pub struct StationCommandTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
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
        })
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
}

pub struct StationKeyBundleTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
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
        let response = post_proto::<_, SubmitConversationAuthorityCommandResponse>(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/command",
            &SubmitConversationAuthorityCommandRequest {
                submission: Some(
                    submit_conversation_authority_command_request::Submission::Command(
                        command.clone(),
                    ),
                ),
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

fn get_proto<Request, Response>(
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
        .map_err(|_| StationTransportError::Network)?;
    let response = client
        .get(format!("{}{path}", station_origin.trim_end_matches('/')))
        .bearer_auth(access_token)
        .header("X-Device-ID", device_id)
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf")
        .body(request.encode_to_vec())
        .send()
        .map_err(|_| StationTransportError::Network)?;
    let status = response.status();
    let bytes = response
        .bytes()
        .map_err(|_| StationTransportError::Decode)?;
    if !status.is_success() {
        return Err(StationTransportError::HttpStatus(status.as_u16()));
    }
    Response::decode(bytes.as_ref()).map_err(|_| StationTransportError::Decode)
}

fn post_proto<Request, Response>(
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
        .map_err(|_| StationTransportError::Network)?;
    let response = client
        .post(format!("{}{path}", station_origin.trim_end_matches('/')))
        .bearer_auth(access_token)
        .header("X-Device-ID", device_id)
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf")
        .body(request.encode_to_vec())
        .send()
        .map_err(|_| StationTransportError::Network)?;
    let status = response.status();
    let bytes = response
        .bytes()
        .map_err(|_| StationTransportError::Decode)?;
    if !status.is_success() {
        return Err(StationTransportError::HttpStatus(status.as_u16()));
    }
    Response::decode(bytes.as_ref()).map_err(|_| StationTransportError::Decode)
}

fn validate_transport_scope(
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
        StationTransportError::Network => CommandSubmitFailure::Retryable {
            code: "network".to_string(),
        },
        StationTransportError::HttpStatus(status)
            if status == 408 || status == 429 || status >= 500 =>
        {
            CommandSubmitFailure::Retryable {
                code: format!("http_{status}"),
            }
        }
        StationTransportError::HttpStatus(status) => CommandSubmitFailure::Terminal {
            code: format!("http_{status}"),
        },
        StationTransportError::Decode => CommandSubmitFailure::Terminal {
            code: "invalid_response".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn command_error_classification_is_bounded() {
        assert!(matches!(
            classify_command_error(StationTransportError::Network),
            CommandSubmitFailure::Retryable { .. }
        ));
        assert!(matches!(
            classify_command_error(StationTransportError::HttpStatus(503)),
            CommandSubmitFailure::Retryable { .. }
        ));
        assert!(matches!(
            classify_command_error(StationTransportError::HttpStatus(403)),
            CommandSubmitFailure::Terminal { .. }
        ));
    }
}
