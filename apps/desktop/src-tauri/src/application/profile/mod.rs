// Profile application service — Station-backed + local fallbacks.
//
// 2026-04-09: Rewritten to support Station OSS upload, expanded profile fields,
//             and dual-path (Station API + local store) architecture.

use crate::domain::profile::{ProfileError, UploadKind};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::{profile_store, station_client};
use crate::contracts::{
    FileUploadInput, ProfilePrivacyInput, ProfileUpdateInput, StubPayload,
};
use crate::state::AppState;
use reqwest::Method;
use serde_json::{json, Value};

// ── Station-backed profile operations ──

pub fn profile_get(state: &AppState) -> AppResult<StubPayload> {
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };
    match station_client::request_json(Method::GET, "/actor/profile", &token, None, None) {
        Ok(value) => success_with_data("profile_get", unwrap_profile_data(value)),
        Err(e) => AppResult::fail(ErrorCode::InternalError, "error.profile.fetchFailed", None),
    }
}

pub fn profile_update(state: &AppState, input: ProfileUpdateInput) -> AppResult<StubPayload> {
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = json!({
        "display_name": input.display_name,
        "note": input.note,
        "avatar": input.avatar,
        "header": input.header,
        "region": input.region,
        "timezone": input.timezone,
        "tags": input.tags,
        "links": input.links,
    });
    match station_client::request_json(Method::POST, "/actor/profile", &token, None, Some(body)) {
        Ok(_) => match station_client::request_json(Method::GET, "/actor/profile", &token, None, None) {
            Ok(value) => success_with_data("profile_update", unwrap_profile_data(value)),
            Err(e) => AppResult::fail(ErrorCode::InternalError, "error.profile.fetchFailed", None),
        },
        Err(e) => AppResult::fail(ErrorCode::InternalError, "error.profile.updateFailed", None),
    }
}

// ── Station OSS upload ──

pub fn profile_upload_avatar_oss(state: &AppState, input: FileUploadInput) -> AppResult<StubPayload> {
    upload_and_set_profile_image(state, &input.file_path, "avatar")
}

pub fn profile_upload_header_oss(state: &AppState, input: FileUploadInput) -> AppResult<StubPayload> {
    upload_and_set_profile_image(state, &input.file_path, "header")
}

fn upload_and_set_profile_image(state: &AppState, file_path: &str, field: &str) -> AppResult<StubPayload> {
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    // Step 1: Upload to OSS
    let oss_resp = match station_client::upload_multipart("/sub-oss/upload", &token, file_path) {
        Ok(v) => v,
        Err(e) => return AppResult::fail(ErrorCode::InternalError, "error.profile.uploadFailed", None),
    };

    let url = oss_resp.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if url.is_empty() {
        return AppResult::fail(ErrorCode::InternalError, "error.profile.ossEmptyUrl", None);
    }

    // Resolve relative OSS URL to absolute for local identity sync
    let absolute_url = if url.starts_with('/') {
        format!("{}{}", station_client::station_base_url(), url)
    } else {
        url.clone()
    };

    // Step 2: Update profile with the relative URL (Station stores relative paths)
    let body = match field {
        "avatar" => json!({ "avatar": url }),
        "header" => json!({ "header": url }),
        _ => return AppResult::fail(ErrorCode::InvalidArgument, "error.profile.invalidField", None),
    };

    match station_client::request_json(Method::POST, "/actor/profile", &token, None, Some(body)) {
        Ok(_) => {
            // Sync avatar to local auth identity with absolute URL so sidebar renders correctly
            if field == "avatar" {
                let _ = crate::infrastructure::auth_identity::update_active_avatar(&absolute_url);
            }
            match station_client::request_json(Method::GET, "/actor/profile", &token, None, None) {
                Ok(value) => success_with_data(&format!("profile_upload_{}_oss", field), unwrap_profile_data(value)),
                Err(e) => AppResult::fail(ErrorCode::InternalError, "error.profile.fetchFailed", None),
            }
        },
        Err(e) => AppResult::fail(ErrorCode::InternalError, "error.profile.updateFailed", None),
    }
}

// ── Local profile fallbacks (kept for backward compat) ──

pub fn profile_upload_avatar(input: FileUploadInput) -> AppResult<StubPayload> {
    map_upload("profile_upload_avatar", UploadKind::Avatar, input)
}

pub fn profile_upload_header(input: FileUploadInput) -> AppResult<StubPayload> {
    map_upload("profile_upload_header", UploadKind::Header, input)
}

pub fn profile_update_privacy(input: ProfilePrivacyInput) -> AppResult<StubPayload> {
    match profile_store::update_privacy(input.visibility, input.allow_direct_message) {
        Ok(snapshot) => AppResult::success(StubPayload {
            command: "profile_update_privacy".to_string(),
            status: format!("privacy:{} dm:{}", snapshot.visibility, snapshot.allow_direct_message),
        }),
        Err(error) => map_error("profile_update_privacy", error),
    }
}

fn map_upload(command: &str, kind: UploadKind, input: FileUploadInput) -> AppResult<StubPayload> {
    match profile_store::upload(kind, &input.file_path) {
        Ok(outcome) if outcome.rolled_back => AppResult::fail(
            ErrorCode::Conflict,
            "error.profile.uploadRolledBack",
            Some(json!({ "command": command, "field": outcome.field, "rolledBack": true })),
        ),
        Ok(outcome) => {
            if outcome.field == "avatar" {
                let _ = crate::infrastructure::auth_identity::update_active_avatar(&outcome.value);
            }
            AppResult::success(StubPayload {
                command: command.to_string(),
                status: format!("{}:{}", outcome.field, outcome.value),
            })
        }
        Err(error) => map_error(command, error),
    }
}

// ── Helpers ──

fn token_from_state(state: &AppState) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(ErrorCode::InternalError, "error.auth.sessionLockFailed", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(ErrorCode::Unauthorized, "error.auth.authenticationRequired", None));
    }
    Ok(token)
}

fn unwrap_profile_data(value: Value) -> Value {
    let mut data = value.get("data").cloned().unwrap_or(Value::Null);
    resolve_profile_urls(&mut data);
    data
}

/// Resolve relative avatar/header URLs (e.g. `/sub-oss/file?key=...`) to absolute URLs
/// by prepending the Station base URL. This ensures the frontend can render images directly.
fn resolve_profile_urls(data: &mut Value) {
    let base = station_client::station_base_url();
    for field in &["avatar", "header"] {
        if let Some(val) = data.get_mut(*field) {
            if let Some(s) = val.as_str() {
                if !s.is_empty() && s.starts_with('/') {
                    *val = Value::String(format!("{}{}", base, s));
                }
            }
        }
    }
}

fn success_with_data(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn map_error(command: &str, error: ProfileError) -> AppResult<StubPayload> {
    match error {
        ProfileError::InvalidArgument(msg) => AppResult::fail(ErrorCode::InvalidArgument, "error.profile.invalidArgument", Some(json!({ "command": command, "detail": msg }))),
        ProfileError::Conflict(msg) => AppResult::fail(ErrorCode::Conflict, "error.profile.conflict", Some(json!({ "command": command, "detail": msg }))),
        ProfileError::Internal(msg) => AppResult::fail(ErrorCode::InternalError, "error.profile.internal", Some(json!({ "command": command, "detail": msg }))),
    }
}
