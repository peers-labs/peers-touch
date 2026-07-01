use crate::application::applet_store;
use crate::application::applets as application_applets;
use crate::application::provider::state as provider_state;
use crate::application::session_resolver;
use crate::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletCreateSessionInput, AppletIdInput,
    AppletInvokeInput, AppletStoreGetVersionInput, AppletStoreInstallInput,
    AppletStoreListCatalogInput, AppletStoreListInstalledInput, AppletStoreMaterializeBundleInput,
    AppletStoreUninstallInput, AppletStoreUploadAuditInput, StubPayload,
};
use crate::domain::applets::AccessContext;
use crate::domain::identity::{ActiveSession, ActorRef};
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::infrastructure::storage::StorageKind;
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri::Window;

const PRODUCT_WINDOW_E2E_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E";
const PRODUCT_WINDOW_E2E_APPLET_ID_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_APPLET_ID";
const PRODUCT_WINDOW_E2E_ACTOR_ID_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_ACTOR_ID";
const PRODUCT_WINDOW_E2E_TOKEN_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_TOKEN";
const PRODUCT_WINDOW_E2E_PROVIDER_BASE_URL_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_PROVIDER_BASE_URL";
const PRODUCT_WINDOW_E2E_PRODUCT_APP_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_PRODUCT_APP";
const PRODUCT_WINDOW_E2E_EVIDENCE_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_EVIDENCE";
const PRODUCT_WINDOW_E2E_LIFECYCLE_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_LIFECYCLE";
const PRODUCT_WINDOW_E2E_SECONDARY_APPLET_ID_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_SECONDARY_APPLET_ID";
const PRODUCT_WINDOW_E2E_LOGIN_METHOD: &str = "product-window-certification";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppletProductWindowRenderedInput {
    pub applet_id: String,
    pub ready_source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppletProductWindowLifecycleInput {
    pub evidence: serde_json::Value,
}

fn product_window_e2e_enabled() -> bool {
    std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn product_window_e2e_product_app_enabled() -> bool {
    std::env::var(PRODUCT_WINDOW_E2E_PRODUCT_APP_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn product_window_e2e_lifecycle_enabled() -> bool {
    std::env::var(PRODUCT_WINDOW_E2E_LIFECYCLE_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn status_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn product_window_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn read_applet_manifest_from_dir(
    directory: &Path,
) -> Result<serde_json::Value, AppResult<StubPayload>> {
    for file_name in ["applet.json", "manifest.json"] {
        let manifest_path = directory.join(file_name);
        if !manifest_path.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&manifest_path).map_err(|error| {
            AppResult::fail(
                ErrorCode::InternalError,
                "error.applet.importManifestReadFailed",
                Some(json!({
                    "path": manifest_path.to_string_lossy(),
                    "reason": error.to_string()
                })),
            )
        })?;
        return serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
            AppResult::fail(
                ErrorCode::InvalidArgument,
                "error.applet.importManifestInvalidJson",
                Some(json!({
                    "path": manifest_path.to_string_lossy(),
                    "reason": error.to_string()
                })),
            )
        });
    }

    Err(AppResult::fail(
        ErrorCode::InvalidArgument,
        "error.applet.importManifestMissing",
        Some(json!({ "directory": directory.to_string_lossy() })),
    ))
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
    let lifecycle_enabled = product_window_e2e_lifecycle_enabled();
    let secondary_applet_id = std::env::var(PRODUCT_WINDOW_E2E_SECONDARY_APPLET_ID_ENV)
        .unwrap_or_else(|_| "peers.note".to_string());

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
            "mode": if lifecycle_enabled { "lifecycle-smoothness" } else { "product-shell" },
            "secondaryAppletId": secondary_applet_id,
            "startPage": if lifecycle_enabled { "applets" } else { "" }
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
pub fn applets_product_window_report_rendered(
    input: AppletProductWindowRenderedInput,
) -> AppResult<StubPayload> {
    if !product_window_e2e_enabled() || !product_window_e2e_product_app_enabled() {
        return status_payload(
            "applets_product_window_report_rendered",
            json!({ "recorded": false, "reason": "product_window_e2e_disabled" }),
        );
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV)
        .unwrap_or_else(|_| "generic-complex-applet".to_string());
    if input.applet_id.trim() != expected_applet_id.trim() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "applet product-window render evidence applet mismatch",
            Some(json!({
                "expectedAppletId": expected_applet_id,
                "actualAppletId": input.applet_id,
            })),
        );
    }

    let output_path = match std::env::var(PRODUCT_WINDOW_E2E_EVIDENCE_ENV) {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => {
            return status_payload(
                "applets_product_window_report_rendered",
                json!({ "recorded": false, "reason": "evidence_path_missing" }),
            );
        }
    };
    if let Some(parent) = output_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return AppResult::fail(
                ErrorCode::InternalError,
                "failed to create product-window render evidence directory",
                Some(json!({ "reason": error.to_string() })),
            );
        }
    }

    let ready_source = input
        .ready_source
        .filter(|source| !source.trim().is_empty())
        .unwrap_or_else(|| "host-rendered".to_string());
    let evidence = json!({
        "ok": true,
        "appletId": input.applet_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": "applet.product.rendered",
        "readySource": ready_source,
        "recordedAt": product_window_timestamp_millis(),
    });
    let bytes = match serde_json::to_vec_pretty(&evidence) {
        Ok(bytes) => bytes,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "failed to serialize product-window render evidence",
                Some(json!({ "reason": error.to_string() })),
            );
        }
    };
    if let Err(error) = fs::write(&output_path, bytes) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "failed to write product-window render evidence",
            Some(json!({
                "path": output_path.to_string_lossy(),
                "reason": error.to_string()
            })),
        );
    }

    status_payload(
        "applets_product_window_report_rendered",
        json!({ "recorded": true, "path": output_path.to_string_lossy() }),
    )
}

