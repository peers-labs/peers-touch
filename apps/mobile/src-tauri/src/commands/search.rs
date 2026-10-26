use prost::Message;
use search_core::model::wire::*;
use search_core::runtime::SearchBinding;
use search_core::SearchError;
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{MobileError, MobileResult};
use crate::runtime::search::{resolve_for_publication, Binding, MobileSearchState};

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
    ) -> Result<(M, Vec<SourceReadState>), SearchError>,
) -> MobileResult<Vec<u8>> {
    let composition = Binding::admit(app.clone()).map_err(failure)?;
    let state = app.state::<MobileSearchState>();
    execute_bound(
        &state,
        &composition.bindings,
        &composition.partition,
        request_id,
        run,
    )
    .map_err(failure)
}

fn execute_bound<M: Message, B: SearchBinding>(
    state: &MobileSearchState,
    bindings: &[B],
    partition: &str,
    request_id: &str,
    run: impl FnOnce(
        &MobileSearchState,
        &[B],
        &search_core::CancelToken,
    ) -> Result<(M, Vec<SourceReadState>), SearchError>,
) -> Result<Vec<u8>, SearchError> {
    let publisher = bindings.first().ok_or(SearchError::Protocol)?;
    // Only one current private partition is retained on Mobile.
    state
        .runtime
        .invalidate_partitions(|existing| existing != partition);
    let mut request = state.requests.begin("mobile", partition, request_id)?;
    // The coordinator qualifies the dependencies; unused bindings are not
    // publication fences for this query or independently issued Open.
    let (result, sources) = run(state, bindings, &request.cancel)?;
    publisher.publish_sources(&sources, || {
        request.complete()?;
        Ok(result.encode_to_vec())
    })
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
            let response = state.runtime.query_all(
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
            )?;
            let sources = response.sources.clone();
            Ok((response, sources))
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
            let response = state.runtime.query_all(
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
            )?;
            let sources = response.sources.clone();
            Ok((response, sources))
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
            resolve_for_publication(state, binding, &request.source_id, resource, cancel)
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

#[cfg(test)]
mod tests {
    use super::*;
    use search_core::runtime::{now_ms, ReadAuthority};
    use search_core::{SearchContributor, SearchExecutionContext, SourceFuture};
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    };

    struct Owners {
        identity_current: bool,
        sources: Vec<SourceReadState>,
    }

    #[derive(Clone)]
    struct TestBinding {
        source: SourceReadState,
        descriptor: SearchContributorDescriptor,
        owners: Arc<Mutex<Owners>>,
        advance_social: Arc<AtomicBool>,
        deny_resolve: Arc<AtomicBool>,
        resolves: Arc<AtomicUsize>,
    }

    impl TestBinding {
        fn composition() -> Vec<Self> {
            let sources: Vec<_> = [
                ("device.messaging", "messaging.read"),
                ("device.social", "social.read"),
                ("station.social.public", "public.read"),
            ]
            .into_iter()
            .map(|(source_id, binding_id)| SourceReadState {
                source_id: source_id.into(),
                binding_id: binding_id.into(),
                source_revision: "one".into(),
                policy_revision: "one".into(),
                read_scope: "partition".into(),
                state: SourceState::Ready as i32,
                extent: CoverageExtent::DeclaredScope as i32,
                no_store: source_id != "device.messaging",
            })
            .collect();
            let owners = Arc::new(Mutex::new(Owners {
                identity_current: true,
                sources: sources.clone(),
            }));
            sources
                .into_iter()
                .map(|source| {
                    let message = source.source_id == "device.messaging";
                    let remote = source.source_id == "station.social.public";
                    Self {
                        descriptor: SearchContributorDescriptor {
                            source_id: source.source_id.clone(),
                            binding_id: source.binding_id.clone(),
                            owning_module: "test-owner".into(),
                            descriptor_revision: "one".into(),
                            authority_namespaces: vec!["authority".into()],
                            kinds: vec![if message {
                                SearchKind::Message as i32
                            } else {
                                SearchKind::SocialPost as i32
                            }],
                            scopes: vec![if remote {
                                SearchScope::Station as i32
                            } else {
                                SearchScope::Device as i32
                            }],
                            max_batch: 100,
                            supports_paging: true,
                        },
                        source,
                        owners: owners.clone(),
                        advance_social: Default::default(),
                        deny_resolve: Default::default(),
                        resolves: Default::default(),
                    }
                })
                .collect()
        }

        fn resource(&self) -> ResourceRef {
            let message = self.source_id() == "device.messaging";
            ResourceRef {
                kind: if message { "message" } else { "social-post" }.into(),
                id: "target".into(),
                authority_namespace: "authority".into(),
                content_revision: "one".into(),
                message_id: if message { "target" } else { "" }.into(),
                conversation_id: if message { "conversation" } else { "" }.into(),
                ..Default::default()
            }
        }

        fn metadata(&self, phase: &str) -> CacheMetadata {
            let revision = if self.read_authority() == ReadAuthority::RemoteOwner {
                format!("owner:{phase}")
            } else {
                self.source.source_revision.clone()
            };
            CacheMetadata {
                validator: "one".into(),
                source_revision: revision.clone(),
                content_fresh_until_unix_ms: if self.source.no_store {
                    0
                } else {
                    now_ms().unwrap() as i64 + 60_000
                },
                read_validity: Some(ReadValidity {
                    read_scope: self.source.read_scope.clone(),
                    policy_revision: revision,
                    owner_check_required: true,
                    lease_until_unix_ms: 0,
                }),
                no_store: self.source.no_store,
            }
        }

        fn original_read(&self) {
            if self.advance_social.swap(false, Ordering::SeqCst) {
                let mut owners = self.owners.lock().unwrap();
                owners.sources[1].source_revision = "two".into();
                owners.sources[1].policy_revision = "two".into();
            }
        }
    }

    impl SearchBinding for TestBinding {
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
        fn read_authority(&self) -> ReadAuthority {
            if self.source_id() == "station.social.public" {
                ReadAuthority::RemoteOwner
            } else {
                ReadAuthority::LocalSnapshot
            }
        }
        fn read_state(&self) -> Result<SourceReadState, SearchError> {
            self.check()?;
            Ok(self.source.clone())
        }
        fn publish_sources<T>(
            &self,
            sources: &[SourceReadState],
            publish: impl FnOnce() -> Result<T, SearchError>,
        ) -> Result<T, SearchError> {
            let owners = self.owners.lock().unwrap();
            if !owners.identity_current {
                return Err(SearchError::Cancelled);
            }
            for source in sources {
                let current = owners
                    .sources
                    .iter()
                    .find(|current| current.source_id == source.source_id)
                    .ok_or(SearchError::Protocol)?;
                if current.source_id == "station.social.public" {
                    if source.binding_id != current.binding_id
                        || source.read_scope != current.read_scope
                        || !source.no_store
                    {
                        return Err(SearchError::Protocol);
                    }
                } else if source != current {
                    return Err(SearchError::SourceChanged);
                }
            }
            publish()
        }
        fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
            Ok(Arc::new(self.clone()))
        }
    }

    impl SearchContributor for TestBinding {
        fn descriptor(&self) -> &SearchContributorDescriptor {
            &self.descriptor
        }
        fn supports_suggestions(&self) -> bool {
            self.source_id() == "device.messaging"
        }
        fn query<'a>(
            &'a self,
            _: &'a QueryIntent,
            ctx: &'a SearchExecutionContext,
        ) -> SourceFuture<'a, SourcePage> {
            Box::pin(async move {
                ctx.check()?;
                self.original_read();
                Ok(SourcePage {
                    candidates: vec![SourceCandidate {
                        resource: Some(self.resource()),
                        source_rank: 1.0,
                    }],
                    coverage: Some(SourceCoverage {
                        source_id: self.source_id().into(),
                        state: self.source.state,
                        extent: self.source.extent,
                        detail_key: String::new(),
                    }),
                    cache: Some(self.metadata("query")),
                    expires_at_unix_ms: now_ms()? as i64 + 60_000,
                    ..Default::default()
                })
            })
        }
        fn hydrate<'a>(
            &'a self,
            input: &'a HydrationRequest,
            ctx: &'a SearchExecutionContext,
        ) -> SourceFuture<'a, HydrationReply> {
            Box::pin(async move {
                ctx.check()?;
                Ok(HydrationReply {
                    outcomes: input
                        .items
                        .iter()
                        .map(|item| HydrationOutcome {
                            item_id: item.item_id.clone(),
                            outcome: Some(hydration_outcome::Outcome::Changed(
                                AuthorizedProjection {
                                    result: Some(ResultItem {
                                        resource: item.resource.clone(),
                                        kind: self.descriptor.kinds[0],
                                        source_id: self.source_id().into(),
                                        ..Default::default()
                                    }),
                                    fields: item.fields.clone(),
                                    cache: Some(self.metadata("hydrate")),
                                },
                            )),
                        })
                        .collect(),
                })
            })
        }
        fn resolve<'a>(
            &'a self,
            resource: &'a ResourceRef,
            ctx: &'a SearchExecutionContext,
        ) -> SourceFuture<'a, ResolvedResource> {
            Box::pin(async move {
                ctx.check()?;
                self.resolves.fetch_add(1, Ordering::SeqCst);
                self.original_read();
                if self.deny_resolve.load(Ordering::SeqCst) {
                    return Err(SearchError::ResourceUnavailable);
                }
                Ok(ResolvedResource {
                    resource: Some(resource.clone()),
                    resolver_binding: "original.open".into(),
                    cache: Some(self.metadata("resolve")),
                })
            })
        }
    }

    fn query(
        state: &MobileSearchState,
        bindings: &[TestBinding],
        suggestions: bool,
        conversation: bool,
        cancel: &search_core::CancelToken,
    ) -> Result<(SearchResponse, Vec<SourceReadState>), SearchError> {
        let response = state.runtime.query_all(
            bindings,
            QueryIntent {
                text: "target".into(),
                kinds: vec![SearchKind::Message as i32],
                scopes: vec![SearchScope::Device as i32],
                limit: 20,
                suggestions,
                conversation_id: if conversation { "conversation" } else { "" }.into(),
                ..Default::default()
            },
            cancel,
        )?;
        let sources = response.sources.clone();
        Ok((response, sources))
    }

    #[test]
    fn native_query_and_suggest_ignore_unconsumed_social_revision() {
        for suggestions in [false, true] {
            for conversation in [false, true] {
                let state = MobileSearchState::default();
                let bindings = TestBinding::composition();
                bindings[0].advance_social.store(true, Ordering::SeqCst);
                let bytes = execute_bound(
                    &state,
                    &bindings,
                    "partition",
                    "query",
                    |state, bindings, cancel| {
                        query(state, bindings, suggestions, conversation, cancel)
                    },
                )
                .unwrap();
                let response = SearchResponse::decode(bytes.as_slice()).unwrap();
                assert_eq!(response.sources, vec![bindings[0].source.clone()]);
                assert_eq!(response.items.len(), 1);
                assert_eq!(response.items[0].resource, Some(bindings[0].resource()));
                assert_eq!(bindings[1].read_state(), Err(SearchError::SourceChanged));
            }
        }
    }

    #[test]
    fn native_open_ignores_unconsumed_social_revision() {
        let state = MobileSearchState::default();
        let bindings = TestBinding::composition();
        let cancel = search_core::CancelToken::new();
        query(&state, &bindings, false, false, &cancel).unwrap();
        bindings[0].advance_social.store(true, Ordering::SeqCst);
        let bytes = execute_bound(
            &state,
            &bindings,
            "partition",
            "open",
            |state, bindings, cancel| {
                resolve_for_publication(
                    state,
                    bindings,
                    bindings[0].source_id(),
                    bindings[0].resource(),
                    cancel,
                )
            },
        )
        .unwrap();
        let resolved = ResolvedResource::decode(bytes.as_slice()).unwrap();
        assert_eq!(resolved.resource, Some(bindings[0].resource()));
        assert_eq!(resolved.resolver_binding, "original.open");
        assert_eq!(bindings[1].read_state(), Err(SearchError::SourceChanged));
        assert_eq!(bindings[0].resolves.load(Ordering::SeqCst), 1);
        assert_eq!(bindings[1].resolves.load(Ordering::SeqCst), 0);
        assert_eq!(bindings[2].resolves.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn native_remote_open_retains_owner_observation_without_messaging_fence() {
        let state = MobileSearchState::default();
        let bindings = TestBinding::composition();
        let response = state
            .runtime
            .query_all(
                &bindings,
                QueryIntent {
                    text: "target".into(),
                    scopes: vec![SearchScope::Station as i32],
                    kinds: vec![SearchKind::SocialPost as i32],
                    limit: 20,
                    ..Default::default()
                },
                &search_core::CancelToken::new(),
            )
            .unwrap();
        assert_eq!(response.items.len(), 1);
        {
            let mut owners = bindings[0].owners.lock().unwrap();
            owners.sources[0].source_revision = "two".into();
            owners.sources[0].policy_revision = "two".into();
        }
        let bytes = execute_bound(
            &state,
            &bindings,
            "partition",
            "open",
            |state, bindings, cancel| {
                let (resolved, sources) = resolve_for_publication(
                    state,
                    bindings,
                    bindings[2].source_id(),
                    response.items[0].resource.clone().unwrap(),
                    cancel,
                )?;
                assert_eq!(sources.len(), 1);
                assert_eq!(sources[0].source_id, bindings[2].source_id());
                assert_eq!(sources[0].source_revision, "owner:resolve");
                assert_eq!(sources[0].policy_revision, "owner:resolve");
                assert_eq!(sources[0].read_scope, "partition");
                assert!(sources[0].no_store);
                Ok((resolved, sources))
            },
        )
        .unwrap();
        assert_eq!(
            ResolvedResource::decode(bytes.as_slice()).unwrap().resource,
            response.items[0].resource
        );
        assert_eq!(bindings[0].read_state(), Err(SearchError::SourceChanged));
    }

    #[test]
    fn native_publication_preserves_consumed_revision_identity_and_cancel_fences() {
        enum Invalidation {
            Source,
            Identity,
            Cancel,
        }
        for invalidation in [
            Invalidation::Source,
            Invalidation::Identity,
            Invalidation::Cancel,
        ] {
            let state = MobileSearchState::default();
            let bindings = TestBinding::composition();
            let expected = if matches!(invalidation, Invalidation::Source) {
                SearchError::SourceChanged
            } else {
                SearchError::Cancelled
            };
            let result = execute_bound(
                &state,
                &bindings,
                "partition",
                "query",
                |state, bindings, cancel| {
                    let result = query(state, bindings, false, false, cancel)?;
                    match invalidation {
                        Invalidation::Source => {
                            bindings[0].owners.lock().unwrap().sources[0].source_revision =
                                "two".into();
                        }
                        Invalidation::Identity => {
                            bindings[0].owners.lock().unwrap().identity_current = false;
                        }
                        Invalidation::Cancel => {
                            assert!(state.requests.cancel("mobile", "partition", "query")?);
                        }
                    }
                    Ok(result)
                },
            );
            assert_eq!(result, Err(expected));
        }
    }

    #[test]
    fn native_open_requires_issuance_and_current_original_owner() {
        let state = MobileSearchState::default();
        let bindings = TestBinding::composition();
        let cancel = search_core::CancelToken::new();
        let resource = bindings[0].resource();
        assert_eq!(
            resolve_for_publication(
                &state,
                &bindings,
                bindings[0].source_id(),
                resource.clone(),
                &cancel
            ),
            Err(SearchError::ResourceUnavailable)
        );
        query(&state, &bindings, false, false, &cancel).unwrap();
        assert_eq!(
            resolve_for_publication(
                &state,
                &bindings,
                bindings[1].source_id(),
                resource.clone(),
                &cancel
            ),
            Err(SearchError::Protocol)
        );
        let mut forged = resource.clone();
        forged.authority_namespace = "forged".into();
        assert_eq!(
            resolve_for_publication(&state, &bindings, bindings[0].source_id(), forged, &cancel),
            Err(SearchError::Protocol)
        );
        assert_eq!(bindings[0].resolves.load(Ordering::SeqCst), 0);
        bindings[0].deny_resolve.store(true, Ordering::SeqCst);
        assert_eq!(
            resolve_for_publication(
                &state,
                &bindings,
                bindings[0].source_id(),
                resource,
                &cancel
            ),
            Err(SearchError::ResourceUnavailable)
        );
        assert_eq!(bindings[0].resolves.load(Ordering::SeqCst), 1);
        assert_eq!(bindings[1].resolves.load(Ordering::SeqCst), 0);
    }
}
