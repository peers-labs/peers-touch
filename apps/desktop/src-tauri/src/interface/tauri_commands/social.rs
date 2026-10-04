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
//   - Matches the messaging module pattern that
//     the desktop frontend has already standardised on for typed wire
//     responses.
//
// Mutations and private reads require an authenticated session. Public-readable
// GETs preserve Station's strict optional-auth contract.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::application::session_resolver;
use crate::contracts::{
    SocialCircleAddMembersInput, SocialCircleCreateInput, SocialCircleDeleteInput,
    SocialCircleListMembersInput, SocialCircleRemoveMembersInput, SocialCircleRenameInput,
    SocialCreateCommentInput, SocialCreateMomentInput, SocialDeleteCommentInput,
    SocialDeleteMomentInput, SocialFollowInput, SocialFriendRequestAcceptInput,
    SocialFriendRequestListInput, SocialFriendRequestRejectInput, SocialFriendRequestSendInput,
    SocialGetCommentsInput, SocialGetFollowersInput, SocialGetFollowingInput, SocialGetMomentInput,
    SocialGetRelationshipInput, SocialGetTimelineInput, SocialListByAuthorInput, SocialReactInput,
    SocialRelationshipMutationInput, SocialStationModerationDeleteInput,
    SocialStationModerationListInput, SocialStationModerationUpsertInput,
    SocialSyncMomentsProjectionInput, SocialUnreactInput,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model;
use crate::state::AppState;

use ed25519_dalek::Signer as _;
use prost::Message;
use reqwest::Method;
use tauri::{State, Window};
use ulid::Ulid;

const FRIEND_REQUEST_COMMAND_FORMAT_VERSION: u32 = 1;
const FRIEND_REQUEST_COMMAND_LIFETIME_SECONDS: i64 = 300;
const SOCIAL_RELATIONSHIP_COMMAND_FORMAT_VERSION: u32 = 1;
const SOCIAL_RELATIONSHIP_COMMAND_LIFETIME_SECONDS: i64 = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn optional_token_from_state_proto(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Option<String> {
    session_resolver::token_for_window(state.inner(), window)
        .filter(|token| !token.trim().is_empty())
}

/// Extract the bearer token tied to the calling window.
fn token_from_state_proto(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Vec<u8>>> {
    optional_token_from_state_proto(state, window)
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))
}

fn friend_request_session(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String, String), AppResult<Vec<u8>>> {
    let session = state
        .sessions
        .get(window.label())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    if session.account_id.trim().is_empty()
        || session.actor.ptid.trim().is_empty()
        || session.jwt.trim().is_empty()
    {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authenticated session is incomplete",
            None,
        ));
    }
    Ok((session.account_id, session.actor.ptid, session.jwt))
}

fn station_error_proto(
    err: station_client::StationClientError,
    context: &str,
) -> AppResult<Vec<u8>> {
    err.into_app_result(context)
}

pub(crate) struct FriendRequestCommandInput {
    pub request_id: String,
    pub action: model::social::FriendRequestAction,
    pub sender_ptid: String,
    pub receiver_ptid: String,
    pub sender_home_station_peer_id: String,
    pub receiver_home_station_peer_id: String,
    pub message: String,
    pub federation_id: String,
}

