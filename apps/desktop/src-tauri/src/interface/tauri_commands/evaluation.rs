use std::sync::Arc;

use tauri::{Manager, Window};

use crate::application::evaluation::{self, EncodedRequestInput, EvaluationOperation};
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

async fn execute(
    input: EncodedRequestInput,
    app: tauri::AppHandle,
    window: Window,
    operation: EvaluationOperation,
) -> AppResult<Vec<u8>> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let token = session_resolver::token_for_window(&state, &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    run_blocking_evaluation_command(move || evaluation::forward(input, &token, operation)).await
}

async fn run_blocking_evaluation_command(
    operation: impl FnOnce() -> AppResult<Vec<u8>> + Send + 'static,
) -> AppResult<Vec<u8>> {
    match tokio::task::spawn_blocking(operation).await {
        Ok(result) => result,
        Err(error) => {
            tracing::error!(error = %error, "Evaluation command task failed");
            AppResult::fail(
                ErrorCode::InternalError,
                "agent.evaluationCommandFailed",
                Some(serde_json::json!({ "reason": error.to_string() })),
            )
        }
    }
}

macro_rules! evaluation_command {
    ($name:ident, $operation:expr) => {
        #[tauri::command]
        pub async fn $name(
            input: EncodedRequestInput,
            app: tauri::AppHandle,
            window: Window,
        ) -> AppResult<Vec<u8>> {
            execute(input, app, window, $operation).await
        }
    };
}

evaluation_command!(
    agent_evaluation_benchmark_create,
    EvaluationOperation::CreateBenchmark
);
evaluation_command!(
    agent_evaluation_benchmark_update,
    EvaluationOperation::UpdateBenchmark
);
evaluation_command!(
    agent_evaluation_benchmark_delete,
    EvaluationOperation::DeleteBenchmark
);
evaluation_command!(
    agent_evaluation_benchmark_list,
    EvaluationOperation::ListBenchmarks
);
evaluation_command!(
    agent_evaluation_dataset_create,
    EvaluationOperation::CreateDataset
);
evaluation_command!(
    agent_evaluation_dataset_update,
    EvaluationOperation::UpdateDataset
);
evaluation_command!(
    agent_evaluation_dataset_delete,
    EvaluationOperation::DeleteDataset
);
evaluation_command!(
    agent_evaluation_dataset_list,
    EvaluationOperation::ListDatasets
);
evaluation_command!(
    agent_evaluation_case_create,
    EvaluationOperation::CreateTestCase
);
evaluation_command!(
    agent_evaluation_case_update,
    EvaluationOperation::UpdateTestCase
);
evaluation_command!(
    agent_evaluation_case_delete,
    EvaluationOperation::DeleteTestCase
);
evaluation_command!(
    agent_evaluation_case_list,
    EvaluationOperation::ListTestCases
);
evaluation_command!(agent_evaluation_run_create, EvaluationOperation::CreateRun);
evaluation_command!(agent_evaluation_run_start, EvaluationOperation::StartRun);
evaluation_command!(agent_evaluation_run_cancel, EvaluationOperation::CancelRun);
evaluation_command!(agent_evaluation_run_retry, EvaluationOperation::RetryCases);
evaluation_command!(agent_evaluation_run_get, EvaluationOperation::GetRun);
evaluation_command!(agent_evaluation_run_list, EvaluationOperation::ListRuns);
evaluation_command!(
    agent_evaluation_run_events_list,
    EvaluationOperation::ListRunEvents
);
evaluation_command!(agent_evaluation_run_delete, EvaluationOperation::DeleteRun);

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::Duration;

    use crate::error::AppResult;

    use super::run_blocking_evaluation_command;

    #[tokio::test(flavor = "current_thread")]
    async fn evaluation_transport_does_not_block_async_command_runtime() {
        let started = Arc::new(AtomicBool::new(false));
        let release = Arc::new(AtomicBool::new(false));
        let task_started = Arc::clone(&started);
        let task_release = Arc::clone(&release);

        let task = tokio::spawn(run_blocking_evaluation_command(move || {
            task_started.store(true, Ordering::Release);
            while !task_release.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(1));
            }
            AppResult::success(Vec::new())
        }));

        tokio::time::timeout(Duration::from_secs(1), async {
            while !started.load(Ordering::Acquire) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("blocking Evaluation transport should start off the async runtime");

        release.store(true, Ordering::Release);
        let result = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .expect("blocking Evaluation transport should finish")
            .expect("Evaluation transport task should not panic");
        assert!(result.ok);
    }
}
