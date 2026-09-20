mod commands;
pub mod domain;
pub mod error;
pub mod messaging;
mod platform;
pub mod runtime;
pub mod secure_content;
mod station_origin;

use messaging::lifecycle::MobileMessagingRuntime;
#[cfg(not(target_os = "android"))]
use platform::secure_storage::SecureStorage;
use platform::MobilePlatform;
use runtime::command_ledger::CommandLedger;
use runtime::draft_store::DraftStore;
use runtime::oauth::OAuthCoordinator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_peers_platform_permissions::init())
        .manage(MobilePlatform::ios_first())
        .manage(OAuthCoordinator::new().expect("failed to initialize the native OAuth coordinator"))
        .manage(MobileMessagingRuntime::default())
        .manage(CommandLedger::new())
        .manage(DraftStore::new());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_peers_secure_storage::init());

    #[cfg(not(target_os = "android"))]
    let builder = builder.manage(SecureStorage::new());

    builder
        .setup(platform::deep_link::install)
        .invoke_handler(commands::handlers())
        .build(tauri::generate_context!())
        .expect("failed to build Peers")
        .run(|_, _| {});
}
