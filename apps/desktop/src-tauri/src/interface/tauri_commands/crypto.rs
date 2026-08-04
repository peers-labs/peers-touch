use std::sync::{Arc, Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::rngs::OsRng;
use serde_json::json;
use tauri::{State, Window};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::application::chat_storage;
use crate::application::session_resolver;
use crate::contracts::{
    ChatDecryptCacheGetInput, ChatDecryptCachePutInput, ChatIndexLocalInput, ChatSearchLocalInput,
    StubPayload,
};
use crate::domain::crypto::{self, CryptoSessionState, X25519KeyPair, X3DHBundle};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::local_chat_store;
use crate::state::AppState;
use ed25519_dalek::Signer;

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

fn dr_operation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
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
pub fn chat_decrypt_cache_get(
    input: ChatDecryptCacheGetInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    chat_decrypt_cache_get_for_scope(input, user_scope)
}

pub(crate) fn chat_decrypt_cache_get_for_scope(
    input: ChatDecryptCacheGetInput,
    user_scope: String,
) -> AppResult<StubPayload> {
    match local_chat_store::get_decrypt_cache(user_scope.as_str(), input.message_id.as_str()) {
        Ok(Some((content, message_type, attachments_json, cached_at))) => to_stub(
            "chat_decrypt_cache_get",
            json!({
                "entry": {
                    "content": content,
                    "message_type": message_type,
                    "attachments_json": attachments_json,
                    "cached_at": cached_at,
                }
            }),
        ),
        Ok(None) => to_stub("chat_decrypt_cache_get", json!({ "entry": null })),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to read decrypt cache: {}", reason),
            None,
        ),
    }
}

#[tauri::command]
pub fn chat_decrypt_cache_put(
    input: ChatDecryptCachePutInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    chat_decrypt_cache_put_for_scope(input, user_scope)
}

pub(crate) fn chat_decrypt_cache_put_for_scope(
    input: ChatDecryptCachePutInput,
    user_scope: String,
) -> AppResult<StubPayload> {
    match local_chat_store::put_decrypt_cache(
        user_scope.as_str(),
        input.message_id.as_str(),
        input.content.as_str(),
        input.message_type,
        input.attachments_json.as_str(),
        input.cached_at,
    ) {
        Ok(()) => to_stub("chat_decrypt_cache_put", json!({ "stored": true })),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to store decrypt cache: {}", reason),
            None,
        ),
    }
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
    negotiated_version: u32,
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
    crypto_init_session_for_context(
        session_id,
        peer_did,
        peer_ik_pub,
        peer_spk_pub,
        peer_spk_sig,
        peer_opk_pub,
        negotiated_version,
        actor_id,
        user_scope,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn crypto_init_session_for_context(
    session_id: String,
    peer_did: String,
    peer_ik_pub: String,
    peer_spk_pub: String,
    peer_spk_sig: String,
    peer_opk_pub: Option<String>,
    negotiated_version: u32,
    actor_id: String,
    user_scope: String,
) -> AppResult<StubPayload> {
    if session_id.trim().is_empty() || peer_did.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Session ID and peer DID are required",
            None,
        );
    }
    if negotiated_version != 1 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Double Ratchet version 1 is required",
            None,
        );
    }
    let version = 1;
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
    let session = CryptoSessionState::from_x3dh_bootstrap(
        session_id.clone(),
        peer_did,
        true,
        Some(x3.ephemeral_pub),
    );

    if let Err(reason) = local_chat_store::save_crypto_session(user_scope.as_str(), &session) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to save crypto session: {}", reason),
            None,
        );
    }
    if let Err(reason) = local_chat_store::set_crypto_session_handshake_delivered(
        user_scope.as_str(),
        session_id.as_str(),
        false,
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!(
                "Failed to initialize secure-channel delivery state: {}",
                reason
            ),
            None,
        );
    }
    let dr =
        crypto::double_ratchet::init_initiator(session_id.as_str(), &x3.shared_secret, spk_arr);
    if let Err(reason) = local_chat_store::save_dr_session(user_scope.as_str(), &dr) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to save Double Ratchet session: {}", reason),
            None,
        );
    }

    to_stub(
        "crypto_init_session",
        json!({
            "ephemeral_key": B64.encode(x3.ephemeral_pub),
            "sender_identity_key": B64.encode(ik.verifying_key.to_bytes()),
            "recipient_signed_prekey": B64.encode(spk_arr),
            "recipient_one_time_prekey": opk.map(|value| B64.encode(value)).unwrap_or_default(),
            "negotiated_version": version,
            "established": true,
        }),
    )
}

