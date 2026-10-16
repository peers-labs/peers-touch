use std::sync::Arc;

use ed25519_dalek::Signer;
use prost::Message;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{State, Window};
use ulid::Ulid;

use crate::error::{AppResult, ErrorCode};
use crate::model::chat::{
    DecideGroupInvitationRequest, DecideGroupInvitationResponse, GetGroupAdmissionSettingsResponse,
    GroupAdmissionMode, GroupInvitationDecisionAction, GroupInvitationDecisionCommand,
    GroupInvitationDecisionSigningInput, GroupInvitationState, ListGroupInvitationsRequest,
    ListGroupInvitationsResponse, RemoveRejectedGroupRequest, RemoveRejectedGroupResponse,
    RetryGroupLeaveRejectRequest, RetryGroupLeaveRejectResponse, StartGroupLeaveRejectRequest,
    StartGroupLeaveRejectResponse, SubmitGroupLeaveRejectIntentRequest,
    SubmitGroupLeaveRejectIntentResponse, UpdateGroupAdmissionPreferenceRequest,
    UpdateGroupAdmissionPreferenceResponse,
};
use crate::state::AppState;

const DECISION_TTL_MS: i64 = 5 * 60 * 1_000;

#[derive(Debug, Deserialize)]
pub struct GroupAdmissionPreferenceUpdateInput {
    pub mode: i32,
    pub observed_revision: u64,
}

#[derive(Debug, Deserialize)]
pub struct RejectedGroupRemoveInput {
    pub conversation_id: String,
    pub observed_policy_revision: u64,
}

#[derive(Debug, Deserialize)]
pub struct GroupInvitationsListInput {
    #[serde(default)]
    pub states: Vec<i32>,
}

#[derive(Debug, Deserialize)]
pub struct GroupInvitationDecisionInput {
    pub invitation_id: String,
    pub accept: bool,
    pub observed_state: i32,
    pub observed_policy_revision: u64,
}

#[derive(Debug, Deserialize)]
pub struct GroupLeaveRejectInput {
    pub operation_id: String,
    pub conversation_id: String,
    pub federation_id: String,
    pub authority_station_peer_id: String,
    pub group_name_snapshot: String,
    pub observed_policy_revision: u64,
}

#[derive(Debug, Deserialize)]
pub struct GroupLeaveRejectRetryInput {
    pub operation_id: String,
}

