// Profile application service — Station-backed + local fallbacks.
//
// 2026-04-09: Rewritten to support Station OSS upload, expanded profile fields,
//             and dual-path (Station API + local store) architecture.

use crate::application::station_runtime::client::{
    self as station_client, StationClient, StationClientError, StationClientErrorKind,
    UploadProgressSink,
};
use crate::application::station_runtime::resource::{
    ResourceProjectionError, ResourceReference, StationResourceHandle,
};
use crate::contracts::{
    AccountSyncAvatarInput, FileUploadInput, ProfilePrivacyInput, ProfileUpdateInput, StubPayload,
};
use crate::domain::profile::{ProfileError, UploadKind};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::{avatar_cache, profile_store};
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

pub fn profile_get(resources: &StationResourceHandle, token: &str) -> AppResult<StubPayload> {
    let station_client = resources.client();
    match station_client.request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        token,
        None,
    ) {
        Ok(p) => match actor_profile_to_value(resources, &p) {
            Ok(profile) => success_with_data("profile_get", profile),
            Err(error) => map_resource_error("profile_get", error),
        },
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
pub fn peer_profile_get(
    resources: &StationResourceHandle,
    token: &str,
    peer_ptid: &str,
) -> AppResult<StubPayload> {
    let station_client = resources.client();
    let trimmed = peer_ptid.trim();
    if trimmed.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "peer_profile_get: did is required",
            None,
        );
    }
    let path = format!("/actor/actors/{}/profile", trimmed);
    match station_client.request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        &path,
        token,
        None,
    ) {
        Ok(p) => match actor_profile_to_value(resources, &p) {
            Ok(profile) => success_with_data("peer_profile_get", profile),
            Err(error) => map_resource_error("peer_profile_get", error),
        },
        Err(e) => {
            tracing::warn!(error = %e, peer_ptid = %trimmed, "Failed to fetch peer profile");
            map_station_error("peer_profile_get", "fetch peer profile", e)
        }
    }
}

pub fn profile_update(
    resources: &StationResourceHandle,
    input: ProfileUpdateInput,
    token: &str,
) -> AppResult<StubPayload> {
    let station_client = resources.client();
    if input.observed_revision == 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "profile_update: observed_revision is required",
            None,
        );
    }
    let body = profile_input_to_proto(&input);
    match execute_profile_update(station_client, &input, &body, token) {
        Ok(response) => profile_update_success(resources, "profile_update", response),
        Err(e) => {
            tracing::error!(error = %e, "Failed to update profile");
            map_station_error("profile_update", "update profile", e)
        }
    }
}

// ── Station OSS upload ──

pub fn profile_upload_avatar_oss(
    resources: &StationResourceHandle,
    input: FileUploadInput,
    token: &str,
    progress: Option<UploadProgressSink>,
) -> AppResult<StubPayload> {
    upload_and_set_profile_image(resources, token, &input.file_path, "avatar", progress)
}

pub fn profile_upload_header_oss(
    resources: &StationResourceHandle,
    input: FileUploadInput,
    token: &str,
    progress: Option<UploadProgressSink>,
) -> AppResult<StubPayload> {
    upload_and_set_profile_image(resources, token, &input.file_path, "header", progress)
}

fn upload_and_set_profile_image(
    resources: &StationResourceHandle,
    token: &str,
    file_path: &str,
    field: &str,
    progress: Option<UploadProgressSink>,
) -> AppResult<StubPayload> {
    let station_client = resources.client();
    tracing::info!(file_path = %file_path, field = %field, "Starting profile image upload");

    let current_profile = match station_client.request_peers_proto_no_body::<ActorProfile>(
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
    let oss_resp = match station_client.upload_multipart(
        "/sub-oss/upload",
        token,
        file_path,
        "avatar",
        "public",
        None,
        progress,
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

    match execute_profile_update(station_client, &input, &body, token) {
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
                let _ = sync_avatar_with_download(resources, token, &url);
            }
            profile_update_success(
                resources,
                &format!("profile_upload_{}_oss", field),
                response,
            )
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to update profile after image upload");
            map_station_error("profile_upload_image_oss", "update profile", e)
        }
    }
}

