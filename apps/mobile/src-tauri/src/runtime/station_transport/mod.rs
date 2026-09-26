use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::multipart::{Form, Part};
use reqwest::{Client, Method, RequestBuilder, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::async_runtime::{channel, JoinHandle};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::session::{authenticated_native_session, AuthenticatedNativeSession};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const REALTIME_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_JSON_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_BINARY_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const MAX_REALTIME_CHUNK_BYTES: usize = 1024 * 1024;
const REALTIME_EVENT: &str = "mobile:station-realtime";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ActorProfileUpdateInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    manually_approves_followers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_permission: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_expire_days: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    discoverability: Option<String>,
    observed_revision: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NotificationPreferencePatchInput {
    category: i32,
    enabled: bool,
    push_enabled: bool,
    sound_enabled: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NotificationPreferencesUpdateInput {
    updates: Vec<NotificationPreferencePatchInput>,
    observed_revision: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ConversationMemberSettingsUpdateInput {
    conversation_id: String,
    settings: ConversationMemberSettingsInput,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ConversationMemberSettingsInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    muted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    alert_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cleared_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StationTransportExecuteInput {
    request_id: String,
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
    operation: StationOperation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StationTransportCancelInput {
    request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operationId", rename_all = "snake_case", deny_unknown_fields)]
enum StationOperation {
    ActorProfileGet {},
    ActorProfileUpdate {
        input: ActorProfileUpdateInput,
    },
    ActorProfileGetPeer {
        ptid: String,
    },
    ActorSearch {
        query: String,
    },
    FederationContextsList {},
    FederationResolve {
        federation_id: String,
        handle: String,
    },
    FederationCatalogSearch {
        federation_id: String,
        prefix: String,
        page_size: u32,
    },
    NotificationList {
        limit: u32,
        cursor: Option<String>,
    },
    NotificationUnreadCounts {},
    NotificationMarkRead {
        notification_ids: Vec<String>,
    },
    NotificationMarkAllRead {
        category: i32,
    },
    NotificationDelete {
        notification_ids: Vec<String>,
    },
    NotificationPreferencesGet {},
    NotificationPreferencesUpdate {
        input: NotificationPreferencesUpdateInput,
    },
    ConversationMembersList {
        conversation_id: String,
    },
    ConversationMemberSettingsGet {
        conversation_id: String,
    },
    ConversationMemberSettingsUpdate {
        input: ConversationMemberSettingsUpdateInput,
    },
    SocialFriendRequestsList {
        state: i32,
        limit: u32,
        offset: u32,
    },
    SocialBlockedList {
        limit: u32,
        cursor: Option<String>,
    },
    SocialFriendshipStatus {
        target_ptid: String,
    },
    MomentsTimeline {
        timeline_type: i32,
        cursor: Option<String>,
        limit: u32,
    },
    MomentsPostGet {
        post_id: String,
    },
    MomentsReact {
        post_id: String,
        reaction_kind: i32,
    },
    MomentsUnreact {
        post_id: String,
        reaction_kind: i32,
    },
    MomentsCommentsList {
        post_id: String,
        cursor: Option<String>,
        limit: u32,
    },
    MomentsCommentCreate {
        post_id: String,
        content: String,
        reply_to_comment_id: Option<String>,
    },
    MomentsCommentDelete {
        comment_id: String,
    },
    MomentsCreate {
        body_bytes: Vec<u8>,
    },
    OssDownload {
        key: String,
    },
    PresenceHeartbeat {
        reason: String,
    },
    PresenceOffline {
        reason: String,
    },
    RealtimeSignalSend {
        recipient_ptid: String,
        session_ulid: String,
        kind: String,
        payload_b64: String,
        call_id: String,
        device_id: String,
    },
    RealtimeCallResolutionGet {
        call_id: String,
        peer_actor_ptid: String,
    },
    TurnIceServers {},
}

impl StationOperation {
    fn id(&self) -> &'static str {
        match self {
            Self::ActorProfileGet {} => "actor_profile_get",
            Self::ActorProfileUpdate { .. } => "actor_profile_update",
            Self::ActorProfileGetPeer { .. } => "actor_profile_get_peer",
            Self::ActorSearch { .. } => "actor_search",
            Self::FederationContextsList {} => "federation_contexts_list",
            Self::FederationResolve { .. } => "federation_resolve",
            Self::FederationCatalogSearch { .. } => "federation_catalog_search",
            Self::NotificationList { .. } => "notification_list",
            Self::NotificationUnreadCounts {} => "notification_unread_counts",
            Self::NotificationMarkRead { .. } => "notification_mark_read",
            Self::NotificationMarkAllRead { .. } => "notification_mark_all_read",
            Self::NotificationDelete { .. } => "notification_delete",
            Self::NotificationPreferencesGet {} => "notification_preferences_get",
            Self::NotificationPreferencesUpdate { .. } => "notification_preferences_update",
            Self::ConversationMembersList { .. } => "conversation_members_list",
            Self::ConversationMemberSettingsGet { .. } => "conversation_member_settings_get",
            Self::ConversationMemberSettingsUpdate { .. } => "conversation_member_settings_update",
            Self::SocialFriendRequestsList { .. } => "social_friend_requests_list",
            Self::SocialBlockedList { .. } => "social_blocked_list",
            Self::SocialFriendshipStatus { .. } => "social_friendship_status",
            Self::MomentsTimeline { .. } => "moments_timeline",
            Self::MomentsPostGet { .. } => "moments_post_get",
            Self::MomentsReact { .. } => "moments_react",
            Self::MomentsUnreact { .. } => "moments_unreact",
            Self::MomentsCommentsList { .. } => "moments_comments_list",
            Self::MomentsCommentCreate { .. } => "moments_comment_create",
            Self::MomentsCommentDelete { .. } => "moments_comment_delete",
            Self::MomentsCreate { .. } => "moments_create",
            Self::OssDownload { .. } => "oss_download",
            Self::PresenceHeartbeat { .. } => "presence_heartbeat",
            Self::PresenceOffline { .. } => "presence_offline",
            Self::RealtimeSignalSend { .. } => "realtime_signal_send",
            Self::RealtimeCallResolutionGet { .. } => "realtime_call_resolution_get",
            Self::TurnIceServers {} => "turn_ice_servers",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationTransportResponse {
    status: u16,
    content_type: String,
    body_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeFileUpload {
    pub reference: String,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StationRealtimeStartInput {
    request_id: String,
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
    resume_cursor: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StationRealtimeStopInput {
    stream_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRealtimeHandle {
    stream_id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StationRealtimeEvent {
    stream_id: u64,
    kind: &'static str,
    chunk_bytes: Vec<u8>,
}

struct ActiveRealtime {
    stream_id: u64,
    task: JoinHandle<()>,
}

enum ActiveRequest {
    Running(JoinHandle<()>),
    Cancelled,
}

pub struct StationTransportRuntime {
    realtime: Mutex<Option<ActiveRealtime>>,
    requests: Mutex<HashMap<String, ActiveRequest>>,
    next_stream_id: AtomicU64,
}

impl Default for StationTransportRuntime {
    fn default() -> Self {
        Self {
            realtime: Mutex::new(None),
            requests: Mutex::new(HashMap::new()),
            next_stream_id: AtomicU64::new(0),
        }
    }
}

impl StationTransportRuntime {
    fn install_realtime<R: Runtime>(
        &self,
        app: AppHandle<R>,
        mut response: Response,
    ) -> MobileResult<StationRealtimeHandle> {
        let stream_id = self
            .next_stream_id
            .fetch_add(1, Ordering::AcqRel)
            .checked_add(1)
            .ok_or_else(|| transport_error("realtime_stream", "generation_overflow"))?;
        let stream_app = app.clone();
        let task = tauri::async_runtime::spawn(async move {
            emit_realtime(&stream_app, stream_id, "connected", Vec::new());
            loop {
                match response.chunk().await {
                    Ok(Some(chunk)) if chunk.len() <= MAX_REALTIME_CHUNK_BYTES => {
                        emit_realtime(&stream_app, stream_id, "chunk", chunk.to_vec());
                    }
                    Ok(Some(_)) | Err(_) => {
                        emit_realtime(&stream_app, stream_id, "error", Vec::new());
                        return;
                    }
                    Ok(None) => {
                        emit_realtime(&stream_app, stream_id, "closed", Vec::new());
                        return;
                    }
                }
            }
        });
        {
            let mut active = self
                .realtime
                .lock()
                .map_err(|_| transport_error("realtime_stream", "runtime_lock"))?;
            if let Some(previous) = active.take() {
                previous.task.abort();
                emit_realtime(&app, previous.stream_id, "closed", Vec::new());
            }
            *active = Some(ActiveRealtime { stream_id, task });
        }
        Ok(StationRealtimeHandle { stream_id })
    }

    fn stop_realtime<R: Runtime>(&self, app: &AppHandle<R>, stream_id: u64) -> MobileResult<()> {
        let mut active = self
            .realtime
            .lock()
            .map_err(|_| transport_error("realtime_stream", "runtime_lock"))?;
        if active
            .as_ref()
            .is_some_and(|stream| stream.stream_id == stream_id)
        {
            if let Some(stream) = active.take() {
                stream.task.abort();
                emit_realtime(app, stream_id, "closed", Vec::new());
            }
        }
        Ok(())
    }

    fn install_request(&self, request_id: String, task: JoinHandle<()>) -> MobileResult<()> {
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| transport_error("request", "runtime_lock"))?;
        match requests.remove(&request_id) {
            Some(ActiveRequest::Cancelled) => {
                task.abort();
                Err(transport_error("request", "cancelled"))
            }
            Some(ActiveRequest::Running(previous)) => {
                requests.insert(request_id, ActiveRequest::Running(previous));
                task.abort();
                Err(transport_error("request", "duplicate_request_id"))
            }
            None => {
                requests.insert(request_id, ActiveRequest::Running(task));
                Ok(())
            }
        }
    }

    fn finish_request(&self, request_id: &str) -> MobileResult<()> {
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| transport_error("request", "runtime_lock"))?;
        if matches!(requests.get(request_id), Some(ActiveRequest::Running(_))) {
            requests.remove(request_id);
        }
        Ok(())
    }

    fn cancel_request(&self, request_id: String) -> MobileResult<()> {
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| transport_error("request", "runtime_lock"))?;
        match requests.remove(&request_id) {
            Some(ActiveRequest::Running(task)) => task.abort(),
            Some(ActiveRequest::Cancelled) => {
                requests.insert(request_id, ActiveRequest::Cancelled);
            }
            None => {
                requests.insert(request_id, ActiveRequest::Cancelled);
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn station_transport_execute(
    runtime: State<'_, StationTransportRuntime>,
    storage: State<'_, SecureStorage>,
    input: StationTransportExecuteInput,
) -> MobileResult<StationTransportResponse> {
    let request_id = clean_required(input.request_id, 128, "request_id")?;
    let session = authenticated_native_session(
        &storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    let (sender, mut receiver) = channel(1);
    let task = tauri::async_runtime::spawn(async move {
        let result = execute_operation(&session, input.operation).await;
        let _ = sender.send(result).await;
    });
    runtime.install_request(request_id.clone(), task)?;
    let result = receiver
        .recv()
        .await
        .ok_or_else(|| transport_error("request", "cancelled"));
    runtime.finish_request(&request_id)?;
    result?
}

#[tauri::command]
pub fn station_transport_cancel(
    runtime: State<'_, StationTransportRuntime>,
    input: StationTransportCancelInput,
) -> MobileResult<()> {
    runtime.cancel_request(clean_required(input.request_id, 128, "request_id")?)
}

#[tauri::command]
pub async fn station_realtime_start<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, StationTransportRuntime>,
    storage: State<'_, SecureStorage>,
    input: StationRealtimeStartInput,
) -> MobileResult<StationRealtimeHandle> {
    let request_id = clean_required(input.request_id, 128, "request_id")?;
    let session = authenticated_native_session(
        &storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    let cursor = clean_optional(input.resume_cursor, 1024, "resume_cursor")?;
    let (sender, mut receiver) = channel(1);
    let task = tauri::async_runtime::spawn(async move {
        let result = open_realtime_response(&session, cursor.as_deref()).await;
        let _ = sender.send(result).await;
    });
    runtime.install_request(request_id.clone(), task)?;
    let response = receiver
        .recv()
        .await
        .ok_or_else(|| transport_error("realtime_stream", "cancelled"));
    runtime.finish_request(&request_id)?;
    let response = response??;
    runtime.install_realtime(app, response)
}

#[tauri::command]
pub fn station_realtime_stop<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, StationTransportRuntime>,
    input: StationRealtimeStopInput,
) -> MobileResult<()> {
    runtime.stop_realtime(&app, input.stream_id)
}

async fn execute_operation(
    session: &AuthenticatedNativeSession,
    operation: StationOperation,
) -> MobileResult<StationTransportResponse> {
    let operation_id = operation.id();
    let client = authenticated_client(REQUEST_TIMEOUT, operation_id)?;
    let request = build_request(&client, session, operation)?;
    let response = request
        .send()
        .await
        .map_err(|error| request_error(operation_id, &error))?;
    response_projection(operation_id, response).await
}

pub(crate) async fn execute_native_json(
    session: &AuthenticatedNativeSession,
    operation_id: &'static str,
    path: &'static str,
    body: Vec<u8>,
) -> MobileResult<(u16, Vec<u8>)> {
    let client = authenticated_client(REQUEST_TIMEOUT, operation_id)?;
    let response = json_request(&client, session, Method::POST, path, body)?
        .send()
        .await
        .map_err(|error| request_error(operation_id, &error))?;
    let projection = response_projection(operation_id, response).await?;
    Ok((projection.status, projection.body_bytes))
}

pub(crate) async fn upload_native_file(
    session: &AuthenticatedNativeSession,
    operation_id: &'static str,
    path: &Path,
    filename: &str,
    bucket: &'static str,
    visibility: &'static str,
    expected_size: u64,
    expected_sha256_hex: &str,
) -> MobileResult<NativeFileUpload> {
    if expected_size == 0 || expected_size > MAX_BINARY_REQUEST_BYTES as u64 {
        return Err(transport_error(operation_id, "file_size_invalid"));
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| transport_error(operation_id, "file_missing"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() != expected_size {
        return Err(transport_error(operation_id, "file_invalid"));
    }
    let filename = clean_header_value(filename.to_string(), 512, "filename")?;
    let file = Part::file(path)
        .await
        .map_err(|_| transport_error(operation_id, "file_open"))?
        .file_name(filename)
        .mime_str("application/octet-stream")
        .map_err(|_| transport_error(operation_id, "file_mime"))?;
    let form = Form::new()
        .text("bucket", bucket)
        .text("visibility", visibility)
        .part("file", file);
    let client = authenticated_client(REQUEST_TIMEOUT, operation_id)?;
    let response = authenticated_request(
        &client,
        session,
        Method::POST,
        fixed_url(session, "/sub-oss/upload")?,
    )
    .multipart(form)
    .send()
    .await
    .map_err(|error| request_error(operation_id, &error))?;
    let projection = response_projection(operation_id, response).await?;
    if !(200..300).contains(&projection.status) {
        return Err(transport_error(
            operation_id,
            &format!("http_{}", projection.status),
        ));
    }
    let uploaded: NativeFileUploadResponse = serde_json::from_slice(&projection.body_bytes)
        .map_err(|_| transport_error(operation_id, "response_decode"))?;
    if uploaded.size != expected_size {
        return Err(transport_error(operation_id, "response_size_mismatch"));
    }
    let reference = if uploaded.cid.trim().is_empty() {
        uploaded.url.trim().to_string()
    } else {
        uploaded.cid.trim().to_string()
    };
    if reference.is_empty() {
        return Err(transport_error(operation_id, "response_reference_missing"));
    }
    let sha256_hex = uploaded
        .sha256
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    if sha256_hex
        .as_deref()
        .is_some_and(|value| value != expected_sha256_hex)
    {
        return Err(transport_error(operation_id, "response_hash_mismatch"));
    }
    Ok(NativeFileUpload {
        reference,
        size: uploaded.size,
    })
}

#[derive(Debug, Deserialize)]
struct NativeFileUploadResponse {
    #[serde(default)]
    cid: String,
    #[serde(default)]
    url: String,
    size: u64,
    #[serde(default)]
    sha256: Option<String>,
}

fn build_request(
    client: &Client,
    session: &AuthenticatedNativeSession,
    operation: StationOperation,
) -> MobileResult<RequestBuilder> {
    let request = match operation {
        StationOperation::ActorProfileGet {} => authenticated_request(
            client,
            session,
            Method::GET,
            fixed_url(session, "/actor/profile")?,
        ),
        StationOperation::ActorProfileUpdate { input } => {
            validate_optional_text(input.display_name.as_deref(), 512, "display_name")?;
            validate_optional_text(input.note.as_deref(), 32 * 1024, "note")?;
            validate_optional_text(input.avatar.as_deref(), 4096, "avatar")?;
            validate_optional_text(input.header.as_deref(), 4096, "header")?;
            validate_optional_text(input.region.as_deref(), 256, "region")?;
            validate_optional_text(input.timezone.as_deref(), 256, "timezone")?;
            validate_optional_text(
                input.default_visibility.as_deref(),
                128,
                "default_visibility",
            )?;
            validate_optional_text(
                input.message_permission.as_deref(),
                128,
                "message_permission",
            )?;
            validate_optional_text(input.discoverability.as_deref(), 64, "discoverability")?;
            validate_revision(&input.observed_revision, "actor_profile_update")?;
            let body = typed_json_body(&input, "actor_profile_update")?;
            json_request(client, session, Method::POST, "/actor/profile", body)?
        }
        StationOperation::ActorProfileGetPeer { ptid } => authenticated_request(
            client,
            session,
            Method::GET,
            url_with_segments(
                session,
                &["actor", "actors"],
                &[clean_id(ptid, "ptid")?, "profile".to_string()],
            )?,
        ),
        StationOperation::ActorSearch { query } => {
            let mut url = fixed_url(session, "/api/v1/social/users/search")?;
            url.query_pairs_mut()
                .append_pair("q", &clean_required(query, 512, "query")?);
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::FederationContextsList {} => authenticated_request(
            client,
            session,
            Method::GET,
            fixed_url(session, "/sub-federation/contexts")?,
        ),
        StationOperation::FederationResolve {
            federation_id,
            handle,
        } => {
            let mut url = fixed_url(session, "/actor/federation/resolve")?;
            url.query_pairs_mut()
                .append_pair("federation_id", &clean_id(federation_id, "federation_id")?)
                .append_pair("handle", &clean_required(handle, 512, "handle")?);
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::FederationCatalogSearch {
            federation_id,
            prefix,
            page_size,
        } => {
            bounded_limit(page_size, 100, "federation_catalog_search")?;
            let body = serde_json::to_vec(&json!({
                "federation_id": clean_id(federation_id, "federation_id")?,
                "prefix": clean_required(prefix, 512, "prefix")?,
                "page_size": page_size,
            }))
            .map_err(|_| transport_error("federation_catalog_search", "encode"))?;
            json_request(
                client,
                session,
                Method::POST,
                "/sub-federation/catalog/search",
                body,
            )?
        }
        StationOperation::NotificationList { limit, cursor } => {
            let mut url = fixed_url(session, "/notification/list")?;
            bounded_limit(limit, 200, "notification_list")?;
            url.query_pairs_mut()
                .append_pair("limit", &limit.to_string());
            if let Some(cursor) = clean_optional(cursor.unwrap_or_default(), 2048, "cursor")? {
                url.query_pairs_mut().append_pair("cursor", &cursor);
            }
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::NotificationUnreadCounts {} => authenticated_request(
            client,
            session,
            Method::GET,
            fixed_url(session, "/notification/unread-counts")?,
        ),
        StationOperation::NotificationMarkRead { notification_ids } => json_request(
            client,
            session,
            Method::POST,
            "/notification/mark-read",
            list_body(
                "notification_ids",
                notification_ids,
                "notification_mark_read",
            )?,
        )?,
        StationOperation::NotificationMarkAllRead { category } => json_request(
            client,
            session,
            Method::POST,
            "/notification/mark-all-read",
            serde_json::to_vec(&json!({ "category": category }))
                .map_err(|_| transport_error("notification_mark_all_read", "encode"))?,
        )?,
        StationOperation::NotificationDelete { notification_ids } => json_request(
            client,
            session,
            Method::POST,
            "/notification/delete",
            list_body("notification_ids", notification_ids, "notification_delete")?,
        )?,
        StationOperation::NotificationPreferencesGet {} => authenticated_request(
            client,
            session,
            Method::GET,
            fixed_url(session, "/notification/preferences")?,
        ),
        StationOperation::NotificationPreferencesUpdate { input } => {
            validate_revision(&input.observed_revision, "notification_preferences_update")?;
            if input.updates.is_empty() {
                return Err(transport_error(
                    "notification_preferences_update",
                    "updates_empty",
                ));
            }
            let mut categories = HashSet::with_capacity(input.updates.len());
            for update in &input.updates {
                if update.category == 0 || !categories.insert(update.category) {
                    return Err(transport_error(
                        "notification_preferences_update",
                        "category_invalid",
                    ));
                }
            }
            let body = typed_json_body(&input, "notification_preferences_update")?;
            json_request(
                client,
                session,
                Method::POST,
                "/notification/preferences",
                body,
            )?
        }
        StationOperation::ConversationMembersList { conversation_id } => {
            let mut url = fixed_url(session, "/conversation/members")?;
            url.query_pairs_mut().append_pair(
                "conversation_id",
                &clean_id(conversation_id, "conversation_id")?,
            );
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::ConversationMemberSettingsGet { conversation_id } => {
            let mut url = fixed_url(session, "/conversation/member/settings")?;
            url.query_pairs_mut().append_pair(
                "conversation_id",
                &clean_id(conversation_id, "conversation_id")?,
            );
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::ConversationMemberSettingsUpdate { mut input } => {
            input.conversation_id = clean_id(input.conversation_id, "conversation_id")?;
            validate_optional_text(input.settings.nickname.as_deref(), 512, "nickname")?;
            validate_optional_text(input.settings.background.as_deref(), 512, "background")?;
            let body = typed_json_body(&input, "conversation_member_settings_update")?;
            json_request(
                client,
                session,
                Method::PUT,
                "/conversation/member/settings",
                body,
            )?
        }
        StationOperation::SocialFriendRequestsList {
            state,
            limit,
            offset,
        } => {
            bounded_limit(limit, 200, "social_friend_requests_list")?;
            let mut url = fixed_url(session, "/api/v1/social/friend-requests")?;
            url.query_pairs_mut()
                .append_pair("state", &state.to_string())
                .append_pair("limit", &limit.to_string())
                .append_pair("offset", &offset.to_string());
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::SocialBlockedList { limit, cursor } => {
            bounded_limit(limit, 200, "social_blocked_list")?;
            let mut url = fixed_url(session, "/api/v1/social/relationships/blocked")?;
            url.query_pairs_mut()
                .append_pair("limit", &limit.to_string());
            if let Some(cursor) = clean_optional(cursor.unwrap_or_default(), 2048, "cursor")? {
                url.query_pairs_mut().append_pair("cursor", &cursor);
            }
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::SocialFriendshipStatus { target_ptid } => {
            let mut url = fixed_url(session, "/api/v1/social/relationships/status")?;
            url.query_pairs_mut()
                .append_pair("target_ptid", &clean_id(target_ptid, "target_ptid")?);
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::MomentsTimeline {
            timeline_type,
            cursor,
            limit,
        } => {
            bounded_limit(limit, 200, "moments_timeline")?;
            let mut url = fixed_url(session, "/api/v1/social/timeline")?;
            url.query_pairs_mut()
                .append_pair("type", &timeline_type.to_string())
                .append_pair("limit", &limit.to_string());
            if let Some(cursor) = clean_optional(cursor.unwrap_or_default(), 2048, "cursor")? {
                url.query_pairs_mut().append_pair("cursor", &cursor);
            }
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::MomentsPostGet { post_id } => authenticated_request(
            client,
            session,
            Method::GET,
            url_with_segments(
                session,
                &["api", "v1", "social", "posts"],
                &[clean_id(post_id, "post_id")?],
            )?,
        ),
        StationOperation::MomentsReact {
            post_id,
            reaction_kind,
        } => {
            let post_id = clean_id(post_id, "post_id")?;
            let url = url_with_segments(
                session,
                &["api", "v1", "social", "posts"],
                &[post_id.clone(), "react".to_string()],
            )?;
            authenticated_request(client, session, Method::POST, url)
                .header(CONTENT_TYPE, "application/json")
                .body(
                    serde_json::to_vec(&json!({
                        "post_id": post_id,
                        "kind": reaction_kind,
                    }))
                    .map_err(|_| transport_error("moments_react", "encode"))?,
                )
        }
        StationOperation::MomentsUnreact {
            post_id,
            reaction_kind,
        } => {
            let post_id = clean_id(post_id, "post_id")?;
            let url = url_with_segments(
                session,
                &["api", "v1", "social", "posts"],
                &[post_id.clone(), "unreact".to_string()],
            )?;
            authenticated_request(client, session, Method::POST, url)
                .header(CONTENT_TYPE, "application/json")
                .body(
                    serde_json::to_vec(&json!({
                        "post_id": post_id,
                        "kind": reaction_kind,
                    }))
                    .map_err(|_| transport_error("moments_unreact", "encode"))?,
                )
        }
        StationOperation::MomentsCommentsList {
            post_id,
            cursor,
            limit,
        } => {
            bounded_limit(limit, 200, "moments_comments_list")?;
            let mut url = url_with_segments(
                session,
                &["api", "v1", "social", "posts"],
                &[clean_id(post_id, "post_id")?, "comments".to_string()],
            )?;
            url.query_pairs_mut()
                .append_pair("limit", &limit.to_string());
            if let Some(cursor) = clean_optional(cursor.unwrap_or_default(), 2048, "cursor")? {
                url.query_pairs_mut().append_pair("cursor", &cursor);
            }
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::MomentsCommentCreate {
            post_id,
            content,
            reply_to_comment_id,
        } => {
            let content = clean_required(content, 32 * 1024, "content")?;
            let reply_to_comment_id = clean_optional(
                reply_to_comment_id.unwrap_or_default(),
                512,
                "reply_to_comment_id",
            )?;
            let url = url_with_segments(
                session,
                &["api", "v1", "social", "posts"],
                &[clean_id(post_id, "post_id")?, "comments".to_string()],
            )?;
            let mut body = serde_json::Map::new();
            body.insert("content".to_string(), Value::String(content));
            if let Some(reply) = reply_to_comment_id {
                body.insert("reply_to_comment_id".to_string(), Value::String(reply));
            }
            authenticated_request(client, session, Method::POST, url)
                .header(CONTENT_TYPE, "application/json")
                .body(
                    serde_json::to_vec(&Value::Object(body))
                        .map_err(|_| transport_error("moments_comment_create", "encode"))?,
                )
        }
        StationOperation::MomentsCommentDelete { comment_id } => authenticated_request(
            client,
            session,
            Method::DELETE,
            url_with_segments(
                session,
                &["api", "v1", "social", "comments"],
                &[clean_id(comment_id, "comment_id")?],
            )?,
        ),
        StationOperation::MomentsCreate { body_bytes } => {
            bounded_bytes(&body_bytes, MAX_BINARY_REQUEST_BYTES, "moments_create")?;
            authenticated_request(
                client,
                session,
                Method::POST,
                fixed_url(session, "/api/v1/social/moments")?,
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(body_bytes)
        }
        StationOperation::OssDownload { key } => {
            let mut url = fixed_url(session, "/sub-oss/file")?;
            url.query_pairs_mut()
                .append_pair("key", &clean_required(key, 4096, "key")?);
            authenticated_request(client, session, Method::GET, url)
                .header(ACCEPT, "application/octet-stream")
        }
        StationOperation::PresenceHeartbeat { reason } => json_request(
            client,
            session,
            Method::POST,
            "/presence/heartbeat",
            serde_json::to_vec(&json!({
                "reason": clean_required(reason, 128, "reason")?,
            }))
            .map_err(|_| transport_error("presence_heartbeat", "encode"))?,
        )?,
        StationOperation::PresenceOffline { reason } => json_request(
            client,
            session,
            Method::POST,
            "/presence/offline",
            serde_json::to_vec(&json!({
                "reason": clean_required(reason, 128, "reason")?,
            }))
            .map_err(|_| transport_error("presence_offline", "encode"))?,
        )?,
        StationOperation::RealtimeSignalSend {
            recipient_ptid,
            session_ulid,
            kind,
            payload_b64,
            call_id,
            device_id,
        } => {
            let recipient_ptid = clean_required(recipient_ptid, 512, "recipient_ptid")?;
            if !recipient_ptid.starts_with("ptid:") {
                return Err(transport_error("realtime_signal_send", "recipient_invalid"));
            }
            let session_ulid = clean_required(session_ulid, 512, "session_ulid")?;
            let kind = clean_required(kind, 32, "kind")?;
            if !matches!(
                kind.as_str(),
                "OFFER"
                    | "ANSWER"
                    | "CANDIDATE"
                    | "HANGUP"
                    | "CALL_REQUEST"
                    | "CALL_ACCEPT"
                    | "CALL_REJECT"
                    | "CALL_END"
            ) {
                return Err(transport_error("realtime_signal_send", "kind_invalid"));
            }
            let decoded = B64
                .decode(payload_b64.trim())
                .map_err(|_| transport_error("realtime_signal_send", "payload_invalid"))?;
            bounded_bytes(&decoded, 64 * 1024, "realtime_signal_send")?;
            let lifecycle = matches!(
                kind.as_str(),
                "CALL_REQUEST" | "CALL_ACCEPT" | "CALL_REJECT" | "CALL_END"
            );
            let call_id = clean_optional(call_id, 64, "call_id")?;
            let device_id = clean_optional(device_id, 255, "device_id")?;
            if lifecycle
                && (call_id.as_deref().unwrap_or_default().is_empty()
                    || device_id.as_deref() != Some(session.device_id()))
            {
                return Err(transport_error(
                    "realtime_signal_send",
                    "call_binding_invalid",
                ));
            }
            json_request(
                client,
                session,
                Method::POST,
                "/realtime/signal",
                serde_json::to_vec(&json!({
                    "recipient_ptid": recipient_ptid,
                    "session_ulid": session_ulid,
                    "kind": kind,
                    "payload_b64": payload_b64,
                    "call_id": call_id,
                    "device_id": device_id,
                }))
                .map_err(|_| transport_error("realtime_signal_send", "encode"))?,
            )?
        }
        StationOperation::RealtimeCallResolutionGet {
            call_id,
            peer_actor_ptid,
        } => {
            let mut url = fixed_url(session, "/realtime/call-resolution")?;
            url.query_pairs_mut()
                .append_pair("call_id", &clean_required(call_id, 64, "call_id")?)
                .append_pair(
                    "peer_actor_ptid",
                    &clean_required(peer_actor_ptid, 512, "peer_actor_ptid")?,
                );
            authenticated_request(client, session, Method::GET, url)
        }
        StationOperation::TurnIceServers {} => authenticated_request(
            client,
            session,
            Method::GET,
            fixed_url(session, "/api/v1/turn/ice-servers")?,
        ),
    };
    Ok(request)
}

async fn open_realtime_response(
    session: &AuthenticatedNativeSession,
    resume_cursor: Option<&str>,
) -> MobileResult<Response> {
    let client = authenticated_client(REALTIME_TIMEOUT, "realtime_stream")?;
    let mut request = authenticated_request(
        &client,
        session,
        Method::GET,
        fixed_url(session, "/events/stream")?,
    )
    .header(ACCEPT, "text/event-stream");
    if let Some(cursor) = resume_cursor {
        request = request.header("Last-Event-ID", cursor);
    }
    let response = request
        .send()
        .await
        .map_err(|error| request_error("realtime_stream", &error))?;
    if !response.status().is_success() {
        return Err(transport_error(
            "realtime_stream",
            &format!("http_{}", response.status().as_u16()),
        ));
    }
    Ok(response)
}

fn authenticated_client(timeout: Duration, operation_id: &str) -> MobileResult<Client> {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| transport_error(operation_id, "client"))
}

fn authenticated_request(
    client: &Client,
    session: &AuthenticatedNativeSession,
    method: Method,
    url: Url,
) -> RequestBuilder {
    client
        .request(method, url)
        .header(AUTHORIZATION, format!("Bearer {}", session.access_token()))
        .header("X-Device-ID", session.device_id())
        .header(ACCEPT, "application/json")
}

fn json_request(
    client: &Client,
    session: &AuthenticatedNativeSession,
    method: Method,
    path: &str,
    body: Vec<u8>,
) -> MobileResult<RequestBuilder> {
    bounded_bytes(&body, MAX_JSON_REQUEST_BYTES, "json_request")?;
    Ok(
        authenticated_request(client, session, method, fixed_url(session, path)?)
            .header(CONTENT_TYPE, "application/json")
            .body(body),
    )
}

async fn response_projection(
    operation_id: &str,
    mut response: Response,
) -> MobileResult<StationTransportResponse> {
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let mut body_bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| request_error(operation_id, &error))?
    {
        if body_bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(transport_error(operation_id, "response_too_large"));
        }
        body_bytes.extend_from_slice(&chunk);
    }
    Ok(StationTransportResponse {
        status,
        content_type,
        body_bytes,
    })
}

fn fixed_url(session: &AuthenticatedNativeSession, path: &str) -> MobileResult<Url> {
    let mut url = Url::parse(session.station_origin())
        .map_err(|_| transport_error("unknown", "stored_origin_invalid"))?;
    url.set_path(path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn url_with_segments(
    session: &AuthenticatedNativeSession,
    fixed: &[&str],
    dynamic: &[String],
) -> MobileResult<Url> {
    let mut url = fixed_url(session, "/")?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| transport_error("unknown", "stored_origin_invalid"))?;
        segments.clear();
        segments.extend(fixed.iter().copied());
        segments.extend(dynamic.iter().map(String::as_str));
    }
    Ok(url)
}

fn typed_json_body<T: Serialize>(input: &T, operation_id: &str) -> MobileResult<Vec<u8>> {
    let encoded = serde_json::to_vec(input).map_err(|_| transport_error(operation_id, "encode"))?;
    bounded_bytes(&encoded, MAX_JSON_REQUEST_BYTES, operation_id)?;
    Ok(encoded)
}

fn list_body(key: &str, values: Vec<String>, operation_id: &str) -> MobileResult<Vec<u8>> {
    if values.is_empty() || values.len() > 500 {
        return Err(transport_error(operation_id, "list_invalid"));
    }
    let values = values
        .into_iter()
        .map(|value| clean_id(value, key))
        .collect::<MobileResult<Vec<_>>>()?;
    let mut body = serde_json::Map::new();
    body.insert(
        key.to_string(),
        Value::Array(values.into_iter().map(Value::String).collect()),
    );
    serde_json::to_vec(&Value::Object(body)).map_err(|_| transport_error(operation_id, "encode"))
}

fn clean_id(value: String, field: &str) -> MobileResult<String> {
    clean_required(value, 2048, field)
}

fn clean_required(value: String, max_len: usize, field: &str) -> MobileResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() || value.len() > max_len || value.contains(['\r', '\n', '\0']) {
        return Err(transport_error("input", &format!("{field}_invalid")));
    }
    Ok(value)
}

fn clean_optional(value: String, max_len: usize, field: &str) -> MobileResult<Option<String>> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    clean_required(value, max_len, field).map(Some)
}

fn clean_header_value(value: String, max_len: usize, field: &str) -> MobileResult<String> {
    let value = clean_required(value, max_len, field)?;
    if value.contains(['"', '\\']) {
        return Err(transport_error("input", &format!("{field}_invalid")));
    }
    Ok(value)
}

fn validate_optional_text(value: Option<&str>, maximum: usize, field: &str) -> MobileResult<()> {
    if let Some(value) = value {
        clean_required(value.to_string(), maximum, field)?;
    }
    Ok(())
}

fn validate_revision(value: &str, operation_id: &str) -> MobileResult<u64> {
    let revision = value
        .parse::<u64>()
        .map_err(|_| transport_error(operation_id, "revision_invalid"))?;
    if revision == 0 {
        return Err(transport_error(operation_id, "revision_invalid"));
    }
    Ok(revision)
}

fn bounded_limit(limit: u32, maximum: u32, operation_id: &str) -> MobileResult<()> {
    if limit == 0 || limit > maximum {
        return Err(transport_error(operation_id, "limit_invalid"));
    }
    Ok(())
}

fn bounded_bytes(bytes: &[u8], maximum: usize, operation_id: &str) -> MobileResult<()> {
    if bytes.is_empty() || bytes.len() > maximum {
        return Err(transport_error(operation_id, "body_size_invalid"));
    }
    Ok(())
}

fn request_error(operation_id: &str, error: &dyn std::fmt::Display) -> MobileError {
    let kind = if error.to_string().to_ascii_lowercase().contains("timed out") {
        "deadline"
    } else {
        "network"
    };
    transport_error(operation_id, kind)
}

fn transport_error(operation_id: &str, reason: &str) -> MobileError {
    MobileError::station_transport(format!("mobile.stationTransport.{reason}.{operation_id}"))
}

fn emit_realtime<R: Runtime>(
    app: &AppHandle<R>,
    stream_id: u64,
    kind: &'static str,
    chunk_bytes: Vec<u8>,
) {
    let _ = app.emit(
        REALTIME_EVENT,
        StationRealtimeEvent {
            stream_id,
            kind,
            chunk_bytes,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_operation_rejects_unknown_body_fields() {
        let payload = json!({
            "operationId": "actor_profile_update",
            "input": {
                "display_name": "Alice",
                "access_token": "secret"
            }
        });
        assert!(serde_json::from_value::<StationOperation>(payload).is_err());
    }

    #[test]
    fn operation_ids_are_stable_and_do_not_contain_urls() {
        let operation = StationOperation::OssDownload {
            key: "cas/aa/file".to_string(),
        };
        assert_eq!(operation.id(), "oss_download");
        assert!(!operation.id().contains('/'));
        assert!(!operation.id().contains("http"));
    }

    #[test]
    fn operation_deserialization_rejects_proxy_controls() {
        for field in ["url", "method", "headers"] {
            let mut payload = serde_json::Map::new();
            payload.insert(
                "operationId".to_string(),
                Value::String("actor_profile_get".to_string()),
            );
            payload.insert(
                field.to_string(),
                Value::String("attacker-controlled".to_string()),
            );
            assert!(serde_json::from_value::<StationOperation>(Value::Object(payload)).is_err());
        }
    }
}
