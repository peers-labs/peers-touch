use crate::application::key_exchange::device_install;
use crate::application::session_resolver;
use crate::domain::actor_device_identity::ActorDeviceIdentity;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::chat::{
    conversation_command, ConversationCommand, ConversationCommandKind,
    ConversationCommandProposal, ConversationCommandProposalSigningInput,
    ConversationCommandSubmissionState, GetConversationCommandProposalResultRequest,
    GetConversationCommandProposalResultResponse, SubmitConversationCommandProposalRequest,
    SubmitConversationCommandProposalResponse,
};
use crate::state::AppState;
use prost::Message;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::{State, Window};

// --- Input types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationCreateDirectInput {
    pub peer_ptid: String,
    pub peer_station_peer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationCreateGroupInput {
    pub name: String,
    pub genesis_transition: Value,
    pub federation_id: Option<String>,
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSubmitCommandInput {
    pub command: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSubmitCommandProposalInput {
    pub federation_id: String,
    pub authority_station_peer_id: String,
    pub authority_epoch: i64,
    pub home_station_peer_id: String,
    pub command_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationGetCommandProposalResultInput {
    pub conversation_id: String,
    pub command_id: String,
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
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPackageFetchInput {
    pub ptid: String,
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
    e.into_app_result(msg)
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
        Err(e) => {
            tracing::warn!("conversation_create_direct: no token");
            return e;
        }
    };
    let body = json!({
        "peer_ptid": input.peer_ptid,
        "peer_station_peer_id": input.peer_station_peer_id.unwrap_or_default(),
    });
    tracing::info!(peer_ptid = %input.peer_ptid, "conversation_create_direct: calling station");
    match station_client::request_json_auth(
        Method::POST,
        "/conversation/direct",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => {
            let conv_id = resp.get("conversation").and_then(|c| c.get("conversation_id")).and_then(|v| v.as_str()).unwrap_or("?");
            tracing::info!(conversation_id = %conv_id, "conversation_create_direct: success");
            AppResult::success(resp)
        }
        Err(e) => {
            tracing::warn!(error = %e, "conversation_create_direct: failed");
            station_err(e, "create direct failed")
        }
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
    let body = json!({
        "name": input.name,
        "genesis_transition": input.genesis_transition,
        "federation_id": input.federation_id.unwrap_or_default(),
        "conversation_id": input.conversation_id,
    });
    match station_client::request_json_auth(
        Method::POST,
        "/conversation/group",
        &token,
        None,
        Some(&body),
    ) {
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
    match station_client::request_json_auth(
        Method::POST,
        "/conversation/command",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "submit command failed"),
    }
}

#[tauri::command]
pub fn conversation_submit_command_proposal(
    input: ConversationSubmitCommandProposalInput,
    identity: State<'_, Arc<ActorDeviceIdentity>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    conversation_submit_command_proposal_with_token(input, identity.inner(), &token)
}

pub(crate) fn conversation_submit_command_proposal_with_token(
    input: ConversationSubmitCommandProposalInput,
    identity: &ActorDeviceIdentity,
    token: &str,
) -> AppResult<Value> {
    let command = match ConversationCommand::decode(input.command_bytes.as_slice()) {
        Ok(command) => command,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("decode conversation command: {error}"),
                None,
            )
        }
    };
    let command_kind = match command_kind(&command) {
        Some(kind) => kind,
        None => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "unsupported durable conversation command",
                None,
            )
        }
    };
    if input.federation_id.is_empty()
        || input.authority_station_peer_id.is_empty()
        || input.home_station_peer_id.is_empty()
        || input.authority_epoch <= 0
        || command.command_id.is_empty()
        || command.conversation_id.is_empty()
        || command.sender_ptid.is_empty()
        || command.sender_device_id.is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "remote conversation command routing is incomplete",
            None,
        );
    }
    let (signing_key_id, _) = match identity.signing_identity() {
        Ok(identity) => identity,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, &error, None),
    };
    let created_at_unix_ms = match unix_time_millis() {
        Ok(value) => value,
        Err(error) => return error,
    };
    let expires_at_unix_ms = created_at_unix_ms + 5 * 60 * 1000;
    let canonical_command_bytes = command.encode_to_vec();
    let command_sha256 = Sha256::digest(&canonical_command_bytes).to_vec();
    let signing_input = ConversationCommandProposalSigningInput {
        version: 1,
        federation_id: input.federation_id.clone(),
        authority_station_peer_id: input.authority_station_peer_id.clone(),
        authority_epoch: input.authority_epoch,
        home_station_peer_id: input.home_station_peer_id.clone(),
        conversation_id: command.conversation_id.clone(),
        command_id: command.command_id.clone(),
        command_kind: command_kind as i32,
        actor_ptid: command.sender_ptid.clone(),
        actor_device_id: command.sender_device_id.clone(),
        actor_signing_key_id: signing_key_id.clone(),
        command_sha256: command_sha256.clone(),
        created_at_unix_ms,
        expires_at_unix_ms,
    };
    let actor_signature = match identity.sign(&signing_input.encode_to_vec()) {
        Ok(signature) => signature,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, &error, None),
    };
    let proposal = ConversationCommandProposal {
        version: 1,
        federation_id: input.federation_id,
        authority_station_peer_id: input.authority_station_peer_id,
        authority_epoch: input.authority_epoch,
        home_station_peer_id: input.home_station_peer_id,
        actor_ptid: command.sender_ptid.clone(),
        actor_device_id: command.sender_device_id.clone(),
        actor_signing_key_id: signing_key_id,
        command: Some(command),
        command_sha256,
        actor_signature,
        created_at_unix_ms,
        expires_at_unix_ms,
    };
    let response = match station_client::request_proto::<
        SubmitConversationCommandProposalRequest,
        SubmitConversationCommandProposalResponse,
    >(
        Method::POST,
        "/conversation/command-proposal",
        token,
        None,
        Some(&SubmitConversationCommandProposalRequest {
            proposal: Some(proposal),
        }),
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("submit conversation command proposal"),
    };
    command_proposal_response_json(response)
}

