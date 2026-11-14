//! Durable completed composer sources. Partial byte streams stay engine-local.
use super::MobileMessagingStore;
use messaging_core::proto::chat::AttachmentSourceStageRecord;
use prost::Message;
use rusqlite::{params, Connection, OptionalExtension};

const MAX_STAGE_COUNT: i64 = 128;
const MAX_STAGE_BYTES: i64 = 512 * 1024 * 1024;

#[derive(Debug)]
pub(crate) struct AdoptedComposerMessage {
    pub message_id: String,
    pub plaintext: String,
    pub reply_to_message_id: String,
    pub thread_root_message_id: String,
    pub attachment_ids: Vec<String>,
}

pub(super) fn initialize(connection: &Connection) -> Result<(), String> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS mobile_attachment_source_stages(
            stage_id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL,
            source_local_ref TEXT UNIQUE NOT NULL,
            plaintext_size INTEGER NOT NULL,
            record_bytes BLOB NOT NULL
        );",
    ).map_err(|error| error.to_string())
}

impl MobileMessagingStore {
    pub(crate) fn save_attachment_source_stage(
        &self,
        source: &str,
        record: &AttachmentSourceStageRecord,
    ) -> Result<(), String> {
        if source.is_empty() || record.stage_id.len() != 26 || record.conversation_id.is_empty()
            || record.plaintext_size == 0 || record.plaintext_sha256.len() != 32
        {
            return Err("mobile attachment source commitment is invalid".into());
        }
        let size = i64::try_from(record.plaintext_size)
            .map_err(|_| "mobile attachment source size overflow")?;
        self.with_transaction(|transaction| {
            let (count, bytes): (i64, i64) = transaction.query_row(
                "SELECT COUNT(*), COALESCE(SUM(plaintext_size), 0)
                 FROM mobile_attachment_source_stages WHERE stage_id != ?1",
                params![record.stage_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|error| error.to_string())?;
            if count >= MAX_STAGE_COUNT || size > MAX_STAGE_BYTES - bytes {
                return Err("FILE_DRAFT_CAPACITY".into());
            }
            transaction.execute(
                "INSERT INTO mobile_attachment_source_stages
                 (stage_id, source_local_ref, plaintext_size, record_bytes, conversation_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![record.stage_id, source, size, record.encode_to_vec(), record.conversation_id],
            ).map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub(crate) fn conversation_attachment_source_stages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<AttachmentSourceStageRecord>, String> {
        let connection = self.connection.lock()
            .map_err(|_| "mobile messaging store lock poisoned")?;
        let mut statement = connection.prepare(
            "SELECT record_bytes FROM mobile_attachment_source_stages
             WHERE conversation_id=?1 ORDER BY stage_id",
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![conversation_id], |row| row.get::<_, Vec<u8>>(0))
            .map_err(|error| error.to_string())?;
        rows.map(|row| {
            let bytes = row.map_err(|error| error.to_string())?;
            let record = AttachmentSourceStageRecord::decode(bytes.as_slice())
                .map_err(|_| "FILE_DRAFT_INVALID".to_string())?;
            if record.conversation_id != conversation_id {
                return Err("FILE_DRAFT_INVALID".into());
            }
            Ok(record)
        }).collect()
    }

    // Transfer adoption is committed with the native message draft. Its existing
    // source reference recovers the submission even before the web envelope saves.
    pub(crate) fn attachment_source_message(
        &self,
        conversation_id: &str,
        source: &str,
    ) -> Result<Option<String>, String> {
        self.connection.lock().map_err(|_| "mobile messaging store lock poisoned")?
            .query_row(
                "SELECT message_id FROM messaging_attachment_transfers
                 WHERE conversation_id=?1 AND source_local_ref=?2",
                params![conversation_id, source], |row| row.get(0),
            ).optional().map_err(|error| error.to_string())
    }

    pub(crate) fn adopted_composer_message(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<Option<AdoptedComposerMessage>, String> {
        let connection = self.connection.lock()
            .map_err(|_| "mobile messaging store lock poisoned")?;
        let mut message = connection.query_row(
            "SELECT message_id, plaintext, reply_to_message_id, thread_root_message_id
             FROM messaging_pending_messages WHERE conversation_id=?1 AND message_id=?2
             UNION ALL
             SELECT message_id, plaintext, reply_to_message_id, thread_root_message_id
             FROM messaging_message_projections WHERE conversation_id=?1 AND message_id=?2
             LIMIT 1",
            params![conversation_id, message_id],
            |row| Ok(AdoptedComposerMessage {
                message_id: row.get(0)?, plaintext: row.get(1)?,
                reply_to_message_id: row.get(2)?, thread_root_message_id: row.get(3)?,
                attachment_ids: Vec::new(),
            }),
        ).optional().map_err(|error| error.to_string())?;
        if let Some(message) = &mut message {
            let mut statement = connection.prepare(
                "SELECT attachment_id FROM messaging_attachment_transfers
                 WHERE conversation_id=?1 AND message_id=?2 ORDER BY attachment_id",
            ).map_err(|error| error.to_string())?;
            message.attachment_ids = statement.query_map(params![conversation_id, message_id], |row| row.get(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<String>, _>>().map_err(|error| error.to_string())?;
        }
        Ok(message)
    }

    pub(crate) fn attachment_source_stage(
        &self,
        stage_id: &str,
    ) -> Result<Option<AttachmentSourceStageRecord>, String> {
        let bytes: Option<Vec<u8>> = self.connection.lock()
            .map_err(|_| "mobile messaging store lock poisoned")?
            .query_row(
                "SELECT record_bytes FROM mobile_attachment_source_stages WHERE stage_id=?1",
                params![stage_id], |row| row.get(0),
            ).optional().map_err(|error| error.to_string())?;
        bytes.map(|bytes| {
            let record = AttachmentSourceStageRecord::decode(bytes.as_slice())
                .map_err(|_| "FILE_DRAFT_INVALID".to_string())?;
            if record.stage_id != stage_id || record.plaintext_sha256.len() != 32 {
                return Err("FILE_DRAFT_INVALID".into());
            }
            Ok(record)
        }).transpose()
    }

    pub(crate) fn owns_attachment_stage_source(&self, source: &str) -> Result<bool, String> {
        self.connection.lock().map_err(|_| "mobile messaging store lock poisoned")?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM mobile_attachment_source_stages
                 WHERE source_local_ref=?1)",
                params![source], |row| row.get(0),
            ).map_err(|error| error.to_string())
    }

    pub(crate) fn remove_attachment_source_stage(&self, stage_id: &str) -> Result<(), String> {
        self.connection.lock().map_err(|_| "mobile messaging store lock poisoned")?
            .execute("DELETE FROM mobile_attachment_source_stages WHERE stage_id=?1",
                params![stage_id]).map_err(|error| error.to_string())?;
        Ok(())
    }
}
