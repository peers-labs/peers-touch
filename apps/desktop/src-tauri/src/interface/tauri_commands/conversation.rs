use crate::application::session_resolver;
use crate::domain::crypto::{self, CryptoSession};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::{local_chat_store, station_client};
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

// --- Input types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationCreateDirectInput {
    pub peer_actor_did: String,
    pub peer_station_peer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationCreateGroupInput {
    pub name: String,
    pub members: Vec<ConversationMemberInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMemberInput {
    pub actor_did: String,
    pub station_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSubmitCommandInput {
    pub command: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationReactInput {
    pub conversation_id: String,
    pub message_id: String,
    pub emoji: String,
    #[serde(default)]
    pub remove: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationGetInput {
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationGetMembersInput {
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeSubmitInput {
    pub envelope: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeAckInput {
    pub device_id: String,
    pub inbox_item_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeResumeInput {
    pub device_id: String,
    pub after_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPackageUploadInput {
    pub device_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPackageFetchInput {
    pub actor_did: String,
    pub home_station_peer_id: Option<String>,
}

// --- Helper ---

fn get_token(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Value>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn station_err(e: station_client::StationClientError, msg: &str) -> AppResult<Value> {
    AppResult::fail(
        ErrorCode::InternalError,
        &format!("{}: {}", msg, e),
        None,
    )
}

// --- Conversation commands ---

#[tauri::command]
pub fn conversation_create_direct(
    input: ConversationCreateDirectInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "peer_actor_did": input.peer_actor_did,
        "peer_station_peer_id": input.peer_station_peer_id.unwrap_or_default(),
    });
    match station_client::request_json_auth(Method::POST, "/conversation/direct", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "create direct failed"),
    }
}

#[tauri::command]
pub fn conversation_create_group(
    input: ConversationCreateGroupInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let members: Vec<Value> = input
        .members
        .iter()
        .map(|m| {
            json!({
                "actor_did": m.actor_did,
                "station_id": m.station_id.clone().unwrap_or_default(),
            })
        })
        .collect();
    let body = json!({ "name": input.name, "members": members });
    match station_client::request_json_auth(Method::POST, "/conversation/group", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "create group failed"),
    }
}

#[tauri::command]
pub fn conversation_submit_command(
    input: ConversationSubmitCommandInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({ "command": input.command });
    match station_client::request_json_auth(Method::POST, "/conversation/command", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "submit command failed"),
    }
}

#[tauri::command]
pub fn conversation_react(
    input: ConversationReactInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "command": {
            "conversation_id": input.conversation_id,
            "react": {
                "message_id": input.message_id,
                "emoji": input.emoji,
                "remove": input.remove,
            }
        }
    });
    match station_client::request_json_auth(Method::POST, "/conversation/command", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "react failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationReceiptInput {
    pub conversation_id: String,
    pub message_id: String,
    pub device_id: String,
    pub receipt_type: i32,
}

#[tauri::command]
pub fn conversation_submit_receipt(
    input: ConversationReceiptInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "conversation_id": input.conversation_id,
        "message_id": input.message_id,
        "device_id": input.device_id,
        "receipt_type": input.receipt_type,
    });
    match station_client::request_json_auth(Method::POST, "/conversation/receipt", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "submit receipt failed"),
    }
}

#[tauri::command]
pub fn conversation_list(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    match station_client::request_json_auth(Method::GET, "/conversation/list", &token, None, None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "list conversations failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListEventsInput {
    pub conversation_id: String,
    pub after_seq: Option<i64>,
    pub limit: Option<i32>,
}

#[tauri::command]
pub fn conversation_list_events(
    input: ConversationListEventsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("after_seq", input.after_seq.unwrap_or(0).to_string()),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    match station_client::request_json_auth(Method::GET, "/conversation/events", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "list events failed"),
    }
}

#[tauri::command]
pub fn conversation_get_members(
    input: ConversationGetMembersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![("conversation_id", input.conversation_id)];
    match station_client::request_json_auth(Method::GET, "/conversation/members", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "get members failed"),
    }
}

// --- Envelope commands ---

#[tauri::command]
pub fn envelope_submit(
    input: EnvelopeSubmitInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({ "envelope": input.envelope });
    match station_client::request_json_auth(Method::POST, "/envelope/submit", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "envelope submit failed"),
    }
}

#[tauri::command]
pub fn envelope_ack(
    input: EnvelopeAckInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "device_id": input.device_id,
        "inbox_item_id": input.inbox_item_id,
    });
    match station_client::request_json_auth(Method::POST, "/envelope/ack", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "envelope ack failed"),
    }
}

