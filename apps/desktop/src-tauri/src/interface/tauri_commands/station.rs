// Station registry tauri commands — dynamic URL picker for testnet/multi-node setups.

use serde::Deserialize;

use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::infrastructure::station_registry::StationEntry;

#[derive(Debug, Deserialize)]
pub struct StationUrlInput {
    pub url: String,
}

#[tauri::command]
pub fn station_list() -> AppResult<StubPayload> {
    let reg = station_client::station_registry();
    let entries = reg.list();
    let active = reg.active_url();
    let payload = serde_json::json!({
        "entries": entries,
        "active_url": active,
    });
    AppResult::success(StubPayload {
        command: "station_list".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_set_active(input: StationUrlInput) -> AppResult<StubPayload> {
    if input.url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
    }
    let reg = station_client::station_registry();
    reg.set_active(&input.url);
    let payload = serde_json::json!({ "active_url": input.url });
    AppResult::success(StubPayload {
        command: "station_set_active".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_add(input: StationUrlInput) -> AppResult<StubPayload> {
    if input.url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
    }
    let (online, label, peer_id, peers_count) =
        station_client::probe_station(&input.url);
    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string());
    let entry = StationEntry {
        url: input.url.trim_end_matches('/').to_string(),
        label,
        peer_id,
        peers_count,
        last_probe: Some(now),
        online,
    };
    let reg = station_client::station_registry();
    reg.add(entry.clone());
    AppResult::success(StubPayload {
        command: "station_add".to_string(),
        status: serde_json::to_string(&entry).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_remove(input: StationUrlInput) -> AppResult<StubPayload> {
    if input.url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
    }
    let reg = station_client::station_registry();
    reg.remove(&input.url);
    let payload = serde_json::json!({ "removed": input.url });
    AppResult::success(StubPayload {
        command: "station_remove".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_probe(input: StationUrlInput) -> AppResult<StubPayload> {
    if input.url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
    }
    let (online, label, peer_id, peers_count) =
        station_client::probe_station(&input.url);
    let reg = station_client::station_registry();
    reg.update_probe(&input.url, label.clone(), peer_id.clone(), peers_count, online);
    let payload = serde_json::json!({
        "url": input.url,
        "online": online,
        "label": label,
        "peer_id": peer_id,
        "peers_count": peers_count,
    });
    AppResult::success(StubPayload {
        command: "station_probe".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}
