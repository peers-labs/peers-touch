use crate::application::session_resolver;
use crate::domain::mls_group::MlsGroupManager;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsInitIdentityInput {
    pub actor_did: String,
}

#[tauri::command]
pub fn mls_init_identity(
    input: MlsInitIdentityInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    mls.init_identity(&input.actor_did);
    AppResult::success(json!({}))
}

#[tauri::command]
pub fn mls_generate_key_package(mls: State<'_, Arc<MlsGroupManager>>) -> AppResult<Value> {
    match mls.generate_key_package() {
        Ok(kp_bytes) => AppResult::success(json!({ "key_package": kp_bytes })),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupCreateInput {
    pub conversation_id: String,
    pub member_key_packages: Vec<Vec<u8>>,
}

#[tauri::command]
pub fn mls_group_create(
    input: MlsGroupCreateInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.create_group(&input.conversation_id, &input.member_key_packages) {
        Ok(result) => AppResult::success(json!({
            "group_id": result.group_id,
            "welcome_bytes": result.welcome_bytes,
            "commit_bytes": result.commit_bytes,
        })),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupJoinInput {
    pub conversation_id: String,
    pub welcome_bytes: Vec<u8>,
}

#[tauri::command]
pub fn mls_group_join(
    input: MlsGroupJoinInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.join_group(&input.conversation_id, &input.welcome_bytes) {
        Ok(()) => AppResult::success(json!({})),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupEncryptInput {
    pub conversation_id: String,
    pub plaintext: Vec<u8>,
}

#[tauri::command]
pub fn mls_group_encrypt(
    input: MlsGroupEncryptInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.encrypt(&input.conversation_id, &input.plaintext) {
        Ok(result) => AppResult::success(json!({ "ciphertext": result.ciphertext })),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupDecryptInput {
    pub conversation_id: String,
    pub ciphertext: Vec<u8>,
}

#[tauri::command]
pub fn mls_group_decrypt(
    input: MlsGroupDecryptInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.decrypt(&input.conversation_id, &input.ciphertext) {
        Ok(plaintext) => AppResult::success(json!({ "plaintext": plaintext })),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupProcessCommitInput {
    pub conversation_id: String,
    pub commit_bytes: Vec<u8>,
}

#[tauri::command]
pub fn mls_group_process_commit(
    input: MlsGroupProcessCommitInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.process_commit(&input.conversation_id, &input.commit_bytes) {
        Ok(()) => AppResult::success(json!({})),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupAddMemberInput {
    pub conversation_id: String,
    pub member_key_package: Vec<u8>,
}

#[tauri::command]
pub fn mls_group_add_member(
    input: MlsGroupAddMemberInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.add_member(&input.conversation_id, &input.member_key_package) {
        Ok((commit_bytes, welcome_bytes)) => AppResult::success(json!({
            "commit_bytes": commit_bytes,
            "welcome_bytes": welcome_bytes,
        })),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupRemoveMemberInput {
    pub conversation_id: String,
    pub member_actor_did: String,
}

#[tauri::command]
pub fn mls_group_remove_member(
    input: MlsGroupRemoveMemberInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.remove_member(&input.conversation_id, &input.member_actor_did) {
        Ok(commit_bytes) => AppResult::success(json!({ "commit_bytes": commit_bytes })),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupStatusInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn mls_group_status(
    input: MlsGroupStatusInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    AppResult::success(json!({ "ready": mls.has_session(&input.conversation_id) }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupSaveInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn mls_group_save(
    input: MlsGroupSaveInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.save_session(&input.conversation_id) {
        Ok(()) => AppResult::success(json!({})),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupLoadInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn mls_group_load(
    input: MlsGroupLoadInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.load_session(&input.conversation_id) {
        Ok(()) => AppResult::success(json!({})),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

// --- MLS distribute (routes MLS material through Station) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsDistributeInput {
    pub conversation_id: String,
    pub kind: i32,
    pub mls_epoch: i64,
    pub opaque_bytes: Vec<u8>,
    pub recipients: Option<Vec<String>>,
}

#[tauri::command]
pub fn mls_distribute(
    input: MlsDistributeInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let body = json!({
        "conversation_id": input.conversation_id,
        "kind": input.kind,
        "mls_epoch": input.mls_epoch,
        "opaque_bytes": input.opaque_bytes,
        "recipients": input.recipients.unwrap_or_default(),
    });
    match station_client::request_json_auth(
        Method::POST,
        "/mls/distribute",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => AppResult::fail(
            ErrorCode::InternalError,
            &format!("mls distribute failed: {e}"),
            None,
        ),
    }
}
