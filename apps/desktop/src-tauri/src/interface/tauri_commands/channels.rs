use std::sync::Arc;

use tauri::{State, Window};

use crate::application::{channels as application_channels, session_resolver};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

fn token_for_window(state: &Arc<AppState>, window: &Window) -> Result<String, AppResult<Vec<u8>>> {
    session_resolver::token_for_window(state, window)
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))
}

macro_rules! authenticated_channel_command {
    ($command:ident, $operation:ident) => {
        #[tauri::command]
        pub fn $command(
            input: application_channels::EncodedChannelRequestInput,
            state: State<'_, Arc<AppState>>,
            window: Window,
        ) -> AppResult<Vec<u8>> {
            let token = match token_for_window(state.inner(), &window) {
                Ok(token) => token,
                Err(error) => return error,
            };
            application_channels::$operation(state.station.client(), input, &token)
        }
    };
}

authenticated_channel_command!(channels_list_bindings, list_bindings);
authenticated_channel_command!(channels_create_binding, create_binding);
authenticated_channel_command!(channels_update_binding, update_binding);
authenticated_channel_command!(channels_delete_binding, delete_binding);
authenticated_channel_command!(channels_start_binding, start_binding);
authenticated_channel_command!(channels_stop_binding, stop_binding);
authenticated_channel_command!(channels_set_default_binding, set_default_binding);
authenticated_channel_command!(channels_validate_app, validate_app);
authenticated_channel_command!(channels_check_health, check_health);
authenticated_channel_command!(
    channels_start_requester_authorization,
    start_requester_authorization
);
authenticated_channel_command!(
    channels_get_requester_authorization,
    get_requester_authorization
);
authenticated_channel_command!(
    channels_refresh_requester_authorization,
    refresh_requester_authorization
);
authenticated_channel_command!(
    channels_revoke_requester_authorization,
    revoke_requester_authorization
);
authenticated_channel_command!(
    channels_cancel_requester_authorization,
    cancel_requester_authorization
);
authenticated_channel_command!(channels_list_routes, list_routes);
authenticated_channel_command!(channels_upsert_route, upsert_route);
authenticated_channel_command!(channels_delete_route, delete_route);
authenticated_channel_command!(channels_list_member_access, list_member_access);
authenticated_channel_command!(channels_decide_member_access, decide_member_access);
authenticated_channel_command!(channels_list_chats, list_chats);
authenticated_channel_command!(channels_list_automations, list_automations);
authenticated_channel_command!(channels_upsert_automation, upsert_automation);
authenticated_channel_command!(channels_delete_automation, delete_automation);
authenticated_channel_command!(channels_run_automation, run_automation);
authenticated_channel_command!(channels_send_message, send_message);
authenticated_channel_command!(channels_list_events, list_events);
authenticated_channel_command!(channels_get_stats, get_stats);
authenticated_channel_command!(channels_retry_delivery, retry_delivery);
authenticated_channel_command!(channels_export_diagnostics, export_diagnostics);
authenticated_channel_command!(channels_start_provisioning, start_provisioning);
authenticated_channel_command!(channels_poll_provisioning, poll_provisioning);
authenticated_channel_command!(channels_confirm_provisioning, confirm_provisioning);
authenticated_channel_command!(channels_cancel_provisioning, cancel_provisioning);
