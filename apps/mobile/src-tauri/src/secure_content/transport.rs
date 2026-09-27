use std::io::Read;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::pkcs8::{DecodePublicKey, EncodePublicKey};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::platform::secure_storage::SecureStorage;
use crate::secure_content::proto::{
    actor::v1 as actor, common::v1 as common, error::v1 as error_model,
};
use crate::secure_content::proto::{
    federation::v1 as federation, secure_content::v1 as wire, social::v1 as social,
};
use crate::secure_content::{NativeSocialSession, PrivateSocialScope, TrustedStationSigningKey};

const MAX_PROTO_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const CLIENT_SIGNING_DOMAIN: &[u8] = b"peers-touch:secure-content:client-command:v1\0";
const PUBLISH_CAPABILITY: &str = "key_exchange.content_prekey.publish";
const INVENTORY_CAPABILITY: &str = "key_exchange.content_prekey.inventory";
const PROFILE_MAX_LIFETIME_MS: i64 = 60 * 60 * 1_000;
const PROFILE_CLOCK_SKEW_MS: i64 = 30_000;
const FEDERATION_KEY_ID_LENGTH: usize = 26;
const FEDERATION_RESOLVE_TYPE_URL: &str =
    "type.googleapis.com/peers_touch.model.federation.v1.FederationResolveView";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportDisposition {
    Terminal,
    Retryable,
    UnknownOutcome,
    PoolNotFound,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransportError {
    pub http_status: Option<u16>,
    pub stable_code: i32,
    pub typed_error: bool,
    pub retry_after_seconds: Option<u64>,
    pub disposition: TransportDisposition,
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "private Social transport failed (status={:?}, code={})",
            self.http_status, self.stable_code
        )
    }
}

impl std::error::Error for TransportError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SenderSigningKeyErrorKind {
    Retryable,
    Integrity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SenderSigningKeyError {
    pub kind: SenderSigningKeyErrorKind,
    message: String,
}

impl SenderSigningKeyError {
    pub(crate) fn retryable(message: impl Into<String>) -> Self {
        Self {
            kind: SenderSigningKeyErrorKind::Retryable,
            message: message.into(),
        }
    }