#[tauri::command]
pub fn conversation_get_command_proposal_result(
    input: ConversationGetCommandProposalResultInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    conversation_get_command_proposal_result_with_token(input, &token)
}

pub(crate) fn conversation_get_command_proposal_result_with_token(
    input: ConversationGetCommandProposalResultInput,
    token: &str,
) -> AppResult<Value> {
    if input.conversation_id.is_empty() || input.command_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and command_id are required",
            None,
        );
    }
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("command_id", input.command_id),
    ];
    let response = match station_client::request_proto::<
        GetConversationCommandProposalResultRequest,
        GetConversationCommandProposalResultResponse,
    >(
        Method::GET,
        "/conversation/command-proposal/result",
        token,
        Some(&query),
        None::<&GetConversationCommandProposalResultRequest>,
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("get conversation command proposal result"),
    };
    command_proposal_result_json(
        response.conversation_id,
        response.command_id,
        response.state,
        response.result,
        response.next_retry_at_unix_ms,
    )
}

fn command_proposal_response_json(
    response: SubmitConversationCommandProposalResponse,
) -> AppResult<Value> {
    command_proposal_result_json(
        response.conversation_id,
        response.command_id,
        response.state,
        response.result,
        0,
    )
}

fn command_proposal_result_json(
    conversation_id: String,
    command_id: String,
    state: i32,
    result: Option<crate::model::chat::ConversationCommandProposalResult>,
    next_retry_at_unix_ms: i64,
) -> AppResult<Value> {
    let event_bytes = result
        .as_ref()
        .and_then(|value| value.committed_event.as_ref())
        .map(Message::encode_to_vec);
    let reject_code = result.as_ref().map(|value| value.reject_code).unwrap_or(0);
    let retryable = result
        .as_ref()
        .map(|value| value.retryable)
        .unwrap_or(false);
    AppResult::success(json!({
        "conversation_id": conversation_id,
        "command_id": command_id,
        "state": state,
        "accepted": state == ConversationCommandSubmissionState::Accepted as i32,
        "terminal_rejected": state == ConversationCommandSubmissionState::TerminalRejected as i32,
        "retryable": retryable,
        "reject_code": reject_code,
        "event_bytes": event_bytes,
        "next_retry_at_unix_ms": next_retry_at_unix_ms,
    }))
}

fn command_kind(command: &ConversationCommand) -> Option<ConversationCommandKind> {
    match command.payload.as_ref()? {
        conversation_command::Payload::SendMessage(_) => Some(ConversationCommandKind::SendMessage),
        conversation_command::Payload::EditMessage(_) => Some(ConversationCommandKind::EditMessage),
        conversation_command::Payload::RetractMessage(_) => {
            Some(ConversationCommandKind::RetractMessage)
        }
        conversation_command::Payload::Dissolve(_) => Some(ConversationCommandKind::Dissolve),
        conversation_command::Payload::UpdateSettings(_) => {
            Some(ConversationCommandKind::UpdateSettings)
        }
        conversation_command::Payload::React(_) => Some(ConversationCommandKind::React),
        conversation_command::Payload::PinMessage(_) => Some(ConversationCommandKind::PinMessage),
        conversation_command::Payload::MembershipTransition(_) => {
            Some(ConversationCommandKind::MembershipTransition)
        }
        conversation_command::Payload::Typing(_) => None,
    }
}

fn unix_time_millis() -> Result<i64, AppResult<Value>> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .map_err(|error| {
            AppResult::fail(
                ErrorCode::InternalError,
                format!("system clock before Unix epoch: {error}"),
                None,
            )
        })
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
    match station_client::request_json_auth(
        Method::POST,
        "/conversation/command",
        &token,
        None,
        Some(&body),
    ) {
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
    match station_client::request_json_auth(
        Method::POST,
        "/conversation/receipt",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "submit receipt failed"),
    }
}

