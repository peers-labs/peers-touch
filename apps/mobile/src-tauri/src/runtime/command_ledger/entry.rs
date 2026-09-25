use prost::Message;
use sha2::{Digest, Sha256};

use super::error::{LedgerError, LedgerErrorCode, LedgerResult};
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    mobile_durable_command_envelope_v2, MobileDurableCommandEnvelopeV2,
    MobileDurableCommandErrorCode, MobileDurableCommandState,
};
use crate::runtime::reliability_proto::peers_touch::model::social::v1::{
    FriendRequestAction, FriendRequestCommand, SocialRelationshipAction, SocialRelationshipCommand,
};

pub const SCHEMA_REVISION: u32 = 2;
pub const MAX_UNRESOLVED_COMMANDS: u64 = 512;
pub const MAX_PARTITION_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_PAYLOAD_BYTES: usize = 256 * 1024;
pub const MAX_ACTIVE_ORDERING_KEYS: u64 = 4;
pub const MAX_TRANSPORT_ATTEMPTS: u32 = 8;
pub const RETRY_BASE_DELAY_MS: u64 = 1_000;
pub const RETRY_MAX_DELAY_MS: u64 = 60_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandScope {
    pub station_peer_id: String,
    pub actor_ptid: String,
}

impl CommandScope {
    pub fn new(
        station_peer_id: impl Into<String>,
        actor_ptid: impl Into<String>,
    ) -> LedgerResult<Self> {
        let scope = Self {
            station_peer_id: station_peer_id.into(),
            actor_ptid: actor_ptid.into(),
        };
        validate_identifier("station_peer_id", &scope.station_peer_id)?;
        validate_identifier("actor_ptid", &scope.actor_ptid)?;
        Ok(scope)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeKeyMetadata {
    pub kek_id: String,
    pub install_epoch: Vec<u8>,
    pub command_key_id: String,
}

impl ScopeKeyMetadata {
    pub fn validate(&self) -> LedgerResult<()> {
        validate_identifier("kek_id", &self.kek_id)?;
        validate_identifier("command_key_id", &self.command_key_id)?;
        if self.install_epoch.len() < 16 {
            return Err(LedgerError::new(
                LedgerErrorCode::InvalidConfiguration,
                "validate scope key metadata",
                "install_epoch must contain at least 128 bits of random identity",
            ));
        }
        Ok(())
    }
}

pub struct TrustedCommandKey {
    bytes: [u8; 32],
    pub metadata: ScopeKeyMetadata,
}

impl TrustedCommandKey {
    pub fn new(bytes: [u8; 32], metadata: ScopeKeyMetadata) -> LedgerResult<Self> {
        metadata.validate()?;
        Ok(Self { bytes, metadata })
    }

    pub(crate) fn bytes(&self) -> &[u8; 32] {
        &self.bytes
    }
}

impl Drop for TrustedCommandKey {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.bytes.zeroize();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedCommand {
    pub envelope: MobileDurableCommandEnvelopeV2,
    pub encoded_envelope: Vec<u8>,
    pub payload_bytes: Vec<u8>,
}

impl ValidatedCommand {
    pub fn command_id(&self) -> &str {
        &self.envelope.command_id
    }

    pub fn state(&self) -> MobileDurableCommandState {
        MobileDurableCommandState::try_from(self.envelope.state).expect("validated command state")
    }

    pub fn payload_size(&self) -> usize {
        self.payload_bytes.len()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DispatchLease {
    pub envelope: MobileDurableCommandEnvelopeV2,
    pub exact_envelope_bytes: Vec<u8>,
    pub exact_payload_bytes: Vec<u8>,
    pub runtime_generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductCommandState {
    Pending,
    FailedRetryable,
    Committed,
    FailedTerminal,
    UnknownOutcome,
    Reconciling,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDecision {
    RetryAt(i64),
    Unresolved(MobileDurableCommandErrorCode),
}

pub fn decode_admission(
    encoded_envelope: &[u8],
    scope: &CommandScope,
    runtime_generation: u64,
) -> LedgerResult<ValidatedCommand> {
    let validated = decode_and_validate(encoded_envelope, scope)?;
    if validated.encoded_envelope != encoded_envelope {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode admission",
            validated.command_id(),
            "envelope bytes are not the canonical generated encoding",
        ));
    }
    let envelope = &validated.envelope;
    if envelope.origin_generation != runtime_generation {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode admission",
            validated.command_id(),
            "origin_generation does not match the active runtime generation",
        ));
    }
    if validated.state() != MobileDurableCommandState::Queued
        || envelope.attempt_count != 0
        || envelope.typed_last_error != MobileDurableCommandErrorCode::Unspecified as i32
        || envelope.dispatch_started_at.is_some()
        || envelope.next_attempt_at.is_some()
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode admission",
            validated.command_id(),
            "new commands must enter as an untouched queued envelope",
        ));
    }
    Ok(validated)
}

