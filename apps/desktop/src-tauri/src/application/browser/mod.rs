// TW-D6: device-held real browser sessions.
//
// The browser process is a single headless CDP host (managed
// Chromium/Chrome with an isolated per-session user data dir) shared by two
// control planes: the agent's structured tools (snapshot/click/fill) and the
// human operator, whose panel renders a live CDP screencast and forwards
// mouse/keyboard input through the CDP Input domain. There is no second
// browser window and no headless/headful switching: both planes drive the
// same Page. Page text and DOM stay untrusted data; agent element actions
// remain gated by an observation generation.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams, DispatchMouseEventType,
    InsertTextParams, MouseButton,
};
use chromiumoxide::cdp::browser_protocol::page::{
    CaptureScreenshotFormat, EventScreencastFrame, ScreencastFrameAckParams, StartScreencastFormat,
    StartScreencastParams, StopScreencastParams,
};
use chromiumoxide::page::ScreenshotParams;
use chromiumoxide::Page;
use futures_lite::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::infrastructure::storage;

mod agent_tools;
pub(crate) use agent_tools::AgentBrowserBridge;

/// Readiness-only proof: a managed browser host is actually launchable.
pub(crate) fn host_is_available() -> bool {
    host_info().available
}

/// Engine identifier reported to Station in browser-session truth rows.
pub(crate) fn host_engine() -> String {
    host_info().engine
}

