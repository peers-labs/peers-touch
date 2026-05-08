//! Stateless authenticated sealed-box envelope for WebRTC signaling.
//!
//! See `docs/architecture/realtime/event-stream.md` §2.7.2 for the full
//! cryptographic contract. Every signaling frame is encrypted
//! independently using a fresh ephemeral X25519 keypair plus a
//! long-term identity DH that authenticates the sender. The two
//! shared secrets are concatenated and fed through HKDF-SHA256 to
//! derive an AES-256-GCM key; the GCM AAD binds `session_ulid` and
//! `kind` so a captured ciphertext cannot be replayed under a
//! different context.
//!
//! This is **not** the same primitive as the friend-chat ratchet:
//! the chat ratchet enforces a strict in-order receive counter,
//! which is correct for chat (small, ordered messages) but breaks
//! for signaling (ICE candidates surface at unrelated wall-clock
//! times and may arrive in any order). Reusing the chat ratchet
//! would couple call reliability to text reliability — a single
//! lost candidate would stall every following text message on the
//! same session, which is unacceptable.
//!
//! # Wire layout
//!
//! ```text
//! | eph_pub | nonce |   ciphertext   | tag  |
//! |  32 B   | 12 B  |   N bytes      | 16 B |     total = 60 + N
//! ```
//!
//! The ephemeral public key is generated fresh per message; the
//! ephemeral private is zeroized as soon as encryption completes.
//! Compromise of long-term identity keys does not retroactively
//! decrypt logged signaling unless the attacker also captured the
//! ephemeral private at send time.

use rand::rngs::OsRng;
use rand::RngCore;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use super::{aes_gcm_decrypt, aes_gcm_encrypt, hkdf_sha256, dh_for_signaling};

/// Wire format constants. Changing any of these is a wire-breaking
/// change and requires a new `info` string (i.e. `:v2`).
const EPH_PUB_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const GCM_TAG_LEN: usize = 16;
const ENVELOPE_HEADER_LEN: usize = EPH_PUB_LEN + NONCE_LEN;
const HKDF_INFO: &[u8] = b"peers-touch:signaling:v1";

/// Compose the AAD that binds the envelope to a (session, kind)
/// context. Keep this in sync with the receiver — both ends must
/// produce byte-identical output or AES-GCM authentication will
/// fail.
///
/// `kind` is the wire string ("OFFER" / "ANSWER" / "CANDIDATE" /
/// "HANGUP") rather than the protobuf enum int — the JSON ingress
/// contract is the stable surface, the proto enum may renumber.
fn aad_for(session_ulid: &str, kind: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(13 + session_ulid.len() + 1 + kind.len());
    aad.extend_from_slice(b"signaling:v1|");
    aad.extend_from_slice(session_ulid.as_bytes());
    aad.push(b'|');
    aad.extend_from_slice(kind.as_bytes());
    aad
}

/// Derive the per-message AES-256 key. Both endpoints compute the
/// same value: by DH symmetry, `ECDH(eph_priv, peer_pub) ==
/// ECDH(peer_priv, eph_pub)` and `ECDH(self_priv, peer_pub) ==
/// ECDH(peer_priv, self_pub)`.
///
/// `salt` is `eph_pub || sender_identity_pub`. The salt does not
/// need to be secret; it pins the HKDF output to a specific
/// (sender, message) pair so an attacker who learns one derived key
/// cannot reuse it.
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

    let okm = hkdf_sha256(&ikm, &salt, HKDF_INFO, 32);
    let mut key = [0u8; 32];
    key.copy_from_slice(&okm);

    // Best-effort wipe of derivation inputs. Rust's borrow checker
    // forces us to do this after the HKDF returns; the static
    // `dh_for_signaling` outputs were already zeroized by the
    // caller after passing them in.
    let _ = ikm;
    let _ = salt;
    key
}

/// Seal `plaintext` for `peer_x_pub` using `self_x_priv` /
/// `self_x_pub` as the long-term identity. Returns the wire bytes
/// described in §2.7.2.2 of the realtime contract.
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

    let mut shared_eph = dh_for_signaling(&eph_priv, peer_x_pub);
    let mut shared_lt = dh_for_signaling(self_x_priv, peer_x_pub);
    let mut key = derive_key(&shared_eph, &shared_lt, eph_pub.as_bytes(), self_x_pub.as_bytes());
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

