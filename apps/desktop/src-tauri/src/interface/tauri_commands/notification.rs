use std::sync::Arc;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::contracts::{
    NotificationDeleteInput, NotificationListInput, NotificationMarkAllReadInput,
    NotificationMarkReadInput, NotificationPreferenceUpdateInput, StubPayload,
};
use crate::state::AppState;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

fn token_from_state(state: &State<'_, Arc<AppState>>) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(ErrorCode::InternalError, "error.auth.sessionLockFailed", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "error.auth.authenticationRequired",
            None,
        ));
    }
    Ok(token)
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

#[tauri::command]
pub fn notification_list(
    input: NotificationListInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(cat) = input.category {
        query.push(("category", cat.to_string()));
    }
    if let Some(st) = input.status {
        query.push(("status", st.to_string()));
    }
    if let Some(ref c) = input.cursor {
        query.push(("cursor", c.clone()));
    }
    let limit = input.limit.unwrap_or(20);
    query.push(("limit", limit.to_string()));

    let resp = match station_client::request_json(
        Method::GET,
        "/notification/list",
        &token,
        Some(&query),
        None,
    ) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.notification.listFailed",
                Some(json!({"reason": e})),
            );
        }
    };

    to_stub("notification_list", resp)
}

#[tauri::command]
pub fn notification_unread_counts(
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_json(
        Method::GET,
        "/notification/unread-counts",
        &token,
        None,
        None,
    ) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.notification.unreadCountsFailed",
                Some(json!({"reason": e})),
            );
        }
    };

    to_stub("notification_unread_counts", resp)
}

#[tauri::command]
pub fn notification_mark_read(
    input: NotificationMarkReadInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_json(
        Method::POST,
        "/notification/mark-read",
        &token,
        None,
        Some(json!({ "notificationIds": input.notification_ids })),
    ) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.notification.markReadFailed",
                Some(json!({"reason": e})),
            );
        }
    };

    to_stub("notification_mark_read", resp)
}

#[tauri::command]
pub fn notification_mark_all_read(
    input: NotificationMarkAllReadInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_json(
        Method::POST,
        "/notification/mark-all-read",
        &token,
        None,
        Some(json!({ "category": input.category.unwrap_or(0) })),
    ) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.notification.markAllReadFailed",
                Some(json!({"reason": e})),
            );
        }
    };

    to_stub("notification_mark_all_read", resp)
}

#[tauri::command]
pub fn notification_delete(
    input: NotificationDeleteInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_json(
        Method::POST,
        "/notification/delete",
        &token,
        None,
        Some(json!({ "notificationIds": input.notification_ids })),
    ) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.notification.deleteFailed",
                Some(json!({"reason": e})),
            );
        }
    };

    to_stub("notification_delete", resp)
}

#[tauri::command]
pub fn notification_preferences(
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_json(
        Method::GET,
        "/notification/preferences",
        &token,
        None,
        None,
    ) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.notification.preferencesFailed",
                Some(json!({"reason": e})),
            );
        }
    };

    to_stub("notification_preferences", resp)
}

#[tauri::command]
pub fn notification_preferences_update(
    input: NotificationPreferenceUpdateInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_json(
        Method::POST,
        "/notification/preferences/update",
        &token,
        None,
        Some(json!({
            "category": input.category,
            "enabled": input.enabled,
            "pushEnabled": input.push_enabled,
            "soundEnabled": input.sound_enabled,
        })),
    ) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "error.notification.preferencesUpdateFailed",
                Some(json!({"reason": e})),
            );
        }
    };

    to_stub("notification_preferences_update", resp)
}