// ── Local profile fallbacks (kept for backward compat) ──

pub fn profile_upload_avatar(
    resources: &StationResourceHandle,
    actor_ptid: &str,
    input: FileUploadInput,
    token: &str,
) -> AppResult<StubPayload> {
    map_upload(
        resources,
        "profile_upload_avatar",
        UploadKind::Avatar,
        input,
        token,
        actor_ptid,
    )
}

pub fn profile_upload_header(
    resources: &StationResourceHandle,
    actor_ptid: &str,
    input: FileUploadInput,
    token: &str,
) -> AppResult<StubPayload> {
    map_upload(
        resources,
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
    resources: &StationResourceHandle,
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
                let _ = sync_avatar_with_download(resources, token, &outcome.value);
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

fn actor_profile_to_value(
    resources: &StationResourceHandle,
    p: &ActorProfile,
) -> Result<Value, ResourceProjectionError> {
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
        // Intrinsic actor type (ActorKind enum, e.g. 7 = AGENT/bot). Drives
        // one-way, non-E2EE conversation UX; -1 is the prost default for an
        // unset enum, normalize it to 0 (UNSPECIFIED).
        "kind": match i32::from(p.kind) {
            v if v < 0 => 0,
            v => v,
        },
        "peers_touch": {
            "network_id": p.peers_touch
                .as_ref()
                .map(|info| info.network_id.as_str())
                .unwrap_or_default(),
        },
    });
    resolve_profile_urls(resources, &mut data)?;
    Ok(data)
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
    station_client: &StationClient,
    input: &ProfileUpdateInput,
    body: &UpdateProfileRequest,
    token: &str,
) -> Result<UpdateProfileResponse, StationClientError> {
    match station_client.request_peers_proto::<UpdateProfileRequest, UpdateProfileResponse>(
        Method::POST,
        "/actor/profile",
        token,
        None,
        Some(body),
    ) {
        Ok(response) if valid_profile_update_response(&response) => Ok(response),
        Ok(_) => reconcile_profile_update(station_client, input, token).ok_or_else(|| {
            StationClientError::new(
                StationClientErrorKind::InvalidResponse,
                "Station returned an invalid profile update response",
                None,
            )
        }),
        Err(error) if ambiguous_profile_update_error(&error) => {
            reconcile_profile_update(station_client, input, token).ok_or(error)
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
    station_client: &StationClient,
    input: &ProfileUpdateInput,
    token: &str,
) -> Option<UpdateProfileResponse> {
    let profile = station_client
        .request_peers_proto_no_body::<ActorProfile>(Method::GET, "/actor/profile", token, None)
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
            | StationClientErrorKind::Unavailable
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
    resources: &StationResourceHandle,
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
    match actor_profile_to_value(resources, &profile) {
        Ok(profile) => success_with_data(
            command,
            json!({
                "outcome": outcome.as_str_name(),
                "profile": profile,
            }),
        ),
        Err(error) => map_resource_error(command, error),
    }
}

fn resolve_profile_urls(
    resources: &StationResourceHandle,
    data: &mut Value,
) -> Result<(), ResourceProjectionError> {
    let Some(fields) = data.as_object_mut() else {
        return Ok(());
    };
    for field in ["avatar", "header"] {
        // Preserve the canonical Station profile value (relative Station media
        // path, external URL, or data URI) as `<field>_identity` BEFORE the
        // ephemeral `station-resource://local/<token>` projection replaces the
        // render field. The renderer avatar owner keys on the canonical
        // identity; the rotating per-process token must never become that
        // identity or cache key (r3.1 Identity/Avatar). Direct-src consumers
        // keep reading the projected `<field>`.
        let identity = fields
            .get(field)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        fields.insert(format!("{field}_identity"), Value::String(identity.clone()));
        if !identity.is_empty() {
            fields.insert(
                field.to_string(),
                Value::String(resources.project_reference(&identity, None)?),
            );
        }
    }
    Ok(())
}

fn map_resource_error(command: &str, error: ResourceProjectionError) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::Conflict,
        format!("{command}: {error}"),
        Some(json!({ "reason": "station_resource_projection_failed" })),
    )
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
pub fn sync_user_profile(
    resources: &StationResourceHandle,
    token: &str,
    actor_ptid: &str,
) -> AppResult<StubPayload> {
    let station_client = resources.client();
    if actor_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "sync_user_profile: caller has no bound actor",
            None,
        );
    }

    // Fetch full profile from Station.
    let profile = match station_client.request_peers_proto_no_body::<ActorProfile>(
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

    // Canonical avatar identity is the raw Station profile value (relative
    // Station media path, external URL, or data: URI). The per-process
    // `station-resource://local/<token>` projection is ephemeral and must
    // never become the identity or cache key (r3.1 Identity/Avatar).
    let avatar_identity = profile.avatar.trim().to_string();
    let last_good = crate::infrastructure::auth_identity::actor_avatar_last_good(actor_ptid);
    let avatar = project_avatar(
        resources,
        Some(token),
        &avatar_identity,
        last_good.as_ref().and_then(|(_, path)| path.as_deref()),
    );

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

    // A failed materialization never clears the same-actor last-good record;
    // an authoritative ABSENT clears identity and local path.
    let avatar_sync = match avatar.state {
        AvatarProjectionKind::Ready => crate::infrastructure::auth_identity::AvatarIdentitySync::Updated {
            identity: &avatar.identity,
            local_path: avatar.local_path.as_deref(),
        },
        AvatarProjectionKind::Absent => crate::infrastructure::auth_identity::AvatarIdentitySync::Cleared,
        AvatarProjectionKind::Failed => crate::infrastructure::auth_identity::AvatarIdentitySync::Unchanged,
    };

    // Sync all profile data + the avatar projection to the local account row.
    let avatar_local = crate::infrastructure::auth_identity::sync_profile_locally(
        &account_id,
        Some(&profile.display_name),
        None, // email is not in ActorProfile
        avatar_sync,
        if profile.url.is_empty() {
            None
        } else {
            Some(&profile.url)
        },
    );

    let local_path = match avatar_local {
        Ok(path) => path.or_else(|| match avatar.state {
            // Persist failed: surface the previous same-actor path (if any) so
            // the renderer keeps showing last-good instead of null-caching.
            AvatarProjectionKind::Failed => {
                last_good.as_ref().and_then(|(_, path)| path.clone())
            }
            _ => None,
        }),
        Err(e) => {
            tracing::warn!(error = %e, "sync_user_profile: local sync partially failed");
            match avatar.state {
                AvatarProjectionKind::Ready => avatar.local_path.clone(),
                AvatarProjectionKind::Failed => {
                    last_good.as_ref().and_then(|(_, path)| path.clone())
                }
                AvatarProjectionKind::Absent => None,
            }
        }
    };

    // The renderer keys on canonical identity; `avatar_url` remains the
    // ephemeral display projection for existing consumers and is empty for a
    // authoritative ABSENT (so empty string can never be read as "unknown").
    let data = json!({
        "name": profile.display_name,
        "email": "", // ActorProfile doesn't carry email
        "avatar_url": avatar.url,
        "avatar_identity": avatar.identity,
        "avatar_local_path": local_path,
        "avatar_state": avatar.state.as_str(),
        "profile_url": profile.url,
        "profile_revision": profile.profile_revision,
        "synced": true,
    });

    AppResult::success(StubPayload {
        command: "sync_user_profile".to_string(),
        status: data.to_string(),
    })
}