    pub(crate) fn integrity(message: impl Into<String>) -> Self {
        Self {
            kind: SenderSigningKeyErrorKind::Integrity,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SenderSigningKeyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SenderSigningKeyError {}

#[derive(Clone, Copy)]
enum CommitSemantics {
    ReadOnly,
    MayCommit,
}

pub struct NativeSocialTransport {
    session: Arc<NativeSocialSession>,
    client: Client,
}

impl NativeSocialTransport {
    pub fn new(session: Arc<NativeSocialSession>) -> Result<Self, String> {
        Ok(Self {
            session,
            client: http_client()?,
        })
    }

    pub fn inventory(
        &self,
        kind: wire::ContentPreKeyKind,
    ) -> Result<wire::ContentPreKeyInventory, TransportError> {
        let publisher = self.publisher();
        let mut request = wire::GetContentPreKeyInventoryRequest {
            publisher: Some(publisher.clone()),
            target: Some(content_prekey_target(kind, publisher)),
            request_id: format!("mobile-cpk-inventory-{}", ulid::Ulid::new()),
            proof: None,
        };
        let request_sha256 = Sha256::digest(request.encode_to_vec()).into();
        request.proof =
            Some(self.client_proof(INVENTORY_CAPABILITY, &request.request_id, request_sha256)?);
        let response: wire::GetContentPreKeyInventoryResponse = self.post_proto(
            "/key-exchange/content-prekeys/inventory",
            &request,
            CommitSemantics::ReadOnly,
        )?;
        response.inventory.ok_or_else(|| local_error(20002))
    }

    pub fn publish_prekeys(
        &self,
        proof_free_request: &[u8],
    ) -> Result<wire::PublishContentPreKeysResponse, TransportError> {
        let mut request = wire::PublishContentPreKeysRequest::decode(proof_free_request)
            .map_err(|_| local_error(20005))?;
        if request.command_id.trim().is_empty() || request.proof.is_some() {
            return Err(local_error(20002));
        }
        let request_sha256 = Sha256::digest(proof_free_request).into();
        request.proof =
            Some(self.client_proof(PUBLISH_CAPABILITY, &request.command_id, request_sha256)?);
        self.post_proto(
            "/key-exchange/content-prekeys/publish",
            &request,
            CommitSemantics::MayCommit,
        )
    }

    pub fn prepare_private_moment(
        &self,
        request: &social::PreparePrivateMomentRequest,
    ) -> Result<social::PreparePrivateMomentResponse, TransportError> {
        self.post_proto(
            "/api/v1/social/moments/prepare-private",
            request,
            CommitSemantics::MayCommit,
        )
    }

    pub fn submit_private_moment(
        &self,
        request: &social::SubmitPrivateMomentRequest,
    ) -> Result<social::SubmitPrivateMomentResponse, TransportError> {
        self.post_proto(
            "/api/v1/social/moments/submit-private",
            request,
            CommitSemantics::MayCommit,
        )
    }

    pub fn get_private_moment(
        &self,
        post_id: &str,
    ) -> Result<social::GetMomentResourceResponse, TransportError> {
        if post_id.trim().is_empty() || post_id != post_id.trim() {
            return Err(local_error(20002));
        }
        self.get_proto(&format!("/api/v1/social/moments/{post_id}"), None)
    }

    pub fn sender_signing_key(
        &self,
        sender: &actor::ActorDeviceRef,
        signing_key_id: &str,
        committed_at_unix_ms: i64,
    ) -> Result<VerifyingKey, SenderSigningKeyError> {
        let sender_actor = sender.actor.as_ref().ok_or_else(|| {
            SenderSigningKeyError::integrity("private Social sender actor is unavailable")
        })?;
        if sender_actor.ptid == self.session.scope.actor_ptid
            && sender.device_id == self.session.scope.device_id
            && signing_key_id == self.session.signing_key_id
        {
            return Ok(*self.session.device_signing_key.verifying_key());
        }
        let handle =
            sender_federated_handle(sender_actor).map_err(SenderSigningKeyError::integrity)?;
        let resolved = self
            .get_actor_federation_resolve(&handle)
            .map_err(|error| {
                SenderSigningKeyError::retryable(format!(
                    "resolve private Social sender profile: {error}"
                ))
            })?;
        require_local_sender_resolve(
            &resolved,
            &handle,
            sender_actor,
            &self.session.scope.station_peer_id,
            &self.session.trusted_station_signing_key.key_id,
        )?;
        let profile = self
            .get_actor_federation_profile(&handle)
            .map_err(|error| {
                SenderSigningKeyError::retryable(format!(
                    "load private Social sender profile: {error}"
                ))
            })?;
        verify_profile_actor_device_signing_key(
            &profile,
            &self.session.trusted_station_signing_key,
            &handle,
            &self.session.scope.station_peer_id,
            sender,
            signing_key_id,
            committed_at_unix_ms,
            now_unix_ms(),
        )
    }

    fn get_actor_federation_resolve(
        &self,
        handle: &str,
    ) -> Result<federation::FederationResolveView, TransportError> {
        self.get_peers_proto(
            "/actor/federation/resolve",
            Some(&[("handle", handle.to_string())]),
            FEDERATION_RESOLVE_TYPE_URL,
        )
    }

    fn get_actor_federation_profile(
        &self,
        handle: &str,
    ) -> Result<federation::ActorProfileEnvelope, TransportError> {
        let profile: federation::ActorProfileEnvelope = self.get_proto(
            "/actor/federation/profile",
            Some(&[("handle", handle.to_string())]),
        )?;
        if profile.federated_handle != handle {
            return Err(local_error(20005));
        }
        Ok(profile)
    }

    fn publisher(&self) -> actor::ActorDeviceRef {
        actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: self.session.scope.actor_ptid.clone(),
                ..Default::default()
            }),
            device_id: self.session.scope.device_id.clone(),
        }
    }

    fn client_proof(
        &self,
        capability_id: &str,
        request_id: &str,
        request_sha256: [u8; 32],
    ) -> Result<wire::ContentPreKeyClientProof, TransportError> {
        let mut nonce = vec![0; 32];
        OsRng.fill_bytes(&mut nonce);
        let input = wire::ContentPreKeyClientSigningInput {
            format_version: 1,
            capability_id: capability_id.to_string(),
            station_peer_id: self.session.scope.station_peer_id.clone(),
            session_id: self.session.jwt_session_id.clone(),
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
            signature: self.session.sign(&signing_bytes),
        })
    }

