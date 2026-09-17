use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{State, Window};

use crate::application::key_exchange::wire;
use crate::contracts::{KeyExchangeFetchInput, KeyExchangeUploadInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::key_exchange as kemodel;
use crate::state::AppState;
use messaging_core::proto::{actor_device_ptid, actor_device_ref, actor_ref};
use reqwest::Method;
use ulid::Ulid;

pub(crate) struct ActiveKeyExchangeContext {
    pub(crate) token: String,
    pub(crate) actor_ptid: String,
    pub(crate) device_id: String,
}

pub(crate) fn active_key_exchange_context_for_account<T: Serialize>(
    state: &AppState,
    account_id: &str,
    actor_ptid: &str,
    token: &str,
) -> Result<ActiveKeyExchangeContext, AppResult<T>> {
    if token.trim().is_empty() || actor_ptid.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authenticated profile is incomplete",
            None,
        ));
    }
    let engine = state
        .messaging_engines
        .get(account_id)
        .map_err(|error| AppResult::fail(ErrorCode::InternalError, error, None))?
        .ok_or_else(|| {
            AppResult::fail(
                ErrorCode::InternalError,
                "messaging profile engine is not active",
                None,
            )
        })?;
    if engine.endpoint().ptid != actor_ptid {
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            "messaging endpoint actor does not match authenticated actor",
            None,
        ));
    }
    Ok(ActiveKeyExchangeContext {
        token: token.to_string(),
        actor_ptid: engine.endpoint().ptid.clone(),
        device_id: engine.endpoint().device_id.clone(),
    })
}

pub(crate) fn active_key_exchange_context<T: Serialize>(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<ActiveKeyExchangeContext, AppResult<T>> {
    let session = state
        .sessions
        .get(window.label())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    active_key_exchange_context_for_account(
        state.inner(),
        &session.account_id,
        &session.actor.ptid,
        &session.jwt,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPackageUploadInput {
    pub device_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPackageFetchInput {
    pub ptid: String,
    pub home_station_peer_id: Option<String>,
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

#[tauri::command]
pub fn key_exchange_upload_bundle(
    input: KeyExchangeUploadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let context = match active_key_exchange_context(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
    let ActiveKeyExchangeContext {
        token,
        actor_ptid,
        device_id,
    } = context;
    if device_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InternalError,
            "messaging profile device is not active",
            None,
        );
    }
    if input.opk_ids.len() != input.opk_pubs.len() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "opk_ids and opk_pubs must have the same length",
            None,
        );
    }
    let req = kemodel::UploadDirectKeyBundleRequest {
        device: Some(actor_device_ref(actor_ptid, device_id.clone())),
        identity_key_public: input.ik_pub,
        signed_pre_key_id: input.spk_id,
        signed_pre_key_public: input.spk_pub,
        signed_pre_key_signature: input.spk_sig,
        one_time_pre_keys: input
            .opk_ids
            .into_iter()
            .zip(input.opk_pubs)
            .map(|(key_id, public_key)| kemodel::DirectOneTimePreKey { key_id, public_key })
            .collect(),
        supported_wire_versions: vec![1],
    };
    match station_client::request_proto_for_device::<
        kemodel::UploadDirectKeyBundleRequest,
        kemodel::UploadDirectKeyBundleResponse,
    >(
        Method::POST,
        "/key-exchange/keys/bundle",
        &token,
        None,
        Some(&req),
        &device_id,
    ) {
        Ok(_r) => to_stub("key_exchange_upload_bundle", json!({})),
        Err(e) => e.into_app_result("Station request failed"),
    }
}

#[tauri::command]
pub fn key_exchange_fetch_bundle(
    input: KeyExchangeFetchInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let context = match active_key_exchange_context(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
    let ActiveKeyExchangeContext {
        token,
        actor_ptid,
        device_id,
    } = context;
    if input.ptid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "ptid is required", None);
    }
    let req = kemodel::FetchDirectKeyBundlesRequest {
        actor: Some(actor_ref(input.ptid)),
        target_device_id: input.device_id.unwrap_or_default(),
        home_station_peer_id: input.home_station_peer_id.unwrap_or_default(),
        request_id: Ulid::new().to_string(),
        requester: Some(actor_device_ref(actor_ptid, device_id.clone())),
    };
    let r = match station_client::request_proto_for_device::<
        kemodel::FetchDirectKeyBundlesRequest,
        kemodel::FetchDirectKeyBundlesResponse,
    >(
        Method::POST,
        "/key-exchange/keys/bundle/fetch",
        &token,
        None,
        Some(&req),
        &device_id,
    ) {
        Ok(v) => v,
        Err(e) => return e.into_app_result("Station request failed"),
    };
    let mut bundles_json = Vec::with_capacity(r.bundles.len());
    for bundle in &r.bundles {
        let device = match bundle.device.as_ref() {
            Some(device) => device,
            None => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "Station returned a key bundle without a device",
                    None,
                );
            }
        };
        let ptid = match actor_device_ptid(device) {
            Ok(ptid) => ptid,
            Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
        };
        bundles_json.push(json!({
            "ptid": ptid,
            "device_id": device.device_id,
            "ik_pub": bundle.identity_key_public,
            "fingerprint": wire::identity_fingerprint_hex(&bundle.identity_key_public),
            "spk_id": bundle.signed_pre_key_id,
            "spk_pub": bundle.signed_pre_key_public,
            "spk_sig": bundle.signed_pre_key_signature,
            "opks": bundle.one_time_pre_keys.iter().map(|key| key.public_key.clone()).collect::<Vec<_>>(),
            "opk_ids": bundle.one_time_pre_keys.iter().map(|key| key.key_id).collect::<Vec<_>>(),
            "published_at_unix_ms": bundle.published_at_unix_ms,
            "supported_versions": bundle.supported_wire_versions,
        }));
    }
    to_stub(
        "key_exchange_fetch_bundle",
        json!({ "bundles": bundles_json }),
    )
}

