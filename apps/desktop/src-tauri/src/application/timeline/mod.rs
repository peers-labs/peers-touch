use crate::domain::timeline::TimelineError;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::timeline_store;
use crate::contracts::{StubPayload, TimelineActionInput, TimelineListInput};

pub fn timeline_list(input: TimelineListInput) -> AppResult<StubPayload> {
    match timeline_store::list(input.cursor.as_deref(), input.limit) {
        Ok(outcome) => AppResult::success(StubPayload {
            command: "timeline_list".to_string(),
            status: format!(
                "fetched:{} next_cursor:{} ids:{}",
                outcome.fetched,
                outcome.next_cursor.unwrap_or_else(|| "none".to_string()),
                outcome.post_ids.join(",")
            ),
        }),
        Err(error) => map_error("timeline_list", error),
    }
}

pub fn timeline_like(input: TimelineActionInput) -> AppResult<StubPayload> {
    match timeline_store::like(&input.post_id) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            format!(
                "Timeline like was rolled back for post {} (command: timeline_like)",
                outcome.post_id
            ),
            None,
        ),
        Ok(outcome) => AppResult::success(StubPayload {
            command: "timeline_like".to_string(),
            status: format!("{} likes:{}", outcome.state, outcome.like_count),
        }),
        Err(error) => map_error("timeline_like", error),
    }
}

pub fn timeline_comment(input: TimelineActionInput) -> AppResult<StubPayload> {
    let content = input.content.unwrap_or_default();
    match timeline_store::comment(&input.post_id, &content) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            format!(
                "Timeline comment was rolled back for post {} (command: timeline_comment)",
                outcome.post_id
            ),
            None,
        ),
        Ok(outcome) => AppResult::success(StubPayload {
            command: "timeline_comment".to_string(),
            status: format!("{} comments:{}", outcome.state, outcome.comment_count),
        }),
        Err(error) => map_error("timeline_comment", error),
    }
}

pub fn timeline_repost(input: TimelineActionInput) -> AppResult<StubPayload> {
    match timeline_store::repost(&input.post_id, input.content.as_deref()) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            format!(
                "Timeline repost was rolled back for post {} (command: timeline_repost)",
                outcome.post_id
            ),
            None,
        ),
        Ok(outcome) => AppResult::success(StubPayload {
            command: "timeline_repost".to_string(),
            status: format!("{} reposts:{}", outcome.state, outcome.repost_count),
        }),
        Err(error) => map_error("timeline_repost", error),
    }
}

fn map_error(command: &str, error: TimelineError) -> AppResult<StubPayload> {
    match error {
        TimelineError::InvalidArgument(message) => {
            tracing::error!(command = %command, error = %message, "Timeline invalid argument");
            AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid argument: {} (command: {})", message, command),
                None,
            )
        }
        TimelineError::NotFound(message) => {
            tracing::error!(command = %command, error = %message, "Timeline item not found");
            AppResult::fail(
                ErrorCode::NotFound,
                format!("Not found: {} (command: {})", message, command),
                None,
            )
        }
        TimelineError::Conflict(message) => {
            tracing::error!(command = %command, error = %message, "Timeline conflict");
            AppResult::fail(
                ErrorCode::Conflict,
                format!("Conflict: {} (command: {})", message, command),
                None,
            )
        }
        TimelineError::Internal(message) => {
            tracing::error!(command = %command, error = %message, "Timeline internal error");
            AppResult::fail(
                ErrorCode::InternalError,
                format!("Internal error: {} (command: {})", message, command),
                None,
            )
        }
    }
}
