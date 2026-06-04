use serde::{Deserialize, Serialize};
use tauri::State;

use crate::domain::crypto::sender_key_store;
use crate::domain::crypto::sender_keys::{
    self, GroupCiphertextWire, SenderChainState, SenderKeyDistributionPayload,
};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCryptoScopeInput {
    user_scope: String,
    actor_did: String,
    group_ulid: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCryptoEncryptInput {
    user_scope: String,
    actor_did: String,
    group_ulid: String,
    plaintext: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCryptoConsumeSkdmInput {
    user_scope: String,
    sender_did: String,
    payload: SenderKeyDistributionView,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCryptoDecryptInput {
    user_scope: String,
    group_ulid: String,
    wire: GroupCiphertextView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitSkdmOutput {
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    payload: SenderKeyDistributionView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateOutput {
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptOutput {
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    wire: GroupCiphertextView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecryptOutput {
    plaintext: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderKeyDistributionView {
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    chain_key: Vec<u8>,
    counter: u32,
    sender_sig_pub: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCiphertextView {
    version: u32,
    sender_did: String,
    sender_key_id: u32,
    counter: u32,
    ciphertext: Vec<u8>,
    signature: Vec<u8>,
}

#[tauri::command]
pub fn crypto_group_sk_emit_skdm(
    storage: State<'_, SecureStorage>,
    input: GroupCryptoScopeInput,
) -> MobileResult<EmitSkdmOutput> {
    let scope = validate_scope(input.user_scope, input.actor_did, input.group_ulid)?;
    let chain = ensure_local_chain(
        &storage,
        &scope.user_scope,
        &scope.group_ulid,
        &scope.actor_did,
    )?;
    let payload = sender_keys::snapshot_for_skdm(&chain);
    Ok(EmitSkdmOutput {
        group_ulid: scope.group_ulid,
        sender_did: scope.actor_did,
        sender_key_id: chain.sender_key_id,
        payload: SenderKeyDistributionView::from_payload(payload),
    })
}

#[tauri::command]
pub fn crypto_group_sk_consume_skdm(
    storage: State<'_, SecureStorage>,
    input: GroupCryptoConsumeSkdmInput,
) -> MobileResult<()> {
    let user_scope = clean_required(input.user_scope, "userScope is required")?;
    let sender_did = clean_required(input.sender_did, "senderDid is required")?;
    let payload = input.payload.into_payload()?;
    if payload.sender_did != sender_did {
        return Err(MobileError::crypto(format!(
            "SKDM sender mismatch: envelope={sender_did}, payload={}",
            payload.sender_did
        )));
    }
    let chain = sender_keys::consume_skdm(&payload).map_err(crypto_error)?;
    sender_key_store::save_group_sender_chain(&storage, &user_scope, &chain)
}

#[tauri::command]
pub fn crypto_group_sk_rotate(
    storage: State<'_, SecureStorage>,
    input: GroupCryptoScopeInput,
) -> MobileResult<RotateOutput> {
    let scope = validate_scope(input.user_scope, input.actor_did, input.group_ulid)?;
    let next_sender_key_id = sender_key_store::max_sender_key_id(
        &storage,
        &scope.user_scope,
        &scope.group_ulid,
        &scope.actor_did,
    )?
    .unwrap_or(0)
        + 1;
    let chain =
        sender_keys::create_local_chain(&scope.group_ulid, &scope.actor_did, next_sender_key_id);
    sender_key_store::save_group_sender_chain(&storage, &scope.user_scope, &chain)?;
    Ok(RotateOutput {
        group_ulid: scope.group_ulid,
        sender_did: scope.actor_did,
        sender_key_id: next_sender_key_id,
    })
}

#[tauri::command]
pub fn crypto_group_encrypt(
    storage: State<'_, SecureStorage>,
    input: GroupCryptoEncryptInput,
) -> MobileResult<EncryptOutput> {
    let scope = validate_scope(input.user_scope, input.actor_did, input.group_ulid)?;
    let plaintext = input.plaintext.into_bytes();
    let mut chain = ensure_local_chain(
        &storage,
        &scope.user_scope,
        &scope.group_ulid,
        &scope.actor_did,
    )?;
    let wire = sender_keys::encrypt(&mut chain, &plaintext).map_err(crypto_error)?;
    sender_key_store::save_group_sender_chain(&storage, &scope.user_scope, &chain)?;
    Ok(EncryptOutput {
        group_ulid: scope.group_ulid,
        sender_did: scope.actor_did,
        sender_key_id: chain.sender_key_id,
        wire: GroupCiphertextView::from_wire(wire),
    })
}

#[tauri::command]
pub fn crypto_group_decrypt(
    storage: State<'_, SecureStorage>,
    input: GroupCryptoDecryptInput,
) -> MobileResult<DecryptOutput> {
    let user_scope = clean_required(input.user_scope, "userScope is required")?;
    let group_ulid = clean_required(input.group_ulid, "groupUlid is required")?;
    let wire = input.wire.into_wire()?;
    if wire.sender_did.trim().is_empty() {
        return Err(MobileError::invalid_input("wire.senderDid is required"));
    }
    let Some(chain) = sender_key_store::load_group_sender_chain(
        &storage,
        &user_scope,
        &group_ulid,
        &wire.sender_did,
        wire.sender_key_id,
    )?
    else {
        return Err(MobileError::crypto(format!(
            "missing sender chain for group={group_ulid}, sender={}",
            wire.sender_did
        )));
    };
    let pre_skipped = sender_key_store::load_group_skipped_keys(
        &storage,
        &user_scope,
        &group_ulid,
        &wire.sender_did,
        wire.sender_key_id,
    )?;
    let consumed_counter =
        if wire.counter < chain.counter && pre_skipped.contains_key(&wire.counter) {
            Some(wire.counter)
        } else {
            None
        };
    let outcome = sender_keys::decrypt(&chain, &wire, &pre_skipped).map_err(crypto_error)?;
    let advanced = SenderChainState {
        group_ulid: chain.group_ulid.clone(),
        sender_did: chain.sender_did.clone(),
        sender_key_id: chain.sender_key_id,
        chain_key: outcome.advanced_chain_key,
        counter: outcome.advanced_counter,
        signing_seed: chain.signing_seed,
        verifying_key: chain.verifying_key,
    };
    sender_key_store::apply_group_decrypt_outcome(
        &storage,
        &user_scope,
        &advanced,
        &outcome.new_skipped,
        consumed_counter,
    )?;
    let plaintext = String::from_utf8(outcome.plaintext)
        .map_err(|error| MobileError::crypto(format!("group plaintext is not utf-8: {error}")))?;
    Ok(DecryptOutput { plaintext })
}

struct ValidScope {
    user_scope: String,
    actor_did: String,
    group_ulid: String,
}

fn validate_scope(
    user_scope: String,
    actor_did: String,
    group_ulid: String,
) -> MobileResult<ValidScope> {
    Ok(ValidScope {
        user_scope: clean_required(user_scope, "userScope is required")?,
        actor_did: clean_required(actor_did, "actorDid is required")?,
        group_ulid: clean_required(group_ulid, "groupUlid is required")?,
    })
}

fn ensure_local_chain(
    storage: &SecureStorage,
    user_scope: &str,
    group_ulid: &str,
    actor_did: &str,
) -> MobileResult<SenderChainState> {
    if let Some(chain) =
        sender_key_store::latest_local_sender_chain(storage, user_scope, group_ulid, actor_did)?
    {
        return Ok(chain);
    }
    let next_sender_key_id =
        sender_key_store::max_sender_key_id(storage, user_scope, group_ulid, actor_did)?
            .unwrap_or(0)
            + 1;
    let chain = sender_keys::create_local_chain(group_ulid, actor_did, next_sender_key_id);
    sender_key_store::save_group_sender_chain(storage, user_scope, &chain)?;
    Ok(chain)
}

impl SenderKeyDistributionView {
    fn from_payload(payload: SenderKeyDistributionPayload) -> Self {
        Self {
            group_ulid: payload.group_ulid.clone(),
            sender_did: payload.sender_did.clone(),
            sender_key_id: payload.sender_key_id,
            chain_key: payload.chain_key.to_vec(),
            counter: payload.counter,
            sender_sig_pub: payload.sender_sig_pub.to_vec(),
        }
    }

    fn into_payload(self) -> MobileResult<SenderKeyDistributionPayload> {
        Ok(SenderKeyDistributionPayload {
            group_ulid: clean_required(self.group_ulid, "payload.groupUlid is required")?,
            sender_did: clean_required(self.sender_did, "payload.senderDid is required")?,
            sender_key_id: self.sender_key_id,
            chain_key: bytes32(self.chain_key, "payload.chainKey")?,
            counter: self.counter,
            sender_sig_pub: bytes32(self.sender_sig_pub, "payload.senderSigPub")?,
        })
    }
}

impl GroupCiphertextView {
    fn from_wire(wire: GroupCiphertextWire) -> Self {
        Self {
            version: wire.version,
            sender_did: wire.sender_did,
            sender_key_id: wire.sender_key_id,
            counter: wire.counter,
            ciphertext: wire.ciphertext,
            signature: wire.signature.to_vec(),
        }
    }

    fn into_wire(self) -> MobileResult<GroupCiphertextWire> {
        Ok(GroupCiphertextWire {
            version: self.version,
            sender_did: clean_required(self.sender_did, "wire.senderDid is required")?,
            sender_key_id: self.sender_key_id,
            counter: self.counter,
            ciphertext: self.ciphertext,
            signature: bytes64(self.signature, "wire.signature")?,
        })
    }
}

fn bytes32(value: Vec<u8>, field: &str) -> MobileResult<[u8; 32]> {
    value.try_into().map_err(|value: Vec<u8>| {
        MobileError::invalid_input(format!("{field} must be 32 bytes, got {}", value.len()))
    })
}

fn bytes64(value: Vec<u8>, field: &str) -> MobileResult<[u8; 64]> {
    value.try_into().map_err(|value: Vec<u8>| {
        MobileError::invalid_input(format!("{field} must be 64 bytes, got {}", value.len()))
    })
}

fn clean_required(value: String, message: &'static str) -> MobileResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(MobileError::invalid_input(message))
    } else {
        Ok(trimmed.to_string())
    }
}

fn crypto_error(error: sender_keys::SenderKeyError) -> MobileError {
    MobileError::crypto(error.to_string())
}
