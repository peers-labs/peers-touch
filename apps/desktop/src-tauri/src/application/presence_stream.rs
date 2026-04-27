//! Long-lived peer-presence SSE consumer.
//!
//! Why this module exists separately from `application::presence`:
//!
//! `application::presence` is a *publisher* — it tells the station that
//! we (this actor, on this device) are online by POSTing
//! `/friend-chat/online` and reconciling the pending queue on
//! transitions. It runs entirely on demand.
//!
//! This module is the *subscriber* side: it opens a long-lived
//! SSE connection to `/friend-chat/presence/stream` and emits a Tauri
//! event every time *any peer* flips online/offline. The two are
//! deliberately decoupled because:
//!
//!   * The publisher's lifecycle is tied to user gestures (login,
//!     focus, logout). The subscriber's lifecycle is tied to *the app
//!     being foregrounded with at least one logged-in actor* — much
//!     coarser.
//!   * Mixing them would couple `online()` retries with stream
//!     reconnect backoff, and a slow stream would block presence
//!     reporting (which has its own time budget).
//!
//! Failure model: the supervisor thread is best-effort. If the network
//! drops, it backs off and reconnects. If decoding fails the line is
//! logged and skipped — a single bad frame should not kill the whole
//! stream because stations are forward-compatible by design (new
//! fields, new event types).
//!
//! Wire format mirrors `apps/station/app/subserver/friend_chat/presence_sse.go`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::infrastructure::station_client::station_base_url;

/// Per-actor cancel flags so a logout / actor switch can shut down
/// exactly the supervisor that belongs to the departing actor without
/// touching anyone else's stream. Keyed by the same actor id used by
/// `WindowSessionRegistry`.
fn registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Tauri event delivered to the frontend on every presence flip and on
/// the initial-connect snapshot. Payload shape:
///
/// ```json
/// { "did": "...", "online": true, "at": 1761501234 }
/// ```
pub const PRESENCE_PEER_EVENT: &str = "presence.peer-changed";

#[derive(Debug, Deserialize)]
struct PresenceFrame {
    did: String,
    online: bool,
    #[serde(default, rename = "at")]
    at_unix: i64,
}

/// Start (or restart) the presence-stream supervisor for an actor.
///
/// If a supervisor already exists for `actor_id`, it is cancelled
/// before a new one starts. This keeps the invariant "at most one
/// stream per actor" — important because every supervisor holds a
/// long-lived TCP connection on the station, and duplicates would
/// double-deliver every event to the frontend.
///
/// Returns silently if `token` is empty (caller is not yet
/// authenticated).
pub fn start(app: AppHandle, actor_id: String, token: String) {
    if token.trim().is_empty() {
        tracing::warn!(actor = %actor_id, "presence_stream: refusing to start with empty token");
        return;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = registry().lock().expect("presence_stream registry poisoned");
        if let Some(prev) = map.insert(actor_id.clone(), cancel.clone()) {
            prev.store(true, Ordering::Relaxed);
        }
    }
    let actor_for_thread = actor_id.clone();
    let cancel_for_thread = cancel.clone();
    std::thread::Builder::new()
        .name(format!(
            "presence-stream-{}",
            &actor_id[..actor_id.len().min(8)]
        ))
        .spawn(move || {
            run_supervisor(app, token, cancel_for_thread);
            // Best-effort cleanup if the supervisor exits naturally
            // (e.g. on cancellation).
            let mut map = registry().lock().expect("presence_stream registry poisoned");
            // Only remove if the entry is still ours — otherwise
            // someone called start() again and replaced us.
            if let Some(existing) = map.get(&actor_for_thread) {
                if Arc::ptr_eq(existing, &cancel) {
                    map.remove(&actor_for_thread);
                }
            }
        })
        .ok();
}

/// Stop the presence-stream supervisor for an actor (idempotent).
/// Used on logout, account switch, and app shutdown.
pub fn stop(actor_id: &str) {
    let mut map = registry().lock().expect("presence_stream registry poisoned");
    if let Some(flag) = map.remove(actor_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

fn run_supervisor(app: AppHandle, token: String, cancel: Arc<AtomicBool>) {
    // Exponential backoff capped at 30s. We never give up — as long as
    // `cancel` is false, every disconnect leads to another attempt.
    let mut backoff_ms: u64 = 500;
    loop {
        if cancel.load(Ordering::Relaxed) {
            tracing::info!("presence_stream: cancelled, exiting");
            return;
        }

        match run_once(&app, &token, &cancel) {
            Ok(()) => {
                // run_once returns Ok only on cancellation; loop will exit.
                backoff_ms = 500;
            }
            Err(err) => {
                tracing::warn!(error = %err, "presence_stream: connection error, will retry");
            }
        }

        // Sleep with cancellation polling so we can shut down promptly.
        let mut slept = 0u64;
        while slept < backoff_ms {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let step = std::cmp::min(100, backoff_ms - slept);
            std::thread::sleep(Duration::from_millis(step));
            slept += step;
        }
        backoff_ms = std::cmp::min(backoff_ms * 2, 30_000);
    }
}

fn run_once(
    app: &AppHandle,
    token: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let url = format!("{}/friend-chat/presence/stream", station_base_url());
    tracing::info!(url = %url, "presence_stream: connecting");

    // Build a dedicated client with NO request timeout — SSE is by
    // definition long-lived. We do keep TCP keepalive so a half-dead
    // network surfaces as an EOF that triggers reconnect.
    let client = reqwest::blocking::Client::builder()
        .tcp_keepalive(Some(Duration::from_secs(30)))
        // Connect timeout still useful: if station is down, fail fast
        // and let backoff handle the retry.
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("build client: {}", e))?;

    let resp = client
        .get(&url)
        .header("Accept", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .bearer_auth(token)
        .send()
        .map_err(|e| format!("send: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("station returned {}: {}", status, body));
    }

    let mut reader = BufReader::new(resp);
    let mut current_event: Option<String> = None;
    let mut data_buf = String::new();
    let mut line = String::new();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("read_line: {}", e))?;
        if n == 0 {
            return Err("station closed stream".to_string());
        }

        // SSE frame terminator. Empty line = dispatch buffered event.
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if !data_buf.is_empty() {
                dispatch(app, current_event.as_deref(), &data_buf);
                data_buf.clear();
                current_event = None;
            }
            continue;
        }

        // Comment / heartbeat — ignore.
        if trimmed.starts_with(':') {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("event:") {
            current_event = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("data:") {
            // SSE allows multiple `data:` lines per event; concatenate
            // with newlines per the spec.
            if !data_buf.is_empty() {
                data_buf.push('\n');
            }
            data_buf.push_str(rest.trim_start());
        }
        // Other fields (id:, retry:) ignored — we don't need replay
        // semantics for presence.
    }
}

fn dispatch(app: &AppHandle, event_name: Option<&str>, data: &str) {
    // We only handle `presence` events, but tolerate the absence of an
    // event field (the spec defaults to "message") to be robust against
    // server-side wording changes.
    if let Some(name) = event_name {
        if name != "presence" {
            return;
        }
    }
    let frame: PresenceFrame = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, payload = %data, "presence_stream: decode failed, skipping");
            return;
        }
    };
    let payload = json!({
        "did": frame.did,
        "online": frame.online,
        "at": frame.at_unix,
    });
    if let Err(e) = app.emit(PRESENCE_PEER_EVENT, &payload) {
        tracing::warn!(error = %e, "presence_stream: emit failed");
    }
}
