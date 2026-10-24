//! Bounded ranking snapshots. Cursors reference state, never source tokens or refs.

use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};

use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::cache::{Operation, ReadKey};
use crate::contributor::{narrow_intent, normalize_intent, same_resource};
use crate::cursor::authenticated::AuthenticatedCursorCodec;
use crate::model::wire::*;
use crate::runtime::{
    apply_observation, now_ms, ReadAuthority, SearchBinding, SearchExecutor, SearchRuntime,
    READ_BUDGET,
};
use crate::{CancelToken, SearchError};

const MAX_SESSIONS: usize = 32;
const MAX_ITEMS: usize = 640;
const MAX_BYTES: usize = 4 * 1024 * 1024;
const SESSION_MS: u64 = 300_000;

#[derive(Clone)]
struct SourceSnapshot {
    state: SourceReadState,
    authority: ReadAuthority,
    binding_generation: String,
    input: QueryIntent,
    pending: Vec<SourceCandidate>,
    next: String,
    started: bool,
    rank_offset: usize,
    coverage: SourceCoverage,
    fresh_until: Instant,
}

#[derive(Clone)]
struct Issued {
    source: SourceReadState,
    resource: ResourceRef,
    validity: ReadValidity,
    until: Instant,
    authority: ReadAuthority,
    binding_generation: String,
}

#[derive(Clone)]
struct Session {
    id: u64,
    partition: String,
    semantic: String,
    step: u64,
    created: u64,
    expiry: u64,
    until: Instant,
    sources: Vec<SourceSnapshot>,
    issued: HashMap<String, Issued>,
}

struct Slot {
    partition: String,
    until: Instant,
    value: Mutex<Session>,
    bytes: AtomicUsize,
    items: AtomicUsize,
}

pub(crate) struct SessionStore {
    slots: Mutex<HashMap<u64, Arc<Slot>>>,
    codec: AuthenticatedCursorCodec,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self {
            slots: Default::default(),
            codec: AuthenticatedCursorCodec::new(rand::random()),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    session: u64,
    step: u64,
}

fn association(source: &str, resource: &ResourceRef) -> String {
    format!(
        "{:?}",
        (source, resource.fusion_key(), &resource.content_revision)
    )
}

impl Session {
    fn measure(&self) -> (usize, usize) {
        let mut bytes = self.partition.len() + self.semantic.len() + 256;
        let mut items = self.issued.len();
        for source in &self.sources {
            bytes += source.binding_generation.len()
                + source.state.encoded_len()
                + source.input.encoded_len()
                + source.next.len()
                + source.coverage.encoded_len();
            items += source.pending.len();
            bytes += source
                .pending
                .iter()
                .map(|c| c.encoded_len() + 64)
                .sum::<usize>();
        }
        bytes += self
            .issued
            .iter()
            .map(|(key, value)| {
                key.len()
                    + value.source.encoded_len()
                    + value.resource.encoded_len()
                    + value.validity.encoded_len()
                    + 64
            })
            .sum::<usize>();
        (bytes, items)
    }

    fn record(&mut self, items: &[ResultItem]) -> Result<(), SearchError> {
        for item in items {
            let resource = item.resource.as_ref().ok_or(SearchError::Protocol)?;
            let source = self
                .sources
                .iter()
                .find(|s| s.state.source_id == item.source_id)
                .ok_or(SearchError::Protocol)?;
            let validity = item.read_validity.clone().ok_or(SearchError::Protocol)?;
            let until = if validity.owner_check_required {
                self.until
            } else {
                self.until.min(
                    Instant::now()
                        + Duration::from_millis(
                            (validity.lease_until_unix_ms as u64).saturating_sub(now_ms()?),
                        ),
                )
            };
            self.issued.insert(
                association(&item.source_id, resource),
                Issued {
                    source: source.state.clone(),
                    resource: resource.clone(),
                    validity,
                    until,
                    authority: source.authority,
                    binding_generation: source.binding_generation.clone(),
                },
            );
        }
        Ok(())
    }
}

impl SessionStore {
    pub(crate) fn invalidate(&self, matches: &impl Fn(&str) -> bool) {
        if let Ok(mut slots) = self.slots.lock() {
            slots.retain(|_, slot| !matches(&slot.partition));
        }
    }

