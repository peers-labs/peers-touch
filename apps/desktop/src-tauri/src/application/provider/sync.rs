use reqwest::blocking::Client;
use serde_json::json;

use super::state::{compute_scope_override, with_provider_store};
use crate::infrastructure::station_client;
use crate::model::ai_chat;

pub(crate) fn push_provider_config(scope: Option<&str>, token: &str) -> Result<(), String> {
    let override_data = with_provider_store(scope, |store| compute_scope_override(store))
        .map_err(|_| "failed to access provider store".to_string())?;

    let body = json!({
        "providers": override_data.provider_overrides.iter().map(|p| p.to_json()).collect::<Vec<serde_json::Value>>(),
        "tombstones": override_data.tombstones,
        "revision": override_data.revision,
    });

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("create http client failed: {}", e))?;

    let resp = client
        .post(format!("{}/ai-chat/provider/sync", station_client::station_base_url()))
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|e| format!("request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("station returned {}", resp.status()));
    }

    Ok(())
}

pub(crate) fn pull_provider_config(scope: Option<&str>, token: &str) -> Result<(), String> {
    let req = ai_chat::ListProvidersRequest {
        page_number: 1,
        page_size: 500,
        enabled_only: false,
    };
    let resp: ai_chat::ListProvidersResponse =
        station_client::request_proto(reqwest::Method::GET, "/ai-chat/providers", token, None, Some(&req))?;

    let has_local_override = with_provider_store(scope, |store| {
        let override_data = compute_scope_override(store);
        !override_data.provider_overrides.is_empty() || !override_data.tombstones.is_empty()
    })
    .map_err(|_| "failed to access provider store".to_string())?;

    if has_local_override {
        return Ok(());
    }

    if resp.providers.is_empty() {
        return Ok(());
    }

    Ok(())
}
