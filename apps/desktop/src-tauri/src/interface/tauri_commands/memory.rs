use crate::error::AppResult;
use crate::contracts::{
    MemoryEventsInput, MemoryExportInput, MemoryIdInput, MemoryImportInput, MemoryListInput,
    MemoryPersonaInput, MemorySearchInput, StubPayload,
};

use crate::application::memory as application_memory;

#[tauri::command]
pub fn memory_list(input: MemoryListInput) -> AppResult<StubPayload> {
    application_memory::memory_list(input)
}

#[tauri::command]
pub fn memory_get(input: MemoryIdInput) -> AppResult<StubPayload> {
    application_memory::memory_get(input)
}

#[tauri::command]
pub fn memory_delete(input: MemoryIdInput) -> AppResult<StubPayload> {
    application_memory::memory_delete(input)
}

#[tauri::command]
pub fn memory_search(input: MemorySearchInput) -> AppResult<StubPayload> {
    application_memory::memory_search(input)
}

#[tauri::command]
pub fn memory_persona(input: MemoryPersonaInput) -> AppResult<StubPayload> {
    application_memory::memory_persona(input)
}

#[tauri::command]
pub fn memory_stats() -> AppResult<StubPayload> {
    application_memory::memory_stats()
}

#[tauri::command]
pub fn memory_events(input: MemoryEventsInput) -> AppResult<StubPayload> {
    application_memory::memory_events(input)
}

#[tauri::command]
pub fn memory_export(input: MemoryExportInput) -> AppResult<StubPayload> {
    application_memory::memory_export(input)
}

#[tauri::command]
pub fn memory_import(input: MemoryImportInput) -> AppResult<StubPayload> {
    application_memory::memory_import(input)
}
