//! Canonical, platform-independent isolation scopes for transport identities.
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum TransportIdentityScope {
    DirectStation(String),
    Relay(String),
    ProvisionalEndpointOrigin(String),
}

impl TransportIdentityScope {
    pub fn stable_id(&self) -> String {
        let (kind, value) = match self {
            Self::DirectStation(value) => ("direct-station", value),
            Self::Relay(value) => ("relay", value),
            Self::ProvisionalEndpointOrigin(value) => ("provisional-origin", value),
        };
        let mut digest = Sha256::new();
        digest.update(b"peers-touch/station-transport-identity-scope/v1\0");
        digest.update(kind.as_bytes());
        digest.update([0]);
        digest.update(value.trim().as_bytes());
        let encoded: String = digest
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        format!("{kind}:{encoded}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unrelated_endpoints_and_roles_have_distinct_stable_scopes() {
        let first = TransportIdentityScope::Relay("relay-a".into());
        assert_eq!(first.stable_id(), first.clone().stable_id());
        assert_ne!(
            first.stable_id(),
            TransportIdentityScope::Relay("relay-b".into()).stable_id()
        );
        assert_ne!(
            first.stable_id(),
            TransportIdentityScope::DirectStation("relay-a".into()).stable_id()
        );
        assert_ne!(
            first.stable_id(),
            TransportIdentityScope::ProvisionalEndpointOrigin("relay-a".into()).stable_id()
        );
    }
}