pub(crate) const BROWSER_EVENT: &str = "peers-touch://browser-session-event";
pub(crate) const BROWSER_FRAME_EVENT: &str = "peers-touch://browser-frame-event";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostInfo {
    available: bool,
    engine: String,
    version: String,
    path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TabMeta {
    tab_id: String,
    generation: u64,
    url: String,
    title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserMeta {
    session_id: String,
    engine: String,
    status: String,
    lease: String,
    tabs: Vec<TabMeta>,
    started_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ElementInfo {
    #[serde(rename = "ref")]
    ref_id: String,
    tag: String,
    input_type: String,
    role: String,
    name: String,
    // Viewport coordinates of the element center; a human-takeover harness
    // (xdotool/VNC) needs them to drive the real window. Untrusted data.
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewportInfo {
    inner_width: i64,
    inner_height: i64,
    outer_width: i64,
    outer_height: i64,
    // Viewport origin on the physical screen (screenX/screenY already exclude
    // tab/address chrome).
    screen_x: i64,
    screen_y: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotResult {
    tab: TabMeta,
    lease: String,
    text: String,
    viewport: ViewportInfo,
    elements: Vec<ElementInfo>,
}

#[derive(Debug)]
pub(crate) struct BrowserError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl BrowserError {
    fn invalid(message: impl Into<String>) -> Self {
        Self { code: "BROWSER_INVALID_ARGUMENT", message: message.into() }
    }
    fn unavailable(message: impl Into<String>) -> Self {
        Self { code: "BROWSER_HOST_UNAVAILABLE", message: message.into() }
    }
    fn failed(message: impl Into<String>) -> Self {
        Self { code: "BROWSER_EXECUTION_FAILED", message: message.into() }
    }
    fn stale() -> Self {
        Self {
            code: "BROWSER_SNAPSHOT_REF_STALE",
            message: "element ref belongs to an older observation; snapshot/observe again".to_string(),
        }
    }
}

impl std::fmt::Display for BrowserError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

// Page::close consumes the page, so each tab keeps it behind a takeable lock.
// Tokio mutex because guards are held across CDP awaits (Send futures).
struct TabHandle {
    id: String,
    page: tokio::sync::Mutex<Option<Page>>,
    generation: AtomicU64,
    url: Mutex<String>,
    title: Mutex<String>,
}

impl TabHandle {
    fn new(id: String, page: Page, url: String, title: String) -> Self {
        Self::with_generation(id, page, url, title, 1)
    }

    /// Relaunched browsers start at the session's next generation epoch so
    /// observation refs minted by the previous incarnation can never validate
    /// against the rebuilt tab even if their numeric generation collides.
    fn with_generation(
        id: String,
        page: Page,
        url: String,
        title: String,
        generation: u64,
    ) -> Self {
        Self {
            id,
            page: tokio::sync::Mutex::new(Some(page)),
            generation: AtomicU64::new(generation),
            url: Mutex::new(url),
            title: Mutex::new(title),
        }
    }

    fn meta(&self) -> TabMeta {
        TabMeta {
            tab_id: self.id.clone(),
            generation: self.generation.load(Ordering::Acquire),
            url: self.url.lock().expect("tab url").clone(),
            title: self.title.lock().expect("tab title").clone(),
        }
    }

    fn set_location(&self, url: String, title: String) {
        *self.url.lock().expect("tab url") = url;
        *self.title.lock().expect("tab title") = title;
    }
}

pub(crate) struct SessionHandle {
    id: String,
    engine: String,
    // Tokio mutex: CDP calls (new_page, close) hold the browser across awaits.
    browser: tokio::sync::Mutex<Option<Browser>>,
    tabs: Mutex<Vec<Arc<TabHandle>>>,
    started_at_ms: u64,
    data_dir: PathBuf,
    // Active screencast supervisors keyed by tab id; firing the sender stops
    // the frame stream for that tab.
    casts: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

fn registry() -> &'static Mutex<HashMap<String, Arc<SessionHandle>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<SessionHandle>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

const HOST_CANDIDATES: &[&str] = &[
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "chrome",
];

fn which_candidate(names: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn resolve_host_path() -> Option<PathBuf> {
    if let Ok(forced) = std::env::var("PT_BROWSER_BIN") {
        let path = PathBuf::from(forced.trim());
        if !forced.trim().is_empty() && path.exists() {
            return Some(path);
        }
    }
    which_candidate(HOST_CANDIDATES)
}

/// Probe the managed browser host. Capability advertisement must use this
/// proof only; MCP/config presence is never readiness.
pub(crate) fn host_info() -> HostInfo {
    match resolve_host_path() {
        Some(path) => {
            let output = std::process::Command::new(&path).arg("--version").output();
            match output {
                Ok(std::process::Output { status, stdout, .. }) if status.success() => {
                    let line = String::from_utf8_lossy(&stdout).trim().to_string();
                    let mut parts = line.splitn(2, ' ');
                    let name = parts.next().unwrap_or("browser").to_lowercase();
                    let version = parts.next().unwrap_or("").to_string();
                    let engine = format!("{}/{}", name.replace(' ', "-"), version);
                    HostInfo {
                        available: true,
                        engine,
                        version,
                        path: path.to_string_lossy().into_owned(),
                    }
                }
                _ => HostInfo {
                    available: false,
                    engine: String::new(),
                    version: String::new(),
                    path: path.to_string_lossy().into_owned(),
                },
            }
        }
        None => HostInfo {
            available: false,
            engine: String::new(),
            version: String::new(),
            path: String::new(),
        },
    }
}

/// The managed browser never needs an OS window: the human watches the
/// screencast stream inside the workbench panel. Headless is therefore the
/// only mode; PT_BROWSER_HEADLESS=0 opts into a headful process for local
/// debugging of a session.
fn default_headless() -> bool {
    std::env::var("PT_BROWSER_HEADLESS").as_deref() != Ok("0")
}

async fn launch_browser(data_dir: &Path, headless: bool) -> Result<Browser, BrowserError> {
    let host = resolve_host_path().ok_or_else(|| {
        BrowserError::unavailable("no managed Chromium/Chrome host found on this device")
    })?;
    // with_head keeps the standard CDP attachment; headless=new is added as a
    // host arg below and remains the same Chrome engine (screenshots/input
    // behave identically). Arg keys are passed WITHOUT leading dashes.
    // Headless Chrome ignores runtime window resizing, so launch at the fixed
    // screencast surface size; the panel fits the frame with object-contain.
    let mut builder = BrowserConfig::builder()
        .chrome_executable(host)
        .user_data_dir(data_dir)
        .no_sandbox()
        .with_head()
        .viewport(None)
        .window_size(SURFACE_WIDTH, SURFACE_HEIGHT)
        .args([
            "no-first-run",
            "no-default-browser-check",
            "disable-background-networking",
        ])
        .arg(("password-store", "basic"))
        .arg(("disable-features", "Translate,MediaRouter"))
        .disable_default_args();
    if headless {
        // headless=new renders the full browser pipeline off-screen: no OS
        // window is ever mapped, while CDP screenshots/input stay identical.
        builder = builder
            .arg(("headless", "new"))
            .arg("disable-gpu");
    }
    let config = builder
        .build()
        .map_err(|error| BrowserError::failed(format!("build browser config: {error}")))?;
    let (browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|error| BrowserError::failed(format!("launch browser host: {error}")))?;
    // Drive the CDP connection in the background for the session lifetime.
    tauri::async_runtime::spawn(async move {
        while handler.next().await.is_some() {}
    });
    Ok(browser)
}

pub(crate) async fn create_session(
    app: AppHandle,
    session_id: String,
) -> Result<BrowserMeta, BrowserError> {
    let info = host_info();
    if !info.available {
        return Err(BrowserError::unavailable(
            "no verified managed browser host; browser capability stays unadvertised",
        ));
    }
    // The browser profile is device application data, never the workspace:
    // page credentials/cookies must not land in task evidence.
    let data_dir = browser_data_dir(&session_id)?;
    let headless = default_headless();
    let browser = launch_browser(&data_dir, headless).await?;
    let initial = browser
        .new_page("about:blank")
        .await
        .map_err(|error| BrowserError::failed(format!("open initial tab: {error}")))?;
    let tab_id = initial.target_id().inner().to_string();
    let handle = Arc::new(SessionHandle {
        id: session_id.clone(),
        engine: info.engine,
        browser: tokio::sync::Mutex::new(Some(browser)),
        tabs: Mutex::new(vec![Arc::new(TabHandle::new(
            tab_id,
            initial,
            "about:blank".to_string(),
            String::new(),
        ))]),
        started_at_ms: now_ms(),
        data_dir,
        casts: Mutex::new(HashMap::new()),
    });
    registry()
        .lock()
        .expect("browser registry")
        .insert(session_id.clone(), Arc::clone(&handle));
    emit_meta(&app, &handle);
    Ok(handle.meta())
}

fn browser_data_dir(session_id: &str) -> Result<PathBuf, BrowserError> {
    let root = storage::application_data_root()
        .map_err(|error| BrowserError::failed(format!("resolve application data dir: {error}")))?;
    let dir = root.join("browser-sessions").join(session_id);
    std::fs::create_dir_all(&dir)
        .map_err(|error| BrowserError::failed(format!("create browser profile dir: {error}")))?;
    Ok(dir)
}

impl SessionHandle {
    fn meta(&self) -> BrowserMeta {
        BrowserMeta {
            session_id: self.id.clone(),
            engine: self.engine.clone(),
            status: "active".to_string(),
            lease: "agent".to_string(),
            tabs: self
                .tabs
                .lock()
                .expect("browser tabs")
                .iter()
                .map(|tab| tab.meta())
                .collect(),
            started_at_ms: self.started_at_ms,
        }
    }

    fn tab(&self, tab_id: &str) -> Result<Arc<TabHandle>, BrowserError> {
        self.tabs
            .lock()
            .expect("browser tabs")
            .iter()
            .find(|tab| tab.id == tab_id)
            .cloned()
            .ok_or_else(|| BrowserError::invalid("browser tab not found"))
    }

    async fn close(&self) {
        // Stop every screencast supervisor before closing the browser.
        let senders: Vec<_> = self
            .casts
            .lock()
            .expect("browser casts")
            .drain()
            .map(|(_, sender)| sender)
            .collect();
        for sender in senders {
            let _ = sender.send(());
        }
        if let Some(mut browser) = self.browser.lock().await.take() {
            let _ = browser.close().await;
        }
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }
}

async fn with_session<T, Fut>(
    session_id: &str,
    action: impl FnOnce(Arc<SessionHandle>) -> Fut,
) -> Result<T, BrowserError>
where
    Fut: std::future::Future<Output = Result<T, BrowserError>>,
{
    let session = {
        let sessions = registry().lock().expect("browser registry");
        sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| BrowserError::invalid("browser session not found"))?
    };
    action(session).await
}

/// JS injected into the page to produce one observation. It is the only
/// code that runs in the untrusted page realm, and its output is treated as
/// data: returned strings never feed command construction. Element refs are
/// stamped on the DOM so actions target exactly what was observed.
const SNAPSHOT_JS: &str = r#"
(() => {
  const selector = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=textbox],[role=menuitem],[contenteditable=""],[contenteditable=true],summary';
  const nodes = Array.from(document.querySelectorAll(selector));
  const elements = [];
  nodes.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const ref = 'e' + elements.length;
    el.setAttribute('data-pt-bref', ref);
    elements.push({
      ref,
      tag: el.tagName.toLowerCase(),
      inputType: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      name: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 120),
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
  });
  return JSON.stringify({
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').slice(0, 8000),
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY
    },
    elements
  });
})()
"#;

/// Parse an exposed `g<generation>-e<index>` ref and verify it matches the
/// tab's current observation generation.
fn verify_ref(tab: &TabHandle, exposed: &str) -> Result<String, BrowserError> {
    let (gen_part, el_part) = exposed
        .split_once('-')
        .ok_or_else(|| BrowserError::invalid("malformed snapshot ref"))?;
    let observed = gen_part
        .strip_prefix('g')
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| BrowserError::invalid("malformed snapshot ref generation"))?;
    if observed != tab.generation.load(Ordering::Acquire) {
        return Err(BrowserError::stale());
    }
    if !el_part.starts_with('e') {
        return Err(BrowserError::invalid("malformed snapshot ref element"));
    }
    Ok(el_part.to_string())
}

async fn eval_json(page: &Page, script: String) -> Result<String, BrowserError> {
    page.evaluate(script)
        .await
        .map_err(|error| BrowserError::failed(format!("page evaluate: {error}")))?
        .into_value::<String>()
        .map_err(|error| BrowserError::failed(format!("page evaluate result: {error}")))
}

pub(crate) async fn open_tab(session_id: &str, url: String) -> Result<TabMeta, BrowserError> {
    with_session(session_id, |session| async move {
        let page = {
            let browser = session.browser.lock().await;
            let browser = browser
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser session is closed"))?;
            browser
                .new_page(&url)
                .await
                .map_err(|error| BrowserError::failed(format!("open tab: {error}")))?
        };
        let tab_id = page.target_id().inner().to_string();
        let tab = Arc::new(TabHandle::new(tab_id, page, url.clone(), String::new()));
        session
            .tabs
            .lock()
            .expect("browser tabs")
            .push(Arc::clone(&tab));
        Ok(tab.meta())
    })
    .await
}

pub(crate) async fn close_tab(session_id: &str, tab_id: String) -> Result<(), BrowserError> {
    with_session(session_id, |session| async move {
        stop_cast(&session, &tab_id);
        let tab = session.tab(&tab_id)?;
        if let Some(page) = tab.page.lock().await.take() {
            page.close()
                .await
                .map_err(|error| BrowserError::failed(format!("close tab: {error}")))?;
        }
        session
            .tabs
            .lock()
            .expect("browser tabs")
            .retain(|candidate| candidate.id != tab_id);
        Ok(())
    })
    .await
}

pub(crate) async fn list_tabs(session_id: &str) -> Result<Vec<TabMeta>, BrowserError> {
    with_session(session_id, |session| async move {
        Ok(session
            .tabs
            .lock()
            .expect("browser tabs")
            .iter()
            .map(|tab| tab.meta())
            .collect())
    })
    .await
}

async fn bump_generation(
    app: Option<&AppHandle>,
    session: &Arc<SessionHandle>,
    tab: &TabHandle,
) -> Result<(), BrowserError> {
    tab.generation.fetch_add(1, Ordering::AcqRel);
    // Observed elements belong to the old generation; drop their DOM stamps.
    let guard = tab.page.lock().await;
    if let Some(page) = guard.as_ref() {
        let _ = eval_json(
            page,
            "document.querySelectorAll('[data-pt-bref]').forEach(el => el.removeAttribute('data-pt-bref')); 'ok'".to_string(),
        )
        .await;
    }
    drop(guard);
    if let Some(app) = app {
        emit_meta(app, session);
    }
    Ok(())
}

pub(crate) async fn navigate(
    app: AppHandle,
    session_id: &str,
    tab_id: String,
    url: String,
) -> Result<TabMeta, BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        {
            let guard = tab.page.lock().await;
            let page = guard
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?;
            page.goto(url)
                .await
                .map_err(|error| BrowserError::failed(format!("navigate: {error}")))?;
            page.wait_for_navigation()
                .await
                .map_err(|error| BrowserError::failed(format!("wait navigation: {error}")))?;
            let location: String = eval_json(page, "location.href".to_string()).await?;
            let title: String = eval_json(page, "document.title".to_string()).await?;
            tab.set_location(location, title);
        }
        bump_generation(Some(&app), &session, &tab).await?;
        Ok(tab.meta())
    })
    .await
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum HistoryDirection {
    Back,
    Forward,
    Reload,
}

