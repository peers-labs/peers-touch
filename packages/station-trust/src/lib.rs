use libp2p_identity::{KeyType, PublicKey};
use multiaddr::Multiaddr;
use prost::Message;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{
    ring::default_provider, verify_tls12_signature, verify_tls13_signature,
    WebPkiSupportedAlgorithms,
};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, Error as RustlsError, RootCertStore,
    SignatureScheme,
};
use sha2::{Digest, Sha256};
use std::fmt;
use std::net::IpAddr;
use std::str::FromStr;
use std::sync::Arc;
use url::{Host, Url};
use x509_parser::{parse_x509_certificate, time::ASN1Time};

pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.peer.v1.rs"));
}

use proto::{
    endpoint_tls_trust, AccessEndpointRole, EndpointTlsTrust, PublicEndpointConnectionMaterial,
    PublicStationAdvertisementStatement, SignedPublicStationAdvertisement, StationCapabilitySet,
    StationIdentityResponse, StationIdentityStatement, StationNodeAuthorization,
    StationNodeAuthorizationStatement, StationRouteAttestation, StationRouteKind,
    StationRouteStatement, StationRouteVisibility,
};

pub const MAX_SIGNED_CONTROL_BYTES: usize = 1 << 20;
pub const STATION_IDENTITY_CHALLENGE_SIZE: usize = 32;
pub const MAX_STATION_IDENTITY_LIFETIME_MS: i64 = 5 * 60 * 1_000;
pub const MAX_NODE_AUTHORIZATION_LIFETIME_MS: i64 = 24 * 60 * 60 * 1_000;
pub const MAX_ROUTE_LIFETIME_MS: i64 = 5 * 60 * 1_000;
pub const PUBLIC_CONNECTION_MATERIAL_SCHEMA_VERSION: u32 = 1;
pub const MAX_PUBLIC_CONNECTION_MATERIAL_LIFETIME_MS: i64 = 7 * 24 * 60 * 60 * 1_000;
pub const MAX_PUBLIC_STATION_ADVERTISEMENT_LIFETIME_MS: i64 = 7 * 24 * 60 * 60 * 1_000;
pub const MAX_PUBLIC_DISCOVERY_ORIGIN_BYTES: usize = 512;
pub const MAX_PUBLIC_DISPLAY_NAME_BYTES: usize = 128;
pub const MAX_ENDPOINT_CERTIFICATE_AUTHORITY_BYTES: usize = 16 * 1024;
pub const CLOCK_SKEW_MS: i64 = 60_000;

const STATION_NODE_AUTHORIZATION_DOMAIN: &[u8] = b"peers-touch/station-node-authorization/v1\0";
const STATION_IDENTITY_DOMAIN: &[u8] = b"peers-touch/station-identity/v1\0";
const STATION_ROUTE_DOMAIN: &[u8] = b"peers-touch/station-route/v1\0";
const PUBLIC_STATION_ADVERTISEMENT_DOMAIN: &[u8] = b"peers-touch/public-station-advertisement/v1\0";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrustError {
    pub code: &'static str,
}

impl TrustError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }
}

impl fmt::Display for TrustError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code)
    }
}

