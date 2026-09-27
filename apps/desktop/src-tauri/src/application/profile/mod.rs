// Profile application service — Station-backed + local fallbacks.
//
// 2026-04-09: Rewritten to support Station OSS upload, expanded profile fields,
//             and dual-path (Station API + local store) architecture.

use crate::contracts::{
    AccountSyncAvatarInput, FileUploadInput, ProfilePrivacyInput, ProfileUpdateInput, StubPayload,
};
use crate::domain::profile::{ProfileError, UploadKind};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client::{StationClientError, StationClientErrorKind};
use crate::infrastructure::{avatar_cache, profile_store, station_client};
use crate::model::actor::{
    ActorProfile, ActorVisibility, ProfileUpdateOutcome, UpdateProfileRequest,
    UpdateProfileResponse, UserLink,
};
use reqwest::Method;
use serde_json::{json, Value};

fn map_station_error(
    command: &str,
    verb: &str,
    err: station_client::StationClientError,
) -> AppResult<StubPayload> {
    err.into_app_result(format!("{} failed to {}", command, verb))
}

// ── Station-backed profile operations ──
//
// `/actor/profile` uses Touch `SuccessResponse` with protobuf `ActorProfile` in `PeersResponse.data`.

pub fn profile_get(token: &str) -> AppResult<StubPayload> {
    match station_client::request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        token,
        None,
    ) {
        Ok(p) => success_with_data("profile_get", actor_profile_to_value(&p)),
        Err(e) => {
            tracing::error!(error = %e, "Failed to fetch profile");
            map_station_error("profile_get", "fetch profile", e)
        }
    }
}

/// Fetch a peer actor's public profile by numeric actor id (a.k.a. DID in the
/// chat layer). Mirrors `profile_get` but targets `/actor/actors/:id/profile`.
/// Token is required because the Station endpoint is JWT-protected to keep
/// peer-directory access bound to a logged-in actor.
pub fn peer_profile_get(token: &str, peer_ptid: &str) -> AppResult<StubPayload> {
    let trimmed = peer_ptid.trim();
    if trimmed.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "peer_profile_get: did is required",
            None,
        );
    }
    let path = format!("/actor/actors/{}/profile", trimmed);
    match station_client::request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        &path,
        token,
        None,
    ) {
        Ok(p) => success_with_data("peer_profile_get", actor_profile_to_value(&p)),
        Err(e) => {
            tracing::warn!(error = %e, peer_ptid = %trimmed, "Failed to fetch peer profile");
            map_station_error("peer_profile_get", "fetch peer profile", e)
        }
    }
}

pub fn profile_update(input: ProfileUpdateInput, token: &str) -> AppResult<StubPayload> {
    if input.observed_revision == 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "profile_update: observed_revision is required",
            None,
        );
    }
    let body = profile_input_to_proto(&input);
    match execute_profile_update(&input, &body, token) {
        Ok(response) => profile_update_success("profile_update", response),
        Err(e) => {
            tracing::error!(error = %e, "Failed to update profile");
            map_station_error("profile_update", "update profile", e)
        }
    }
}

// ── Station OSS upload ──

pub fn profile_upload_avatar_oss(input: FileUploadInput, token: &str) -> AppResult<StubPayload> {
    upload_and_set_profile_image(token, &input.file_path, "avatar")
}

pub fn profile_upload_header_oss(input: FileUploadInput, token: &str) -> AppResult<StubPayload> {
    upload_and_set_profile_image(token, &input.file_path, "header")
}