    fn slot(&self, id: u64) -> Result<Arc<Slot>, SearchError> {
        self.slots
            .lock()
            .map_err(|_| SearchError::Cancelled)?
            .get(&id)
            .filter(|s| s.until > Instant::now())
            .cloned()
            .ok_or(SearchError::CursorExpired)
    }

    /// Eviction is conservative and bounded; an evicted cursor never restarts.
    fn admit(
        &self,
        session: &Session,
        existing: Option<&Arc<Slot>>,
    ) -> Result<Arc<Slot>, SearchError> {
        let (bytes, items) = session.measure();
        if bytes > MAX_BYTES || items > MAX_ITEMS {
            return Err(SearchError::SourceUnavailable("session capacity".into()));
        }
        let mut slots = self.slots.lock().map_err(|_| SearchError::Cancelled)?;
        slots.retain(|_, slot| slot.until > Instant::now());
        if existing.is_some() && !slots.contains_key(&session.id) {
            return Err(SearchError::CursorExpired);
        }
        loop {
            let others: Vec<_> = slots.iter().filter(|(id, _)| **id != session.id).collect();
            let total_bytes = others
                .iter()
                .map(|(_, s)| s.bytes.load(Ordering::Relaxed))
                .sum::<usize>();
            let total_items = others
                .iter()
                .map(|(_, s)| s.items.load(Ordering::Relaxed))
                .sum::<usize>();
            if others.len() < MAX_SESSIONS
                && total_bytes + bytes <= MAX_BYTES
                && total_items + items <= MAX_ITEMS
            {
                break;
            }
            let victim = others
                .iter()
                .min_by_key(|(_, slot)| slot.until)
                .map(|(id, _)| **id)
                .ok_or_else(|| SearchError::SourceUnavailable("session capacity".into()))?;
            slots.remove(&victim);
        }
        let slot = existing.cloned().unwrap_or_else(|| {
            Arc::new(Slot {
                partition: session.partition.clone(),
                until: session.until,
                value: Mutex::new(session.clone()),
                bytes: AtomicUsize::new(0),
                items: AtomicUsize::new(0),
            })
        });
        slot.bytes.store(bytes, Ordering::Relaxed);
        slot.items.store(items, Ordering::Relaxed);
        slots.insert(session.id, slot.clone());
        Ok(slot)
    }