#[tauri::command]
pub fn conversation_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(window = %window.label(), "conversation_list: no token available");
            return e;
        }
    };
    match station_client::request_json_auth(Method::GET, "/conversation/list", &token, None, None) {
        Ok(resp) => {
            let count = resp.get("conversations")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            tracing::info!(count, "conversation_list: success");
            AppResult::success(resp)
        }
        Err(e) => {
            tracing::warn!(error = %e, "conversation_list: station request failed");
            station_err(e, "list conversations failed")
        }
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
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/events",
        &token,
        Some(&query),
        None,
    ) {
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
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/members",
        &token,
        Some(&query),
        None,
    ) {
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
    match station_client::request_json_auth(
        Method::POST,
        "/envelope/submit",
        &token,
        None,
        Some(&body),
    ) {
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
    match station_client::request_json_auth(
        Method::POST,
        "/envelope/ack",
        &token,
        None,
        Some(&body),
    ) {
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
    match station_client::request_json_auth(
        Method::GET,
        "/envelope/resume",
        &token,
        Some(&query),
        None,
    ) {
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
    match station_client::request_json_auth(
        Method::POST,
        "/keypackage/upload",
        &token,
        None,
        Some(&body),
    ) {
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
    let mut body = json!({ "ptid": input.ptid });
    if let Some(ref station_id) = input.home_station_peer_id {
        body["home_station_peer_id"] = json!(station_id);
    }
    match station_client::request_json_auth(
        Method::POST,
        "/keypackage/fetch",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "keypackage fetch failed"),
    }
}

#[tauri::command]
pub fn keypackage_count(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    match station_client::request_json_auth(Method::GET, "/keypackage/count", &token, None, None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "keypackage count failed"),
    }
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    session_resolver::actor_id_for_window(state.inner(), window).unwrap_or_default()
}

// --- Device commands ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRegisterInput {
    pub device_id: String,
    pub label: Option<String>,
    pub public_key: Option<String>,
    pub signing_key_id: Option<String>,
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
    let device_id = input.device_id.trim();
    if device_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "device_id is required", None);
    }
    let body = json!({
        "device_id": device_id,
        "label": input.label.unwrap_or_default(),
        "public_key": input.public_key.unwrap_or_default(),
        "signing_key_id": input.signing_key_id.unwrap_or_default(),
        "profile_version": 1,
    });
    match station_client::request_json_auth_with_device_id(
        Method::POST,
        "/device/register",
        &token,
        None,
        Some(&body),
        device_id,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "device register failed"),
    }
}

#[tauri::command]
pub fn device_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Value> {
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
    match station_client::request_json_auth(
        Method::POST,
        "/device/revoke",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "device revoke failed"),
    }
}

// --- Direct Key Exchange (X3DH) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkxSendInput {
    pub recipient_ptid: String,
    pub recipient_device_id: String,
    pub recipient_station_peer_id: Option<String>,
    pub conversation_id: String,
    pub session_id: String,
    pub kind: i32,
    pub opaque_key_material: String,
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
    let actor_id = user_scope_from_state(&state, &window);
    if actor_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let sender_device_id = match device_install::get_or_create_device_id(&actor_id) {
        Ok(device_id) => device_id,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("device_id: {error}"),
                None,
            );
        }
    };
    let body = json!({
        "recipient_ptid": input.recipient_ptid,
        "recipient_device_id": input.recipient_device_id,
        "recipient_station_peer_id": input.recipient_station_peer_id.unwrap_or_default(),
        "conversation_id": input.conversation_id,
        "session_id": input.session_id,
        "kind": input.kind,
        "opaque_key_material": input.opaque_key_material,
    });
    match station_client::request_json_auth_with_device_id(
        Method::POST,
        "/dkx/send",
        &token,
        None,
        Some(&body),
        &sender_device_id,
    ) {
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
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/messages",
        &token,
        Some(&query),
        None,
    ) {
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
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/thread/messages",
        &token,
        Some(&query),
        None,
    ) {
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
    match station_client::request_json_auth(
        Method::POST,
        "/conversation/thread/counts",
        &token,
        None,
        Some(&body),
    ) {
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
    match station_client::request_json_auth(
        Method::POST,
        "/conversation/read-cursor",
        &token,
        None,
        Some(&body),
    ) {
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
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/unread",
        &token,
        Some(&query),
        None,
    ) {
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
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/member/settings",
        &token,
        Some(&query),
        None,
    ) {
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
    match station_client::request_json_auth(
        Method::PUT,
        "/conversation/member/settings",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "update member settings failed"),
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
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/messages",
        &token,
        Some(&query),
        None,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "sync from station failed"),
    }
}
