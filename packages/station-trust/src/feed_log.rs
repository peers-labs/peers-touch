//! Actor-owned public feeds. Trust comes from the retained Actor identity key,
//! not a key selected by the Station being verified.
use crate::TrustError;
use libp2p_identity::{ed25519, Keypair};
use prost::Message;
use sha2::{Digest, Sha256};

pub mod proto {
    include!(concat!(
        env!("OUT_DIR"),
        "/peers_touch.model.social.feed.v1.rs"
    ));
}
use proto::*;

// Compile the existing content contracts; signed payloads must not invent a
// second schema that accepts a private body or mismatched content variant.
pub mod content {
    pub mod common {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
        }
    }
    pub mod activity {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/peers_touch.model.activity.v1.rs"));
        }
    }
    pub mod social {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/peers_touch.model.social.v1.rs"));
        }
    }
}

pub const PUBLIC_CHAIN_ID: &str = "public/v1";
pub const GENESIS_DOMAIN: &[u8] = b"peers-touch/social-feed/genesis/v1\0";
pub const GRANT_DOMAIN: &[u8] = b"peers-touch/social-feed/writer-grant/v1\0";
pub const EVENT_DOMAIN: &[u8] = b"peers-touch/social-feed/event/v1\0";
pub const EVENT_HASH_DOMAIN: &[u8] = b"peers-touch/social-feed/event-hash/v1\0";
pub const MAX_FEED_BYTES: usize = 1 << 20;

fn error(code: &'static str) -> TrustError {
    TrustError::new(code)
}

pub fn signing_bytes<T: Message>(domain: &[u8], message: &T) -> Result<Vec<u8>, TrustError> {
    if message.encoded_len() > MAX_FEED_BYTES {
        return Err(error("FEED_INVALID"));
    }
    let mut input = domain.to_vec();
    message
        .encode(&mut input)
        .map_err(|_| error("FEED_INVALID"))?;
    Ok(input)
}

pub fn hash<T: Message>(domain: &[u8], message: &T) -> Result<Vec<u8>, TrustError> {
    Ok(Sha256::digest(signing_bytes(domain, message)?).to_vec())
}

pub fn decode_canonical<T: Message + Default>(wire: &[u8]) -> Result<T, TrustError> {
    if wire.len() > MAX_FEED_BYTES {
        return Err(error("FEED_INVALID"));
    }
    let message = T::decode(wire).map_err(|_| error("FEED_INVALID"))?;
    // Prost drops unknown fields; an exact re-encode comparison rejects them,
    // duplicate/reordered fields and non-minimal varints at every nested level.
    if message.encode_to_vec() != wire {
        return Err(error("FEED_NONCANONICAL"));
    }
    Ok(message)
}

fn verify<T: Message>(
    domain: &[u8],
    statement: &T,
    key: &[u8],
    signature: &[u8],
) -> Result<(), TrustError> {
    let public =
        ed25519::PublicKey::try_from_bytes(key).map_err(|_| error("FEED_SIGNATURE_INVALID"))?;
    if signature.len() != 64 || !public.verify(&signing_bytes(domain, statement)?, signature) {
        return Err(error("FEED_SIGNATURE_INVALID"));
    }
    Ok(())
}

fn identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && value.trim() == value && !value.contains('\0')
}

pub fn verify_authorization(
    genesis: &FeedGenesis,
    grant: &FeedWriterGrant,
    actor_ptid: &str,
    trusted_root: &[u8],
) -> Result<(), TrustError> {
    let g = genesis
        .statement
        .as_ref()
        .ok_or_else(|| error("FEED_INVALID"))?;
    let w = grant
        .statement
        .as_ref()
        .ok_or_else(|| error("FEED_INVALID"))?;
    if actor_ptid.is_empty() || trusted_root.len() != 32 {
        return Err(error("FEED_INVALID"));
    }
    if g.format_version != 1
        || w.format_version != 1
        || g.actor_ptid != actor_ptid
        || w.actor_ptid != actor_ptid
        || g.chain_id != PUBLIC_CHAIN_ID
        || w.chain_id != g.chain_id
        || g.actor_identity_public_key != trusted_root
        || !identifier(&w.device_id)
        || !identifier(&w.signing_key_id)
        || w.device_public_key.len() != 32
    {
        return Err(error("FEED_WRITER_NOT_AUTHORIZED"));
    }
    verify(GENESIS_DOMAIN, g, trusted_root, &genesis.actor_signature)?;
    if w.genesis_hash != hash(GENESIS_DOMAIN, genesis)? {
        return Err(error("FEED_INVALID"));
    }
    verify(GRANT_DOMAIN, w, trusted_root, &grant.actor_signature)
}

