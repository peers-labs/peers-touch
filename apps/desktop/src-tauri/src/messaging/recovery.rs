use super::identity::{generate_fresh_device_identity, FreshDeviceEnrollment};
use super::store::MessagingStore;
use crate::domain::crypto::backup::{
    derive_backup_key, BackupKdfParameters, ARGON2_MEMORY_COST_KIB, ARGON2_PARALLELISM,
    ARGON2_TIME_COST, BACKUP_KEY_BYTES, BACKUP_NONCE_BYTES, BACKUP_SALT_BYTES,
};
use crate::domain::crypto::validate_mnemonic;
use crate::domain::storage::database::DatabaseOpenSpec;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::infrastructure::storage::{open_database, resolve_database_path};
use crate::model::chat::{
    AttachmentPlaintextMetadata, RecoveryArchiveManifest, RecoveryArchiveSection,
    RecoveryArchiveSectionKind,
};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use zeroize::Zeroize;

pub const MESSAGING_RECOVERY_FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryMessageProjection {
    pub conversation_id: String,
    pub event_id: String,
    pub event_sequence: i64,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub committed_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryConversationProjection {
    pub conversation_id: String,
    pub authority_station_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: String,
    pub member_ptids: Vec<String>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryAttachmentMetadata {
    pub message_id: String,
    pub attachment_id: String,
    pub metadata: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryTrustRecord {
    pub peer_ptid: String,
    pub fingerprint: String,
    pub verified_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessagingRecoveryArchive {
    pub ptid: String,
    pub actor_identity_seed: [u8; 32],
    pub actor_profile_version: u64,
    pub conversations: Vec<RecoveryConversationProjection>,
    pub messages: Vec<RecoveryMessageProjection>,
    pub attachments: Vec<RecoveryAttachmentMetadata>,
    pub trust: Vec<RecoveryTrustRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedRecoveryRevision {
    pub revision_id: String,
    pub format_version: u32,
    pub bytes: Vec<u8>,
    pub sha256: [u8; 32],
}

#[derive(Serialize, Deserialize)]
struct RecoveryRevisionEnvelope {
    kdf: BackupKdfParameters,
    manifest: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct ActorIdentitySection {
    seed: [u8; 32],
    profile_version: u64,
}

#[derive(Serialize, Deserialize)]
struct MessageHistorySection {
    conversations: Vec<RecoveryConversationProjection>,
    messages: Vec<RecoveryMessageProjection>,
}

#[derive(Serialize, Deserialize)]
struct AttachmentSection {
    attachments: Vec<RecoveryAttachmentMetadata>,
}

#[derive(Serialize, Deserialize)]
struct TrustSection {
    trust: Vec<RecoveryTrustRecord>,
}

pub fn encode_recovery_revision(
    recovery_phrase: &str,
    revision_id: &str,
    created_by_device_id: &str,
    created_at_unix_ms: i64,
    archive: &MessagingRecoveryArchive,
) -> Result<EncodedRecoveryRevision, String> {
    validate_archive_identity(recovery_phrase, revision_id, created_by_device_id, archive)?;
    let mut salt = vec![0_u8; BACKUP_SALT_BYTES];
    OsRng.fill_bytes(&mut salt);
    let kdf = BackupKdfParameters {
        salt,
        memory_cost_kib: ARGON2_MEMORY_COST_KIB,
        time_cost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
        output_length: BACKUP_KEY_BYTES as u32,
    };
    let mut key =
        derive_backup_key(recovery_phrase.as_bytes(), &kdf).map_err(|error| error.to_string())?;
    let mut sections = Vec::new();
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        RecoveryArchiveSectionKind::ActorIdentity,
        &ActorIdentitySection {
            seed: archive.actor_identity_seed,
            profile_version: archive.actor_profile_version,
        },
        1,
    )?);
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        RecoveryArchiveSectionKind::MessageHistory,
        &MessageHistorySection {
            conversations: archive.conversations.clone(),
            messages: archive.messages.clone(),
        },
        (archive.conversations.len() + archive.messages.len()) as u64,
    )?);
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        RecoveryArchiveSectionKind::AttachmentMetadata,
        &AttachmentSection {
            attachments: archive.attachments.clone(),
        },
        archive.attachments.len() as u64,
    )?);
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        RecoveryArchiveSectionKind::Trust,
        &TrustSection {
            trust: archive.trust.clone(),
        },
        archive.trust.len() as u64,
    )?);
    key.zeroize();

    let mut manifest = RecoveryArchiveManifest {
        format_version: MESSAGING_RECOVERY_FORMAT_VERSION,
        ptid: archive.ptid.clone(),
        revision_id: revision_id.to_string(),
        sections,
        archive_sha256: Vec::new(),
        created_at: Some(prost_types::Timestamp {
            seconds: created_at_unix_ms.div_euclid(1_000),
            nanos: (created_at_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
        }),
        created_by_device_id: created_by_device_id.to_string(),
    };
    manifest.archive_sha256 = manifest_hash(&manifest);
    let envelope = RecoveryRevisionEnvelope {
        kdf,
        manifest: manifest.encode_to_vec(),
    };
    let bytes = serde_json::to_vec(&envelope).map_err(|error| error.to_string())?;
    let sha256 = Sha256::digest(&bytes).into();
    Ok(EncodedRecoveryRevision {
        revision_id: revision_id.to_string(),
        format_version: MESSAGING_RECOVERY_FORMAT_VERSION,
        bytes,
        sha256,
    })
}

