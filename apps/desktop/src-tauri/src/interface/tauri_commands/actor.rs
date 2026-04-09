use crate::contracts::{ActorSearchUsersInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model;
use crate::state::AppState;
use reqwest::Method;
use serde_json::json;
use tauri::State;

fn token_from_state(state: &State<AppState>) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(ErrorCode::InternalError, "failed to access session state", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn to_stub(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

#[tauri::command]
pub fn actor_search_users(input: ActorSearchUsersInput, state: State<AppState>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let resp = match station_client::request_proto::<(), model::actor::ActorList>(
        Method::GET, "/api/v1/social/users/search", &token, Some(&[("q", input.q.clone())]), None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };

    let items: Vec<serde_json::Value> = resp.items.iter().map(|a| {
        json!({
            "id": a.id,
            "username": a.username,
            "displayName": a.display_name,
            "email": a.email,
            "actorId": a.actor_id,
        })
    }).collect();

    to_stub("actor_search_users", json!({ "items": items, "total": resp.total }))
}

#[tauri::command]
pub fn actor_get_me(state: State<AppState>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let resp = match station_client::request_proto::<(), model::actor::ActorProfile>(
        Method::GET, "/api/v1/social/users/me", &token, None, None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, &e, None),
    };

    to_stub("actor_get_me", json!({
        "id": resp.id,
        "displayName": resp.display_name,
        "username": resp.username,
        "avatar": resp.avatar,
    }))
}

/// Alias for `actor_search_users` - registered as `actor_search_actors` in the invoke handler.
#[tauri::command]
pub fn actor_search_actors(input: ActorSearchUsersInput, state: State<AppState>) -> AppResult<StubPayload> {
    actor_search_users(input, state)
}

/// Alias for `actor_get_me` - registered as `actor_get_my_profile` in the invoke handler.
#[tauri::command]
pub fn actor_get_my_profile(state: State<AppState>) -> AppResult<StubPayload> {
    actor_get_me(state)
}
