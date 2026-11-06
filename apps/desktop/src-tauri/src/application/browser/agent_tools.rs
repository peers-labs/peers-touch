// TW-D6 model-callable browser tools.
//
// Adapter between the client capability executor (sync, dispatched by
// capability id) and the managed browser worker. The worker remains the only
// owner of the CDP host and control lease; this module only:
//   1. resolves the task-bound agent session (creating it + the Station truth
//      row on first use),
//   2. forwards one tool action,
//   3. returns a bounded model-facing observation.
// Recoverable page outcomes (human takeover held, stale snapshot ref) stay
// bounded business results so the model can wait/re-observe instead of
// terminating the turn; only infrastructure faults become executor errors.
use crate::application::agent_browser_session;
use crate::application::station_runtime::client::StationClient;
use crate::model::agent::v1 as agent;
use serde_json::{json, Value};
use tauri::AppHandle;
use ulid::Ulid;


use super::{BrowserError, SnapshotResult};

/// Station-facing context the executor needs to bind agent-created browser
/// sessions to the owning task/device/account. Cloned per worker registration.
pub(crate) struct AgentBrowserBridge {
    app: AppHandle,
    station: StationClient,
    token: String,
    device_id: String,
}

impl AgentBrowserBridge {
    pub(crate) fn new(
        app: AppHandle,
        station: StationClient,
        token: String,
        device_id: String,
    ) -> Self {
        Self { app, station, token, device_id }
    }

    /// Executes one dispatched browser capability. `tool_name` is the
    /// model-facing name (browser_navigate/snapshot/screenshot/click/fill/
    /// submit); `arguments` is the model tool input; conversation/turn come
    /// from the signed dispatch envelope.
    pub(crate) fn execute(
        &self,
        tool_name: &str,
        arguments: &Value,
        conversation_id: &str,
        turn_id: &str,
    ) -> Result<Value, String> {
        match tool_name {
            "browser_navigate" => self.navigate(arguments, conversation_id, turn_id),
            "browser_snapshot" => self.snapshot_existing(arguments),
            "browser_screenshot" => self.screenshot(arguments),
            "browser_click" => self.interact("click", arguments, conversation_id, turn_id),
            "browser_fill" => self.interact("fill", arguments, conversation_id, turn_id),
            "browser_submit" => self.interact("submit", arguments, conversation_id, turn_id),
            other => Err(format!("BROWSER_TOOL_UNSUPPORTED: {other}")),
        }
    }

    fn navigate(
        &self,
        arguments: &Value,
        conversation_id: &str,
        turn_id: &str,
    ) -> Result<Value, String> {
        let url = require_string(arguments, "url")?;
        let (session_id, tab_id, fresh) =
            self.resolve_tab(arguments, true)?;
        if fresh {
            self.register_station(&session_id, conversation_id, turn_id);
        }
        let meta = match block_on(super::navigate(
            self.app.clone(),
            &session_id,
            tab_id.clone(),
            url.to_string(),
        )) {
            Ok(meta) => meta,
            Err(error) => return business_or_exec_error(error),
        };
        self.report_tabs(&session_id, &meta);
        let snapshot = match block_on(super::snapshot(&session_id, tab_id)) {
            Ok(snapshot) => snapshot,
            Err(error) => return business_or_exec_error(error),
        };
        Ok(observation_json(&session_id, snapshot))
    }

    fn snapshot_existing(&self, arguments: &Value) -> Result<Value, String> {
        let (session_id, tab_id, _) = self.resolve_tab(arguments, false)?;
        let snapshot = match block_on(super::snapshot(&session_id, tab_id)) {
            Ok(snapshot) => snapshot,
            Err(error) => return business_or_exec_error(error),
        };
        Ok(observation_json(&session_id, snapshot))
    }

    fn screenshot(&self, arguments: &Value) -> Result<Value, String> {
        let (session_id, tab_id, _) = self.resolve_tab(arguments, false)?;
        let bytes = match block_on(super::screenshot(&session_id, tab_id.clone())) {
            Ok(bytes) => bytes,
            Err(error) => return business_or_exec_error(error),
        };
        Ok(json!({
            "captured": true,
            "mime": "image/png",
            "byte_size": bytes.len(),
            "session_id": session_id,
            "tab_id": tab_id.clone(),
        }))
    }

    fn interact(
        &self,
        action: &str,
        arguments: &Value,
        _conversation_id: &str,
        _turn_id: &str,
    ) -> Result<Value, String> {
        let element_ref = require_string(arguments, "element_ref")?;
        let snapshot_ref = require_string(arguments, "snapshot_ref")?;
        if !element_ref.starts_with(&format!("{snapshot_ref}-")) {
            return Ok(business_result(
                "BROWSER_SNAPSHOT_REF_STALE",
                "element_ref does not belong to snapshot_ref; re-snapshot and retry",
            ));
        }
        let (session_id, tab_id, _) = self.resolve_tab(arguments, false)?;
        let action_result = match action {
            "click" => block_on(super::click(
                self.app.clone(),
                &session_id,
                tab_id.clone(),
                element_ref.to_string(),
            )),
            "fill" => {
                let value = require_string(arguments, "value")?;
                block_on(super::fill(
                    self.app.clone(),
                    &session_id,
                    tab_id.clone(),
                    element_ref.to_string(),
                    value.to_string(),
                ))
            }
            "submit" => block_on(super::submit(
                self.app.clone(),
                &session_id,
                tab_id.clone(),
                element_ref.to_string(),
            )),
            other => return Err(format!("BROWSER_INTERACTION_UNSUPPORTED: {other}")),
        };
        let meta = match action_result {
            Ok(meta) => meta,
            Err(error) => return business_or_exec_error(error),
        };
        self.report_tabs(&session_id, &meta);
        // Every interaction invalidates the observation generation; return the
        // post-action observation so the model continues from current truth.
        let snapshot = match block_on(super::snapshot(&session_id, tab_id)) {
            Ok(snapshot) => snapshot,
            Err(error) => return business_or_exec_error(error),
        };
        Ok(observation_json(&session_id, snapshot))
    }

