//! Authentication for one non-recursive, opaque bootstrap document. Network
//! adapters must verify endpoint identity/TLS before transmitting the locator.
use super::{
    decode_canonical, decode_ed25519_public_key, verify_node_authorization, verify_signature,
    TrustError, VerifiedPublicEndpointConnectionMaterial, CLOCK_SKEW_MS,
};
use crate::proto::{
    AccessEndpointResponse, AccessEndpointRole, AccessEndpointSourceProofStatement,
    AccessEndpointStatement, BootstrapBlobStatement, PublishBootstrapBlobRequest,
    RetrieveBootstrapBlobResponse,
};
use sha2::{Digest, Sha256};

pub const RETRIEVAL_PATH: &str = "/.well-known/peers-touch/bootstrap";
pub const MAX_BLOB_BYTES: usize = 16 * 1024;
pub const MAX_BLOB_LIFETIME_MS: i64 = 5 * 60 * 1000;
const DOMAIN: &[u8] = b"peers-touch/bootstrap-blob/v1\0";

/// Fresh retrieval contact proves the endpoint before any locator is sent.
/// Route/grant verification remains the transport owner's separate operation.
pub fn verify_retrieval_discovery(
    bytes: &[u8],
    challenge: &[u8],
    expected: &VerifiedPublicEndpointConnectionMaterial,
    now: i64,
) -> Result<(), TrustError> {
    let response = decode_canonical::<AccessEndpointResponse>(bytes, "bootstrap_discovery")?;
    let statement = decode_canonical::<AccessEndpointStatement>(
        &response.endpoint_statement_bytes,
        "bootstrap_endpoint_statement",
    )?;
    if challenge.len() != 32
        || statement.challenge != challenge
        || statement.endpoint_role != expected.expected_endpoint_role as i32
        || statement.canonical_origin != expected.canonical_discovery_origin
        || !statement.protocol_versions.contains(&1)
        || statement.issued_at_unix_ms > now.saturating_add(CLOCK_SKEW_MS)
        || statement.expires_at_unix_ms <= now
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement
            .expires_at_unix_ms
            .saturating_sub(statement.issued_at_unix_ms)
            > MAX_BLOB_LIFETIME_MS
        || expected.expires_at_unix_ms <= now
    {
        return Err(TrustError::new("bootstrap_discovery_fields"));
    }
    let public = decode_ed25519_public_key(&response.endpoint_public_key)?;
    if public.to_peer_id().to_string() != statement.endpoint_peer_id {
        return Err(TrustError::new("bootstrap_discovery_identity"));
    }
    verify_signature(
        &public,
        b"peers-touch/access-endpoint/v1\0",
        &response.endpoint_statement_bytes,
        &response.endpoint_signature,
        "bootstrap_discovery_signature",
    )?;
    match expected.expected_endpoint_role {
        AccessEndpointRole::Relay => {
            if statement.endpoint_peer_id != expected.expected_endpoint_identity
                || response.node_authorization.is_some()
                || !statement.node_authorization_digest.is_empty()
            {
                return Err(TrustError::new("bootstrap_relay_identity"));
            }
        }
        AccessEndpointRole::DirectStation => {
            let node = verify_node_authorization(
                response
                    .node_authorization
                    .as_ref()
                    .ok_or_else(|| TrustError::new("bootstrap_authorization"))?,
                now,
            )?;
            if node.station_peer_id != expected.expected_endpoint_identity
                || Some(node.station_root_public_key.as_slice())
                    != expected.station_root_public_key.as_deref()
                || node.node_peer_id != statement.endpoint_peer_id
                || node.node_public_key != response.endpoint_public_key
                || node.authorization_digest.as_slice() != statement.node_authorization_digest
            {
                return Err(TrustError::new("bootstrap_station_identity"));
            }
        }
        AccessEndpointRole::Unspecified => return Err(TrustError::new("bootstrap_role")),
    }
    Ok(())
}

pub fn source_statement(
    locator: &[u8],
    endpoint_id: &str,
    challenge: &[u8],
) -> Result<AccessEndpointSourceProofStatement, TrustError> {
    if locator.len() != 32 || challenge.len() != 32 {
        return Err(TrustError::new("bootstrap_source_invalid"));
    }
    Ok(AccessEndpointSourceProofStatement {
        challenge: challenge.to_vec(),
        connection_grant_digest: Sha256::digest(locator).to_vec(),
        relay_peer_id: endpoint_id.to_string(),
        client_protocol_version: 1,
    })
}

