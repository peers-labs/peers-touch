use crate::error::{AppResult, ErrorCode};
use crate::model::chat::{ConversationKind, MessagingMembershipAction};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

#[derive(Debug, Deserialize)]
pub struct MessagingSendTextInput {
    pub conversation_id: String,
    pub conversation_kind: String,
    pub plaintext: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingListMessagesInput {
    pub conversation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingCreateDirectInput {
    pub peer_ptid: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingCreateGroupInput {
    pub conversation_id: String,
    pub name: String,
    pub member_ptids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct MessagingMembershipTransitionInput {
    pub conversation_id: String,
    pub action: String,
    pub target_ptid: String,
    #[serde(default)]
    pub target_device_id: String,
    #[serde(default)]
    pub role: String,
}

fn active_engine(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<(String, String, Arc<crate::messaging::MessagingEngine>), AppResult<Value>> {
    let session = state
        .sessions
        .get(window.label())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    if session.account_id.trim().is_empty() || session.jwt.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authenticated profile is incomplete",
            None,
        ));
    }
    let engine = state
        .messaging_engines
        .get(&session.account_id)
        .map_err(|error| AppResult::fail(ErrorCode::InternalError, error, None))?
        .ok_or_else(|| {
            AppResult::fail(
                ErrorCode::InternalError,
                "messaging profile engine is not active",
                None,
            )
        })?;
    Ok((session.account_id, session.jwt, engine))
}

#[tauri::command]
pub fn messaging_create_direct(
    input: MessagingCreateDirectInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.peer_ptid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "peer_ptid is required", None);
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let conversation_id = match engine.create_direct_conversation(&token, &input.peer_ptid) {
        Ok(conversation_id) => conversation_id,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    if let Err(error) = engine.drain_once(&token, 100) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "conversation_id": conversation_id,
        "state": "projected",
    }))
}

#[tauri::command]
pub fn messaging_list_conversations(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let conversations = match engine.conversations() {
        Ok(conversations) => conversations,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    AppResult::success(json!({
        "conversations": conversations.into_iter().map(|conversation| json!({
            "conversation_id": conversation.conversation_id,
            "authority_station_id": conversation.authority_station_id,
            "kind": conversation.kind,
            "name": conversation.name,
            "owner_ptid": conversation.owner_ptid,
            "member_ptids": conversation.member_ptids,
            "membership_epoch": conversation.membership_epoch,
            "mls_epoch": conversation.mls_epoch,
            "active": conversation.active,
            "updated_at_unix_ms": conversation.updated_at_unix_ms,
        })).collect::<Vec<_>>()
    }))
}

#[tauri::command]
pub fn messaging_create_group(
    input: MessagingCreateGroupInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.conversation_id.trim().is_empty()
        || input.name.trim().is_empty()
        || input.member_ptids.is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id, name, and members are required",
            None,
        );
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let conversation_id = match engine.create_group_conversation(
        &token,
        &input.conversation_id,
        &input.name,
        &input.member_ptids,
    ) {
        Ok(conversation_id) => conversation_id,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let progress = engine.dispatch_command_once(
        &token,
        crate::messaging::now_unix_ms(),
        crate::messaging::CommandRetryPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        },
    );
    if !matches!(
        progress,
        Ok(crate::messaging::CommandDispatchProgress::Submitted { .. })
            | Ok(crate::messaging::CommandDispatchProgress::Idle)
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("messaging group genesis dispatch incomplete: {progress:?}"),
            None,
        );
    }
    if let Err(error) = engine.drain_once(&token, 100) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "conversation_id": conversation_id,
        "state": "projected",
    }))
}

#[tauri::command]
pub fn messaging_membership_transition(
    input: MessagingMembershipTransitionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.conversation_id.trim().is_empty() || input.target_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and target_ptid are required",
            None,
        );
    }
    let action = match input.action.as_str() {
        "add_actor" => MessagingMembershipAction::AddActor,
        "remove_actor" => MessagingMembershipAction::RemoveActor,
        "add_device" => MessagingMembershipAction::AddDevice,
        "remove_device" => MessagingMembershipAction::RemoveDevice,
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "unsupported messaging membership action",
                None,
            );
        }
    };
    if matches!(
        action,
        MessagingMembershipAction::AddDevice | MessagingMembershipAction::RemoveDevice
    ) && input.target_device_id.trim().is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_device_id is required for a device transition",
            None,
        );
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let command = match engine.prepare_membership_transition(
        &token,
        &crate::messaging::MembershipTransitionIntentInput {
            conversation_id: input.conversation_id,
            action,
            target_ptid: input.target_ptid,
            target_device_id: input.target_device_id,
            role: input.role,
        },
    ) {
        Ok(command) => command,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let command_id = command.command_id.clone();
    let progress = engine.dispatch_command_once(
        &token,
        crate::messaging::now_unix_ms(),
        crate::messaging::CommandRetryPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        },
    );
    if !matches!(
        progress,
        Ok(crate::messaging::CommandDispatchProgress::Submitted { .. })
            | Ok(crate::messaging::CommandDispatchProgress::Idle)
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("messaging membership transition dispatch incomplete: {progress:?}"),
            None,
        );
    }
    if let Err(error) = engine.drain_once(&token, 100) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "command_id": command_id,
        "state": "pending",
    }))
}

#[tauri::command]
pub fn messaging_send_text(
    input: MessagingSendTextInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let conversation_kind = match input.conversation_kind.as_str() {
        "direct" => ConversationKind::Direct,
        "group" => ConversationKind::Group,
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "conversation_kind must be direct or group",
                None,
            );
        }
    };
    if input.conversation_id.trim().is_empty() || input.plaintext.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and plaintext are required",
            None,
        );
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let (command_id, message_id) = match engine.submit_text(
        &token,
        &input.conversation_id,
        conversation_kind,
        &input.plaintext,
    ) {
        Ok(value) => value,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "command_id": command_id,
        "message_id": message_id,
        "state": "pending",
    }))
}

#[tauri::command]
pub fn messaging_list_messages(
    input: MessagingListMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.conversation_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id is required",
            None,
        );
    }
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let messages = match engine.conversation_messages(&input.conversation_id) {
        Ok(messages) => messages,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    AppResult::success(json!({
        "messages": messages.into_iter().map(|message| json!({
            "event_id": message.event_id,
            "event_sequence": message.event_sequence,
            "message_id": message.message_id,
            "sender_ptid": message.sender_ptid,
            "sender_device_id": message.sender_device_id,
            "plaintext": message.plaintext,
            "state": message.state,
            "timestamp_unix_ms": message.timestamp_unix_ms,
        })).collect::<Vec<_>>()
    }))
}
