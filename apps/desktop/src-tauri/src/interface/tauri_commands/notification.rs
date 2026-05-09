use std::sync::Arc;

use crate::application::session_resolver;
use crate::contracts::{
    NotificationDeleteInput, NotificationListInput, NotificationMarkAllReadInput,
    NotificationMarkReadInput, NotificationPreferenceUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model;
use crate::state::AppState;
use reqwest::Method;
use serde_json::{json, Map, Value};
use tauri::{State, Window};

fn token_from_state(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Authentication required — please log in",
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

fn ts_millis(ts: &Option<prost_types::Timestamp>) -> serde_json::Value {
    match ts {
        Some(t) => {
            serde_json::Value::Number((t.seconds * 1000 + (t.nanos as i64) / 1_000_000).into())
        }
        None => serde_json::Value::Null,
    }
}

fn notification_to_value(n: &model::notification::Notification) -> Value {
    let mut meta = Map::with_capacity(n.metadata.len());
    for (k, v) in &n.metadata {
        meta.insert(k.clone(), Value::String(v.clone()));
    }
    json!({
        "id": n.id,
        "recipientId": n.recipient_id,
        "actorId": n.actor_id,
        "type": n.r#type,
        "category": n.category,
        "status": n.status,
        "targetType": n.target_type,
        "targetId": n.target_id,
        "title": n.title,
        "body": n.body,
        "metadata": Value::Object(meta),
        "groupKey": n.group_key,
        "createdAt": ts_millis(&n.created_at),
        "readAt": ts_millis(&n.read_at),
    })
}

fn notification_preference_to_value(p: &model::notification::NotificationPreference) -> Value {
    json!({
        "actorId": p.actor_id,
        "category": p.category,
        "enabled": p.enabled,
        "pushEnabled": p.push_enabled,
        "soundEnabled": p.sound_enabled,
        "updatedAt": ts_millis(&p.updated_at),
        "type": p.r#type,
    })
}

#[tauri::command]
pub fn notification_list(
    input: NotificationListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
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

    let resp =
        match station_client::request_proto::<(), model::notification::ListNotificationsResponse>(
            Method::GET,
            "/notification/list",
            &token,
            Some(&query),
            None::<&()>,
        ) {
            Ok(r) => r,
            Err(e) => return e.into_app_result("Failed to list notifications"),
        };

    let notifications: Vec<Value> = resp
        .notifications
        .iter()
        .map(notification_to_value)
        .collect();
    to_stub(
        "notification_list",
        json!({
            "notifications": notifications,
            "nextCursor": resp.next_cursor,
            "totalCount": resp.total_count,
            "unreadCount": resp.unread_count,
        }),
    )
}

#[tauri::command]
pub fn notification_unread_counts(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_proto::<(), model::notification::GetUnreadCountsResponse>(
        Method::GET,
        "/notification/unread-counts",
        &token,
        None,
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to get unread notification counts"),
    };

    let mut by_category = Map::with_capacity(resp.by_category.len());
    for (k, v) in &resp.by_category {
        by_category.insert(k.to_string(), Value::Number((*v).into()));
    }

    to_stub(
        "notification_unread_counts",
        json!({
            "total": resp.total,
            "byCategory": Value::Object(by_category),
        }),
    )
}

#[tauri::command]
pub fn notification_mark_read(
    input: NotificationMarkReadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let body = model::notification::MarkNotificationsReadRequest {
        notification_ids: input.notification_ids,
    };

    let resp = match station_client::request_proto::<
        model::notification::MarkNotificationsReadRequest,
        model::notification::MarkNotificationsReadResponse,
    >(
        Method::POST,
        "/notification/mark-read",
        &token,
        None,
        Some(&body),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to mark notifications as read"),
    };

    to_stub(
        "notification_mark_read",
        json!({ "updatedCount": resp.updated_count }),
    )
}

#[tauri::command]
pub fn notification_mark_all_read(
    input: NotificationMarkAllReadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let body = model::notification::MarkAllNotificationsReadRequest {
        category: input.category.unwrap_or(0),
    };

    let resp = match station_client::request_proto::<
        model::notification::MarkAllNotificationsReadRequest,
        model::notification::MarkAllNotificationsReadResponse,
    >(
        Method::POST,
        "/notification/mark-all-read",
        &token,
        None,
        Some(&body),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to mark all notifications as read"),
    };

    to_stub(
        "notification_mark_all_read",
        json!({ "updatedCount": resp.updated_count }),
    )
}

#[tauri::command]
pub fn notification_delete(
    input: NotificationDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let body = model::notification::DeleteNotificationsRequest {
        notification_ids: input.notification_ids,
    };

    let resp = match station_client::request_proto::<
        model::notification::DeleteNotificationsRequest,
        model::notification::DeleteNotificationsResponse,
    >(
        Method::POST,
        "/notification/delete",
        &token,
        None,
        Some(&body),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to delete notifications"),
    };

    to_stub(
        "notification_delete",
        json!({ "deletedCount": resp.deleted_count }),
    )
}

#[tauri::command]
pub fn notification_preferences(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_proto::<
        (),
        model::notification::GetNotificationPreferencesResponse,
    >(
        Method::GET,
        "/notification/preferences",
        &token,
        None,
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to load notification preferences"),
    };

    let preferences: Vec<Value> = resp
        .preferences
        .iter()
        .map(notification_preference_to_value)
        .collect();

    to_stub(
        "notification_preferences",
        json!({ "preferences": preferences }),
    )
}

#[tauri::command]
pub fn notification_preferences_update(
    input: NotificationPreferenceUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let body = model::notification::UpdateNotificationPreferenceRequest {
        category: input.category,
        enabled: input.enabled,
        push_enabled: input.push_enabled,
        sound_enabled: input.sound_enabled,
    };

    let resp = match station_client::request_proto::<
        model::notification::UpdateNotificationPreferenceRequest,
        model::notification::UpdateNotificationPreferenceResponse,
    >(
        Method::POST,
        "/notification/preferences/update",
        &token,
        None,
        Some(&body),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to update notification preferences"),
    };

    let preference = match &resp.preference {
        Some(p) => notification_preference_to_value(p),
        None => Value::Null,
    };

    to_stub(
        "notification_preferences_update",
        json!({ "preference": preference }),
    )
}
