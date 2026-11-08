use prost::Message;

use crate::model::social;
use crate::secure_content::store::StoredReactionCommand;

use super::projection::{
    checked_timestamp_millis, private_poll_option_set_hash, PrivateMomentContentProjection,
    PrivateMomentProjection, PrivatePollResultProjection, PrivateReadState,
};

/// Labels and their opaque identifiers come only from the verified decrypted
/// parent. Renderer indices never become Station option identifiers directly.
pub(super) fn ballot_request(
    content: &PrivateMomentContentProjection,
    post_id: &str,
    indices: &[u32],
    command_id: &str,
    key_id: &str,
) -> Result<social::VotePrivatePollRequest, String> {
    let (ids, hash, min, max, _) = poll_definition(content)?;
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
        post_id: post_id.into(),
        opaque_option_ids: selected,
        command_id: command_id.into(),
        option_set_sha256: hash,
        actor_signing_key_id: key_id.into(),
        actor_device_signature: vec![],
    })
}

fn poll_definition(
    content: &PrivateMomentContentProjection,
) -> Result<(Vec<Vec<u8>>, Vec<u8>, u32, u32, i64), String> {
    let PrivateMomentContentProjection::Poll {
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
        .map(|value| {
            let bytes =
                hex::decode(value).map_err(|_| "private poll option identity is invalid")?;
            if bytes.len() != 32 || hex::encode(&bytes) != *value {
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

pub(super) fn requires_definition_read(parent: &PrivateMomentProjection) -> bool {
    matches!(parent.content.as_ref(), Some(PrivateMomentContentProjection::Poll {
        opaque_option_ids, option_set_sha256, ..
    }) if opaque_option_ids.is_empty() || option_set_sha256.is_empty())
}

pub(super) fn project_poll_result(
    content: &PrivateMomentContentProjection,
    result: &social::PrivatePollProjection,
    post_id: &str,
) -> Result<PrivatePollResultProjection, String> {
    let (ids, hash, min, max, _) = poll_definition(content)?;
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
    let lower = result
        .voter_count
        .checked_mul(min as u64)
        .ok_or("private poll count overflow")?;
    let upper = result
        .voter_count
        .checked_mul(max as u64)
        .ok_or("private poll count overflow")?;
    if total < lower
        || total > upper
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
                .find(|option| &option.opaque_option_id == id)
                .ok_or_else(|| "private poll result option is unavailable".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PrivatePollResultProjection {
        vote_counts: ordered
            .iter()
            .map(|option| option.vote_count.to_string())
            .collect(),
        selected_options: ordered
            .iter()
            .enumerate()
            .filter_map(|(index, option)| option.selected_by_viewer.then_some(index as u32))
            .collect(),
        voter_count: result.voter_count.to_string(),
        projection_revision: result.projection_revision.to_string(),
        command_id: result.command_id.clone(),
        vote_actor_ptid: result.vote_actor_ptid.clone(),
    })
}

pub(super) fn qualify_poll_response(
    command: &StoredReactionCommand,
    response: &social::VotePrivatePollResponse,
    parent: &PrivateMomentProjection,
    actor_ptid: &str,
) -> Result<PrivatePollResultProjection, String> {
    let request = social::VotePrivatePollRequest::decode(command.request_bytes.as_slice())
        .map_err(|_| "private poll durable ballot is malformed")?;
    let content = parent
        .content
        .as_ref()
        .ok_or("private poll parent is unavailable")?;
    let (_, _, _, _, expiry) = poll_definition(content)?;
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
        .filter(|option| option.selected_by_viewer)
        .map(|option| option.opaque_option_id.clone())
        .collect::<Vec<_>>();
    if selected != request.opaque_option_ids {
        return Err("private poll response selection differs from the signed ballot".into());
    }
    project_poll_result(
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

pub(crate) fn project_poll_target(
    post_id: &str,
    current_bytes: &[u8],
    incoming: &PrivatePollResultProjection,
) -> Result<Vec<u8>, String> {
    let mut parent = PrivateMomentProjection::decode_local(current_bytes)?;
    if parent.post_id != post_id || parent.state != PrivateReadState::ContentReady {
        return Err("private poll requires an authorized parent projection".into());
    }
    let Some(PrivateMomentContentProjection::Poll { result, .. }) = parent.content.as_mut() else {
        return Err("SOCIAL_PRIVATE_NOT_A_POLL".into());
    };
    let revision = incoming
        .projection_revision
        .parse::<u64>()
        .map_err(|_| "private poll revision is invalid")?;
    let current_revision = result
        .as_ref()
        .map(|value| value.projection_revision.parse::<u64>())
        .transpose()
        .map_err(|_| "private poll stored revision is invalid")?
        .unwrap_or(0);
    if revision > current_revision || result.is_none() {
        *result = Some(incoming.clone());
    } else if revision == current_revision && result.as_ref() != Some(incoming) {
        return Err("private poll result conflicts at the same revision".into());
    }
    parent.encode_local()
}

pub(crate) fn merge_poll_readback(
    current: Option<&[u8]>,
    incoming: &[u8],
) -> Result<Vec<u8>, String> {
    let Some(current) = current else {
        return Ok(incoming.to_vec());
    };
    let old = PrivateMomentProjection::decode_local(current)?;
    let mut new = PrivateMomentProjection::decode_local(incoming)?;
    if old.state != PrivateReadState::ContentReady
        || new.state != PrivateReadState::ContentReady
        || old.post_id != new.post_id
        || old.content_id != new.content_id
        || old.generation != new.generation
    {
        return Ok(incoming.to_vec());
    }
    let (
        Some(PrivateMomentContentProjection::Poll {
            opaque_option_ids: old_ids,
            option_set_sha256: old_hash,
            result: old_result,
            ..
        }),
        Some(PrivateMomentContentProjection::Poll {
            opaque_option_ids: new_ids,
            option_set_sha256: new_hash,
            result: new_result,
            ..
        }),
    ) = (old.content.as_ref(), new.content.as_mut())
    else {
        return Ok(incoming.to_vec());
    };
    if old_ids.is_empty() {
        return Ok(incoming.to_vec());
    }
    if old_ids != new_ids || old_hash != new_hash {
        return Err("private poll readback changed the verified definition".into());
    }
    if let Some(old_result) = old_result {
        let old_revision = old_result
            .projection_revision
            .parse::<u64>()
            .map_err(|_| "private poll stored revision is invalid")?;
        let new_revision = new_result
            .as_ref()
            .map(|result| result.projection_revision.parse::<u64>())
            .transpose()
            .map_err(|_| "private poll readback revision is invalid")?
            .unwrap_or(0);
        if old_revision > new_revision || new_result.is_none() {
            *new_result = Some(old_result.clone());
        } else if old_revision == new_revision && new_result.as_ref() != Some(old_result) {
            return Err("private poll readback conflicts at the same revision".into());
        }
    }
    new.encode_local()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_content::store::{ReactionCommandState, SecureContentStore};
    use crate::social::PrivateReactionOperation;
    use sha2::{Digest, Sha256};

    fn parent() -> PrivateMomentProjection {
        let ids = vec![vec![0x11; 32], vec![0x22; 32]];
        serde_json::from_value(serde_json::json!({
            "post_id": "poll", "content_id": "poll", "generation": "1",
            "author_ptid": "ptid:alice", "audience_kind": "FRIENDS", "state": "CONTENT_READY",
            "content": { "kind": "POLL", "text": "", "question": "Choose",
                "options": ["Second", "First"], "opaque_option_ids": [hex::encode(&ids[1]), hex::encode(&ids[0])],
                "option_set_sha256": hex::encode(private_poll_option_set_hash(&ids).unwrap()),
                "min_choices": 1, "max_choices": 2, "expires_at_seconds": 4_000_000_000i64 }
        })).unwrap()
    }

    fn command(parent: &PrivateMomentProjection) -> StoredReactionCommand {
        let mut request = ballot_request(
            parent.content.as_ref().unwrap(),
            "poll",
            &[0],
            "ballot",
            "device",
        )
        .unwrap();
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

    fn response(command: &StoredReactionCommand) -> social::VotePrivatePollResponse {
        let request =
            social::VotePrivatePollRequest::decode(command.request_bytes.as_slice()).unwrap();
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
            command_id: command.command_id.clone(),
            post_id: command.post_id.clone(),
            option_set_sha256: request.option_set_sha256,
            projection_revision: 1,
            admitted_at: Some(prost_types::Timestamp {
                seconds: 3_999_999_999,
                nanos: 999_999_999,
            }),
        }
    }

    #[test]
    fn private_poll_uses_decrypted_label_order_and_rejects_invalid_selection() {
        let parent = parent();
        let content = parent.content.as_ref().unwrap();
        let request = ballot_request(content, "poll", &[0, 1], "ballot", "device").unwrap();
        assert_eq!(
            request.opaque_option_ids,
            vec![vec![0x11; 32], vec![0x22; 32]]
        );
        for indices in [vec![], vec![0, 0], vec![1, 0], vec![2]] {
            assert!(ballot_request(content, "poll", &indices, "ballot", "device").is_err());
        }
        let command = command(&parent);
        let result =
            qualify_poll_response(&command, &response(&command), &parent, "ptid:bob").unwrap();
        assert_eq!(result.vote_counts, ["1", "0"]);
        assert_eq!(result.selected_options, [0]);
    }

    #[test]
    fn private_poll_legacy_cache_cannot_supply_vote_or_search_authority() {
        let mut legacy = parent();
        if let Some(PrivateMomentContentProjection::Poll {
            opaque_option_ids,
            option_set_sha256,
            ..
        }) = legacy.content.as_mut()
        {
            opaque_option_ids.clear();
            option_set_sha256.clear();
        }
        assert!(requires_definition_read(&legacy));
        assert!(ballot_request(
            legacy.content.as_ref().unwrap(),
            "poll",
            &[0],
            "ballot",
            "device"
        )
        .is_err());
        let scrubbed = super::super::private_moment::scrub_persisted_projection(legacy);
        assert_eq!(scrubbed.state, PrivateReadState::LoadingAuthorizedResource);
        assert!(scrubbed.content.is_none());
        assert!(!requires_definition_read(&parent()));
    }

    #[test]
    fn private_poll_response_rejects_substitution_cutoff_and_unrealizable_counts() {
        let parent = parent();
        let command = command(&parent);
        let original = response(&command);
        let mut invalid = vec![];
        let mut value = original.clone();
        value.post_id = "other".into();
        invalid.push(value);
        let mut value = original.clone();
        value.command_id = "other".into();
        invalid.push(value);
        let mut value = original.clone();
        value.option_set_sha256[0] ^= 1;
        invalid.push(value);
        let mut value = original.clone();
        value.projection_revision = 0;
        invalid.push(value);
        let mut value = original.clone();
        value.admitted_at.as_mut().unwrap().seconds = 4_000_000_000;
        invalid.push(value);
        let mut value = original.clone();
        value.options[1].selected_by_viewer = false;
        invalid.push(value);
        let mut value = original.clone();
        value.options[1].vote_count = 2;
        invalid.push(value);
        let mut value = original.clone();
        value.options[0].opaque_option_id = vec![8; 32];
        invalid.push(value);
        let mut value = original;
        value.options[1].vote_count = 0;
        invalid.push(value);
        for value in invalid {
            assert!(qualify_poll_response(&command, &value, &parent, "ptid:bob").is_err());
        }
    }

    #[test]
    fn private_poll_exact_retry_and_readback_share_the_original_journal_transaction() {
        let store = SecureContentStore::in_memory().unwrap();
        let parent = parent();
        let parent_bytes = parent.encode_local().unwrap();
        store
            .commit_content_root("poll", 1, "poll", &[7; 32], None, &parent_bytes)
            .unwrap();
        let command = command(&parent);
        store.persist_reaction_command(&command).unwrap();
        let first = store.acquire_reaction_command("ballot", 1).unwrap();
        store
            .mark_reaction_failure(
                "ballot",
                first.lease_generation,
                1,
                ReactionCommandState::UnknownCommit,
                "REACTION_RESULT_UNKNOWN",
                None,
            )
            .unwrap();
        let retry = store.acquire_reaction_command("ballot", 1).unwrap();
        assert_eq!(retry.request_bytes, command.request_bytes);
        assert_eq!(retry.request_sha256, command.request_sha256);
        let response = response(&command);
        let result = qualify_poll_response(&retry, &response, &parent, "ptid:bob").unwrap();
        let bytes = response.encode_to_vec();
        let hash = Sha256::digest(&bytes).into();
        assert!(!store
            .mark_reaction_committed(&first, &bytes, &hash, 1, &[], Some(&result))
            .unwrap());
        assert!(store
            .mark_reaction_committed(&retry, &bytes, &hash, 1, &[], Some(&result))
            .unwrap());
        let retained = store.projection("poll").unwrap().unwrap();
        store
            .commit_content_root("poll", 1, "poll", &[7; 32], None, &parent_bytes)
            .unwrap();
        assert_eq!(store.projection("poll").unwrap().unwrap(), retained);
        store.save_projection("poll", &parent_bytes).unwrap();
        assert_eq!(store.projection("poll").unwrap().unwrap(), retained);
        let mut conflict = result.clone();
        conflict.vote_counts = vec!["0".into(), "1".into()];
        assert!(project_poll_target("poll", &retained, &conflict).is_err());
        let conflicted = serde_json::from_slice::<serde_json::Value>(&retained).unwrap();
        let mut conflicted_parent =
            PrivateMomentProjection::decode_local(&serde_json::to_vec(&conflicted).unwrap())
                .unwrap();
        if let Some(PrivateMomentContentProjection::Poll { result, .. }) =
            conflicted_parent.content.as_mut()
        {
            *result = Some(conflict);
        }
        assert!(store
            .save_projection("poll", &conflicted_parent.encode_local().unwrap())
            .is_err());
        assert_eq!(store.projection("poll").unwrap().unwrap(), retained);
        assert_eq!(
            store.reaction_command("ballot").unwrap().unwrap().state,
            ReactionCommandState::Committed
        );
        let mut next = command.clone();
        next.command_id = "second-ballot".into();
        assert!(store
            .persist_reaction_command(&StoredReactionCommand {
                kind: 1,
                ..next.clone()
            })
            .is_err());
        next.comment_id = "comment".into();
        assert!(store.persist_reaction_command(&next).is_err());
    }
}
