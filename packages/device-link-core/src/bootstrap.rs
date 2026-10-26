//! Native-only retrieval: fixed HTTPS paths, fresh endpoint challenge, bounded
//! reads and pinned DNS addresses. No QR key or locator enters renderer state.
use crate::{
    canonical, crypto,
    offer::{self, VerifiedOffer},
    proto::{DeviceLinkLocator, SignedDeviceLinkOffer},
    Error,
};
use prost::Message;
use rand::RngCore;
use reqwest::blocking::{Client, Response};
use station_trust::{
    bootstrap::{
        source_statement, verify_retrieval_discovery, verify_retrieved_blob, MAX_BLOB_BYTES,
        RETRIEVAL_PATH,
    },
    endpoint_tls_client_config,
    proto::{
        AccessEndpointRequest, AccessEndpointRole, AccessEndpointSourceProof,
        RetrieveBootstrapBlobRequest,
    },
    transport_identity::TransportIdentityScope,
    verify_public_connection_material,
};
use std::{
    io::Read,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    sync::mpsc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MEDIA: &str = "application/protobuf";
const SOURCE_DOMAIN: &[u8] = b"peers-touch/access-endpoint-source-proof/v1\0";
const MAX_RESPONSE: usize = MAX_BLOB_BYTES + 4096;

pub fn unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

/// Signing uses the same persisted endpoint scope as later grant redemption.
pub fn retrieve<F>(locator: &DeviceLinkLocator, sign: F) -> Result<VerifiedOffer, Error>
where
    F: FnOnce(&TransportIdentityScope, &[u8]) -> Result<(Vec<u8>, Vec<u8>), Error>,
{
    let deadline = Instant::now() + Duration::from_secs(15);
    let now = unix_ms();
    if locator.protocol_version != 1
        || locator.locator.len() != 32
        || locator.unsealing_key.len() != 32
        || locator.offer_digest.len() != 32
        || locator.desktop_hpke_public_key.len() != 32
        || locator.expires_at_unix_ms <= now
        || locator.expires_at_unix_ms
            > now.saturating_add(crate::MAX_OFFER_MS + station_trust::CLOCK_SKEW_MS)
    {
        return Err(Error("invalidLocator"));
    }
    let material = locator
        .retrieval_endpoint
        .as_ref()
        .ok_or(Error("missingRetrievalEndpoint"))?;
    let endpoint = verify_public_connection_material(material, true, now)
        .map_err(|_| Error("invalidRetrievalEndpoint"))?;
    if !endpoint.canonical_discovery_origin.starts_with("https://")
        || (endpoint.expected_endpoint_role == AccessEndpointRole::DirectStation
            && (endpoint.expected_endpoint_identity != locator.station_peer_id
                || endpoint.station_root_public_key.as_deref()
                    != Some(locator.station_root_public_key.as_slice())))
    {
        return Err(Error("stationRootMismatch"));
    }
    let root = libp2p_identity::PublicKey::try_decode_protobuf(&locator.station_root_public_key)
        .map_err(|_| Error("stationRootMismatch"))?;
    if root.to_peer_id().to_string() != locator.station_peer_id {
        return Err(Error("stationRootMismatch"));
    }
    let origin = reqwest::Url::parse(&endpoint.canonical_discovery_origin)
        .map_err(|_| Error("invalidRetrievalEndpoint"))?;
    let host = origin
        .host_str()
        .ok_or(Error("invalidRetrievalEndpoint"))?
        .trim_matches(['[', ']'])
        .to_string();
    let addresses = resolve(
        &host,
        origin
            .port_or_known_default()
            .ok_or(Error("invalidRetrievalEndpoint"))?,
    )?;
    let mut builder = Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(&host, &addresses);
    if let Some(config) =
        endpoint_tls_client_config(&endpoint.tls_trust).map_err(|_| Error("invalidRetrievalTls"))?
    {
        builder = builder.use_preconfigured_tls(config);
    }
    let client = builder.build().map_err(|_| Error("retrievalUnavailable"))?;
    let mut challenge = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut challenge);
    let discovery = AccessEndpointRequest {
        challenge: challenge.to_vec(),
        client_protocol_version: 1,
        ..Default::default()
    };
    let fresh = post(
        &client,
        &endpoint.canonical_discovery_origin,
        "/.well-known/peers-touch/access",
        &discovery,
        deadline,
    )?;
    verify_retrieval_discovery(&fresh, &challenge, &endpoint, unix_ms())
        .map_err(|_| Error("retrievalIdentityMismatch"))?;
    if locator.expires_at_unix_ms <= unix_ms() {
        return Err(Error("offerExpired"));
    }
    let statement = source_statement(
        &locator.locator,
        &endpoint.expected_endpoint_identity,
        &challenge,
    )
    .map_err(|_| Error("invalidLocator"))?;
    let statement_bytes = statement.encode_to_vec();
    let scope = match endpoint.expected_endpoint_role {
        AccessEndpointRole::DirectStation => {
            TransportIdentityScope::DirectStation(locator.station_peer_id.clone())
        }
        AccessEndpointRole::Relay => {
            TransportIdentityScope::Relay(endpoint.expected_endpoint_identity.clone())
        }
        _ => return Err(Error("invalidRetrievalEndpoint")),
    };
    let (source_public_key, source_signature) =
        sign(&scope, &[SOURCE_DOMAIN, &statement_bytes].concat())?;
    let request = RetrieveBootstrapBlobRequest {
        locator: locator.locator.clone(),
        source_proof: Some(AccessEndpointSourceProof {
            statement_bytes,
            source_public_key,
            source_signature,
        }),
    };
    let response = post(
        &client,
        &endpoint.canonical_discovery_origin,
        RETRIEVAL_PATH,
        &request,
        deadline,
    )?;
    let sealed = verify_retrieved_blob(
        &response,
        &locator.locator,
        &locator.station_peer_id,
        &locator.station_root_public_key,
        &endpoint,
        unix_ms(),
    )
    .map_err(|_| Error("invalidBootstrapBlob"))?;
    let bytes = crypto::unseal_offer(&locator.unsealing_key, &locator.offer_digest, &sealed)?;
    let signed: SignedDeviceLinkOffer = canonical(&bytes)?;
    let offer = offer::verify(
        &signed,
        &locator.station_peer_id,
        &locator.station_root_public_key,
        unix_ms(),
    )?;
    if offer.digest.as_slice() != locator.offer_digest
        || offer.statement.desktop_hpke_public_key != locator.desktop_hpke_public_key
        || offer.statement.expires_at_unix_ms != locator.expires_at_unix_ms
    {
        return Err(Error("offerDigestMismatch"));
    }
    Ok(offer)
}