/// Authenticity only; it does not import an unrelated author's history.
pub fn verify_event(event: &FeedEvent, grant: &FeedWriterGrant) -> Result<(), TrustError> {
    let s = event
        .statement
        .as_ref()
        .ok_or_else(|| error("FEED_INVALID"))?;
    let w = grant
        .statement
        .as_ref()
        .ok_or_else(|| error("FEED_INVALID"))?;
    if s.format_version != 1
        || s.sequence == 0
        || s.sequence > i64::MAX as u64
        || s.actor_ptid != w.actor_ptid
        || s.chain_id != w.chain_id
        || s.created_at_unix_ms <= 0
        || s.previous_hash.len() != 32
        || event.payload.is_empty()
        || event.payload.len() > MAX_FEED_BYTES
        || !(1..=8).contains(&s.kind)
    {
        return Err(error("FEED_INVALID"));
    }
    if s.writer_grant_hash != hash(GRANT_DOMAIN, grant)? {
        return Err(error("FEED_WRITER_NOT_AUTHORIZED"));
    }
    if s.payload_hash != Sha256::digest(&event.payload).as_slice() {
        return Err(error("FEED_INVALID"));
    }
    if event.encoded_len() > MAX_FEED_BYTES {
        return Err(error("FEED_INVALID"));
    }
    verify(
        EVENT_DOMAIN,
        s,
        &w.device_public_key,
        &event.device_signature,
    )?;
    let payload: FeedPayload = decode_canonical(&event.payload)?;
    validate_payload(s.kind, &payload)
}

pub fn object_id(value: &str) -> Result<u64, TrustError> {
    let n = value.parse::<u64>().map_err(|_| error("FEED_INVALID"))?;
    if n == 0 || n > i64::MAX as u64 || n.to_string() != value {
        return Err(error("FEED_INVALID"));
    }
    Ok(n)
}

pub fn target_object(value: &str, kind: &str) -> Result<(String, String), TrustError> {
    let suffix = value.strip_prefix("oss://").ok_or_else(|| error("FEED_INVALID"))?;
    let (home, path) = suffix.split_once('/').ok_or_else(|| error("FEED_INVALID"))?;
    if home.is_empty() || home.chars().any(|c| matches!(c, ':' | '@' | '?' | '#' | '%' | '\\') || c.is_whitespace()) {
        return Err(error("FEED_INVALID"));
    }
    let id = path.strip_prefix(&format!("{kind}/")).ok_or_else(|| error("FEED_INVALID"))?;
    object_id(id)?;
    Ok((home.to_owned(), id.to_owned()))
}

pub fn validate_payload(kind: i32, payload: &FeedPayload) -> Result<(), TrustError> {
    use content::social::v1::{create_post_request::Content, CreateCommentRequest, CreatePostRequest};
    match (kind, payload.mutation.as_ref()) {
        (1..=3, Some(feed_payload::Mutation::Post(p))) => {
            object_id(&p.post_id)?;
            if kind == 3 {
                return if p.create_request.is_empty() { Ok(()) } else { Err(error("FEED_INVALID")) };
            }
            let r: CreatePostRequest = decode_canonical(&p.create_request)?;
            let audience = r.audience.as_ref().ok_or_else(|| error("FEED_INVALID"))?;
            if audience.kind != 1 || !r.reply_to_post_id.is_empty() {
                return Err(error("FEED_INVALID"));
            }
            // PUBLIC rejects private audience selectors, exactly like Go's
            // ValidateAudience, rather than silently dropping their intent.
            if audience.target.is_some() || !audience.actor_ptids.is_empty() || audience.base_kind != 0 {
                return Err(error("FEED_INVALID"));
            }
            match (r.r#type, r.content.as_ref()) {
                (0, Some(Content::Text(_))) | (1, Some(Content::Image(_))) |
                (2, Some(Content::Video(_))) | (3, Some(Content::Link(_))) |
                (4, Some(Content::Poll(_))) | (6, Some(Content::Location(_))) => Ok(()),
                (5, Some(Content::Repost(p))) => target_object(&p.original_post_id, "post").map(|_| ()),
                _ => Err(error("FEED_INVALID")),
            }
        }
        (4..=5, Some(feed_payload::Mutation::Reaction(r))) => {
            if !(1..=16).contains(&r.reaction_kind) {
                return Err(error("FEED_INVALID"));
            }
            target_object(&r.target_post_ref, "post")?;
            if !r.target_comment_ref.is_empty() {
                target_object(&r.target_comment_ref, "comment")?;
            }
            Ok(())
        }
        (6..=8, Some(feed_payload::Mutation::Comment(c))) => {
            object_id(&c.comment_id)?;
            target_object(&c.target_post_ref, "post")?;
            if kind == 8 {
                return if c.create_request.is_empty() { Ok(()) } else { Err(error("FEED_INVALID")) };
            }
            let r: CreateCommentRequest = decode_canonical(&c.create_request)?;
            if r.content.trim().is_empty() || r.post_id != c.target_post_ref {
                return Err(error("FEED_INVALID"));
            }
            if !r.reply_to_comment_id.is_empty() {
                target_object(&r.reply_to_comment_id, "comment")?;
            }
            validate_mentions(&r.content, &r.typed_mentions)
        }
        _ => Err(error("FEED_INVALID")),
    }
}