#[tauri::command]
pub fn envelope_resume(
    input: EnvelopeResumeInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("device_id", input.device_id),
        ("after_cursor", input.after_cursor.unwrap_or_default()),
    ];
    match station_client::request_json_auth(Method::GET, "/envelope/resume", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "envelope resume failed"),
    }
}

// --- KeyPackage commands ---

#[tauri::command]
pub fn keypackage_upload(
    input: KeyPackageUploadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "device_id": input.device_id,
        "data": input.data,
    });
    match station_client::request_json_auth(Method::POST, "/keypackage/upload", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "keypackage upload failed"),
    }
}

#[tauri::command]
pub fn keypackage_fetch(
    input: KeyPackageFetchInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut body = json!({ "actor_did": input.actor_did });
    if let Some(ref station_id) = input.home_station_peer_id {
        body["home_station_peer_id"] = json!(station_id);
    }
    match station_client::request_json_auth(Method::POST, "/keypackage/fetch", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "keypackage fetch failed"),
    }
}

#[tauri::command]
pub fn keypackage_count(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    match station_client::request_json_auth(Method::GET, "/keypackage/count", &token, None, None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "keypackage count failed"),
    }
}

// --- Integrated encrypt+send (P2 private chat closure) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSendEncryptedInput {
    pub conversation_id: String,
    pub session_id: String,
    pub peer_did: String,
    pub plaintext: String,
    pub device_id: String,
}

#[tauri::command]
pub fn conversation_send_encrypted(
    input: ConversationSendEncryptedInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let user_scope = user_scope_from_state(&state, &window);

    let st = match local_chat_store::load_crypto_session(user_scope.as_str(), &input.session_id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "crypto session not found — initiate X3DH first",
                None,
            );
        }
        Err(e) => {
            return AppResult::fail(ErrorCode::InternalError, &format!("load session: {e}"), None);
        }
    };

    let mut session = CryptoSession::from_state(&st);
    let enc = match session.encrypt(input.plaintext.as_bytes()) {
        Ok(e) => e,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                &format!("encryption failed: {reason}"),
                None,
            );
        }
    };

    if let Err(e) = local_chat_store::save_crypto_session(user_scope.as_str(), &session.to_state())
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            &format!("save session: {e}"),
            None,
        );
    }

    let encrypted_payload = B64.encode(&enc.ciphertext);
    let command = json!({
        "conversation_id": input.conversation_id,
        "sender_device_id": input.device_id,
        "payload": {
            "send_message": {
                "encrypted_payload": encrypted_payload,
                "content_type": 1
            }
        }
    });

    let body = json!({ "command": command });
    match station_client::request_json_auth(Method::POST, "/conversation/command", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "send encrypted message failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationDecryptInput {
    pub session_id: String,
    pub peer_did: String,
    pub ciphertext: String,
    pub counter: u32,
}

#[tauri::command]
pub fn conversation_decrypt_message(
    input: ConversationDecryptInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let user_scope = user_scope_from_state(&state, &window);

    let st = match local_chat_store::load_crypto_session(user_scope.as_str(), &input.session_id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return AppResult::fail(ErrorCode::NotFound, "crypto session not found", None);
        }
        Err(e) => {
            return AppResult::fail(ErrorCode::InternalError, &format!("load session: {e}"), None);
        }
    };

    let ciphertext = match B64.decode(input.ciphertext.trim()) {
        Ok(b) => b,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                &format!("invalid base64: {e}"),
                None,
            );
        }
    };

    let mut session = CryptoSession::from_state(&st);
    let msg = crypto::EncryptedMessage {
        ciphertext,
        counter: input.counter,
        ephemeral_key: None,
    };
    let plaintext = match session.decrypt(&msg) {
        Ok(p) => p,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                &format!("decryption failed: {reason}"),
                None,
            );
        }
    };

    if let Err(e) = local_chat_store::save_crypto_session(user_scope.as_str(), &session.to_state())
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            &format!("save session: {e}"),
            None,
        );
    }

    let text = String::from_utf8_lossy(&plaintext).to_string();
    AppResult::success(json!({ "plaintext": text }))
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    session_resolver::actor_id_for_window(state.inner(), window).unwrap_or_default()
}

// --- Device commands ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRegisterInput {
    pub device_id: String,
    pub label: Option<String>,
    pub public_key: Option<Vec<u8>>,
}

#[tauri::command]
pub fn device_register(
    input: DeviceRegisterInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "device_id": input.device_id,
        "label": input.label.unwrap_or_default(),
        "public_key": input.public_key.unwrap_or_default(),
    });
    match station_client::request_json_auth(Method::POST, "/device/register", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "device register failed"),
    }
}

