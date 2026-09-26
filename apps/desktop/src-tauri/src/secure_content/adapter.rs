use std::io::Read;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::{
    HeaderMap, ACCEPT, ACCEPT_RANGES, AUTHORIZATION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
    ETAG, RANGE, RETRY_AFTER,
};
use secure_content_core::object::{
    EncryptedObjectChunk, ObjectDescriptor, ObjectEncryptionSuite, ObjectNonceStrategy,
    ObjectTransferErrorCode, ObjectTransferFailure, ObjectTransferRecord, ObjectUploadSpec,
    PreparedObjectUpload,
};
use secure_content_core::ports::{ObjectCommitmentCodec, ObjectTransferTransport};
use secure_content_core::prekey::canonicalize_publish_content_prekeys_request;
use sha2::{Digest, Sha256};

use crate::model::{actor, error as error_model, federation, secure_content as wire, social};

use super::store::SecureContentStore;
use super::{SecureContentRequestGuard, SecureContentSession};

const MAX_PROTO_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_RETRY_AFTER_MAX_SECONDS: u64 = 300;
const PRIVATE_CONTENT_CODE_DETAIL: &str = "private_content_code";
const CLIENT_SIGNING_DOMAIN: &[u8] = b"peers-touch:secure-content:client-command:v1\0";
const PUBLISH_CAPABILITY: &str = "key_exchange.content_prekey.publish";
const INVENTORY_CAPABILITY: &str = "key_exchange.content_prekey.inventory";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeErrorDisposition {
    Terminal,
    Retryable,
    UnknownCommit,
    PoolNotFound,
}

#[derive(Clone, Copy)]
enum RequestCommitSemantics {
    ReadOnly,
    MayCommit,
}

#[derive(Clone, Copy)]
enum RetryAfterSemantics {
    Bounded,
    Exact,
}

impl RetryAfterSemantics {
    fn apply(self, seconds: u64) -> u64 {
        match self {
            Self::Bounded => seconds.min(DEFAULT_RETRY_AFTER_MAX_SECONDS),
            Self::Exact => seconds,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeTransportError {
    pub http_status: Option<u16>,
    pub stable_code: i32,
    pub retry_after_seconds: Option<u64>,
    pub disposition: NativeErrorDisposition,
    pub message: String,
}

impl std::fmt::Display for NativeTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "secure content transport failed (status={:?}, code={})",
            self.http_status, self.stable_code
        )
    }
}

impl std::error::Error for NativeTransportError {}

pub struct SecureContentTransport {
    session: Arc<SecureContentSession>,
    client: Client,
}