#[tauri::command]
pub fn crypto_accept_session(
    session_id: String,
    peer_did: String,
    sender_identity_key: String,
    sender_ephemeral_key: String,
    recipient_signed_prekey: String,
    recipient_one_time_prekey: Option<String>,
    negotiated_version: u32,
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
    crypto_accept_session_for_context(
        session_id,
        peer_did,
        sender_identity_key,
        sender_ephemeral_key,
        recipient_signed_prekey,
        recipient_one_time_prekey,
        negotiated_version,
        actor_id,
        user_scope,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn crypto_accept_session_for_context(
    session_id: String,
    peer_did: String,
    sender_identity_key: String,
    sender_ephemeral_key: String,
    recipient_signed_prekey: String,
    recipient_one_time_prekey: Option<String>,
    negotiated_version: u32,
    actor_id: String,
    user_scope: String,
) -> AppResult<StubPayload> {
    if session_id.trim().is_empty() || peer_did.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Session ID and peer DID are required",
            None,
        );
    }
    if negotiated_version != 1 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Double Ratchet version 1 is required",
            None,
        );
    }
    let sender_ik = match decode_b64_fixed::<32>("sender_identity_key", &sender_identity_key) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(ErrorCode::InvalidArgument, reason, None);
        }
    };
    let sender_ephemeral =
        match decode_b64_fixed::<32>("sender_ephemeral_key", &sender_ephemeral_key) {
            Ok(value) => value,
            Err(reason) => {
                return AppResult::fail(ErrorCode::InvalidArgument, reason, None);
            }
        };
    let signed_prekey =
        match decode_b64_fixed::<32>("recipient_signed_prekey", &recipient_signed_prekey) {
            Ok(value) => value,
            Err(reason) => {
                return AppResult::fail(ErrorCode::InvalidArgument, reason, None);
            }
        };
    let signed_prekey_private = match local_chat_store::crypto_load_signed_prekey_by_public(
        user_scope.as_str(),
        &signed_prekey,
    ) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::NotFound,
                format!(
                    "Secure channel could not use the requested signed pre-key: {}",
                    reason
                ),
                None,
            );
        }
    };
    let signed_prekey_pair = X25519KeyPair {
        private: StaticSecret::from(signed_prekey_private),
        public: PublicKey::from(signed_prekey),
    };
    let one_time_prekey = match recipient_one_time_prekey
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(value) => {
            let public = match decode_b64_fixed::<32>("recipient_one_time_prekey", value) {
                Ok(value) => value,
                Err(reason) => {
                    return AppResult::fail(ErrorCode::InvalidArgument, reason, None);
                }
            };
            let private = match local_chat_store::crypto_consume_opk_by_public(
                user_scope.as_str(),
                &public,
            ) {
                Ok(value) => value,
                Err(reason) => {
                    return AppResult::fail(
                        ErrorCode::NotFound,
                        format!(
                            "Secure channel could not consume its one-time pre-key: {}",
                            reason
                        ),
                        None,
                    );
                }
            };
            Some(X25519KeyPair {
                private: StaticSecret::from(private),
                public: PublicKey::from(public),
            })
        }
        None => None,
    };
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
            .identity_key_ref();
    let identity = match crypto::get_or_create_identity(identity_key_ref.as_str()) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity operation failed: {}", reason),
                None,
            );
        }
    };
    let shared_secret = match crypto::x3dh_receiver(
        &identity,
        &signed_prekey_pair,
        one_time_prekey.as_ref(),
        &sender_ik,
        &sender_ephemeral,
    ) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("X3DH key agreement failed: {}", reason),
                None,
            );
        }
    };
    let session =
        CryptoSessionState::from_x3dh_bootstrap(session_id.clone(), peer_did, false, None);
    if let Err(reason) = local_chat_store::save_crypto_session(user_scope.as_str(), &session) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to save crypto session: {}", reason),
            None,
        );
    }
    let dr = crypto::double_ratchet::init_responder(
        session_id.as_str(),
        &shared_secret,
        signed_prekey_private,
    );
    if let Err(reason) = local_chat_store::save_dr_session(user_scope.as_str(), &dr) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to save Double Ratchet session: {}", reason),
            None,
        );
    }
    if let Err(reason) = local_chat_store::set_crypto_session_handshake_delivered(
        user_scope.as_str(),
        session_id.as_str(),
        true,
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist secure-channel readiness: {}", reason),
            None,
        );
    }
    to_stub(
        "crypto_accept_session",
        json!({
            "established": true,
            "negotiated_version": negotiated_version,
        }),
    )
}

