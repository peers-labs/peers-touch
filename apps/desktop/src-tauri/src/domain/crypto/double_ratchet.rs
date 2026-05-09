//! Double Ratchet — Phase M1 skeleton. Not wired into any send/recv
//! path yet (the bundle publishes [0] until M2 flips).
//!
//! The cryptographic protocol follows Signal:
//!   * X25519 DH ratchet for forward secrecy (every received message
//!     with a new peer DH key triggers a half-rotation; every send
//!     after a receive triggers the full rotation).
//!   * HKDF-SHA256 for both root-key and chain-key derivation.
//!   * Per-message AES-256-GCM with a chain-derived message key and a
//!     random 12-byte nonce carried on the wire.
//!
//! Persistence: every send/recv produces an updated [`DrSessionState`]
//! that the caller MUST persist via `local_chat_store::save_dr_session`
//! before the next operation. Skipped-message keys produced during
//! out-of-order receives go into a separate per-(session, peer_dh)
//! store so they survive restart.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::ZeroizeOnDrop;

pub const WIRE_VERSION: u32 = 1;
pub const MAX_SKIP: u32 = 1024;
pub const MAX_SKIPPED_TOTAL: u32 = 4096;
const AES_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

const KDF_RK_INFO: &[u8] = b"peers-touch:dr:rk:v1";
const KDF_CK_INFO: &[u8] = b"peers-touch:dr:ck:v1";
const KDF_SK_ROOT_INFO: &[u8] = b"peers-touch:dr:sk-root:v1";

#[derive(Clone, ZeroizeOnDrop)]
pub struct DrSessionState {
    pub session_id: String,
    pub root_key: [u8; 32],
    pub self_priv: [u8; 32],
    pub self_pub: [u8; 32],
    pub peer_pub: Option<[u8; 32]>,
    pub send_chain_key: Option<[u8; 32]>,
    pub recv_chain_key: Option<[u8; 32]>,
    pub n_send: u32,
    pub n_recv: u32,
    pub n_prev: u32,
}