impl SecureContentTransport {
    pub fn new(session: Arc<SecureContentSession>) -> Result<Self, String> {
        if session.station_url.trim().is_empty() || session.key.device_id.trim().is_empty() {
            return Err("secure content transport identity is incomplete".to_string());
        }
        session.begin_request()?;
        Ok(Self {
            session,
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|error| format!("build secure content HTTP client: {error}"))?,
        })
    }

    pub fn inventory(
        &self,
        kind: wire::ContentPreKeyKind,
    ) -> Result<wire::ContentPreKeyInventory, NativeTransportError> {
        let publisher = self.publisher();
        let target = content_prekey_target(kind, &publisher);
        let mut request = wire::GetContentPreKeyInventoryRequest {
            publisher: Some(publisher),
            target: Some(target),
            request_id: format!("cpk-inventory-{}", ulid::Ulid::new()),
            proof: None,
        };
        let request_hash: [u8; 32] = Sha256::digest(request.encode_to_vec()).into();
        request.proof =
            Some(self.client_proof(INVENTORY_CAPABILITY, &request.request_id, request_hash)?);
        let response: wire::GetContentPreKeyInventoryResponse =
            self.post_proto("/key-exchange/content-prekeys/inventory", &request)?;
        response.inventory.ok_or_else(|| NativeTransportError {
            http_status: None,
            stable_code: error_model::ErrorCode::InternalServerError as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "Content PreKey inventory response is incomplete".to_string(),
        })
    }

    pub fn publish_proof_free(
        &self,
        proof_free_bytes: &[u8],
    ) -> Result<wire::PublishContentPreKeysResponse, NativeTransportError> {
        let canonical_proof_free = canonicalize_publish_content_prekeys_request(proof_free_bytes)
            .map_err(|_| {
            invalid_local_request("stored publication request is not canonical")
        })?;
        if canonical_proof_free != proof_free_bytes {
            return Err(invalid_local_request(
                "stored publication request is not canonical",
            ));
        }
        let mut request =
            wire::PublishContentPreKeysRequest::decode(canonical_proof_free.as_slice())
                .map_err(|_| invalid_local_request("stored publication request is invalid"))?;
        if request.proof.is_some() || request.command_id.trim().is_empty() {
            return Err(invalid_local_request(
                "stored publication request is not proof-free",
            ));
        }
        let request_hash: [u8; 32] = Sha256::digest(&canonical_proof_free).into();
        request.proof =
            Some(self.client_proof(PUBLISH_CAPABILITY, &request.command_id, request_hash)?);
        let request_bytes = canonical_publication_bytes(&request).map_err(invalid_local_request)?;
        self.post_proto_bytes_with_retry_after(
            "/key-exchange/content-prekeys/publish",
            &request_bytes,
            RetryAfterSemantics::Bounded,
        )
    }

    pub fn prepare_private_moment(
        &self,
        request: &social::PreparePrivateMomentRequest,
    ) -> Result<social::PreparePrivateMomentResponse, NativeTransportError> {
        self.post_proto("/api/v1/social/moments/prepare-private", request)
    }

    pub fn submit_private_moment(
        &self,
        request: &social::SubmitPrivateMomentRequest,
    ) -> Result<social::SubmitPrivateMomentResponse, NativeTransportError> {
        self.post_proto("/api/v1/social/moments/submit-private", request)
    }

    pub fn prepare_private_comment(
        &self,
        post_id: &str,
        request: &social::PreparePrivateCommentRequest,
    ) -> Result<social::PreparePrivateCommentResponse, NativeTransportError> {
        self.post_comment_proto(
            &format!("/api/v1/social/moments/{post_id}/comments/prepare-private"),
            request,
        )
    }

    pub fn submit_private_comment(
        &self,
        post_id: &str,
        request_bytes: &[u8],
    ) -> Result<social::SubmitPrivateCommentResponse, NativeTransportError> {
        if request_bytes.is_empty() {
            return Err(invalid_local_request(
                "private Comment submission bytes are unavailable",
            ));
        }
        social::SubmitPrivateCommentRequest::decode(request_bytes)
            .map_err(|_| invalid_local_request("private Comment submission bytes are malformed"))?;
        self.post_proto_bytes_with_retry_after(
            &format!("/api/v1/social/moments/{post_id}/comments/submit-private"),
            request_bytes,
            RetryAfterSemantics::Exact,
        )
    }

    pub fn get_private_comment(
        &self,
        post_id: &str,
        comment_id: &str,
    ) -> Result<social::GetMomentCommentResourceResponse, NativeTransportError> {
        self.get_comment_proto(
            &format!("/api/v1/social/moments/{post_id}/comments/{comment_id}"),
            None,
        )
    }

    pub fn list_moment_comments(
        &self,
        post_id: &str,
        cursor: &str,
        limit: u32,
    ) -> Result<social::ListMomentCommentsResponse, NativeTransportError> {
        let query = [("cursor", cursor.to_string()), ("limit", limit.to_string())];
        self.get_comment_proto(
            &format!("/api/v1/social/moments/{post_id}/comments"),
            Some(&query),
        )
    }

    pub fn get_private_moment(
        &self,
        post_id: &str,
    ) -> Result<social::GetMomentResourceResponse, NativeTransportError> {
        self.get_proto(&format!("/api/v1/social/moments/{post_id}"), None)
    }

    pub fn get_actor_federation_profile(
        &self,
        sender: &actor::ActorRef,
    ) -> Result<federation::ActorProfileEnvelope, NativeTransportError> {
        let canonical_handle = canonical_actor_federated_handle(sender)?;
        let query = [("handle", canonical_handle.clone())];
        let envelope: federation::ActorProfileEnvelope =
            self.get_proto("/actor/federation/profile", Some(&query))?;
        validate_actor_federation_profile_handle(&envelope, &canonical_handle)?;
        Ok(envelope)
    }

    pub fn list_recoverable(
        &self,
        cursor: &str,
        limit: u32,
    ) -> Result<social::ListRecoverablePrivateContentResponse, NativeTransportError> {
        let query = [("cursor", cursor.to_string()), ("limit", limit.to_string())];
        self.get_proto("/api/v1/social/moments/recoverable", Some(&query))
    }

    fn publisher(&self) -> actor::ActorDeviceRef {
        actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: self.session.key.actor_ptid.clone(),
                ..Default::default()
            }),
            device_id: self.session.key.device_id.clone(),
        }
    }

    fn client_proof(
        &self,
        capability_id: &str,
        request_id: &str,
        request_sha256: [u8; 32],
    ) -> Result<wire::ContentPreKeyClientProof, NativeTransportError> {
        let mut nonce = vec![0_u8; 32];
        OsRng.fill_bytes(&mut nonce);
        let input = wire::ContentPreKeyClientSigningInput {
            format_version: 1,
            capability_id: capability_id.to_string(),
            station_peer_id: self.session.key.station_peer_id.clone(),
            session_id: self.session.key.jwt_session_id.clone(),
            publisher: Some(self.publisher()),
            publisher_signing_key_id: self.session.signing_key_id.clone(),
            publisher_profile_version: self.session.profile_version,
            request_id: request_id.to_string(),
            request_sha256: request_sha256.to_vec(),
            nonce,
            issued_at: Some(now_timestamp()),
        };
        let mut signing_bytes =
            Vec::with_capacity(CLIENT_SIGNING_DOMAIN.len() + input.encoded_len());
        signing_bytes.extend_from_slice(CLIENT_SIGNING_DOMAIN);
        signing_bytes.extend_from_slice(&input.encode_to_vec());
        Ok(wire::ContentPreKeyClientProof {
            input: Some(input),
            signature: self.session.sign(&signing_bytes).map_err(cancelled_error)?,
        })
    }

    fn post_proto<Req, Resp>(&self, path: &str, request: &Req) -> Result<Resp, NativeTransportError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        self.post_proto_with_retry_after(path, request, RetryAfterSemantics::Bounded)
    }

    fn post_comment_proto<Req, Resp>(
        &self,
        path: &str,
        request: &Req,
    ) -> Result<Resp, NativeTransportError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        self.post_proto_with_retry_after(path, request, RetryAfterSemantics::Exact)
    }

    fn post_proto_with_retry_after<Req, Resp>(
        &self,
        path: &str,
        request: &Req,
        retry_after_semantics: RetryAfterSemantics,
    ) -> Result<Resp, NativeTransportError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        self.post_proto_bytes_with_retry_after(
            path,
            &request.encode_to_vec(),
            retry_after_semantics,
        )
    }

    fn post_proto_bytes_with_retry_after<Resp>(
        &self,
        path: &str,
        request_bytes: &[u8],
        retry_after_semantics: RetryAfterSemantics,
    ) -> Result<Resp, NativeTransportError>
    where
        Resp: Message + Default,
    {
        let (_guard, builder) = self.request(reqwest::Method::POST, path)?;
        let response = with_proto_content_negotiation(builder)
            .body(request_bytes.to_vec())
            .send()
            .map_err(network_error)?;
        let result = decode_proto_response_with_retry_after(
            response,
            RequestCommitSemantics::MayCommit,
            retry_after_semantics,
        );
        result
    }

    fn get_proto<Resp>(
        &self,
        path: &str,
        query: Option<&[(&str, String)]>,
    ) -> Result<Resp, NativeTransportError>
    where
        Resp: Message + Default,
    {
        self.get_proto_with_retry_after(path, query, RetryAfterSemantics::Bounded)
    }

    fn get_comment_proto<Resp>(
        &self,
        path: &str,
        query: Option<&[(&str, String)]>,
    ) -> Result<Resp, NativeTransportError>
    where
        Resp: Message + Default,
    {
        self.get_proto_with_retry_after(path, query, RetryAfterSemantics::Exact)
    }

    fn get_proto_with_retry_after<Resp>(
        &self,
        path: &str,
        query: Option<&[(&str, String)]>,
        retry_after_semantics: RetryAfterSemantics,
    ) -> Result<Resp, NativeTransportError>
    where
        Resp: Message + Default,
    {
        let (_guard, mut request) = self.request(reqwest::Method::GET, path)?;
        request = with_proto_content_negotiation(request);
        if let Some(query) = query {
            request = request.query(query);
        }
        decode_proto_response_with_retry_after(
            request.send().map_err(network_error)?,
            RequestCommitSemantics::ReadOnly,
            retry_after_semantics,
        )
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<(SecureContentRequestGuard<'_>, RequestBuilder), NativeTransportError> {
        let guard = self.session.begin_request().map_err(cancelled_error)?;
        let request = self
            .client
            .request(
                method,
                format!("{}{}", self.session.station_url.trim_end_matches('/'), path),
            )
            .header(AUTHORIZATION, format!("Bearer {}", guard.token()))
            .header("X-Device-ID", &self.session.key.device_id);
        Ok((guard, request))
    }
}