    fn post_proto<Req, Resp>(
        &self,
        path: &str,
        request: &Req,
        semantics: CommitSemantics,
    ) -> Result<Resp, TransportError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        decode_proto_response(
            self.request(reqwest::Method::POST, path)
                .header(CONTENT_TYPE, "application/protobuf")
                .header(ACCEPT, "application/protobuf")
                .body(request.encode_to_vec())
                .send()
                .map_err(network_error)?,
            semantics,
        )
    }

    fn get_proto<Resp>(
        &self,
        path: &str,
        query: Option<&[(&str, String)]>,
    ) -> Result<Resp, TransportError>
    where
        Resp: Message + Default,
    {
        let request = self
            .client
            .request(
                reqwest::Method::GET,
                endpoint_url(&self.session.scope.station_origin, path, query)?,
            )
            .header(
                AUTHORIZATION,
                format!("Bearer {}", self.session.access_token()),
            )
            .header("X-Device-ID", &self.session.scope.device_id)
            .header(ACCEPT, "application/protobuf");
        decode_proto_response(
            request.send().map_err(network_error)?,
            CommitSemantics::ReadOnly,
        )
    }

    fn get_peers_proto<Resp>(
        &self,
        path: &str,
        query: Option<&[(&str, String)]>,
        expected_type_url: &str,
    ) -> Result<Resp, TransportError>
    where
        Resp: Message + Default,
    {
        let request = self
            .client
            .request(
                reqwest::Method::GET,
                endpoint_url(&self.session.scope.station_origin, path, query)?,
            )
            .header(
                AUTHORIZATION,
                format!("Bearer {}", self.session.access_token()),
            )
            .header("X-Device-ID", &self.session.scope.device_id)
            .header(ACCEPT, "application/protobuf");
        decode_peers_proto_response(request.send().map_err(network_error)?, expected_type_url)
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(
                method,
                format!(
                    "{}{}",
                    self.session.scope.station_origin.trim_end_matches('/'),
                    path
                ),
            )
            .header(
                AUTHORIZATION,
                format!("Bearer {}", self.session.access_token()),
            )
            .header("X-Device-ID", &self.session.scope.device_id)
    }
}

pub fn resolve_trusted_station_signing_key(
    scope: &PrivateSocialScope,
    access_token: &str,
    storage: &SecureStorage,
) -> Result<TrustedStationSigningKey, String> {
    require_authenticated_transport(&scope.station_origin)?;
    let client = http_client()?;
    let federation_self: federation::FederationSelfView =
        get_proto_at(&client, scope, access_token, "/actor/federation/me", None)?;
    if federation_self.home_station_peer_id != scope.station_peer_id
        || federation_self
            .actor_ref
            .as_ref()
            .map(|actor| actor.ptid.as_str())
            != Some(scope.actor_ptid.as_str())
        || federation_self.federated_handle.trim().is_empty()
    {
        return Err("private Social Federation self identity is inconsistent".to_string());
    }
    let handle = canonical_federated_handle(&federation_self.federated_handle)
        .ok_or_else(|| "private Social Federation self handle is invalid".to_string())?;
    let profile: federation::ActorProfileEnvelope = get_proto_at(
        &client,
        scope,
        access_token,
        "/actor/federation/profile",
        Some(&[("handle", handle.clone())]),
    )?;
    let trusted =
        verify_profile_envelope(&profile, &handle, &scope.station_peer_id, now_unix_ms())?;
    pin_or_verify_station_key(storage, &scope.station_peer_id, &trusted)?;
    Ok(trusted)
}

pub fn jwt_session_id(token: &str) -> Result<String, String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| "private Social session token is malformed".to_string())?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "private Social session token payload is malformed".to_string())?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded)
        .map_err(|_| "private Social session token claims are malformed".to_string())?;
    claims
        .get("session_id")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.trim() == *value)
        .map(ToOwned::to_owned)
        .ok_or_else(|| "private Social session token has no validated session ID".to_string())
}

pub fn publication_command_id(request: &wire::PublishContentPreKeysRequest) -> String {
    let mut request = request.clone();
    request.command_id.clear();
    request.proof = None;
    format!(
        "mobile-cpk-publish-{}",
        hex(&Sha256::digest(request.encode_to_vec()))
    )
}

fn content_prekey_target(
    kind: wire::ContentPreKeyKind,
    publisher: actor::ActorDeviceRef,
) -> wire::ContentPreKeyClaimTarget {
    use wire::content_pre_key_claim_target::Principal;
    let principal = match kind {
        wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => Principal::Endpoint(publisher),
        wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
            Principal::RecoveryActor(publisher.actor.unwrap_or_default())
        }
        wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => {
            unreachable!("validated PreKey kind")
        }
    };
    wire::ContentPreKeyClaimTarget {
        kind: kind as i32,
        principal: Some(principal),
    }
}

fn get_proto_at<Resp: Message + Default>(
    client: &Client,
    scope: &PrivateSocialScope,
    access_token: &str,
    path: &str,
    query: Option<&[(&str, String)]>,
) -> Result<Resp, String> {
    let request = client
        .get(endpoint_url(&scope.station_origin, path, query).map_err(|error| error.to_string())?)
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header("X-Device-ID", &scope.device_id)
        .header(ACCEPT, "application/protobuf");
    decode_proto_response(
        request
            .send()
            .map_err(|error| format!("load private Social trust material: {error}"))?,
        CommitSemantics::ReadOnly,
    )
    .map_err(|error| error.to_string())
}

