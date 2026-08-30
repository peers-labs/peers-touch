// Profile application service — Station-backed + local fallbacks.
//
// 2026-04-09: Rewritten to support Station OSS upload, expanded profile fields,
//             and dual-path (Station API + local store) architecture.

use crate::contracts::{
    AccountSyncAvatarInput, FileUploadInput, ProfilePrivacyInput, ProfileUpdateInput, StubPayload,
};
use crate::domain::profile::{ProfileError, UploadKind};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::{avatar_cache, profile_store, station_client};
use crate::model::actor::{ActorProfile, UpdateProfileRequest, UserLink};
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
    let body = profile_input_to_proto(&input);
    match station_client::request_peers_proto_no_payload(
        Method::POST,
        "/actor/profile",
        token,
        None,
        Some(&body),
    ) {
        Ok(()) => match station_client::request_peers_proto_no_body::<ActorProfile>(
            Method::GET,
            "/actor/profile",
            token,
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

    let media_identity = profile_media_identity(&url);

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
        token,
        None,
        Some(&body),
    ) {
        Ok(()) => {
            // Sync avatar to local auth identity and download to local cache.
            if field == "avatar" {
                let _ = sync_avatar_with_download(token, &media_identity);
            }
            match station_client::request_peers_proto_no_body::<ActorProfile>(
                Method::GET,
                "/actor/profile",
                token,
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
    let canonical_ptid = canonical_profile_ptid(p).unwrap_or_default();
    let links: Vec<Value> = p
        .links
        .iter()
        .map(|l| json!({ "label": l.label, "url": l.url }))
        .collect();
    json!({
        "id": canonical_ptid,
        "username": p.username,
        "display_name": p.display_name,
        "note": p.note,
        "avatar": profile_media_identity(&p.avatar),
        "header": profile_media_identity(&p.header),
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
        "peers_touch": {
            "network_id": canonical_ptid,
        },
    })
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
    r
}

/// Keep Station-owned media identity independent of the current transport
/// endpoint. The avatar cache resolves relative paths only when downloading.
fn profile_media_identity(url: &str) -> String {
    avatar_cache::canonical_remote_identity(url).unwrap_or_else(|_| url.trim().to_string())
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
/// `account_id` and `actor_ptid` MUST come from the same bound window session.
/// We intentionally do NOT consult `identities.json::active_account_id` to pick
/// the destination record — under multi-window dev (`make dev-dual`) and right
/// after PIN unlock, `active_account_id` may lag behind the per-window session
/// and would cause us to write actor X's profile into actor Y's record (the
/// "both rows show User B" bug).
pub fn sync_user_profile(
    token: &str,
    account_id: &str,
    actor_ptid: &str,
) -> AppResult<StubPayload> {
    if account_id.trim().is_empty() || actor_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "sync_user_profile: caller has no complete bound identity",
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

    // Resolve avatar URL through the same self/peer profile normalization.
    let avatar_url = profile_media_identity(&profile.avatar);

    // Sync all profile data + download avatar to local cache.
    let avatar_local = crate::infrastructure::auth_identity::sync_profile_locally(
        account_id,
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
    use super::{actor_profile_to_value, canonical_profile_ptid, profile_matches_actor};
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
    fn profile_value_exposes_canonical_ptid_and_transport_independent_media() {
        let profile = ActorProfile {
            id: "350519971299721219".to_string(),
            avatar: "/sub-oss/avatar/alice".to_string(),
            header: "https://cdn.example.test/header/alice".to_string(),
            peers_touch: Some(PeersTouchInfo {
                network_id: "ptid:v1:actor:peers:p:alice:1220abc".to_string(),
            }),
            ..ActorProfile::default()
        };

        let value = actor_profile_to_value(&profile);

        assert_eq!(
            value.get("id").and_then(|id| id.as_str()),
            Some("ptid:v1:actor:peers:p:alice:1220abc")
        );
        assert_eq!(
            value
                .get("peers_touch")
                .and_then(|info| info.get("network_id"))
                .and_then(|id| id.as_str()),
            Some("ptid:v1:actor:peers:p:alice:1220abc")
        );
        assert_eq!(
            value.get("avatar").and_then(|avatar| avatar.as_str()),
            Some("/sub-oss/avatar/alice")
        );
        assert_eq!(
            value.get("header").and_then(|header| header.as_str()),
            Some("https://cdn.example.test/header/alice")
        );
    }
}
