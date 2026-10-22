pub mod requests;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use search_core::model::wire::{
    ResultItem, SearchIntent, SearchKind, SearchResponse, SearchScope,
    SourceCoverage, SourceState, SubmitRequest, SuggestRequest,
};
use search_core::{ScoredDocument, SearchError};

use crate::contracts::{AiSearchInput, SearchQueryInput, StubPayload};
use crate::error::AppResult;
use crate::messaging::MessagingEngine;

/// Device milestone search: closed domain, device-local sources only (D-19).
/// The coordinator fuses same-leaf documents once per source list with RRF
/// and reports coverage honestly; it never calls Station/network APIs.

const DEVICE_MESSAGE_SOURCE: &str = "device.messages";
const DEVICE_CONVERSATION_SOURCE: &str = "device.conversations";

/// Default and maximum page sizes; mirror the store's own bound.
const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 100;

fn bounded_limit(requested: i32) -> usize {
    if requested == 0 { DEFAULT_LIMIT as usize }
    else { requested.clamp(1, MAX_LIMIT as i32) as usize }
}

fn envelope(items: Vec<ScoredDocument>, sources: &[&str]) -> SearchResponse {
    SearchResponse {
        items: items.into_iter().map(|d| ResultItem {
            resource: Some(d.resource), kind: d.kind as i32, zone: d.zone as i32,
            title: d.title, snippet: d.snippet, conversation_title: d.conversation_title,
            author_ptid: d.author_ptid, created_at_unix_ms: d.created_at_unix_ms, score: d.score,
        }).collect(),
        coverage: sources.iter().map(|source| SourceCoverage {
            source_id: (*source).into(), state: SourceState::Ready as i32,
            detail_key: "search.coverage.device_ready".into(),
        }).collect(),
        ..Default::default()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MessageCursor {
    fingerprint: String,
    timestamp: i64,
    message_id: String,
    conversation_id: String,
}

fn admitted_query(query: &str) -> Result<&str, SearchError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > search_core::MAX_QUERY_CHARS {
        Err(SearchError::InvalidQuery)
    } else { Ok(query) }
}

/// Immediate local suggestions: conversation names plus a small message
/// sample fused by RRF. Never performs a network request.
pub fn search_suggest(
    engine: &MessagingEngine,
    input: SuggestRequest,
    check: &dyn Fn() -> Result<(), SearchError>,
) -> Result<SearchResponse, SearchError> {
    check()?;
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(envelope(Vec::new(), &[]));
    }
    admitted_query(query)?;
    let kind = SearchKind::try_from(input.kind).map_err(|_| SearchError::InvalidQuery)?;
    if !matches!(kind, SearchKind::Unspecified | SearchKind::Conversation | SearchKind::Message) {
        return Err(SearchError::InvalidQuery);
    }
    let limit = bounded_limit(input.limit);
    let mut sources = Vec::new();
    let conversations = if kind != SearchKind::Message {
        let rows = engine.suggest_conversations(query, limit, &|| check().map_err(|e| e.to_string()));
        check()?;
        sources.push(DEVICE_CONVERSATION_SOURCE);
        rows.map_err(SearchError::SourceUnavailable)?
    } else { Vec::new() };
    check()?;
    let messages = if kind != SearchKind::Conversation {
        let rows = engine.search_device_documents(query, None, limit.min(8),
            &|| check().map_err(|e| e.to_string()));
        check()?;
        sources.push(DEVICE_MESSAGE_SOURCE);
        rows.map_err(SearchError::SourceUnavailable)?
    } else { Vec::new() };
    let fused = search_core::reciprocal_rank_fusion(
        &[conversations, messages],
        search_core::ranking::DEFAULT_RRF_K,
    );
    check()?;
    Ok(envelope(fused.into_iter().take(limit).collect(), &sources))
}

