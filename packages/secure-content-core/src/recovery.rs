use crate::prekey::{
    ContentPreKeyPair, ContentPreKeyPublic, MAX_CONTENT_PREKEY_ACTOR_PTID_BYTES,
    MAX_CONTENT_PREKEY_EPOCH, MAX_CONTENT_PREKEY_KEY_ID_BYTES,
};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const RECOVERY_ENTROPY_SIZE: usize = 32;

const RECOVERY_MASTER_SALT_DOMAIN: &[u8] = b"peers-touch:secure-content:recovery-master-salt:v1\0";
const RECOVERY_MASTER_INFO: &[u8] = b"peers-touch:secure-content:recovery:v1\0";
const RECOVERY_PREKEY_SALT_DOMAIN: &[u8] = b"peers-touch:secure-content:recovery-prekey-salt:v1\0";
const RECOVERY_PREKEY_INFO_DOMAIN: &[u8] = b"peers-touch:secure-content:recovery-prekey:v1\0";

/// The actor recovery master. Its bytes are secret and are zeroized on drop.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct RecoveryMaster([u8; 32]);

impl RecoveryMaster {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

pub fn derive_recovery_master(
    mnemonic_entropy: &[u8],
    actor_ptid: &str,
    recovery_epoch: u64,
) -> Result<RecoveryMaster, String> {
    if mnemonic_entropy.len() != RECOVERY_ENTROPY_SIZE {
        return Err("secure content recovery entropy must contain exactly 32 bytes".to_string());
    }
    validate_actor_epoch(actor_ptid, recovery_epoch)?;

    let master_context = master_context(actor_ptid, recovery_epoch);
    let salt = domain_hash(RECOVERY_MASTER_SALT_DOMAIN, &master_context);
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), mnemonic_entropy);
    let mut master = Zeroizing::new([0_u8; 32]);
    hkdf.expand(RECOVERY_MASTER_INFO, master.as_mut())
        .map_err(|_| "secure content recovery master derivation failed".to_string())?;
    Ok(RecoveryMaster(*master))
}

/// Deterministically derives the private and public recovery PreKey for one key ID.
///
/// The HKDF seed is zeroized immediately after it is moved into the private-key
/// owner. `ContentPreKeyPair` then zeroizes the private key on drop.
pub fn derive_recovery_prekey(
    master: &RecoveryMaster,
    actor_ptid: &str,
    recovery_epoch: u64,
    key_id: &str,
) -> Result<ContentPreKeyPair, String> {
    validate_actor_epoch(actor_ptid, recovery_epoch)?;
    validate_identifier(key_id, MAX_CONTENT_PREKEY_KEY_ID_BYTES, "recovery key ID")?;

    let context = prekey_context(actor_ptid, recovery_epoch, key_id);
    let salt = domain_hash(RECOVERY_PREKEY_SALT_DOMAIN, &context);
    let mut info = Vec::with_capacity(RECOVERY_PREKEY_INFO_DOMAIN.len() + context.len());
    info.extend_from_slice(RECOVERY_PREKEY_INFO_DOMAIN);
    info.extend_from_slice(&context);

    let hkdf = Hkdf::<Sha256>::new(Some(&salt), master.as_bytes());
    let mut seed = Zeroizing::new([0_u8; 32]);
    hkdf.expand(&info, seed.as_mut())
        .map_err(|_| "secure content recovery PreKey derivation failed".to_string())?;

    Ok(ContentPreKeyPair::from_private(
        crate::prekey::ContentPreKeyPrivate::from_bytes(*seed),
    ))
}

/// Derives a recovery PreKey and rejects a claimed public key mismatch before use.
pub fn derive_validated_recovery_prekey(
    master: &RecoveryMaster,
    actor_ptid: &str,
    recovery_epoch: u64,
    key_id: &str,
    claimed_public: ContentPreKeyPublic,
) -> Result<ContentPreKeyPair, String> {
    let pair = derive_recovery_prekey(master, actor_ptid, recovery_epoch, key_id)?;
    if pair.public() != claimed_public {
        return Err("secure content recovery PreKey public key does not match claim".to_string());
    }
    Ok(pair)
}

fn validate_actor_epoch(actor_ptid: &str, recovery_epoch: u64) -> Result<(), String> {
    validate_identifier(
        actor_ptid,
        MAX_CONTENT_PREKEY_ACTOR_PTID_BYTES,
        "recovery actor PTID",
    )?;
    if recovery_epoch == 0 || recovery_epoch > MAX_CONTENT_PREKEY_EPOCH {
        return Err("secure content recovery input is invalid".to_string());
    }
    Ok(())
}

fn validate_identifier(value: &str, maximum_bytes: usize, name: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > maximum_bytes
        || value.trim() != value
        || value.as_bytes().contains(&0)
    {
        return Err(format!("secure content {name} is invalid"));
    }
    Ok(())
}

