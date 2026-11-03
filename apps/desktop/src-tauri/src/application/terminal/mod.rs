// TW-D5: device-held persistent terminal sessions.
//
// The PTY/process and its bounded output ring live in the worker (this
// process), never in the Page. The webview is a subscriber: it attaches by
// cursor, receives output events, and closing the viewer only unsubscribes.
// Station stores metadata only; secrets and output never leave the device
// through this contract.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::application::tools::{resolve_terminal_cwd, ToolError};

pub(crate) const TERMINAL_EVENT: &str = "peers-touch://terminal-session-event";

const RING_CAPACITY_BYTES: usize = 256 * 1024;
const EVENT_CHUNK_BYTES: usize = 32 * 1024;
const DEFAULT_COLS: u16 = 100;
const DEFAULT_ROWS: u16 = 30;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalMeta {
    session_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    pid: u32,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    output_bytes: u64,
    started_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalRead {
    meta: TerminalMeta,
    // Base64 chunk covering [cursor, next_cursor) within the bounded ring.
    chunk_b64: String,
    next_cursor: u64,
    // Requested cursor predated the retained ring; UI should treat the chunk
    // as a resynchronization boundary (history before it is gone by design).
    resync: bool,
}

#[derive(Clone, Copy, Debug)]
enum Lifecycle {
    Running,
    Exited(i32),
    Killed(i32),
}

impl Lifecycle {
    fn status(self) -> &'static str {
        match self {
            Lifecycle::Running => "running",
            Lifecycle::Exited(_) => "exited",
            Lifecycle::Killed(_) => "killed",
        }
    }

    fn exit_code(self) -> Option<i32> {
        match self {
            Lifecycle::Running => None,
            Lifecycle::Exited(code) | Lifecycle::Killed(code) => Some(code),
        }
    }
}

/// Bounded monotonic byte ring. `total` counts every emitted byte even after
/// eviction; cursors are absolute offsets into the output stream.
struct OutputRing {
    segments: VecDeque<(u64, Vec<u8>)>,
    retained: usize,
    total: u64,
}

impl OutputRing {
    fn new() -> Self {
        Self {
            segments: VecDeque::new(),
            retained: 0,
            total: 0,
        }
    }

    fn append(&mut self, bytes: &[u8]) -> u64 {
        if bytes.is_empty() {
            return self.total;
        }
        let start = self.total;
        self.segments.push_back((start, bytes.to_vec()));
        self.retained += bytes.len();
        self.total += bytes.len() as u64;
        while self.retained > RING_CAPACITY_BYTES {
            if let Some((_, oldest)) = self.segments.front() {
                self.retained -= oldest.len();
                self.segments.pop_front();
            } else {
                break;
            }
        }
        self.total
    }

    fn oldest_cursor(&self) -> u64 {
        self.segments.front().map(|(start, _)| *start).unwrap_or(self.total)
    }

    fn read(&self, cursor: u64) -> (bool, Vec<u8>) {
        let oldest = self.oldest_cursor();
        let effective = cursor.max(oldest);
        let mut out = Vec::new();
        for (start, bytes) in &self.segments {
            let end = start + bytes.len() as u64;
            if end <= effective {
                continue;
            }
            let skip = effective.saturating_sub(*start) as usize;
            out.extend_from_slice(&bytes[skip.min(bytes.len())..]);
        }
        (cursor < oldest, out)
    }
}

pub(crate) struct SessionHandle {
    id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    started_at_ms: u64,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    ring: Mutex<OutputRing>,
    lifecycle: Mutex<Lifecycle>,
    kill_requested: AtomicBool,
    output_bytes: AtomicU64,
}

impl SessionHandle {
    fn meta(self: &Arc<Self>) -> TerminalMeta {
        let lifecycle = *self.lifecycle.lock().expect("terminal lifecycle");
        TerminalMeta {
            session_id: self.id.clone(),
            command: self.command.clone(),
            args: self.args.clone(),
            cwd: self.cwd.clone(),
            pid: self.child.lock().expect("terminal child").process_id().unwrap_or(0),
            status: lifecycle.status().to_string(),
            exit_code: lifecycle.exit_code(),
            output_bytes: self.output_bytes.load(Ordering::Acquire),
            started_at_ms: self.started_at_ms,
        }
    }
}