#[derive(Clone, ZeroizeOnDrop)]
pub struct DrSkippedMessageKey {
    pub session_id: String,
    pub peer_pub: [u8; 32],
    pub counter: u32,
    pub message_key: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DrCiphertextWire {
    pub version: u32,
    pub sender_dh: [u8; 32],
    pub n_send: u32,
    pub n_prev: u32,
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DrError {
    SkipTooFar,
    SkipBudgetExhausted,
    AeadFailure,
    BadWireFormat,
    UninitializedReceive,
    CounterRegression,
}

pub struct DrDecryptOutcome {
    pub plaintext: Vec<u8>,
    pub advanced_state: DrSessionState,
    pub new_skipped: Vec<DrSkippedMessageKey>,
    pub consumed_skipped: Option<([u8; 32], u32)>,
}

fn root_from_sk(sk: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, sk.as_slice());
    let mut rk = [0u8; 32];
    hk.expand(KDF_SK_ROOT_INFO, &mut rk)
        .expect("hkdf expand sk-root");
    rk
}

/// `(rk', recv_dir, send_dir)` for this party after the DH step:
/// * Outbound messages use `send_dir` (symmetric chain).
/// * Inbound messages from the peer (whose sending chain mirrors ours)
///   are decrypted with the counterpart chain — the one that matches
///   the peer's `send_dir`, which equals our `recv_chain` material only
///   after the next ratchet; for the initial triple-DH output,
///   **incoming ciphertexts from the peer that initiated the DH** match
///   `send_dir` on *their* side, so locally we decrypt with `send_dir`
///   from the same tuple on the very first receive.
fn kdf_rk(root: &[u8; 32], dh_out: &[u8; 32]) -> ([u8; 32], [u8; 32], [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(Some(root.as_ref()), dh_out.as_slice());
    let mut buf = [0u8; 96];
    hk.expand(KDF_RK_INFO, &mut buf).expect("hkdf expand rk");
    let mut rk = [0u8; 32];
    let mut recv_dir = [0u8; 32];
    let mut send_dir = [0u8; 32];
    rk.copy_from_slice(&buf[..32]);
    recv_dir.copy_from_slice(&buf[32..64]);
    send_dir.copy_from_slice(&buf[64..]);
    (rk, recv_dir, send_dir)
}

fn kdf_ck(chain_key: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(None, chain_key.as_slice());
    let mut buf = [0u8; 64];
    hk.expand(KDF_CK_INFO, &mut buf).expect("hkdf expand ck");
    let mut mk = [0u8; 32];
    let mut next_ck = [0u8; 32];
    mk.copy_from_slice(&buf[..32]);
    next_ck.copy_from_slice(&buf[32..]);
    (mk, next_ck)
}

fn build_aad(session_id: &str, wire_version: u32, sender_dh: &[u8; 32], extra: &[u8]) -> Vec<u8> {
    const SEP: u8 = 0x1f;
    let mut v = Vec::with_capacity(session_id.len() + 4 + 32 + extra.len() + 8);
    v.extend_from_slice(session_id.as_bytes());
    v.push(SEP);
    v.extend_from_slice(&wire_version.to_be_bytes());
    v.push(SEP);
    v.extend_from_slice(sender_dh.as_slice());
    v.extend_from_slice(extra);
    v
}

fn dh_bytes(priv_bytes: &[u8; 32], peer_pub: &[u8; 32]) -> [u8; 32] {
    let priv_s = StaticSecret::from(*priv_bytes);
    let peer = PublicKey::from(*peer_pub);
    priv_s.diffie_hellman(&peer).to_bytes()
}

fn rotate_self_keys(state: &mut DrSessionState) {
    let new_priv = StaticSecret::random_from_rng(&mut OsRng);
    let new_pub = PublicKey::from(&new_priv);
    state.self_priv = new_priv.to_bytes();
    state.self_pub = new_pub.to_bytes();
}

/// Initialize from an X3DH-derived shared secret.
pub fn init_initiator(session_id: &str, sk: &[u8; 32], peer_dh: [u8; 32]) -> DrSessionState {
    let self_priv = StaticSecret::random_from_rng(&mut OsRng);
    let self_pub = PublicKey::from(&self_priv);
    let rk0 = root_from_sk(sk);
    let dh = dh_bytes(&self_priv.to_bytes(), &peer_dh);
    let (rk, recv_dir, send_dir) = kdf_rk(&rk0, &dh);
    DrSessionState {
        session_id: session_id.to_string(),
        root_key: rk,
        self_priv: self_priv.to_bytes(),
        self_pub: self_pub.to_bytes(),
        peer_pub: Some(peer_dh),
        send_chain_key: Some(send_dir),
        recv_chain_key: Some(recv_dir),
        n_send: 0,
        n_recv: 0,
        n_prev: 0,
    }
}

pub fn init_responder(session_id: &str, sk: &[u8; 32], self_priv: [u8; 32]) -> DrSessionState {
    let priv_s = StaticSecret::from(self_priv);
    let self_pub = PublicKey::from(&priv_s);
    DrSessionState {
        session_id: session_id.to_string(),
        root_key: root_from_sk(sk),
        self_priv: priv_s.to_bytes(),
        self_pub: self_pub.to_bytes(),
        peer_pub: None,
        send_chain_key: None,
        recv_chain_key: None,
        n_send: 0,
        n_recv: 0,
        n_prev: 0,
    }
}

fn count_pre_skipped_for_session(pre: &[DrSkippedMessageKey], session_id: &str) -> u32 {
    pre.iter().filter(|k| k.session_id == session_id).count() as u32
}

fn materialize_skipped(
    session_id: &str,
    peer_dh: [u8; 32],
    recv_ck: &mut [u8; 32],
    n_recv: &mut u32,
    until: u32,
    new_skipped: &mut Vec<DrSkippedMessageKey>,
    pre_existing: &[DrSkippedMessageKey],
) -> Result<(), DrError> {
    if until < *n_recv {
        return Err(DrError::BadWireFormat);
    }
    let gap = until - *n_recv;
    if gap > MAX_SKIP {
        return Err(DrError::SkipTooFar);
    }
    let already =
        new_skipped.len() as u32 + count_pre_skipped_for_session(pre_existing, session_id);
    if already.saturating_add(gap) > MAX_SKIPPED_TOTAL {
        return Err(DrError::SkipBudgetExhausted);
    }
    for _ in 0..gap {
        let (mk, next_ck) = kdf_ck(recv_ck);
        new_skipped.push(DrSkippedMessageKey {
            session_id: session_id.to_string(),
            peer_pub: peer_dh,
            counter: *n_recv,
            message_key: mk,
        });
        *recv_ck = next_ck;
        *n_recv = n_recv.checked_add(1).ok_or(DrError::BadWireFormat)?;
    }
    Ok(())
}

/// Advance the receive chain and decrypt `wire.n_send`.
fn decrypt_at_counter(
    session_id: &str,
    wire: &DrCiphertextWire,
    recv_ck: &mut [u8; 32],
    n_recv: &mut u32,
    new_skipped: &mut Vec<DrSkippedMessageKey>,
    pre_existing: &[DrSkippedMessageKey],
    aad_extra: &[u8],
) -> Result<Vec<u8>, DrError> {
    let peer_dh = wire.sender_dh;
    materialize_skipped(
        session_id,
        peer_dh,
        recv_ck,
        n_recv,
        wire.n_send,
        new_skipped,
        pre_existing,
    )?;
    if *n_recv != wire.n_send {
        return Err(DrError::BadWireFormat);
    }
    let (mk, next_ck) = kdf_ck(recv_ck);
    let aad = build_aad(session_id, wire.version, &wire.sender_dh, aad_extra);
    let cipher = Aes256Gcm::new_from_slice(&mk).map_err(|_| DrError::AeadFailure)?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(&wire.nonce),
            Payload {
                msg: wire.ciphertext.as_slice(),
                aad: &aad,
            },
        )
        .map_err(|_| DrError::AeadFailure)?;
    *recv_ck = next_ck;
    *n_recv = n_recv.checked_add(1).ok_or(DrError::BadWireFormat)?;
    Ok(plain)
}

pub fn encrypt(
    state: &mut DrSessionState,
    plaintext: &[u8],
    aad_extra: &[u8],
) -> Result<DrCiphertextWire, DrError> {
    if state.send_chain_key.is_none() {
        let peer = state.peer_pub.ok_or(DrError::UninitializedReceive)?;
        let new_priv = StaticSecret::random_from_rng(&mut OsRng);
        let new_pub = PublicKey::from(&new_priv);
        let dh = new_priv.diffie_hellman(&PublicKey::from(peer));
        let (rk, recv_dir, send_dir) = kdf_rk(&state.root_key, dh.as_bytes());
        state.root_key = rk;
        state.self_priv = new_priv.to_bytes();
        state.self_pub = new_pub.to_bytes();
        state.recv_chain_key = Some(recv_dir);
        state.send_chain_key = Some(send_dir);
        state.n_prev = state.n_send;
        state.n_send = 0;
        state.n_recv = 0;
    }
    let send_ck = state
        .send_chain_key
        .as_mut()
        .ok_or(DrError::UninitializedReceive)?;
    let (mk, next_send_ck) = kdf_ck(send_ck);
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let aad = build_aad(&state.session_id, WIRE_VERSION, &state.self_pub, aad_extra);
    let cipher = Aes256Gcm::new_from_slice(&mk).map_err(|_| DrError::AeadFailure)?;
    let ct = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| DrError::AeadFailure)?;

