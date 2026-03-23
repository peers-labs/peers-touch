use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{FileUploadInput, ProfilePrivacyInput, ProfileUpdateInput, StubPayload};
use super::domain_profile::{self, ProfileError, UploadKind};

pub fn profile_get() -> AppResult<StubPayload> {
    match domain_profile::get() {
        Ok(snapshot) => AppResult::success(StubPayload {
            command: "profile_get".to_string(),
            status: format!(
                "display:{} visibility:{} dm:{}",
                snapshot.display_name, snapshot.visibility, snapshot.allow_direct_message
            ),
        }),
        Err(error) => map_error("profile_get", error),
    }
}

pub fn profile_update(input: ProfileUpdateInput) -> AppResult<StubPayload> {
    match domain_profile::update(input.display_name, input.bio, input.location) {
        Ok(snapshot) => AppResult::success(StubPayload {
            command: "profile_update".to_string(),
            status: format!("updated:{}@{}", snapshot.display_name, snapshot.location),
        }),
        Err(error) => map_error("profile_update", error),
    }
}

pub fn profile_upload_avatar(input: FileUploadInput) -> AppResult<StubPayload> {
    map_upload("profile_upload_avatar", UploadKind::Avatar, input)
}

pub fn profile_upload_header(input: FileUploadInput) -> AppResult<StubPayload> {
    map_upload("profile_upload_header", UploadKind::Header, input)
}

pub fn profile_update_privacy(input: ProfilePrivacyInput) -> AppResult<StubPayload> {
    match domain_profile::update_privacy(input.visibility, input.allow_direct_message) {
        Ok(snapshot) => AppResult::success(StubPayload {
            command: "profile_update_privacy".to_string(),
            status: format!(
                "privacy:{} dm:{}",
                snapshot.visibility, snapshot.allow_direct_message
            ),
        }),
        Err(error) => map_error("profile_update_privacy", error),
    }
}

fn map_upload(command: &str, kind: UploadKind, input: FileUploadInput) -> AppResult<StubPayload> {
    match domain_profile::upload(kind, &input.file_path) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            "profile upload rolled back",
            Some(serde_json::json!({
                "command": command,
                "field": outcome.field,
                "rolledBack": true
            })),
        ),
        Ok(outcome) => AppResult::success(StubPayload {
            command: command.to_string(),
            status: format!("{}:{}", outcome.field, outcome.value),
        }),
        Err(error) => map_error(command, error),
    }
}

fn map_error(command: &str, error: ProfileError) -> AppResult<StubPayload> {
    match error {
        ProfileError::InvalidArgument(message) => AppResult::fail(
            ErrorCode::InvalidArgument,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
        ProfileError::Conflict(message) => AppResult::fail(
            ErrorCode::Conflict,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
        ProfileError::Internal(message) => AppResult::fail(
            ErrorCode::InternalError,
            message,
            Some(serde_json::json!({ "command": command })),
        ),
    }
}
