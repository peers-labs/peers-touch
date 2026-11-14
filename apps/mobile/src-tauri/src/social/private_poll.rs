use prost::Message;

use crate::secure_content::proto::social::v1 as social;
use crate::secure_content::receiver::{
    checked_timestamp_millis, private_poll_option_set_hash, PrivateMomentReadProjection,
    PrivatePollResultProjection, PrivateReadContent, PrivateReadState,
};
use crate::secure_content::store::StoredReactionCommand;

// Display order is retained from the verified decrypted parent. Wire choices
// always use its opaque identities in canonical order.
fn definition(
    content: &PrivateReadContent,
) -> Result<(Vec<Vec<u8>>, Vec<u8>, u32, u32, i64), String> {
    let PrivateReadContent::Poll {
        options,
        opaque_option_ids,
        option_set_sha256,
        min_choices,
        max_choices,
        expires_at_seconds,
        ..
    } = content
    else {
        return Err("SOCIAL_PRIVATE_NOT_A_POLL".into());
    };
    let ids = opaque_option_ids
        .iter()
        .map(|id| {
            let bytes = hex::decode(id).map_err(|_| "private poll option identity is invalid")?;
            if bytes.len() != 32 || hex::encode(&bytes) != *id {
                return Err("private poll option identity is invalid".to_string());
            }
            Ok(bytes)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut canonical = ids.clone();
    canonical.sort();
    let hash = private_poll_option_set_hash(&canonical)?;
    if ids.len() != options.len()
        || !(2..=20).contains(&ids.len())
        || !canonical.windows(2).all(|pair| pair[0] < pair[1])
        || *min_choices == 0
        || min_choices > max_choices
        || *max_choices > ids.len() as u32
        || *expires_at_seconds <= 0
        || hex::encode(hash) != *option_set_sha256
    {
        return Err("private poll requires a current verified definition".into());
    }
    Ok((
        ids,
        hash.to_vec(),
        *min_choices,
        *max_choices,
        *expires_at_seconds,
    ))
}

pub(super) fn ballot_request(
    parent: &PrivateMomentReadProjection,
    indices: &[u32],
    command_id: &str,
    key_id: &str,
) -> Result<social::VotePrivatePollRequest, String> {
    if parent.state != PrivateReadState::ContentReady {
        return Err("private poll parent is unavailable".into());
    }
    let (ids, hash, min, max, _) = definition(
        parent
            .content
            .as_ref()
            .ok_or("private poll parent is unavailable")?,
    )?;
    if indices.len() < min as usize
        || indices.len() > max as usize
        || !indices.windows(2).all(|pair| pair[0] < pair[1])
    {
        return Err("SOCIAL_PRIVATE_POLL_INVALID_SELECTION".into());
    }
    let mut selected = indices
        .iter()
        .map(|index| {
            ids.get(*index as usize)
                .cloned()
                .ok_or_else(|| "SOCIAL_PRIVATE_POLL_INVALID_SELECTION".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    selected.sort();
    Ok(social::VotePrivatePollRequest {
        post_id: parent.post_id.clone(),
        opaque_option_ids: selected,
        command_id: command_id.into(),
        option_set_sha256: hash,
        actor_signing_key_id: key_id.into(),
        actor_device_signature: vec![],
    })
}

pub(crate) fn project_result(
    content: &PrivateReadContent,
    result: &social::PrivatePollProjection,
    post_id: &str,
) -> Result<PrivatePollResultProjection, String> {
    let (ids, hash, min, max, _) = definition(content)?;
    let mut canonical = ids.clone();
    canonical.sort();
    if result.post_id != post_id
        || result.option_set_sha256 != hash
        || result.options.len() != ids.len()
        || result.projection_revision > i64::MAX as u64
        || (result.projection_revision == 0
            && (result.voter_count != 0
                || !result.command_id.is_empty()
                || !result.vote_actor_ptid.is_empty()))
        || (result.projection_revision > 0
            && (result.command_id.trim().is_empty()
                || result.command_id.trim() != result.command_id
                || result.vote_actor_ptid.trim().is_empty()
                || result.vote_actor_ptid.trim() != result.vote_actor_ptid))
    {
        return Err("private poll result authority is invalid".into());
    }
    let mut total = 0u64;
    let mut selected = 0usize;
    for (option, expected) in result.options.iter().zip(&canonical) {
        if &option.opaque_option_id != expected
            || option.vote_count > result.voter_count
            || (option.selected_by_viewer && option.vote_count == 0)
        {
            return Err("private poll result option counts are invalid".into());
        }
        total = total
            .checked_add(option.vote_count)
            .ok_or("private poll count overflow")?;
        selected += usize::from(option.selected_by_viewer);
    }
    if total
        < result
            .voter_count
            .checked_mul(min as u64)
            .ok_or("private poll count overflow")?
        || total
            > result
                .voter_count
                .checked_mul(max as u64)
                .ok_or("private poll count overflow")?
        || (selected != 0 && (selected < min as usize || selected > max as usize))
    {
        return Err("private poll result selection totals are invalid".into());
    }
    let ordered = ids
        .iter()
        .map(|id| {
            result
                .options
                .iter()
                .find(|o| &o.opaque_option_id == id)
                .ok_or_else(|| "private poll result option is unavailable".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PrivatePollResultProjection {
        vote_counts: ordered.iter().map(|o| o.vote_count.to_string()).collect(),
        selected_options: ordered
            .iter()
            .enumerate()
            .filter_map(|(i, o)| o.selected_by_viewer.then_some(i as u32))
            .collect(),
        voter_count: result.voter_count.to_string(),
        projection_revision: result.projection_revision.to_string(),
        command_id: result.command_id.clone(),
        vote_actor_ptid: result.vote_actor_ptid.clone(),
    })
}

pub(super) fn qualify_response(
    command: &StoredReactionCommand,
    response: &social::VotePrivatePollResponse,
    parent: &PrivateMomentReadProjection,
    actor_ptid: &str,
) -> Result<PrivatePollResultProjection, String> {
    let request = social::VotePrivatePollRequest::decode(command.request_bytes.as_slice())
        .map_err(|_| "private poll durable ballot is malformed")?;
    let content = parent
        .content
        .as_ref()
        .ok_or("private poll parent is unavailable")?;
    let (_, _, _, _, expiry) = definition(content)?;
    let admitted =
        checked_timestamp_millis(response.admitted_at.as_ref(), "private poll admission")?;
    if request.encode_to_vec() != command.request_bytes
        || request.command_id != command.command_id
        || request.post_id != command.post_id
        || parent.post_id != command.post_id
        || parent.state != PrivateReadState::ContentReady
        || response.command_id != command.command_id
        || response.post_id != command.post_id
        || response.option_set_sha256 != request.option_set_sha256
        || response.projection_revision == 0
        || admitted
            >= expiry
                .checked_mul(1000)
                .ok_or("private poll expiry overflow")?
    {
        return Err("private poll response does not bind the admitted ballot".into());
    }
    let selected = response
        .options
        .iter()
        .filter(|o| o.selected_by_viewer)
        .map(|o| o.opaque_option_id.clone())
        .collect::<Vec<_>>();
    if selected != request.opaque_option_ids {
        return Err("private poll response selection differs from the signed ballot".into());
    }
    project_result(
        content,
        &social::PrivatePollProjection {
            options: response.options.clone(),
            voter_count: response.voter_count,
            post_id: response.post_id.clone(),
            option_set_sha256: response.option_set_sha256.clone(),
            projection_revision: response.projection_revision,
            command_id: response.command_id.clone(),
            vote_actor_ptid: actor_ptid.into(),
        },
        &command.post_id,
    )
}

pub(crate) fn project_target(
    post_id: &str,
    bytes: &[u8],
    incoming: &PrivatePollResultProjection,
) -> Result<Vec<u8>, String> {
    let mut parent = PrivateMomentReadProjection::decode(bytes)?;
    if parent.post_id != post_id || parent.state != PrivateReadState::ContentReady {
        return Err("private poll requires an authorized parent projection".into());
    }
    let Some(PrivateReadContent::Poll { result, .. }) = parent.content.as_mut() else {
        return Err("SOCIAL_PRIVATE_NOT_A_POLL".into());
    };
    merge_result(result, &Some(incoming.clone()))?;
    parent.encode()
}

fn merge_result(
    current: &mut Option<PrivatePollResultProjection>,
    incoming: &Option<PrivatePollResultProjection>,
) -> Result<(), String> {
    let Some(incoming) = incoming else {
        return Ok(());
    };
    let revision = incoming
        .projection_revision
        .parse::<u64>()
        .map_err(|_| "private poll revision is invalid")?;
    let old_revision = current
        .as_ref()
        .map(|r| r.projection_revision.parse::<u64>())
        .transpose()
        .map_err(|_| "private poll stored revision is invalid")?
        .unwrap_or(0);
    if current.is_none() || revision > old_revision {
        *current = Some(incoming.clone());
    } else if revision == old_revision && current.as_ref() != Some(incoming) {
        return Err("private poll result conflicts at the same revision".into());
    }
    Ok(())
}

pub(crate) fn merge_readback(current: Option<&[u8]>, incoming: &[u8]) -> Result<Vec<u8>, String> {
    let Some(current) = current else {
        return Ok(incoming.to_vec());
    };
    let old = PrivateMomentReadProjection::decode(current)?;
    let mut new = PrivateMomentReadProjection::decode(incoming)?;
    if old.state != PrivateReadState::ContentReady
        || new.state != PrivateReadState::ContentReady
        || old.post_id != new.post_id
        || old.content_id != new.content_id
        || old.generation != new.generation
    {
        return Ok(incoming.to_vec());
    }
    if let (
        Some(PrivateReadContent::Poll {
            opaque_option_ids: old_ids,
            option_set_sha256: old_hash,
            result: old_result,
            ..
        }),
        Some(PrivateReadContent::Poll {
            opaque_option_ids: new_ids,
            option_set_sha256: new_hash,
            result: new_result,
            ..
        }),
    ) = (old.content.as_ref(), new.content.as_mut())
    {
        if old_ids.is_empty() {
            return Ok(incoming.to_vec());
        }
        if old_ids != new_ids || old_hash != new_hash {
            return Err("private poll readback changed the verified definition".into());
        }
        merge_result(new_result, old_result)?;
    }
    new.encode()
}

pub(crate) fn requires_definition_read(parent: &PrivateMomentReadProjection) -> bool {
    matches!(parent.content.as_ref(), Some(PrivateReadContent::Poll { opaque_option_ids, option_set_sha256, .. })
        if opaque_option_ids.is_empty() || option_set_sha256.is_empty())
}

pub(crate) fn conceal_legacy(
    mut parent: PrivateMomentReadProjection,
) -> PrivateMomentReadProjection {
    if requires_definition_read(&parent) {
        parent.content = None;
        parent.state = PrivateReadState::RecoveryRequired;
    }
    parent
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_content::store::{PrivateSocialStore, ReactionCommandState};
    use crate::social::private_reaction::PrivateReactionOperation;
    use sha2::{Digest, Sha256};

    fn parent() -> PrivateMomentReadProjection {
        let ids = vec![vec![0x11; 32], vec![0x22; 32]];
        serde_json::from_value(serde_json::json!({
            "postId": "poll", "contentId": "poll", "generation": "1", "authorPtid": "ptid:alice",
            "authorityNamespace": "social:station", "audienceKind": "FRIENDS", "state": "CONTENT_READY",
            "content": { "kind": "POLL", "text": "", "question": "Choose", "options": ["Second", "First"],
                "opaqueOptionIds": [hex::encode(&ids[1]), hex::encode(&ids[0])],
                "optionSetSha256": hex::encode(private_poll_option_set_hash(&ids).unwrap()),
                "minChoices": 1, "maxChoices": 2, "expiresAtSeconds": 4_000_000_000i64 }
        })).unwrap()
    }

    fn command(parent: &PrivateMomentReadProjection) -> StoredReactionCommand {
        let mut request = ballot_request(parent, &[0], "ballot", "device").unwrap();
        request.actor_device_signature = vec![7; 64];
        let bytes = request.encode_to_vec();
        StoredReactionCommand {
            command_id: "ballot".into(),
            post_id: "poll".into(),
            comment_id: String::new(),
            kind: 0,
            operation: PrivateReactionOperation::VotePoll,
            request_sha256: Sha256::digest(&bytes).into(),
            request_bytes: bytes,
            result_sha256: None,
            result_bytes: None,
            state: ReactionCommandState::Pending,
            session_generation: 1,
            lease_generation: 0,
            attempt_count: 0,
            projection_revision: 0,
            error_code: None,
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        }
    }

    fn response() -> social::VotePrivatePollResponse {
        social::VotePrivatePollResponse {
            options: vec![
                social::PrivatePollOptionResult {
                    opaque_option_id: vec![0x11; 32],
                    vote_count: 0,
                    selected_by_viewer: false,
                },
                social::PrivatePollOptionResult {
                    opaque_option_id: vec![0x22; 32],
                    vote_count: 1,
                    selected_by_viewer: true,
                },
            ],
            voter_count: 1,
            exact_replay: false,
            command_id: "ballot".into(),
            post_id: "poll".into(),
            option_set_sha256: private_poll_option_set_hash(&[vec![0x11; 32], vec![0x22; 32]])
                .unwrap()
                .to_vec(),
            projection_revision: 1,
            admitted_at: Some(prost_types::Timestamp {
                seconds: 3_999_999_999,
                nanos: 0,
            }),
        }
    }

    #[test]
    fn private_poll_binds_decrypted_option_order_exact_selection_and_source_admission() {
        let parent = parent();
        let command = command(&parent);
        let response = response();
        let projected = qualify_response(&command, &response, &parent, "ptid:alice").unwrap();
        assert_eq!(projected.vote_counts, ["1", "0"]);
        assert_eq!(projected.selected_options, [0]);
        for indices in [vec![], vec![0, 0], vec![2], vec![1, 0]] {
            assert!(ballot_request(&parent, &indices, "ballot", "device").is_err());
        }
        let mut changed = response.clone();
        changed.admitted_at.as_mut().unwrap().seconds = 4_000_000_000;
        assert!(qualify_response(&command, &changed, &parent, "ptid:alice").is_err());
        changed = response.clone();
        changed.options[0].selected_by_viewer = true;
        assert!(qualify_response(&command, &changed, &parent, "ptid:alice").is_err());
        changed = response.clone();
        changed.options[1].vote_count = 2;
        assert!(qualify_response(&command, &changed, &parent, "ptid:alice").is_err());
        changed = response.clone();
        changed.post_id = "other".into();
        assert!(qualify_response(&command, &changed, &parent, "ptid:alice").is_err());
        let encoded = parent.encode().unwrap();
        let value: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(value["content"]["minChoices"], 1);
        assert!(value["content"].get("min_choices").is_none());
    }

    #[test]
    fn private_poll_retries_exact_journal_and_preserves_newer_projection_atomically() {
        let parent = parent();
        let store = PrivateSocialStore::in_memory("station", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();
        store
            .commit_receiver_projection(
                1,
                "poll",
                1,
                "poll",
                &[7; 32],
                None,
                &parent.encode().unwrap(),
            )
            .unwrap();
        let command = command(&parent);
        store.persist_reaction_command(&command).unwrap();
        let first = store.acquire_reaction_command("ballot", 1).unwrap();
        store
            .mark_reaction_failure(
                "ballot",
                first.lease_generation,
                1,
                ReactionCommandState::UnknownOutcome,
                "unknown",
                None,
            )
            .unwrap();
        let retry = store.acquire_reaction_command("ballot", 1).unwrap();
        assert_eq!(first.request_bytes, retry.request_bytes);
        let response = response();
        let projected = qualify_response(&retry, &response, &parent, "ptid:alice").unwrap();
        let mut newer = projected.clone();
        newer.projection_revision = "2".into();
        newer.command_id = "newer".into();
        let newer_bytes = project_target("poll", &parent.encode().unwrap(), &newer).unwrap();
        store
            .commit_receiver_projection(1, "poll", 1, "poll", &[7; 32], None, &newer_bytes)
            .unwrap();
        let bytes = response.encode_to_vec();
        assert!(store
            .mark_reaction_committed(
                &retry,
                &bytes,
                &Sha256::digest(&bytes).into(),
                1,
                &[],
                Some(&projected)
            )
            .unwrap());
        let stored = store.read_projection("poll").unwrap().unwrap();
        assert_eq!(stored, newer_bytes);
        store
            .commit_receiver_projection(
                1,
                "poll",
                1,
                "poll",
                &[7; 32],
                None,
                &parent.encode().unwrap(),
            )
            .unwrap();
        assert_eq!(store.read_projection("poll").unwrap().unwrap(), newer_bytes);
        let mut conflicting = newer.clone();
        conflicting.command_id = "drift".into();
        assert!(project_target("poll", &newer_bytes, &conflicting).is_err());
        assert!(store
            .commit_receiver_projection(
                1,
                "poll",
                1,
                "poll",
                &[7; 32],
                None,
                &project_target("poll", &parent.encode().unwrap(), &conflicting).unwrap()
            )
            .is_err());
        assert_eq!(store.read_projection("poll").unwrap().unwrap(), newer_bytes);
        store.bind_session_generation(2).unwrap();
        assert!(store
            .mark_reaction_committed(
                &retry,
                &bytes,
                &Sha256::digest(&bytes).into(),
                1,
                &[],
                Some(&projected)
            )
            .is_err());
    }

    #[test]
    fn private_poll_legacy_label_cache_is_concealed_and_reacquired() {
        let mut old = parent();
        if let Some(PrivateReadContent::Poll {
            opaque_option_ids,
            option_set_sha256,
            ..
        }) = old.content.as_mut()
        {
            opaque_option_ids.clear();
            option_set_sha256.clear();
        }
        assert!(requires_definition_read(&old));
        let concealed = conceal_legacy(old.clone());
        assert!(concealed.content.is_none());
        assert_eq!(concealed.state, PrivateReadState::RecoveryRequired);
        assert!(!requires_definition_read(
            &PrivateMomentReadProjection::decode(
                &merge_readback(Some(&old.encode().unwrap()), &parent().encode().unwrap()).unwrap()
            )
            .unwrap()
        ));
    }
}