pub(crate) fn sign_friend_request_command(
    state: &AppState,
    account_id: &str,
    authenticated_ptid: &str,
    input: FriendRequestCommandInput,
) -> Result<model::social::FriendRequestCommand, String> {
    if account_id.trim().is_empty()
        || authenticated_ptid.trim().is_empty()
        || input.request_id.trim().is_empty()
        || input.sender_ptid.trim().is_empty()
        || input.receiver_ptid.trim().is_empty()
        || input.sender_home_station_peer_id.trim().is_empty()
        || input.receiver_home_station_peer_id.trim().is_empty()
        || input.federation_id.trim().is_empty()
        || input.sender_ptid == input.receiver_ptid
    {
        return Err("friend request command identity is incomplete".to_string());
    }
    let local_station_peer_id = station_client::active_station_peer_id()
        .ok_or_else(|| "friend request command requires the active Station peer ID".to_string())?;
    let expected_author = match input.action {
        model::social::FriendRequestAction::Send => {
            if input.sender_home_station_peer_id != local_station_peer_id {
                return Err(
                    "friend request SEND sender Home Station does not match the active Station"
                        .to_string(),
                );
            }
            input.sender_ptid.as_str()
        }
        model::social::FriendRequestAction::Accept | model::social::FriendRequestAction::Reject => {
            if input.receiver_home_station_peer_id != local_station_peer_id {
                return Err(
                    "friend request mutation receiver Home Station does not match the active Station"
                        .to_string(),
                );
            }
            input.receiver_ptid.as_str()
        }
        model::social::FriendRequestAction::Unspecified => {
            return Err("friend request command action is required".to_string());
        }
    };
    if expected_author != authenticated_ptid {
        return Err("friend request command actor does not match the active session".to_string());
    }

    let engine = state
        .messaging_engines
        .get(account_id)?
        .ok_or_else(|| "friend request command requires an active messaging engine".to_string())?;
    if engine.endpoint().ptid != authenticated_ptid {
        return Err("friend request command engine identity mismatch".to_string());
    }
    if engine.store().pending_device_enrollment()?.is_some() {
        return Err("friend request command requires an enrolled device identity".to_string());
    }
    let (signing_key_id, signing_key) = engine.device_signing_identity()?.ok_or_else(|| {
        "friend request command device signing identity is unavailable".to_string()
    })?;

    let now_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "friend request command clock is before the Unix epoch".to_string())?
        .as_secs()
        .try_into()
        .map_err(|_| "friend request command timestamp exceeds i64".to_string())?;
    let body = model::social::FriendRequestCommandBody {
        format_version: FRIEND_REQUEST_COMMAND_FORMAT_VERSION,
        command_id: format!(
            "friend-request:{}:{}",
            input.action.as_str_name().to_ascii_lowercase(),
            input.request_id
        ),
        request_id: input.request_id,
        action: input.action as i32,
        sender: Some(person_actor_ref(input.sender_ptid)),
        receiver: Some(person_actor_ref(input.receiver_ptid)),
        sender_home_station_peer_id: input.sender_home_station_peer_id,
        receiver_home_station_peer_id: input.receiver_home_station_peer_id,
        message: input.message.trim().to_string(),
        observed_request_state: match input.action {
            model::social::FriendRequestAction::Send => {
                model::social::FriendRequestState::Unspecified as i32
            }
            model::social::FriendRequestAction::Accept
            | model::social::FriendRequestAction::Reject => {
                model::social::FriendRequestState::Pending as i32
            }
            model::social::FriendRequestAction::Unspecified => unreachable!(),
        },
        created_at: Some(prost_types::Timestamp {
            seconds: now_seconds,
            nanos: 0,
        }),
        expires_at: Some(prost_types::Timestamp {
            seconds: now_seconds.saturating_add(FRIEND_REQUEST_COMMAND_LIFETIME_SECONDS),
            nanos: 0,
        }),
        authorizing_device: Some(model::actor::ActorDeviceRef {
            actor: Some(person_actor_ref(authenticated_ptid.to_string())),
            device_id: engine.endpoint().device_id.clone(),
        }),
        federation_id: input.federation_id,
    };
    let signing_input = model::social::FriendRequestCommandSigningInput {
        body: Some(body.clone()),
        signing_key_id: signing_key_id.clone(),
    };
    let signature = signing_key.sign(&signing_input.encode_to_vec());
    Ok(model::social::FriendRequestCommand {
        body: Some(body),
        signing_key_id,
        actor_device_signature: signature.to_bytes().to_vec(),
    })
}

pub(crate) fn friend_request_command_device_id(
    command: &model::social::FriendRequestCommand,
) -> Result<&str, String> {
    command
        .body
        .as_ref()
        .and_then(|body| body.authorizing_device.as_ref())
        .map(|device| device.device_id.as_str())
        .filter(|device_id| !device_id.trim().is_empty())
        .ok_or_else(|| "friend request command authorizing device is unavailable".to_string())
}

