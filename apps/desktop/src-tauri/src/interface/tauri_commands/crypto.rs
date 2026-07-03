use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::rngs::OsRng;
use serde_json::json;
use tauri::{State, Window};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::application::chat_storage;
use crate::application::session_resolver;
use crate::contracts::{ChatIndexLocalInput, ChatSearchLocalInput, StubPayload};
use crate::domain::crypto::sender_keys::{
    self, GroupCiphertextWire, SenderChainState, SenderKeyDistributionPayload,
};
use crate::domain::crypto::{self, CryptoSession, EncryptedMessage, X3DHBundle};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::local_chat_store;
use crate::model::chat as model_chat;
use crate::state::AppState;
use ed25519_dalek::Signer;
use prost::Message as _;

fn actor_id_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> Option<String> {
    session_resolver::actor_id_for_window(state.inner(), window)
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    let actor_id = actor_id_from_state(state, window);
    crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_unix_seconds_i32() -> i32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().min(i32::MAX as u64) as i32)
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
pub fn chat_search_local(
    input: ChatSearchLocalInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Search query is required", None);
    }
    let user_scope = user_scope_from_state(&state, &window);
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
                format!("Failed to search local messages: {}", reason),
                None,
            );
        }
    };
    to_stub("chat_search_local", json!({ "results": items }))
}

#[tauri::command]
pub fn chat_index_local_messages(
    input: ChatIndexLocalInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    let records = input
        .messages
        .into_iter()
        .filter_map(|item| {
            let scope = item.scope.trim();
            if scope != "friend" && scope != "group" {
                return None;
            }
            let conversation_id = item.conversation_id.trim();
            let message_id = item.message_id.trim();
            let content = item.content.trim();
            if conversation_id.is_empty() || message_id.is_empty() || content.is_empty() {
                return None;
            }
            Some(local_chat_store::LocalChatRecord {
                scope: scope.to_string(),
                conversation_id: conversation_id.to_string(),
                message_id: message_id.to_string(),
                sender_did: item.sender_did.trim().to_string(),
                content: content.to_string(),
                reply_to_ulid: item
                    .reply_to_ulid
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .to_string(),
                thread_root_ulid: item
                    .thread_root_ulid
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .to_string(),
                sent_at: item.sent_at,
            })
        })
        .collect::<Vec<_>>();
    let indexed = match chat_storage::index_plaintext_messages(user_scope.as_str(), &records) {
        Ok(count) => count,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to index local messages: {}", reason),
                None,
            );
        }
    };
    to_stub(
        "chat_index_local_messages",
        json!({ "indexed_count": indexed }),
    )
}

#[tauri::command]
pub fn crypto_generate_identity(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = match actor_id_from_state(&state, &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            );
        }
    };
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
            .identity_key_ref();
    let kp = match crypto::get_or_create_identity(identity_key_ref.as_str()) {
        Ok(k) => k,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity operation failed: {}", reason),
                None,
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
pub fn crypto_get_fingerprint(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = match actor_id_from_state(&state, &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            );
        }
    };
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
            .identity_key_ref();
    let kp = match crypto::load_identity_key(identity_key_ref.as_str()) {
        Ok(Some(k)) => k,
        Ok(None) => {
            return AppResult::fail(ErrorCode::NotFound, "No crypto identity found", None);
        }
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity operation failed: {}", reason),
                None,
            );
        }
    };
    let fp = crypto::identity_fingerprint_hex(&kp.verifying_key);
    to_stub("crypto_get_fingerprint", json!({ "fingerprint": fp }))
}

#[tauri::command]
pub fn crypto_ratchet_telemetry_snapshot() -> AppResult<StubPayload> {
    let snap = crate::domain::crypto::telemetry::snapshot();
    to_stub(
        "crypto_ratchet_telemetry_snapshot",
        json!({
            "legacy_decrypts": snap.legacy_decrypts,
            "dr_decrypts": snap.dr_decrypts,
            "since_unix_ms": snap.since_unix_ms,
        }),
    )
}

