use crate::contracts::{
    NotebookCreateInput, NotebookIdInput, NotebookUpdateInput, StubPayload, TopicIdInput,
};
use crate::error::AppResult;

use crate::application::notebook as application_notebook;

#[tauri::command]
pub fn notebook_list_documents(input: TopicIdInput) -> AppResult<StubPayload> {
    application_notebook::notebook_list_documents(input)
}

#[tauri::command]
pub fn notebook_get_document(input: NotebookIdInput) -> AppResult<StubPayload> {
    application_notebook::notebook_get_document(input)
}

#[tauri::command]
pub fn notebook_create_document(input: NotebookCreateInput) -> AppResult<StubPayload> {
    application_notebook::notebook_create_document(input)
}

#[tauri::command]
pub fn notebook_update_document(input: NotebookUpdateInput) -> AppResult<StubPayload> {
    application_notebook::notebook_update_document(input)
}

#[tauri::command]
pub fn notebook_delete_document(input: NotebookIdInput) -> AppResult<StubPayload> {
    application_notebook::notebook_delete_document(input)
}

#[tauri::command]
pub fn notebook_list_all_documents() -> AppResult<StubPayload> {
    application_notebook::notebook_list_all_documents()
}