#[tauri::command]
pub fn device_list(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    match station_client::request_json_auth(Method::GET, "/device/list", &token, None, None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "device list failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRevokeInput {
    pub device_id: String,
}

#[tauri::command]
pub fn device_revoke(
    input: DeviceRevokeInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({ "device_id": input.device_id });
    match station_client::request_json_auth(Method::POST, "/device/revoke", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "device revoke failed"),
    }
}

// --- Direct Key Exchange (X3DH) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkxSendInput {
    pub recipient_actor_did: String,
    pub recipient_station_peer_id: Option<String>,
    pub session_id: String,
    pub kind: i32,
    pub opaque_key_material: Vec<u8>,
}

#[tauri::command]
pub fn dkx_send(
    input: DkxSendInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "recipient_actor_did": input.recipient_actor_did,
        "recipient_station_peer_id": input.recipient_station_peer_id.unwrap_or_default(),
        "session_id": input.session_id,
        "kind": input.kind,
        "opaque_key_material": input.opaque_key_material,
    });
    match station_client::request_json_auth(Method::POST, "/dkx/send", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "dkx send failed"),
    }
}

// =============================================================================
// Unified Message Queries (P2 — replaces friend_chat_* + group_chat_* commands)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListMessagesInput {
    pub conversation_id: String,
    pub after_seq: Option<i64>,
    pub limit: Option<i32>,
}

#[tauri::command]
pub fn conversation_list_messages(
    input: ConversationListMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("after_seq", input.after_seq.unwrap_or(0).to_string()),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    match station_client::request_json_auth(Method::GET, "/conversation/messages", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "list messages failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListThreadMessagesInput {
    pub conversation_id: String,
    pub root_id: String,
    pub after_seq: Option<i64>,
    pub limit: Option<i32>,
}

#[tauri::command]
pub fn conversation_list_thread_messages(
    input: ConversationListThreadMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("root_id", input.root_id),
        ("after_seq", input.after_seq.unwrap_or(0).to_string()),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    match station_client::request_json_auth(Method::GET, "/conversation/thread/messages", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "list thread messages failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationThreadCountsInput {
    pub conversation_id: String,
    pub root_ids: Vec<String>,
}

#[tauri::command]
pub fn conversation_thread_counts(
    input: ConversationThreadCountsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "conversation_id": input.conversation_id,
        "root_ids": input.root_ids,
    });
    match station_client::request_json_auth(Method::POST, "/conversation/thread/counts", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "thread counts failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSetReadCursorInput {
    pub conversation_id: String,
    pub last_read_seq: i64,
}

#[tauri::command]
pub fn conversation_set_read_cursor(
    input: ConversationSetReadCursorInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "conversation_id": input.conversation_id,
        "last_read_seq": input.last_read_seq,
    });
    match station_client::request_json_auth(Method::POST, "/conversation/read-cursor", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "set read cursor failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationGetUnreadInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn conversation_get_unread(
    input: ConversationGetUnreadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![("conversation_id", input.conversation_id)];
    match station_client::request_json_auth(Method::GET, "/conversation/unread", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "get unread failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMemberSettingsInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn conversation_get_member_settings(
    input: ConversationMemberSettingsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![("conversation_id", input.conversation_id)];
    match station_client::request_json_auth(Method::GET, "/conversation/member/settings", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "get member settings failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationUpdateMemberSettingsInput {
    pub conversation_id: String,
    pub nickname: Option<String>,
    pub muted: Option<bool>,
}

#[tauri::command]
pub fn conversation_update_member_settings(
    input: ConversationUpdateMemberSettingsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "conversation_id": input.conversation_id,
        "nickname": input.nickname,
        "muted": input.muted,
    });
    match station_client::request_json_auth(Method::PUT, "/conversation/member/settings", &token, None, Some(&body)) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "update member settings failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSearchInput {
    pub conversation_id: String,
    pub query: String,
    pub limit: Option<i32>,
}

#[tauri::command]
pub fn conversation_search_messages(
    input: ConversationSearchInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("q", input.query),
        ("limit", input.limit.unwrap_or(20).to_string()),
    ];
    match station_client::request_json_auth(Method::GET, "/conversation/messages/search", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "search messages failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSyncInput {
    pub conversation_id: String,
    pub limit: Option<i32>,
    pub max_pages: Option<i32>,
}

#[tauri::command]
pub fn conversation_sync_from_station(
    input: ConversationSyncInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let limit = input.limit.unwrap_or(200);
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("after_seq", "0".to_string()),
        ("limit", limit.to_string()),
    ];
    match station_client::request_json_auth(Method::GET, "/conversation/messages", &token, Some(&query), None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "sync from station failed"),
    }
}