#[tauri::command]
pub fn crypto_get_key_bundle(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = match actor_id_from_state(&state, &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            );
        }
    };
    let user_scope = user_scope_from_state(&state, &window);
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
            .identity_key_ref();
    let ik = match crypto::get_or_create_identity(identity_key_ref.as_str()) {
        Ok(k) => k,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity operation failed: {}", reason),
                None,
            );
        }
    };

    let spk_sk = StaticSecret::random_from_rng(OsRng);
    let spk_pub = PublicKey::from(&spk_sk);
    let spk_pub_bytes = spk_pub.to_bytes();
    let spk_sig = ik.signing_key.sign(spk_pub_bytes.as_slice());
    let spk_id = now_unix_seconds_i32();

    if let Err(reason) = local_chat_store::crypto_store_signed_prekey(
        user_scope.as_str(),
        i64::from(spk_id),
        spk_sk.to_bytes().as_slice(),
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to store signed pre-key: {}", reason),
            None,
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
                format!("Failed to store one-time pre-keys: {}", reason),
                None,
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

// NOTE: The previous crypto_group_encrypt / crypto_group_decrypt /
// crypto_group_rotate_key Tauri commands were removed in commit
// landing alongside docs/architecture/encryption/group-sender-keys.md
// in the peers-touch worktree. They were:
//   1. Never registered in main.rs::tauri::generate_handler!
//      (i.e. unreachable from the JS layer at runtime).
//   2. Unused by the TS layer (no callers anywhere in apps/desktop/src).
//   3. Architecturally broken: GroupKeyState::generate() produced a
//      fresh random key per-device with no distribution mechanism, so
//      two members would never share a key for the same group.
// The replacement is the Sender Keys protocol designed in
// peers-touch/docs/architecture/encryption/group-sender-keys.md, which
// will land in a follow-up commit per the G0..G5 phase plan documented
// there. Until that lands, group chat is plaintext on the wire and the
// codebase no longer pretends otherwise.

fn decode_b64_fixed<const N: usize>(label: &str, data: &str) -> Result<[u8; N], String> {
    let raw = B64
        .decode(data.trim())
        .map_err(|e| format!("{label} base64: {e}"))?;
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
    window: Window,
) -> AppResult<StubPayload> {
    if session_id.trim().is_empty() || peer_did.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Session ID and peer DID are required",
            None,
        );
    }
    let actor_id = match actor_id_from_state(&state, &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            );
        }
    };
    let user_scope = user_scope_from_state(&state, &window);
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
            .identity_key_ref();
    let ik = match crypto::get_or_create_identity(identity_key_ref.as_str()) {
        Ok(k) => k,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity operation failed: {}", reason),
                None,
            );
        }
    };

    let ik_arr = match decode_b64_fixed::<32>("peer_ik_pub", &peer_ik_pub) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid peer identity key: {}", e),
                None,
            );
        }
    };
    let spk_arr = match decode_b64_fixed::<32>("peer_spk_pub", &peer_spk_pub) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid peer signed pre-key: {}", e),
                None,
            );
        }
    };
    let sig_raw = match B64.decode(peer_spk_sig.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for peer_spk_sig: {}", e),
                None,
            );
        }
    };
    let opk = match peer_opk_pub.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(s) => match decode_b64_fixed::<32>("peer_opk_pub", s) {
            Ok(b) => Some(b),
            Err(e) => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    format!("Invalid peer one-time pre-key: {}", e),
                    None,
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
                format!("X3DH key agreement failed: {}", reason),
                None,
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

    if let Err(reason) =
        local_chat_store::save_crypto_session(user_scope.as_str(), &session.to_state())
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to save crypto session: {}", reason),
            None,
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
    window: Window,
) -> AppResult<StubPayload> {
    if session_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Session ID is required", None);
    }
    let user_scope = user_scope_from_state(&state, &window);
    let st = match local_chat_store::load_crypto_session(user_scope.as_str(), session_id.as_str()) {
        Ok(s) => s,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load crypto session: {}", reason),
                None,
            );
        }
    };
    let Some(mut st) = st else {
        return AppResult::fail(ErrorCode::NotFound, "Crypto session not found", None);
    };
    if st.peer_did != peer_did {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Session peer does not match",
            None,
        );
    }
    let mut session = CryptoSession::from_state(&st);
    let enc = match session.encrypt(plaintext.as_bytes()) {
        Ok(e) => e,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Encryption failed: {}", reason),
                None,
            );
        }
    };
    st = session.to_state();
    if let Err(reason) = local_chat_store::save_crypto_session(user_scope.as_str(), &st) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to save crypto session: {}", reason),
            None,
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
    window: Window,
) -> AppResult<StubPayload> {
    let _ = ephemeral_key;
    if session_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Session ID is required", None);
    }
    let user_scope = user_scope_from_state(&state, &window);
    let st = match local_chat_store::load_crypto_session(user_scope.as_str(), session_id.as_str()) {
        Ok(s) => s,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load crypto session: {}", reason),
                None,
            );
        }
    };
    let Some(mut st) = st else {
        return AppResult::fail(ErrorCode::NotFound, "Crypto session not found", None);
    };
    if st.peer_did != peer_did {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Session peer does not match",
            None,
        );
    }
    let ct_raw = match B64.decode(ciphertext.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 ciphertext: {}", e),
                None,
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
                format!("Decryption failed: {}", reason),
                None,
            );
        }
    };
    st = session.to_state();
    if let Err(reason) = local_chat_store::save_crypto_session(user_scope.as_str(), &st) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to save crypto session: {}", reason),
            None,
        );
    }
    let text = match String::from_utf8(plain) {
        Ok(s) => s,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Decrypted plaintext is not valid UTF-8: {}", e),
                None,
            );
        }
    };
    to_stub("crypto_decrypt_message", json!({ "plaintext": text }))
}