    pub(crate) fn remember(
        &self,
        response: &SearchResponse,
        page: &SourcePage,
        binding_generation: &str,
        authority: ReadAuthority,
    ) -> Result<(), SearchError> {
        let now = now_ms()?;
        let mut session = Session {
            id: rand::random(),
            partition: response.partition.clone(),
            semantic: String::new(),
            step: 0,
            created: now,
            expiry: response.expires_at_unix_ms as u64,
            until: Instant::now()
                + Duration::from_millis(
                    (response.expires_at_unix_ms as u64)
                        .saturating_sub(now)
                        .min(SESSION_MS),
                ),
            sources: response
                .sources
                .iter()
                .map(|state| SourceSnapshot {
                    state: state.clone(),
                    authority,
                    binding_generation: binding_generation.into(),
                    input: Default::default(),
                    pending: Vec::new(),
                    next: String::new(),
                    started: true,
                    rank_offset: 0,
                    coverage: page.coverage.clone().unwrap_or_default(),
                    fresh_until: Instant::now(),
                })
                .collect(),
            issued: HashMap::new(),
        };
        session.record(&response.items)?;
        self.admit(&session, None)?;
        Ok(())
    }
}

fn semantic(partition: &str, input: &QueryIntent) -> String {
    let mut input = input.clone();
    input.cursor.clear();
    input.refresh = false;
    let mut hash = Sha256::new();
    hash.update(partition.as_bytes());
    hash.update(input.encode_to_vec());
    format!("{:x}", hash.finalize())
}

fn failed(source: &mut SourceSnapshot, error: &SearchError) {
    source.started = true;
    source.next.clear();
    source.coverage.state = SourceState::Unavailable as i32;
    source.coverage.detail_key = match error {
        SearchError::Timeout => "search.coverage.source_timeout",
        SearchError::Protocol => "search.coverage.source_protocol",
        _ => "search.coverage.source_unavailable",
    }
    .into();
}

impl<E: SearchExecutor> SearchRuntime<E> {
    /// Project original-owner states without discovering adapters or reading content.
    pub fn read_states<B: SearchBinding>(
        &self,
        bindings: &[B],
    ) -> Result<SearchReadState, SearchError> {
        if bindings.is_empty() || bindings.len() > 3 {
            return Err(SearchError::Protocol);
        }
        let partition = bindings[0].partition();
        let mut names = HashSet::new();
        let mut sources = Vec::new();
        for binding in bindings {
            if binding.partition() != partition || !names.insert(binding.source_id()) {
                return Err(SearchError::Protocol);
            }
            let state = binding.read_state()?;
            if state.source_id != binding.source_id()
                || state.binding_id != binding.binding_id()
                || (binding.read_authority() == ReadAuthority::LocalSnapshot
                    && state.source_revision != binding.source_revision())
                || (binding.read_authority() == ReadAuthority::RemoteOwner && !state.no_store)
                || state.read_scope.is_empty()
            {
                return Err(SearchError::Protocol);
            }
            sources.push(state);
        }
        sources.sort_by(|a, b| a.source_id.cmp(&b.source_id));
        Ok(SearchReadState {
            partition: partition.into(),
            sources,
        })
    }

    /// `B` is a concrete trusted composition, typically the host's Binding enum.
    pub fn query_all<B: SearchBinding>(
        &self,
        bindings: &[B],
        input: QueryIntent,
        cancel: &CancelToken,
    ) -> Result<SearchResponse, SearchError> {
        let deadline = Instant::now() + READ_BUDGET;
        cancel.check()?;
        let input = normalize_intent(input)?;
        let read_states = self.read_states(bindings)?;
        let partition = bindings[0].partition();
        let mut snapshots = Vec::new();
        for binding in bindings {
            if input.suggestions && binding.read_authority() == ReadAuthority::RemoteOwner {
                continue;
            }
            let state = read_states
                .sources
                .iter()
                .find(|s| s.source_id == binding.source_id())
                .ok_or(SearchError::Protocol)?
                .clone();
            match self.source(binding) {
                Ok(source) => {
                    if input.suggestions && !source.supports_suggestions() {
                        continue;
                    }
                    if let Some(mut narrowed) = narrow_intent(source.descriptor(), &input) {
                        narrowed.cursor.clear();
                        narrowed.limit = source.descriptor().max_batch.min(100);
                        snapshots.push(SourceSnapshot {
                            coverage: SourceCoverage {
                                source_id: state.source_id.clone(),
                                state: state.state,
                                extent: state.extent,
                                detail_key: String::new(),
                            },
                            started: state.state == SourceState::Unavailable as i32,
                            state,
                            authority: binding.read_authority(),
                            binding_generation: binding.source_revision().into(),
                            input: narrowed,
                            pending: Vec::new(),
                            next: String::new(),
                            rank_offset: 0,
                            fresh_until: Instant::now(),
                        });
                    }
                }
                Err(error) => {
                    let mut snapshot = SourceSnapshot {
                        coverage: SourceCoverage {
                            source_id: state.source_id.clone(),
                            state: state.state,
                            extent: state.extent,
                            detail_key: String::new(),
                        },
                        state,
                        authority: binding.read_authority(),
                        binding_generation: binding.source_revision().into(),
                        input: input.clone(),
                        pending: Vec::new(),
                        next: String::new(),
                        started: true,
                        rank_offset: 0,
                        fresh_until: Instant::now(),
                    };
                    failed(&mut snapshot, &error);
                    snapshots.push(snapshot);
                }
            }
        }
        snapshots.sort_by(|a, b| a.state.source_id.cmp(&b.state.source_id));
        let identity = semantic(partition, &input);
        let states = SearchReadState {
            sources: snapshots.iter().map(|s| s.state.clone()).collect(),
            partition: partition.into(),
        };
        let mut canonical = input.clone();
        canonical.refresh = false;
        let mut bytes = canonical.encode_to_vec();
        bytes.extend(states.encode_to_vec());
        bytes.extend(
            serde_json::to_vec(
                &snapshots
                    .iter()
                    .map(|s| &s.binding_generation)
                    .collect::<Vec<_>>(),
            )
            .map_err(|_| SearchError::Protocol)?,
        );
        let key = ReadKey {
            partition: partition.into(),
            source: "$session".into(),
            binding: identity.clone(),
            read_scope: partition.into(),
            dependency: format!("{:x}", Sha256::digest(states.encode_to_vec())),
            operation: "session".into(),
            semantic: bytes,
        };
        let (subscription, operation) = self.cache.subscribe(
            key,
            input.refresh,
            deadline.saturating_duration_since(Instant::now()),
        )?;
        if let Some(operation) = operation {
            let runtime = self.clone();
            let bindings = bindings.to_vec();
            let input = input.clone();
            self.executor.spawn(Box::new(move || {
                if let Err(error) =
                    runtime.advance(&bindings, input, snapshots, identity, &operation)
                {
                    operation.fail(error);
                }
            }));
        }
        let bytes = subscription.wait(cancel, deadline)?;
        let response = SearchResponse::decode(bytes.as_ref()).map_err(|_| SearchError::Protocol)?;
        bindings[0].publish_sources(&response.sources.clone(), || {
            cancel.check()?;
            self.validate_visible(&response)?;
            Ok(response)
        })
    }