fn verify_profile_envelope(
    envelope: &federation::ActorProfileEnvelope,
    expected_handle: &str,
    expected_station_peer_id: &str,
    now: i64,
) -> Result<TrustedStationSigningKey, String> {
    if envelope.federated_handle != expected_handle
        || envelope.home_station_peer_id != expected_station_peer_id
        || envelope.signing_key_pem.trim().is_empty()
        || envelope.signing_key_kid.trim().is_empty()
        || envelope.signature.len() != 64
        || envelope.expires_at_unix_ms <= envelope.issued_at_unix_ms
        || envelope
            .expires_at_unix_ms
            .saturating_sub(envelope.issued_at_unix_ms)
            > PROFILE_MAX_LIFETIME_MS
        || envelope.issued_at_unix_ms > now.saturating_add(PROFILE_CLOCK_SKEW_MS)
        || envelope.expires_at_unix_ms < now.saturating_sub(PROFILE_CLOCK_SKEW_MS)
    {
        return Err("private Social Station profile identity is invalid".to_string());
    }
    let verifying_key = VerifyingKey::from_public_key_pem(&envelope.signing_key_pem)
        .map_err(|_| "private Social Station signing key is invalid".to_string())?;
    let key_id = federation_signing_key_id(&verifying_key)?;
    if envelope.signing_key_kid != key_id {
        return Err("private Social Station signing key fingerprint mismatched".to_string());
    }
    let signature = Signature::from_slice(&envelope.signature)
        .map_err(|_| "private Social Station profile signature is invalid".to_string())?;
    let mut unsigned = envelope.clone();
    unsigned.signature.clear();
    verifying_key
        .verify(&unsigned.encode_to_vec(), &signature)
        .map_err(|_| "private Social Station profile signature is invalid".to_string())?;
    Ok(TrustedStationSigningKey {
        key_id,
        verifying_key,
    })
}

fn verify_profile_actor_device_signing_key(
    envelope: &federation::ActorProfileEnvelope,
    trusted_station: &TrustedStationSigningKey,
    expected_handle: &str,
    expected_station_peer_id: &str,
    expected_sender: &actor::ActorDeviceRef,
    expected_signing_key_id: &str,
    committed_at_unix_ms: i64,
    now_unix_ms: i64,
) -> Result<VerifyingKey, SenderSigningKeyError> {
    let profile_station = verify_profile_envelope(
        envelope,
        expected_handle,
        expected_station_peer_id,
        now_unix_ms,
    )
    .map_err(SenderSigningKeyError::integrity)?;
    if profile_station.key_id != trusted_station.key_id
        || profile_station.verifying_key != trusted_station.verifying_key
    {
        return Err(SenderSigningKeyError::integrity(
            "private Social sender profile is not signed by the pinned Station",
        ));
    }
    let sender_actor = expected_sender.actor.as_ref().ok_or_else(|| {
        SenderSigningKeyError::integrity("private Social sender actor is unavailable")
    })?;
    let profile_ptid = envelope
        .profile
        .as_ref()
        .and_then(|profile| profile.peers_touch.as_ref())
        .map(|identity| identity.network_id.as_str())
        .unwrap_or_default();
    if !canonical_ptid(&sender_actor.ptid)
        || profile_ptid != sender_actor.ptid
        || expected_sender.device_id.trim().is_empty()
        || expected_signing_key_id.trim().is_empty()
        || committed_at_unix_ms <= 0
    {
        return Err(SenderSigningKeyError::integrity(
            "private Social sender profile identity is invalid",
        ));
    }
    let mut matches = envelope.device_signing_keys.iter().filter(|key| {
        key.actor_ptid == sender_actor.ptid
            && key.actor_device_id == expected_sender.device_id
            && key.home_station_peer_id == expected_station_peer_id
            && key.signing_key_id == expected_signing_key_id
    });
    let key = matches.next().ok_or_else(|| {
        SenderSigningKeyError::retryable(
            "private Social sender profile does not expose the retained signing key",
        )
    })?;
    if matches.next().is_some()
        || key.ed25519_public_key.len() != 32
        || key.profile_version <= 0
        || key.valid_from_unix_ms <= 0
        || key.valid_from_unix_ms > committed_at_unix_ms
        || (key.revoked_at_unix_ms != 0
            && (key.revoked_at_unix_ms <= key.valid_from_unix_ms
                || committed_at_unix_ms >= key.revoked_at_unix_ms))
        || !matches!(
            actor::ActorSigningKeyVerificationSource::try_from(key.verification_source).ok(),
            Some(actor::ActorSigningKeyVerificationSource::VerifiedProfile)
                | Some(actor::ActorSigningKeyVerificationSource::VerifiedLocator)
        )
    {
        return Err(SenderSigningKeyError::integrity(
            "private Social sender signing key is invalid at commit time",
        ));
    }
    VerifyingKey::from_bytes(key.ed25519_public_key.as_slice().try_into().map_err(|_| {
        SenderSigningKeyError::integrity("private Social sender signing key is invalid")
    })?)
    .map_err(|_| SenderSigningKeyError::integrity("private Social sender signing key is invalid"))
}

