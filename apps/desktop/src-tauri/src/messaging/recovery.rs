use super::store::MessagingStore;
use crate::domain::crypto::backup::{
    derive_backup_key, BackupKdfParameters, ARGON2_MEMORY_COST_KIB, ARGON2_PARALLELISM,
    ARGON2_TIME_COST, BACKUP_KEY_BYTES, BACKUP_SALT_BYTES,
};
use crate::domain::crypto::validate_mnemonic;
use crate::domain::storage::database::DatabaseOpenSpec;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::infrastructure::storage::{open_database, resolve_database_path};
use messaging_core::identity::enrollment::generate_fresh_device_identity_from_seed;
use messaging_core::identity::FreshDeviceEnrollment;
use messaging_core::recovery::{self as recovery_core, RecoveryKdf};
pub use messaging_core::recovery::{
    DecodedRecoveryRevision, EncodedRecoveryRevision, MessagingRecoveryArchive,
    RecoveryAttachmentMetadata, RecoveryConversationProjection, RecoveryMessageProjection,
    RecoveryTrustRecord,
};
use rand::{rngs::OsRng, RngCore};
#[cfg(test)]
use serde::{Deserialize, Serialize};
#[cfg(test)]
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use zeroize::ZeroizeOnDrop;

struct DesktopRecoveryKdf;

impl RecoveryKdf for DesktopRecoveryKdf {
    type Params = BackupKdfParameters;

    fn default_params(&self) -> Self::Params {
        let mut salt = vec![0_u8; BACKUP_SALT_BYTES];
        OsRng.fill_bytes(&mut salt);
        BackupKdfParameters {
            salt,
            memory_cost_kib: ARGON2_MEMORY_COST_KIB,
            time_cost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
            output_length: BACKUP_KEY_BYTES as u32,
        }
    }

    fn derive_key(&self, passphrase: &[u8], params: &Self::Params) -> Result<[u8; 32], String> {
        derive_backup_key(passphrase, params).map_err(|error| error.to_string())
    }

    fn validate_mnemonic(&self, phrase: &str) -> Result<(), String> {
        validate_mnemonic(phrase).map_err(|error| error.to_string())
    }
}

pub fn encode_recovery_revision(
    recovery_phrase: &str,
    revision_id: &str,
    created_by_device_id: &str,
    created_at_unix_ms: i64,
    recovery_epoch: u64,
    archive: &MessagingRecoveryArchive,
) -> Result<EncodedRecoveryRevision, String> {
    recovery_core::encode_recovery_revision(
        &DesktopRecoveryKdf,
        recovery_phrase,
        revision_id,
        created_by_device_id,
        created_at_unix_ms,
        recovery_epoch,
        archive,
    )
}

pub fn decode_recovery_revision(
    recovery_phrase: &str,
    expected_ptid: &str,
    expected_revision_id: &str,
    encoded: &[u8],
    expected_sha256: &[u8],
) -> Result<DecodedRecoveryRevision, String> {
    recovery_core::decode_recovery_revision(
        &DesktopRecoveryKdf,
        recovery_phrase,
        expected_ptid,
        expected_revision_id,
        encoded,
        expected_sha256,
    )
}

// The profile Engine and every legacy connection to the same database must be
// stopped before this function is called.
pub fn restore_profile_database_atomically(
    profile_id: &str,
    archive: &MessagingRecoveryArchive,
) -> Result<FreshDeviceEnrollment, String> {
    validate_archive(archive)?;
    if profile_id.trim().is_empty() {
        return Err("messaging recovery requires profile ID".to_string());
    }
    let final_spec = DatabaseOpenSpec::new_chat_main(profile_id.to_string());
    let final_path = resolve_database_path(
        &final_spec.app_name,
        &final_spec.domain,
        &final_spec.profile,
        &final_spec.user_scope,
    )
    .map_err(|error| format!("{error:?}"))?;
    let mut staging_spec = final_spec.clone();
    staging_spec.profile = format!("recovery-staging-{:016x}", OsRng.next_u64());
    let staging_path = resolve_database_path(
        &staging_spec.app_name,
        &staging_spec.domain,
        &staging_spec.profile,
        &staging_spec.user_scope,
    )
    .map_err(|error| format!("{error:?}"))?;
    remove_database_files(&staging_path)?;

    let result = (|| {
        let connection = open_database(&staging_spec, PlatformKeyProvider::shared())
            .map_err(|error| format!("{error:?}"))?;
        let staging = MessagingStore::from_connection(connection)?;
        staging.populate_recovery_staging(archive)?;
        let fresh_device = generate_fresh_device_identity_from_seed(
            &archive.ptid,
            &archive.actor_identity_seed,
            archive.actor_profile_version,
        )?;
        staging.install_fresh_device_identity(&fresh_device)?;
        let readback = staging.build_recovery_archive(
            &archive.ptid,
            &archive.actor_identity_seed,
            archive.actor_profile_version,
        )?;
        if &readback != archive {
            return Err("messaging recovery staging readback mismatch".to_string());
        }
        staging.validate_integrity()?;
        staging.prepare_for_atomic_replace()?;
        drop(staging);
        #[cfg(feature = "acceptance-webdriver")]
        if std::env::var_os("PT_MESSAGING_RECOVERY_FAIL_BEFORE_REPLACE_FILE")
            .map(PathBuf::from)
            .is_some_and(|path| path.is_file())
        {
            return Err("injected messaging recovery failure before replace".to_string());
        }
        remove_sidecars(&final_path)?;
        atomic_replace_file(&staging_path, &final_path)?;
        Ok(fresh_device.enrollment)
    })();
    if result.is_err() {
        let _ = remove_database_files(&staging_path);
    }
    result
}

