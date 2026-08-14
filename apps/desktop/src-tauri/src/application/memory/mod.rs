use crate::contracts::{
    MemoryEventsInput, MemoryExportInput, MemoryIdInput, MemoryImportInput, MemoryListInput,
    MemoryPersonaInput, MemorySearchInput, MemoryUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;
use prost_types::Timestamp;
use reqwest::Method;
use serde_json::{json, Value};

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn station_error(command: &str, err: station_client::StationClientError) -> AppResult<StubPayload> {
    err.into_app_result::<StubPayload>(format!("{command} station request failed"))
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn timestamp_to_iso(ts: &Option<Timestamp>) -> Option<String> {
    ts.as_ref()
        .and_then(|t| {
            time::OffsetDateTime::from_unix_timestamp(t.seconds)
                .ok()
                .and_then(|dt| dt.replace_nanosecond(t.nanos.max(0) as u32).ok())
        })
        .map(|dt| {
            dt.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| dt.unix_timestamp().to_string())
        })
}

fn memory_content_json(content: &str) -> Value {
    serde_json::from_str(content).unwrap_or_else(|_| json!({ "text": content }))
}

fn memory_layer_to_str(layer: i32) -> &'static str {
    match layer {
        1 => "identity",
        2 => "preference",
        3 => "context",
        4 => "experience",
        5 => "activity",
        _ => "preference",
    }
}

fn str_to_memory_layer(s: &str) -> i32 {
    match s {
        "identity" => 1,
        "preference" => 2,
        "context" => 3,
        "experience" => 4,
        "activity" => 5,
        _ => 0,
    }
}

fn memory_item_json(item: &agent::MemoryItem) -> Value {
    json!({
        "id": item.memory_id,
        "memory_id": item.memory_id,
        "agent_id": item.agent_id,
        "target": item.target,
        "layer": memory_layer_to_str(item.layer),
        "session_id": item.session_id,
        "source": if item.source.is_empty() { "turn" } else { item.source.as_str() },
        "content": memory_content_json(&item.content),
        "summary": item.summary,
        "relevance": item.relevance,
        "access_count": item.access_count,
        "last_accessed_at": timestamp_to_iso(&item.last_accessed_at),
        "trust_score": item.trust_score,
        "helpful_count": item.helpful_count,
        "harmful_count": item.harmful_count,
        "is_frozen": item.is_frozen,
        "source_turn_id": item.source_turn_id,
        "created_at": timestamp_to_iso(&item.created_at).unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()),
        "updated_at": timestamp_to_iso(&item.updated_at).unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()),
    })
}

fn persona_json(persona: Option<&agent::MemoryPersona>) -> Value {
    match persona {
        Some(p) => json!({
            "tagline": p.tagline,
            "narrative": p.narrative,
            "updated_at": timestamp_to_iso(&p.updated_at).unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()),
        }),
        None => Value::Null,
    }
}

fn params_value(input: Option<Value>) -> Value {
    input.unwrap_or_else(|| json!({}))
}

fn value_string(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn value_i32(v: &Value, key: &str) -> i32 {
    v.get(key).and_then(|v| v.as_i64()).unwrap_or_default() as i32
}

pub fn memory_list(input: MemoryListInput, token: &str) -> AppResult<StubPayload> {
    let params = params_value(input.params);
    let req = agent::ListMemoriesRequest {
        agent_id: value_string(&params, "agent_id"),
        target: value_string(&params, "target"),
        layer: str_to_memory_layer(&value_string(&params, "layer")),
        page: value_i32(&params, "page"),
        page_size: value_i32(&params, "page_size"),
        order_by: value_string(&params, "order_by"),
        since: value_string(&params, "since"),
        until: value_string(&params, "until"),
        period: value_string(&params, "period"),
    };
    match station_client::request_peers_proto::<
        agent::ListMemoriesRequest,
        agent::ListMemoriesResponse,
    >(Method::POST, "/agent/memory/list", token, None, Some(&req))
    {
        Ok(resp) => success_payload(
            "memory_list",
            json!({
                "memories": resp.items.iter().map(memory_item_json).collect::<Vec<_>>(),
                "total": resp.total,
            }),
        ),
        Err(err) => station_error("memory_list", err),
    }
}

pub fn memory_get(input: MemoryIdInput, token: &str) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let req = agent::GetMemoryRequest { id: input.id };
    match station_client::request_peers_proto::<agent::GetMemoryRequest, agent::GetMemoryResponse>(
        Method::POST,
        "/agent/memory/get",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => success_payload(
            "memory_get",
            resp.item
                .as_ref()
                .map(memory_item_json)
                .unwrap_or(Value::Null),
        ),
        Err(err) => station_error("memory_get", err),
    }
}