// ---------------------------------------------------------------------
// Sender Keys (group chat E2EE).
//
// Four entry points the JS layer calls into:
//
//   crypto_group_sk_emit_skdm    -> "give me the SKDM bytes for this
//                                    (group, me) chain so I can
//                                    deliver them over friend chat".
//                                    Mints + persists the chain on
//                                    first use.
//   crypto_group_sk_consume_skdm -> "I just received this SKDM over
//                                    a friend-chat type-50 control
//                                    message; install the chain".
//   crypto_group_encrypt         -> "wrap this plaintext as a
//                                    GroupCiphertext I can stuff
//                                    into SendGroupMessageRequest
//                                    .encrypted_payload".
//   crypto_group_decrypt         -> "I just got an
//                                    encrypted_payload off the wire;
//                                    give me the plaintext back".
//
// All four require an authenticated active actor. The TS layer talks
// to them through `desktop_api`; nothing else in Rust calls them
// directly. See peers-touch/docs/architecture/encryption/group-sender-keys.md.
// ---------------------------------------------------------------------

fn sk_authed_scope(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String), AppResult<StubPayload>> {
    let actor_id = match actor_id_from_state(state, window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return Err(AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            ));
        }
    };
    let scope = user_scope_from_state(state, window);
    Ok((actor_id, scope))
}

fn proto_skdm_to_payload(
    msg: &model_chat::SenderKeyDistributionMessage,
) -> Result<SenderKeyDistributionPayload, String> {
    if msg.group_ulid.is_empty() || msg.sender_did.is_empty() {
        return Err("SKDM missing group_ulid or sender_did".to_string());
    }
    if msg.chain_key.len() != 32 {
        return Err(format!(
            "SKDM chain_key must be 32 bytes (got {})",
            msg.chain_key.len()
        ));
    }
    if msg.sender_sig_pub.len() != 32 {
        return Err(format!(
            "SKDM sender_sig_pub must be 32 bytes (got {})",
            msg.sender_sig_pub.len()
        ));
    }
    let mut chain_key = [0u8; 32];
    chain_key.copy_from_slice(&msg.chain_key);
    let mut sender_sig_pub = [0u8; 32];
    sender_sig_pub.copy_from_slice(&msg.sender_sig_pub);
    Ok(SenderKeyDistributionPayload {
        group_ulid: msg.group_ulid.clone(),
        sender_did: msg.sender_did.clone(),
        sender_key_id: msg.sender_key_id,
        chain_key,
        counter: msg.counter,
        sender_sig_pub,
    })
}

fn payload_to_proto_skdm(
    payload: &SenderKeyDistributionPayload,
) -> model_chat::SenderKeyDistributionMessage {
    model_chat::SenderKeyDistributionMessage {
        group_ulid: payload.group_ulid.clone(),
        sender_did: payload.sender_did.clone(),
        sender_key_id: payload.sender_key_id,
        chain_key: payload.chain_key.to_vec(),
        counter: payload.counter,
        sender_sig_pub: payload.sender_sig_pub.to_vec(),
    }
}

