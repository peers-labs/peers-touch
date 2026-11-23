//! Disposable post-creation indexes share the original SQLCipher journal.
//! This module only retains generic interaction targeting and creation
//! ancestry; poll admissions are no longer part of the social protocol.
use super::*;

pub(super) const POST_CREATIONS_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS social_feed_post_creations (
    target TEXT PRIMARY KEY, actor TEXT NOT NULL, chain TEXT NOT NULL,
    sequence INTEGER NOT NULL, UNIQUE(actor,chain,sequence)
);";

pub(super) fn interaction_target(payload: &FeedPayload) -> Result<&str, String> {
    match payload.mutation.as_ref().ok_or("FEED_INVALID")? {
        feed_payload::Mutation::Reaction(r) => Ok(&r.target_post_ref),
        feed_payload::Mutation::Comment(c) => Ok(&c.target_post_ref),
        _ => Err("FEED_INVALID".into()),
    }
}

pub(super) fn receipt_bytes(receipt: &FeedInteraction) -> Vec<u8> {
    receipt.encode_to_vec()
}

pub(super) fn retain_creation(
    connection: &Connection,
    event: &FeedEvent,
    home: &str,
) -> Result<(), String> {
    let statement = event.statement.as_ref().ok_or("FEED_INVALID")?;
    if statement.kind != FeedEventKind::PostCreated as i32 {
        return Ok(());
    }
    let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
    let Some(feed_payload::Mutation::Post(post)) = payload.mutation else {
        return Err("FEED_INVALID".into());
    };
    let target = format!("oss://{home}/post/{}", post.post_id);
    feed::target_object(&target, "post").map_err(|e| e.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO social_feed_post_creations VALUES (?1,?2,?3,?4)",
            params![target, statement.actor_ptid, statement.chain_id, statement.sequence],
        )
        .map_err(|e| e.to_string())?;
    let retained: (String, String, u64) = connection
        .query_row(
            "SELECT actor,chain,sequence FROM social_feed_post_creations WHERE target=?1",
            params![target],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    if retained != (statement.actor_ptid.clone(), statement.chain_id.clone(), statement.sequence) {
        return Err("FEED_INVALID".into());
    }
    Ok(())
}

pub(super) fn creation_for_post(
    connection: &Connection,
    target: &str,
) -> Result<(String, feed::content::social::v1::CreatePostRequest, i64), String> {
    let (home, post_id) = feed::target_object(target, "post").map_err(|e| e.to_string())?;
    let row: Option<(String, u64, Vec<u8>, Option<Vec<u8>>, Option<Vec<u8>>, Option<bool>)> = connection
        .query_row(
            "SELECT c.actor,c.sequence,p.root,e.event,j.event,j.confirmed
             FROM social_feed_post_creations c
             LEFT JOIN social_remote_feed_events e ON e.actor=c.actor AND e.chain=c.chain AND e.sequence=c.sequence
             LEFT JOIN social_feed_journal j ON j.actor=c.actor AND j.chain=c.chain AND j.sequence=c.sequence
             JOIN social_feed_actor_pins p ON p.actor=c.actor
             WHERE c.target=?1 AND c.chain=?2 AND p.home=?3",
            params![target, feed::PUBLIC_CHAIN_ID, home],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (actor, sequence, root, remote, local, confirmed) = row.ok_or("FEED_GAP")?;
    if let Some(remote) = remote.as_ref() {
        let head =
            PublicFeedStore::verified_remote_head(connection, &actor, &root, &home)?.ok_or("FEED_GAP")?;
        if sequence > head.sequence {
            return Err("FEED_GAP".into());
        }
        if local.as_ref().is_some_and(|local| local != remote) {
            return Err("FEED_FORK_DETECTED".into());
        }
    }
    if local.is_some() {
        if confirmed != Some(true) {
            return Err("FEED_PENDING_ACK".into());
        }
        let local_root: Vec<u8> = connection
            .query_row(
                "SELECT root FROM social_feed_heads WHERE actor=?1 AND chain=?2",
                params![actor, feed::PUBLIC_CHAIN_ID],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if local_root != root {
            return Err("FEED_WRITER_NOT_AUTHORIZED".into());
        }
        if sequence > PublicFeedStore::verified_head(connection, &actor)?.sequence {
            return Err("FEED_GAP".into());
        }
    }
    let wire = remote.or(local).ok_or("FEED_GAP")?;
    let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
    let statement = event.statement.as_ref().ok_or("FEED_INVALID")?;
    let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
    let Some(feed_payload::Mutation::Post(post)) = payload.mutation else {
        return Err("FEED_INVALID".into());
    };
    if statement.actor_ptid != actor
        || statement.chain_id != feed::PUBLIC_CHAIN_ID
        || statement.sequence != sequence
        || statement.kind != FeedEventKind::PostCreated as i32
        || post.post_id != post_id
    {
        return Err("FEED_INVALID".into());
    }
    Ok((
        actor,
        feed::decode_canonical(&post.create_request).map_err(|e| e.to_string())?,
        statement.created_at_unix_ms,
    ))
}
