use super::types::{
    DecodedRecoveryRevision, EncodedRecoveryRevision, MessagingRecoveryArchive,
    RecoveryAttachmentMetadata, RecoveryConversationProjection, RecoveryMessageProjection,
    RecoveryTrustRecord, MESSAGING_RECOVERY_FORMAT_VERSION,
};
use crate::codec::private_content::validate_attachment_plaintext_metadata;
use crate::proto::actor_ref;
use crate::proto::chat::AttachmentPlaintextMetadata;
use crate::proto::recovery::{
    OpaqueRecoveryArchiveManifest, OpaqueRecoveryArchiveSection, OpaqueRecoveryArchiveSectionKind,
};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const BACKUP_NONCE_BYTES: usize = 12;

pub trait RecoveryKdf: Send + Sync {
    type Params: Serialize + for<'de> Deserialize<'de>;

    fn default_params(&self) -> Self::Params;
    fn derive_key(&self, passphrase: &[u8], params: &Self::Params) -> Result<[u8; 32], String>;
    fn validate_mnemonic(&self, phrase: &str) -> Result<(), String>;
}

#[derive(Serialize, Deserialize)]
struct RecoveryRevisionEnvelope<P> {
    kdf: P,
    #[serde(default = "initial_recovery_epoch")]
    recovery_epoch: u64,
    manifest: Vec<u8>,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct ActorIdentitySection {
    seed: [u8; 32],
    profile_version: u64,
    #[serde(default = "initial_recovery_epoch")]
    recovery_epoch: u64,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct MessageHistorySection {
    conversations: Vec<RecoveryConversationProjection>,
    messages: Vec<RecoveryMessageProjection>,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct AttachmentSection {
    attachments: Vec<RecoveryAttachmentMetadata>,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct TrustSection {
    trust: Vec<RecoveryTrustRecord>,
}

#[derive(Serialize)]
struct ActorIdentitySectionRef<'a> {
    seed: &'a [u8; 32],
    profile_version: u64,
    recovery_epoch: u64,
}

#[derive(Serialize)]
struct MessageHistorySectionRef<'a> {
    conversations: &'a [RecoveryConversationProjection],
    messages: &'a [RecoveryMessageProjection],
}

#[derive(Serialize)]
struct AttachmentSectionRef<'a> {
    attachments: &'a [RecoveryAttachmentMetadata],
}

#[derive(Serialize)]
struct TrustSectionRef<'a> {
    trust: &'a [RecoveryTrustRecord],
}

pub fn encode_recovery_revision<K: RecoveryKdf>(
    kdf_provider: &K,
    recovery_phrase: &str,
    revision_id: &str,
    created_by_device_id: &str,
    created_at_unix_ms: i64,
    recovery_epoch: u64,
    archive: &MessagingRecoveryArchive,
) -> Result<EncodedRecoveryRevision, String> {
    validate_archive_identity(
        kdf_provider,
        recovery_phrase,
        revision_id,
        created_by_device_id,
        archive,
    )?;
    if recovery_epoch == 0 || recovery_epoch > i64::MAX as u64 {
        return Err("messaging recovery epoch is invalid".to_string());
    }
    let params = kdf_provider.default_params();
    let key = Zeroizing::new(kdf_provider.derive_key(recovery_phrase.as_bytes(), &params)?);

    let mut sections = Vec::new();
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        OpaqueRecoveryArchiveSectionKind::ActorIdentity,
        &ActorIdentitySectionRef {
            seed: &archive.actor_identity_seed,
            profile_version: archive.actor_profile_version,
            recovery_epoch,
        },
        1,
    )?);
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        OpaqueRecoveryArchiveSectionKind::MessageHistory,
        &MessageHistorySectionRef {
            conversations: &archive.conversations,
            messages: &archive.messages,
        },
        (archive.conversations.len() + archive.messages.len()) as u64,
    )?);
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        OpaqueRecoveryArchiveSectionKind::AttachmentMetadata,
        &AttachmentSectionRef {
            attachments: &archive.attachments,
        },
        archive.attachments.len() as u64,
    )?);
    sections.push(encrypt_section(
        &key,
        archive,
        revision_id,
        OpaqueRecoveryArchiveSectionKind::Trust,
        &TrustSectionRef {
            trust: &archive.trust,
        },
        archive.trust.len() as u64,
    )?);
    let mut manifest = OpaqueRecoveryArchiveManifest {
        format_version: MESSAGING_RECOVERY_FORMAT_VERSION,
        actor: Some(actor_ref(&archive.ptid)),
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
        kdf: params,
        recovery_epoch,
        manifest: manifest.encode_to_vec(),
    };
    let bytes = serde_json::to_vec(&envelope).map_err(|error| error.to_string())?;
    let sha256 = Sha256::digest(&bytes).into();
    Ok(EncodedRecoveryRevision {
        revision_id: revision_id.to_string(),
        format_version: MESSAGING_RECOVERY_FORMAT_VERSION,
        recovery_epoch,
        bytes,
        sha256,
    })
}

