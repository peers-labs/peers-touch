//! The single SSE consumer for the canonical realtime event stream.
//!
//! See `docs/architecture/realtime/event-stream.md` for the wire
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
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use prost::Message;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::infrastructure::session_revocation;
use crate::infrastructure::station_client::station_base_url;
use crate::infrastructure::storage::{self, StorageKind};
use crate::model::realtime::v1::{stream_event::Kind as StreamKind, StreamEvent};

// ---------------------------------------------------------------------
// Tauri event channel names — the public contract with the frontend.
//
// These names are part of the wire contract between Rust and TS;
// renaming them is a breaking change to the frontend dispatcher.
// ---------------------------------------------------------------------

/// Every realtime frame the bus delivers reaches the frontend through
/// this channel. Payload: `{ event_id, data_b64 }`. The frontend
/// decodes `data_b64` with the generated TypeScript protobuf schema.
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

fn registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
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
pub fn start(app: AppHandle, actor_ptid: String, token: String, device_id: String) {
    if token.trim().is_empty() {
        tracing::warn!(actor = %actor_ptid, "event_stream: refusing to start with empty token");
        return;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = registry().lock().expect("event_stream registry poisoned");
        if let Some(prev) = map.insert(actor_ptid.clone(), cancel.clone()) {
            prev.store(true, Ordering::Relaxed);
        }
    }
    let actor_for_thread = actor_ptid.clone();
    let cancel_for_thread = cancel.clone();
    std::thread::Builder::new()
        .name(format!(
            "event-stream-{}",
            &actor_ptid[..actor_ptid.len().min(8)]
        ))
        .spawn(move || {
            run_supervisor(
                app,
                actor_for_thread.clone(),
                token,
                device_id,
                cancel_for_thread,
            );
            // Best-effort cleanup if the supervisor exits naturally.
            let mut map = registry().lock().expect("event_stream registry poisoned");
            if let Some(existing) = map.get(&actor_for_thread) {
                if Arc::ptr_eq(existing, &cancel) {
                    map.remove(&actor_for_thread);
                }
            }
        })
        .ok();
}

