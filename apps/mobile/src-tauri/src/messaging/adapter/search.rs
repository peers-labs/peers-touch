//! Search reads and derived-index maintenance at the original SQLCipher store.

use std::sync::atomic::Ordering;

use rusqlite::{params, Connection};
use search_core::{ResourceRef, ResultKind, ScoredDocument, SearchError};

use super::{index_message_search, load_pending_attachments, MobileMessagingStore};

pub(super) fn dependency(table: &str) -> bool {
    matches!(
        table,
        "messaging_message_projections"
            | "messaging_conversations"
            | "messaging_conversation_members"
            | "messaging_service_messages"
            | "messaging_attachment_projections"
            | "messaging_search_index_progress"
    )
}

fn revision(connection: &Connection, changes: u64) -> Result<String, String> {
    let external: i64 = connection
        .query_row("PRAGMA data_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    Ok(format!("{changes}:{external}"))
}

/// The only index format is the shared token stream. Opening an older store
/// replaces its derived FTS, then resumes bounded original-row batches.
pub(super) fn initialize(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS messaging_search_index_progress(
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            token_format TEXT NOT NULL, after_rowid INTEGER NOT NULL, ready INTEGER NOT NULL
         )",
        )
        .map_err(|error| error.to_string())?;
    let current: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM messaging_search_index_progress
         WHERE singleton = 1 AND token_format = 'cjk-unigram-bigram')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !current {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(
                "DELETE FROM messaging_message_search_fts;
             INSERT OR REPLACE INTO messaging_search_index_progress
             VALUES(1, 'cjk-unigram-bigram', 0, 0)",
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn document(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScoredDocument> {
    let kind: String = row.get(0)?;
    let id: String = row.get(1)?;
    let conversation: String = row.get(2)?;
    let authority: String = row.get(3)?;
    let title: String = row.get(4)?;
    let snippet: String = row.get(5)?;
    let message = kind == "message";
    Ok(ScoredDocument {
        resource: ResourceRef {
            kind,
            id: id.clone(),
            conversation_id: conversation,
            message_id: if message { id.clone() } else { String::new() },
            authority_namespace: format!("station:{authority}"),
            anchor: message.then_some(search_core::model::wire::ResourceAnchor {
                kind: "message".into(),
                id,
            }),
            ..Default::default()
        },
        kind: if message {
            ResultKind::Message
        } else {
            ResultKind::Conversation
        },
        zone: search_core::model::TrustZone::DeviceE2ee,
        title: title.clone(),
        conversation_title: title,
        snippet: snippet.chars().take(512).collect(),
        author_ptid: row.get(6)?,
        created_at_unix_ms: row.get(7)?,
        score: 0.0,
    })
}

impl MobileMessagingStore {
    pub(crate) fn rebuild_search_index_batch(&self) -> Result<bool, String> {
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let (after, ready): (i64, bool) = connection.query_row(
            "SELECT after_rowid, ready FROM messaging_search_index_progress WHERE singleton = 1",
            [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|error| error.to_string())?;
        if ready {
            return Ok(true);
        }
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let rows =
            {
                let mut statement = transaction.prepare(
                "SELECT rowid, conversation_id, message_id, COALESCE(edited_text, plaintext)
                 FROM messaging_message_projections
                 WHERE rowid > ?1 ORDER BY rowid LIMIT 128",
            ).map_err(|error| error.to_string())?;
                let rows = statement
                    .query_map(params![after], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    })
                    .map_err(|error| error.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())?;
                rows
            };
        for (_, conversation, message, plaintext) in &rows {
            let attachments = load_pending_attachments(&transaction, message)?;
            index_message_search(&transaction, conversation, message, plaintext, &attachments)?;
        }
        let ready = rows.len() < 128;
        transaction.execute(
            "UPDATE messaging_search_index_progress SET after_rowid = ?1, ready = ?2 WHERE singleton = 1",
            params![rows.last().map_or(after, |row| row.0), ready],
        ).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(ready)
    }

    pub(crate) fn search_index_ready(&self) -> Result<bool, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .query_row(
                "SELECT ready FROM messaging_search_index_progress WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn search_revision(&self) -> Result<String, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        revision(&connection, self.search_changes.load(Ordering::Relaxed))
    }

    pub(crate) fn with_search_revision<T>(
        &self,
        expected: &str,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| SearchError::SourceUnavailable(error.to_string()))?;
        if revision(&connection, self.search_changes.load(Ordering::Relaxed))
            .map_err(SearchError::SourceUnavailable)?
            != expected
        {
            return Err(SearchError::SourceChanged);
        }
        publish()
    }

    pub(crate) fn search_authorities(&self, actor: &str) -> Result<Vec<String>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let revision = format!(
            "{actor}:{}",
            revision(
                &connection,
                self.search_authority_changes.load(Ordering::Relaxed),
            )?
        );
        let mut cache = self
            .search_authority_cache
            .lock()
            .map_err(|error| error.to_string())?;
        if let Some((cached, authorities)) = cache.as_ref() {
            if cached == &revision {
                return Ok(authorities.clone());
            }
        }
        let mut statement = connection
            .prepare(
                "SELECT DISTINCT authority_station_id FROM messaging_conversations conversation
             WHERE conversation.active = 1 AND authority_station_id <> ''
               AND EXISTS(SELECT 1 FROM messaging_conversation_members member
                 WHERE member.conversation_id = conversation.conversation_id
                   AND member.ptid = ?1 AND member.active = 1)
             ORDER BY authority_station_id",
            )
            .map_err(|error| error.to_string())?;
        let authorities = statement
            .query_map(params![actor], |row| {
                row.get::<_, String>(0)
                    .map(|authority| format!("station:{authority}"))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        *cache = Some((revision, authorities.clone()));
        Ok(authorities)
    }

    pub(crate) fn search_documents(
        &self,
        actor: &str,
        conversation: Option<&str>,
        query: &str,
        attachment_names_only: bool,
        before: Option<(i64, &str, &str)>,
        limit: usize,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        let mut expression =
            search_core::build_match_expression(query).map_err(|error| error.to_string())?;
        if attachment_names_only {
            expression = format!("attachment_filenames : ({expression})");
        }
        if limit == 0 || limit > 101 {
            return Err("search limit invalid".into());
        }
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        check()?;
        let mut statement = connection
            .prepare(
                "SELECT 'message', message.message_id, message.conversation_id,
                    conversation.authority_station_id, conversation.name,
                    COALESCE((SELECT group_concat(attachment.filename, char(10)) || char(10)
                         FROM messaging_attachment_projections attachment
                         WHERE attachment.message_id = message.message_id), '')
                    || COALESCE(message.edited_text, message.plaintext),
                    message.sender_ptid, message.committed_at_unix_ms
             FROM messaging_message_search_fts
             JOIN messaging_message_projections message
               ON message.conversation_id = messaging_message_search_fts.conversation_id
              AND message.message_id = messaging_message_search_fts.message_id
             JOIN messaging_conversations conversation
               ON conversation.conversation_id = message.conversation_id
             WHERE messaging_message_search_fts MATCH ?1
               AND (?2 = '' OR message.conversation_id = ?2)
               AND conversation.active = 1 AND message.retracted = 0
               AND message.hidden_for_actor = 0 AND message.moderated = 0
               AND EXISTS(SELECT 1 FROM messaging_conversation_members member
                 WHERE member.conversation_id = conversation.conversation_id
                   AND member.ptid = ?7 AND member.active = 1)
               AND NOT EXISTS(SELECT 1 FROM messaging_service_messages service
                 WHERE service.conversation_id = message.conversation_id
                   AND service.message_id = message.message_id)
               AND (message.committed_at_unix_ms, message.message_id, message.conversation_id)
                    < (?3, ?4, ?5)
             ORDER BY message.committed_at_unix_ms DESC, message.message_id DESC,
                      message.conversation_id DESC LIMIT ?6",
            )
            .map_err(|error| error.to_string())?;
        let (timestamp, message, container) =
            before.unwrap_or((i64::MAX, "\u{10ffff}", "\u{10ffff}"));
        let rows = statement
            .query_map(
                params![
                    expression,
                    conversation.unwrap_or(""),
                    timestamp,
                    message,
                    container,
                    limit as i64,
                    actor
                ],
                document,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        check()?;
        Ok(rows)
    }

    pub(crate) fn search_conversations(
        &self,
        actor: &str,
        conversation: Option<&str>,
        query: &str,
        limit: usize,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        check()?;
        let mut statement = connection
            .prepare(
                "SELECT 'conversation', conversation_id, conversation_id, authority_station_id,
                    name, '', '', updated_at_unix_ms
             FROM messaging_conversations conversation
             WHERE active = 1 AND (?2 = '' OR conversation_id = ?2)
               AND EXISTS(SELECT 1 FROM messaging_conversation_members member
                 WHERE member.conversation_id = conversation.conversation_id
                   AND member.ptid = ?1 AND member.active = 1)
             ORDER BY updated_at_unix_ms DESC, conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let mut rows = statement
            .query(params![actor, conversation.unwrap_or("")])
            .map_err(|error| error.to_string())?;
        let mut documents = Vec::new();
        let needle = query.trim().to_lowercase();
        while let Some(row) = rows.next().map_err(|error| error.to_string())? {
            check()?;
            let doc = document(row).map_err(|error| error.to_string())?;
            if needle.is_empty() || doc.title.to_lowercase().contains(&needle) {
                documents.push(doc);
                if documents.len() >= limit {
                    break;
                }
            }
        }
        Ok(documents)
    }

    pub(crate) fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        actor: &str,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        if refs.is_empty() {
            return Ok(Vec::new());
        }
        if refs.len() > 100 {
            return Err("search batch exceeds limit".into());
        }
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        check()?;
        let placeholders = refs
            .iter()
            .map(|_| "(?, ?, ?, ?)")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "WITH requested(kind, id, container, authority) AS (VALUES {placeholders})
             SELECT requested.kind, requested.id, conversation.conversation_id,
                    conversation.authority_station_id, conversation.name,
                    CASE WHEN requested.kind = 'message'
                      THEN COALESCE((SELECT group_concat(attachment.filename, char(10)) || char(10)
                            FROM messaging_attachment_projections attachment
                            WHERE attachment.message_id = message.message_id), '')
                        || COALESCE(message.edited_text, message.plaintext)
                      ELSE '' END, COALESCE(message.sender_ptid, ''),
                    CASE WHEN requested.kind = 'message' THEN message.committed_at_unix_ms
                         ELSE conversation.updated_at_unix_ms END
             FROM requested JOIN messaging_conversations conversation
               ON conversation.conversation_id = requested.container
              AND 'station:' || conversation.authority_station_id = requested.authority
             LEFT JOIN messaging_message_projections message
               ON requested.kind = 'message' AND message.conversation_id = requested.container
              AND message.message_id = requested.id
             WHERE conversation.active = 1
               AND EXISTS(SELECT 1 FROM messaging_conversation_members member
                 WHERE member.conversation_id = conversation.conversation_id
                   AND member.ptid = ? AND member.active = 1)
               AND ((requested.kind = 'conversation' AND requested.id = requested.container)
                 OR (requested.kind = 'message' AND message.retracted = 0
                   AND message.hidden_for_actor = 0 AND message.moderated = 0
                   AND NOT EXISTS(SELECT 1 FROM messaging_service_messages service
                     WHERE service.conversation_id = message.conversation_id
                       AND service.message_id = message.message_id)))",
        );
        let mut values: Vec<&str> = refs
            .iter()
            .flat_map(|reference| {
                [
                    reference.kind.as_str(),
                    reference.id.as_str(),
                    reference.conversation_id.as_str(),
                    reference.authority_namespace.as_str(),
                ]
            })
            .collect();
        values.push(actor);
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(rusqlite::params_from_iter(values), document)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        check()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(connection: &Connection, count: usize) {
        connection
            .execute_batch(
                "INSERT INTO messaging_conversations(
                conversation_id, authority_station_id, federation_id, kind, name,
                owner_ptid, membership_epoch, mls_epoch, active, updated_at_unix_ms
             ) VALUES('conversation', 'home', 'federation', 1, '周会', 'ptid:alice', 1, 1, 1, 1);
             INSERT INTO messaging_conversation_members(conversation_id, ptid, role, active)
             VALUES('conversation', 'ptid:alice', 1, 1)",
            )
            .unwrap();
        for index in 0..count {
            let id = format!("message-{index:04}");
            connection
                .execute(
                    "INSERT INTO messaging_message_projections(
                    conversation_id, event_id, event_sequence, message_id, sender_ptid,
                    sender_device_id, plaintext, edited_text, delivery_state, committed_at_unix_ms
                 ) VALUES('conversation', ?1, ?2, ?1, 'ptid:alice', 'device',
                          '原始内容', '周会目录 Camino山友', 'received', ?2)",
                    params![id, index as i64 + 1],
                )
                .unwrap();
            connection.execute(
                "INSERT INTO messaging_message_search_fts(conversation_id, message_id, plaintext, attachment_filenames)
                 VALUES('conversation', ?1, '周会目录 Camino山友', '')",
                params![id],
            ).unwrap();
        }
    }

    #[test]
    fn legacy_index_rebuild_is_bounded_resumable_and_preserves_original_messages() {
        let connection = Connection::open_in_memory().unwrap();
        super::super::migrate_messaging_schema(&super::super::RusqliteMessagingSchema(&connection))
            .unwrap();
        super::super::create_mobile_messaging_adapter_schema(&connection).unwrap();
        seed(&connection, 260);
        let store = MobileMessagingStore::from_connection(connection).unwrap();
        assert!(!store.search_index_ready().unwrap());
        assert_eq!(
            store
                .connection
                .lock()
                .unwrap()
                .query_row(
                    "SELECT count(*) FROM messaging_message_search_fts",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            128,
        );
        assert!(!store.rebuild_search_index_batch().unwrap());
        assert!(store.rebuild_search_index_batch().unwrap());
        let documents = store
            .search_documents("ptid:alice", None, "目录", false, None, 101, &|| Ok(()))
            .unwrap();
        assert_eq!(documents.len(), 101);
        assert!(documents.iter().all(|doc| doc.snippet.contains("周会目录")));
        assert_eq!(
            store
                .search_documents(
                    "ptid:alice",
                    Some("another"),
                    "目录",
                    false,
                    None,
                    101,
                    &|| Ok(()),
                )
                .unwrap()
                .len(),
            0
        );
        let connection = store.connection.lock().unwrap();
        let originals: i64 = connection
            .query_row(
                "SELECT count(*) FROM messaging_message_projections
             WHERE plaintext = '原始内容' AND edited_text = '周会目录 Camino山友'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(originals, 260);
    }

    #[test]
    fn authority_revocation_denies_queries_resources_and_stale_publication() {
        let store = MobileMessagingStore::in_memory().unwrap();
        {
            let connection = store.connection.lock().unwrap();
            seed(&connection, 1);
            index_message_search(
                &connection,
                "conversation",
                "message-0000",
                "周会目录 Camino山友",
                &[],
            )
            .unwrap();
        }
        let hits = store
            .search_documents(
                "ptid:alice",
                None,
                "目录 Camino",
                false,
                None,
                20,
                &|| Ok(()),
            )
            .unwrap();
        assert_eq!(hits.len(), 1);
        let reference = hits[0].resource.clone();
        assert_eq!(
            store
                .search_read_resources(&[reference.clone()], "ptid:alice", &|| Ok(()))
                .unwrap()
                .len(),
            1
        );
        let before = store.search_revision().unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection.execute(
                "UPDATE messaging_conversation_members SET active = 0 WHERE ptid = 'ptid:alice'", [],
            ).unwrap();
        }
        assert_eq!(
            store.with_search_revision(&before, || Ok(())),
            Err(SearchError::SourceChanged)
        );
        assert!(store
            .search_documents("ptid:alice", None, "目录", false, None, 20, &|| Ok(()))
            .unwrap()
            .is_empty());
        assert!(store
            .search_read_resources(&[reference], "ptid:alice", &|| Ok(()))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn filename_filter_excludes_body_only_hits_and_retains_message_anchor() {
        let store = MobileMessagingStore::in_memory().unwrap();
        {
            let connection = store.connection.lock().unwrap();
            seed(&connection, 2);
            connection
                .execute(
                    "UPDATE messaging_message_search_fts SET plaintext = ?1,
                 attachment_filenames = CASE WHEN message_id = 'message-0001'
                    THEN ?1 ELSE '' END",
                    params![search_core::tokenize("周会目录.pdf").join(" ")],
                )
                .unwrap();
        }
        let all = store
            .search_documents("ptid:alice", None, "目录", false, None, 20, &|| Ok(()))
            .unwrap();
        let names = store
            .search_documents("ptid:alice", None, "目录", true, None, 20, &|| Ok(()))
            .unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].resource.kind, "message");
        assert_eq!(names[0].resource.message_id, "message-0001");
        assert!(store
            .search_documents("ptid:other", None, "目录", true, None, 20, &|| Ok(()))
            .unwrap()
            .is_empty());
    }
}
