// Social (Moments) Tauri commands — thin BFF wrappers around the
// station's `/api/v1/social/*` HTTP surface.
//
// Pattern: each command performs a single proto-over-HTTP round-trip via
// `station_client::request_proto`, returns the response as raw protobuf
// bytes (`Vec<u8>`), and lets the TS layer deserialize through
// `invokeRustProto` / `fromBinary` against the matching schema.
//
// Why proto bytes (not StubPayload JSON) for this module:
//   - The social wire shape carries `Audience`, `Mention`, typed
//     `ReactionSummary`, etc. — all defined in proto. Re-encoding into
//     bespoke JSON shapes (the StubPayload route used by older modules)
//     creates a parallel schema that drifts. Proto bytes preserve the
//     contract exactly.
//   - Matches the chat / group_chat module pattern that
//     the desktop frontend has already standardised on for typed wire
//     responses.
//
// All commands require an authenticated session — `token_from_state_proto`
// returns Unauthorized early when the session token is missing.

use std::sync::Arc;

use crate::application::session_resolver;
use crate::contracts::{
    SocialCircleAddMembersInput, SocialCircleCreateInput, SocialCircleDeleteInput,
    SocialCircleListMembersInput, SocialCircleRemoveMembersInput, SocialCircleRenameInput,
    SocialCreateCommentInput, SocialCreateMomentInput, SocialDeleteCommentInput,
    SocialDeleteMomentInput, SocialFollowInput, SocialFriendRequestAcceptInput,
    SocialFriendRequestListInput, SocialFriendRequestRejectInput, SocialFriendRequestSendInput,
    SocialGetCommentsInput, SocialGetFollowersInput, SocialGetFollowingInput,
    SocialGetMomentInput, SocialGetRelationshipInput, SocialGetTimelineInput,
    SocialListByAuthorInput, SocialReactInput, SocialStationModerationDeleteInput,
    SocialStationModerationListInput, SocialStationModerationUpsertInput,
    SocialSyncMomentsProjectionInput, SocialUnreactInput,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model;
use crate::state::AppState;

use prost::Message;
use reqwest::Method;
use tauri::{State, Window};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract the bearer token tied to the calling window.
fn token_from_state_proto(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Vec<u8>>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn station_error_proto(
    err: station_client::StationClientError,
    context: &str,
) -> AppResult<Vec<u8>> {
    err.into_app_result(context)
}

/// Convenience: fetch a JSON-or-proto path with no body and decode the
/// proto response. We pass `None::<&()>` — the unit type is `prost::Message`
/// indirectly through the request_proto Req bound; using `()` plus an
/// explicit turbofish keeps the call sites short.
fn get_proto<Resp: Message + Default>(
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
) -> Result<Resp, station_client::StationClientError> {
    station_client::request_proto::<(), Resp>(Method::GET, path, token, query, None)
}

fn post_proto<Req: Message, Resp: Message + Default>(
    path: &str,
    token: &str,
    body: &Req,
) -> Result<Resp, station_client::StationClientError> {
    station_client::request_proto::<Req, Resp>(Method::POST, path, token, None, Some(body))
}

fn delete_proto<Resp: Message + Default>(
    path: &str,
    token: &str,
) -> Result<Resp, station_client::StationClientError> {
    station_client::request_proto::<(), Resp>(Method::DELETE, path, token, None, None)
}

fn delete_proto_with_query<Resp: Message + Default>(
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
) -> Result<Resp, station_client::StationClientError> {
    station_client::request_proto::<(), Resp>(Method::DELETE, path, token, query, None)
}

/// Translate the JS-side string id (always a stringified u64 to keep
/// JSON safe — JS Number can't carry the full uint64 range) into the
/// numeric form prost expects for `circle_id` fields. Empty / non-
/// numeric input is treated as an invalid argument since the calling
/// command would otherwise silently round-trip a `0` and corrupt
/// state on the server.
fn parse_circle_id(raw: &str) -> Result<u64, AppResult<Vec<u8>>> {
    raw.trim().parse::<u64>().map_err(|_| {
        AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("invalid circle_id: {:?}", raw),
            None,
        )
    })
}

// ---------------------------------------------------------------------------
// Moments — write
// ---------------------------------------------------------------------------

/// Create a new Moment. P2 only exercises text content + the three
/// active audience kinds (PUBLIC / FOLLOWERS / SELF); other content
/// types (image / video / etc.) and audience kinds (CIRCLE / GROUP /
/// CUSTOM_*) are accepted by the wire format but the desktop UI keeps
/// them disabled until OSS / P3 land.
///
/// Audience routing:
///   - The proto `Audience { kind, target_id?, base_kind?, actor_dids[] }`
///     is constructed on the TS side. The Rust shim is intentionally a
///     dumb forwarder so the audience contract isn't double-encoded.
#[tauri::command]
pub fn social_create_moment(
    input: SocialCreateMomentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.payload.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "payload (CreatePostRequest bytes) is required",
            None,
        );
    }
    let req = match model::social::CreatePostRequest::decode(input.payload.as_slice()) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("decode CreatePostRequest: {}", e),
                None,
            )
        }
    };
    let resp: model::social::CreatePostResponse =
        match post_proto("/api/v1/social/moments", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "create moment failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_get_moment(
    input: SocialGetMomentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let path = format!("/api/v1/social/moments/{}", input.id);
    let resp: model::social::GetPostResponse = match get_proto(&path, &token, None) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "get moment failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_delete_moment(
    input: SocialDeleteMomentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let path = format!("/api/v1/social/moments/{}", input.id);
    let resp: model::social::DeletePostResponse = match delete_proto(&path, &token) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "delete moment failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Moments — read (timelines + author feed)
// ---------------------------------------------------------------------------

/// `social_get_timeline` covers both PUBLIC (Explore) and HOME feeds.
/// The TS layer picks the variant via the `type` field of
/// `GetTimelineRequest` — same shape the station expects.
///
/// Hot vs Recent: when `sort=hot` is set, the server scores by
/// `log10(reactions+comments+1) - hours_since_created * 0.05` and
/// emits a `(score, id)` cursor instead of `(created_at, id)`. P2-C6
/// adds the backend support; the BFF here is sort-agnostic — it just
/// forwards `sort` through the query string.
#[tauri::command]
pub fn social_get_timeline(
    input: SocialGetTimelineInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut query: Vec<(&str, String)> = Vec::new();
    query.push(("type", input.r#type));
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    if let Some(l) = input.limit {
        query.push(("limit", l.to_string()));
    }
    if let Some(s) = input.sort {
        query.push(("sort", s));
    }
    let resp: model::social::GetTimelineResponse =
        match get_proto("/api/v1/social/timeline", &token, Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "get timeline failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_sync_moments_projection(
    input: SocialSyncMomentsProjectionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let req = model::social::SyncMomentsProjectionRequest {
        home_cursor: input.home_cursor.unwrap_or_default(),
        public_cursor: input.public_cursor.unwrap_or_default(),
        limit: input.limit.unwrap_or(20),
        public_sort: input.public_sort.unwrap_or(0),
        reason: input.reason.unwrap_or_default(),
    };
    let resp: model::social::SyncMomentsProjectionResponse =
        match post_proto("/api/v1/social/moments/sync", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "sync moments projection failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Moderation — Station trust policy
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn social_station_moderation_upsert(
    input: SocialStationModerationUpsertInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.station_domain.trim().is_empty()
        && input
            .station_peer_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "station_domain or station_peer_id is required",
            None,
        );
    }
    let req = model::social::UpsertStationModerationPolicyRequest {
        policy: Some(model::social::StationModerationPolicy {
            station_domain: input.station_domain,
            station_peer_id: input.station_peer_id.unwrap_or_default(),
            kind: input.kind.unwrap_or(1),
            reason: input.reason.unwrap_or_default(),
            ..Default::default()
        }),
    };
    let resp: model::social::UpsertStationModerationPolicyResponse =
        match post_proto("/api/v1/social/moderation/stations", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "upsert station moderation failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_station_moderation_delete(
    input: SocialStationModerationDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let station_domain = input.station_domain.unwrap_or_default();
    let station_peer_id = input.station_peer_id.unwrap_or_default();
    if station_domain.trim().is_empty() && station_peer_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "station_domain or station_peer_id is required",
            None,
        );
    }
    let query = vec![
        ("station_domain", station_domain),
        ("station_peer_id", station_peer_id),
        ("kind", input.kind.unwrap_or(1).to_string()),
    ];
    let resp: model::social::DeleteStationModerationPolicyResponse =
        match delete_proto_with_query("/api/v1/social/moderation/stations", &token, Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "delete station moderation failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_station_moderation_list(
    input: SocialStationModerationListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut query: Vec<(&str, String)> = vec![("kind", input.kind.unwrap_or(1).to_string())];
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    if let Some(l) = input.limit {
        query.push(("limit", l.to_string()));
    }
    let resp: model::social::ListStationModerationPoliciesResponse =
        match get_proto("/api/v1/social/moderation/stations", &token, Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "list station moderation failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_list_by_author(
    input: SocialListByAuthorInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.user_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "user_id is required", None);
    }
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    if let Some(l) = input.limit {
        query.push(("limit", l.to_string()));
    }
    let path = format!("/api/v1/social/users/{}/posts", input.user_id);
    let resp: model::social::ListPostsResponse = match get_proto(&path, &token, Some(&query)) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "list by author failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/// Note: the wire route is `/api/v1/social/posts/:id/react` — the
/// legacy `/posts/` prefix is retained on the station alongside the
/// `/moments/` family (handler.go preserves both). Once all clients
/// are off `/posts/`, P4 will collapse the alias.
#[tauri::command]
pub fn social_react(
    input: SocialReactInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.post_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "post_id is required", None);
    }
    if input.kind == 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "reaction kind is required (REACTION_UNSPECIFIED rejected)",
            None,
        );
    }
    let req = model::social::ReactToPostRequest {
        post_id: input.post_id.clone(),
        kind: input.kind,
    };
    let path = format!("/api/v1/social/posts/{}/react", input.post_id);
    let resp: model::social::ReactToPostResponse = match post_proto(&path, &token, &req) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "react failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_unreact(
    input: SocialUnreactInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.post_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "post_id is required", None);
    }
    let req = model::social::UnreactToPostRequest {
        post_id: input.post_id.clone(),
        kind: input.kind,
    };
    let path = format!("/api/v1/social/posts/{}/unreact", input.post_id);
    let resp: model::social::UnreactToPostResponse = match post_proto(&path, &token, &req) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "unreact failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn social_get_comments(
    input: SocialGetCommentsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.post_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "post_id is required", None);
    }
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    if let Some(l) = input.limit {
        query.push(("limit", l.to_string()));
    }
    let path = format!("/api/v1/social/moments/{}/comments", input.post_id);
    let resp: model::social::GetCommentsResponse = match get_proto(&path, &token, Some(&query)) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "get comments failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_create_comment(
    input: SocialCreateCommentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.post_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "post_id is required", None);
    }
    if input.content.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "content is required", None);
    }
    let req = model::social::CreateCommentRequest {
        post_id: input.post_id.clone(),
        content: input.content,
        reply_to_comment_id: input.reply_to_comment_id.unwrap_or_default(),
    };
    let path = format!("/api/v1/social/moments/{}/comments", input.post_id);
    let resp: model::social::CreateCommentResponse = match post_proto(&path, &token, &req) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "create comment failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_delete_comment(
    input: SocialDeleteCommentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.comment_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "comment_id is required", None);
    }
    let path = format!("/api/v1/social/comments/{}", input.comment_id);
    let resp: model::social::DeleteCommentResponse = match delete_proto(&path, &token) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "delete comment failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Relationships (follow / unfollow / lists)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn social_follow(
    input: SocialFollowInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.target_user_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_user_id is required",
            None,
        );
    }
    let req = model::social::FollowRequest {
        target_actor_id: input.target_user_id,
    };
    let resp: model::social::FollowResponse =
        match post_proto("/api/v1/social/relationships/follow", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "follow failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_unfollow(
    input: SocialFollowInput, // same shape — target_user_id only
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.target_user_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_user_id is required",
            None,
        );
    }
    let req = model::social::UnfollowRequest {
        target_actor_id: input.target_user_id,
    };
    let resp: model::social::UnfollowResponse =
        match post_proto("/api/v1/social/relationships/unfollow", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "unfollow failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_get_followers(
    input: SocialGetFollowersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(uid) = input.user_id {
        if !uid.is_empty() {
            query.push(("user_id", uid));
        }
    }
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    if let Some(l) = input.limit {
        query.push(("limit", l.to_string()));
    }
    let resp: model::social::GetFollowersResponse = match get_proto(
        "/api/v1/social/relationships/followers",
        &token,
        Some(&query),
    ) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "get followers failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_get_following(
    input: SocialGetFollowingInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(uid) = input.user_id {
        if !uid.is_empty() {
            query.push(("user_id", uid));
        }
    }
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    if let Some(l) = input.limit {
        query.push(("limit", l.to_string()));
    }
    let resp: model::social::GetFollowingResponse = match get_proto(
        "/api/v1/social/relationships/following",
        &token,
        Some(&query),
    ) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "get following failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_get_relationship(
    input: SocialGetRelationshipInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.target_user_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_user_id is required",
            None,
        );
    }
    let query = vec![("target_user_id", input.target_user_id)];
    let resp: model::social::GetRelationshipResponse =
        match get_proto("/api/v1/social/relationships", &token, Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "get relationship failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn social_circle_create(
    input: SocialCircleCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.name.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "name is required", None);
    }
    let req = model::social::CreateCircleRequest {
        name: input.name,
        description: input.description.unwrap_or_default(),
        member_dids: input.member_dids.unwrap_or_default(),
    };
    let resp: model::social::CreateCircleResponse =
        match post_proto("/api/v1/social/circles", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "create circle failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_circle_rename(
    input: SocialCircleRenameInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.circle_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "circle_id is required", None);
    }
    let circle_id_num = match parse_circle_id(&input.circle_id) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let req = model::social::RenameCircleRequest {
        circle_id: circle_id_num,
        name: input.name,
        description: input.description,
    };
    let path = format!("/api/v1/social/circles/{}", input.circle_id);
    let resp: model::social::RenameCircleResponse =
        match station_client::request_proto::<_, model::social::RenameCircleResponse>(
            Method::PUT,
            &path,
            &token,
            None,
            Some(&req),
        ) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "rename circle failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_circle_delete(
    input: SocialCircleDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.circle_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "circle_id is required", None);
    }
    let path = format!("/api/v1/social/circles/{}", input.circle_id);
    let resp: model::social::DeleteCircleResponse = match delete_proto(&path, &token) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "delete circle failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_circle_list_mine(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let resp: model::social::ListMyCirclesResponse =
        match get_proto("/api/v1/social/circles", &token, None) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "list circles failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_circle_add_members(
    input: SocialCircleAddMembersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.circle_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "circle_id is required", None);
    }
    if input.member_dids.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "member_dids is required", None);
    }
    let circle_id_num = match parse_circle_id(&input.circle_id) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let req = model::social::AddCircleMemberRequest {
        circle_id: circle_id_num,
        member_dids: input.member_dids,
    };
    let path = format!("/api/v1/social/circles/{}/members", input.circle_id);
    let resp: model::social::AddCircleMemberResponse = match post_proto(&path, &token, &req) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "add circle members failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_circle_remove_members(
    input: SocialCircleRemoveMembersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.circle_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "circle_id is required", None);
    }
    if input.member_dids.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "member_dids is required", None);
    }
    let circle_id_num = match parse_circle_id(&input.circle_id) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let req = model::social::RemoveCircleMemberRequest {
        circle_id: circle_id_num,
        member_dids: input.member_dids,
    };
    let path = format!("/api/v1/social/circles/{}/members", input.circle_id);
    let resp: model::social::RemoveCircleMemberResponse =
        match station_client::request_proto::<_, model::social::RemoveCircleMemberResponse>(
            Method::DELETE,
            &path,
            &token,
            None,
            Some(&req),
        ) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "remove circle members failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

