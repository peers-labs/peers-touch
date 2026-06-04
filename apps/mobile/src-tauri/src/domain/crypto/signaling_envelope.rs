use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

const EPH_PUB_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const GCM_TAG_LEN: usize = 16;
const ENVELOPE_HEADER_LEN: usize = EPH_PUB_LEN + NONCE_LEN;
const HKDF_INFO: &[u8] = b"peers-touch:signaling:v1";

pub fn seal(
    self_x_priv: &StaticSecret,
    self_x_pub: &PublicKey,
    peer_x_pub: &PublicKey,
    session_ulid: &str,
    kind: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>, String> {
    if session_ulid.is_empty() {
        return Err("session_ulid must not be empty".into());
    }
    if kind.is_empty() {
        return Err("kind must not be empty".into());
    }

    let eph_priv = StaticSecret::random_from_rng(OsRng);
    let eph_pub = PublicKey::from(&eph_priv);
    let mut shared_eph = dh(&eph_priv, peer_x_pub);
    let mut shared_lt = dh(self_x_priv, peer_x_pub);
    let mut key = derive_key(
        &shared_eph,
        &shared_lt,
        eph_pub.as_bytes(),
        self_x_pub.as_bytes(),
    );
    shared_eph.zeroize();
    shared_lt.zeroize();

    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let aad = aad_for(session_ulid, kind);
    let ct_with_tag = aes_gcm_encrypt(&key, &nonce, plaintext, &aad)?;
    key.zeroize();

    let mut out = Vec::with_capacity(ENVELOPE_HEADER_LEN + ct_with_tag.len());
    out.extend_from_slice(eph_pub.as_bytes());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct_with_tag);
    Ok(out)
}

pub fn open(
    self_x_priv: &StaticSecret,
    sender_x_pub: &PublicKey,
    session_ulid: &str,
    kind: &str,
    sealed: &[u8],
) -> Result<Vec<u8>, String> {
    if sealed.len() < ENVELOPE_HEADER_LEN + GCM_TAG_LEN {
        return Err(format!(
            "signaling envelope truncated: {} bytes < {} minimum",
            sealed.len(),
            ENVELOPE_HEADER_LEN + GCM_TAG_LEN
        ));
    }

    let mut eph_pub_bytes = [0u8; EPH_PUB_LEN];
    eph_pub_bytes.copy_from_slice(&sealed[..EPH_PUB_LEN]);
    let eph_pub = PublicKey::from(eph_pub_bytes);

    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&sealed[EPH_PUB_LEN..ENVELOPE_HEADER_LEN]);
    let ct_with_tag = &sealed[ENVELOPE_HEADER_LEN..];

    let mut shared_eph = dh(self_x_priv, &eph_pub);
    let mut shared_lt = dh(self_x_priv, sender_x_pub);
    let mut key = derive_key(
        &shared_eph,
        &shared_lt,
        eph_pub.as_bytes(),
        sender_x_pub.as_bytes(),
    );
    shared_eph.zeroize();
    shared_lt.zeroize();

    let aad = aad_for(session_ulid, kind);
    let result = aes_gcm_decrypt(&key, &nonce, ct_with_tag, &aad);
    key.zeroize();
    result
}

fn aad_for(session_ulid: &str, kind: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(13 + session_ulid.len() + 1 + kind.len());
    aad.extend_from_slice(b"signaling:v1|");
    aad.extend_from_slice(session_ulid.as_bytes());
    aad.push(b'|');
    aad.extend_from_slice(kind.as_bytes());
    aad
}

fn derive_key(
    shared_eph: &[u8; 32],
    shared_lt: &[u8; 32],
    eph_pub: &[u8; 32],
    sender_pub: &[u8; 32],
) -> [u8; 32] {
    let mut ikm = [0u8; 64];
    ikm[..32].copy_from_slice(shared_eph);
    ikm[32..].copy_from_slice(shared_lt);
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(eph_pub);
    salt[32..].copy_from_slice(sender_pub);

    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut key = [0u8; 32];
    hk.expand(HKDF_INFO, &mut key)
        .expect("HKDF expand for signaling envelope key");
    ikm.zeroize();
    salt.zeroize();
    key
}

fn aes_gcm_encrypt(
    key: &[u8; 32],
    nonce: &[u8; 12],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|error| error.to_string())?;
    cipher
        .encrypt(
            Nonce::from_slice(nonce.as_slice()),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|error| error.to_string())
}

fn aes_gcm_decrypt(
    key: &[u8; 32],
    nonce: &[u8; 12],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|error| error.to_string())?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce.as_slice()),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|error| error.to_string())
}

fn dh(secret: &StaticSecret, peer: &PublicKey) -> [u8; 32] {
    secret.diffie_hellman(peer).to_bytes()
}
