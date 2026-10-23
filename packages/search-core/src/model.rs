//! Canonical protobuf types and the internal scored candidate used by fusion.

use serde::{Deserialize, Serialize};

pub mod wire {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.search.v1.rs"));
}

pub use wire::{
    ResourceRef, SearchKind as ResultKind, SearchZone as TrustZone,
    SourceCoverage, SourceState as SourceStateKind,
};

impl ResourceRef {
    /// Stable fusion identity: the same object returned by several sources
    /// (message index, attachment projection, recents) must collapse to one.
    pub fn fusion_key(&self) -> String {
        if self.message_id.is_empty() {
            format!("{}:{}", self.kind, self.id)
        } else {
            format!("message:{}:{}", self.conversation_id, self.message_id)
        }
    }
}

/// One candidate document returned by a source port.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoredDocument {
    pub resource: ResourceRef,
    pub kind: ResultKind,
    pub zone: TrustZone,
    pub title: String,
    pub snippet: String,
    pub conversation_title: String,
    pub author_ptid: String,
    pub created_at_unix_ms: i64,
    pub score: f64,
}

impl ScoredDocument {
    pub fn fusion_key(&self) -> String {
        self.resource.fusion_key()
    }
}
