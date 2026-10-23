use std::sync::Arc;

use prost::Message;
use search_core::model::wire::{
    CancelRequest, CancelResponse, QueryIntent, ResolveRequest, SearchErrorCode, SearchIntent,
    SearchKind, SearchReadState, SearchScope, SubmitRequest, SuggestRequest,
};
use search_core::runtime::{SearchBinding, SearchRuntime};
use search_core::SearchError;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Manager, State, Window};

use crate::application::search as application_search;
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
        SearchError::Timeout => SearchErrorCode::SourceTimeout,
        SearchError::Protocol => SearchErrorCode::Protocol,
        SearchError::ResourceUnavailable => SearchErrorCode::ResourceUnavailable,
        SearchError::SourceChanged => SearchErrorCode::SourceChanged,
    };
    AppResult::fail(
        ErrorCode::InvalidArgument,
        error.to_string(),
        Some(json!({ "search_error_code": code as i32 })),
    )
}

struct Admission {
    session: crate::domain::identity::ActiveSession,
    revision: u64,
    engine: Arc<crate::messaging::MessagingEngine>,
    request: search_core::requests::SearchRequest,
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
            None => {
                return Err(AppResult::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                ))
            }
        };
        let (_, _, engine) = match active_engine(state, window) {
            Ok(value) => value,
            Err(error) => {
                return Err(AppResult::fail(
                    error
                        .error
                        .as_ref()
                        .map(|e| e.code.clone())
                        .unwrap_or(ErrorCode::Unauthorized),
                    "authenticated messaging engine required",
                    None,
                ))
            }
        };
        (session, revision, engine)
    };
    let request = match state
        .search_requests
        .begin(window.label(), &session.account_id, request_id)
    {
        Ok(request) => request,
        Err(error) => return Err(failure(error)),
    };
    Ok(Admission {
        session,
        revision,
        engine,
        request,
    })
}

fn execute<M: Message>(
    state: &Arc<AppState>,
    window: &Window,
    admission: Admission,
    run: impl FnOnce(
        &SearchRuntime<application_search::runtime::DesktopSearchExecutor>,
        &application_search::runtime::Binding,
        &search_core::CancelToken,
    ) -> Result<M, SearchError>,
) -> AppResult<Vec<u8>> {
    let Admission {
        session,
        revision,
        engine,
        mut request,
    } = admission;
    let binding = match application_search::runtime::Binding::new(
        state.clone(),
        window.label().into(),
        session.account_id,
        revision,
        engine,
    ) {
        Ok(binding) => binding,
        Err(error) => return failure(error),
    };
    let response = match run(&state.search_runtime, &binding, &request.cancel) {
        Ok(response) => response,
        Err(error) => return failure(error),
    };
    match binding.publish(|| {
        request.complete()?;
        Ok(response.encode_to_vec())
    }) {
        Ok(bytes) => AppResult::success(bytes),
        Err(error) => failure(error),
    }
}

#[tauri::command]
pub async fn search_suggest(
    input: SearchInput,
    app: tauri::AppHandle,
    window: Window,
) -> AppResult<Vec<u8>> {
    if input.request_bytes.len() > 65536 {
        return failure(SearchError::InvalidQuery);
    }
    let request = match SuggestRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => return failure(SearchError::InvalidQuery),
    };
    let state = app.state::<Arc<AppState>>().inner().clone();
    let admission = match admit(&state, &window, &request.request_id) {
        Ok(admission) => admission,
        Err(error) => return error,
    };
    tauri::async_runtime::spawn_blocking(move || {
        execute(&state, &window, admission, |runtime, binding, cancel| {
            runtime.query(
                binding,
                QueryIntent {
                    text: request.query,
                    kind: request.kind,
                    scope: SearchScope::Device as i32,
                    limit: if request.limit == 0 {
                        12
                    } else {
                        request.limit.clamp(1, 100) as u32
                    },
                    suggestions: true,
                    conversation_id: request.conversation_id,
                    ..Default::default()
                },
                cancel,
            )
        })
    })
    .await
    .unwrap_or_else(|_| failure(SearchError::Cancelled))
}