#[tauri::command]
pub fn applets_product_window_report_lifecycle(
    input: AppletProductWindowLifecycleInput,
) -> AppResult<StubPayload> {
    if !product_window_e2e_enabled() || !product_window_e2e_lifecycle_enabled() {
        return status_payload(
            "applets_product_window_report_lifecycle",
            json!({ "recorded": false, "reason": "product_window_lifecycle_e2e_disabled" }),
        );
    }

    let output_path = match std::env::var(PRODUCT_WINDOW_E2E_EVIDENCE_ENV) {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => {
            return status_payload(
                "applets_product_window_report_lifecycle",
                json!({ "recorded": false, "reason": "evidence_path_missing" }),
            );
        }
    };
    if let Some(parent) = output_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return AppResult::fail(
                ErrorCode::InternalError,
                "failed to create product-window lifecycle evidence directory",
                Some(json!({ "reason": error.to_string() })),
            );
        }
    }

    let applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV)
        .unwrap_or_else(|_| "generic-complex-applet".to_string());
    let secondary_applet_id = std::env::var(PRODUCT_WINDOW_E2E_SECONDARY_APPLET_ID_ENV)
        .unwrap_or_else(|_| "peers.note".to_string());
    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "secondaryAppletId": secondary_applet_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": "applet.lifecycle.smoothness.completed",
        "recordedAt": product_window_timestamp_millis(),
        "detail": input.evidence,
    });
    let bytes = match serde_json::to_vec_pretty(&evidence) {
        Ok(bytes) => bytes,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "failed to serialize product-window lifecycle evidence",
                Some(json!({ "reason": error.to_string() })),
            );
        }
    };
    if let Err(error) = fs::write(&output_path, bytes) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "failed to write product-window lifecycle evidence",
            Some(json!({
                "path": output_path.to_string_lossy(),
                "reason": error.to_string()
            })),
        );
    }

    status_payload(
        "applets_product_window_report_lifecycle",
        json!({ "recorded": true, "path": output_path.to_string_lossy() }),
    )
}

#[tauri::command]
pub async fn applets_pick_import_directory() -> AppResult<StubPayload> {
    tracing::info!("Opening applet import directory picker");
    let picked = rfd::AsyncFileDialog::new().pick_folder().await;
    let directory: PathBuf = match picked {
        Some(handle) => handle.path().to_path_buf(),
        None => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "error.applet.importDirectoryCancelled",
                None,
            );
        }
    };

    let manifest = match read_applet_manifest_from_dir(&directory) {
        Ok(manifest) => manifest,
        Err(error) => return error,
    };

    status_payload(
        "applets_pick_import_directory",
        json!({
            "directory": directory.to_string_lossy(),
            "manifest": manifest
        }),
    )
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
pub fn applets_store_list_catalog(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletStoreListCatalogInput,
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
    applet_store::list_catalog(context, input, &data_dir)
}

#[tauri::command]
pub fn applets_store_list_installed(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletStoreListInstalledInput,
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
    applet_store::list_installed(context, input, &data_dir)
}

#[tauri::command]
pub fn applets_store_install(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletStoreInstallInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    applet_store::install(context, input)
}

#[tauri::command]
pub fn applets_store_uninstall(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletStoreUninstallInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    applet_store::uninstall(context, input)
}

#[tauri::command]
pub fn applets_store_get_version(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletStoreGetVersionInput,
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
    applet_store::get_version(context, input, &data_dir)
}

#[tauri::command]
pub fn applets_store_materialize_bundle(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletStoreMaterializeBundleInput,
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
    applet_store::materialize_bundle(context, input, &data_dir)
}

#[tauri::command]
pub fn applets_store_upload_audit(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletStoreUploadAuditInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    applet_store::upload_audit(context, input.device_id)
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