/// Typed avatar projection shared by every profile/avatar entry point
/// (`sync_user_profile`, `avatar_resolve_local`, `account_sync_avatar`, and
/// both the Tauri command and HTTP gateway front doors).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AvatarProjectionKind {
    /// Materialized local file is available.
    Ready,
    /// The authoritative profile carries no avatar.
    Absent,
    /// Identity exists but materialization/decode failed; callers keep
    /// last-good and may retry. This is never a permanent negative cache.
    Failed,
}

impl AvatarProjectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Absent => "absent",
            Self::Failed => "failed",
        }
    }
}

struct AvatarProjection {
    state: AvatarProjectionKind,
    identity: String,
    local_path: Option<String>,
    url: String,
}

fn absent_projection() -> AvatarProjection {
    AvatarProjection {
        state: AvatarProjectionKind::Absent,
        identity: String::new(),
        local_path: None,
        url: String::new(),
    }
}

/// Resolve a canonical avatar identity into its typed projection.
///
/// `last_good_path` is returned with `Failed` (never with `Ready` or `Absent`)
/// so a transient Station/network failure cannot blank an actor that has a
/// previously materialized image.
fn project_avatar(
    resources: &StationResourceHandle,
    token: Option<&str>,
    canonical_identity: &str,
    last_good_path: Option<&str>,
) -> AvatarProjection {
    let identity = canonical_identity.trim();
    if identity.is_empty() {
        return absent_projection();
    }

    let reference = match resources.reference(identity, None) {
        Ok(reference) => reference,
        Err(error) => {
            tracing::warn!(error = %error, identity = %identity, "avatar reference rejected");
            return failed_projection(identity, last_good_path);
        }
    };

    let url = match &reference {
        ResourceReference::Station(resource) => resources
            .project(resource.clone())
            .map(|uri| uri.as_str().to_string())
            .unwrap_or_else(|_| identity.to_string()),
        ResourceReference::External(external) => external.as_str().to_string(),
        ResourceReference::Inline(inline) => inline.as_str().to_string(),
    };

    match materialize_avatar_reference(resources, token, &reference) {
        Ok(Some(path)) => AvatarProjection {
            state: AvatarProjectionKind::Ready,
            identity: identity.to_string(),
            local_path: Some(path),
            url,
        },
        Ok(None) => absent_projection(),
        Err(error) => {
            tracing::warn!(error = %error, identity = %identity, "avatar materialization failed");
            failed_projection(identity, last_good_path)
        }
    }
}

