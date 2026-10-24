use prost::Message;
use search_core::model::wire::*;
use search_core::runtime::SearchBinding;
use search_core::SearchError;
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{MobileError, MobileResult};
use crate::runtime::search::{Binding, MobileSearchState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchInput {
    request_bytes: Vec<u8>,
}

fn failure(error: SearchError) -> MobileError {
    let code = match &error {
        SearchError::OutsideDomain => "SEARCH_SCOPE_OUTSIDE_SEARCH_DOMAIN",
        SearchError::InvalidQuery => "SEARCH_INVALID_QUERY",
        SearchError::Cancelled => "SEARCH_CANCELLED",
        SearchError::SourceUnavailable(_) => "SEARCH_SOURCE_UNAVAILABLE",
        SearchError::CursorExpired => "SEARCH_CURSOR_EXPIRED",
        SearchError::Timeout => "SEARCH_SOURCE_TIMEOUT",
        SearchError::Protocol => "SEARCH_PROTOCOL",
        SearchError::ResourceUnavailable => "SEARCH_RESOURCE_UNAVAILABLE",
        SearchError::SourceChanged => "SEARCH_SOURCE_CHANGED",
    };
    MobileError::coded(code, error.to_string())
}

fn decode<M: Message + Default>(input: SearchInput, max: usize) -> MobileResult<M> {
    if input.request_bytes.len() > max {
        return Err(failure(SearchError::InvalidQuery));
    }
    M::decode(input.request_bytes.as_slice()).map_err(|_| failure(SearchError::InvalidQuery))
}

fn execute<M: Message, R: Runtime>(
    app: &AppHandle<R>,
    request_id: &str,
    run: impl FnOnce(
        &MobileSearchState,
        &[Binding<R>],
        &search_core::CancelToken,
    ) -> Result<M, SearchError>,
) -> MobileResult<Vec<u8>> {
    let composition = Binding::admit(app.clone()).map_err(failure)?;
    let state = app.state::<MobileSearchState>();
    // Only one current private partition is retained on Mobile.
    state
        .runtime
        .invalidate_partitions(|partition| partition != composition.partition);
    let mut request = state
        .requests
        .begin("mobile", &composition.partition, request_id)
        .map_err(failure)?;
    let result = run(&state, &composition.bindings, &request.cancel).map_err(failure)?;
    let sources = composition
        .bindings
        .iter()
        .map(|b| b.read_state())
        .collect::<Result<Vec<_>, _>>()
        .map_err(failure)?;
    composition.bindings[0]
        .publish_sources(&sources, || {
            request.complete()?;
            Ok(result.encode_to_vec())
        })
        .map_err(failure)
}

#[tauri::command]
pub async fn search_submit<R: Runtime>(
    app: AppHandle<R>,
    input: SearchInput,
) -> MobileResult<Vec<u8>> {
    let request: SubmitRequest = decode(input, 65536)?;
    if request.intent != SearchIntent::Find as i32 || !(0..=100).contains(&request.limit) {
        return Err(failure(SearchError::InvalidQuery));
    }
    tauri::async_runtime::spawn_blocking(move || {
        execute(&app, &request.request_id, |state, binding, cancel| {
            state.runtime.query_all(
                binding,
                QueryIntent {
                    text: request.query.clone(),
                    kinds: request.kinds.clone(),
                    scopes: request.scopes.clone(),
                    limit: if request.limit == 0 {
                        20
                    } else {
                        request.limit as u32
                    },
                    cursor: request.cursor.clone(),
                    locale: request.locale.clone(),
                    suggestions: false,
                    refresh: request.refresh,
                    conversation_id: request.conversation_id.clone(),
                    attachment_names_only: request.attachment_names_only,
                },
                cancel,
            )
        })
    })
    .await
    .map_err(|_| failure(SearchError::Cancelled))?
}

#[tauri::command]
pub async fn search_suggest<R: Runtime>(
    app: AppHandle<R>,
    input: SearchInput,
) -> MobileResult<Vec<u8>> {
    let request: SuggestRequest = decode(input, 65536)?;
    if !(0..=100).contains(&request.limit) {
        return Err(failure(SearchError::InvalidQuery));
    }
    tauri::async_runtime::spawn_blocking(move || {
        execute(&app, &request.request_id, |state, binding, cancel| {
            state.runtime.query_all(
                binding,
                QueryIntent {
                    text: request.query.clone(),
                    kinds: request.kinds.clone(),
                    scopes: vec![SearchScope::Device as i32],
                    limit: if request.limit == 0 {
                        12
                    } else {
                        request.limit as u32
                    },
                    suggestions: true,
                    conversation_id: request.conversation_id.clone(),
                    attachment_names_only: request.attachment_names_only,
                    ..Default::default()
                },
                cancel,
            )
        })
    })
    .await
    .map_err(|_| failure(SearchError::Cancelled))?
}

#[tauri::command]
pub async fn search_resolve<R: Runtime>(
    app: AppHandle<R>,
    input: SearchInput,
) -> MobileResult<Vec<u8>> {
    let request: ResolveRequest = decode(input, 4096)?;
    let resource = request
        .resource
        .ok_or_else(|| failure(SearchError::InvalidQuery))?;
    tauri::async_runtime::spawn_blocking(move || {
        execute(&app, &request.request_id, |state, binding, cancel| {
            state
                .runtime
                .resolve_all(binding, &request.source_id, resource, cancel)
        })
    })
    .await
    .map_err(|_| failure(SearchError::Cancelled))?
}

#[tauri::command]
pub async fn search_read_state<R: Runtime>(app: AppHandle<R>) -> MobileResult<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || {
        let composition = Binding::admit(app).map_err(failure)?;
        let sources = composition
            .bindings
            .iter()
            .map(|b| b.read_state())
            .collect::<Result<Vec<_>, _>>()
            .map_err(failure)?;
        composition.bindings[0]
            .publish_sources(&sources, || {
                Ok(SearchReadState {
                    sources: sources.clone(),
                    partition: composition.partition,
                }
                .encode_to_vec())
            })
            .map_err(failure)
    })
    .await
    .map_err(|_| failure(SearchError::Cancelled))?
}

/// Supporting cost diagnostics; contains no query, identity or private content.
#[tauri::command]
pub async fn search_read_diagnostics<R: Runtime>(
    app: AppHandle<R>,
) -> MobileResult<crate::runtime::search::SearchReadDiagnostics> {
    if !cfg!(debug_assertions) {
        return Err(failure(SearchError::OutsideDomain));
    }
    let composition = Binding::admit(app).map_err(failure)?;
    composition.bindings[0]
        .publish(|| Ok(crate::runtime::search::read_diagnostics()))
        .map_err(failure)
}

#[tauri::command]
pub async fn search_cancel<R: Runtime>(
    app: AppHandle<R>,
    input: SearchInput,
) -> MobileResult<Vec<u8>> {
    let request: CancelRequest = decode(input, 1024)?;
    if request.request_id.trim().is_empty() || request.request_id.len() > 128 {
        return Err(failure(SearchError::InvalidQuery));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let composition = Binding::admit(app.clone()).map_err(failure)?;
        composition.bindings[0]
            .publish(|| {
                let cancelled = app.state::<MobileSearchState>().requests.cancel(
                    "mobile",
                    &composition.partition,
                    &request.request_id,
                )?;
                Ok(CancelResponse {
                    request_id: request.request_id,
                    cancelled,
                }
                .encode_to_vec())
            })
            .map_err(failure)
    })
    .await
    .map_err(|_| failure(SearchError::Cancelled))?
}
