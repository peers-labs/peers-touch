pub mod build_identity;
pub mod health;
pub mod key_exchange;
pub mod native_events;
pub mod oauth;
pub mod secure_storage;
pub mod station;

use tauri::ipc::Invoke;

#[cfg(not(feature = "acceptance-harness"))]
pub fn handlers<R: tauri::Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        key_exchange::crypto_identity_key_bundle,
        key_exchange::signaling_envelope_open,
        key_exchange::signaling_envelope_seal,
        health::mobile_health,
        native_events::mobile_native_event_emit,
        oauth::oauth_cancel,
        oauth::oauth_logout_purge,
        oauth::oauth_projection,
        oauth::oauth_restore,
        oauth::oauth_retry_browser,
        oauth::oauth_start,
        oauth::oauth_status,
        secure_storage::secure_storage_get,
        secure_storage::secure_storage_remove,
        secure_storage::secure_storage_set,
        station::station_identity_verify,
        station::station_probe,
    ]
}

#[cfg(feature = "acceptance-harness")]
pub fn handlers<R: tauri::Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        build_identity::mobile_build_identity,
        key_exchange::crypto_identity_key_bundle,
        key_exchange::signaling_envelope_open,
        key_exchange::signaling_envelope_seal,
        health::mobile_health,
        native_events::mobile_native_event_emit,
        oauth::oauth_acceptance_callback_replay_handle,
        oauth::oauth_acceptance_negative_callback,
        oauth::oauth_cancel,
        oauth::oauth_logout_purge,
        oauth::oauth_projection,
        oauth::oauth_restore,
        oauth::oauth_retry_browser,
        oauth::oauth_start,
        oauth::oauth_status,
        secure_storage::secure_storage_get,
        secure_storage::secure_storage_remove,
        secure_storage::secure_storage_set,
        station::station_identity_verify,
        station::station_probe,
    ]
}
