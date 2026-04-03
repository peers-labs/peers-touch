use tracing_appender::non_blocking::WorkerGuard;

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

    let log_dir = layout.dirs.get(&StorageKind::Logs)
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    tracing::info!(
        app = layout.app_name,
        root = %layout.root.display(),
        source = layout.root_source,
        "Storage initialized"
    );

    tracing::info!(log_dir = %log_dir, "Logger initialized");

    let result = BootstrapResult {
        app_state: AppState::new(layout),
        _log_guard: log_guard,
    };

    tracing::info!("Bootstrap complete");

    result
}

fn init_storage() -> StorageLayout {
    storage::initialize_app_storage("desktop")
        .expect("[bootstrap] Failed to initialize storage layout")
}

fn init_logger(layout: &StorageLayout) -> WorkerGuard {
    let logs_dir = layout.dirs.get(&StorageKind::Logs)
        .expect("[bootstrap] Logs directory not found in storage layout");
    logger::initialize(logs_dir)
        .expect("[bootstrap] Failed to initialize logger")
}
