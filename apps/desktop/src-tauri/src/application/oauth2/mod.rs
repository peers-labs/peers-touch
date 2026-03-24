use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    OAuthAuthorizeInput, OAuthIdInput, OAuthResourceInput, OAuthSetCredentialsInput, StubPayload,
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

pub fn oauth2_list_providers() -> AppResult<StubPayload> {
    success_payload(
        "oauth2_list_providers",
        json!([{
            "id":"lark",
            "name":"Lark",
            "description":"Lark OAuth2 provider",
            "auth_url":"https://open.lark.com",
            "token_url":"https://open.lark.com",
            "enabled":true
        }]),
    )
}

pub fn oauth2_get_provider(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "oauth2_get_provider",
        json!({
            "id": input.id,
            "name":"Provider",
            "description":"",
            "auth_url":"https://example.com/auth",
            "token_url":"https://example.com/token",
            "client_id":"",
            "scopes":[]
        }),
    )
}

pub fn oauth2_get_credential_info(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "oauth2_get_credential_info",
        json!({
            "client_id":"",
            "secret_masked":"****",
            "source":"local",
            "yaml_has_conf":false
        }),
    )
}

pub fn oauth2_set_credentials(input: OAuthSetCredentialsInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.client_id.trim().is_empty() {
        return invalid_argument("client_id is required");
    }
    success_payload("oauth2_set_credentials", json!({ "status":"ok" }))
}

pub fn oauth2_authorize(input: OAuthAuthorizeInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let env = input.environment.unwrap_or_else(|| "default".to_string());
    success_payload(
        "oauth2_authorize",
        json!({ "auth_url": format!("https://example.com/oauth/{}/authorize?env={}", input.id, env) }),
    )
}

pub fn oauth2_list_connections() -> AppResult<StubPayload> {
    success_payload(
        "oauth2_list_connections",
        json!([{
            "id":"conn-1",
            "provider_id":"lark",
            "status":"connected",
            "created_at":"2026-03-24T00:00:00.000Z"
        }]),
    )
}

pub fn oauth2_get_connection(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "oauth2_get_connection",
        json!({
            "id":input.id,
            "provider_id":"lark",
            "status":"connected",
            "created_at":"2026-03-24T00:00:00.000Z"
        }),
    )
}

pub fn oauth2_disconnect(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("oauth2_disconnect", json!({ "status":"ok" }))
}

pub fn oauth2_refresh_token(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("oauth2_refresh_token", json!({ "status":"ok" }))
}

pub fn oauth2_call_resource(input: OAuthResourceInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.resource.trim().is_empty() {
        return invalid_argument("resource is required");
    }
    success_payload(
        "oauth2_call_resource",
        json!({
            "ok":true,
            "resource":input.resource,
            "data":input.params.unwrap_or_else(|| json!({}))
        }),
    )
}

pub fn oauth2_reload() -> AppResult<StubPayload> {
    success_payload("oauth2_reload", json!({ "status":"ok" }))
}

pub fn oauth2_get_page(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "oauth2_get_page",
        json!({
            "provider":{
                "id":input.id,
                "name":"Provider",
                "description":"",
                "auth_url":"https://example.com/auth",
                "token_url":"https://example.com/token",
                "client_id":"",
                "scopes":[]
            },
            "has_credentials":false
        }),
    )
}