fn validate_mentions(text: &str, mentions: &[content::social::v1::Mention]) -> Result<(), TrustError> {
    if mentions.len() > 20 { return Err(error("FEED_INVALID")); }
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut ordered: Vec<_> = mentions.iter().collect();
    ordered.sort_by_key(|m| m.offset);
    let mut actors = std::collections::HashSet::new();
    let mut previous_end = 0;
    for m in ordered {
        if m.actor_ptid.is_empty() || m.actor_ptid.len() > 255 || !actors.insert(&m.actor_ptid) ||
            m.offset < previous_end || m.length <= 0 {
            return Err(error("FEED_INVALID"));
        }
        let end = m.offset.checked_add(m.length).ok_or_else(|| error("FEED_INVALID"))?;
        if end as usize > units.len() || String::from_utf16_lossy(&units[m.offset as usize..end as usize]) != m.display {
            return Err(error("FEED_INVALID"));
        }
        previous_end = end;
    }
    Ok(())
}

pub fn event_hash(event: &FeedEvent) -> Result<Vec<u8>, TrustError> {
    hash(EVENT_HASH_DOMAIN, event)
}

pub fn initial_head(genesis: &FeedGenesis) -> Result<FeedHead, TrustError> {
    let statement = genesis
        .statement
        .as_ref()
        .ok_or_else(|| error("FEED_INVALID"))?;
    Ok(FeedHead {
        actor_ptid: statement.actor_ptid.clone(),
        chain_id: statement.chain_id.clone(),
        sequence: 0,
        event_hash: hash(GENESIS_DOMAIN, genesis)?,
    })
}

/// Check after verify_event; an absent prefix is a gap, not a fork.
pub fn advance_head(head: &FeedHead, event: &FeedEvent) -> Result<FeedHead, TrustError> {
    let s = event
        .statement
        .as_ref()
        .ok_or_else(|| error("FEED_INVALID"))?;
    if s.actor_ptid != head.actor_ptid || s.chain_id != head.chain_id {
        return Err(error("FEED_INVALID"));
    }
    if s.sequence <= head.sequence {
        return Err(error("FEED_HEAD_ROLLBACK"));
    }
    if head.sequence.checked_add(1) != Some(s.sequence) {
        return Err(error("FEED_GAP"));
    }
    if s.previous_hash != head.event_hash {
        return Err(error("FEED_FORK_DETECTED"));
    }
    Ok(FeedHead {
        actor_ptid: s.actor_ptid.clone(),
        chain_id: s.chain_id.clone(),
        sequence: s.sequence,
        event_hash: event_hash(event)?,
    })
}

/// Pin observation requires the exact local event hash at the observed
/// sequence. A claimed high sequence alone is never accepted as proof.
pub fn verify_observed_head(pinned: &FeedHead, observed: &FeedHead) -> Result<(), TrustError> {
    if observed.actor_ptid != pinned.actor_ptid || observed.chain_id != pinned.chain_id {
        return Err(error("FEED_INVALID"));
    }
    if observed.sequence < pinned.sequence {
        return Err(error("FEED_HEAD_ROLLBACK"));
    }
    if observed.sequence != pinned.sequence {
        return Err(error("FEED_GAP"));
    }
    if observed.event_hash != pinned.event_hash {
        return Err(error("FEED_FORK_DETECTED"));
    }
    Ok(())
}

