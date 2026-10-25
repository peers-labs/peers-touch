//! Bounded memory reads and independent subscriber/operation lifetimes.
//!
//! The host supplies execution, original-owner authority checks and monotonic
//! validity. It must hold the authority's publication guard while committing.
//! Evictable payloads never own invalidation fences or resurrect operations.

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::model::wire::SearchResponse;
use crate::{CancelToken, SearchError};
use prost::Message;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ReadKey {
    pub partition: String,
    pub source: String,
    pub binding: String,
    pub read_scope: String,
    pub dependency: String,
    pub operation: String,
    pub semantic: Vec<u8>,
}

impl ReadKey {
    fn bytes(&self) -> usize {
        self.partition.len()
            + self.source.len()
            + self.binding.len()
            + self.read_scope.len()
            + self.dependency.len()
            + self.operation.len()
            + self.semantic.len()
            + 128
    }
}

struct Payload {
    bytes: Arc<[u8]>,
    fresh_until: Instant,
    used: u64,
    items: usize,
}

struct Flight {
    key: ReadKey,
    cancel: CancelToken,
    deadline: Instant,
    subscribers: usize,
    result: Option<Result<Arc<[u8]>, SearchError>>,
}

#[derive(Default)]
struct State {
    clock: u64,
    payloads: HashMap<ReadKey, Payload>,
    flights: HashMap<u64, Flight>,
    pending: HashMap<ReadKey, u64>,
    // Retained until every overlapping read finishes, independently of LRU.
    newest: HashMap<ReadKey, u64>,
}

impl State {
    fn flight_bytes(&self) -> usize {
        self.flights
            .values()
            .map(|f| {
                // Include the pending, operation and subscription key copies.
                f.key.bytes() * 5
                    + f.result
                        .as_ref()
                        .and_then(|r| r.as_ref().ok())
                        .map_or(0, |b| b.len())
            })
            .sum::<usize>()
            + self.newest.keys().map(ReadKey::bytes).sum::<usize>()
    }

    fn payload_bytes(&self) -> usize {
        self.payloads
            .iter()
            .map(|(key, p)| key.bytes() + p.bytes.len())
            .sum()
    }
}

#[derive(Default)]
pub struct ReadCache {
    state: Mutex<State>,
    changed: Condvar,
}

pub struct Subscription {
    cache: Arc<ReadCache>,
    key: ReadKey,
    id: u64,
    hit: Option<Arc<[u8]>>,
}

#[derive(Clone)]
pub struct Operation {
    cache: Arc<ReadCache>,
    key: ReadKey,
    id: u64,
    pub cancel: CancelToken,
    pub deadline: Instant,
}

const MAX_ENTRIES: usize = 128;
const MAX_BYTES: usize = 4 * 1024 * 1024;
const PARTITION_ENTRIES: usize = 64;
const PARTITION_BYTES: usize = 2 * 1024 * 1024;
const MAX_FLIGHTS: usize = 320;
const MAX_SESSION_FRAMES: usize = 32;
const MAX_DISPLAY_ITEMS: usize = 200;

fn semantic_key(key: &ReadKey) -> ReadKey {
    let mut key = key.clone();
    if let Some(operation) = key.operation.strip_suffix(":refresh") {
        key.operation = operation.to_owned();
    }
    key
}

impl ReadCache {
    /// Only for conditional original-owner reads. This is not permission to
    /// publish stale bytes; unchanged must independently renew read validity.
    pub fn validator_payload(&self, key: &ReadKey) -> Option<Arc<[u8]>> {
        self.state
            .lock()
            .ok()?
            .payloads
            .get(key)
            .map(|p| p.bytes.clone())
    }

