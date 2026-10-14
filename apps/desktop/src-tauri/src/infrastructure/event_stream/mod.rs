//! The single SSE consumer for the canonical realtime event stream.
//!
//! See `docs/architecture/shared/communication/event-stream.md` for the wire
//! contract this module implements. In short:
//!
//! * One long-lived SSE connection per actor to `/events/stream`.
//! * Frames are protobuf `StreamEvent` base64-encoded into the SSE
//!   `data:` field with `event_id` riding in the SSE `id:` field.
//! * Reconnect uses `Last-Event-ID` so the server replays missed
//!   events out of its ring buffer; if the cursor is too old the
//!   server sends a `Resync` event and the frontend triggers a cold
//!   catch-up.
//! * 30s no-frame deadline (heartbeat or business event resets it);
//!   silent-NAT detection without depending on TCP keepalive.
//!
//! The module is sync/blocking because there is only one canonical
//! realtime connection per actor. Async migration is a future concern.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::Engine;
use prost::Message;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CACHE_CONTROL};
use reqwest::Method;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use crate::application::station_runtime::client::{
    ReplayPolicy, StationClient, StationRequest, StationRequestBody, StationRouteSecurity,
    TrafficClass,
};
use crate::infrastructure::session_revocation;
use crate::infrastructure::storage::{self, StorageKind};
use crate::model::realtime::v1::{stream_event::Kind as StreamKind, StreamEvent};

// ---------------------------------------------------------------------
// Tauri event channel names — the public contract with the frontend.
//
// These names are part of the wire contract between Rust and TS;
// renaming them is a breaking change to the frontend dispatcher.
// ---------------------------------------------------------------------

/// Every realtime frame the bus delivers reaches the frontend through
/// this channel. Payload: `{ actor_ptid, session_epoch, station_peer_id,
/// station_url, event_id, data_b64 }`. The frontend uses the stream scope as a
/// lifecycle fence and decodes `data_b64` with the generated TypeScript
/// protobuf schema.
pub const EVENT_REALTIME: &str = "realtime:event";

/// Connection lifecycle hint for the UI ("Connecting…", "Online",
/// "Offline"). Payload: `{ connected: bool, reason?: String }`.
/// Frequency-limited — emitted only on transitions.
pub const EVENT_CONNECTION_STATE: &str = "realtime:connection-state";

// ---------------------------------------------------------------------
// Per-actor supervisor registry.
//
// A logout / actor switch can shut down exactly the supervisor that
// belongs to the departing actor without touching anyone else's stream.
// Keyed by `actor_ptid`.
// ---------------------------------------------------------------------

struct StreamControl {
    cancellation: CancellationToken,
}

impl StreamControl {
    fn new() -> Self {
        Self {
            cancellation: CancellationToken::new(),
        }
    }

    fn cancel(&self) {
        self.cancellation.cancel();
    }

    fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }
}

struct StreamWorker {
    control: Arc<StreamControl>,
    join: JoinHandle<()>,
}

#[derive(Default)]
pub struct EventStreamRuntime {
    transition: Mutex<()>,
    workers: Mutex<HashMap<String, StreamWorker>>,
}