    fn advance<B: SearchBinding>(
        &self,
        bindings: &[B],
        input: QueryIntent,
        snapshots: Vec<SourceSnapshot>,
        identity: String,
        operation: &Operation,
    ) -> Result<(), SearchError> {
        operation.check()?;
        let now = now_ms()?;
        let mut requested_step = None;
        let slot = if input.cursor.is_empty() {
            None
        } else {
            let cursor: Cursor = self
                .sessions
                .codec
                .decode(&input.cursor, &identity, now)
                .map_err(|_| SearchError::CursorExpired)?;
            let slot = self.sessions.slot(cursor.session)?;
            requested_step = Some(cursor.step);
            Some(slot)
        };
        let mut guard = slot
            .as_ref()
            .map(|s| s.value.lock().map_err(|_| SearchError::Cancelled))
            .transpose()?;
        let mut draft = if let Some(session) = &guard {
            let session = (*session).clone();
            if Some(session.step) != requested_step {
                return Err(SearchError::CursorExpired);
            }
            if session.partition != bindings[0].partition()
                || session.semantic != identity
                || session.created > now
                || session.expiry <= now
                || session.until <= Instant::now()
            {
                return Err(SearchError::CursorExpired);
            }
            if session.sources.len() != snapshots.len()
                || session
                    .sources
                    .iter()
                    .zip(&snapshots)
                    .any(|(previous, current)| {
                        previous.authority != current.authority
                            || previous.binding_generation != current.binding_generation
                            || match previous.authority {
                                ReadAuthority::LocalSnapshot => previous.state != current.state,
                                ReadAuthority::RemoteOwner => {
                                    previous.state.source_id != current.state.source_id
                                        || previous.state.binding_id != current.state.binding_id
                                        || previous.state.read_scope != current.state.read_scope
                                        || !current.state.no_store
                                }
                            }
                    })
            {
                return Err(SearchError::SourceChanged);
            }
            session
        } else {
            Session {
                id: rand::random(),
                partition: bindings[0].partition().into(),
                semantic: identity.clone(),
                step: 0,
                created: now,
                expiry: now + SESSION_MS,
                until: Instant::now() + Duration::from_millis(SESSION_MS),
                sources: snapshots,
                issued: HashMap::new(),
            }
        };
        self.refill(bindings, &mut draft, operation)?;
        let previously_issued: HashSet<_> = draft
            .issued
            .values()
            .map(|i| i.resource.fusion_key())
            .collect();
        for source in &mut draft.sources {
            source.pending.retain(|c| {
                c.resource
                    .as_ref()
                    .is_some_and(|r| !previously_issued.contains(&r.fusion_key()))
            });
        }
        let mut ranked: HashMap<String, (f64, usize, ResourceRef)> = HashMap::new();
        for (index, source) in draft.sources.iter().enumerate() {
            for candidate in &source.pending {
                let resource = candidate.resource.as_ref().ok_or(SearchError::Protocol)?;
                let score = 1.0 / (crate::ranking::DEFAULT_RRF_K as f64 + candidate.source_rank);
                ranked
                    .entry(resource.fusion_key())
                    .and_modify(|row| row.0 += score)
                    .or_insert((score, index, resource.clone()));
            }
        }
        let mut ranked: Vec<_> = ranked.into_values().collect();
        ranked.sort_by(|a, b| {
            b.0.total_cmp(&a.0)
                .then(a.1.cmp(&b.1))
                .then(a.2.fusion_key().cmp(&b.2.fusion_key()))
        });
        ranked.truncate(input.limit as usize);
        let mut items = Vec::new();
        // Hydration is also fan-out, with the same original operation deadline.
        let (tx, rx) = mpsc::channel();
        for (index, source) in draft.sources.iter().enumerate() {
            let refs: Vec<_> = ranked
                .iter()
                .filter(|r| r.1 == index)
                .map(|r| r.2.clone())
                .collect();
            if refs.is_empty() {
                continue;
            }
            let binding = bindings
                .iter()
                .find(|b| b.source_id() == source.state.source_id)
                .ok_or(SearchError::Protocol)?
                .clone();
            let runtime = self.clone();
            let tx = tx.clone();
            let cancel = operation.cancel.clone();
            let deadline = operation.deadline - Duration::from_millis(20);
            let refresh = input.refresh || source.state.no_store;
            self.executor.spawn(Box::new(move || {
                let _ = tx.send((
                    index,
                    runtime.hydrate(&binding, refs, refresh, &cancel, deadline),
                ));
            }));
        }
        drop(tx);
        for (index, result) in rx.iter() {
            match result {
                Ok(hydrated) => {
                    if draft.sources[index].authority == ReadAuthority::RemoteOwner
                        && !hydrated.state.source_revision.is_empty()
                    {
                        let state = &mut draft.sources[index].state;
                        state.source_revision = hydrated.state.source_revision;
                        state.policy_revision = hydrated.state.policy_revision;
                        state.read_scope = hydrated.state.read_scope;
                    }
                    items.extend(hydrated.items);
                }
                Err(error) => failed(&mut draft.sources[index], &error),
            }
        }
        operation.check()?;
        items.sort_by_key(|item| {
            ranked
                .iter()
                .position(|r| {
                    item.resource
                        .as_ref()
                        .is_some_and(|ref_| same_resource(ref_, &r.2))
                })
                .unwrap_or(usize::MAX)
        });
        for item in &mut items {
            item.score = ranked
                .iter()
                .find(|r| {
                    item.resource
                        .as_ref()
                        .is_some_and(|ref_| same_resource(ref_, &r.2))
                })
                .map_or(0.0, |r| r.0);
        }
        let consumed: HashSet<_> = ranked.iter().map(|r| r.2.fusion_key()).collect();
        for source in &mut draft.sources {
            source.pending.retain(|c| {
                c.resource
                    .as_ref()
                    .is_some_and(|r| !consumed.contains(&r.fusion_key()))
            });
        }
        draft.record(&items)?;
        draft.step += 1;
        let has_more = draft
            .sources
            .iter()
            .any(|s| !s.pending.is_empty() || !s.next.is_empty());
        let cursor = if has_more {
            self.sessions
                .codec
                .encode_until(
                    Cursor {
                        session: draft.id,
                        step: draft.step,
                    },
                    &identity,
                    draft.expiry,
                )
                .map_err(|_| SearchError::CursorExpired)?
        } else {
            String::new()
        };
        let response = SearchResponse {
            items,
            next_cursor: cursor,
            has_more,
            coverage: draft.sources.iter().map(|s| s.coverage.clone()).collect(),
            sources: draft.sources.iter().map(|s| s.state.clone()).collect(),
            partition: draft.partition.clone(),
            expires_at_unix_ms: draft.expiry as i64,
        };
        bindings[0].publish_sources(&response.sources, || {
            operation.check()?;
            self.validate_visible(&response)?;
            let until = response
                .items
                .iter()
                .filter_map(|i| i.read_validity.as_ref())
                .filter(|v| !v.owner_check_required)
                .map(|v| v.lease_until_unix_ms as u64)
                .min()
                .unwrap_or(draft.expiry)
                .min(draft.expiry);
            let no_store = response.sources.iter().any(|s| s.no_store)
                || response
                    .coverage
                    .iter()
                    .any(|c| c.state != SourceState::Ready as i32);
            let fresh_until = draft
                .sources
                .iter()
                .map(|s| s.fresh_until)
                .min()
                .unwrap_or(draft.until)
                .min(draft.until)
                .min(Instant::now() + Duration::from_millis(until.saturating_sub(now_ms()?)));
            self.sessions.admit(&draft, slot.as_ref())?;
            let commit = operation.commit(response.encode_to_vec(), fresh_until, no_store);
            if let Err(error) = commit {
                if slot.is_none() {
                    self.sessions
                        .slots
                        .lock()
                        .map_err(|_| SearchError::Cancelled)?
                        .remove(&draft.id);
                }
                return Err(error);
            }
            if let Some(guard) = &mut guard {
                **guard = draft;
            }
            Ok(())
        })
    }