fn sign_social_relationship_command(
    state: &AppState,
    account_id: &str,
    authenticated_ptid: &str,
    input: SocialRelationshipMutationInput,
    action: model::social::SocialRelationshipAction,
) -> Result<model::social::SocialRelationshipCommand, String> {
    if account_id.trim().is_empty()
        || !authenticated_ptid.starts_with("ptid:")
        || !input.target_actor_ptid.starts_with("ptid:")
        || input.target_actor_ptid == authenticated_ptid
        || input.target_home_station_peer_id.trim().is_empty()
        || input.observed_revision < 0
        || !matches!(
            action,
            model::social::SocialRelationshipAction::Block
                | model::social::SocialRelationshipAction::Unblock
        )
    {
        return Err("Social relationship command identity is incomplete".to_string());
    }
    let actor_home_station_peer_id = station_client::active_station_peer_id()
        .ok_or_else(|| "Social relationship command requires the active Station".to_string())?;
    let engine = state.messaging_engines.get(account_id)?.ok_or_else(|| {
        "Social relationship command requires an active messaging engine".to_string()
    })?;
    if engine.endpoint().ptid != authenticated_ptid {
        return Err("Social relationship command engine identity mismatch".to_string());
    }
    if engine.store().pending_device_enrollment()?.is_some() {
        return Err("Social relationship command requires an enrolled device identity".to_string());
    }
    let (signing_key_id, signing_key) = engine.device_signing_identity()?.ok_or_else(|| {
        "Social relationship command device signing identity is unavailable".to_string()
    })?;
    let now_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Social relationship command clock is before the Unix epoch".to_string())?
        .as_secs()
        .try_into()
        .map_err(|_| "Social relationship command timestamp exceeds i64".to_string())?;
    let actor = person_actor_ref(authenticated_ptid.to_string());
    let body = model::social::SocialRelationshipCommandBody {
        format_version: SOCIAL_RELATIONSHIP_COMMAND_FORMAT_VERSION,
        command_id: format!(
            "social-relationship:{}:{}",
            action.as_str_name().to_ascii_lowercase(),
            Ulid::new(),
        ),
        action: action as i32,
        actor: Some(actor.clone()),
        target_actor: Some(person_actor_ref(input.target_actor_ptid)),
        actor_home_station_peer_id,
        target_home_station_peer_id: input.target_home_station_peer_id,
        observed_revision: input.observed_revision,
        created_at: Some(prost_types::Timestamp {
            seconds: now_seconds,
            nanos: 0,
        }),
        expires_at: Some(prost_types::Timestamp {
            seconds: now_seconds.saturating_add(SOCIAL_RELATIONSHIP_COMMAND_LIFETIME_SECONDS),
            nanos: 0,
        }),
        authorizing_device: Some(model::actor::ActorDeviceRef {
            actor: Some(actor),
            device_id: engine.endpoint().device_id.clone(),
        }),
    };
    let signing_input = model::social::SocialRelationshipCommandSigningInput {
        body: Some(body.clone()),
        signing_key_id: signing_key_id.clone(),
    };
    let signature = signing_key.sign(&signing_input.encode_to_vec());
    Ok(model::social::SocialRelationshipCommand {
        body: Some(body),
        signing_key_id,
        actor_device_signature: signature.to_bytes().to_vec(),
    })
}

fn social_relationship_command_device_id(
    command: &model::social::SocialRelationshipCommand,
) -> Result<&str, String> {
    command
        .body
        .as_ref()
        .and_then(|body| body.authorizing_device.as_ref())
        .map(|device| device.device_id.as_str())
        .filter(|device_id| !device_id.trim().is_empty())
        .ok_or_else(|| "Social relationship command authorizing device is unavailable".to_string())
}