fn validate_sender_resolve_view(
    view: &federation::FederationResolveView,
    expected_handle: &str,
    expected_actor: &actor::ActorRef,
    local_station_peer_id: &str,
    local_station_signing_key_id: &str,
) -> Result<bool, SenderSigningKeyError> {
    let profile_ptid = view
        .profile
        .as_ref()
        .and_then(|profile| profile.peers_touch.as_ref())
        .map(|identity| identity.network_id.as_str())
        .unwrap_or_default();
    let is_local_home = view.home_station_peer_id == local_station_peer_id;
    if view.federated_handle != expected_handle
        || !canonical_ptid(&expected_actor.ptid)
        || profile_ptid != expected_actor.ptid
        || view.home_station_peer_id.trim().is_empty()
        || view.signing_key_kid.trim().is_empty()
        || view.is_local != is_local_home
        || (is_local_home && view.signing_key_kid != local_station_signing_key_id)
    {
        return Err(SenderSigningKeyError::integrity(
            "private Social sender Federation resolution is inconsistent",
        ));
    }
    Ok(is_local_home)
}

fn require_local_sender_resolve(
    view: &federation::FederationResolveView,
    expected_handle: &str,
    expected_actor: &actor::ActorRef,
    local_station_peer_id: &str,
    local_station_signing_key_id: &str,
) -> Result<(), SenderSigningKeyError> {
    if validate_sender_resolve_view(
        view,
        expected_handle,
        expected_actor,
        local_station_peer_id,
        local_station_signing_key_id,
    )? {
        Ok(())
    } else {
        Err(SenderSigningKeyError::retryable(
            "private Social sender Home Station profile is unavailable",
        ))
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStationPin {
    key_id: String,
    public_key_b64: String,
}

fn pin_or_verify_station_key(
    storage: &SecureStorage,
    station_peer_id: &str,
    trusted: &TrustedStationSigningKey,
) -> Result<(), String> {
    let key = format!(
        "secure-content.station-pin.v1.{}",
        hex(&Sha256::digest(station_peer_id.as_bytes())[..16])
    );
    if let Some(encoded) = storage.get(&key).map_err(|error| error.to_string())? {
        let stored: StoredStationPin = serde_json::from_str(&encoded)
            .map_err(|_| "private Social Station pin is malformed".to_string())?;
        let public_key = B64
            .decode(stored.public_key_b64)
            .map_err(|_| "private Social Station pin is malformed".to_string())?;
        if stored.key_id != trusted.key_id
            || public_key.as_slice() != trusted.verifying_key.as_bytes()
        {
            return Err("private Social Station signing key pin changed".to_string());
        }
        return Ok(());
    }
    let encoded = serde_json::to_string(&StoredStationPin {
        key_id: trusted.key_id.clone(),
        public_key_b64: B64.encode(trusted.verifying_key.as_bytes()),
    })
    .map_err(|error| error.to_string())?;
    storage
        .set(&key, &encoded)
        .map_err(|error| error.to_string())
}

fn federation_signing_key_id(key: &VerifyingKey) -> Result<String, String> {
    let document = key
        .to_public_key_der()
        .map_err(|_| "encode private Social Station signing key".to_string())?;
    let encoded = base32_no_pad(&Sha256::digest(document.as_bytes()));
    Ok(encoded[..FEDERATION_KEY_ID_LENGTH].to_ascii_lowercase())
}

fn endpoint_url(
    station_origin: &str,
    path: &str,
    query: Option<&[(&str, String)]>,
) -> Result<reqwest::Url, TransportError> {
    let mut url = reqwest::Url::parse(&format!("{}{}", station_origin.trim_end_matches('/'), path))
        .map_err(|_| local_error(20002))?;
    if let Some(query) = query {
        url.query_pairs_mut()
            .extend_pairs(query.iter().map(|(key, value)| (*key, value.as_str())));
    }
    Ok(url)
}

fn base32_no_pad(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut output = String::with_capacity(bytes.len().saturating_mul(8).div_ceil(5));
    let mut buffer = 0_u16;
    let mut bits = 0_u8;
    for byte in bytes {
        buffer = (buffer << 8) | u16::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(ALPHABET[((buffer >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((buffer << (5 - bits)) & 0x1f) as usize] as char);
    }
    output
}

fn require_authenticated_transport(station_origin: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(station_origin)
        .map_err(|_| "private Social Station origin is invalid".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "private Social Station origin has no host".to_string())?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("private Social first-use trust requires HTTPS or loopback HTTP".to_string());
    }
    Ok(())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("build private Social HTTP client: {error}"))
}

fn decode_proto_response<Resp: Message + Default>(
    response: Response,
    semantics: CommitSemantics,
) -> Result<Resp, TransportError> {
    let status = response.status();
    let retry_after_seconds = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| seconds.min(300));
    let body = bounded_response_body(response).map_err(|mut error| {
        if status.is_success() && matches!(semantics, CommitSemantics::MayCommit) {
            error.disposition = TransportDisposition::UnknownOutcome;
        }
        error
    })?;
    if !status.is_success() {
        return Err(decode_typed_error(
            status.as_u16(),
            &body,
            retry_after_seconds,
            semantics,
        ));
    }
    Resp::decode(body.as_slice()).map_err(|_| TransportError {
        http_status: Some(status.as_u16()),
        stable_code: 20005,
        typed_error: false,
        retry_after_seconds: None,
        disposition: match semantics {
            CommitSemantics::ReadOnly => TransportDisposition::Terminal,
            CommitSemantics::MayCommit => TransportDisposition::UnknownOutcome,
        },
    })
}

fn decode_peers_proto_response<Resp: Message + Default>(
    response: Response,
    expected_type_url: &str,
) -> Result<Resp, TransportError> {
    let status = response.status();
    let retry_after_seconds = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| seconds.min(300));
    let body = bounded_response_body(response)?;
    if !status.is_success() {
        return Err(decode_typed_error(
            status.as_u16(),
            &body,
            retry_after_seconds,
            CommitSemantics::ReadOnly,
        ));
    }
    decode_peers_payload(&body, expected_type_url).map_err(|mut error| {
        error.http_status = Some(status.as_u16());
        error
    })
}

