use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    MemoryEventsInput, MemoryExportInput, MemoryIdInput, MemoryImportInput, MemoryListInput, MemoryPersonaInput,
    MemorySearchInput, StubPayload,
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

pub fn memory_list(input: MemoryListInput) -> AppResult<StubPayload> {
    let _ = input.params;
    success_payload("memory_list", json!({ "memories": [], "total": 0 }))
}

pub fn memory_get(input: MemoryIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "memory_get",
        json!({
            "id":input.id,
            "layer":"episodic",
            "content":"stub memory",
            "created_at":"2026-03-24T00:00:00.000Z"
        }),
    )
}

pub fn memory_delete(input: MemoryIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("memory_delete", json!({ "ok": true }))
}

pub fn memory_search(input: MemorySearchInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return invalid_argument("query is required");
    }
    success_payload("memory_search", json!({ "results": [] }))
}

pub fn memory_persona(input: MemoryPersonaInput) -> AppResult<StubPayload> {
    let _ = input.agent_id;
    success_payload("memory_persona", json!({ "persona": null }))
}

pub fn memory_stats() -> AppResult<StubPayload> {
    success_payload(
        "memory_stats",
        json!({
            "total":0,
            "layers":{"episodic":0,"semantic":0,"procedural":0}
        }),
    )
}

pub fn memory_events(input: MemoryEventsInput) -> AppResult<StubPayload> {
    let _ = input.params;
    success_payload("memory_events", json!({ "events": [] }))
}

pub fn memory_export(input: MemoryExportInput) -> AppResult<StubPayload> {
    let _ = input.params;
    success_payload("memory_export", json!({ "version":"1.0.0", "items":[] }))
}

pub fn memory_import(input: MemoryImportInput) -> AppResult<StubPayload> {
    let _ = input.data;
    let _ = input.skip_duplicates;
    success_payload(
        "memory_import",
        json!({
            "imported":0,
            "skipped":0,
            "errors":[]
        }),
    )
}

pub fn memory_embedding_status() -> AppResult<StubPayload> {
    success_payload(
        "memory_embedding_status",
        json!({
            "provider":"none",
            "model":"none",
            "dimensions":0,
            "vector_count":0
        }),
    )
}

pub fn memory_reembed() -> AppResult<StubPayload> {
    success_payload("memory_reembed", json!({ "ok": true, "reembedded_count": 0 }))
}