fn with_proto_content_negotiation(request: RequestBuilder) -> RequestBuilder {
    request
        .header(CONTENT_TYPE, "application/protobuf")
        .header(ACCEPT, "application/protobuf")
}

pub fn jwt_session_id(token: &str) -> Result<String, String> {
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| "secure content session token is malformed".to_string())?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "secure content session token payload is malformed".to_string())?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded)
        .map_err(|_| "secure content session token claims are malformed".to_string())?;
    claims
        .get("session_id")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.trim() == *value)
        .map(ToOwned::to_owned)
        .ok_or_else(|| "secure content session token has no validated session ID".to_string())
}

pub fn canonical_publication_bytes(
    request: &wire::PublishContentPreKeysRequest,
) -> Result<Vec<u8>, String> {
    canonicalize_publish_content_prekeys_request(&request.encode_to_vec())
        .map_err(|error| format!("canonicalize Content PreKey publication: {error}"))
}

pub fn publication_command_id(
    request: &wire::PublishContentPreKeysRequest,
) -> Result<String, String> {
    let mut payload = request.clone();
    payload.command_id.clear();
    payload.proof = None;
    Ok(format!(
        "cpk-pub-v1-{}",
        hex::encode(Sha256::digest(canonical_publication_bytes(&payload)?))
    ))
}

pub fn content_prekey_target(
    kind: wire::ContentPreKeyKind,
    publisher: &actor::ActorDeviceRef,
) -> wire::ContentPreKeyClaimTarget {
    use wire::content_pre_key_claim_target::Principal;
    let principal = match kind {
        wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => {
            Principal::Endpoint(publisher.clone())
        }
        wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
            Principal::RecoveryActor(publisher.actor.clone().unwrap_or_default())
        }
        wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => {
            unreachable!("validated callers never request an unspecified pool")
        }
    };
    wire::ContentPreKeyClaimTarget {
        kind: kind as i32,
        principal: Some(principal),
    }
}

fn decode_proto_response<Resp: Message + Default>(
    response: Response,
    semantics: RequestCommitSemantics,
) -> Result<Resp, NativeTransportError> {
    decode_proto_response_with_retry_after(response, semantics, RetryAfterSemantics::Bounded)
}

fn decode_proto_response_with_retry_after<Resp: Message + Default>(
    response: Response,
    semantics: RequestCommitSemantics,
    retry_after_semantics: RetryAfterSemantics,
) -> Result<Resp, NativeTransportError> {
    let status = response.status();
    let retry_after_seconds = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let body = bounded_response_body(response).map_err(|error| {
        if status.is_success() && matches!(semantics, RequestCommitSemantics::MayCommit) {
            committed_response_error(status.as_u16(), error.message)
        } else {
            error
        }
    })?;
    if !status.is_success() {
        return Err(decode_typed_error_with_retry_after(
            status.as_u16(),
            &body,
            retry_after_seconds,
            semantics,
            retry_after_semantics,
        ));
    }
    Resp::decode(body.as_slice()).map_err(|_| NativeTransportError {
        http_status: Some(status.as_u16()),
        stable_code: error_model::ErrorCode::InvalidProtobuf as i32,
        retry_after_seconds: None,
        disposition: match semantics {
            RequestCommitSemantics::ReadOnly => NativeErrorDisposition::Terminal,
            RequestCommitSemantics::MayCommit => NativeErrorDisposition::UnknownCommit,
        },
        message: "Station returned an invalid protobuf response".to_string(),
    })
}

fn bounded_response_body(response: Response) -> Result<Vec<u8>, NativeTransportError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PROTO_RESPONSE_BYTES as u64)
    {
        return Err(invalid_local_request(
            "Station response exceeds the client bound",
        ));
    }
    let mut body = Vec::new();
    response
        .take(MAX_PROTO_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut body)
        .map_err(network_error)?;
    if body.len() > MAX_PROTO_RESPONSE_BYTES {
        return Err(invalid_local_request(
            "Station response exceeds the client bound",
        ));
    }
    Ok(body)
}

