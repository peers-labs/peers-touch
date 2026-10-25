mod commands;
pub mod domain;
pub mod error;
pub mod messaging;
mod platform;
pub mod runtime;
pub mod secure_content;
pub mod social;
mod station_origin;

pub use platform::ios::{
    AdmissionProjection, AdmissionState, CapabilityFact, CapabilityFactState, PlatformHostPort,
    ReleaseTargetId, RuntimePortId, SystemAction, SystemActionOutcome, SystemActionState,
};

use messaging::lifecycle::MobileMessagingRuntime;
use platform::push_bridge::PushBridgeRuntime;
#[cfg(not(target_os = "android"))]
use platform::secure_storage::SecureStorage;
use platform::MobilePlatform;
use runtime::x_config::MobileXConfigRuntime;
use runtime::oauth::OAuthCoordinator;
use runtime::reliability::ReliabilityRuntime;
use runtime::station_transport::StationTransportRuntime;
use social::MobilePrivateSocialRuntime;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mobile_platform = MobilePlatform::from_compiled_target()
        .expect("failed to resolve the Mobile release target");
    let builder = tauri::Builder::default()
        .register_uri_scheme_protocol("chat-file", |context, request| {
            let runtime = context.app_handle().state::<MobileMessagingRuntime>();
            messaging::file_access::asset_response(runtime.inner(), context.webview_label(), &request)
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_peers_platform_permissions::init())
        .plugin(tauri_plugin_peers_secure_input::init())
        .manage(mobile_platform)
        .manage(OAuthCoordinator::new().expect("failed to initialize the native OAuth coordinator"))
        .manage(MobileMessagingRuntime::default())
        .manage(MobilePrivateSocialRuntime::default())
        .manage(PushBridgeRuntime::default())
        .manage(ReliabilityRuntime::default())
        .manage(MobileXConfigRuntime::default())
        .manage(StationTransportRuntime::default());

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