fn wire_to_proto_ciphertext(w: &GroupCiphertextWire) -> model_chat::GroupCiphertext {
    model_chat::GroupCiphertext {
        version: w.version,
        sender_did: w.sender_did.clone(),
        sender_key_id: w.sender_key_id,
        counter: w.counter,
        ciphertext: w.ciphertext.clone(),
        signature: w.signature.to_vec(),
    }
}

fn proto_ciphertext_to_wire(
    p: &model_chat::GroupCiphertext,
) -> Result<GroupCiphertextWire, String> {
    if p.signature.len() != 64 {
        return Err(format!(
            "GroupCiphertext signature must be 64 bytes (got {})",
            p.signature.len()
        ));
    }
    if p.sender_did.is_empty() {
        return Err("GroupCiphertext missing sender_did".to_string());
    }
    let mut signature = [0u8; 64];
    signature.copy_from_slice(&p.signature);
    Ok(GroupCiphertextWire {
        version: p.version,
        sender_did: p.sender_did.clone(),
        sender_key_id: p.sender_key_id,
        counter: p.counter,
        ciphertext: p.ciphertext.clone(),
        signature,
    })
}

/// Mint or load the local sender chain for `group_ulid` and return
/// the SKDM bytes (proto-encoded `SenderKeyDistributionMessage`)
/// that the caller will deliver pairwise over friend chat as a
/// type-50 control message.
///
/// Idempotent on the storage side: calling this command N times
/// without rotating returns the *same* SKDM (same key, same
/// counter) so the JS layer can safely retry on transient failures.
/// Rotation is a separate (future) command — this one never
/// advances `sender_key_id`.
#[tauri::command]
pub fn crypto_group_sk_emit_skdm(
    group_ulid: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let (actor_id, scope) = match sk_authed_scope(&state, &window) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let chain = match local_chat_store::latest_local_sender_chain(
        scope.as_str(),
        group_ulid.as_str(),
        actor_id.as_str(),
    ) {
        Ok(Some(c)) => c,
        Ok(None) => {
            // First send into this group. Mint and persist a
            // generation-1 chain. Persist-then-distribute order
            // matters: if we crash after distribution but before
            // persistence, peers would have a key we cannot use.
            let fresh = sender_keys::create_local_chain(group_ulid.as_str(), actor_id.as_str(), 1);
            if let Err(reason) = local_chat_store::save_group_sender_chain(scope.as_str(), &fresh) {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("Failed to persist new sender chain: {}", reason),
                    None,
                );
            }
            fresh
        }
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load sender chain: {}", reason),
                None,
            );
        }
    };
    let payload = sender_keys::snapshot_for_skdm(&chain);
    let proto = payload_to_proto_skdm(&payload);
    let mut buf = Vec::with_capacity(proto.encoded_len());
    proto.encode(&mut buf).expect("prost SKDM encode");
    to_stub(
        "crypto_group_sk_emit_skdm",
        json!({
            "group_ulid": group_ulid,
            "sender_did": actor_id,
            "sender_key_id": chain.sender_key_id,
            "skdm_b64": B64.encode(&buf),
        }),
    )
}

/// Force-rotate our local sender chain for `group_ulid`.
///
/// Mints a fresh chain at `sender_key_id = max_known + 1` so it
/// cannot collide with anything a peer might already have on file
/// (including past chains we minted and then forgot about). The
/// caller (TS layer) is responsible for clearing the SKDM-sent
/// ledger so the next send re-distributes the new chain to every
/// member -- without the clear, the dedupe set would suppress the
/// re-distribution and peers would silently fail to decrypt
/// post-rotation messages.
///
/// Returns the freshly-minted `sender_key_id` so the caller can
/// log it / surface it in UI ("group encryption was reset").
///
/// The previous chain is kept in storage so receivers can still
/// decrypt any in-flight ciphertext we sent before rotating; only
/// new sends use the new chain (because `latest_local_sender_chain`
/// returns the highest sender_key_id with a signing seed).
#[tauri::command]
pub fn crypto_group_sk_rotate(
    group_ulid: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let (actor_id, scope) = match sk_authed_scope(&state, &window) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let next_id = match local_chat_store::max_sender_key_id(
        scope.as_str(),
        group_ulid.as_str(),
        actor_id.as_str(),
    ) {
        Ok(Some(v)) => v.checked_add(1).unwrap_or(1),
        Ok(None) => 1,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to query max sender_key_id: {}", reason),
                None,
            );
        }
    };
    let fresh = sender_keys::create_local_chain(group_ulid.as_str(), actor_id.as_str(), next_id);
    if let Err(reason) = local_chat_store::save_group_sender_chain(scope.as_str(), &fresh) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist rotated chain: {}", reason),
            None,
        );
    }
    to_stub(
        "crypto_group_sk_rotate",
        json!({
            "group_ulid": group_ulid,
            "sender_did": actor_id,
            "sender_key_id": next_id,
        }),
    )
}

