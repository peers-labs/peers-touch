use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    ConfigFieldResetInput, ConfigPostgresTestInput, ConfigSectionInput, ConfigSectionSetInput, LogsTailInput,
    OAuthCreateBotSessionInput, OAuthSessionInput, OAuthSimulateStartInput, OnboardingSetInput, PreferencesSetInput,
    ShareIdInput, ShareSessionInput, StubPayload, WizardExecuteApiInput, WizardStepInput,
};
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

pub fn system_health() -> AppResult<StubPayload> {
    success_payload("system_health", json!({ "status": "ok" }))
}

pub fn onboarding_get() -> AppResult<StubPayload> {
    success_payload("onboarding_get", json!({ "done": false }))
}

pub fn onboarding_set(input: OnboardingSetInput) -> AppResult<StubPayload> {
    let _ = input.data;
    success_payload("onboarding_set", json!({ "ok": true }))
}

pub fn onboarding_reset() -> AppResult<StubPayload> {
    success_payload("onboarding_reset", json!({ "ok": true }))
}

pub fn wizard_get() -> AppResult<StubPayload> {
    success_payload(
        "wizard_get",
        json!({
            "steps": [],
            "current_step": null,
            "completed": false
        }),
    )
}

pub fn wizard_state_get() -> AppResult<StubPayload> {
    success_payload("wizard_state_get", json!({ "data": {}, "completed_steps": [] }))
}

pub fn wizard_step_save(input: WizardStepInput) -> AppResult<StubPayload> {
    if input.step_id.trim().is_empty() {
        return invalid_argument("step_id is required");
    }
    let _ = input.data;
    success_payload("wizard_step_save", json!({ "data": {}, "completed_steps": [input.step_id] }))
}

pub fn wizard_complete() -> AppResult<StubPayload> {
    success_payload("wizard_complete", json!({ "data": {}, "completed_steps": [], "completed": true }))
}

pub fn wizard_api_execute(input: WizardExecuteApiInput) -> AppResult<StubPayload> {
    if input.path.trim().is_empty() {
        return invalid_argument("path is required");
    }
    let _ = input.method;
    let _ = input.body;
    success_payload("wizard_api_execute", json!({ "ok": true }))
}

pub fn statistics_get() -> AppResult<StubPayload> {
    success_payload(
        "statistics_get",
        json!({
            "agents":0,
            "sessions":0,
            "messages":0
        }),
    )
}

pub fn preferences_get() -> AppResult<StubPayload> {
    success_payload("preferences_get", json!({}))
}

pub fn preferences_set(input: PreferencesSetInput) -> AppResult<StubPayload> {
    let _ = input.prefs;
    success_payload("preferences_set", json!({ "ok": true }))
}

pub fn share_create(input: ShareSessionInput) -> AppResult<StubPayload> {
    if input.session_key.trim().is_empty() {
        return invalid_argument("session_key is required");
    }
    success_payload(
        "share_create",
        json!({
            "share_id":"share-1",
            "session_key":input.session_key,
            "title":"Shared Session",
            "visibility":"public"
        }),
    )
}

pub fn share_delete(input: ShareSessionInput) -> AppResult<StubPayload> {
    if input.session_key.trim().is_empty() {
        return invalid_argument("session_key is required");
    }
    success_payload("share_delete", json!({ "ok": true }))
}

pub fn share_get(input: ShareIdInput) -> AppResult<StubPayload> {
    if input.share_id.trim().is_empty() {
        return invalid_argument("share_id is required");
    }
    success_payload(
        "share_get",
        json!({
            "share_id":input.share_id,
            "title":"Shared Session",
            "messages":[]
        }),
    )
}

pub fn logs_tail(input: LogsTailInput) -> AppResult<StubPayload> {
    success_payload(
        "logs_tail",
        json!({
            "file":"app.log",
            "cursor":input.cursor,
            "size":0,
            "lines":[],
            "truncated":false,
            "reset":false,
            "limit":input.limit.unwrap_or(1000),
            "max_bytes":input.max_bytes.unwrap_or(102400)
        }),
    )
}

pub fn oauth_simulate_lark_start(input: OAuthSimulateStartInput) -> AppResult<StubPayload> {
    success_payload(
        "oauth_simulate_lark_start",
        json!({
            "status":"pending",
            "session_id":"sim-1",
            "qr_url":"https://example.com/qr",
            "create_bot":input.create_bot.unwrap_or(false),
            "app_name":input.app_name.unwrap_or_else(|| "Lark Bot".to_string())
        }),
    )
}

pub fn oauth_simulate_lark_poll(input: OAuthSessionInput) -> AppResult<StubPayload> {
    if input.session_id.trim().is_empty() {
        return invalid_argument("session_id is required");
    }
    success_payload(
        "oauth_simulate_lark_poll",
        json!({
            "status":"done",
            "session_id":input.session_id
        }),
    )
}

pub fn oauth_simulate_lark_create_bot_session(input: OAuthCreateBotSessionInput) -> AppResult<StubPayload> {
    success_payload(
        "oauth_simulate_lark_create_bot_session",
        json!({
            "status":"ok",
            "bot":{"app_id":"app-1","app_secret":"secret"},
            "channel_id":"channel-1",
            "app_name":input.app_name.unwrap_or_else(|| "Lark Bot".to_string())
        }),
    )
}

pub fn config_section_get(input: ConfigSectionInput) -> AppResult<StubPayload> {
    if input.section.trim().is_empty() {
        return invalid_argument("section is required");
    }
    success_payload("config_section_get", json!({}))
}

pub fn config_section_set(input: ConfigSectionSetInput) -> AppResult<StubPayload> {
    if input.section.trim().is_empty() {
        return invalid_argument("section is required");
    }
    let _ = input.values;
    success_payload("config_section_set", json!({ "ok": true }))
}

pub fn config_field_reset(input: ConfigFieldResetInput) -> AppResult<StubPayload> {
    if input.section.trim().is_empty() || input.field.trim().is_empty() {
        return invalid_argument("section and field are required");
    }
    success_payload("config_field_reset", json!({ "ok": true }))
}

pub fn config_test_postgres(input: ConfigPostgresTestInput) -> AppResult<StubPayload> {
    if input.dsn.trim().is_empty() {
        return invalid_argument("dsn is required");
    }
    success_payload("config_test_postgres", json!({ "ok": true, "has_pgvector": true }))
}

pub fn embedding_models_list() -> AppResult<StubPayload> {
    success_payload(
        "embedding_models_list",
        json!({
            "models":[],
            "resolved":{"provider_id":"", "provider_name":"", "model":""},
            "configured":{"provider":"", "model":""}
        }),
    )
}

pub fn visitor_heartbeat() -> AppResult<StubPayload> {
    success_payload("visitor_heartbeat", json!({ "online": 1, "ip": "127.0.0.1" }))
}

pub fn visitor_online() -> AppResult<StubPayload> {
    success_payload("visitor_online", json!({ "online": 1 }))
}
