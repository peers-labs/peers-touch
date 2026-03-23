use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{StubPayload, TimelineActionInput, TimelineListInput};
use super::domain_timeline::{self, TimelineError};

pub fn timeline_list(input: TimelineListInput) -> AppResult<StubPayload> {
    match domain_timeline::list(input.cursor.as_deref(), input.limit) {
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
    match domain_timeline::like(&input.post_id) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            "timeline like rolled back",
            Some(serde_json::json!({
                "command": "timeline_like",
                "postId": outcome.post_id,
                "rolledBack": true
            })),
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
    match domain_timeline::comment(&input.post_id, &content) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            "timeline comment rolled back",
            Some(serde_json::json!({
                "command": "timeline_comment",
                "postId": outcome.post_id,
                "rolledBack": true
            })),
        ),
        Ok(outcome) => AppResult::success(StubPayload {
            command: "timeline_comment".to_string(),
            status: format!("{} comments:{}", outcome.state, outcome.comment_count),
        }),
        Err(error) => map_error("timeline_comment", error),
    }
}

pub fn timeline_repost(input: TimelineActionInput) -> AppResult<StubPayload> {
    match domain_timeline::repost(&input.post_id, input.content.as_deref()) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            "timeline repost rolled back",
            Some(serde_json::json!({
                "command": "timeline_repost",
                "postId": outcome.post_id,
                "rolledBack": true
            })),
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
        TimelineError::InvalidArgument(message) => AppResult::fail(
            ErrorCode::InvalidArgument,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
        TimelineError::NotFound(message) => AppResult::fail(
            ErrorCode::NotFound,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
        TimelineError::Conflict(message) => AppResult::fail(
            ErrorCode::Conflict,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
        TimelineError::Internal(message) => AppResult::fail(
            ErrorCode::InternalError,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
    }
}
