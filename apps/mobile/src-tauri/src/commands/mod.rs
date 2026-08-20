pub mod health;
pub mod key_exchange;
pub mod native_events;
pub mod secure_storage;
pub mod station;

use tauri::ipc::Invoke;

pub fn handlers<R: tauri::Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        key_exchange::crypto_identity_key_bundle,
        key_exchange::signaling_envelope_open,
        key_exchange::signaling_envelope_seal,
        health::mobile_health,
        native_events::mobile_native_event_emit,
        secure_storage::secure_storage_get,
        secure_storage::secure_storage_remove,
        secure_storage::secure_storage_set,
        station::station_probe,
    ]
}