impl std::error::Error for TrustError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedNodeAuthorization {
    pub station_peer_id: String,
    pub node_peer_id: String,
    pub station_root_public_key: Vec<u8>,
    pub node_public_key: Vec<u8>,
    pub authorization_digest: [u8; 32],
    pub authorization_epoch: u64,
    pub capabilities_digest: [u8; 32],
    pub expires_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedStationIdentity {
    pub station_peer_id: String,
    pub node_peer_id: String,
    pub station_root_public_key: Vec<u8>,
    pub authorization_digest: [u8; 32],
    pub capabilities: Vec<String>,
    pub verified_at_unix_ms: i64,
    pub authorization_epoch: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedStationRoute {
    pub station_peer_id: String,
    pub node_peer_id: String,
    pub station_root_public_key: Vec<u8>,
    pub route_id: String,
    pub route_generation: u64,
    pub relay_peer_id: Option<String>,
    pub inner_tls_spki_sha256: [u8; 32],
    pub authorization_digest: [u8; 32],
    pub authorization_epoch: u64,
    pub addresses: Vec<String>,
    pub expires_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VerifiedEndpointTlsTrust {
    WebPki,
    AuthenticatedPlaintextBootstrap,
    CertificateAuthorityDer(Vec<u8>),
    LeafSpkiSha256([u8; 32]),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedPublicEndpointConnectionMaterial {
    pub canonical_discovery_origin: String,
    pub expected_endpoint_role: AccessEndpointRole,
    pub expected_endpoint_identity: String,
    pub station_root_public_key: Option<Vec<u8>>,
    pub tls_trust: VerifiedEndpointTlsTrust,
    pub expires_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedPublicStationAdvertisement {
    pub statement: PublicStationAdvertisementStatement,
    pub material: VerifiedPublicEndpointConnectionMaterial,
}

pub fn endpoint_tls_client_config(
    trust: &VerifiedEndpointTlsTrust,
) -> Result<Option<ClientConfig>, TrustError> {
    let provider = default_provider();
    let supported = provider.signature_verification_algorithms;
    let builder = ClientConfig::builder_with_provider(Arc::new(provider))
        .with_safe_default_protocol_versions()
        .map_err(|_| TrustError::new("public_connection_material_tls_config"))?;
    match trust {
        VerifiedEndpointTlsTrust::WebPki
        | VerifiedEndpointTlsTrust::AuthenticatedPlaintextBootstrap => Ok(None),
        VerifiedEndpointTlsTrust::CertificateAuthorityDer(bytes) => {
            let mut roots = RootCertStore::empty();
            roots
                .add(CertificateDer::from(bytes.clone()))
                .map_err(|_| TrustError::new("public_connection_material_tls_config"))?;
            Ok(Some(
                builder.with_root_certificates(roots).with_no_client_auth(),
            ))
        }
        VerifiedEndpointTlsTrust::LeafSpkiSha256(expected) => Ok(Some(
            builder
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(PinnedSpkiVerifier {
                    expected: *expected,
                    supported,
                }))
                .with_no_client_auth(),
        )),
    }
}

#[derive(Debug)]
struct PinnedSpkiVerifier {
    expected: [u8; 32],
    supported: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for PinnedSpkiVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        let (remainder, certificate) = parse_x509_certificate(end_entity.as_ref())
            .map_err(|_| invalid_tls_certificate(CertificateError::BadEncoding))?;
        if !remainder.is_empty() {
            return Err(invalid_tls_certificate(CertificateError::BadEncoding));
        }
        let validation_time = ASN1Time::from_timestamp(now.as_secs() as i64)
            .map_err(|_| invalid_tls_certificate(CertificateError::BadEncoding))?;
        if !certificate.validity().is_valid_at(validation_time) {
            return Err(invalid_tls_certificate(CertificateError::Expired));
        }
        let digest: [u8; 32] = Sha256::digest(certificate.tbs_certificate.subject_pki.raw).into();
        if digest != self.expected {
            return Err(invalid_tls_certificate(CertificateError::UnknownIssuer));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls12_signature(message, certificate, signature, &self.supported)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls13_signature(message, certificate, signature, &self.supported)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.supported.supported_schemes()
    }
}

fn invalid_tls_certificate(error: CertificateError) -> RustlsError {
    RustlsError::InvalidCertificate(error)
}

pub fn verify_public_connection_material_bytes(
    bytes: &[u8],
    source_authenticated: bool,
    now_unix_ms: i64,
) -> Result<VerifiedPublicEndpointConnectionMaterial, TrustError> {
    let material =
        decode_canonical::<PublicEndpointConnectionMaterial>(bytes, "public_connection_material")?;
    verify_public_connection_material(&material, source_authenticated, now_unix_ms)
}

pub fn verify_public_connection_material(
    material: &PublicEndpointConnectionMaterial,
    source_authenticated: bool,
    now_unix_ms: i64,
) -> Result<VerifiedPublicEndpointConnectionMaterial, TrustError> {
    validate_size(&material.encode_to_vec(), "public_connection_material_size")?;
    if material.schema_version != PUBLIC_CONNECTION_MATERIAL_SCHEMA_VERSION {
        return Err(TrustError::new("public_connection_material_schema"));
    }
    let scheme = canonical_public_discovery_origin(&material.canonical_discovery_origin)?;
    if scheme == "http" && !source_authenticated {
        return Err(TrustError::new(
            "public_connection_material_source_authentication",
        ));
    }
    let expected_identity = libp2p_identity::PeerId::from_str(&material.expected_endpoint_identity)
        .map_err(|_| TrustError::new("public_connection_material_identity"))?;
    if expected_identity.to_string() != material.expected_endpoint_identity
        || !valid_public_lifetime(
            material.issued_at_unix_ms,
            material.expires_at_unix_ms,
            now_unix_ms,
            MAX_PUBLIC_CONNECTION_MATERIAL_LIFETIME_MS,
        )
    {
        return Err(TrustError::new("public_connection_material_fields"));
    }

    let role = AccessEndpointRole::try_from(material.expected_endpoint_role)
        .map_err(|_| TrustError::new("public_connection_material_role"))?;
    let station_root_public_key = match role {
        AccessEndpointRole::Relay => {
            if !material.expected_station_root_public_key.is_empty() {
                return Err(TrustError::new("public_connection_material_relay_root"));
            }
            None
        }
        AccessEndpointRole::DirectStation => {
            let root = decode_ed25519_public_key(&material.expected_station_root_public_key)?;
            if root.to_peer_id() != expected_identity {
                return Err(TrustError::new("public_connection_material_station_root"));
            }
            Some(material.expected_station_root_public_key.clone())
        }
        _ => return Err(TrustError::new("public_connection_material_role")),
    };
    let tls_trust = verify_endpoint_tls_trust(material.endpoint_tls_trust.as_ref(), &scheme)?;
    Ok(VerifiedPublicEndpointConnectionMaterial {
        canonical_discovery_origin: material.canonical_discovery_origin.clone(),
        expected_endpoint_role: role,
        expected_endpoint_identity: expected_identity.to_string(),
        station_root_public_key,
        tls_trust,
        expires_at_unix_ms: material.expires_at_unix_ms,
    })
}

pub fn public_connection_material_digest(
    material: &PublicEndpointConnectionMaterial,
) -> Result<[u8; 32], TrustError> {
    let bytes = material.encode_to_vec();
    validate_size(&bytes, "public_connection_material_size")?;
    Ok(Sha256::digest(bytes).into())
}

pub fn verify_public_station_advertisement_bytes(
    bytes: &[u8],
    material: &PublicEndpointConnectionMaterial,
    now_unix_ms: i64,
) -> Result<VerifiedPublicStationAdvertisement, TrustError> {
    let advertisement = decode_canonical::<SignedPublicStationAdvertisement>(
        bytes,
        "public_station_advertisement",
    )?;
    verify_public_station_advertisement(&advertisement, material, now_unix_ms)
}

pub fn verify_public_station_advertisement(
    advertisement: &SignedPublicStationAdvertisement,
    material: &PublicEndpointConnectionMaterial,
    now_unix_ms: i64,
) -> Result<VerifiedPublicStationAdvertisement, TrustError> {
    validate_size(
        &advertisement.encode_to_vec(),
        "public_station_advertisement_size",
    )?;
    let verified_material = verify_public_connection_material(material, true, now_unix_ms)?;
    if verified_material.expected_endpoint_role != AccessEndpointRole::DirectStation {
        return Err(TrustError::new("public_station_advertisement_role"));
    }
    let statement = decode_canonical::<PublicStationAdvertisementStatement>(
        &advertisement.statement_bytes,
        "public_station_advertisement_statement",
    )?;
    let material_digest = public_connection_material_digest(material)?;
    if statement.schema_version != PUBLIC_CONNECTION_MATERIAL_SCHEMA_VERSION
        || statement.station_peer_id != verified_material.expected_endpoint_identity
        || statement.station_root_public_key != material.expected_station_root_public_key
        || statement.connection_material_digest != material_digest
        || !statement.public_discovery_consent
        || statement.advertisement_sequence == 0
        || statement.canonical_discovery_origin != verified_material.canonical_discovery_origin
        || !valid_public_display_name(&statement.display_name)
        || StationRouteVisibility::try_from(statement.visibility).ok()
            != Some(StationRouteVisibility::Public)
        || statement.issued_at_unix_ms < material.issued_at_unix_ms
        || statement.expires_at_unix_ms > verified_material.expires_at_unix_ms
        || !valid_public_lifetime(
            statement.issued_at_unix_ms,
            statement.expires_at_unix_ms,
            now_unix_ms,
            MAX_PUBLIC_STATION_ADVERTISEMENT_LIFETIME_MS,
        )
    {
        return Err(TrustError::new("public_station_advertisement_fields"));
    }
    let root = decode_ed25519_public_key(&statement.station_root_public_key)?;
    verify_signature(
        &root,
        PUBLIC_STATION_ADVERTISEMENT_DOMAIN,
        &advertisement.statement_bytes,
        &advertisement.station_root_signature,
        "public_station_advertisement_signature",
    )?;
    Ok(VerifiedPublicStationAdvertisement {
        statement,
        material: verified_material,
    })
}

pub fn station_capabilities_digest(capabilities: &[String]) -> Result<[u8; 32], TrustError> {
    validate_capabilities(capabilities)?;
    let bytes = StationCapabilitySet {
        capabilities: capabilities.to_vec(),
    }
    .encode_to_vec();
    Ok(Sha256::digest(bytes).into())
}

pub fn verify_node_authorization_bytes(
    bytes: &[u8],
    now_unix_ms: i64,
) -> Result<VerifiedNodeAuthorization, TrustError> {
    validate_size(bytes, "authorization_size")?;
    let authorization = StationNodeAuthorization::decode(bytes)
        .map_err(|_| TrustError::new("authorization_decode"))?;
    if authorization.encode_to_vec() != bytes {
        return Err(TrustError::new("authorization_noncanonical"));
    }
    verify_node_authorization(&authorization, now_unix_ms)
}

pub fn verify_station_identity_response_bytes(
    bytes: &[u8],
    challenge: &[u8],
    expected_canonical_origin: &str,
    required_capabilities: &[&str],
    now_unix_ms: i64,
) -> Result<VerifiedStationIdentity, TrustError> {
    validate_size(bytes, "identity_size")?;
    if challenge.len() != STATION_IDENTITY_CHALLENGE_SIZE {
        return Err(TrustError::new("identity_challenge"));
    }
    let response =
        StationIdentityResponse::decode(bytes).map_err(|_| TrustError::new("identity_decode"))?;
    if response.encode_to_vec() != bytes {
        return Err(TrustError::new("identity_noncanonical"));
    }
    let authorization_message = response
        .node_authorization
        .as_ref()
        .ok_or_else(|| TrustError::new("identity_authorization_missing"))?;
    let authorization = verify_node_authorization(authorization_message, now_unix_ms)?;
    let statement = decode_canonical::<StationIdentityStatement>(
        &response.statement_bytes,
        "identity_statement",
    )?;
    if statement.challenge != challenge
        || statement.station_peer_id != authorization.station_peer_id
        || statement.canonical_origin != expected_canonical_origin
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= now_unix_ms
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms
            > MAX_STATION_IDENTITY_LIFETIME_MS
        || statement.expires_at_unix_ms > authorization.expires_at_unix_ms
        || statement.node_authorization_digest != authorization.authorization_digest
    {
        return Err(TrustError::new("identity_fields"));
    }
    validate_capabilities(&statement.capabilities)?;
    if station_capabilities_digest(&statement.capabilities)? != authorization.capabilities_digest {
        return Err(TrustError::new("identity_capabilities_digest"));
    }
    if required_capabilities.iter().any(|required| {
        statement
            .capabilities
            .binary_search_by(|candidate| candidate.as_str().cmp(required))
            .is_err()
    }) {
        return Err(TrustError::new("identity_capability_missing"));
    }
    let node_public_key = decode_ed25519_public_key(&authorization.node_public_key)?;
    verify_signature(
        &node_public_key,
        STATION_IDENTITY_DOMAIN,
        &response.statement_bytes,
        &response.node_signature,
        "identity_signature",
    )?;
    Ok(VerifiedStationIdentity {
        station_peer_id: authorization.station_peer_id,
        node_peer_id: authorization.node_peer_id,
        station_root_public_key: authorization.station_root_public_key,
        authorization_digest: authorization.authorization_digest,
        capabilities: statement.capabilities,
        verified_at_unix_ms: now_unix_ms,
        authorization_epoch: authorization.authorization_epoch,
    })
}

pub fn verify_station_route_attestation_bytes(
    bytes: &[u8],
    expected_relay_peer_id: Option<&str>,
    now_unix_ms: i64,
) -> Result<VerifiedStationRoute, TrustError> {
    validate_size(bytes, "route_size")?;
    let attestation =
        StationRouteAttestation::decode(bytes).map_err(|_| TrustError::new("route_decode"))?;
    if attestation.encode_to_vec() != bytes {
        return Err(TrustError::new("route_noncanonical"));
    }
    let authorization_message = attestation
        .node_authorization
        .as_ref()
        .ok_or_else(|| TrustError::new("route_authorization_missing"))?;
    let authorization = verify_node_authorization(authorization_message, now_unix_ms)?;
    let statement =
        decode_canonical::<StationRouteStatement>(&attestation.statement_bytes, "route_statement")?;
    let visibility = StationRouteVisibility::try_from(statement.visibility).ok();
    let kind = StationRouteKind::try_from(statement.kind).ok();
    let relay_is_valid = match kind {
        Some(StationRouteKind::Direct) => {
            statement.relay_peer_id.is_empty() && expected_relay_peer_id.is_none()
        }
        Some(StationRouteKind::Circuit) => {
            expected_relay_peer_id == Some(statement.relay_peer_id.as_str())
        }
        _ => false,
    };
    if statement.station_peer_id != authorization.station_peer_id
        || statement.node_peer_id != authorization.node_peer_id
        || statement.route_id.trim().is_empty()
        || statement.route_id.trim() != statement.route_id
        || statement.route_generation == 0
        || statement.inner_tls_spki_sha256.len() != 32
        || statement.capabilities_digest != authorization.capabilities_digest
        || statement.node_authorization_digest != authorization.authorization_digest
        || !matches!(
            visibility,
            Some(StationRouteVisibility::Public | StationRouteVisibility::GrantOnly)
        )
        || !relay_is_valid
        || !canonical_addresses(&statement.addresses)
        || !route_addresses_match_kind(&statement, kind)
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= now_unix_ms
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms > MAX_ROUTE_LIFETIME_MS
        || statement.expires_at_unix_ms > authorization.expires_at_unix_ms
    {
        return Err(TrustError::new("route_fields"));
    }
    let node_public_key = decode_ed25519_public_key(&authorization.node_public_key)?;
    verify_signature(
        &node_public_key,
        STATION_ROUTE_DOMAIN,
        &attestation.statement_bytes,
        &attestation.node_signature,
        "route_signature",
    )?;
    let spki: [u8; 32] = statement
        .inner_tls_spki_sha256
        .as_slice()
        .try_into()
        .map_err(|_| TrustError::new("route_spki"))?;
    Ok(VerifiedStationRoute {
        station_peer_id: authorization.station_peer_id,
        node_peer_id: authorization.node_peer_id,
        station_root_public_key: authorization.station_root_public_key,
        route_id: statement.route_id,
        route_generation: statement.route_generation,
        relay_peer_id: match kind {
            Some(StationRouteKind::Circuit) => Some(statement.relay_peer_id),
            _ => None,
        },
        inner_tls_spki_sha256: spki,
        authorization_digest: authorization.authorization_digest,
        authorization_epoch: authorization.authorization_epoch,
        addresses: statement.addresses,
        expires_at_unix_ms: statement.expires_at_unix_ms,
    })
}

fn verify_node_authorization(
    authorization: &StationNodeAuthorization,
    now_unix_ms: i64,
) -> Result<VerifiedNodeAuthorization, TrustError> {
    let authorization_bytes = authorization.encode_to_vec();
    validate_size(&authorization_bytes, "authorization_size")?;
    let statement = decode_canonical::<StationNodeAuthorizationStatement>(
        &authorization.statement_bytes,
        "authorization_statement",
    )?;
    if statement.authorization_epoch == 0
        || statement.capabilities_digest.len() != 32
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= now_unix_ms
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms
            > MAX_NODE_AUTHORIZATION_LIFETIME_MS
    {
        return Err(TrustError::new("authorization_fields"));
    }
    let root_public_key = decode_ed25519_public_key(&authorization.station_root_public_key)?;
    let node_public_key = decode_ed25519_public_key(&statement.node_public_key)?;
    let station_peer_id = root_public_key.to_peer_id().to_string();
    let node_peer_id = node_public_key.to_peer_id().to_string();
    if statement.station_peer_id != station_peer_id
        || statement.node_peer_id != node_peer_id
        || station_peer_id == node_peer_id
    {
        return Err(TrustError::new("authorization_identity"));
    }
    verify_signature(
        &root_public_key,
        STATION_NODE_AUTHORIZATION_DOMAIN,
        &authorization.statement_bytes,
        &authorization.root_signature,
        "authorization_signature",
    )?;
    let capabilities_digest: [u8; 32] = statement
        .capabilities_digest
        .as_slice()
        .try_into()
        .map_err(|_| TrustError::new("authorization_capabilities"))?;
    Ok(VerifiedNodeAuthorization {
        station_peer_id,
        node_peer_id,
        station_root_public_key: authorization.station_root_public_key.clone(),
        node_public_key: statement.node_public_key,
        authorization_digest: Sha256::digest(authorization_bytes).into(),
        authorization_epoch: statement.authorization_epoch,
        capabilities_digest,
        expires_at_unix_ms: statement.expires_at_unix_ms,
    })
}

fn decode_canonical<M: Message + Default>(
    bytes: &[u8],
    code: &'static str,
) -> Result<M, TrustError> {
    validate_size(bytes, code)?;
    let message = M::decode(bytes).map_err(|_| TrustError::new(code))?;
    if message.encode_to_vec() != bytes {
        return Err(TrustError::new(code));
    }
    Ok(message)
}

fn decode_ed25519_public_key(bytes: &[u8]) -> Result<PublicKey, TrustError> {
    let key =
        PublicKey::try_decode_protobuf(bytes).map_err(|_| TrustError::new("public_key_decode"))?;
    if key.key_type() != KeyType::Ed25519 {
        return Err(TrustError::new("public_key_type"));
    }
    Ok(key)
}

fn verify_signature(
    public_key: &PublicKey,
    domain: &[u8],
    statement: &[u8],
    signature: &[u8],
    code: &'static str,
) -> Result<(), TrustError> {
    let mut input = Vec::with_capacity(domain.len() + statement.len());
    input.extend_from_slice(domain);
    input.extend_from_slice(statement);
    if !public_key.verify(&input, signature) {
        return Err(TrustError::new(code));
    }
    Ok(())
}

fn validate_capabilities(capabilities: &[String]) -> Result<(), TrustError> {
    if capabilities.is_empty()
        || capabilities.len() > 64
        || capabilities.iter().any(|capability| {
            capability.is_empty() || capability.trim() != capability || capability.len() > 128
        })
        || capabilities.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(TrustError::new("capabilities_canonical"));
    }
    Ok(())
}

fn canonical_addresses(addresses: &[String]) -> bool {
    !addresses.is_empty()
        && addresses.len() <= 16
        && !addresses
            .iter()
            .any(|address| address.is_empty() || address.trim() != address || address.len() > 2048)
        && !addresses.windows(2).any(|pair| pair[0] >= pair[1])
}

fn route_addresses_match_kind(
    statement: &StationRouteStatement,
    kind: Option<StationRouteKind>,
) -> bool {
    let suffix = match kind {
        Some(StationRouteKind::Direct) => {
            format!("/p2p/{}", statement.node_peer_id)
        }
        Some(StationRouteKind::Circuit) => format!(
            "/p2p/{}/p2p-circuit/p2p/{}",
            statement.relay_peer_id, statement.node_peer_id
        ),
        _ => return false,
    };
    statement.addresses.iter().all(|raw| {
        let Ok(address) = Multiaddr::from_str(raw) else {
            return false;
        };
        if address.to_string() != *raw || !raw.ends_with(&suffix) {
            return false;
        }
        let prefix = raw.trim_end_matches(&suffix);
        !prefix.is_empty()
            && !prefix.contains("/p2p/")
            && !prefix.contains("/p2p-circuit")
            && Multiaddr::from_str(prefix).is_ok_and(|parsed| parsed.to_string() == prefix)
    })
}

fn verify_endpoint_tls_trust(
    trust: Option<&EndpointTlsTrust>,
    scheme: &str,
) -> Result<VerifiedEndpointTlsTrust, TrustError> {
    let Some(value) = trust.and_then(|trust| trust.trust.as_ref()) else {
        return Ok(if scheme == "https" {
            VerifiedEndpointTlsTrust::WebPki
        } else {
            VerifiedEndpointTlsTrust::AuthenticatedPlaintextBootstrap
        });
    };
    if scheme != "https" {
        return Err(TrustError::new("public_connection_material_http_tls"));
    }
    match value {
        endpoint_tls_trust::Trust::CertificateAuthorityDer(bytes) => {
            if bytes.is_empty() || bytes.len() > MAX_ENDPOINT_CERTIFICATE_AUTHORITY_BYTES {
                return Err(TrustError::new(
                    "public_connection_material_certificate_authority",
                ));
            }
            let (remainder, certificate) = parse_x509_certificate(bytes)
                .map_err(|_| TrustError::new("public_connection_material_certificate_authority"))?;
            let constraints = certificate
                .basic_constraints()
                .map_err(|_| TrustError::new("public_connection_material_certificate_authority"))?;
            if !remainder.is_empty() || !constraints.is_some_and(|extension| extension.value.ca) {
                return Err(TrustError::new(
                    "public_connection_material_certificate_authority",
                ));
            }
            Ok(VerifiedEndpointTlsTrust::CertificateAuthorityDer(
                bytes.clone(),
            ))
        }
        endpoint_tls_trust::Trust::LeafSpkiSha256(bytes) => {
            let digest: [u8; 32] = bytes
                .as_slice()
                .try_into()
                .map_err(|_| TrustError::new("public_connection_material_spki"))?;
            Ok(VerifiedEndpointTlsTrust::LeafSpkiSha256(digest))
        }
    }
}

fn canonical_public_discovery_origin(origin: &str) -> Result<String, TrustError> {
    if origin.is_empty()
        || origin.trim() != origin
        || origin.len() > MAX_PUBLIC_DISCOVERY_ORIGIN_BYTES
    {
        return Err(TrustError::new("public_connection_material_origin"));
    }
    let parsed =
        Url::parse(origin).map_err(|_| TrustError::new("public_connection_material_origin"))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(TrustError::new("public_connection_material_origin"));
    }
    let prefix = format!("{}://", parsed.scheme());
    let authority = origin
        .strip_prefix(&prefix)
        .ok_or_else(|| TrustError::new("public_connection_material_origin"))?;
    let (host_literal, port) = split_canonical_authority(authority)?;
    let parsed_host_matches = match parsed.host() {
        Some(Host::Domain(value)) => value == host_literal,
        Some(Host::Ipv4(value)) => value.to_string() == host_literal,
        Some(Host::Ipv6(value)) => value.to_string() == host_literal,
        None => false,
    };
    if !valid_canonical_host(host_literal)
        || !parsed_host_matches
        || port.is_some_and(|value| {
            value.parse::<u16>().ok().filter(|port| *port > 0).is_none()
                || value.parse::<u16>().unwrap().to_string() != value
        })
    {
        return Err(TrustError::new("public_connection_material_origin"));
    }
    Ok(parsed.scheme().to_string())
}

fn split_canonical_authority(authority: &str) -> Result<(&str, Option<&str>), TrustError> {
    if let Some(ipv6) = authority.strip_prefix('[') {
        let closing = ipv6
            .find(']')
            .ok_or_else(|| TrustError::new("public_connection_material_origin"))?;
        let host = &ipv6[..closing];
        let suffix = &ipv6[closing + 1..];
        let port = if suffix.is_empty() {
            None
        } else {
            Some(
                suffix
                    .strip_prefix(':')
                    .ok_or_else(|| TrustError::new("public_connection_material_origin"))?,
            )
        };
        if port == Some("") {
            return Err(TrustError::new("public_connection_material_origin"));
        }
        return Ok((host, port));
    }
    if authority.matches(':').count() > 1 {
        return Err(TrustError::new("public_connection_material_origin"));
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if host.is_empty() || port.is_empty() {
            return Err(TrustError::new("public_connection_material_origin"));
        }
        return Ok((host, Some(port)));
    }
    Ok((authority, None))
}

fn valid_canonical_host(host: &str) -> bool {
    if host.is_empty() || host != host.to_ascii_lowercase() || host.ends_with('.') {
        return false;
    }
    if let Ok(address) = IpAddr::from_str(host) {
        return address.to_string() == host;
    }
    if host.len() > 253 {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == b'-'
            })
    })
}