pub fn decode_recovery_revision<K: RecoveryKdf>(
    kdf_provider: &K,
    recovery_phrase: &str,
    expected_ptid: &str,
    expected_revision_id: &str,
    encoded: &[u8],
    expected_sha256: &[u8],
) -> Result<DecodedRecoveryRevision, String> {
    kdf_provider.validate_mnemonic(recovery_phrase)?;
    if expected_ptid.trim().is_empty()
        || expected_revision_id.trim().is_empty()
        || expected_sha256.len() != 32
        || Sha256::digest(encoded).as_slice() != expected_sha256
    {
        return Err("messaging recovery revision binding is invalid".to_string());
    }
    let envelope: RecoveryRevisionEnvelope<K::Params> =
        serde_json::from_slice(encoded).map_err(|_| "messaging recovery envelope invalid")?;
    if envelope.recovery_epoch == 0 || envelope.recovery_epoch > i64::MAX as u64 {
        return Err("messaging recovery epoch is invalid".to_string());
    }
    let manifest = OpaqueRecoveryArchiveManifest::decode(envelope.manifest.as_slice())
        .map_err(|_| "messaging recovery manifest invalid")?;
    let manifest_ptid = recovery_manifest_ptid(&manifest)?.to_string();
    if manifest.format_version != MESSAGING_RECOVERY_FORMAT_VERSION
        || manifest_ptid != expected_ptid
        || manifest.revision_id != expected_revision_id
        || manifest.archive_sha256.len() != 32
        || manifest_hash(&manifest) != manifest.archive_sha256
    {
        return Err("messaging recovery manifest binding is invalid".to_string());
    }
    let key = Zeroizing::new(kdf_provider.derive_key(recovery_phrase.as_bytes(), &envelope.kdf)?);
    let mut identity: ActorIdentitySection = decrypt_required_section(
        &key,
        &manifest,
        OpaqueRecoveryArchiveSectionKind::ActorIdentity,
    )?;
    if identity.recovery_epoch != envelope.recovery_epoch {
        return Err("messaging recovery epoch binding is invalid".to_string());
    }
    let mut history: MessageHistorySection = decrypt_required_section(
        &key,
        &manifest,
        OpaqueRecoveryArchiveSectionKind::MessageHistory,
    )?;
    let mut attachments: AttachmentSection = decrypt_required_section(
        &key,
        &manifest,
        OpaqueRecoveryArchiveSectionKind::AttachmentMetadata,
    )?;
    let mut trust: TrustSection =
        decrypt_required_section(&key, &manifest, OpaqueRecoveryArchiveSectionKind::Trust)?;
    let archive = MessagingRecoveryArchive {
        ptid: manifest_ptid,
        actor_identity_seed: std::mem::take(&mut identity.seed),
        actor_profile_version: identity.profile_version,
        conversations: std::mem::take(&mut history.conversations),
        messages: std::mem::take(&mut history.messages),
        attachments: std::mem::take(&mut attachments.attachments),
        trust: std::mem::take(&mut trust.trust),
    };
    validate_archive(&archive)?;
    Ok(DecodedRecoveryRevision {
        recovery_epoch: envelope.recovery_epoch,
        archive,
    })
}