pub fn verify_retrieved_blob(
    bytes: &[u8],
    locator: &[u8],
    expected_station: &str,
    expected_root: &[u8],
    endpoint: &VerifiedPublicEndpointConnectionMaterial,
    now: i64,
) -> Result<Vec<u8>, TrustError> {
    if locator.len() != 32
        || bytes.len() > MAX_BLOB_BYTES + 4096
        || endpoint.expires_at_unix_ms <= now
        || !endpoint.canonical_discovery_origin.starts_with("https://")
    {
        return Err(TrustError::new("bootstrap_endpoint_invalid"));
    }
    let response = decode_canonical::<RetrieveBootstrapBlobResponse>(bytes, "bootstrap_decode")?;
    let message = PublishBootstrapBlobRequest {
        statement_bytes: response.statement_bytes,
        sealed_blob: response.sealed_blob,
        node_signature: response.node_signature,
        node_authorization: response.node_authorization,
    };
    let statement = verify_blob(&message, now)?;
    if statement.locator_digest != Sha256::digest(locator).as_slice()
        || statement.station_peer_id != expected_station
        || statement.retrieval_endpoint_identity != endpoint.expected_endpoint_identity
        || message
            .node_authorization
            .as_ref()
            .map(|a| a.station_root_public_key.as_slice())
            != Some(expected_root)
    {
        return Err(TrustError::new("bootstrap_scope_mismatch"));
    }
    Ok(message.sealed_blob)
}

