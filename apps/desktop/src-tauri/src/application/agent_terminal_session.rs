// TW-D5 terminal session metadata transport: typed proto passthrough to
// Station `/agent/terminal-session/*` routes. The worker owns the process;
// these calls only persist metadata and authorization bindings.
use crate::application::station_runtime::client::StationClient;
use crate::error::AppResult;
use crate::model::agent::v1 as agent;
use prost::Message;
use reqwest::Method;

fn post<Req, Resp>(
    client: &StationClient,
    path: &str,
    token: &str,
    request: &Req,
) -> AppResult<Vec<u8>>
where
    Req: Message,
    Resp: Message + Default,
{
    match client.request_proto::<Req, Resp>(Method::POST, path, token, None, Some(request)) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.terminalSessionRequestFailed"),
    }
}

pub fn create(
    client: &StationClient,
    token: &str,
    request: &agent::CreateTerminalSessionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::CreateTerminalSessionResponse>(
        client,
        "/sub-agent/agent/terminal-session/create",
        token,
        request,
    )
}

pub fn update(
    client: &StationClient,
    token: &str,
    request: &agent::UpdateTerminalSessionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::UpdateTerminalSessionResponse>(
        client,
        "/sub-agent/agent/terminal-session/update",
        token,
        request,
    )
}

pub fn list(
    client: &StationClient,
    token: &str,
    request: &agent::ListTerminalSessionsRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ListTerminalSessionsResponse>(
        client,
        "/sub-agent/agent/terminal-session/list",
        token,
        request,
    )
}

pub fn reconcile(
    client: &StationClient,
    token: &str,
    request: &agent::ReconcileTerminalSessionsRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ReconcileTerminalSessionsResponse>(
        client,
        "/sub-agent/agent/terminal-session/reconcile",
        token,
        request,
    )
}

pub fn remove(
    client: &StationClient,
    token: &str,
    request: &agent::RemoveTerminalSessionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::RemoveTerminalSessionResponse>(
        client,
        "/sub-agent/agent/terminal-session/remove",
        token,
        request,
    )
}

// ── WE-S6 WORKSPACE_SANDBOX PTY proxy ──────────────────────────────────────

pub fn sandbox_pty_write(
    client: &StationClient,
    token: &str,
    request: &agent::SandboxPtyWriteRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::SandboxPtyWriteResponse>(
        client,
        "/sub-agent/agent/sandbox-pty/write",
        token,
        request,
    )
}

pub fn sandbox_pty_read(
    client: &StationClient,
    token: &str,
    request: &agent::SandboxPtyReadRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::SandboxPtyReadResponse>(
        client,
        "/sub-agent/agent/sandbox-pty/read",
        token,
        request,
    )
}

pub fn sandbox_pty_resize(
    client: &StationClient,
    token: &str,
    request: &agent::SandboxPtyResizeRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::SandboxPtyResizeResponse>(
        client,
        "/sub-agent/agent/sandbox-pty/resize",
        token,
        request,
    )
}

pub fn sandbox_pty_signal(
    client: &StationClient,
    token: &str,
    request: &agent::SandboxPtySignalRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::SandboxPtySignalResponse>(
        client,
        "/sub-agent/agent/sandbox-pty/signal",
        token,
        request,
    )
}