fn failed_projection(identity: &str, last_good_path: Option<&str>) -> AvatarProjection {
    AvatarProjection {
        state: AvatarProjectionKind::Failed,
        identity: identity.trim().to_string(),
        local_path: last_good_path
            .filter(|path| !path.trim().is_empty())
            .map(str::to_string),
        // No fresh display projection on failure; the renderer keeps its
        // last-good src and retries through the shared AvatarAssets owner.
        url: String::new(),
    }
}

/// Sync avatar for the active account: update remote URL and warm the local cache.
/// Returns the cached file path when the download succeeds, `None` otherwise.
/// `token` is reserved for future Station-authenticated download paths; callers pass the session access token.
pub fn sync_avatar_with_download(
    resources: &StationResourceHandle,
    token: &str,
    avatar_url: &str,
) -> Result<Option<String>, String> {
    let reference = resources
        .reference(avatar_url, None)
        .map_err(|error| error.to_string())?;
    let identity = match &reference {
        ResourceReference::Station(resource) => resource.path_and_query(),
        ResourceReference::External(url) => url.as_str(),
        ResourceReference::Inline(data) => data.as_str(),
    };
    crate::infrastructure::auth_identity::update_active_avatar(identity)?;

    let local_path = materialize_avatar_reference(resources, Some(token), &reference)?;
    if let Some(ref path) = local_path {
        crate::infrastructure::auth_identity::update_active_avatar_local_path(path)?;
    }
    Ok(local_path)
}

