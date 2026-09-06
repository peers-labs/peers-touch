// Tauri commands for the encrypted draft store.
//
// These commands are the IPC bridge between the TypeScript layer
// and the Rust `DraftStore`.

use serde::Deserialize;
use tauri::State;

use crate::error::{MobileError, MobileResult};
use crate::runtime::draft_store::types::{DraftKind, DraftProjection};
use crate::runtime::draft_store::DraftStore;

/// Input for `draft_store_initialize`.
#[derive(Debug, Deserialize)]
pub struct DraftStoreInitInput {
    pub db_dir: String,
    pub encryption_secret_b64: String,
}

/// Input for `draft_save`.
#[derive(Debug, Deserialize)]
pub struct DraftSaveInput {
    pub kind: String,
    pub domain_key: String,
    pub payload_json: String,
}

/// Input for `draft_load`.
#[derive(Debug, Deserialize)]
pub struct DraftLoadInput {
    pub kind: String,
    pub domain_key: String,
}

/// Input for `draft_remove`.
#[derive(Debug, Deserialize)]
pub struct DraftRemoveInput {
    pub kind: String,
    pub domain_key: String,
}

/// Input for `draft_list`.
#[derive(Debug, Deserialize)]
pub struct DraftListInput {
    pub kind: String,
}

use base64::Engine;

#[tauri::command]
pub async fn draft_store_initialize(
    input: DraftStoreInitInput,
    store: State<'_, DraftStore>,
) -> MobileResult<()> {
    let secret = base64::engine::general_purpose::STANDARD
        .decode(&input.encryption_secret_b64)
        .map_err(|e| MobileError::draft(format!("invalid base64 secret: {e}")))?;

    let db_dir = std::path::PathBuf::from(&input.db_dir);

    store.initialize(&db_dir, &secret)
}

#[tauri::command]
pub async fn draft_save(input: DraftSaveInput, store: State<'_, DraftStore>) -> MobileResult<()> {
    let kind = parse_draft_kind(&input.kind)?;
    store.save(kind, &input.domain_key, &input.payload_json)
}

#[tauri::command]
pub async fn draft_load(
    input: DraftLoadInput,
    store: State<'_, DraftStore>,
) -> MobileResult<Option<DraftProjection>> {
    let kind = parse_draft_kind(&input.kind)?;
    store.load(kind, &input.domain_key)
}

#[tauri::command]
pub async fn draft_remove(
    input: DraftRemoveInput,
    store: State<'_, DraftStore>,
) -> MobileResult<()> {
    let kind = parse_draft_kind(&input.kind)?;
    store.remove(kind, &input.domain_key)
}

#[tauri::command]
pub async fn draft_list(
    input: DraftListInput,
    store: State<'_, DraftStore>,
) -> MobileResult<Vec<DraftProjection>> {
    let kind = parse_draft_kind(&input.kind)?;
    store.list_by_kind(kind)
}

#[tauri::command]
pub async fn draft_store_shutdown(store: State<'_, DraftStore>) -> MobileResult<()> {
    store.shutdown()
}

fn parse_draft_kind(value: &str) -> MobileResult<DraftKind> {
    DraftKind::from_str(value)
        .ok_or_else(|| MobileError::invalid_input(format!("unknown draft kind: {value}")))
}