/// Verify a bounded page against the caller's independently retained root and
/// prefix. The advertised terminal head is pinned only after its full prefix
/// has arrived. Returned payloads, not Station-rendered bodies, own projection.
pub fn verify_read_page(
    request: &ReadFeedRequest,
    response: &ReadFeedResponse,
    trusted_root: &[u8],
    previous: Option<&FeedHead>,
) -> Result<FeedHead, TrustError> {
    if request.chain_id != PUBLIC_CHAIN_ID || request.actor_ptid.is_empty() ||
        request.limit == 0 || request.limit > 64 || response.encoded_len() > MAX_FEED_BYTES {
        return Err(error("FEED_INVALID"));
    }
    let bundle = response.bundle.as_ref().ok_or_else(|| error("FEED_INVALID"))?;
    let genesis = bundle.genesis.as_ref().ok_or_else(|| error("FEED_INVALID"))?;
    let grant = bundle.writer_grant.as_ref().ok_or_else(|| error("FEED_INVALID"))?;
    verify_authorization(genesis, grant, &request.actor_ptid, trusted_root)?;
    let mut head = match previous {
        Some(p) => p.clone(),
        None => initial_head(genesis)?,
    };
    if head.actor_ptid != request.actor_ptid || head.chain_id != request.chain_id ||
        head.sequence != request.after_sequence || head.event_hash.len() != 32 ||
        bundle.events.len() > request.limit as usize {
        return Err(error("FEED_INVALID"));
    }
    for event in &bundle.events {
        verify_event(event, grant)?;
        head = advance_head(&head, event)?;
    }
    let observed = response.head.as_ref().ok_or_else(|| error("FEED_INVALID"))?;
    if observed.actor_ptid != head.actor_ptid || observed.chain_id != head.chain_id || observed.event_hash.len() != 32 {
        return Err(error("FEED_INVALID"));
    }
    if observed.sequence < head.sequence {
        return Err(error("FEED_HEAD_ROLLBACK"));
    }
    if response.has_more {
        if bundle.events.is_empty() || observed.sequence <= head.sequence {
            return Err(error("FEED_INVALID"));
        }
    } else {
        verify_observed_head(&head, observed)?;
    }
    Ok(head)
}

pub fn sign_genesis(
    statement: FeedGenesisStatement,
    root: &Keypair,
) -> Result<FeedGenesis, TrustError> {
    let actor_signature = root
        .sign(&signing_bytes(GENESIS_DOMAIN, &statement)?)
        .map_err(|_| error("FEED_SIGNATURE_INVALID"))?;
    Ok(FeedGenesis {
        statement: Some(statement),
        actor_signature,
    })
}

pub fn sign_grant(
    statement: FeedWriterGrantStatement,
    root: &Keypair,
) -> Result<FeedWriterGrant, TrustError> {
    let actor_signature = root
        .sign(&signing_bytes(GRANT_DOMAIN, &statement)?)
        .map_err(|_| error("FEED_SIGNATURE_INVALID"))?;
    Ok(FeedWriterGrant {
        statement: Some(statement),
        actor_signature,
    })
}