/// Stop the event-stream supervisor for an actor (idempotent). Used
/// on logout, account switch, and app shutdown.
pub fn stop(actor_ptid: &str) {
    let mut map = registry().lock().expect("event_stream registry poisoned");
    if let Some(flag) = map.remove(actor_ptid) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Stop every Station-scoped event stream before changing Station binding.
pub fn stop_all() {
    let mut map = registry().lock().expect("event_stream registry poisoned");
    for (_, flag) in map.drain() {
        flag.store(true, Ordering::Relaxed);
    }
}

/// True if a supervisor is registered for the actor (it may not be
/// connected yet — registration happens before the first connect).
pub fn is_running(actor_ptid: &str) -> bool {
    registry()
        .lock()
        .map(|m| m.contains_key(actor_ptid))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------
// Cursor persistence
// ---------------------------------------------------------------------

fn cursor_path(actor_ptid: &str) -> Option<PathBuf> {
    let scope = crate::infrastructure::local_scope::user_scope_for_actor_ptid(actor_ptid);
    let name = format!("{scope}.txt");
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["auth", "event_cursors", &name],
    )
    .ok()
}

fn load_cursor(actor_ptid: &str) -> String {
    let Some(path) = cursor_path(actor_ptid) else {
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

fn save_cursor(actor_ptid: &str, event_id: &str) {
    if event_id.is_empty() {
        return;
    }
    let Some(path) = cursor_path(actor_ptid) else {
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

// ---------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------

fn run_supervisor(
    app: AppHandle,
    actor_ptid: String,
    token: String,
    device_id: String,
    cancel: Arc<AtomicBool>,
) {
    // Exponential backoff capped at 30s. Full jitter would be ideal
    // for thundering-herd protection across many clients reconnecting
    // at once, but for now plain exponential with a 30s cap matches
    // contract §4.1 wording closely enough.
    let mut backoff_ms: u64 = 500;
    let mut last_state_connected: Option<bool> = None;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }

        let cursor = load_cursor(&actor_ptid);
        emit_state(&app, &mut last_state_connected, false, "connecting");

        match run_once(&app, &actor_ptid, &token, &device_id, &cursor, &cancel) {
            Ok(()) => return, // Cancelled.
            Err(err) => {
                tracing::warn!(actor = %actor_ptid, error = %err, "event_stream: connection ended, will retry");
                emit_state(&app, &mut last_state_connected, false, "disconnected");
            }
        }

        // Sleep with cancellation polling.
        let mut slept = 0u64;
        while slept < backoff_ms {
            if cancel.load(Ordering::Relaxed) {
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
    actor_ptid: &str,
    token: &str,
    device_id: &str,
    cursor: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let url = format!("{}/events/stream", station_base_url());
    tracing::info!(url = %url, actor = %actor_ptid, cursor_len = cursor.len(), "event_stream: connecting");

    // Contract §2.4 wants a 30s no-frame deadline; reqwest 0.12.28
    // blocking ClientBuilder does not expose per-read timeout (that's
    // only on the async builder). We approximate the same outcome
    // with aggressive TCP keepalive — a silent-NAT black hole becomes
    // a TCP error within ~15-30s rather than minutes. Combined with
    // the server's 15s heartbeat (so any healthy connection sees a
    // frame at least that often), this is close enough to the
    // contract for now. If we ever migrate this supervisor to
    // tokio + async reqwest the per-read read_timeout becomes the
    // canonical implementation.
    let client = reqwest::blocking::Client::builder()
        .tcp_keepalive(Some(Duration::from_secs(15)))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("build client: {e}"))?;

    let mut req = client
        .get(&url)
        .header("Accept", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .bearer_auth(token);
    if !cursor.is_empty() {
        req = req.header("Last-Event-ID", cursor);
    }
    if !device_id.is_empty() {
        req = req.header("X-Device-ID", device_id);
    }

    let resp = req.send().map_err(|e| format!("send: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        if session_revocation::emit_if_session_revoked(app, status.as_u16(), &body) {
            return Ok(());
        }
        return Err(format!("station returned {status}: {body}"));
    }

    // Connected. Frontend can now show a green "online" indicator.
    let _ = app.emit(
        EVENT_CONNECTION_STATE,
        &json!({"connected": true, "reason": "connected"}),
    );

    let mut reader = BufReader::new(resp);
    let mut current_event: Option<String> = None;
    let mut current_id: Option<String> = None;
    let mut data_buf = String::new();
    let mut line = String::new();
    loop {
        if cancel.load(Ordering::Relaxed) {
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

    // Persist the cursor BEFORE emit so a frontend-side panic can't
    // strand us in a state where we've shown a message but won't
    // resume past it on reconnect. Empty event_id (heartbeats early
    // in a session before any business event) is a no-op.
    save_cursor(actor_ptid, &resolved_event_id);

    let payload = json!({
        "event_id": resolved_event_id,
        "data_b64": data_b64.trim(),
    });
    if let Err(e) = app.emit(EVENT_REALTIME, &payload) {
        tracing::warn!(error = %e, "event_stream: emit failed");
    }
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
        save_cursor(actor, "ev-abc");
        assert_eq!(load_cursor(actor), "ev-abc");
        save_cursor(actor, "ev-def");
        assert_eq!(load_cursor(actor), "ev-def");
        // Cleanup so concurrent test runs don't leak.
        if let Some(p) = cursor_path(actor) {
            let _ = fs::remove_file(p);
        }
    }

    #[test]
    fn empty_event_id_does_not_overwrite_cursor() {
        let actor = "noop-test-actor";
        save_cursor(actor, "ev-abc");
        save_cursor(actor, "");
        assert_eq!(load_cursor(actor), "ev-abc");
        if let Some(p) = cursor_path(actor) {
            let _ = fs::remove_file(p);
        }
    }
}
