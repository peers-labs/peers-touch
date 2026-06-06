use crate::contracts::{
    MemoryEventsInput, MemoryExportInput, MemoryFeedbackInput, MemoryIdInput, MemoryImportInput,
    MemoryListInput, MemoryPersonaInput, MemorySearchInput, StubPayload,
};
use crate::error::AppResult;
use crate::state::AppState;

use crate::application::memory as application_memory;

fn token_from_state(state: &tauri::State<AppState>) -> Result<String, AppResult<StubPayload>> {
    match state.session.lock() {
        Ok(guard) => Ok(guard.token.clone().unwrap_or_default()),
        Err(_) => Err(AppResult::fail(
            crate::error::ErrorCode::InternalError,
            "failed to access session state",
            None,
        )),
    }
}

#[tauri::command]
pub fn memory_list(
    state: tauri::State<AppState>,
    input: MemoryListInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_list(input, &token)
}

#[tauri::command]
pub fn memory_get(state: tauri::State<AppState>, input: MemoryIdInput) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_get(input, &token)
}

#[tauri::command]
pub fn memory_delete(
    state: tauri::State<AppState>,
    input: MemoryIdInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_delete(input, &token)
}

#[tauri::command]
pub fn memory_feedback(
    state: tauri::State<AppState>,
    input: MemoryFeedbackInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_feedback(input, &token)
}

#[tauri::command]
pub fn memory_search(
    state: tauri::State<AppState>,
    input: MemorySearchInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_search(input, &token)
}

#[tauri::command]
pub fn memory_persona(
    state: tauri::State<AppState>,
    input: MemoryPersonaInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_persona(input, &token)
}

#[tauri::command]
pub fn memory_stats(state: tauri::State<AppState>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_stats(&token)
}

#[tauri::command]
pub fn memory_events(
    state: tauri::State<AppState>,
    input: MemoryEventsInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_events(input, &token)
}

#[tauri::command]
pub fn memory_export(
    state: tauri::State<AppState>,
    input: MemoryExportInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_export(input, &token)
}

#[tauri::command]
pub fn memory_import(
    state: tauri::State<AppState>,
    input: MemoryImportInput,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_import(input, &token)
}

#[tauri::command]
pub fn memory_embedding_status(state: tauri::State<AppState>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_embedding_status(&token)
}

#[tauri::command]
pub fn memory_reembed(state: tauri::State<AppState>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(err) => return err,
    };
    application_memory::memory_reembed(&token)
}