fn upload_and_set_profile_image(
    token: &str,
    file_path: &str,
    field: &str,
) -> AppResult<StubPayload> {
    tracing::info!(file_path = %file_path, field = %field, "Starting profile image upload");

    let current_profile = match station_client::request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        token,
        None,
    ) {
        Ok(profile) if profile.profile_revision > 0 => profile,
        Ok(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Profile snapshot is missing its revision",
                None,
            )
        }
        Err(error) => {
            return map_station_error("profile_upload_image_oss", "fetch profile revision", error)
        }
    };

    // Step 1: Upload to OSS
    tracing::info!(file_path = %file_path, "Uploading image to OSS");
    let oss_resp = match station_client::upload_multipart(
        "/sub-oss/upload",
        token,
        file_path,
        "avatar",
        "public",
        None,
    ) {
        Ok(v) => {
            tracing::info!("OSS upload succeeded");
            v
        }
        Err(e) => {
            tracing::error!(error = %e, file_path = %file_path, "Failed to upload profile image to storage");
            return e.into_app_result("Failed to upload profile image");
        }
    };

    let url = oss_resp
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
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
    let mut input = ProfileUpdateInput {
        display_name: None,
        note: None,
        avatar: None,
        header: None,
        region: None,
        timezone: None,
        tags: None,
        links: None,
        discoverability: None,
        observed_revision: current_profile.profile_revision,
    };
    match field {
        "avatar" => input.avatar = Some(url.clone()),
        "header" => input.header = Some(url.clone()),
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "Invalid profile image field (expected avatar or header)",
                None,
            )
        }
    };
    let body = profile_input_to_proto(&input);

    match execute_profile_update(&input, &body, token) {
        Ok(response) => {
            let outcome = ProfileUpdateOutcome::try_from(response.outcome)
                .unwrap_or(ProfileUpdateOutcome::Unspecified);
            // Sync avatar to local auth identity and download to local cache.
            if field == "avatar"
                && matches!(
                    outcome,
                    ProfileUpdateOutcome::Applied | ProfileUpdateOutcome::Unchanged
                )
            {
                let _ = sync_avatar_with_download(token, &absolute_url);
            }
            profile_update_success(&format!("profile_upload_{}_oss", field), response)
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to update profile after image upload");
            map_station_error("profile_upload_image_oss", "update profile", e)
        }
    }
}

// ── Local profile fallbacks (kept for backward compat) ──

pub fn profile_upload_avatar(
    actor_ptid: &str,
    input: FileUploadInput,
    token: &str,
) -> AppResult<StubPayload> {
    map_upload(
        "profile_upload_avatar",
        UploadKind::Avatar,
        input,
        token,
        actor_ptid,
    )
}

pub fn profile_upload_header(
    actor_ptid: &str,
    input: FileUploadInput,
    token: &str,
) -> AppResult<StubPayload> {
    map_upload(
        "profile_upload_header",
        UploadKind::Header,
        input,
        token,
        actor_ptid,
    )
}