fn initial_recovery_epoch() -> u64 {
    1
}

pub fn validate_archive(archive: &MessagingRecoveryArchive) -> Result<(), String> {
    let message_ids = archive
        .messages
        .iter()
        .map(|message| message.message_id.as_str())
        .collect::<HashSet<_>>();
    if archive.ptid.trim().is_empty()
        || archive.actor_profile_version == 0
        || archive.conversations.iter().any(|conversation| {
            conversation.conversation_id.trim().is_empty()
                || conversation.authority_station_id.trim().is_empty()
                || conversation.kind == 0
                || conversation.owner_ptid.trim().is_empty()
                || conversation.member_ptids.len() < 2
                || (!conversation.member_roles.is_empty()
                    && (conversation.member_roles.len() != conversation.member_ptids.len()
                        || conversation
                            .member_ptids
                            .iter()
                            .any(|ptid| !conversation.member_roles.contains_key(ptid))))
                || conversation.member_roles.iter().any(|(ptid, role)| {
                    ptid.trim().is_empty()
                        || !matches!(
                            crate::proto::chat::MemberRole::try_from(*role),
                            Ok(crate::proto::chat::MemberRole::Member
                                | crate::proto::chat::MemberRole::Admin
                                | crate::proto::chat::MemberRole::Owner)
                        )
                })
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
                        validate_attachment_plaintext_metadata(&metadata)
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

fn validate_archive_identity<K: RecoveryKdf>(
    kdf_provider: &K,
    phrase: &str,
    revision_id: &str,
    device_id: &str,
    archive: &MessagingRecoveryArchive,
) -> Result<(), String> {
    kdf_provider.validate_mnemonic(phrase)?;
    if revision_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("messaging recovery revision identity is incomplete".to_string());
    }
    validate_archive(archive)
}

fn encrypt_section<T: Serialize>(
    key: &[u8; 32],
    archive: &MessagingRecoveryArchive,
    revision_id: &str,
    kind: OpaqueRecoveryArchiveSectionKind,
    value: &T,
    record_count: u64,
) -> Result<OpaqueRecoveryArchiveSection, String> {
    let plaintext = Zeroizing::new(serde_json::to_vec(value).map_err(|error| error.to_string())?);
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
    Ok(OpaqueRecoveryArchiveSection {
        kind: kind as i32,
        ciphertext_sha256: Sha256::digest(&sealed).to_vec(),
        ciphertext: sealed,
        record_count,
    })
}

fn decrypt_required_section<T: DeserializeOwned>(
    key: &[u8; 32],
    manifest: &OpaqueRecoveryArchiveManifest,
    kind: OpaqueRecoveryArchiveSectionKind,
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
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &section_aad(
                        recovery_manifest_ptid(manifest)?,
                        &manifest.revision_id,
                        kind,
                    ),
                },
            )
            .map_err(|_| "messaging recovery phrase or section integrity invalid")?,
    );
    serde_json::from_slice(&plaintext).map_err(|_| "messaging recovery section invalid".to_string())
}

fn recovery_manifest_ptid(manifest: &OpaqueRecoveryArchiveManifest) -> Result<&str, String> {
    manifest
        .actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .filter(|ptid| !ptid.trim().is_empty())
        .ok_or_else(|| "messaging recovery manifest actor is invalid".to_string())
}

fn section_aad(ptid: &str, revision_id: &str, kind: OpaqueRecoveryArchiveSectionKind) -> Vec<u8> {
    format!(
        "peers-touch:messaging-recovery:{}:{}:{}:{}",
        MESSAGING_RECOVERY_FORMAT_VERSION, ptid, revision_id, kind as i32
    )
    .into_bytes()
}

