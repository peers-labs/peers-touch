use std::sync::Arc;

use reqwest::Method;
use prost::Message;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{State, Window};

use crate::application::session_resolver;
use crate::application::station_runtime::client::{self as station_client, StationClient};
use crate::error::{AppResult, ErrorCode};
use crate::model::actor::ActorProfile;
use crate::model::federation::v1::{
    CreateFederationRequest, CreateFederationResponse, DeleteFederationRequest,
    DeleteFederationResponse, JoinFederationRequest, JoinFederationResponse,
    LeaveFederationRequest, LeaveFederationResponse, ListFederationsResponse,
    ListMemberStationsResponse,
};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct FederationFixtureCreateInput {
    name: String,
    description: String,
}

#[derive(Debug, Deserialize)]
pub struct FederationFixtureJoinInput {
    federation_endpoint: String,
    federation_id: String,
    message: String,
}

#[derive(Debug, Deserialize)]
pub struct FederationFixtureLeaveInput {
    federation_id: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
pub struct FederationFixtureDeleteInput {
    federation_id: String,
}

fn token_or_unauthorized(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Value>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn station_failure(error: station_client::StationClientError, context: &str) -> AppResult<Value> {
    error.into_app_result(context)
}

// This module is mounted only by acceptance-webdriver. The fixture owner uses
// the reviewed development Profile's Dashboard bootstrap credentials, never
// the window's Actor JWT. Overrides stay in the native process environment.
fn managed_fixture_request<Q: Message, R: Message + Default>(
    station_client: &StationClient,
    route: &str,
    request: &Q,
) -> Result<R, AppResult<Value>> {
    let username = std::env::var("PT_ACCEPTANCE_DASHBOARD_USERNAME")
        .unwrap_or_else(|_| "peers".to_string());
    let password = std::env::var("PT_ACCEPTANCE_DASHBOARD_PASSWORD")
        .unwrap_or_else(|_| "peers".to_string());
    let login = station_client
        .post_json_no_auth(
            "/dashboard/api/auth/login",
            json!({ "username": username, "password": password }),
        )
        .map_err(|error| station_failure(error, "Dashboard fixture authentication failed"))?;
    let token = login.get("token").and_then(Value::as_str).unwrap_or_default();
    if token.is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Dashboard fixture authentication required",
            None,
        ));
    }
    let result = station_client.request_proto::<Q, R>(
        Method::POST,
        route,
        token,
        None,
        Some(request),
    );
    // One bounded fixture action owns this separate administrator session.
    let logout = station_client.post_json_with_auth("/dashboard/api/auth/logout", token, json!({}));
    if result.is_ok() {
        logout.map_err(|error| station_failure(error, "Dashboard fixture session cleanup failed"))?;
    }
    result.map_err(|error| station_failure(error, "Dashboard Federation fixture mutation failed"))
}

pub(crate) fn fixture_snapshot(
    station_client: &StationClient,
    token: &str,
) -> Result<Value, station_client::StationClientError> {
    let profile = station_client.request_peers_proto_no_body::<ActorProfile>(
        Method::GET,
        "/actor/profile",
        token,
        None,
    )?;
    let federations = station_client.request_proto::<(), ListFederationsResponse>(
        Method::GET,
        "/sub-federation/federations",
        token,
        None,
        None::<&()>,
    )?;

    let mut projected = Vec::with_capacity(federations.federations.len());
    for federation in federations.federations {
        let federation_id = federation.federation_id.trim().to_string();
        let route = format!("/sub-federation/federations/{federation_id}/stations");
        let members = station_client.request_proto::<(), ListMemberStationsResponse>(
            Method::GET,
            &route,
            token,
            None,
            None::<&()>,
        )?;
        projected.push(json!({
            "federationId": federation_id,
            "name": federation.name,
            "status": federation.status,
            "policyType": federation.policy_type,
            "headSeq": federation.head_seq,
            "headHash": federation.head_hash,
            "sequencerStationPeerId": federation.sequencer_station_peer_id,
            "myRole": federation.my_role,
            "capability": federation.capability.map(|capability| json!({
                "canInvite": capability.can_invite,
                "canApproveJoin": capability.can_approve_join,
                "canUpdatePolicy": capability.can_update_policy,
                "canViewLedger": capability.can_view_ledger,
                "canRemoveStation": capability.can_remove_station,
                "canGrantAdmin": capability.can_grant_admin,
                "canLeave": capability.can_leave,
                "canArchive": capability.can_archive,
            })),
            "members": members.stations.into_iter().map(|station| json!({
                "stationPeerId": station.station_peer_id,
                "stationName": station.station_name,
                "stationUrl": station.station_url,
                "status": station.status,
            })).collect::<Vec<_>>(),
        }));
    }

    Ok(json!({
        "actorPtid": profile.r#ref.as_ref().map(|actor| actor.ptid.as_str()).unwrap_or_default(),
        "federatedHandle": profile.federated_handle,
        "homeStationPeerId": profile.home_station_peer_id,
        "homeStationDomain": profile.home_station_domain,
        "federations": projected,
    }))
}