fn decode_typed_error(
    status: u16,
    body: &[u8],
    retry_after_seconds: Option<u64>,
    semantics: RequestCommitSemantics,
) -> NativeTransportError {
    decode_typed_error_with_retry_after(
        status,
        body,
        retry_after_seconds,
        semantics,
        RetryAfterSemantics::Bounded,
    )
}

fn decode_typed_error_with_retry_after(
    status: u16,
    body: &[u8],
    retry_after_seconds: Option<u64>,
    semantics: RequestCommitSemantics,
    retry_after_semantics: RetryAfterSemantics,
) -> NativeTransportError {
    let typed = error_model::ErrorResponse::decode(body).ok();
    let stable_code = typed
        .as_ref()
        .map(|error| error.code)
        .unwrap_or(error_model::ErrorCode::Undefined as i32);
    let message = typed
        .as_ref()
        .and_then(|error| error.details.get(PRIVATE_CONTENT_CODE_DETAIL))
        .filter(|code| !code.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| {
            error_model::ErrorCode::try_from(stable_code)
                .map(|code| code.as_str_name().to_string())
                .unwrap_or_else(|_| "ERROR_CODE_UNDEFINED".to_string())
        });
    let disposition = match (typed.is_some(), stable_code) {
        (false, _) if matches!(semantics, RequestCommitSemantics::MayCommit) => {
            NativeErrorDisposition::UnknownCommit
        }
        (_, 30203) => NativeErrorDisposition::PoolNotFound,
        (_, 30208 | 30209) => NativeErrorDisposition::Retryable,
        (_, 20008) if status >= 500 => NativeErrorDisposition::UnknownCommit,
        _ if status >= 500 => NativeErrorDisposition::UnknownCommit,
        _ => NativeErrorDisposition::Terminal,
    };
    NativeTransportError {
        http_status: Some(status),
        stable_code,
        retry_after_seconds: retry_after_seconds
            .map(|seconds| retry_after_semantics.apply(seconds)),
        disposition,
        message,
    }
}

fn network_error(error: impl std::fmt::Display) -> NativeTransportError {
    NativeTransportError {
        http_status: None,
        stable_code: error_model::ErrorCode::Undefined as i32,
        retry_after_seconds: None,
        disposition: NativeErrorDisposition::UnknownCommit,
        message: format!("secure content network request failed: {error}"),
    }
}

fn unknown_commit_error(message: impl Into<String>) -> NativeTransportError {
    NativeTransportError {
        http_status: None,
        stable_code: error_model::ErrorCode::Undefined as i32,
        retry_after_seconds: None,
        disposition: NativeErrorDisposition::UnknownCommit,
        message: message.into(),
    }
}

fn committed_response_error(status: u16, message: impl Into<String>) -> NativeTransportError {
    NativeTransportError {
        http_status: Some(status),
        stable_code: error_model::ErrorCode::InvalidProtobuf as i32,
        retry_after_seconds: None,
        disposition: NativeErrorDisposition::UnknownCommit,
        message: message.into(),
    }
}

fn canonical_actor_federated_handle(
    sender: &actor::ActorRef,
) -> Result<String, NativeTransportError> {
    if sender.ptid.trim().is_empty() || sender.ptid.trim() != sender.ptid {
        return Err(invalid_local_request(
            "Actor Federation profile PTID is invalid",
        ));
    }
    canonical_federated_handle(&sender.acct).ok_or_else(|| {
        invalid_local_request("Actor Federation profile persisted handle is unavailable")
    })
}

fn canonical_federated_handle(value: &str) -> Option<String> {
    if value.trim().is_empty() || value.trim() != value || value.as_bytes().contains(&0) {
        return None;
    }
    let bare = value
        .strip_prefix('@')
        .unwrap_or(value)
        .to_ascii_lowercase();
    let mut parts = bare.split('@');
    if parts.next().is_none_or(str::is_empty)
        || parts.next().is_none_or(str::is_empty)
        || parts.next().is_some()
    {
        return None;
    }
    Some(format!("@{bare}"))
}

fn validate_actor_federation_profile_handle(
    envelope: &federation::ActorProfileEnvelope,
    expected_handle: &str,
) -> Result<(), NativeTransportError> {
    if envelope.federated_handle != expected_handle {
        return Err(invalid_local_request(
            "Actor Federation profile response changed the requested handle",
        ));
    }
    Ok(())
}

fn cancelled_error(error: impl std::fmt::Display) -> NativeTransportError {
    unknown_commit_error(error.to_string())
}

fn invalid_local_request(message: impl Into<String>) -> NativeTransportError {
    NativeTransportError {
        http_status: None,
        stable_code: error_model::ErrorCode::InvalidRequest as i32,
        retry_after_seconds: None,
        disposition: NativeErrorDisposition::Terminal,
        message: message.into(),
    }
}

fn now_timestamp() -> prost_types::Timestamp {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    prost_types::Timestamp {
        seconds: duration.as_secs().min(i64::MAX as u64) as i64,
        nanos: duration.subsec_nanos() as i32,
    }
}

#[derive(Clone, Default)]
pub struct SocialObjectCodec {
    download_descriptor_sha256: Option<(String, [u8; 32])>,
}

impl SocialObjectCodec {
    pub fn for_download(descriptor: &wire::EncryptedObjectDescriptor) -> Result<Self, String> {
        Self::descriptor_to_core(descriptor).map_err(|error| error.to_string())?;
        Ok(Self {
            download_descriptor_sha256: Some((
                descriptor.object_id.clone(),
                Sha256::digest(descriptor.encode_to_vec()).into(),
            )),
        })
    }