    fn refill<B: SearchBinding>(
        &self,
        bindings: &[B],
        draft: &mut Session,
        operation: &Operation,
    ) -> Result<(), SearchError> {
        let (tx, rx) = mpsc::channel();
        for (index, source) in draft.sources.iter().enumerate() {
            if !source.pending.is_empty() || (source.started && source.next.is_empty()) {
                continue;
            }
            let binding = bindings
                .iter()
                .find(|b| b.source_id() == source.state.source_id)
                .ok_or(SearchError::Protocol)?
                .clone();
            let runtime = self.clone();
            let mut input = source.input.clone();
            input.cursor = source.next.clone();
            input.refresh |= source.state.no_store;
            let tx = tx.clone();
            let cancel = operation.cancel.clone();
            let deadline = operation.deadline - Duration::from_millis(100);
            self.executor.spawn(Box::new(move || {
                let _ = tx.send((
                    index,
                    runtime.source_page(&binding, input, &cancel, deadline),
                ));
            }));
        }
        drop(tx);
        for (index, result) in rx.iter() {
            let source = &mut draft.sources[index];
            match result {
                Ok(mut page) => {
                    if source.started
                        && !page.next_cursor.is_empty()
                        && page.next_cursor == source.next
                    {
                        return Err(SearchError::Protocol);
                    }
                    draft.expiry = draft.expiry.min(page.expires_at_unix_ms as u64);
                    draft.until = draft.until.min(
                        Instant::now()
                            + Duration::from_millis(draft.expiry.saturating_sub(now_ms()?)),
                    );
                    source.started = true;
                    source.next = page.next_cursor;
                    source.coverage = page.coverage.ok_or(SearchError::Protocol)?;
                    source.state.no_store |= page.cache.as_ref().is_some_and(|c| c.no_store);
                    if source.authority == ReadAuthority::RemoteOwner {
                        apply_observation(
                            &mut source.state,
                            page.cache.as_ref().ok_or(SearchError::Protocol)?,
                        )?;
                        source.state.state = source.coverage.state;
                        source.state.extent = source.coverage.extent;
                    }
                    source.fresh_until = crate::runtime::freshness(
                        page.cache.as_ref().ok_or(SearchError::Protocol)?,
                    )?;
                    for candidate in &mut page.candidates {
                        candidate.source_rank += source.rank_offset as f64;
                    }
                    source.rank_offset += page.candidates.len();
                    source.pending = page.candidates;
                }
                Err(SearchError::SourceChanged) => return Err(SearchError::SourceChanged),
                Err(error) => failed(source, &error),
            }
        }
        operation.check()
    }