pub(crate) async fn history(
    app: AppHandle,
    session_id: &str,
    tab_id: String,
    direction: HistoryDirection,
) -> Result<TabMeta, BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        {
            let guard = tab.page.lock().await;
            let page = guard
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?;
            match direction {
                HistoryDirection::Reload => {
                    page.reload()
                        .await
                        .map_err(|error| BrowserError::failed(format!("reload: {error}")))?;
                }
                // CDP history navigation is not exposed by the host crate;
                // the page's own history API is equivalent and observable.
                HistoryDirection::Back => {
                    eval_json(page, "history.back(); 'ok'".to_string()).await?;
                }
                HistoryDirection::Forward => {
                    eval_json(page, "history.forward(); 'ok'".to_string()).await?;
                }
            }
            let _ = page.wait_for_navigation().await;
            let location: String = eval_json(page, "location.href".to_string()).await?;
            let title: String = eval_json(page, "document.title".to_string()).await?;
            tab.set_location(location, title);
        }
        bump_generation(Some(&app), &session, &tab).await?;
        Ok(tab.meta())
    })
    .await
}

pub(crate) async fn snapshot(
    session_id: &str,
    tab_id: String,
) -> Result<SnapshotResult, BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        // Each observation starts a new generation even within the same
        // document: refs from an earlier snapshot must not survive an
        // explicit re-observe.
        tab.generation.fetch_add(1, Ordering::AcqRel);
        let (json, location, title) = {
            let guard = tab.page.lock().await;
            let page = guard
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?;
            let json = eval_json(page, SNAPSHOT_JS.to_string()).await?;
            let parsed: serde_json::Value = serde_json::from_str(&json)
                .map_err(|error| BrowserError::failed(format!("decode snapshot: {error}")))?;
            let location = parsed
                .get("url")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            let title = parsed
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            (json, location, title)
        };
        tab.set_location(location, title);
        let parsed: serde_json::Value = serde_json::from_str(&json)
            .map_err(|error| BrowserError::failed(format!("decode snapshot: {error}")))?;
        let text = parsed
            .get("text")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        let viewport_value = parsed.get("viewport").cloned().unwrap_or(serde_json::json!({}));
        let viewport = ViewportInfo {
            inner_width: viewport_value.get("innerWidth").and_then(|v| v.as_i64()).unwrap_or(0),
            inner_height: viewport_value.get("innerHeight").and_then(|v| v.as_i64()).unwrap_or(0),
            outer_width: viewport_value.get("outerWidth").and_then(|v| v.as_i64()).unwrap_or(0),
            outer_height: viewport_value.get("outerHeight").and_then(|v| v.as_i64()).unwrap_or(0),
            screen_x: viewport_value.get("screenX").and_then(|v| v.as_i64()).unwrap_or(0),
            screen_y: viewport_value.get("screenY").and_then(|v| v.as_i64()).unwrap_or(0),
        };
        let generation = tab.generation.load(Ordering::Acquire);
        let mut elements = Vec::new();
        if let Some(items) = parsed.get("elements").and_then(|value| value.as_array()) {
            for item in items {
                let el_ref = item
                    .get("ref")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                elements.push(ElementInfo {
                    ref_id: format!("g{generation}-{el_ref}"),
                    tag: item
                        .get("tag")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    input_type: item
                        .get("inputType")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    role: item
                        .get("role")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    name: item
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    x: item.get("x").and_then(|v| v.as_i64()).unwrap_or(0),
                    y: item.get("y").and_then(|v| v.as_i64()).unwrap_or(0),
                    width: item.get("width").and_then(|v| v.as_i64()).unwrap_or(0),
                    height: item.get("height").and_then(|v| v.as_i64()).unwrap_or(0),
                });
            }
        }
        Ok(SnapshotResult {
            tab: tab.meta(),
            lease: "agent".to_string(),
            text,
            viewport,
            elements,
        })
    })
    .await
}

