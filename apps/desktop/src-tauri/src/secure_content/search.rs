//! Bounded derived FTS reads in the original SQLCipher owner.

use std::sync::atomic::Ordering;
use std::sync::{MutexGuard, TryLockError};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use search_core::{ResourceRef, ResultKind, ScoredDocument, SearchError};

use crate::social::search_projection::{self, COMMENT, POST};

use super::store::SecureContentStore;

pub const SEARCH_BATCH_MAX: usize = 100;
pub const SEARCH_BACKFILL_MAX: usize = 128;
const MAX_TARGET_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchIndexProgress {
    pub generation: u64,
    pub posts_through: i64,
    pub comments_through: i64,
    pub ready: bool,
}

pub struct SearchTargetWindow {
    pub post_projection: Vec<u8>,
    pub comment_projections: Vec<Vec<u8>>,
}

pub struct SearchDocumentPage {
    pub documents: Vec<ScoredDocument>,
    /// Last scanned original row, not the last policy-readable result.
    /// None means exhaustion was established with a bounded metadata lookahead.
    pub next_before: Option<(i64, String, String)>,
}

pub(super) struct SearchCandidatePage {
    pub resources: Vec<ResourceRef>,
    pub next_before: Option<(i64, String, String)>,
}

// This is local integrity/readiness, not a server grant. Only the headless
// binding can publish documents, after one fresh original-domain policy batch.
const READABLE: &str = "
 ?1 != 0 AND d.readable = 1
 AND EXISTS (SELECT 1 FROM secure_content_roots r
             WHERE r.content_id = d.content_id AND r.generation = d.generation AND r.post_id = d.post_id)
 AND NOT EXISTS (SELECT 1 FROM secure_content_search_denials x
                 WHERE (x.kind = 'social-post' AND x.id = d.post_id)
                    OR (x.kind = d.kind AND x.id = d.id)
                    OR (d.kind = 'social-comment' AND x.kind = 'comment_thread' AND x.id = d.post_id))
 AND (d.kind = 'social-post' OR EXISTS (
   SELECT 1 FROM secure_content_search_documents p
   WHERE p.kind = 'social-post' AND p.id = d.post_id AND p.readable = 1
     AND EXISTS (SELECT 1 FROM secure_content_roots r
                 WHERE r.content_id = p.content_id AND r.generation = p.generation AND r.post_id = p.post_id)
 ))";

pub(super) fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS secure_content_search_state (
           singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
           generation INTEGER NOT NULL,
           source_revision INTEGER NOT NULL,
           policy_revision INTEGER NOT NULL,
           posts_through INTEGER NOT NULL,
           comments_through INTEGER NOT NULL,
           posts_snapshot INTEGER NOT NULL,
           comments_snapshot INTEGER NOT NULL,
           ready INTEGER NOT NULL CHECK(ready IN (0, 1))
         );
         INSERT OR IGNORE INTO secure_content_search_state
           SELECT 1, 1, 0, 1, 0, 0,
             COALESCE((SELECT MAX(rowid) FROM secure_content_moment_projections), 0),
             COALESCE((SELECT MAX(rowid) FROM secure_content_comment_projections), 0),
             NOT EXISTS(SELECT 1 FROM secure_content_moment_projections)
               AND NOT EXISTS(SELECT 1 FROM secure_content_comment_projections);
         CREATE TABLE IF NOT EXISTS secure_content_search_documents (
           kind TEXT NOT NULL,
           id TEXT NOT NULL,
           post_id TEXT NOT NULL,
           content_id TEXT NOT NULL,
           generation INTEGER NOT NULL,
           revision TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           readable INTEGER NOT NULL CHECK(readable IN (0, 1)),
           PRIMARY KEY(kind, id)
         );
         CREATE INDEX IF NOT EXISTS idx_secure_content_search_parent
           ON secure_content_search_documents(post_id, kind, created_at, id);
         CREATE VIRTUAL TABLE IF NOT EXISTS secure_content_social_search_fts USING fts5(
           kind UNINDEXED, id UNINDEXED, tokens, tokenize = 'unicode61'
         );
         CREATE TABLE IF NOT EXISTS secure_content_search_denials (
           kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
           PRIMARY KEY(kind, id)
         );",
        )
        .map_err(|error| error.to_string())
}

