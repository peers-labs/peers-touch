pub mod build_identity;
pub mod draft;
pub mod health;
pub mod key_exchange;
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
        // Crypto / key exchange
        key_exchange::crypto_identity_key_bundle,
        key_exchange::signaling_envelope_open,
        key_exchange::signaling_envelope_seal,
        // Health
        health::mobile_health,
        // Native events
        native_events::mobile_native_event_emit,
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
        // Crypto / key exchange
        key_exchange::crypto_identity_key_bundle,
        key_exchange::signaling_envelope_open,
        key_exchange::signaling_envelope_seal,
        // Health
        health::mobile_health,
        // Native events
        native_events::mobile_native_event_emit,
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