/// Start (or restart) the event-stream supervisor for an actor.
///
/// If a supervisor already exists for `actor_ptid`, it is cancelled
/// before a new one starts. This keeps the invariant "at most one
/// stream per actor" — every supervisor holds a long-lived TCP
/// connection on the station, and duplicates would double-deliver
/// every event to the frontend.
///
/// `device_id` should be a stable per-window identifier so a user
/// running two windows of the same actor on the same machine gets
/// independent cursor tracking on the server side. Empty string is
/// tolerated; the server falls back to an anonymous suffix.
impl EventStreamRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start(
        &self,
        station_client: StationClient,
        app: AppHandle,
        actor_ptid: String,
        session_epoch: u64,
        token: String,
        device_id: String,
    ) -> Result<(), String> {
        if token.trim().is_empty() {
            return Err("event stream requires a non-empty token".to_string());
        }
        let _transition = self
            .transition
            .lock()
            .map_err(|_| "event stream transition lock poisoned".to_string())?;
        let previous = self
            .workers
            .lock()
            .map_err(|_| "event stream worker lock poisoned".to_string())?
            .remove(&actor_ptid);
        if let Some(previous) = previous {
            let deadline = Instant::now() + Duration::from_secs(5);
            if !cancel_and_wait(&previous, deadline) {
                self.workers
                    .lock()
                    .map_err(|_| "event stream worker lock poisoned".to_string())?
                    .insert(actor_ptid, previous);
                return Err(
                    "previous event stream worker did not stop before replacement".to_string(),
                );
            }
            join_worker(previous)?;
        }

        let control = Arc::new(StreamControl::new());
        let control_for_thread = control.clone();
        let actor_for_thread = actor_ptid.clone();
        let station_url = station_client.active_endpoint_origin().unwrap_or_default();
        let station_peer_id = station_client.active_station_peer_id().unwrap_or_default();
        let stream_cursor_path = cursor_path(&actor_ptid, &station_peer_id, &station_url);
        let join = std::thread::Builder::new()
            .name(format!(
                "event-stream-{}",
                &actor_ptid[..actor_ptid.len().min(8)]
            ))
            .spawn(move || {
                run_supervisor(
                    station_client,
                    app,
                    actor_for_thread,
                    session_epoch,
                    station_url,
                    station_peer_id,
                    stream_cursor_path,
                    token,
                    device_id,
                    control_for_thread,
                );
            })
            .map_err(|error| format!("start event stream worker: {error}"))?;
        let worker = StreamWorker { control, join };
        self.workers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(actor_ptid, worker);
        Ok(())
    }

    /// Stop the event-stream supervisor for an actor (idempotent). Used
    /// on logout, account switch, and app shutdown.
    pub fn stop(&self, actor_ptid: &str) -> Result<(), String> {
        let _transition = self
            .transition
            .lock()
            .map_err(|_| "event stream transition lock poisoned".to_string())?;
        let worker = self
            .workers
            .lock()
            .map_err(|_| "event stream worker lock poisoned".to_string())?
            .remove(actor_ptid);
        let Some(worker) = worker else {
            return Ok(());
        };
        if !cancel_and_wait(&worker, Instant::now() + Duration::from_secs(5)) {
            self.workers
                .lock()
                .map_err(|_| "event stream worker lock poisoned".to_string())?
                .insert(actor_ptid.to_string(), worker);
            return Err(
                "event stream worker did not stop before the shutdown deadline".to_string(),
            );
        }
        join_worker(worker)
    }

    /// Stop every Station-scoped event stream before changing Station binding.
    pub fn stop_all(&self) -> Result<(), String> {
        let _transition = self
            .transition
            .lock()
            .map_err(|_| "event stream transition lock poisoned".to_string())?;
        let workers = self
            .workers
            .lock()
            .map_err(|_| "event stream worker lock poisoned".to_string())?
            .drain()
            .collect::<Vec<_>>();
        for (_, worker) in &workers {
            worker.control.cancel();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut failures = Vec::new();
        let mut retained = Vec::new();
        for (actor_ptid, worker) in workers {
            if !wait_for_worker(&worker, deadline) {
                failures.push(format!(
                    "event stream worker {actor_ptid} did not stop before the shutdown deadline"
                ));
                retained.push((actor_ptid, worker));
                continue;
            }
            if let Err(error) = join_worker(worker) {
                failures.push(error);
            }
        }
        if !retained.is_empty() {
            self.workers
                .lock()
                .map_err(|_| "event stream worker lock poisoned".to_string())?
                .extend(retained);
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }

    /// True if a live supervisor is registered for the actor.
    pub fn is_running(&self, actor_ptid: &str) -> bool {
        self.workers
            .lock()
            .ok()
            .and_then(|workers| {
                workers
                    .get(actor_ptid)
                    .map(|worker| !worker.join.is_finished())
            })
            .unwrap_or(false)
    }
}

fn cancel_and_wait(worker: &StreamWorker, deadline: Instant) -> bool {
    worker.control.cancel();
    wait_for_worker(worker, deadline)
}

fn wait_for_worker(worker: &StreamWorker, deadline: Instant) -> bool {
    while !worker.join.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    worker.join.is_finished()
}

fn join_worker(worker: StreamWorker) -> Result<(), String> {
    worker
        .join
        .join()
        .map_err(|_| "event stream worker panicked".to_string())
}

// ---------------------------------------------------------------------
// Cursor persistence
// ---------------------------------------------------------------------

fn cursor_path(actor_ptid: &str, station_peer_id: &str, station_url: &str) -> Option<PathBuf> {
    let scope = crate::infrastructure::local_scope::user_scope_for_actor_at_station(
        actor_ptid,
        Some(station_peer_id),
        station_url,
    );
    let name = format!("{scope}.txt");
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["auth", "event_cursors", &name],
    )
    .ok()
}

