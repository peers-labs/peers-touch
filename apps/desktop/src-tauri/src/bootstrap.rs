use tracing_appender::non_blocking::WorkerGuard;

use crate::application::station_runtime::StationRuntime;
use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::logger;
use crate::infrastructure::storage::active_profile::ProfileSource;
use crate::infrastructure::storage::{self, active_profile, StorageKind, StorageLayout};
use crate::state::AppState;

pub struct BootstrapResult {
    pub app_state: AppState,
    pub _log_guard: WorkerGuard,
}

pub fn run() -> BootstrapResult {
    tracing::info!("Peers Touch Desktop starting");

    // Resolve the launch profile exactly once and publish it through
    // PT_PROFILE so every later reader (storage layout, SQLCipher DB names,
    // attachment/MCP components) shares the selection. Without this a
    // Finder/Dock launch falls into the hardcoded "desktop" profile and can
    // strand an identity verified under another profile; see
    // infrastructure::storage::active_profile.
    let (profile, profile_source) = active_profile::resolve_launch_profile()
        .expect("[bootstrap] invalid PT_PROFILE profile id");
    std::env::set_var("PT_PROFILE", &profile);
    let layout = storage::initialize_app_storage(&profile)
        .expect("[bootstrap] Failed to initialize storage layout");
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

    tracing::info!(
        profile = %profile,
        selection = profile_source.as_str(),
        "Launch profile resolved"
    );

    tracing::info!(log_dir = %log_dir, "Logger initialized");

    let config_dir = layout
        .dirs
        .get(&StorageKind::Config)
        .cloned()
        .unwrap_or_else(|| layout.root.join("config"));

    // Secure stores bind before any subsystem that can read secrets:
    // Station transport identity is resolved during StationRuntime::start.
    configure_secure_stores(&layout);

    let station = StationRuntime::start(&config_dir)
        .expect("[bootstrap] Failed to initialize app-scoped Station runtime");
    tracing::info!("App-scoped Station runtime initialized");

    let i18n = I18nService::new(&config_dir);
    tracing::info!("I18nService initialized");

    let result = BootstrapResult {
        app_state: AppState::new(layout, i18n, station),
        _log_guard: log_guard,
    };

    tracing::info!("Bootstrap complete");

    result
}

// Identity seeds and SQLCipher database keys share one 0700/0600 file-backed
// secure store under the active profile data directory in every build profile:
// `<profile>/data/secure-store/{identity-keys,storage-keys}/<sha256(ref)>`.
// The file store is portable across rebuilds, re-signing, upgrades, and
// multi-instance account isolation, whereas the macOS Keychain ACL is bound to
// the ad-hoc code signature (cdhash): recompiling or re-signing the binary
// would otherwise lock it out of its own secrets and force a new device
// identity or a "wrong database key" failure. Legacy carriers (the pre-profile
// debug file store and the OS keychain) remain read-only sources migrated into
// the canonical file store on first miss. Content-addressed per-ref files keep
// every account's secrets independent, so co-running desktop instances signed
// into different accounts never conflict or overwrite each other.
fn configure_secure_stores(layout: &StorageLayout) {
    let Some(data_dir) = layout.dirs.get(&StorageKind::Data) else {
        return;
    };
    let secure_store = data_dir.join("secure-store");
    if let Err(error) = crate::domain::crypto::set_identity_file_root(secure_store.clone()) {
        tracing::warn!(%error, "failed to configure identity file store");
    }
    if let Err(error) =
        crate::infrastructure::storage::key_provider::set_storage_key_file_root(secure_store)
    {
        tracing::warn!(%error, "failed to configure storage key file store");
    }
}

fn init_logger(layout: &StorageLayout) -> WorkerGuard {
    let logs_dir = layout
        .dirs
        .get(&StorageKind::Logs)
        .expect("[bootstrap] Logs directory not found in storage layout");
    logger::initialize(logs_dir).expect("[bootstrap] Failed to initialize logger")
}
