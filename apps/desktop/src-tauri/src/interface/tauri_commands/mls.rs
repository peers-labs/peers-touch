use crate::application::session_resolver;
use crate::domain::actor_device_identity::ActorDeviceIdentity;
use crate::domain::mls_group::{MlsGroupManager, MlsMemberKeyPackage};
use crate::domain::mls_transition::{
    can_bootstrap_from_welcome, classify_event_order, decode_authority_event, decode_mls_delivery,
    validate_event_delivery_pair, EventOrder, RecipientTransitionHead, RECIPIENT_REORDER_LIMIT,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::{local_chat_store, station_client};
use crate::model::chat::{
    CommittedConversationEvent, GetConversationIdentityResponse,
    ListPendingMlsLeaveIntentsResponse, MlsLeaveIntent, MlsLeaveIntentSigningInput,
    MlsTransitionDeliveryKind, MlsTransitionDeliveryPayload, SubmitMlsLeaveIntentRequest,
    SubmitMlsLeaveIntentResponse,
};
use crate::state::AppState;
use prost::Message;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsInitIdentityInput {
    pub ptid: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsSubmitLeaveIntentInput {
    pub federation_id: String,
    pub authority_station_peer_id: String,
    pub authority_epoch: i64,
    pub home_station_peer_id: String,
    pub conversation_id: String,
    pub actor_ptid: String,
    pub actor_device_id: String,
    pub observed_membership_epoch: i64,
    pub observed_mls_epoch: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsListLeaveIntentsInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn mls_init_identity(
    mut input: MlsInitIdentityInput,
    actor_identity: State<'_, Arc<ActorDeviceIdentity>>,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let token = match session_resolver::token_for_window(state.inner(), &window) {
        Some(token) => token,
        None => return AppResult::fail(ErrorCode::Unauthorized, "auth required", None),
    };
    let identity = match station_client::request_proto::<(), GetConversationIdentityResponse>(
        Method::GET,
        "/conversation/identity",
        &token,
        None,
        None::<&()>,
    ) {
        Ok(identity) => identity,
        Err(e) => return e.into_app_result("resolve authenticated actor PTID"),
    };
    if !identity.ptid.starts_with("ptid:") {
        return AppResult::fail(
            ErrorCode::Conflict,
            "authenticated actor has no canonical PTID",
            None,
        );
    }
    input.ptid = identity.ptid;
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    mls_init_identity_for_scope(input, actor_identity.inner(), mls.inner(), &scope)
}

pub(crate) fn mls_init_identity_for_scope(
    input: MlsInitIdentityInput,
    identity: &ActorDeviceIdentity,
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    match local_chat_store::crypto_load_actor_device_identity(user_scope) {
        Ok(Some((ptid, blob))) if ptid == input.ptid => {
            if let Err(e) = identity.import(&input.ptid, &input.device_id, &blob) {
                return AppResult::fail(ErrorCode::InternalError, &e, None);
            }
        }
        Ok(Some(_)) => {
            return AppResult::fail(
                ErrorCode::Conflict,
                "persisted MLS identity belongs to a different actor",
                None,
            )
        }
        Ok(None) => {
            if let Err(e) = identity.init(&input.ptid, &input.device_id) {
                return AppResult::fail(ErrorCode::InvalidArgument, &e, None);
            }
            let blob = match identity.export(&input.ptid, &input.device_id) {
                Ok(blob) => blob,
                Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
            };
            if let Err(e) =
                local_chat_store::crypto_save_actor_device_identity(user_scope, &input.ptid, &blob)
            {
                return AppResult::fail(ErrorCode::InternalError, &e, None);
            }
        }
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    }
    match local_chat_store::crypto_load_mls_join_provider_pool(user_scope) {
        Ok(Some(blob)) => {
            if let Err(e) = mls.import_pending_join_providers(&blob) {
                return AppResult::fail(ErrorCode::InternalError, &e, None);
            }
        }
        Ok(None) => {}
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    }
    match identity.signing_identity() {
        Ok((signing_key_id, public_key)) => AppResult::success(json!({
            "ptid": input.ptid,
            "signing_key_id": signing_key_id,
            "public_key": public_key,
        })),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[tauri::command]
pub fn mls_submit_leave_intent(
    input: MlsSubmitLeaveIntentInput,
    identity: State<'_, Arc<ActorDeviceIdentity>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match session_resolver::token_for_window(state.inner(), &window) {
        Some(token) => token,
        None => return AppResult::fail(ErrorCode::Unauthorized, "auth required", None),
    };
    mls_submit_leave_intent_with_token(input, identity.inner(), &token)
}

pub(crate) fn mls_submit_leave_intent_with_token(
    input: MlsSubmitLeaveIntentInput,
    identity: &ActorDeviceIdentity,
    token: &str,
) -> AppResult<Value> {
    let (signing_key_id, _) = match identity.signing_identity() {
        Ok(identity) => identity,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    let created_at = match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("system clock before Unix epoch: {e}"),
                None,
            )
        }
    };
    let mut intent = MlsLeaveIntent {
        version: 1,
        intent_id: ulid::Ulid::new().to_string(),
        federation_id: input.federation_id,
        authority_station_peer_id: input.authority_station_peer_id,
        authority_epoch: input.authority_epoch,
        home_station_peer_id: input.home_station_peer_id,
        conversation_id: input.conversation_id,
        actor_ptid: input.actor_ptid,
        actor_device_id: input.actor_device_id,
        actor_signing_key_id: signing_key_id,
        observed_membership_epoch: input.observed_membership_epoch,
        observed_mls_epoch: input.observed_mls_epoch,
        created_at_unix_ms: created_at,
        expires_at_unix_ms: created_at + 5 * 60 * 1000,
        actor_signature: Vec::new(),
    };
    let signing_input = MlsLeaveIntentSigningInput {
        version: intent.version,
        intent_id: intent.intent_id.clone(),
        federation_id: intent.federation_id.clone(),
        authority_station_peer_id: intent.authority_station_peer_id.clone(),
        authority_epoch: intent.authority_epoch,
        home_station_peer_id: intent.home_station_peer_id.clone(),
        conversation_id: intent.conversation_id.clone(),
        actor_ptid: intent.actor_ptid.clone(),
        actor_device_id: intent.actor_device_id.clone(),
        actor_signing_key_id: intent.actor_signing_key_id.clone(),
        observed_membership_epoch: intent.observed_membership_epoch,
        observed_mls_epoch: intent.observed_mls_epoch,
        created_at_unix_ms: intent.created_at_unix_ms,
        expires_at_unix_ms: intent.expires_at_unix_ms,
    };
    intent.actor_signature = match identity.sign(&signing_input.encode_to_vec()) {
        Ok(signature) => signature,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    let response = match station_client::request_proto::<
        SubmitMlsLeaveIntentRequest,
        SubmitMlsLeaveIntentResponse,
    >(
        Method::POST,
        "/conversation/mls/leave-intent",
        token,
        None,
        Some(&SubmitMlsLeaveIntentRequest {
            intent: Some(intent),
        }),
    ) {
        Ok(response) => response,
        Err(e) => return e.into_app_result("submit MLS leave intent"),
    };
    match response.intent {
        Some(intent) => AppResult::success(leave_intent_json(&intent)),
        None => AppResult::fail(
            ErrorCode::InternalError,
            "Station returned no leave intent",
            None,
        ),
    }
}

#[tauri::command]
pub fn mls_list_leave_intents(
    input: MlsListLeaveIntentsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match session_resolver::token_for_window(state.inner(), &window) {
        Some(token) => token,
        None => return AppResult::fail(ErrorCode::Unauthorized, "auth required", None),
    };
    mls_list_leave_intents_with_token(input, &token)
}

pub(crate) fn mls_list_leave_intents_with_token(
    input: MlsListLeaveIntentsInput,
    token: &str,
) -> AppResult<Value> {
    let query = [("conversation_id", input.conversation_id)];
    match station_client::request_proto::<(), ListPendingMlsLeaveIntentsResponse>(
        Method::GET,
        "/conversation/mls/leave-intents",
        token,
        Some(&query),
        None,
    ) {
        Ok(response) => AppResult::success(json!({
            "intents": response.intents.iter().map(leave_intent_json).collect::<Vec<_>>(),
        })),
        Err(e) => e.into_app_result("list MLS leave intents"),
    }
}

fn leave_intent_json(intent: &MlsLeaveIntent) -> Value {
    json!({
        "version": intent.version,
        "intent_id": intent.intent_id,
        "federation_id": intent.federation_id,
        "authority_station_peer_id": intent.authority_station_peer_id,
        "authority_epoch": intent.authority_epoch,
        "home_station_peer_id": intent.home_station_peer_id,
        "conversation_id": intent.conversation_id,
        "actor_ptid": intent.actor_ptid,
        "actor_device_id": intent.actor_device_id,
        "actor_signing_key_id": intent.actor_signing_key_id,
        "observed_membership_epoch": intent.observed_membership_epoch,
        "observed_mls_epoch": intent.observed_mls_epoch,
        "created_at_unix_ms": intent.created_at_unix_ms,
        "expires_at_unix_ms": intent.expires_at_unix_ms,
        "actor_signature": intent.actor_signature,
    })
}

#[tauri::command]
pub fn mls_generate_key_package(
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    mls_generate_key_package_for_scope(mls.inner(), &scope)
}

pub(crate) fn mls_generate_key_package_for_scope(
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    match mls.generate_key_package() {
        Ok(kp_bytes) => {
            let pool = match mls.export_pending_join_providers() {
                Ok(pool) => pool,
                Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
            };
            match local_chat_store::crypto_save_mls_join_provider_pool(user_scope, &pool) {
                Ok(()) => AppResult::success(json!({ "key_package": kp_bytes })),
                Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
            }
        }
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupCreateInput {
    pub conversation_id: String,
    pub members: Vec<MlsMemberKeyPackage>,
}

#[tauri::command]
pub fn mls_group_create(
    input: MlsGroupCreateInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    match mls.create_group(&input.conversation_id, &input.members) {
        Ok(result) => {
            let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
            let scope =
                crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
            let blob = match mls.export_pending_transition(&input.conversation_id) {
                Ok(blob) => blob,
                Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
            };
            match local_chat_store::crypto_save_mls_pending_transition(
                &scope,
                &input.conversation_id,
                &result.transition_id,
                &blob,
            ) {
                Ok(()) => AppResult::success(json!(result)),
                Err(e) => {
                    mls.discard_pending_transition(&input.conversation_id);
                    AppResult::fail(ErrorCode::InternalError, &e, None)
                }
            }
        }
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
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    mls_group_join_for_scope(input, mls.inner(), &scope)
}

pub(crate) fn mls_group_join_for_scope(
    input: MlsGroupJoinInput,
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    let previous_pool = match mls.export_pending_join_providers() {
        Ok(pool) => pool,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    if let Err(e) = mls.join_group(&input.conversation_id, &input.welcome_bytes) {
        return AppResult::fail(ErrorCode::InternalError, &e, None);
    }
    let state_blob = match mls.export_session_state(&input.conversation_id) {
        Ok(blob) => blob,
        Err(e) => {
            mls.remove_session(&input.conversation_id);
            let _ = mls.import_pending_join_providers(&previous_pool);
            return AppResult::fail(ErrorCode::InternalError, &e, None);
        }
    };
    let provider_pool = match mls.export_pending_join_providers() {
        Ok(pool) => pool,
        Err(e) => {
            mls.remove_session(&input.conversation_id);
            let _ = mls.import_pending_join_providers(&previous_pool);
            return AppResult::fail(ErrorCode::InternalError, &e, None);
        }
    };
    if let Err(e) = local_chat_store::crypto_save_mls_join_result(
        user_scope,
        &input.conversation_id,
        &state_blob,
        &provider_pool,
    ) {
        mls.remove_session(&input.conversation_id);
        let restore_error = mls.import_pending_join_providers(&previous_pool).err();
        let message = match restore_error {
            Some(restore) => format!("{e}; restore MLS join provider pool: {restore}"),
            None => e,
        };
        return AppResult::fail(ErrorCode::InternalError, &message, None);
    }
    AppResult::success(json!({}))
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
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let user_scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    mls_group_encrypt_for_scope(input, mls.inner(), &user_scope)
}

pub(crate) fn mls_group_encrypt_for_scope(
    input: MlsGroupEncryptInput,
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    let head = match local_chat_store::crypto_load_mls_recipient_head(
        user_scope,
        &input.conversation_id,
    ) {
        Ok(head) => head,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, &error, None),
    };
    let buffers = match local_chat_store::crypto_count_mls_recipient_buffers(
        user_scope,
        &input.conversation_id,
    ) {
        Ok(buffers) => buffers,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, &error, None),
    };
    if head
        .as_ref()
        .is_some_and(|head| head.status == "establishing" || head.status == "crypto_desynced")
        || buffers.0 > 0
        || buffers.1 > 0
    {
        return AppResult::fail(
            ErrorCode::Conflict,
            "MLS recipient state is not ready for sends",
            None,
        );
    }
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
    pub member: MlsMemberKeyPackage,
}

#[tauri::command]
pub fn mls_group_add_member(
    input: MlsGroupAddMemberInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    match mls.add_member(&input.conversation_id, &input.member) {
        Ok(prepared) => {
            let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
            let scope =
                crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
            let blob = match mls.export_pending_transition(&input.conversation_id) {
                Ok(blob) => blob,
                Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
            };
            match local_chat_store::crypto_save_mls_pending_transition(
                &scope,
                &input.conversation_id,
                &prepared.transition_id,
                &blob,
            ) {
                Ok(()) => AppResult::success(json!(prepared)),
                Err(e) => {
                    mls.discard_pending_transition(&input.conversation_id);
                    AppResult::fail(ErrorCode::InternalError, &e, None)
                }
            }
        }
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupRemoveMemberInput {
    pub conversation_id: String,
    pub member_ptid: String,
}

#[tauri::command]
pub fn mls_group_remove_member(
    input: MlsGroupRemoveMemberInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    match mls.remove_member(&input.conversation_id, &input.member_ptid) {
        Ok(prepared) => {
            let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
            let scope =
                crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
            let blob = match mls.export_pending_transition(&input.conversation_id) {
                Ok(blob) => blob,
                Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
            };
            match local_chat_store::crypto_save_mls_pending_transition(
                &scope,
                &input.conversation_id,
                &prepared.transition_id,
                &blob,
            ) {
                Ok(()) => AppResult::success(json!(prepared)),
                Err(e) => {
                    mls.discard_pending_transition(&input.conversation_id);
                    AppResult::fail(ErrorCode::InternalError, &e, None)
                }
            }
        }
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupRemoveDeviceInput {
    pub conversation_id: String,
    pub member_ptid: String,
    pub device_id: String,
}

#[tauri::command]
pub fn mls_group_remove_device(
    input: MlsGroupRemoveDeviceInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    match mls.remove_device(&input.conversation_id, &input.member_ptid, &input.device_id) {
        Ok(prepared) => {
            let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
            let scope =
                crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
            let blob = match mls.export_pending_transition(&input.conversation_id) {
                Ok(blob) => blob,
                Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
            };
            match local_chat_store::crypto_save_mls_pending_transition(
                &scope,
                &input.conversation_id,
                &prepared.transition_id,
                &blob,
            ) {
                Ok(()) => AppResult::success(json!(prepared)),
                Err(e) => {
                    mls.discard_pending_transition(&input.conversation_id);
                    AppResult::fail(ErrorCode::InternalError, &e, None)
                }
            }
        }
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsPendingTransitionInput {
    pub conversation_id: String,
    pub transition_id: Option<String>,
}

#[tauri::command]
pub fn mls_group_accept_pending(
    input: MlsPendingTransitionInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    mls_group_accept_pending_for_scope(input, mls.inner(), &scope)
}

pub(crate) fn mls_group_accept_pending_for_scope(
    input: MlsPendingTransitionInput,
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    let pending_blob = match mls.export_pending_transition(&input.conversation_id) {
        Ok(blob) => blob,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    let pending = match mls.pending_transition(&input.conversation_id) {
        Ok(pending) => pending,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    let expected = input.transition_id.unwrap_or_default();
    if let Err(e) = mls.accept_pending_transition(&input.conversation_id, &expected) {
        return AppResult::fail(ErrorCode::InternalError, &e, None);
    }
    let accepted_blob = match mls.export_session_state(&input.conversation_id) {
        Ok(blob) => blob,
        Err(e) => {
            let _ = mls.import_pending_transition(&input.conversation_id, &pending_blob);
            return AppResult::fail(ErrorCode::InternalError, &e, None);
        }
    };
    if let Err(e) = local_chat_store::crypto_accept_mls_transition(
        user_scope,
        &input.conversation_id,
        &pending.transition_id,
        pending.from_mls_epoch as i64,
        pending.to_mls_epoch as i64,
        &pending.commit_sha256,
        &accepted_blob,
    ) {
        let restore_error = mls
            .import_pending_transition(&input.conversation_id, &pending_blob)
            .err();
        let message = match restore_error {
            Some(restore) => format!("{e}; restore pending transition: {restore}"),
            None => e,
        };
        return AppResult::fail(ErrorCode::InternalError, &message, None);
    }
    AppResult::success(json!({ "accepted": true }))
}

#[tauri::command]
pub fn mls_group_discard_pending(
    input: MlsPendingTransitionInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    if let Err(e) =
        local_chat_store::crypto_delete_mls_pending_transition(&scope, &input.conversation_id)
    {
        return AppResult::fail(ErrorCode::InternalError, &e, None);
    }
    AppResult::success(json!({
        "discarded": mls.discard_pending_transition(&input.conversation_id),
    }))
}

#[tauri::command]
pub fn mls_group_pending_status(
    input: MlsPendingTransitionInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    AppResult::success(json!({
        "pending": mls.has_pending_transition(&input.conversation_id),
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsRecipientAuthorityEventInput {
    pub event_bytes: Vec<u8>,
    pub recipient_device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsRecipientDeliveryInput {
    pub delivery_bytes: Vec<u8>,
    pub recipient_device_id: String,
}

pub(crate) fn canonical_mls_identity_ptid(user_scope: &str) -> Result<String, String> {
    match local_chat_store::crypto_load_actor_device_identity(user_scope)? {
        Some((ptid, _)) if ptid.starts_with("ptid:") => Ok(ptid),
        Some(_) => Err("persisted MLS identity is not a canonical PTID".to_string()),
        None => Err("MLS identity is not initialized".to_string()),
    }
}

#[tauri::command]
pub fn mls_recipient_record_authority_event(
    input: MlsRecipientAuthorityEventInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    if actor_id.is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id.as_str()));
    let recipient_ptid = match canonical_mls_identity_ptid(&scope) {
        Ok(ptid) => ptid,
        Err(error) => return AppResult::fail(ErrorCode::Conflict, &error, None),
    };
    mls_recipient_record_authority_event_for_scope(input, mls.inner(), &scope, &recipient_ptid)
}

pub(crate) fn mls_recipient_record_authority_event_for_scope(
    input: MlsRecipientAuthorityEventInput,
    mls: &MlsGroupManager,
    user_scope: &str,
    recipient_ptid: &str,
) -> AppResult<Value> {
    let _guard = mls.lock_recipient_transitions();
    let context = CommittedConversationEvent::decode(input.event_bytes.as_slice())
        .ok()
        .map(|event| event.conversation_id)
        .unwrap_or_default();
    let authority = match decode_authority_event(&input.event_bytes) {
        Ok(authority) => authority,
        Err(error) => return recipient_failure(user_scope, &context, &error),
    };
    let conversation_id = authority.event.conversation_id.clone();
    match local_chat_store::crypto_load_mls_recipient_head(user_scope, &conversation_id) {
        Ok(Some(head)) if head.status == "crypto_desynced" => {
            return AppResult::fail(
                ErrorCode::Conflict,
                "MLS recipient state is crypto-desynced",
                None,
            )
        }
        Ok(_) => {}
        Err(error) => return recipient_failure(user_scope, &conversation_id, &error),
    }
    match local_chat_store::crypto_load_mls_applied_event_hash(
        user_scope,
        &conversation_id,
        authority.event.group_seq,
    ) {
        Ok(Some(hash)) if hash == authority.event.event_hash => {
            return AppResult::success(json!({
                "status": "active",
                "applied": 0,
                "duplicate": true,
                "buffered": 0,
            }))
        }
        Ok(Some(_)) => {
            return recipient_failure(
                user_scope,
                &conversation_id,
                "authority reused an applied group_seq with a different event hash",
            )
        }
        Ok(None) => {}
        Err(error) => return recipient_failure(user_scope, &conversation_id, &error),
    }
    if let Err(error) = local_chat_store::crypto_enqueue_mls_recipient_event(
        user_scope,
        &conversation_id,
        authority.event.group_seq,
        &authority.event.event_hash,
        &input.event_bytes,
        RECIPIENT_REORDER_LIMIT,
    ) {
        return recipient_failure(user_scope, &conversation_id, &error);
    }
    drain_mls_recipient_queue(
        mls,
        user_scope,
        &conversation_id,
        recipient_ptid,
        &input.recipient_device_id,
    )
}

#[tauri::command]
pub fn mls_recipient_apply_delivery(
    input: MlsRecipientDeliveryInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    if actor_id.is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id.as_str()));
    let recipient_ptid = match canonical_mls_identity_ptid(&scope) {
        Ok(ptid) => ptid,
        Err(error) => return AppResult::fail(ErrorCode::Conflict, &error, None),
    };
    mls_recipient_apply_delivery_for_scope(input, mls.inner(), &scope, &recipient_ptid)
}

pub(crate) fn mls_recipient_apply_delivery_for_scope(
    input: MlsRecipientDeliveryInput,
    mls: &MlsGroupManager,
    user_scope: &str,
    recipient_ptid: &str,
) -> AppResult<Value> {
    let _guard = mls.lock_recipient_transitions();
    let context = MlsTransitionDeliveryPayload::decode(input.delivery_bytes.as_slice())
        .ok()
        .map(|delivery| delivery.conversation_id)
        .unwrap_or_default();
    let material = match decode_mls_delivery(&input.delivery_bytes) {
        Ok(material) => material,
        Err(error) => return recipient_failure(user_scope, &context, &error),
    };
    let conversation_id = material.delivery.conversation_id.clone();
    match local_chat_store::crypto_load_mls_recipient_head(user_scope, &conversation_id) {
        Ok(Some(head)) if head.status == "crypto_desynced" => {
            return AppResult::fail(
                ErrorCode::Conflict,
                "MLS recipient state is crypto-desynced",
                None,
            )
        }
        Ok(_) => {}
        Err(error) => return recipient_failure(user_scope, &conversation_id, &error),
    }
    match local_chat_store::crypto_load_mls_applied_transition(
        user_scope,
        &conversation_id,
        &material.delivery.transition_id,
    ) {
        Ok(Some(applied))
            if applied.group_seq == material.delivery.group_seq
                && applied.payload_sha256 == material.delivery.payload_sha256
                && applied.kind == material.kind as i32 =>
        {
            return AppResult::success(json!({
                "status": "active",
                "applied": 0,
                "duplicate": true,
                "buffered": 0,
            }))
        }
        Ok(Some(_)) => {
            return recipient_failure(
                user_scope,
                &conversation_id,
                "applied MLS transition identity was reused with different material",
            )
        }
        Ok(None) => {}
        Err(error) => return recipient_failure(user_scope, &conversation_id, &error),
    }
    let buffered = local_chat_store::CryptoMlsBufferedDelivery {
        transition_id: material.delivery.transition_id.clone(),
        group_seq: material.delivery.group_seq,
        kind: material.kind as i32,
        payload_sha256: material.delivery.payload_sha256.clone(),
        delivery_blob: input.delivery_bytes,
    };
    if let Err(error) = local_chat_store::crypto_enqueue_mls_recipient_delivery(
        user_scope,
        &buffered,
        &conversation_id,
        RECIPIENT_REORDER_LIMIT,
    ) {
        return recipient_failure(user_scope, &conversation_id, &error);
    }
    if let Err(error) = local_chat_store::crypto_mark_mls_recipient_status(
        user_scope,
        &conversation_id,
        "establishing",
        "",
    ) {
        return AppResult::fail(ErrorCode::InternalError, &error, None);
    }
    drain_mls_recipient_queue(
        mls,
        user_scope,
        &conversation_id,
        recipient_ptid,
        &input.recipient_device_id,
    )
}

fn drain_mls_recipient_queue(
    mls: &MlsGroupManager,
    user_scope: &str,
    conversation_id: &str,
    recipient_ptid: &str,
    recipient_device_id: &str,
) -> AppResult<Value> {
    let mut applied_count = 0usize;
    let mut duplicate_count = 0usize;
    loop {
        let stored_head =
            match local_chat_store::crypto_load_mls_recipient_head(user_scope, conversation_id) {
                Ok(head) => head,
                Err(error) => return recipient_failure(user_scope, conversation_id, &error),
            };
        if stored_head
            .as_ref()
            .is_some_and(|head| head.status == "crypto_desynced")
        {
            return AppResult::fail(
                ErrorCode::Conflict,
                "MLS recipient state is crypto-desynced",
                None,
            );
        }
        let head = stored_head
            .as_ref()
            .filter(|head| head.group_seq > 0)
            .map(|head| RecipientTransitionHead {
                group_seq: head.group_seq,
                event_hash: head.event_hash.clone(),
                membership_epoch: head.membership_epoch,
                mls_epoch: head.mls_epoch,
                transition_id: head.transition_id.clone(),
                commit_sha256: head.commit_sha256.clone(),
            });
        let buffered_event = match local_chat_store::crypto_load_next_mls_recipient_event(
            user_scope,
            conversation_id,
        ) {
            Ok(event) => event,
            Err(error) => return recipient_failure(user_scope, conversation_id, &error),
        };
        let Some(buffered_event) = buffered_event else {
            let (events, deliveries) = match local_chat_store::crypto_count_mls_recipient_buffers(
                user_scope,
                conversation_id,
            ) {
                Ok(counts) => counts,
                Err(error) => return recipient_failure(user_scope, conversation_id, &error),
            };
            let status = if events == 0 && deliveries == 0 {
                "active"
            } else {
                "establishing"
            };
            return AppResult::success(json!({
                "status": status,
                "applied": applied_count,
                "duplicate": duplicate_count > 0,
                "buffered": events + deliveries,
            }));
        };
        let authority = match decode_authority_event(&buffered_event.event_blob) {
            Ok(authority) => authority,
            Err(error) => return recipient_failure(user_scope, conversation_id, &error),
        };
        if authority.event.group_seq <= head.as_ref().map_or(0, |head| head.group_seq) {
            match local_chat_store::crypto_load_mls_applied_event_hash(
                user_scope,
                conversation_id,
                authority.event.group_seq,
            ) {
                Ok(Some(hash)) if hash == authority.event.event_hash => {
                    if let Err(error) = local_chat_store::crypto_delete_mls_recipient_event(
                        user_scope,
                        conversation_id,
                        authority.event.group_seq,
                    ) {
                        return recipient_failure(user_scope, conversation_id, &error);
                    }
                    duplicate_count += 1;
                    continue;
                }
                Ok(_) => {
                    return recipient_failure(
                        user_scope,
                        conversation_id,
                        "authority replay conflicts with the durable applied-event ledger",
                    )
                }
                Err(error) => return recipient_failure(user_scope, conversation_id, &error),
            }
        }
        let order = match classify_event_order(head.as_ref(), &authority.event) {
            Ok(order) => order,
            Err(error) => return recipient_failure(user_scope, conversation_id, &error),
        };
        let transition = authority.transition.as_ref();
        let material = if let Some(transition) = transition {
            match local_chat_store::crypto_load_mls_recipient_delivery(
                user_scope,
                conversation_id,
                &transition.transition_id,
            ) {
                Ok(material) => material,
                Err(error) => return recipient_failure(user_scope, conversation_id, &error),
            }
        } else {
            None
        };
        if order == EventOrder::Gap {
            let bootstrap = match (material.as_ref(), transition) {
                (Some(material), Some(_)) => match decode_mls_delivery(&material.delivery_blob) {
                    Ok(material) => {
                        can_bootstrap_from_welcome(head.as_ref(), &authority, &material)
                    }
                    Err(error) => return recipient_failure(user_scope, conversation_id, &error),
                },
                _ => false,
            };
            if !bootstrap {
                if let Err(error) = local_chat_store::crypto_mark_mls_recipient_status(
                    user_scope,
                    conversation_id,
                    "establishing",
                    "authority event gap",
                ) {
                    return AppResult::fail(ErrorCode::InternalError, &error, None);
                }
                let (events, deliveries) = local_chat_store::crypto_count_mls_recipient_buffers(
                    user_scope,
                    conversation_id,
                )
                .unwrap_or((0, 0));
                return AppResult::success(json!({
                    "status": "establishing",
                    "applied": applied_count,
                    "duplicate": duplicate_count > 0,
                    "buffered": events + deliveries,
                }));
            }
        }
        if transition.is_none() {
            let mls_epoch = head.as_ref().map_or(0, |head| head.mls_epoch);
            if let Err(error) = local_chat_store::crypto_commit_plain_recipient_event(
                user_scope,
                conversation_id,
                authority.event.group_seq,
                &authority.event.event_hash,
                authority.event.membership_epoch,
                mls_epoch,
            ) {
                return recipient_failure(user_scope, conversation_id, &error);
            }
            applied_count += 1;
            continue;
        }
        let transition = transition.expect("checked transition");
        let Some(material) = material else {
            let local_accepted = match local_chat_store::crypto_load_mls_local_accepted_transition(
                user_scope,
                conversation_id,
                &transition.transition_id,
            ) {
                Ok(marker) => marker,
                Err(error) => return recipient_failure(user_scope, conversation_id, &error),
            };
            if let Some(marker) = local_accepted {
                let epochs_match = marker.from_mls_epoch == transition.from_mls_epoch
                    && marker.to_mls_epoch == transition.to_mls_epoch
                    && marker.commit_sha256 == transition.commit_sha256;
                let group_epoch = mls
                    .group_epoch(conversation_id)
                    .ok()
                    .map(|epoch| epoch as i64);
                if !epochs_match || group_epoch != Some(transition.to_mls_epoch) {
                    return recipient_failure(
                        user_scope,
                        conversation_id,
                        "locally accepted MLS transition differs from authority evidence",
                    );
                }
                if let Some(head) = head.as_ref() {
                    if transition.from_membership_epoch != head.membership_epoch
                        || transition.from_mls_epoch != head.mls_epoch
                    {
                        return recipient_failure(
                            user_scope,
                            conversation_id,
                            "locally accepted transition does not advance durable recipient epochs",
                        );
                    }
                }
                let accepted_state = match mls.export_session_state(conversation_id) {
                    Ok(state) => state,
                    Err(error) => return recipient_failure(user_scope, conversation_id, &error),
                };
                if let Err(error) = local_chat_store::crypto_commit_mls_recipient_transition(
                    user_scope,
                    conversation_id,
                    authority.event.group_seq,
                    &authority.event.event_hash,
                    transition.to_membership_epoch,
                    transition.to_mls_epoch,
                    &transition.transition_id,
                    &transition.commit_sha256,
                    &transition.commit_sha256,
                    MlsTransitionDeliveryKind::Commit as i32,
                    &accepted_state,
                    None,
                ) {
                    return recipient_failure(user_scope, conversation_id, &error);
                }
                applied_count += 1;
                continue;
            }
            if let Err(error) = local_chat_store::crypto_mark_mls_recipient_status(
                user_scope,
                conversation_id,
                "establishing",
                "waiting for MLS transition material",
            ) {
                return AppResult::fail(ErrorCode::InternalError, &error, None);
            }
            return AppResult::success(json!({
                "status": "establishing",
                "applied": applied_count,
                "duplicate": duplicate_count > 0,
                "buffered": 1,
            }));
        };
        let material = match decode_mls_delivery(&material.delivery_blob) {
            Ok(material) => material,
            Err(error) => return recipient_failure(user_scope, conversation_id, &error),
        };
        if let Err(error) =
            validate_event_delivery_pair(&authority, &material, recipient_ptid, recipient_device_id)
        {
            return recipient_failure(user_scope, conversation_id, &error);
        }
        if let Some(head) = head.as_ref() {
            if transition.from_membership_epoch != head.membership_epoch
                || transition.from_mls_epoch != head.mls_epoch
            {
                return recipient_failure(
                    user_scope,
                    conversation_id,
                    "MLS transition does not advance the durable recipient epochs",
                );
            }
        } else if !can_bootstrap_from_welcome(None, &authority, &material) {
            return recipient_failure(
                user_scope,
                conversation_id,
                "recipient cannot bootstrap without an addressed MLS Welcome",
            );
        }
        let prepared = match material.kind {
            MlsTransitionDeliveryKind::Commit => mls.prepare_received_commit(
                conversation_id,
                &material.delivery.opaque_mls_bytes,
                &transition.changes,
            ),
            MlsTransitionDeliveryKind::Welcome => mls.prepare_received_welcome(
                conversation_id,
                &material.delivery.opaque_mls_bytes,
                &transition.changes,
            ),
            MlsTransitionDeliveryKind::Unspecified => {
                Err("MLS transition delivery kind is unspecified".to_string())
            }
        };
        let prepared = match prepared {
            Ok(prepared) => prepared,
            Err(error) => return recipient_failure(user_scope, conversation_id, &error),
        };
        if let Err(error) = local_chat_store::crypto_commit_mls_recipient_transition(
            user_scope,
            conversation_id,
            authority.event.group_seq,
            &authority.event.event_hash,
            transition.to_membership_epoch,
            transition.to_mls_epoch,
            &transition.transition_id,
            &transition.commit_sha256,
            &material.delivery.payload_sha256,
            material.kind as i32,
            &prepared.session_state,
            prepared.provider_pool_state.as_deref(),
        ) {
            return recipient_failure(user_scope, conversation_id, &error);
        }
        if let Err(error) = mls.install_received_state(conversation_id, &prepared) {
            return recipient_failure(user_scope, conversation_id, &error);
        }
        applied_count += 1;
    }
}

fn recipient_failure(user_scope: &str, conversation_id: &str, error: &str) -> AppResult<Value> {
    if !conversation_id.is_empty() {
        let _ = local_chat_store::crypto_mark_mls_recipient_status(
            user_scope,
            conversation_id,
            "crypto_desynced",
            error,
        );
    }
    AppResult::fail(ErrorCode::Conflict, error, None)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsRecipientStatusInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn mls_recipient_status(
    input: MlsRecipientStatusInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let recipient_ptid =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    if recipient_ptid.is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let scope =
        crate::infrastructure::local_scope::user_scope_for_actor(Some(recipient_ptid.as_str()));
    mls_recipient_status_for_scope(input, mls.inner(), &scope)
}

pub(crate) fn mls_recipient_status_for_scope(
    input: MlsRecipientStatusInput,
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    let head = match local_chat_store::crypto_load_mls_recipient_head(
        user_scope,
        &input.conversation_id,
    ) {
        Ok(head) => head,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, &error, None),
    };
    let (events, deliveries) = match local_chat_store::crypto_count_mls_recipient_buffers(
        user_scope,
        &input.conversation_id,
    ) {
        Ok(counts) => counts,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, &error, None),
    };
    let status = match head.as_ref().map(|head| head.status.as_str()) {
        Some("crypto_desynced") => "crypto_desynced",
        Some("establishing") => "establishing",
        _ if events > 0 || deliveries > 0 => "establishing",
        _ if mls.has_session(&input.conversation_id) => "active",
        _ => "idle",
    };
    AppResult::success(json!({
        "status": status,
        "group_seq": head.as_ref().map_or(0, |head| head.group_seq),
        "membership_epoch": head.as_ref().map_or(0, |head| head.membership_epoch),
        "mls_epoch": head.as_ref().map_or(0, |head| head.mls_epoch),
        "buffered": events + deliveries,
        "last_error": head.as_ref().map_or("", |head| head.last_error.as_str()),
    }))
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

#[tauri::command]
pub fn mls_group_public_head(
    input: MlsGroupStatusInput,
    mls: State<'_, Arc<MlsGroupManager>>,
) -> AppResult<Value> {
    match mls.public_head(&input.conversation_id) {
        Ok(head) => AppResult::success(json!(head)),
        Err(e) => AppResult::fail(ErrorCode::NotFound, &e, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupSaveInput {
    pub conversation_id: String,
}

#[tauri::command]
pub fn mls_group_save(
    input: MlsGroupSaveInput,
    mls: State<'_, Arc<MlsGroupManager>>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let user_scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    mls_group_save_for_scope(input, mls.inner(), &user_scope)
}

pub(crate) fn mls_group_save_for_scope(
    input: MlsGroupSaveInput,
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    let state_blob = match mls.export_session_state(&input.conversation_id) {
        Ok(blob) => blob,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    match local_chat_store::crypto_save_mls_state(user_scope, &input.conversation_id, &state_blob) {
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
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let user_scope = crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref());
    mls_group_load_for_scope(input, mls.inner(), &user_scope)
}

pub(crate) fn mls_group_load_for_scope(
    input: MlsGroupLoadInput,
    mls: &MlsGroupManager,
    user_scope: &str,
) -> AppResult<Value> {
    let accepted = match local_chat_store::crypto_load_mls_state(user_scope, &input.conversation_id)
    {
        Ok(state) => state,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    let pending = match local_chat_store::crypto_load_mls_pending_transition(
        user_scope,
        &input.conversation_id,
    ) {
        Ok(state) => state,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };
    if accepted.is_none() && pending.is_none() {
        return AppResult::fail(ErrorCode::NotFound, "MLS session state not found", None);
    }
    if let Some(state_blob) = accepted {
        if let Err(e) = mls.import_session_state(&input.conversation_id, &state_blob) {
            return AppResult::fail(ErrorCode::InternalError, &e, None);
        }
    }
    if let Some((transition_id, blob)) = pending {
        match mls.import_pending_transition(&input.conversation_id, &blob) {
            Ok(prepared) if prepared.transition_id == transition_id => {}
            Ok(_) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "pending MLS transition identity mismatch",
                    None,
                )
            }
            Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
        }
    }
    AppResult::success(json!({}))
}

#[cfg(test)]
mod recipient_transition_tests {
    use super::*;
    use crate::model::chat::{
        committed_conversation_event, CommittedConversationEvent, ConversationCreatedEvent,
        MembershipTransitionCommittedEvent, MlsTransitionDeliveryPayload, MlsWelcomeDescriptor,
    };
    use prost::Message;
    use sha2::{Digest, Sha256};

    fn unique_scope() -> String {
        format!(
            "test-mls-recipient-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn finalize_event(mut event: CommittedConversationEvent) -> (Vec<u8>, Vec<u8>) {
        event.event_hash.clear();
        let hash = Sha256::digest(event.encode_to_vec()).to_vec();
        event.event_hash = hash.clone();
        (event.encode_to_vec(), hash)
    }

    #[test]
    fn recipient_identity_uses_persisted_canonical_ptid() {
        let scope = unique_scope();
        local_chat_store::crypto_save_actor_device_identity(
            &scope,
            "ptid:v1:actor:peers:p:alice",
            b"identity",
        )
        .unwrap();
        assert_eq!(
            canonical_mls_identity_ptid(&scope).unwrap(),
            "ptid:v1:actor:peers:p:alice"
        );

        let invalid_scope = unique_scope();
        local_chat_store::crypto_save_actor_device_identity(&invalid_scope, "42", b"identity")
            .unwrap();
        assert!(canonical_mls_identity_ptid(&invalid_scope).is_err());
    }

    #[test]
    fn recipient_reorders_restart_replays_and_fork_protects() {
        let scope = unique_scope();
        let sender_scope = unique_scope();
        let alice = MlsGroupManager::new();
        let bob_before_restart = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_before_restart
            .actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        let bob_kp = bob_before_restart.generate_key_package().unwrap();
        let provider_pool = bob_before_restart.export_pending_join_providers().unwrap();
        local_chat_store::crypto_save_mls_join_provider_pool(&scope, &provider_pool).unwrap();

        let created = alice
            .create_group(
                "conversation-recipient",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:test:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob_kp,
                }],
            )
            .unwrap();
        let accepted = mls_group_accept_pending_for_scope(
            MlsPendingTransitionInput {
                conversation_id: "conversation-recipient".to_string(),
                transition_id: Some(created.transition_id.clone()),
            },
            &alice,
            &sender_scope,
        );
        assert!(accepted.ok);

        let created_event = CommittedConversationEvent {
            event_id: "created-event".to_string(),
            conversation_id: "conversation-recipient".to_string(),
            group_seq: 1,
            membership_epoch: 0,
            committed_by_station_peer_id: "station-1".to_string(),
            committed_at: None,
            event_hash: Vec::new(),
            prev_event_hash: Vec::new(),
            payload: Some(committed_conversation_event::Payload::ConversationCreated(
                ConversationCreatedEvent {
                    conversation: None,
                    initial_members: Vec::new(),
                },
            )),
        };
        let (created_event_bytes, created_event_hash) = finalize_event(created_event);
        let welcome_hash = Sha256::digest(&created.welcome_bytes).to_vec();
        let transition_event = CommittedConversationEvent {
            event_id: "transition-event".to_string(),
            conversation_id: "conversation-recipient".to_string(),
            group_seq: 2,
            membership_epoch: 1,
            committed_by_station_peer_id: "station-1".to_string(),
            committed_at: None,
            event_hash: Vec::new(),
            prev_event_hash: created_event_hash,
            payload: Some(
                committed_conversation_event::Payload::MembershipTransitionCommitted(
                    MembershipTransitionCommittedEvent {
                        transition_id: created.transition_id.clone(),
                        from_membership_epoch: 0,
                        to_membership_epoch: 1,
                        from_mls_epoch: 0,
                        to_mls_epoch: 1,
                        changes: Vec::new(),
                        opaque_mls_commit_bytes: created.commit_bytes.clone(),
                        commit_sha256: created.commit_sha256.clone(),
                        leave_intent_id: String::new(),
                        welcome_descriptors: vec![MlsWelcomeDescriptor {
                            recipient_ptid: "ptid:test:bob".to_string(),
                            recipient_device_id: "bob-device".to_string(),
                            recipient_home_station_peer_id: "station-1".to_string(),
                            welcome_sha256: welcome_hash.clone(),
                        }],
                    },
                ),
            ),
        };
        let (transition_event_bytes, transition_event_hash) =
            finalize_event(transition_event.clone());
        let delivery = MlsTransitionDeliveryPayload {
            conversation_id: "conversation-recipient".to_string(),
            transition_id: created.transition_id.clone(),
            group_seq: 2,
            from_membership_epoch: 0,
            to_membership_epoch: 1,
            from_mls_epoch: 0,
            to_mls_epoch: 1,
            kind: MlsTransitionDeliveryKind::Welcome as i32,
            opaque_mls_bytes: created.welcome_bytes.clone(),
            payload_sha256: welcome_hash,
        };
        let delivery_bytes = delivery.encode_to_vec();

        let bob = MlsGroupManager::new();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        bob.import_pending_join_providers(
            &local_chat_store::crypto_load_mls_join_provider_pool(&scope)
                .unwrap()
                .unwrap(),
        )
        .unwrap();

        let delivery_result = mls_recipient_apply_delivery_for_scope(
            MlsRecipientDeliveryInput {
                delivery_bytes: delivery_bytes.clone(),
                recipient_device_id: "bob-device".to_string(),
            },
            &bob,
            &scope,
            "ptid:test:bob",
        );
        assert!(delivery_result.ok);
        assert_eq!(
            delivery_result.data.unwrap()["status"],
            serde_json::Value::String("establishing".to_string())
        );

        let future_result = mls_recipient_record_authority_event_for_scope(
            MlsRecipientAuthorityEventInput {
                event_bytes: transition_event_bytes.clone(),
                recipient_device_id: "bob-device".to_string(),
            },
            &bob,
            &scope,
            "ptid:test:bob",
        );
        assert!(future_result.ok);
        assert!(!bob.has_session("conversation-recipient"));

        let created_result = mls_recipient_record_authority_event_for_scope(
            MlsRecipientAuthorityEventInput {
                event_bytes: created_event_bytes.clone(),
                recipient_device_id: "bob-device".to_string(),
            },
            &bob,
            &scope,
            "ptid:test:bob",
        );
        assert!(created_result.ok);
        assert_eq!(
            created_result.data.unwrap()["status"],
            serde_json::Value::String("active".to_string())
        );
        assert!(bob.has_session("conversation-recipient"));

        let encrypted = alice
            .encrypt("conversation-recipient", b"recipient ordered")
            .unwrap();
        assert_eq!(
            bob.decrypt("conversation-recipient", &encrypted.ciphertext)
                .unwrap(),
            b"recipient ordered"
        );

        let duplicate = mls_recipient_apply_delivery_for_scope(
            MlsRecipientDeliveryInput {
                delivery_bytes,
                recipient_device_id: "bob-device".to_string(),
            },
            &bob,
            &scope,
            "ptid:test:bob",
        );
        assert!(duplicate.ok);
        assert_eq!(duplicate.data.unwrap()["duplicate"], true);

        let sender_created = mls_recipient_record_authority_event_for_scope(
            MlsRecipientAuthorityEventInput {
                event_bytes: created_event_bytes,
                recipient_device_id: "alice-device".to_string(),
            },
            &alice,
            &sender_scope,
            "ptid:test:alice",
        );
        assert!(sender_created.ok);
        let sender_transition = mls_recipient_record_authority_event_for_scope(
            MlsRecipientAuthorityEventInput {
                event_bytes: transition_event_bytes,
                recipient_device_id: "alice-device".to_string(),
            },
            &alice,
            &sender_scope,
            "ptid:test:alice",
        );
        assert!(sender_transition.ok);
        assert_eq!(
            sender_transition.data.unwrap()["status"],
            serde_json::Value::String("active".to_string())
        );

        let future_event = CommittedConversationEvent {
            event_id: "future-event".to_string(),
            conversation_id: "conversation-recipient".to_string(),
            group_seq: 4,
            membership_epoch: 1,
            committed_by_station_peer_id: "station-1".to_string(),
            committed_at: None,
            event_hash: Vec::new(),
            prev_event_hash: transition_event_hash,
            payload: Some(committed_conversation_event::Payload::ConversationCreated(
                ConversationCreatedEvent {
                    conversation: None,
                    initial_members: Vec::new(),
                },
            )),
        };
        let (future_bytes, _) = finalize_event(future_event);
        let future_result = mls_recipient_record_authority_event_for_scope(
            MlsRecipientAuthorityEventInput {
                event_bytes: future_bytes,
                recipient_device_id: "bob-device".to_string(),
            },
            &bob,
            &scope,
            "ptid:test:bob",
        );
        assert!(future_result.ok);
        assert_eq!(
            future_result.data.unwrap()["status"],
            serde_json::Value::String("establishing".to_string())
        );
        let blocked_send = mls_group_encrypt_for_scope(
            MlsGroupEncryptInput {
                conversation_id: "conversation-recipient".to_string(),
                plaintext: b"must not send across gap".to_vec(),
            },
            &bob,
            &scope,
        );
        assert!(!blocked_send.ok);

        let mut fork = transition_event;
        fork.event_id = "fork-event".to_string();
        let (fork_bytes, _) = finalize_event(fork);
        let fork_result = mls_recipient_record_authority_event_for_scope(
            MlsRecipientAuthorityEventInput {
                event_bytes: fork_bytes,
                recipient_device_id: "bob-device".to_string(),
            },
            &bob,
            &scope,
            "ptid:test:bob",
        );
        assert!(!fork_result.ok);
        assert_eq!(
            local_chat_store::crypto_load_mls_recipient_head(&scope, "conversation-recipient")
                .unwrap()
                .unwrap()
                .status,
            "crypto_desynced"
        );
    }
}