pub fn profile_update_privacy(
    actor_ptid: &str,
    _token: &str,
    input: ProfilePrivacyInput,
) -> AppResult<StubPayload> {
    match profile_store::update_privacy(actor_ptid, input.visibility, input.allow_direct_message) {
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

fn map_upload(
    command: &str,
    kind: UploadKind,
    input: FileUploadInput,
    token: &str,
    actor_ptid: &str,
) -> AppResult<StubPayload> {
    match profile_store::upload(actor_ptid, kind, &input.file_path) {
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
                let _ = sync_avatar_with_download(token, &outcome.value);
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
        "profile_revision": p.profile_revision,
        "federated_handle": p.federated_handle,
        "home_station_peer_id": p.home_station_peer_id,
        "home_station_domain": p.home_station_domain,
        "discoverability": discoverability_label(p.discoverability),
    });
    resolve_profile_urls(&mut data);
    data
}

fn canonical_profile_ptid(profile: &ActorProfile) -> Option<&str> {
    if profile.id.starts_with("ptid:") {
        return Some(profile.id.as_str());
    }
    profile
        .peers_touch
        .as_ref()
        .map(|info| info.network_id.as_str())
        .filter(|ptid| ptid.starts_with("ptid:"))
}

fn profile_matches_actor(profile: &ActorProfile, actor_ptid: &str) -> bool {
    profile.id == actor_ptid || canonical_profile_ptid(profile) == Some(actor_ptid)
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
    if let Some(value) = input.discoverability.as_deref() {
        r.discoverability = Some(discoverability_value(value));
    }
    r.observed_revision = input.observed_revision;
    r
}

fn execute_profile_update(
    input: &ProfileUpdateInput,
    body: &UpdateProfileRequest,
    token: &str,
) -> Result<UpdateProfileResponse, StationClientError> {
    match station_client::request_peers_proto::<UpdateProfileRequest, UpdateProfileResponse>(
        Method::POST,
        "/actor/profile",
        token,
        None,
        Some(body),
    ) {
        Ok(response) if valid_profile_update_response(&response) => Ok(response),
        Ok(_) => reconcile_profile_update(input, token).ok_or_else(|| {
            StationClientError::new(
                StationClientErrorKind::InvalidResponse,
                "Station returned an invalid profile update response",
                None,
            )
        }),
        Err(error) if ambiguous_profile_update_error(&error) => {
            reconcile_profile_update(input, token).ok_or(error)
        }
        Err(error) => Err(error),
    }
}

fn valid_profile_update_response(response: &UpdateProfileResponse) -> bool {
    response
        .profile
        .as_ref()
        .is_some_and(|profile| profile.profile_revision > 0)
        && !matches!(
            ProfileUpdateOutcome::try_from(response.outcome),
            Ok(ProfileUpdateOutcome::Unspecified) | Err(_)
        )
}

fn reconcile_profile_update(
    input: &ProfileUpdateInput,
    token: &str,
) -> Option<UpdateProfileResponse> {
    let profile = station_client::request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        token,
        None,
    )
    .ok()?;
    let outcome = if profile_matches_input(&profile, input) {
        if profile.profile_revision == input.observed_revision {
            ProfileUpdateOutcome::Unchanged
        } else if profile.profile_revision > input.observed_revision {
            ProfileUpdateOutcome::Applied
        } else {
            return None;
        }
    } else if profile.profile_revision > input.observed_revision {
        ProfileUpdateOutcome::Conflict
    } else {
        return None;
    };
    Some(UpdateProfileResponse {
        outcome: outcome as i32,
        profile: Some(profile),
    })
}

fn ambiguous_profile_update_error(error: &StationClientError) -> bool {
    matches!(
        error.kind,
        StationClientErrorKind::Network
            | StationClientErrorKind::Decode
            | StationClientErrorKind::InvalidResponse
    )
}

fn profile_matches_input(profile: &ActorProfile, input: &ProfileUpdateInput) -> bool {
    input
        .display_name
        .as_ref()
        .is_none_or(|value| value == &profile.display_name)
        && input
            .note
            .as_ref()
            .is_none_or(|value| value == &profile.note)
        && input
            .avatar
            .as_ref()
            .is_none_or(|value| value == &profile.avatar)
        && input
            .header
            .as_ref()
            .is_none_or(|value| value == &profile.header)
        && input
            .region
            .as_ref()
            .is_none_or(|value| value == &profile.region)
        && input
            .timezone
            .as_ref()
            .is_none_or(|value| value == &profile.timezone)
        && input
            .tags
            .as_ref()
            .is_none_or(|value| value == &profile.tags)
        && input.links.as_ref().is_none_or(|links| {
            links.len() == profile.links.len()
                && links
                    .iter()
                    .zip(&profile.links)
                    .all(|(left, right)| left.label == right.label && left.url == right.url)
        })
        && input
            .discoverability
            .as_deref()
            .is_none_or(|value| discoverability_value(value) == profile.discoverability)
}

fn discoverability_value(value: &str) -> i32 {
    match value.trim().to_ascii_lowercase().as_str() {
        "hidden" => ActorVisibility::Hidden as i32,
        "by_handle" => ActorVisibility::ByHandle as i32,
        "indexed" => ActorVisibility::Indexed as i32,
        _ => ActorVisibility::Unspecified as i32,
    }
}

fn discoverability_label(value: i32) -> &'static str {
    match ActorVisibility::try_from(value).unwrap_or(ActorVisibility::Unspecified) {
        ActorVisibility::Hidden => "hidden",
        ActorVisibility::ByHandle => "by_handle",
        ActorVisibility::Indexed => "indexed",
        ActorVisibility::Unspecified => "hidden",
    }
}