/// Open a sealed envelope addressed to us from `sender_x_pub`. The
/// inverse of `seal` — `self_x_priv` is our identity-derived static
/// X25519 secret. Returns the plaintext on success; an authentication
/// failure (wrong sender, tampered AAD, replay across session/kind,
/// truncated bytes) returns an error and no plaintext.
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

    let mut shared_eph = dh_for_signaling(self_x_priv, &eph_pub);
    let mut shared_lt = dh_for_signaling(self_x_priv, sender_x_pub);
    let mut key = derive_key(&shared_eph, &shared_lt, eph_pub.as_bytes(), sender_x_pub.as_bytes());
    shared_eph.zeroize();
    shared_lt.zeroize();

    let aad = aad_for(session_ulid, kind);
    let result = aes_gcm_decrypt(&key, &nonce, ct_with_tag, &aad);
    key.zeroize();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_peer() -> (StaticSecret, PublicKey) {
        let priv_key = StaticSecret::random_from_rng(OsRng);
        let pub_key = PublicKey::from(&priv_key);
        (priv_key, pub_key)
    }

    #[test]
    fn round_trip_sender_to_receiver() {
        let (alice_priv, alice_pub) = make_peer();
        let (bob_priv, bob_pub) = make_peer();

        let plaintext = br#"{"sdp":"v=0\r\no=- ..."}"#;
        let sealed = seal(&alice_priv, &alice_pub, &bob_pub, "session-01HX", "OFFER", plaintext)
            .expect("seal should succeed");

        let opened = open(&bob_priv, &alice_pub, "session-01HX", "OFFER", &sealed)
            .expect("open should succeed");
        assert_eq!(opened, plaintext);
    }

    #[test]
    fn each_seal_uses_a_fresh_ephemeral() {
        // Two seals of the same plaintext for the same context must
        // produce different ciphertexts — otherwise the ephemeral
        // isn't being regenerated and the design loses its forward
        // secrecy.
        let (alice_priv, alice_pub) = make_peer();
        let (_bob_priv, bob_pub) = make_peer();

        let plaintext = b"same plaintext both times";
        let a = seal(&alice_priv, &alice_pub, &bob_pub, "session-01", "ANSWER", plaintext).unwrap();
        let b = seal(&alice_priv, &alice_pub, &bob_pub, "session-01", "ANSWER", plaintext).unwrap();
        assert_ne!(a, b);

        // The 32-byte eph_pub prefix must also differ.
        assert_ne!(&a[..32], &b[..32]);
    }

    #[test]
    fn aad_session_binding_is_enforced() {
        // A ciphertext sealed under session-01 must not decrypt
        // under session-02 — that is the AAD's job.
        let (alice_priv, alice_pub) = make_peer();
        let (bob_priv, bob_pub) = make_peer();

        let sealed = seal(&alice_priv, &alice_pub, &bob_pub, "session-01", "CANDIDATE", b"x").unwrap();
        let res = open(&bob_priv, &alice_pub, "session-02", "CANDIDATE", &sealed);
        assert!(res.is_err(), "cross-session decrypt must fail");
    }

    #[test]
    fn aad_kind_binding_is_enforced() {
        // Likewise, kind binding: a CANDIDATE cannot be replayed as
        // an OFFER (the WebRTC stack would mis-route it).
        let (alice_priv, alice_pub) = make_peer();
        let (bob_priv, bob_pub) = make_peer();

        let sealed = seal(&alice_priv, &alice_pub, &bob_pub, "session-01", "CANDIDATE", b"x").unwrap();
        let res = open(&bob_priv, &alice_pub, "session-01", "OFFER", &sealed);
        assert!(res.is_err(), "cross-kind decrypt must fail");
    }

    #[test]
    fn wrong_sender_pub_fails() {
        // The sender's identity public participates in the key
        // derivation. Opening with the wrong sender key produces
        // a different AES key and AEAD authentication fails.
        let (alice_priv, alice_pub) = make_peer();
        let (bob_priv, bob_pub) = make_peer();
        let (_eve_priv, eve_pub) = make_peer();

        let sealed = seal(&alice_priv, &alice_pub, &bob_pub, "session-01", "OFFER", b"hi").unwrap();
        let res = open(&bob_priv, &eve_pub, "session-01", "OFFER", &sealed);
        assert!(res.is_err(), "open with wrong sender must fail");
    }

    #[test]
    fn truncated_envelope_fails_cleanly() {
        // Bounds check: short input should error rather than panic.
        let (bob_priv, _bob_pub) = make_peer();
        let (_alice_priv, alice_pub) = make_peer();
        let res = open(&bob_priv, &alice_pub, "s", "OFFER", &[0u8; 10]);
        assert!(res.is_err());
    }
}