fn post<M: Message>(
    client: &Client,
    origin: &str,
    path: &'static str,
    request: &M,
    deadline: Instant,
) -> Result<Vec<u8>, Error> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(Error("retrievalUnavailable"));
    }
    let response = client
        .post(format!("{origin}{path}"))
        .timeout(remaining.min(Duration::from_secs(5)))
        .header("Accept", MEDIA)
        .header("Content-Type", MEDIA)
        .body(request.encode_to_vec())
        .send()
        .map_err(|_| Error("retrievalUnavailable"))?;
    read(response)
}

fn read(response: Response) -> Result<Vec<u8>, Error> {
    if !response.status().is_success()
        || response
            .headers()
            .get("Content-Type")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.split(';').next())
            .map(str::trim)
            != Some(MEDIA)
        || response
            .content_length()
            .is_some_and(|n| n > MAX_RESPONSE as u64)
    {
        return Err(Error("invalidRetrievalResponse"));
    }
    let mut bytes = Vec::new();
    response
        .take((MAX_RESPONSE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| Error("retrievalUnavailable"))?;
    if bytes.len() > MAX_RESPONSE {
        return Err(Error("invalidSize"));
    }
    Ok(bytes)
}

fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, Error> {
    let host = host.to_string();
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("device-link-dns".into())
        .spawn(move || {
            let result = (host.as_str(), port)
                .to_socket_addrs()
                .map(|addresses| addresses.take(17).collect::<Vec<_>>());
            let _ = sender.send(result);
        })
        .map_err(|_| Error("retrievalUnavailable"))?;
    let addresses = receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| Error("retrievalUnavailable"))?
        .map_err(|_| Error("retrievalUnavailable"))?;
    if addresses.is_empty()
        || addresses.len() > 16
        || addresses.iter().any(|a| !allowed_address(a.ip()))
    {
        return Err(Error("retrievalAddressForbidden"));
    }
    Ok(addresses)
}

fn allowed_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 224
                && ip.octets() != [100, 100, 100, 200]
        }
        IpAddr::V6(ip) => {
            if let Some(ip) = ip.to_ipv4_mapped() {
                return allowed_address(IpAddr::V4(ip));
            }
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && ip.segments()[0] & 0xffc0 != 0xfe80
                && ip != "fd00:ec2::254".parse::<std::net::Ipv6Addr>().unwrap()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_lan_is_allowed_but_loopback_metadata_and_mapped_bypasses_are_rejected() {
        for ip in ["192.168.1.10", "10.0.0.5", "fc00::5", "1.1.1.1"] {
            assert!(allowed_address(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "127.0.0.2",
            "::1",
            "::",
            "0.1.2.3",
            "169.254.169.254",
            "100.100.100.200",
            "fd00:ec2::254",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
        ] {
            assert!(!allowed_address(ip.parse().unwrap()), "{ip}");
        }
    }
}