#[tauri::command]
pub fn keypackage_upload(
    input: KeyPackageUploadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let context = match active_key_exchange_context::<Value>(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
    execute_keypackage_upload(context, input)
}

pub(crate) fn execute_keypackage_upload(
    context: ActiveKeyExchangeContext,
    input: KeyPackageUploadInput,
) -> AppResult<Value> {
    if input.device_id != context.device_id {
        return AppResult::fail(
            ErrorCode::Forbidden,
            "MLS KeyPackage device does not match the active Messaging endpoint",
            None,
        );
    }
    let key_package = match B64.decode(input.data.as_bytes()) {
        Ok(value) => value,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid MLS KeyPackage encoding: {error}"),
                None,
            );
        }
    };
    let request = kemodel::UploadMlsKeyPackageRequest {
        device: Some(actor_device_ref(
            context.actor_ptid,
            context.device_id.clone(),
        )),
        key_package,
    };
    match station_client::request_proto_for_device::<
        kemodel::UploadMlsKeyPackageRequest,
        kemodel::UploadMlsKeyPackageResponse,
    >(
        Method::POST,
        "/key-exchange/mls/key-package/upload",
        &context.token,
        None,
        Some(&request),
        &context.device_id,
    ) {
        Ok(response) => AppResult::success(json!({
            "package_id": response.package_id,
            "key_package_sha256": B64.encode(response.key_package_sha256),
        })),
        Err(error) => error.into_app_result("MLS KeyPackage upload failed"),
    }
}

#[tauri::command]
pub fn keypackage_fetch(
    input: KeyPackageFetchInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let context = match active_key_exchange_context::<Value>(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
    execute_keypackage_fetch(context, input)
}

pub(crate) fn execute_keypackage_fetch(
    context: ActiveKeyExchangeContext,
    input: KeyPackageFetchInput,
) -> AppResult<Value> {
    if input.ptid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "peer PTID is required", None);
    }
    let request = kemodel::FetchMlsKeyPackageRequest {
        actor: Some(actor_ref(input.ptid)),
        home_station_peer_id: input.home_station_peer_id.unwrap_or_default(),
        request_id: Ulid::new().to_string(),
        requester: Some(actor_device_ref(
            context.actor_ptid,
            context.device_id.clone(),
        )),
    };
    let response = match station_client::request_proto_for_device::<
        kemodel::FetchMlsKeyPackageRequest,
        kemodel::FetchMlsKeyPackageResponse,
    >(
        Method::POST,
        "/key-exchange/mls/key-package/fetch",
        &context.token,
        None,
        Some(&request),
        &context.device_id,
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("MLS KeyPackage fetch failed"),
    };
    let reservation = match response.reservation {
        Some(reservation) => Some(reservation),
        None if response.available => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Station returned an available MLS KeyPackage without a reservation",
                None,
            );
        }
        None => None,
    };
    AppResult::success(json!({
        "available": response.available,
        "device_id": reservation
            .as_ref()
            .and_then(|item| item.target.as_ref())
            .map(|target| target.device_id.as_str())
            .unwrap_or(""),
        "data": reservation
            .as_ref()
            .map(|item| B64.encode(&item.key_package)),
        "home_station_peer_id": response.home_station_peer_id,
    }))
}

#[tauri::command]
pub fn keypackage_count(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Value> {
    let context = match active_key_exchange_context::<Value>(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
    execute_keypackage_count(context)
}

pub(crate) fn execute_keypackage_count(context: ActiveKeyExchangeContext) -> AppResult<Value> {
    let request = kemodel::CountMlsKeyPackagesRequest {
        device: Some(actor_device_ref(
            context.actor_ptid,
            context.device_id.clone(),
        )),
    };
    match station_client::request_proto_for_device::<
        kemodel::CountMlsKeyPackagesRequest,
        kemodel::CountMlsKeyPackagesResponse,
    >(
        Method::GET,
        "/key-exchange/mls/key-package/count",
        &context.token,
        None,
        Some(&request),
        &context.device_id,
    ) {
        Ok(response) => AppResult::success(json!({ "count": response.count })),
        Err(error) => error.into_app_result("MLS KeyPackage count failed"),
    }
}