    /// A new caller can reuse a successful value or attach to a live read.
    /// Refresh has a separate flight key, but replaces the same semantic value.
    pub fn subscribe(
        self: &Arc<Self>,
        mut key: ReadKey,
        refresh: bool,
        budget: Duration,
    ) -> Result<(Subscription, Option<Operation>), SearchError> {
        let mut state = self.state.lock().map_err(|_| SearchError::Cancelled)?;
        state.clock += 1;
        let used = state.clock;
        if !refresh {
            if let Some(value) = state.payloads.get_mut(&key) {
                if Instant::now() < value.fresh_until {
                    value.used = used;
                    return Ok((
                        Subscription {
                            cache: self.clone(),
                            key,
                            id: 0,
                            hit: Some(value.bytes.clone()),
                        },
                        None,
                    ));
                }
            }
        }
        state.payloads.retain(|_, p| p.fresh_until > Instant::now());
        if refresh {
            key.operation.push_str(":refresh");
        }
        if let Some(id) = state.pending.get(&key).copied() {
            let flight = state.flights.get_mut(&id).ok_or(SearchError::Cancelled)?;
            if flight.result.is_none()
                && !flight.cancel.is_cancelled()
                && Instant::now() < flight.deadline
            {
                flight.subscribers += 1;
                return Ok((
                    Subscription {
                        cache: self.clone(),
                        key,
                        id,
                        hit: None,
                    },
                    None,
                ));
            }
        }
        if state.flights.len() >= MAX_FLIGHTS {
            return Err(SearchError::SourceUnavailable("read capacity".into()));
        }
        let admission_bytes = key.bytes() * 6;
        if state.flight_bytes() + admission_bytes > MAX_BYTES {
            return Err(SearchError::SourceUnavailable("read key capacity".into()));
        }
        while state.payload_bytes() + state.flight_bytes() + admission_bytes > MAX_BYTES {
            if let Some(victim) = state
                .payloads
                .iter()
                .min_by_key(|(_, p)| p.used)
                .map(|(k, _)| k.clone())
            {
                state.payloads.remove(&victim);
            } else {
                break;
            }
        }
        if key.operation.starts_with("session")
            && state
                .flights
                .values()
                .filter(|f| f.key.operation.starts_with("session"))
                .count()
                >= MAX_SESSION_FRAMES
        {
            return Err(SearchError::SourceUnavailable(
                "session read capacity".into(),
            ));
        }
        state.clock += 1;
        let id = state.clock;
        state.newest.insert(semantic_key(&key), id);
        let cancel = CancelToken::new();
        let deadline = Instant::now() + budget;
        state.pending.insert(key.clone(), id);
        state.flights.insert(
            id,
            Flight {
                key: key.clone(),
                cancel: cancel.clone(),
                deadline,
                subscribers: 1,
                result: None,
            },
        );
        let operation = Operation {
            cache: self.clone(),
            key: key.clone(),
            id,
            cancel,
            deadline,
        };
        Ok((
            Subscription {
                cache: self.clone(),
                key,
                id,
                hit: None,
            },
            Some(operation),
        ))
    }

    /// Authority/source invalidation is serialized with commit and publication.
    /// Completed and running handles are cancelled before payloads are removed.
    pub fn invalidate(&self, matches: impl Fn(&ReadKey) -> bool) {
        if let Ok(mut state) = self.state.lock() {
            for flight in state.flights.values_mut() {
                if matches(&flight.key) {
                    log::debug!(target: "search",
                        "Search source changed phase=cache_invalidation source={}",
                        flight.key.source);
                    flight.cancel.cancel();
                    flight.result = Some(Err(SearchError::SourceChanged));
                }
            }
            state.payloads.retain(|key, _| !matches(key));
            self.changed.notify_all();
        }
    }
}

impl Operation {
    pub fn check(&self) -> Result<(), SearchError> {
        self.cancel.check()?;
        if Instant::now() >= self.deadline {
            return Err(SearchError::Timeout);
        }
        let state = self
            .cache
            .state
            .lock()
            .map_err(|_| SearchError::Cancelled)?;
        match state.flights.get(&self.id) {
            Some(f) if f.result.is_none() && !f.cancel.is_cancelled() => Ok(()),
            _ => Err(SearchError::Cancelled),
        }
    }

