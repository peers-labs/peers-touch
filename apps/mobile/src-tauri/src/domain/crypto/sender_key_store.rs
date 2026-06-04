//! Secure persistence for Mobile group Sender Keys.
//!
//! Mobile does not have Desktop's SQLCipher-backed local chat store yet.
//! This module stores sender chains and skipped message keys in the
//! platform secure storage namespace with explicit indexes so the crypto
//! command layer can load exact/latest/max records without scanning the
//! whole Keychain.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::domain::crypto::sender_keys::{SenderChainState, SkippedMessageKey};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

const STORE_VERSION: u32 = 1;
const KEY_PREFIX: &str = "group-sender-key";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChainIndexEntry {
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    has_signing_seed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChainRecord {
    version: u32,
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    chain_key: Vec<u8>,
    counter: u32,
    signing_seed: Option<Vec<u8>>,
    verifying_key: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkippedIndexEntry {
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    counter: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkippedRecord {
    version: u32,
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    counter: u32,
    key: Vec<u8>,
    nonce: Vec<u8>,
}

pub fn save_group_sender_chain(
    storage: &SecureStorage,
    user_scope: &str,
    chain: &SenderChainState,
) -> MobileResult<()> {
    let record = ChainRecord::from_chain(chain);
    storage.set(
        &chain_key(
            user_scope,
            &record.group_ulid,
            &record.sender_did,
            record.sender_key_id,
        ),
        &encode_json(&record)?,
    )?;
    upsert_chain_index(storage, user_scope, chain)
}

pub fn load_group_sender_chain(
    storage: &SecureStorage,
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
    sender_key_id: u32,
) -> MobileResult<Option<SenderChainState>> {
    let Some(raw) = storage.get(&chain_key(
        user_scope,
        group_ulid,
        sender_did,
        sender_key_id,
    ))?
    else {
        return Ok(None);
    };
    let record: ChainRecord = decode_json(&raw)?;
    record.into_chain().map(Some)
}

pub fn latest_local_sender_chain(
    storage: &SecureStorage,
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
) -> MobileResult<Option<SenderChainState>> {
    let mut candidates = load_chain_index(storage, user_scope)?;
    candidates.retain(|entry| {
        entry.group_ulid == group_ulid && entry.sender_did == sender_did && entry.has_signing_seed
    });
    candidates.sort_by(|a, b| b.sender_key_id.cmp(&a.sender_key_id));
    for entry in candidates {
        if let Some(chain) = load_group_sender_chain(
            storage,
            user_scope,
            &entry.group_ulid,
            &entry.sender_did,
            entry.sender_key_id,
        )? {
            return Ok(Some(chain));
        }
    }
    Ok(None)
}

pub fn max_sender_key_id(
    storage: &SecureStorage,
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
) -> MobileResult<Option<u32>> {
    Ok(load_chain_index(storage, user_scope)?
        .into_iter()
        .filter(|entry| entry.group_ulid == group_ulid && entry.sender_did == sender_did)
        .map(|entry| entry.sender_key_id)
        .max())
}

pub fn load_group_skipped_keys(
    storage: &SecureStorage,
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
    sender_key_id: u32,
) -> MobileResult<BTreeMap<u32, SkippedMessageKey>> {
    let mut out = BTreeMap::new();
    for entry in load_skipped_index(storage, user_scope)? {
        if entry.group_ulid != group_ulid
            || entry.sender_did != sender_did
            || entry.sender_key_id != sender_key_id
        {
            continue;
        }
        let Some(raw) = storage.get(&skipped_key(
            user_scope,
            &entry.group_ulid,
            &entry.sender_did,
            entry.sender_key_id,
            entry.counter,
        ))?
        else {
            continue;
        };
        let record: SkippedRecord = decode_json(&raw)?;
        out.insert(record.counter, record.into_skipped()?);
    }
    Ok(out)
}

pub fn apply_group_decrypt_outcome(
    storage: &SecureStorage,
    user_scope: &str,
    chain: &SenderChainState,
    new_skipped: &[SkippedMessageKey],
    consumed_counter: Option<u32>,
) -> MobileResult<()> {
    for skipped in new_skipped {
        save_skipped_key(storage, user_scope, skipped)?;
    }
    save_group_sender_chain(storage, user_scope, chain)?;
    if let Some(counter) = consumed_counter {
        remove_skipped_key(
            storage,
            user_scope,
            &chain.group_ulid,
            &chain.sender_did,
            chain.sender_key_id,
            counter,
        )?;
    }
    Ok(())
}

fn save_skipped_key(
    storage: &SecureStorage,
    user_scope: &str,
    skipped: &SkippedMessageKey,
) -> MobileResult<()> {
    let record = SkippedRecord::from_skipped(skipped);
    storage.set(
        &skipped_key(
            user_scope,
            &record.group_ulid,
            &record.sender_did,
            record.sender_key_id,
            record.counter,
        ),
        &encode_json(&record)?,
    )?;
    upsert_skipped_index(storage, user_scope, skipped)
}

fn remove_skipped_key(
    storage: &SecureStorage,
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
    sender_key_id: u32,
    counter: u32,
) -> MobileResult<()> {
    storage.remove(&skipped_key(
        user_scope,
        group_ulid,
        sender_did,
        sender_key_id,
        counter,
    ))?;
    let mut index = load_skipped_index(storage, user_scope)?;
    index.retain(|entry| {
        !(entry.group_ulid == group_ulid
            && entry.sender_did == sender_did
            && entry.sender_key_id == sender_key_id
            && entry.counter == counter)
    });
    storage.set(&skipped_index_key(user_scope), &encode_json(&index)?)
}

fn upsert_chain_index(
    storage: &SecureStorage,
    user_scope: &str,
    chain: &SenderChainState,
) -> MobileResult<()> {
    let mut index = load_chain_index(storage, user_scope)?;
    index.retain(|entry| {
        !(entry.group_ulid == chain.group_ulid
            && entry.sender_did == chain.sender_did
            && entry.sender_key_id == chain.sender_key_id)
    });
    index.push(ChainIndexEntry {
        group_ulid: chain.group_ulid.clone(),
        sender_did: chain.sender_did.clone(),
        sender_key_id: chain.sender_key_id,
        has_signing_seed: chain.signing_seed.is_some(),
    });
    storage.set(&chain_index_key(user_scope), &encode_json(&index)?)
}

fn upsert_skipped_index(
    storage: &SecureStorage,
    user_scope: &str,
    skipped: &SkippedMessageKey,
) -> MobileResult<()> {
    let mut index = load_skipped_index(storage, user_scope)?;
    index.retain(|entry| {
        !(entry.group_ulid == skipped.group_ulid
            && entry.sender_did == skipped.sender_did
            && entry.sender_key_id == skipped.sender_key_id
            && entry.counter == skipped.counter)
    });
    index.push(SkippedIndexEntry {
        group_ulid: skipped.group_ulid.clone(),
        sender_did: skipped.sender_did.clone(),
        sender_key_id: skipped.sender_key_id,
        counter: skipped.counter,
    });
    storage.set(&skipped_index_key(user_scope), &encode_json(&index)?)
}

fn load_chain_index(
    storage: &SecureStorage,
    user_scope: &str,
) -> MobileResult<Vec<ChainIndexEntry>> {
    decode_optional_json(storage.get(&chain_index_key(user_scope))?)
}

fn load_skipped_index(
    storage: &SecureStorage,
    user_scope: &str,
) -> MobileResult<Vec<SkippedIndexEntry>> {
    decode_optional_json(storage.get(&skipped_index_key(user_scope))?)
}

impl ChainRecord {
    fn from_chain(chain: &SenderChainState) -> Self {
        Self {
            version: STORE_VERSION,
            group_ulid: chain.group_ulid.clone(),
            sender_did: chain.sender_did.clone(),
            sender_key_id: chain.sender_key_id,
            chain_key: chain.chain_key.to_vec(),
            counter: chain.counter,
            signing_seed: chain.signing_seed.map(|seed| seed.to_vec()),
            verifying_key: chain.verifying_key.to_vec(),
        }
    }

    fn into_chain(self) -> MobileResult<SenderChainState> {
        if self.version != STORE_VERSION {
            return Err(MobileError::secure_storage(format!(
                "unsupported group sender-key store version: {}",
                self.version
            )));
        }
        Ok(SenderChainState {
            group_ulid: self.group_ulid,
            sender_did: self.sender_did,
            sender_key_id: self.sender_key_id,
            chain_key: bytes32(self.chain_key, "chain_key")?,
            counter: self.counter,
            signing_seed: optional_bytes32(self.signing_seed, "signing_seed")?,
            verifying_key: bytes32(self.verifying_key, "verifying_key")?,
        })
    }
}

impl SkippedRecord {
    fn from_skipped(skipped: &SkippedMessageKey) -> Self {
        Self {
            version: STORE_VERSION,
            group_ulid: skipped.group_ulid.clone(),
            sender_did: skipped.sender_did.clone(),
            sender_key_id: skipped.sender_key_id,
            counter: skipped.counter,
            key: skipped.key.to_vec(),
            nonce: skipped.nonce.to_vec(),
        }
    }

    fn into_skipped(self) -> MobileResult<SkippedMessageKey> {
        if self.version != STORE_VERSION {
            return Err(MobileError::secure_storage(format!(
                "unsupported group skipped-key store version: {}",
                self.version
            )));
        }
        Ok(SkippedMessageKey {
            group_ulid: self.group_ulid,
            sender_did: self.sender_did,
            sender_key_id: self.sender_key_id,
            counter: self.counter,
            key: bytes32(self.key, "skipped key")?,
            nonce: bytes12(self.nonce, "skipped nonce")?,
        })
    }
}

fn bytes32(value: Vec<u8>, field: &str) -> MobileResult<[u8; 32]> {
    value.try_into().map_err(|value: Vec<u8>| {
        MobileError::secure_storage(format!("{field} must be 32 bytes, got {}", value.len()))
    })
}

fn optional_bytes32(value: Option<Vec<u8>>, field: &str) -> MobileResult<Option<[u8; 32]>> {
    value.map(|entry| bytes32(entry, field)).transpose()
}

fn bytes12(value: Vec<u8>, field: &str) -> MobileResult<[u8; 12]> {
    value.try_into().map_err(|value: Vec<u8>| {
        MobileError::secure_storage(format!("{field} must be 12 bytes, got {}", value.len()))
    })
}

fn encode_json<T: Serialize>(value: &T) -> MobileResult<String> {
    serde_json::to_string(value).map_err(|error| {
        MobileError::secure_storage(format!("encode sender-key store record failed: {error}"))
    })
}

fn decode_json<T: for<'de> Deserialize<'de>>(value: &str) -> MobileResult<T> {
    serde_json::from_str(value).map_err(|error| {
        MobileError::secure_storage(format!("decode sender-key store record failed: {error}"))
    })
}

fn decode_optional_json<T: for<'de> Deserialize<'de>>(
    value: Option<String>,
) -> MobileResult<Vec<T>> {
    value
        .map(|raw| decode_json(&raw))
        .unwrap_or_else(|| Ok(Vec::new()))
}

fn chain_index_key(user_scope: &str) -> String {
    format!("{KEY_PREFIX}.chain-index.{}", scope_hash(user_scope))
}

fn skipped_index_key(user_scope: &str) -> String {
    format!("{KEY_PREFIX}.skipped-index.{}", scope_hash(user_scope))
}

fn chain_key(user_scope: &str, group_ulid: &str, sender_did: &str, sender_key_id: u32) -> String {
    format!(
        "{KEY_PREFIX}.chain.{}.{}.{}",
        scope_hash(user_scope),
        identity_hash(group_ulid, sender_did),
        sender_key_id
    )
}

fn skipped_key(
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
    sender_key_id: u32,
    counter: u32,
) -> String {
    format!(
        "{KEY_PREFIX}.skipped.{}.{}.{}.{}",
        scope_hash(user_scope),
        identity_hash(group_ulid, sender_did),
        sender_key_id,
        counter
    )
}

fn scope_hash(user_scope: &str) -> String {
    hex_sha256(user_scope.as_bytes())
}

fn identity_hash(group_ulid: &str, sender_did: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(group_ulid.as_bytes());
    hasher.update([0x1f]);
    hasher.update(sender_did.as_bytes());
    to_hex(&hasher.finalize())
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    to_hex(&hasher.finalize())
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
