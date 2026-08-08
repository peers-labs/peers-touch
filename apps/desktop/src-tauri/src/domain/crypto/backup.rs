//! Recovery backup codec.
//!
//! Backups contain actor-owned, device-independent data only. Device signing
//! keys, pre-keys, Double Ratchet state, outbox entries, and MLS state are
//! intentionally absent.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroize;

use super::error::CryptoError;

pub const BACKUP_FORMAT_VERSION: u32 = 1;
pub const ARGON2_MEMORY_COST_KIB: u32 = 65_536;
pub const ARGON2_TIME_COST: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 1;
pub const BACKUP_KEY_BYTES: usize = 32;
pub const BACKUP_SALT_BYTES: usize = 16;
pub const BACKUP_NONCE_BYTES: usize = 12;
pub const BACKUP_TAG_BYTES: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupKdfParameters {
    pub salt: Vec<u8>,
    pub memory_cost_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
    pub output_length: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecoveryMessage {
    pub scope: String,
    pub conversation_id: String,
    pub message_id: String,
    pub sender_ptid: String,
    pub content: String,
    pub reply_to_message_id: String,
    pub thread_root_message_id: String,
    pub sent_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecoveryConversation {
    pub scope: String,
    pub conversation_id: String,
    pub metadata: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AttachmentDecryptionMetadata {
    pub message_id: String,
    pub attachment_id: String,
    pub metadata: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerifiedFingerprint {
    pub peer_ptid: String,
    pub fingerprint: String,
    pub verified_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecoverySnapshot {
    pub format_version: u32,
    pub ptid: String,
    pub actor_identity_seed: [u8; 32],
    pub messages: Vec<RecoveryMessage>,
    pub conversations: Vec<RecoveryConversation>,
    pub attachments: Vec<AttachmentDecryptionMetadata>,
    pub verified_fingerprints: Vec<VerifiedFingerprint>,
}

impl RecoverySnapshot {
    pub fn validate(&self, expected_ptid: &str) -> Result<(), CryptoError> {
        if self.format_version != BACKUP_FORMAT_VERSION
            || expected_ptid.trim().is_empty()
            || self.ptid != expected_ptid
        {
            return Err(CryptoError::BackupDecryptionFailed);
        }
        if self.messages.iter().any(|message| {
            message.message_id.trim().is_empty()
                || message.conversation_id.trim().is_empty()
                || !matches!(message.scope.as_str(), "friend" | "group")
        }) {
            return Err(CryptoError::BackupDecryptionFailed);
        }
        if self.conversations.iter().any(|conversation| {
            conversation.conversation_id.trim().is_empty()
                || !matches!(conversation.scope.as_str(), "friend" | "group")
        }) {
            return Err(CryptoError::BackupDecryptionFailed);
        }
        if self.attachments.iter().any(|attachment| {
            attachment.message_id.trim().is_empty() || attachment.attachment_id.trim().is_empty()
        }) {
            return Err(CryptoError::BackupDecryptionFailed);
        }
        if self.verified_fingerprints.iter().any(|fingerprint| {
            fingerprint.peer_ptid.trim().is_empty() || fingerprint.fingerprint.trim().is_empty()
        }) {
            return Err(CryptoError::BackupDecryptionFailed);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedBackup {
    pub encrypted_blob: Vec<u8>,
    pub nonce: [u8; BACKUP_NONCE_BYTES],
    pub integrity_tag: [u8; BACKUP_TAG_BYTES],
    pub kdf: BackupKdfParameters,
}

fn backup_aad(ptid: &str) -> Vec<u8> {
    format!("peers-touch:recovery-backup:{BACKUP_FORMAT_VERSION}:{ptid}").into_bytes()
}

pub fn derive_backup_key(
    recovery_phrase: &[u8],
    kdf: &BackupKdfParameters,
) -> Result<[u8; BACKUP_KEY_BYTES], CryptoError> {
    if kdf.salt.len() != BACKUP_SALT_BYTES
        || kdf.memory_cost_kib != ARGON2_MEMORY_COST_KIB
        || kdf.time_cost != ARGON2_TIME_COST
        || kdf.parallelism != ARGON2_PARALLELISM
        || kdf.output_length != BACKUP_KEY_BYTES as u32
    {
        return Err(CryptoError::BackupDerivationFailed(
            "unsupported backup KDF parameters".into(),
        ));
    }
    let params = Params::new(
        kdf.memory_cost_kib,
        kdf.time_cost,
        kdf.parallelism,
        Some(kdf.output_length as usize),
    )
    .map_err(|error| CryptoError::BackupDerivationFailed(error.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; BACKUP_KEY_BYTES];
    argon2
        .hash_password_into(recovery_phrase, &kdf.salt, &mut key)
        .map_err(|error| CryptoError::BackupDerivationFailed(error.to_string()))?;
    Ok(key)
}

pub fn encrypt_snapshot(
    recovery_phrase: &str,
    snapshot: &RecoverySnapshot,
) -> Result<EncryptedBackup, CryptoError> {
    snapshot.validate(&snapshot.ptid)?;
    let plaintext = serde_json::to_vec(snapshot)
        .map_err(|error| CryptoError::InternalError(format!("serialize backup: {error}")))?;

    let mut salt = vec![0u8; BACKUP_SALT_BYTES];
    OsRng.fill_bytes(&mut salt);
    let kdf = BackupKdfParameters {
        salt,
        memory_cost_kib: ARGON2_MEMORY_COST_KIB,
        time_cost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
        output_length: BACKUP_KEY_BYTES as u32,
    };
    let mut key = derive_backup_key(recovery_phrase.as_bytes(), &kdf)?;
    let mut nonce = [0u8; BACKUP_NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| CryptoError::BackupDerivationFailed("AES initialization failed".into()))?;
    let mut ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &backup_aad(&snapshot.ptid),
            },
        )
        .map_err(|_| CryptoError::BackupDerivationFailed("backup encryption failed".into()))?;
    key.zeroize();

    if ciphertext.len() < BACKUP_TAG_BYTES {
        return Err(CryptoError::InternalError(
            "backup encryption returned no integrity tag".into(),
        ));
    }
    let tag_offset = ciphertext.len() - BACKUP_TAG_BYTES;
    let tag = ciphertext.split_off(tag_offset);
    let mut integrity_tag = [0u8; BACKUP_TAG_BYTES];
    integrity_tag.copy_from_slice(&tag);
    Ok(EncryptedBackup {
        encrypted_blob: ciphertext,
        nonce,
        integrity_tag,
        kdf,
    })
}

pub fn decrypt_snapshot(
    recovery_phrase: &str,
    expected_ptid: &str,
    encrypted: &EncryptedBackup,
) -> Result<RecoverySnapshot, CryptoError> {
    if encrypted.encrypted_blob.is_empty() {
        return Err(CryptoError::BackupDecryptionFailed);
    }
    let mut key = derive_backup_key(recovery_phrase.as_bytes(), &encrypted.kdf)
        .map_err(|_| CryptoError::BackupDecryptionFailed)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::BackupDecryptionFailed)?;
    let mut ciphertext_and_tag =
        Vec::with_capacity(encrypted.encrypted_blob.len() + BACKUP_TAG_BYTES);
    ciphertext_and_tag.extend_from_slice(&encrypted.encrypted_blob);
    ciphertext_and_tag.extend_from_slice(&encrypted.integrity_tag);
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&encrypted.nonce),
            Payload {
                msg: &ciphertext_and_tag,
                aad: &backup_aad(expected_ptid),
            },
        )
        .map_err(|_| CryptoError::BackupDecryptionFailed)?;
    key.zeroize();

    let snapshot: RecoverySnapshot =
        serde_json::from_slice(&plaintext).map_err(|_| CryptoError::BackupDecryptionFailed)?;
    snapshot.validate(expected_ptid)?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    fn snapshot() -> RecoverySnapshot {
        RecoverySnapshot {
            format_version: BACKUP_FORMAT_VERSION,
            ptid: "ptid:alice".into(),
            actor_identity_seed: [42; 32],
            messages: vec![RecoveryMessage {
                scope: "friend".into(),
                conversation_id: "conversation-1".into(),
                message_id: "message-1".into(),
                sender_ptid: "ptid:alice".into(),
                content: "exact plaintext".into(),
                reply_to_message_id: String::new(),
                thread_root_message_id: String::new(),
                sent_at_unix_ms: 7,
            }],
            conversations: vec![RecoveryConversation {
                scope: "friend".into(),
                conversation_id: "conversation-1".into(),
                metadata: serde_json::json!({"peerPtid": "ptid:bob"}),
            }],
            attachments: vec![AttachmentDecryptionMetadata {
                message_id: "message-1".into(),
                attachment_id: "cid-1".into(),
                metadata: serde_json::json!({"keyB64": "secret", "nonceB64": "nonce"}),
            }],
            verified_fingerprints: vec![VerifiedFingerprint {
                peer_ptid: "ptid:bob".into(),
                fingerprint: "abcd".into(),
                verified_at_unix_ms: 8,
            }],
        }
    }

    #[test]
    fn recovery_snapshot_round_trips_every_recoverable_data_class() {
        let expected = snapshot();
        let encrypted = encrypt_snapshot(PHRASE, &expected).expect("encrypt");
        let actual = decrypt_snapshot(PHRASE, "ptid:alice", &encrypted).expect("decrypt snapshot");
        assert_eq!(actual, expected);
    }

    #[test]
    fn wrong_phrase_or_actor_fails_closed() {
        let encrypted = encrypt_snapshot(PHRASE, &snapshot()).expect("encrypt");
        assert!(decrypt_snapshot("wrong phrase", "ptid:alice", &encrypted).is_err());
        assert!(decrypt_snapshot(PHRASE, "ptid:bob", &encrypted).is_err());
    }

    #[test]
    fn tampered_ciphertext_restores_nothing() {
        let mut encrypted = encrypt_snapshot(PHRASE, &snapshot()).expect("encrypt");
        encrypted.encrypted_blob[0] ^= 0x80;
        assert!(decrypt_snapshot(PHRASE, "ptid:alice", &encrypted).is_err());
    }
}
