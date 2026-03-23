#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod interface;
mod state;

use interface::tauri_commands::{admin, auth, chat, profile, settings, timeline};
use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            auth::auth_login,
            auth::auth_logout,
            auth::auth_restore_session,
            auth::auth_validate_token,
            settings::settings_get,
            settings::settings_set,
            settings::settings_reset,
            chat::chat_list_conversations,
            chat::chat_list_messages,
            chat::chat_send_message,
            chat::chat_mark_read,
            timeline::timeline_list,
            timeline::timeline_like,
            timeline::timeline_comment,
            timeline::timeline_repost,
            profile::profile_get,
            profile::profile_update,
            profile::profile_upload_avatar,
            profile::profile_upload_header,
            profile::profile_update_privacy,
            admin::admin_health,
            admin::admin_network_probe,
            admin::admin_execute_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