pub fn decode_recovery_revision(
    recovery_phrase: &str,
    expected_ptid: &str,
    expected_revision_id: &str,
    encoded: &[u8],
    expected_sha256: &[u8],
) -> Result<MessagingRecoveryArchive, String> {
    validate_mnemonic(recovery_phrase).map_err(|error| error.to_string())?;
    if expected_ptid.trim().is_empty()
        || expected_revision_id.trim().is_empty()
        || expected_sha256.len() != 32
        || Sha256::digest(encoded).as_slice() != expected_sha256
    {
        return Err("messaging recovery revision binding is invalid".to_string());
    }
    let envelope: RecoveryRevisionEnvelope =
        serde_json::from_slice(encoded).map_err(|_| "messaging recovery envelope invalid")?;
    let manifest = RecoveryArchiveManifest::decode(envelope.manifest.as_slice())
        .map_err(|_| "messaging recovery manifest invalid")?;
    if manifest.format_version != MESSAGING_RECOVERY_FORMAT_VERSION
        || manifest.ptid != expected_ptid
        || manifest.revision_id != expected_revision_id
        || manifest.archive_sha256.len() != 32
        || manifest_hash(&manifest) != manifest.archive_sha256
    {
        return Err("messaging recovery manifest binding is invalid".to_string());
    }
    let mut key = derive_backup_key(recovery_phrase.as_bytes(), &envelope.kdf)
        .map_err(|_| "messaging recovery phrase or KDF invalid".to_string())?;
    let identity: ActorIdentitySection =
        decrypt_required_section(&key, &manifest, RecoveryArchiveSectionKind::ActorIdentity)?;
    let history: MessageHistorySection =
        decrypt_required_section(&key, &manifest, RecoveryArchiveSectionKind::MessageHistory)?;
    let attachments: AttachmentSection = decrypt_required_section(
        &key,
        &manifest,
        RecoveryArchiveSectionKind::AttachmentMetadata,
    )?;
    let trust: TrustSection =
        decrypt_required_section(&key, &manifest, RecoveryArchiveSectionKind::Trust)?;
    key.zeroize();
    let archive = MessagingRecoveryArchive {
        ptid: manifest.ptid,
        actor_identity_seed: identity.seed,
        actor_profile_version: identity.profile_version,
        conversations: history.conversations,
        messages: history.messages,
        attachments: attachments.attachments,
        trust: trust.trust,
    };
    validate_archive(&archive)?;
    Ok(archive)
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
        Some(&final_spec.user_scope),
    )
    .map_err(|error| format!("{error:?}"))?;
    let mut staging_spec = final_spec.clone();
    staging_spec.profile = format!("recovery-staging-{:016x}", OsRng.next_u64());
    let staging_path = resolve_database_path(
        &staging_spec.app_name,
        &staging_spec.domain,
        &staging_spec.profile,
        Some(&staging_spec.user_scope),
    )
    .map_err(|error| format!("{error:?}"))?;
    remove_database_files(&staging_path)?;

    let result = (|| {
        let connection = open_database(&staging_spec, PlatformKeyProvider::shared())
            .map_err(|error| format!("{error:?}"))?;
        let staging = MessagingStore::from_connection(connection)?;
        staging.populate_recovery_staging(archive)?;
        let fresh_device = generate_fresh_device_identity(
            &archive.ptid,
            archive.actor_identity_seed,
            archive.actor_profile_version,
        )?;
        staging.install_fresh_device_identity(&fresh_device)?;
        let readback = staging.build_recovery_archive(
            &archive.ptid,
            archive.actor_identity_seed,
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

fn validate_archive_identity(
    phrase: &str,
    revision_id: &str,
    device_id: &str,
    archive: &MessagingRecoveryArchive,
) -> Result<(), String> {
    validate_mnemonic(phrase).map_err(|error| error.to_string())?;
    if revision_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("messaging recovery revision identity is incomplete".to_string());
    }
    validate_archive(archive)
}

pub(super) fn validate_archive(archive: &MessagingRecoveryArchive) -> Result<(), String> {
    let message_ids = archive
        .messages
        .iter()
        .map(|message| message.message_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if archive.ptid.trim().is_empty()
        || archive.actor_profile_version == 0
        || archive.conversations.iter().any(|conversation| {
            conversation.conversation_id.trim().is_empty()
                || conversation.authority_station_id.trim().is_empty()
                || conversation.kind == 0
                || conversation.owner_ptid.trim().is_empty()
                || conversation.member_ptids.len() < 2
                || conversation.membership_epoch < 0
                || conversation.mls_epoch < 0
                || conversation.updated_at_unix_ms <= 0
        })
        || archive.messages.iter().any(|message| {
            message.conversation_id.trim().is_empty()
                || message.event_id.trim().is_empty()
                || message.event_sequence <= 0
                || message.message_id.trim().is_empty()
                || message.sender_ptid.trim().is_empty()
                || message.sender_device_id.trim().is_empty()
        })
        || archive.attachments.iter().any(|attachment| {
            attachment.message_id.trim().is_empty()
                || attachment.attachment_id.trim().is_empty()
                || !message_ids.contains(attachment.message_id.as_str())
                || AttachmentPlaintextMetadata::decode(attachment.metadata.as_slice())
                    .ok()
                    .filter(|metadata| metadata.attachment_id == attachment.attachment_id)
                    .and_then(|metadata| {
                        super::private_content::validate_attachment_plaintext_metadata(&metadata)
                            .ok()
                            .map(|_| metadata)
                    })
                    .is_none()
        })
        || archive
            .trust
            .iter()
            .any(|trust| trust.peer_ptid.trim().is_empty() || trust.fingerprint.trim().is_empty())
    {
        return Err("messaging recovery archive is invalid".to_string());
    }
    Ok(())
}

fn encrypt_section<T: Serialize>(
    key: &[u8; 32],
    archive: &MessagingRecoveryArchive,
    revision_id: &str,
    kind: RecoveryArchiveSectionKind,
    value: &T,
    record_count: u64,
) -> Result<RecoveryArchiveSection, String> {
    let plaintext = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let mut nonce = [0_u8; BACKUP_NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "recovery AES init failed")?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &section_aad(&archive.ptid, revision_id, kind),
            },
        )
        .map_err(|_| "recovery section encryption failed")?;
    let mut sealed = nonce.to_vec();
    sealed.extend_from_slice(&ciphertext);
    Ok(RecoveryArchiveSection {
        kind: kind as i32,
        ciphertext_sha256: Sha256::digest(&sealed).to_vec(),
        ciphertext: sealed,
        record_count,
    })
}

fn decrypt_required_section<T: DeserializeOwned>(
    key: &[u8; 32],
    manifest: &RecoveryArchiveManifest,
    kind: RecoveryArchiveSectionKind,
) -> Result<T, String> {
    let matches = manifest
        .sections
        .iter()
        .filter(|section| section.kind == kind as i32)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("messaging recovery section set is invalid".to_string());
    }
    let section = matches[0];
    if section.ciphertext.len() <= BACKUP_NONCE_BYTES
        || section.ciphertext_sha256.len() != 32
        || Sha256::digest(&section.ciphertext).as_slice() != section.ciphertext_sha256
    {
        return Err("messaging recovery section hash invalid".to_string());
    }
    let (nonce, ciphertext) = section.ciphertext.split_at(BACKUP_NONCE_BYTES);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "recovery AES init failed")?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &section_aad(&manifest.ptid, &manifest.revision_id, kind),
            },
        )
        .map_err(|_| "messaging recovery phrase or section integrity invalid")?;
    serde_json::from_slice(&plaintext).map_err(|_| "messaging recovery section invalid".to_string())
}

