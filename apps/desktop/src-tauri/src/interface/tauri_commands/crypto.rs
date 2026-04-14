use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::rngs::OsRng;
use serde_json::json;
use tauri::State;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::application::chat_storage;
use crate::contracts::{ChatSearchLocalInput, StubPayload};
use crate::domain::crypto::{
    self, CryptoSession, EncryptedMessage, GroupEncryptedMessage, GroupKeyState, X3DHBundle,
};
use ed25519_dalek::Signer;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::local_chat_store;
use crate::infrastructure::storage::resolve_user_scope;
use crate::state::AppState;

fn actor_id_from_state(state: &State<'_, Arc<AppState>>) -> Option<String> {
    state
        .session
        .lock()
        .ok()
        .and_then(|guard| guard.actor_id.clone())
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>) -> String {
    let actor_id = actor_id_from_state(state);
    resolve_user_scope(actor_id.as_deref())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn to_stub(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

/// Unified local FTS search (friend / group / both) with optional conversation filter.
#[tauri::command]
pub fn chat_search_local(input: ChatSearchLocalInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.chat.queryRequired", None);
    }
    let user_scope = user_scope_from_state(&state);
    let limit = input.limit.unwrap_or(30).clamp(1, 200) as usize;
    let scope_filter = input.scope.trim();
    let conv = input
        .conversation_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    let items = match chat_storage::search_messages_unified(
        user_scope.as_str(),
        input.query.as_str(),
        scope_filter,
        conv,
        limit,
    ) {
        Ok(items) => items,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.chat.localSearchFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    to_stub("chat_search_local", json!({ "results": items }))
}

#[tauri::command]
pub fn crypto_generate_identity(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let actor_id = match actor_id_from_state(&state) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "error.auth.authenticationRequired",
                None,
            );
        }
    };
    let kp = match crypto::get_or_create_identity(actor_id.as_str()) {
        Ok(k) => k,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.identityFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    let fp = crypto::identity_fingerprint_hex(&kp.verifying_key);
    let public_key = hex::encode(kp.verifying_key.to_bytes());
    to_stub(
        "crypto_generate_identity",
        json!({
            "fingerprint": fp,
            "public_key": public_key,
        }),
    )
}

#[tauri::command]
pub fn crypto_get_fingerprint(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let actor_id = match actor_id_from_state(&state) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "error.auth.authenticationRequired",
                None,
            );
        }
    };
    let kp = match crypto::load_identity_key(actor_id.as_str()) {
        Ok(Some(k)) => k,
        Ok(None) => {
            return AppResult::fail(ErrorCode::NotFound, "error.crypto.identityNotFound", None);
        }
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.identityFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    let fp = crypto::identity_fingerprint_hex(&kp.verifying_key);
    to_stub("crypto_get_fingerprint", json!({ "fingerprint": fp }))
}