fn master_context(actor_ptid: &str, recovery_epoch: u64) -> Vec<u8> {
    let mut context = Vec::with_capacity(4 + actor_ptid.len() + 8);
    push_identifier(&mut context, actor_ptid);
    context.extend_from_slice(&recovery_epoch.to_be_bytes());
    context
}

fn prekey_context(actor_ptid: &str, recovery_epoch: u64, key_id: &str) -> Vec<u8> {
    let mut context = master_context(actor_ptid, recovery_epoch);
    context.reserve(4 + key_id.len());
    push_identifier(&mut context, key_id);
    context
}

fn push_identifier(output: &mut Vec<u8>, value: &str) {
    let length = u32::try_from(value.len()).expect("validated recovery identifier length");
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(value.as_bytes());
}

fn domain_hash(domain: &[u8], context: &[u8]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(context);
    digest.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::{open_content_key, ContentKey, SealedContentKey};

    #[test]
    fn recovery_master_matches_the_sc_d16_normative_vector() {
        let actor_ptid = "ptid:v1:actor:peers:p:alice:key";
        let context = master_context(actor_ptid, 7);
        assert_eq!(
            hex(&context),
            "0000001f707469643a76313a6163746f723a70656572733a703a616c6963653a6b65790000000000000007"
        );
        assert_eq!(
            hex(&domain_hash(RECOVERY_MASTER_SALT_DOMAIN, &context)),
            "0d42446c4a58ccdc74013ffd21ab0023c9c18813cd06f24a8395d3ffa25d4023"
        );

        let master = derive_recovery_master(&[0x0b; RECOVERY_ENTROPY_SIZE], actor_ptid, 7).unwrap();
        assert_eq!(
            hex(master.as_bytes()),
            "57064757d05c45ddfe290541243c801fa07a8e90b7248b3a5989fae496e155aa"
        );
    }

    #[test]
    fn recovery_prekey_matches_the_sc_d16_normative_vector() {
        let actor_ptid = "ptid:v1:actor:peers:p:alice:key";
        let key_id = "recovery-prekey-0001";
        let master = derive_recovery_master(&[0x0b; RECOVERY_ENTROPY_SIZE], actor_ptid, 7).unwrap();
        let context = prekey_context(actor_ptid, 7, key_id);
        assert_eq!(
            hex(&context),
            "0000001f707469643a76313a6163746f723a70656572733a703a616c6963653a6b65790000000000000007000000147265636f766572792d7072656b65792d30303031"
        );
        assert_eq!(
            hex(&domain_hash(RECOVERY_PREKEY_SALT_DOMAIN, &context)),
            "a204ff97065160b31b68d86f3dd6ac9d2071e6c5bec45cfca9593368ec8e09f7"
        );

        let pair = derive_recovery_prekey(&master, actor_ptid, 7, key_id).unwrap();
        assert_eq!(
            hex(pair.private().as_bytes()),
            "07fd2947dd56b405f1139f053cbbc13fa9b29c8ef323731b9f3a73a9b28022ac"
        );
        assert_eq!(
            hex(pair.public().as_bytes()),
            "7de402b631f5f1a0f4f0b2b0d1b063a8a4e3fe7212f28b3bc6202197274bb43a"
        );
        assert!(
            derive_validated_recovery_prekey(&master, actor_ptid, 7, key_id, pair.public(),)
                .is_ok()
        );
        assert!(derive_validated_recovery_prekey(
            &master,
            actor_ptid,
            7,
            key_id,
            ContentPreKeyPublic::from_bytes([0x55; 32]),
        )
        .is_err());
    }

    #[test]
    fn recovery_prekeys_diverge_for_wrong_actor_epoch_and_key_id() {
        let actor_ptid = "ptid:v1:actor:peers:p:alice:key";
        let master = derive_recovery_master(&[0x0b; RECOVERY_ENTROPY_SIZE], actor_ptid, 7).unwrap();
        let expected =
            derive_recovery_prekey(&master, actor_ptid, 7, "recovery-prekey-0001").unwrap();
        let wrong_actor = derive_recovery_prekey(
            &master,
            "ptid:v1:actor:peers:p:mallory:key",
            7,
            "recovery-prekey-0001",
        )
        .unwrap();
        let wrong_epoch =
            derive_recovery_prekey(&master, actor_ptid, 8, "recovery-prekey-0001").unwrap();
        let wrong_key =
            derive_recovery_prekey(&master, actor_ptid, 7, "recovery-prekey-0002").unwrap();
        let wrong_phrase_master =
            derive_recovery_master(&[0x0c; RECOVERY_ENTROPY_SIZE], actor_ptid, 7).unwrap();
        let wrong_phrase =
            derive_recovery_prekey(&wrong_phrase_master, actor_ptid, 7, "recovery-prekey-0001")
                .unwrap();

        for divergent in [&wrong_actor, &wrong_epoch, &wrong_key, &wrong_phrase] {
            assert_ne!(
                divergent.private().as_bytes(),
                expected.private().as_bytes()
            );
            assert_ne!(divergent.public(), expected.public());
        }
    }

    #[test]
    fn recovery_derivation_enforces_entropy_identifier_and_epoch_bounds() {
        let entropy = [0x0b; RECOVERY_ENTROPY_SIZE];
        assert!(derive_recovery_master(&entropy[..31], "actor", 1).is_err());
        assert!(derive_recovery_master(&[0; 33], "actor", 1).is_err());
        assert!(derive_recovery_master(&entropy, "", 1).is_err());
        assert!(derive_recovery_master(&entropy, " actor", 1).is_err());
        assert!(derive_recovery_master(&entropy, "actor\0suffix", 1).is_err());
        assert!(derive_recovery_master(
            &entropy,
            &"a".repeat(MAX_CONTENT_PREKEY_ACTOR_PTID_BYTES),
            1
        )
        .is_ok());
        assert!(derive_recovery_master(
            &entropy,
            &"a".repeat(MAX_CONTENT_PREKEY_ACTOR_PTID_BYTES + 1),
            1
        )
        .is_err());
        assert!(derive_recovery_master(&entropy, "actor", 0).is_err());
        assert!(derive_recovery_master(&entropy, "actor", MAX_CONTENT_PREKEY_EPOCH + 1).is_err());
        assert!(derive_recovery_master(&entropy, "actor", MAX_CONTENT_PREKEY_EPOCH).is_ok());

        let master = derive_recovery_master(&entropy, "actor", 1).unwrap();
        assert!(derive_recovery_prekey(&master, "actor", 1, "").is_err());
        assert!(derive_recovery_prekey(&master, "actor", 1, "key ").is_err());
        assert!(derive_recovery_prekey(&master, "actor", 1, "key\0suffix").is_err());
        assert!(derive_recovery_prekey(
            &master,
            "actor",
            1,
            &"k".repeat(MAX_CONTENT_PREKEY_KEY_ID_BYTES),
        )
        .is_ok());
        assert!(derive_recovery_prekey(
            &master,
            "actor",
            1,
            &"k".repeat(MAX_CONTENT_PREKEY_KEY_ID_BYTES + 1),
        )
        .is_err());
    }

    #[test]
    fn derived_recovery_prekey_opens_the_fixed_hpke_envelope_vector() {
        const CANONICAL_BINDING_HEX: &str = "080112127265636f766572792d706c616e2d303030311a201111111111111111111111111111111111111111111111111111111111111111221b080212157265636f766572792d636f6e74656e742d3030303118012a127265636f766572792d736c6f742d3030303130023a147265636f766572792d7072656b65792d30303031422012121212121212121212121212121212121212121212121212121212121212124a201313131313131313131313131313131313131313131313131313131313131313522014141414141414141414141414141414141414141414141414141414141414145a20151515151515151515151515151515151515151515151515151515151515151562060880a8d6b9076a390a23121f707469643a76313a6163746f723a70656572733a703a616c6963653a6b6579200112126465766963652d617574686f722d30303031721773656e6465722d7369676e696e672d6b65792d30303031";
        const ENCAPSULATED_KEY_HEX: &str =
            "393cf2465b8465c277dc0dd9d19664a2d54150b6cc8eb2cb97d155ca7e7cc761";
        const CIPHERTEXT_HEX: &str =
            "6e006d72d0034b5791aac1c22a46a8bcc6876222d27e0a9974a3b2c36fda11bae7ed9601871a07e989ea8003bc3e210b";
        let actor_ptid = "ptid:v1:actor:peers:p:alice:key";
        let master = derive_recovery_master(&[0x0b; RECOVERY_ENTROPY_SIZE], actor_ptid, 7).unwrap();
        let pair = derive_recovery_prekey(&master, actor_ptid, 7, "recovery-prekey-0001").unwrap();
        let binding = decode_hex(CANONICAL_BINDING_HEX);
        let envelope = SealedContentKey {
            encapsulated_key: decode_hex(ENCAPSULATED_KEY_HEX),
            ciphertext: decode_hex(CIPHERTEXT_HEX),
        };

        let opened = open_content_key(pair.private(), &binding, &envelope).unwrap();
        assert_eq!(
            opened.as_bytes(),
            ContentKey::from_bytes([0x42; 32]).as_bytes()
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        assert_eq!(value.len() % 2, 0);
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|digits| {
                let digits = std::str::from_utf8(digits).unwrap();
                u8::from_str_radix(digits, 16).unwrap()
            })
            .collect()
    }
}
