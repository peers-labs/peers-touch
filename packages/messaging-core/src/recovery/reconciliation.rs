use super::{MessagingRecoveryArchive, RecoveryMessageRedactionTombstone};
use crate::codec::verification::verify_authority_event;
use crate::proto::chat::{conversation_event, ConversationEvent};

pub fn fetch_recovery_events_to_target<F>(
    from_sequence: i64,
    target_sequence: i64,
    page_limit: i32,
    max_pages: usize,
    mut fetch_page: F,
) -> Result<Vec<ConversationEvent>, String>
where
    F: FnMut(i64, i32) -> Result<Vec<ConversationEvent>, String>,
{
    if from_sequence <= 0 || target_sequence < from_sequence || page_limit <= 0 || max_pages == 0 {
        return Err("messaging recovery reconciliation replay bound is invalid".into());
    }
    let mut events = Vec::new();
    let mut after = from_sequence;
    for _ in 0..max_pages {
        if after == target_sequence {
            return Ok(events);
        }
        let limit = (target_sequence - after).min(i64::from(page_limit)) as i32;
        let page = fetch_page(after, limit)?;
        if page.is_empty() {
            return Err(
                "messaging recovery reconciliation authority event log is incomplete".into(),
            );
        }
        if page.len() > limit as usize {
            return Err(
                "messaging recovery reconciliation authority event page exceeds target".into(),
            );
        }
        let next = page
            .last()
            .ok_or("messaging recovery authority page is empty")?
            .sequence;
        if next <= after || next > target_sequence {
            return Err("messaging recovery reconciliation authority page is out of range".into());
        }
        after = next;
        events.extend(page);
    }
    Err("messaging recovery reconciliation exceeded authority replay bound".into())
}

pub fn reconcile_archive_authority_events(
    archive: &MessagingRecoveryArchive,
    conversation_id: &str,
    target_sequence: i64,
    target_event_hash: &[u8],
    events: &[ConversationEvent],
) -> Result<Vec<RecoveryMessageRedactionTombstone>, String> {
    let conversation = archive
        .conversations
        .iter()
        .find(|c| c.conversation_id == conversation_id)
        .ok_or("messaging recovery reconciliation conversation is missing")?;
    let head = archive
        .authority_heads
        .iter()
        .find(|h| h.conversation_id == conversation_id)
        .ok_or("messaging recovery reconciliation authority head is missing")?;
    let mut sequence = head.event_sequence;
    let mut hash = head.event_hash.clone();
    if target_sequence < sequence
        || target_event_hash.len() != 32
        || target_event_hash.iter().all(|b| *b == 0)
    {
        return Err("messaging recovery reconciliation authority target is invalid".into());
    }
    let mut redactions: Vec<RecoveryMessageRedactionTombstone> = Vec::new();
    for event in events {
        verify_authority_event(event)?;
        if event.conversation_id != conversation_id
            || event.authority_station_peer_id != conversation.authority_station_id
            || event.sequence != sequence + 1
            || event.previous_hash != hash
        {
            return Err(
                "messaging recovery reconciliation authority chain is not contiguous".into(),
            );
        }
        let target = match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageRetracted(fact)) => {
                Some((fact.message_id.as_str(), "retracted"))
            }
            Some(conversation_event::Payload::MessageHiddenForActor(fact))
                if fact.actor_ptid == archive.ptid =>
            {
                Some((fact.message_id.as_str(), "hidden_for_actor"))
            }
            _ => None,
        };
        if let Some((message, kind)) = target {
            if message.trim().is_empty() {
                return Err("messaging recovery redaction target is missing".into());
            }
            let timestamp = event
                .committed_at
                .as_ref()
                .ok_or("messaging recovery event timestamp missing")?;
            if timestamp.seconds < 0 || !(0..1_000_000_000).contains(&timestamp.nanos) {
                return Err("messaging recovery event timestamp invalid".into());
            }
            let applied_at = timestamp
                .seconds
                .checked_mul(1_000)
                .and_then(|ms| ms.checked_add(i64::from(timestamp.nanos) / 1_000_000))
                .filter(|ms| *ms > 0)
                .ok_or("messaging recovery event timestamp invalid")?;
            let tombstone = RecoveryMessageRedactionTombstone {
                conversation_id: conversation_id.into(),
                message_id: message.into(),
                kind: kind.into(),
                authority_sequence: event.sequence,
                authority_event_hash: event.event_hash.clone(),
                applied_at_unix_ms: applied_at,
            };
            if let Some(previous) = redactions
                .iter_mut()
                .find(|t| t.message_id == message && t.kind == kind)
            {
                *previous = tombstone;
            } else {
                redactions.push(tombstone);
            }
        }
        sequence = event.sequence;
        hash.clone_from(&event.event_hash);
    }
    if sequence != target_sequence || hash != target_event_hash {
        return Err(
            "messaging recovery reconciliation did not reach the authority snapshot".into(),
        );
    }
    Ok(redactions)
}