fn load_cursor(path: Option<&PathBuf>) -> String {
    let Some(path) = path else {
        return String::new();
    };
    match fs::read_to_string(&path) {
        Ok(s) => s.trim().to_string(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            tracing::warn!(error = %e, "event_stream: load cursor failed");
            String::new()
        }
    }
}

fn save_cursor(path: Option<&PathBuf>, event_id: &str) {
    if event_id.is_empty() {
        return;
    }
    let Some(path) = path else {
        return;
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            tracing::warn!(error = %e, "event_stream: ensure cursor dir failed");
            return;
        }
    }
    if let Err(e) = fs::write(&path, event_id) {
        tracing::warn!(error = %e, "event_stream: save cursor failed");
    }
}

fn with_current_supervisor(cancel: &Arc<StreamControl>, operation: impl FnOnce()) -> bool {
    if cancel.is_cancelled() {
        return false;
    }
    operation();
    true
}

// ---------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------

fn run_supervisor(
    station_client: StationClient,
    app: AppHandle,
    actor_ptid: String,
    session_epoch: u64,
    station_url: String,
    station_peer_id: String,
    cursor_path: Option<PathBuf>,
    token: String,
    device_id: String,
    cancel: Arc<StreamControl>,
) {
    // Exponential backoff capped at 30s. Full jitter would be ideal
    // for thundering-herd protection across many clients reconnecting
    // at once, but for now plain exponential with a 30s cap matches
    // contract §4.1 wording closely enough.
    let mut backoff_ms: u64 = 500;
    let mut last_state_connected: Option<bool> = None;
    loop {
        if cancel.is_cancelled() {
            return;
        }

        let cursor = load_cursor(cursor_path.as_ref());
        emit_state(&app, &mut last_state_connected, false, "connecting");

        match run_once(
            &app,
            &station_client,
            &actor_ptid,
            session_epoch,
            &station_url,
            &station_peer_id,
            cursor_path.as_ref(),
            &token,
            &device_id,
            &cursor,
            &cancel,
        ) {
            Ok(()) => return, // Cancelled.
            Err(err) => {
                tracing::warn!(actor = %actor_ptid, error = %err, "event_stream: connection ended, will retry");
                emit_state(&app, &mut last_state_connected, false, "disconnected");
            }
        }

        // Sleep with cancellation polling.
        let mut slept = 0u64;
        while slept < backoff_ms {
            if cancel.is_cancelled() {
                return;
            }
            let step = std::cmp::min(100, backoff_ms - slept);
            std::thread::sleep(Duration::from_millis(step));
            slept += step;
        }
        backoff_ms = std::cmp::min(backoff_ms.saturating_mul(2), 30_000);
    }
}

