use tracing_appender::non_blocking::WorkerGuard;

use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::logger;
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
    let i18n = I18nService::new(&config_dir);
    tracing::info!("I18nService initialized");

    let result = BootstrapResult {
        app_state: AppState::new(layout, i18n),
        _log_guard: log_guard,
    };

    tracing::info!("Bootstrap complete");

    result
}

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
