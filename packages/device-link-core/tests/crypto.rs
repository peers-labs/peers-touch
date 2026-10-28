use device_link_core::{crypto::*, digest};
use hpke_rs::HpkePrivateKey;

#[test]
fn rfc9180_cfrg_x25519_chacha20poly1305_base_receiver_vector() {
    // Published RFC 9180 CFRG vectors, mode=0, kem=32, kdf=1, aead=3.
    // https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/master/test-vectors.json
    let sk =
        hex::decode("8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb").unwrap();
    let enc =
        hex::decode("1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a").unwrap();
    let info = hex::decode("4f6465206f6e2061204772656369616e2055726e").unwrap();
    let aad = hex::decode("436f756e742d30").unwrap();
    let ciphertext = hex::decode("1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28").unwrap();
    let expected =
        hex::decode("4265617574792069732074727574682c20747275746820626561757479").unwrap();
    assert_eq!(
        suite()
            .open(
                &enc,
                &HpkePrivateKey::from(sk),
                &info,
                &aad,
                &ciphertext,
                None,
                None,
                None
            )
            .unwrap(),
        expected
    );
}

#[test]
fn independent_encapsulation_binds_receiver_transcript_and_purpose() {
    let mobile = ReceiverKey::generate();
    let other = ReceiverKey::generate();
    let first = seal(mobile.public(), b"identity-transcript", b"actor-seed").unwrap();
    let second = seal(mobile.public(), b"identity-transcript", b"actor-seed").unwrap();
    assert_ne!(first.encapsulated_key, second.encapsulated_key);
    assert_ne!(first.ciphertext, second.ciphertext);
    assert_eq!(
        open(&mobile, &first, b"identity-transcript")
            .unwrap()
            .as_slice(),
        b"actor-seed"
    );
    assert!(open(&other, &first, b"identity-transcript").is_err());
    assert!(open(&mobile, &first, b"credential-transcript").is_err());
    let mut corrupt = first;
    corrupt.ciphertext[0] ^= 1;
    assert!(open(&mobile, &corrupt, b"identity-transcript").is_err());
    assert!(seal(&[0; 32], b"identity-transcript", b"actor-seed").is_err());
}

#[test]
fn sealed_offer_is_authenticated_and_bounded() {
    let key = [71; 32];
    let plaintext = b"signed-offer";
    let sealed = seal_offer(&key, plaintext).unwrap();
    assert_eq!(
        unseal_offer(&key, &digest(plaintext), &sealed)
            .unwrap()
            .as_slice(),
        plaintext
    );
    assert!(unseal_offer(&[72; 32], &digest(plaintext), &sealed).is_err());
    assert!(unseal_offer(&key, &digest(b"other-offer"), &sealed).is_err());
    for length in 0..34 {
        assert!(unseal_offer(
            &key,
            &digest(plaintext),
            &sealed[..length.min(sealed.len())]
        )
        .is_err());
    }
    let mut corrupt = sealed;
    corrupt[18] ^= 1;
    assert!(unseal_offer(&key, &digest(plaintext), &corrupt).is_err());
    assert!(seal_offer(&key, &vec![0; 16 * 1024]).is_err());
}