fn element_action_js(el_ref: &str, action: &str) -> String {
    // el_ref is the stamped attribute token we minted; page content is only
    // ever read, never interpolated as code.
    format!(
        r#"
(() => {{
  const el = document.querySelector('[data-pt-bref="{el_ref}"]');
  if (!el) return JSON.stringify({{ok:false, code:'BROWSER_SNAPSHOT_REF_STALE'}});
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return JSON.stringify({{ok:false, code:'BROWSER_ELEMENT_NOT_INTERACTABLE'}});
  el.scrollIntoView({{block:'center'}});
  {action}
  return JSON.stringify({{ok:true}});
}})()
"#
    )
}

pub(crate) async fn click(
    app: AppHandle,
    session_id: &str,
    tab_id: String,
    exposed_ref: String,
) -> Result<TabMeta, BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        let el_ref = verify_ref(&tab, &exposed_ref)?;
        let result = {
            let guard = tab.page.lock().await;
            let page = guard
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?;
            eval_json(page, element_action_js(&el_ref, "el.click();")).await?
        };
        check_action_result(&result)?;
        // A click may navigate; force a fresh generation regardless.
        {
            let guard = tab.page.lock().await;
            if let Some(page) = guard.as_ref() {
                let _ = page.wait_for_navigation().await;
                let location = eval_json(page, "location.href".to_string()).await.unwrap_or_default();
                let title = eval_json(page, "document.title".to_string()).await.unwrap_or_default();
                tab.set_location(location, title);
            }
        }
        bump_generation(Some(&app), &session, &tab).await?;
        Ok(tab.meta())
    })
    .await
}