fn run_once(
    app: &AppHandle,
    station_client: &StationClient,
    actor_ptid: &str,
    session_epoch: u64,
    station_url: &str,
    station_peer_id: &str,
    cursor_path: Option<&PathBuf>,
    token: &str,
    device_id: &str,
    cursor: &str,
    cancel: &Arc<StreamControl>,
) -> Result<(), String> {
    tracing::info!(actor = %actor_ptid, cursor_len = cursor.len(), "event_stream: connecting");

    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|error| format!("invalid event stream token: {error}"))?,
    );
    if !cursor.is_empty() {
        headers.insert(
            HeaderName::from_static("last-event-id"),
            HeaderValue::from_str(cursor)
                .map_err(|error| format!("invalid event stream cursor: {error}"))?,
        );
    }
    if !device_id.is_empty() {
        headers.insert(
            HeaderName::from_static("x-device-id"),
            HeaderValue::from_str(device_id)
                .map_err(|error| format!("invalid event stream device ID: {error}"))?,
        );
    }

    let mut response = station_client
        .execute_raw(StationRequest {
            method: Method::GET,
            path_and_query: "/events/stream".to_string(),
            headers,
            body: StationRequestBody::Empty,
            timeout: Duration::from_secs(24 * 60 * 60),
            admission_timeout: Duration::from_secs(30),
            traffic_class: TrafficClass::Realtime,
            route_security: StationRouteSecurity::VerifiedRoute,
            route_policy: crate::application::station_runtime::client::StationRoutePolicy::Auto,
            replay_policy: ReplayPolicy::SafeRead,
            cancellation: cancel.cancellation.clone(),
            expected_scope: None,
        })
        .map_err(|error| format!("send: {error}"))?;
    if !(200..300).contains(&response.status) {
        let status = response.status;
        let mut body = String::new();
        let _ = response.body.read_to_string(&mut body);
        if session_revocation::emit_if_session_revoked(app, token, status, &body) {
            return Ok(());
        }
        return Err(format!("station returned {status}: {body}"));
    }

    // Connected. Frontend can now show a green "online" indicator.
    let _ = app.emit(
        EVENT_CONNECTION_STATE,
        &json!({"connected": true, "reason": "connected"}),
    );

    let mut reader = BufReader::new(response.body);
    let mut current_event: Option<String> = None;
    let mut current_id: Option<String> = None;
    let mut data_buf = String::new();
    let mut line = String::new();
    loop {
        if cancel.is_cancelled() {
            return Ok(());
        }
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("read_line: {e}"))?;
        if n == 0 {
            return Err("station closed stream".into());
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);

        // SSE frame terminator: empty line dispatches the buffered event.
        if trimmed.is_empty() {
            if !data_buf.is_empty() {
                dispatch(
                    app,
                    actor_ptid,
                    session_epoch,
                    station_url,
                    station_peer_id,
                    cursor_path,
                    cancel,
                    current_event.as_deref(),
                    current_id.as_deref(),
                    &data_buf,
                );
                data_buf.clear();
                current_event = None;
                current_id = None;
            }
            continue;
        }

        // Comments / explicit ":connected" / ":heartbeat" — ignore.
        if trimmed.starts_with(':') {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("event:") {
            current_event = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("id:") {
            current_id = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("data:") {
            // SSE allows multiple `data:` lines per event; concatenate
            // with newlines per the spec. In practice our server emits
            // a single line, but we honour the spec.
            if !data_buf.is_empty() {
                data_buf.push('\n');
            }
            data_buf.push_str(rest.trim_start());
        }
        // Other fields (retry:) ignored.
    }
}

fn dispatch(
    app: &AppHandle,
    actor_ptid: &str,
    session_epoch: u64,
    station_url: &str,
    station_peer_id: &str,
    cursor_path: Option<&PathBuf>,
    cancel: &Arc<StreamControl>,
    event_name: Option<&str>,
    event_id: Option<&str>,
    data_b64: &str,
) {
    // Defensive: only dispatch frames the server marked as our wire
    // type. Anything else is a protocol drift signal and we'd rather
    // log it than feed garbage to the frontend.
    if let Some(name) = event_name {
        if name != "stream" {
            tracing::warn!(name = %name, "event_stream: ignoring unknown SSE event name");
            return;
        }
    }

    // We attempt to decode just to (a) extract event_id when it is
    // missing from the SSE id: header (defence in depth), and (b)
    // detect Resync to log it loudly. The full decoded StreamEvent
    // is handed to the frontend as opaque base64; the TS dispatcher
    // owns business interpretation.
    let bytes = match base64::engine::general_purpose::STANDARD.decode(data_b64.trim()) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "event_stream: base64 decode failed, skipping");
            return;
        }
    };
    let resolved_event_id = match StreamEvent::decode(bytes.as_slice()) {
        Ok(ev) => {
            if let Some(StreamKind::Resync(r)) = ev.kind.as_ref() {
                tracing::info!(
                    newest = %r.newest_event_id,
                    reason = %r.reason,
                    "event_stream: Resync received — frontend will trigger cold catch-up"
                );
            }
            // Prefer the SSE `id:` header; fall back to the decoded
            // body's event_id (they should match per server contract).
            event_id
                .map(str::to_string)
                .unwrap_or_else(|| ev.event_id.clone())
        }
        Err(e) => {
            tracing::warn!(error = %e, "event_stream: protobuf decode failed, skipping");
            return;
        }
    };

    let payload = json!({
        "actor_ptid": actor_ptid,
        "session_epoch": session_epoch,
        "station_url": station_url,
        "station_peer_id": station_peer_id,
        "event_id": resolved_event_id,
        "data_b64": data_b64.trim(),
    });
    with_current_supervisor(cancel, || {
        // Cursor advancement and emit share the registration fence. Once a
        // replacement supervisor is registered, the old generation can do
        // neither and the replacement resumes from the unconsumed event.
        save_cursor(cursor_path, &resolved_event_id);
        if let Err(e) = app.emit(EVENT_REALTIME, &payload) {
            tracing::warn!(error = %e, "event_stream: emit failed");
        }
    });
}

