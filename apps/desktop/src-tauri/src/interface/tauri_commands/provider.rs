use crate::application::provider as application_provider;
use crate::application::session_resolver;
use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::AppResult;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{State, Window};

fn resolve_scope_from_state(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<Option<String>, AppResult<StubPayload>> {
    let scope = session_resolver::actor_id_for_window(state.inner(), window).unwrap_or_default();
    let scope = scope.trim();
    if scope.is_empty() {
        return Ok(None);
    }
    Ok(Some(scope.to_string()))
}

fn provider_list_for_scope(scope: Option<&str>) -> AppResult<StubPayload> {
    application_provider::provider_list(scope)
}

fn provider_get_for_scope(scope: Option<&str>, input: ProviderIdInput) -> AppResult<StubPayload> {
    application_provider::provider_get(scope, input)
}

fn provider_update_for_scope(
    scope: Option<&str>,
    input: ProviderUpdateInput,
) -> AppResult<StubPayload> {
    application_provider::provider_update(scope, input)
}

fn provider_check_for_scope(
    scope: Option<&str>,
    input: ProviderCheckInput,
) -> AppResult<StubPayload> {
    application_provider::provider_check(scope, input)
}

fn provider_create_for_scope(
    scope: Option<&str>,
    input: ProviderCreateInput,
) -> AppResult<StubPayload> {
    application_provider::provider_create(scope, input)
}

fn provider_delete_for_scope(
    scope: Option<&str>,
    input: ProviderIdInput,
) -> AppResult<StubPayload> {
    application_provider::provider_delete(scope, input)
}

fn provider_list_available_models_for_scope(scope: Option<&str>) -> AppResult<StubPayload> {
    application_provider::provider_list_available_models(scope)
}

#[tauri::command]
pub fn provider_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    provider_list_for_scope(scope.as_deref())
}

#[tauri::command]
pub fn provider_get(
    input: ProviderIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    provider_get_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn provider_update(
    input: ProviderUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    provider_update_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn provider_check(
    input: ProviderCheckInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    provider_check_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn provider_create(
    input: ProviderCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    provider_create_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn provider_delete(
    input: ProviderIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    provider_delete_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn provider_apply_preset(
    input: ProviderIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    application_provider::provider_apply_preset(scope.as_deref(), input)
}

#[tauri::command]
pub fn provider_list_available_models(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state, &window) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    provider_list_available_models_for_scope(scope.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn parse_status(payload: &StubPayload) -> Value {
        serde_json::from_str(&payload.status).expect("status should be valid json")
    }

    #[test]
    fn command_provider_check_should_return_validation_error() {
        let result = provider_check_for_scope(
            None,
            ProviderCheckInput {
                id: "".to_string(),
                key_vaults: None,
                config_json: None,
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], false);
        assert_eq!(status["error"], "id is required");
    }

    const TEST_SCOPE: Option<&str> = Some("__test_provider_cmd__");

    #[test]
    fn command_provider_create_then_get_should_work() {
        let create_result = provider_create_for_scope(
            TEST_SCOPE,
            ProviderCreateInput {
                name: "Command Test Provider".to_string(),
                description: "for command layer".to_string(),
                logo: "".to_string(),
                key_vaults: "{\"api_key\":\"k\"}".to_string(),
                config_json: "{\"base_url\":\"https://api.openai.com/v1\"}".to_string(),
                runtime_kind: None,
                cli_command: None,
                protocol: None,
            },
        );
        assert!(create_result.ok);
        let created_payload = create_result.data.expect("payload should exist");
        let created_status = parse_status(&created_payload);
        let provider_id = created_status["provider"]["id"]
            .as_str()
            .expect("provider id should exist")
            .to_string();
        let get_result = provider_get_for_scope(TEST_SCOPE, ProviderIdInput { id: provider_id });
        assert!(get_result.ok);
        let get_payload = get_result.data.expect("payload should exist");
        let get_status = parse_status(&get_payload);
        assert_eq!(get_status["provider"]["name"], "Command Test Provider");
    }

    #[test]
    fn command_provider_scope_should_be_isolated() {
        let scope_a = Some("user-a");
        let scope_b = Some("user-b");
        let create_result = provider_create_for_scope(
            scope_a,
            ProviderCreateInput {
                name: "Provider A".to_string(),
                description: "scope a".to_string(),
                logo: "".to_string(),
                key_vaults: "{\"api_key\":\"ka\"}".to_string(),
                config_json: "{\"base_url\":\"https://api.openai.com/v1\"}".to_string(),
                runtime_kind: None,
                cli_command: None,
                protocol: None,
            },
        );
        assert!(create_result.ok);
        let list_a = provider_list_for_scope(scope_a);
        let list_b = provider_list_for_scope(scope_b);
        assert!(list_a.ok);
        assert!(list_b.ok);
        let status_a = parse_status(&list_a.data.expect("payload should exist"));
        let status_b = parse_status(&list_b.data.expect("payload should exist"));
        let has_provider_a = status_a["providers"]
            .as_array()
            .expect("providers should be array")
            .iter()
            .any(|item| item["name"] == "Provider A");
        let has_provider_b = status_b["providers"]
            .as_array()
            .expect("providers should be array")
            .iter()
            .any(|item| item["name"] == "Provider A");
        assert!(has_provider_a);
        assert!(!has_provider_b);
    }
}
