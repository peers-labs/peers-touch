use std::collections::HashSet;
use std::sync::Arc;

use crate::application::session_resolver;
use crate::contracts::{
    NotificationDeleteInput, NotificationListInput, NotificationMarkAllReadInput,
    NotificationMarkReadInput, NotificationPreferencesUpdateInput, StubPayload,
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
        "recipientPtid": n.recipient_ptid,
        "actorPtid": n.actor_ptid,
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
        "actorPtid": p.actor_ptid,
        "category": p.category,
        "enabled": p.enabled,
        "pushEnabled": p.push_enabled,
        "soundEnabled": p.sound_enabled,
        "updatedAt": ts_millis(&p.updated_at),
        "type": p.r#type,
    })
}

fn notification_preferences_snapshot_to_value(
    snapshot: &model::notification::NotificationPreferencesSnapshot,
) -> Value {
    json!({
        "preferences": snapshot
            .preferences
            .iter()
            .map(notification_preference_to_value)
            .collect::<Vec<_>>(),
        "notificationPreferencesRevision": snapshot.notification_preferences_revision,
    })
}

fn load_notification_preferences_snapshot(
    token: &str,
) -> Result<model::notification::NotificationPreferencesSnapshot, station_client::StationClientError>
{
    let response = station_client::request_proto::<
        (),
        model::notification::GetNotificationPreferencesResponse,
    >(
        Method::GET,
        "/notification/preferences",
        token,
        None,
        None::<&()>,
    )?;
    response.snapshot.ok_or_else(|| {
        station_client::StationClientError::new(
            station_client::StationClientErrorKind::InvalidResponse,
            "Station response omitted notification preference snapshot",
            None,
        )
    })
}

fn reconcile_notification_preferences_update(
    token: &str,
    request: &model::notification::UpdateNotificationPreferencesRequest,
) -> Option<model::notification::UpdateNotificationPreferencesResponse> {
    let snapshot = load_notification_preferences_snapshot(token).ok()?;
    let matches = request.updates.iter().all(|update| {
        snapshot.preferences.iter().any(|preference| {
            preference.category == update.category
                && preference.enabled == update.enabled
                && preference.push_enabled == update.push_enabled
                && preference.sound_enabled == update.sound_enabled
        })
    });
    let outcome = if matches {
        if snapshot.notification_preferences_revision == request.observed_revision {
            model::notification::NotificationPreferencesUpdateOutcome::Unchanged
        } else if snapshot.notification_preferences_revision > request.observed_revision {
            model::notification::NotificationPreferencesUpdateOutcome::Applied
        } else {
            return None;
        }
    } else if snapshot.notification_preferences_revision > request.observed_revision {
        model::notification::NotificationPreferencesUpdateOutcome::Conflict
    } else {
        return None;
    };
    Some(model::notification::UpdateNotificationPreferencesResponse {
        outcome: outcome as i32,
        snapshot: Some(snapshot),
    })
}

fn ambiguous_notification_preferences_error(error: &station_client::StationClientError) -> bool {
    matches!(
        error.kind,
        station_client::StationClientErrorKind::Network
            | station_client::StationClientErrorKind::Decode
            | station_client::StationClientErrorKind::InvalidResponse
    )
}

fn valid_notification_preferences_update_response(
    response: &model::notification::UpdateNotificationPreferencesResponse,
) -> bool {
    response
        .snapshot
        .as_ref()
        .is_some_and(|snapshot| snapshot.notification_preferences_revision > 0)
        && !matches!(
            model::notification::NotificationPreferencesUpdateOutcome::try_from(response.outcome,),
            Ok(model::notification::NotificationPreferencesUpdateOutcome::Unspecified) | Err(_)
        )
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
        Ok(response) => response,
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

    let snapshot = match load_notification_preferences_snapshot(&token) {
        Ok(snapshot) => snapshot,
        Err(e) => return e.into_app_result("Failed to load notification preferences"),
    };

    if snapshot.notification_preferences_revision == 0 {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Station response returned an invalid notification preference revision",
            None,
        );
    }

    to_stub(
        "notification_preferences",
        notification_preferences_snapshot_to_value(&snapshot),
    )
}

#[tauri::command]
pub fn notification_preferences_update(
    input: NotificationPreferencesUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    if input.observed_revision == 0 || input.updates.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Notification preference updates require a revision and at least one category",
            None,
        );
    }
    let mut categories = HashSet::with_capacity(input.updates.len());
    let updates = input
        .updates
        .into_iter()
        .map(|update| {
            if update.category == 0 || !categories.insert(update.category) {
                return Err(AppResult::fail(
                    ErrorCode::InvalidArgument,
                    "Notification preference categories must be specified and unique",
                    None,
                ));
            }
            Ok(model::notification::NotificationPreferencePatch {
                category: update.category,
                enabled: update.enabled,
                push_enabled: update.push_enabled,
                sound_enabled: update.sound_enabled,
            })
        })
        .collect::<Result<Vec<_>, _>>();
    let updates = match updates {
        Ok(updates) => updates,
        Err(error) => return error,
    };
    let body = model::notification::UpdateNotificationPreferencesRequest {
        updates,
        observed_revision: input.observed_revision,
    };

    let resp = match station_client::request_proto::<
        model::notification::UpdateNotificationPreferencesRequest,
        model::notification::UpdateNotificationPreferencesResponse,
    >(
        Method::POST,
        "/notification/preferences",
        &token,
        None,
        Some(&body),
    ) {
        Ok(r) => r,
        Err(error) if ambiguous_notification_preferences_error(&error) => {
            match reconcile_notification_preferences_update(&token, &body) {
                Some(response) => response,
                None => return error.into_app_result("Failed to update notification preferences"),
            }
        }
        Err(e) => return e.into_app_result("Failed to update notification preferences"),
    };

    let outcome = model::notification::NotificationPreferencesUpdateOutcome::try_from(resp.outcome)
        .unwrap_or(model::notification::NotificationPreferencesUpdateOutcome::Unspecified);
    let snapshot = match &resp.snapshot {
        Some(snapshot) if snapshot.notification_preferences_revision > 0 => {
            notification_preferences_snapshot_to_value(snapshot)
        }
        _ => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Station returned an invalid notification preference outcome",
                None,
            )
        }
    };
    if matches!(
        outcome,
        model::notification::NotificationPreferencesUpdateOutcome::Unspecified
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Station returned an unspecified notification preference outcome",
            None,
        );
    }

    to_stub(
        "notification_preferences_update",
        json!({
            "outcome": outcome.as_str_name(),
            "snapshot": snapshot,
        }),
    )
}