fn registry() -> &'static Mutex<HashMap<String, Arc<SessionHandle>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<SessionHandle>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug)]
pub(crate) struct TerminalError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl TerminalError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "TERMINAL_INVALID_ARGUMENT",
            message: message.into(),
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            code: "TERMINAL_EXECUTION_FAILED",
            message: message.into(),
        }
    }
}

impl std::fmt::Display for TerminalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

pub(crate) struct CreateTerminal {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) workspace_root: String,
    pub(crate) allowed_roots: Vec<String>,
    pub(crate) cols: Option<u16>,
    pub(crate) rows: Option<u16>,
}

pub(crate) fn create_session(
    app: AppHandle,
    input: CreateTerminal,
) -> Result<TerminalMeta, TerminalError> {
    let command = input.command.trim().to_string();
    if command.is_empty() {
        return Err(TerminalError::invalid("command is required"));
    }
    let allowed: Option<&[String]> = Some(input.allowed_roots.as_slice());
    let cwd = resolve_terminal_cwd(
        Some(input.workspace_root.as_str()),
        input.cwd.as_deref(),
        allowed,
    )
    .map_err(|error| TerminalError::invalid(error.to_string()))?;

    let pty_system = native_pty_system();
    let size = PtySize {
        rows: input.rows.unwrap_or(DEFAULT_ROWS).max(1),
        cols: input.cols.unwrap_or(DEFAULT_COLS).max(1),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|error| TerminalError::failed(format!("open pty: {error}")))?;
    let mut builder = CommandBuilder::new(&command);
    for arg in &input.args {
        builder.arg(arg);
    }
    builder.cwd(&cwd);

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|error| TerminalError::failed(format!("spawn command: {error}")))?;
    // The process holds its own slave; keeping this slave open here would
    // prevent the reader from ever reaching EOF.
    drop(pair.slave);
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| TerminalError::failed(format!("open pty writer: {error}")))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| TerminalError::failed(format!("open pty reader: {error}")))?;

    let id = format!("terms-{}", ulid::Ulid::new());
    let handle = Arc::new(SessionHandle {
        id: id.clone(),
        command,
        args: input.args,
        cwd: cwd.to_string_lossy().to_string(),
        started_at_ms: now_ms(),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        child: Mutex::new(child),
        ring: Mutex::new(OutputRing::new()),
        lifecycle: Mutex::new(Lifecycle::Running),
        kill_requested: AtomicBool::new(false),
        output_bytes: AtomicU64::new(0),
    });

    {
        let arc = Arc::clone(&handle);
        let app = app.clone();
        std::thread::spawn(move || pump_output(arc, app, reader));
    }

    let meta = handle.meta();
    registry()
        .lock()
        .expect("terminal registry")
        .insert(id, handle);
    Ok(meta)
}

fn pump_output(
    session: Arc<SessionHandle>,
    app: AppHandle,
    mut reader: Box<dyn Read + Send>,
) {
    let mut buffer = vec![0u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let end = append_and_emit(&session, &app, &buffer[..count]);
                if end.is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let exit = {
        let mut child = session.child.lock().expect("terminal child");
        child.wait().ok().map(|status| status.exit_code())
    };
    let raw_i32 = exit.map(|value| value as i32).unwrap_or(-1);
    let killed = session.kill_requested.load(Ordering::Acquire);
    let lifecycle = if killed {
        Lifecycle::Killed(raw_i32)
    } else {
        Lifecycle::Exited(raw_i32)
    };
    *session.lifecycle.lock().expect("terminal lifecycle") = lifecycle;
    let payload = serde_json::json!({
        "sessionId": session.id,
        "kind": "status",
        "status": lifecycle.status(),
        "exitCode": lifecycle.exit_code(),
        "outputBytes": session.output_bytes.load(Ordering::Acquire),
    });
    let _ = app.emit(TERMINAL_EVENT, payload);
}

fn append_and_emit(
    session: &Arc<SessionHandle>,
    app: &AppHandle,
    bytes: &[u8],
) -> Result<(), ()> {
    let end = {
        let mut ring = session.ring.lock().map_err(|_| ())?;
        ring.append(bytes)
    };
    session.output_bytes.store(end, Ordering::Release);
    for offset in (0..bytes.len()).step_by(EVENT_CHUNK_BYTES) {
        let chunk = &bytes[offset..(offset + EVENT_CHUNK_BYTES).min(bytes.len())];
        let payload = serde_json::json!({
            "sessionId": session.id,
            "kind": "output",
            "chunkB64": base64::engine::general_purpose::STANDARD.encode(chunk),
        });
        app.emit(TERMINAL_EVENT, payload).map_err(|_| ())?;
    }
    Ok(())
}

fn with_session<T>(
    session_id: &str,
    action: impl FnOnce(&Arc<SessionHandle>) -> Result<T, TerminalError>,
) -> Result<T, TerminalError> {
    let sessions = registry().lock().expect("terminal registry");
    let session = sessions
        .get(session_id)
        .ok_or_else(|| TerminalError::invalid("terminal session not found"))?;
    action(session)
}

pub(crate) fn write_input(session_id: &str, data: &[u8]) -> Result<(), TerminalError> {
    with_session(session_id, |session| {
        session
            .writer
            .lock()
            .expect("terminal writer")
            .write_all(data)
            .map_err(|error| TerminalError::failed(format!("write pty: {error}")))
    })
}

pub(crate) fn resize(
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), TerminalError> {
    with_session(session_id, |session| {
        session
            .master
            .lock()
            .expect("terminal master")
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| TerminalError::failed(format!("resize pty: {error}")))
    })
}