fn profile_update_success(
    command: &str,
    response: UpdateProfileResponse,
) -> AppResult<StubPayload> {
    let outcome = ProfileUpdateOutcome::try_from(response.outcome)
        .unwrap_or(ProfileUpdateOutcome::Unspecified);
    let Some(profile) = response.profile else {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("{command}: Station response omitted profile"),
            None,
        );
    };
    if matches!(outcome, ProfileUpdateOutcome::Unspecified) || profile.profile_revision == 0 {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("{command}: Station returned an invalid profile outcome"),
            None,
        );
    }
    success_with_data(
        command,
        json!({
            "outcome": outcome.as_str_name(),
            "profile": actor_profile_to_value(&profile),
        }),
    )
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
            AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid argument: {}", msg),
                None,
            )
        }
        ProfileError::Conflict(msg) => {
            tracing::error!(command = %command, error = %msg, "Profile conflict");
            AppResult::fail(ErrorCode::Conflict, format!("Conflict: {}", msg), None)
        }
        ProfileError::Internal(msg) => {
            tracing::error!(command = %command, error = %msg, "Profile internal error");
            AppResult::fail(
                ErrorCode::InternalError,
                format!("Internal error: {}", msg),
                None,
            )
        }
    }
}

// ── Aggregated local user profile sync ──
//
// 2026-04-21: Fetches profile from Station and syncs all user data
// (metadata + avatar file) to local storage in a single operation.