fn bump(connection: &Connection, policy: bool) -> Result<(), String> {
    connection
        .execute(
            "UPDATE secure_content_search_state
         SET source_revision = source_revision + 1,
             policy_revision = policy_revision + ?1 WHERE singleton = 1",
            params![policy],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(super) fn ensure_not_denied(
    connection: &Connection,
    kind: &str,
    id: &str,
    post_id: &str,
    generation: Option<u64>,
) -> Result<(), String> {
    let denied: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM secure_content_search_denials
         WHERE (kind = 'social-post' AND id = ?3) OR (kind = ?1 AND id = ?2)
            OR (?1 = 'social-comment' AND kind = 'comment_thread' AND id = ?3))
         OR EXISTS(SELECT 1 FROM secure_content_pending_purges WHERE post_id = ?3)",
            params![kind, id, post_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if denied {
        return Err("private Social resource is unavailable".to_string());
    }
    if let Some(generation) = generation {
        let current: Option<i64> = connection
            .query_row(
                "SELECT MAX(generation) FROM (
               SELECT generation FROM secure_content_search_documents WHERE kind = ?1 AND id = ?2
               UNION ALL SELECT generation FROM secure_content_moment_projections
                 WHERE ?1 = 'social-post' AND post_id = ?2
               UNION ALL SELECT generation FROM secure_content_comment_projections
                 WHERE ?1 = 'social-comment' AND comment_id = ?2 AND post_id = ?3)",
                params![kind, id, post_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if current.is_some_and(|current| generation < current as u64) {
            return Err("private Social projection revision is stale".to_string());
        }
    }
    Ok(())
}

pub(super) fn refresh(
    connection: &Connection,
    kind: &str,
    id: &str,
    post_id: &str,
    content_id: &str,
    generation: u64,
    bytes: &[u8],
) -> Result<(), String> {
    ensure_not_denied(connection, kind, id, post_id, Some(generation))?;
    let projection = search_projection::decode(kind, id, post_id, bytes).filter(|projection| {
        projection.content_id == content_id && projection.generation == generation
    });
    let revision = projection
        .as_ref()
        .map(|p| p.document.resource.content_revision.as_str())
        .unwrap_or("");
    let created_at = projection
        .as_ref()
        .map(|p| p.document.created_at_unix_ms)
        .unwrap_or(0);
    let unchanged: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM secure_content_search_documents
             WHERE kind = ?1 AND id = ?2 AND post_id = ?3 AND content_id = ?4
               AND generation = ?5 AND revision = ?6 AND created_at = ?7 AND readable = ?8)",
            params![
                kind, id, post_id, content_id, generation as i64,
                revision, created_at, projection.is_some(),
            ],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    // Replayed/read-back projections are not new content. The original denial
    // and generation checks above still precede this idempotent index update.
    if unchanged {
        return Ok(());
    }
    connection
        .execute(
            "DELETE FROM secure_content_social_search_fts WHERE kind = ?1 AND id = ?2",
            params![kind, id],
        )
        .map_err(|error| error.to_string())?;
    // Invalid/unavailable projections retain only a deny/read-state row.
    connection
        .execute(
            "INSERT INTO secure_content_search_documents
           (kind, id, post_id, content_id, generation, revision, created_at,
            readable)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(kind, id) DO UPDATE SET
           post_id = excluded.post_id, content_id = excluded.content_id,
           generation = excluded.generation, revision = excluded.revision,
           created_at = excluded.created_at, readable = excluded.readable",
            params![
                kind,
                id,
                post_id,
                content_id,
                generation as i64,
                revision,
                created_at,
                projection.is_some(),
            ],
        )
        .map_err(|error| error.to_string())?;
    if let Some(projection) = projection {
        connection
            .execute(
                "INSERT INTO secure_content_social_search_fts(kind, id, tokens) VALUES(?1, ?2, ?3)",
                params![kind, id, search_core::build_index_text(&projection.text)],
            )
            .map_err(|error| error.to_string())?;
    }
    bump(connection, false)
}

pub(super) fn refresh_existing_post(
    connection: &Connection,
    post_id: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let original: Option<(String, i64)> = connection.query_row(
        "SELECT content_id, generation FROM secure_content_moment_projections WHERE post_id = ?1",
        params![post_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(|error| error.to_string())?;
    let Some((content_id, generation)) = original else {
        return Ok(());
    };
    refresh(
        connection,
        POST,
        post_id,
        post_id,
        &content_id,
        generation as u64,
        bytes,
    )
}

pub(super) fn deny(connection: &Connection, kind: &str, id: &str) -> Result<(), String> {
    connection.execute(
        "INSERT INTO secure_content_search_denials(kind, id, revision)
         VALUES(?1, ?2, (SELECT source_revision + 1 FROM secure_content_search_state WHERE singleton = 1))
         ON CONFLICT(kind, id) DO UPDATE SET revision = excluded.revision",
        params![kind, id],
    ).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM secure_content_social_search_fts WHERE (kind, id) IN (
         SELECT kind, id FROM secure_content_search_documents
         WHERE (kind = ?1 AND id = ?2) OR (?1 = 'social-post' AND post_id = ?2)
            OR (?1 = 'comment_thread' AND kind = 'social-comment' AND post_id = ?2))",
            params![kind, id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE secure_content_search_documents SET readable = 0
         WHERE (kind = ?1 AND id = ?2) OR (?1 = 'social-post' AND post_id = ?2)
            OR (?1 = 'comment_thread' AND kind = 'social-comment' AND post_id = ?2)",
            params![kind, id],
        )
        .map_err(|error| error.to_string())?;
    // A denial changes both source and local read-policy watermarks.
    bump(connection, true)
}

fn revision(connection: &Connection, session: u64, policy: bool) -> Result<String, String> {
    let data_version: i64 = connection
        .query_row("PRAGMA data_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let (generation, source, policy_revision, bound): (i64, i64, i64, i64) = connection.query_row(
        "SELECT s.generation, s.source_revision, s.policy_revision, r.session_generation
         FROM secure_content_search_state s JOIN secure_content_runtime_state r ON r.singleton = s.singleton",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|error| error.to_string())?;
    if session == 0 || bound != session as i64 {
        return Err("private Social search session is unavailable".to_string());
    }
    Ok(format!(
        "{generation}:{session}:{data_version}:{}:{policy_revision}",
        if policy { 0 } else { source }
    ))
}

fn progress(connection: &Connection) -> Result<SearchIndexProgress, String> {
    connection
        .query_row(
            "SELECT generation, posts_through, comments_through, ready
         FROM secure_content_search_state WHERE singleton = 1",
            [],
            |row| {
                Ok(SearchIndexProgress {
                    generation: row.get::<_, i64>(0)? as u64,
                    posts_through: row.get(1)?,
                    comments_through: row.get(2)?,
                    ready: row.get(3)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

fn validate_limit(limit: usize) -> Result<(), String> {
    if limit == 0 || limit > SEARCH_BATCH_MAX {
        return Err("private Social search batch exceeds its bound".to_string());
    }
    Ok(())
}

// The caller holds the original Store mutex throughout. An interrupt can only
// affect this read, never a neighboring writer or another owner's operation.
fn bounded_sql_read<T>(
    connection: &Connection,
    check: &(dyn Fn() -> Result<(), String> + Sync),
    read: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    check()?;
    let interrupt = connection.get_interrupt_handle();
    std::thread::scope(|scope| {
        let (stop, stopped) = std::sync::mpsc::channel::<()>();
        scope.spawn(move || loop {
            match stopped.recv_timeout(Duration::from_millis(10)) {
                Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if check().is_err() {
                        interrupt.interrupt();
                        break;
                    }
                }
            }
        });
        let result = read();
        drop(stop);
        result
    })
}

fn read_document(
    connection: &Connection,
    kind: &str,
    id: &str,
    post_id: &str,
) -> Result<Option<ScoredDocument>, String> {
    let sql = match kind {
        POST => {
            "SELECT projection_bytes FROM secure_content_moment_projections
                 WHERE post_id = ?1 AND length(projection_bytes) <= 262144"
        }
        COMMENT => {
            "SELECT projection_bytes FROM secure_content_comment_projections
                    WHERE comment_id = ?1 AND post_id = ?2 AND length(projection_bytes) <= 262144"
        }
        _ => return Ok(None),
    };
    let bytes: Option<Vec<u8>> = if kind == POST {
        connection
            .query_row(sql, params![id], |row| row.get(0))
            .optional()
    } else {
        connection
            .query_row(sql, params![id, post_id], |row| row.get(0))
            .optional()
    }
    .map_err(|error| error.to_string())?;
    let mut document = bytes
        .and_then(|bytes| search_projection::decode(kind, id, post_id, &bytes))
        .map(|p| p.document);
    if kind == COMMENT {
        let Some(parent) = read_document(connection, POST, post_id, post_id)? else {
            return Ok(None);
        };
        if let Some(comment) = document.as_mut() {
            comment.title = parent.title;
        }
    }
    Ok(document)
}

impl SecureContentStore {
    fn search_connection(
        &self,
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<MutexGuard<'_, Connection>, String> {
        loop {
            check()?;
            match self.connection.try_lock() {
                Ok(connection) => return Ok(connection),
                Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(1)),
                Err(TryLockError::Poisoned(_)) => {
                    return Err("secure content store lock poisoned".to_string())
                }
            }
        }
    }

    pub(super) fn search_revision_checked(
        &self,
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<String, String> {
        let connection = self.search_connection(check)?;
        revision(
            &connection,
            self.session_generation.load(Ordering::Acquire),
            false,
        )
    }

    pub fn search_revision(&self) -> Result<String, String> {
        let connection = self.connection()?;
        revision(
            &connection,
            self.session_generation.load(Ordering::Acquire),
            false,
        )
    }

    pub fn search_policy_revision(&self) -> Result<String, String> {
        let connection = self.connection()?;
        revision(
            &connection,
            self.session_generation.load(Ordering::Acquire),
            true,
        )
    }

    pub fn search_index_ready(&self) -> Result<bool, String> {
        Ok(self.search_index_progress()?.ready)
    }

    pub fn search_index_progress(&self) -> Result<SearchIndexProgress, String> {
        let connection = self.connection()?;
        progress(&connection)
    }

    /// Host policy stream gaps/offline uncertainty invalidate in-flight reads.
    /// Every subsequent read still requires a fresh server batch, never a lease.
    pub fn invalidate_search_policy(&self) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        bump(&transaction, true)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn purge_private_comment_material(
        &self,
        post_id: &str,
        comment_id: &str,
    ) -> Result<(), String> {
        if post_id.is_empty() || comment_id.is_empty() {
            return Err("private Social resource is unavailable".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        deny(&transaction, COMMENT, comment_id)?;
        transaction
            .execute(
                "DELETE FROM secure_content_roots WHERE (content_id, generation) IN (
             SELECT content_id, generation FROM secure_content_comment_projections
             WHERE post_id = ?1 AND comment_id = ?2)",
                params![post_id, comment_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.execute(
            "DELETE FROM secure_content_comment_projections WHERE post_id = ?1 AND comment_id = ?2",
            params![post_id, comment_id],
        ).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    /// Hold after identity/supervisor gates, only for cache/bytes publication.
    /// The closure must not call any Store or Supervisor method.
    pub fn with_search_revision<T>(
        &self,
        expected: &str,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let connection = self.connection().map_err(SearchError::SourceUnavailable)?;
        if revision(
            &connection,
            self.session_generation.load(Ordering::Acquire),
            false,
        )
        .map_err(SearchError::SourceUnavailable)?
            != expected
        {
            return Err(SearchError::SourceChanged);
        }
        publish()
    }

    /// Stable temporal keyset within the original source revision. No raw FTS
    /// syntax, unbounded candidate decode, or query-time backfill is allowed.
    pub(super) fn search_candidate_refs(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<(i64, &str, &str)>,
        limit: usize,
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<SearchCandidatePage, String> {
        validate_limit(limit)?;
        let expression =
            search_core::build_match_expression(query).map_err(|error| error.to_string())?;
        let posts = kinds.is_empty() || kinds.contains(&ResultKind::SocialPost);
        let comments = kinds.is_empty() || kinds.contains(&ResultKind::SocialComment);
        check()?;
        let connection = self.search_connection(check)?;
        let session = self.session_generation.load(Ordering::Acquire);
        revision(&connection, session, false)?;
        bounded_sql_read(&connection, check, || {
            let sql = format!(
            "SELECT d.kind, d.id, d.post_id, d.revision, d.created_at FROM secure_content_social_search_fts f
             JOIN secure_content_search_documents d ON d.kind = f.kind AND d.id = f.id
             WHERE secure_content_social_search_fts MATCH ?2 AND {READABLE}
               AND ((?3 AND d.kind = 'social-post') OR (?4 AND d.kind = 'social-comment'))
               AND (?5 OR (d.created_at, d.kind, d.id) < (?6, ?7, ?8))
             ORDER BY d.created_at DESC, d.kind DESC, d.id DESC LIMIT ?9"
        );
            let (time, kind, id) = before.unwrap_or((0, "", ""));
            let mut statement = connection
                .prepare(&sql)
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(
                    params![
                        session as i64,
                        expression,
                        posts,
                        comments,
                        before.is_none(),
                        time,
                        kind,
                        id,
                        (limit + 1) as i64
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )
                .map_err(|error| error.to_string())?;
            let mut resources = Vec::new();
            let mut last_scanned = None;
            let mut more = false;
            for row in rows {
                check()?;
                let (kind, id, post_id, revision, created) =
                    row.map_err(|error| error.to_string())?;
                if resources.len() == limit {
                    more = true;
                    break;
                }
                last_scanned = Some((created, kind.clone(), id.clone()));
                resources.push(search_projection::resource_ref(
                    &kind, &id, &post_id, &revision,
                ));
            }
            check()?;
            Ok(SearchCandidatePage {
                resources,
                next_before: if more { last_scanned } else { None },
            })
        })
    }

    pub(super) fn search_resource_refs(
        &self,
        refs: &[ResourceRef],
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<Vec<ResourceRef>, String> {
        if refs.is_empty() {
            return Ok(Vec::new());
        }
        validate_limit(refs.len())?;
        let wanted = refs.iter().filter(|resource| {
            resource.authority_namespace == search_projection::AUTHORITY
                && !resource.id.is_empty() && resource.conversation_id.is_empty()
                && resource.message_id.is_empty() && resource.target_page.is_empty()
                && match resource.kind.as_str() {
                    POST => resource.parent.is_none()
                        && resource.anchor.as_ref().map_or(true, |anchor| {
                            anchor.kind == "post" && anchor.id == resource.id
                        }),
                    COMMENT => resource.anchor.as_ref().is_some_and(|anchor| {
                        anchor.kind == "comment" && anchor.id == resource.id
                    }) && resource.parent.as_ref().is_some_and(|parent| {
                        parent.kind == POST && parent.authority_namespace == search_projection::AUTHORITY
                            && !parent.id.is_empty()
                            && parent.parent.is_none() && parent.conversation_id.is_empty()
                            && parent.message_id.is_empty() && parent.target_page.is_empty()
                    }),
                    _ => false,
                }
        }).map(|resource| serde_json::json!({
            "kind": resource.kind, "id": resource.id,
            "post_id": resource.parent.as_ref().map(|parent| parent.id.as_str()).unwrap_or(&resource.id),
        })).collect::<Vec<_>>();
        let wanted = serde_json::to_string(&wanted).map_err(|error| error.to_string())?;
        check()?;
        let connection = self.search_connection(check)?;
        let session = self.session_generation.load(Ordering::Acquire);
        revision(&connection, session, false)?;
        bounded_sql_read(&connection, check, || {
            let sql = format!(
            "SELECT DISTINCT d.kind, d.id, d.post_id, d.revision FROM json_each(?2) w
             JOIN secure_content_search_documents d ON d.kind = json_extract(w.value, '$.kind')
               AND d.id = json_extract(w.value, '$.id') AND d.post_id = json_extract(w.value, '$.post_id')
             WHERE {READABLE} LIMIT ?3"
        );
            let mut statement = connection
                .prepare(&sql)
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(
                    params![session as i64, wanted, SEARCH_BATCH_MAX as i64],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .map_err(|error| error.to_string())?;
            let mut resources = Vec::new();
            for row in rows {
                check()?;
                let (kind, id, post_id, revision) = row.map_err(|error| error.to_string())?;
                resources.push(search_projection::resource_ref(
                    &kind, &id, &post_id, &revision,
                ));
            }
            check()?;
            Ok(resources)
        })
    }

    /// Only the sibling policy reader calls this with freshly authorized refs.
    pub(super) fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<Vec<ScoredDocument>, String> {
        let resources = self.search_resource_refs(refs, check)?;
        let connection = self.search_connection(check)?;
        revision(
            &connection,
            self.session_generation.load(Ordering::Acquire),
            false,
        )?;
        let mut documents = Vec::new();
        for resource in resources {
            check()?;
            let post_id = resource
                .parent
                .as_ref()
                .map(|p| p.id.as_str())
                .unwrap_or(&resource.id);
            if let Some(document) =
                read_document(&connection, &resource.kind, &resource.id, post_id)?
            {
                documents.push(document);
            }
        }
        check()?;
        Ok(documents)
    }

    /// Bounded original-domain target IDs, without decoding any plaintext.
    pub(super) fn search_target_refs(
        &self,
        post_id: &str,
        anchor_comment_id: Option<&str>,
        limit: usize,
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<Vec<ResourceRef>, String> {
        validate_limit(limit)?;
        // Reserve one policy item for the parent.
        let limit = limit.min(SEARCH_BATCH_MAX - 1);
        check()?;
        let connection = self.search_connection(check)?;
        let session = self.session_generation.load(Ordering::Acquire);
        revision(&connection, session, false)?;
        bounded_sql_read(&connection, check, || {
            let sql = format!(
                "SELECT d.revision FROM secure_content_search_documents d
             WHERE {READABLE} AND d.kind = 'social-post' AND d.id = ?2"
            );
            let parent_revision: Option<String> = connection
                .query_row(&sql, params![session as i64, post_id], |row| row.get(0))
                .optional()
                .map_err(|error| error.to_string())?;
            let Some(parent_revision) = parent_revision else {
                return Ok(Vec::new());
            };
            let mut resources = vec![search_projection::resource_ref(
                POST,
                post_id,
                post_id,
                &parent_revision,
            )];
            if let Some(anchor) = anchor_comment_id {
                let sql = format!(
                    "SELECT d.created_at FROM secure_content_search_documents d WHERE {READABLE}
                 AND d.kind = 'social-comment' AND d.post_id = ?2 AND d.id = ?3"
                );
                let anchor_time: Option<i64> = connection
                    .query_row(&sql, params![session as i64, post_id, anchor], |row| {
                        row.get(0)
                    })
                    .optional()
                    .map_err(|error| error.to_string())?;
                let Some(anchor_time) = anchor_time else {
                    return Ok(Vec::new());
                };
                let sql = format!(
                    "WITH older AS (
                   SELECT d.id, d.created_at, d.revision FROM secure_content_search_documents d
                   WHERE {READABLE} AND d.kind = 'social-comment' AND d.post_id = ?2
                     AND (d.created_at, d.id) < (?3, ?4)
                   ORDER BY d.created_at DESC, d.id DESC LIMIT ?5),
                 newer AS (
                   SELECT d.id, d.created_at, d.revision FROM secure_content_search_documents d
                   WHERE {READABLE} AND d.kind = 'social-comment' AND d.post_id = ?2
                     AND (d.created_at, d.id) >= (?3, ?4)
                   ORDER BY d.created_at, d.id LIMIT ?6)
                 SELECT w.id, w.revision FROM (
                   SELECT * FROM older UNION ALL SELECT * FROM newer) w
                 ORDER BY w.created_at, w.id"
                );
                let mut statement = connection
                    .prepare(&sql)
                    .map_err(|error| error.to_string())?;
                let rows = statement
                    .query_map(
                        params![
                            session as i64,
                            post_id,
                            anchor_time,
                            anchor,
                            (limit / 2) as i64,
                            (limit - limit / 2) as i64
                        ],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .map_err(|error| error.to_string())?;
                let mut found = false;
                for row in rows {
                    check()?;
                    let (id, revision) = row.map_err(|error| error.to_string())?;
                    found |= id == anchor;
                    resources.push(search_projection::resource_ref(
                        COMMENT, &id, post_id, &revision,
                    ));
                }
                if !found {
                    return Ok(Vec::new());
                }
            }
            check()?;
            Ok(resources)
        })
    }

    /// Decode only the already batch-authorized bounded original target refs.
    pub(super) fn search_read_target_window(
        &self,
        post_id: &str,
        anchor_comment_id: Option<&str>,
        authorized: &[ResourceRef],
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<Option<SearchTargetWindow>, String> {
        if authorized.is_empty() {
            return Ok(None);
        }
        validate_limit(authorized.len())?;
        check()?;
        let connection = self.search_connection(check)?;
        let session = self.session_generation.load(Ordering::Acquire);
        revision(&connection, session, false)?;
        bounded_sql_read(&connection, check, || {
            let mut post_projection = None;
            let mut comment_projections = Vec::new();
            let mut found = anchor_comment_id.is_none();
            let mut bytes_read = 0usize;
            for resource in authorized {
                check()?;
                let parent_id = resource
                    .parent
                    .as_ref()
                    .map(|p| p.id.as_str())
                    .unwrap_or(&resource.id);
                if parent_id != post_id {
                    return Err("private Social target parent mismatch".to_string());
                }
                let sql = format!(
                    "SELECT EXISTS(SELECT 1 FROM secure_content_search_documents d WHERE {READABLE}
                 AND d.kind = ?2 AND d.id = ?3 AND d.post_id = ?4 AND d.revision = ?5)"
                );
                let current: bool = connection
                    .query_row(
                        &sql,
                        params![
                            session as i64,
                            resource.kind,
                            resource.id,
                            post_id,
                            resource.content_revision
                        ],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                if !current {
                    continue;
                }
                let bytes: Option<Vec<u8>> = if resource.kind == POST {
                    connection
                        .query_row(
                            "SELECT projection_bytes FROM secure_content_moment_projections
                     WHERE post_id = ?1 AND length(projection_bytes) <= 262144",
                            params![post_id],
                            |row| row.get(0),
                        )
                        .optional()
                } else if resource.kind == COMMENT {
                    connection
                        .query_row(
                            "SELECT projection_bytes FROM secure_content_comment_projections
                     WHERE post_id = ?1 AND comment_id = ?2 AND length(projection_bytes) <= 262144",
                            params![post_id, resource.id],
                            |row| row.get(0),
                        )
                        .optional()
                } else {
                    return Err("private Social target kind is invalid".to_string());
                }
                .map_err(|error| error.to_string())?;
                let Some(bytes) = bytes else { continue };
                if search_projection::decode(&resource.kind, &resource.id, post_id, &bytes)
                    .is_none()
                {
                    continue;
                }
                bytes_read = bytes_read.saturating_add(bytes.len());
                if bytes_read > MAX_TARGET_BYTES {
                    return Err("private Social target window exceeds its byte bound".to_string());
                }
                if resource.kind == POST {
                    post_projection = Some(search_projection::scrub_post_target(&bytes)?);
                } else {
                    found |= anchor_comment_id == Some(resource.id.as_str());
                    comment_projections.push(bytes);
                }
            }
            check()?;
            let Some(post_projection) = post_projection.filter(|_| found) else {
                return Ok(None);
            };
            Ok(Some(SearchTargetWindow {
                post_projection,
                comment_projections,
            }))
        })
    }

    /// Original-owner background recovery: each call advances at most 128
    /// snapshot rows and commits its checkpoint with the derived writes.
    pub fn search_backfill_batch(
        &self,
        limit: usize,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<SearchIndexProgress, String> {
        if limit == 0 || limit > SEARCH_BACKFILL_MAX {
            return Err("private Social backfill batch exceeds its bound".to_string());
        }
        check()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let current = progress(&transaction)?;
        if current.ready {
            return Ok(current);
        }
        let mut remaining = limit;
        for (kind, table, checkpoint, snapshot) in [
            (
                POST,
                "secure_content_moment_projections",
                "posts_through",
                "posts_snapshot",
            ),
            (
                COMMENT,
                "secure_content_comment_projections",
                "comments_through",
                "comments_snapshot",
            ),
        ] {
            if remaining == 0 {
                break;
            }
            let id = if kind == POST {
                "post_id"
            } else {
                "comment_id"
            };
            let sql = format!(
                "SELECT rowid, {id}, post_id, content_id, generation,
                   CASE WHEN length(projection_bytes) <= 262144 THEN projection_bytes ELSE X'' END FROM {table}
                 WHERE rowid > (SELECT {checkpoint} FROM secure_content_search_state WHERE singleton = 1)
                   AND rowid <= (SELECT {snapshot} FROM secure_content_search_state WHERE singleton = 1)
                 ORDER BY rowid LIMIT ?1"
            );
            let mut statement = transaction
                .prepare(&sql)
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(params![remaining as i64], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, Vec<u8>>(5)?,
                    ))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            drop(statement);
            let count = rows.len();
            let mut through = None;
            for (rowid, id, post_id, content_id, generation, bytes) in rows {
                check()?;
                let exists: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM secure_content_search_documents WHERE kind = ?1 AND id = ?2)",
                    params![kind, id], |row| row.get(0),
                ).map_err(|error| error.to_string())?;
                if !exists && ensure_not_denied(&transaction, kind, &id, &post_id, None).is_ok() {
                    // Integrity-ready historical rows still need a fresh policy batch.
                    refresh(
                        &transaction,
                        kind,
                        &id,
                        &post_id,
                        &content_id,
                        generation as u64,
                        &bytes,
                    )?;
                }
                through = Some(rowid);
            }
            let sql = if count < remaining {
                format!("UPDATE secure_content_search_state SET {checkpoint} = {snapshot} WHERE singleton = 1")
            } else {
                format!(
                    "UPDATE secure_content_search_state SET {checkpoint} = ?1 WHERE singleton = 1"
                )
            };
            if count < remaining {
                transaction.execute(&sql, [])
            } else {
                transaction.execute(&sql, params![through.unwrap_or_default()])
            }
            .map_err(|error| error.to_string())?;
            remaining -= count;
        }
        transaction
            .execute(
                "UPDATE secure_content_search_state SET ready =
              (posts_through >= posts_snapshot AND comments_through >= comments_snapshot)
             WHERE singleton = 1",
                [],
            )
            .map_err(|error| error.to_string())?;
        bump(&transaction, false)?;
        let result = progress(&transaction)?;
        check()?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(result)
    }
}

#[cfg(test)]
#[path = "search_tests.rs"]
mod tests;
