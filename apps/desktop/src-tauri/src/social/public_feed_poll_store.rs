//! Supplemental admissions and disposable creation indexes share the original
//! SQLCipher journal. Station signing keys are resolved afresh by the caller.
use super::*;

pub(super) type PollKeyResolver<'a> = dyn Fn(&str) -> Result<(String, Vec<u8>), String> + 'a;
pub(super) const POLL_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS social_feed_poll_admissions (
    actor TEXT NOT NULL, chain TEXT NOT NULL, sequence INTEGER NOT NULL,
    home TEXT NOT NULL, target TEXT NOT NULL, key_id TEXT NOT NULL,
    admission BLOB, PRIMARY KEY(actor,chain,sequence)
);
CREATE TABLE IF NOT EXISTS social_feed_post_creations (
    target TEXT PRIMARY KEY, actor TEXT NOT NULL, chain TEXT NOT NULL,
    sequence INTEGER NOT NULL, UNIQUE(actor,chain,sequence)
);";

pub(super) fn interaction_target(payload: &FeedPayload) -> Result<&str, String> {
    match payload.mutation.as_ref().ok_or("FEED_INVALID")? {
        feed_payload::Mutation::Reaction(r) => Ok(&r.target_post_ref),
        feed_payload::Mutation::Comment(c) => Ok(&c.target_post_ref),
        feed_payload::Mutation::PollBallot(b) => Ok(&b.target_post_ref),
        _ => Err("FEED_INVALID".into()),
    }
}

pub(super) fn receipt_bytes(receipt: &FeedInteraction) -> Vec<u8> {
    let mut base = receipt.clone();
    base.poll_admission = None;
    base.encode_to_vec()
}

pub(super) fn retain_creation(connection: &Connection, event: &FeedEvent, home: &str) -> Result<(), String> {
    let statement = event.statement.as_ref().ok_or("FEED_INVALID")?;
    if statement.kind != FeedEventKind::PostCreated as i32 { return Ok(()); }
    let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
    let Some(feed_payload::Mutation::Post(post)) = payload.mutation else { return Err("FEED_INVALID".into()); };
    let target = format!("oss://{home}/post/{}", post.post_id);
    feed::target_object(&target, "post").map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO social_feed_post_creations VALUES (?1,?2,?3,?4)",
        params![target, statement.actor_ptid, statement.chain_id, statement.sequence]).map_err(|e| e.to_string())?;
    let retained: (String,String,u64) = connection.query_row(
        "SELECT actor,chain,sequence FROM social_feed_post_creations WHERE target=?1",
        params![target], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e| e.to_string())?;
    if retained != (statement.actor_ptid.clone(),statement.chain_id.clone(),statement.sequence) {
        return Err("FEED_INVALID".into());
    }
    Ok(())
}

pub(super) fn creation_for_post(connection: &Connection, target: &str)
    -> Result<(String,feed::content::social::v1::CreatePostRequest,i64),String> {
    let (home, post_id) = feed::target_object(target, "post").map_err(|e| e.to_string())?;
    let row: Option<(String,u64,Vec<u8>,Option<Vec<u8>>,Option<Vec<u8>>,Option<bool>)> = connection.query_row(
        "SELECT c.actor,c.sequence,p.root,e.event,j.event,j.confirmed
         FROM social_feed_post_creations c
         LEFT JOIN social_remote_feed_events e ON e.actor=c.actor AND e.chain=c.chain AND e.sequence=c.sequence
         LEFT JOIN social_feed_journal j ON j.actor=c.actor AND j.chain=c.chain AND j.sequence=c.sequence
         JOIN social_feed_actor_pins p ON p.actor=c.actor
         WHERE c.target=?1 AND c.chain=?2 AND p.home=?3",
        params![target,feed::PUBLIC_CHAIN_ID,home],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))
        .optional().map_err(|e| e.to_string())?;
    let (actor,sequence,root,remote,local,confirmed) = row.ok_or("FEED_GAP")?;
    if let Some(remote) = remote.as_ref() {
        let head = PublicFeedStore::verified_remote_head(connection,&actor,&root,&home)?.ok_or("FEED_GAP")?;
        if sequence > head.sequence { return Err("FEED_GAP".into()); }
        if local.as_ref().is_some_and(|local| local != remote) { return Err("FEED_FORK_DETECTED".into()); }
    }
    if local.is_some() {
        if confirmed != Some(true) { return Err("FEED_PENDING_ACK".into()); }
        let local_root: Vec<u8> = connection.query_row(
            "SELECT root FROM social_feed_heads WHERE actor=?1 AND chain=?2",
            params![actor,feed::PUBLIC_CHAIN_ID], |r| r.get(0)).map_err(|e| e.to_string())?;
        if local_root != root { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        if sequence > PublicFeedStore::verified_head(connection,&actor)?.sequence { return Err("FEED_GAP".into()); }
    }
    let wire = remote.or(local).ok_or("FEED_GAP")?;
    let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
    let statement = event.statement.as_ref().ok_or("FEED_INVALID")?;
    let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
    let Some(feed_payload::Mutation::Post(post)) = payload.mutation else { return Err("FEED_INVALID".into()); };
    if statement.actor_ptid != actor || statement.chain_id != feed::PUBLIC_CHAIN_ID
        || statement.sequence != sequence || statement.kind != FeedEventKind::PostCreated as i32 || post.post_id != post_id {
        return Err("FEED_INVALID".into());
    }
    Ok((actor,feed::decode_canonical(&post.create_request).map_err(|e| e.to_string())?,statement.created_at_unix_ms))
}

