// TW-D6 Tauri surface for device-held browser sessions.
//
// Worker commands drive the verified CDP host; the agent_* commands are
// authenticated typed proxies that persist only session metadata on
// Station. Page content never crosses the metadata boundary.

use std::sync::Arc;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, Window};

use crate::application::agent_browser_session as session_rpc;
use crate::application::browser::{
    self, BrowserMeta, HistoryDirection, HostInfo, SnapshotResult, TabMeta,
};
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
use crate::model::agent::v1 as agent;
use crate::state::AppState;

#[tauri::command]
pub fn browser_host_info() -> AppResult<HostInfo> {
    AppResult::success(browser::host_info())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionCreateInput {
    session_id: String,
}

#[tauri::command]
pub async fn browser_session_create(
    app: AppHandle,
    input: BrowserSessionCreateInput,
) -> AppResult<BrowserMeta> {
    match browser::create_session(app, input.session_id).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionInput {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabOpenInput {
    session_id: String,
    url: String,
}

#[tauri::command]
pub async fn browser_tab_open(input: BrowserTabOpenInput) -> AppResult<TabMeta> {
    match browser::open_tab(&input.session_id, input.url).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabCloseInput {
    session_id: String,
    tab_id: String,
}

#[tauri::command]
pub async fn browser_tab_close(input: BrowserTabCloseInput) -> AppResult<bool> {
    match browser::close_tab(&input.session_id, input.tab_id).await {
        Ok(()) => AppResult::success(true),
        Err(error) => browser_fail(error),
    }
}

#[tauri::command]
pub async fn browser_tab_list(input: BrowserSessionInput) -> AppResult<Vec<TabMeta>> {
    match browser::list_tabs(&input.session_id).await {
        Ok(tabs) => AppResult::success(tabs),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavigateInput {
    session_id: String,
    tab_id: String,
    url: String,
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, input: BrowserNavigateInput) -> AppResult<TabMeta> {
    match browser::navigate(app, &input.session_id, input.tab_id, input.url).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryInput {
    session_id: String,
    tab_id: String,
    /// "back" | "forward" | "reload"
    direction: String,
}

#[tauri::command]
pub async fn browser_history(app: AppHandle, input: BrowserHistoryInput) -> AppResult<TabMeta> {
    let direction = match input.direction.as_str() {
        "back" => HistoryDirection::Back,
        "forward" => HistoryDirection::Forward,
        "reload" => HistoryDirection::Reload,
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "direction must be back, forward or reload",
                None,
            );
        }
    };
    match browser::history(app, &input.session_id, input.tab_id, direction).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabRefInput {
    session_id: String,
    tab_id: String,
}

#[tauri::command]
pub async fn browser_snapshot(input: BrowserTabRefInput) -> AppResult<SnapshotResult> {
    match browser::snapshot(&input.session_id, input.tab_id).await {
        Ok(snapshot) => AppResult::success(snapshot),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserElementInput {
    session_id: String,
    tab_id: String,
    element_ref: String,
}

#[tauri::command]
pub async fn browser_click(app: AppHandle, input: BrowserElementInput) -> AppResult<TabMeta> {
    match browser::click(app, &input.session_id, input.tab_id, input.element_ref).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFillInput {
    session_id: String,
    tab_id: String,
    element_ref: String,
    value: String,
}

#[tauri::command]
pub async fn browser_fill(app: AppHandle, input: BrowserFillInput) -> AppResult<TabMeta> {
    match browser::fill(
        app,
        &input.session_id,
        input.tab_id,
        input.element_ref,
        input.value,
    )
    .await
    {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[tauri::command]
pub async fn browser_submit(app: AppHandle, input: BrowserElementInput) -> AppResult<TabMeta> {
    match browser::submit(app, &input.session_id, input.tab_id, input.element_ref).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserScreenshotResult {
    mime: String,
    data_b64: String,
}

#[tauri::command]
pub async fn browser_screenshot(input: BrowserTabRefInput) -> AppResult<BrowserScreenshotResult> {
    match browser::screenshot(&input.session_id, input.tab_id).await {
        Ok(bytes) => AppResult::success(BrowserScreenshotResult {
            mime: "image/png".to_string(),
            data_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
        }),
        Err(error) => browser_fail(error),
    }
}

#[tauri::command]
pub async fn browser_takeover(
    app: AppHandle,
    input: BrowserSessionInput,
) -> AppResult<BrowserMeta> {
    match browser::takeover(app, &input.session_id).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[tauri::command]
pub async fn browser_release(
    app: AppHandle,
    input: BrowserSessionInput,
) -> AppResult<BrowserMeta> {
    match browser::release(app, &input.session_id).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[tauri::command]
pub async fn browser_inspect(input: BrowserSessionInput) -> AppResult<BrowserMeta> {
    match browser::inspect(&input.session_id).await {
        Ok(meta) => AppResult::success(meta),
        Err(error) => browser_fail(error),
    }
}

#[tauri::command]
pub async fn browser_remove(app: AppHandle, input: BrowserSessionInput) -> AppResult<bool> {
    match browser::remove_session(app, &input.session_id).await {
        Ok(()) => AppResult::success(true),
        Err(error) => browser_fail(error),
    }
}

#[tauri::command]
pub fn browser_session_list() -> AppResult<Vec<BrowserMeta>> {
    AppResult::success(browser::list_sessions())
}

// ── Station metadata proxies (authenticated proto) ──────────────────────

fn station_token(
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

#[derive(Debug, Deserialize)]
pub struct AgentBrowserCreateInput {
    session_id: String,
    conversation_id: String,
    #[serde(default)]
    turn_id: String,
    device_id: String,
    engine: String,
}

#[tauri::command]
pub fn agent_browser_session_create(
    input: AgentBrowserCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::CreateBrowserSessionRequest {
        session_id: input.session_id,
        conversation_id: input.conversation_id,
        turn_id: input.turn_id,
        device_id: input.device_id,
        engine: input.engine,
    };
    session_rpc::create(state.station.client(), &token, &request)
}

#[derive(Debug, Deserialize)]
pub struct AgentBrowserTabInput {
    #[allow(dead_code)]
    tab_id: String,
    #[allow(dead_code)]
    generation: u64,
    #[allow(dead_code)]
    url: String,
    #[allow(dead_code)]
    title: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentBrowserUpdateInput {
    session_id: String,
    status: i32,
    lease: i32,
    #[serde(default)]
    tabs: Vec<AgentBrowserTabInput>,
}

#[tauri::command]
pub fn agent_browser_session_update(
    input: AgentBrowserUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let tabs = input
        .tabs
        .into_iter()
        .map(|tab| agent::BrowserTab {
            tab_id: tab.tab_id,
            generation: tab.generation,
            url: tab.url,
            title: tab.title,
        })
        .collect();
    let request = agent::UpdateBrowserSessionRequest {
        session_id: input.session_id,
        status: input.status,
        lease: input.lease,
        tabs,
    };
    session_rpc::update(state.station.client(), &token, &request)
}

#[derive(Debug, Deserialize)]
pub struct AgentBrowserListInput {
    conversation_id: String,
}

#[tauri::command]
pub fn agent_browser_session_list(
    input: AgentBrowserListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ListBrowserSessionsRequest {
        conversation_id: input.conversation_id,
    };
    session_rpc::list(state.station.client(), &token, &request)
}

#[derive(Debug, Deserialize)]
pub struct AgentBrowserReconcileInput {
    device_id: String,
    #[serde(default)]
    live_session_ids: Vec<String>,
}

#[tauri::command]
pub fn agent_browser_session_reconcile(
    input: AgentBrowserReconcileInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ReconcileBrowserSessionsRequest {
        device_id: input.device_id,
        live_session_ids: input.live_session_ids,
    };
    session_rpc::reconcile(state.station.client(), &token, &request)
}

// Station proxies receive snake_case fields from the TS layer, unlike the
// local worker commands which use camelCase. A dedicated input keeps the two
// wire contracts from sharing a struct that silently drops `session_id`.
#[derive(Debug, Deserialize)]
pub struct AgentBrowserSessionInput {
    session_id: String,
}

#[tauri::command]
pub fn agent_browser_session_remove(
    input: AgentBrowserSessionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::RemoveBrowserSessionRequest {
        session_id: input.session_id,
    };
    session_rpc::remove(state.station.client(), &token, &request)
}

fn browser_fail<T: Serialize>(error: browser::BrowserError) -> AppResult<T> {
    let code = match error.code {
        "BROWSER_INVALID_ARGUMENT" => ErrorCode::InvalidArgument,
        "BROWSER_HOST_UNAVAILABLE" => ErrorCode::Unavailable,
        "BROWSER_HUMAN_TAKEOVER_HELD" | "BROWSER_SNAPSHOT_REF_STALE" => ErrorCode::Conflict,
        _ => ErrorCode::InternalError,
    };
    AppResult::fail(code, error.message, None)
}
