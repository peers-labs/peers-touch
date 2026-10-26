//! Canonical protobuf types and the internal scored candidate used by fusion.

use serde::{Deserialize, Serialize};

#[allow(clippy::large_enum_variant)]
pub mod wire {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.search.v1.rs"));
}

pub use wire::{
    ResourceRef, SearchKind as ResultKind, SearchZone as TrustZone, SourceCoverage,
    SourceState as SourceStateKind,
};

/// Private memory-cache provenance. Business fields remain the generated response.
/// The retained session owns issuance; these bytes confer no read or open rights.
#[derive(Clone, PartialEq, prost::Message)]
pub(crate) struct SessionCacheFrame {
    #[prost(uint64, tag = "1")]
    pub session_id: u64,
    #[prost(message, optional, tag = "2")]
    pub response: Option<wire::SearchResponse>,
}

impl ResourceRef {
    /// Stable fusion identity: the same object returned by several sources
    /// (message index, attachment projection, recents) must collapse to one.
    pub fn fusion_key(&self) -> String {
        if self.kind != "message" || self.message_id.is_empty() {
            format!("{:?}", (&self.authority_namespace, &self.kind, &self.id))
        } else {
            format!(
                "{:?}",
                (
                    &self.authority_namespace,
                    "message",
                    &self.conversation_id,
                    &self.message_id
                )
            )
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