pub fn decode_persisted(
    encoded_envelope: &[u8],
    scope: &CommandScope,
) -> LedgerResult<ValidatedCommand> {
    decode_and_validate(encoded_envelope, scope)
}

pub fn encode_envelope(envelope: &MobileDurableCommandEnvelopeV2) -> Vec<u8> {
    envelope.encode_to_vec()
}

pub fn state_of(
    envelope: &MobileDurableCommandEnvelopeV2,
) -> LedgerResult<MobileDurableCommandState> {
    let state = MobileDurableCommandState::try_from(envelope.state).map_err(|_| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "read command state",
            &envelope.command_id,
            "generated command state is unknown",
        )
    })?;
    if state == MobileDurableCommandState::Unspecified {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "read command state",
            &envelope.command_id,
            "generated command state is unspecified",
        ));
    }
    Ok(state)
}

pub fn error_of(
    envelope: &MobileDurableCommandEnvelopeV2,
) -> LedgerResult<MobileDurableCommandErrorCode> {
    MobileDurableCommandErrorCode::try_from(envelope.typed_last_error).map_err(|_| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "read command error",
            &envelope.command_id,
            "generated typed_last_error is unknown",
        )
    })
}

pub fn allows_transition(
    current: MobileDurableCommandState,
    next: MobileDurableCommandState,
) -> bool {
    use MobileDurableCommandState as State;
    matches!(
        (current, next),
        (State::Queued, State::DispatchFenced)
            | (State::Queued, State::Cancelled)
            | (State::Queued, State::FailedTerminal)
            | (State::RetryWait, State::DispatchFenced)
            | (State::RetryWait, State::Cancelled)
            | (State::RetryWait, State::Unresolved)
            | (State::DispatchFenced, State::Submitting)
            | (State::DispatchFenced, State::UnknownOutcome)
            | (State::Submitting, State::AcceptedPending)
            | (State::Submitting, State::Committed)
            | (State::Submitting, State::FailedTerminal)
            | (State::Submitting, State::UnknownOutcome)
            | (State::Submitting, State::RetryWait)
            | (State::UnknownOutcome, State::Reconciling)
            | (State::Reconciling, State::AcceptedPending)
            | (State::Reconciling, State::Committed)
            | (State::Reconciling, State::FailedTerminal)
            | (State::Reconciling, State::RetryWait)
            | (State::Reconciling, State::Unresolved)
            | (State::Unresolved, State::Reconciling)
            | (State::Unresolved, State::Discarded)
            | (State::AcceptedPending, State::Committed)
            | (State::AcceptedPending, State::FailedTerminal)
            | (State::AcceptedPending, State::Checkpointing)
            | (State::Committed, State::Checkpointing)
            | (State::FailedTerminal, State::Acknowledged)
    )
}

pub fn product_state(state: MobileDurableCommandState) -> ProductCommandState {
    use MobileDurableCommandState as State;
    match state {
        State::Queued
        | State::DispatchFenced
        | State::Submitting
        | State::AcceptedPending
        | State::Checkpointing => ProductCommandState::Pending,
        State::RetryWait => ProductCommandState::FailedRetryable,
        State::Committed => ProductCommandState::Committed,
        State::FailedTerminal | State::Acknowledged => ProductCommandState::FailedTerminal,
        State::UnknownOutcome | State::Unresolved => ProductCommandState::UnknownOutcome,
        State::Reconciling => ProductCommandState::Reconciling,
        State::Cancelled | State::Discarded | State::Unspecified => ProductCommandState::Cancelled,
    }
}

pub fn retry_decision(
    attempt_count: u32,
    expires_at_ms: i64,
    now_ms: i64,
    entropy: u64,
) -> RetryDecision {
    if now_ms >= expires_at_ms {
        return RetryDecision::Unresolved(MobileDurableCommandErrorCode::DomainExpired);
    }
    if attempt_count >= MAX_TRANSPORT_ATTEMPTS {
        return RetryDecision::Unresolved(MobileDurableCommandErrorCode::AttemptExhausted);
    }
    RetryDecision::RetryAt(
        now_ms.saturating_add(full_jitter_delay_ms(attempt_count, entropy) as i64),
    )
}