pub fn verify_blob(
    message: &PublishBootstrapBlobRequest,
    now: i64,
) -> Result<BootstrapBlobStatement, TrustError> {
    if message.sealed_blob.is_empty() || message.sealed_blob.len() > MAX_BLOB_BYTES {
        return Err(TrustError::new("bootstrap_blob_size"));
    }
    let authorization = verify_node_authorization(
        message
            .node_authorization
            .as_ref()
            .ok_or_else(|| TrustError::new("bootstrap_authorization"))?,
        now,
    )?;
    let statement = decode_canonical::<BootstrapBlobStatement>(
        &message.statement_bytes,
        "bootstrap_statement",
    )?;
    let duration = statement
        .expires_at_unix_ms
        .checked_sub(statement.issued_at_unix_ms);
    if statement.protocol_version != 1
        || statement.locator_digest.len() != 32
        || statement.blob_digest != Sha256::digest(&message.sealed_blob).as_slice()
        || statement.station_peer_id != authorization.station_peer_id
        || statement.max_sources == 0
        || statement.max_sources > 4
        || statement.issued_at_unix_ms > now.saturating_add(CLOCK_SKEW_MS)
        || statement.expires_at_unix_ms <= now
        || !duration.is_some_and(|d| d > 0 && d <= MAX_BLOB_LIFETIME_MS)
        || statement.expires_at_unix_ms > authorization.expires_at_unix_ms
        || !statement
            .retrieval_endpoint_identity
            .parse::<libp2p_identity::PeerId>()
            .is_ok_and(|id| id.to_string() == statement.retrieval_endpoint_identity)
    {
        return Err(TrustError::new("bootstrap_fields"));
    }
    verify_signature(
        &decode_ed25519_public_key(&authorization.node_public_key)?,
        DOMAIN,
        &message.statement_bytes,
        &message.node_signature,
        "bootstrap_signature",
    )?;
    Ok(statement)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        proto::*,
        tests::{authorization, sign, NOW},
        verify_public_connection_material,
    };
    use libp2p_identity::Keypair;
    use prost::Message;

    #[test]
    fn retrieval_requires_a_fresh_challenge_and_role_bound_endpoint_signature() {
        let root = Keypair::generate_ed25519();
        let node = Keypair::generate_ed25519();
        let relay = Keypair::generate_ed25519();
        let challenge = [5; 32];
        for role in [AccessEndpointRole::DirectStation, AccessEndpointRole::Relay] {
            let endpoint_key = if role == AccessEndpointRole::Relay {
                &relay
            } else {
                &node
            };
            let authority = if role == AccessEndpointRole::DirectStation {
                Some(authorization(&root, &node, 7))
            } else {
                None
            };
            let expected = verify_public_connection_material(
                &PublicEndpointConnectionMaterial {
                    schema_version: 1,
                    canonical_discovery_origin: "https://endpoint.example:443".into(),
                    expected_endpoint_role: role as i32,
                    expected_endpoint_identity: if role == AccessEndpointRole::Relay {
                        relay.public().to_peer_id().to_string()
                    } else {
                        root.public().to_peer_id().to_string()
                    },
                    expected_station_root_public_key: if role == AccessEndpointRole::DirectStation {
                        root.public().encode_protobuf()
                    } else {
                        vec![]
                    },
                    issued_at_unix_ms: NOW,
                    expires_at_unix_ms: NOW + 60_000,
                    ..Default::default()
                },
                true,
                NOW,
            )
            .unwrap();
            let authorization_digest = authority
                .as_ref()
                .map(|a| {
                    verify_node_authorization(a, NOW)
                        .unwrap()
                        .authorization_digest
                        .to_vec()
                })
                .unwrap_or_default();
            let statement = AccessEndpointStatement {
                challenge: challenge.to_vec(),
                endpoint_role: role as i32,
                endpoint_peer_id: endpoint_key.public().to_peer_id().to_string(),
                canonical_origin: expected.canonical_discovery_origin.clone(),
                protocol_versions: vec![1],
                issued_at_unix_ms: NOW,
                expires_at_unix_ms: NOW + 60_000,
                node_authorization_digest: authorization_digest,
                ..Default::default()
            };
            let statement_bytes = statement.encode_to_vec();
            let mut response = AccessEndpointResponse {
                endpoint_public_key: endpoint_key.public().encode_protobuf(),
                endpoint_signature: sign(
                    endpoint_key,
                    b"peers-touch/access-endpoint/v1\0",
                    &statement_bytes,
                ),
                endpoint_statement_bytes: statement_bytes,
                node_authorization: authority,
                ..Default::default()
            };
            assert!(verify_retrieval_discovery(
                &response.encode_to_vec(),
                &challenge,
                &expected,
                NOW
            )
            .is_ok());
            assert!(verify_retrieval_discovery(
                &response.encode_to_vec(),
                &[6; 32],
                &expected,
                NOW
            )
            .is_err());
            assert!(verify_retrieval_discovery(
                &response.encode_to_vec(),
                &challenge,
                &expected,
                NOW + 60_000
            )
            .is_err());
            response.endpoint_signature[0] ^= 1;
            assert!(verify_retrieval_discovery(
                &response.encode_to_vec(),
                &challenge,
                &expected,
                NOW
            )
            .is_err());
        }
    }

    #[test]
    fn binds_ciphertext_locator_root_and_endpoint_and_rejects_expiry() {
        let root = Keypair::generate_ed25519();
        let node = Keypair::generate_ed25519();
        let relay = Keypair::generate_ed25519();
        let locator = [7; 32];
        let sealed = vec![8; 192];
        let statement = BootstrapBlobStatement {
            protocol_version: 1,
            locator_digest: Sha256::digest(locator).to_vec(),
            blob_digest: Sha256::digest(&sealed).to_vec(),
            station_peer_id: root.public().to_peer_id().to_string(),
            retrieval_endpoint_identity: relay.public().to_peer_id().to_string(),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60_000,
            max_sources: 4,
        };
        let statement_bytes = statement.encode_to_vec();
        let response = RetrieveBootstrapBlobResponse {
            node_signature: sign(&node, DOMAIN, &statement_bytes),
            statement_bytes,
            sealed_blob: sealed.clone(),
            node_authorization: Some(authorization(&root, &node, 7)),
        };
        let endpoint = verify_public_connection_material(
            &PublicEndpointConnectionMaterial {
                schema_version: 1,
                canonical_discovery_origin: "https://relay.example:443".into(),
                expected_endpoint_role: AccessEndpointRole::Relay as i32,
                expected_endpoint_identity: relay.public().to_peer_id().to_string(),
                issued_at_unix_ms: NOW,
                expires_at_unix_ms: NOW + 60_000,
                ..Default::default()
            },
            true,
            NOW,
        )
        .unwrap();
        let verify = |r: &RetrieveBootstrapBlobResponse, l: &[u8], station: &str, time: i64| {
            verify_retrieved_blob(
                &r.encode_to_vec(),
                l,
                station,
                &root.public().encode_protobuf(),
                &endpoint,
                time,
            )
        };
        assert_eq!(
            verify(&response, &locator, &statement.station_peer_id, NOW).unwrap(),
            sealed
        );
        assert!(verify(&response, &[9; 32], &statement.station_peer_id, NOW).is_err());
        assert!(verify(&response, &locator, "different-root", NOW).is_err());
        assert!(verify(
            &response,
            &locator,
            &statement.station_peer_id,
            NOW + 60_000
        )
        .is_err());
        let mut forged = response;
        forged.sealed_blob[0] ^= 1;
        assert!(verify(&forged, &locator, &statement.station_peer_id, NOW).is_err());
    }
}
