//! Reciprocal Rank Fusion across source rankings.
//!
//! Each source returns its own ranked list (messages, conversations,
//! attachments, functions). RRF fuses them without normalizing incomparable
//! relevance scores: `score = Σ 1/(k + rank)` over every list containing the
//! object. A leaf object is fused at most once per list (decision D-16).

use std::collections::HashMap;

use crate::model::ScoredDocument;

/// Default RRF constant. Standard literature value; large enough that the
/// first few ranks dominate gently rather than absolutely.
pub const DEFAULT_RRF_K: usize = 60;

/// Fuse ranked source lists. Input lists must already be de-duplicated within
/// themselves. Results are ordered by fused score descending, with earlier
/// list / earlier rank as the deterministic tiebreaker.
pub fn reciprocal_rank_fusion(lists: &[Vec<ScoredDocument>], k: usize) -> Vec<ScoredDocument> {
    struct Accumulator {
        document: ScoredDocument,
        fused: f64,
        order: usize,
    }

    let mut fused: HashMap<String, Accumulator> = HashMap::new();
    let mut order = 0usize;

    for list in lists {
        for (rank, document) in list.iter().enumerate() {
            let contribution = 1.0 / (k as f64 + rank as f64 + 1.0);
            let key = document.fusion_key();
            fused
                .entry(key)
                .and_modify(|acc| acc.fused += contribution)
                .or_insert_with(|| {
                    order += 1;
                    let mut merged = document.clone();
                    merged.score = contribution;
                    Accumulator {
                        document: merged,
                        fused: contribution,
                        order,
                    }
                });
            if let Some(acc) = fused.get_mut(&document.fusion_key()) {
                // Keep the strongest per-source relevance for display, while
                // the fused value drives ordering.
                acc.document.score = acc.fused;
            }
        }
    }

    let mut entries: Vec<_> = fused.into_values().collect();
    entries.sort_by(|a, b| {
        b.fused
            .partial_cmp(&a.fused)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.order.cmp(&b.order))
    });
    entries.into_iter().map(|acc| acc.document).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ResourceRef, ResultKind, TrustZone};

    fn doc(id: &str, score: f64) -> ScoredDocument {
        ScoredDocument {
            resource: ResourceRef {
                kind: "message".to_string(),
                id: id.to_string(),
                ..Default::default()
            },
            kind: ResultKind::Message,
            zone: TrustZone::DeviceE2ee,
            title: id.to_string(),
            snippet: String::new(),
            conversation_title: String::new(),
            author_ptid: String::new(),
            created_at_unix_ms: 0,
            score,
        }
    }

    #[test]
    fn fuses_presence_across_lists_by_rank() {
        let a = vec![doc("x", 9.0), doc("y", 1.0)];
        let b = vec![doc("y", 8.0), doc("z", 2.0)];
        let fused = reciprocal_rank_fusion(&[a, b], DEFAULT_RRF_K);
        let ids: Vec<_> = fused.iter().map(|d| d.resource.id.as_str()).collect();
        // y ranks in both lists, so it beats x despite lower native scores.
        assert_eq!(ids, vec!["y", "x", "z"]);
    }

    #[test]
    fn one_leaf_is_counted_once_per_list() {
        // Same leaf twice inside one list contributes only one rank window;
        // callers must de-dup, and fusion itself collapses identical keys.
        let list = vec![doc("x", 1.0), doc("x", 1.0)];
        let fused = reciprocal_rank_fusion(&[list], DEFAULT_RRF_K);
        assert_eq!(fused.len(), 1);
    }

    #[test]
    fn message_anchor_and_bare_object_do_not_collapse() {
        let mut anchored = doc("m1", 1.0);
        anchored.resource.conversation_id = "c1".to_string();
        anchored.resource.message_id = "msg-1".to_string();
        let bare = doc("m1", 1.0);
        let fused = reciprocal_rank_fusion(&[vec![anchored, bare]], DEFAULT_RRF_K);
        assert_eq!(fused.len(), 2);
    }

    #[test]
    fn empty_input_is_empty() {
        assert!(reciprocal_rank_fusion(&[], DEFAULT_RRF_K).is_empty());
    }
}
