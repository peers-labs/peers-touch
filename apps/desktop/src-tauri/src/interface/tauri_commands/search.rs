use std::sync::Arc;

use prost::Message;
use serde::Deserialize;
use serde_json::{json, Value};
use search_core::model::wire::{
    CancelRequest, CancelResponse, SearchErrorCode, SearchResponse, SubmitRequest, SuggestRequest,
};
use search_core::SearchError;
use tauri::{Manager, State, Window};

use crate::application::search as application_search;
use crate::contracts::{AiSearchInput, SearchQueryInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::interface::tauri_commands::messaging::active_engine;
use crate::state::AppState;

// ── New closed-domain search commands (SRCH-D03) ──────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchInput {
    pub request_bytes: Vec<u8>,
}

fn failure(error: SearchError) -> AppResult<Vec<u8>> {
    let code = match &error {
        SearchError::OutsideDomain => SearchErrorCode::ScopeOutsideSearchDomain,
        SearchError::InvalidQuery => SearchErrorCode::InvalidQuery,
        SearchError::Cancelled => SearchErrorCode::Cancelled,
        SearchError::SourceUnavailable(_) => SearchErrorCode::SourceUnavailable,
        SearchError::CursorExpired => SearchErrorCode::CursorExpired,
    };
    AppResult::fail(ErrorCode::InvalidArgument, error.to_string(),
        Some(json!({ "search_error_code": code as i32 })))
}

struct Admission {
    session: crate::domain::identity::ActiveSession,
    revision: u64,
    engine: Arc<crate::messaging::MessagingEngine>,
    request: application_search::requests::SearchRequest,
}

fn admit(
    state: &Arc<AppState>,
    window: &Window,
    request_id: &str,
) -> Result<Admission, AppResult<Vec<u8>>> {
    let (session, revision, engine) = {
        let _transition = match state.identity_transition.lock() {
            Ok(lock) => lock,
            Err(_) => return Err(failure(SearchError::Cancelled)),
        };
        let (session, revision) = match state.sessions.get_with_revision(window.label()) {
            Some(value) => value,
            None => return Err(AppResult::fail(ErrorCode::Unauthorized, "authentication required", None)),
        };
        let (_, _, engine) = match active_engine(state, window) {
            Ok(value) => value,
            Err(error) => return Err(AppResult::fail(
                error.error.as_ref().map(|e| e.code.clone()).unwrap_or(ErrorCode::Unauthorized),
                "authenticated messaging engine required", None)),
        };
        (session, revision, engine)
    };
    let request = match state.search_requests.begin(
        window.label(), &session.account_id, request_id,
    ) {
        Ok(request) => request,
        Err(error) => return Err(failure(error)),
    };
    Ok(Admission { session, revision, engine, request })
}

fn execute(
    state: &Arc<AppState>,
    window: &Window,
    admission: Admission,
    run: impl FnOnce(
        &crate::messaging::MessagingEngine, &str,
        &dyn Fn() -> Result<(), SearchError>,
    ) -> Result<SearchResponse, SearchError>,
) -> AppResult<Vec<u8>> {
    let Admission { session, revision, engine, mut request } = admission;
    let check = || {
        request.cancel.check()?;
        let (_, current_revision) = state.sessions.get_with_revision(window.label())
            .ok_or(SearchError::Cancelled)?;
        let current = state.messaging_engines.get(&session.account_id)
            .map_err(|_| SearchError::Cancelled)?.ok_or(SearchError::Cancelled)?;
        if current_revision != revision || !Arc::ptr_eq(&engine, &current) {
            return Err(SearchError::Cancelled);
        }
        Ok(())
    };
    let binding = format!("{}:{revision}", session.account_id);
    let response = match run(&engine, &binding, &check) {
        Ok(response) => response,
        Err(error) => return failure(error),
    };
    let _transition = match state.identity_transition.lock() {
        Ok(lock) => lock,
        Err(_) => return failure(SearchError::Cancelled),
    };
    if let Err(error) = check() { return failure(error); }
    match request.complete() {
        Ok(()) => AppResult::success(response.encode_to_vec()),
        Err(error) => failure(error),
    }
}

#[tauri::command]
pub async fn search_suggest(
    input: SearchInput,
    app: tauri::AppHandle,
    window: Window,
) -> AppResult<Vec<u8>> {
    if input.request_bytes.len() > 65536 { return failure(SearchError::InvalidQuery); }
    let request = match SuggestRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => return failure(SearchError::InvalidQuery),
    };
    let state = app.state::<Arc<AppState>>().inner().clone();
    let admission = match admit(&state, &window, &request.request_id) {
        Ok(admission) => admission,
        Err(error) => return error,
    };
    tauri::async_runtime::spawn_blocking(move || execute(
        &state, &window, admission,
        |engine, _, check| application_search::search_suggest(engine, request, check),
    )).await.unwrap_or_else(|_| failure(SearchError::Cancelled))
}

#[tauri::command]
pub async fn search_submit(
    input: SearchInput,
    app: tauri::AppHandle,
    window: Window,
) -> AppResult<Vec<u8>> {
    if input.request_bytes.len() > 65536 { return failure(SearchError::InvalidQuery); }
    let request = match SubmitRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => return failure(SearchError::InvalidQuery),
    };
    let state = app.state::<Arc<AppState>>().inner().clone();
    let admission = match admit(&state, &window, &request.request_id) {
        Ok(admission) => admission,
        Err(error) => return error,
    };
    tauri::async_runtime::spawn_blocking(move || execute(
        &state, &window, admission,
        |engine, account, check| application_search::search_submit(engine, request, account, check),
    )).await.unwrap_or_else(|_| failure(SearchError::Cancelled))
}

#[tauri::command]
pub fn search_cancel(
    input: SearchInput, state: State<'_, Arc<AppState>>, window: Window,
) -> AppResult<Vec<u8>> {
    if input.request_bytes.len() > 1024 { return failure(SearchError::InvalidQuery); }
    let request = match CancelRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) if !request.request_id.trim().is_empty() => request,
        _ => return failure(SearchError::InvalidQuery),
    };
    let (account, _, _) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match state.search_requests.cancel(window.label(), &account, &request.request_id) {
        Ok(cancelled) => AppResult::success(CancelResponse {
            request_id: request.request_id, cancelled,
        }.encode_to_vec()),
        Err(error) => failure(error),
    }
}

// ── Legacy success-empty stubs (deleted in SRCH-D04B) ─────────────────────

#[tauri::command]
pub fn help_get() -> AppResult<StubPayload> {
    application_search::help_get()
}

#[tauri::command]
pub fn search_sources() -> AppResult<StubPayload> {
    application_search::search_sources()
}

#[tauri::command]
pub fn search_query(input: SearchQueryInput) -> AppResult<StubPayload> {
    application_search::search_query(input)
}

#[tauri::command]
pub fn search_ai(input: AiSearchInput) -> AppResult<StubPayload> {
    application_search::search_ai(input)
}