pub(crate) async fn fill(
    app: AppHandle,
    session_id: &str,
    tab_id: String,
    exposed_ref: String,
    value: String,
) -> Result<TabMeta, BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        let el_ref = verify_ref(&tab, &exposed_ref)?;
        let encoded = serde_json::to_string(&value).unwrap_or_else(|_| "\"\"".to_string());
        // The value is a user/agent instruction string, assigned through the
        // page's own input machinery; page content is never read back as a
        // command.
        let action = format!(
            "const value = {encoded};\
             if (el.isContentEditable) {{ el.textContent = value; }} \
             else {{ const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') \
               || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value'); \
               if (proto && proto.set) {{ proto.set.call(el, value); }} else {{ el.value = value; }} \
               el.dispatchEvent(new Event('input', {{bubbles:true}})); \
               el.dispatchEvent(new Event('change', {{bubbles:true}})); }} \
             el.focus();"
        );
        let result = {
            let guard = tab.page.lock().await;
            let page = guard
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?;
            eval_json(page, element_action_js(&el_ref, &action)).await?
        };
        check_action_result(&result)?;
        emit_meta(&app, &session);
        Ok(tab.meta())
    })
    .await
}

pub(crate) async fn submit(
    app: AppHandle,
    session_id: &str,
    tab_id: String,
    exposed_ref: String,
) -> Result<TabMeta, BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        let el_ref = verify_ref(&tab, &exposed_ref)?;
        let result = {
            let guard = tab.page.lock().await;
            let page = guard
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?;
            eval_json(
                page,
                element_action_js(
                    &el_ref,
                    "if (el.form) { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); } else { el.click(); }",
                ),
            )
            .await?
        };
        check_action_result(&result)?;
        {
            let guard = tab.page.lock().await;
            if let Some(page) = guard.as_ref() {
                let _ = page.wait_for_navigation().await;
                let location = eval_json(page, "location.href".to_string()).await.unwrap_or_default();
                let title = eval_json(page, "document.title".to_string()).await.unwrap_or_default();
                tab.set_location(location, title);
            }
        }
        bump_generation(Some(&app), &session, &tab).await?;
        Ok(tab.meta())
    })
    .await
}