/// Install a sender chain we received as a type-50 friend-chat
/// payload. The friend-chat layer has already authenticated the
/// envelope (we know the SKDM came from `claimed_sender_did`'s
/// device); here we add the application-level integrity check that
/// the embedded `sender_did` matches.
///
/// Returns the (group_ulid, sender_did, sender_key_id) we installed
/// so the caller can mark the friend-chat control message as
/// processed.
#[tauri::command]
pub fn crypto_group_sk_consume_skdm(
    claimed_sender_did: String,
    skdm_b64: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if claimed_sender_did.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "claimed_sender_did is required",
            None,
        );
    }
    let (_actor_id, scope) = match sk_authed_scope(&state, &window) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let raw = match B64.decode(skdm_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for skdm_b64: {}", e),
                None,
            );
        }
    };
    let proto = match model_chat::SenderKeyDistributionMessage::decode(raw.as_slice()) {
        Ok(p) => p,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("SKDM proto decode failed: {}", e),
                None,
            );
        }
    };
    if proto.sender_did != claimed_sender_did {
        // Friend-chat envelope says A sent it but the embedded SKDM
        // claims to be from B's chain. Reject -- otherwise A could
        // distribute B's key as their own and frame B for messages
        // they didn't send.
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "SKDM sender_did does not match the friend-chat envelope sender",
            None,
        );
    }
    let payload = match proto_skdm_to_payload(&proto) {
        Ok(p) => p,
        Err(e) => return AppResult::fail(ErrorCode::InvalidArgument, e, None),
    };
    let chain = match sender_keys::consume_skdm(&payload) {
        Ok(c) => c,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("SKDM consume failed: {}", e),
                None,
            );
        }
    };
    if let Err(reason) = local_chat_store::save_group_sender_chain(scope.as_str(), &chain) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist received sender chain: {}", reason),
            None,
        );
    }
    to_stub(
        "crypto_group_sk_consume_skdm",
        json!({
            "group_ulid": chain.group_ulid,
            "sender_did": chain.sender_did,
            "sender_key_id": chain.sender_key_id,
        }),
    )
}

/// Encrypt `plaintext_b64` under the local sender chain for
/// `group_ulid` and return the wire bytes that should be stuffed
/// into `SendGroupMessageRequest.encrypted_payload`.
///
/// Errors with `NotFound` if no local chain has been minted yet.
/// The TS layer is expected to call `crypto_group_sk_emit_skdm`
/// before the first send to bootstrap the chain.
#[tauri::command]
pub fn crypto_group_encrypt(
    group_ulid: String,
    plaintext_b64: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let (actor_id, scope) = match sk_authed_scope(&state, &window) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let plaintext = match B64.decode(plaintext_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for plaintext_b64: {}", e),
                None,
            );
        }
    };
    let mut chain = match local_chat_store::latest_local_sender_chain(
        scope.as_str(),
        group_ulid.as_str(),
        actor_id.as_str(),
    ) {
        Ok(Some(c)) => c,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "No local sender chain for group; emit SKDM first",
                None,
            );
        }
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load sender chain: {}", reason),
                None,
            );
        }
    };
    let wire = match sender_keys::encrypt(&mut chain, &plaintext) {
        Ok(w) => w,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Sender-keys encrypt failed: {}", e),
                None,
            );
        }
    };
    // Persist BEFORE returning the ciphertext. AES-GCM key reuse on
    // a re-encrypt with the un-advanced chain would be catastrophic,
    // so we'd rather fail the send than risk that.
    if let Err(reason) = local_chat_store::save_group_sender_chain(scope.as_str(), &chain) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist advanced chain: {}", reason),
            None,
        );
    }
    let proto = wire_to_proto_ciphertext(&wire);
    let mut buf = Vec::with_capacity(proto.encoded_len());
    proto
        .encode(&mut buf)
        .expect("prost GroupCiphertext encode");
    to_stub(
        "crypto_group_encrypt",
        json!({
            "encrypted_payload_b64": B64.encode(&buf),
            "sender_key_id": wire.sender_key_id,
            "counter": wire.counter,
        }),
    )
}

