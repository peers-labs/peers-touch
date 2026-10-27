use std::sync::Arc;

use prost::Message;
use search_core::model::wire::{
    CancelRequest, CancelResponse, QueryIntent, ResolveRequest, SearchErrorCode, SearchIntent,
    SearchReadState, SearchScope, SourceReadState, SubmitRequest, SuggestRequest,
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
    ) -> Result<(M, Vec<SourceReadState>), SearchError>,
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
    match publish_response(&composition.bindings, response, || request.complete()) {
        Ok(bytes) => AppResult::success(bytes),
        Err(error) => failure(error),
    }
}

fn publish_response<M: Message, B: SearchBinding>(
    bindings: &[B],
    (response, sources): (M, Vec<SourceReadState>),
    complete: impl FnOnce() -> Result<(), SearchError>,
) -> Result<Vec<u8>, SearchError> {
    // The trusted coordinator/issuing binding supplies the actual vector.
    // Re-admitting the composition would add unrelated source dependencies.
    bindings
        .first()
        .ok_or(SearchError::Protocol)?
        .publish_sources(&sources, || {
            complete()?;
            Ok(response.encode_to_vec())
        })
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
            let response = runtime.query_all(
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
            )?;
            let sources = response.sources.clone();
            Ok((response, sources))
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
            let response = runtime.query_all(
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
            )?;
            let sources = response.sources.clone();
            Ok((response, sources))
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
            let response = runtime.resolve_all(binding, &request.source_id, resource, cancel)?;
            let source = binding
                .iter()
                .find(|binding| binding.source_id() == request.source_id)
                .ok_or(SearchError::ResourceUnavailable)?
                .read_state()?;
            Ok((response, vec![source]))
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

#[cfg(test)]
mod tests {
    use super::*;
    use search_core::model::wire::{ResolvedResource, SearchResponse};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    #[derive(Clone)]
    struct PublicationBinding {
        source: SourceReadState,
        current: Arc<Mutex<HashMap<String, SourceReadState>>>,
        identity_current: Arc<AtomicBool>,
    }

    impl SearchBinding for PublicationBinding {
        fn partition(&self) -> &str {
            "partition"
        }
        fn source_revision(&self) -> &str {
            &self.source.source_revision
        }
        fn source_id(&self) -> &str {
            &self.source.source_id
        }
        fn binding_id(&self) -> &str {
            &self.source.binding_id
        }
        fn check(&self) -> Result<(), SearchError> {
            self.publish(|| Ok(()))
        }
        fn publish<T>(
            &self,
            publish: impl FnOnce() -> Result<T, SearchError>,
        ) -> Result<T, SearchError> {
            self.publish_sources(std::slice::from_ref(&self.source), publish)
        }
        fn publish_sources<T>(
            &self,
            sources: &[SourceReadState],
            publish: impl FnOnce() -> Result<T, SearchError>,
        ) -> Result<T, SearchError> {
            if !self.identity_current.load(Ordering::SeqCst) {
                return Err(SearchError::Cancelled);
            }
            let current = self.current.lock().unwrap();
            if sources
                .iter()
                .any(|source| current.get(&source.source_id) != Some(source))
            {
                return Err(SearchError::SourceChanged);
            }
            publish()
        }
        fn contributor(&self) -> Result<Arc<dyn search_core::SearchContributor>, SearchError> {
            panic!("IPC publication must not read a contributor");
        }
    }

    fn publication_bindings() -> Vec<PublicationBinding> {
        let sources: Vec<_> = ["device.messaging", "device.social", "station.social.public"]
            .into_iter()
            .map(|id| SourceReadState {
                source_id: id.into(),
                source_revision: "original".into(),
                ..Default::default()
            })
            .collect();
        let current = Arc::new(Mutex::new(
            sources
                .iter()
                .cloned()
                .map(|s| (s.source_id.clone(), s))
                .collect(),
        ));
        let identity_current = Arc::new(AtomicBool::new(true));
        sources
            .into_iter()
            .map(|source| PublicationBinding {
                source,
                current: current.clone(),
                identity_current: identity_current.clone(),
            })
            .collect()
    }

    #[test]
    fn final_ipc_uses_actual_sources_without_readmitting_unrelated_bindings() {
        for selected in 0..3 {
            let bindings = publication_bindings();
            let source = bindings[selected].source.clone();
            for unrelated in bindings
                .iter()
                .filter(|b| b.source_id() != source.source_id)
            {
                bindings[0]
                    .current
                    .lock()
                    .unwrap()
                    .get_mut(unrelated.source_id())
                    .unwrap()
                    .source_revision = "advanced".into();
            }
            let response = SearchResponse {
                sources: vec![source.clone()],
                ..Default::default()
            };
            let bytes = publish_response(
                &bindings,
                (response.clone(), response.sources.clone()),
                || Ok(()),
            )
            .unwrap();
            assert_eq!(SearchResponse::decode(bytes.as_slice()).unwrap(), response);
            // Resolve has only its successfully qualified issuing source.
            let resolved = ResolvedResource::default();
            assert_eq!(
                publish_response(&bindings, (resolved.clone(), vec![source]), || Ok(())).unwrap(),
                resolved.encode_to_vec(),
            );
        }
    }

    #[test]
    fn final_ipc_retains_participating_owner_identity_and_request_fences() {
        let bindings = publication_bindings();
        let response = SearchResponse {
            sources: vec![bindings[1].source.clone()],
            ..Default::default()
        };
        assert_eq!(
            publish_response(
                &bindings,
                (response.clone(), response.sources.clone()),
                || Err(SearchError::Cancelled),
            )
            .unwrap_err(),
            SearchError::Cancelled,
        );
        bindings[0].identity_current.store(false, Ordering::SeqCst);
        assert_eq!(
            publish_response(
                &bindings,
                (response.clone(), response.sources.clone()),
                || Ok(()),
            )
            .unwrap_err(),
            SearchError::Cancelled,
        );
        bindings[0].identity_current.store(true, Ordering::SeqCst);
        bindings[0]
            .current
            .lock()
            .unwrap()
            .get_mut("device.social")
            .unwrap()
            .source_revision = "advanced".into();
        assert_eq!(
            publish_response(
                &bindings,
                (response.clone(), response.sources.clone()),
                || Ok(()),
            )
            .unwrap_err(),
            SearchError::SourceChanged,
        );
    }
}