    /// Call under the original authority's guard. No-store values can be shared
    /// by current subscribers, but never enter the reusable payload map.
    pub fn commit(
        &self,
        bytes: Vec<u8>,
        fresh_until: Instant,
        no_store: bool,
    ) -> Result<(), SearchError> {
        self.cancel.check()?;
        let mut state = self
            .cache
            .state
            .lock()
            .map_err(|_| SearchError::Cancelled)?;
        if bytes.len() > PARTITION_BYTES {
            return Err(SearchError::SourceUnavailable("reply capacity".into()));
        }
        let flight_bytes = state.flight_bytes();
        if flight_bytes + bytes.len() > MAX_BYTES {
            return Err(SearchError::SourceUnavailable("read byte capacity".into()));
        }
        while state.payload_bytes() + flight_bytes + bytes.len() > MAX_BYTES {
            let victim = state
                .payloads
                .iter()
                .min_by_key(|(_, p)| p.used)
                .map(|(k, _)| k.clone());
            if let Some(victim) = victim {
                state.payloads.remove(&victim);
            } else {
                break;
            }
        }
        let flight = state
            .flights
            .get_mut(&self.id)
            .ok_or(SearchError::Cancelled)?;
        if flight.cancel.is_cancelled() || flight.result.is_some() {
            return Err(SearchError::Cancelled);
        }
        if Instant::now() >= flight.deadline {
            return Err(SearchError::Timeout);
        }
        let bytes: Arc<[u8]> = bytes.into();
        flight.result = Some(Ok(bytes.clone()));
        let key = semantic_key(&self.key);
        let newest = state.newest.get(&key) == Some(&self.id);
        if newest && no_store {
            state.payloads.remove(&key);
        }
        if newest && !no_store && bytes.len() <= PARTITION_BYTES && fresh_until > Instant::now() {
            let items = if key.operation == "session" {
                SearchResponse::decode(bytes.as_ref())
                    .map_err(|_| SearchError::Protocol)?
                    .items
                    .len()
            } else {
                0
            };
            state.clock += 1;
            let used = state.clock;
            state.payloads.insert(
                key.clone(),
                Payload {
                    bytes: bytes.clone(),
                    fresh_until,
                    used,
                    items,
                },
            );
            loop {
                let total = state.payload_bytes();
                let scoped: Vec<_> = state
                    .payloads
                    .iter()
                    .filter(|(k, _)| k.partition == key.partition && k.source == key.source)
                    .collect();
                let scoped_bytes: usize =
                    scoped.iter().map(|(k, p)| k.bytes() + p.bytes.len()).sum();
                let scoped_over =
                    scoped.len() > PARTITION_ENTRIES || scoped_bytes > PARTITION_BYTES;
                let session_over = state
                    .payloads
                    .iter()
                    .filter(|(k, _)| k.operation == "session")
                    .count()
                    > MAX_SESSION_FRAMES
                    || state.payloads.values().map(|p| p.items).sum::<usize>() > MAX_DISPLAY_ITEMS;
                if !scoped_over
                    && !session_over
                    && state.payloads.len() <= MAX_ENTRIES
                    && total + flight_bytes + bytes.len() <= MAX_BYTES
                {
                    break;
                }
                let victim = state
                    .payloads
                    .iter()
                    .filter(|(k, _)| {
                        (!scoped_over || (k.partition == key.partition && k.source == key.source))
                            && (!session_over || k.operation == "session")
                    })
                    .min_by_key(|(_, p)| p.used)
                    .map(|(k, _)| k.clone());
                if let Some(victim) = victim {
                    state.payloads.remove(&victim);
                } else {
                    break;
                }
            }
        }
        self.cache.changed.notify_all();
        Ok(())
    }

    pub fn fail(&self, error: SearchError) {
        if let Ok(mut state) = self.cache.state.lock() {
            if let Some(flight) = state.flights.get_mut(&self.id) {
                if flight.result.is_none() {
                    flight.result = Some(Err(error));
                }
            }
            self.cache.changed.notify_all();
        }
    }
}

impl Subscription {
    /// Detaching one subscriber never cancels another subscriber's read.
    /// The caller must revalidate authority under its own publication guard.
    pub fn wait(&self, cancel: &CancelToken, deadline: Instant) -> Result<Arc<[u8]>, SearchError> {
        loop {
            cancel.check()?;
            if Instant::now() >= deadline {
                return Err(SearchError::Timeout);
            }
            if let Some(hit) = &self.hit {
                return Ok(hit.clone());
            }
            let state = self
                .cache
                .state
                .lock()
                .map_err(|_| SearchError::Cancelled)?;
            let flight = state.flights.get(&self.id).ok_or(SearchError::Cancelled)?;
            if matches!(flight.result, Some(Err(SearchError::SourceChanged))) {
                return Err(SearchError::SourceChanged);
            }
            if flight.cancel.is_cancelled() {
                return Err(SearchError::Cancelled);
            }
            if let Some(result) = &flight.result {
                return result.clone();
            }
            if Instant::now() >= flight.deadline {
                return Err(SearchError::Timeout);
            }
            let _ = self
                .cache
                .changed
                .wait_timeout(state, Duration::from_millis(20))
                .map_err(|_| SearchError::Cancelled)?;
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if self.id == 0 {
            return;
        }
        if let Ok(mut state) = self.cache.state.lock() {
            if let Some(flight) = state.flights.get_mut(&self.id) {
                flight.subscribers -= 1;
                if flight.subscribers == 0 {
                    flight.cancel.cancel();
                    state.flights.remove(&self.id);
                    if state.pending.get(&self.key) == Some(&self.id) {
                        state.pending.remove(&self.key);
                    }
                    let family = semantic_key(&self.key);
                    if !state
                        .flights
                        .values()
                        .any(|f| semantic_key(&f.key) == family)
                    {
                        state.newest.remove(&family);
                    }
                }
            }
            self.cache.changed.notify_all();
        }
    }
}
