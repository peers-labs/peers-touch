use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

const LOG_FILE_NAME: &str = "app.log";
const DEFAULT_LOG_LEVEL: &str = "info";

pub fn initialize(logs_dir: &Path) -> Result<WorkerGuard, String> {
    let file_appender = tracing_appender::rolling::daily(logs_dir, LOG_FILE_NAME);
    let (non_blocking_writer, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_LEVEL));

    let file_layer = fmt::layer()
        .with_writer(non_blocking_writer)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .json()
        .flatten_event(true)
        .with_current_span(false)
        .with_span_list(false);

    let stdout_layer = fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(true)
        .with_target(true)
        .with_thread_ids(false);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(stdout_layer)
        .init();

    Ok(guard)
}