fn decode_peers_payload<Resp: Message + Default>(
    body: &[u8],
    expected_type_url: &str,
) -> Result<Resp, TransportError> {
    let response = common::PeersResponse::decode(body).map_err(|_| local_error(20005))?;
    let payload = response.data.ok_or_else(|| local_error(20005))?;
    if response.code != "200" || payload.type_url != expected_type_url {
        return Err(local_error(20005));
    }
    Resp::decode(payload.value.as_slice()).map_err(|_| local_error(20005))
}

fn bounded_response_body(response: Response) -> Result<Vec<u8>, TransportError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PROTO_RESPONSE_BYTES as u64)
    {
        return Err(local_error(20002));
    }
    let mut body = Vec::new();
    response
        .take(MAX_PROTO_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut body)
        .map_err(network_error)?;
    if body.len() > MAX_PROTO_RESPONSE_BYTES {
        return Err(local_error(20002));
    }
    Ok(body)
}

fn decode_typed_error(
    status: u16,
    body: &[u8],
    retry_after_seconds: Option<u64>,
    semantics: CommitSemantics,
) -> TransportError {
    let typed = error_model::ErrorResponse::decode(body).ok();
    let stable_code = typed.as_ref().map(|error| error.code).unwrap_or(1);
    let disposition = match (typed.is_some(), stable_code) {
        (false, _) if matches!(semantics, CommitSemantics::MayCommit) => {
            TransportDisposition::UnknownOutcome
        }
        (_, 30203) => TransportDisposition::PoolNotFound,
        (_, 30208 | 30209) => TransportDisposition::Retryable,
        _ if status >= 500 => TransportDisposition::UnknownOutcome,
        _ => TransportDisposition::Terminal,
    };
    TransportError {
        http_status: Some(status),
        stable_code,
        typed_error: typed.is_some(),
        retry_after_seconds,
        disposition,
    }
}

fn network_error(_error: impl std::fmt::Display) -> TransportError {
    TransportError {
        http_status: None,
        stable_code: 1,
        typed_error: false,
        retry_after_seconds: None,
        disposition: TransportDisposition::UnknownOutcome,
    }
}