pub(crate) fn snapshot_result(station_client: &StationClient, token: &str) -> AppResult<Value> {
    match fixture_snapshot(station_client, token) {
        Ok(snapshot) => AppResult::success(snapshot),
        Err(error) => station_failure(error, "acceptance Federation fixture snapshot failed"),
    }
}

pub(crate) fn create_fixture(
    station_client: &StationClient,
    input: FederationFixtureCreateInput,
) -> AppResult<Value> {
    let name = input.name.trim();
    if name.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "name is required", None);
    }
    let request = CreateFederationRequest {
        name: name.to_string(),
        description: input.description.trim().to_string(),
        policy_type: "single_admin".to_string(),
    };
    match managed_fixture_request::<CreateFederationRequest, CreateFederationResponse>(
        station_client,
        "/dashboard/api/federation/create",
        &request,
    ) {
        Ok(response) => AppResult::success(json!({
            "federationId": response.federation_id,
        })),
        Err(error) => error,
    }
}

pub(crate) fn join_fixture(
    station_client: &StationClient,
    input: FederationFixtureJoinInput,
) -> AppResult<Value> {
    if input.federation_id.trim().is_empty() || input.federation_endpoint.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "federation_id and federation_endpoint are required",
            None,
        );
    }
    let request = JoinFederationRequest {
        federation_endpoint: input.federation_endpoint.trim().to_string(),
        federation_id: input.federation_id.trim().to_string(),
        message: input.message,
    };
    match managed_fixture_request::<JoinFederationRequest, JoinFederationResponse>(
        station_client,
        "/dashboard/api/federation/join",
        &request,
    ) {
        Ok(response) => AppResult::success(json!({
            "status": response.status,
            "proposalId": response.proposal_id,
        })),
        Err(error) => error,
    }
}

pub(crate) fn leave_fixture(
    station_client: &StationClient,
    input: FederationFixtureLeaveInput,
) -> AppResult<Value> {
    let federation_id = input.federation_id.trim();
    if federation_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "federation_id is required",
            None,
        );
    }
    let request = LeaveFederationRequest {
        federation_id: federation_id.to_string(),
        reason: input.reason.trim().to_string(),
    };
    match managed_fixture_request::<LeaveFederationRequest, LeaveFederationResponse>(
        station_client,
        "/dashboard/api/federation/leave",
        &request,
    ) {
        Ok(response) => AppResult::success(json!({
            "federationId": federation_id,
            "success": response.success,
        })),
        Err(error) => error,
    }
}

pub(crate) fn delete_fixture(
    station_client: &StationClient,
    input: FederationFixtureDeleteInput,
) -> AppResult<Value> {
    let federation_id = input.federation_id.trim();
    if federation_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "federation_id is required",
            None,
        );
    }
    let request = DeleteFederationRequest {
        federation_id: federation_id.to_string(),
    };
    match managed_fixture_request::<DeleteFederationRequest, DeleteFederationResponse>(
        station_client,
        "/dashboard/api/federation/delete",
        &request,
    ) {
        Ok(response) => AppResult::success(json!({
            "federationId": federation_id,
            "success": response.success,
        })),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn acceptance_federation_fixture_snapshot(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    snapshot_result(state.station.client(), &token)
}

#[tauri::command]
pub fn acceptance_federation_fixture_create(
    state: State<'_, Arc<AppState>>,
    input: FederationFixtureCreateInput,
) -> AppResult<Value> {
    create_fixture(state.station.client(), input)
}

#[tauri::command]
pub fn acceptance_federation_fixture_join(
    state: State<'_, Arc<AppState>>,
    input: FederationFixtureJoinInput,
) -> AppResult<Value> {
    join_fixture(state.station.client(), input)
}

#[tauri::command]
pub fn acceptance_federation_fixture_leave(
    state: State<'_, Arc<AppState>>,
    input: FederationFixtureLeaveInput,
) -> AppResult<Value> {
    leave_fixture(state.station.client(), input)
}

#[tauri::command]
pub fn acceptance_federation_fixture_delete(
    state: State<'_, Arc<AppState>>,
    input: FederationFixtureDeleteInput,
) -> AppResult<Value> {
    delete_fixture(state.station.client(), input)
}
