use std::collections::HashSet;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use hmac::{Hmac, Mac};
use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::{actor, secure_content as wire, social};
use crate::secure_content::SecureContentSession;

const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_PRIVATE_MENTIONS: usize = 256;
pub(super) const MENTION_COMMITMENT_DOMAIN: &[u8] = b"peers-touch:secure-content:mention:v1";

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PrivateMentionIntent {
    pub actor_ptid: String,
    pub offset: i32,
    pub length: i32,
    pub display: String,
}

pub(super) fn canonical_private_mentions(
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

pub(super) fn build_signed_mention_routing(
    mentions: &[social::Mention],
    commitment_salt: Option<&[u8; 32]>,
    plan: &wire::ContentEncryptionPlan,
    payload: &wire::EncryptedPayload,
    session: &SecureContentSession,
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
            let mut mac = HmacSha256::new_from_slice(commitment_salt)
                .map_err(|_| format!("{label} mention HMAC key is invalid"))?;
            mac.update(MENTION_COMMITMENT_DOMAIN);
            mac.update(&mention.encode_to_vec());
            Ok(social::MentionRoutingFact {
                mentioned_actor: Some(actor::ActorRef {
                    ptid: mention.actor_ptid.clone(),
                    kind: actor::ActorKind::Person as i32,
                    ..Default::default()
                }),
                mention_commitment: mac.finalize().into_bytes().to_vec(),
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
    routing.sender_signature = session.sign(&routing.canonical_facts_sha256)?;
    Ok(Some(routing))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validated_mention_routing_hash(
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
        if mentioned_actor.ptid.trim().is_empty()
            || mentioned_actor.ptid.trim() != mentioned_actor.ptid
            || mentioned_actor.ptid.len() > 255
            || mentioned_actor.ptid.as_bytes().contains(&0)
            || actor::ActorKind::try_from(mentioned_actor.kind)
                .ok()
                .is_none_or(|kind| kind == actor::ActorKind::Unspecified)
            || fact.mention_commitment.len() != 32
        {
            return Err(format!("{label} mention fact is invalid"));
        }
        let current = (
            mentioned_actor.encode_to_vec(),
            fact.mention_commitment.clone(),
        );
        if previous
            .as_ref()
            .is_some_and(|previous| previous >= &current)
            || !commitments.insert(fact.mention_commitment.clone())
        {
            return Err(format!("{label} mention facts are not canonical"));
        }
        previous = Some(current);
    }

    let mut signing_input = routing.clone();
    signing_input.canonical_facts_sha256.clear();
    signing_input.sender_signature.clear();
    let signing_digest = Sha256::digest(signing_input.encode_to_vec());
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

pub(super) fn verify_decrypted_mentions(
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

    let mut expected = Vec::with_capacity(mentions.len());
    for mention in mentions {
        let mut mac = HmacSha256::new_from_slice(&commitment_salt)
            .map_err(|_| format!("{label} mention HMAC key is invalid"))?;
        mac.update(MENTION_COMMITMENT_DOMAIN);
        mac.update(&mention.encode_to_vec());
        expected.push(social::MentionRoutingFact {
            mentioned_actor: Some(actor::ActorRef {
                ptid: mention.actor_ptid.clone(),
                kind: actor::ActorKind::Person as i32,
                ..Default::default()
            }),
            mention_commitment: mac.finalize().into_bytes().to_vec(),
        });
    }
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
        if mention.actor_ptid.trim().is_empty()
            || mention.actor_ptid.trim() != mention.actor_ptid
            || mention.actor_ptid.len() > 255
            || mention.actor_ptid.as_bytes().contains(&0)
            || mention.offset < 0
            || mention.length <= 0
            || mention.display.trim().is_empty()
            || mention.display.trim() != mention.display
            || mention.display.starts_with('@')
        {
            return Err(format!("{label} mention is invalid"));
        }
        let start = mention.offset as usize;
        let end = start
            .checked_add(mention.length as usize)
            .ok_or_else(|| format!("{label} mention range overflows"))?;
        if end > text_utf16_len || start < previous_end {
            return Err(format!("{label} mention range is invalid or overlapping"));
        }
        previous_end = end;
    }
    Ok(())
}

fn canonical_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= MAX_IDENTIFIER_BYTES
        && !value.as_bytes().contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_content::station_trust::TrustedStationSigningKey;
    use crate::secure_content::SecureContentSessionKey;
    use ed25519_dalek::SigningKey;

    fn session() -> (SecureContentSession, VerifyingKey) {
        let sender_key = SigningKey::from_bytes(&[7; 32]);
        let sender_verifying_key = sender_key.verifying_key();
        let station_key = SigningKey::from_bytes(&[8; 32]);
        (
            SecureContentSession::new(
                SecureContentSessionKey {
                    station_peer_id: "station-1".to_string(),
                    actor_ptid: "ptid:alice".to_string(),
                    device_id: "device-1".to_string(),
                    jwt_session_id: "session-1".to_string(),
                    window_label: "main".to_string(),
                    session_generation: 1,
                },
                "account-1".to_string(),
                "https://station.test".to_string(),
                "token".to_string(),
                "sender-key-1".to_string(),
                1,
                sender_key,
                TrustedStationSigningKey {
                    key_id: "station-key-current".to_string(),
                    verifying_key: station_key.verifying_key(),
                },
            ),
            sender_verifying_key,
        )
    }

    fn fixture() -> (
        SecureContentSession,
        VerifyingKey,
        wire::ContentEncryptionPlan,
        wire::EncryptedPayload,
        wire::ViewerContentCommitProof,
    ) {
        let (session, sender_key) = session();
        let resource = wire::SecureResourceRef {
            owner_domain: wire::SecureContentOwnerDomain::Social as i32,
            content_id: "comment-1".to_string(),
            generation: 3,
        };
        let sender = actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: "ptid:alice".to_string(),
                kind: actor::ActorKind::Person as i32,
                ..Default::default()
            }),
            device_id: "device-1".to_string(),
        };
        let authorization_snapshot_sha256 = vec![3; 32];
        let plan = wire::ContentEncryptionPlan {
            resource: Some(resource.clone()),
            author: Some(sender.clone()),
            authorization_snapshot_sha256: authorization_snapshot_sha256.clone(),
            ..Default::default()
        };
        let payload = wire::EncryptedPayload {
            format_version: 1,
            resource: Some(resource.clone()),
            suite: wire::PayloadEncryptionSuite::Aes256Gcm as i32,
            nonce: vec![1; 12],
            ciphertext: vec![2; 32],
            ciphertext_sha256: vec![4; 32],
            aad_sha256: vec![5; 32],
        };
        let proof = wire::ViewerContentCommitProof {
            resource: Some(resource),
            author: Some(sender),
            authorization_snapshot_sha256,
            ..Default::default()
        };
        (session, sender_key, plan, payload, proof)
    }

    #[test]
    fn signed_routing_round_trips_exact_decrypted_mentions() {
        let (session, sender_key, plan, payload, mut proof) = fixture();
        let intents = vec![PrivateMentionIntent {
            actor_ptid: "ptid:bob".to_string(),
            offset: 6,
            length: 3,
            display: "Bob".to_string(),
        }];
        let mentions =
            canonical_private_mentions("hello Bob", &intents, "private Comment").unwrap();
        let routing = build_signed_mention_routing(
            &mentions,
            Some(&[9; 32]),
            &plan,
            &payload,
            &session,
            "private Comment",
        )
        .unwrap()
        .unwrap();
        let verification = social::PrivateContentVerification {
            mention_routing: Some(routing.clone()),
            ..Default::default()
        };
        proof.mention_routing_sha256 = Sha256::digest(routing.encode_to_vec()).to_vec();

        let routing_hash = validated_mention_routing_hash(
            &verification,
            &proof,
            plan.resource.as_ref().unwrap(),
            &payload,
            plan.author.as_ref().unwrap(),
            Some("sender-key-1"),
            Some(&sender_key),
            "private Comment",
        )
        .unwrap();
        assert_eq!(routing_hash.as_slice(), proof.mention_routing_sha256);
        assert_eq!(
            verify_decrypted_mentions(
                "hello Bob",
                &mentions,
                &[9; 32],
                Some(&routing),
                "private Comment",
            )
            .unwrap(),
            mentions,
        );
    }

    #[test]
    fn decrypted_mention_tampering_fails_closed() {
        let (session, _, plan, payload, _) = fixture();
        let mentions = canonical_private_mentions(
            "hello Bob",
            &[PrivateMentionIntent {
                actor_ptid: "ptid:bob".to_string(),
                offset: 6,
                length: 3,
                display: "Bob".to_string(),
            }],
            "private Comment",
        )
        .unwrap();
        let routing = build_signed_mention_routing(
            &mentions,
            Some(&[9; 32]),
            &plan,
            &payload,
            &session,
            "private Comment",
        )
        .unwrap()
        .unwrap();
        let mut tampered = mentions;
        tampered[0].display = "Eve".to_string();

        assert!(verify_decrypted_mentions(
            "hello Eve",
            &tampered,
            &[9; 32],
            Some(&routing),
            "private Comment",
        )
        .is_err());
    }
}
