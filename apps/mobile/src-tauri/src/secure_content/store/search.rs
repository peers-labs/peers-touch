//! Derived tokens only. Plaintext and keys remain in the original SQLCipher tables.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use search_core::model::{wire::ResourceAnchor, ResultKind, TrustZone};
use search_core::{build_index_text, build_match_expression, ResourceRef, ScoredDocument};
use sha2::{Digest, Sha256};

use super::PrivateSocialStore;
use crate::secure_content::private_comment::PrivateCommentProjection;
use crate::secure_content::receiver::{
    PrivateMomentReadProjection, PrivateReadContent, PrivateReadState,
};

pub const SEARCH_BATCH_MAX: usize = 100;
pub const SEARCH_BACKFILL_MAX: usize = 128;
const SEARCH_SQL_INSTRUCTIONS_MAX: u32 = 1_000_000;
pub type SearchBoundary<'a> = (i64, &'a str, &'a str);

pub struct SearchDocumentPage {
    pub documents: Vec<ScoredDocument>,
    pub next_before: Option<(i64, String, String)>,
}

pub(super) fn migrate(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
         CREATE TABLE IF NOT EXISTS mobile_social_search_progress(
           singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
           generation INTEGER NOT NULL, revision INTEGER NOT NULL,
           phase INTEGER NOT NULL, checkpoint INTEGER NOT NULL);
         INSERT OR IGNORE INTO mobile_social_search_progress VALUES(1, 1, 1, 0, 0);
         CREATE TABLE IF NOT EXISTS mobile_social_search_barriers(
           kind TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL,
           tombstone INTEGER NOT NULL, PRIMARY KEY(kind, id));
         CREATE INDEX IF NOT EXISTS mobile_social_search_barrier_parent
           ON mobile_social_search_barriers(parent_id);
         CREATE TABLE IF NOT EXISTS mobile_social_search_pending(
           kind TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL,
           PRIMARY KEY(kind, id));
         CREATE INDEX IF NOT EXISTS mobile_social_search_pending_parent
           ON mobile_social_search_pending(parent_id);
         CREATE TABLE IF NOT EXISTS mobile_social_search_documents(
           kind TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL,
           content_id TEXT NOT NULL, content_generation INTEGER NOT NULL,
           authority TEXT NOT NULL, content_revision TEXT NOT NULL,
           created_at INTEGER NOT NULL, UNIQUE(kind, id));
         CREATE INDEX IF NOT EXISTS mobile_social_search_parent
           ON mobile_social_search_documents(parent_id);
         CREATE INDEX IF NOT EXISTS mobile_social_comment_window
           ON mobile_private_social_comment_projections(post_id);
         CREATE VIRTUAL TABLE IF NOT EXISTS mobile_social_search_fts
           USING fts5(tokens, tokenize='unicode61');
         COMMIT;",
        )
        .map_err(|error| error.to_string())
}