#[tauri::command]
pub fn crypto_session_status(
    session_id: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    crypto_session_status_for_scope(session_id, user_scope)
}

pub(crate) fn crypto_session_status_for_scope(
    session_id: String,
    user_scope: String,
) -> AppResult<StubPayload> {
    let delivered = match local_chat_store::crypto_session_handshake_delivered(
        user_scope.as_str(),
        session_id.as_str(),
    ) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load secure-channel delivery state: {}", reason),
                None,
            );
        }
    };
    match local_chat_store::load_dr_session(user_scope.as_str(), session_id.as_str()) {
        Ok(Some(_)) => {
            return to_stub(
                "crypto_session_status",
                json!({ "established": delivered, "version": 1 }),
            );
        }
        Ok(None) => {}
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load secure channel: {}", reason),
                None,
            );
        }
    }
    to_stub(
        "crypto_session_status",
        json!({ "established": false, "version": -1 }),
    )
}

#[tauri::command]
pub fn crypto_reset_session(
    session_id: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    crypto_reset_session_for_scope(session_id, user_scope)
}

pub(crate) fn crypto_reset_session_for_scope(
    session_id: String,
    user_scope: String,
) -> AppResult<StubPayload> {
    if session_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Session ID is required", None);
    }
    match local_chat_store::reset_crypto_session(user_scope.as_str(), session_id.as_str()) {
        Ok(()) => to_stub("crypto_reset_session", json!({ "reset": true })),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to reset secure channel: {}", reason),
            None,
        ),
    }
}

#[tauri::command]
pub fn crypto_mark_session_ready(
    session_id: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    crypto_mark_session_ready_for_scope(session_id, user_scope)
}

pub(crate) fn crypto_mark_session_ready_for_scope(
    session_id: String,
    user_scope: String,
) -> AppResult<StubPayload> {
    match local_chat_store::set_crypto_session_handshake_delivered(
        user_scope.as_str(),
        session_id.as_str(),
        true,
    ) {
        Ok(()) => to_stub("crypto_mark_session_ready", json!({ "established": true })),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist secure-channel readiness: {}", reason),
            None,
        ),
    }
}

#[tauri::command]
pub fn dr_encrypt(
    session_id: String,
    plaintext: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    dr_encrypt_for_scope(session_id, plaintext, user_scope)
}