/// Decrypt a `GroupCiphertext` payload that just arrived off the
/// wire. The caller passes the bytes from
/// `GroupMessage.encrypted_payload`; we look up the chain by
/// `(group_ulid, sender_did, sender_key_id)` -- the last comes from
/// inside the wire.
///
/// Returns `NotFound` if the SKDM hasn't been processed yet -- the
/// caller should hold the message in a re-decrypt queue and try
/// again after the next SKDM arrives. Returns plaintext as base64
/// so binary-content groups (image / file body, etc.) round-trip
/// losslessly.
#[tauri::command]
pub fn crypto_group_decrypt(
    group_ulid: String,
    encrypted_payload_b64: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let (_actor_id, scope) = match sk_authed_scope(&state, &window) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let raw = match B64.decode(encrypted_payload_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for encrypted_payload_b64: {}", e),
                None,
            );
        }
    };
    let proto = match model_chat::GroupCiphertext::decode(raw.as_slice()) {
        Ok(p) => p,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("GroupCiphertext proto decode failed: {}", e),
                None,
            );
        }
    };
    let wire = match proto_ciphertext_to_wire(&proto) {
        Ok(w) => w,
        Err(e) => return AppResult::fail(ErrorCode::InvalidArgument, e, None),
    };
    let chain = match local_chat_store::load_group_sender_chain(
        scope.as_str(),
        group_ulid.as_str(),
        wire.sender_did.as_str(),
        wire.sender_key_id,
    ) {
        Ok(Some(c)) => c,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "No sender chain for (group, sender, sender_key_id); SKDM not yet processed",
                None,
            );
        }
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load sender chain: {}", reason),
                None,
            );
        }
    };
    let pre_skipped = match local_chat_store::load_group_skipped_keys(
        scope.as_str(),
        group_ulid.as_str(),
        wire.sender_did.as_str(),
        wire.sender_key_id,
    ) {
        Ok(map) => map,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load skipped keys: {}", reason),
                None,
            );
        }
    };
    let was_skipped = pre_skipped.contains_key(&wire.counter);
    let outcome = match sender_keys::decrypt(&chain, &wire, &pre_skipped) {
        Ok(o) => o,
        Err(e) => {
            // Surface the variant string so the UI can tell apart
            // "possibly forged" (bad signature) from "out of sync"
            // (skip too far) and react appropriately.
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Sender-keys decrypt failed: {}", e),
                None,
            );
        }
    };
    let advanced = SenderChainState {
        group_ulid: chain.group_ulid.clone(),
        sender_did: chain.sender_did.clone(),
        sender_key_id: chain.sender_key_id,
        chain_key: outcome.advanced_chain_key,
        counter: outcome.advanced_counter,
        signing_seed: chain.signing_seed,
        verifying_key: chain.verifying_key,
    };
    let consumed = if was_skipped {
        Some(wire.counter)
    } else {
        None
    };
    if let Err(reason) = local_chat_store::apply_group_decrypt_outcome(
        scope.as_str(),
        &advanced,
        &outcome.new_skipped,
        consumed,
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist decrypt outcome: {}", reason),
            None,
        );
    }
    to_stub(
        "crypto_group_decrypt",
        json!({
            "plaintext_b64": B64.encode(&outcome.plaintext),
            "sender_did": wire.sender_did,
            "sender_key_id": wire.sender_key_id,
            "counter": wire.counter,
        }),
    )
}

// ---------------------------------------------------------------------
// Signaling envelope: stateless authenticated sealed-box.
//
// The realtime plane (docs/architecture/realtime/event-stream.md
// §2.7) wraps every WebRTC signaling frame in a per-message envelope
// derived from the local actor's long-term identity X25519 key plus
// a fresh ephemeral X25519 keypair. This is intentionally a separate
// primitive from the chat ratchet — see §2.7.2.1 for why coupling
// signaling and chat in one ratchet would have made loss of a single
// ICE candidate stall every following text message.
//
// These two commands are the only allowed entry points for sealing /
// opening signaling payloads at the application boundary; the TS
// `friendChatP2p` module calls them through the desktop_api wrapper.
// ---------------------------------------------------------------------

