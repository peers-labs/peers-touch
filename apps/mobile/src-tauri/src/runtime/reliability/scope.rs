use sha2::{Digest, Sha256};

use super::codec::Encoder;
use super::error::{ReliabilityError, ReliabilityResult};

pub const RELIABILITY_SCHEMA_REVISION: u32 = 2;
const MAX_SCOPE_COMPONENT_BYTES: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ExactScope {
    station_peer_id: String,
    actor_ptid: String,
}

impl ExactScope {
    pub fn new(
        station_peer_id: impl Into<String>,
        actor_ptid: impl Into<String>,
    ) -> ReliabilityResult<Self> {
        let scope = Self {
            station_peer_id: station_peer_id.into(),
            actor_ptid: actor_ptid.into(),
        };
        validate_component("station_peer_id", &scope.station_peer_id)?;
        validate_component("actor_ptid", &scope.actor_ptid)?;
        Ok(scope)
    }

    pub fn station_peer_id(&self) -> &str {
        &self.station_peer_id
    }

    pub fn actor_ptid(&self) -> &str {
        &self.actor_ptid
    }

    pub(crate) fn stable_token(&self) -> String {
        let digest = Sha256::digest(self.canonical_bytes());
        let mut token = String::with_capacity(digest.len() * 2);
        for byte in digest {
            use std::fmt::Write;
            write!(&mut token, "{byte:02x}").expect("writing to String cannot fail");
        }
        token
    }

    pub(crate) fn canonical_bytes(&self) -> Vec<u8> {
        let mut encoder = Encoder::new(b"PTRS");
        encoder
            .string(&self.station_peer_id)
            .expect("validated Station peer ID fits the canonical encoding");
        encoder
            .string(&self.actor_ptid)
            .expect("validated PTID fits the canonical encoding");
        encoder.finish()
    }
}

pub(crate) fn authenticated_context(
    domain: &[u8],
    kek_id: &[u8; 16],
    install_epoch: &[u8; 32],
    scope: &ExactScope,
    schema_revision: u32,
    extra_fields: &[&[u8]],
) -> ReliabilityResult<Vec<u8>> {
    let mut encoder = Encoder::new(b"PTRA");
    encoder.bytes(domain)?;
    encoder.fixed(kek_id);
    encoder.fixed(install_epoch);
    encoder.u32(schema_revision);
    encoder.string(scope.station_peer_id())?;
    encoder.string(scope.actor_ptid())?;
    for field in extra_fields {
        encoder.bytes(field)?;
    }
    Ok(encoder.finish())
}

fn validate_component(name: &str, value: &str) -> ReliabilityResult<()> {
    if value.is_empty()
        || value.trim() != value
        || value.as_bytes().contains(&0)
        || value.len() > MAX_SCOPE_COMPONENT_BYTES
    {
        return Err(ReliabilityError::invalid(format!(
            "{name} is not a canonical exact-scope component"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_scope_rejects_non_canonical_components() {
        assert!(ExactScope::new("", "ptid").is_err());
        assert!(ExactScope::new(" peer", "ptid").is_err());
        assert!(ExactScope::new("peer", "ptid\0suffix").is_err());
    }

    #[test]
    fn stable_token_is_exact_scope_sensitive() {
        let first = ExactScope::new("station-a", "ptid-a").unwrap();
        let second = ExactScope::new("station-a", "ptid-b").unwrap();
        assert_ne!(first.stable_token(), second.stable_token());
        assert_eq!(first.stable_token().len(), 64);
    }
}