/// Resolve the local cache path for any canonical avatar identity. The single
/// backend entry point used by the React-free `AvatarAssets` owner. All three
/// states are typed (`ready` / `absent` / `failed`) so the renderer never has
/// to infer identity from a null path.
pub fn avatar_resolve_local(
    resources: &StationResourceHandle,
    token: Option<&str>,
    remote_url: &str,
) -> Value {
    let projection = project_avatar(resources, token, remote_url, None);
    json!({
        "state": projection.state.as_str(),
        "identity": projection.identity,
        "local_path": projection.local_path,
        "avatar_url": projection.url,
    })
}

/// Download Station avatar to local cache and link it to the active auth identity.
///
/// Shares the exact response contract as `sync_user_profile`
/// (`avatar_identity` / `avatar_local_path` / `avatar_state`) so the renderer
/// has one typed fallback path instead of three ad-hoc shapes.
pub fn account_sync_avatar(
    resources: &StationResourceHandle,
    input: &AccountSyncAvatarInput,
    token: &str,
) -> AppResult<StubPayload> {
    let identity = input.avatar_url.trim();
    if identity.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "avatar_url is required",
            None,
        );
    }
    let last_good =
        crate::infrastructure::auth_identity::active_avatar_last_good();
    let projection = project_avatar(
        resources,
        Some(token),
        identity,
        last_good.as_ref().and_then(|(_, path)| path.as_deref()),
    );

    if projection.state == AvatarProjectionKind::Ready {
        if let Err(error) =
            crate::infrastructure::auth_identity::update_active_avatar(&projection.identity)
        {
            tracing::error!(error = %error, "Failed to sync avatar identity");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to sync avatar: {error}"),
                None,
            );
        }
        if let Some(ref path) = projection.local_path {
            if let Err(error) =
                crate::infrastructure::auth_identity::update_active_avatar_local_path(path)
            {
                tracing::error!(error = %error, "Failed to sync avatar local path");
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("Failed to sync avatar: {error}"),
                    None,
                );
            }
        }
    }

    let status = json!({
        // Same wire contract as `avatar_resolve_local`: the three profile/
        // avatar entry points normalize to one typed TS shape.
        "state": projection.state.as_str(),
        "identity": projection.identity,
        "local_path": projection.local_path,
        "avatar_url": projection.url,
    });
    AppResult::success(StubPayload {
        command: "account_sync_avatar".to_string(),
        status: status.to_string(),
    })
}

