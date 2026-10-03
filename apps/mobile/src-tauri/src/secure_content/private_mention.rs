use std::collections::HashSet;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::secure_content::proto::{
    actor::v1 as actor, secure_content::v1 as wire, social::v1 as social,
};
use crate::secure_content::NativeSocialSession;

const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_PRIVATE_MENTIONS: usize = 256;
const HMAC_BLOCK_BYTES: usize = 64;
const MENTION_COMMITMENT_DOMAIN: &[u8] = b"peers-touch:secure-content:mention:v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMentionIntent {
    pub actor_ptid: String,
    pub offset: i32,
    pub length: i32,
    pub display: String,
}

pub fn canonical_private_mentions(
    text: &str,
    intents: &[PrivateMentionIntent],
    label: &str,
) -> Result<Vec<social::Mention>, String> {
    let mentions = intents
        .iter()
        .map(|mention| social::Mention {
            actor_ptid: mention.actor_ptid.clone(),
            offset: mention.offset,
            length: mention.length,
            display: mention.display.clone(),
        })
        .collect::<Vec<_>>();
    validate_private_mentions(text, &mentions, label)?;
    Ok(mentions)
}

pub fn build_signed_mention_routing(
    mentions: &[social::Mention],
    commitment_salt: Option<&[u8; 32]>,
    plan: &wire::ContentEncryptionPlan,
    payload: &wire::EncryptedPayload,
    session: &NativeSocialSession,
    label: &str,
) -> Result<Option<social::SignedMentionRouting>, String> {
    if mentions.is_empty() {
        if commitment_salt.is_some() {
            return Err(format!("{label} mention salt exists without mentions"));
        }
        return Ok(None);
    }
    let commitment_salt =
        commitment_salt.ok_or_else(|| format!("{label} mention commitment salt is unavailable"))?;
    let resource = plan
        .resource
        .as_ref()
        .ok_or_else(|| format!("{label} mention resource is unavailable"))?;
    let sender = plan
        .author
        .as_ref()
        .ok_or_else(|| format!("{label} mention sender is unavailable"))?;
    let payload_hash = Sha256::digest(payload.encode_to_vec()).to_vec();
    let mut facts = mentions
        .iter()
        .map(|mention| {
            Ok(social::MentionRoutingFact {
                mentioned_actor: Some(actor::ActorRef {
                    ptid: mention.actor_ptid.clone(),
                    kind: actor::ActorKind::Person as i32,
                    ..Default::default()
                }),
                mention_commitment: domain_hmac_sha256(
                    commitment_salt,
                    &[MENTION_COMMITMENT_DOMAIN, &mention.encode_to_vec()],
                )
                .to_vec(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    facts.sort_by(|left, right| {
        left.mentioned_actor
            .as_ref()
            .map(Message::encode_to_vec)
            .cmp(&right.mentioned_actor.as_ref().map(Message::encode_to_vec))
            .then_with(|| left.mention_commitment.cmp(&right.mention_commitment))
    });
    if facts
        .windows(2)
        .any(|pair| pair[0].mention_commitment == pair[1].mention_commitment)
    {
        return Err(format!("{label} mention commitments are not unique"));
    }
    let mut routing = social::SignedMentionRouting {
        format_version: payload.format_version,
        resource: Some(resource.clone()),
        authorization_snapshot_sha256: plan.authorization_snapshot_sha256.clone(),
        encrypted_payload_sha256: payload_hash,
        facts,
        sender: Some(sender.clone()),
        sender_signing_key_id: session.signing_key_id.clone(),
        canonical_facts_sha256: Vec::new(),
        sender_signature: Vec::new(),
    };
    routing.canonical_facts_sha256 = Sha256::digest(routing.encode_to_vec()).to_vec();
    routing.sender_signature = session.sign(&routing.canonical_facts_sha256);
    Ok(Some(routing))
}

#[allow(clippy::too_many_arguments)]
pub fn validated_mention_routing_hash(
    verification: &social::PrivateContentVerification,
    proof: &wire::ViewerContentCommitProof,
    resource: &wire::SecureResourceRef,
    payload: &wire::EncryptedPayload,
    sender: &actor::ActorDeviceRef,
    expected_signing_key_id: Option<&str>,
    sender_signing_key: Option<&VerifyingKey>,
    label: &str,
) -> Result<[u8; 32], String> {
    let Some(routing) = verification.mention_routing.as_ref() else {
        return Ok(Sha256::digest([]).into());
    };
    let expected_signing_key_id = expected_signing_key_id
        .ok_or_else(|| format!("{label} mention signing key ID is unavailable"))?;
    let sender_signing_key =
        sender_signing_key.ok_or_else(|| format!("{label} mention signing key is unavailable"))?;
    if routing.format_version != payload.format_version
        || routing.resource.as_ref() != Some(resource)
        || routing.authorization_snapshot_sha256 != proof.authorization_snapshot_sha256
        || routing.encrypted_payload_sha256 != Sha256::digest(payload.encode_to_vec()).as_slice()
        || routing.sender.as_ref() != Some(sender)
        || routing.sender_signing_key_id != expected_signing_key_id
        || !canonical_identifier(&routing.sender_signing_key_id)
        || routing.facts.is_empty()
        || routing.facts.len() > MAX_PRIVATE_MENTIONS
        || routing.canonical_facts_sha256.len() != 32
        || routing.sender_signature.len() != 64
    {
        return Err(format!("{label} mention routing is invalid"));
    }
    let mut previous: Option<(Vec<u8>, Vec<u8>)> = None;
    let mut commitments = HashSet::with_capacity(routing.facts.len());
    for fact in &routing.facts {
        let mentioned_actor = fact
            .mentioned_actor
            .as_ref()
            .ok_or_else(|| format!("{label} mentioned actor is unavailable"))?;
        if !canonical_actor(mentioned_actor) || fact.mention_commitment.len() != 32 {
            return Err(format!("{label} mention fact is invalid"));
        }
        let current = (
            mentioned_actor.encode_to_vec(),
            fact.mention_commitment.clone(),
        );
        if previous.as_ref().is_some_and(|value| value >= &current)
            || !commitments.insert(fact.mention_commitment.clone())
        {
            return Err(format!("{label} mention facts are not canonical"));
        }
        previous = Some(current);
    }
    let mut unsigned = routing.clone();
    unsigned.canonical_facts_sha256.clear();
    unsigned.sender_signature.clear();
    let signing_digest = Sha256::digest(unsigned.encode_to_vec());
    if routing.canonical_facts_sha256 != signing_digest.as_slice() {
        return Err(format!("{label} mention routing digest is invalid"));
    }
    let signature = Signature::from_slice(&routing.sender_signature)
        .map_err(|_| format!("{label} mention signature is invalid"))?;
    sender_signing_key
        .verify(&routing.canonical_facts_sha256, &signature)
        .map_err(|_| format!("{label} mention signature is invalid"))?;
    Ok(Sha256::digest(routing.encode_to_vec()).into())
}

pub fn verify_decrypted_mentions(
    text: &str,
    mentions: &[social::Mention],
    commitment_salt: &[u8],
    routing: Option<&social::SignedMentionRouting>,
    label: &str,
) -> Result<Vec<social::Mention>, String> {
    if mentions.is_empty() {
        if !commitment_salt.is_empty() || routing.is_some() {
            return Err(format!("{label} empty mentions have routing metadata"));
        }
        return Ok(Vec::new());
    }
    let commitment_salt: [u8; 32] = commitment_salt
        .try_into()
        .map_err(|_| format!("{label} mention commitment salt is invalid"))?;
    let routing = routing.ok_or_else(|| format!("{label} mention routing is unavailable"))?;
    if routing.facts.len() != mentions.len() {
        return Err(format!("{label} mention routing coverage is incomplete"));
    }
    validate_private_mentions(text, mentions, label)?;
    let mut expected = mentions
        .iter()
        .map(|mention| social::MentionRoutingFact {
            mentioned_actor: Some(actor::ActorRef {
                ptid: mention.actor_ptid.clone(),
                kind: actor::ActorKind::Person as i32,
                ..Default::default()
            }),
            mention_commitment: domain_hmac_sha256(
                &commitment_salt,
                &[MENTION_COMMITMENT_DOMAIN, &mention.encode_to_vec()],
            )
            .to_vec(),
        })
        .collect::<Vec<_>>();
    expected.sort_by(|left, right| {
        left.mentioned_actor
            .as_ref()
            .map(Message::encode_to_vec)
            .cmp(&right.mentioned_actor.as_ref().map(Message::encode_to_vec))
            .then_with(|| left.mention_commitment.cmp(&right.mention_commitment))
    });
    if expected != routing.facts {
        return Err(format!("{label} decrypted mentions do not match routing"));
    }
    Ok(mentions.to_vec())
}

fn validate_private_mentions(
    text: &str,
    mentions: &[social::Mention],
    label: &str,
) -> Result<(), String> {
    if mentions.len() > MAX_PRIVATE_MENTIONS {
        return Err(format!(
            "{label} mention count exceeds {MAX_PRIVATE_MENTIONS}"
        ));
    }
    let text_utf16_len = text.encode_utf16().count();
    let mut previous_end = 0usize;
    for mention in mentions {
        let start = usize::try_from(mention.offset)
            .map_err(|_| format!("{label} mention range is invalid or overlapping"))?;
        let length = usize::try_from(mention.length)
            .map_err(|_| format!("{label} mention range is invalid or overlapping"))?;
        let end = start
            .checked_add(length)
            .ok_or_else(|| format!("{label} mention range overflows"))?;
        if !canonical_identifier(&mention.actor_ptid)
            || length == 0
            || mention.display.trim().is_empty()
            || mention.display.trim() != mention.display
            || mention.display.starts_with('@')
            || end > text_utf16_len
            || start < previous_end
        {
            return Err(format!("{label} mention is invalid"));
        }
        previous_end = end;
    }
    Ok(())
}

fn canonical_actor(actor: &actor::ActorRef) -> bool {
    canonical_identifier(&actor.ptid)
        && actor::ActorKind::try_from(actor.kind)
            .ok()
            .is_some_and(|kind| kind != actor::ActorKind::Unspecified)
}

fn canonical_identifier(value: &str) -> bool {
    !value.is_empty()
        && value == value.trim()
        && value.len() <= MAX_IDENTIFIER_BYTES
        && !value.as_bytes().contains(&0)
}

pub(crate) fn domain_hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let normalized_key: [u8; HMAC_BLOCK_BYTES] = if key.len() > HMAC_BLOCK_BYTES {
        let mut normalized = [0_u8; HMAC_BLOCK_BYTES];
        normalized[..32].copy_from_slice(&Sha256::digest(key));
        normalized
    } else {
        let mut normalized = [0_u8; HMAC_BLOCK_BYTES];
        normalized[..key.len()].copy_from_slice(key);
        normalized
    };
    let mut inner_pad = [0x36_u8; HMAC_BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; HMAC_BLOCK_BYTES];
    for index in 0..HMAC_BLOCK_BYTES {
        inner_pad[index] ^= normalized_key[index];
        outer_pad[index] ^= normalized_key[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    for part in parts {
        inner.update(part);
    }
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_hmac_matches_the_sha256_reference_vector() {
        assert_eq!(
            domain_hmac_sha256(b"key", &[b"The quick brown fox jumps over the lazy dog"]),
            [
                0xf7, 0xbc, 0x83, 0xf4, 0x30, 0x53, 0x84, 0x24, 0xb1, 0x32, 0x98, 0xe6, 0xaa, 0x6f,
                0xb1, 0x43, 0xef, 0x4d, 0x59, 0xa1, 0x49, 0x46, 0x17, 0x59, 0x97, 0x47, 0x9d, 0xbc,
                0x2d, 0x1a, 0x3c, 0xd8,
            ]
        );
    }

    #[test]
    fn mention_ranges_are_utf16_bounded_and_non_overlapping() {
        let mention = PrivateMentionIntent {
            actor_ptid: "ptid:bob".to_string(),
            offset: 3,
            length: 3,
            display: "Bob".to_string(),
        };
        assert!(
            canonical_private_mentions("a😀Bob", std::slice::from_ref(&mention), "private").is_ok()
        );
        let mut overlapping = mention.clone();
        overlapping.offset = 4;
        assert!(canonical_private_mentions("a😀Bob", &[mention, overlapping], "private").is_err());
    }
}
