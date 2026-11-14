//! Poll rules for the original Actor Feed. Callers resolve Home keys through
//! their existing Station trust owner before accepting a supplemental receipt.
use super::*;

pub const POLL_DEFINITION_DOMAIN: &[u8] = b"peers-touch/social-feed/poll-definition/v1\0";
pub const POLL_ADMISSION_DOMAIN: &[u8] = b"peers-touch/social-feed/poll-admission/v1\0";
const MAX_POLL_LIFETIME_MS: i64 = 30 * 24 * 3_600_000;

fn poll_choices(request: &content::social::v1::CreatePollPostRequest) -> (u32, u32) {
    (
        request.min_choices.max(1),
        if request.max_choices != 0 {
            request.max_choices
        } else if request.multiple_choice {
            request.options.len() as u32
        } else {
            1
        },
    )
}

/// Shape validation does not move a relative deadline to an edit's timestamp.
pub fn validate_poll_request(request: &content::social::v1::CreatePollPostRequest) -> Result<(), TrustError> {
    if request.expires_at_unix_ms < 0
        || (request.expires_at_unix_ms == 0 && !(1..=720).contains(&request.duration_hours))
        || (request.expires_at_unix_ms > 0 && request.duration_hours != 0)
    {
        return Err(error("FEED_INVALID"));
    }
    let (minimum, maximum) = poll_choices(request);
    if request.multiple_choice != (maximum > 1) {
        return Err(error("FEED_INVALID"));
    }
    validate_poll_definition(&FeedPollDefinition {
        question: request.question.clone(),
        options: request.options.clone(),
        min_choices: minimum,
        max_choices: maximum,
        expires_at_unix_ms: 1,
    })
}

pub fn poll_definition(request: &content::social::v1::CreatePollPostRequest, created_at: i64) -> Result<FeedPollDefinition, TrustError> {
    validate_poll_request(request)?;
    if created_at <= 0 || created_at > i64::MAX - MAX_POLL_LIFETIME_MS {
        return Err(error("FEED_INVALID"));
    }
    let expires = if request.expires_at_unix_ms == 0 {
        created_at + i64::from(request.duration_hours) * 3_600_000
    } else {
        request.expires_at_unix_ms
    };
    let (minimum, maximum) = poll_choices(request);
    let definition = FeedPollDefinition {
        question: request.question.clone(),
        options: request.options.clone(),
        min_choices: minimum,
        max_choices: maximum,
        expires_at_unix_ms: expires,
    };
    if expires <= created_at || expires - created_at > MAX_POLL_LIFETIME_MS {
        return Err(error("FEED_INVALID"));
    }
    validate_poll_definition(&definition)?;
    Ok(definition)
}

pub fn validate_poll_definition(d: &FeedPollDefinition) -> Result<(), TrustError> {
    if d.question.is_empty() || d.question.len() > 1000 || d.question.trim() != d.question
        || !(2..=10).contains(&d.options.len()) || d.min_choices == 0
        || d.max_choices < d.min_choices || d.max_choices as usize > d.options.len()
        || d.expires_at_unix_ms <= 0
    {
        return Err(error("FEED_INVALID"));
    }
    let mut options = std::collections::BTreeSet::new();
    for option in &d.options {
        if option.is_empty() || option.trim() != option || option.len() > 500 || !options.insert(option) {
            return Err(error("FEED_INVALID"));
        }
    }
    Ok(())
}

pub fn poll_definition_hash(definition: &FeedPollDefinition) -> Result<Vec<u8>, TrustError> {
    validate_poll_definition(definition)?;
    hash(POLL_DEFINITION_DOMAIN, definition)
}

pub fn validate_post_update(original: &content::social::v1::CreatePostRequest,
    updated: &content::social::v1::CreatePostRequest, created_at: i64) -> Result<(), TrustError> {
    use content::social::v1::create_post_request::Content;
    match (original.content.as_ref(), updated.content.as_ref()) {
        (Some(Content::Poll(old)), Some(Content::Poll(new))) => {
            if poll_definition(old, created_at)? != poll_definition(new, created_at)? {
                return Err(error("FEED_INVALID"));
            }
            Ok(())
        }
        (Some(Content::Poll(_)), _) | (_, Some(Content::Poll(_))) => Err(error("FEED_INVALID")),
        _ => Ok(()),
    }
}

/// Per-prefix replay state binds edits to original creation. It neither
/// persists data nor reads a journal, so prefix verification cannot recurse.
#[derive(Default)]
pub struct FeedPostReplay {
    originals: std::collections::BTreeMap<String, (content::social::v1::CreatePostRequest, i64)>,
    tombstoned: std::collections::BTreeSet<String>,
}

