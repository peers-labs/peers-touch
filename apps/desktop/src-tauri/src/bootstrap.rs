use tracing_appender::non_blocking::WorkerGuard;

use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::logger;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind, StorageLayout};
use crate::state::AppState;

pub struct BootstrapResult {
    pub app_state: AppState,
    pub _log_guard: WorkerGuard,
}

pub fn run() -> BootstrapResult {
    tracing::info!("Peers Touch Desktop starting");

    let layout = init_storage();
    let log_guard = init_logger(&layout);

    let log_dir = layout
        .dirs
        .get(&StorageKind::Logs)
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    tracing::info!(
        app = layout.app_name,
        root = %layout.root.display(),
        source = layout.root_source,
        "Storage initialized"
    );

    tracing::info!(log_dir = %log_dir, "Logger initialized");

    let config_dir = layout
        .dirs
        .get(&StorageKind::Config)
        .cloned()
        .unwrap_or_else(|| layout.root.join("config"));

    // Initialize global station registry before any station_client calls.
    station_client::init_station_registry(&config_dir);
    tracing::info!("StationRegistry initialized");

    let i18n = I18nService::new(&config_dir);
    tracing::info!("I18nService initialized");

    configure_debug_identity_store(&layout);

    let result = BootstrapResult {
        app_state: AppState::new(layout, i18n),
        _log_guard: log_guard,
    };

    tracing::info!("Bootstrap complete");

    result
}

// Debug/dev builds keep identity seeds in a file-backed secure store instead of
// the macOS Keychain, so recompiling (which changes the ad-hoc signature and
// invalidates the Keychain ACL) does not prompt for the login password on every
// launch. Release builds leave the domain on the OS keychain.
#[cfg(debug_assertions)]
fn configure_debug_identity_store(layout: &StorageLayout) {
    let Some(data_dir) = layout.dirs.get(&StorageKind::Data) else {
        return;
    };
    let secure_store = data_dir.join("secure-store");
    if let Err(error) = crate::domain::crypto::set_identity_file_root(secure_store) {
        tracing::warn!(%error, "failed to configure debug identity file store");
    }
}

#[cfg(not(debug_assertions))]
fn configure_debug_identity_store(_layout: &StorageLayout) {}

fn init_storage() -> StorageLayout {
    let profile = std::env::var("PT_PROFILE").unwrap_or_else(|_| "desktop".to_string());
    storage::initialize_app_storage(&profile)
        .expect("[bootstrap] Failed to initialize storage layout")
}

fn init_logger(layout: &StorageLayout) -> WorkerGuard {
    let logs_dir = layout
        .dirs
        .get(&StorageKind::Logs)
        .expect("[bootstrap] Logs directory not found in storage layout");
    logger::initialize(logs_dir).expect("[bootstrap] Failed to initialize logger")
}