#[tauri::command]
pub fn crypto_get_key_bundle(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let actor_id = match actor_id_from_state(&state) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "error.auth.authenticationRequired",
                None,
            );
        }
    };
    let user_scope = user_scope_from_state(&state);
    let ik = match crypto::get_or_create_identity(actor_id.as_str()) {
        Ok(k) => k,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.identityFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };

    let spk_sk = StaticSecret::random_from_rng(OsRng);
    let spk_pub = PublicKey::from(&spk_sk);
    let spk_pub_bytes = spk_pub.to_bytes();
    let spk_sig = ik.signing_key.sign(spk_pub_bytes.as_slice());
    let spk_id = now_ms();

    if let Err(reason) = local_chat_store::crypto_store_signed_prekey(
        user_scope.as_str(),
        spk_id,
        spk_sk.to_bytes().as_slice(),
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "error.crypto.prekeyStoreFailed",
            Some(json!({ "reason": reason })),
        );
    }

    let mut opk_privs: Vec<Vec<u8>> = Vec::new();
    let mut opk_pubs: Vec<[u8; 32]> = Vec::new();
    for _ in 0..20 {
        let opk_sk = StaticSecret::random_from_rng(OsRng);
        let pk = PublicKey::from(&opk_sk);
        opk_pubs.push(pk.to_bytes());
        opk_privs.push(opk_sk.to_bytes().to_vec());
    }
    let opk_ids = match local_chat_store::crypto_insert_opks(user_scope.as_str(), &opk_privs) {
        Ok(ids) => ids,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.prekeyStoreFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };

    let ik_pub_b64 = B64.encode(ik.verifying_key.to_bytes());
    let spk_pub_b64 = B64.encode(spk_pub_bytes);
    let spk_sig_b64 = B64.encode(spk_sig.to_bytes());
    let opk_pubs_b64: Vec<String> = opk_pubs.iter().map(|b| B64.encode(b)).collect();

    to_stub(
        "crypto_get_key_bundle",
        json!({
            "ik_pub": ik_pub_b64,
            "spk_id": spk_id,
            "spk_pub": spk_pub_b64,
            "spk_sig": spk_sig_b64,
            "opk_ids": opk_ids,
            "opk_pubs": opk_pubs_b64,
        }),
    )
}

fn group_key_state_or_create(user_scope: &str, group_id: &str) -> Result<GroupKeyState, String> {
    match local_chat_store::load_group_key(user_scope, group_id)? {
        Some((k, epoch, counter)) if k.len() == 32 => {
            let mut key = [0u8; 32];
            key.copy_from_slice(&k[..32]);
            Ok(GroupKeyState {
                group_id: group_id.to_string(),
                key,
                epoch,
                counter,
            })
        }
        _ => {
            let s = GroupKeyState::generate(group_id);
            local_chat_store::save_group_key(user_scope, group_id, &s.key, s.epoch, s.counter)?;
            Ok(s)
        }
    }
}

#[tauri::command]
pub fn crypto_group_encrypt(
    group_id: String,
    plaintext: String,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    if group_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.groupChat.groupUlidRequired", None);
    }
    let user_scope = user_scope_from_state(&state);
    let mut gk = match group_key_state_or_create(user_scope.as_str(), group_id.as_str()) {
        Ok(s) => s,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.groupKeyFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    let enc = match gk.encrypt(plaintext.as_bytes()) {
        Ok(e) => e,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.encryptFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    if let Err(reason) =
        local_chat_store::save_group_key(user_scope.as_str(), group_id.as_str(), &gk.key, gk.epoch, gk.counter)
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            "error.crypto.groupKeySaveFailed",
            Some(json!({ "reason": reason })),
        );
    }
    to_stub(
        "crypto_group_encrypt",
        json!({
            "ciphertext": B64.encode(&enc.ciphertext),
            "epoch": enc.epoch,
            "counter": enc.counter,
        }),
    )
}

#[tauri::command]
pub fn crypto_group_decrypt(
    group_id: String,
    ciphertext: String,
    epoch: u32,
    counter: u32,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    if group_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.groupChat.groupUlidRequired", None);
    }
    let user_scope = user_scope_from_state(&state);
    let row = match local_chat_store::load_group_key(user_scope.as_str(), group_id.as_str()) {
        Ok(r) => r,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.groupKeyFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    let Some((k, _e, _c)) = row else {
        return AppResult::fail(ErrorCode::NotFound, "error.crypto.groupKeyNotFound", None);
    };
    if k.len() != 32 {
        return AppResult::fail(ErrorCode::InternalError, "error.crypto.groupKeyInvalid", None);
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&k[..32]);
    let ct_raw = match B64.decode(ciphertext.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "error.crypto.invalidBase64",
                Some(json!({ "field": "ciphertext", "reason": e.to_string() })),
            );
        }
    };
    let gk = GroupKeyState {
        group_id: group_id.clone(),
        key,
        epoch: 0,
        counter: 0,
    };
    let msg = GroupEncryptedMessage {
        ciphertext: ct_raw,
        epoch,
        counter,
    };
    let plain = match gk.decrypt(&msg) {
        Ok(p) => p,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.decryptFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    let text = match String::from_utf8(plain) {
        Ok(s) => s,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.plaintextUtf8",
                Some(json!({ "reason": e.to_string() })),
            );
        }
    };
    to_stub("crypto_group_decrypt", json!({ "plaintext": text }))
}