fn active_scope(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<(String, Arc<crate::messaging::MessagingEngine>), AppResult<Value>> {
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
    Ok((session.jwt, engine))
}

fn timestamp_json(timestamp: &Option<prost_types::Timestamp>) -> Value {
    timestamp
        .as_ref()
        .map(|value| json!({ "seconds": value.seconds, "nanos": value.nanos }))
        .unwrap_or(Value::Null)
}

fn preference_json(preference: &crate::model::chat::GroupAdmissionPreference) -> Value {
    json!({
        "actorPtid": preference.actor_ptid,
        "mode": preference.mode,
        "revision": preference.revision,
        "updatedAt": timestamp_json(&preference.updated_at),
    })
}

fn rejected_group_json(group: &crate::model::chat::RejectedGroup) -> Value {
    json!({
        "conversationId": group.conversation_id,
        "federationId": group.federation_id,
        "authorityStationPeerId": group.authority_station_peer_id,
        "groupNameSnapshot": group.group_name_snapshot,
        "policyRevision": group.policy_revision,
        "rejectedAt": timestamp_json(&group.rejected_at),
        "leaveRejectOperationId": group.leave_reject_operation_id,
        "leaveRejectState": group.leave_reject_state,
        "leaveRejectFailureCode": group.leave_reject_failure_code,
    })
}

fn leave_reject_operation_json(operation: &crate::model::chat::GroupLeaveRejectOperation) -> Value {
    json!({
        "operationId": operation.operation_id,
        "conversationId": operation.conversation_id,
        "state": operation.state,
        "rejectionPolicyRevision": operation.rejection_policy_revision,
        "leaveIntentId": operation.leave_intent_id,
        "fulfillmentTransitionId": operation.fulfillment_transition_id,
        "failureCode": operation.failure_code,
    })
}

fn invitation_json(invitation: &crate::model::chat::GroupInvitation) -> Value {
    json!({
        "version": invitation.version,
        "invitationId": invitation.invitation_id,
        "conversationId": invitation.conversation_id,
        "federationId": invitation.federation_id,
        "authorityStationPeerId": invitation.authority_station_peer_id,
        "authorityEpoch": invitation.authority_epoch,
        "inviterPtid": invitation.inviter_ptid,
        "inviteePtid": invitation.invitee_ptid,
        "inviteeHomeStationPeerId": invitation.invitee_home_station_peer_id,
        "state": invitation.state,
        "groupNameSnapshot": invitation.group_name_snapshot,
        "createdAt": timestamp_json(&invitation.created_at),
        "expiresAt": timestamp_json(&invitation.expires_at),
        "decidedAt": timestamp_json(&invitation.decided_at),
        "decisionCommandId": invitation.decision_command_id,
        "fulfillmentTransitionId": invitation.fulfillment_transition_id,
        "policyRevision": invitation.policy_revision,
    })
}

#[tauri::command]
pub fn group_admission_settings_get(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (token, _) = match active_scope(state.inner(), &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let response = match state
        .station
        .client()
        .request_proto::<(), GetGroupAdmissionSettingsResponse>(
            Method::GET,
            "/conversation/group-admission/settings",
            &token,
            None,
            None::<&()>,
        ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to load group admission settings"),
    };
    AppResult::success(json!({
        "preference": response.preference.as_ref().map(preference_json),
        "rejectedGroups": response.rejected_groups.iter().map(rejected_group_json).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub fn group_admission_preference_update(
    input: GroupAdmissionPreferenceUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (token, _) = match active_scope(state.inner(), &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let mode = match GroupAdmissionMode::try_from(input.mode) {
        Ok(GroupAdmissionMode::FriendsDirectAdd)
        | Ok(GroupAdmissionMode::FriendsRequireConfirmation) => input.mode,
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "group admission mode is invalid",
                None,
            )
        }
    };
    let response = match state.station.client().request_proto::<
        UpdateGroupAdmissionPreferenceRequest,
        UpdateGroupAdmissionPreferenceResponse,
    >(
        Method::PUT,
        "/conversation/group-admission/settings",
        &token,
        None,
        Some(&UpdateGroupAdmissionPreferenceRequest {
            mode,
            observed_revision: input.observed_revision,
        }),
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to update group admission preference"),
    };
    match response.preference.as_ref() {
        Some(preference) => AppResult::success(preference_json(preference)),
        None => AppResult::fail(
            ErrorCode::InternalError,
            "Station omitted group admission preference",
            None,
        ),
    }
}

#[tauri::command]
pub fn group_admission_rejected_group_remove(
    input: RejectedGroupRemoveInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (token, _) = match active_scope(state.inner(), &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let response = match state
        .station
        .client()
        .request_proto::<RemoveRejectedGroupRequest, RemoveRejectedGroupResponse>(
            Method::POST,
            "/conversation/group-admission/rejected-groups/remove",
            &token,
            None,
            Some(&RemoveRejectedGroupRequest {
                conversation_id: input.conversation_id.clone(),
                observed_policy_revision: input.observed_policy_revision,
            }),
        ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to remove rejected group"),
    };
    match response.preference.as_ref() {
        Some(preference) => AppResult::success(preference_json(preference)),
        None => AppResult::fail(
            ErrorCode::InternalError,
            "Station omitted group admission preference",
            None,
        ),
    }
}

#[tauri::command]
pub fn group_invitations_list(
    input: GroupInvitationsListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (token, _) = match active_scope(state.inner(), &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    if input.states.iter().any(|state| {
        matches!(
            GroupInvitationState::try_from(*state),
            Ok(GroupInvitationState::Unspecified) | Err(_)
        )
    }) {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group invitation state is invalid",
            None,
        );
    }
    let response = match state
        .station
        .client()
        .request_proto::<ListGroupInvitationsRequest, ListGroupInvitationsResponse>(
            Method::POST,
            "/conversation/group-invitations",
            &token,
            None,
            Some(&ListGroupInvitationsRequest {
                states: input.states,
            }),
        ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to list group invitations"),
    };
    AppResult::success(json!({
        "invitations": response.invitations.iter().map(invitation_json).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub fn group_invitation_decide(
    input: GroupInvitationDecisionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (token, engine) = match active_scope(state.inner(), &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let action = if input.accept {
        GroupInvitationDecisionAction::Accept
    } else {
        GroupInvitationDecisionAction::Decline
    };
    if matches!(
        GroupInvitationState::try_from(input.observed_state),
        Ok(GroupInvitationState::Unspecified) | Err(_)
    ) {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "observed group invitation state is invalid",
            None,
        );
    }
    let Some((signing_key_id, signing_key)) = (match engine.device_signing_identity() {
        Ok(identity) => identity,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    }) else {
        return AppResult::fail(
            ErrorCode::Conflict,
            "device signing identity is unavailable",
            None,
        );
    };
    let created_at_unix_ms = crate::messaging::now_unix_ms();
    let created_at = prost_types::Timestamp {
        seconds: created_at_unix_ms.div_euclid(1_000),
        nanos: (created_at_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
    };
    let expires_at_unix_ms = created_at_unix_ms + DECISION_TTL_MS;
    let expires_at = prost_types::Timestamp {
        seconds: expires_at_unix_ms.div_euclid(1_000),
        nanos: (expires_at_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
    };
    let command_id = Ulid::new().to_string();
    let actor = Some(messaging_core::proto::actor_device_ref(
        engine.endpoint().ptid.clone(),
        engine.endpoint().device_id.clone(),
    ));
    let signing_input = GroupInvitationDecisionSigningInput {
        version: 1,
        command_id: command_id.clone(),
        invitation_id: input.invitation_id.clone(),
        actor: actor.clone(),
        actor_signing_key_id: signing_key_id.clone(),
        action: action as i32,
        observed_state: input.observed_state,
        observed_policy_revision: input.observed_policy_revision,
        created_at: Some(created_at.clone()),
        expires_at: Some(expires_at.clone()),
    };
    let mut command = GroupInvitationDecisionCommand {
        version: 1,
        command_id,
        invitation_id: input.invitation_id,
        actor,
        actor_signing_key_id: signing_key_id,
        action: action as i32,
        observed_state: input.observed_state,
        observed_policy_revision: input.observed_policy_revision,
        created_at: Some(created_at),
        expires_at: Some(expires_at),
        actor_signature: Vec::new(),
    };
    command.actor_signature = signing_key
        .sign(&signing_input.encode_to_vec())
        .to_bytes()
        .to_vec();
    let response = match state
        .station
        .client()
        .request_proto_for_device::<DecideGroupInvitationRequest, DecideGroupInvitationResponse>(
            Method::POST,
            "/conversation/group-invitations/decide",
            &token,
            None,
            Some(&DecideGroupInvitationRequest {
                command: Some(command),
            }),
            &engine.endpoint().device_id,
        ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to decide group invitation"),
    };
    match response.invitation.as_ref() {
        Some(invitation) => AppResult::success(json!({
            "invitation": invitation_json(invitation),
            "grantId": response.grant.as_ref().map(|grant| grant.grant_id.clone()),
        })),
        None => AppResult::fail(
            ErrorCode::InternalError,
            "Station omitted group invitation decision",
            None,
        ),
    }
}

#[tauri::command]
pub fn group_leave_reject_start(
    input: GroupLeaveRejectInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (token, engine) = match active_scope(state.inner(), &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let response = match state
        .station
        .client()
        .request_proto_for_device::<StartGroupLeaveRejectRequest, StartGroupLeaveRejectResponse>(
            Method::POST,
            "/conversation/group-leave-reject",
            &token,
            None,
            Some(&StartGroupLeaveRejectRequest {
                operation_id: input.operation_id,
                conversation_id: input.conversation_id.clone(),
                federation_id: input.federation_id,
                authority_station_peer_id: input.authority_station_peer_id,
                group_name_snapshot: input.group_name_snapshot,
                observed_policy_revision: input.observed_policy_revision,
                actor: Some(messaging_core::proto::actor_device_ref(
                    engine.endpoint().ptid.clone(),
                    engine.endpoint().device_id.clone(),
                )),
            }),
            &engine.endpoint().device_id,
        ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to leave and reject group"),
    };
    let operation = match response.operation {
        Some(operation) => operation,
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Station omitted group leave-and-reject operation",
                None,
            )
        }
    };
    let leave_intent = match engine.create_leave_intent(&token, &input.conversation_id) {
        Ok(intent) => intent,
        Err(error) => {
            tracing::warn!(
                operation_id = %operation.operation_id,
                error = %error,
                "group leave-and-reject requires durable leave-intent retry"
            );
            let retry = state.station.client().request_proto_for_device::<
                RetryGroupLeaveRejectRequest,
                RetryGroupLeaveRejectResponse,
            >(
                Method::POST,
                "/conversation/group-leave-reject/retry",
                &token,
                None,
                Some(&RetryGroupLeaveRejectRequest {
                    operation_id: operation.operation_id,
                }),
                &engine.endpoint().device_id,
            );
            return match retry {
                Ok(response) => match response.operation.as_ref() {
                    Some(operation) => AppResult::success(leave_reject_operation_json(operation)),
                    None => AppResult::fail(
                        ErrorCode::InternalError,
                        "Station omitted group leave-and-reject retry state",
                        None,
                    ),
                },
                Err(error) => {
                    error.into_app_result("Failed to persist group leave-and-reject retry state")
                }
            };
        }
    };
    let submitted = match state.station.client().request_proto_for_device::<
        SubmitGroupLeaveRejectIntentRequest,
        SubmitGroupLeaveRejectIntentResponse,
    >(
        Method::POST,
        "/conversation/group-leave-reject/leave-intent",
        &token,
        None,
        Some(&SubmitGroupLeaveRejectIntentRequest {
            operation_id: operation.operation_id.clone(),
            leave_intent: Some(leave_intent),
        }),
        &engine.endpoint().device_id,
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to submit group leave intent"),
    };
    match submitted.operation {
        Some(operation) => AppResult::success(leave_reject_operation_json(&operation)),
        None => AppResult::fail(
            ErrorCode::InternalError,
            "Station omitted group leave-and-reject intent result",
            None,
        ),
    }
}

#[tauri::command]
pub fn group_leave_reject_retry(
    input: GroupLeaveRejectRetryInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (token, engine) = match active_scope(state.inner(), &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let response = match state
        .station
        .client()
        .request_proto_for_device::<RetryGroupLeaveRejectRequest, RetryGroupLeaveRejectResponse>(
            Method::POST,
            "/conversation/group-leave-reject/retry",
            &token,
            None,
            Some(&RetryGroupLeaveRejectRequest {
                operation_id: input.operation_id,
            }),
            &engine.endpoint().device_id,
        ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to retry group leave-and-reject"),
    };
    let operation = match response.operation {
        Some(operation) => operation,
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Station omitted group leave-and-reject retry state",
                None,
            )
        }
    };
    if operation.leave_intent_id.is_empty() {
        let leave_intent = match engine.create_leave_intent(&token, &operation.conversation_id) {
            Ok(intent) => intent,
            Err(error) => {
                tracing::warn!(
                    operation_id = %operation.operation_id,
                    error = %error,
                    "group leave-and-reject leave intent remains unavailable"
                );
                return AppResult::success(leave_reject_operation_json(&operation));
            }
        };
        let submitted = match state.station.client().request_proto_for_device::<
            SubmitGroupLeaveRejectIntentRequest,
            SubmitGroupLeaveRejectIntentResponse,
        >(
            Method::POST,
            "/conversation/group-leave-reject/leave-intent",
            &token,
            None,
            Some(&SubmitGroupLeaveRejectIntentRequest {
                operation_id: operation.operation_id,
                leave_intent: Some(leave_intent),
            }),
            &engine.endpoint().device_id,
        ) {
            Ok(response) => response,
            Err(error) => {
                return error.into_app_result("Failed to submit retried group leave intent")
            }
        };
        return match submitted.operation.as_ref() {
            Some(operation) => AppResult::success(leave_reject_operation_json(operation)),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station omitted retried group leave intent result",
                None,
            ),
        };
    }
    AppResult::success(leave_reject_operation_json(&operation))
}
