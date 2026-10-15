//! Recovery projection I/O over the canonical encrypted Messaging schema.
//! Platform adapters own connection keys, lifecycle fencing and file replacement.
use std::collections::BTreeMap;

use prost::Message;
use rusqlite::{params, Connection, Row, Transaction};

use super::{
    validate_archive, MessagingRecoveryArchive, RecoveryAttachmentMetadata, RecoveryAuthorityHead,
    RecoveryConversationProjection, RecoveryMessageProjection, RecoveryMessageRedactionTombstone,
    RecoveryReconciliation, RecoveryRetentionFloor, RecoveryTrustRecord,
};
use crate::proto::chat::{
    AttachmentPlaintextMetadata, EncryptedObjectDescriptor, VoiceNoteMetadata,
};

fn rows<T>(
    connection: &Connection,
    query: &str,
    map: impl FnMut(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, String> {
    connection
        .prepare(query)
        .map_err(|e| e.to_string())?
        .query_map([], map)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn export_archive(
    connection: &Connection,
    ptid: &str,
    actor_identity_seed: &[u8; 32],
    actor_profile_version: u64,
) -> Result<MessagingRecoveryArchive, String> {
    if ptid.trim().is_empty() || actor_profile_version == 0 {
        return Err("messaging recovery export requires actor and profile version".into());
    }
    let mut conversations = rows(
        connection,
        "SELECT conversation_id, authority_station_id, federation_id, kind, name,
                description, avatar_object_id, owner_ptid, membership_epoch, mls_epoch,
                active, updated_at_unix_ms FROM messaging_conversations
         WHERE authority_station_id <> '' ORDER BY conversation_id",
        |r| {
            Ok(RecoveryConversationProjection {
                conversation_id: r.get(0)?,
                authority_station_id: r.get(1)?,
                federation_id: r.get(2)?,
                kind: r.get(3)?,
                name: r.get(4)?,
                description: r.get(5)?,
                avatar_object_id: r.get(6)?,
                owner_ptid: r.get(7)?,
                membership_epoch: r.get(8)?,
                mls_epoch: r.get(9)?,
                active: r.get(10)?,
                updated_at_unix_ms: r.get(11)?,
                member_ptids: Vec::new(),
                member_roles: BTreeMap::new(),
            })
        },
    )?;
    for conversation in &mut conversations {
        let mut statement = connection
            .prepare(
                "SELECT ptid, role FROM messaging_conversation_members
             WHERE conversation_id = ?1 AND active = 1 ORDER BY ptid",
            )
            .map_err(|e| e.to_string())?;
        conversation.member_roles = statement
            .query_map(params![conversation.conversation_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        conversation.member_ptids = conversation.member_roles.keys().cloned().collect();
    }
    let messages = rows(
        connection,
        "SELECT m.conversation_id, m.event_id, m.event_sequence, a.event_hash,
                m.message_id, m.sender_ptid, m.sender_device_id,
                COALESCE(m.edited_text, m.plaintext), m.committed_at_unix_ms, m.retracted
         FROM messaging_message_projections m
         JOIN messaging_authority_events a ON a.conversation_id = m.conversation_id
             AND a.event_id = m.event_id AND a.event_sequence = m.event_sequence
         JOIN messaging_conversations c ON c.conversation_id = m.conversation_id
         WHERE c.authority_station_id <> '' AND m.hidden_for_actor = 0
           AND m.event_sequence > COALESCE((SELECT MAX(pruned_through_sequence)
               FROM chat_retention_floor f WHERE f.conversation_id = m.conversation_id), 0)
         ORDER BY m.conversation_id, m.event_sequence, m.event_id",
        |r| {
            Ok(RecoveryMessageProjection {
                conversation_id: r.get(0)?,
                event_id: r.get(1)?,
                event_sequence: r.get(2)?,
                authority_event_hash: r.get(3)?,
                message_id: r.get(4)?,
                sender_ptid: r.get(5)?,
                sender_device_id: r.get(6)?,
                plaintext: r.get(7)?,
                committed_at_unix_ms: r.get(8)?,
                retracted: r.get(9)?,
            })
        },
    )?;
    let authority_heads = rows(
        connection,
        "SELECT h.conversation_id, h.event_sequence, h.event_hash, h.updated_at_unix_ms
         FROM messaging_authority_heads h JOIN messaging_conversations c
           ON c.conversation_id = h.conversation_id
         WHERE c.authority_station_id <> '' ORDER BY h.conversation_id",
        |r| {
            Ok(RecoveryAuthorityHead {
                conversation_id: r.get(0)?,
                event_sequence: r.get(1)?,
                event_hash: r.get(2)?,
                updated_at_unix_ms: r.get(3)?,
            })
        },
    )?;
    let retention_floors = rows(
        connection,
        "SELECT f.station_peer_id, f.conversation_id, f.pruned_through_sequence,
                f.authority_event_hash, f.policy_cutoff_unix_ms, f.reason, f.updated_at_unix_ms
         FROM chat_retention_floor f JOIN messaging_device_identity i
           ON i.id = 1 AND i.ptid = f.actor_ptid AND i.device_id = f.device_id
         ORDER BY f.station_peer_id, f.conversation_id",
        |r| {
            Ok(RecoveryRetentionFloor {
                station_peer_id: r.get(0)?,
                conversation_id: r.get(1)?,
                pruned_through_sequence: r.get(2)?,
                authority_event_hash: r.get(3)?,
                policy_cutoff_unix_ms: r.get(4)?,
                reason: r.get(5)?,
                updated_at_unix_ms: r.get(6)?,
            })
        },
    )?;
    let redaction_tombstones = rows(
        connection,
        "SELECT t.conversation_id, t.message_id, t.kind, t.authority_sequence,
                t.authority_event_hash, t.applied_at_unix_ms
         FROM message_redaction_tombstones t JOIN messaging_conversations c
           ON c.conversation_id = t.conversation_id WHERE c.authority_station_id <> ''
         ORDER BY t.conversation_id, t.authority_sequence, t.message_id, t.kind",
        |r| {
            Ok(RecoveryMessageRedactionTombstone {
                conversation_id: r.get(0)?,
                message_id: r.get(1)?,
                kind: r.get(2)?,
                authority_sequence: r.get(3)?,
                authority_event_hash: r.get(4)?,
                applied_at_unix_ms: r.get(5)?,
            })
        },
    )?;
    let mut attachments = Vec::new();
    let mut statement = connection
        .prepare(
            "SELECT message_id, attachment_id, filename, mime_type, plaintext_size,
                plaintext_sha256, object_key, base_nonce, content_kind, duration_ms,
                descriptor_bytes, voice_note_bytes
         FROM messaging_attachment_projections ORDER BY message_id, attachment_id",
        )
        .map_err(|e| e.to_string())?;
    let mut cursor = statement.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = cursor.next().map_err(|e| e.to_string())? {
        let message_id: String = row.get(0).map_err(|e| e.to_string())?;
        if !messages
            .iter()
            .any(|m| m.message_id == message_id && !m.retracted)
        {
            continue;
        }
        let read = |index| row.get::<_, Vec<u8>>(index).map_err(|e| e.to_string());
        let descriptor = read(10)?;
        let voice = read(11)?;
        let metadata = AttachmentPlaintextMetadata {
            attachment_id: row.get(1).map_err(|e| e.to_string())?,
            filename: row.get(2).map_err(|e| e.to_string())?,
            mime_type: row.get(3).map_err(|e| e.to_string())?,
            plaintext_size: row.get::<_, u64>(4).map_err(|e| e.to_string())?,
            plaintext_sha256: read(5)?,
            object_key: read(6)?,
            base_nonce: read(7)?,
            content_kind: row.get(8).map_err(|e| e.to_string())?,
            duration_ms: row.get(9).map_err(|e| e.to_string())?,
            object: Some(
                EncryptedObjectDescriptor::decode(descriptor.as_slice())
                    .map_err(|e| e.to_string())?,
            ),
            voice_note: if voice.is_empty() {
                None
            } else {
                Some(VoiceNoteMetadata::decode(voice.as_slice()).map_err(|e| e.to_string())?)
            },
        };
        attachments.push(RecoveryAttachmentMetadata {
            message_id,
            attachment_id: metadata.attachment_id.clone(),
            metadata: metadata.encode_to_vec(),
        });
    }
    let trust = rows(connection,
        "SELECT peer_ptid, fingerprint, verified_at_unix_ms FROM messaging_trust ORDER BY peer_ptid",
        |r| Ok(RecoveryTrustRecord { peer_ptid: r.get(0)?, fingerprint: r.get(1)?,
            verified_at_unix_ms: r.get(2)? }))?;
    let archive = MessagingRecoveryArchive {
        ptid: ptid.into(),
        actor_identity_seed: *actor_identity_seed,
        actor_profile_version,
        conversations,
        messages,
        retention_floors,
        authority_heads,
        redaction_tombstones,
        attachments,
        trust,
    };
    validate_archive(&archive)?;
    Ok(archive)
}

/// Merge historical projections without replacing live keys, ratchets, queue
/// cursors or current authority state. A failed import rolls back as one unit.
pub fn import_history(
    transaction: &Transaction<'_>,
    archive: &MessagingRecoveryArchive,
    reconciliation: &RecoveryReconciliation,
    device_id: &str,
) -> Result<(), String> {
    validate_archive(archive)?;
    let bound: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM messaging_device_identity
         WHERE id=1 AND ptid=?1 AND device_id=?2)",
            params![archive.ptid, device_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !bound {
        return Err("messaging recovery import endpoint mismatch".into());
    }
    let execute = |sql: &str, values: &[&dyn rusqlite::ToSql]| {
        transaction.execute(sql, values).map_err(|e| e.to_string())
    };
    for c in &archive.conversations {
        let inserted = execute(
            "INSERT OR IGNORE INTO messaging_conversations(conversation_id, authority_station_id,
             federation_id, kind, name, description, avatar_object_id, owner_ptid,
             membership_epoch, mls_epoch, active, updated_at_unix_ms, recovery_ready)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,1)",
            &[
                &c.conversation_id,
                &c.authority_station_id,
                &c.federation_id,
                &c.kind,
                &c.name,
                &c.description,
                &c.avatar_object_id,
                &c.owner_ptid,
                &c.membership_epoch,
                &c.mls_epoch,
                &c.active,
                &c.updated_at_unix_ms,
            ],
        )?;
        if inserted == 1 {
            for (ptid, role) in &c.member_roles {
                execute(
                    "INSERT INTO messaging_conversation_members(conversation_id,ptid,role,active)
                    VALUES (?1,?2,?3,1)",
                    &[&c.conversation_id, ptid, role],
                )?;
            }
        }
    }
    for floor in &archive.retention_floors {
        execute(
            "INSERT INTO chat_retention_floor(station_peer_id,actor_ptid,device_id,
            conversation_id,pruned_through_sequence,authority_event_hash,policy_cutoff_unix_ms,
            reason,updated_at_unix_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
            ON CONFLICT(station_peer_id,actor_ptid,device_id,conversation_id) DO UPDATE SET
            pruned_through_sequence=excluded.pruned_through_sequence,
            authority_event_hash=excluded.authority_event_hash,reason=excluded.reason,
            policy_cutoff_unix_ms=excluded.policy_cutoff_unix_ms,
            updated_at_unix_ms=excluded.updated_at_unix_ms
            WHERE excluded.pruned_through_sequence > chat_retention_floor.pruned_through_sequence",
            &[
                &floor.station_peer_id,
                &archive.ptid,
                &device_id,
                &floor.conversation_id,
                &floor.pruned_through_sequence,
                &floor.authority_event_hash,
                &floor.policy_cutoff_unix_ms,
                &floor.reason,
                &floor.updated_at_unix_ms,
            ],
        )?;
    }
    for t in archive
        .redaction_tombstones
        .iter()
        .chain(&reconciliation.redactions)
    {
        execute("INSERT INTO message_redaction_tombstones(conversation_id,message_id,kind,
            authority_sequence,authority_event_hash,applied_at_unix_ms) VALUES (?1,?2,?3,?4,?5,?6)
            ON CONFLICT(conversation_id,message_id,kind) DO UPDATE SET
            authority_sequence=excluded.authority_sequence,authority_event_hash=excluded.authority_event_hash,
            applied_at_unix_ms=excluded.applied_at_unix_ms
            WHERE excluded.authority_sequence > message_redaction_tombstones.authority_sequence",
            &[&t.conversation_id,&t.message_id,&t.kind,&t.authority_sequence,
              &t.authority_event_hash,&t.applied_at_unix_ms])?;
    }
    for m in &archive.messages {
        let conflict: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messaging_authority_events
             WHERE conversation_id=?1 AND event_sequence=?2 AND (event_id<>?3 OR event_hash<>?4))",
                params![
                    m.conversation_id,
                    m.event_sequence,
                    m.event_id,
                    m.authority_event_hash
                ],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if conflict {
            return Err("messaging recovery historical authority conflict".into());
        }
        execute(
            "INSERT OR IGNORE INTO messaging_message_projections(conversation_id,event_id,
            event_sequence,message_id,sender_ptid,sender_device_id,plaintext,delivery_state,
            committed_at_unix_ms,retracted)
            SELECT ?1,?2,?3,?4,?5,?6,?7,'restored',?8,?9
            WHERE ?3 > COALESCE((SELECT MAX(pruned_through_sequence) FROM chat_retention_floor
                WHERE conversation_id=?1),0)
            AND NOT EXISTS(SELECT 1 FROM message_redaction_tombstones
                WHERE conversation_id=?1 AND message_id=?4)",
            &[
                &m.conversation_id,
                &m.event_id,
                &m.event_sequence,
                &m.message_id,
                &m.sender_ptid,
                &m.sender_device_id,
                &m.plaintext,
                &m.committed_at_unix_ms,
                &m.retracted,
            ],
        )?;
        execute(
            "INSERT OR IGNORE INTO messaging_authority_events(conversation_id,event_id,
            event_sequence,event_hash,committed_at_unix_ms) VALUES (?1,?2,?3,?4,?5)",
            &[
                &m.conversation_id,
                &m.event_id,
                &m.event_sequence,
                &m.authority_event_hash,
                &m.committed_at_unix_ms,
            ],
        )?;
    }
    for head in &archive.authority_heads {
        execute(
            "INSERT OR IGNORE INTO messaging_authority_heads(conversation_id,event_sequence,
            event_hash,updated_at_unix_ms) VALUES (?1,?2,?3,?4)",
            &[
                &head.conversation_id,
                &head.event_sequence,
                &head.event_hash,
                &head.updated_at_unix_ms,
            ],
        )?;
    }
    for a in &archive.attachments {
        let m = AttachmentPlaintextMetadata::decode(a.metadata.as_slice())
            .map_err(|e| e.to_string())?;
        let object = m
            .object
            .as_ref()
            .ok_or("messaging recovery attachment object missing")?;
        let voice = m
            .voice_note
            .as_ref()
            .map(Message::encode_to_vec)
            .unwrap_or_default();
        execute("INSERT OR IGNORE INTO messaging_attachment_projections(message_id,attachment_id,
            object_id,storage_ref,filename,mime_type,content_kind,duration_ms,plaintext_size,
            plaintext_sha256,object_key,base_nonce,descriptor_bytes,voice_note_bytes,availability_state)
            SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'remote'
            WHERE EXISTS(SELECT 1 FROM messaging_message_projections
              WHERE message_id=?1 AND retracted=0 AND hidden_for_actor=0)",
            &[&a.message_id,&a.attachment_id,&object.object_id,&object.storage_ref,&m.filename,
              &m.mime_type,&m.content_kind,&m.duration_ms,&m.plaintext_size,&m.plaintext_sha256,
              &m.object_key,&m.base_nonce,&object.encode_to_vec(),&voice])?;
    }
    for trust in &archive.trust {
        execute(
            "INSERT OR IGNORE INTO messaging_trust(peer_ptid,fingerprint,verified_at_unix_ms)
            VALUES (?1,?2,?3)",
            &[
                &trust.peer_ptid,
                &trust.fingerprint,
                &trust.verified_at_unix_ms,
            ],
        )?;
    }
    execute(
        "INSERT INTO messaging_message_search_fts(conversation_id,message_id,plaintext,
        attachment_filenames)
        SELECT m.conversation_id,m.message_id,COALESCE(m.edited_text,m.plaintext),
          COALESCE((SELECT group_concat(filename,char(10)) FROM messaging_attachment_projections
            WHERE message_id=m.message_id),'')
        FROM messaging_message_projections m WHERE m.retracted=0 AND m.hidden_for_actor=0
          AND NOT EXISTS(SELECT 1 FROM messaging_message_search_fts s
            WHERE s.conversation_id=m.conversation_id AND s.message_id=m.message_id)",
        &[],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::MESSAGING_SCHEMA_SQL;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(MESSAGING_SCHEMA_SQL).unwrap();
        connection
            .execute(
                "INSERT INTO messaging_device_identity(id,ptid,device_id,device_signing_seed,
             actor_identity_public_key,actor_identity_key_fingerprint,device_signing_public_key,
             actor_cross_signature,signing_key_id,profile_version)
             VALUES(1,'ptid:alice','device-1',?1,?1,?1,?1,?2,'key-1',1)",
                params![vec![1u8; 32], vec![1u8; 64]],
            )
            .unwrap();
        connection
    }

    fn archive() -> MessagingRecoveryArchive {
        MessagingRecoveryArchive {
            ptid: "ptid:alice".into(),
            actor_identity_seed: [7; 32],
            actor_profile_version: 1,
            conversations: vec![RecoveryConversationProjection {
                conversation_id: "direct-1".into(),
                authority_station_id: "station-1".into(),
                federation_id: "federation-1".into(),
                kind: 1,
                name: String::new(),
                description: String::new(),
                avatar_object_id: String::new(),
                owner_ptid: "ptid:alice".into(),
                member_ptids: vec!["ptid:alice".into(), "ptid:bob".into()],
                member_roles: BTreeMap::from([("ptid:alice".into(), 1), ("ptid:bob".into(), 3)]),
                membership_epoch: 1,
                mls_epoch: 0,
                active: true,
                updated_at_unix_ms: 10,
            }],
            messages: vec![RecoveryMessageProjection {
                conversation_id: "direct-1".into(),
                event_id: "event-2".into(),
                event_sequence: 2,
                authority_event_hash: vec![2; 32],
                message_id: "message-2".into(),
                sender_ptid: "ptid:bob".into(),
                sender_device_id: "device-b".into(),
                plaintext: "历史 continuity".into(),
                retracted: false,
                committed_at_unix_ms: 10,
            }],
            authority_heads: vec![RecoveryAuthorityHead {
                conversation_id: "direct-1".into(),
                event_sequence: 2,
                event_hash: vec![2; 32],
                updated_at_unix_ms: 10,
            }],
            retention_floors: Vec::new(),
            redaction_tombstones: Vec::new(),
            attachments: Vec::new(),
            trust: Vec::new(),
        }
    }

    #[test]
    fn history_merge_preserves_live_heads_and_is_idempotent() {
        let mut db = database();
        db.execute(
            "INSERT INTO messaging_authority_heads VALUES('direct-1',4,?1,20)",
            params![vec![4u8; 32]],
        )
        .unwrap();
        for _ in 0..2 {
            let tx = db.transaction().unwrap();
            import_history(
                &tx,
                &archive(),
                &RecoveryReconciliation::default(),
                "device-1",
            )
            .unwrap();
            tx.commit().unwrap();
        }
        assert_eq!(
            db.query_row(
                "SELECT event_sequence FROM messaging_authority_heads",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            4
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM messaging_message_projections",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM messaging_message_search_fts",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            export_archive(&db, "ptid:alice", &[7; 32], 1)
                .unwrap()
                .messages[0]
                .plaintext,
            "历史 continuity"
        );
    }

    #[test]
    fn history_merge_does_not_resurrect_redacted_or_cleared_content() {
        let mut db = database();
        let reconciliation = RecoveryReconciliation {
            redactions: vec![RecoveryMessageRedactionTombstone {
                conversation_id: "direct-1".into(),
                message_id: "message-2".into(),
                kind: "retracted".into(),
                authority_sequence: 3,
                authority_event_hash: vec![3; 32],
                applied_at_unix_ms: 20,
            }],
        };
        let tx = db.transaction().unwrap();
        import_history(&tx, &archive(), &reconciliation, "device-1").unwrap();
        tx.commit().unwrap();
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM messaging_message_projections",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM messaging_message_search_fts",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        db.execute("DELETE FROM message_redaction_tombstones", [])
            .unwrap();
        db.execute(
            "INSERT INTO chat_retention_floor VALUES('station-1','ptid:alice','device-1',
            'direct-1',2,?1,NULL,'manual_clear',20)",
            params![vec![2u8; 32]],
        )
        .unwrap();
        let tx = db.transaction().unwrap();
        import_history(
            &tx,
            &archive(),
            &RecoveryReconciliation::default(),
            "device-1",
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM messaging_message_projections",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn authority_conflict_rolls_back_the_entire_import() {
        let mut db = database();
        db.execute(
            "INSERT INTO messaging_authority_events VALUES('direct-1','other-event',2,?1,10)",
            params![vec![9u8; 32]],
        )
        .unwrap();
        let tx = db.transaction().unwrap();
        assert!(import_history(
            &tx,
            &archive(),
            &RecoveryReconciliation::default(),
            "device-1"
        )
        .is_err());
        drop(tx);
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM messaging_conversations", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