pub(crate) fn kill_session(session_id: &str) -> Result<TerminalMeta, TerminalError> {
    with_session(session_id, |session| {
        session.kill_requested.store(true, Ordering::Release);
        let kill_result = session.child.lock().expect("terminal child").kill();
        if let Err(error) = kill_result {
            // Already exited is fine; everything else is reported.
            if error.kind() != std::io::ErrorKind::InvalidInput {
                return Err(TerminalError::failed(format!("kill process: {error}")));
            }
        }
        Ok(session.meta())
    })
}

pub(crate) fn remove_session(session_id: &str) -> Result<(), TerminalError> {
    let handle = {
        let mut sessions = registry().lock().expect("terminal registry");
        sessions.remove(session_id)
    };
    if let Some(session) = handle {
        session.kill_requested.store(true, Ordering::Release);
        let _ = session.child.lock().expect("terminal child").kill();
    }
    Ok(())
}

pub(crate) fn list_sessions() -> Vec<TerminalMeta> {
    let sessions = registry().lock().expect("terminal registry");
    sessions.values().map(|session| session.meta()).collect()
}

pub(crate) fn read_session(session_id: &str, cursor: u64) -> Result<TerminalRead, TerminalError> {
    with_session(session_id, |session| {
        let (resync, bytes) = session
            .ring
            .lock()
            .expect("terminal ring")
            .read(cursor);
        Ok(TerminalRead {
            meta: session.meta(),
            chunk_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
            next_cursor: session.output_bytes.load(Ordering::Acquire),
            resync,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::OutputRing;

    #[test]
    fn ring_reads_from_absolute_cursor_and_reports_total() {
        let mut ring = OutputRing::new();
        assert_eq!(ring.append(b"hello "), 6);
        assert_eq!(ring.append(b"world"), 11);
        let (resync, bytes) = ring.read(6);
        assert!(!resync);
        assert_eq!(bytes, b"world");
        assert_eq!(ring.read(11).1, b"");
    }

    #[test]
    fn ring_replays_full_history_while_within_capacity() {
        let mut ring = OutputRing::new();
        ring.append(b"old");
        ring.append(b"new");
        let (resync, bytes) = ring.read(0);
        assert!(!resync, "small ring retains everything");
        assert_eq!(bytes, b"oldnew");
        let (resyncFuture, future) = ring.read(3);
        assert!(!resyncFuture);
        assert_eq!(future, b"new");
    }

    #[test]
    fn ring_evicts_oldest_and_clamps_to_oldest_cursor() {
        let mut ring = OutputRing::new();
        let chunk = vec![b'x'; RING_CAPACITY_BYTES + 10];
        let total = ring.append(&chunk);
        assert_eq!(total as usize, RING_CAPACITY_BYTES + 10);
        // Cursor 0 predates the retained window: resync boundary.
        let (resync, bytes) = ring.read(0);
        assert!(resync);
        assert_eq!(bytes.len(), RING_CAPACITY_BYTES);
        // Reading at the oldest retained cursor returns the same window with
        // no resync flag: replay remains deterministic.
        let oldest = ring.oldest_cursor();
        let (resyncAtOldest, atOldest) = ring.read(oldest);
        assert!(!resyncAtOldest);
        assert_eq!(atOldest.len(), RING_CAPACITY_BYTES);
    }
}