fn definition_for_post(connection: &Connection, target: &str) -> Result<FeedPollDefinition,String> {
    let (_,request,created) = creation_for_post(connection,target)?;
    let Some(feed::content::social::v1::create_post_request::Content::Poll(poll)) = request.content
        else { return Err("FEED_NOT_A_POLL".into()); };
    feed::poll_definition(&poll,created).map_err(|e| e.to_string())
}

pub(super) fn retain_admission(connection: &Connection, event: &FeedEvent,
    admission: &FeedPollAdmission, keys: &PollKeyResolver<'_>) -> Result<(),String> {
    let event_statement = event.statement.as_ref().ok_or("FEED_INVALID")?;
    let statement = admission.statement.as_ref().ok_or("FEED_INVALID")?;
    let definition = definition_for_post(connection,&statement.target_post_ref)?;
    let (key_id,key) = keys(&statement.home_station_peer_id)?;
    feed::verify_poll_admission(admission,event,&definition,&key_id,&key).map_err(|e| e.to_string())?;
    let wire = admission.encode_to_vec();
    let known: Option<(String,String,Option<Vec<u8>>)> = connection.query_row(
        "SELECT home,target,admission FROM social_feed_poll_admissions WHERE actor=?1 AND chain=?2 AND sequence=?3",
        params![event_statement.actor_ptid,event_statement.chain_id,event_statement.sequence],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e| e.to_string())?;
    if known.is_some_and(|(home,target,previous)| home != statement.home_station_peer_id
        || target != statement.target_post_ref || previous.is_some_and(|previous| previous != wire)) {
        return Err("FEED_POLL_ADMISSION_CONFLICT".into());
    }
    connection.execute(
        "INSERT INTO social_feed_poll_admissions VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(actor,chain,sequence) DO UPDATE SET key_id=excluded.key_id,admission=excluded.admission
         WHERE social_feed_poll_admissions.admission IS NULL
           AND social_feed_poll_admissions.home=excluded.home AND social_feed_poll_admissions.target=excluded.target",
        params![event_statement.actor_ptid,event_statement.chain_id,event_statement.sequence,
            statement.home_station_peer_id,statement.target_post_ref,key_id,wire]).map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn verified_admission(connection: &Connection, event: &FeedEvent,
    keys: &PollKeyResolver<'_>) -> Result<Option<FeedPollAdmission>,String> {
    let s = event.statement.as_ref().ok_or("FEED_INVALID")?;
    let retained: Option<(String,String,String,Option<Vec<u8>>)> = connection.query_row(
        "SELECT home,target,key_id,admission FROM social_feed_poll_admissions WHERE actor=?1 AND chain=?2 AND sequence=?3",
        params![s.actor_ptid,s.chain_id,s.sequence],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))
        .optional().map_err(|e| e.to_string())?;
    let Some((home,target,key_id,Some(wire))) = retained else { return Ok(None); };
    let admission: FeedPollAdmission = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
    let s = admission.statement.as_ref().ok_or("FEED_INVALID")?;
    if s.home_station_peer_id != home || s.target_post_ref != target || s.signing_key_id != key_id {
        return Err("FEED_INVALID".into());
    }
    let (trusted_id,key) = keys(&home)?;
    feed::verify_poll_admission(&admission,event,&definition_for_post(connection,&target)?,&trusted_id,&key)
        .map_err(|e| e.to_string())?;
    Ok(Some(admission))
}

