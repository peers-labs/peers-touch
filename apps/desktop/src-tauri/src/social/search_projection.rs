//! Search projections decoded only at the original private-content boundary.

use search_core::model::{wire::ResourceAnchor, TrustZone};
use search_core::{ResourceRef, ResultKind, ScoredDocument};

use super::private_comment::PrivateCommentProjection;
use super::projection::{
    PrivateMomentContentProjection, PrivateMomentProjection, PrivateReadState,
};
use crate::secure_content::store::CommentState;

pub(crate) const AUTHORITY: &str = "social";
pub(crate) const POST: &str = "social-post";
pub(crate) const COMMENT: &str = "social-comment";
pub(crate) const MAX_PROJECTION_BYTES: usize = 256 * 1024;

pub(crate) struct SearchProjection {
    pub document: ScoredDocument,
    pub content_id: String,
    pub generation: u64,
    pub text: String,
}

pub(crate) fn resource_ref(kind: &str, id: &str, post_id: &str, revision: &str) -> ResourceRef {
    ResourceRef {
        kind: kind.to_string(),
        id: id.to_string(),
        authority_namespace: AUTHORITY.to_string(),
        content_revision: revision.to_string(),
        anchor: Some(ResourceAnchor {
            kind: if kind == COMMENT { "comment" } else { "post" }.to_string(),
            id: id.to_string(),
        }),
        parent: (kind == COMMENT).then(|| {
            Box::new(ResourceRef {
                kind: POST.to_string(),
                id: post_id.to_string(),
                authority_namespace: AUTHORITY.to_string(),
                ..Default::default()
            })
        }),
        ..Default::default()
    }
}

pub(crate) fn scrub_post_target(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let projection = PrivateMomentProjection::decode_local(bytes)?;
    super::private_moment::scrub_persisted_media_projection(projection).encode_local()
}

pub(crate) fn decode(
    kind: &str,
    id: &str,
    post_id: &str,
    bytes: &[u8],
) -> Option<SearchProjection> {
    if bytes.len() > MAX_PROJECTION_BYTES {
        return None;
    }
    let (content_id, generation, author_ptid, created, text, result_kind) = match kind {
        POST => {
            let projection = PrivateMomentProjection::decode_local(bytes).ok()?;
            if projection.post_id != id
                || id != post_id
                || projection.state != PrivateReadState::ContentReady
            {
                return None;
            }
            let text = match projection.content? {
                PrivateMomentContentProjection::Text { text }
                | PrivateMomentContentProjection::Image { text, .. }
                | PrivateMomentContentProjection::Video { text, .. } => text,
                PrivateMomentContentProjection::Link { text, title, .. } => {
                    format!("{title}\n{text}")
                }
                PrivateMomentContentProjection::Poll {
                    text,
                    question,
                    options,
                    ..
                } => {
                    format!("{text}\n{question}\n{}", options.join("\n"))
                }
                // A repost snapshot does not grant current read rights to its source.
                PrivateMomentContentProjection::Repost { comment, .. } => comment,
                PrivateMomentContentProjection::Location {
                    text,
                    name,
                    address,
                    ..
                } => {
                    format!("{text}\n{name}\n{address}")
                }
            };
            (
                projection.content_id,
                projection.generation.parse::<u64>().ok()?,
                projection.author_ptid,
                projection.created_at_millis.unwrap_or_default(),
                text,
                ResultKind::SocialPost,
            )
        }
        COMMENT => {
            let projection = PrivateCommentProjection::decode_local(bytes).ok()?;
            if projection.comment_id != id
                || projection.post_id != post_id
                || projection.state != CommentState::Posted.as_str()
            {
                return None;
            }
            (
                projection.content_id,
                projection.generation.parse::<u64>().ok()?,
                projection.author_ptid,
                projection.created_at_millis.unwrap_or_default(),
                projection.text?,
                ResultKind::SocialComment,
            )
        }
        _ => return None,
    };
    if generation == 0 || content_id.is_empty() || author_ptid.is_empty() {
        return None;
    }
    let resource = resource_ref(kind, id, post_id, &format!("{content_id}:{generation}"));
    Some(SearchProjection {
        document: ScoredDocument {
            resource,
            kind: result_kind,
            zone: TrustZone::DeviceE2ee,
            title: text
                .lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(80)
                .collect(),
            snippet: text.chars().take(240).collect(),
            conversation_title: String::new(),
            author_ptid,
            created_at_unix_ms: created,
            score: 0.0,
        },
        content_id,
        generation,
        text,
    })
}
