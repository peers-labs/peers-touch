// TW-D6: device-held real browser sessions.
//
// The browser process is launched and controlled by the worker through a
// verified CDP host (managed Chromium/Chrome with an isolated per-session
// user data dir). The Page is a renderer of untrusted data: page text and
// DOM never become commands, credentials or permissions, and every agent
// action is gated by an observation generation + control lease. A human
// takeover acquires the lease and pauses all agent actions; after release
// the agent must observe a fresh generation before acting again.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::page::ScreenshotParams;
use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotFormat;
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Lease {
    Agent,
    Human,
}

impl Lease {
    fn name(self) -> &'static str {
        match self {
            Lease::Agent => "agent",
            Lease::Human => "human",
        }
    }
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
    fn takeover() -> Self {
        Self {
            code: "BROWSER_HUMAN_TAKEOVER_HELD",
            message: "human control lease is active; agent actions are paused".to_string(),
        }
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
    // Tokio mutex: CDP calls (new_page, close, relaunch) hold the browser across awaits.
    browser: tokio::sync::Mutex<Option<Browser>>,
    tabs: Mutex<Vec<Arc<TabHandle>>>,
    lease: Mutex<Lease>,
    started_at_ms: u64,
    data_dir: PathBuf,
    // Whether the current browser process runs headless (agent control) or as
    // a visible OS window (human takeover). Relaunch flips the mode in place.
    headless: Mutex<bool>,
    // Strictly increasing epoch; every relaunch rebuilds tabs on a higher
    // epoch so stale observation refs can never match a new incarnation.
    generation_epoch: AtomicU64,
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

/// Native E2E cells keep the browser headful from creation: physical-input
/// takeover gates (tw-d6) drive the real on-screen window with xdotool.
fn e2e_native_cell() -> bool {
    std::env::var("PT_DESKTOP_E2E").as_deref() == Ok("1")
}

/// Explicit CI/headless override.
fn force_headless() -> bool {
    std::env::var("PT_BROWSER_HEADLESS").as_deref() == Ok("1")
}

/// The agent-controlled browser must not exist as an OS window in production:
/// headless by default so there is no taskbar entry, no infobar and no
/// window-manager race. Human takeover relaunches a headful instance on the
/// same profile. Native E2E cells and explicit headful CI setups opt out.
fn default_headless() -> bool {
    force_headless() || !e2e_native_cell()
}

async fn launch_browser(data_dir: &Path, headless: bool) -> Result<Browser, BrowserError> {
    let host = resolve_host_path().ok_or_else(|| {
        BrowserError::unavailable("no managed Chromium/Chrome host found on this device")
    })?;
    // with_head keeps the standard CDP attachment; headless=new is added as a
    // host arg below and remains the same Chrome engine (screenshots/input
    // behave identically). Arg keys are passed WITHOUT leading dashes.
    let mut builder = BrowserConfig::builder()
        .chrome_executable(host)
        .user_data_dir(data_dir)
        .no_sandbox()
        .with_head()
        // No device-metrics emulation: the 1280x860 window is the observed
        // viewport so coordinates match physical input in headful takeover.
        .viewport(None)
        .window_size(1280, 860)
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
        lease: Mutex::new(Lease::Agent),
        started_at_ms: now_ms(),
        data_dir,
        headless: Mutex::new(headless),
        generation_epoch: AtomicU64::new(1),
    });
    registry()
        .lock()
        .expect("browser registry")
        .insert(session_id.clone(), Arc::clone(&handle));
    emit_meta(&app, &handle);
    // A headless process owns no OS window; only headful cells need parking
    // while the agent drives (takeover restores it later).
    if !headless {
        place_session_window(handle.data_dir.as_path(), true).await;
    }
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
            lease: self.lease.lock().expect("browser lease").name().to_string(),
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

    fn require_agent_lease(&self) -> Result<(), BrowserError> {
        if *self.lease.lock().expect("browser lease") == Lease::Human {
            return Err(BrowserError::takeover());
        }
        Ok(())
    }

    async fn close(&self) {
        if let Some(mut browser) = self.browser.lock().await.take() {
            let _ = browser.close().await;
        }
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }

    /// Switches the running browser between headless (agent control) and
    /// headful (human takeover) without changing the session identity or its
    /// on-disk profile: cookies, logins and open URLs survive. Tab target ids
    /// are rebuilt and every rebuilt tab starts on a fresh generation epoch.
    async fn relaunch(&self, headless: bool) -> Result<(), BrowserError> {
        let urls: Vec<String> = self
            .tabs
            .lock()
            .expect("browser tabs")
            .iter()
            .map(|tab| tab.url.lock().expect("tab url").clone())
            .filter(|url| !url.is_empty())
            .collect();
        if let Some(mut previous) = self.browser.lock().await.take() {
            let _ = previous.close().await;
        }
        // chromiumoxide reaps the child asynchronously after close(); wait for
        // the actual profile process to exit rather than the lock files.
        wait_profile_process_exit(&self.data_dir).await?;
        let browser = launch_browser(&self.data_dir, headless).await?;
        let epoch = self.generation_epoch.fetch_add(1, Ordering::AcqRel) + 1;

        let targets = if urls.is_empty() {
            vec!["about:blank".to_string()]
        } else {
            urls
        };
        let mut rebuilt: Vec<Arc<TabHandle>> = Vec::with_capacity(targets.len());
        for url in targets {
            let page = browser
                .new_page(&url)
                .await
                .map_err(|error| BrowserError::failed(format!("reopen tab during relaunch: {error}")))?;
            let tab_id = page.target_id().inner().to_string();
            rebuilt.push(Arc::new(TabHandle::with_generation(
                tab_id,
                page,
                url,
                String::new(),
                epoch,
            )));
        }
        *self.tabs.lock().expect("browser tabs") = rebuilt;
        *self.browser.lock().await = Some(browser);
        *self.headless.lock().expect("headless flag") = headless;
        Ok(())
    }

    fn is_headless(&self) -> bool {
        *self.headless.lock().expect("headless flag")
    }
}

