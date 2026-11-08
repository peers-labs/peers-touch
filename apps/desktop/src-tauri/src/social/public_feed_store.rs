use libp2p_identity::Keypair;
use prost::Message;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use station_trust::feed_log::{self as feed, proto::*};

use crate::domain::storage::database::DatabaseOpenSpec;
use crate::infrastructure::{local_scope, storage};
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;

#[path = "public_feed_poll_store.rs"]
mod poll;
use poll::*;

/// One SQLCipher database per retained Actor. The journal owns issued bytes
/// and verified heads; neither is reconstructed from Station projections.
pub(super) struct PublicFeedStore {
    connection: Connection,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS social_feed_heads (
    actor TEXT NOT NULL, chain TEXT NOT NULL, root BLOB NOT NULL,
    genesis BLOB NOT NULL, grant_bytes BLOB NOT NULL, head BLOB NOT NULL,
    PRIMARY KEY(actor, chain)
);
CREATE TABLE IF NOT EXISTS social_feed_journal (
    actor TEXT NOT NULL, chain TEXT NOT NULL, sequence INTEGER NOT NULL,
    command_id TEXT NOT NULL, event BLOB NOT NULL, confirmed INTEGER NOT NULL,
    PRIMARY KEY(actor, chain, sequence), UNIQUE(actor, chain, command_id)
);
CREATE TABLE IF NOT EXISTS social_remote_feed_heads (
    actor TEXT NOT NULL, chain TEXT NOT NULL, home TEXT NOT NULL, root BLOB NOT NULL,
    genesis BLOB NOT NULL, grant_bytes BLOB NOT NULL, head BLOB NOT NULL,
    PRIMARY KEY(actor, chain)
);
CREATE TABLE IF NOT EXISTS social_remote_feed_events (
    actor TEXT NOT NULL, chain TEXT NOT NULL, sequence INTEGER NOT NULL,
    event BLOB NOT NULL, PRIMARY KEY(actor, chain, sequence)
);
CREATE TABLE IF NOT EXISTS social_feed_actor_pins (
    actor TEXT PRIMARY KEY, home TEXT NOT NULL, root BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS social_remote_feed_threads (
    author TEXT NOT NULL, cursor INTEGER NOT NULL, home TEXT NOT NULL,
    root BLOB NOT NULL, receipt BLOB NOT NULL, actor TEXT NOT NULL,
    chain TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(author,cursor),
    UNIQUE(actor,chain,sequence)
);
CREATE TABLE IF NOT EXISTS social_feed_receipt_authorizations (
    actor TEXT PRIMARY KEY, genesis BLOB NOT NULL, grant_bytes BLOB NOT NULL
);";

impl PublicFeedStore {
    pub(super) fn open(actor: &str) -> Result<Self, String> {
        if actor.trim().is_empty() { return Err("FEED_INVALID".into()); }
        let spec = DatabaseOpenSpec::new_social_feed_main(local_scope::user_scope_for_actor_ptid(actor));
        let connection = storage::open_database(&spec, PlatformKeyProvider::shared())
            .map_err(|e| e.to_string())?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, String> {
        connection.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        connection.execute_batch(POLL_SCHEMA).map_err(|e| e.to_string())?;
        Ok(Self { connection })
    }

    pub(super) fn pin_actor(&mut self, actor: &str, home: &str, root: &[u8]) -> Result<(), String> {
        if actor.is_empty() || home.is_empty() || root.len() != 32 { return Err("FEED_INVALID".into()); }
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        tx.execute("INSERT OR IGNORE INTO social_feed_actor_pins VALUES (?1,?2,?3)", params![actor, home, root])
            .map_err(|e| e.to_string())?;
        let (retained_home, retained_root): (String, Vec<u8>) = tx.query_row(
            "SELECT home, root FROM social_feed_actor_pins WHERE actor=?1", params![actor],
            |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        if retained_home != home || retained_root != root { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        tx.commit().map_err(|e| e.to_string())
    }

    pub(super) fn remote_head(&self, actor: &str, root: &[u8], home: &str) -> Result<Option<FeedHead>, String> {
        Self::verified_remote_head(&self.connection, actor, root, home)
    }

    pub(super) fn thread_cursor(&self, author: &str, keys: &PollKeyResolver<'_>) -> Result<u64, String> {
        let mut query = self.connection.prepare(
            "SELECT cursor,home,root,receipt,actor,chain,sequence FROM social_remote_feed_threads WHERE author=?1 ORDER BY cursor")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![author], |r| Ok((r.get::<_,u64>(0)?,r.get::<_,String>(1)?,
            r.get::<_,Vec<u8>>(2)?,r.get::<_,Vec<u8>>(3)?,r.get::<_,String>(4)?,
            r.get::<_,String>(5)?,r.get::<_,u64>(6)?))).map_err(|e| e.to_string())?;
        let mut cursor = 0;
        for row in rows {
            let (n, home, root, wire, actor, chain, sequence) = row.map_err(|e| e.to_string())?;
            if n != cursor+1 { return Err("FEED_GAP".into()); }
            let receipt: FeedInteraction = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
            let statement = receipt.event.as_ref().and_then(|e| e.statement.as_ref()).ok_or("FEED_INVALID")?;
            if statement.actor_ptid != actor || statement.chain_id != chain || statement.sequence != sequence {
                return Err("FEED_INVALID".into());
            }
            Self::verify_thread_receipt(&self.connection, author, &home, &root, &receipt, keys)?;
            cursor = n;
        }
        Ok(cursor)
    }

    fn verify_thread_receipt(connection: &Connection, author: &str, home: &str,
        root: &[u8], receipt: &FeedInteraction, keys: &PollKeyResolver<'_>) -> Result<(), String> {
        let genesis = receipt.genesis.as_ref().ok_or("FEED_INVALID")?;
        let grant = receipt.writer_grant.as_ref().ok_or("FEED_INVALID")?;
        let event = receipt.event.as_ref().ok_or("FEED_INVALID")?;
        let actor = &event.statement.as_ref().ok_or("FEED_INVALID")?.actor_ptid;
        let (pinned_home,pinned_root): (String,Vec<u8>) = connection.query_row(
            "SELECT home,root FROM social_feed_actor_pins WHERE actor=?1", params![actor],
            |r| Ok((r.get(0)?,r.get(1)?))).map_err(|e| e.to_string())?;
        if pinned_home != home || pinned_root != root { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        feed::verify_authorization(genesis,grant,actor,root).map_err(|e| e.to_string())?;
        feed::verify_event(event,grant).map_err(|e| e.to_string())?;
        for table in ["social_remote_feed_heads","social_feed_heads","social_feed_receipt_authorizations"] {
            let known: Option<(Vec<u8>,Vec<u8>)> = connection.query_row(
                &format!("SELECT genesis,grant_bytes FROM {table} WHERE actor=?1"),params![actor],
                |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
            if known.is_some_and(|(g,w)| g != genesis.encode_to_vec() || w != grant.encode_to_vec()) {
                return Err("FEED_WRITER_NOT_AUTHORIZED".into());
            }
        }
        let statement = event.statement.as_ref().ok_or("FEED_INVALID")?;
        for table in ["social_remote_feed_events","social_feed_journal"] {
            let known: Option<Vec<u8>> = connection.query_row(
                &format!("SELECT event FROM {table} WHERE actor=?1 AND chain=?2 AND sequence=?3"),
                params![actor,statement.chain_id,statement.sequence],|r| r.get(0)).optional().map_err(|e| e.to_string())?;
            if known.is_some_and(|wire| wire != event.encode_to_vec()) { return Err("FEED_FORK_DETECTED".into()); }
        }
        let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
        let target = interaction_target(&payload)?;
        if creation_for_post(connection,target)?.0 != author { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        attach_admission(connection,&mut receipt.clone(),keys)
    }

    // Receipt authenticity and synchronization do not depend on arrival order.
    // Exposure does: a comment target needs its independently verified creation
    // on this parent. Missing ancestors remain durable, but are never rendered.
    fn verify_comment_target(connection: &Connection, author: &str, receipt: &FeedInteraction,
        keys: &PollKeyResolver<'_>) -> Result<(), String> {
        let event = receipt.event.as_ref().ok_or("FEED_INVALID")?;
        let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
        let Some(feed_payload::Mutation::Reaction(reaction)) = payload.mutation else { return Ok(()); };
        if reaction.target_comment_ref.is_empty() { return Ok(()); }
        let mut query = connection.prepare(
            "SELECT home,root,receipt FROM social_remote_feed_threads WHERE author=?1 ORDER BY cursor")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![author], |r| Ok((r.get::<_,String>(0)?,
            r.get::<_,Vec<u8>>(1)?, r.get::<_,Vec<u8>>(2)?))).map_err(|e| e.to_string())?;
        for row in rows {
            let (home,root,wire) = row.map_err(|e| e.to_string())?;
            let creation: FeedInteraction = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
            let created = creation.event.as_ref().ok_or("FEED_INVALID")?;
            if created.statement.as_ref().ok_or("FEED_INVALID")?.kind != FeedEventKind::CommentCreated as i32 { continue; }
            let payload: FeedPayload = feed::decode_canonical(&created.payload).map_err(|e| e.to_string())?;
            if let Some(feed_payload::Mutation::Comment(comment)) = payload.mutation {
                if format!("oss://{home}/comment/{}",comment.comment_id) == reaction.target_comment_ref {
                    Self::verify_thread_receipt(connection,author,&home,&root,&creation,keys)?;
                    if comment.target_post_ref != reaction.target_post_ref { return Err("FEED_INVALID".into()); }
                    return Ok(());
                }
            }
        }
        Err("FEED_GAP".into())
    }

    pub(super) fn import_thread(&mut self, request: &ReadFeedRequest, response: &ReadFeedResponse,
        roots: &std::collections::BTreeMap<String,Vec<u8>>, keys: &PollKeyResolver<'_>) -> Result<(), String> {
        if response.thread_entries.len() > 32 || response.encoded_len() > feed::MAX_FEED_BYTES {
            return Err("FEED_INVALID".into());
        }
        if self.thread_cursor(&request.actor_ptid,keys)? != request.after_thread_cursor { return Err("FEED_GAP".into()); }
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let mut cursor = request.after_thread_cursor;
        for entry in &response.thread_entries {
            if entry.cursor != cursor+1 { return Err("FEED_GAP".into()); }
            let receipt = entry.receipt.as_ref().ok_or("FEED_INVALID")?;
            let statement = receipt.event.as_ref().and_then(|e| e.statement.as_ref()).ok_or("FEED_INVALID")?;
            let root = roots.get(&statement.actor_ptid).ok_or("FEED_WRITER_NOT_AUTHORIZED")?;
            Self::verify_thread_receipt(&tx,&request.actor_ptid,&entry.interaction_home_station,root,receipt,keys)?;
            let base = receipt_bytes(receipt);
            // A receipt with the same author sequence cannot change, including
            // when it reappears under a different thread arrival cursor.
            let known: Option<Vec<u8>> = tx.query_row(
                "SELECT receipt FROM social_remote_feed_threads WHERE actor=?1 AND chain=?2 AND sequence=?3",
                params![statement.actor_ptid,statement.chain_id,statement.sequence],|r| r.get(0))
                .optional().map_err(|e| e.to_string())?;
            if let Some(wire) = known {
                if wire != base {
                    return Err("FEED_FORK_DETECTED".into());
                }
                return Err("FEED_INVALID".into());
            }
            if let Some(admission) = receipt.poll_admission.as_ref() {
                retain_admission(&tx,receipt.event.as_ref().ok_or("FEED_INVALID")?,admission,keys)?;
            }
            tx.execute("INSERT OR IGNORE INTO social_feed_receipt_authorizations VALUES (?1,?2,?3)",
                params![statement.actor_ptid,receipt.genesis.as_ref().ok_or("FEED_INVALID")?.encode_to_vec(),
                    receipt.writer_grant.as_ref().ok_or("FEED_INVALID")?.encode_to_vec()]).map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO social_remote_feed_threads VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![request.actor_ptid,entry.cursor,entry.interaction_home_station,root,base,
                    statement.actor_ptid,statement.chain_id,statement.sequence])
                .map_err(|e| e.to_string())?;
            cursor = entry.cursor;
        }
        if response.thread_cursor != cursor { return Err("FEED_GAP".into()); }
        // Validate after retaining the entire page, so an ancestor arriving
        // later in the same page works. Only absence is deferred.
        for entry in &response.thread_entries {
            match Self::verify_comment_target(&tx,&request.actor_ptid,entry.receipt.as_ref().ok_or("FEED_INVALID")?,keys) {
                Ok(()) => (),
                Err(error) if error == "FEED_GAP" => (),
                Err(error) => return Err(error),
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub(super) fn thread_page(&self, author: &str, after: u64, keys: &PollKeyResolver<'_>) -> Result<Vec<FeedThreadEntry>,String> {
        if after > self.thread_cursor(author,keys)? { return Err("FEED_GAP".into()); }
        let mut query = self.connection.prepare(
            "SELECT cursor,home,receipt FROM social_remote_feed_threads WHERE author=?1 AND cursor>?2 ORDER BY cursor LIMIT 32")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![author,after], |r| Ok((r.get::<_,u64>(0)?,r.get::<_,String>(1)?,r.get::<_,Vec<u8>>(2)?)))
            .map_err(|e| e.to_string())?;
        let mut entries = Vec::new();
        let mut bytes = 0;
        for row in rows {
            let (cursor,home,wire) = row.map_err(|e| e.to_string())?;
            let mut entry = FeedThreadEntry{cursor,interaction_home_station:home,
                receipt:Some(feed::decode_canonical(&wire).map_err(|e| e.to_string())?)};
            attach_admission(&self.connection,entry.receipt.as_mut().ok_or("FEED_INVALID")?,keys)?;
            match Self::verify_comment_target(&self.connection,author,entry.receipt.as_ref().ok_or("FEED_INVALID")?,keys) {
                Ok(()) => (),
                Err(error) if error == "FEED_GAP" => break,
                Err(error) => return Err(error),
            }
            bytes += entry.encoded_len();
            if bytes > feed::MAX_FEED_BYTES { break; }
            entries.push(entry);
        }
        Ok(entries)
    }

    /// The renderer cursor is independent of the synchronization cursor.
    /// Lost command responses and process restarts can replay retained bytes.
    pub(super) fn remote_page(&self, actor: &str, root: &[u8], home: &str,
        after: u64, limit: u32) -> Result<(ReadFeedResponse, FeedHead), String> {
        if limit == 0 || limit > 64 { return Err("FEED_INVALID".into()); }
        let head = self.remote_head(actor, root, home)?.ok_or("FEED_INVALID")?;
        if after > head.sequence { return Err("FEED_GAP".into()); }
        let (g, w): (Vec<u8>, Vec<u8>) = self.connection.query_row(
            "SELECT genesis, grant_bytes FROM social_remote_feed_heads WHERE actor=?1 AND chain=?2",
            params![actor, feed::PUBLIC_CHAIN_ID], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        let genesis: FeedGenesis = feed::decode_canonical(&g).map_err(|e| e.to_string())?;
        let grant: FeedWriterGrant = feed::decode_canonical(&w).map_err(|e| e.to_string())?;
        let start = if after == 0 { feed::initial_head(&genesis).map_err(|e| e.to_string())? } else {
            let wire: Vec<u8> = self.connection.query_row(
                "SELECT event FROM social_remote_feed_events WHERE actor=?1 AND chain=?2 AND sequence=?3",
                params![actor, feed::PUBLIC_CHAIN_ID, after], |r| r.get(0)).map_err(|e| e.to_string())?;
            let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
            FeedHead{actor_ptid: actor.into(), chain_id: feed::PUBLIC_CHAIN_ID.into(), sequence: after,
                event_hash: feed::event_hash(&event).map_err(|e| e.to_string())?}
        };
        let mut page = ReadFeedResponse{bundle: Some(FeedBundle{
            genesis: Some(genesis), writer_grant: Some(grant), events: vec![]}),
            head: Some(head), has_more: false, ..Default::default()};
        let mut query = self.connection.prepare(
            "SELECT event FROM social_remote_feed_events WHERE actor=?1 AND chain=?2 AND sequence>?3 ORDER BY sequence LIMIT ?4")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![actor, feed::PUBLIC_CHAIN_ID, after, limit],
            |r| r.get::<_, Vec<u8>>(0)).map_err(|e| e.to_string())?;
        for row in rows {
            let event = feed::decode_canonical(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            page.bundle.as_mut().ok_or("FEED_INVALID")?.events.push(event);
            if page.encoded_len() > feed::MAX_FEED_BYTES {
                page.bundle.as_mut().ok_or("FEED_INVALID")?.events.pop();
                break;
            }
        }
        let count = page.bundle.as_ref().ok_or("FEED_INVALID")?.events.len() as u64;
        page.has_more = after + count < page.head.as_ref().ok_or("FEED_INVALID")?.sequence;
        let request = ReadFeedRequest{actor_ptid: actor.into(), chain_id: feed::PUBLIC_CHAIN_ID.into(),
            after_sequence: after, limit, ..Default::default()};
        let page_head = feed::verify_read_page(&request, &page, root, Some(&start)).map_err(|e| e.to_string())?;
        Ok((page, page_head))
    }

    fn verified_remote_head(connection: &Connection, actor: &str, root: &[u8], home: &str)
        -> Result<Option<FeedHead>, String> {
        let row: Option<(String, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>)> = connection.query_row(
            "SELECT home, root, genesis, grant_bytes, head FROM social_remote_feed_heads WHERE actor=?1 AND chain=?2",
            params![actor, feed::PUBLIC_CHAIN_ID], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .optional().map_err(|e| e.to_string())?;
        let Some((retained_home, retained_root, g, w, h)) = row else { return Ok(None); };
        if retained_home != home || retained_root != root { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        let genesis: FeedGenesis = feed::decode_canonical(&g).map_err(|e| e.to_string())?;
        let grant: FeedWriterGrant = feed::decode_canonical(&w).map_err(|e| e.to_string())?;
        feed::verify_authorization(&genesis, &grant, actor, root).map_err(|e| e.to_string())?;
        let observed: FeedHead = feed::decode_canonical(&h).map_err(|e| e.to_string())?;
        let mut head = feed::initial_head(&genesis).map_err(|e| e.to_string())?;
        let mut replay = feed::FeedPostReplay::default();
        let mut creations = Vec::new();
        let mut query = connection.prepare(
            "SELECT sequence, event FROM social_remote_feed_events WHERE actor=?1 AND chain=?2 ORDER BY sequence")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![actor, feed::PUBLIC_CHAIN_ID],
            |r| Ok((r.get::<_, u64>(0)?, r.get::<_, Vec<u8>>(1)?))).map_err(|e| e.to_string())?;
        for row in rows {
            let (sequence, wire) = row.map_err(|e| e.to_string())?;
            let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
            feed::verify_event(&event, &grant).map_err(|e| e.to_string())?;
            if event.statement.as_ref().ok_or("FEED_INVALID")?.sequence != sequence { return Err("FEED_INVALID".into()); }
            head = feed::advance_head(&head, &event).map_err(|e| e.to_string())?;
            replay.observe(&event).map_err(|e| e.to_string())?;
            if event.statement.as_ref().ok_or("FEED_INVALID")?.kind == FeedEventKind::PostCreated as i32 {
                creations.push(event);
            }
        }
        feed::verify_observed_head(&head, &observed).map_err(|e| e.to_string())?;
        for event in creations { retain_creation(connection,&event,home)?; }
        Ok(Some(head))
    }

    /// Verify and import in one transaction. An advertised unseen tail never
    /// becomes the retained head, and failed verification publishes no bytes.
    pub(super) fn import_remote_page(&mut self, request: &ReadFeedRequest, response: &ReadFeedResponse,
        root: &[u8], home: &str) -> Result<FeedHead, String> {
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let previous = Self::verified_remote_head(&tx, &request.actor_ptid, root, home)?;
        let head = feed::verify_read_page(request, response, root, previous.as_ref()).map_err(|e| e.to_string())?;
        let bundle = response.bundle.as_ref().ok_or("FEED_INVALID")?;
        let genesis = bundle.genesis.as_ref().ok_or("FEED_INVALID")?.encode_to_vec();
        let grant = bundle.writer_grant.as_ref().ok_or("FEED_INVALID")?.encode_to_vec();
        let retained_authorization: Option<(Vec<u8>,Vec<u8>)> = tx.query_row(
            "SELECT genesis,grant_bytes FROM social_feed_receipt_authorizations WHERE actor=?1",
            params![request.actor_ptid],|r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
        if retained_authorization.is_some_and(|(g,w)| g != genesis || w != grant) {
            return Err("FEED_WRITER_NOT_AUTHORIZED".into());
        }
        let existing: Option<(Vec<u8>, Vec<u8>)> = tx.query_row(
            "SELECT genesis, grant_bytes FROM social_remote_feed_heads WHERE actor=?1 AND chain=?2",
            params![request.actor_ptid, request.chain_id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
        if let Some((g, w)) = existing {
            if g != genesis || w != grant { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        } else {
            tx.execute("INSERT INTO social_remote_feed_heads VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![request.actor_ptid, request.chain_id, home, root, genesis, grant, head.encode_to_vec()])
                .map_err(|e| e.to_string())?;
        }
        for event in &bundle.events {
            let statement = event.statement.as_ref().ok_or("FEED_INVALID")?;
            let receipt_wire: Option<Vec<u8>> = tx.query_row(
                "SELECT receipt FROM social_remote_feed_threads WHERE actor=?1 AND chain=?2 AND sequence=?3",
                params![request.actor_ptid,request.chain_id,statement.sequence],|r| r.get(0))
                .optional().map_err(|e| e.to_string())?;
            if let Some(wire) = receipt_wire {
                let receipt: FeedInteraction = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
                if receipt.event.as_ref() != Some(event) {
                    return Err("FEED_FORK_DETECTED".into());
                }
            }
            tx.execute("INSERT INTO social_remote_feed_events VALUES (?1,?2,?3,?4)",
                params![request.actor_ptid, request.chain_id, event.statement.as_ref().ok_or("FEED_INVALID")?.sequence,
                    event.encode_to_vec()]).map_err(|e| e.to_string())?;
        }
        tx.execute("UPDATE social_remote_feed_heads SET head=?3 WHERE actor=?1 AND chain=?2",
            params![request.actor_ptid, request.chain_id, head.encode_to_vec()]).map_err(|e| e.to_string())?;
        Self::verified_remote_head(&tx,&request.actor_ptid,root,home)?.ok_or("FEED_GAP")?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(head)
    }

    pub(super) fn initialize(&mut self, genesis: &FeedGenesis, grant: &FeedWriterGrant,
        actor: &str, root: &[u8]) -> Result<(), String> {
        feed::verify_authorization(genesis, grant, actor, root).map_err(|e| e.to_string())?;
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let existing: Option<(Vec<u8>, Vec<u8>, Vec<u8>)> = tx.query_row(
            "SELECT root, genesis, grant_bytes FROM social_feed_heads WHERE actor=?1 AND chain=?2",
            params![actor, feed::PUBLIC_CHAIN_ID], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        ).optional().map_err(|e| e.to_string())?;
        if let Some((retained, previous, writer)) = existing {
            if retained != root || previous != genesis.encode_to_vec() || writer != grant.encode_to_vec() {
                return Err("FEED_WRITER_NOT_AUTHORIZED".into());
            }
        } else {
            let head = feed::initial_head(genesis).map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO social_feed_heads VALUES (?1,?2,?3,?4,?5,?6)",
                params![actor, feed::PUBLIC_CHAIN_ID, root, genesis.encode_to_vec(), grant.encode_to_vec(), head.encode_to_vec()])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub(super) fn authorization(&self, actor: &str, root: &[u8]) -> Result<Option<FeedBundle>, String> {
        let row: Option<(Vec<u8>, Vec<u8>, Vec<u8>)> = self.connection.query_row(
            "SELECT root, genesis, grant_bytes FROM social_feed_heads WHERE actor=?1 AND chain=?2",
            params![actor, feed::PUBLIC_CHAIN_ID], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        ).optional().map_err(|e| e.to_string())?;
        let Some((retained, g, w)) = row else { return Ok(None); };
        if retained != root { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        let genesis: FeedGenesis = feed::decode_canonical(&g).map_err(|e| e.to_string())?;
        let grant: FeedWriterGrant = feed::decode_canonical(&w).map_err(|e| e.to_string())?;
        feed::verify_authorization(&genesis, &grant, actor, root).map_err(|e| e.to_string())?;
        Ok(Some(FeedBundle{genesis: Some(genesis), writer_grant: Some(grant), events: vec![]}))
    }

    pub(super) fn head(&self, actor: &str) -> Result<FeedHead, String> {
        Self::verified_head(&self.connection, actor)
    }

    fn verified_head(connection: &Connection, actor: &str) -> Result<FeedHead, String> {
        let (root, genesis, grant, wire): (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) = connection.query_row(
            "SELECT root, genesis, grant_bytes, head FROM social_feed_heads WHERE actor=?1 AND chain=?2",
            params![actor, feed::PUBLIC_CHAIN_ID], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?;
        let genesis: FeedGenesis = feed::decode_canonical(&genesis).map_err(|e| e.to_string())?;
        let grant: FeedWriterGrant = feed::decode_canonical(&grant).map_err(|e| e.to_string())?;
        feed::verify_authorization(&genesis, &grant, actor, &root).map_err(|e| e.to_string())?;
        let observed: FeedHead = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
        let mut expected = feed::initial_head(&genesis).map_err(|e| e.to_string())?;
        let mut replay = feed::FeedPostReplay::default();
        let mut creations = Vec::new();
        let mut query = connection.prepare(
            "SELECT sequence, event FROM social_feed_journal WHERE actor=?1 AND chain=?2 AND confirmed=1 ORDER BY sequence")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![actor, feed::PUBLIC_CHAIN_ID],
            |r| Ok((r.get::<_, u64>(0)?, r.get::<_, Vec<u8>>(1)?))).map_err(|e| e.to_string())?;
        for row in rows {
            let (sequence, bytes) = row.map_err(|e| e.to_string())?;
            let event: FeedEvent = feed::decode_canonical(&bytes).map_err(|e| e.to_string())?;
            feed::verify_event(&event, &grant).map_err(|e| e.to_string())?;
            if event.statement.as_ref().ok_or("FEED_INVALID")?.sequence != sequence {
                return Err("FEED_INVALID".into());
            }
            expected = feed::advance_head(&expected, &event).map_err(|e| e.to_string())?;
            replay.observe(&event).map_err(|e| e.to_string())?;
            if event.statement.as_ref().ok_or("FEED_INVALID")?.kind == FeedEventKind::PostCreated as i32 {
                creations.push(event);
            }
        }
        feed::verify_observed_head(&expected, &observed).map_err(|e| e.to_string())?;
        let home: Option<String> = connection.query_row("SELECT home FROM social_feed_actor_pins WHERE actor=?1",
            params![actor],|r| r.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(home) = home { for event in creations { retain_creation(connection,&event,&home)?; } }
        Ok(expected)
    }

    pub(super) fn pending(&self, actor: &str, root: &[u8]) -> Result<Vec<(String, FeedEvent)>, String> {
        let bundle = self.authorization(actor, root)?.ok_or("FEED_WRITER_NOT_AUTHORIZED")?;
        let grant = bundle.writer_grant.as_ref().ok_or("FEED_INVALID")?;
        let head = self.head(actor)?;
        let mut query = self.connection.prepare(
            "SELECT command_id, sequence, event FROM social_feed_journal WHERE actor=?1 AND chain=?2 AND confirmed=0 ORDER BY sequence")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![actor, feed::PUBLIC_CHAIN_ID], |r|
            Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?, r.get::<_, Vec<u8>>(2)?)))
            .map_err(|e| e.to_string())?;
        let mut pending = Vec::new();
        for row in rows {
            let (command, sequence, wire) = row.map_err(|e| e.to_string())?;
            let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
            feed::verify_event(&event, grant).map_err(|e| e.to_string())?;
            if !pending.is_empty() || event.statement.as_ref().ok_or("FEED_INVALID")?.sequence != sequence {
                return Err("FEED_INVALID".into());
            }
            feed::advance_head(&head, &event).map_err(|e| e.to_string())?;
            pending.push((command, event));
        }
        Ok(pending)
    }

    /// A timeout leaves this exact signed event pending. A later command may
    /// not allocate its sequence until that event receives a verified ACK.
    pub(super) fn stage(&mut self, actor: &str, root: &[u8], command: &str,
        kind: i32, payload: &FeedPayload, now: i64, writer: &Keypair) -> Result<FeedBundle, String> {
        if command.is_empty() || command.len() > 128 || command.trim() != command {
            return Err("FEED_INVALID".into());
        }
        feed::validate_payload(kind, payload).map_err(|e| e.to_string())?;
        let mut bundle = self.authorization(actor, root)?.ok_or("FEED_WRITER_NOT_AUTHORIZED")?;
        let grant = bundle.writer_grant.as_ref().ok_or("FEED_INVALID")?;
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let head = Self::verified_head(&tx, actor)?;
        let existing: Option<(u64, Vec<u8>, bool)> = tx.query_row(
            "SELECT sequence, event, confirmed FROM social_feed_journal WHERE actor=?1 AND chain=?2 AND command_id=?3",
            params![actor, feed::PUBLIC_CHAIN_ID, command], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional().map_err(|e| e.to_string())?;
        if let Some((sequence, wire, confirmed)) = existing {
            let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
            feed::verify_event(&event, grant).map_err(|e| e.to_string())?;
            if event.statement.as_ref().ok_or("FEED_INVALID")?.sequence != sequence {
                return Err("FEED_INVALID".into());
            }
            if !confirmed {
                feed::advance_head(&head, &event).map_err(|e| e.to_string())?;
            }
            if event.statement.as_ref().ok_or("FEED_INVALID")?.kind != kind || event.payload != payload.encode_to_vec() {
                return Err("FEED_COMMAND_CONFLICT".into());
            }
            bundle.events.push(event);
            return Ok(bundle);
        }
        let pending: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM social_feed_journal WHERE actor=?1 AND chain=?2 AND confirmed=0)",
            params![actor, feed::PUBLIC_CHAIN_ID], |r| r.get(0)).map_err(|e| e.to_string())?;
        if pending { return Err("FEED_PENDING_ACK".into()); }
        if let Some(feed_payload::Mutation::Post(post)) = payload.mutation.as_ref() {
            if kind == FeedEventKind::PostUpdated as i32 {
                let home: String = tx.query_row("SELECT home FROM social_feed_actor_pins WHERE actor=?1",
                    params![actor],|r| r.get(0)).map_err(|e| e.to_string())?;
                let (author,original,created) = creation_for_post(&tx,&format!("oss://{home}/post/{}",post.post_id))?;
                if author != actor { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
                let updated = feed::decode_canonical(&post.create_request).map_err(|e| e.to_string())?;
                feed::validate_post_update(&original,&updated,created).map_err(|e| e.to_string())?;
            }
        }
        if let Some(feed_payload::Mutation::PollBallot(ballot)) = payload.mutation.as_ref() {
            let pending: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM social_feed_poll_admissions WHERE actor=?1 AND chain=?2 AND target=?3 AND admission IS NULL)",
                params![actor,feed::PUBLIC_CHAIN_ID,ballot.target_post_ref],|r| r.get(0)).map_err(|e| e.to_string())?;
            if pending { return Err("FEED_POLL_ADMISSION_PENDING".into()); }
        }
        let event = feed::sign_event(FeedEventStatement{
            format_version: 1, actor_ptid: actor.into(), chain_id: feed::PUBLIC_CHAIN_ID.into(),
            sequence: head.sequence.checked_add(1).ok_or("FEED_INVALID")?,
            previous_hash: head.event_hash, writer_grant_hash: feed::hash(feed::GRANT_DOMAIN, grant).map_err(|e| e.to_string())?,
            kind, created_at_unix_ms: now, payload_hash: vec![],
        }, payload, writer).map_err(|e| e.to_string())?;
        feed::verify_event(&event, grant).map_err(|e| e.to_string())?;
        let mut replay = feed::FeedPostReplay::default();
        let mut query = tx.prepare("SELECT event FROM social_feed_journal WHERE actor=?1 AND chain=?2 AND confirmed=1 ORDER BY sequence")
            .map_err(|e| e.to_string())?;
        let rows = query.query_map(params![actor,feed::PUBLIC_CHAIN_ID],|r| r.get::<_,Vec<u8>>(0)).map_err(|e| e.to_string())?;
        for row in rows {
            let event: FeedEvent = feed::decode_canonical(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            replay.observe(&event).map_err(|e| e.to_string())?;
        }
        replay.observe(&event).map_err(|e| e.to_string())?;
        drop(query);
        tx.execute("INSERT INTO social_feed_journal VALUES (?1,?2,?3,?4,?5,0)",
            params![actor, feed::PUBLIC_CHAIN_ID, event.statement.as_ref().ok_or("FEED_INVALID")?.sequence as i64,
                command, event.encode_to_vec()]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        bundle.events.push(event);
        Ok(bundle)
    }

    pub(super) fn confirm(&mut self, actor: &str, root: &[u8], command: &str,
        observed: &FeedHead) -> Result<(), String> {
        let bundle = self.authorization(actor, root)?.ok_or("FEED_WRITER_NOT_AUTHORIZED")?;
        let grant = bundle.writer_grant.as_ref().ok_or("FEED_INVALID")?;
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let (sequence, wire, confirmed): (u64, Vec<u8>, bool) = tx.query_row(
            "SELECT sequence, event, confirmed FROM social_feed_journal WHERE actor=?1 AND chain=?2 AND command_id=?3",
            params![actor, feed::PUBLIC_CHAIN_ID, command], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?;
        let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
        feed::verify_event(&event, grant).map_err(|e| e.to_string())?;
        if event.statement.as_ref().ok_or("FEED_INVALID")?.sequence != sequence {
            return Err("FEED_INVALID".into());
        }
        let previous = Self::verified_head(&tx, actor)?;
        let next = if confirmed { previous } else { feed::advance_head(&previous, &event).map_err(|e| e.to_string())? };
        feed::verify_observed_head(&next, observed).map_err(|e| e.to_string())?;
        tx.execute("UPDATE social_feed_heads SET head=?3 WHERE actor=?1 AND chain=?2",
            params![actor, feed::PUBLIC_CHAIN_ID, next.encode_to_vec()]).map_err(|e| e.to_string())?;
        tx.execute("UPDATE social_feed_journal SET confirmed=1 WHERE actor=?1 AND chain=?2 AND command_id=?3",
            params![actor, feed::PUBLIC_CHAIN_ID, command]).map_err(|e| e.to_string())?;
        Self::verified_head(&tx,actor)?;
        remember_pending_admission(&tx,&event)?;
        tx.commit().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn no_poll_key(_: &str) -> Result<(String,Vec<u8>),String> {
        Err("FEED_POLL_TRUST_UNAVAILABLE".into())
    }
    fn fixture() -> (PublicFeedStore, FeedBundle, Vec<u8>, Keypair) {
        let vector: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../model/domain/social/testdata/feed_v1.json")).unwrap();
        let bundle = feed::decode_canonical(&hex::decode(vector["bundle"].as_str().unwrap()).unwrap()).unwrap();
        let root = hex::decode(vector["root_public_key"].as_str().unwrap()).unwrap();
        (PublicFeedStore::from_connection(Connection::open_in_memory().unwrap()).unwrap(),
            bundle, root, Keypair::ed25519_from_bytes([2;32]).unwrap())
    }
    #[test]
    fn thread_receipts_require_independent_root_and_signed_target_then_replay() {
        use feed::content::social::v1::{CreatePostRequest,Audience,create_post_request,CreateTextPostRequest};
        let (mut store, mut bundle, root, writer) = fixture();
        let actor = "ptid:test:alice";
        let interaction_payload: FeedPayload=feed::decode_canonical(&bundle.events[0].payload).unwrap();
        let mut interaction_statement=bundle.events[0].statement.clone().unwrap();
        interaction_statement.sequence=9;
        let receipt = FeedInteraction{genesis:bundle.genesis.clone(),writer_grant:bundle.writer_grant.clone(),
            event:Some(feed::sign_event(interaction_statement,&interaction_payload,&writer).unwrap()),..Default::default()};
        let content = CreatePostRequest{audience:Some(Audience{kind:1,..Default::default()}),
            content:Some(create_post_request::Content::Text(CreateTextPostRequest{text:"post".into()})),
            ..Default::default()};
        let payload = FeedPayload{mutation:Some(feed_payload::Mutation::Post(FeedPostMutation{
            post_id:"101".into(),create_request:content.encode_to_vec()}))};
        let mut statement = bundle.events[0].statement.clone().unwrap();
        statement.kind=1;
        bundle.events[0]=feed::sign_event(statement,&payload,&writer).unwrap();
        store.pin_actor(actor,"station-a",&root).unwrap();
        let head=feed::advance_head(&feed::initial_head(bundle.genesis.as_ref().unwrap()).unwrap(),&bundle.events[0]).unwrap();
        let request=ReadFeedRequest{actor_ptid:actor.into(),chain_id:feed::PUBLIC_CHAIN_ID.into(),
            limit:32,include_thread:true,..Default::default()};
        let response=ReadFeedResponse{bundle:Some(bundle),head:Some(head),thread_cursor:1,
            thread_entries:vec![FeedThreadEntry{cursor:1,interaction_home_station:"station-a".into(),receipt:Some(receipt)}],
            ..Default::default()};
        store.import_remote_page(&request,&response,&root,"station-a").unwrap();
        let mut roots=std::collections::BTreeMap::new();
        roots.insert(actor.into(),vec![3;32]);
        assert!(store.import_thread(&request,&response,&roots,&no_poll_key).is_err());
        assert_eq!(store.thread_cursor(actor,&no_poll_key).unwrap(),0);
        roots.insert(actor.into(),root);
        let mut corrupt=response.clone();
        corrupt.thread_entries[0].receipt.as_mut().unwrap().event.as_mut().unwrap().payload[0]^=1;
        assert!(store.import_thread(&request,&corrupt,&roots,&no_poll_key).is_err());
        store.import_thread(&request,&response,&roots,&no_poll_key).unwrap();
        assert_eq!(store.thread_cursor(actor,&no_poll_key).unwrap(),1);
        assert_eq!(store.thread_page(actor,0,&no_poll_key).unwrap(),response.thread_entries);
        assert!(store.thread_page(actor,1,&no_poll_key).unwrap().is_empty());
        store.connection.execute("UPDATE social_remote_feed_threads SET sequence=10",[]).unwrap();
        assert!(store.thread_cursor(actor,&no_poll_key).is_err());
        store.connection.execute("UPDATE social_remote_feed_threads SET sequence=9",[]).unwrap();
        assert_eq!(store.thread_cursor(actor,&no_poll_key).unwrap(),1);
        store.connection.execute("UPDATE social_remote_feed_threads SET receipt=?1",params![vec![0u8;32]]).unwrap();
        assert!(store.thread_cursor(actor,&no_poll_key).is_err());
    }
    #[test]
    fn comment_reaction_waits_for_signed_creation_and_rejects_wrong_parent_and_cache_tampering() {
        use feed::content::social::v1::{CreatePostRequest,Audience,create_post_request,CreateTextPostRequest,
            CreateCommentRequest};
        let (mut store, mut bundle, root, writer) = fixture();
        let actor = "ptid:test:alice";
        let content = CreatePostRequest{audience:Some(Audience{kind:1,..Default::default()}),
            content:Some(create_post_request::Content::Text(CreateTextPostRequest{text:"post".into()})),
            ..Default::default()};
        let payload = FeedPayload{mutation:Some(feed_payload::Mutation::Post(FeedPostMutation{
            post_id:"101".into(),create_request:content.encode_to_vec()}))};
        let mut statement = bundle.events[0].statement.clone().unwrap();
        statement.kind=FeedEventKind::PostCreated as i32;
        bundle.events[0]=feed::sign_event(statement.clone(),&payload,&writer).unwrap();
        let mut second_statement=statement.clone();
        second_statement.sequence=2;
        second_statement.previous_hash=feed::event_hash(&bundle.events[0]).unwrap();
        let second_payload=FeedPayload{mutation:Some(feed_payload::Mutation::Post(FeedPostMutation{
            post_id:"102".into(),create_request:content.encode_to_vec()}))};
        bundle.events.push(feed::sign_event(second_statement,&second_payload,&writer).unwrap());
        store.pin_actor(actor,"station-a",&root).unwrap();
        let mut head=feed::initial_head(bundle.genesis.as_ref().unwrap()).unwrap();
        for event in &bundle.events { head=feed::advance_head(&head,event).unwrap(); }
        let mut request=ReadFeedRequest{actor_ptid:actor.into(),chain_id:feed::PUBLIC_CHAIN_ID.into(),
            limit:32,include_thread:true,..Default::default()};
        store.import_remote_page(&request,&ReadFeedResponse{bundle:Some(bundle.clone()),head:Some(head),
            ..Default::default()},&root,"station-a").unwrap();
        let mut interaction = |sequence, kind, payload: &FeedPayload| {
            statement.sequence=sequence;
            statement.kind=kind;
            FeedInteraction{genesis:bundle.genesis.clone(),writer_grant:bundle.writer_grant.clone(),
                event:Some(feed::sign_event(statement.clone(),payload,&writer).unwrap()),..Default::default()}
        };
        let reaction=interaction(8,FeedEventKind::ReactionSet as i32,&FeedPayload{
            mutation:Some(feed_payload::Mutation::Reaction(FeedReactionMutation{
                target_post_ref:"oss://station-a/post/101".into(),
                target_comment_ref:"oss://station-a/comment/201".into(),reaction_kind:1}))});
        let roots=std::collections::BTreeMap::from([(actor.to_string(),root)]);
        let response=ReadFeedResponse{thread_cursor:1,thread_has_more:true,thread_entries:vec![
            FeedThreadEntry{cursor:1,interaction_home_station:"station-a".into(),receipt:Some(reaction)}],
            ..Default::default()};
        store.import_thread(&request,&response,&roots,&no_poll_key).unwrap();
        assert_eq!(store.thread_cursor(actor,&no_poll_key).unwrap(),1);
        assert!(store.thread_page(actor,0,&no_poll_key).unwrap().is_empty());
        let creation=interaction(9,FeedEventKind::CommentCreated as i32,&FeedPayload{
            mutation:Some(feed_payload::Mutation::Comment(FeedCommentMutation{comment_id:"201".into(),
                target_post_ref:"oss://station-a/post/101".into(),create_request:CreateCommentRequest{
                    post_id:"oss://station-a/post/101".into(),content:"comment".into(),..Default::default()}.encode_to_vec()}))});
        request.after_thread_cursor=1;
        let response=ReadFeedResponse{thread_cursor:2,thread_entries:vec![
            FeedThreadEntry{cursor:2,interaction_home_station:"station-a".into(),receipt:Some(creation.clone())}],
            ..Default::default()};
        store.import_thread(&request,&response,&roots,&no_poll_key).unwrap();
        assert_eq!(store.thread_page(actor,0,&no_poll_key).unwrap().len(),2);
        // A signed creation bound to another post must never authorize this
        // reaction, even when its comment ID and writer match.
        let mut wrong=creation.clone();
        let mut payload: FeedPayload=feed::decode_canonical(&wrong.event.as_ref().unwrap().payload).unwrap();
        if let Some(feed_payload::Mutation::Comment(comment))=&mut payload.mutation {
            comment.target_post_ref="oss://station-a/post/102".into();
            comment.create_request=CreateCommentRequest{post_id:comment.target_post_ref.clone(),
                content:"comment".into(),..Default::default()}.encode_to_vec();
        }
        wrong.event=Some(feed::sign_event(wrong.event.unwrap().statement.unwrap(),&payload,&writer).unwrap());
        store.connection.execute("UPDATE social_remote_feed_threads SET receipt=?1 WHERE cursor=2",
            params![wrong.encode_to_vec()]).unwrap();
        assert_eq!(store.thread_page(actor,0,&no_poll_key).unwrap_err(),"FEED_INVALID");
        let mut corrupt=creation.encode_to_vec();
        *corrupt.last_mut().unwrap() ^= 1;
        store.connection.execute("UPDATE social_remote_feed_threads SET receipt=?1 WHERE cursor=2",params![corrupt]).unwrap();
        assert!(store.thread_cursor(actor,&no_poll_key).is_err());
    }
    #[test]
    fn journal_retry_is_exact_and_unverified_ack_cannot_advance() {
        let (mut store, b, root, writer) = fixture();
        let actor = "ptid:test:alice";
        store.initialize(b.genesis.as_ref().unwrap(), b.writer_grant.as_ref().unwrap(), actor, &root).unwrap();
        let payload: FeedPayload = feed::decode_canonical(&b.events[0].payload).unwrap();
        let first = store.stage(actor, &root, "command", 4, &payload, 1700000000000, &writer).unwrap();
        let retry = store.stage(actor, &root, "command", 4, &payload, 1700000000999, &writer).unwrap();
        assert_eq!(first.encode_to_vec(), retry.encode_to_vec());
        assert_eq!(store.pending(actor, &root).unwrap()[0], ("command".into(), first.events[0].clone()));
        assert_eq!(store.stage(actor, &root, "next", 4, &payload, 1700000000999, &writer).unwrap_err(), "FEED_PENDING_ACK");
        let head = feed::advance_head(&store.head(actor).unwrap(), &first.events[0]).unwrap();
        let mut tampered = head.clone();
        tampered.event_hash[0] ^= 1;
        assert_eq!(store.confirm(actor, &root, "command", &tampered).unwrap_err(), "FEED_FORK_DETECTED");
        assert_eq!(store.head(actor).unwrap().sequence, 0);
        store.confirm(actor, &root, "command", &head).unwrap();
        assert!(store.pending(actor, &root).unwrap().is_empty());
        assert_eq!(store.head(actor).unwrap(), head);
        store.confirm(actor, &root, "command", &head).unwrap();
        let second = store.stage(actor, &root, "next", 4, &payload, 1700000000999, &writer).unwrap();
        assert_eq!(second.events[0].statement.as_ref().unwrap().sequence, 2);
    }

    #[test]
    fn remote_read_pins_identity_and_rejects_rollback_or_mutable_body() {
        let (mut store, bundle, root, _) = fixture();
        let actor = "ptid:test:alice";
        store.pin_actor(actor, "station-a", &root).unwrap();
        assert!(store.pin_actor(actor, "station-a", &[3; 32]).is_err());
        assert!(store.pin_actor(actor, "station-other", &root).is_err());
        let request = ReadFeedRequest{actor_ptid: actor.into(), chain_id: feed::PUBLIC_CHAIN_ID.into(),
            after_sequence: 0, limit: 32, ..Default::default()};
        let initial = feed::initial_head(bundle.genesis.as_ref().unwrap()).unwrap();
        let head = feed::advance_head(&initial, &bundle.events[0]).unwrap();
        let response = ReadFeedResponse{bundle: Some(bundle.clone()), head: Some(head.clone()), has_more: false, ..Default::default()};
        let mut corrupt = response.clone();
        corrupt.bundle.as_mut().unwrap().events[0].payload[0] ^= 1;
        assert!(store.import_remote_page(&request, &corrupt, &root, "station-a").is_err());
        assert!(store.remote_head(actor, &root, "station-a").unwrap().is_none());
        assert_eq!(store.import_remote_page(&request, &response, &root, "station-a").unwrap(), head);
        let request = ReadFeedRequest{after_sequence: 1, ..request};
        let rollback = ReadFeedResponse{bundle: Some(FeedBundle{events: vec![], ..bundle.clone()}),
            head: Some(initial), has_more: false, ..Default::default()};
        assert!(store.import_remote_page(&request, &rollback, &root, "station-a").is_err());
        assert_eq!(store.remote_head(actor, &root, "station-a").unwrap(), Some(head));
        let (replayed, replay_head) = store.remote_page(actor, &root, "station-a", 0, 32).unwrap();
        assert_eq!(replayed.bundle.unwrap(), bundle);
        assert_eq!(replay_head.sequence, 1);
        let (empty, _) = store.remote_page(actor, &root, "station-a", 1, 32).unwrap();
        assert!(empty.bundle.unwrap().events.is_empty());
        assert!(store.remote_page(actor, &root, "station-a", 2, 32).is_err());
        store.connection.execute("UPDATE social_remote_feed_events SET event=?1", params![vec![0u8;32]]).unwrap();
        assert!(store.remote_head(actor, &root, "station-a").is_err());
    }

    #[test]
    fn corrupted_retained_head_and_missing_history_block_signing() {
        let (mut store, b, root, writer) = fixture();
        let actor = "ptid:test:alice";
        store.initialize(b.genesis.as_ref().unwrap(), b.writer_grant.as_ref().unwrap(), actor, &root).unwrap();
        let payload: FeedPayload = feed::decode_canonical(&b.events[0].payload).unwrap();
        let first = store.stage(actor, &root, "first", 4, &payload, 1700000000000, &writer).unwrap();
        let initial = store.head(actor).unwrap();
        let head = feed::advance_head(&initial, &first.events[0]).unwrap();
        store.confirm(actor, &root, "first", &head).unwrap();
        store.connection.execute("UPDATE social_feed_heads SET head=?1", params![initial.encode_to_vec()]).unwrap();
        assert!(store.stage(actor, &root, "next", 4, &payload, 1700000000001, &writer).is_err());
        store.connection.execute("UPDATE social_feed_heads SET head=?1", params![head.encode_to_vec()]).unwrap();
        store.connection.execute("DELETE FROM social_feed_journal WHERE confirmed=1", []).unwrap();
        assert!(store.head(actor).is_err());
        assert!(store.stage(actor, &root, "next", 4, &payload, 1700000000001, &writer).is_err());
    }

    #[test]
    fn poll_source_ack_releases_chain_and_retains_exact_pending_admission() {
        use feed::content::social::v1::{CreatePostRequest,CreatePollPostRequest,Audience,create_post_request};
        let (mut store,bundle,root,writer) = fixture();
        let actor = "ptid:test:alice";
        let now = 1_700_000_000_000;
        store.pin_actor(actor,"station-a",&root).unwrap();
        store.initialize(bundle.genesis.as_ref().unwrap(),bundle.writer_grant.as_ref().unwrap(),actor,&root).unwrap();
        let request = CreatePostRequest {r#type: 4,audience: Some(Audience {kind: 1,..Default::default()}),
            content: Some(create_post_request::Content::Poll(CreatePollPostRequest {
                text: "original".into(),question: "Which route?".into(),options: vec!["Direct".into(),"Relay".into()],
                duration_hours: 1,..Default::default()
            })),..Default::default()};
        let post = FeedPayload {mutation: Some(feed_payload::Mutation::Post(FeedPostMutation {
            post_id: "101".into(),create_request: request.encode_to_vec()
        }))};
        let created = store.stage(actor,&root,"create",1,&post,now,&writer).unwrap();
        let head = feed::advance_head(&store.head(actor).unwrap(),&created.events[0]).unwrap();
        store.confirm(actor,&root,"create",&head).unwrap();
        let (_,original,created_at) = creation_for_post(&store.connection,"oss://station-a/post/101").unwrap();
        assert_eq!(original,request);
        assert_eq!(created_at,now);
        let create_post_request::Content::Poll(poll) = request.content.as_ref().unwrap() else { panic!("poll"); };
        let definition = feed::poll_definition(poll,now).unwrap();
        let ballot = FeedPayload {mutation: Some(feed_payload::Mutation::PollBallot(FeedPollBallotMutation {
            target_post_ref: "oss://station-a/post/101".into(),definition_hash: feed::poll_definition_hash(&definition).unwrap(),
            option_indices: vec![0]
        }))};
        let issued = store.stage(actor,&root,"ballot",9,&ballot,now+1,&writer).unwrap();
        let head = feed::advance_head(&store.head(actor).unwrap(),&issued.events[0]).unwrap();
        store.confirm(actor,&root,"ballot",&head).unwrap();
        assert!(store.pending(actor,&root).unwrap().is_empty());
        assert_eq!(store.pending_poll_admissions(actor).unwrap(),vec![("ballot".into(),issued.events[0].clone())]);
        assert_eq!(store.stage(actor,&root,"ballot",9,&ballot,now+2,&writer).unwrap(),issued);
        assert_eq!(store.stage(actor,&root,"other-ballot",9,&ballot,now+2,&writer).unwrap_err(),"FEED_POLL_ADMISSION_PENDING");
        let reaction: FeedPayload = feed::decode_canonical(&bundle.events[0].payload).unwrap();
        let other = store.stage(actor,&root,"reaction",4,&reaction,now+2,&writer).unwrap();
        let head = feed::advance_head(&store.head(actor).unwrap(),&other.events[0]).unwrap();
        store.confirm(actor,&root,"reaction",&head).unwrap();
        assert_eq!(store.head(actor).unwrap().sequence,3);
        let home_key = Keypair::ed25519_from_bytes([7u8;32]).unwrap();
        let statement = FeedPollAdmissionStatement {format_version: 1,home_station_peer_id: "station-a".into(),
            target_post_ref: "oss://station-a/post/101".into(),event_hash: feed::event_hash(&issued.events[0]).unwrap(),
            definition_hash: feed::poll_definition_hash(&definition).unwrap(),accepted_at_unix_ms: now+2,
            result: FeedPollAdmissionResult::Accepted as i32,signing_key_id: "home-key".into()};
        let admission = FeedPollAdmission {station_signature: home_key.sign(
            &feed::signing_bytes(feed::POLL_ADMISSION_DOMAIN,&statement).unwrap()).unwrap(),statement: Some(statement)};
        let key = home_key.public().try_into_ed25519().unwrap().to_bytes().to_vec();
        let keys = |home: &str| {
            if home != "station-a" { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
            Ok(("home-key".into(),key.clone()))
        };
        store.retain_poll_admission(&issued.events[0],&admission,&keys).unwrap();
        assert!(store.pending_poll_admissions(actor).unwrap().is_empty());
        assert_eq!(store.poll_admission_for(&issued.events[0],&keys).unwrap(),Some(admission.clone()));
        assert!(store.poll_admission_for(&issued.events[0],&|_| Ok(("foreign".into(),vec![8;32]))).is_err());
        let receipt = FeedInteraction {genesis: issued.genesis.clone(),writer_grant: issued.writer_grant.clone(),
            event: Some(issued.events[0].clone()),poll_admission: Some(admission.clone())};
        let request = ReadFeedRequest {actor_ptid: actor.into(),chain_id: feed::PUBLIC_CHAIN_ID.into(),
            limit: 32,include_thread: true,..Default::default()};
        let response = ReadFeedResponse {thread_cursor: 1,thread_entries: vec![FeedThreadEntry {
            cursor: 1,interaction_home_station: "station-a".into(),receipt: Some(receipt.clone()),
        }],..Default::default()};
        let roots = std::collections::BTreeMap::from([(actor.to_string(),root.clone())]);
        store.import_thread(&request,&response,&roots,&keys).unwrap();
        assert_eq!(store.thread_page(actor,0,&keys).unwrap(),response.thread_entries);
        let base: Vec<u8> = store.connection.query_row("SELECT receipt FROM social_remote_feed_threads",
            [],|r| r.get(0)).unwrap();
        assert!(feed::decode_canonical::<FeedInteraction>(&base).unwrap().poll_admission.is_none());
        assert!(store.thread_cursor(actor,&|_| Ok(("foreign".into(),vec![8;32]))).is_err());
        assert_eq!(store.stage(actor,&root,"replacement",9,&ballot,now+3,&writer).unwrap().events[0].statement.as_ref().unwrap().sequence,4);
    }
}
