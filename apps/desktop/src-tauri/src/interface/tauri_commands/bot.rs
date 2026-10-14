use std::sync::Arc;

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model;
use crate::state::AppState;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Manager, State, Window};

use model::bot::v1 as botpb;

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

fn stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn bot_to_value(bot: Option<&botpb::Bot>) -> Value {
    match bot {
        Some(b) => {
            let grant = b.publishing_grant.as_ref();
            json!({
                "botPtid": b.bot_ptid,
                "ownerPtid": b.owner_ptid,
                "name": b.name,
                "state": b.state as i32,
                "publishingId": grant.map(|value| value.publishing_id.as_str()).unwrap_or_default(),
                "ingressUrl": grant.map(|value| {
                    format!("/message-ingress/{}", value.publishing_id)
                }).unwrap_or_default(),
                "secretHint": grant.map(|value| value.secret_hint.as_str()).unwrap_or_default(),
                "rateLimitPerMinute": grant.map(|value| value.rate_limit_per_minute).unwrap_or_default(),
                "createdAtMs": grant.and_then(|value| value.created_at.as_ref()).map(|value| {
                    value.seconds.saturating_mul(1_000)
                        .saturating_add(i64::from(value.nanos) / 1_000_000)
                }).unwrap_or_default(),
            })
        }
        None => Value::Null,
    }
}

#[tauri::command]
pub fn bot_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let resp =
        match station_client::request_proto::<botpb::ListMyBotsRequest, botpb::ListMyBotsResponse>(
            Method::POST,
            "/bot/list",
            &token,
            None,
            Some(&botpb::ListMyBotsRequest {}),
        ) {
            Ok(r) => r,
            Err(e) => return e.into_app_result("Failed to list bots"),
        };
    let bots: Vec<Value> = resp.bots.iter().map(|b| bot_to_value(Some(b))).collect();
    stub("bot_list", json!({ "bots": bots }))
}

#[derive(Debug, Deserialize)]
pub struct BotCreateInput {
    pub name: String,
    #[serde(default)]
    pub avatar: Option<String>,
}

#[tauri::command]
pub fn bot_create(
    input: BotCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = botpb::CreateBotRequest {
        name: input.name,
        avatar: input.avatar,
    };
    let resp = match station_client::request_proto::<
        botpb::CreateBotRequest,
        botpb::CreateBotResponse,
    >(Method::POST, "/bot/create", &token, None, Some(&body))
    {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to create bot"),
    };
    stub(
        "bot_create",
        json!({
            "bot": bot_to_value(resp.bot.as_ref()),
            "ingressUrl": resp.ingress_url,
            "secret": resp.secret,
        }),
    )
}

#[derive(Debug, Deserialize)]
pub struct BotPtidInput {
    pub bot_ptid: String,
}

#[tauri::command]
pub fn bot_rotate_secret(
    input: BotPtidInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = botpb::RotateBotSecretRequest {
        bot_ptid: input.bot_ptid,
    };
    let resp = match station_client::request_proto::<
        botpb::RotateBotSecretRequest,
        botpb::RotateBotSecretResponse,
    >(
        Method::POST,
        "/bot/rotate-secret",
        &token,
        None,
        Some(&body),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to rotate bot secret"),
    };
    stub("bot_rotate_secret", json!({ "secret": resp.secret }))
}

#[derive(Debug, Deserialize)]
pub struct BotSetStateInput {
    pub bot_ptid: String,
    pub target_state: i32,
}

#[tauri::command]
pub fn bot_set_state(
    input: BotSetStateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = botpb::SetBotStateRequest {
        bot_ptid: input.bot_ptid,
        target_state: input.target_state,
    };
    let resp = match station_client::request_proto::<
        botpb::SetBotStateRequest,
        botpb::SetBotStateResponse,
    >(Method::POST, "/bot/set-state", &token, None, Some(&body))
    {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to set bot state"),
    };
    stub(
        "bot_set_state",
        json!({ "bot": bot_to_value(resp.bot.as_ref()) }),
    )
}

#[derive(Debug, Deserialize)]
pub struct BotSetProfileInput {
    pub bot_ptid: String,
    #[serde(default)]
    pub avatar: Option<String>,
}

#[tauri::command]
pub fn bot_set_profile(
    input: BotSetProfileInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = botpb::SetBotProfileRequest {
        bot_ptid: input.bot_ptid,
        avatar: input.avatar,
    };
    let resp = match station_client::request_proto::<
        botpb::SetBotProfileRequest,
        botpb::SetBotProfileResponse,
    >(Method::POST, "/bot/set-profile", &token, None, Some(&body))
    {
        Ok(r) => r,
        Err(e) => return e.into_app_result("Failed to set bot profile"),
    };
    stub(
        "bot_set_profile",
        json!({ "bot": bot_to_value(resp.bot.as_ref()) }),
    )
}

#[derive(Debug, Deserialize)]
pub struct BotAvatarUploadInput {
    pub file_path: String,
}

// Uploads an image to the avatar OSS bucket and returns the Station-relative
// URL. The caller then binds it to the bot via bot_set_profile. This does not
// mutate the logged-in user's actor (unlike profile_upload_avatar_oss).
#[tauri::command]
pub async fn bot_upload_avatar(
    app: tauri::AppHandle,
    input: BotAvatarUploadInput,
    window: Window,
) -> AppResult<StubPayload> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let token = session_resolver::token_for_window(&state, &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "Authentication required — please log in",
            None,
        );
    }
    tokio::task::spawn_blocking(move || {
        let result = match station_client::upload_multipart(
            "/sub-oss/upload",
            &token,
            &input.file_path,
            "avatar",
            "public",
            None,
        ) {
            Ok(v) => v,
            Err(e) => return e.into_app_result("Failed to upload bot avatar"),
        };
        let url = result
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        stub("bot_upload_avatar", json!({ "url": url }))
    })
    .await
    .unwrap_or_else(|e| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Bot avatar upload task failed: {e}"),
            None,
        )
    })
}