    pub fn upload_spec(
        transfer: &ObjectTransferRecord,
        object: &ObjectUploadSpec,
    ) -> wire::EncryptedObjectUploadSpec {
        wire::EncryptedObjectUploadSpec {
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: transfer.owner_scope_id.clone(),
                generation: 1,
            }),
            object_id: transfer.operation_id.clone(),
            ciphertext_size: object.ciphertext_size,
            ciphertext_sha256: object.ciphertext_sha256.clone(),
            chunk_size: object.chunk_size,
            chunk_count: object.chunk_count,
            encryption_suite: wire::ObjectEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: object.tag_size,
            nonce_strategy: wire::ObjectNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: object.chunk_ciphertext_sha256.clone(),
        }
    }

    pub fn descriptor_to_core(
        descriptor: &wire::EncryptedObjectDescriptor,
    ) -> Result<ObjectDescriptor, ObjectTransferFailure> {
        let commitment = descriptor.commitment.as_ref().ok_or_else(|| {
            ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "Social object descriptor has no commitment",
            )
        })?;
        if descriptor.resource.is_none()
            || descriptor.resource != commitment.resource
            || descriptor.object_id.trim().is_empty()
            || descriptor.object_id != commitment.object_id
            || commitment.encryption_suite != wire::ObjectEncryptionSuite::Aes256GcmChunked as i32
            || commitment.nonce_strategy != wire::ObjectNonceStrategy::Counter32Be as i32
            || commitment.tag_size != secure_content_core::object::OBJECT_TAG_SIZE
        {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "Social object descriptor identity is inconsistent",
            ));
        }
        Ok(ObjectDescriptor {
            object_id: descriptor.object_id.clone(),
            storage_ref: descriptor.storage_ref.clone(),
            commitment: ObjectUploadSpec {
                ciphertext_size: commitment.ciphertext_size,
                ciphertext_sha256: commitment.ciphertext_sha256.clone(),
                media_type: None,
                chunk_size: commitment.chunk_size,
                chunk_count: commitment.chunk_count,
                encryption_suite: ObjectEncryptionSuite::Aes256GcmChunked,
                tag_size: commitment.tag_size,
                nonce_strategy: ObjectNonceStrategy::Counter32Be,
                chunk_ciphertext_sha256: commitment.chunk_ciphertext_sha256.clone(),
            },
        })
    }

    pub fn descriptor_from_core(
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
    ) -> wire::EncryptedObjectDescriptor {
        wire::EncryptedObjectDescriptor {
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: transfer.owner_scope_id.clone(),
                generation: 1,
            }),
            object_id: descriptor.object_id.clone(),
            storage_ref: descriptor.storage_ref.clone(),
            commitment: Some(Self::upload_spec(transfer, &descriptor.commitment)),
        }
    }
}

impl ObjectCommitmentCodec for SocialObjectCodec {
    fn upload_commitment(
        &self,
        transfer: &ObjectTransferRecord,
        object: &ObjectUploadSpec,
    ) -> Result<[u8; 32], ObjectTransferFailure> {
        let input = wire::EncryptedObjectDescriptorCommitmentInput {
            format_version: 1,
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: transfer.owner_scope_id.clone(),
                generation: 1,
            }),
            object_id: transfer.operation_id.clone(),
            upload_spec: Some(Self::upload_spec(transfer, object)),
        };
        Ok(Sha256::digest(input.encode_to_vec()).into())
    }

    fn descriptor_commitment(
        &self,
        descriptor: &ObjectDescriptor,
    ) -> Result<[u8; 32], ObjectTransferFailure> {
        match self.download_descriptor_sha256 {
            Some((ref object_id, digest)) if object_id == &descriptor.object_id => Ok(digest),
            _ => Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "Social download codec is not bound to this object descriptor",
            )),
        }
    }
}

pub struct StationObjectTransferTransport {
    session: Arc<SecureContentSession>,
    store: Arc<SecureContentStore>,
    client: Client,
}

impl StationObjectTransferTransport {
    pub fn new(
        session: Arc<SecureContentSession>,
        store: Arc<SecureContentStore>,
    ) -> Result<Self, String> {
        Ok(Self {
            session,
            store,
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(90))
                .build()
                .map_err(|error| format!("build Social object HTTP client: {error}"))?,
        })
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<(SecureContentRequestGuard<'_>, RequestBuilder), NativeTransportError> {
        let guard = self.session.begin_request().map_err(cancelled_error)?;
        let request = self
            .client
            .request(
                method,
                format!("{}{}", self.session.station_url.trim_end_matches('/'), path),
            )
            .header(AUTHORIZATION, format!("Bearer {}", guard.token()))
            .header("X-Device-ID", &self.session.key.device_id);
        Ok((guard, request))
    }

    fn map_failure(error: NativeTransportError) -> ObjectTransferFailure {
        let trusted_not_granted = error.http_status == Some(404)
            && error.stable_code == error_model::ErrorCode::PostNotFound as i32;
        let untrusted_auth_or_not_found =
            matches!(error.http_status, Some(401 | 403 | 404)) && !trusted_not_granted;
        let code = match error.http_status {
            _ if trusted_not_granted => ObjectTransferErrorCode::NotGranted,
            Some(409) => ObjectTransferErrorCode::PartConflict,
            Some(412) => ObjectTransferErrorCode::DescriptorMismatch,
            Some(416) => ObjectTransferErrorCode::RangeInvalid,
            Some(429) => ObjectTransferErrorCode::QuotaExceeded,
            _ => ObjectTransferErrorCode::RetryLater,
        };
        if untrusted_auth_or_not_found
            || (!trusted_not_granted
                && matches!(
                    error.disposition,
                    NativeErrorDisposition::Retryable | NativeErrorDisposition::UnknownCommit
                ))
        {
            ObjectTransferFailure::retryable(
                code,
                error
                    .retry_after_seconds
                    .map(|seconds| (seconds as i64).saturating_mul(1_000)),
                error.message,
            )
        } else {
            ObjectTransferFailure::terminal(code, error.message)
        }
    }
}

