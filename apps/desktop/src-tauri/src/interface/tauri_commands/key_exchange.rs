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
use reqwest::Method;

fn token_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> Result<String, AppResult<StubPayload>> {
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

fn actor_id_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> Option<String> {
    session_resolver::actor_id_for_window(state.inner(), window)
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
    let actor_id = match actor_id_from_state(&state, &window) {
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
    let device_id = match device_install::get_or_create_device_id(actor_id.as_str()) {
        Ok(s) => s,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("device_id: {e}"),
                None,
            );
        }
    };
    let req = kemodel::UploadKeyBundleRequest {
        ik_pub: input.ik_pub,
        spk_id: input.spk_id,
        spk_pub: input.spk_pub,
        spk_sig: input.spk_sig,
        opk_ids: input.opk_ids,
        opk_pubs: input.opk_pubs,
        device_id,
    };
    match station_client::request_proto::<kemodel::UploadKeyBundleRequest, kemodel::UploadKeyBundleResponse>(
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
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "did is required", None);
    }
    let req = kemodel::FetchKeyBundleRequest {
        did: input.did,
        device_id: input.device_id.unwrap_or_default(),
    };
    let r = match station_client::request_proto::<kemodel::FetchKeyBundleRequest, kemodel::FetchKeyBundleResponse>(
        Method::POST,
        "/key-exchange/keys/bundle/fetch",
        &token,
        None,
        Some(&req),
    ) {
        Ok(v) => v,
        Err(e) => return e.into_app_result("Station request failed"),
    };
    let bundles_json: Vec<Value> = r
        .bundles
        .iter()
        .map(|b| {
            json!({
                "did": b.did,
                "device_id": b.device_id,
                "ik_pub": b.ik_pub,
                "fingerprint": wire::identity_fingerprint_hex(&b.ik_pub),
                "spk_pub": b.spk_pub,
                "spk_sig": b.spk_sig,
                "opks": b.opks,
                "published_at_unix_ms": b.published_at_unix_ms,
            })
        })
        .collect();
    to_stub("key_exchange_fetch_bundle", json!({ "bundles": bundles_json }))
}
