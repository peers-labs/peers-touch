mod commands;
pub mod domain;
pub mod error;
pub mod messaging;
mod platform;
pub mod runtime;

use platform::native_events;
#[cfg(not(target_os = "android"))]
use platform::secure_storage::SecureStorage;
use platform::MobilePlatform;
use runtime::oauth::OAuthCoordinator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(MobilePlatform::ios_first())
        .manage(
            OAuthCoordinator::new().expect("failed to initialize the native OAuth coordinator"),
        );

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_peers_secure_storage::init());

    #[cfg(not(target_os = "android"))]
    let builder = builder.manage(SecureStorage::new());

    builder
        .setup(platform::deep_link::install)
        .invoke_handler(commands::handlers())
        .build(tauri::generate_context!())
        .expect("failed to build Peers")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Resumed) {
                if let Err(error) = native_events::emit_resume(app, "tauri-run-event") {
                    let _ = native_events::emit_native_event_error(
                        app,
                        "emit-mobile-resume",
                        &error.to_string(),
                    );
                }
            }
        });
}
