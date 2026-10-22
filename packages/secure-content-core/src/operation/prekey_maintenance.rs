use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::codec::CanonicalMessageEncoder;
use crate::ports::{ContentKeyMaterial, OperationClock};
use crate::prekey::{
    canonicalize_proof_free_publish_content_prekeys_request,
    canonicalize_publish_content_prekeys_request, ContentPreKeyActorRef, ContentPreKeyEndpoint,
    ContentPreKeyKind, ContentPreKeyPair, ContentPreKeyPrincipal, ContentPreKeySigningInput,
    CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
};
use crate::recovery::derive_recovery_prekey;

use super::outcome::{OperationErrorCode, OperationFailure, OperationOutcome};
use super::state::{OperationCompletion, OperationKind, OperationRecord, OperationState};

pub const CONTENT_PREKEY_PUBLICATION_COMMAND_PREFIX: &str = "cpk-pub-v1-";
pub const MAX_CONTENT_PREKEY_PUBLICATION_COUNT: u32 = 100;
pub const MAX_CONTENT_PREKEY_RETRY_DELAY_MS: u64 = 300_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentPreKeyPoolKind {
    Endpoint,
    ActorRecovery,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentPreKeyInventory {
    pub current_epoch: u64,
    pub available: u32,
    pub capacity: u32,
    pub needs_replenishment: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentPreKeyPublicationPlan {
    pub kind: ContentPreKeyPoolKind,
    pub pool_epoch: u64,
    pub expected_pool_epoch: u64,
    pub count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentPreKeyMaintenancePlan {
    Ready { available: u32 },
    Publish(ContentPreKeyPublicationPlan),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContentPreKeyPublishDisposition {
    Committed,
    Retryable {
        retry_after_ms: Option<u64>,
        detail: String,
    },
    UnknownOutcome {
        detail: String,
    },
    AuthorizationRejected {
        code: String,
        detail: String,
    },
    Rejected {
        code: String,
        detail: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentPreKeyPublishClassification {
    pub completion: OperationCompletion,
    pub outcome: OperationOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentPreKeyPublisher {
    pub actor_ptid: String,
    pub device_id: String,
    pub signing_key_id: String,
    pub profile_version: u64,
}

pub struct PreparedEndpointContentPreKey {
    pub key_id: String,
    pub private_key: [u8; 32],
    pub public_key: [u8; 32],
}

impl Drop for PreparedEndpointContentPreKey {
    fn drop(&mut self) {
        self.private_key.zeroize();
    }
}

pub struct PreparedContentPreKeyPublication {
    pub operation: OperationRecord,
    pub kind: ContentPreKeyPoolKind,
    pub pool_epoch: u64,
    pub proof_free_request_bytes: Vec<u8>,
    pub endpoint_keys: Vec<PreparedEndpointContentPreKey>,
}

pub trait ContentPreKeyIdSource {
    fn next_id(&mut self, kind: ContentPreKeyPoolKind) -> Result<String, OperationFailure>;
}

pub struct RandomContentPreKeyIdSource;

impl ContentPreKeyIdSource for RandomContentPreKeyIdSource {
    fn next_id(&mut self, kind: ContentPreKeyPoolKind) -> Result<String, OperationFailure> {
        let mut random = [0_u8; 16];
        OsRng.fill_bytes(&mut random);
        let prefix = match kind {
            ContentPreKeyPoolKind::Endpoint => "content-endpoint",
            ContentPreKeyPoolKind::ActorRecovery => "content-recovery",
        };
        Ok(format!("{prefix}-{}", hex(&random)))
    }
}

pub fn plan_content_prekey_maintenance(
    kind: ContentPreKeyPoolKind,
    inventory: Option<ContentPreKeyInventory>,
    publisher_profile_version: u64,
    latest_recovery_epoch: Option<u64>,
) -> Result<ContentPreKeyMaintenancePlan, OperationFailure> {
    if publisher_profile_version == 0 {
        return Err(invalid_plan(
            "Content PreKey publisher profile version is required",
        ));
    }
    if let Some(inventory) = inventory {
        if inventory.current_epoch == 0
            || inventory.capacity == 0
            || inventory.capacity > MAX_CONTENT_PREKEY_PUBLICATION_COUNT
            || inventory.available > inventory.capacity
        {
            return Err(invalid_plan("Content PreKey inventory is invalid"));
        }
    }

    let expected_pool_epoch = inventory.map_or(0, |value| value.current_epoch);
    let rotation_pending = match kind {
        ContentPreKeyPoolKind::Endpoint => publisher_profile_version != expected_pool_epoch,
        ContentPreKeyPoolKind::ActorRecovery => {
            latest_recovery_epoch.is_some_and(|epoch| epoch > expected_pool_epoch)
        }
    };
    if let Some(inventory) = inventory {
        if !inventory.needs_replenishment && !rotation_pending {
            return Ok(ContentPreKeyMaintenancePlan::Ready {
                available: inventory.available,
            });
        }
    }

    let pool_epoch = match kind {
        ContentPreKeyPoolKind::Endpoint => publisher_profile_version,
        ContentPreKeyPoolKind::ActorRecovery => {
            let latest_recovery_epoch = latest_recovery_epoch.ok_or_else(|| {
                OperationFailure::terminal(
                    OperationErrorCode::KeyMaterialUnavailable,
                    "Content PreKey recovery master is unavailable",
                )
            })?;
            if latest_recovery_epoch == 0 {
                return Err(invalid_plan(
                    "Content PreKey recovery epoch must be positive",
                ));
            }
            if expected_pool_epoch == 0 {
                1
            } else if latest_recovery_epoch > expected_pool_epoch {
                expected_pool_epoch
                    .checked_add(1)
                    .ok_or_else(|| invalid_plan("Content PreKey recovery epoch is exhausted"))?
            } else {
                expected_pool_epoch
            }
        }
    };
    if pool_epoch == 0 {
        return Err(invalid_plan("Content PreKey pool epoch is invalid"));
    }

    let capacity = inventory.map_or(MAX_CONTENT_PREKEY_PUBLICATION_COUNT, |value| value.capacity);
    let available = inventory.map_or(0, |value| value.available);
    let count = if pool_epoch != expected_pool_epoch {
        capacity
    } else {
        capacity.saturating_sub(available)
    }
    .clamp(1, MAX_CONTENT_PREKEY_PUBLICATION_COUNT);

    Ok(ContentPreKeyMaintenancePlan::Publish(
        ContentPreKeyPublicationPlan {
            kind,
            pool_epoch,
            expected_pool_epoch,
            count,
        },
    ))
}

pub fn content_prekey_publication_command_id(
    proof_free_request_bytes: &[u8],
) -> Result<String, OperationFailure> {
    let canonical = canonicalize_proof_free_publish_content_prekeys_request(
        proof_free_request_bytes,
    )
    .map_err(|error| {
        OperationFailure::terminal(
            OperationErrorCode::InvalidRecord,
            format!("canonicalize proof-free Content PreKey publication: {error}"),
        )
    })?;
    Ok(format!(
        "{CONTENT_PREKEY_PUBLICATION_COMMAND_PREFIX}{}",
        hex(&Sha256::digest(canonical)),
    ))
}

pub fn classify_content_prekey_publish(
    disposition: ContentPreKeyPublishDisposition,
    reconciles_unknown_outcome: bool,
    clock: &dyn OperationClock,
    default_retry_delay_ms: u64,
) -> Result<ContentPreKeyPublishClassification, OperationFailure> {
    let now_unix_ms = clock.now_unix_ms();
    if now_unix_ms <= 0
        || default_retry_delay_ms == 0
        || default_retry_delay_ms > MAX_CONTENT_PREKEY_RETRY_DELAY_MS
    {
        return Err(invalid_plan(
            "Content PreKey publication retry policy is invalid",
        ));
    }
    Ok(match disposition {
        ContentPreKeyPublishDisposition::Committed => ContentPreKeyPublishClassification {
            completion: OperationCompletion::Committed,
            outcome: OperationOutcome::Committed {
                authoritative_readback: false,
            },
        },
        ContentPreKeyPublishDisposition::Retryable { retry_after_ms, .. } => {
            let delay = retry_after_ms
                .unwrap_or(default_retry_delay_ms)
                .clamp(1, MAX_CONTENT_PREKEY_RETRY_DELAY_MS);
            let delay = i64::try_from(delay).map_err(|_| {
                invalid_plan("Content PreKey publication retry delay exceeds clock range")
            })?;
            let next_attempt_at_unix_ms = now_unix_ms.checked_add(delay).ok_or_else(|| {
                invalid_plan("Content PreKey publication retry deadline is exhausted")
            })?;
            ContentPreKeyPublishClassification {
                completion: OperationCompletion::RetryAt(next_attempt_at_unix_ms),
                outcome: OperationOutcome::RetryScheduled {
                    next_attempt_at_unix_ms,
                },
            }
        }
        ContentPreKeyPublishDisposition::UnknownOutcome { .. } => {
            ContentPreKeyPublishClassification {
                completion: OperationCompletion::UnknownOutcome,
                outcome: OperationOutcome::UnknownOutcome,
            }
        }
        ContentPreKeyPublishDisposition::AuthorizationRejected { code, .. }
            if reconciles_unknown_outcome =>
        {
            validate_rejection_code(&code)?;
            ContentPreKeyPublishClassification {
                completion: OperationCompletion::UnknownOutcome,
                outcome: OperationOutcome::UnknownOutcome,
            }
        }
        ContentPreKeyPublishDisposition::AuthorizationRejected { code, .. }
        | ContentPreKeyPublishDisposition::Rejected { code, .. } => {
            validate_rejection_code(&code)?;
            ContentPreKeyPublishClassification {
                completion: OperationCompletion::Terminal,
                outcome: OperationOutcome::Rejected { code },
            }
        }
    })
}

pub fn prepare_content_prekey_publication(
    plan: ContentPreKeyPublicationPlan,
    publisher: &ContentPreKeyPublisher,
    key_material: &dyn ContentKeyMaterial,
    clock: &dyn OperationClock,
) -> Result<PreparedContentPreKeyPublication, OperationFailure> {
    prepare_content_prekey_publication_with_ids(
        plan,
        publisher,
        key_material,
        clock,
        &mut RandomContentPreKeyIdSource,
    )
}

pub fn prepare_content_prekey_publication_with_ids(
    plan: ContentPreKeyPublicationPlan,
    publisher: &ContentPreKeyPublisher,
    key_material: &dyn ContentKeyMaterial,
    clock: &dyn OperationClock,
    ids: &mut dyn ContentPreKeyIdSource,
) -> Result<PreparedContentPreKeyPublication, OperationFailure> {
    validate_publication_input(plan, publisher)?;
    let now_unix_ms = clock.now_unix_ms();
    if now_unix_ms <= 0 {
        return Err(invalid_plan("Content PreKey publication clock is invalid"));
    }

    let endpoint = ContentPreKeyEndpoint::new(&publisher.actor_ptid, &publisher.device_id);
    let recovery_master = match plan.kind {
        ContentPreKeyPoolKind::Endpoint => None,
        ContentPreKeyPoolKind::ActorRecovery => Some(
            key_material
                .recovery_master(&publisher.actor_ptid, plan.pool_epoch)?
                .ok_or_else(|| {
                    OperationFailure::terminal(
                        OperationErrorCode::KeyMaterialUnavailable,
                        "Content PreKey recovery master is unavailable",
                    )
                })?,
        ),
    };
    let mut generated = Vec::with_capacity(plan.count as usize);
    for _ in 0..plan.count {
        let key_id = ids.next_id(plan.kind)?;
        let pair = match recovery_master.as_ref() {
            Some(master) => {
                derive_recovery_prekey(master, &publisher.actor_ptid, plan.pool_epoch, &key_id)
                    .map_err(|detail| {
                        OperationFailure::terminal(OperationErrorCode::IntegrityFailed, detail)
                    })?
            }
            None => ContentPreKeyPair::generate(),
        };
        generated.push((key_id, pair));
    }
    generated.sort_by(|left, right| left.0.cmp(&right.0));
    if generated.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(invalid_plan(
            "Content PreKey publication generated a duplicate key identity",
        ));
    }

    let mut encoded_prekeys = Vec::with_capacity(generated.len());
    let mut endpoint_keys = Vec::with_capacity(match plan.kind {
        ContentPreKeyPoolKind::Endpoint => generated.len(),
        ContentPreKeyPoolKind::ActorRecovery => 0,
    });
    for (key_id, pair) in generated {
        let (kind, principal) = match plan.kind {
            ContentPreKeyPoolKind::Endpoint => (
                ContentPreKeyKind::Endpoint,
                ContentPreKeyPrincipal::Endpoint(endpoint.clone()),
            ),
            ContentPreKeyPoolKind::ActorRecovery => (
                ContentPreKeyKind::ActorRecovery,
                ContentPreKeyPrincipal::RecoveryActor(ContentPreKeyActorRef::new(
                    &publisher.actor_ptid,
                )),
            ),
        };
        let signing_input = ContentPreKeySigningInput {
            format_version: CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
            kind,
            key_id: key_id.clone(),
            x25519_public_key: pair.public(),
            principal: principal.clone(),
            pool_epoch: plan.pool_epoch,
            expected_pool_epoch: plan.expected_pool_epoch,
            publisher: endpoint.clone(),
            publisher_signing_key_id: publisher.signing_key_id.clone(),
            publisher_profile_version: publisher.profile_version,
        };
        let signature = key_material.sign_device_payload(
            &signing_input
                .signing_bytes()
                .map_err(|detail| invalid_plan(detail.to_string()))?,
        )?;
        if signature.len() != 64 {
            return Err(OperationFailure::terminal(
                OperationErrorCode::KeyMaterialUnavailable,
                "Content PreKey device signature has an invalid length",
            ));
        }
        encoded_prekeys.push(encode_content_prekey(
            kind,
            &key_id,
            pair.public().as_bytes(),
            &principal,
            plan.pool_epoch,
            &signature,
        )?);
        if plan.kind == ContentPreKeyPoolKind::Endpoint {
            endpoint_keys.push(PreparedEndpointContentPreKey {
                key_id,
                private_key: pair.private().to_bytes(),
                public_key: *pair.public().as_bytes(),
            });
        }
    }

    let command_payload =
        encode_publication_request(publisher, plan.expected_pool_epoch, &encoded_prekeys, None)?;
    let command_id = content_prekey_publication_command_id(&command_payload)?;
    let proof_free_request_bytes = encode_publication_request(
        publisher,
        plan.expected_pool_epoch,
        &encoded_prekeys,
        Some(&command_id),
    )?;
    let operation = OperationRecord::new(
        &command_id,
        &command_id,
        OperationKind::ContentPreKeyPublication,
        OperationState::Pending,
        &proof_free_request_bytes,
        now_unix_ms,
    )?;
    Ok(PreparedContentPreKeyPublication {
        operation,
        kind: plan.kind,
        pool_epoch: plan.pool_epoch,
        proof_free_request_bytes,
        endpoint_keys,
    })
}

fn validate_publication_input(
    plan: ContentPreKeyPublicationPlan,
    publisher: &ContentPreKeyPublisher,
) -> Result<(), OperationFailure> {
    if plan.count == 0
        || plan.count > MAX_CONTENT_PREKEY_PUBLICATION_COUNT
        || plan.pool_epoch == 0
        || plan.expected_pool_epoch > plan.pool_epoch
        || publisher.actor_ptid.trim().is_empty()
        || publisher.actor_ptid.trim() != publisher.actor_ptid
        || publisher.device_id.trim().is_empty()
        || publisher.device_id.trim() != publisher.device_id
        || publisher.signing_key_id.trim().is_empty()
        || publisher.signing_key_id.trim() != publisher.signing_key_id
        || publisher.profile_version == 0
    {
        return Err(invalid_plan("Content PreKey publication input is invalid"));
    }
    if plan.kind == ContentPreKeyPoolKind::Endpoint && plan.pool_epoch != publisher.profile_version
    {
        return Err(invalid_plan(
            "Content PreKey endpoint epoch does not match the publisher profile",
        ));
    }
    Ok(())
}

fn encode_content_prekey(
    kind: ContentPreKeyKind,
    key_id: &str,
    public_key: &[u8; 32],
    principal: &ContentPreKeyPrincipal,
    pool_epoch: u64,
    signature: &[u8],
) -> Result<Vec<u8>, OperationFailure> {
    let mut prekey = CanonicalMessageEncoder::new();
    prekey
        .singular_varint(1, kind as u64)
        .map_err(canonical_failure)?;
    prekey
        .singular_bytes(2, key_id.as_bytes())
        .map_err(canonical_failure)?;
    prekey
        .singular_bytes(3, public_key)
        .map_err(canonical_failure)?;
    match principal {
        ContentPreKeyPrincipal::Endpoint(endpoint) => prekey
            .oneof_message(4, 1, &encode_endpoint(endpoint)?)
            .map_err(canonical_failure)?,
        ContentPreKeyPrincipal::RecoveryActor(actor) => prekey
            .oneof_message(5, 1, &encode_actor(actor)?)
            .map_err(canonical_failure)?,
    }
    prekey
        .singular_varint(6, pool_epoch)
        .map_err(canonical_failure)?;
    prekey
        .singular_bytes(7, signature)
        .map_err(canonical_failure)?;
    canonicalize_prekey(prekey.finish())
}

fn encode_publication_request(
    publisher: &ContentPreKeyPublisher,
    expected_pool_epoch: u64,
    prekeys: &[Vec<u8>],
    command_id: Option<&str>,
) -> Result<Vec<u8>, OperationFailure> {
    let endpoint = ContentPreKeyEndpoint::new(&publisher.actor_ptid, &publisher.device_id);
    let mut request = CanonicalMessageEncoder::new();
    request
        .singular_message(1, &encode_endpoint(&endpoint)?)
        .map_err(canonical_failure)?;
    request
        .singular_bytes(2, publisher.signing_key_id.as_bytes())
        .map_err(canonical_failure)?;
    request
        .singular_varint(3, publisher.profile_version)
        .map_err(canonical_failure)?;
    request
        .singular_varint(4, expected_pool_epoch)
        .map_err(canonical_failure)?;
    for prekey in prekeys {
        request
            .repeated_bytes(5, prekey)
            .map_err(canonical_failure)?;
    }
    if let Some(command_id) = command_id {
        request
            .singular_bytes(6, command_id.as_bytes())
            .map_err(canonical_failure)?;
    }
    let encoded = request.finish();
    if command_id.is_some() {
        canonicalize_publish_content_prekeys_request(&encoded).map_err(canonical_failure)
    } else {
        canonicalize_proof_free_publish_content_prekeys_request(&encoded).map_err(canonical_failure)
    }
}

fn encode_actor(actor: &ContentPreKeyActorRef) -> Result<Vec<u8>, OperationFailure> {
    let mut encoded = CanonicalMessageEncoder::new();
    encoded
        .singular_bytes(2, actor.ptid.as_bytes())
        .map_err(canonical_failure)?;
    Ok(encoded.finish())
}

fn encode_endpoint(endpoint: &ContentPreKeyEndpoint) -> Result<Vec<u8>, OperationFailure> {
    let mut encoded = CanonicalMessageEncoder::new();
    encoded
        .singular_message(1, &encode_actor(&endpoint.actor)?)
        .map_err(canonical_failure)?;
    encoded
        .singular_bytes(2, endpoint.device_id.as_bytes())
        .map_err(canonical_failure)?;
    Ok(encoded.finish())
}

fn canonicalize_prekey(encoded: Vec<u8>) -> Result<Vec<u8>, OperationFailure> {
    let mut request = CanonicalMessageEncoder::new();
    request
        .singular_message(1, &encode_endpoint(&ContentPreKeyEndpoint::new("p", "d"))?)
        .map_err(canonical_failure)?;
    request.singular_bytes(2, b"k").map_err(canonical_failure)?;
    request.singular_varint(3, 1).map_err(canonical_failure)?;
    request
        .repeated_bytes(5, &encoded)
        .map_err(canonical_failure)?;
    let wrapped = canonicalize_proof_free_publish_content_prekeys_request(&request.finish())
        .map_err(canonical_failure)?;
    extract_length_delimited_field(&wrapped, 5)
}

fn extract_length_delimited_field(
    encoded: &[u8],
    field_number: u8,
) -> Result<Vec<u8>, OperationFailure> {
    let key = field_number << 3 | 2;
    let start = encoded
        .iter()
        .position(|byte| *byte == key)
        .ok_or_else(|| invalid_plan("canonical Content PreKey field is missing"))?
        + 1;
    let (length, prefix) = decode_small_varint(&encoded[start..])?;
    let content_start = start + prefix;
    let content_end = content_start
        .checked_add(length)
        .filter(|end| *end <= encoded.len())
        .ok_or_else(|| invalid_plan("canonical Content PreKey field is truncated"))?;
    Ok(encoded[content_start..content_end].to_vec())
}

fn decode_small_varint(input: &[u8]) -> Result<(usize, usize), OperationFailure> {
    let mut value = 0_usize;
    for index in 0..10 {
        let byte = *input
            .get(index)
            .ok_or_else(|| invalid_plan("canonical Content PreKey length is truncated"))?;
        value |= usize::from(byte & 0x7f) << (index * 7);
        if byte & 0x80 == 0 {
            return Ok((value, index + 1));
        }
    }
    Err(invalid_plan("canonical Content PreKey length is invalid"))
}

fn validate_rejection_code(code: &str) -> Result<(), OperationFailure> {
    if code.trim().is_empty() || code.trim() != code {
        Err(invalid_plan(
            "Content PreKey publication rejection code is invalid",
        ))
    } else {
        Ok(())
    }
}

fn canonical_failure(detail: impl std::fmt::Display) -> OperationFailure {
    OperationFailure::terminal(OperationErrorCode::InvalidRecord, detail.to_string())
}

fn invalid_plan(detail: impl Into<String>) -> OperationFailure {
    OperationFailure::terminal(OperationErrorCode::InvalidRecord, detail)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBLISH_REQUEST_VECTOR: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../model/domain/secure_content/testdata/content_prekey_publication.hex"
    ));

    struct FixedClock(i64);

    impl OperationClock for FixedClock {
        fn now_unix_ms(&self) -> i64 {
            self.0
        }
    }

    #[test]
    fn endpoint_pool_rotates_to_the_publisher_profile_version() {
        let plan = plan_content_prekey_maintenance(
            ContentPreKeyPoolKind::Endpoint,
            Some(ContentPreKeyInventory {
                current_epoch: 6,
                available: 80,
                capacity: 100,
                needs_replenishment: false,
            }),
            7,
            None,
        )
        .unwrap();

        assert_eq!(
            plan,
            ContentPreKeyMaintenancePlan::Publish(ContentPreKeyPublicationPlan {
                kind: ContentPreKeyPoolKind::Endpoint,
                pool_epoch: 7,
                expected_pool_epoch: 6,
                count: 100,
            })
        );
    }

    #[test]
    fn recovery_pool_advances_one_epoch_at_a_time() {
        let plan = plan_content_prekey_maintenance(
            ContentPreKeyPoolKind::ActorRecovery,
            Some(ContentPreKeyInventory {
                current_epoch: 3,
                available: 50,
                capacity: 100,
                needs_replenishment: false,
            }),
            9,
            Some(7),
        )
        .unwrap();

        assert_eq!(
            plan,
            ContentPreKeyMaintenancePlan::Publish(ContentPreKeyPublicationPlan {
                kind: ContentPreKeyPoolKind::ActorRecovery,
                pool_epoch: 4,
                expected_pool_epoch: 3,
                count: 100,
            })
        );
    }

    #[test]
    fn healthy_pool_is_a_noop() {
        let plan = plan_content_prekey_maintenance(
            ContentPreKeyPoolKind::Endpoint,
            Some(ContentPreKeyInventory {
                current_epoch: 7,
                available: 90,
                capacity: 100,
                needs_replenishment: false,
            }),
            7,
            None,
        )
        .unwrap();

        assert_eq!(plan, ContentPreKeyMaintenancePlan::Ready { available: 90 },);
    }

    #[test]
    fn publication_identity_matches_the_shared_vector() {
        let mut request = decode_hex(PUBLISH_REQUEST_VECTOR);
        request.truncate(proof_free_request_length(&request));

        assert_eq!(
            content_prekey_publication_command_id(&request).unwrap(),
            "cpk-pub-v1-5ca0fee4658c8956feeca6d8a9272e70ce8c6127e41cd81a2961dbf1a4dd0d8c",
        );
    }

    #[test]
    fn command_identity_rejects_command_or_proof_fields() {
        let full_request = decode_hex(PUBLISH_REQUEST_VECTOR);
        assert!(content_prekey_publication_command_id(&full_request).is_err());
    }

    #[test]
    fn transport_disposition_has_one_core_owned_state_mapping() {
        let clock = FixedClock(10_000);
        assert_eq!(
            classify_content_prekey_publish(
                ContentPreKeyPublishDisposition::Committed,
                false,
                &clock,
                1_000,
            )
            .unwrap(),
            ContentPreKeyPublishClassification {
                completion: OperationCompletion::Committed,
                outcome: OperationOutcome::Committed {
                    authoritative_readback: false,
                },
            },
        );
        assert_eq!(
            classify_content_prekey_publish(
                ContentPreKeyPublishDisposition::Retryable {
                    retry_after_ms: Some(5_000),
                    detail: "overloaded".to_string(),
                },
                false,
                &clock,
                1_000,
            )
            .unwrap()
            .completion,
            OperationCompletion::RetryAt(15_000),
        );
        assert_eq!(
            classify_content_prekey_publish(
                ContentPreKeyPublishDisposition::UnknownOutcome {
                    detail: "response lost".to_string(),
                },
                false,
                &clock,
                1_000,
            )
            .unwrap()
            .completion,
            OperationCompletion::UnknownOutcome,
        );
        assert_eq!(
            classify_content_prekey_publish(
                ContentPreKeyPublishDisposition::Rejected {
                    code: "CONTENT_PREKEY_STALE_EPOCH".to_string(),
                    detail: "stale".to_string(),
                },
                false,
                &clock,
                1_000,
            )
            .unwrap()
            .completion,
            OperationCompletion::Terminal,
        );
        assert_eq!(
            classify_content_prekey_publish(
                ContentPreKeyPublishDisposition::AuthorizationRejected {
                    code: "UNAUTHORIZED".to_string(),
                    detail: "session expired".to_string(),
                },
                true,
                &clock,
                1_000,
            )
            .unwrap()
            .completion,
            OperationCompletion::UnknownOutcome,
        );
    }

    struct DeterministicIds(u32);

    impl ContentPreKeyIdSource for DeterministicIds {
        fn next_id(&mut self, kind: ContentPreKeyPoolKind) -> Result<String, OperationFailure> {
            self.0 += 1;
            Ok(format!(
                "{}-{:04}",
                match kind {
                    ContentPreKeyPoolKind::Endpoint => "content-endpoint",
                    ContentPreKeyPoolKind::ActorRecovery => "content-recovery",
                },
                self.0
            ))
        }
    }

    struct FakeKeyMaterial {
        recovery: Option<crate::recovery::RecoveryMaster>,
    }

    impl ContentKeyMaterial for FakeKeyMaterial {
        fn recovery_master(
            &self,
            _actor_ptid: &str,
            _recovery_epoch: u64,
        ) -> Result<Option<crate::recovery::RecoveryMaster>, OperationFailure> {
            Ok(self
                .recovery
                .as_ref()
                .map(|master| crate::recovery::RecoveryMaster::from_bytes(master.to_bytes())))
        }

        fn sign_device_payload(&self, _payload: &[u8]) -> Result<Vec<u8>, OperationFailure> {
            Ok(vec![7; 64])
        }
    }

    #[test]
    fn publication_preparation_is_the_single_wire_and_operation_owner() {
        let publisher = ContentPreKeyPublisher {
            actor_ptid: "ptid:alice".to_string(),
            device_id: "device-alice".to_string(),
            signing_key_id: "signing-key-1".to_string(),
            profile_version: 7,
        };
        let prepared = prepare_content_prekey_publication_with_ids(
            ContentPreKeyPublicationPlan {
                kind: ContentPreKeyPoolKind::Endpoint,
                pool_epoch: 7,
                expected_pool_epoch: 6,
                count: 2,
            },
            &publisher,
            &FakeKeyMaterial { recovery: None },
            &FixedClock(10_000),
            &mut DeterministicIds(0),
        )
        .unwrap();

        assert_eq!(prepared.operation.state, OperationState::Pending);
        assert_eq!(
            prepared.operation.kind,
            OperationKind::ContentPreKeyPublication
        );
        assert_eq!(prepared.endpoint_keys.len(), 2);
        assert_eq!(
            canonicalize_publish_content_prekeys_request(&prepared.proof_free_request_bytes)
                .unwrap(),
            prepared.proof_free_request_bytes,
        );
        let expected_sha256: [u8; 32] = Sha256::digest(&prepared.proof_free_request_bytes).into();
        assert_eq!(prepared.operation.command_sha256, expected_sha256,);
        assert_eq!(
            prepared.operation.command_id,
            content_prekey_publication_command_id(&strip_command_id(
                &prepared.proof_free_request_bytes
            ))
            .unwrap(),
        );
    }

    fn strip_command_id(request: &[u8]) -> Vec<u8> {
        let command_tag = request
            .windows(CONTENT_PREKEY_PUBLICATION_COMMAND_PREFIX.len())
            .position(|window| window == CONTENT_PREKEY_PUBLICATION_COMMAND_PREFIX.as_bytes())
            .unwrap();
        request[..command_tag - 2].to_vec()
    }

    fn proof_free_request_length(request: &[u8]) -> usize {
        let command_tag = request
            .windows("command-test".len())
            .position(|window| window == b"command-test")
            .expect("tracked vector command ID");
        command_tag - 2
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        let value = value.trim();
        (0..value.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16).unwrap())
            .collect()
    }
}