fn manifest_hash(manifest: &OpaqueRecoveryArchiveManifest) -> Vec<u8> {
    let mut input = manifest.clone();
    input.archive_sha256.clear();
    Sha256::digest(input.encode_to_vec()).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::private_content::test_attachment_metadata;

    struct TestKdf;

    #[derive(Serialize, Deserialize)]
    struct TestKdfParams {
        salt: Vec<u8>,
    }

    impl RecoveryKdf for TestKdf {
        type Params = TestKdfParams;

        fn default_params(&self) -> TestKdfParams {
            let mut salt = vec![0u8; 16];
            OsRng.fill_bytes(&mut salt);
            TestKdfParams { salt }
        }

        fn derive_key(
            &self,
            passphrase: &[u8],
            params: &TestKdfParams,
        ) -> Result<[u8; 32], String> {
            let mut key = [0u8; 32];
            let mut h = Sha256::new();
            h.update(passphrase);
            h.update(&params.salt);
            key.copy_from_slice(&h.finalize());
            Ok(key)
        }

        fn validate_mnemonic(&self, phrase: &str) -> Result<(), String> {
            if phrase.split_whitespace().count() >= 12 {
                Ok(())
            } else {
                Err("mnemonic too short".to_string())
            }
        }
    }

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

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
                member_roles: std::collections::BTreeMap::from([
                    (
                        "ptid:alice".to_string(),
                        crate::proto::chat::MemberRole::Owner as i32,
                    ),
                    (
                        "ptid:bob".to_string(),
                        crate::proto::chat::MemberRole::Member as i32,
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
    fn recovery_revision_round_trips_all_sections() {
        let expected = archive();
        let encoded = encode_recovery_revision(
            &TestKdf,
            PHRASE,
            "revision-1",
            "alice-device",
            10,
            7,
            &expected,
        )
        .unwrap();
        let actual = decode_recovery_revision(
            &TestKdf,
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
    fn legacy_archive_without_federation_identity_remains_decodable() {
        let mut value = serde_json::to_value(archive()).unwrap();
        value["conversations"][0]
            .as_object_mut()
            .unwrap()
            .remove("federation_id");
        value["conversations"][0]
            .as_object_mut()
            .unwrap()
            .remove("description");
        value["conversations"][0]
            .as_object_mut()
            .unwrap()
            .remove("avatar_object_id");
        let legacy: MessagingRecoveryArchive = serde_json::from_value(value).unwrap();
        assert!(legacy.conversations[0].federation_id.is_empty());
        assert!(legacy.conversations[0].description.is_empty());
        assert!(legacy.conversations[0].avatar_object_id.is_empty());
        assert!(validate_archive(&legacy).is_ok());
    }

    #[test]
    fn wrong_phrase_fails_closed() {
        let encoded = encode_recovery_revision(
            &TestKdf,
            PHRASE,
            "revision-1",
            "alice-device",
            10,
            1,
            &archive(),
        )
        .unwrap();
        let wrong = "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful";
        assert!(decode_recovery_revision(
            &TestKdf,
            wrong,
            "ptid:alice",
            "revision-1",
            &encoded.bytes,
            &encoded.sha256,
        )
        .is_err());
    }

    #[test]
    fn corruption_fails_closed() {
        let encoded = encode_recovery_revision(
            &TestKdf,
            PHRASE,
            "revision-1",
            "alice-device",
            10,
            1,
            &archive(),
        )
        .unwrap();
        let mut corrupted = encoded.bytes.clone();
        let last = corrupted.len() - 1;
        corrupted[last] ^= 1;
        assert!(decode_recovery_revision(
            &TestKdf,
            PHRASE,
            "ptid:alice",
            "revision-1",
            &corrupted,
            &encoded.sha256,
        )
        .is_err());
    }
}