/// `social_get_my_stats` returns the aggregate Moments counters for
/// the calling user — the data behind the dashboard panel. Cheap
/// enough to fetch on every Moments-tab open; the station computes
/// each counter live with simple SQL aggregates.
#[tauri::command]
pub fn social_get_my_stats(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let resp: model::social::GetMyMomentsStatsResponse =
        match get_proto("/api/v1/social/me/stats", &token, None) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "get my moments stats failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_circle_list_members(
    input: SocialCircleListMembersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.circle_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "circle_id is required", None);
    }
    let path = format!("/api/v1/social/circles/{}/members", input.circle_id);
    let resp: model::social::ListCircleMembersResponse = match get_proto(&path, &token, None) {
        Ok(r) => r,
        Err(e) => return station_error_proto(e, "list circle members failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_friend_request_send(
    input: SocialFriendRequestSendInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.receiver_did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "receiver_did is required", None);
    }
    let req = model::chat::SendFriendRequestRequest {
        receiver_did: input.receiver_did,
        message: input.message.unwrap_or_default(),
    };
    let resp: model::chat::SendFriendRequestResponse =
        match post_proto("/api/v1/social/friend-request/send", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "send friend request failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_friend_request_accept(
    input: SocialFriendRequestAcceptInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.request_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "request_id is required", None);
    }
    let req = model::chat::AcceptFriendRequestRequest {
        request_id: input.request_id,
    };
    let resp: model::chat::AcceptFriendRequestResponse =
        match post_proto("/api/v1/social/friend-request/accept", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "accept friend request failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_friend_request_reject(
    input: SocialFriendRequestRejectInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.request_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "request_id is required", None);
    }
    let req = model::chat::RejectFriendRequestRequest {
        request_id: input.request_id,
    };
    let resp: model::chat::RejectFriendRequestResponse =
        match post_proto("/api/v1/social/friend-request/reject", &token, &req) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "reject friend request failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_friend_request_list(
    input: SocialFriendRequestListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut query = Vec::new();
    if let Some(status) = input.status {
        query.push(("status", status.to_string()));
    }
    query.push(("limit", input.limit.unwrap_or(50).clamp(1, 200).to_string()));
    query.push(("offset", input.offset.unwrap_or(0).to_string()));
    let resp: model::chat::ListFriendRequestsResponse =
        match get_proto("/api/v1/social/friend-requests", &token, Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "list friend requests failed"),
        };
    AppResult::success(resp.encode_to_vec())
}
