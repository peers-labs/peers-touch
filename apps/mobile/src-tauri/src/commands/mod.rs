pub mod build_identity;
pub mod draft;
pub mod health;
pub mod ledger;
pub mod native_events;
pub mod oauth;
pub mod platform_bridge;
pub mod secure_storage;
pub mod station;

use tauri::ipc::Invoke;

#[cfg(not(feature = "acceptance-harness"))]
pub fn handlers<R: tauri::Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Health
        health::mobile_health,
        // Native events
        native_events::mobile_native_event_emit,
        // Messaging
        crate::messaging::commands::messaging_activate,
        crate::messaging::commands::messaging_attachment_stage_begin,
        crate::messaging::commands::messaging_attachment_stage_complete,
        crate::messaging::commands::messaging_attachment_stage_discard,
        crate::messaging::commands::messaging_attachment_stage_write,
        crate::messaging::commands::messaging_cancel_attachment,
        crate::messaging::commands::messaging_command_status,
        crate::messaging::commands::messaging_create_direct,
        crate::messaging::commands::messaging_create_group,
        crate::messaging::commands::messaging_deactivate,
        crate::messaging::commands::messaging_list_conversations,
        crate::messaging::commands::messaging_list_messages,
        crate::messaging::commands::messaging_list_thread_messages,
        crate::messaging::commands::messaging_open_attachment,
        crate::messaging::commands::messaging_reconcile,
        crate::messaging::commands::messaging_resume,
        crate::messaging::commands::messaging_search_messages,
        crate::messaging::commands::messaging_send_message,
        crate::messaging::commands::messaging_status,
        crate::messaging::commands::messaging_suspend,
        crate::messaging::commands::messaging_submit_edit,
        crate::messaging::commands::messaging_submit_metadata_interaction,
        crate::messaging::commands::messaging_submit_read_cursor,
        crate::messaging::commands::messaging_submit_typing,
        crate::messaging::commands::messaging_wake,
        // OAuth
        oauth::oauth_cancel,
        oauth::oauth_logout_purge,
        oauth::oauth_projection,
        oauth::oauth_restore,
        oauth::oauth_retry_browser,
        oauth::oauth_start,
        oauth::oauth_status,
        // Secure storage
        secure_storage::secure_storage_get,
        secure_storage::secure_storage_remove,
        secure_storage::secure_storage_set,
        // Station
        station::station_identity_verify,
        station::station_probe,
        // Command ledger
        ledger::ledger_initialize,
        ledger::ledger_admit,
        ledger::ledger_update_status,
        ledger::ledger_readback,
        ledger::ledger_readback_by_status,
        ledger::ledger_purge_committed,
        ledger::ledger_shutdown,
        // Draft store
        draft::draft_store_initialize,
        draft::draft_save,
        draft::draft_load,
        draft::draft_remove,
        draft::draft_list,
        draft::draft_store_shutdown,
        // W7: Platform bridge — lifecycle, permissions, network
        platform_bridge::lifecycle_generation,
        platform_bridge::lifecycle_advance_generation,
        platform_bridge::lifecycle_process_event,
        platform_bridge::lifecycle_reconciliation_report,
        platform_bridge::permission_check,
        platform_bridge::permission_request,
        platform_bridge::permission_check_all,
        platform_bridge::network_state,
        platform_bridge::network_update_state,
        platform_bridge::network_is_connected,
    ]
}

#[cfg(feature = "acceptance-harness")]
pub fn handlers<R: tauri::Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // Build identity (acceptance only)
        build_identity::mobile_build_identity,
        // Health
        health::mobile_health,
        // Native events
        native_events::mobile_native_event_emit,
        // Messaging
        crate::messaging::commands::messaging_activate,
        crate::messaging::commands::messaging_attachment_stage_begin,
        crate::messaging::commands::messaging_attachment_stage_complete,
        crate::messaging::commands::messaging_attachment_stage_discard,
        crate::messaging::commands::messaging_attachment_stage_write,
        crate::messaging::commands::messaging_cancel_attachment,
        crate::messaging::commands::messaging_command_status,
        crate::messaging::commands::messaging_create_direct,
        crate::messaging::commands::messaging_create_group,
        crate::messaging::commands::messaging_deactivate,
        crate::messaging::commands::messaging_list_conversations,
        crate::messaging::commands::messaging_list_messages,
        crate::messaging::commands::messaging_list_thread_messages,
        crate::messaging::commands::messaging_open_attachment,
        crate::messaging::commands::messaging_reconcile,
        crate::messaging::commands::messaging_resume,
        crate::messaging::commands::messaging_search_messages,
        crate::messaging::commands::messaging_send_message,
        crate::messaging::commands::messaging_status,
        crate::messaging::commands::messaging_suspend,
        crate::messaging::commands::messaging_submit_edit,
        crate::messaging::commands::messaging_submit_metadata_interaction,
        crate::messaging::commands::messaging_submit_read_cursor,
        crate::messaging::commands::messaging_submit_typing,
        crate::messaging::commands::messaging_wake,
        // OAuth (acceptance)
        oauth::oauth_acceptance_callback_replay_handle,
        oauth::oauth_acceptance_negative_callback,
        oauth::oauth_cancel,
        oauth::oauth_logout_purge,
        oauth::oauth_projection,
        oauth::oauth_restore,
        oauth::oauth_retry_browser,
        oauth::oauth_start,
        oauth::oauth_status,
        // Secure storage
        secure_storage::secure_storage_get,
        secure_storage::secure_storage_remove,
        secure_storage::secure_storage_set,
        // Station
        station::station_identity_verify,
        station::station_probe,
        // Command ledger
        ledger::ledger_initialize,
        ledger::ledger_admit,
        ledger::ledger_update_status,
        ledger::ledger_readback,
        ledger::ledger_readback_by_status,
        ledger::ledger_purge_committed,
        ledger::ledger_shutdown,
        // Draft store
        draft::draft_store_initialize,
        draft::draft_save,
        draft::draft_load,
        draft::draft_remove,
        draft::draft_list,
        draft::draft_store_shutdown,
        // W7: Platform bridge — lifecycle, permissions, network
        platform_bridge::lifecycle_generation,
        platform_bridge::lifecycle_advance_generation,
        platform_bridge::lifecycle_process_event,
        platform_bridge::lifecycle_reconciliation_report,
        platform_bridge::permission_check,
        platform_bridge::permission_request,
        platform_bridge::permission_check_all,
        platform_bridge::network_state,
        platform_bridge::network_update_state,
        platform_bridge::network_is_connected,
    ]
}