pub(crate) fn dr_encrypt_for_scope(
    session_id: String,
    plaintext: String,
    user_scope: String,
) -> AppResult<StubPayload> {
    let _guard = dr_operation_lock().lock().unwrap();
    let mut session =
        match local_chat_store::load_dr_session(user_scope.as_str(), session_id.as_str()) {
            Ok(Some(value)) => value,
            Ok(None) => {
                return AppResult::fail(ErrorCode::NotFound, "Secure channel is not ready", None);
            }
            Err(reason) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("Failed to load secure channel: {}", reason),
                    None,
                );
            }
        };
    let plaintext = match B64.decode(plaintext.trim()) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid plaintext encoding: {}", reason),
                None,
            );
        }
    };
    let wire = match crypto::double_ratchet::encrypt(&mut session, &plaintext, b"") {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Secure message encryption failed: {:?}", reason),
                None,
            );
        }
    };
    if let Err(reason) = local_chat_store::save_dr_session(user_scope.as_str(), &session) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist secure channel: {}", reason),
            None,
        );
    }
    to_stub(
        "dr_encrypt",
        json!({
            "version": wire.version,
            "ciphertext": B64.encode(wire.ciphertext),
            "ratchet_pub": B64.encode(wire.sender_dh),
            "counter": wire.n_send,
            "prev_counter": wire.n_prev,
            "nonce": B64.encode(wire.nonce),
        }),
    )
}

#[tauri::command]
pub fn dr_decrypt(
    session_id: String,
    ciphertext: String,
    ratchet_pub: String,
    counter: u32,
    prev_counter: u32,
    nonce: String,
    version: u32,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    dr_decrypt_for_scope(
        session_id,
        ciphertext,
        ratchet_pub,
        counter,
        prev_counter,
        nonce,
        version,
        user_scope,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn dr_decrypt_for_scope(
    session_id: String,
    ciphertext: String,
    ratchet_pub: String,
    counter: u32,
    prev_counter: u32,
    nonce: String,
    version: u32,
    user_scope: String,
) -> AppResult<StubPayload> {
    let _guard = dr_operation_lock().lock().unwrap();
    let session = match local_chat_store::load_dr_session(user_scope.as_str(), session_id.as_str())
    {
        Ok(Some(value)) => value,
        Ok(None) => {
            return AppResult::fail(ErrorCode::NotFound, "Secure channel is not ready", None);
        }
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to load secure channel: {}", reason),
                None,
            );
        }
    };
    let ciphertext = match B64.decode(ciphertext.trim()) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid ciphertext encoding: {}", reason),
                None,
            );
        }
    };
    let sender_dh = match decode_b64_fixed::<32>("ratchet_pub", &ratchet_pub) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(ErrorCode::InvalidArgument, reason, None);
        }
    };
    let nonce = match decode_b64_fixed::<12>("nonce", &nonce) {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(ErrorCode::InvalidArgument, reason, None);
        }
    };
    let skipped =
        match local_chat_store::load_dr_skipped_keys(user_scope.as_str(), session_id.as_str()) {
            Ok(value) => value,
            Err(reason) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("Failed to load skipped message keys: {}", reason),
                    None,
                );
            }
        };
    let wire = crypto::double_ratchet::DrCiphertextWire {
        version,
        sender_dh,
        n_send: counter,
        n_prev: prev_counter,
        nonce,
        ciphertext,
    };
    let outcome = match crypto::double_ratchet::decrypt(&session, &wire, &skipped, b"") {
        Ok(value) => value,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Secure message decryption failed: {:?}", reason),
                None,
            );
        }
    };
    if let Err(reason) = local_chat_store::apply_dr_decrypt_outcome(
        user_scope.as_str(),
        &outcome.advanced_state,
        &outcome.new_skipped,
        outcome.consumed_skipped,
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist secure channel: {}", reason),
            None,
        );
    }
    crypto::telemetry::record_dr_decrypt();
    to_stub(
        "dr_decrypt",
        json!({ "plaintext": B64.encode(outcome.plaintext) }),
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