pub fn memory_delete(input: MemoryIdInput, token: &str) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let req = agent::DeleteMemoryRequest {
        id: input.id,
        agent_id: String::new(),
    };
    match station_client::request_peers_proto::<
        agent::DeleteMemoryRequest,
        agent::DeleteMemoryResponse,
    >(
        Method::POST,
        "/agent/memory/delete",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => success_payload("memory_delete", json!({ "ok": resp.ok })),
        Err(err) => station_error("memory_delete", err),
    }
}

pub fn memory_update(input: MemoryUpdateInput, token: &str) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.content.trim().is_empty() {
        return invalid_argument("content is required");
    }
    let req = agent::WriteMemoryRequest {
        old_content: input.id,
        content: input.content,
        action: "update".to_string(),
        ..Default::default()
    };
    match station_client::request_peers_proto::<
        agent::WriteMemoryRequest,
        agent::WriteMemoryResponse,
    >(
        Method::POST,
        "/agent/memory/update",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => success_payload(
            "memory_update",
            json!({
                "ok": resp.success,
                "item": resp.item.as_ref().map(memory_item_json).unwrap_or(Value::Null),
            }),
        ),
        Err(err) => station_error("memory_update", err),
    }
}

pub fn memory_search(input: MemorySearchInput, token: &str) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return invalid_argument("query is required");
    }
    let req = agent::SearchMemoriesRequest {
        query: input.query,
        layers: input
            .layers
            .unwrap_or_default()
            .into_iter()
            .map(|s| str_to_memory_layer(&s))
            .collect(),
        limit: input.limit.unwrap_or(10) as i32,
        agent_id: input.agent_id.unwrap_or_default(),
        since: input.since.unwrap_or_default(),
        until: input.until.unwrap_or_default(),
        period: input.period.unwrap_or_default(),
        effort: String::new(),
    };
    match station_client::request_peers_proto::<
        agent::SearchMemoriesRequest,
        agent::SearchMemoriesResponse,
    >(
        Method::POST,
        "/agent/memory/search",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => {
            let results: Vec<Value> = resp
                .results
                .iter()
                .map(|r| {
                    let explain = r.explain.as_ref().map(|e| {
                        json!({
                            "vector_score": e.vector_score,
                            "keyword_score": e.keyword_score,
                            "weighted_score": e.weighted_score,
                            "decay_factor": e.decay_factor,
                            "after_decay": e.after_decay,
                            "after_rerank": e.after_rerank,
                            "final_score": e.final_score,
                            "trust_factor": e.trust_factor,
                        })
                    });
                    json!({
                        "memory": r.memory.as_ref().map(memory_item_json).unwrap_or(Value::Null),
                        "score": r.score,
                        "explain": explain,
                    })
                })
                .collect();
            success_payload("memory_search", json!({ "results": results }))
        }
        Err(err) => station_error("memory_search", err),
    }
}

pub fn memory_persona(input: MemoryPersonaInput, token: &str) -> AppResult<StubPayload> {
    let req = agent::GetMemoryPersonaRequest {
        agent_id: input.agent_id.unwrap_or_default(),
    };
    match station_client::request_peers_proto::<
        agent::GetMemoryPersonaRequest,
        agent::GetMemoryPersonaResponse,
    >(
        Method::POST,
        "/agent/memory/persona",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => success_payload(
            "memory_persona",
            json!({ "persona": persona_json(resp.persona.as_ref()) }),
        ),
        Err(err) => station_error("memory_persona", err),
    }
}

pub fn memory_stats(token: &str) -> AppResult<StubPayload> {
    let req = agent::GetMemoryStatsRequest {
        agent_id: String::new(),
    };
    match station_client::request_peers_proto::<
        agent::GetMemoryStatsRequest,
        agent::GetMemoryStatsResponse,
    >(Method::POST, "/agent/memory/stats", token, None, Some(&req))
    {
        Ok(resp) => success_payload(
            "memory_stats",
            json!({
                "total": resp.total,
                "by_layer": resp.by_layer,
                "storage_bytes": resp.storage_bytes,
            }),
        ),
        Err(err) => station_error("memory_stats", err),
    }
}

pub fn memory_events(input: MemoryEventsInput, token: &str) -> AppResult<StubPayload> {
    let params = params_value(input.params);
    let req = agent::ListMemoryEventsRequest {
        r#type: value_string(&params, "type"),
        agent_id: value_string(&params, "agent_id"),
        limit: value_i32(&params, "limit"),
        offset: value_i32(&params, "offset"),
        since: value_string(&params, "since"),
        until: value_string(&params, "until"),
        period: value_string(&params, "period"),
    };
    match station_client::request_peers_proto::<
        agent::ListMemoryEventsRequest,
        agent::ListMemoryEventsResponse,
    >(
        Method::POST,
        "/agent/memory/events",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => {
            let events: Vec<Value> = resp.events.iter().map(|e| json!({
				"id": e.id,
				"type": e.r#type,
				"memory_id": e.memory_id,
				"session_id": e.session_id,
				"agent_id": e.agent_id,
				"layer": e.layer,
				"detail": serde_json::from_str::<Value>(&e.detail_json).unwrap_or_else(|_| json!({ "text": e.detail_json })),
				"latency_ms": e.latency_ms,
				"timestamp": timestamp_to_iso(&e.timestamp).unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()),
			})).collect();
            success_payload("memory_events", json!({ "events": events }))
        }
        Err(err) => station_error("memory_events", err),
    }
}