#[tauri::command]
pub async fn search_submit(
    input: SearchInput,
    app: tauri::AppHandle,
    window: Window,
) -> AppResult<Vec<u8>> {
    if input.request_bytes.len() > 65536 {
        return failure(SearchError::InvalidQuery);
    }
    let request = match SubmitRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => return failure(SearchError::InvalidQuery),
    };
    if request.intent != SearchIntent::Find as i32 {
        return failure(SearchError::InvalidQuery);
    }
    let state = app.state::<Arc<AppState>>().inner().clone();
    let admission = match admit(&state, &window, &request.request_id) {
        Ok(admission) => admission,
        Err(error) => return error,
    };
    tauri::async_runtime::spawn_blocking(move || {
        execute(&state, &window, admission, |runtime, binding, cancel| {
            runtime.query(
                binding,
                QueryIntent {
                    text: request.query,
                    kind: if request.kind == SearchKind::Unspecified as i32 {
                        SearchKind::Message as i32
                    } else {
                        request.kind
                    },
                    scope: request.scope,
                    cursor: request.cursor,
                    limit: if request.limit == 0 {
                        20
                    } else {
                        request.limit.clamp(1, 100) as u32
                    },
                    locale: request.locale,
                    refresh: request.refresh,
                    suggestions: false,
                    conversation_id: request.conversation_id,
                },
                cancel,
            )
        })
    })
    .await
    .unwrap_or_else(|_| failure(SearchError::Cancelled))
}

#[tauri::command]
pub async fn search_resolve(
    input: SearchInput,
    app: tauri::AppHandle,
    window: Window,
) -> AppResult<Vec<u8>> {
    if input.request_bytes.len() > 4096 {
        return failure(SearchError::InvalidQuery);
    }
    let request = match ResolveRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => return failure(SearchError::InvalidQuery),
    };
    let Some(resource) = request.resource else {
        return failure(SearchError::InvalidQuery);
    };
    let state = app.state::<Arc<AppState>>().inner().clone();
    let admission = match admit(&state, &window, &request.request_id) {
        Ok(admission) => admission,
        Err(error) => return error,
    };
    tauri::async_runtime::spawn_blocking(move || {
        execute(&state, &window, admission, |runtime, binding, cancel| {
            runtime.resolve(binding, resource, cancel)
        })
    })
    .await
    .unwrap_or_else(|_| failure(SearchError::Cancelled))
}

#[tauri::command]
pub fn search_read_state(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Vec<u8>> {
    let (session, revision) = match state.sessions.get_with_revision(window.label()) {
        Some(binding) => binding,
        None => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(engine) => engine,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "authenticated engine required",
                None,
            )
        }
    };
    let binding = match application_search::runtime::Binding::new(
        state.inner().clone(),
        window.label().into(),
        session.account_id,
        revision,
        engine,
    ) {
        Ok(binding) => binding,
        Err(error) => return failure(error),
    };
    match binding.publish(|| {
        Ok(SearchReadState {
            source_revision: binding.source_revision.clone(),
            read_scope: binding.partition.clone(),
        }
        .encode_to_vec())
    }) {
        Ok(bytes) => AppResult::success(bytes),
        Err(error) => failure(error),
    }
}

#[tauri::command]
pub fn search_cancel(
    input: SearchInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    if input.request_bytes.len() > 1024 {
        return failure(SearchError::InvalidQuery);
    }
    let request = match CancelRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) if !request.request_id.trim().is_empty() => request,
        _ => return failure(SearchError::InvalidQuery),
    };
    let (account, _, _) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match state
        .search_requests
        .cancel(window.label(), &account, &request.request_id)
    {
        Ok(cancelled) => AppResult::success(
            CancelResponse {
                request_id: request.request_id,
                cancelled,
            }
            .encode_to_vec(),
        ),
        Err(error) => failure(error),
    }
}