fn local_error(code: i32) -> TransportError {
    TransportError {
        http_status: None,
        stable_code: code,
        typed_error: false,
        retry_after_seconds: None,
        disposition: TransportDisposition::Terminal,
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

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn canonical_ptid(value: &str) -> bool {
    !value.is_empty()
        && value == value.trim()
        && value.starts_with("ptid:")
        && value.len() <= 255
        && !value.as_bytes().contains(&0)
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

fn sender_federated_handle(sender: &actor::ActorRef) -> Result<String, String> {
    if !canonical_ptid(&sender.ptid) {
        return Err("private Social sender PTID is invalid".to_string());
    }
    canonical_federated_handle(&sender.acct)
        .ok_or_else(|| "private Social sender persisted handle is unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signed_sender_profile(
        station_key: &SigningKey,
        sender_key: &SigningKey,
        now: i64,
    ) -> federation::ActorProfileEnvelope {
        let verifying_key = station_key.verifying_key();
        let mut envelope = federation::ActorProfileEnvelope {
            federated_handle: "@bob@station.test".to_string(),
            home_station_peer_id: "station-1".to_string(),
            home_station_domain: "station.test".to_string(),
            profile: Some(actor::ActorProfile {
                peers_touch: Some(actor::PeersTouchInfo {
                    network_id: "ptid:bob".to_string(),
                }),
                ..Default::default()
            }),
            issued_at_unix_ms: now,
            expires_at_unix_ms: now + 300_000,
            signature: Vec::new(),
            signing_key_pem: verifying_key.to_public_key_pem(Default::default()).unwrap(),
            signing_key_kid: federation_signing_key_id(&verifying_key).unwrap(),
            device_signing_keys: vec![actor::VerifiedActorDeviceSigningKey {
                actor_ptid: "ptid:bob".to_string(),
                actor_device_id: "device-bob".to_string(),
                home_station_peer_id: "station-1".to_string(),
                signing_key_id: "sender-key-1".to_string(),
                ed25519_public_key: sender_key.verifying_key().to_bytes().to_vec(),
                profile_version: 7,
                verification_source: actor::ActorSigningKeyVerificationSource::VerifiedProfile
                    as i32,
                valid_from_unix_ms: now - 10_000,
                revoked_at_unix_ms: 0,
            }],
        };
        envelope.signature = station_key
            .sign(&envelope.encode_to_vec())
            .to_bytes()
            .to_vec();
        envelope
    }

    #[test]
    fn jwt_session_identity_is_required() {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let claims = URL_SAFE_NO_PAD.encode(r#"{"session_id":"session-1"}"#);
        assert_eq!(
            jwt_session_id(&format!("header.{claims}.signature")).unwrap(),
            "session-1"
        );
        let missing = URL_SAFE_NO_PAD.encode(r#"{"sub":"actor"}"#);
        assert!(jwt_session_id(&format!("header.{missing}.signature")).is_err());
    }

    #[test]
    fn malformed_may_commit_error_is_unknown() {
        let error = decode_typed_error(400, b"not protobuf", None, CommitSemantics::MayCommit);
        assert_eq!(error.disposition, TransportDisposition::UnknownOutcome);
        let read = decode_typed_error(400, b"not protobuf", None, CommitSemantics::ReadOnly);
        assert_eq!(read.disposition, TransportDisposition::Terminal);
    }

    #[test]
    fn remote_plaintext_transport_is_rejected() {
        assert!(require_authenticated_transport("https://station.test").is_ok());
        assert!(require_authenticated_transport("http://127.0.0.1:18080").is_ok());
        assert!(require_authenticated_transport("http://station.test").is_err());
    }

    #[test]
    fn base32_encoder_matches_the_station_key_id_alphabet() {
        assert_eq!(base32_no_pad(b"foo"), "MZXW6");
        assert_eq!(base32_no_pad(b"foobar"), "MZXW6YTBOI");
    }

    #[test]
    fn federation_profile_resolves_only_the_exact_retained_sender_key() {
        let now = 1_900_000_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let sender_key = SigningKey::from_bytes(&[8; 32]);
        let trusted = TrustedStationSigningKey {
            key_id: federation_signing_key_id(&station_key.verifying_key()).unwrap(),
            verifying_key: station_key.verifying_key(),
        };
        let sender = actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: "ptid:bob".to_string(),
                acct: "bob@station.test".to_string(),
                kind: actor::ActorKind::Person as i32,
            }),
            device_id: "device-bob".to_string(),
        };
        let mut profile = signed_sender_profile(&station_key, &sender_key, now);

        assert_eq!(
            verify_profile_actor_device_signing_key(
                &profile,
                &trusted,
                "@bob@station.test",
                "station-1",
                &sender,
                "sender-key-1",
                now,
                now,
            )
            .unwrap(),
            sender_key.verifying_key()
        );

        profile.device_signing_keys[0].revoked_at_unix_ms = now;
        profile.signature.clear();
        profile.signature = station_key
            .sign(&profile.encode_to_vec())
            .to_bytes()
            .to_vec();
        let error = verify_profile_actor_device_signing_key(
            &profile,
            &trusted,
            "@bob@station.test",
            "station-1",
            &sender,
            "sender-key-1",
            now,
            now,
        )
        .unwrap_err();
        assert_eq!(error.kind, SenderSigningKeyErrorKind::Integrity);

        profile.device_signing_keys.clear();
        profile.signature.clear();
        profile.signature = station_key
            .sign(&profile.encode_to_vec())
            .to_bytes()
            .to_vec();
        let error = verify_profile_actor_device_signing_key(
            &profile,
            &trusted,
            "@bob@station.test",
            "station-1",
            &sender,
            "sender-key-1",
            now,
            now,
        )
        .unwrap_err();
        assert_eq!(error.kind, SenderSigningKeyErrorKind::Retryable);
    }

    #[test]
    fn production_sender_requires_persisted_canonical_handle() {
        let sender = actor::ActorRef {
            ptid: "ptid:bob".to_string(),
            acct: "Bob@Station.Test".to_string(),
            kind: actor::ActorKind::Person as i32,
        };
        assert_eq!(
            sender_federated_handle(&sender).unwrap(),
            "@bob@station.test"
        );

        let missing = actor::ActorRef {
            acct: String::new(),
            ..sender
        };
        assert!(sender_federated_handle(&missing).is_err());
    }

    #[test]
    fn federation_resolve_envelope_requires_exact_type() {
        let view = federation::FederationResolveView {
            federated_handle: "@bob@station.test".to_string(),
            home_station_peer_id: "station-1".to_string(),
            ..Default::default()
        };
        let response = common::PeersResponse {
            code: "200".to_string(),
            msg: "federation resolve verified".to_string(),
            data: Some(prost_types::Any {
                type_url: FEDERATION_RESOLVE_TYPE_URL.to_string(),
                value: view.encode_to_vec(),
            }),
        };

        let decoded = decode_peers_payload::<federation::FederationResolveView>(
            &response.encode_to_vec(),
            FEDERATION_RESOLVE_TYPE_URL,
        )
        .unwrap();
        assert_eq!(decoded, view);

        let mut wrong_type = response;
        wrong_type.data.as_mut().unwrap().type_url =
            "type.googleapis.com/peers_touch.model.federation.v1.FederationSelfView".to_string();
        assert!(decode_peers_payload::<federation::FederationResolveView>(
            &wrong_type.encode_to_vec(),
            FEDERATION_RESOLVE_TYPE_URL,
        )
        .is_err());
    }

    #[test]
    fn federation_resolve_allows_local_profile_verification() {
        let sender = actor::ActorRef {
            ptid: "ptid:bob".to_string(),
            acct: "@bob@station.test".to_string(),
            kind: actor::ActorKind::Person as i32,
        };
        let view = federation::FederationResolveView {
            federated_handle: "@bob@station.test".to_string(),
            home_station_peer_id: "station-1".to_string(),
            is_local: true,
            profile: Some(actor::ActorProfile {
                peers_touch: Some(actor::PeersTouchInfo {
                    network_id: "ptid:bob".to_string(),
                }),
                ..Default::default()
            }),
            signing_key_kid: "station-key-1".to_string(),
            ..Default::default()
        };

        assert!(validate_sender_resolve_view(
            &view,
            "@bob@station.test",
            &sender,
            "station-1",
            "station-key-1",
        )
        .unwrap());
    }

    #[test]
    fn remote_sender_profile_unavailability_is_retryable() {
        let sender = actor::ActorRef {
            ptid: "ptid:bob".to_string(),
            acct: "@bob@remote.test".to_string(),
            kind: actor::ActorKind::Person as i32,
        };
        let view = federation::FederationResolveView {
            federated_handle: "@bob@remote.test".to_string(),
            home_station_peer_id: "station-remote".to_string(),
            is_local: false,
            profile: Some(actor::ActorProfile {
                peers_touch: Some(actor::PeersTouchInfo {
                    network_id: "ptid:bob".to_string(),
                }),
                ..Default::default()
            }),
            signing_key_kid: "remote-station-key".to_string(),
            ..Default::default()
        };

        let error = require_local_sender_resolve(
            &view,
            "@bob@remote.test",
            &sender,
            "station-1",
            "station-key-1",
        )
        .unwrap_err();
        assert_eq!(error.kind, SenderSigningKeyErrorKind::Retryable);
        assert_eq!(
            error.to_string(),
            "private Social sender Home Station profile is unavailable"
        );
    }
}
