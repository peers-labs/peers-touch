use super::store::MessagingStore;
use crate::domain::crypto::backup::{
    derive_backup_key, BackupKdfParameters, ARGON2_MEMORY_COST_KIB, ARGON2_PARALLELISM,
    ARGON2_TIME_COST, BACKUP_KEY_BYTES, BACKUP_NONCE_BYTES, BACKUP_SALT_BYTES,
};
use crate::domain::crypto::validate_mnemonic;
use crate::domain::storage::database::DatabaseOpenSpec;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::infrastructure::storage::{open_database, resolve_database_path};
use crate::model::actor::ActorRef;
use crate::model::chat::AttachmentPlaintextMetadata;
use crate::model::recovery::{
    OpaqueRecoveryArchiveManifest, OpaqueRecoveryArchiveSection, OpaqueRecoveryArchiveSectionKind,
};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use messaging_core::codec::verification::verify_authority_event;
use messaging_core::identity::enrollment::generate_fresh_device_identity_from_seed;
use messaging_core::identity::FreshDeviceEnrollment;
use messaging_core::proto::chat::{conversation_event, ConversationEvent};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const MESSAGING_RECOVERY_FORMAT_VERSION: u32 = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryMessageProjection {
    pub conversation_id: String,
    pub event_id: String,
    pub event_sequence: i64,
    pub authority_event_hash: Vec<u8>,
    pub message_id: String,
    pub sender_ptid: String,
    pub sender_device_id: String,
    pub plaintext: String,
    pub retracted: bool,
    pub committed_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryConversationProjection {
    pub conversation_id: String,
    pub authority_station_id: String,
    pub federation_id: String,
    pub kind: i32,
    pub name: String,
    pub owner_ptid: String,
    pub member_ptids: Vec<String>,
    pub member_roles: BTreeMap<String, i32>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub active: bool,
    pub updated_at_unix_ms: i64,
}

impl Zeroize for RecoveryConversationProjection {
    fn zeroize(&mut self) {
        self.conversation_id.zeroize();
        self.authority_station_id.zeroize();
        self.federation_id.zeroize();
        self.kind.zeroize();
        self.name.zeroize();
        self.owner_ptid.zeroize();
        self.member_ptids.zeroize();
        for (mut ptid, mut role) in std::mem::take(&mut self.member_roles) {
            ptid.zeroize();
            role.zeroize();
        }
        self.membership_epoch.zeroize();
        self.mls_epoch.zeroize();
        self.active.zeroize();
        self.updated_at_unix_ms.zeroize();
    }
}

impl Drop for RecoveryConversationProjection {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl ZeroizeOnDrop for RecoveryConversationProjection {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryRetentionFloor {
    pub station_peer_id: String,
    pub conversation_id: String,
    pub pruned_through_sequence: i64,
    pub authority_event_hash: Vec<u8>,
    pub policy_cutoff_unix_ms: Option<i64>,
    pub reason: String,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryAuthorityHead {
    pub conversation_id: String,
    pub event_sequence: i64,
    pub event_hash: Vec<u8>,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryMessageRedactionTombstone {
    pub conversation_id: String,
    pub message_id: String,
    pub kind: String,
    pub authority_sequence: i64,
    pub authority_event_hash: Vec<u8>,
    pub applied_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryAttachmentMetadata {
    pub message_id: String,
    pub attachment_id: String,
    pub metadata: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryTrustRecord {
    pub peer_ptid: String,
    pub fingerprint: String,
    pub verified_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct MessagingRecoveryArchive {
    pub ptid: String,
    pub actor_identity_seed: [u8; 32],
    pub actor_profile_version: u64,
    pub conversations: Vec<RecoveryConversationProjection>,
    pub messages: Vec<RecoveryMessageProjection>,
    pub retention_floors: Vec<RecoveryRetentionFloor>,
    pub authority_heads: Vec<RecoveryAuthorityHead>,
    pub redaction_tombstones: Vec<RecoveryMessageRedactionTombstone>,
    pub attachments: Vec<RecoveryAttachmentMetadata>,
    pub trust: Vec<RecoveryTrustRecord>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
pub struct RecoveryReconciliation {
    pub redactions: Vec<RecoveryMessageRedactionTombstone>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedRecoveryRevision {
    pub revision_id: String,
    pub format_version: u32,
    pub recovery_epoch: u64,
    pub bytes: Vec<u8>,
    pub sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedRecoveryRevision {
    pub recovery_epoch: u64,
    pub archive: MessagingRecoveryArchive,
}

#[derive(Serialize, Deserialize)]
struct RecoveryRevisionEnvelope {
    kdf: BackupKdfParameters,
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
    retention_floors: Vec<RecoveryRetentionFloor>,
    authority_heads: Vec<RecoveryAuthorityHead>,
    redaction_tombstones: Vec<RecoveryMessageRedactionTombstone>,
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
    retention_floors: &'a [RecoveryRetentionFloor],
    authority_heads: &'a [RecoveryAuthorityHead],
    redaction_tombstones: &'a [RecoveryMessageRedactionTombstone],
}

#[derive(Serialize)]
struct AttachmentSectionRef<'a> {
    attachments: &'a [RecoveryAttachmentMetadata],
}

#[derive(Serialize)]
struct TrustSectionRef<'a> {
    trust: &'a [RecoveryTrustRecord],
}

pub fn encode_recovery_revision(
    recovery_phrase: &str,
    revision_id: &str,
    created_by_device_id: &str,
    created_at_unix_ms: i64,
    recovery_epoch: u64,
    archive: &MessagingRecoveryArchive,
) -> Result<EncodedRecoveryRevision, String> {
    validate_archive_identity(recovery_phrase, revision_id, created_by_device_id, archive)?;
    if recovery_epoch == 0 || recovery_epoch > i64::MAX as u64 {
        return Err("messaging recovery epoch is invalid".to_string());
    }
    let mut salt = vec![0_u8; BACKUP_SALT_BYTES];
    OsRng.fill_bytes(&mut salt);
    let kdf = BackupKdfParameters {
        salt,
        memory_cost_kib: ARGON2_MEMORY_COST_KIB,
        time_cost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
        output_length: BACKUP_KEY_BYTES as u32,
    };
    let key = Zeroizing::new(
        derive_backup_key(recovery_phrase.as_bytes(), &kdf).map_err(|error| error.to_string())?,
    );
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
            retention_floors: &archive.retention_floors,
            authority_heads: &archive.authority_heads,
            redaction_tombstones: &archive.redaction_tombstones,
        },
        (archive.conversations.len()
            + archive.messages.len()
            + archive.retention_floors.len()
            + archive.authority_heads.len()
            + archive.redaction_tombstones.len()) as u64,
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
        actor: Some(ActorRef {
            ptid: archive.ptid.clone(),
            ..Default::default()
        }),
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

pub fn decode_recovery_revision(
    recovery_phrase: &str,
    expected_ptid: &str,
    expected_revision_id: &str,
    encoded: &[u8],
    expected_sha256: &[u8],
) -> Result<DecodedRecoveryRevision, String> {
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
    if envelope.recovery_epoch == 0 || envelope.recovery_epoch > i64::MAX as u64 {
        return Err("messaging recovery epoch is invalid".to_string());
    }
    let manifest = OpaqueRecoveryArchiveManifest::decode(envelope.manifest.as_slice())
        .map_err(|_| "messaging recovery manifest invalid")?;
    let manifest_ptid = manifest
        .actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .filter(|ptid| !ptid.trim().is_empty())
        .ok_or_else(|| "messaging recovery manifest actor is missing".to_string())?;
    if manifest.format_version != MESSAGING_RECOVERY_FORMAT_VERSION
        || manifest_ptid != expected_ptid
        || manifest.revision_id != expected_revision_id
        || manifest.archive_sha256.len() != 32
        || manifest_hash(&manifest) != manifest.archive_sha256
    {
        return Err("messaging recovery manifest binding is invalid".to_string());
    }
    let key = Zeroizing::new(
        derive_backup_key(recovery_phrase.as_bytes(), &envelope.kdf)
            .map_err(|_| "messaging recovery phrase or KDF invalid".to_string())?,
    );
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
        ptid: manifest_ptid.to_string(),
        actor_identity_seed: std::mem::take(&mut identity.seed),
        actor_profile_version: identity.profile_version,
        conversations: std::mem::take(&mut history.conversations),
        messages: std::mem::take(&mut history.messages),
        retention_floors: std::mem::take(&mut history.retention_floors),
        authority_heads: std::mem::take(&mut history.authority_heads),
        redaction_tombstones: std::mem::take(&mut history.redaction_tombstones),
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

// The profile Engine and every legacy connection to the same database must be
// stopped before this function is called.
pub fn restore_profile_database_atomically(
    profile_id: &str,
    archive: &MessagingRecoveryArchive,
    reconciliation: &RecoveryReconciliation,
) -> Result<FreshDeviceEnrollment, String> {
    validate_archive(archive)?;
    validate_reconciliation(archive, reconciliation)?;
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
        staging.apply_recovery_reconciliation(reconciliation)?;
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
    let message_keys = archive
        .messages
        .iter()
        .map(|message| {
            (
                message.conversation_id.as_str(),
                message.message_id.as_str(),
            )
        })
        .collect::<std::collections::HashSet<_>>();
    let conversation_station_by_id = archive
        .conversations
        .iter()
        .map(|conversation| {
            (
                conversation.conversation_id.as_str(),
                conversation.authority_station_id.as_str(),
            )
        })
        .collect::<std::collections::HashMap<_, _>>();
    let mut authority_head_by_conversation = std::collections::HashMap::new();
    for head in &archive.authority_heads {
        if authority_head_by_conversation
            .insert(head.conversation_id.as_str(), head)
            .is_some()
        {
            return Err("messaging recovery archive has duplicate authority heads".to_string());
        }
    }
    let mut retention_floor_by_conversation = std::collections::HashMap::new();
    for floor in &archive.retention_floors {
        if retention_floor_by_conversation
            .insert(
                floor.conversation_id.as_str(),
                floor.pruned_through_sequence,
            )
            .is_some()
        {
            return Err("messaging recovery archive has duplicate retention floors".to_string());
        }
    }
    let mut redaction_keys = std::collections::HashSet::new();
    for tombstone in &archive.redaction_tombstones {
        if !redaction_keys.insert((
            tombstone.conversation_id.as_str(),
            tombstone.message_id.as_str(),
            tombstone.kind.as_str(),
        )) {
            return Err(
                "messaging recovery archive has duplicate redaction tombstones".to_string(),
            );
        }
    }
    if archive.ptid.trim().is_empty()
        || archive.actor_profile_version == 0
        || archive.conversations.iter().any(|conversation| {
            conversation.conversation_id.trim().is_empty()
                || conversation.authority_station_id.trim().is_empty()
                || conversation.federation_id.trim().is_empty()
                || conversation.kind == 0
                || conversation.owner_ptid.trim().is_empty()
                || conversation.member_ptids.len() < 2
                || conversation.member_roles.len() != conversation.member_ptids.len()
                || conversation
                    .member_ptids
                    .iter()
                    .any(|ptid| !conversation.member_roles.contains_key(ptid))
                || conversation.member_roles.iter().any(|(ptid, role)| {
                    ptid.trim().is_empty()
                        || !matches!(
                            crate::model::chat::MemberRole::try_from(*role),
                            Ok(crate::model::chat::MemberRole::Member
                                | crate::model::chat::MemberRole::Admin
                                | crate::model::chat::MemberRole::Owner)
                        )
                })
                || !authority_head_by_conversation
                    .contains_key(conversation.conversation_id.as_str())
                || conversation.membership_epoch < 0
                || conversation.mls_epoch < 0
                || conversation.updated_at_unix_ms <= 0
        })
        || archive.messages.iter().any(|message| {
            message.conversation_id.trim().is_empty()
                || message.event_id.trim().is_empty()
                || message.event_sequence <= 0
                || message.authority_event_hash.len() != 32
                || message.authority_event_hash.iter().all(|byte| *byte == 0)
                || retention_floor_by_conversation
                    .get(message.conversation_id.as_str())
                    .is_some_and(|floor| message.event_sequence <= *floor)
                || message.message_id.trim().is_empty()
                || message.sender_ptid.trim().is_empty()
                || message.sender_device_id.trim().is_empty()
                || authority_head_by_conversation
                    .get(message.conversation_id.as_str())
                    .is_none_or(|head| {
                        message.event_sequence > head.event_sequence
                            || (message.event_sequence == head.event_sequence
                                && message.authority_event_hash != head.event_hash)
                    })
                || (message.retracted
                    && (!message.plaintext.is_empty()
                        || !redaction_keys.contains(&(
                            message.conversation_id.as_str(),
                            message.message_id.as_str(),
                            "retracted",
                        ))))
        })
        || archive.retention_floors.iter().any(|floor| {
            floor.station_peer_id.trim().is_empty()
                || floor.conversation_id.trim().is_empty()
                || conversation_station_by_id.get(floor.conversation_id.as_str())
                    != Some(&floor.station_peer_id.as_str())
                || floor.pruned_through_sequence <= 0
                || floor.authority_event_hash.len() != 32
                || floor.authority_event_hash.iter().all(|byte| *byte == 0)
                || !matches!(floor.reason.as_str(), "policy" | "manual_clear")
                || floor.updated_at_unix_ms <= 0
                || authority_head_by_conversation
                    .get(floor.conversation_id.as_str())
                    .is_none_or(|head| {
                        floor.pruned_through_sequence > head.event_sequence
                            || (floor.pruned_through_sequence == head.event_sequence
                                && floor.authority_event_hash != head.event_hash)
                    })
        })
        || archive.authority_heads.iter().any(|head| {
            head.conversation_id.trim().is_empty()
                || !conversation_station_by_id.contains_key(head.conversation_id.as_str())
                || head.event_sequence <= 0
                || head.event_hash.len() != 32
                || head.event_hash.iter().all(|byte| *byte == 0)
                || head.updated_at_unix_ms <= 0
        })
        || archive.redaction_tombstones.iter().any(|tombstone| {
            tombstone.conversation_id.trim().is_empty()
                || tombstone.message_id.trim().is_empty()
                || !matches!(tombstone.kind.as_str(), "hidden_for_actor" | "retracted")
                || !conversation_station_by_id.contains_key(tombstone.conversation_id.as_str())
                || tombstone.authority_sequence <= 0
                || tombstone.authority_event_hash.len() != 32
                || tombstone.authority_event_hash.iter().all(|byte| *byte == 0)
                || tombstone.applied_at_unix_ms <= 0
                || authority_head_by_conversation
                    .get(tombstone.conversation_id.as_str())
                    .is_none_or(|head| {
                        tombstone.authority_sequence > head.event_sequence
                            || (tombstone.authority_sequence == head.event_sequence
                                && tombstone.authority_event_hash != head.event_hash)
                    })
                || (tombstone.kind == "hidden_for_actor"
                    && message_keys.contains(&(
                        tombstone.conversation_id.as_str(),
                        tombstone.message_id.as_str(),
                    )))
                || (tombstone.kind == "retracted"
                    && archive.messages.iter().any(|message| {
                        message.conversation_id == tombstone.conversation_id
                            && message.message_id == tombstone.message_id
                            && (!message.retracted || !message.plaintext.is_empty())
                    }))
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

pub(super) fn fetch_recovery_events_to_target<F>(
    from_sequence: i64,
    target_sequence: i64,
    page_limit: i32,
    max_pages: usize,
    mut fetch_page: F,
) -> Result<Vec<ConversationEvent>, String>
where
    F: FnMut(i64, i32) -> Result<Vec<ConversationEvent>, String>,
{
    if from_sequence <= 0 || target_sequence < from_sequence || page_limit <= 0 || max_pages == 0 {
        return Err("messaging recovery reconciliation replay bound is invalid".to_string());
    }
    let mut events = Vec::new();
    let mut after_sequence = from_sequence;
    for _ in 0..max_pages {
        if after_sequence == target_sequence {
            return Ok(events);
        }
        let limit = i32::try_from((target_sequence - after_sequence).min(i64::from(page_limit)))
            .map_err(|_| "messaging recovery reconciliation page limit is invalid".to_string())?;
        let page = fetch_page(after_sequence, limit)?;
        if page.is_empty() {
            return Err(
                "messaging recovery reconciliation authority event log is incomplete".to_string(),
            );
        }
        if page.len() > limit as usize {
            return Err(
                "messaging recovery reconciliation authority event page exceeds target".to_string(),
            );
        }
        let next_sequence = page.last().map(|event| event.sequence).ok_or_else(|| {
            "messaging recovery reconciliation authority event log is incomplete".to_string()
        })?;
        if next_sequence <= after_sequence || next_sequence > target_sequence {
            return Err(
                "messaging recovery reconciliation authority event page is out of range"
                    .to_string(),
            );
        }
        after_sequence = next_sequence;
        events.extend(page);
    }
    Err("messaging recovery reconciliation exceeded authority replay bound".to_string())
}

pub(super) fn reconcile_archive_authority_events(
    archive: &MessagingRecoveryArchive,
    conversation_id: &str,
    target_sequence: i64,
    target_event_hash: &[u8],
    events: &[ConversationEvent],
) -> Result<Vec<RecoveryMessageRedactionTombstone>, String> {
    let conversation = archive
        .conversations
        .iter()
        .find(|conversation| conversation.conversation_id == conversation_id)
        .ok_or_else(|| "messaging recovery reconciliation conversation is missing".to_string())?;
    let authority_station_id = conversation.authority_station_id.clone();
    let head_index = archive
        .authority_heads
        .iter()
        .position(|head| head.conversation_id == conversation_id)
        .ok_or_else(|| "messaging recovery reconciliation authority head is missing".to_string())?;
    let mut sequence = archive.authority_heads[head_index].event_sequence;
    let mut event_hash = archive.authority_heads[head_index].event_hash.clone();
    if target_sequence < sequence
        || target_event_hash.len() != 32
        || target_event_hash.iter().all(|byte| *byte == 0)
    {
        return Err("messaging recovery reconciliation authority target is invalid".to_string());
    }
    let mut redactions = Vec::new();

    for event in events {
        verify_authority_event(event)?;
        if event.conversation_id != conversation_id
            || event.authority_station_peer_id != authority_station_id
            || event.sequence != sequence + 1
            || event.previous_hash != event_hash
        {
            return Err(
                "messaging recovery reconciliation authority chain is not contiguous".to_string(),
            );
        }
        match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageRetracted(fact)) => {
                upsert_reconciliation_redaction(
                    &mut redactions,
                    conversation_id,
                    &fact.message_id,
                    "retracted",
                    event,
                    event_timestamp_unix_ms(event)?,
                )?;
            }
            Some(conversation_event::Payload::MessageHiddenForActor(fact))
                if fact.actor_ptid == archive.ptid =>
            {
                upsert_reconciliation_redaction(
                    &mut redactions,
                    conversation_id,
                    &fact.message_id,
                    "hidden_for_actor",
                    event,
                    event_timestamp_unix_ms(event)?,
                )?;
            }
            _ => {}
        }
        sequence = event.sequence;
        event_hash.clone_from(&event.event_hash);
    }

    if sequence != target_sequence || event_hash != target_event_hash {
        return Err(
            "messaging recovery reconciliation did not reach the authority snapshot".to_string(),
        );
    }
    Ok(redactions)
}

fn upsert_reconciliation_redaction(
    redactions: &mut Vec<RecoveryMessageRedactionTombstone>,
    conversation_id: &str,
    message_id: &str,
    kind: &str,
    event: &ConversationEvent,
    applied_at_unix_ms: i64,
) -> Result<(), String> {
    if message_id.trim().is_empty() {
        return Err("messaging recovery redaction target is missing".to_string());
    }
    if !matches!(kind, "retracted" | "hidden_for_actor") {
        return Err("messaging recovery redaction kind is invalid".to_string());
    }
    let tombstone = RecoveryMessageRedactionTombstone {
        conversation_id: conversation_id.to_string(),
        message_id: message_id.to_string(),
        kind: kind.to_string(),
        authority_sequence: event.sequence,
        authority_event_hash: event.event_hash.clone(),
        applied_at_unix_ms,
    };
    if let Some(existing) = redactions.iter_mut().find(|existing| {
        existing.conversation_id == conversation_id
            && existing.message_id == message_id
            && existing.kind == kind
    }) {
        *existing = tombstone;
    } else {
        redactions.push(tombstone);
    }
    Ok(())
}

fn validate_reconciliation(
    archive: &MessagingRecoveryArchive,
    reconciliation: &RecoveryReconciliation,
) -> Result<(), String> {
    let heads = archive
        .authority_heads
        .iter()
        .map(|head| (head.conversation_id.as_str(), head.event_sequence))
        .collect::<std::collections::HashMap<_, _>>();
    let mut keys = std::collections::HashSet::new();
    if reconciliation.redactions.iter().any(|redaction| {
        redaction.conversation_id.trim().is_empty()
            || redaction.message_id.trim().is_empty()
            || !matches!(redaction.kind.as_str(), "hidden_for_actor" | "retracted")
            || redaction.authority_sequence
                <= heads
                    .get(redaction.conversation_id.as_str())
                    .copied()
                    .unwrap_or(i64::MAX)
            || redaction.authority_event_hash.len() != 32
            || redaction.authority_event_hash.iter().all(|byte| *byte == 0)
            || redaction.applied_at_unix_ms <= 0
            || !keys.insert((
                redaction.conversation_id.as_str(),
                redaction.message_id.as_str(),
                redaction.kind.as_str(),
            ))
    }) {
        return Err("messaging recovery reconciliation is invalid".to_string());
    }
    Ok(())
}

fn event_timestamp_unix_ms(event: &ConversationEvent) -> Result<i64, String> {
    let timestamp = event
        .committed_at
        .as_ref()
        .ok_or_else(|| "messaging recovery authority event timestamp is missing".to_string())?;
    if timestamp.seconds < 0 || !(0..1_000_000_000).contains(&timestamp.nanos) {
        return Err("messaging recovery authority event timestamp is invalid".to_string());
    }
    timestamp
        .seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(timestamp.nanos) / 1_000_000))
        .filter(|value| *value > 0)
        .ok_or_else(|| "messaging recovery authority event timestamp is invalid".to_string())
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
                        manifest
                            .actor
                            .as_ref()
                            .map(|actor| actor.ptid.as_str())
                            .unwrap_or_default(),
                        &manifest.revision_id,
                        kind,
                    ),
                },
            )
            .map_err(|_| "messaging recovery phrase or section integrity invalid")?,
    );
    serde_json::from_slice(&plaintext).map_err(|_| "messaging recovery section invalid".to_string())
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

    #[test]
    fn recovery_secret_bearing_types_zeroize_on_drop() {
        fn require_zeroize_on_drop<T: ZeroizeOnDrop>() {}

        require_zeroize_on_drop::<RecoveryMessageProjection>();
        require_zeroize_on_drop::<RecoveryRetentionFloor>();
        require_zeroize_on_drop::<RecoveryAuthorityHead>();
        require_zeroize_on_drop::<RecoveryMessageRedactionTombstone>();
        require_zeroize_on_drop::<RecoveryReconciliation>();
        require_zeroize_on_drop::<RecoveryConversationProjection>();
        require_zeroize_on_drop::<RecoveryAttachmentMetadata>();
        require_zeroize_on_drop::<RecoveryTrustRecord>();
        require_zeroize_on_drop::<MessagingRecoveryArchive>();
        require_zeroize_on_drop::<ActorIdentitySection>();
        require_zeroize_on_drop::<MessageHistorySection>();
        require_zeroize_on_drop::<AttachmentSection>();
        require_zeroize_on_drop::<TrustSection>();
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
                event_id: "event-7".to_string(),
                event_sequence: 7,
                authority_event_hash: vec![7; 32],
                message_id: "message-1".to_string(),
                sender_ptid: "ptid:bob".to_string(),
                sender_device_id: "bob-device".to_string(),
                plaintext: "exact plaintext".to_string(),
                retracted: false,
                committed_at_unix_ms: 10,
            }],
            retention_floors: vec![RecoveryRetentionFloor {
                station_peer_id: "station-local".to_string(),
                conversation_id: "conversation-1".to_string(),
                pruned_through_sequence: 6,
                authority_event_hash: vec![6; 32],
                policy_cutoff_unix_ms: Some(60),
                reason: "policy".to_string(),
                updated_at_unix_ms: 70,
            }],
            authority_heads: vec![RecoveryAuthorityHead {
                conversation_id: "conversation-1".to_string(),
                event_sequence: 7,
                event_hash: vec![7; 32],
                updated_at_unix_ms: 10,
            }],
            redaction_tombstones: Vec::new(),
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
    fn recovery_v4_rejects_conversation_projection_without_required_scope() {
        let legacy = serde_json::json!({
            "conversation_id": "conversation-1",
            "authority_station_id": "station-local",
            "kind": 2,
            "name": "Legacy group",
            "owner_ptid": "ptid:alice",
            "member_ptids": ["ptid:alice", "ptid:bob"],
            "membership_epoch": 1,
            "mls_epoch": 1,
            "active": true,
            "updated_at_unix_ms": 100,
        });

        assert!(serde_json::from_value::<RecoveryConversationProjection>(legacy).is_err());

        let mut invalid = archive();
        invalid.conversations[0].federation_id.clear();
        assert!(validate_archive(&invalid).is_err());
        invalid.conversations[0].federation_id = "federation-1".to_string();
        invalid.conversations[0].member_roles.clear();
        assert!(validate_archive(&invalid).is_err());
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
    fn redacted_history_requires_a_tombstone_and_contains_no_plaintext() {
        let mut redacted = archive();
        redacted.messages[0].plaintext.clear();
        redacted.messages[0].retracted = true;
        redacted.redaction_tombstones = vec![RecoveryMessageRedactionTombstone {
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            kind: "retracted".to_string(),
            authority_sequence: 8,
            authority_event_hash: vec![8; 32],
            applied_at_unix_ms: 20,
        }];
        redacted.authority_heads[0] = RecoveryAuthorityHead {
            conversation_id: "conversation-1".to_string(),
            event_sequence: 8,
            event_hash: vec![8; 32],
            updated_at_unix_ms: 20,
        };
        assert!(validate_archive(&redacted).is_ok());

        redacted.messages[0].plaintext = "must not survive".to_string();
        assert!(validate_archive(&redacted).is_err());
        redacted.messages[0].plaintext.clear();
        redacted.redaction_tombstones.clear();
        assert!(validate_archive(&redacted).is_err());
    }

    #[test]
    fn actor_hidden_history_cannot_remain_in_the_archive() {
        let mut hidden = archive();
        hidden.redaction_tombstones = vec![RecoveryMessageRedactionTombstone {
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            kind: "hidden_for_actor".to_string(),
            authority_sequence: 8,
            authority_event_hash: vec![8; 32],
            applied_at_unix_ms: 20,
        }];
        hidden.authority_heads[0] = RecoveryAuthorityHead {
            conversation_id: "conversation-1".to_string(),
            event_sequence: 8,
            event_hash: vec![8; 32],
            updated_at_unix_ms: 20,
        };

        assert!(validate_archive(&hidden).is_err());
        hidden.messages.clear();
        hidden.attachments.clear();
        assert!(validate_archive(&hidden).is_ok());
    }

    #[test]
    fn newer_authority_redactions_are_captured_without_advancing_the_archive_head() {
        let archived = archive();
        let mut retract = ConversationEvent {
            event_id: "event-retract".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 8,
            command_id: "command-retract".to_string(),
            previous_hash: vec![7; 32],
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageRetracted(
                messaging_core::proto::chat::MessageRetractedFact {
                    message_id: "message-1".to_string(),
                    ..Default::default()
                },
            )),
            ..Default::default()
        };
        retract.event_hash = Sha256::digest(retract.encode_to_vec()).to_vec();
        let mut trailing = ConversationEvent {
            event_id: "event-trailing".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 9,
            command_id: "command-trailing".to_string(),
            previous_hash: retract.event_hash.clone(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 2,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            ..Default::default()
        };
        trailing.event_hash = Sha256::digest(trailing.encode_to_vec()).to_vec();
        let trailing_hash = trailing.event_hash.clone();

        let redactions = reconcile_archive_authority_events(
            &archived,
            "conversation-1",
            9,
            &trailing_hash,
            &[retract, trailing],
        )
        .unwrap();

        assert_eq!(redactions.len(), 1);
        assert_eq!(redactions[0].kind, "retracted");
        assert_eq!(redactions[0].authority_sequence, 8);
        assert_eq!(archived.messages[0].plaintext, "exact plaintext");
        assert!(!archived.messages[0].retracted);
        assert_eq!(archived.attachments.len(), 1);
        assert_eq!(archived.authority_heads[0].event_sequence, 7);
        assert_eq!(archived.authority_heads[0].event_hash, vec![7; 32]);
    }

    #[test]
    fn actor_hide_reconciliation_is_idempotent_and_removes_recoverable_content() {
        let archived = archive();
        let mut hidden = ConversationEvent {
            event_id: "event-hidden".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 8,
            command_id: "command-hidden".to_string(),
            previous_hash: vec![7; 32],
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageHiddenForActor(
                messaging_core::proto::chat::MessageHiddenForActorFact {
                    message_id: "message-1".to_string(),
                    actor_ptid: "ptid:alice".to_string(),
                    ..Default::default()
                },
            )),
            ..Default::default()
        };
        hidden.event_hash = Sha256::digest(hidden.encode_to_vec()).to_vec();
        let mut repeated = ConversationEvent {
            event_id: "event-hidden-repeated".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 9,
            command_id: "command-hidden-repeated".to_string(),
            previous_hash: hidden.event_hash.clone(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 2,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageHiddenForActor(
                messaging_core::proto::chat::MessageHiddenForActorFact {
                    message_id: "message-1".to_string(),
                    actor_ptid: "ptid:alice".to_string(),
                    ..Default::default()
                },
            )),
            ..Default::default()
        };
        repeated.event_hash = Sha256::digest(repeated.encode_to_vec()).to_vec();
        let repeated_hash = repeated.event_hash.clone();

        let redactions = reconcile_archive_authority_events(
            &archived,
            "conversation-1",
            9,
            &repeated_hash,
            &[hidden, repeated],
        )
        .unwrap();

        assert_eq!(redactions.len(), 1);
        assert_eq!(redactions[0].kind, "hidden_for_actor");
        assert_eq!(redactions[0].authority_sequence, 9);
        assert_eq!(redactions[0].authority_event_hash, repeated_hash);
        assert_eq!(archived.authority_heads[0].event_sequence, 7);
    }

    #[test]
    fn reconciliation_rejects_a_broken_authority_chain() {
        let archived = archive();
        let mut broken = ConversationEvent {
            event_id: "event-broken".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 8,
            command_id: "command-broken".to_string(),
            previous_hash: vec![6; 32],
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            ..Default::default()
        };
        broken.event_hash = Sha256::digest(broken.encode_to_vec()).to_vec();

        let target_hash = broken.event_hash.clone();
        let error = reconcile_archive_authority_events(
            &archived,
            "conversation-1",
            8,
            &target_hash,
            &[broken],
        )
        .unwrap_err();

        assert!(error.contains("authority chain is not contiguous"));
    }

    #[test]
    fn reconciliation_requires_the_exact_snapshotted_authority_head() {
        let archived = archive();
        let mut event = ConversationEvent {
            event_id: "event-8".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 8,
            command_id: "command-8".to_string(),
            previous_hash: vec![7; 32],
            authority_station_peer_id: "station-local".to_string(),
            ..Default::default()
        };
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();

        let error =
            reconcile_archive_authority_events(&archived, "conversation-1", 8, &[9; 32], &[event])
                .unwrap_err();

        assert!(error.contains("did not reach the authority snapshot"));
    }

    #[test]
    fn recovery_replay_continues_after_short_pages_until_the_snapshot() {
        let mut pages = std::collections::VecDeque::from([
            vec![ConversationEvent {
                sequence: 8,
                ..Default::default()
            }],
            vec![ConversationEvent {
                sequence: 9,
                ..Default::default()
            }],
        ]);
        let mut calls = Vec::new();

        let events = fetch_recovery_events_to_target(7, 9, 500, 3, |after, limit| {
            calls.push((after, limit));
            Ok(pages.pop_front().unwrap_or_default())
        })
        .unwrap();

        assert_eq!(calls, vec![(7, 2), (8, 1)]);
        assert_eq!(
            events
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![8, 9]
        );
    }

    #[test]
    fn recovery_replay_fails_when_the_snapshotted_range_disappears_or_is_overshot() {
        let incomplete =
            fetch_recovery_events_to_target(7, 9, 500, 3, |_, _| Ok(Vec::new())).unwrap_err();
        assert!(incomplete.contains("event log is incomplete"));

        let overshot = fetch_recovery_events_to_target(7, 9, 500, 3, |_, _| {
            Ok(vec![ConversationEvent {
                sequence: 10,
                ..Default::default()
            }])
        })
        .unwrap_err();
        assert!(overshot.contains("page is out of range"));
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
