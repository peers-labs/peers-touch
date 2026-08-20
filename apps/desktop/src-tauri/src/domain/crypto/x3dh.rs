pub use messaging_core::crypto::x3dh::{PreKeyBundle, X3dhReceiverInput, X3dhSenderResult};

use super::error::CryptoError;
use super::identity::{IdentityKeyPair, X25519KeyPair};

pub fn x3dh_sender(
    our_ik: &IdentityKeyPair,
    bundle: &PreKeyBundle,
) -> Result<X3dhSenderResult, CryptoError> {
    messaging_core::crypto::x3dh::x3dh_sender(our_ik, bundle).map_err(classify_x3dh_error)
}

pub fn x3dh_receiver(
    our_ik: &IdentityKeyPair,
    our_spk: &X25519KeyPair,
    our_opk: Option<&X25519KeyPair>,
    input: &X3dhReceiverInput,
) -> Result<[u8; 32], CryptoError> {
    messaging_core::crypto::x3dh::x3dh_receiver(our_ik, our_spk, our_opk, input)
        .map_err(classify_x3dh_error)
}

fn classify_x3dh_error(msg: String) -> CryptoError {
    if msg.contains("SPK signature invalid") {
        CryptoError::X3dhSpkSignatureInvalid
    } else if msg.contains("bundle malformed") || msg.contains("invalid") {
        CryptoError::X3dhBundleMalformed(msg)
    } else {
        CryptoError::X3dhDerivationFailed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Signer;

    #[test]
    fn x3dh_sender_receiver_derive_same_secret() {
        let alice_ik = IdentityKeyPair::generate();
        let bob_ik = IdentityKeyPair::generate();
        let bob_spk = X25519KeyPair::generate();
        let bob_opk = X25519KeyPair::generate();

        let spk_sig = bob_ik.sign(&bob_spk.public_bytes());
        let bundle = PreKeyBundle {
            ik_pub: bob_ik.verifying_key().to_bytes(),
            spk_pub: bob_spk.public_bytes(),
            spk_sig: spk_sig.to_bytes().to_vec(),
            opk_pub: Some(bob_opk.public_bytes()),
            spk_id: 1,
            opk_id: Some(42),
        };

        let sender_result = x3dh_sender(&alice_ik, &bundle).expect("sender X3DH");

        let receiver_input = X3dhReceiverInput {
            sender_ik_pub: alice_ik.verifying_key().to_bytes(),
            sender_ephemeral_pub: sender_result.ephemeral_pub,
            spk_id: 1,
            opk_id: Some(42),
        };
        let receiver_secret = x3dh_receiver(&bob_ik, &bob_spk, Some(&bob_opk), &receiver_input)
            .expect("receiver X3DH");

        assert_eq!(sender_result.shared_secret, receiver_secret);
    }

    #[test]
    fn x3dh_without_opk() {
        let alice_ik = IdentityKeyPair::generate();
        let bob_ik = IdentityKeyPair::generate();
        let bob_spk = X25519KeyPair::generate();

        let spk_sig = bob_ik.sign(&bob_spk.public_bytes());
        let bundle = PreKeyBundle {
            ik_pub: bob_ik.verifying_key().to_bytes(),
            spk_pub: bob_spk.public_bytes(),
            spk_sig: spk_sig.to_bytes().to_vec(),
            opk_pub: None,
            spk_id: 5,
            opk_id: None,
        };

        let sender_result = x3dh_sender(&alice_ik, &bundle).expect("sender X3DH no OPK");

        let receiver_input = X3dhReceiverInput {
            sender_ik_pub: alice_ik.verifying_key().to_bytes(),
            sender_ephemeral_pub: sender_result.ephemeral_pub,
            spk_id: 5,
            opk_id: None,
        };
        let receiver_secret =
            x3dh_receiver(&bob_ik, &bob_spk, None, &receiver_input).expect("receiver X3DH no OPK");

        assert_eq!(sender_result.shared_secret, receiver_secret);
    }

    #[test]
    fn x3dh_bad_spk_signature_rejected() {
        let alice_ik = IdentityKeyPair::generate();
        let bob_ik = IdentityKeyPair::generate();
        let bob_spk = X25519KeyPair::generate();

        let eve_ik = IdentityKeyPair::generate();
        let bad_sig = eve_ik.sign(&bob_spk.public_bytes());
        let bundle = PreKeyBundle {
            ik_pub: bob_ik.verifying_key().to_bytes(),
            spk_pub: bob_spk.public_bytes(),
            spk_sig: bad_sig.to_bytes().to_vec(),
            opk_pub: None,
            spk_id: 1,
            opk_id: None,
        };

        let result = x3dh_sender(&alice_ik, &bundle);
        assert!(matches!(result, Err(CryptoError::X3dhSpkSignatureInvalid)));
    }
}
