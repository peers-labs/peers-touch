use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{State, Window};

use crate::application::key_exchange::{device_install, wire};
use crate::application::session_resolver;
use crate::contracts::{KeyExchangeFetchInput, KeyExchangeUploadInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::key_exchange as kemodel;
use crate::state::AppState;
use messaging_core::proto::{actor_device_ptid, actor_device_ref, actor_ref};
use reqwest::Method;
use ulid::Ulid;

fn token_from_state(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
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

fn actor_ptid_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> Option<String> {
    session_resolver::ptid_for_window(state.inner(), window)
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
    let actor_ptid = match actor_ptid_from_state(&state, &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            );
        }
    };
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let device_id = match device_install::get_or_create_device_id(actor_ptid.as_str()) {
        Ok(s) => s,
        Err(e) => {
            return AppResult::fail(ErrorCode::InternalError, format!("device_id: {e}"), None);
        }
    };
    station_client::set_device_id(device_id.clone());
    if input.opk_ids.len() != input.opk_pubs.len() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "opk_ids and opk_pubs must have the same length",
            None,
        );
    }
    let req = kemodel::UploadDirectKeyBundleRequest {
        device: Some(actor_device_ref(actor_ptid, device_id)),
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
    match station_client::request_proto::<
        kemodel::UploadDirectKeyBundleRequest,
        kemodel::UploadDirectKeyBundleResponse,
    >(
        Method::POST,
        "/key-exchange/keys/bundle",
        &token,
        None,
        Some(&req),
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
    let actor_ptid = match actor_ptid_from_state(&state, &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
        }
    };
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.ptid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "ptid is required", None);
    }
    let device_id = match device_install::get_or_create_device_id(&actor_ptid) {
        Ok(device_id) => device_id,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("device_id: {error}"),
                None,
            );
        }
    };
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