#[tauri::command]
pub fn crypto_group_rotate_key(group_id: String, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    if group_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.groupChat.groupUlidRequired", None);
    }
    let user_scope = user_scope_from_state(&state);
    let mut gk = match local_chat_store::load_group_key(user_scope.as_str(), group_id.as_str()) {
        Ok(Some((k, epoch, counter))) if k.len() == 32 => {
            let mut key = [0u8; 32];
            key.copy_from_slice(&k[..32]);
            GroupKeyState {
                group_id: group_id.clone(),
                key,
                epoch,
                counter,
            }
        }
        Ok(None) => {
            let s = GroupKeyState::generate(group_id.as_str());
            if let Err(reason) = local_chat_store::save_group_key(
                user_scope.as_str(),
                group_id.as_str(),
                &s.key,
                s.epoch,
                s.counter,
            ) {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "error.crypto.groupKeySaveFailed",
                    Some(json!({ "reason": reason })),
                );
            }
            return to_stub("crypto_group_rotate_key", json!({ "epoch": s.epoch }));
        }
        Ok(Some(_)) => {
            return AppResult::fail(ErrorCode::InternalError, "error.crypto.groupKeyInvalid", None);
        }
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.groupKeyFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    gk.rotate();
    if let Err(reason) =
        local_chat_store::save_group_key(user_scope.as_str(), group_id.as_str(), &gk.key, gk.epoch, gk.counter)
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            "error.crypto.groupKeySaveFailed",
            Some(json!({ "reason": reason })),
        );
    }
    to_stub("crypto_group_rotate_key", json!({ "epoch": gk.epoch }))
}

fn decode_b64_fixed<const N: usize>(label: &str, data: &str) -> Result<[u8; N], String> {
    let raw = B64.decode(data.trim()).map_err(|e| format!("{label} base64: {e}"))?;
    if raw.len() != N {
        return Err(format!("{label}: expected {N} bytes, got {}", raw.len()));
    }
    let mut out = [0u8; N];
    out.copy_from_slice(&raw[..N]);
    Ok(out)
}

#[tauri::command]
pub fn crypto_init_session(
    session_id: String,
    peer_did: String,
    peer_ik_pub: String,
    peer_spk_pub: String,
    peer_spk_sig: String,
    peer_opk_pub: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    if session_id.trim().is_empty() || peer_did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.crypto.sessionIdRequired", None);
    }
    let actor_id = match actor_id_from_state(&state) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "error.auth.authenticationRequired",
                None,
            );
        }
    };
    let user_scope = user_scope_from_state(&state);
    let ik = match crypto::get_or_create_identity(actor_id.as_str()) {
        Ok(k) => k,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.identityFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };

    let ik_arr = match decode_b64_fixed::<32>("peer_ik_pub", &peer_ik_pub) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "error.crypto.invalidKey",
                Some(json!({ "reason": e })),
            );
        }
    };
    let spk_arr = match decode_b64_fixed::<32>("peer_spk_pub", &peer_spk_pub) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "error.crypto.invalidKey",
                Some(json!({ "reason": e })),
            );
        }
    };
    let sig_raw = match B64.decode(peer_spk_sig.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "error.crypto.invalidBase64",
                Some(json!({ "field": "peer_spk_sig", "reason": e.to_string() })),
            );
        }
    };
    let opk = match peer_opk_pub.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(s) => match decode_b64_fixed::<32>("peer_opk_pub", s) {
            Ok(b) => Some(b),
            Err(e) => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    "error.crypto.invalidKey",
                    Some(json!({ "reason": e })),
                );
            }
        },
        None => None,
    };

    let bundle = X3DHBundle {
        ik_pub: ik_arr,
        spk_pub: spk_arr,
        spk_sig: sig_raw,
        opk_pub: opk,
    };

    let x3 = match crypto::x3dh_sender(&ik, &bundle) {
        Ok(x) => x,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.x3dhFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };

    let session = CryptoSession::from_x3dh_shared_secret(
        session_id.clone(),
        peer_did,
        x3.shared_secret,
        true,
        Some(x3.ephemeral_pub),
    );

    if let Err(reason) = local_chat_store::save_crypto_session(user_scope.as_str(), &session.to_state()) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "error.crypto.sessionSaveFailed",
            Some(json!({ "reason": reason })),
        );
    }

    to_stub(
        "crypto_init_session",
        json!({
            "ephemeral_key": B64.encode(x3.ephemeral_pub),
            "established": session.established,
        }),
    )
}

