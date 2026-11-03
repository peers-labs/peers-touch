// TW-D6 typed transport: Desktop browser session metadata to Station.
use crate::error::AppResult;
use crate::model::agent::v1 as agent;
use crate::application::station_runtime::client::StationClient;
use prost::Message;
use reqwest::Method;

fn post<Req: Message, Resp: Message + Default>(
    client: &StationClient,
    token: &str,
    path: &str,
    request: &Req,
) -> AppResult<Vec<u8>> {
    match client.request_proto::<Req, Resp>(Method::POST, path, token, None, Some(request)) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.browserSessionRequestFailed"),
    }
}

pub fn create(
    client: &StationClient,
    token: &str,
    request: &agent::CreateBrowserSessionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::CreateBrowserSessionResponse>(
        client,
        token,
        "/sub-agent/agent/browser-session/create",
        request,
    )
}

pub fn update(
    client: &StationClient,
    token: &str,
    request: &agent::UpdateBrowserSessionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::UpdateBrowserSessionResponse>(
        client,
        token,
        "/sub-agent/agent/browser-session/update",
        request,
    )
}

pub fn list(
    client: &StationClient,
    token: &str,
    request: &agent::ListBrowserSessionsRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ListBrowserSessionsResponse>(
        client,
        token,
        "/sub-agent/agent/browser-session/list",
        request,
    )
}

pub fn reconcile(
    client: &StationClient,
    token: &str,
    request: &agent::ReconcileBrowserSessionsRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ReconcileBrowserSessionsResponse>(
        client,
        token,
        "/sub-agent/agent/browser-session/reconcile",
        request,
    )
}

pub fn remove(
    client: &StationClient,
    token: &str,
    request: &agent::RemoveBrowserSessionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::RemoveBrowserSessionResponse>(
        client,
        token,
        "/sub-agent/agent/browser-session/remove",
        request,
    )
}