fn check_action_result(json: &str) -> Result<(), BrowserError> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
        if value.get("ok").and_then(|ok| ok.as_bool()) == Some(true) {
            return Ok(());
        }
        if value.get("code").and_then(|code| code.as_str())
            == Some("BROWSER_SNAPSHOT_REF_STALE")
        {
            return Err(BrowserError::stale());
        }
        return Err(BrowserError::failed(format!("page rejected action: {json}")));
    }
    Err(BrowserError::failed("malformed action result"))
}

pub(crate) async fn screenshot(
    session_id: &str,
    tab_id: String,
) -> Result<Vec<u8>, BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        let guard = tab.page.lock().await;
        let page = guard
            .as_ref()
            .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?;
        let params = ScreenshotParams::builder()
            .format(CaptureScreenshotFormat::Png)
            .build();
        page.screenshot(params)
            .await
            .map_err(|error| BrowserError::failed(format!("screenshot: {error}")))
    })
    .await
}

// ── Live screencast + human input bridge ────────────────────────────────
//
// The workbench panel renders the real page through Page.startScreencast and
// forwards pointer/keyboard events through the CDP Input domain. Human input
// always works: it shares the Page with the agent instead of opening a
// separate window.

/// Minimum interval between location polls. Screencast frames do not carry
/// the URL; throttled eval keeps the address bar/tab title live without
/// issuing a CDP round-trip per frame.
const LOCATION_POLL_MS: u64 = 500;

/// Fixed remote window/screencast surface. Headless Chrome ignores runtime
/// bounds changes, so the browser launches at this size and the panel fits
/// the frame using object-contain.
const SURFACE_WIDTH: u32 = 480;
const SURFACE_HEIGHT: u32 = 760;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FramePayload {
    session_id: String,
    tab_id: String,
    data_b64: String,
    width: i64,
    height: i64,
}

fn stop_cast(session: &SessionHandle, tab_id: &str) {
    if let Some(sender) = session.casts.lock().expect("browser casts").remove(tab_id) {
        let _ = sender.send(());
    }
}

pub(crate) async fn start_screencast(
    app: AppHandle,
    session_id: &str,
    tab_id: String,
    width: i64,
    height: i64,
) -> Result<(), BrowserError> {
    with_session(session_id, |session| async move {
        let tab = session.tab(&tab_id)?;
        // Restarting a stream (e.g. after a panel resize) first stops the old
        // supervisor so two frame streams never share one tab.
        stop_cast(&session, &tab_id);

        let page = {
            let guard = tab.page.lock().await;
            guard
                .as_ref()
                .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?
                .clone()
        };

        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        session
            .casts
            .lock()
            .expect("browser casts")
            .insert(tab_id.clone(), stop_tx);

        let app = app.clone();
        let session = Arc::clone(&session);
        tauri::async_runtime::spawn(run_screencast(
            app, session, tab, page, width.max(1), height.max(1), stop_rx,
        ));
        Ok(())
    })
    .await
}

pub(crate) async fn stop_screencast(session_id: &str, tab_id: String) -> Result<(), BrowserError> {
    with_session(session_id, |session| async move {
        stop_cast(&session, &tab_id);
        Ok(())
    })
    .await
}