impl FeedPostReplay {
    pub fn observe(&mut self, event: &FeedEvent) -> Result<(), TrustError> {
        use content::social::v1::create_post_request::Content;
        let statement = event.statement.as_ref().ok_or_else(|| error("FEED_INVALID"))?;
        let payload: FeedPayload = decode_canonical(&event.payload)?;
        let Some(feed_payload::Mutation::Post(post)) = payload.mutation else { return Ok(()); };
        if statement.kind == FeedEventKind::PostTombstoned as i32 {
            if !self.originals.contains_key(&post.post_id) { return Err(error("FEED_GAP")); }
            self.tombstoned.insert(post.post_id);
            return Ok(());
        }
        let request: content::social::v1::CreatePostRequest = decode_canonical(&post.create_request)?;
        if statement.kind == FeedEventKind::PostCreated as i32 {
            if self.originals.contains_key(&post.post_id) { return Err(error("FEED_INVALID")); }
            if let Some(Content::Poll(poll)) = request.content.as_ref() {
                poll_definition(poll, statement.created_at_unix_ms)?;
            }
            self.originals.insert(post.post_id, (request, statement.created_at_unix_ms));
            return Ok(());
        }
        if statement.kind != FeedEventKind::PostUpdated as i32 || self.tombstoned.contains(&post.post_id) {
            return Err(error("FEED_INVALID"));
        }
        let (original, created) = self.originals.get(&post.post_id).ok_or_else(|| error("FEED_GAP"))?;
        validate_post_update(original, &request, *created)
    }
}

pub fn validate_poll_ballot(ballot: &FeedPollBallotMutation) -> Result<(), TrustError> {
    if ballot.definition_hash.len() != 32 || !(1..=10).contains(&ballot.option_indices.len()) {
        return Err(error("FEED_INVALID"));
    }
    target_object(&ballot.target_post_ref, "post")?;
    let mut previous = -1;
    for &option in &ballot.option_indices {
        if !(0..10).contains(&option) || option <= previous { return Err(error("FEED_INVALID")); }
        previous = option;
    }
    Ok(())
}

pub fn poll_ballot_decision(ballot: &FeedPollBallotMutation, definition: &FeedPollDefinition,
    at: i64) -> Result<FeedPollAdmissionResult, TrustError> {
    validate_poll_ballot(ballot)?;
    if at <= 0 { return Err(error("FEED_INVALID")); }
    if ballot.definition_hash != poll_definition_hash(definition)? {
        return Ok(FeedPollAdmissionResult::DefinitionChanged);
    }
    if ballot.option_indices.len() < definition.min_choices as usize
        || ballot.option_indices.len() > definition.max_choices as usize
        || *ballot.option_indices.last().ok_or_else(|| error("FEED_INVALID"))? as usize >= definition.options.len()
    {
        return Ok(FeedPollAdmissionResult::InvalidSelection);
    }
    if at >= definition.expires_at_unix_ms { return Ok(FeedPollAdmissionResult::Closed); }
    Ok(FeedPollAdmissionResult::Accepted)
}

pub fn verify_poll_admission(admission: &FeedPollAdmission, event: &FeedEvent,
    definition: &FeedPollDefinition, trusted_key_id: &str, trusted_key: &[u8]) -> Result<(), TrustError> {
    let statement = admission.statement.as_ref().ok_or_else(|| error("FEED_INVALID"))?;
    let payload: FeedPayload = decode_canonical(&event.payload)?;
    let Some(feed_payload::Mutation::PollBallot(ballot)) = payload.mutation else { return Err(error("FEED_INVALID")); };
    validate_poll_ballot(&ballot)?;
    let (home, _) = target_object(&ballot.target_post_ref, "post")?;
    if event.statement.as_ref().ok_or_else(|| error("FEED_INVALID"))?.kind != FeedEventKind::PollBallotSet as i32
        || statement.format_version != 1 || statement.home_station_peer_id != home
        || statement.target_post_ref != ballot.target_post_ref || statement.event_hash != event_hash(event)?
        || statement.definition_hash != poll_definition_hash(definition)? || statement.accepted_at_unix_ms <= 0
        || !identifier(&statement.signing_key_id) || statement.signing_key_id != trusted_key_id
    {
        return Err(error("FEED_INVALID"));
    }
    let result = FeedPollAdmissionResult::try_from(statement.result).map_err(|_| error("FEED_INVALID"))?;
    if result != FeedPollAdmissionResult::TargetUnavailable
        && result != poll_ballot_decision(&ballot, definition, statement.accepted_at_unix_ms)?
    {
        return Err(error("FEED_INVALID"));
    }
    verify(POLL_ADMISSION_DOMAIN, statement, trusted_key, &admission.station_signature)
}
