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
use crate::model::actor::{ActorProfile, UpdateProfileRequest, UserLink};
use crate::state::AppState;
use reqwest::Method;
use serde_json::{json, Value};

fn map_station_error(command: &str, verb: &str, err: station_client::StationClientError) -> AppResult<StubPayload> {
    err.into_app_result(format!("{} failed to {}", command, verb))
}

// ── Station-backed profile operations ──
//
// `/actor/profile` uses Touch `SuccessResponse` with protobuf `ActorProfile` in `PeersResponse.data`.

pub fn profile_get(state: &AppState) -> AppResult<StubPayload> {
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };
    match station_client::request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        &token,
        None,
    ) {
        Ok(p) => success_with_data("profile_get", actor_profile_to_value(&p)),
        Err(e) => {
            tracing::error!(error = %e, "Failed to fetch profile");
            map_station_error("profile_get", "fetch profile", e)
        }
    }
}

pub fn profile_update(state: &AppState, input: ProfileUpdateInput) -> AppResult<StubPayload> {
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let body = profile_input_to_proto(&input);
    match station_client::request_peers_proto_no_payload(
        Method::POST,
        "/actor/profile",
        &token,
        None,
        Some(&body),
    ) {
        Ok(()) => match station_client::request_peers_proto_no_body::<ActorProfile>(
            Method::GET,
            "/actor/profile",
            &token,
            None,
        ) {
            Ok(p) => success_with_data("profile_update", actor_profile_to_value(&p)),
            Err(e) => {
                tracing::error!(error = %e, "Failed to fetch profile after update");
                map_station_error("profile_update", "fetch profile", e)
            }
        },
        Err(e) => {
            tracing::error!(error = %e, "Failed to update profile");
            map_station_error("profile_update", "update profile", e)
        }
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
    tracing::info!(file_path = %file_path, field = %field, "Starting profile image upload");
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(field = %field, "Profile image upload aborted: no valid session token");
            return e;
        }
    };

    // Step 1: Upload to OSS
    tracing::info!(file_path = %file_path, "Uploading image to OSS");
    let oss_resp = match station_client::upload_multipart("/sub-oss/upload", &token, file_path) {
        Ok(v) => {
            tracing::info!("OSS upload succeeded");
            v
        }
        Err(e) => {
            tracing::error!(error = %e, file_path = %file_path, "Failed to upload profile image to storage");
            return e.into_app_result("Failed to upload profile image");
        }
    };

    let url = oss_resp.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if url.is_empty() {
        tracing::error!(oss_response = ?oss_resp, "OSS returned empty URL");
        return AppResult::fail(
            ErrorCode::InternalError,
            "Upload succeeded but the storage service returned an empty URL",
            None,
        );
    }
    tracing::info!(url = %url, field = %field, "OSS URL obtained, updating profile");

    // Resolve relative OSS URL to absolute for local identity sync
    let absolute_url = if url.starts_with('/') {
        format!("{}{}", station_client::station_base_url(), url)
    } else {
        url.clone()
    };

    // Step 2: Update profile with the relative URL (Station stores relative paths)
    let mut body = UpdateProfileRequest::default();
    match field {
        "avatar" => body.avatar = Some(url.clone()),
        "header" => body.header = Some(url.clone()),
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "Invalid profile image field (expected avatar or header)",
                None,
            )
        }
    };

    match station_client::request_peers_proto_no_payload(
        Method::POST,
        "/actor/profile",
        &token,
        None,
        Some(&body),
    ) {
        Ok(()) => {
            // Sync avatar to local auth identity and download to local cache.
            if field == "avatar" {
                let _ = sync_avatar_with_download(&absolute_url);
            }
            match station_client::request_peers_proto_no_body::<ActorProfile>(
                Method::GET,
                "/actor/profile",
                &token,
                None,
            ) {
                Ok(p) => success_with_data(
                    &format!("profile_upload_{}_oss", field),
                    actor_profile_to_value(&p),
                ),
                Err(e) => {
                    tracing::error!(error = %e, "Failed to fetch profile after image upload");
                    map_station_error("profile_upload_image_oss", "fetch profile", e)
                }
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to update profile after image upload");
            map_station_error("profile_upload_image_oss", "update profile", e)
        }
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
            format!(
                "Profile upload was rolled back (field: {}, command: {})",
                outcome.field, command
            ),
            None,
        ),
        Ok(outcome) => {
            if outcome.field == "avatar" {
                let _ = sync_avatar_with_download(&outcome.value);
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
    let guard = state.session.lock().map_err(|e| {
        tracing::error!(error = %e, "Failed to access session state");
        AppResult::fail(ErrorCode::InternalError, "Failed to access session state", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Authentication required — please log in",
            None,
        ));
    }
    Ok(token)
}

fn actor_profile_to_value(p: &ActorProfile) -> Value {
    let links: Vec<Value> = p
        .links
        .iter()
        .map(|l| json!({ "label": l.label, "url": l.url }))
        .collect();
    let mut data = json!({
        "id": p.id,
        "username": p.username,
        "display_name": p.display_name,
        "note": p.note,
        "avatar": p.avatar,
        "header": p.header,
        "region": p.region,
        "timezone": p.timezone,
        "tags": p.tags,
        "links": links,
        "url": p.url,
        "acct": p.acct,
        "locked": p.locked,
        "created_at": p.created_at,
        "followers_count": p.followers_count,
        "following_count": p.following_count,
        "statuses_count": p.statuses_count,
        "default_visibility": p.default_visibility,
        "manually_approves_followers": p.manually_approves_followers,
        "message_permission": p.message_permission,
        "auto_expire_days": p.auto_expire_days,
    });
    resolve_profile_urls(&mut data);
    data
}

fn profile_input_to_proto(input: &ProfileUpdateInput) -> UpdateProfileRequest {
    let mut r = UpdateProfileRequest::default();
    if let Some(s) = input.display_name.clone() {
        r.display_name = Some(s);
    }
    if let Some(s) = input.note.clone() {
        r.note = Some(s);
    }
    if let Some(s) = input.avatar.clone() {
        r.avatar = Some(s);
    }
    if let Some(s) = input.header.clone() {
        r.header = Some(s);
    }
    if let Some(s) = input.region.clone() {
        r.region = Some(s);
    }
    if let Some(s) = input.timezone.clone() {
        r.timezone = Some(s);
    }
    if let Some(tags) = input.tags.clone() {
        r.tags = tags;
    }
    if let Some(links) = input.links.as_ref() {
        r.links = links
            .iter()
            .map(|l| UserLink {
                label: l.label.clone(),
                url: l.url.clone(),
            })
            .collect();
    }
    r
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
        ProfileError::InvalidArgument(msg) => {
            tracing::error!(command = %command, error = %msg, "Invalid profile argument");
            AppResult::fail(ErrorCode::InvalidArgument, format!("Invalid argument: {}", msg), None)
        }
        ProfileError::Conflict(msg) => {
            tracing::error!(command = %command, error = %msg, "Profile conflict");
            AppResult::fail(ErrorCode::Conflict, format!("Conflict: {}", msg), None)
        }
        ProfileError::Internal(msg) => {
            tracing::error!(command = %command, error = %msg, "Profile internal error");
            AppResult::fail(ErrorCode::InternalError, format!("Internal error: {}", msg), None)
        }
    }
}

// ── Aggregated local user profile sync ──
//
// 2026-04-21: Fetches profile from Station and syncs all user data
// (metadata + avatar file) to local storage in a single operation.

/// Fetch the active user's profile from Station, sync metadata and avatar to local storage.
/// Returns a JSON payload with the synced profile including `avatar_local_path`.
pub fn sync_user_profile(state: &AppState) -> AppResult<StubPayload> {
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    // Fetch full profile from Station.
    let profile = match station_client::request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        &token,
        None,
    ) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "sync_user_profile: failed to fetch profile from Station");
            return map_station_error("sync_user_profile", "fetch profile", e);
        }
    };

    // Resolve avatar URL to absolute.
    let avatar_url = if !profile.avatar.is_empty() && profile.avatar.starts_with('/') {
        format!("{}{}", station_client::station_base_url(), profile.avatar)
    } else {
        profile.avatar.clone()
    };

    // Use the persisted active_account_id from identities.json — it matches regardless
    // of login method (OAuth: "github:123", password: "password:abc").
    let account_id = crate::infrastructure::auth_identity::read_state()
        .ok()
        .and_then(|s| s.active_account_id)
        .unwrap_or_default();

    if account_id.is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "No active session to sync profile for",
            None,
        );
    }

    // Sync all profile data + download avatar to local cache.
    let avatar_local = crate::infrastructure::auth_identity::sync_profile_locally(
        &account_id,
        Some(&profile.display_name),
        None, // email is not in ActorProfile
        if avatar_url.is_empty() { None } else { Some(&avatar_url) },
        if profile.url.is_empty() { None } else { Some(&profile.url) },
    );

    let local_path = match avatar_local {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "sync_user_profile: local sync partially failed");
            None
        }
    };

    // Build response including local avatar path for the frontend.
    let data = json!({
        "name": profile.display_name,
        "email": "", // ActorProfile doesn't carry email
        "avatar_url": avatar_url,
        "avatar_local_path": local_path,
        "profile_url": profile.url,
        "synced": true,
    });

    AppResult::success(StubPayload {
        command: "sync_user_profile".to_string(),
        status: data.to_string(),
    })
}

/// Sync avatar for the active account: update remote URL and download to local cache.
/// Enhanced version of the old `account_sync_avatar` that also caches the file locally.
pub fn sync_avatar_with_download(avatar_url: &str) -> Result<Option<String>, String> {
    // Update remote URL in identities.json.
    crate::infrastructure::auth_identity::update_active_avatar(avatar_url)?;

    // Download to local cache.
    if avatar_url.is_empty() {
        return Ok(None);
    }
    match crate::infrastructure::auth_identity::download_avatar(avatar_url) {
        Ok(path) => {
            let path_str = path.to_string_lossy().to_string();
            crate::infrastructure::auth_identity::update_active_avatar_local_path(&path_str)?;
            Ok(Some(path_str))
        }
        Err(e) => {
            tracing::warn!(error = %e, "Avatar download failed, remote URL still saved");
            Ok(None)
        }
    }
}