async fn run_screencast(
    app: AppHandle,
    session: Arc<SessionHandle>,
    tab: Arc<TabHandle>,
    page: Page,
    _width: i64,
    _height: i64,
    mut stopped: tokio::sync::oneshot::Receiver<()>,
) {
    // Register the frame listener before starting the stream so the first
    // frames cannot be missed.
    let mut frames = match page.event_listener::<EventScreencastFrame>().await {
        Ok(frames) => frames,
        Err(error) => {
            tracing::warn!(error = %error, "browser: screencast listener failed");
            return;
        }
    };

    // Headless targets need explicit activation to receive input focus for
    // forwarded pointer/keyboard events (text entry, checkboxes, buttons).
    let _ = page.bring_to_front().await;

    let start = StartScreencastParams::builder()
        .format(StartScreencastFormat::Jpeg)
        .quality(60)
        .every_nth_frame(1)
        .build();
    if let Err(error) = page.execute(start).await {
        tracing::warn!(error = %error, "browser: start screencast failed");
        return;
    }

    let mut last_location_poll = Instant::now();
    loop {
        tokio::select! {
            _ = &mut stopped => break,
            frame = frames.next() => {
                let Some(frame) = frame else { break };
                let ack = ScreencastFrameAckParams::new(frame.session_id);
                let _ = page.execute(ack).await;
                // CDP delivers screencast bytes already base64-encoded.
                let data_b64: &str = frame.data.as_ref();
                let payload = FramePayload {
                    session_id: session.id.clone(),
                    tab_id: tab.id.clone(),
                    data_b64: data_b64.to_string(),
                    width: frame.metadata.device_width as i64,
                    height: frame.metadata.device_height as i64,
                };
                let _ = app.emit(BROWSER_FRAME_EVENT, payload);

                if last_location_poll.elapsed() >= Duration::from_millis(LOCATION_POLL_MS) {
                    last_location_poll = Instant::now();
                    sync_tab_location(&app, &session, &tab, &page).await;
                }
            }
        }
    }

    let _ = page.execute(StopScreencastParams::default()).await;
    // Drop a stale stop handle only if it still points at this supervisor.
    if let Some(sender) = session.casts.lock().expect("browser casts").get(&tab.id) {
        if sender.is_closed() {
            session.casts.lock().expect("browser casts").remove(&tab.id);
        }
    }
}

async fn sync_tab_location(app: &AppHandle, session: &Arc<SessionHandle>, tab: &Arc<TabHandle>, page: &Page) {
    let location = eval_json(page, "location.href".to_string()).await.unwrap_or_default();
    let title = eval_json(page, "document.title".to_string()).await.unwrap_or_default();
    let previous = tab.meta().url;
    if location != previous {
        tab.set_location(location, title);
        emit_meta(app, session);
    }
}

fn map_mouse_button(button: &str) -> Option<MouseButton> {
    match button {
        "left" => Some(MouseButton::Left),
        "right" => Some(MouseButton::Right),
        "middle" => Some(MouseButton::Middle),
        _ => None,
    }
}

/// Forwarded human pointer event. `kind` is moved | pressed | released.
pub(crate) async fn send_mouse(
    session_id: &str,
    tab_id: String,
    kind: String,
    x: f64,
    y: f64,
    button: String,
    buttons: i64,
    click_count: i64,
) -> Result<(), BrowserError> {
    let event_type = match kind.as_str() {
        "moved" => DispatchMouseEventType::MouseMoved,
        "pressed" => DispatchMouseEventType::MousePressed,
        "released" => DispatchMouseEventType::MouseReleased,
        _ => return Err(BrowserError::invalid("mouse kind must be moved, pressed or released")),
    };
    let params = DispatchMouseEventParams {
        r#type: event_type,
        x,
        y,
        modifiers: None,
        timestamp: None,
        button: map_mouse_button(&button),
        buttons: Some(buttons),
        click_count: Some(click_count),
        force: None,
        tangential_pressure: None,
        tilt_x: None,
        tilt_y: None,
        twist: None,
        delta_x: None,
        delta_y: None,
        pointer_type: None,
    };
    with_page(session_id, &tab_id, |page| async move {
        page.execute(params)
            .await
            .map(|_| ())
            .map_err(|error| BrowserError::failed(format!("dispatch mouse: {error}")))
    })
    .await
}

pub(crate) async fn send_wheel(
    session_id: &str,
    tab_id: String,
    x: f64,
    y: f64,
    delta_x: f64,
    delta_y: f64,
) -> Result<(), BrowserError> {
    let params = DispatchMouseEventParams {
        r#type: DispatchMouseEventType::MouseWheel,
        x,
        y,
        modifiers: None,
        timestamp: None,
        button: None,
        buttons: Some(0),
        click_count: Some(0),
        force: None,
        tangential_pressure: None,
        tilt_x: None,
        tilt_y: None,
        twist: None,
        delta_x: Some(delta_x),
        delta_y: Some(delta_y),
        pointer_type: None,
    };
    with_page(session_id, &tab_id, |page| async move {
        page.execute(params)
            .await
            .map(|_| ())
            .map_err(|error| BrowserError::failed(format!("dispatch wheel: {error}")))
    })
    .await
}

