pub use messaging_core::crypto::double_ratchet::{
    DrCiphertextWire, DrDecryptOutcome, DrSessionState, DrSkippedMessageKey, MAX_SKIP,
    MAX_SKIPPED_TOTAL, WIRE_VERSION,
};

use super::error::CryptoError;

pub fn init_initiator(session_id: &str, sk: &[u8; 32], peer_dh: [u8; 32]) -> DrSessionState {
    messaging_core::crypto::double_ratchet::init_initiator(session_id, sk, peer_dh)
}

pub fn init_responder(
    session_id: &str,
    sk: &[u8; 32],
    self_priv: [u8; 32],
) -> DrSessionState {
    messaging_core::crypto::double_ratchet::init_responder(session_id, sk, self_priv)
}

pub fn encrypt(
    state: &mut DrSessionState,
    plaintext: &[u8],
    aad_extra: &[u8],
) -> Result<DrCiphertextWire, CryptoError> {
    messaging_core::crypto::double_ratchet::encrypt(state, plaintext, aad_extra)
        .map_err(CryptoError::from)
}

pub fn decrypt(
    state: &DrSessionState,
    wire: &DrCiphertextWire,
    skipped_keys: &[DrSkippedMessageKey],
    aad_extra: &[u8],
) -> Result<DrDecryptOutcome, CryptoError> {
    messaging_core::crypto::double_ratchet::decrypt(state, wire, skipped_keys, aad_extra)
        .map_err(CryptoError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::OsRng, RngCore};
    use x25519_dalek::{PublicKey, StaticSecret};

    fn make_session_id() -> String {
        format!(
            "dr-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn random_sk() -> [u8; 32] {
        let mut s = [0u8; 32];
        OsRng.fill_bytes(&mut s);
        s
    }

    #[test]
    fn basic_round_trip() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let wire = encrypt(&mut alice, b"hello bob", b"").expect("encrypt");
        let outcome = decrypt(&bob, &wire, &[], b"").expect("decrypt");
        assert_eq!(outcome.plaintext, b"hello bob");
    }

    #[test]
    fn multiple_messages_in_order() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let mut bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        for i in 0..5u32 {
            let msg = format!("msg-{i}");
            let wire = encrypt(&mut alice, msg.as_bytes(), b"").expect("encrypt");
            let out = decrypt(&bob, &wire, &[], b"").expect("decrypt");
            assert_eq!(out.plaintext, msg.as_bytes());
            bob = out.advanced_state;
        }
    }

    #[test]
    fn bidirectional_communication() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let mut bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let w1 = encrypt(&mut alice, b"from alice", b"").expect("a encrypt");
        let o1 = decrypt(&bob, &w1, &[], b"").expect("b decrypt");
        assert_eq!(o1.plaintext, b"from alice");
        bob = o1.advanced_state;

        let w2 = encrypt(&mut bob, b"from bob", b"").expect("b encrypt");
        let o2 = decrypt(&alice, &w2, &[], b"").expect("a decrypt");
        assert_eq!(o2.plaintext, b"from bob");
        alice = o2.advanced_state;

        let w3 = encrypt(&mut alice, b"again", b"").expect("a encrypt 2");
        let o3 = decrypt(&bob, &w3, &[], b"").expect("b decrypt 2");
        assert_eq!(o3.plaintext, b"again");
    }

    #[test]
    fn out_of_order_with_skipped_keys() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let w0 = encrypt(&mut alice, b"m0", b"").unwrap();
        let w1 = encrypt(&mut alice, b"m1", b"").unwrap();
        let w2 = encrypt(&mut alice, b"m2", b"").unwrap();

        let out2 = decrypt(&bob, &w2, &[], b"").expect("decrypt w2");
        assert_eq!(out2.plaintext, b"m2");
        assert_eq!(out2.new_skipped.len(), 2);

        let bob2 = out2.advanced_state;
        let out0 = decrypt(&bob2, &w0, &out2.new_skipped, b"").expect("decrypt w0");
        assert_eq!(out0.plaintext, b"m0");
        assert!(out0.consumed_skipped.is_some());

        let remaining: Vec<_> = out2
            .new_skipped
            .iter()
            .filter(|k| k.counter != 0)
            .cloned()
            .collect();
        let out1 = decrypt(&bob2, &w1, &remaining, b"").expect("decrypt w1");
        assert_eq!(out1.plaintext, b"m1");
    }

    #[test]
    fn skip_too_far_rejected() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let mut bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let boot = encrypt(&mut alice, b"boot", b"").unwrap();
        bob = decrypt(&bob, &boot, &[], b"").unwrap().advanced_state;

        let forged = DrCiphertextWire {
            version: WIRE_VERSION,
            sender_dh: alice.self_pub,
            n_send: bob.n_recv.saturating_add(MAX_SKIP + 1),
            n_prev: 0,
            nonce: [0u8; 12],
            ciphertext: vec![0u8; 32],
        };
        assert!(matches!(
            decrypt(&bob, &forged, &[], b""),
            Err(CryptoError::RatchetSkipTooFar)
        ));
    }

    #[test]
    fn counter_regression_rejected() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let w0 = encrypt(&mut alice, b"m0", b"").unwrap();
        let _w1 = encrypt(&mut alice, b"m1", b"").unwrap();
        let w2 = encrypt(&mut alice, b"m2", b"").unwrap();

        let out2 = decrypt(&bob, &w2, &[], b"").unwrap();
        let bob2 = out2.advanced_state;

        assert!(matches!(
            decrypt(&bob2, &w0, &[], b""),
            Err(CryptoError::RatchetCounterRegression)
        ));
    }

    #[test]
    fn cross_session_replay_rejected() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid_a = make_session_id();
        let sid_b = format!("{sid_a}-other");

        let mut alice = init_initiator(&sid_a, &sk, bob_pub);
        let bob_a = init_responder(&sid_a, &sk, bob_priv.to_bytes());

        let wire = encrypt(&mut alice, b"secret", b"").unwrap();

        let mut bob_b = bob_a.clone();
        bob_b.session_id = sid_b;
        assert!(matches!(
            decrypt(&bob_b, &wire, &[], b""),
            Err(CryptoError::RatchetAeadFailure)
        ));
    }
}
