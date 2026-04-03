use crate::error::{AppResult, ErrorCode};
use crate::contracts::{
    ProviderModelAddInput, ProviderModelDeleteInput, ProviderModelFetchInput,
    ProviderModelToggleAllInput, ProviderModelToggleInput, ProviderModelUpdateInput, StubPayload,
};
use crate::application::models as application_models;
use crate::state::AppState;
use tauri::State;

fn resolve_scope_from_state(state: &State<AppState>) -> Result<Option<String>, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "failed to access session state",
            None,
        )
    })?;
    let scope = guard.actor_id.clone().unwrap_or_default();
    let scope = scope.trim();
    if scope.is_empty() {
        return Ok(None);
    }
    Ok(Some(scope.to_string()))
}

fn model_add_for_scope(scope: Option<&str>, input: ProviderModelAddInput) -> AppResult<StubPayload> {
    application_models::model_add(scope, input)
}

fn model_update_for_scope(scope: Option<&str>, input: ProviderModelUpdateInput) -> AppResult<StubPayload> {
    application_models::model_update(scope, input)
}

fn model_delete_for_scope(scope: Option<&str>, input: ProviderModelDeleteInput) -> AppResult<StubPayload> {
    application_models::model_delete(scope, input)
}

fn model_fetch_remote_for_scope(scope: Option<&str>, input: ProviderModelFetchInput) -> AppResult<StubPayload> {
    application_models::model_fetch_remote(scope, input)
}

fn model_toggle_for_scope(scope: Option<&str>, input: ProviderModelToggleInput) -> AppResult<StubPayload> {
    application_models::model_toggle(scope, input)
}

fn model_toggle_all_for_scope(scope: Option<&str>, input: ProviderModelToggleAllInput) -> AppResult<StubPayload> {
    application_models::model_toggle_all(scope, input)
}

#[tauri::command]
pub fn model_add(input: ProviderModelAddInput, state: State<AppState>) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    model_add_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn model_update(input: ProviderModelUpdateInput, state: State<AppState>) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    model_update_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn model_delete(input: ProviderModelDeleteInput, state: State<AppState>) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    model_delete_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn model_fetch_remote(input: ProviderModelFetchInput, state: State<AppState>) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    model_fetch_remote_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn model_toggle(input: ProviderModelToggleInput, state: State<AppState>) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    model_toggle_for_scope(scope.as_deref(), input)
}

#[tauri::command]
pub fn model_toggle_all(input: ProviderModelToggleAllInput, state: State<AppState>) -> AppResult<StubPayload> {
    let scope = match resolve_scope_from_state(&state) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    model_toggle_all_for_scope(scope.as_deref(), input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::provider as application_provider;
    use crate::contracts::ProviderCreateInput;
    use serde_json::Value;

    fn parse_status(payload: &StubPayload) -> Value {
        serde_json::from_str(&payload.status).expect("status should be valid json")
    }

    fn prepare_provider(scope: Option<&str>) -> String {
        let create_result = application_provider::provider_create(scope, ProviderCreateInput {
            name: "Command Models Provider".to_string(),
            description: "for model command tests".to_string(),
            logo: "".to_string(),
            key_vaults: "{\"api_key\":\"k\"}".to_string(),
            config_json: "{\"base_url\":\"https://api.openai.com/v1\"}".to_string(),
        });
        assert!(create_result.ok);
        let payload = create_result.data.expect("payload should exist");
        let status = parse_status(&payload);
        status["provider"]["id"]
            .as_str()
            .expect("provider id should exist")
            .to_string()
    }

    const TEST_SCOPE: Option<&str> = Some("__test_models_cmd__");

    #[test]
    fn command_model_add_toggle_delete_should_work() {
        let provider_id = prepare_provider(TEST_SCOPE);
        let add_result = model_add_for_scope(TEST_SCOPE, ProviderModelAddInput {
            provider_id: provider_id.clone(),
            data: serde_json::json!({
                "id": "m-command-1",
                "display_name": "m-command-1",
                "type": "chat",
                "enabled": true
            }),
        });
        assert!(add_result.ok);
        let toggle_result = model_toggle_for_scope(TEST_SCOPE, ProviderModelToggleInput {
            provider_id: provider_id.clone(),
            model_id: "m-command-1".to_string(),
            enabled: false,
        });
        assert!(toggle_result.ok);
        let delete_result = model_delete_for_scope(TEST_SCOPE, ProviderModelDeleteInput {
            provider_id,
            model_id: "m-command-1".to_string(),
        });
        assert!(delete_result.ok);
    }

    #[test]
    fn command_model_fetch_remote_should_fail_without_base_url() {
        let provider_id = prepare_provider(TEST_SCOPE);
        let result = model_fetch_remote_for_scope(TEST_SCOPE, ProviderModelFetchInput {
            provider_id,
            data: Some(serde_json::json!({
                "base_url": "",
                "api_key": "k"
            })),
        });
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], false);
    }

    #[test]
    fn command_model_scope_should_be_isolated() {
        let scope_a = Some("user-model-a");
        let scope_b = Some("user-model-b");
        let provider_id = prepare_provider(scope_a);
        let add_result = model_add_for_scope(scope_a, ProviderModelAddInput {
            provider_id: provider_id.clone(),
            data: serde_json::json!({
                "id": "m-scope-a",
                "display_name": "m-scope-a",
                "type": "chat",
                "enabled": true
            }),
        });
        assert!(add_result.ok);
        let list_a = application_provider::provider_get(
            scope_a,
            crate::contracts::ProviderIdInput {
                id: provider_id.clone(),
            },
        );
        let list_b = application_provider::provider_get(
            scope_b,
            crate::contracts::ProviderIdInput { id: provider_id },
        );
        assert!(list_a.ok);
        assert!(!list_b.ok);
        let status_a = parse_status(&list_a.data.expect("payload should exist"));
        let has_model_a = status_a["provider"]["models"]
            .as_array()
            .expect("models should be array")
            .iter()
            .any(|item| item["id"] == "m-scope-a");
        assert!(has_model_a);
    }
}
