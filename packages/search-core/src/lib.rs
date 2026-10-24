//! Portable Peers Search query kernel.
//!
//! Host-neutral search semantics shared by Desktop and Mobile native
//! adapters. It owns deterministic text analysis, the FTS5 match expression,
//! reciprocal-rank fusion, opaque cursors, and cancellation. It deliberately
//! depends on neither host application frameworks, database drivers,
//! network/transport clients, model SDKs, nor any UI layer — those stay
//! behind the ports in [`ports`].
//!
//! The wire shapes are generated from `model/domain/search/search.proto`;
//! the scored candidate is an internal execution projection over those
//! canonical types. Search is a closed domain (decision D-19): there is no web,
//! OS-file, or external-connector concept anywhere in this crate.

pub mod cache;
pub mod contributor;
pub mod cursor;
pub mod model;
pub mod ports;
pub mod query;
pub mod ranking;
pub mod requests;
pub mod runtime;
pub mod tokenize;

pub use cursor::{decode_cursor, encode_cursor, CursorError, PageCursor};
pub use model::{ResourceRef, ResultKind, ScoredDocument, SourceCoverage, SourceStateKind};
pub use ports::{
    CancelToken, SearchContributor, SearchError, SearchExecutionContext, SourceFuture,
};
pub use query::{build_index_text, build_match_expression, MAX_QUERY_CHARS};
pub use ranking::reciprocal_rank_fusion;
pub use tokenize::tokenize;