    fn validate_visible(&self, response: &SearchResponse) -> Result<(), SearchError> {
        let now = now_ms()? as i64;
        if response.expires_at_unix_ms <= now {
            return Err(SearchError::CursorExpired);
        }
        for item in &response.items {
            let source = response
                .sources
                .iter()
                .find(|s| s.source_id == item.source_id)
                .ok_or(SearchError::Protocol)?;
            let validity = item.read_validity.as_ref().ok_or(SearchError::Protocol)?;
            if validity.read_scope != source.read_scope
                || validity.policy_revision != source.policy_revision
                || (!validity.owner_check_required && validity.lease_until_unix_ms <= now)
            {
                return Err(SearchError::SourceChanged);
            }
        }
        Ok(())
    }

    /// No kind routing or fallback: only the source which issued this exact ref.
    pub fn resolve_all<B: SearchBinding>(
        &self,
        bindings: &[B],
        source_id: &str,
        resource: ResourceRef,
        cancel: &CancelToken,
    ) -> Result<ResolvedResource, SearchError> {
        cancel.check()?;
        let binding = bindings
            .iter()
            .find(|b| b.source_id() == source_id)
            .ok_or(SearchError::ResourceUnavailable)?;
        if bindings
            .iter()
            .filter(|b| b.source_id() == source_id)
            .count()
            != 1
        {
            return Err(SearchError::Protocol);
        }
        let state = binding.read_state()?;
        let slots: Vec<_> = self
            .sessions
            .slots
            .lock()
            .map_err(|_| SearchError::Cancelled)?
            .values()
            .filter(|s| s.partition == binding.partition() && s.until > Instant::now())
            .cloned()
            .collect();
        let mut issued = None;
        for slot in slots {
            if let Ok(session) = slot.value.try_lock() {
                if now_ms()? >= session.expiry || now_ms()? < session.created {
                    continue;
                }
                if let Some(value) = session.issued.get(&association(source_id, &resource)) {
                    issued = Some(value.clone());
                    break;
                }
            }
        }
        let issued = issued.ok_or(SearchError::ResourceUnavailable)?;
        let mut expected = issued.source.clone();
        expected.no_store = state.no_store;
        let same_binding = issued.authority == binding.read_authority()
            && issued.binding_generation == binding.source_revision()
            && match issued.authority {
                ReadAuthority::LocalSnapshot => expected == state,
                ReadAuthority::RemoteOwner => {
                    state.no_store
                        && expected.source_id == state.source_id
                        && expected.binding_id == state.binding_id
                        && expected.read_scope == state.read_scope
                }
            };
        if !same_binding || issued.resource != resource || issued.until <= Instant::now() {
            return Err(SearchError::ResourceUnavailable);
        }
        if !issued.validity.owner_check_required
            && issued.validity.lease_until_unix_ms <= now_ms()? as i64
        {
            return Err(SearchError::ResourceUnavailable);
        }
        binding.publish(|| cancel.check())?;
        self.resolve_source(binding, resource, cancel)
    }
}
