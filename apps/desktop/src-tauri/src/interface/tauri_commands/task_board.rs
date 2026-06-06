use crate::application::task_board as application_task_board;
use crate::contracts::StubPayload;
use crate::error::AppResult;

#[tauri::command]
pub fn agent_task_reviews_list(
    input: application_task_board::TaskReviewListInput,
) -> AppResult<StubPayload> {
    application_task_board::agent_task_reviews_list(input)
}

#[tauri::command]
pub fn agent_task_review_update(
    input: application_task_board::TaskReviewUpdateInput,
) -> AppResult<StubPayload> {
    application_task_board::agent_task_review_update(input)
}