/// Materialize a referenced avatar, honoring the transport-independent cache
/// identity. Station and inline resources are served from the local file
/// cache on identity hit, so the ephemeral `station-resource://local/<token>`
/// projection neither doubles the cache key nor triggers a second fetch after
/// `sync_user_profile` has already stored the bytes.
fn materialize_avatar_reference(
    resources: &StationResourceHandle,
    token: Option<&str>,
    reference: &ResourceReference,
) -> Result<Option<String>, String> {
    let path = match reference {
        ResourceReference::Station(resource) => {
            if let Some(path) = avatar_cache::lookup_identity(&resource.cache_identity()) {
                path
            } else {
                let (bytes, _) = resources
                    .fetch_bytes(resource, token)
                    .map_err(|error| error.to_string())?;
                avatar_cache::store_bytes(&resource.cache_identity(), &bytes)
                    .map_err(|error| error.to_string())?
            }
        }
        ResourceReference::External(url) => {
            // `ensure_external` is already identity-based and cache-first.
            avatar_cache::ensure_external(url.as_str()).map_err(|error| error.to_string())?
        }
        ResourceReference::Inline(data) => {
            if let Some(path) = avatar_cache::lookup_identity(&data.cache_identity()) {
                path
            } else {
                let bytes = data.decoded_bytes().map_err(|error| error.to_string())?;
                avatar_cache::store_bytes(&data.cache_identity(), &bytes)
                    .map_err(|error| error.to_string())?
            }
        }
    };
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        project_avatar, actor_profile_to_value, canonical_profile_ptid, profile_matches_actor,
        AvatarProjectionKind,
    };
    use crate::application::station_runtime::client::StationClient;
    use crate::application::station_runtime::resource::StationResourceHandle;
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

    #[test]
    fn account_profile_projection_includes_canonical_ptid() {
        let resources = StationResourceHandle::new(StationClient::testing_unavailable());
        let profile = ActorProfile {
            id: "350519971299721219".to_string(),
            peers_touch: Some(PeersTouchInfo {
                network_id: "ptid:v1:actor:peers:p:alice:1220abc".to_string(),
            }),
            ..ActorProfile::default()
        };

        assert_eq!(
            actor_profile_to_value(&resources, &profile).unwrap()["peers_touch"]["network_id"],
            "ptid:v1:actor:peers:p:alice:1220abc"
        );
    }

    #[test]
    fn profile_projects_station_paths_without_rewriting_external_urls() {
        let resources = StationResourceHandle::new(StationClient::testing_scoped("station", 7));
        let profile = ActorProfile {
            avatar: "/sub-oss/file?key=avatar.png".to_string(),
            header: "https://cdn.example.test/header.png".to_string(),
            ..ActorProfile::default()
        };

        let projected = actor_profile_to_value(&resources, &profile).unwrap();

        assert!(projected["avatar"]
            .as_str()
            .is_some_and(|value| value.starts_with("station-resource://local/")));
        assert_eq!(projected["header"], "https://cdn.example.test/header.png");
        // The rotating projection must never replace the canonical identity.
        assert_eq!(
            projected["avatar_identity"],
            "/sub-oss/file?key=avatar.png"
        );
        assert_eq!(
            projected["header_identity"],
            "https://cdn.example.test/header.png"
        );
        assert_ne!(projected["avatar"], projected["avatar_identity"]);
    }

    #[test]
    fn profile_identity_fields_are_empty_when_profile_has_no_media() {
        let resources = StationResourceHandle::new(StationClient::testing_scoped("station", 7));
        let profile = ActorProfile {
            avatar: String::new(),
            header: String::new(),
            ..ActorProfile::default()
        };

        let projected = actor_profile_to_value(&resources, &profile).unwrap();

        assert_eq!(projected["avatar"], "");
        assert_eq!(projected["header"], "");
        assert_eq!(projected["avatar_identity"], "");
        assert_eq!(projected["header_identity"], "");
    }

    #[test]
    fn profile_preserves_valid_inline_image_data() {
        let resources = StationResourceHandle::new(StationClient::testing_scoped("station", 7));
        let avatar = "data:image/svg+xml;base64,PHN2Zy8+";
        let profile = ActorProfile {
            avatar: avatar.to_string(),
            ..ActorProfile::default()
        };

        let projected = actor_profile_to_value(&resources, &profile).unwrap();

        assert_eq!(projected["avatar"], avatar);
        assert_eq!(projected["avatar_identity"], avatar);
    }

    #[test]
    fn avatar_projection_is_absent_for_empty_identity() {
        let resources = StationResourceHandle::new(StationClient::testing_unavailable());

        let projection = project_avatar(&resources, None, "   ", None);

        assert_eq!(projection.state, AvatarProjectionKind::Absent);
        assert!(projection.identity.is_empty());
        assert_eq!(projection.local_path, None);
        assert!(projection.url.is_empty());
    }

    #[test]
    fn avatar_projection_failure_keeps_same_actor_last_good() {
        let resources = StationResourceHandle::new(StationClient::testing_unavailable());

        // No active Station scope in tests, so a relative Station identity
        // cannot materialize; the projection must be typed failed and retain
        // the supplied same-actor last-good path instead of nulling it.
        let projection = project_avatar(
            &resources,
            None,
            "/sub-oss/file?key=avatar.png",
            Some("/cache/last-good.png"),
        );

        assert_eq!(projection.state, AvatarProjectionKind::Failed);
        assert_eq!(projection.identity, "/sub-oss/file?key=avatar.png");
        assert_eq!(projection.local_path.as_deref(), Some("/cache/last-good.png"));
    }
}