pub fn full_jitter_delay_ms(attempt_count: u32, entropy: u64) -> u64 {
    let exponent = attempt_count.saturating_sub(1).min(31);
    let ceiling = RETRY_BASE_DELAY_MS
        .saturating_mul(1_u64 << exponent)
        .min(RETRY_MAX_DELAY_MS);
    entropy % (ceiling + 1)
}

pub fn timestamp_to_millis(
    timestamp: Option<&prost_types::Timestamp>,
    field: &'static str,
    command_id: &str,
) -> LedgerResult<i64> {
    let timestamp = timestamp.ok_or_else(|| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate command timestamp",
            command_id,
            format!("{field} is required"),
        )
    })?;
    if timestamp.seconds < 0 || !(0..1_000_000_000).contains(&timestamp.nanos) {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate command timestamp",
            command_id,
            format!("{field} is outside the supported timestamp range"),
        ));
    }
    timestamp
        .seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(timestamp.nanos) / 1_000_000))
        .ok_or_else(|| {
            LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "validate command timestamp",
                command_id,
                format!("{field} overflows milliseconds"),
            )
        })
}

pub fn millis_to_timestamp(milliseconds: i64) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: milliseconds.div_euclid(1_000),
        nanos: (milliseconds.rem_euclid(1_000) * 1_000_000) as i32,
    }
}

fn decode_and_validate(
    encoded_envelope: &[u8],
    scope: &CommandScope,
) -> LedgerResult<ValidatedCommand> {
    let envelope = MobileDurableCommandEnvelopeV2::decode(encoded_envelope).map_err(|error| {
        LedgerError::new(
            LedgerErrorCode::Serialization,
            "decode generated command envelope",
            error.to_string(),
        )
    })?;
    validate_identifier("command_id", &envelope.command_id)?;
    validate_identifier("ordering_key", &envelope.ordering_key)?;
    validate_identifier("station_peer_id", &envelope.station_peer_id)?;
    validate_identifier("actor_ptid", &envelope.actor_ptid)?;
    if envelope.schema_revision != SCHEMA_REVISION {
        return Err(LedgerError::for_command(
            LedgerErrorCode::SchemaMismatch,
            "validate generated command envelope",
            &envelope.command_id,
            "unsupported reliability schema revision",
        ));
    }
    if envelope.station_peer_id != scope.station_peer_id || envelope.actor_ptid != scope.actor_ptid
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidScope,
            "validate generated command envelope",
            &envelope.command_id,
            "command scope does not match the activated Station/PTID partition",
        ));
    }
    state_of(&envelope)?;
    error_of(&envelope)?;

    let created_at_ms = timestamp_to_millis(
        envelope.created_at.as_ref(),
        "created_at",
        &envelope.command_id,
    )?;
    let updated_at_ms = timestamp_to_millis(
        envelope.updated_at.as_ref(),
        "updated_at",
        &envelope.command_id,
    )?;
    let expires_at_ms = timestamp_to_millis(
        envelope.expires_at.as_ref(),
        "expires_at",
        &envelope.command_id,
    )?;
    if updated_at_ms < created_at_ms || expires_at_ms <= created_at_ms {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate generated command envelope",
            &envelope.command_id,
            "command timestamps are not monotonic",
        ));
    }
    if let Some(timestamp) = envelope.dispatch_started_at.as_ref() {
        timestamp_to_millis(Some(timestamp), "dispatch_started_at", &envelope.command_id)?;
    }
    if let Some(timestamp) = envelope.next_attempt_at.as_ref() {
        timestamp_to_millis(Some(timestamp), "next_attempt_at", &envelope.command_id)?;
    }

    let payload_bytes = match envelope.payload.as_ref() {
        Some(mobile_durable_command_envelope_v2::Payload::FriendRequest(command)) => {
            validate_friend_request(command, &envelope, scope)?;
            command.encode_to_vec()
        }
        Some(mobile_durable_command_envelope_v2::Payload::SocialRelationship(command)) => {
            validate_social_relationship(command, &envelope, scope)?;
            command.encode_to_vec()
        }
        None => {
            return Err(LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "validate generated command envelope",
                &envelope.command_id,
                "generated command payload is required",
            ));
        }
    };
    if payload_bytes.len() > MAX_PAYLOAD_BYTES {
        return Err(LedgerError::for_command(
            LedgerErrorCode::PayloadTooLarge,
            "validate generated command envelope",
            &envelope.command_id,
            "serialized generated payload exceeds 256 KiB",
        ));
    }
    let actual_hash = Sha256::digest(&payload_bytes);
    if envelope.payload_sha256.as_slice() != actual_hash.as_slice() {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate generated command envelope",
            &envelope.command_id,
            "payload_sha256 does not match the exact generated payload bytes",
        ));
    }

    Ok(ValidatedCommand {
        encoded_envelope: envelope.encode_to_vec(),
        envelope,
        payload_bytes,
    })
}