pub(super) fn attach_admission(connection: &Connection, receipt: &mut FeedInteraction,
    keys: &PollKeyResolver<'_>) -> Result<(),String> {
    let event = receipt.event.as_ref().ok_or("FEED_INVALID")?;
    if event.statement.as_ref().ok_or("FEED_INVALID")?.kind != FeedEventKind::PollBallotSet as i32 {
        return if receipt.poll_admission.is_none() { Ok(()) } else { Err("FEED_INVALID".into()) };
    }
    if let Some(admission) = receipt.poll_admission.as_ref() {
        let s = admission.statement.as_ref().ok_or("FEED_INVALID")?;
        let (id,key) = keys(&s.home_station_peer_id)?;
        feed::verify_poll_admission(admission,event,&definition_for_post(connection,&s.target_post_ref)?,&id,&key)
            .map_err(|e| e.to_string())?;
    } else {
        receipt.poll_admission = Some(verified_admission(connection,event,keys)?.ok_or("FEED_POLL_ADMISSION_PENDING")?);
    }
    Ok(())
}

pub(super) fn remember_pending_admission(connection: &Connection, event: &FeedEvent) -> Result<(),String> {
    let s = event.statement.as_ref().ok_or("FEED_INVALID")?;
    if s.kind != FeedEventKind::PollBallotSet as i32 { return Ok(()); }
    let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
    let Some(feed_payload::Mutation::PollBallot(ballot)) = payload.mutation else { return Err("FEED_INVALID".into()); };
    feed::validate_poll_ballot(&ballot).map_err(|e| e.to_string())?;
    let (home,_) = feed::target_object(&ballot.target_post_ref,"post").map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO social_feed_poll_admissions VALUES (?1,?2,?3,?4,?5,'',NULL)",
        params![s.actor_ptid,s.chain_id,s.sequence,home,ballot.target_post_ref]).map_err(|e| e.to_string())?;
    let retained: (String,String) = connection.query_row(
        "SELECT home,target FROM social_feed_poll_admissions WHERE actor=?1 AND chain=?2 AND sequence=?3",
        params![s.actor_ptid,s.chain_id,s.sequence],|r| Ok((r.get(0)?,r.get(1)?))).map_err(|e| e.to_string())?;
    if retained != (home,ballot.target_post_ref) { return Err("FEED_POLL_ADMISSION_CONFLICT".into()); }
    Ok(())
}

impl PublicFeedStore {
    pub(in crate::social) fn pending_poll_admissions(&self, actor: &str) -> Result<Vec<(String,FeedEvent)>,String> {
        let head = Self::verified_head(&self.connection,actor)?;
        let mut query = self.connection.prepare(
            "SELECT j.command_id,j.sequence,j.event,a.home,a.target
             FROM social_feed_poll_admissions a JOIN social_feed_journal j
               ON j.actor=a.actor AND j.chain=a.chain AND j.sequence=a.sequence
             WHERE a.actor=?1 AND a.chain=?2 AND a.admission IS NULL AND j.confirmed=1
             ORDER BY j.sequence LIMIT 64").map_err(|e| e.to_string())?;
        let rows = query.query_map(params![actor,feed::PUBLIC_CHAIN_ID],
            |r| Ok((r.get::<_,String>(0)?,r.get::<_,u64>(1)?,r.get::<_,Vec<u8>>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?)))
            .map_err(|e| e.to_string())?;
        let mut pending = Vec::new();
        for row in rows {
            let (command,sequence,wire,home,target) = row.map_err(|e| e.to_string())?;
            let event: FeedEvent = feed::decode_canonical(&wire).map_err(|e| e.to_string())?;
            let s = event.statement.as_ref().ok_or("FEED_INVALID")?;
            let payload: FeedPayload = feed::decode_canonical(&event.payload).map_err(|e| e.to_string())?;
            if s.actor_ptid != actor || s.chain_id != feed::PUBLIC_CHAIN_ID || s.sequence != sequence
                || sequence > head.sequence || s.kind != FeedEventKind::PollBallotSet as i32
                || interaction_target(&payload)? != target || feed::target_object(&target,"post").map_err(|e| e.to_string())?.0 != home {
                return Err("FEED_INVALID".into());
            }
            pending.push((command,event));
        }
        Ok(pending)
    }

    pub(in crate::social) fn retain_poll_admission(&mut self, event: &FeedEvent,
        admission: &FeedPollAdmission, keys: &PollKeyResolver<'_>) -> Result<(),String> {
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        retain_admission(&tx,event,admission,keys)?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub(in crate::social) fn poll_admission_for(&self, event: &FeedEvent,
        keys: &PollKeyResolver<'_>) -> Result<Option<FeedPollAdmission>,String> {
        verified_admission(&self.connection,event,keys)
    }
}