#[tauri::command]
pub fn crypto_encrypt_message(
    session_id: String,
    peer_did: String,
    plaintext: String,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    if session_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.crypto.sessionIdRequired", None);
    }
    let user_scope = user_scope_from_state(&state);
    let st = match local_chat_store::load_crypto_session(user_scope.as_str(), session_id.as_str()) {
        Ok(s) => s,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.sessionLoadFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    let Some(mut st) = st else {
        return AppResult::fail(ErrorCode::NotFound, "error.crypto.sessionNotFound", None);
    };
    if st.peer_did != peer_did {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.crypto.peerMismatch", None);
    }
    let mut session = CryptoSession::from_state(&st);
    let enc = match session.encrypt(plaintext.as_bytes()) {
        Ok(e) => e,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.encryptFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    st = session.to_state();
    if let Err(reason) = local_chat_store::save_crypto_session(user_scope.as_str(), &st) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "error.crypto.sessionSaveFailed",
            Some(json!({ "reason": reason })),
        );
    }

    let mut v = json!({
        "ciphertext": B64.encode(&enc.ciphertext),
        "counter": enc.counter,
    });
    if let Some(eph) = enc.ephemeral_key {
        v["ephemeral_key"] = json!(B64.encode(eph));
    }
    to_stub("crypto_encrypt_message", v)
}

#[tauri::command]
pub fn crypto_decrypt_message(
    session_id: String,
    peer_did: String,
    ciphertext: String,
    counter: u32,
    ephemeral_key: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let _ = ephemeral_key;
    if session_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.crypto.sessionIdRequired", None);
    }
    let user_scope = user_scope_from_state(&state);
    let st = match local_chat_store::load_crypto_session(user_scope.as_str(), session_id.as_str()) {
        Ok(s) => s,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.sessionLoadFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    let Some(mut st) = st else {
        return AppResult::fail(ErrorCode::NotFound, "error.crypto.sessionNotFound", None);
    };
    if st.peer_did != peer_did {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.crypto.peerMismatch", None);
    }
    let ct_raw = match B64.decode(ciphertext.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "error.crypto.invalidBase64",
                Some(json!({ "field": "ciphertext", "reason": e.to_string() })),
            );
        }
    };

    let mut session = CryptoSession::from_state(&st);
    let msg = EncryptedMessage {
        ciphertext: ct_raw,
        counter,
        ephemeral_key: None,
    };
    let plain = match session.decrypt(&msg) {
        Ok(p) => p,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.decryptFailed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    st = session.to_state();
    if let Err(reason) = local_chat_store::save_crypto_session(user_scope.as_str(), &st) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "error.crypto.sessionSaveFailed",
            Some(json!({ "reason": reason })),
        );
    }
    let text = match String::from_utf8(plain) {
        Ok(s) => s,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.crypto.plaintextUtf8",
                Some(json!({ "reason": e.to_string() })),
            );
        }
    };
    to_stub("crypto_decrypt_message", json!({ "plaintext": text }))
}