pub(super) fn validate_archive(archive: &MessagingRecoveryArchive) -> Result<(), String> {
    recovery_core::validate_archive(archive)
}

fn atomic_replace_file(staging: &Path, target: &Path) -> Result<(), String> {
    if !staging.is_file() {
        return Err("messaging recovery staging database is missing".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(staging, target).map_err(|error| error.to_string())
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{suffix}", path.display()))
}

fn remove_sidecars(path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = sidecar(path, suffix);
        if sidecar.exists() {
            fs::remove_file(sidecar).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn remove_database_files(path: &Path) -> Result<(), String> {
    remove_sidecars(path)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::crypto::{DeviceSigningKey, IdentityKeyPair};
    use crate::messaging::private_content::test_attachment_metadata;
    use prost::Message;
    use std::collections::BTreeMap;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    #[derive(Serialize, Deserialize)]
    struct RecoveryRevisionEnvelope {
        kdf: BackupKdfParameters,
        recovery_epoch: u64,
        manifest: Vec<u8>,
    }

    #[test]
    fn recovery_secret_bearing_types_zeroize_on_drop() {
        fn require_zeroize_on_drop<T: ZeroizeOnDrop>() {}

        require_zeroize_on_drop::<RecoveryMessageProjection>();
        require_zeroize_on_drop::<RecoveryConversationProjection>();
        require_zeroize_on_drop::<RecoveryAttachmentMetadata>();
        require_zeroize_on_drop::<RecoveryTrustRecord>();
        require_zeroize_on_drop::<MessagingRecoveryArchive>();
    }

    fn archive() -> MessagingRecoveryArchive {
        MessagingRecoveryArchive {
            ptid: "ptid:alice".to_string(),
            actor_identity_seed: [7; 32],
            actor_profile_version: 4,
            conversations: vec![RecoveryConversationProjection {
                conversation_id: "conversation-1".to_string(),
                authority_station_id: "station-local".to_string(),
                federation_id: "federation-1".to_string(),
                kind: 1,
                name: String::new(),
                description: "Recovery description".to_string(),
                avatar_object_id: "oss://chat/avatar-1".to_string(),
                owner_ptid: "ptid:alice".to_string(),
                member_ptids: vec!["ptid:alice".to_string(), "ptid:bob".to_string()],
                member_roles: BTreeMap::from([
                    (
                        "ptid:alice".to_string(),
                        crate::model::chat::MemberRole::Owner as i32,
                    ),
                    (
                        "ptid:bob".to_string(),
                        crate::model::chat::MemberRole::Member as i32,
                    ),
                ]),
                membership_epoch: 1,
                mls_epoch: 0,
                active: true,
                updated_at_unix_ms: 10,
            }],
            messages: vec![RecoveryMessageProjection {
                conversation_id: "conversation-1".to_string(),
                event_id: "event-1".to_string(),
                event_sequence: 1,
                message_id: "message-1".to_string(),
                sender_ptid: "ptid:bob".to_string(),
                sender_device_id: "bob-device".to_string(),
                plaintext: "exact plaintext".to_string(),
                committed_at_unix_ms: 10,
            }],
            attachments: vec![RecoveryAttachmentMetadata {
                message_id: "message-1".to_string(),
                attachment_id: "attachment-1".to_string(),
                metadata: test_attachment_metadata("attachment-1").encode_to_vec(),
            }],
            trust: vec![RecoveryTrustRecord {
                peer_ptid: "ptid:bob".to_string(),
                fingerprint: "abcd".to_string(),
                verified_at_unix_ms: 11,
            }],
        }
    }

    #[test]
    fn legacy_conversation_projection_decodes_without_member_roles() {
        let projection: RecoveryConversationProjection =
            serde_json::from_value(serde_json::json!({
                "conversation_id": "conversation-legacy",
                "authority_station_id": "station-local",
                "kind": 2,
                "name": "Legacy group",
                "owner_ptid": "ptid:alice",
                "member_ptids": ["ptid:alice", "ptid:bob"],
                "membership_epoch": 1,
                "mls_epoch": 1,
                "active": true,
                "updated_at_unix_ms": 100,
            }))
            .unwrap();

        assert!(projection.member_roles.is_empty());
        assert!(projection.federation_id.is_empty());
        assert!(projection.description.is_empty());
        assert!(projection.avatar_object_id.is_empty());
        let mut legacy = archive();
        legacy.conversations = vec![projection];
        assert!(validate_archive(&legacy).is_ok());
    }

    #[test]
    fn recovery_revision_round_trips_all_recoverable_sections() {
        let expected = archive();
        let encoded =
            encode_recovery_revision(PHRASE, "revision-1", "alice-device", 10, 7, &expected)
                .unwrap();
        let actual = decode_recovery_revision(
            PHRASE,
            "ptid:alice",
            "revision-1",
            &encoded.bytes,
            &encoded.sha256,
        )
        .unwrap();
        assert_eq!(actual.recovery_epoch, 7);
        assert_eq!(actual.archive, expected);
    }

    #[test]
    fn wrong_phrase_and_corruption_fail_closed() {
        let encoded =
            encode_recovery_revision(PHRASE, "revision-1", "alice-device", 10, 1, &archive())
                .unwrap();
        let wrong_phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow legal winner thank year wave sausage worth useful legal winner thank yellow";
        assert!(decode_recovery_revision(
            wrong_phrase,
            "ptid:alice",
            "revision-1",
            &encoded.bytes,
            &encoded.sha256,
        )
        .is_err());
        let mut corrupted = encoded.bytes.clone();
        let last = corrupted.len() - 1;
        corrupted[last] ^= 1;
        assert!(decode_recovery_revision(
            PHRASE,
            "ptid:alice",
            "revision-1",
            &corrupted,
            &encoded.sha256,
        )
        .is_err());
    }

    #[test]
    fn recovery_epoch_is_bound_by_encrypted_identity_section() {
        let encoded =
            encode_recovery_revision(PHRASE, "revision-epoch", "alice-device", 10, 7, &archive())
                .unwrap();
        let mut envelope: RecoveryRevisionEnvelope =
            serde_json::from_slice(&encoded.bytes).unwrap();
        envelope.recovery_epoch = 8;
        let tampered = serde_json::to_vec(&envelope).unwrap();
        let tampered_sha = Sha256::digest(&tampered);

        assert!(decode_recovery_revision(
            PHRASE,
            "ptid:alice",
            "revision-epoch",
            &tampered,
            tampered_sha.as_slice(),
        )
        .is_err());
    }

    #[test]
    fn archive_schema_has_no_live_device_or_crypto_state() {
        let serialized = serde_json::to_string(&archive()).unwrap();
        for forbidden in [
            "device_identity",
            "signed_prekey",
            "one_time_prekey",
            "ratchet",
            "skipped_key",
            "mls_state",
            "queue",
            "consumer_epoch",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "forbidden field {forbidden}"
            );
        }
    }

    #[test]
    fn atomic_file_replace_never_removes_target_when_staging_is_missing() {
        let root = std::env::temp_dir().join(format!(
            "peers-touch-recovery-file-test-{:016x}",
            OsRng.next_u64()
        ));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.db");
        let missing = root.join("missing.db");
        fs::write(&target, b"old").unwrap();
        assert!(atomic_replace_file(&missing, &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old");

        let staging = root.join("staging.db");
        fs::write(&staging, b"new").unwrap();
        atomic_replace_file(&staging, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(!staging.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_generates_fresh_cross_signed_device_identity() {
        let archive = archive();
        let first = generate_fresh_device_identity_from_seed(
            &archive.ptid,
            &archive.actor_identity_seed,
            archive.actor_profile_version,
        )
        .unwrap();
        let second = generate_fresh_device_identity_from_seed(
            &archive.ptid,
            &archive.actor_identity_seed,
            archive.actor_profile_version,
        )
        .unwrap();
        let first_device = first.enrollment.certificate.device.as_ref().unwrap();
        let second_device = second.enrollment.certificate.device.as_ref().unwrap();
        assert_ne!(first_device.device_id, second_device.device_id);
        assert_ne!(
            first.enrollment.certificate.device_signing_public_key,
            second.enrollment.certificate.device_signing_public_key
        );
        let actor_identity = IdentityKeyPair::from_seed(&archive.actor_identity_seed);
        let reconstructed = DeviceSigningKey::from_parts(
            &first.device_signing_seed,
            ed25519_dalek::Signature::from_bytes(&first.enrollment.actor_cross_signature),
            first_device.device_id.clone(),
        );
        reconstructed
            .verify_cross_signature(
                actor_identity.verifying_key(),
                &first.enrollment.certificate.encode_to_vec(),
            )
            .unwrap();

        let store = MessagingStore::in_memory().unwrap();
        store.install_fresh_device_identity(&first).unwrap();
        assert_eq!(
            store.pending_device_enrollment().unwrap(),
            Some(first.enrollment.clone())
        );
        store
            .complete_device_enrollment(&first_device.device_id)
            .unwrap();
        assert_eq!(store.pending_device_enrollment().unwrap(), None);
    }
}