fn validate_social_relationship(
    command: &SocialRelationshipCommand,
    envelope: &MobileDurableCommandEnvelopeV2,
    scope: &CommandScope,
) -> LedgerResult<()> {
    let body = command.body.as_ref().ok_or_else(|| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Social relationship command",
            &envelope.command_id,
            "Social relationship body is required",
        )
    })?;
    if body.command_id != envelope.command_id {
        return Err(LedgerError::for_command(
            LedgerErrorCode::CommandConflict,
            "validate Social relationship command",
            &envelope.command_id,
            "outer and domain command IDs differ",
        ));
    }
    if body.created_at != envelope.created_at || body.expires_at != envelope.expires_at {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Social relationship command",
            &envelope.command_id,
            "outer timestamps do not match the signed domain command",
        ));
    }
    validate_identifier("signing_key_id", &command.signing_key_id)?;
    if command.actor_device_signature.len() != 64 {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Social relationship command",
            &envelope.command_id,
            "actor-device signature must be an Ed25519 signature",
        ));
    }
    let action = SocialRelationshipAction::try_from(body.action).map_err(|_| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Social relationship command",
            &envelope.command_id,
            "Social relationship action is unknown",
        )
    })?;
    if !matches!(
        action,
        SocialRelationshipAction::Block | SocialRelationshipAction::Unblock
    ) {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Social relationship command",
            &envelope.command_id,
            "Social relationship action is unspecified",
        ));
    }
    let actor_ptid = body
        .actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .unwrap_or("");
    let device_ptid = body
        .authorizing_device
        .as_ref()
        .and_then(|device| device.actor.as_ref())
        .map(|actor| actor.ptid.as_str())
        .unwrap_or("");
    let target_ptid = body
        .target_actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .unwrap_or("");
    if actor_ptid != scope.actor_ptid
        || device_ptid != scope.actor_ptid
        || body.actor_home_station_peer_id != scope.station_peer_id
        || target_ptid.is_empty()
        || target_ptid == scope.actor_ptid
        || body.target_home_station_peer_id.trim().is_empty()
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidScope,
            "validate Social relationship command",
            &envelope.command_id,
            "signed command authority or target does not match the exact scope",
        ));
    }
    if body
        .authorizing_device
        .as_ref()
        .map(|device| device.device_id.trim().is_empty())
        .unwrap_or(true)
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Social relationship command",
            &envelope.command_id,
            "authorizing device is required",
        ));
    }
    Ok(())
}

fn validate_friend_request(
    command: &FriendRequestCommand,
    envelope: &MobileDurableCommandEnvelopeV2,
    scope: &CommandScope,
) -> LedgerResult<()> {
    let body = command.body.as_ref().ok_or_else(|| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Friend Request command",
            &envelope.command_id,
            "Friend Request body is required",
        )
    })?;
    if body.command_id != envelope.command_id {
        return Err(LedgerError::for_command(
            LedgerErrorCode::CommandConflict,
            "validate Friend Request command",
            &envelope.command_id,
            "outer and domain command IDs differ",
        ));
    }
    if body.created_at != envelope.created_at || body.expires_at != envelope.expires_at {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Friend Request command",
            &envelope.command_id,
            "outer timestamps do not match the signed domain command",
        ));
    }
    validate_identifier("signing_key_id", &command.signing_key_id)?;
    if command.actor_device_signature.len() != 64 {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Friend Request command",
            &envelope.command_id,
            "actor-device signature must be an Ed25519 signature",
        ));
    }

    let action = FriendRequestAction::try_from(body.action).map_err(|_| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Friend Request command",
            &envelope.command_id,
            "Friend Request action is unknown",
        )
    })?;
    let (authorizing_actor, source_station) = match action {
        FriendRequestAction::Send => (
            body.sender.as_ref(),
            body.sender_home_station_peer_id.as_str(),
        ),
        FriendRequestAction::Accept | FriendRequestAction::Reject => (
            body.receiver.as_ref(),
            body.receiver_home_station_peer_id.as_str(),
        ),
        FriendRequestAction::Unspecified => {
            return Err(LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "validate Friend Request command",
                &envelope.command_id,
                "Friend Request action is unspecified",
            ));
        }
    };
    let authorizing_ptid = authorizing_actor
        .map(|actor| actor.ptid.as_str())
        .unwrap_or("");
    let device_ptid = body
        .authorizing_device
        .as_ref()
        .and_then(|device| device.actor.as_ref())
        .map(|actor| actor.ptid.as_str())
        .unwrap_or("");
    if authorizing_ptid != scope.actor_ptid
        || device_ptid != scope.actor_ptid
        || source_station != scope.station_peer_id
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidScope,
            "validate Friend Request command",
            &envelope.command_id,
            "signed command authority does not match the exact Station/PTID scope",
        ));
    }
    if body
        .authorizing_device
        .as_ref()
        .map(|device| device.device_id.trim().is_empty())
        .unwrap_or(true)
    {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "validate Friend Request command",
            &envelope.command_id,
            "authorizing device is required",
        ));
    }
    Ok(())
}

