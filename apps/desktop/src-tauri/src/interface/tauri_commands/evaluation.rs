use std::sync::Arc;

use tauri::{State, Window};

use crate::application::evaluation::{self, EncodedRequestInput, EvaluationOperation};
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

fn execute(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
    operation: EvaluationOperation,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    evaluation::forward(input, &token, operation)
}

macro_rules! evaluation_command {
    ($name:ident, $operation:expr) => {
        #[tauri::command]
        pub fn $name(
            input: EncodedRequestInput,
            state: State<'_, Arc<AppState>>,
            window: Window,
        ) -> AppResult<Vec<u8>> {
            execute(input, state, window, $operation)
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
