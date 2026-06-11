use crate::application::applets as application_applets;
use crate::application::provider::state as provider_state;
use crate::application::session_resolver;
use crate::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletCreateSessionInput, AppletIdInput,
    AppletInvokeInput, StubPayload,
};
use crate::domain::applets::AccessContext;
use crate::domain::identity::{ActiveSession, ActorRef};
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::infrastructure::storage::StorageKind;
use crate::state::AppState;
use serde_json::json;
use std::sync::Arc;
use tauri::State;
use tauri::Window;

const PRODUCT_WINDOW_E2E_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E";
const PRODUCT_WINDOW_E2E_APPLET_ID_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_APPLET_ID";
const PRODUCT_WINDOW_E2E_ACTOR_ID_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_ACTOR_ID";
const PRODUCT_WINDOW_E2E_TOKEN_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_TOKEN";
const PRODUCT_WINDOW_E2E_PROVIDER_BASE_URL_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_PROVIDER_BASE_URL";
const PRODUCT_WINDOW_E2E_LOGIN_METHOD: &str = "product-window-certification";

fn product_window_e2e_enabled() -> bool {
    std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn status_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn seed_product_window_e2e_provider() {
    let base_url = std::env::var(PRODUCT_WINDOW_E2E_PROVIDER_BASE_URL_ENV)
        .or_else(|_| std::env::var("PEERS_APPLET_E2E_BASE_URL"))
        .unwrap_or_default();
    if base_url.trim().is_empty() {
        return;
    }

    let _ = provider_state::with_provider_store(None, |store| {
        store
            .providers
            .retain(|provider| provider.id != "applet-product-window-e2e");
        store.providers.insert(
            0,
            provider_state::ProviderRecord {
                id: "applet-product-window-e2e".to_string(),
                name: "Applet Product Window E2E".to_string(),
                description: "Controlled local provider for packaged applet readiness".to_string(),
                logo: "".to_string(),
                enabled: true,
                key_vaults: json!({ "api_key": "applet-product-window-e2e-key" }).to_string(),
                config_json: json!({
                    "base_url": base_url,
                    "default_model": "e2e-model-openai",
                    "protocol": "openai-compatible"
                })
                .to_string(),
                check_model: "e2e-model-openai".to_string(),
                models: vec![provider_state::ModelRecord {
                    id: "e2e-model-openai".to_string(),
                    display_name: "E2E OpenAI-Compatible".to_string(),
                    r#type: "chat".to_string(),
                    enabled: true,
                    context_window: 8192,
                    function_call: false,
                    vision: false,
                    reasoning: false,
                    search: false,
                    image_output: false,
                    video: false,
                    protocol_override: Some("openai-compatible".to_string()),
                }],
                builtin: false,
                show_checker: false,
                show_api_key: false,
            },
        );
    });
}

fn bind_product_window_e2e_session(
    state: &Arc<AppState>,
    window: &Window,
    actor_id: &str,
    token: &str,
) {
    state.sessions.bind(ActiveSession::new(
        window.label(),
        format!("{}:{}", PRODUCT_WINDOW_E2E_LOGIN_METHOD, actor_id),
        ActorRef::new_person(actor_id.to_string()),
        token.to_string(),
    ));
    if let Ok(mut legacy) = state.session.lock() {
        legacy.actor_id = Some(actor_id.to_string());
        legacy.token = Some(token.to_string());
    }
}

fn applet_context(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<AccessContext, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state, window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    let actor_id = session_resolver::actor_id_for_window(state, window);
    Ok(AccessContext { actor_id, token })
}

#[tauri::command]
pub fn applets_product_window_launch_context(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if !product_window_e2e_enabled() {
        return status_payload(
            "applets_product_window_launch_context",
            json!({ "enabled": false }),
        );
    }

    let applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV)
        .unwrap_or_else(|_| "generic-complex-applet".to_string());
    let actor_id = std::env::var(PRODUCT_WINDOW_E2E_ACTOR_ID_ENV)
        .unwrap_or_else(|_| "applet-product-window-e2e-actor".to_string());
    let token = std::env::var(PRODUCT_WINDOW_E2E_TOKEN_ENV)
        .unwrap_or_else(|_| format!("applet-product-window-e2e-token:{}", actor_id));

    if applet_id.trim().is_empty() || actor_id.trim().is_empty() || token.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "applet product-window certification env is incomplete",
            Some(json!({ "reason": "invalid_certification_env" })),
        );
    }

    seed_product_window_e2e_provider();
    bind_product_window_e2e_session(state.inner(), &window, &actor_id, &token);

    status_payload(
        "applets_product_window_launch_context",
        json!({
            "enabled": true,
            "appletId": applet_id,
            "actorId": actor_id,
            "name": "Applet Product Window Certification",
            "email": "",
            "loginMethod": PRODUCT_WINDOW_E2E_LOGIN_METHOD,
            "mode": "product-shell"
        }),
    )
}

#[tauri::command]
pub fn applets_readiness_probe_context(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    applets_product_window_launch_context(state, window)
}

#[tauri::command]
pub fn applets_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_list(context)
}

#[tauri::command]
pub fn applets_get(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_get(context, input)
}

#[tauri::command]
pub fn applets_activate(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_activate(context, input)
}

#[tauri::command]
pub fn applets_deactivate(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_deactivate(context, input)
}

#[tauri::command]
pub fn applets_get_config(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_get_config(context, input)
}

#[tauri::command]
pub fn applets_set_config(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletConfigSetInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_set_config(context, input)
}

#[tauri::command]
pub fn applets_action(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletActionInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_action(context, input)
}

#[tauri::command]
pub fn applets_create_session(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletCreateSessionInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let data_dir = match state.storage.dirs.get(&StorageKind::Data) {
        Some(dir) => dir.clone(),
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Application data directory not configured",
                None,
            );
        }
    };
    application_applets::applets_create_session(context, input, &data_dir)
}

#[tauri::command]
pub fn applets_invoke(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletInvokeInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let data_dir = match state.storage.dirs.get(&StorageKind::Data) {
        Some(dir) => dir.clone(),
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Application data directory not configured",
                None,
            );
        }
    };
    application_applets::applets_invoke(context, input, &data_dir)
}
