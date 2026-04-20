use reqwest::Method;
use serde_json::{json, Value};

use super::state::{compute_scope_override, with_provider_store};
use crate::infrastructure::station_client;

pub(crate) fn push_provider_config(scope: Option<&str>, token: &str) -> Result<(), String> {
    let override_data = with_provider_store(scope, |store| compute_scope_override(store))
        .map_err(|_| "failed to access provider store".to_string())?;

    let body = json!({
        "providers": override_data.provider_overrides.iter().map(|p| p.to_json()).collect::<Vec<_>>(),
        "tombstones": override_data.tombstones,
        "revision": override_data.revision,
    });

    // TODO(ai_chat): No matching Station subserver route for `/ai-chat/provider/sync`; keep JSON until implemented.
    station_client::request_json(
        Method::POST,
        "/ai-chat/provider/sync",
        token,
        None,
        Some(body),
    )?;

    Ok(())
}

pub(crate) fn pull_provider_config(scope: Option<&str>, token: &str) -> Result<(), String> {
    // TODO(ai_chat): No matching Station handler for `/ai-chat/providers`; keep JSON until implemented.
    let remote = station_client::request_json(
        Method::GET,
        "/ai-chat/providers",
        token,
        Some(&[
            ("page_size", "500".to_string()),
            ("page_number", "1".to_string()),
        ]),
        None,
    )?;

    let has_local_override = with_provider_store(scope, |store| {
        let override_data = compute_scope_override(store);
        !override_data.provider_overrides.is_empty() || !override_data.tombstones.is_empty()
    })
    .map_err(|_| "failed to access provider store".to_string())?;

    if has_local_override {
        return Ok(());
    }

    if let Some(providers) = remote.get("providers").and_then(Value::as_array) {
        if providers.is_empty() {
            return Ok(());
        }
    }

    Ok(())
}