pub fn memory_export(input: MemoryExportInput, token: &str) -> AppResult<StubPayload> {
    let params = params_value(input.params);
    let req = agent::ExportMemoriesRequest {
        agent_id: value_string(&params, "agent_id"),
        layer: value_string(&params, "layer"),
    };
    match station_client::request_peers_proto::<
        agent::ExportMemoriesRequest,
        agent::ExportMemoriesResponse,
    >(
        Method::POST,
        "/agent/memory/export",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => success_payload(
            "memory_export",
            json!({
                "version": resp.version,
                "exported_at": resp.exported_at,
                "memories": resp.memories.iter().map(memory_item_json).collect::<Vec<_>>(),
                "persona": persona_json(resp.persona.as_ref()),
            }),
        ),
        Err(err) => station_error("memory_export", err),
    }
}

pub fn memory_import(input: MemoryImportInput, token: &str) -> AppResult<StubPayload> {
    let memories = input
        .data
        .get("memories")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let proto_memories = memories.iter().map(value_to_memory_item).collect();
    let req = agent::ImportMemoriesRequest {
        data: Some(agent::ExportMemoriesResponse {
            version: input
                .data
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("1.0")
                .to_string(),
            exported_at: input
                .data
                .get("exported_at")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            memories: proto_memories,
            persona: None,
        }),
        skip_duplicates: input.skip_duplicates.unwrap_or(true),
    };
    match station_client::request_peers_proto::<
        agent::ImportMemoriesRequest,
        agent::ImportMemoriesResponse,
    >(
        Method::POST,
        "/agent/memory/import",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => success_payload(
            "memory_import",
            json!({
                "imported": resp.imported,
                "skipped": resp.skipped,
                "failed": resp.failed,
                "total": resp.total,
            }),
        ),
        Err(err) => station_error("memory_import", err),
    }
}

fn value_to_memory_item(value: &Value) -> agent::MemoryItem {
    let content = value
        .get("content")
        .map(|v| {
            if v.is_string() {
                v.as_str().unwrap_or_default().to_string()
            } else {
                v.to_string()
            }
        })
        .unwrap_or_default();
    agent::MemoryItem {
        memory_id: value_string(value, "id"),
        agent_id: value_string(value, "agent_id"),
        target: value_string(value, "target"),
        content,
        source_turn_id: value_string(value, "source_turn_id"),
        created_at: None,
        updated_at: None,
        layer: str_to_memory_layer(&value_string(value, "layer")),
        session_id: value_string(value, "session_id"),
        source: value_string(value, "source"),
        summary: value_string(value, "summary"),
        relevance: value
            .get("relevance")
            .and_then(|v| v.as_f64())
            .unwrap_or_default(),
        access_count: value_i32(value, "access_count"),
        last_accessed_at: None,
        trust_score: value
            .get("trust_score")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5),
        helpful_count: value_i32(value, "helpful_count"),
        harmful_count: value_i32(value, "harmful_count"),
        is_frozen: value
            .get("is_frozen")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

pub fn memory_embedding_status(token: &str) -> AppResult<StubPayload> {
    match station_client::request_peers_proto::<
        agent::EmbeddingStatusRequest,
        agent::EmbeddingStatusResponse,
    >(
        Method::POST,
        "/agent/memory/embedding-status",
        token,
        None,
        Some(&agent::EmbeddingStatusRequest {}),
    ) {
        Ok(resp) => success_payload(
            "memory_embedding_status",
            json!({
                "provider": resp.provider,
                "model": resp.model,
                "dimensions": resp.dimensions,
                "vector_count": resp.vector_count,
            }),
        ),
        Err(err) => station_error("memory_embedding_status", err),
    }
}

pub fn memory_reembed(token: &str) -> AppResult<StubPayload> {
    match station_client::request_peers_proto::<agent::ReEmbedRequest, agent::ReEmbedResponse>(
        Method::POST,
        "/agent/memory/reembed",
        token,
        None,
        Some(&agent::ReEmbedRequest {}),
    ) {
        Ok(resp) => success_payload(
            "memory_reembed",
            json!({
                "ok": resp.ok,
                "reembedded_count": resp.reembedded_count,
            }),
        ),
        Err(err) => station_error("memory_reembed", err),
    }
}