    let n_out = state.n_send;
    *send_ck = next_send_ck;
    state.n_send = state.n_send.checked_add(1).expect("n_send overflow");

    Ok(DrCiphertextWire {
        version: WIRE_VERSION,
        sender_dh: state.self_pub,
        n_send: n_out,
        n_prev: state.n_prev,
        nonce,
        ciphertext: ct,
    })
}

pub fn decrypt(
    state: &DrSessionState,
    wire: &DrCiphertextWire,
    pre_skipped: &[DrSkippedMessageKey],
    aad_extra: &[u8],
) -> Result<DrDecryptOutcome, DrError> {
    if wire.version != WIRE_VERSION {
        return Err(DrError::BadWireFormat);
    }
    for sk in pre_skipped {
        if sk.session_id == state.session_id
            && sk.peer_pub == wire.sender_dh
            && sk.counter == wire.n_send
        {
            let aad = build_aad(&state.session_id, wire.version, &wire.sender_dh, aad_extra);
            let cipher =
                Aes256Gcm::new_from_slice(&sk.message_key).map_err(|_| DrError::AeadFailure)?;
            let plain = cipher
                .decrypt(
                    Nonce::from_slice(&wire.nonce),
                    Payload {
                        msg: wire.ciphertext.as_slice(),
                        aad: &aad,
                    },
                )
                .map_err(|_| DrError::AeadFailure)?;
            let advanced = state.clone();
            return Ok(DrDecryptOutcome {
                plaintext: plain,
                advanced_state: advanced,
                new_skipped: Vec::new(),
                consumed_skipped: Some((wire.sender_dh, wire.n_send)),
            });
        }
    }

    let mut st = state.clone();
    let mut new_skipped: Vec<DrSkippedMessageKey> = Vec::new();

    let same_peer = st.peer_pub.map(|p| p == wire.sender_dh).unwrap_or(false);

    if !same_peer {
        if let (Some(old_peer), Some(mut recv_ck)) = (st.peer_pub, st.recv_chain_key) {
            let mut nr = st.n_recv;
            materialize_skipped(
                &st.session_id,
                old_peer,
                &mut recv_ck,
                &mut nr,
                wire.n_prev,
                &mut new_skipped,
                pre_skipped,
            )?;
            st.recv_chain_key = Some(recv_ck);
            st.n_recv = nr;
        }

        let dh = dh_bytes(&st.self_priv, &wire.sender_dh);
        let (rk, _recv_dir, send_dir) = kdf_rk(&st.root_key, &dh);
        st.root_key = rk;
        st.recv_chain_key = Some(send_dir);
        st.n_recv = 0;
        st.peer_pub = Some(wire.sender_dh);
        rotate_self_keys(&mut st);
        st.send_chain_key = None;
    }

    let mut recv_ck = st.recv_chain_key.ok_or(DrError::UninitializedReceive)?;
    let mut nr = st.n_recv;
    if same_peer && wire.n_send < nr {
        return Err(DrError::CounterRegression);
    }
    let plain = decrypt_at_counter(
        &st.session_id,
        wire,
        &mut recv_ck,
        &mut nr,
        &mut new_skipped,
        pre_skipped,
        aad_extra,
    )?;
    st.recv_chain_key = Some(recv_ck);
    st.n_recv = nr;

    let total =
        count_pre_skipped_for_session(pre_skipped, &st.session_id) + new_skipped.len() as u32;
    if total > MAX_SKIPPED_TOTAL {
        return Err(DrError::SkipBudgetExhausted);
    }

    Ok(DrDecryptOutcome {
        plaintext: plain,
        advanced_state: st,
        new_skipped,
        consumed_skipped: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sess_id() -> String {
        format!(
            "dr-sess-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn sk() -> [u8; 32] {
        let mut s = [7u8; 32];
        OsRng.fill_bytes(&mut s);
        s
    }

    #[test]
    fn round_trip_in_order() {
        let shared = sk();
        let bob_static_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_static_priv).to_bytes();
        let sid = sess_id();
        let mut alice = init_initiator(&sid, &shared, bob_pub);
        let mut bob = init_responder(&sid, &shared, bob_static_priv.to_bytes());

        for i in 0..3 {
            let msg = format!("m{i}");
            let w = encrypt(&mut alice, msg.as_bytes(), b"").expect("alice encrypt");
            let out = decrypt(&bob, &w, &[], b"").expect("bob decrypt");
            assert_eq!(out.plaintext, msg.as_bytes());
            bob = out.advanced_state;
        }
    }

    #[test]
    fn out_of_order_materialises_skipped() {
        let shared = sk();
        let bob_static_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_static_priv).to_bytes();
        let sid = sess_id();
        let mut alice = init_initiator(&sid, &shared, bob_pub);
        let bob0 = init_responder(&sid, &shared, bob_static_priv.to_bytes());

        let w0 = encrypt(&mut alice, b"m0", b"").unwrap();
        let w1 = encrypt(&mut alice, b"m1", b"").unwrap();
        let w2 = encrypt(&mut alice, b"m2", b"").unwrap();

        let mut bob = bob0;
        let out2 = decrypt(&bob, &w2, &[], b"").expect("d2");
        assert_eq!(out2.plaintext, b"m2");
        assert!(out2.new_skipped.iter().any(|s| s.counter == 0));
        assert!(out2.new_skipped.iter().any(|s| s.counter == 1));
        bob = out2.advanced_state;

        let out0 = decrypt(&bob, &w0, &out2.new_skipped, b"").expect("d0");
        assert_eq!(out0.plaintext, b"m0");
        let remain: Vec<_> = out2
            .new_skipped
            .iter()
            .filter(|k| k.counter != 0)
            .cloned()
            .collect();
        let out1 = decrypt(&bob, &w1, &remain, b"").expect("d1");
        assert_eq!(out1.plaintext, b"m1");
    }

    #[test]
    fn skip_too_far_is_rejected() {
        let shared = sk();
        let bob_static_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_static_priv).to_bytes();
        let sid = sess_id();
        let mut alice = init_initiator(&sid, &shared, bob_pub);
        let mut bob = init_responder(&sid, &shared, bob_static_priv.to_bytes());

        let boot = encrypt(&mut alice, b"boot", b"").unwrap();
        bob = decrypt(&bob, &boot, &[], b"").unwrap().advanced_state;

        let forged = DrCiphertextWire {
            version: WIRE_VERSION,
            sender_dh: alice.self_pub,
            n_send: bob.n_recv.saturating_add(MAX_SKIP + 1),
            n_prev: 0,
            nonce: [0u8; 12],
            ciphertext: vec![],
        };
        assert!(matches!(
            decrypt(&bob, &forged, &[], b""),
            Err(DrError::SkipTooFar)
        ));
    }

    #[test]
    fn cross_session_replay_is_rejected() {
        let shared = sk();
        let bob_static_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_static_priv).to_bytes();
        let sid_a = sess_id();
        let sid_b = sess_id();
        let mut alice_a = init_initiator(&sid_a, &shared, bob_pub);
        let bob_a = init_responder(&sid_a, &shared, bob_static_priv.to_bytes());
        let w = encrypt(&mut alice_a, b"secret", b"").unwrap();

        let mut bob_b = bob_a.clone();
        bob_b.session_id = sid_b;
        assert!(matches!(
            decrypt(&bob_b, &w, &[], b""),
            Err(DrError::AeadFailure)
        ));
    }

    #[test]
    fn dh_ratchet_rotates_keys() {
        let shared = sk();
        let bob_static_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_static_priv).to_bytes();
        let sid = sess_id();
        let mut alice = init_initiator(&sid, &shared, bob_pub);
        let mut bob = init_responder(&sid, &shared, bob_static_priv.to_bytes());

        let w1 = encrypt(&mut alice, b"a", b"").unwrap();
        let o1 = decrypt(&bob, &w1, &[], b"").unwrap();
        bob = o1.advanced_state;

        let w2 = encrypt(&mut bob, b"b", b"").unwrap();
        let o2 = decrypt(&alice, &w2, &[], b"").unwrap();
        alice = o2.advanced_state;

        let sk_before = alice.self_priv;
        let _w3 = encrypt(&mut alice, b"c", b"").unwrap();
        assert_ne!(sk_before, alice.self_priv);
    }

    #[test]
    fn skipped_key_consumed_once() {
        let shared = sk();
        let bob_static_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_static_priv).to_bytes();
        let sid = sess_id();
        let mut alice = init_initiator(&sid, &shared, bob_pub);
        let mut bob = init_responder(&sid, &shared, bob_static_priv.to_bytes());

        let w0 = encrypt(&mut alice, b"m0", b"").unwrap();
        let w1 = encrypt(&mut alice, b"m1", b"").unwrap();
        let w2 = encrypt(&mut alice, b"m2", b"").unwrap();

        let out2 = decrypt(&bob, &w2, &[], b"").unwrap();
        bob = out2.advanced_state;
        let skipped = out2.new_skipped.clone();

        let _d0 = decrypt(&bob, &w0, &skipped, b"").expect("decrypt from skipped");
        assert!(matches!(
            decrypt(&bob, &w0, &[], b""),
            Err(DrError::CounterRegression)
        ));
    }

    #[test]
    fn init_initiator_and_responder_converge() {
        let shared = sk();
        let bob_static_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_static_priv).to_bytes();
        let sid = sess_id();
        let mut alice = init_initiator(&sid, &shared, bob_pub);
        let mut bob = init_responder(&sid, &shared, bob_static_priv.to_bytes());

        let hello = b"hello-double-ratchet";
        let w = encrypt(&mut alice, hello, b"").expect("encrypt");
        let out = decrypt(&bob, &w, &[], b"").expect("decrypt");
        assert_eq!(out.plaintext, hello);
        bob = out.advanced_state;
        let back = encrypt(&mut bob, b"ack", b"").expect("reply");
        let fin = decrypt(&alice, &back, &[], b"").expect("decrypt reply");
        assert_eq!(fin.plaintext, b"ack");
    }
}