    /// Returns (session_id, tab_id, fresh). A missing session_id creates a new
    /// worker session only when `allow_create` (navigation); the initial tab is
    /// about:blank and the caller navigates it immediately.
    fn resolve_tab(
        &self,
        arguments: &Value,
        allow_create: bool,
    ) -> Result<(String, String, bool), String> {
        if let Some(session_id) = arguments
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
        {
            let tab_id = match arguments.get("tab_id").and_then(|v| v.as_str()) {
                Some(id) if !id.is_empty() => id.to_string(),
                _ => self.first_tab(session_id)?,
            };
            return Ok((session_id.to_string(), tab_id, false));
        }
        if !allow_create {
            return Err(
                "BROWSER_SESSION_REQUIRED: call browser_navigate to open the task browser first"
                    .to_string(),
            );
        }
        let session_id = format!("brows-{}", Ulid::new().to_string());
        let meta = block_on(super::create_session(self.app.clone(), session_id.clone()))
            .map_err(|error| format!("{}: {}", error.code, error.message))?;
        let tab_id = meta
            .tabs
            .first()
            .map(|tab| tab.tab_id.clone())
            .ok_or_else(|| "BROWSER_EXECUTION_FAILED: new session has no tab".to_string())?;
        Ok((session_id, tab_id, true))
    }

    fn first_tab(&self, session_id: &str) -> Result<String, String> {
        block_on(super::list_tabs(session_id))
            .map_err(|error| format!("{}: {}", error.code, error.message))?
            .into_iter()
            .next()
            .map(|tab| tab.tab_id)
            .ok_or_else(|| "BROWSER_TAB_REQUIRED: session has no open tab".to_string())
    }

    fn register_station(
        &self,
        session_id: &str,
        conversation_id: &str,
        turn_id: &str,
    ) {
        if conversation_id.trim().is_empty() {
            // Station truth binds to a task; without the envelope conversation
            // the worker session would be an unbound device resource, which is
            // exactly what the model-tool contract forbids.
            tracing::error!(
                session_id,
                "agent browser session: cannot register Station truth without conversation binding"
            );
            return;
        }
        let engine = super::host_engine();
        let result = agent_browser_session::create(
            &self.station,
            &self.token,
            &agent::CreateBrowserSessionRequest {
                session_id: session_id.to_string(),
                conversation_id: conversation_id.to_string(),
                turn_id: turn_id.to_string(),
                device_id: self.device_id.clone(),
                engine,
            },
        );
        if !result.ok {
            tracing::warn!(
                session_id,
                error = ?result.error,
                "agent browser session: Station truth registration failed"
            );
        }
    }

    fn report_tabs(&self, session_id: &str, _meta: &super::TabMeta) {
        let tabs = match block_on(super::list_tabs(session_id)) {
            Ok(tabs) => tabs,
            Err(error) => {
                tracing::warn!(session_id, error = %error.message, "agent browser session: tab list failed");
                return;
            }
        };
        let result = agent_browser_session::update(
            &self.station,
            &self.token,
            &agent::UpdateBrowserSessionRequest {
                session_id: session_id.to_string(),
                status: agent::BrowserSessionStatus::Active as i32,
                lease: agent::BrowserControlLease::Agent as i32,
                tabs: {
                    let mapped: Vec<agent::BrowserTab> = tabs
                        .into_iter()
                        .map(|tab| agent::BrowserTab {
                            tab_id: tab.tab_id,
                            generation: tab.generation,
                            url: tab.url,
                            title: tab.title,
                        })
                        .collect();
                    mapped
                },
            },
        );
        if !result.ok {
            tracing::warn!(
                session_id,
                error = ?result.error,
                "agent browser session: Station truth update failed"
            );
        }
    }
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn require_string<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arguments
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("BROWSER_INVALID_ARGUMENT: {key} is required"))
}

/// Recoverable page/lease outcomes stay bounded so the model adapts; host and
/// argument faults are executor errors.
fn business_or_exec_error(error: BrowserError) -> Result<Value, String> {
    match error.code {
        "BROWSER_HUMAN_TAKEOVER_HELD" | "BROWSER_SNAPSHOT_REF_STALE" => {
            Ok(business_result(error.code, &error.message))
        }
        _ => Err(format!("{}: {}", error.code, error.message)),
    }
}

fn business_result(code: &str, message: &str) -> Value {
    json!({
        "is_error": true,
        "error_code": code,
        "error": message,
    })
}

fn observation_json(session_id: &str, snapshot: SnapshotResult) -> Value {
    json!({
        "session_id": session_id,
        "tab_id": snapshot.tab.tab_id,
        "url": snapshot.tab.url,
        "title": snapshot.tab.title,
        "generation": snapshot.tab.generation,
        "snapshot_ref": format!("g{}", snapshot.tab.generation),
        "lease": snapshot.lease,
        "text": snapshot.text,
        "elements": snapshot.elements.iter().map(element_json).collect::<Vec<_>>(),
    })
}

fn element_json(element: &super::ElementInfo) -> Value {
    json!({
        "ref": element.ref_id,
        "tag": element.tag,
        "input_type": element.input_type,
        "role": element.role,
        "name": element.name,
    })
}
