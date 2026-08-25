use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256, Sha512};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use zeroize::Zeroize;

#[derive(Clone)]
pub struct IdentityKeyPair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

impl Drop for IdentityKeyPair {
    fn drop(&mut self) {
        let mut zeros = [0u8; 32];
        self.signing_key = SigningKey::from_bytes(&zeros);
        zeros.zeroize();
    }
}

impl IdentityKeyPair {
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
        }
    }

    pub fn from_seed(seed: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(seed);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
        }
    }

    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    pub fn verifying_key(&self) -> &VerifyingKey {
        &self.verifying_key
    }

    pub fn seed_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    pub fn sign(&self, msg: &[u8]) -> Signature {
        self.signing_key.sign(msg)
    }

    pub fn to_x25519_secret(&self) -> StaticSecret {
        let seed = self.signing_key.to_bytes();
        let digest = Sha512::digest(seed);
        let mut scalar = [0u8; 32];
        scalar.copy_from_slice(&digest[..32]);
        scalar[0] &= 248;
        scalar[31] &= 127;
        scalar[31] |= 64;
        StaticSecret::from(scalar)
    }

    pub fn to_x25519_public(&self) -> X25519Public {
        X25519Public::from(&self.to_x25519_secret())
    }
}

#[derive(Clone)]
pub struct DeviceSigningKey {
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
    cross_signature: Signature,
    device_id: String,
}

impl Drop for DeviceSigningKey {
    fn drop(&mut self) {
        let mut zeros = [0u8; 32];
        self.signing_key = SigningKey::from_bytes(&zeros);
        zeros.zeroize();
    }
}

impl DeviceSigningKey {
    pub fn generate_cross_signed<F>(
        ik: &IdentityKeyPair,
        device_id: &str,
        certificate_bytes: F,
    ) -> Self
    where
        F: FnOnce(&VerifyingKey) -> Vec<u8>,
    {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let cross_signature = ik.sign(&certificate_bytes(&verifying_key));
        Self {
            signing_key,
            verifying_key,
            cross_signature,
            device_id: device_id.to_string(),
        }
    }

    pub fn from_parts(seed: &[u8; 32], cross_signature: Signature, device_id: String) -> Self {
        let signing_key = SigningKey::from_bytes(seed);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
            cross_signature,
            device_id,
        }
    }

    pub fn verifying_key(&self) -> &VerifyingKey {
        &self.verifying_key
    }

    pub fn seed_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    pub fn cross_signature(&self) -> &Signature {
        &self.cross_signature
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn sign(&self, msg: &[u8]) -> Signature {
        self.signing_key.sign(msg)
    }

    pub fn verify_cross_signature(
        &self,
        ik_verifying: &VerifyingKey,
        certificate_bytes: &[u8],
    ) -> Result<(), String> {
        ik_verifying
            .verify(certificate_bytes, &self.cross_signature)
            .map_err(|e| format!("signature verification failed: {e}"))
    }
}

pub struct X25519KeyPair {
    pub private: StaticSecret,
    pub public: X25519Public,
}

impl X25519KeyPair {
    pub fn generate() -> Self {
        let private = StaticSecret::random_from_rng(OsRng);
        let public = X25519Public::from(&private);
        Self { private, public }
    }

    pub fn from_private_bytes(bytes: [u8; 32]) -> Self {
        let private = StaticSecret::from(bytes);
        let public = X25519Public::from(&private);
        Self { private, public }
    }

    pub fn private(&self) -> &StaticSecret {
        &self.private
    }

    pub fn public(&self) -> &X25519Public {
        &self.public
    }

    pub fn private_bytes(&self) -> [u8; 32] {
        self.private.to_bytes()
    }

    pub fn public_bytes(&self) -> [u8; 32] {
        self.public.to_bytes()
    }
}

pub fn fingerprint_hex(verifying_key: &VerifyingKey) -> String {
    let mut h = Sha256::new();
    h.update(verifying_key.as_bytes());
    hex::encode(h.finalize())
}

pub fn fingerprint_numeric(vk_a: &VerifyingKey, vk_b: &VerifyingKey) -> String {
    let mut h = Sha256::new();
    let (first, second) = if vk_a.as_bytes() <= vk_b.as_bytes() {
        (vk_a, vk_b)
    } else {
        (vk_b, vk_a)
    };
    h.update(b"peers-touch:safety-number:v1:");
    h.update(first.as_bytes());
    h.update(second.as_bytes());
    let digest = h.finalize();

    let mut digits = String::with_capacity(72);
    for (i, chunk) in digest[..30].chunks(5).enumerate() {
        let mut val: u64 = 0;
        for &b in chunk {
            val = (val << 8) | (b as u64);
        }
        let group = format!("{:05}", val % 100000);
        if i > 0 {
            digits.push(' ');
        }
        digits.push_str(&group);
    }
    digits
}

pub fn ed25519_verifying_to_x25519_public(
    verifying_key: &VerifyingKey,
) -> Result<X25519Public, String> {
    use curve25519_dalek::edwards::CompressedEdwardsY;
    let bytes = verifying_key.to_bytes();
    let comp = CompressedEdwardsY(bytes);
    let edwards = comp
        .decompress()
        .ok_or_else(|| "cannot decompress Ed25519 point to Montgomery".to_string())?;
    let mont = edwards.to_montgomery();
    Ok(X25519Public::from(mont.to_bytes()))
}