fn validate_identifier(field: &'static str, value: &str) -> LedgerResult<()> {
    if value.is_empty() || value.trim() != value {
        return Err(LedgerError::new(
            LedgerErrorCode::InvalidEnvelope,
            "validate command identifier",
            format!("{field} must be non-empty and canonical"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_machine_contains_every_accepted_transition() {
        use MobileDurableCommandState as State;
        for transition in [
            (State::Queued, State::DispatchFenced),
            (State::Queued, State::Cancelled),
            (State::Queued, State::FailedTerminal),
            (State::RetryWait, State::DispatchFenced),
            (State::RetryWait, State::Cancelled),
            (State::RetryWait, State::Unresolved),
            (State::DispatchFenced, State::Submitting),
            (State::DispatchFenced, State::UnknownOutcome),
            (State::Submitting, State::AcceptedPending),
            (State::Submitting, State::Committed),
            (State::Submitting, State::FailedTerminal),
            (State::Submitting, State::UnknownOutcome),
            (State::Submitting, State::RetryWait),
            (State::UnknownOutcome, State::Reconciling),
            (State::Reconciling, State::AcceptedPending),
            (State::Reconciling, State::Committed),
            (State::Reconciling, State::FailedTerminal),
            (State::Reconciling, State::RetryWait),
            (State::Reconciling, State::Unresolved),
            (State::Unresolved, State::Reconciling),
            (State::Unresolved, State::Discarded),
            (State::AcceptedPending, State::Committed),
            (State::AcceptedPending, State::FailedTerminal),
            (State::AcceptedPending, State::Checkpointing),
            (State::Committed, State::Checkpointing),
            (State::FailedTerminal, State::Acknowledged),
        ] {
            assert!(allows_transition(transition.0, transition.1));
        }
        assert!(!allows_transition(State::DispatchFenced, State::Cancelled));
        assert!(!allows_transition(
            State::UnknownOutcome,
            State::DispatchFenced
        ));
        assert!(!allows_transition(State::Committed, State::Queued));
    }

    #[test]
    fn retry_jitter_stays_within_exponential_and_global_bounds() {
        assert_eq!(full_jitter_delay_ms(1, 1_001), 0);
        assert_eq!(full_jitter_delay_ms(1, 1_000), 1_000);
        assert!(full_jitter_delay_ms(2, u64::MAX) <= 2_000);
        assert!(full_jitter_delay_ms(7, u64::MAX) <= RETRY_MAX_DELAY_MS);
        assert!(full_jitter_delay_ms(32, u64::MAX) <= RETRY_MAX_DELAY_MS);
    }

    #[test]
    fn retry_ceiling_and_domain_expiry_are_terminal_for_automatic_replay() {
        assert_eq!(
            retry_decision(MAX_TRANSPORT_ATTEMPTS, 10_000, 1_000, 7),
            RetryDecision::Unresolved(MobileDurableCommandErrorCode::AttemptExhausted)
        );
        assert_eq!(
            retry_decision(1, 1_000, 1_000, 7),
            RetryDecision::Unresolved(MobileDurableCommandErrorCode::DomainExpired)
        );
        assert!(matches!(
            retry_decision(1, 10_000, 1_000, 7),
            RetryDecision::RetryAt(value) if (1_000..=2_000).contains(&value)
        ));
    }
}