fn local_identity_x25519(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(StaticSecret, PublicKey), AppResult<StubPayload>> {
    let actor_id = match actor_id_from_state(state, window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return Err(AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            ));
        }
    };
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
            .identity_key_ref();
    let ik = match crypto::load_identity_key(identity_key_ref.as_str()) {
        Ok(Some(k)) => k,
        Ok(None) => {
            return Err(AppResult::fail(
                ErrorCode::NotFound,
                "No crypto identity found for the active actor",
                None,
            ));
        }
        Err(reason) => {
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity load failed: {}", reason),
                None,
            ));
        }
    };
    let kp = crypto::ed25519_to_x25519(&ik.signing_key);
    Ok((kp.private, kp.public))
}

fn peer_x25519_pub_from_ed25519(
    label: &str,
    ed_pub_b64: &str,
) -> Result<PublicKey, AppResult<StubPayload>> {
    let raw = match B64.decode(ed_pub_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for {}: {}", label, e),
                None,
            ));
        }
    };
    if raw.len() != 32 {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("{} must decode to 32 bytes, got {}", label, raw.len()),
            None,
        ));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&raw);
    let verifying = match ed25519_dalek::VerifyingKey::from_bytes(&bytes) {
        Ok(v) => v,
        Err(e) => {
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("{} is not a valid Ed25519 public key: {}", label, e),
                None,
            ));
        }
    };
    crypto::ed25519_verifying_to_x25519_public(&verifying).map_err(|reason| {
        AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("{}: Ed25519 → X25519 conversion failed: {}", label, reason),
            None,
        )
    })
}

#[tauri::command]
pub fn signaling_envelope_seal(
    peer_ik_pub: String,
    session_ulid: String,
    kind: String,
    plaintext: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if session_ulid.trim().is_empty() || kind.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "session_ulid and kind are required",
            None,
        );
    }
    let (self_priv, self_pub) = match local_identity_x25519(&state, &window) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let peer_pub = match peer_x25519_pub_from_ed25519("peer_ik_pub", &peer_ik_pub) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let sealed = match crypto::signaling_envelope::seal(
        &self_priv,
        &self_pub,
        &peer_pub,
        session_ulid.as_str(),
        kind.as_str(),
        plaintext.as_bytes(),
    ) {
        Ok(b) => b,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Signaling envelope seal failed: {}", reason),
                None,
            );
        }
    };
    to_stub(
        "signaling_envelope_seal",
        json!({ "payload_b64": B64.encode(&sealed) }),
    )
}

#[tauri::command]
pub fn signaling_envelope_open(
    sender_ik_pub: String,
    session_ulid: String,
    kind: String,
    payload_b64: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if session_ulid.trim().is_empty() || kind.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "session_ulid and kind are required",
            None,
        );
    }
    let (self_priv, _self_pub) = match local_identity_x25519(&state, &window) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let sender_pub = match peer_x25519_pub_from_ed25519("sender_ik_pub", &sender_ik_pub) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let sealed = match B64.decode(payload_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for payload_b64: {}", e),
                None,
            );
        }
    };
    let plaintext = match crypto::signaling_envelope::open(
        &self_priv,
        &sender_pub,
        session_ulid.as_str(),
        kind.as_str(),
        &sealed,
    ) {
        Ok(b) => b,
        Err(reason) => {
            // Authentication failure / wrong sender / replay across
            // contexts all surface here. Don't leak the AAD details
            // back to the caller — just say it failed.
            tracing::warn!(reason = %reason, "signaling_envelope_open: AEAD failed");
            return AppResult::fail(
                ErrorCode::InternalError,
                "Signaling envelope failed to authenticate",
                None,
            );
        }
    };
    let text = match String::from_utf8(plaintext) {
        Ok(s) => s,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Decrypted signaling plaintext is not valid UTF-8: {}", e),
                None,
            );
        }
    };
    to_stub("signaling_envelope_open", json!({ "plaintext": text }))
}
