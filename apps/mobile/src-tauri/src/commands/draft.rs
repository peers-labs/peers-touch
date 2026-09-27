use prost::Message;
use serde::Deserialize;
use tauri::State;

use crate::error::{MobileError, MobileResult};
use crate::runtime::draft_store::DraftKey;
use crate::runtime::reliability::ReliabilityRuntime;
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    MobileDraftEnvelopeV2, MobileDraftSurfaceKind,
};

use super::ledger::map_reliability_error;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaveInput {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub envelope_bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftKeyInput {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub surface_kind: i32,
    pub target_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftListInput {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub surface_kind: Option<i32>,
}

#[tauri::command]
pub fn draft_save(
    runtime: State<'_, ReliabilityRuntime>,
    input: DraftSaveInput,
) -> MobileResult<()> {
    let envelope = MobileDraftEnvelopeV2::decode(input.envelope_bytes.as_slice())
        .map_err(|error| MobileError::draft(format!("decode generated draft envelope: {error}")))?;
    if envelope.encode_to_vec() != input.envelope_bytes {
        return Err(MobileError::draft(
            "generated draft envelope bytes are not canonical",
        ));
    }
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    active.save_draft(&envelope).map_err(map_reliability_error)
}

#[tauri::command]
pub fn draft_load(
    runtime: State<'_, ReliabilityRuntime>,
    input: DraftKeyInput,
) -> MobileResult<Option<Vec<u8>>> {
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    let key = DraftKey::new(
        active.scope.clone(),
        parse_surface(input.surface_kind)?,
        input.target_id,
    )
    .map_err(map_reliability_error)?;
    active
        .drafts
        .load(&key)
        .map(|draft| draft.map(|draft| draft.encode_to_vec()))
        .map_err(map_reliability_error)
}

#[tauri::command]
pub fn draft_remove(
    runtime: State<'_, ReliabilityRuntime>,
    input: DraftKeyInput,
) -> MobileResult<bool> {
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    let key = DraftKey::new(
        active.scope.clone(),
        parse_surface(input.surface_kind)?,
        input.target_id,
    )
    .map_err(map_reliability_error)?;
    active.drafts.remove(&key).map_err(map_reliability_error)
}

#[tauri::command]
pub fn draft_list(
    runtime: State<'_, ReliabilityRuntime>,
    input: DraftListInput,
) -> MobileResult<Vec<Vec<u8>>> {
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    let surface = input.surface_kind.map(parse_surface).transpose()?;
    active
        .drafts
        .list(surface)
        .map(|drafts| {
            drafts
                .into_iter()
                .map(|draft| draft.encode_to_vec())
                .collect()
        })
        .map_err(map_reliability_error)
}

fn parse_surface(value: i32) -> MobileResult<MobileDraftSurfaceKind> {
    let surface = MobileDraftSurfaceKind::try_from(value)
        .map_err(|_| MobileError::invalid_input("unknown generated draft surface"))?;
    if surface == MobileDraftSurfaceKind::Unspecified {
        return Err(MobileError::invalid_input("draft surface must be explicit"));
    }
    Ok(surface)
}
