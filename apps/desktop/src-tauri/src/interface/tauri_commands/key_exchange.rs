use std::sync::Arc;

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

fn active_key_exchange_context(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String, String), AppResult<StubPayload>> {
    let session = state
        .sessions
        .get(window.label())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    if session.jwt.trim().is_empty() || session.actor.ptid.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authenticated profile is incomplete",
            None,
        ));
    }
    let engine = state
        .messaging_engines
        .get(&session.account_id)
        .map_err(|error| AppResult::fail(ErrorCode::InternalError, error, None))?
        .ok_or_else(|| {
            AppResult::fail(
                ErrorCode::InternalError,
                "messaging profile engine is not active",
                None,
            )
        })?;
    if engine.endpoint().ptid != session.actor.ptid {
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            "messaging endpoint actor does not match authenticated actor",
            None,
        ));
    }
    Ok((
        session.jwt,
        engine.endpoint().ptid.clone(),
        engine.endpoint().device_id.clone(),
    ))
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
    let (token, actor_ptid, device_id) = match active_key_exchange_context(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
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
    let (token, actor_ptid, device_id) = match active_key_exchange_context(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
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
