use crate::application::session_resolver;
use crate::contracts::{ActorSearchUsersInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model;
use crate::state::AppState;
use reqwest::Method;
use serde_json::json;
use std::sync::Arc;
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

fn to_stub(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

pub(crate) fn actor_search_item_to_json(actor: &model::actor::Actor) -> serde_json::Value {
    json!({
        "id": actor.id,
        "username": actor.username,
        "displayName": actor.display_name,
        "email": actor.email,
        "avatar": actor.avatar,
    })
}

#[tauri::command]
pub fn actor_search_users(
    input: ActorSearchUsersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let resp = match station_client::request_proto::<(), model::actor::ActorList>(
        Method::GET,
        "/api/v1/social/users/search",
        &token,
        Some(&[("q", input.q.clone())]),
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "Failed to search actors");
            return e.into_app_result("Failed to search actors");
        }
    };

    let items: Vec<serde_json::Value> = resp.items.iter().map(actor_search_item_to_json).collect();

    to_stub(
        "actor_search_users",
        json!({ "items": items, "total": resp.total }),
    )
}

#[tauri::command]
pub fn actor_get_me(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let resp = match station_client::request_proto::<(), model::actor::ActorProfile>(
        Method::GET,
        "/api/v1/social/users/me",
        &token,
        None,
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get current user profile");
            return e.into_app_result("Failed to get profile");
        }
    };

    to_stub(
        "actor_get_me",
        json!({
            "id": resp.id,
            "displayName": resp.display_name,
            "username": resp.username,
            "avatar": resp.avatar,
        }),
    )
}

/// Alias for `actor_search_users` - registered as `actor_search_actors` in the invoke handler.
#[tauri::command]
pub fn actor_search_actors(
    input: ActorSearchUsersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    actor_search_users(input, state, window)
}

/// Alias for `actor_get_me` - registered as `actor_get_my_profile` in the invoke handler.
#[tauri::command]
pub fn actor_get_my_profile(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    actor_get_me(state, window)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_search_json_uses_ptid_without_internal_actor_id() {
        let actor = model::actor::Actor {
            id: "ptid:v1:actor:peers:p:alice:fingerprint".to_string(),
            actor_id: 347760575104679938,
            ..Default::default()
        };

        let value = actor_search_item_to_json(&actor);

        assert_eq!(
            value.get("id").and_then(serde_json::Value::as_str),
            Some("ptid:v1:actor:peers:p:alice:fingerprint")
        );
        assert!(value.get("actorId").is_none());
    }
}