fn bump(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "UPDATE mobile_social_search_progress SET revision = revision + 1 WHERE singleton = 1",
            [],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn tombstoned(connection: &Connection, kind: &str, id: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM mobile_social_search_barriers
         WHERE kind = ?1 AND id = ?2 AND tombstone = 1)",
            params![kind, id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

pub(super) fn require_upsert(
    connection: &Connection,
    kind: &str,
    id: &str,
    parent: &str,
) -> Result<(), String> {
    if tombstoned(connection, kind, id)?
        || (!parent.is_empty() && tombstoned(connection, "social-post", parent)?)
    {
        return Err("private Social resource is tombstoned".into());
    }
    Ok(())
}

fn remove(connection: &Connection, kind: &str, id: &str) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM mobile_social_search_fts WHERE rowid IN
         (SELECT rowid FROM mobile_social_search_documents WHERE kind = ?1 AND id = ?2)",
            params![kind, id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM mobile_social_search_documents WHERE kind = ?1 AND id = ?2",
            params![kind, id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn pending(connection: &Connection, kind: &str, id: &str, parent: &str) -> Result<(), String> {
    remove(connection, kind, id)?;
    connection
        .execute(
            "INSERT INTO mobile_social_search_pending VALUES(?1, ?2, ?3)
         ON CONFLICT(kind, id) DO UPDATE SET parent_id = excluded.parent_id",
            params![kind, id, parent],
        )
        .map_err(|error| error.to_string())?;
    bump(connection)
}

pub(super) fn deny_post(connection: &Connection, id: &str, permanent: bool) -> Result<(), String> {
    if permanent {
        connection
            .execute(
                "INSERT INTO mobile_social_search_barriers(kind, id, parent_id, tombstone)
             SELECT 'social-comment', comment_id, post_id, 1
             FROM mobile_private_social_comment_projections WHERE post_id = ?1
             ON CONFLICT(kind, id) DO UPDATE SET tombstone = 1",
                params![id],
            )
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "INSERT INTO mobile_social_search_barriers VALUES('social-post', ?1, '', ?2)
         ON CONFLICT(kind, id) DO UPDATE SET tombstone = MAX(tombstone, excluded.tombstone)",
            params![id, permanent],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM mobile_social_search_fts WHERE rowid IN
         (SELECT rowid FROM mobile_social_search_documents WHERE id = ?1 AND kind = 'social-post'
          OR parent_id = ?1)",
            params![id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM mobile_social_search_documents
         WHERE (kind = 'social-post' AND id = ?1) OR parent_id = ?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM mobile_social_search_pending
         WHERE (kind = 'social-post' AND id = ?1) OR parent_id = ?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;
    bump(connection)
}

fn post_text(content: &PrivateReadContent) -> String {
    match content {
        PrivateReadContent::Text { text }
        | PrivateReadContent::Image { text, .. }
        | PrivateReadContent::Video { text, .. } => text.clone(),
        PrivateReadContent::Link { text, title, .. } => format!("{text} {title}"),
        PrivateReadContent::Poll {
            text,
            question,
            options,
            ..
        } => format!("{text} {question} {}", options.join(" ")),
        // The source snapshot is a separate resource, not this post's searchable text.
        PrivateReadContent::Repost { comment, .. } => comment.clone(),
        PrivateReadContent::Location {
            text,
            name,
            address,
            ..
        } => format!("{text} {name} {address}"),
    }
}

fn revision(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn readable_post(
    connection: &Connection,
    id: &str,
) -> Result<Option<PrivateMomentReadProjection>, String> {
    if tombstoned(connection, "social-post", id)? {
        return Ok(None);
    }
    let bytes: Option<Vec<u8>> = connection
        .query_row(
            "SELECT p.projection_json FROM mobile_private_social_read_projections p
         JOIN mobile_private_social_roots r ON r.content_id = p.content_id
           AND r.generation = p.generation AND r.post_id = p.post_id
         WHERE p.post_id = ?1
           AND NOT EXISTS(SELECT 1 FROM mobile_social_search_barriers b
             WHERE b.kind = 'social-post' AND b.id = p.post_id)",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(bytes
        .and_then(|bytes| PrivateMomentReadProjection::decode(&bytes).ok())
        .filter(|p| {
            p.state == PrivateReadState::ContentReady
                && p.content.is_some()
                && !p.authority_namespace.is_empty()
        }))
}

fn index(
    connection: &Connection,
    doc: &ScoredDocument,
    content: &str,
    content_id: &str,
    generation: &str,
    parent: &str,
) -> Result<(), String> {
    let generation: i64 = generation
        .parse()
        .map_err(|_| "invalid private Social content generation")?;
    if generation <= 0 {
        return Err("invalid private Social content generation".into());
    }
    connection
        .execute(
            "DELETE FROM mobile_social_search_pending WHERE kind = ?1 AND id = ?2",
            params![doc.resource.kind, doc.resource.id],
        )
        .map_err(|error| error.to_string())?;
    let unchanged: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM mobile_social_search_documents
         WHERE kind = ?1 AND id = ?2 AND content_revision = ?3 AND authority = ?4)",
            params![
                doc.resource.kind,
                doc.resource.id,
                doc.resource.content_revision,
                doc.resource.authority_namespace
            ],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if unchanged {
        return Ok(());
    }
    remove(connection, &doc.resource.kind, &doc.resource.id)?;
    connection.execute(
        "INSERT INTO mobile_social_search_documents
         (kind, id, parent_id, content_id, content_generation, authority, content_revision, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![doc.resource.kind, doc.resource.id, parent, content_id, generation,
            doc.resource.authority_namespace, doc.resource.content_revision, doc.created_at_unix_ms],
    ).map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO mobile_social_search_fts(rowid, tokens) VALUES(?1, ?2)",
            params![connection.last_insert_rowid(), build_index_text(content)],
        )
        .map_err(|error| error.to_string())?;
    bump(connection)
}

fn post_doc(p: &PrivateMomentReadProjection, bytes: &[u8]) -> Option<ScoredDocument> {
    let text = post_text(p.content.as_ref()?);
    Some(document(
        ResourceRef {
            kind: "social-post".into(),
            id: p.post_id.clone(),
            authority_namespace: p.authority_namespace.clone(),
            content_revision: revision(bytes),
            anchor: Some(ResourceAnchor {
                kind: "post".into(),
                id: p.post_id.clone(),
            }),
            ..Default::default()
        },
        ResultKind::SocialPost,
        text,
        p.author_ptid.clone(),
        p.created_at_millis.unwrap_or(0),
    ))
}

fn document(
    resource: ResourceRef,
    kind: ResultKind,
    text: String,
    author: String,
    created: i64,
) -> ScoredDocument {
    ScoredDocument {
        resource,
        kind,
        zone: TrustZone::DeviceE2ee,
        title: text.chars().take(80).collect(),
        snippet: text.chars().take(320).collect(),
        conversation_title: String::new(),
        author_ptid: author,
        created_at_unix_ms: created,
        score: 0.0,
    }
}

pub(super) fn update_post(connection: &Connection, id: &str, bytes: &[u8]) -> Result<(), String> {
    let Some(p) = PrivateMomentReadProjection::decode(bytes).ok() else {
        return deny_post(connection, id, false);
    };
    if p.state != PrivateReadState::ContentReady {
        return deny_post(
            connection,
            id,
            p.state == PrivateReadState::DeletedOrRevoked,
        );
    }
    require_upsert(connection, "social-post", id, "")?;
    connection.execute(
        "DELETE FROM mobile_social_search_barriers WHERE kind = 'social-post' AND id = ?1 AND tombstone = 0",
        params![id],
    ).map_err(|error| error.to_string())?;
    if p.post_id != id || readable_post(connection, id)?.is_none() {
        return pending(connection, "social-post", id, "");
    }
    let doc = post_doc(&p, bytes).ok_or("private Social content is unavailable")?;
    let was_indexed: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM mobile_social_search_documents WHERE kind = 'social-post' AND id = ?1)",
        params![id], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    index(
        connection,
        &doc,
        &post_text(p.content.as_ref().unwrap()),
        &p.content_id,
        &p.generation,
        "",
    )?;
    if !was_indexed {
        connection.execute(
            "UPDATE mobile_social_search_progress SET phase = MIN(phase, 1), checkpoint = 0 WHERE singleton = 1 AND phase > 0",
            [],
        ).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(super) fn update_comment(
    connection: &Connection,
    id: &str,
    parent_id: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let Some(p) = PrivateCommentProjection::decode(bytes).ok() else {
        remove(connection, "social-comment", id)?;
        connection.execute(
            "DELETE FROM mobile_social_search_pending WHERE kind = 'social-comment' AND id = ?1",
            params![id],
        ).map_err(|error| error.to_string())?;
        return bump(connection);
    };
    if p.state != "COMMENT_POSTED" {
        connection
            .execute(
                "INSERT INTO mobile_social_search_barriers VALUES('social-comment', ?1, ?2, 1)
             ON CONFLICT(kind, id) DO UPDATE SET tombstone = 1",
                params![id, parent_id],
            )
            .map_err(|error| error.to_string())?;
        remove(connection, "social-comment", id)?;
        connection.execute(
            "DELETE FROM mobile_social_search_pending WHERE kind = 'social-comment' AND id = ?1",
            params![id],
        ).map_err(|error| error.to_string())?;
        return bump(connection);
    }
    require_upsert(connection, "social-comment", id, parent_id)?;
    let Some(parent) = readable_post(connection, parent_id)? else {
        return pending(connection, "social-comment", id, parent_id);
    };
    let key_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM mobile_private_social_roots
         WHERE content_id = ?1 AND generation = ?2 AND post_id = ?3)",
            params![p.content_id, p.generation, parent_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if p.comment_id != id || p.post_id != parent_id || !key_exists || p.text.is_none() {
        return pending(connection, "social-comment", id, parent_id);
    }
    let doc = comment_doc(&p, bytes, &parent)?;
    index(
        connection,
        &doc,
        p.text.as_deref().unwrap(),
        &p.content_id,
        &p.generation,
        parent_id,
    )
}

fn comment_doc(
    p: &PrivateCommentProjection,
    bytes: &[u8],
    parent: &PrivateMomentReadProjection,
) -> Result<ScoredDocument, String> {
    let parent_bytes = parent.encode()?;
    let parent_document =
        post_doc(parent, &parent_bytes).ok_or("private Social parent unavailable")?;
    let mut comment = document(
        ResourceRef {
            kind: "social-comment".into(),
            id: p.comment_id.clone(),
            authority_namespace: parent.authority_namespace.clone(),
            content_revision: revision(bytes),
            parent: Some(Box::new(parent_document.resource)),
            anchor: Some(ResourceAnchor {
                kind: "comment".into(),
                id: p.comment_id.clone(),
            }),
            ..Default::default()
        },
        ResultKind::SocialComment,
        p.text.clone().unwrap_or_default(),
        p.author_ptid.clone(),
        p.created_at_millis.unwrap_or(0),
    );
    comment.title = parent_document.title;
    Ok(comment)
}

fn read_document(
    connection: &Connection,
    resource: &ResourceRef,
) -> Result<Option<ScoredDocument>, String> {
    if tombstoned(connection, &resource.kind, &resource.id)? {
        return Ok(None);
    }
    let indexed: Option<(String, String)> = connection.query_row(
        "SELECT authority, content_revision FROM mobile_social_search_documents WHERE kind = ?1 AND id = ?2",
        params![resource.kind, resource.id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(|error| error.to_string())?;
    let Some((authority, rev)) = indexed else {
        return Ok(None);
    };
    if authority != resource.authority_namespace
        || (!resource.content_revision.is_empty() && rev != resource.content_revision)
    {
        return Ok(None);
    }
    let doc = match resource.kind.as_str() {
        "social-post" => {
            let Some(p) = readable_post(connection, &resource.id)? else {
                return Ok(None);
            };
            post_doc(&p, &p.encode()?)
        }
        "social-comment" => {
            let bytes: Option<Vec<u8>> = connection.query_row(
                "SELECT p.projection_json FROM mobile_private_social_comment_projections p
                 JOIN mobile_social_search_documents d ON d.id = p.comment_id AND d.kind = 'social-comment'
                 JOIN mobile_private_social_roots r ON r.content_id = d.content_id
                   AND r.generation = d.content_generation AND r.post_id = p.post_id
                 WHERE p.comment_id = ?1",
                params![resource.id], |row| row.get(0),
            ).optional().map_err(|error| error.to_string())?;
            let Some(bytes) = bytes else {
                return Ok(None);
            };
            let p = PrivateCommentProjection::decode(&bytes)?;
            let Some(parent) = readable_post(connection, &p.post_id)? else {
                return Ok(None);
            };
            if p.state != "COMMENT_POSTED" || p.text.is_none() {
                return Ok(None);
            }
            Some(comment_doc(&p, &bytes, &parent)?)
        }
        _ => None,
    };
    Ok(doc.filter(|doc| {
        doc.resource.content_revision == rev
            && resource.parent.as_ref().is_none_or(|p| {
                doc.resource.parent.as_ref().is_some_and(|actual| {
                    p.kind == actual.kind
                        && p.id == actual.id
                        && p.authority_namespace == actual.authority_namespace
                        && (p.content_revision.is_empty()
                            || p.content_revision == actual.content_revision)
                })
            })
            && resource
                .anchor
                .as_ref()
                .is_none_or(|a| doc.resource.anchor.as_ref() == Some(a))
    }))
}

impl PrivateSocialStore {
    pub fn delete_comment_projection(
        &self,
        expected_session_generation: u64,
        post_id: &str,
        comment_id: &str,
    ) -> Result<(), String> {
        if post_id.is_empty() || comment_id.is_empty() {
            return Err("private Comment deletion target is invalid".into());
        }
        let mut connection = self.connection()?;
        self.ensure_session_generation(expected_session_generation)?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let retained: Option<(String, Vec<u8>)> = tx
            .query_row(
                "SELECT post_id, projection_json FROM mobile_private_social_comment_projections WHERE comment_id = ?1",
                params![comment_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if retained
            .as_ref()
            .is_some_and(|(parent, _)| parent != post_id)
        {
            return Err("private Comment deletion parent is invalid".into());
        }
        let content_id = retained
            .as_ref()
            .map(|(_, bytes)| PrivateCommentProjection::decode(bytes))
            .transpose()?
            .map_or_else(|| comment_id.to_string(), |p| p.content_id);
        tx.execute(
            "INSERT INTO mobile_social_search_barriers VALUES('social-comment', ?1, ?2, 1)
             ON CONFLICT(kind, id) DO UPDATE SET tombstone = 1",
            params![comment_id, post_id],
        )
        .map_err(|e| e.to_string())?;
        remove(&tx, "social-comment", comment_id)?;
        tx.execute(
            "DELETE FROM mobile_social_search_pending WHERE kind = 'social-comment' AND id = ?1",
            params![comment_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM mobile_private_social_comment_projections WHERE comment_id = ?1 AND post_id = ?2",
            params![comment_id, post_id]).map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM mobile_private_social_roots WHERE content_id = ?1 AND post_id = ?2",
            params![content_id, post_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM mobile_private_social_comment_drafts WHERE comment_id = ?1 AND post_id = ?2",
            params![comment_id, post_id]).map_err(|e| e.to_string())?;
        bump(&tx)?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn comment_projection_window(
        &self,
        post_id: &str,
        anchor_comment_id: &str,
        limit: usize,
    ) -> Result<Vec<Vec<u8>>, String> {
        if limit == 0 || limit > SEARCH_BATCH_MAX || anchor_comment_id.is_empty() {
            return Err("private Comment anchor window is invalid".into());
        }
        let connection = self.connection()?;
        self.generation()?;
        if readable_post(&connection, post_id)?.is_none() {
            return Err("private Comment parent is unavailable".into());
        }
        let mut stmt = connection.prepare(
            "SELECT projection_json FROM mobile_private_social_comment_projections
             WHERE post_id = ?1 AND rowid >=
               (SELECT rowid FROM mobile_private_social_comment_projections WHERE post_id = ?1 AND comment_id = ?2)
             ORDER BY rowid LIMIT ?3",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![post_id, anchor_comment_id, limit], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn search_revision(&self) -> Result<String, String> {
        let connection = self.connection()?;
        let session = self.generation()?;
        connection.query_row(
            "SELECT generation, revision FROM mobile_social_search_progress WHERE singleton = 1",
            [], |row| Ok(format!("{session}:{}:{}", row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        ).map_err(|error| error.to_string())
    }

    pub fn search_authorities(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut stmt = connection
            .prepare("SELECT DISTINCT authority FROM mobile_social_search_documents LIMIT 100")
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn search_index_ready(&self) -> Result<bool, String> {
        self.connection()?
            .query_row(
                "SELECT phase = 2 AND NOT EXISTS(SELECT 1 FROM mobile_social_search_pending)
             FROM mobile_social_search_progress WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    /// Each batch releases the store lock; only original reconciliation calls this.
    pub fn backfill_search_index(
        &self,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<bool, String> {
        check()?;
        let mut connection = self.connection()?;
        let generation = self.generation()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let (phase, checkpoint): (i64, i64) = tx
            .query_row(
                "SELECT phase, checkpoint FROM mobile_social_search_progress WHERE singleton = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        if phase == 2 {
            return Ok(true);
        }
        let sql = if phase == 0 {
            "SELECT rowid, post_id, '', projection_json FROM mobile_private_social_read_projections WHERE rowid > ?1 ORDER BY rowid LIMIT ?2"
        } else {
            "SELECT rowid, comment_id, post_id, projection_json FROM mobile_private_social_comment_projections WHERE rowid > ?1 ORDER BY rowid LIMIT ?2"
        };
        let rows: Vec<(i64, String, String, Vec<u8>)> = {
            let mut stmt = tx.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![checkpoint, SEARCH_BACKFILL_MAX], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        for (_, id, parent, bytes) in &rows {
            // Retained tombstones win over legacy rows, including after restart.
            if tombstoned(
                &tx,
                if phase == 0 {
                    "social-post"
                } else {
                    "social-comment"
                },
                id,
            )? || (!parent.is_empty() && tombstoned(&tx, "social-post", parent)?)
            {
                continue;
            }
            if phase == 0 {
                update_post(&tx, id, bytes)?;
            } else {
                update_comment(&tx, id, parent, bytes)?;
            }
        }
        let next_phase = if rows.len() < SEARCH_BACKFILL_MAX {
            phase + 1
        } else {
            phase
        };
        let next_checkpoint = if next_phase != phase {
            0
        } else {
            rows.last().map_or(checkpoint, |r| r.0)
        };
        self.ensure_session_generation(generation)?;
        tx.execute("UPDATE mobile_social_search_progress SET phase = ?1, checkpoint = ?2, revision = revision + 1 WHERE singleton = 1",
            params![next_phase, next_checkpoint]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(connection);
        check()?;
        Ok(next_phase == 2)
    }

    pub fn search_documents(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<SearchBoundary<'_>>,
        limit: usize,
        deadline: std::time::Instant,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        self.search_documents_page(query, kinds, before, limit, deadline, check)
            .map(|page| page.documents)
    }

    pub fn search_documents_page(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<SearchBoundary<'_>>,
        limit: usize,
        deadline: std::time::Instant,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<SearchDocumentPage, String> {
        check()?;
        if limit == 0 || limit > SEARCH_BATCH_MAX {
            return Err("private Social search limit is invalid".into());
        }
        let expression = build_match_expression(query).map_err(|e| e.to_string())?;
        let connection = self.connection()?;
        self.generation()?;
        if std::time::Instant::now() >= deadline {
            return Err("private Social search deadline expired".into());
        }
        let mut remaining = SEARCH_SQL_INSTRUCTIONS_MAX / 1000;
        connection.progress_handler(
            1000,
            Some(move || {
                remaining = remaining.saturating_sub(1);
                remaining == 0 || std::time::Instant::now() >= deadline
            }),
        );
        let result = (|| {
            let (timestamp, kind, id) = before.unwrap_or((i64::MAX, "", ""));
            let post = kinds.is_empty() || kinds.contains(&ResultKind::SocialPost);
            let comment = kinds.is_empty() || kinds.contains(&ResultKind::SocialComment);
            let mut stmt = connection.prepare(
                "SELECT d.kind, d.id, d.authority, d.content_revision, d.created_at
                 FROM mobile_social_search_fts f JOIN mobile_social_search_documents d ON d.rowid = f.rowid
                 WHERE mobile_social_search_fts MATCH ?1
                   AND ((d.kind = 'social-post' AND ?2) OR (d.kind = 'social-comment' AND ?3))
                   AND (?4 OR d.created_at < ?5 OR (d.created_at = ?5 AND (d.kind, d.id) > (?6, ?7)))
                 ORDER BY d.created_at DESC, d.kind, d.id LIMIT ?8",
            ).map_err(|e| e.to_string())?;
            let mut refs = stmt
                .query_map(
                    params![
                        expression,
                        post,
                        comment,
                        before.is_none(),
                        timestamp,
                        kind,
                        id,
                        limit + 1
                    ],
                    |r| {
                        Ok((
                            ResourceRef {
                                kind: r.get(0)?,
                                id: r.get(1)?,
                                authority_namespace: r.get(2)?,
                                content_revision: r.get(3)?,
                                ..Default::default()
                            },
                            r.get::<_, i64>(4)?,
                        ))
                    },
                )
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let has_more = refs.len() > limit;
            refs.truncate(limit);
            let next_before = if has_more {
                refs.last().map(|(resource, timestamp)| {
                    (*timestamp, resource.kind.clone(), resource.id.clone())
                })
            } else {
                None
            };
            let mut docs = Vec::new();
            for (resource, _) in refs {
                if let Some(mut doc) = read_document(&connection, &resource)? {
                    doc.score = 1.0 / (docs.len() + 1) as f64;
                    docs.push(doc);
                }
            }
            Ok(SearchDocumentPage {
                documents: docs,
                next_before,
            })
        })();
        connection.progress_handler(0, None::<fn() -> bool>);
        drop(connection);
        check()?;
        result
    }

    pub fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        deadline: std::time::Instant,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        check()?;
        if refs.len() > SEARCH_BATCH_MAX {
            return Err("private Social hydration limit is invalid".into());
        }
        let connection = self.connection()?;
        self.generation()?;
        let mut docs = Vec::new();
        for resource in refs {
            if std::time::Instant::now() >= deadline {
                return Err("private Social hydration deadline expired".into());
            }
            let valid_anchor = resource.anchor.as_ref().is_some_and(|anchor| {
                anchor.id == resource.id
                    && anchor.kind
                        == if resource.kind == "social-post" {
                            "post"
                        } else {
                            "comment"
                        }
            });
            let valid_parent = match resource.kind.as_str() {
                "social-post" => resource.parent.is_none(),
                "social-comment" => resource.parent.as_ref().is_some_and(|parent| {
                    parent.kind == "social-post"
                        && !parent.id.is_empty()
                        && parent.authority_namespace == resource.authority_namespace
                }),
                _ => false,
            };
            if !valid_anchor || !valid_parent || resource.authority_namespace.is_empty() {
                return Err("private Social resource reference is invalid".into());
            }
            if let Some(doc) = read_document(&connection, resource)? {
                docs.push(doc);
            }
        }
        drop(connection);
        check()?;
        Ok(docs)
    }

    pub fn with_search_revision<T>(
        &self,
        expected: &str,
        publish: impl FnOnce() -> Result<T, search_core::SearchError>,
    ) -> Result<T, search_core::SearchError> {
        let connection = self
            .connection()
            .map_err(search_core::SearchError::SourceUnavailable)?;
        let session = self
            .generation()
            .map_err(search_core::SearchError::SourceUnavailable)?;
        let actual: String = connection.query_row(
            "SELECT generation, revision FROM mobile_social_search_progress WHERE singleton = 1", [],
            |r| Ok(format!("{session}:{}:{}", r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        ).map_err(|e| search_core::SearchError::SourceUnavailable(e.to_string()))?;
        if expected != actual {
            return Err(search_core::SearchError::SourceChanged);
        }
        publish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_content::receiver::PrivateReadContent;

    fn deadline() -> std::time::Instant {
        std::time::Instant::now() + std::time::Duration::from_secs(5)
    }

    fn store() -> PrivateSocialStore {
        let store = PrivateSocialStore::in_memory("station", "actor").unwrap();
        store.bind_session_generation(1).unwrap();
        store
    }

    fn post(id: &str, text: &str, created: i64) -> PrivateMomentReadProjection {
        PrivateMomentReadProjection {
            post_id: id.into(),
            authority_namespace: "social:station".into(),
            content_id: id.into(),
            generation: "1".into(),
            author_ptid: "author".into(),
            audience_kind: "FOLLOWERS".into(),
            state: PrivateReadState::ContentReady,
            mentions: vec![],
            reactions: vec![],
            reaction_revision: "0".into(),
            reactions_hydrated: false,
            content: Some(PrivateReadContent::Text { text: text.into() }),
            error_code: None,
            retry_after_seconds: None,
            created_at_millis: Some(created),
            updated_at_millis: Some(created),
        }
    }

    fn put_post(store: &PrivateSocialStore, p: &PrivateMomentReadProjection) {
        store
            .commit_receiver_projection(
                1,
                &p.content_id,
                1,
                &p.post_id,
                &[7; 32],
                None,
                &p.encode().unwrap(),
            )
            .unwrap();
    }

    fn comment(id: &str, parent: &str, text: &str, created: i64) -> PrivateCommentProjection {
        PrivateCommentProjection {
            comment_id: id.into(),
            content_id: id.into(),
            generation: "1".into(),
            post_id: parent.into(),
            reply_to_comment_id: String::new(),
            author_ptid: "comment-author".into(),
            state: "COMMENT_POSTED".into(),
            text: Some(text.into()),
            mentions: vec![],
            reactions_count: 0,
            replies_count: 0,
            created_at_millis: Some(created),
            updated_at_millis: Some(created),
        }
    }

    fn put_comment(store: &PrivateSocialStore, p: &PrivateCommentProjection) {
        store
            .commit_comment_receiver_projection(
                1,
                &p.content_id,
                1,
                &p.post_id,
                &p.comment_id,
                &[8; 32],
                None,
                &p.encode().unwrap(),
            )
            .unwrap();
    }

    fn search(store: &PrivateSocialStore, query: &str) -> Vec<ScoredDocument> {
        store
            .search_documents(query, &[], None, 100, deadline(), &|| Ok(()))
            .unwrap()
    }

    #[test]
    fn cjk_independent_comment_identity_and_typed_parent() {
        let store = store();
        put_post(
            &store,
            &post("post", "\u{5468}\u{672b}\u{5f92}\u{6b65} camino", 1),
        );
        put_comment(
            &store,
            &comment("comment", "post", "\u{5f92}\u{6b65} coffee", 2),
        );
        let docs = search(&store, "\u{5f92}\u{6b65}");
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].kind, ResultKind::SocialComment);
        assert_eq!(docs[0].resource.kind, "social-comment");
        assert_eq!(docs[0].resource.id, "comment");
        assert_eq!(docs[0].resource.anchor.as_ref().unwrap().kind, "comment");
        let parent = docs[0].resource.parent.as_ref().unwrap();
        assert_eq!(parent.kind, "social-post");
        assert_eq!(parent.id, "post");
        assert_eq!(
            parent.authority_namespace,
            docs[0].resource.authority_namespace
        );
        assert_ne!(parent.content_revision, docs[0].resource.content_revision);
        assert_eq!(search(&store, "camino")[0].resource.id, "post");
        assert_eq!(search(&store, "coffee")[0].resource.id, "comment");
    }

    #[test]
    fn revocation_removes_tokens_and_rejects_late_same_session_upserts() {
        let store = store();
        let p = post("post", "private secret", 1);
        let c = comment("comment", "post", "private secret", 2);
        put_post(&store, &p);
        put_comment(&store, &c);
        let old = store.search_revision().unwrap();
        let mut revoked = p.clone();
        revoked.state = PrivateReadState::DeletedOrRevoked;
        revoked.content = None;
        store
            .persist_receiver_failure(1, "post", &revoked.encode().unwrap(), true)
            .unwrap();
        assert!(search(&store, "secret").is_empty());
        assert!(store
            .commit_receiver_projection(1, "post", 1, "post", &[7; 32], None, &p.encode().unwrap())
            .is_err());
        assert!(store
            .commit_comment_receiver_projection(
                1,
                "comment",
                1,
                "post",
                "comment",
                &[8; 32],
                None,
                &c.encode().unwrap()
            )
            .is_err());
        assert!(store.content_root("post", 1).unwrap().is_none());
        assert!(store.with_search_revision(&old, || Ok(())).is_err());
        let tokens: i64 = store
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM mobile_social_search_fts", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(tokens, 0);
    }

    #[test]
    fn missing_keys_own_state_parent_deny_and_wrong_ref_fail_closed() {
        let store = store();
        put_post(&store, &post("post", "parent", 1));
        let mut c = comment("comment", "post", "needle", 2);
        put_comment(&store, &c);
        let mut resource = search(&store, "needle")[0].resource.clone();
        resource.parent.as_mut().unwrap().id = "other".into();
        assert!(store
            .search_read_resources(&[resource], deadline(), &|| Ok(()))
            .unwrap()
            .is_empty());
        let resource = search(&store, "needle")[0].resource.clone();
        store
            .connection()
            .unwrap()
            .execute(
                "DELETE FROM mobile_private_social_roots WHERE content_id = 'comment'",
                [],
            )
            .unwrap();
        assert!(store
            .search_read_resources(&[resource], deadline(), &|| Ok(()))
            .unwrap()
            .is_empty());
        put_comment(&store, &c);
        c.state = "COMMENT_PARENT_UNAVAILABLE".into();
        c.text = None;
        store
            .persist_comment_projection("comment", "post", &c.encode().unwrap())
            .unwrap();
        assert!(search(&store, "needle").is_empty());
        let mut denied = post("post", "", 1);
        denied.state = PrivateReadState::NotFoundOrNotAuthorized;
        denied.content = None;
        store
            .persist_receiver_failure(1, "post", &denied.encode().unwrap(), false)
            .unwrap();
        assert!(search(&store, "parent").is_empty());
    }

    #[test]
    fn deterministic_kind_boundary_and_edited_projection_revision() {
        let store = store();
        let mut p = post("post", "shared original", 3);
        put_post(&store, &p);
        put_comment(&store, &comment("comment", "post", "shared", 3));
        let first = store
            .search_documents("shared", &[], None, 1, deadline(), &|| Ok(()))
            .unwrap();
        let doc = &first[0];
        let second = store
            .search_documents(
                "shared",
                &[],
                Some((doc.created_at_unix_ms, &doc.resource.kind, &doc.resource.id)),
                1,
                deadline(),
                &|| Ok(()),
            )
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_ne!(doc.resource.id, second[0].resource.id);
        let old = search(&store, "original")[0].resource.clone();
        p.content = Some(PrivateReadContent::Text {
            text: "shared edited".into(),
        });
        put_post(&store, &p);
        assert!(search(&store, "original").is_empty());
        assert_eq!(search(&store, "edited").len(), 1);
        assert!(store
            .search_read_resources(&[old], deadline(), &|| Ok(()))
            .unwrap()
            .is_empty());
        assert!(store
            .search_documents("shared", &[], None, 101, deadline(), &|| Ok(()))
            .is_err());
        assert!(store
            .search_documents("shared", &[], None, 1, deadline(), &|| Err(
                "cancelled".into()
            ))
            .is_err());
    }

    #[test]
    fn backfill_releases_store_before_external_lifecycle_checks() {
        let store = store();
        let checks = std::cell::Cell::new(0);
        let check = || {
            let _connection = store
                .connection
                .try_lock()
                .map_err(|_| "lifecycle check cannot acquire the store".to_string())?;
            checks.set(checks.get() + 1);
            Ok(())
        };

        assert!(!store.backfill_search_index(&check).unwrap());
        assert!(store.backfill_search_index(&check).unwrap());
        assert_eq!(checks.get(), 4);
    }

    #[test]
    fn backfill_checkpoint_is_bounded_resumable_and_parent_arrival_reindexes_comments() {
        let store = store();
        {
            let connection = store.connection().unwrap();
            for n in 0..129 {
                let p = post(&format!("post-{n}"), "legacy needle", n);
                connection
                    .execute(
                        "INSERT INTO mobile_private_social_roots VALUES(?1, 1, ?1, ?2, 1)",
                        params![p.post_id, [7_u8; 32].as_slice()],
                    )
                    .unwrap();
                connection.execute(
                    "INSERT INTO mobile_private_social_read_projections VALUES(?1, ?1, 1, ?2, 1)",
                    params![p.post_id, p.encode().unwrap()],
                ).unwrap();
            }
        }
        assert!(!store.backfill_search_index(&|| Ok(())).unwrap());
        let checkpoint: i64 = store
            .connection()
            .unwrap()
            .query_row(
                "SELECT checkpoint FROM mobile_social_search_progress",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(checkpoint, 128);
        assert!(!store.search_index_ready().unwrap());
        assert!(store
            .backfill_search_index(&|| Err("cancelled".into()))
            .is_err());
        while !store.backfill_search_index(&|| Ok(())).unwrap() {}
        assert!(store.search_index_ready().unwrap());
        let c = comment("orphan", "late-parent", "orphan needle", 200);
        put_comment(&store, &c);
        assert!(search(&store, "orphan").is_empty());
        put_post(&store, &post("late-parent", "late", 199));
        assert!(!store.search_index_ready().unwrap());
        while !store.backfill_search_index(&|| Ok(())).unwrap() {}
        assert_eq!(search(&store, "orphan").len(), 1);
    }

    #[test]
    fn comment_delete_is_atomic_and_cannot_be_resurrected_by_backfill() {
        let store = store();
        put_post(&store, &post("post", "parent", 1));
        let c = comment("comment", "post", "needle", 2);
        put_comment(&store, &c);
        assert!(store
            .delete_comment_projection(1, "wrong-parent", "comment")
            .is_err());
        assert_eq!(search(&store, "needle").len(), 1);
        store
            .delete_comment_projection(1, "post", "comment")
            .unwrap();
        assert!(search(&store, "needle").is_empty());
        assert!(store.comment_projection("comment").unwrap().is_none());
        assert!(store.content_root("comment", 1).unwrap().is_none());
        assert!(store.content_root("post", 1).unwrap().is_some());
        assert!(store
            .commit_comment_receiver_projection(
                1,
                "comment",
                1,
                "post",
                "comment",
                &[8; 32],
                None,
                &c.encode().unwrap(),
            )
            .is_err());
        while !store.backfill_search_index(&|| Ok(())).unwrap() {}
        assert!(search(&store, "needle").is_empty());
    }

    #[test]
    fn comment_deletion_uses_original_content_identity_not_comment_identity() {
        let store = store();
        put_post(&store, &post("post", "parent", 1));
        let mut c = comment("comment", "post", "needle", 2);
        c.content_id = "comment-content".into();
        put_comment(&store, &c);
        assert_eq!(search(&store, "needle").len(), 1);
        store
            .delete_comment_projection(1, "post", "comment")
            .unwrap();
        assert!(store.content_root("comment-content", 1).unwrap().is_none());
        assert!(store.content_root("post", 1).unwrap().is_some());
        assert!(search(&store, "needle").is_empty());
    }

    #[test]
    fn unknown_legacy_authority_stays_recovering_until_original_point_read() {
        let store = store();
        let mut p = post("post", "needle", 1);
        p.authority_namespace.clear();
        put_post(&store, &p);
        while !store.backfill_search_index(&|| Ok(())).unwrap() {}
        assert!(!store.search_index_ready().unwrap());
        assert!(search(&store, "needle").is_empty());
        p.authority_namespace = "social:station".into();
        put_post(&store, &p);
        while !store.backfill_search_index(&|| Ok(())).unwrap() {}
        assert!(store.search_index_ready().unwrap());
        assert_eq!(search(&store, "needle").len(), 1);
    }

    #[test]
    fn policy_batch_requires_exact_ids_and_known_decisions_without_an_offline_lease() {
        use crate::secure_content::proto::social::v1 as social;
        use crate::secure_content::transport::validated_moment_read_decisions;
        let request = social::CheckMomentReadPolicyRequest {
            targets: vec![
                social::MomentReadPolicyTarget {
                    item_id: "post-item".into(),
                    post_id: "post".into(),
                    comment_id: "".into(),
                },
                social::MomentReadPolicyTarget {
                    item_id: "comment-item".into(),
                    post_id: "post".into(),
                    comment_id: "comment".into(),
                },
            ],
        };
        let response = social::CheckMomentReadPolicyResponse {
            outcomes: vec![
                social::MomentReadPolicyOutcome {
                    item_id: "comment-item".into(),
                    decision: social::MomentReadDecision::Unavailable as i32,
                },
                social::MomentReadPolicyOutcome {
                    item_id: "post-item".into(),
                    decision: social::MomentReadDecision::Readable as i32,
                },
            ],
        };
        assert_eq!(
            validated_moment_read_decisions(&request, &response).unwrap(),
            vec![true, false]
        );
        let mut missing = response.clone();
        missing.outcomes.pop();
        assert!(validated_moment_read_decisions(&request, &missing).is_err());
        let mut duplicate = response.clone();
        duplicate.outcomes[1] = duplicate.outcomes[0].clone();
        assert!(validated_moment_read_decisions(&request, &duplicate).is_err());
        let mut extra = response.clone();
        extra.outcomes.push(extra.outcomes[0].clone());
        assert!(validated_moment_read_decisions(&request, &extra).is_err());
        let mut foreign = response.clone();
        foreign.outcomes[0].item_id = "foreign".into();
        assert!(validated_moment_read_decisions(&request, &foreign).is_err());
        for decision in [0, 999] {
            let mut unknown = response.clone();
            unknown.outcomes[0].decision = decision;
            assert!(validated_moment_read_decisions(&request, &unknown).is_err());
        }
        let mut invalid_request = request.clone();
        invalid_request.targets[1].item_id = invalid_request.targets[0].item_id.clone();
        assert!(validated_moment_read_decisions(&invalid_request, &response).is_err());
    }

    #[test]
    fn anchor_window_reads_a_bounded_historical_target_not_the_first_page() {
        let store = store();
        put_post(&store, &post("post", "parent", 1));
        for n in 0..150 {
            put_comment(&store, &comment(&format!("comment-{n}"), "post", "text", n));
        }
        let rows = store
            .comment_projection_window("post", "comment-120", 3)
            .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(
            PrivateCommentProjection::decode(&rows[0])
                .unwrap()
                .comment_id,
            "comment-120"
        );
        assert!(store
            .comment_projection_window("post", "missing", 3)
            .unwrap()
            .is_empty());
        assert!(store
            .comment_projection_window("post", "comment-120", 101)
            .is_err());
        let connection = store.connection().unwrap();
        let mut plan = connection.prepare(
            "EXPLAIN QUERY PLAN SELECT projection_json FROM mobile_private_social_comment_projections
             WHERE post_id = 'post' AND rowid >= 120 ORDER BY rowid LIMIT 3",
        ).unwrap();
        let plan = plan
            .query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join(" ");
        assert!(plan.contains("mobile_social_comment_window"));
    }
}
