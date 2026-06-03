use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::domain::crypto::{identity_keys, signaling_envelope};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

const SKDM_ENVELOPE_KIND: &str = "GROUP_SKDM";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityScopeInput {
    user_scope: String,
    actor_did: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalingSealInput {
    user_scope: String,
    actor_did: String,
    peer_ik_pub: String,
    session_ulid: String,
    kind: String,
    plaintext: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalingOpenInput {
    user_scope: String,
    actor_did: String,
    sender_ik_pub: String,
    session_ulid: String,
    kind: String,
    payload_b64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityBundleOutput {
    device_id: String,
    ik_pub: String,
    spk_id: i32,
    spk_pub: String,
    spk_sig: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalingSealOutput {
    payload_b64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalingOpenOutput {
    plaintext: String,
}

#[tauri::command]
pub fn crypto_identity_key_bundle(
    storage: State<'_, SecureStorage>,
    input: IdentityScopeInput,
) -> MobileResult<IdentityBundleOutput> {
    let scope = validate_identity_scope(input.user_scope, input.actor_did)?;
    let bundle = identity_keys::ensure_key_bundle(&storage, &scope.user_scope, &scope.actor_did)?;
    Ok(IdentityBundleOutput {
        device_id: bundle.device_id,
        ik_pub: bundle.ik_pub,
        spk_id: bundle.spk_id,
        spk_pub: bundle.spk_pub,
        spk_sig: bundle.spk_sig,
    })
}

#[tauri::command]
pub fn signaling_envelope_seal(
    storage: State<'_, SecureStorage>,
    input: SignalingSealInput,
) -> MobileResult<SignalingSealOutput> {
    let scope = validate_identity_scope(input.user_scope, input.actor_did)?;
    let kind = clean_required(input.kind, "kind is required")?;
    if kind != SKDM_ENVELOPE_KIND {
        return Err(MobileError::invalid_input(
            "unsupported signaling envelope kind",
        ));
    }
    let session_ulid = clean_required(input.session_ulid, "sessionUlid is required")?;
    let peer_pub = identity_keys::peer_x25519_pub_from_ed25519("peerIkPub", &input.peer_ik_pub)?;
    let local =
        identity_keys::local_identity_x25519(&storage, &scope.user_scope, &scope.actor_did)?;
    let sealed = signaling_envelope::seal(
        &local.private,
        &local.public,
        &peer_pub,
        &session_ulid,
        &kind,
        input.plaintext.as_bytes(),
    )
    .map_err(|reason| MobileError::crypto(format!("signaling envelope seal failed: {reason}")))?;
    Ok(SignalingSealOutput {
        payload_b64: B64.encode(sealed),
    })
}

#[tauri::command]
pub fn signaling_envelope_open(
    storage: State<'_, SecureStorage>,
    input: SignalingOpenInput,
) -> MobileResult<SignalingOpenOutput> {
    let scope = validate_identity_scope(input.user_scope, input.actor_did)?;
    let kind = clean_required(input.kind, "kind is required")?;
    if kind != SKDM_ENVELOPE_KIND {
        return Err(MobileError::invalid_input(
            "unsupported signaling envelope kind",
        ));
    }
    let session_ulid = clean_required(input.session_ulid, "sessionUlid is required")?;
    let sender_pub =
        identity_keys::peer_x25519_pub_from_ed25519("senderIkPub", &input.sender_ik_pub)?;
    let sealed = B64.decode(input.payload_b64.trim()).map_err(|error| {
        MobileError::invalid_input(format!("payloadB64 is not base64: {error}"))
    })?;
    let local =
        identity_keys::local_identity_x25519(&storage, &scope.user_scope, &scope.actor_did)?;
    let plaintext =
        signaling_envelope::open(&local.private, &sender_pub, &session_ulid, &kind, &sealed)
            .map_err(|_| MobileError::crypto("signaling envelope failed to authenticate"))?;
    let text = String::from_utf8(plaintext).map_err(|error| {
        MobileError::crypto(format!("signaling plaintext is not utf-8: {error}"))
    })?;
    Ok(SignalingOpenOutput { plaintext: text })
}

struct IdentityScope {
    user_scope: String,
    actor_did: String,
}

fn validate_identity_scope(user_scope: String, actor_did: String) -> MobileResult<IdentityScope> {
    Ok(IdentityScope {
        user_scope: clean_required(user_scope, "userScope is required")?,
        actor_did: clean_required(actor_did, "actorDid is required")?,
    })
}

fn clean_required(value: String, message: &'static str) -> MobileResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(MobileError::invalid_input(message));
    }
    Ok(value)
}
