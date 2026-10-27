//! Shared native-only cryptography. Secrets never enter renderer projections.
pub mod bootstrap;
pub mod crypto;
pub mod material;
pub mod offer;
pub mod reference;
pub mod transcript;

pub use schema_core::proto::device_link as proto;
pub use schema_core::proto::peers_touch::model::actor::v1 as actor;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_OFFER_MS: i64 = 300_000;
pub const MAX_PROTOCOL_BYTES: usize = 64 * 1024;
pub const MAX_IDENTITY_BYTES: usize = 4096;
pub const OFFER_DOMAIN: &[u8] = b"peers-touch/device-link/offer/v1\0";
pub const APPROVAL_DOMAIN: &[u8] = b"peers-touch/device-link/approval/v1\0";
pub const CREDENTIAL_DOMAIN: &[u8] = b"peers-touch/device-link/credential/v1\0";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Error(pub &'static str);
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "deviceLink.{}", self.0)
    }
}
impl std::error::Error for Error {}

pub fn digest(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).into()
}

pub fn canonical<M: prost::Message + Default>(bytes: &[u8]) -> Result<M, Error> {
    if bytes.is_empty() || bytes.len() > MAX_PROTOCOL_BYTES {
        return Err(Error("invalidSize"));
    }
    let value = M::decode(bytes).map_err(|_| Error("invalidMessage"))?;
    if value.encode_to_vec() != bytes {
        return Err(Error("nonCanonical"));
    }
    Ok(value)
}

pub fn verify_device_signature(
    public_key: &[u8],
    domain: &[u8],
    bytes: &[u8],
    signature: &[u8],
) -> Result<(), Error> {
    let key = ed25519_dalek::VerifyingKey::from_bytes(
        public_key
            .try_into()
            .map_err(|_| Error("invalidSigningKey"))?,
    )
    .map_err(|_| Error("invalidSigningKey"))?;
    let signature =
        ed25519_dalek::Signature::from_slice(signature).map_err(|_| Error("invalidSignature"))?;
    let mut signed = Vec::with_capacity(domain.len() + bytes.len());
    signed.extend_from_slice(domain);
    signed.extend_from_slice(bytes);
    key.verify_strict(&signed, &signature)
        .map_err(|_| Error("invalidSignature"))
}
