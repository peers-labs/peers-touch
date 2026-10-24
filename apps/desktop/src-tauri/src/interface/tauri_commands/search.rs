use std::sync::Arc;

use prost::Message;
use search_core::model::wire::{
    CancelRequest, CancelResponse, QueryIntent, ResolveRequest, SearchErrorCode, SearchIntent,
    SearchReadState, SearchScope, SubmitRequest, SuggestRequest,
};
use search_core::runtime::{SearchBinding, SearchRuntime};
use search_core::SearchError;
use serde::Deserialize;
use serde_json::json;
use tauri::{Manager, State, Window};

use crate::application::search as application_search;
use crate::error::{AppResult, ErrorCode};
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
    composition: application_search::runtime::Composition,
    request: search_core::requests::SearchRequest,
}

fn admit(
    state: &Arc<AppState>,
    window: &Window,
    request_id: &str,
) -> Result<Admission, AppResult<Vec<u8>>> {
    let composition =
        match application_search::runtime::Binding::admit(state.clone(), window.label()) {
            Ok(composition) => composition,
            Err(error) => return Err(failure(error)),
        };
    let partition_prefix = composition.partition.clone();
    state.search_runtime.invalidate_partitions(|partition| {
        partition.starts_with(window.label()) && partition != partition_prefix
    });
    let request =
        match state
            .search_requests
            .begin(window.label(), &composition.partition, request_id)
        {
            Ok(request) => request,
            Err(error) => return Err(failure(error)),
        };
    Ok(Admission {
        composition,
        request,
    })
}

fn execute<M: Message>(
    state: &Arc<AppState>,
    _window: &Window,
    admission: Admission,
    run: impl FnOnce(
        &SearchRuntime<application_search::runtime::DesktopSearchExecutor>,
        &[application_search::runtime::Binding],
        &search_core::CancelToken,
    ) -> Result<M, SearchError>,
) -> AppResult<Vec<u8>> {
    let Admission {
        composition,
        mut request,
    } = admission;
    let response = match run(
        &state.search_runtime,
        &composition.bindings,
        &request.cancel,
    ) {
        Ok(response) => response,
        Err(error) => return failure(error),
    };
    let source_states = match composition
        .bindings
        .iter()
        .map(|binding| binding.read_state())
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(states) => states,
        Err(error) => return failure(error),
    };
    match composition.bindings[0].publish_sources(&source_states, || {
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
            runtime.query_all(
                binding,
                QueryIntent {
                    text: request.query,
                    kinds: request.kinds,
                    scopes: vec![SearchScope::Device as i32],
                    limit: if request.limit == 0 {
                        12
                    } else {
                        request.limit.clamp(1, 100) as u32
                    },
                    suggestions: true,
                    conversation_id: request.conversation_id,
                    attachment_names_only: request.attachment_names_only,
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
            runtime.query_all(
                binding,
                QueryIntent {
                    text: request.query,
                    kinds: request.kinds,
                    scopes: request.scopes,
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
                    attachment_names_only: request.attachment_names_only,
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
            runtime.resolve_all(binding, &request.source_id, resource, cancel)
        })
    })
    .await
    .unwrap_or_else(|_| failure(SearchError::Cancelled))
}

#[tauri::command]
pub fn search_read_state(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Vec<u8>> {
    let composition =
        match application_search::runtime::Binding::admit(state.inner().clone(), window.label()) {
            Ok(composition) => composition,
            Err(error) => return failure(error),
        };
    let sources = match composition
        .bindings
        .iter()
        .map(|b| b.read_state())
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(sources) => sources,
        Err(error) => return failure(error),
    };
    match composition.bindings[0].publish_sources(&sources, || {
        Ok(SearchReadState {
            sources: sources.clone(),
            partition: composition.partition,
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
    let composition =
        match application_search::runtime::Binding::admit(state.inner().clone(), window.label()) {
            Ok(composition) => composition,
            Err(error) => return failure(error),
        };
    match state
        .search_requests
        .cancel(window.label(), &composition.partition, &request.request_id)
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