impl ObjectTransferTransport for StationObjectTransferTransport {
    fn begin_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<(String, u64, Vec<u8>), ObjectTransferFailure> {
        let request = wire::BeginEncryptedObjectUploadRequest {
            format_version: 1,
            plan_id: transfer.authority_id.clone(),
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: transfer.owner_scope_id.clone(),
                generation: 1,
            }),
            object_id: transfer.operation_id.clone(),
            upload_spec: Some(SocialObjectCodec::upload_spec(transfer, &prepared.object)),
            descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
            command_id: format!("object-begin:{}", transfer.operation_id),
        };
        let (_guard, request_builder) = self
            .request(
                reqwest::Method::POST,
                "/api/v1/social/moments/objects/uploads/begin",
            )
            .map_err(Self::map_failure)?;
        let response = request_builder
            .header(CONTENT_TYPE, "application/protobuf")
            .header(ACCEPT, "application/protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(network_error)
            .and_then(|response| {
                decode_proto_response::<wire::BeginEncryptedObjectUploadResponse>(
                    response,
                    RequestCommitSemantics::MayCommit,
                )
            })
            .map_err(Self::map_failure)?;
        if response.upload_id.trim().is_empty() || response.generation == 0 {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "Social object begin response is incomplete",
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
        transfer: &ObjectTransferRecord,
        chunk: &EncryptedObjectChunk,
    ) -> Result<(), ObjectTransferFailure> {
        let (_guard, request) = self
            .request(
                reqwest::Method::PUT,
                &format!(
                    "/api/v1/social/moments/objects/uploads/{}/chunks/{}",
                    transfer.upload_id, chunk.chunk_index
                ),
            )
            .map_err(Self::map_failure)?;
        let response = request
            .header(CONTENT_TYPE, "application/octet-stream")
            .header("X-Upload-Generation", transfer.generation)
            .header(
                "X-Chunk-Offset",
                u64::from(chunk.chunk_index)
                    * u64::from(transfer.chunk_size + secure_content_core::object::OBJECT_TAG_SIZE),
            )
            .header("X-Ciphertext-Size", chunk.ciphertext.len())
            .header("X-Ciphertext-SHA256", hex::encode(chunk.ciphertext_sha256))
            .header(
                "Idempotency-Key",
                format!("{}:{}", transfer.operation_id, chunk.chunk_index),
            )
            .body(chunk.ciphertext.clone())
            .send()
            .map_err(network_error)
            .map_err(Self::map_failure)?;
        decode_proto_response::<wire::PutEncryptedObjectChunkResponse>(
            response,
            RequestCommitSemantics::MayCommit,
        )
        .map(|_| ())
        .map_err(Self::map_failure)
    }

    fn complete_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<ObjectDescriptor, ObjectTransferFailure> {
        let request = wire::CompleteEncryptedObjectUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
            command_id: format!("object-complete:{}", transfer.operation_id),
        };
        let (_guard, request_builder) = self
            .request(
                reqwest::Method::POST,
                &format!(
                    "/api/v1/social/moments/objects/uploads/{}/complete",
                    transfer.upload_id
                ),
            )
            .map_err(Self::map_failure)?;
        let response = request_builder
            .header(CONTENT_TYPE, "application/protobuf")
            .header(ACCEPT, "application/protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(network_error)
            .and_then(|response| {
                decode_proto_response::<wire::CompleteEncryptedObjectUploadResponse>(
                    response,
                    RequestCommitSemantics::MayCommit,
                )
            })
            .map_err(Self::map_failure)?;
        if response.state != wire::EncryptedObjectTransferState::CompleteUnattached as i32 {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::IntegrityFailed,
                "Social object completion did not reach COMPLETE_UNATTACHED",
            ));
        }
        let descriptor = response.descriptor.ok_or_else(|| {
            ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "Social object completion omitted the descriptor",
            )
        })?;
        self.store
            .persist_object_descriptor(&transfer.transfer_id, &descriptor.encode_to_vec())
            .map_err(|error| {
                ObjectTransferFailure::retryable(ObjectTransferErrorCode::RetryLater, None, error)
            })?;
        SocialObjectCodec::descriptor_to_core(&descriptor)
    }

    fn get_download_chunk(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, ObjectTransferFailure> {
        let (_guard, request) = self
            .request(
                reqwest::Method::GET,
                &format!(
                    "/api/v1/social/moments/objects/{}?expected_descriptor_sha256={}",
                    transfer.operation_id,
                    hex::encode(&transfer.descriptor_sha256)
                ),
            )
            .map_err(Self::map_failure)?;
        let response = request
            .header(RANGE, format!("bytes={start}-{end}"))
            .send()
            .map_err(network_error)
            .map_err(Self::map_failure)?;
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(Self::map_failure(decode_typed_error(
                response.status().as_u16(),
                &bounded_response_body(response).unwrap_or_default(),
                None,
                RequestCommitSemantics::ReadOnly,
            )));
        }
        let expected_length = end.saturating_sub(start).saturating_add(1);
        validate_download_response_headers(
            response.headers(),
            &transfer.descriptor_sha256,
            descriptor.commitment.ciphertext_size,
            start,
            end,
            chunk_index,
        )?;
        let body = bounded_response_body(response).map_err(Self::map_failure)?;
        if body.len() as u64 != expected_length {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::RangeInvalid,
                format!("Social object chunk {chunk_index} response length mismatched"),
            ));
        }
        Ok(body)
    }

    fn cancel_upload(&self, transfer: &ObjectTransferRecord) -> Result<(), ObjectTransferFailure> {
        let request = wire::CancelEncryptedObjectUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            command_id: format!("object-cancel:{}", transfer.operation_id),
        };
        let (_guard, request_builder) = self
            .request(
                reqwest::Method::POST,
                &format!(
                    "/api/v1/social/moments/objects/uploads/{}/cancel",
                    transfer.upload_id
                ),
            )
            .map_err(Self::map_failure)?;
        request_builder
            .header(CONTENT_TYPE, "application/protobuf")
            .header(ACCEPT, "application/protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(network_error)
            .and_then(|response| {
                decode_proto_response::<wire::CancelEncryptedObjectUploadResponse>(
                    response,
                    RequestCommitSemantics::MayCommit,
                )
            })
            .map(|_| ())
            .map_err(Self::map_failure)
    }
}