/// Full local retrieval across all device conversations.
pub fn search_submit(
    engine: &MessagingEngine,
    input: SubmitRequest,
    account: &str,
    check: &dyn Fn() -> Result<(), SearchError>,
) -> Result<SearchResponse, SearchError> {
    check()?;
    if input.scope != SearchScope::Device as i32 {
        return Err(SearchError::OutsideDomain);
    }
    // OPEN belongs to the resource owner. Other result kinds and full mixed
    // retrieval are not implemented in this coordinator slice; never ignore them.
    if input.intent != SearchIntent::Find as i32 || input.kind != SearchKind::Message as i32 {
        return Err(SearchError::InvalidQuery);
    }
    let query = admitted_query(&input.query)?;
    let fingerprint = hex::encode(Sha256::digest(format!("{account}\0{query}").as_bytes()));
    let cursor: Option<MessageCursor> = if input.cursor.is_empty() { None } else {
        if input.cursor.len() > 4096 { return Err(SearchError::CursorExpired); }
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&input.cursor)
            .map_err(|_| SearchError::CursorExpired)?;
        let cursor: MessageCursor = serde_json::from_slice(&bytes)
            .map_err(|_| SearchError::CursorExpired)?;
        if cursor.fingerprint != fingerprint {
            return Err(SearchError::CursorExpired);
        }
        Some(cursor)
    };
    let before = cursor.as_ref().map(|c|
        (c.timestamp, c.message_id.as_str(), c.conversation_id.as_str()));
    let limit = bounded_limit(input.limit);
    let rows = engine.search_device_documents(query, before, limit + 1,
        &|| check().map_err(|e| e.to_string()));
    check()?;
    let mut documents = rows.map_err(SearchError::SourceUnavailable)?;
    let has_more = documents.len() > limit;
    documents.truncate(limit);
    let next_cursor = if has_more {
        let last = documents.last().ok_or(SearchError::CursorExpired)?;
        let cursor = MessageCursor {
            fingerprint, timestamp: last.created_at_unix_ms,
            message_id: last.resource.message_id.clone(),
            conversation_id: last.resource.conversation_id.clone(),
        };
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&cursor).map_err(|_| SearchError::CursorExpired)?)
    } else { String::new() };
    let mut response = envelope(documents, &[DEVICE_MESSAGE_SOURCE]);
    response.has_more = has_more;
    response.next_cursor = next_cursor;
    check()?;
    Ok(response)
}

// ── Legacy success-empty stubs ─────────────────────────────────────────────
// The old search-provider UX still calls these until SRCH-D04B replaces its
// TS consumers. They return success-empty only; no new caller may use them,
// and they are physically deleted in D04B.

pub fn help_get() -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: "help_get".to_string(),
        status: json!({
            "categories": [],
        })
        .to_string(),
    })
}

pub fn search_sources() -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: "search_sources".to_string(),
        status: json!({
            "sources": [],
        })
        .to_string(),
    })
}

pub fn search_query(input: SearchQueryInput) -> AppResult<StubPayload> {
    let _ = input;
    AppResult::success(StubPayload {
        command: "search_query".to_string(),
        status: json!({
            "results": [],
            "count": 0,
        })
        .to_string(),
    })
}

pub fn search_ai(input: AiSearchInput) -> AppResult<StubPayload> {
    let _ = input;
    AppResult::success(StubPayload {
        command: "search_ai".to_string(),
        status: json!({
            "answer": "",
            "sources": [],
        })
        .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_is_bounded() {
        assert_eq!(bounded_limit(0), DEFAULT_LIMIT as usize);
        assert_eq!(bounded_limit(-1), 1);
        assert_eq!(bounded_limit(500), MAX_LIMIT as usize);
        assert_eq!(bounded_limit(7), 7);
    }

    #[test]
    fn empty_envelope_has_no_items_and_no_cursor() {
        let value = envelope(Vec::new(), &[]);
        assert!(value.items.is_empty());
        assert!(!value.has_more);
        assert_eq!(value.next_cursor, "");
    }

    #[test]
    fn legacy_stubs_stay_success_empty() {
        assert!(help_get().data.unwrap().status.contains("categories"));
        assert!(search_sources().data.unwrap().status.contains("sources"));
    }
}