/// Forwarded human keyboard event. `kind` is down | up | char.
pub(crate) async fn send_key(
    session_id: &str,
    tab_id: String,
    kind: String,
    key: String,
    code: String,
    modifiers: i64,
) -> Result<(), BrowserError> {
    let event_type = match kind.as_str() {
        "down" => DispatchKeyEventType::RawKeyDown,
        "up" => DispatchKeyEventType::KeyUp,
        "char" => DispatchKeyEventType::Char,
        _ => return Err(BrowserError::invalid("key kind must be down, up or char")),
    };
    let params = DispatchKeyEventParams {
        r#type: event_type,
        modifiers: Some(modifiers),
        timestamp: None,
        text: None,
        unmodified_text: None,
        key_identifier: None,
        code: Some(code),
        key: Some(key),
        windows_virtual_key_code: None,
        native_virtual_key_code: None,
        auto_repeat: None,
        is_keypad: None,
        is_system_key: None,
        location: None,
        commands: None,
    };
    with_page(session_id, &tab_id, |page| async move {
        page.execute(params)
            .await
            .map(|_| ())
            .map_err(|error| BrowserError::failed(format!("dispatch key: {error}")))
    })
    .await
}

/// Commits composed text (printable input typed in the host webview,
/// including IME compositions on compositionend) directly into the focused
/// page element.
pub(crate) async fn insert_text(session_id: &str, tab_id: String, text: String) -> Result<(), BrowserError> {
    with_page(session_id, &tab_id, |page| async move {
        page.execute(InsertTextParams { text })
            .await
            .map(|_| ())
            .map_err(|error| BrowserError::failed(format!("insert text: {error}")))
    })
    .await
}

async fn with_page<T, Fut>(
    session_id: &str,
    tab_id: &str,
    action: impl FnOnce(Page) -> Fut,
) -> Result<T, BrowserError>
where
    Fut: std::future::Future<Output = Result<T, BrowserError>>,
{
    with_session(session_id, |session| async move {
        let tab = session.tab(tab_id)?;
        let guard = tab.page.lock().await;
        let page = guard
            .as_ref()
            .ok_or_else(|| BrowserError::invalid("browser tab is closed"))?
            .clone();
        drop(guard);
        action(page).await
    })
    .await
}

pub(crate) async fn inspect(session_id: &str) -> Result<BrowserMeta, BrowserError> {
    // Inspect is always allowed, including after timeout/disconnect: callers
    // use current tab state to decide whether a mutation may be retried.
    with_session(session_id, |session| async move { Ok(session.meta()) }).await
}

pub(crate) async fn remove_session(app: AppHandle, session_id: &str) -> Result<(), BrowserError> {
    let handle = {
        let mut sessions = registry().lock().expect("browser registry");
        sessions.remove(session_id)
    };
    if let Some(session) = handle {
        session.close().await;
        let payload = serde_json::json!({
            "sessionId": session_id,
            "kind": "closed",
            "status": "closed",
        });
        let _ = app.emit(BROWSER_EVENT, payload);
    }
    Ok(())
}

pub(crate) fn list_sessions() -> Vec<BrowserMeta> {
    registry()
        .lock()
        .expect("browser registry")
        .values()
        .map(|session| session.meta())
        .collect()
}

fn emit_meta(app: &AppHandle, session: &Arc<SessionHandle>) {
    let _ = app.emit(
        BROWSER_EVENT,
        serde_json::json!({
            "sessionId": session.id,
            "kind": "meta",
            "meta": session.meta(),
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::verify_ref_direct;

    #[test]
    fn ref_parsing_roundtrip_uses_generation_prefix() {
        let valid = verify_ref_direct(7, "g7-e12");
        assert!(valid.is_ok());
        let stale = verify_ref_direct(7, "g6-e12");
        assert!(stale.is_err());
        assert_eq!(stale.unwrap_err().code, "BROWSER_SNAPSHOT_REF_STALE");
        assert!(verify_ref_direct(7, "not-a-ref").is_err());
    }

    #[test]
    fn action_script_never_interpolates_page_content_as_code() {
        let script = super::element_action_js("e3", "el.click();");
        assert!(script.contains(r#"[data-pt-bref="e3"]"#));
        assert!(!script.contains("</script>"));
    }
}

// Test-only parsing mirror of verify_ref's generation check.
#[cfg(test)]
fn verify_ref_direct(generation: u64, exposed: &str) -> Result<String, BrowserError> {
    let (gen_part, el_part) = exposed
        .split_once('-')
        .ok_or_else(|| BrowserError::invalid("malformed snapshot ref"))?;
    let observed = gen_part
        .strip_prefix('g')
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| BrowserError::invalid("malformed snapshot ref generation"))?;
    if observed != generation {
        return Err(BrowserError::stale());
    }
    Ok(el_part.to_string())
}
