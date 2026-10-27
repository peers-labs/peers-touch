//! Compact bootstrap context; PeerID and endpoint trust retain their owners.
use crate::{digest, proto::DeviceLinkLocator, Error, MAX_OFFER_MS};
use hkdf::Hkdf;
use prost::Message;
use sha2::Sha256;
use station_trust::proto::{AccessEndpointRole, PublicEndpointConnectionMaterial};
use zeroize::Zeroizing;

pub struct Reference {
    pub station_peer_id: String,
    pub station_root: Vec<u8>,
    pub endpoint: PublicEndpointConnectionMaterial,
    pub lookup: Zeroizing<[u8; 32]>,
    pub unseal: Zeroizing<[u8; 32]>,
}

fn public(raw: &[u8]) -> Result<libp2p_identity::PublicKey, Error> {
    if raw.len() != 32 || raw.iter().all(|byte| *byte == 0) {
        return Err(Error("stationRootMismatch"));
    }
    let key = libp2p_identity::ed25519::PublicKey::try_from_bytes(raw)
        .map_err(|_| Error("stationRootMismatch"))?;
    Ok(key.into())
}

pub fn derive(locator: &DeviceLinkLocator) -> Result<Reference, Error> {
    if locator.protocol_version != 1
        || locator.bootstrap_secret.len() != 32
        || locator.offer_digest.len() != 32
        || locator.station_root_ed25519.len() != 32
        || locator.canonical_discovery_origin.is_empty()
        || locator.expires_at_unix_ms <= MAX_OFFER_MS
    {
        return Err(Error("invalidLocator"));
    }
    let root = public(&locator.station_root_ed25519)?;
    let station_peer_id = root.to_peer_id().to_string();
    let role = AccessEndpointRole::try_from(locator.endpoint_role)
        .map_err(|_| Error("invalidRetrievalEndpoint"))?;
    let endpoint_id = match role {
        AccessEndpointRole::DirectStation if locator.relay_ed25519.is_empty() => {
            station_peer_id.clone()
        }
        AccessEndpointRole::Relay => {
            if locator.relay_ed25519 == locator.station_root_ed25519 {
                return Err(Error("invalidRetrievalEndpoint"));
            }
            public(&locator.relay_ed25519)?.to_peer_id().to_string()
        }
        _ => return Err(Error("invalidRetrievalEndpoint")),
    };
    let station_root = root.encode_protobuf();
    let endpoint = PublicEndpointConnectionMaterial {
        schema_version: 1,
        canonical_discovery_origin: locator.canonical_discovery_origin.clone(),
        expected_endpoint_role: role as i32,
        expected_endpoint_identity: endpoint_id,
        expected_station_root_public_key: if role == AccessEndpointRole::DirectStation {
            station_root.clone()
        } else {
            Vec::new()
        },
        endpoint_tls_trust: locator.endpoint_tls_trust.clone(),
        issued_at_unix_ms: locator.expires_at_unix_ms - MAX_OFFER_MS,
        expires_at_unix_ms: locator.expires_at_unix_ms,
    };
    let mut context = locator.clone();
    context.bootstrap_secret.clear();
    let salt = digest(
        &[
            b"peers-touch/device-link/bootstrap-context/v1\0".as_slice(),
            &context.encode_to_vec(),
        ]
        .concat(),
    );
    let kdf = Hkdf::<Sha256>::new(Some(&salt), &locator.bootstrap_secret);
    let expand = |purpose: &str| -> Result<Zeroizing<[u8; 32]>, Error> {
        let mut output = Zeroizing::new([0; 32]);
        let info = format!("peers-touch/device-link/bootstrap/{purpose}/v1\0");
        kdf.expand(info.as_bytes(), output.as_mut())
            .map_err(|_| Error("invalidLocator"))?;
        Ok(output)
    };
    Ok(Reference {
        station_peer_id,
        station_root,
        endpoint,
        lookup: expand("lookup")?,
        unseal: expand("unseal")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use station_trust::verify_public_connection_material;

    fn fixed(value: u8) -> [u8; 32] {
        [value; 32]
    }
    fn public_key(seed: u8) -> [u8; 32] {
        ed25519_dalek::SigningKey::from_bytes(&[seed; 32])
            .verifying_key()
            .to_bytes()
    }

    fn reference() -> DeviceLinkLocator {
        DeviceLinkLocator {
            protocol_version: 1,
            offer_digest: fixed(1).to_vec(),
            expires_at_unix_ms: 1_800_000_300_000,
            station_root_ed25519: public_key(2).to_vec(),
            bootstrap_secret: fixed(3).to_vec(),
            canonical_discovery_origin: "https://station.example".into(),
            endpoint_role: AccessEndpointRole::DirectStation as i32,
            relay_ed25519: Vec::new(),
            endpoint_tls_trust: None,
        }
    }

    #[test]
    fn derives_canonical_peer_endpoint_and_cross_language_hkdf_vector() {
        let derived = derive(&reference()).unwrap();
        assert_eq!(
            hex::encode(&*derived.lookup),
            "d5d5d38c804904ae70ab3ff7e808e7586e68b598c22a0a2fe634e94fea5f7f65"
        );
        assert_eq!(
            hex::encode(&*derived.unseal),
            "611c8b8de6a70a075018a5a2396e23c14a662e41374857dde35437dfb93358de"
        );
        assert_ne!(derived.lookup.as_slice(), derived.unseal.as_slice());
        let station = public(&public_key(2)).unwrap().to_peer_id().to_string();
        assert_eq!(derived.station_peer_id, station);
        assert_eq!(derived.endpoint.expected_endpoint_identity, station);
        assert_eq!(
            derived.endpoint.expected_station_root_public_key,
            derived.station_root
        );
        let verified = verify_public_connection_material(
            &derived.endpoint,
            true,
            derived.endpoint.issued_at_unix_ms,
        )
        .unwrap();
        assert_eq!(
            verified.canonical_discovery_origin,
            "https://station.example"
        );
    }

    #[test]
    fn every_reference_context_field_binds_derived_keys() {
        let baseline = derive(&reference()).unwrap();
        let mut changed = reference();
        changed.offer_digest[0] = 9;
        let candidate = derive(&changed).unwrap();
        assert_ne!(candidate.lookup.as_slice(), baseline.lookup.as_slice());
        assert_ne!(candidate.unseal.as_slice(), baseline.unseal.as_slice());

        for mutate in [
            |value: &mut DeviceLinkLocator| value.station_root_ed25519 = public_key(9).to_vec(),
            |value: &mut DeviceLinkLocator| value.bootstrap_secret[0] = 9,
            |value: &mut DeviceLinkLocator| {
                value.canonical_discovery_origin = "https://relay.example".into()
            },
            |value: &mut DeviceLinkLocator| value.expires_at_unix_ms += 1,
        ] {
            let mut changed = reference();
            mutate(&mut changed);
            let candidate = derive(&changed).unwrap();
            assert_ne!(candidate.lookup.as_slice(), baseline.lookup.as_slice());
            assert_ne!(candidate.unseal.as_slice(), baseline.unseal.as_slice());
        }
    }

    #[test]
    fn direct_and_relay_keys_remain_distinct_and_role_scoped() {
        let relay = DeviceLinkLocator {
            endpoint_role: AccessEndpointRole::Relay as i32,
            relay_ed25519: public_key(2).to_vec(),
            ..reference()
        };
        assert!(derive(&relay).is_err());

        let relay = DeviceLinkLocator {
            endpoint_role: AccessEndpointRole::Relay as i32,
            relay_ed25519: public_key(4).to_vec(),
            ..reference()
        };
        let derived = derive(&relay).unwrap();
        assert_eq!(
            derived.endpoint.expected_endpoint_identity,
            public(&public_key(4)).unwrap().to_peer_id().to_string()
        );
        assert!(derived.endpoint.expected_station_root_public_key.is_empty());

        let direct = DeviceLinkLocator {
            relay_ed25519: public_key(4).to_vec(),
            ..reference()
        };
        assert!(derive(&direct).is_err());
    }
}