/// Fetch the user's profile from Station and sync metadata + avatar to local storage.
///
/// `actor_ptid` MUST be the actor whose token is being used for this call. We
/// intentionally do NOT consult `identities.json::active_account_id` to pick
/// the destination record — under multi-window dev (`make dev-dual`) and right
/// after PIN unlock, `active_account_id` may lag behind the per-window session
/// and would cause us to write actor X's profile into actor Y's record (the
/// "both rows show User B" bug).
pub fn sync_user_profile(token: &str, actor_ptid: &str) -> AppResult<StubPayload> {
    if actor_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "sync_user_profile: caller has no bound actor",
            None,
        );
    }

    // Fetch full profile from Station.
    let profile = match station_client::request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        token,
        None,
    ) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "sync_user_profile: failed to fetch profile from Station");
            return map_station_error("sync_user_profile", "fetch profile", e);
        }
    };

    // Cross-check the canonical PTID. Legacy Station profile responses may
    // still carry their storage ID in `profile.id`; `peers_touch.network_id`
    // is the canonical identity in that response shape.
    if !profile_matches_actor(&profile, actor_ptid) {
        tracing::error!(
            caller_actor = %actor_ptid,
            station_storage_actor = %profile.id,
            station_actor = ?canonical_profile_ptid(&profile),
            "sync_user_profile: actor mismatch between caller token and Station response; refusing to write"
        );
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "sync_user_profile: actor mismatch between caller and Station response",
            None,
        );
    }

    // Resolve avatar URL to absolute.
    let avatar_url = if !profile.avatar.is_empty() && profile.avatar.starts_with('/') {
        format!("{}{}", station_client::station_base_url(), profile.avatar)
    } else {
        profile.avatar.clone()
    };

    // Pick the LocalAccount whose `provider_user_id` matches `actor_ptid`. This
    // is the only correct destination — `active_account_id` is a UI/router
    // hint and is not authoritative for token-bound writes.
    let account_id = match crate::infrastructure::auth_identity::find_account_id_by_actor_ptid(
        actor_ptid,
    ) {
        Some(id) => id,
        None => {
            tracing::error!(
                actor_ptid = %actor_ptid,
                "sync_user_profile: no LocalAccount matches caller actor_ptid; refusing to write"
            );
            return AppResult::fail(
                ErrorCode::NotFound,
                "sync_user_profile: caller actor has no local account record",
                None,
            );
        }
    };

    // Sync all profile data + download avatar to local cache.
    let avatar_local = crate::infrastructure::auth_identity::sync_profile_locally(
        &account_id,
        Some(&profile.display_name),
        None, // email is not in ActorProfile
        if avatar_url.is_empty() {
            None
        } else {
            Some(&avatar_url)
        },
        if profile.url.is_empty() {
            None
        } else {
            Some(&profile.url)
        },
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

/// Sync avatar for the active account: update remote URL and warm the local cache.
/// Returns the cached file path when the download succeeds, `None` otherwise.
/// `token` is reserved for future Station-authenticated download paths; callers pass the session access token.
pub fn sync_avatar_with_download(_token: &str, avatar_url: &str) -> Result<Option<String>, String> {
    crate::infrastructure::auth_identity::update_active_avatar(avatar_url)?;

    let local_path = avatar_cache::try_ensure_local_string(avatar_url);
    if let Some(ref path) = local_path {
        crate::infrastructure::auth_identity::update_active_avatar_local_path(path)?;
    }
    Ok(local_path)
}

/// Resolve the local cache path for any avatar URL. The single backend entry
/// point used by the `UserSquareAvatar` component to honor the project rule
/// "always render local images". Downloads on cache miss, returns `None` if
/// the URL is empty or the download cannot complete.
pub fn avatar_resolve_local(remote_url: &str) -> Option<String> {
    avatar_cache::try_ensure_local_string(remote_url)
}

/// Download Station avatar to local cache and link it to the active auth identity.
pub fn account_sync_avatar(input: &AccountSyncAvatarInput, token: &str) -> AppResult<StubPayload> {
    match sync_avatar_with_download(token, &input.avatar_url) {
        Ok(local_path) => {
            let status = match local_path {
                Some(p) => format!("synced_local:{}", p),
                None => "synced_remote_only".to_string(),
            };
            AppResult::success(StubPayload {
                command: "account_sync_avatar".to_string(),
                status,
            })
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to sync avatar");
            AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to sync avatar: {}", e),
                None,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical_profile_ptid, profile_matches_actor};
    use crate::model::actor::{ActorProfile, PeersTouchInfo};

    #[test]
    fn canonical_profile_ptid_accepts_profile_id_when_it_is_a_ptid() {
        let profile = ActorProfile {
            id: "ptid:v1:actor:peers:p:alice:1220abc".to_string(),
            ..ActorProfile::default()
        };

        assert_eq!(
            canonical_profile_ptid(&profile),
            Some("ptid:v1:actor:peers:p:alice:1220abc")
        );
    }

    #[test]
    fn canonical_profile_ptid_uses_network_id_in_legacy_profile_shape() {
        let profile = ActorProfile {
            id: "350519971299721219".to_string(),
            peers_touch: Some(PeersTouchInfo {
                network_id: "ptid:v1:actor:peers:p:alice:1220abc".to_string(),
            }),
            ..ActorProfile::default()
        };

        assert_eq!(
            canonical_profile_ptid(&profile),
            Some("ptid:v1:actor:peers:p:alice:1220abc")
        );
    }

    #[test]
    fn canonical_profile_ptid_rejects_internal_actor_ptid_without_ptid() {
        let profile = ActorProfile {
            id: "350519971299721219".to_string(),
            ..ActorProfile::default()
        };

        assert_eq!(canonical_profile_ptid(&profile), None);
    }

    #[test]
    fn profile_actor_match_accepts_storage_id_or_canonical_ptid() {
        let profile = ActorProfile {
            id: "350519971299721219".to_string(),
            peers_touch: Some(PeersTouchInfo {
                network_id: "ptid:v1:actor:peers:p:alice:1220abc".to_string(),
            }),
            ..ActorProfile::default()
        };

        assert!(profile_matches_actor(&profile, "350519971299721219"));
        assert!(profile_matches_actor(
            &profile,
            "ptid:v1:actor:peers:p:alice:1220abc"
        ));
        assert!(!profile_matches_actor(&profile, "350519971299721220"));
    }
}