fn valid_public_lifetime(
    issued_at_unix_ms: i64,
    expires_at_unix_ms: i64,
    now_unix_ms: i64,
    max_lifetime_ms: i64,
) -> bool {
    issued_at_unix_ms <= now_unix_ms + CLOCK_SKEW_MS
        && expires_at_unix_ms > now_unix_ms
        && expires_at_unix_ms > issued_at_unix_ms
        && expires_at_unix_ms - issued_at_unix_ms <= max_lifetime_ms
}

fn valid_public_display_name(value: &str) -> bool {
    !value.is_empty() && value.trim() == value && value.len() <= MAX_PUBLIC_DISPLAY_NAME_BYTES
}

fn validate_size(bytes: &[u8], code: &'static str) -> Result<(), TrustError> {
    if bytes.is_empty() || bytes.len() > MAX_SIGNED_CONTROL_BYTES {
        return Err(TrustError::new(code));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libp2p_identity::Keypair;

    const NOW: i64 = 1_800_000_000_000;

    fn capabilities() -> Vec<String> {
        vec![
            "access-gate".to_string(),
            "station-identity".to_string(),
            "station-route".to_string(),
        ]
    }

    fn authorization(root: &Keypair, node: &Keypair, epoch: u64) -> StationNodeAuthorization {
        let statement = StationNodeAuthorizationStatement {
            station_peer_id: root.public().to_peer_id().to_string(),
            node_peer_id: node.public().to_peer_id().to_string(),
            node_public_key: node.public().encode_protobuf(),
            authorization_epoch: epoch,
            capabilities_digest: station_capabilities_digest(&capabilities())
                .unwrap()
                .to_vec(),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60 * 60 * 1_000,
        };
        let statement_bytes = statement.encode_to_vec();
        StationNodeAuthorization {
            statement_bytes: statement_bytes.clone(),
            station_root_public_key: root.public().encode_protobuf(),
            root_signature: sign(root, STATION_NODE_AUTHORIZATION_DOMAIN, &statement_bytes),
        }
    }

    fn identity_response(
        root: &Keypair,
        node: &Keypair,
        challenge: &[u8],
    ) -> StationIdentityResponse {
        let authorization = authorization(root, node, 7);
        let authorization_digest: [u8; 32] = Sha256::digest(authorization.encode_to_vec()).into();
        let statement = StationIdentityStatement {
            challenge: challenge.to_vec(),
            station_peer_id: root.public().to_peer_id().to_string(),
            canonical_origin: "https://station.example:443".to_string(),
            capabilities: capabilities(),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60_000,
            node_authorization_digest: authorization_digest.to_vec(),
        };
        let statement_bytes = statement.encode_to_vec();
        StationIdentityResponse {
            statement_bytes: statement_bytes.clone(),
            node_signature: sign(node, STATION_IDENTITY_DOMAIN, &statement_bytes),
            node_authorization: Some(authorization),
        }
    }

    fn route_attestation(
        root: &Keypair,
        node: &Keypair,
        relay_peer_id: &str,
    ) -> StationRouteAttestation {
        let authorization = authorization(root, node, 7);
        let authorization_digest: [u8; 32] = Sha256::digest(authorization.encode_to_vec()).into();
        let statement = StationRouteStatement {
            station_peer_id: root.public().to_peer_id().to_string(),
            relay_peer_id: relay_peer_id.to_string(),
            route_id: "route-1".to_string(),
            route_generation: 3,
            inner_tls_spki_sha256: vec![9; 32],
            capabilities_digest: station_capabilities_digest(&capabilities())
                .unwrap()
                .to_vec(),
            visibility: StationRouteVisibility::Public as i32,
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60_000,
            node_peer_id: node.public().to_peer_id().to_string(),
            node_authorization_digest: authorization_digest.to_vec(),
            kind: StationRouteKind::Circuit as i32,
            addresses: vec![format!(
                "/ip4/127.0.0.1/tcp/4001/p2p/{relay_peer_id}/p2p-circuit/p2p/{}",
                node.public().to_peer_id()
            )],
        };
        let statement_bytes = statement.encode_to_vec();
        StationRouteAttestation {
            statement_bytes: statement_bytes.clone(),
            node_signature: sign(node, STATION_ROUTE_DOMAIN, &statement_bytes),
            node_authorization: Some(authorization),
        }
    }

    fn direct_route_attestation(root: &Keypair, node: &Keypair) -> StationRouteAttestation {
        let authorization = authorization(root, node, 7);
        let authorization_digest: [u8; 32] = Sha256::digest(authorization.encode_to_vec()).into();
        let statement = StationRouteStatement {
            station_peer_id: root.public().to_peer_id().to_string(),
            route_id: format!("direct-{}", node.public().to_peer_id()),
            route_generation: 7,
            inner_tls_spki_sha256: vec![7; 32],
            capabilities_digest: station_capabilities_digest(&capabilities())
                .unwrap()
                .to_vec(),
            visibility: StationRouteVisibility::Public as i32,
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60_000,
            node_peer_id: node.public().to_peer_id().to_string(),
            node_authorization_digest: authorization_digest.to_vec(),
            kind: StationRouteKind::Direct as i32,
            addresses: vec![format!(
                "/ip4/127.0.0.1/tcp/4001/p2p/{}",
                node.public().to_peer_id()
            )],
            ..Default::default()
        };
        let statement_bytes = statement.encode_to_vec();
        StationRouteAttestation {
            statement_bytes: statement_bytes.clone(),
            node_signature: sign(node, STATION_ROUTE_DOMAIN, &statement_bytes),
            node_authorization: Some(authorization),
        }
    }

    fn sign(key: &Keypair, domain: &[u8], statement: &[u8]) -> Vec<u8> {
        let mut input = domain.to_vec();
        input.extend_from_slice(statement);
        key.sign(&input).unwrap()
    }

    #[test]
    fn public_connection_material_and_station_advertisement_verify_exact_bytes() {
        let root = Keypair::generate_ed25519();
        let material = PublicEndpointConnectionMaterial {
            schema_version: PUBLIC_CONNECTION_MATERIAL_SCHEMA_VERSION,
            canonical_discovery_origin: "https://station.example:8443".to_string(),
            expected_endpoint_role: AccessEndpointRole::DirectStation as i32,
            expected_endpoint_identity: root.public().to_peer_id().to_string(),
            expected_station_root_public_key: root.public().encode_protobuf(),
            endpoint_tls_trust: Some(EndpointTlsTrust {
                trust: Some(endpoint_tls_trust::Trust::LeafSpkiSha256(vec![0x35; 32])),
            }),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 24 * 60 * 60 * 1_000,
        };
        let bytes = material.encode_to_vec();
        let verified = verify_public_connection_material_bytes(&bytes, true, NOW).unwrap();
        assert_eq!(
            verified.expected_endpoint_identity,
            root.public().to_peer_id().to_string()
        );
        assert_eq!(
            verified.tls_trust,
            VerifiedEndpointTlsTrust::LeafSpkiSha256([0x35; 32])
        );
        assert!(endpoint_tls_client_config(&verified.tls_trust)
            .unwrap()
            .is_some());

        let statement = PublicStationAdvertisementStatement {
            schema_version: PUBLIC_CONNECTION_MATERIAL_SCHEMA_VERSION,
            station_peer_id: root.public().to_peer_id().to_string(),
            station_root_public_key: root.public().encode_protobuf(),
            connection_material_digest: public_connection_material_digest(&material)
                .unwrap()
                .to_vec(),
            public_discovery_consent: true,
            advertisement_sequence: 7,
            canonical_discovery_origin: material.canonical_discovery_origin.clone(),
            display_name: "Public Station".to_string(),
            visibility: StationRouteVisibility::Public as i32,
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 12 * 60 * 60 * 1_000,
        };
        let statement_bytes = statement.encode_to_vec();
        let advertisement = SignedPublicStationAdvertisement {
            statement_bytes: statement_bytes.clone(),
            station_root_signature: sign(
                &root,
                PUBLIC_STATION_ADVERTISEMENT_DOMAIN,
                &statement_bytes,
            ),
        };
        let verified_advertisement = verify_public_station_advertisement_bytes(
            &advertisement.encode_to_vec(),
            &material,
            NOW,
        )
        .unwrap();
        assert_eq!(verified_advertisement.statement.advertisement_sequence, 7);

        let mut forged = advertisement;
        forged.station_root_signature[0] ^= 0xff;
        assert!(verify_public_station_advertisement(&forged, &material, NOW,).is_err());
    }

    #[test]
    fn public_connection_material_rejects_bare_http_and_invalid_scoped_tls() {
        let relay = Keypair::generate_ed25519();
        let mut material = PublicEndpointConnectionMaterial {
            schema_version: PUBLIC_CONNECTION_MATERIAL_SCHEMA_VERSION,
            canonical_discovery_origin: "http://192.0.2.10:8080".to_string(),
            expected_endpoint_role: AccessEndpointRole::Relay as i32,
            expected_endpoint_identity: relay.public().to_peer_id().to_string(),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60 * 60 * 1_000,
            ..Default::default()
        };
        assert!(verify_public_connection_material(&material, false, NOW).is_err());
        let plaintext = verify_public_connection_material(&material, true, NOW).unwrap();
        assert!(endpoint_tls_client_config(&plaintext.tls_trust)
            .unwrap()
            .is_none());

        material.endpoint_tls_trust = Some(EndpointTlsTrust {
            trust: Some(endpoint_tls_trust::Trust::LeafSpkiSha256(vec![0x21; 32])),
        });
        assert!(verify_public_connection_material(&material, true, NOW).is_err());

        material.canonical_discovery_origin = "https://relay.example:443".to_string();
        material.endpoint_tls_trust = Some(EndpointTlsTrust {
            trust: Some(endpoint_tls_trust::Trust::CertificateAuthorityDer(vec![
                1, 2, 3,
            ])),
        });
        assert!(verify_public_connection_material(&material, true, NOW).is_err());
    }

    #[test]
    fn public_connection_material_accepts_canonical_ipv6_origin() {
        let relay = Keypair::generate_ed25519();
        let material = PublicEndpointConnectionMaterial {
            schema_version: PUBLIC_CONNECTION_MATERIAL_SCHEMA_VERSION,
            canonical_discovery_origin: "https://[2001:db8::1]:8443".to_string(),
            expected_endpoint_role: AccessEndpointRole::Relay as i32,
            expected_endpoint_identity: relay.public().to_peer_id().to_string(),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60 * 60 * 1_000,
            ..Default::default()
        };

        assert!(verify_public_connection_material(&material, true, NOW).is_ok());
    }

    #[test]
    fn two_nodes_retain_one_logical_station_identity() {
        let root = Keypair::generate_ed25519();
        let first_node = Keypair::generate_ed25519();
        let second_node = Keypair::generate_ed25519();
        let challenge = [7_u8; STATION_IDENTITY_CHALLENGE_SIZE];

        let first = verify_station_identity_response_bytes(
            &identity_response(&root, &first_node, &challenge).encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity", "station-route"],
            NOW,
        )
        .unwrap();
        let second = verify_station_identity_response_bytes(
            &identity_response(&root, &second_node, &challenge).encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity", "station-route"],
            NOW,
        )
        .unwrap();

        assert_eq!(first.station_peer_id, second.station_peer_id);
        assert_ne!(first.node_peer_id, second.node_peer_id);
    }

    #[test]
    fn rejects_root_node_epoch_expiry_capability_relay_and_spki_forgeries() {
        let root = Keypair::generate_ed25519();
        let node = Keypair::generate_ed25519();
        let challenge = [8_u8; STATION_IDENTITY_CHALLENGE_SIZE];
        let identity = identity_response(&root, &node, &challenge);

        let mut wrong_root = identity.clone();
        wrong_root
            .node_authorization
            .as_mut()
            .unwrap()
            .station_root_public_key = Keypair::generate_ed25519().public().encode_protobuf();
        assert!(verify_station_identity_response_bytes(
            &wrong_root.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity"],
            NOW,
        )
        .is_err());

        let mut wrong_node = identity.clone();
        wrong_node.node_signature[0] ^= 0xff;
        assert!(verify_station_identity_response_bytes(
            &wrong_node.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity"],
            NOW,
        )
        .is_err());

        assert!(verify_node_authorization_bytes(
            &authorization(&root, &node, 0).encode_to_vec(),
            NOW,
        )
        .is_err());
        assert!(verify_station_identity_response_bytes(
            &identity.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity"],
            NOW + 60 * 60 * 1_000,
        )
        .is_err());
        assert!(verify_station_identity_response_bytes(
            &identity.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["not-authorized"],
            NOW,
        )
        .is_err());

        let relay = Keypair::generate_ed25519()
            .public()
            .to_peer_id()
            .to_string();
        let other_relay = Keypair::generate_ed25519()
            .public()
            .to_peer_id()
            .to_string();
        let route = route_attestation(&root, &node, &relay);
        assert!(verify_station_route_attestation_bytes(
            &route.encode_to_vec(),
            Some(&other_relay),
            NOW,
        )
        .is_err());
        let mut wrong_address_identity = route.clone();
        let mut statement =
            StationRouteStatement::decode(wrong_address_identity.statement_bytes.as_slice())
                .unwrap();
        statement.addresses = vec![format!(
            "/ip4/127.0.0.1/tcp/4001/p2p/{}/p2p-circuit/p2p/{}",
            other_relay,
            node.public().to_peer_id()
        )];
        wrong_address_identity.statement_bytes = statement.encode_to_vec();
        assert!(verify_station_route_attestation_bytes(
            &wrong_address_identity.encode_to_vec(),
            Some(&relay),
            NOW,
        )
        .is_err());
        let mut wrong_spki = route.clone();
        let mut statement =
            StationRouteStatement::decode(wrong_spki.statement_bytes.as_slice()).unwrap();
        statement.inner_tls_spki_sha256[0] ^= 0xff;
        wrong_spki.statement_bytes = statement.encode_to_vec();
        assert!(verify_station_route_attestation_bytes(
            &wrong_spki.encode_to_vec(),
            Some(&relay),
            NOW,
        )
        .is_err());
    }

    #[test]
    fn direct_route_binds_node_multiaddr_and_tls_spki_without_relay_identity() {
        let root = Keypair::generate_ed25519();
        let node = Keypair::generate_ed25519();
        let route = direct_route_attestation(&root, &node);

        let verified =
            verify_station_route_attestation_bytes(&route.encode_to_vec(), None, NOW).unwrap();
        assert_eq!(verified.relay_peer_id, None);
        assert_eq!(verified.inner_tls_spki_sha256, [7; 32]);
        assert!(verified.addresses[0].ends_with(&format!("/p2p/{}", verified.node_peer_id)));
        assert!(verify_station_route_attestation_bytes(
            &route.encode_to_vec(),
            Some("unexpected-relay"),
            NOW,
        )
        .is_err());
    }
}
