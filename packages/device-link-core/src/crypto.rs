use crate::{proto::DeviceLinkHpkeEnvelope, Error, PROTOCOL_VERSION};
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit,
};
use hpke_rs::{
    hpke_types::{AeadAlgorithm, KdfAlgorithm, KemAlgorithm},
    rustcrypto::HpkeRustCrypto,
    Hpke, HpkePrivateKey, HpkePublicKey, Mode,
};
use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroizing;

const HPKE_INFO: &[u8] = b"peers-touch/device-link/hpke/v1\0";
const SEALED_MAGIC: &[u8] = b"PTSO1\0";
const SEALED_DOMAIN: &[u8] = b"peers-touch/device-link/sealed-offer/v1\0";

/// No Debug/Serialize/Clone implementation: the Host alone persists these bytes.
pub struct ReceiverKey {
    private: Zeroizing<[u8; 32]>,
    public: [u8; 32],
}
impl ReceiverKey {
    pub fn generate() -> Self {
        Self::from_private(x25519_dalek::StaticSecret::random_from_rng(OsRng).to_bytes())
    }
    pub fn from_private(private: [u8; 32]) -> Self {
        let secret = x25519_dalek::StaticSecret::from(private);
        Self {
            public: x25519_dalek::PublicKey::from(&secret).to_bytes(),
            private: Zeroizing::new(private),
        }
    }
    pub fn public(&self) -> &[u8; 32] {
        &self.public
    }
    pub fn private_for_secure_storage(&self) -> &[u8; 32] {
        &self.private
    }
}

pub fn suite() -> Hpke<HpkeRustCrypto> {
    Hpke::new(
        Mode::Base,
        KemAlgorithm::DhKem25519,
        KdfAlgorithm::HkdfSha256,
        AeadAlgorithm::ChaCha20Poly1305,
    )
}

pub fn seal(
    public_key: &[u8],
    transcript: &[u8],
    plaintext: &[u8],
) -> Result<DeviceLinkHpkeEnvelope, Error> {
    if public_key.len() != 32
        || public_key.iter().all(|b| *b == 0)
        || transcript.is_empty()
        || transcript.len() > 4096
        || plaintext.is_empty()
        || plaintext.len() > crate::MAX_PROTOCOL_BYTES - 4096
    {
        return Err(Error("invalidMaterial"));
    }
    let (encapsulated_key, ciphertext) = suite()
        .seal(
            &HpkePublicKey::from(public_key),
            HPKE_INFO,
            transcript,
            plaintext,
            None,
            None,
            None,
        )
        .map_err(|_| Error("encryptionFailed"))?;
    Ok(DeviceLinkHpkeEnvelope {
        protocol_version: PROTOCOL_VERSION,
        encapsulated_key,
        ciphertext,
        transcript_bytes: transcript.to_vec(),
    })
}

/// Caller must first authenticate the exact expected transcript with its owner.
pub fn open(
    receiver: &ReceiverKey,
    envelope: &DeviceLinkHpkeEnvelope,
    expected_transcript: &[u8],
) -> Result<Zeroizing<Vec<u8>>, Error> {
    if envelope.protocol_version != PROTOCOL_VERSION
        || envelope.encapsulated_key.len() != 32
        || envelope.ciphertext.len() < 16
        || envelope.ciphertext.len() > crate::MAX_PROTOCOL_BYTES
        || expected_transcript.is_empty()
        || expected_transcript.len() > 4096
        || envelope.transcript_bytes != expected_transcript
    {
        return Err(Error("transcriptMismatch"));
    }
    suite()
        .open(
            &envelope.encapsulated_key,
            &HpkePrivateKey::from(receiver.private.as_slice()),
            HPKE_INFO,
            expected_transcript,
            &envelope.ciphertext,
            None,
            None,
            None,
        )
        .map(Zeroizing::new)
        .map_err(|_| Error("decryptionFailed"))
}

/// PTSO1 NUL || 12-byte nonce || ChaCha20Poly1305 ciphertext/tag.
/// A fresh random 32-byte QR key is used for each immutable offer.
pub fn seal_offer(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, Error> {
    if plaintext.is_empty() || plaintext.len() > station_trust::bootstrap::MAX_BLOB_BYTES - 34 {
        return Err(Error("offerTooLarge"));
    }
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let aad = sealed_aad(&crate::digest(plaintext));
    let ciphertext = ChaCha20Poly1305::new(key.into())
        .encrypt(
            (&nonce).into(),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| Error("encryptionFailed"))?;
    let mut result = Vec::with_capacity(18 + ciphertext.len());
    result.extend_from_slice(SEALED_MAGIC);
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    if result.len() > station_trust::bootstrap::MAX_BLOB_BYTES {
        return Err(Error("offerTooLarge"));
    }
    Ok(result)
}

pub fn unseal_offer(
    key: &[u8],
    expected_digest: &[u8],
    blob: &[u8],
) -> Result<Zeroizing<Vec<u8>>, Error> {
    if key.len() != 32
        || expected_digest.len() != 32
        || blob.len() < 34
        || blob.len() > station_trust::bootstrap::MAX_BLOB_BYTES
        || !blob.starts_with(SEALED_MAGIC)
    {
        return Err(Error("invalidSealedOffer"));
    }
    let aad = sealed_aad(expected_digest);
    let plaintext = Zeroizing::new(
        ChaCha20Poly1305::new_from_slice(key)
            .map_err(|_| Error("invalidSealedOffer"))?
            .decrypt(
                (&blob[6..18]).into(),
                Payload {
                    msg: &blob[18..],
                    aad: &aad,
                },
            )
            .map_err(|_| Error("decryptionFailed"))?,
    );
    if crate::digest(&plaintext).as_slice() != expected_digest {
        return Err(Error("offerDigestMismatch"));
    }
    Ok(plaintext)
}

fn sealed_aad(offer_digest: &[u8]) -> Vec<u8> {
    [SEALED_DOMAIN, offer_digest].concat()
}
