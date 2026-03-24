use crate::error::AppResult;
use crate::interface::contracts::{
    ConfigFieldResetInput, ConfigPostgresTestInput, ConfigSectionInput, ConfigSectionSetInput, LogsTailInput,
    OAuthCreateBotSessionInput, OAuthSessionInput, OAuthSimulateStartInput, OnboardingSetInput, PreferencesSetInput,
    ShareIdInput, ShareSessionInput, StubPayload, WizardExecuteApiInput, WizardStepInput,
};

#[path = "../../application/system/mod.rs"]
mod application_system;

#[tauri::command]
pub fn system_health() -> AppResult<StubPayload> { application_system::system_health() }
#[tauri::command]
pub fn onboarding_get() -> AppResult<StubPayload> { application_system::onboarding_get() }
#[tauri::command]
pub fn onboarding_set(input: OnboardingSetInput) -> AppResult<StubPayload> { application_system::onboarding_set(input) }
#[tauri::command]
pub fn onboarding_reset() -> AppResult<StubPayload> { application_system::onboarding_reset() }
#[tauri::command]
pub fn wizard_get() -> AppResult<StubPayload> { application_system::wizard_get() }
#[tauri::command]
pub fn wizard_state_get() -> AppResult<StubPayload> { application_system::wizard_state_get() }
#[tauri::command]
pub fn wizard_step_save(input: WizardStepInput) -> AppResult<StubPayload> { application_system::wizard_step_save(input) }
#[tauri::command]
pub fn wizard_complete() -> AppResult<StubPayload> { application_system::wizard_complete() }
#[tauri::command]
pub fn wizard_api_execute(input: WizardExecuteApiInput) -> AppResult<StubPayload> { application_system::wizard_api_execute(input) }
#[tauri::command]
pub fn statistics_get() -> AppResult<StubPayload> { application_system::statistics_get() }
#[tauri::command]
pub fn preferences_get() -> AppResult<StubPayload> { application_system::preferences_get() }
#[tauri::command]
pub fn preferences_set(input: PreferencesSetInput) -> AppResult<StubPayload> { application_system::preferences_set(input) }
#[tauri::command]
pub fn share_create(input: ShareSessionInput) -> AppResult<StubPayload> { application_system::share_create(input) }
#[tauri::command]
pub fn share_delete(input: ShareSessionInput) -> AppResult<StubPayload> { application_system::share_delete(input) }
#[tauri::command]
pub fn share_get(input: ShareIdInput) -> AppResult<StubPayload> { application_system::share_get(input) }
#[tauri::command]
pub fn logs_tail(input: LogsTailInput) -> AppResult<StubPayload> { application_system::logs_tail(input) }
#[tauri::command]
pub fn oauth_simulate_lark_start(input: OAuthSimulateStartInput) -> AppResult<StubPayload> { application_system::oauth_simulate_lark_start(input) }
#[tauri::command]
pub fn oauth_simulate_lark_poll(input: OAuthSessionInput) -> AppResult<StubPayload> { application_system::oauth_simulate_lark_poll(input) }
#[tauri::command]
pub fn oauth_simulate_lark_create_bot_session(input: OAuthCreateBotSessionInput) -> AppResult<StubPayload> { application_system::oauth_simulate_lark_create_bot_session(input) }
#[tauri::command]
pub fn config_section_get(input: ConfigSectionInput) -> AppResult<StubPayload> { application_system::config_section_get(input) }
#[tauri::command]
pub fn config_section_set(input: ConfigSectionSetInput) -> AppResult<StubPayload> { application_system::config_section_set(input) }
#[tauri::command]
pub fn config_field_reset(input: ConfigFieldResetInput) -> AppResult<StubPayload> { application_system::config_field_reset(input) }
#[tauri::command]
pub fn config_test_postgres(input: ConfigPostgresTestInput) -> AppResult<StubPayload> { application_system::config_test_postgres(input) }
#[tauri::command]
pub fn embedding_models_list() -> AppResult<StubPayload> { application_system::embedding_models_list() }
#[tauri::command]
pub fn visitor_heartbeat() -> AppResult<StubPayload> { application_system::visitor_heartbeat() }
#[tauri::command]
pub fn visitor_online() -> AppResult<StubPayload> { application_system::visitor_online() }