fn validate_download_response_headers(
    headers: &HeaderMap,
    descriptor_sha256: &[u8],
    total_ciphertext_size: u64,
    start: u64,
    end: u64,
    chunk_index: u32,
) -> Result<(), ObjectTransferFailure> {
    let expected_descriptor = hex::encode(descriptor_sha256);
    let expected_etag = format!("\"sha256:{expected_descriptor}\"");
    let expected_range = format!("bytes {start}-{end}/{total_ciphertext_size}");
    let expected_length = end.saturating_sub(start).saturating_add(1);
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
    };
    let metadata_matches = header("X-Descriptor-SHA256") == expected_descriptor
        && header(ETAG.as_str()) == expected_etag
        && header(ACCEPT_RANGES.as_str()) == "bytes"
        && header(CONTENT_RANGE.as_str()) == expected_range
        && header("X-Total-Ciphertext-Size") == total_ciphertext_size.to_string()
        && header(CONTENT_LENGTH.as_str()) == expected_length.to_string();
    if metadata_matches {
        Ok(())
    } else {
        Err(ObjectTransferFailure::terminal(
            ObjectTransferErrorCode::DescriptorMismatch,
            format!("Social object chunk {chunk_index} response metadata mismatched"),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_federation_profile_requires_persisted_canonical_handle() {
        let sender = actor::ActorRef {
            ptid: "ptid:alice".to_string(),
            acct: "Alice@Station.Test".to_string(),
            kind: actor::ActorKind::Person as i32,
        };
        assert_eq!(
            canonical_actor_federated_handle(&sender).unwrap(),
            "@alice@station.test"
        );

        let missing = actor::ActorRef {
            acct: String::new(),
            ..sender.clone()
        };
        assert!(canonical_actor_federated_handle(&missing).is_err());

        let canonical = "@alice@station.test";
        let matching = federation::ActorProfileEnvelope {
            federated_handle: canonical.to_string(),
            ..Default::default()
        };
        assert!(validate_actor_federation_profile_handle(&matching, canonical).is_ok());

        let legacy_bare = federation::ActorProfileEnvelope {
            federated_handle: "alice@station.test".to_string(),
            ..Default::default()
        };
        assert!(validate_actor_federation_profile_handle(&legacy_bare, canonical).is_err());
    }

    #[test]
    fn secure_content_proto_requests_declare_request_and_response_media_types() {
        let request =
            with_proto_content_negotiation(Client::new().get("http://127.0.0.1/secure-content"))
                .build()
                .unwrap();

        assert_eq!(
            request.headers().get(CONTENT_TYPE).unwrap(),
            "application/protobuf"
        );
        assert_eq!(
            request.headers().get(ACCEPT).unwrap(),
            "application/protobuf"
        );
    }

    #[test]
    fn content_prekey_publication_matches_the_shared_canonical_vector() {
        let publisher = actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: "ptid:test".to_string(),
                ..Default::default()
            }),
            device_id: "device-test".to_string(),
        };
        let request = wire::PublishContentPreKeysRequest {
            publisher: Some(publisher.clone()),
            publisher_signing_key_id: "signing-test".to_string(),
            publisher_profile_version: 1,
            expected_pool_epoch: 0,
            prekeys: vec![wire::ContentOneTimePreKey {
                kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
                key_id: "key-test".to_string(),
                x25519_public_key: vec![1; 32],
                principal: Some(wire::content_one_time_pre_key::Principal::Endpoint(
                    publisher.clone(),
                )),
                profile_or_recovery_epoch: 1,
                issuer_signature: vec![2; 64],
            }],
            command_id: "command-test".to_string(),
            proof: Some(wire::ContentPreKeyClientProof {
                input: Some(wire::ContentPreKeyClientSigningInput {
                    format_version: 1,
                    capability_id: PUBLISH_CAPABILITY.to_string(),
                    station_peer_id: "station-test".to_string(),
                    session_id: "session-test".to_string(),
                    publisher: Some(publisher),
                    publisher_signing_key_id: "signing-test".to_string(),
                    publisher_profile_version: 1,
                    request_id: "command-test".to_string(),
                    request_sha256: vec![3; 32],
                    nonce: vec![4; 32],
                    issued_at: Some(prost_types::Timestamp {
                        seconds: 1,
                        nanos: 0,
                    }),
                }),
                signature: vec![5; 64],
            }),
        };
        let canonical = canonical_publication_bytes(&request).unwrap();
        assert_ne!(request.encode_to_vec(), canonical);
        assert_eq!(
            hex::encode(canonical),
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../model/domain/secure_content/testdata/content_prekey_publication.hex"
            ))
            .trim()
        );
        assert_eq!(
            publication_command_id(&request).unwrap(),
            "cpk-pub-v1-5ca0fee4658c8956feeca6d8a9272e70ce8c6127e41cd81a2961dbf1a4dd0d8c"
        );
    }

    #[test]
    fn secure_content_jwt_session_id_requires_the_canonical_claim() {
        let claims = URL_SAFE_NO_PAD.encode(r#"{"session_id":"session-1"}"#);
        assert_eq!(
            jwt_session_id(&format!("header.{claims}.signature")).unwrap(),
            "session-1"
        );
        let missing = URL_SAFE_NO_PAD.encode(r#"{"sub":"session-1"}"#);
        assert!(jwt_session_id(&format!("header.{missing}.signature")).is_err());
    }

    #[test]
    fn secure_content_typed_error_decoder_preserves_retry_contract() {
        let body = error_model::ErrorResponse {
            code: 30208,
            message: "bounded".to_string(),
            details: Default::default(),
        }
        .encode_to_vec();
        let error = decode_typed_error(429, &body, Some(999), RequestCommitSemantics::MayCommit);
        assert_eq!(error.stable_code, 30208);
        assert_eq!(error.retry_after_seconds, Some(300));
        assert_eq!(error.disposition, NativeErrorDisposition::Retryable);

        let comment_error = decode_typed_error_with_retry_after(
            429,
            &body,
            Some(3_599),
            RequestCommitSemantics::MayCommit,
            RetryAfterSemantics::Exact,
        );
        assert_eq!(comment_error.retry_after_seconds, Some(3_599));
        assert_eq!(comment_error.disposition, NativeErrorDisposition::Retryable);

        let conflict_body = error_model::ErrorResponse {
            code: error_model::ErrorCode::InvalidRequest as i32,
            message: "conflict".to_string(),
            details: [(
                PRIVATE_CONTENT_CODE_DETAIL.to_string(),
                "SOCIAL_PRIVATE_STALE_PLAN".to_string(),
            )]
            .into(),
        }
        .encode_to_vec();
        let conflict =
            decode_typed_error(409, &conflict_body, None, RequestCommitSemantics::MayCommit);
        assert_eq!(conflict.message, "SOCIAL_PRIVATE_STALE_PLAN");
        assert_eq!(conflict.disposition, NativeErrorDisposition::Terminal);

        let committed = committed_response_error(200, "response body was truncated");
        assert_eq!(committed.http_status, Some(200));
        assert_eq!(committed.disposition, NativeErrorDisposition::UnknownCommit);

        let malformed = decode_typed_error(
            500,
            b"not protobuf",
            None,
            RequestCommitSemantics::MayCommit,
        );
        assert_eq!(malformed.disposition, NativeErrorDisposition::UnknownCommit);
        assert_eq!(
            malformed.stable_code,
            error_model::ErrorCode::Undefined as i32
        );

        let malformed_client_error = decode_typed_error(
            400,
            b"not protobuf",
            None,
            RequestCommitSemantics::MayCommit,
        );
        assert_eq!(
            malformed_client_error.disposition,
            NativeErrorDisposition::UnknownCommit
        );

        let malformed_read_error =
            decode_typed_error(400, b"not protobuf", None, RequestCommitSemantics::ReadOnly);
        assert_eq!(
            malformed_read_error.disposition,
            NativeErrorDisposition::Terminal
        );
    }

    #[test]
    fn secure_content_object_not_granted_requires_trusted_status_and_code() {
        for http_status in [401, 403, 404] {
            let failure = StationObjectTransferTransport::map_failure(NativeTransportError {
                http_status: Some(http_status),
                stable_code: error_model::ErrorCode::Undefined as i32,
                retry_after_seconds: None,
                disposition: NativeErrorDisposition::Terminal,
                message: "untrusted proxy status".to_string(),
            });
            assert_eq!(failure.code, ObjectTransferErrorCode::RetryLater);
            assert!(failure.retryable);
        }

        let trusted = StationObjectTransferTransport::map_failure(NativeTransportError {
            http_status: Some(404),
            stable_code: error_model::ErrorCode::PostNotFound as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "ERROR_CODE_POST_NOT_FOUND".to_string(),
        });
        assert_eq!(trusted.code, ObjectTransferErrorCode::NotGranted);
        assert!(!trusted.retryable);

        let mismatched = StationObjectTransferTransport::map_failure(NativeTransportError {
            http_status: Some(500),
            stable_code: error_model::ErrorCode::PostNotFound as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::UnknownCommit,
            message: "mismatched status and code".to_string(),
        });
        assert_eq!(mismatched.code, ObjectTransferErrorCode::RetryLater);
        assert!(mismatched.retryable);
    }

    #[test]
    fn secure_content_publication_command_id_ignores_command_and_proof_fields() {
        let mut request = wire::PublishContentPreKeysRequest {
            publisher: Some(actor::ActorDeviceRef {
                actor: Some(actor::ActorRef {
                    ptid: "ptid:alice".to_string(),
                    kind: actor::ActorKind::Person as i32,
                    ..Default::default()
                }),
                device_id: "device-1".to_string(),
            }),
            publisher_signing_key_id: "signing-1".to_string(),
            publisher_profile_version: 1,
            expected_pool_epoch: 0,
            prekeys: Vec::new(),
            command_id: String::new(),
            proof: None,
        };
        let expected = publication_command_id(&request).unwrap();
        request.command_id = "ignored".to_string();
        request.proof = Some(wire::ContentPreKeyClientProof::default());
        assert_eq!(publication_command_id(&request).unwrap(), expected);
        assert!(expected.starts_with("cpk-pub-v1-"));
    }

    #[test]
    fn secure_content_download_headers_bind_exact_descriptor_and_range() {
        let digest = [7_u8; 32];
        let digest_hex = hex::encode(digest);
        let mut headers = HeaderMap::new();
        headers.insert("X-Descriptor-SHA256", digest_hex.parse().unwrap());
        headers.insert(ETAG, format!("\"sha256:{digest_hex}\"").parse().unwrap());
        headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
        headers.insert(CONTENT_RANGE, "bytes 0-15/32".parse().unwrap());
        headers.insert("X-Total-Ciphertext-Size", "32".parse().unwrap());
        headers.insert(CONTENT_LENGTH, "16".parse().unwrap());

        assert!(validate_download_response_headers(&headers, &digest, 32, 0, 15, 0).is_ok());

        headers.insert(ETAG, "\"sha256:attacker\"".parse().unwrap());
        assert!(validate_download_response_headers(&headers, &digest, 32, 0, 15, 0).is_err());
    }
}