fn person_actor_ref(ptid: String) -> model::actor::ActorRef {
    model::actor::ActorRef {
        ptid,
        kind: model::actor::ActorKind::Person as i32,
        ..Default::default()
    }
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

fn get_proto_optional_auth<Resp: Message + Default>(
    path: &str,
    token: Option<&str>,
    query: Option<&[(&str, String)]>,
) -> Result<Resp, station_client::StationClientError> {
    station_client::request_proto_optional_auth::<(), Resp>(Method::GET, path, token, query, None)
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
///   - The proto `Audience { kind, target: circle_id | group_conversation_id,
///     base_kind?, actor_ptids[] }`
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
    let token = optional_token_from_state_proto(&state, &window);
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let path = format!("/api/v1/social/moments/{}", input.id);
    let resp: model::social::GetPostResponse =
        match get_proto_optional_auth(&path, token.as_deref(), None) {
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
    let timeline_type = match input.station_timeline_type() {
        Some(value) => value.to_string(),
        None => {
            return AppResult::fail(ErrorCode::InvalidArgument, "timeline type is invalid", None)
        }
    };
    let token = optional_token_from_state_proto(&state, &window);
    if timeline_type != "TIMELINE_PUBLIC" && token.is_none() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let mut query: Vec<(&str, String)> = Vec::new();
    query.push(("type", timeline_type));
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
        match get_proto_optional_auth("/api/v1/social/timeline", token.as_deref(), Some(&query)) {
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
    let token = optional_token_from_state_proto(&state, &window);
    if input.author_ptid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "author_ptid is required", None);
    }
    let mut query: Vec<(&str, String)> = vec![
        ("type", "TIMELINE_USER".to_string()),
        ("actor_ptid", input.author_ptid),
    ];
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    if let Some(l) = input.limit {
        query.push(("limit", l.to_string()));
    }
    let resp: model::social::ListPostsResponse =
        match get_proto_optional_auth("/api/v1/social/timeline", token.as_deref(), Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "list by author failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/// Reactions use the canonical Moments route family.
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
        command_id: String::new(),
        actor_signing_key_id: String::new(),
        actor_device_signature: Vec::new(),
    };
    let path = format!("/api/v1/social/moments/{}/react", input.post_id);
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
        command_id: String::new(),
        actor_signing_key_id: String::new(),
        actor_device_signature: Vec::new(),
    };
    let path = format!("/api/v1/social/moments/{}/unreact", input.post_id);
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
    let token = optional_token_from_state_proto(&state, &window);
    if input.post_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "post_id is required", None);
    }
    let limit = input.limit.unwrap_or(20);
    if !(1..=100).contains(&limit) {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "comment limit must be between 1 and 100",
            None,
        );
    }
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(c) = input.cursor {
        if !c.is_empty() {
            query.push(("cursor", c));
        }
    }
    query.push(("limit", limit.to_string()));
    let path = format!("/api/v1/social/moments/{}/comments", input.post_id);
    let resp: model::social::ListMomentCommentsResponse =
        match get_proto_optional_auth(&path, token.as_deref(), Some(&query)) {
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
    if input.target_actor_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_actor_ptid is required",
            None,
        );
    }
    let req = model::social::FollowRequest {
        target_actor_ptid: input.target_actor_ptid,
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
    input: SocialFollowInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.target_actor_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_actor_ptid is required",
            None,
        );
    }
    let req = model::social::UnfollowRequest {
        target_actor_ptid: input.target_actor_ptid,
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
    if let Some(actor_ptid) = input.actor_ptid {
        if !actor_ptid.is_empty() {
            query.push(("actor_ptid", actor_ptid));
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
    if let Some(actor_ptid) = input.actor_ptid {
        if !actor_ptid.is_empty() {
            query.push(("actor_ptid", actor_ptid));
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
    if input.target_actor_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_actor_ptid is required",
            None,
        );
    }
    let query = vec![("target_actor_ptid", input.target_actor_ptid)];
    let resp: model::social::GetRelationshipResponse =
        match get_proto("/api/v1/social/relationships", &token, Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "get relationship failed"),
        };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn social_block_actor(
    input: SocialRelationshipMutationInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (account_id, actor_ptid, token) = match friend_request_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    if input.target_actor_ptid.trim().is_empty()
        || input.target_home_station_peer_id.trim().is_empty()
        || input.observed_revision < 0
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Social relationship block input is incomplete",
            None,
        );
    }
    let command = match sign_social_relationship_command(
        state.inner(),
        &account_id,
        &actor_ptid,
        input,
        model::social::SocialRelationshipAction::Block,
    ) {
        Ok(command) => command,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let device_id = match social_relationship_command_device_id(&command) {
        Ok(device_id) => device_id.to_string(),
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let request = model::social::BlockSocialActorRequest {
        command: Some(command),
    };
    let response: model::social::BlockSocialActorResponse =
        match station_client::request_proto_for_device(
            Method::POST,
            "/api/v1/social/relationships/block",
            &token,
            None,
            Some(&request),
            &device_id,
        ) {
            Ok(response) => response,
            Err(error) => return station_error_proto(error, "block Social actor failed"),
        };
    AppResult::success(response.encode_to_vec())
}

#[tauri::command]
pub fn social_unblock_actor(
    input: SocialRelationshipMutationInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (account_id, actor_ptid, token) = match friend_request_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    if input.target_actor_ptid.trim().is_empty()
        || input.target_home_station_peer_id.trim().is_empty()
        || input.observed_revision < 0
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Social relationship unblock input is incomplete",
            None,
        );
    }
    let command = match sign_social_relationship_command(
        state.inner(),
        &account_id,
        &actor_ptid,
        input,
        model::social::SocialRelationshipAction::Unblock,
    ) {
        Ok(command) => command,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let device_id = match social_relationship_command_device_id(&command) {
        Ok(device_id) => device_id.to_string(),
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let request = model::social::UnblockSocialActorRequest {
        command: Some(command),
    };
    let response: model::social::UnblockSocialActorResponse =
        match station_client::request_proto_for_device(
            Method::POST,
            "/api/v1/social/relationships/unblock",
            &token,
            None,
            Some(&request),
            &device_id,
        ) {
            Ok(response) => response,
            Err(error) => return station_error_proto(error, "unblock Social actor failed"),
        };
    AppResult::success(response.encode_to_vec())
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
        member_ptids: input.member_ptids.unwrap_or_default(),
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
    if input.member_ptids.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "member_ptids is required", None);
    }
    let circle_id_num = match parse_circle_id(&input.circle_id) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let req = model::social::AddCircleMemberRequest {
        circle_id: circle_id_num,
        member_ptids: input.member_ptids,
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
    if input.member_ptids.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "member_ptids is required", None);
    }
    let circle_id_num = match parse_circle_id(&input.circle_id) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let req = model::social::RemoveCircleMemberRequest {
        circle_id: circle_id_num,
        member_ptids: input.member_ptids,
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
    let (account_id, actor_ptid, token) = match friend_request_session(&state, &window) {
        Ok(session) => session,
        Err(e) => return e,
    };
    if input.receiver_ptid.trim().is_empty()
        || input.receiver_home_station_peer_id.trim().is_empty()
        || input.federation_id.trim().is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "receiver_ptid, receiver_home_station_peer_id, and federation_id are required",
            None,
        );
    }
    let sender_home_station_peer_id = match station_client::active_station_peer_id() {
        Some(peer_id) => peer_id,
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "active Station peer ID is unavailable",
                None,
            );
        }
    };
    let request_id = Ulid::new().to_string();
    let command = match sign_friend_request_command(
        state.inner(),
        &account_id,
        &actor_ptid,
        FriendRequestCommandInput {
            request_id,
            action: model::social::FriendRequestAction::Send,
            sender_ptid: actor_ptid.clone(),
            receiver_ptid: input.receiver_ptid,
            sender_home_station_peer_id,
            receiver_home_station_peer_id: input.receiver_home_station_peer_id,
            message: input.message.unwrap_or_default(),
            federation_id: input.federation_id,
        },
    ) {
        Ok(command) => command,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let device_id = match friend_request_command_device_id(&command) {
        Ok(device_id) => device_id.to_string(),
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let req = model::social::SendSocialFriendRequestRequest {
        command: Some(command),
    };
    let resp: model::social::SendSocialFriendRequestResponse =
        match station_client::request_proto_for_device(
            Method::POST,
            "/api/v1/social/friend-request/send",
            &token,
            None,
            Some(&req),
            &device_id,
        ) {
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
    let (account_id, actor_ptid, token) = match friend_request_session(&state, &window) {
        Ok(session) => session,
        Err(e) => return e,
    };
    if input.request_id.trim().is_empty()
        || input.sender_ptid.trim().is_empty()
        || input.sender_home_station_peer_id.trim().is_empty()
        || input.federation_id.trim().is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "friend request acceptance context is incomplete",
            None,
        );
    }
    let receiver_home_station_peer_id = match station_client::active_station_peer_id() {
        Some(peer_id) => peer_id,
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "active Station peer ID is unavailable",
                None,
            );
        }
    };
    let command = match sign_friend_request_command(
        state.inner(),
        &account_id,
        &actor_ptid,
        FriendRequestCommandInput {
            request_id: input.request_id,
            action: model::social::FriendRequestAction::Accept,
            sender_ptid: input.sender_ptid,
            receiver_ptid: actor_ptid.clone(),
            sender_home_station_peer_id: input.sender_home_station_peer_id,
            receiver_home_station_peer_id,
            message: input.message.unwrap_or_default(),
            federation_id: input.federation_id,
        },
    ) {
        Ok(command) => command,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let device_id = match friend_request_command_device_id(&command) {
        Ok(device_id) => device_id.to_string(),
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let req = model::social::AcceptSocialFriendRequestRequest {
        command: Some(command),
    };
    let resp: model::social::AcceptSocialFriendRequestResponse =
        match station_client::request_proto_for_device(
            Method::POST,
            "/api/v1/social/friend-request/accept",
            &token,
            None,
            Some(&req),
            &device_id,
        ) {
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
    let (account_id, actor_ptid, token) = match friend_request_session(&state, &window) {
        Ok(session) => session,
        Err(e) => return e,
    };
    if input.request_id.trim().is_empty()
        || input.sender_ptid.trim().is_empty()
        || input.sender_home_station_peer_id.trim().is_empty()
        || input.federation_id.trim().is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "friend request rejection context is incomplete",
            None,
        );
    }
    let receiver_home_station_peer_id = match station_client::active_station_peer_id() {
        Some(peer_id) => peer_id,
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "active Station peer ID is unavailable",
                None,
            );
        }
    };
    let command = match sign_friend_request_command(
        state.inner(),
        &account_id,
        &actor_ptid,
        FriendRequestCommandInput {
            request_id: input.request_id,
            action: model::social::FriendRequestAction::Reject,
            sender_ptid: input.sender_ptid,
            receiver_ptid: actor_ptid.clone(),
            sender_home_station_peer_id: input.sender_home_station_peer_id,
            receiver_home_station_peer_id,
            message: input.message.unwrap_or_default(),
            federation_id: input.federation_id,
        },
    ) {
        Ok(command) => command,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let device_id = match friend_request_command_device_id(&command) {
        Ok(device_id) => device_id.to_string(),
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let req = model::social::RejectSocialFriendRequestRequest {
        command: Some(command),
    };
    let resp: model::social::RejectSocialFriendRequestResponse =
        match station_client::request_proto_for_device(
            Method::POST,
            "/api/v1/social/friend-request/reject",
            &token,
            None,
            Some(&req),
            &device_id,
        ) {
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
        query.push(("state", status.to_string()));
    }
    query.push(("limit", input.limit.unwrap_or(50).clamp(1, 200).to_string()));
    query.push(("offset", input.offset.unwrap_or(0).to_string()));
    let resp: model::social::ListSocialFriendRequestsResponse =
        match get_proto("/api/v1/social/friend-requests", &token, Some(&query)) {
            Ok(r) => r,
            Err(e) => return station_error_proto(e, "list friend requests failed"),
        };
    AppResult::success(resp.encode_to_vec())
}