fn section_aad(ptid: &str, revision_id: &str, kind: RecoveryArchiveSectionKind) -> Vec<u8> {
    format!(
        "peers-touch:messaging-recovery:{}:{}:{}:{}",
        MESSAGING_RECOVERY_FORMAT_VERSION, ptid, revision_id, kind as i32
    )
    .into_bytes()
}

fn manifest_hash(manifest: &RecoveryArchiveManifest) -> Vec<u8> {
    let mut input = manifest.clone();
    input.archive_sha256.clear();
    Sha256::digest(input.encode_to_vec()).to_vec()
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

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    fn archive() -> MessagingRecoveryArchive {
        MessagingRecoveryArchive {
            ptid: "ptid:alice".to_string(),
            actor_identity_seed: [7; 32],
            actor_profile_version: 4,
            conversations: vec![RecoveryConversationProjection {
                conversation_id: "conversation-1".to_string(),
                authority_station_id: "station-local".to_string(),
                kind: 1,
                name: String::new(),
                owner_ptid: "ptid:alice".to_string(),
                member_ptids: vec!["ptid:alice".to_string(), "ptid:bob".to_string()],
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
    fn recovery_revision_round_trips_all_recoverable_sections() {
        let expected = archive();
        let encoded =
            encode_recovery_revision(PHRASE, "revision-1", "alice-device", 10, &expected).unwrap();
        let actual = decode_recovery_revision(
            PHRASE,
            "ptid:alice",
            "revision-1",
            &encoded.bytes,
            &encoded.sha256,
        )
        .unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn wrong_phrase_and_corruption_fail_closed() {
        let encoded =
            encode_recovery_revision(PHRASE, "revision-1", "alice-device", 10, &archive()).unwrap();
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
        let first = generate_fresh_device_identity(
            &archive.ptid,
            archive.actor_identity_seed,
            archive.actor_profile_version,
        )
        .unwrap();
        let second = generate_fresh_device_identity(
            &archive.ptid,
            archive.actor_identity_seed,
            archive.actor_profile_version,
        )
        .unwrap();
        assert_ne!(
            first.enrollment.certificate.device_id,
            second.enrollment.certificate.device_id
        );
        assert_ne!(
            first.enrollment.certificate.device_signing_public_key,
            second.enrollment.certificate.device_signing_public_key
        );
        let actor_identity = IdentityKeyPair::from_seed(&archive.actor_identity_seed);
        let reconstructed = DeviceSigningKey::from_parts(
            &first.device_signing_seed,
            ed25519_dalek::Signature::from_bytes(&first.enrollment.actor_cross_signature),
            first.enrollment.certificate.device_id.clone(),
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
            .complete_device_enrollment(&first.enrollment.certificate.device_id)
            .unwrap();
        assert_eq!(store.pending_device_enrollment().unwrap(), None);
    }
}
