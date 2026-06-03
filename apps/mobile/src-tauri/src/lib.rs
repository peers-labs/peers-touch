mod commands;
pub mod error;
mod platform;

use platform::MobilePlatform;
use platform::native_events;
use platform::secure_storage::SecureStorage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MobilePlatform::ios_first())
        .manage(SecureStorage::new())
        .invoke_handler(commands::handlers())
        .build(tauri::generate_context!())
        .expect("failed to build Peers Touch Mobile")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Resumed) {
                if let Err(error) = native_events::emit_resume(app, "tauri-run-event") {
                    let _ = native_events::emit_native_event_error(app, "emit-mobile-resume", &error.to_string());
                }
            }
        });
}