fn emit_state(app: &AppHandle, last: &mut Option<bool>, connected: bool, reason: &str) {
    if *last == Some(connected) {
        return;
    }
    *last = Some(connected);
    let _ = app.emit(
        EVENT_CONNECTION_STATE,
        &json!({"connected": connected, "reason": reason}),
    );
}

// ---------------------------------------------------------------------
// Tests
//
// The runtime supervisor is integration-shaped (network + Tauri
// AppHandle), so unit tests focus on the small pure helpers — cursor
// path resolution and SSE line parsing edge cases. The full network
// path is covered by Station-side bus tests on the server.
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_roundtrip_via_disk() {
        let actor = "roundtrip-test-actor";
        let path = cursor_path(actor, "station-a", "https://station-a.test");
        save_cursor(path.as_ref(), "ev-abc");
        assert_eq!(load_cursor(path.as_ref()), "ev-abc");
        save_cursor(path.as_ref(), "ev-def");
        assert_eq!(load_cursor(path.as_ref()), "ev-def");
        if let Some(p) = path {
            let _ = fs::remove_file(p);
        }
    }

    #[test]
    fn empty_event_id_does_not_overwrite_cursor() {
        let actor = "noop-test-actor";
        let path = cursor_path(actor, "station-a", "https://station-a.test");
        save_cursor(path.as_ref(), "ev-abc");
        save_cursor(path.as_ref(), "");
        assert_eq!(load_cursor(path.as_ref()), "ev-abc");
        if let Some(p) = path {
            let _ = fs::remove_file(p);
        }
    }

    #[test]
    fn cursor_path_is_scoped_by_station_identity() {
        let actor = "cross-station-cursor-actor";
        let station_a = cursor_path(actor, "station-a", "https://shared.test");
        let station_a_relay = cursor_path(actor, "station-a", "https://relay.test");
        let station_b = cursor_path(actor, "station-b", "https://shared.test");
        let url_fallback = cursor_path(actor, "", "https://station-c.test");

        assert_eq!(station_a, station_a_relay);
        assert_ne!(station_a, station_b);
        assert_ne!(station_a, url_fallback);
        assert_ne!(station_b, url_fallback);
    }

    #[test]
    fn replaced_supervisor_cannot_advance_cursor() {
        let actor = "renewed-session-cursor-actor";
        let path = cursor_path(actor, "station-a", "https://station-a.test");
        if let Some(path) = path.as_ref() {
            let _ = fs::remove_file(path);
        }
        let old = Arc::new(StreamControl::new());
        let current = Arc::new(StreamControl::new());
        old.cancel();

        assert!(!with_current_supervisor(&old, || {
            save_cursor(path.as_ref(), "stale-event");
        }));
        assert_eq!(load_cursor(path.as_ref()), "");
        assert!(with_current_supervisor(&current, || {
            save_cursor(path.as_ref(), "current-event");
        }));
        assert_eq!(load_cursor(path.as_ref()), "current-event");

        if let Some(path) = path {
            let _ = fs::remove_file(path);
        }
    }

    #[test]
    fn runtime_stop_cancels_and_joins_worker() {
        let runtime = EventStreamRuntime::new();
        let control = Arc::new(StreamControl::new());
        let worker_control = control.clone();
        let join = std::thread::spawn(move || {
            while !worker_control.is_cancelled() {
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        runtime
            .workers
            .lock()
            .unwrap()
            .insert("actor-a".to_string(), StreamWorker { control, join });

        runtime.stop("actor-a").unwrap();

        assert!(!runtime.is_running("actor-a"));
        assert!(runtime.workers.lock().unwrap().is_empty());
    }

    #[test]
    fn lifecycle_operations_are_serialized() {
        let runtime = Arc::new(EventStreamRuntime::new());
        let transition = runtime.transition.lock().unwrap();
        let completed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let completed_by_worker = completed.clone();
        let runtime_for_worker = runtime.clone();
        let worker = std::thread::spawn(move || {
            runtime_for_worker.stop("actor-a").unwrap();
            completed_by_worker.store(true, std::sync::atomic::Ordering::Release);
        });

        std::thread::sleep(Duration::from_millis(20));
        assert!(!completed.load(std::sync::atomic::Ordering::Acquire));
        drop(transition);
        worker.join().unwrap();
        assert!(completed.load(std::sync::atomic::Ordering::Acquire));
    }
}