pub fn sign_event(
    mut statement: FeedEventStatement,
    payload: &FeedPayload,
    writer: &Keypair,
) -> Result<FeedEvent, TrustError> {
    let payload = payload.encode_to_vec();
    statement.payload_hash = Sha256::digest(&payload).to_vec();
    let device_signature = writer
        .sign(&signing_bytes(EVENT_DOMAIN, &statement)?)
        .map_err(|_| error("FEED_SIGNATURE_INVALID"))?;
    Ok(FeedEvent {
        statement: Some(statement),
        payload,
        device_signature,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    fn vector() -> (FeedBundle, Vec<u8>, Vec<u8>) {
        let fixture = include_str!("../../../model/domain/social/testdata/feed_v1.json");
        let field = |name: &str| {
            fixture
                .lines()
                .find(|line| line.contains(&format!("\"{name}\":")))
                .unwrap()
                .split('"')
                .nth(3)
                .unwrap()
        };
        (
            decode_canonical(&hex(field("bundle"))).unwrap(),
            hex(field("root_public_key")),
            hex(field("event_hash")),
        )
    }

    #[test]
    fn independent_conformance_vector_and_signature() {
        let (bundle, root, expected_hash) = vector();
        let genesis = bundle.genesis.as_ref().unwrap();
        let grant = bundle.writer_grant.as_ref().unwrap();
        let event = &bundle.events[0];
        verify_authorization(genesis, grant, "ptid:test:alice", &root).unwrap();
        verify_event(event, grant).unwrap();
        assert_eq!(event_hash(event).unwrap(), expected_hash);
        let writer = Keypair::ed25519_from_bytes([2u8; 32]).unwrap();
        assert_eq!(
            writer
                .sign(&signing_bytes(EVENT_DOMAIN, event.statement.as_ref().unwrap()).unwrap())
                .unwrap(),
            event.device_signature
        );
    }

    #[test]
    fn trust_namespace_and_payload_tamper_fail_closed() {
        let (mut bundle, mut root, _) = vector();
        root[0] ^= 1;
        assert_eq!(
            verify_authorization(
                bundle.genesis.as_ref().unwrap(),
                bundle.writer_grant.as_ref().unwrap(),
                "ptid:test:alice",
                &root
            )
            .unwrap_err()
            .code,
            "FEED_WRITER_NOT_AUTHORIZED"
        );
        bundle.events[0].payload[0] ^= 1;
        assert_eq!(
            verify_event(&bundle.events[0], bundle.writer_grant.as_ref().unwrap())
                .unwrap_err()
                .code,
            "FEED_INVALID"
        );
        let (mut bundle, root, _) = vector();
        bundle
            .genesis
            .as_mut()
            .unwrap()
            .statement
            .as_mut()
            .unwrap()
            .chain_id = "private/v1".into();
        assert!(verify_authorization(
            bundle.genesis.as_ref().unwrap(),
            bundle.writer_grant.as_ref().unwrap(),
            "ptid:test:alice",
            &root
        )
        .is_err());
    }

    #[test]
    fn head_gap_fork_and_rollback_are_distinct() {
        let (bundle, _, _) = vector();
        let head = initial_head(bundle.genesis.as_ref().unwrap()).unwrap();
        let next = advance_head(&head, &bundle.events[0]).unwrap();
        assert_eq!(next.sequence, 1);
        assert_eq!(
            verify_observed_head(&next, &head).unwrap_err().code,
            "FEED_HEAD_ROLLBACK"
        );
        let mut gap = bundle.events[0].clone();
        gap.statement.as_mut().unwrap().sequence = 3;
        assert_eq!(advance_head(&head, &gap).unwrap_err().code, "FEED_GAP");
        let mut fork = bundle.events[0].clone();
        fork.statement.as_mut().unwrap().previous_hash[0] ^= 1;
        assert_eq!(
            advance_head(&head, &fork).unwrap_err().code,
            "FEED_FORK_DETECTED"
        );
    }

    #[test]
    fn noncanonical_wire_is_rejected() {
        let (bundle, _, _) = vector();
        let mut wire = bundle.encode_to_vec();
        wire.extend_from_slice(&[0x28, 1]);
        assert_eq!(
            decode_canonical::<FeedBundle>(&wire).unwrap_err().code,
            "FEED_NONCANONICAL"
        );
        let mut wire = bundle.encode_to_vec();
        wire.extend_from_slice(&[0x0a, 0x84, 0x01]);
        wire.extend_from_slice(&bundle.genesis.as_ref().unwrap().encode_to_vec());
        assert!(decode_canonical::<FeedBundle>(&wire).is_err());
    }

    #[test]
    fn read_page_cannot_replace_payload_or_pin_unseen_terminal_head() {
        let (bundle, root, _) = vector();
        let initial = initial_head(bundle.genesis.as_ref().unwrap()).unwrap();
        let next = advance_head(&initial, &bundle.events[0]).unwrap();
        let request = ReadFeedRequest{actor_ptid: initial.actor_ptid.clone(),
            chain_id: PUBLIC_CHAIN_ID.into(), after_sequence: 0, limit: 32, ..Default::default()};
        let mut response = ReadFeedResponse{bundle: Some(bundle), head: Some(next.clone()), has_more: false, ..Default::default()};
        assert_eq!(verify_read_page(&request, &response, &root, None).unwrap(), next);
        response.bundle.as_mut().unwrap().events[0].payload[0] ^= 1;
        assert!(verify_read_page(&request, &response, &root, None).is_err());
        response.bundle.as_mut().unwrap().events.clear();
        assert_eq!(verify_read_page(&request, &response, &root, None).unwrap_err().code, "FEED_GAP");
        response.has_more = true;
        assert!(verify_read_page(&request, &response, &root, None).is_err());
        response.head = Some(initial.clone());
        response.has_more = false;
        assert_eq!(verify_read_page(&request, &response, &root, None).unwrap(), initial);
        let mut after = request;
        after.after_sequence = 1;
        assert_eq!(verify_read_page(&after, &response, &root, Some(&next)).unwrap_err().code, "FEED_HEAD_ROLLBACK");
    }
}
