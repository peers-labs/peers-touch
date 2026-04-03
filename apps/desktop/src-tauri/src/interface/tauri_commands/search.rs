use crate::error::AppResult;
use crate::contracts::{AiSearchInput, SearchQueryInput, StubPayload};

use crate::application::search as application_search;

#[tauri::command]
pub fn help_get() -> AppResult<StubPayload> {
    application_search::help_get()
}

#[tauri::command]
pub fn search_sources() -> AppResult<StubPayload> {
    application_search::search_sources()
}

#[tauri::command]
pub fn search_query(input: SearchQueryInput) -> AppResult<StubPayload> {
    application_search::search_query(input)
}

#[tauri::command]
pub fn search_ai(input: AiSearchInput) -> AppResult<StubPayload> {
    application_search::search_ai(input)
}
