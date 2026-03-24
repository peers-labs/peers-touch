use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    NotebookCreateInput, NotebookIdInput, NotebookUpdateInput, StubPayload, TopicIdInput,
};
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

pub fn notebook_list_documents(input: TopicIdInput) -> AppResult<StubPayload> {
    if input.topic_id.trim().is_empty() {
        return invalid_argument("topic_id is required");
    }
    success_payload("notebook_list_documents", json!({ "documents": [] }))
}

pub fn notebook_get_document(input: NotebookIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "notebook_get_document",
        json!({
            "id": input.id,
            "topic_id":"default",
            "title":"Untitled",
            "content":"",
            "type":"note"
        }),
    )
}

pub fn notebook_create_document(input: NotebookCreateInput) -> AppResult<StubPayload> {
    if input.topic_id.trim().is_empty() {
        return invalid_argument("topic_id is required");
    }
    success_payload(
        "notebook_create_document",
        json!({
            "id":"doc-1",
            "topic_id":input.topic_id,
            "title":input.title,
            "content":input.content,
            "type":input.r#type.unwrap_or_else(|| "note".to_string())
        }),
    )
}

pub fn notebook_update_document(input: NotebookUpdateInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("notebook_update_document", json!({ "ok": true }))
}

pub fn notebook_delete_document(input: NotebookIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("notebook_delete_document", json!({ "ok": true }))
}

pub fn notebook_list_all_documents() -> AppResult<StubPayload> {
    success_payload("notebook_list_all_documents", json!({ "documents": [] }))
}