/// Polls until no Chrome process references this profile. Lock files can
/// outlive a killed process briefly, while a second Chrome attached to a live
/// profile always fails — process exit is the reliable reuse signal. If the
/// graceful close lingers, the profile processes are killed explicitly.
async fn wait_profile_process_exit(data_dir: &Path) -> Result<(), BrowserError> {
    let pattern = format!("user-data-dir={}", data_dir.display());
    let grace_deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if !profile_processes_running(&pattern) {
            return Ok(());
        }
        if Instant::now() >= grace_deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // chromiumoxide reaps the child in the background; force the issue so a
    // slow shutdown cannot block the profile reuse.
    let kill_pattern = pattern.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = std::process::Command::new("pkill")
            .arg("-f")
            .arg(kill_pattern)
            .status();
    })
    .await
    .map_err(|error| BrowserError::failed(format!("relaunch kill join failed: {error}")))?;
    let kill_deadline = Instant::now() + Duration::from_secs(7);
    loop {
        if !profile_processes_running(&pattern) {
            return Ok(());
        }
        if Instant::now() >= kill_deadline {
            return Err(BrowserError::failed(
                "managed browser process did not exit for relaunch",
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn profile_processes_running(pattern: &str) -> bool {
    std::process::Command::new("pgrep")
        .arg("-f")
        .arg(pattern)
        .output()
        .map(|output| {
            !String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .collect::<Vec<_>>()
                .is_empty()
        })
        .unwrap_or(false)
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
        session.require_agent_lease()?;
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
        let epoch = session.generation_epoch.load(Ordering::Acquire);
        let tab = Arc::new(TabHandle::with_generation(
            tab_id,
            page,
            url.clone(),
            String::new(),
            epoch,
        ));
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
        session.require_agent_lease()?;
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
        session.require_agent_lease()?;
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
        session.require_agent_lease()?;
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
        session.require_agent_lease()?;
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
            lease: session.lease.lock().expect("browser lease").name().to_string(),
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
        session.require_agent_lease()?;
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
        session.require_agent_lease()?;
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
        session.require_agent_lease()?;
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
        session.require_agent_lease()?;
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

pub(crate) async fn takeover(
    app: AppHandle,
    session_id: &str,
) -> Result<BrowserMeta, BrowserError> {
    with_session(session_id, |session| async move {
        // Production sessions run headless while the agent is in control;
        // an explicit takeover relaunches the same profile as a visible
        // window. On failure rebuild the previous headless mode so the
        // session never loses its browser process, and keep the agent lease.
        if session.is_headless() {
            if let Err(error) = session.relaunch(false).await {
                let _ = session.relaunch(true).await;
                return Err(error);
            }
        }
        *session.lease.lock().expect("browser lease") = Lease::Human;
        // The visible browser window belongs to the device user from here on;
        // the lease is the gate — agent clicks/fills are now refused.
        let focused_tab = session.tabs.lock().expect("browser tabs").first().cloned();
        if let Some(tab) = focused_tab {
            let guard = tab.page.lock().await;
            if let Some(page) = guard.as_ref() {
                let _ = page.evaluate("window.focus(); 'ok'").await;
            }
        }
        // Raise and position the OS window (no-op for headless/E2E cells).
        place_session_window(&session.data_dir, false).await;
        emit_meta(&app, &session);
        Ok(session.meta())
    })
    .await
}

pub(crate) async fn release(
    app: AppHandle,
    session_id: &str,
) -> Result<BrowserMeta, BrowserError> {
    with_session(session_id, |session| async move {
        let was_headless = session.is_headless();
        *session.lease.lock().expect("browser lease") = Lease::Agent;
        // Production returns to a headless process so the OS window vanishes
        // the moment control is handed back. Native E2E cells stay headful.
        if !was_headless && !e2e_native_cell() {
            // A failed headless relaunch would strand the visible window;
            // rebuild it headful so the session stays drivable, then surface.
            if let Err(error) = session.relaunch(true).await {
                let _ = session.relaunch(false).await;
                return Err(error);
            }
        }
        // Control changed hands: every earlier observation is invalid. Relaunch
        // already moved tabs onto a higher generation epoch; the explicit bump
        // also covers the headful E2E path and any surviving tab.
        let tabs = session.tabs.lock().expect("browser tabs").clone();
        for tab in &tabs {
            bump_generation(Some(&app), &session, tab).await?;
        }
        // Agent is back in control — park any headful window (E2E).
        place_session_window(&session.data_dir, true).await;
        emit_meta(&app, &session);
        Ok(session.meta())
    })
    .await
}

/// Best-effort X11 window placement for headful browser instances. Production
/// agent control is headless (no window to place); this only serves human
/// takeover (restore/raise/position) and headful native E2E cells. Silently
/// no-ops without xdotool (Wayland, headless, PT_DESKTOP_E2E physical geometry).
async fn place_session_window(data_dir: &Path, minimize_window: bool) {
    if std::env::var("PT_DESKTOP_E2E").as_deref() == Ok("1") {
        return;
    }
    let data_dir = data_dir.to_path_buf();
    tauri::async_runtime::spawn(async move {
        fn run(program: &str, args: &[&str]) -> bool {
            std::process::Command::new(program)
                .args(args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        }
        if !run("which", &["xdotool"]) {
            return;
        }
        // Find the chrome process using this session's profile dir.
        let pgrep = std::process::Command::new("pgrep")
            .arg("-f")
            .arg(format!("user-data-dir={}", data_dir.display()))
            .output();
        let Ok(output) = pgrep else { return };
        let pid = match String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .next()
            .map(str::to_owned)
        {
            Some(pid) => pid,
            None => return,
        };
        let search = std::process::Command::new("xdotool")
            .args(["search", "--pid"])
            .arg(&pid)
            .output();
        let Ok(output) = search else { return };
        // A Chrome process may own a tiny helper window in addition to the
        // browser window; drive the largest one rather than the first match.
        let mut candidates: Vec<(u64, u64, String)> = Vec::new();
        for window in String::from_utf8_lossy(&output.stdout).split_whitespace() {
            let geometry = std::process::Command::new("xdotool")
                .args(["getwindowgeometry", "--shell", window])
                .output();
            let Ok(geometry) = geometry else { continue };
            let mut width = 0u64;
            let mut height = 0u64;
            for line in String::from_utf8_lossy(&geometry.stdout).lines() {
                if let Some(value) = line.strip_prefix("WIDTH=") {
                    width = value.trim().parse().unwrap_or(0);
                }
                if let Some(value) = line.strip_prefix("HEIGHT=") {
                    height = value.trim().parse().unwrap_or(0);
                }
            }
            candidates.push((width * height, width, window.to_owned()));
        }
        let Some((_, _, window)) = candidates.into_iter().max_by_key(|(area, _, _)| *area) else {
            return;
        };
        if minimize_window {
            // Creation path: give the WM time to map the new window first.
            tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
            run("xdotool", &["windowminimize", &window]);
        } else {
            // Restore + move first, then activate/raise last: some WMs drop
            // the activation when geometry commands arrive right after it.
            run("xdotool", &["windowsize", &window, "1280", "860"]);
            run("xdotool", &["windowmove", &window, "120", "80"]);
            run("xdotool", &["windowactivate", "--sync", &window]);
            run("xdotool", &["windowraise", &window]);
        }
    });
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
