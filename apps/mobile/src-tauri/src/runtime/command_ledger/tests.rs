use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};
use std::thread;

use prost::Message;
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::*;
use crate::runtime::reliability_proto::peers_touch::model::actor::v1::{
    ActorDeviceRef, ActorKind, ActorRef,
};
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    mobile_durable_command_envelope_v2, MobileDurableCommandErrorCode, MobileDurableCommandState,
};
use crate::runtime::reliability_proto::peers_touch::model::social::v1::{
    FriendRequestAction, FriendRequestCommand, FriendRequestCommandBody,
    FriendRequestCommandLookupState, FriendRequestCommandResult, FriendRequestCommandResultKind,
    FriendRequestState, LookupFriendRequestCommandResultResponse,
};

const NOW_MS: i64 = 1_800_000_000_000;
const GENERATION: u64 = 41;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let mut suffix = [0_u8; 8];
        rand::rngs::OsRng.fill_bytes(&mut suffix);
        let path = std::env::temp_dir().join(format!(
            "peers-command-ledger-{}",
            u64::from_be_bytes(suffix)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn scope() -> CommandScope {
    CommandScope::new("station-a", "ptid:alice").unwrap()
}

fn trusted_key(byte: u8, key_id: &str) -> TrustedCommandKey {
    TrustedCommandKey::new(
        [byte; 32],
        ScopeKeyMetadata {
            kek_id: "install-kek-1".to_string(),
            install_epoch: vec![3; 32],
            command_key_id: key_id.to_string(),
        },
    )
    .unwrap()
}

fn paths(directory: &Path) -> LedgerPaths {
    LedgerPaths {
        database_path: directory.join("station-a-alice-v2.db"),
        legacy_v1: None,
    }
}

fn activate(
    ledger: &CommandLedger,
    directory: &Path,
    scope: CommandScope,
    key: TrustedCommandKey,
    generation: u64,
) {
    ledger
        .activate(LedgerActivation {
            paths: paths(directory),
            scope,
            trusted_command_key: key,
            runtime_generation: generation,
            now_ms: NOW_MS,
        })
        .unwrap();
}

fn actor(ptid: &str) -> ActorRef {
    ActorRef {
        ptid: ptid.to_string(),
        acct: String::new(),
        kind: ActorKind::Person as i32,
    }
}

fn generated_envelope(
    command_id: &str,
    ordering_key: &str,
    generation: u64,
    message_length: usize,
) -> Vec<u8> {
    let created_at = entry::millis_to_timestamp(NOW_MS);
    let expires_at = entry::millis_to_timestamp(NOW_MS + 600_000);
    let sender = actor("ptid:alice");
    let command = FriendRequestCommand {
        body: Some(FriendRequestCommandBody {
            format_version: 1,
            command_id: command_id.to_string(),
            request_id: format!("request-{command_id}"),
            action: FriendRequestAction::Send as i32,
            sender: Some(sender.clone()),
            receiver: Some(actor("ptid:bob")),
            sender_home_station_peer_id: "station-a".to_string(),
            receiver_home_station_peer_id: "station-b".to_string(),
            message: "x".repeat(message_length),
            observed_request_state: FriendRequestState::Unspecified as i32,
            created_at: Some(created_at.clone()),
            expires_at: Some(expires_at.clone()),
            authorizing_device: Some(ActorDeviceRef {
                actor: Some(sender),
                device_id: "device-a".to_string(),
            }),
            federation_id: format!("federation-{command_id}"),
        }),
        signing_key_id: "signing-key-a".to_string(),
        actor_device_signature: vec![7; 64],
    };
    let payload_sha256 = Sha256::digest(command.encode_to_vec()).to_vec();
    MobileDurableCommandEnvelopeV2 {
        schema_revision: SCHEMA_REVISION,
        command_id: command_id.to_string(),
        station_peer_id: "station-a".to_string(),
        actor_ptid: "ptid:alice".to_string(),
        origin_generation: generation,
        ordering_key: ordering_key.to_string(),
        payload_sha256,
        created_at: Some(created_at.clone()),
        updated_at: Some(created_at),
        expires_at: Some(expires_at),
        attempt_count: 0,
        state: MobileDurableCommandState::Queued as i32,
        typed_last_error: MobileDurableCommandErrorCode::Unspecified as i32,
        dispatch_started_at: None,
        next_attempt_at: None,
        payload: Some(mobile_durable_command_envelope_v2::Payload::FriendRequest(
            command,
        )),
    }
    .encode_to_vec()
}

fn lookup_bytes(
    envelope: &MobileDurableCommandEnvelopeV2,
    state: FriendRequestCommandLookupState,
    result_kind: Option<FriendRequestCommandResultKind>,
) -> Vec<u8> {
    LookupFriendRequestCommandResultResponse {
        state: state as i32,
        command_id: envelope.command_id.clone(),
        command_payload_sha256: envelope.payload_sha256.clone(),
        terminal_result: result_kind.map(|kind| FriendRequestCommandResult {
            command_id: envelope.command_id.clone(),
            request_id: format!("request-{}", envelope.command_id),
            command_payload_sha256: envelope.payload_sha256.clone(),
            kind: kind as i32,
            event: None,
            error_code: 0,
            retryable: false,
        }),
    }
    .encode_to_vec()
}

fn admit(ledger: &CommandLedger, command_id: &str, ordering_key: &str) {
    assert_eq!(
        ledger
            .admit_generated_envelope(&generated_envelope(command_id, ordering_key, GENERATION, 0,))
            .unwrap(),
        AdmissionOutcome::Inserted
    );
}

#[test]
fn admission_keeps_one_generated_command_id_and_hash() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    let encoded = generated_envelope("command-1", "friend:ptid:bob", GENERATION, 0);
    assert_eq!(
        ledger.admit_generated_envelope(&encoded).unwrap(),
        AdmissionOutcome::Inserted
    );
    assert_eq!(
        ledger.admit_generated_envelope(&encoded).unwrap(),
        AdmissionOutcome::AlreadyPresent
    );
    let stored = ledger.get("command-1").unwrap().unwrap();
    let decoded = MobileDurableCommandEnvelopeV2::decode(encoded.as_slice()).unwrap();
    assert_eq!(stored.command_id, decoded.command_id);
    assert_eq!(stored.payload_sha256, decoded.payload_sha256);

    let conflicting = generated_envelope("command-1", "friend:ptid:bob", GENERATION, 1);
    assert_eq!(
        ledger
            .admit_generated_envelope(&conflicting)
            .unwrap_err()
            .code,
        LedgerErrorCode::CommandConflict
    );
}

#[test]
fn wrong_scope_metadata_and_key_fail_before_recovery_mutates_rows() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-1", "friend:ptid:bob");
    ledger.deactivate().unwrap();

    let wrong_scope = CommandLedger::new();
    let error = wrong_scope
        .activate(LedgerActivation {
            paths: paths(&directory.0),
            scope: CommandScope::new("station-a", "ptid:mallory").unwrap(),
            trusted_command_key: trusted_key(7, "command-key-1"),
            runtime_generation: GENERATION + 1,
            now_ms: NOW_MS + 1,
        })
        .unwrap_err();
    assert_eq!(error.code, LedgerErrorCode::InvalidScope);

    let wrong_metadata = CommandLedger::new();
    let error = wrong_metadata
        .activate(LedgerActivation {
            paths: paths(&directory.0),
            scope: scope(),
            trusted_command_key: trusted_key(7, "command-key-other"),
            runtime_generation: GENERATION + 1,
            now_ms: NOW_MS + 1,
        })
        .unwrap_err();
    assert_eq!(error.code, LedgerErrorCode::KeyMetadataMismatch);

    let wrong_key = CommandLedger::new();
    let error = wrong_key
        .activate(LedgerActivation {
            paths: paths(&directory.0),
            scope: scope(),
            trusted_command_key: trusted_key(8, "command-key-1"),
            runtime_generation: GENERATION + 1,
            now_ms: NOW_MS + 1,
        })
        .unwrap_err();
    assert_eq!(error.code, LedgerErrorCode::AuthenticationFailed);

    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION + 1,
    );
    assert_eq!(
        ledger.get("command-1").unwrap().unwrap().state,
        MobileDurableCommandState::Queued as i32
    );
}

#[test]
fn cancel_and_dispatch_fence_have_one_persisted_winner() {
    let directory = TestDirectory::new();
    let ledger = Arc::new(CommandLedger::new());
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-race", "friend:ptid:bob");
    let barrier = Arc::new(Barrier::new(3));

    let cancel_ledger = Arc::clone(&ledger);
    let cancel_barrier = Arc::clone(&barrier);
    let cancel = thread::spawn(move || {
        cancel_barrier.wait();
        cancel_ledger.cancel_before_dispatch(
            "command-race",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
    });
    let dispatch_ledger = Arc::clone(&ledger);
    let dispatch_barrier = Arc::clone(&barrier);
    let dispatch = thread::spawn(move || {
        dispatch_barrier.wait();
        dispatch_ledger.compare_and_swap_dispatch_fence(
            "command-race",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
    });
    barrier.wait();

    let cancel = cancel.join().unwrap();
    let dispatch = dispatch.join().unwrap();
    assert_ne!(cancel.is_ok(), dispatch.is_ok());
    let state = ledger.get("command-race").unwrap().unwrap().state;
    assert!(
        state == MobileDurableCommandState::Cancelled as i32
            || state == MobileDurableCommandState::DispatchFenced as i32
    );
}

#[test]
fn authoritative_retry_then_checkpoint_is_durable_and_acknowledgeable() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-1", "friend:ptid:bob");
    let lease = match ledger
        .compare_and_swap_dispatch_fence(
            "command-1",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
        .unwrap()
    {
        DispatchFenceResult::Ready(lease) => lease,
        DispatchFenceResult::NotDispatchable(_) => panic!("unexpected terminal command"),
    };
    assert_eq!(lease.envelope.attempt_count, 1);
    ledger
        .mark_submitting("command-1", GENERATION, NOW_MS + 2)
        .unwrap();
    ledger
        .mark_unknown(
            "command-1",
            GENERATION,
            MobileDurableCommandErrorCode::Deadline,
            NOW_MS + 3,
        )
        .unwrap();
    let reconciling = ledger
        .begin_reconciliation(
            "command-1",
            MobileDurableCommandState::UnknownOutcome,
            GENERATION,
            NOW_MS + 4,
        )
        .unwrap();
    let not_found = lookup_bytes(
        &reconciling,
        FriendRequestCommandLookupState::NotFound,
        None,
    );
    let retry = ledger
        .transition_from_authoritative_lookup("command-1", &not_found, GENERATION, NOW_MS + 5, 500)
        .unwrap();
    assert_eq!(
        retry.envelope.state,
        MobileDurableCommandState::RetryWait as i32
    );
    let retry_at = retry.retry_at_ms.unwrap();

    ledger
        .compare_and_swap_dispatch_fence(
            "command-1",
            MobileDurableCommandState::RetryWait,
            GENERATION,
            retry_at,
        )
        .unwrap();
    let submitting = ledger
        .mark_submitting("command-1", GENERATION, retry_at + 1)
        .unwrap();
    let committed_lookup = lookup_bytes(
        &submitting,
        FriendRequestCommandLookupState::TerminalResult,
        Some(FriendRequestCommandResultKind::Committed),
    );
    let committed = ledger
        .transition_from_authoritative_lookup(
            "command-1",
            &committed_lookup,
            GENERATION,
            retry_at + 2,
            0,
        )
        .unwrap();
    assert_eq!(
        committed.envelope.state,
        MobileDurableCommandState::Committed as i32
    );

    let checkpoint = ledger
        .persist_projection_checkpoint_and_remove(
            "command-1",
            &committed_lookup,
            GENERATION,
            retry_at + 3,
        )
        .unwrap();
    assert!(ledger.get("command-1").unwrap().is_none());
    assert_eq!(
        ledger.list_projection_checkpoints().unwrap(),
        vec![checkpoint.clone()]
    );
    ledger
        .acknowledge_projection_checkpoint("command-1", &checkpoint.payload_sha256)
        .unwrap();
    assert!(ledger.list_projection_checkpoints().unwrap().is_empty());
}

#[test]
fn terminal_failure_requires_explicit_acknowledgement() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-rejected", "friend:ptid:bob");
    ledger
        .compare_and_swap_dispatch_fence(
            "command-rejected",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
        .unwrap();
    let submitting = ledger
        .mark_submitting("command-rejected", GENERATION, NOW_MS + 2)
        .unwrap();
    let rejected = lookup_bytes(
        &submitting,
        FriendRequestCommandLookupState::TerminalResult,
        Some(FriendRequestCommandResultKind::Rejected),
    );
    let transition = ledger
        .transition_from_authoritative_lookup(
            "command-rejected",
            &rejected,
            GENERATION,
            NOW_MS + 3,
            0,
        )
        .unwrap();
    assert_eq!(
        transition.envelope.state,
        MobileDurableCommandState::FailedTerminal as i32
    );
    ledger
        .acknowledge_terminal_failure("command-rejected", GENERATION, NOW_MS + 4)
        .unwrap();
    assert!(ledger.get("command-rejected").unwrap().is_none());
}

#[test]
fn expected_state_updates_reject_stale_callers() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-cas", "friend:ptid:bob");
    assert_eq!(
        ledger
            .mark_submitting("command-cas", GENERATION, NOW_MS + 1)
            .unwrap_err()
            .code,
        LedgerErrorCode::StateConflict
    );
    ledger
        .compare_and_swap_dispatch_fence(
            "command-cas",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 2,
        )
        .unwrap();
    assert_eq!(
        ledger
            .cancel_before_dispatch(
                "command-cas",
                MobileDurableCommandState::Queued,
                GENERATION,
                NOW_MS + 3,
            )
            .unwrap_err()
            .code,
        LedgerErrorCode::StateConflict
    );
    ledger
        .mark_submitting("command-cas", GENERATION, NOW_MS + 4)
        .unwrap();
    ledger
        .mark_terminal_failure(
            "command-cas",
            MobileDurableCommandState::Submitting,
            GENERATION,
            MobileDurableCommandErrorCode::Unauthorized,
            NOW_MS + 5,
        )
        .unwrap();
}

#[test]
fn accepted_pending_result_uses_the_same_checkpoint_handoff() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-pending", "friend:ptid:bob");
    ledger
        .compare_and_swap_dispatch_fence(
            "command-pending",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
        .unwrap();
    let submitting = ledger
        .mark_submitting("command-pending", GENERATION, NOW_MS + 2)
        .unwrap();
    let accepted = lookup_bytes(
        &submitting,
        FriendRequestCommandLookupState::AcceptedPending,
        None,
    );
    let transitioned = ledger
        .transition_from_authoritative_lookup(
            "command-pending",
            &accepted,
            GENERATION,
            NOW_MS + 3,
            0,
        )
        .unwrap();
    assert_eq!(
        transitioned.envelope.state,
        MobileDurableCommandState::AcceptedPending as i32
    );
    let checkpoint = ledger
        .persist_projection_checkpoint_and_remove(
            "command-pending",
            &accepted,
            GENERATION,
            NOW_MS + 4,
        )
        .unwrap();
    assert!(ledger.get("command-pending").unwrap().is_none());
    assert_eq!(
        checkpoint.authoritative_lookup.state,
        FriendRequestCommandLookupState::AcceptedPending as i32
    );
}

#[test]
fn accepted_pending_can_advance_to_a_terminal_station_result() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );

    for (command_id, result_kind, expected_state) in [
        (
            "command-pending-committed",
            FriendRequestCommandResultKind::Committed,
            MobileDurableCommandState::Committed,
        ),
        (
            "command-pending-rejected",
            FriendRequestCommandResultKind::Rejected,
            MobileDurableCommandState::FailedTerminal,
        ),
    ] {
        admit(&ledger, command_id, command_id);
        ledger
            .compare_and_swap_dispatch_fence(
                command_id,
                MobileDurableCommandState::Queued,
                GENERATION,
                NOW_MS + 1,
            )
            .unwrap();
        let submitting = ledger
            .mark_submitting(command_id, GENERATION, NOW_MS + 2)
            .unwrap();
        let accepted = lookup_bytes(
            &submitting,
            FriendRequestCommandLookupState::AcceptedPending,
            None,
        );
        let pending = ledger
            .transition_from_authoritative_lookup(command_id, &accepted, GENERATION, NOW_MS + 3, 0)
            .unwrap()
            .envelope;
        let terminal = lookup_bytes(
            &pending,
            FriendRequestCommandLookupState::TerminalResult,
            Some(result_kind),
        );
        let resolved = ledger
            .transition_from_authoritative_lookup(command_id, &terminal, GENERATION, NOW_MS + 4, 0)
            .unwrap()
            .envelope;
        assert_eq!(resolved.state, expected_state as i32);
    }
}

#[test]
fn eight_transport_attempts_end_in_persisted_unresolved_state() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-exhausted", "friend:ptid:bob");
    let mut expected = MobileDurableCommandState::Queued;
    let mut now_ms = NOW_MS + 1;
    for attempt in 1..=MAX_TRANSPORT_ATTEMPTS {
        ledger
            .compare_and_swap_dispatch_fence("command-exhausted", expected, GENERATION, now_ms)
            .unwrap();
        let submitting = ledger
            .mark_submitting("command-exhausted", GENERATION, now_ms + 1)
            .unwrap();
        let not_found = lookup_bytes(&submitting, FriendRequestCommandLookupState::NotFound, None);
        let transition = ledger
            .transition_from_authoritative_lookup(
                "command-exhausted",
                &not_found,
                GENERATION,
                now_ms + 2,
                u64::from(attempt) * 137,
            )
            .unwrap();
        if attempt == MAX_TRANSPORT_ATTEMPTS {
            assert_eq!(
                transition.envelope.state,
                MobileDurableCommandState::Unresolved as i32
            );
            assert_eq!(
                transition.envelope.typed_last_error,
                MobileDurableCommandErrorCode::AttemptExhausted as i32
            );
            assert_eq!(transition.envelope.attempt_count, MAX_TRANSPORT_ATTEMPTS);
            break;
        }
        assert_eq!(
            transition.envelope.state,
            MobileDurableCommandState::RetryWait as i32
        );
        expected = MobileDurableCommandState::RetryWait;
        now_ms = transition.retry_at_ms.unwrap();
    }
}

#[test]
fn queued_command_expiry_is_a_known_terminal_failure_before_dispatch() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    let mut envelope = MobileDurableCommandEnvelopeV2::decode(
        generated_envelope("command-expired", "friend:ptid:bob", GENERATION, 0).as_slice(),
    )
    .unwrap();
    let command = match envelope.payload.as_mut() {
        Some(mobile_durable_command_envelope_v2::Payload::FriendRequest(command)) => command,
        _ => panic!("expected Friend Request payload"),
    };
    let expires_at = entry::millis_to_timestamp(NOW_MS + 1);
    command.body.as_mut().unwrap().expires_at = Some(expires_at.clone());
    envelope.expires_at = Some(expires_at);
    envelope.payload_sha256 = Sha256::digest(command.encode_to_vec()).to_vec();
    ledger
        .admit_generated_envelope(&envelope.encode_to_vec())
        .unwrap();

    let result = ledger
        .compare_and_swap_dispatch_fence(
            "command-expired",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 2,
        )
        .unwrap();
    let expired = match result {
        DispatchFenceResult::NotDispatchable(envelope) => envelope,
        DispatchFenceResult::Ready(_) => panic!("expired command was dispatched"),
    };
    assert_eq!(
        expired.state,
        MobileDurableCommandState::FailedTerminal as i32
    );
    assert_eq!(
        expired.typed_last_error,
        MobileDurableCommandErrorCode::DomainExpired as i32
    );
}

#[test]
fn crash_recovery_preserves_attempts_and_rebinds_runtime_generation() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-crash", "friend:ptid:bob");
    ledger
        .compare_and_swap_dispatch_fence(
            "command-crash",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
        .unwrap();
    ledger.deactivate().unwrap();

    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION + 1,
    );
    let recovered = ledger.get("command-crash").unwrap().unwrap();
    assert_eq!(
        recovered.state,
        MobileDurableCommandState::UnknownOutcome as i32
    );
    assert_eq!(recovered.attempt_count, 1);
    assert_eq!(recovered.origin_generation, GENERATION);
    assert_eq!(
        ledger
            .begin_reconciliation(
                "command-crash",
                MobileDurableCommandState::UnknownOutcome,
                GENERATION,
                NOW_MS + 2,
            )
            .unwrap_err()
            .code,
        LedgerErrorCode::StateConflict
    );
    ledger
        .begin_reconciliation(
            "command-crash",
            MobileDurableCommandState::UnknownOutcome,
            GENERATION + 1,
            NOW_MS + 2,
        )
        .unwrap();
}

#[test]
fn crash_recovery_never_strands_an_inflight_reconciliation() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    admit(&ledger, "command-reconciling-crash", "friend:ptid:bob");
    ledger
        .compare_and_swap_dispatch_fence(
            "command-reconciling-crash",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
        .unwrap();
    ledger
        .mark_submitting("command-reconciling-crash", GENERATION, NOW_MS + 2)
        .unwrap();
    ledger
        .mark_unknown(
            "command-reconciling-crash",
            GENERATION,
            MobileDurableCommandErrorCode::Deadline,
            NOW_MS + 3,
        )
        .unwrap();
    ledger
        .begin_reconciliation(
            "command-reconciling-crash",
            MobileDurableCommandState::UnknownOutcome,
            GENERATION,
            NOW_MS + 4,
        )
        .unwrap();
    ledger.deactivate().unwrap();

    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION + 1,
    );
    let recovered = ledger.get("command-reconciling-crash").unwrap().unwrap();
    assert_eq!(
        recovered.state,
        MobileDurableCommandState::Unresolved as i32
    );
    assert_eq!(
        recovered.typed_last_error,
        MobileDurableCommandErrorCode::LocalUnavailable as i32
    );
    assert_eq!(recovered.attempt_count, 1);
}

#[test]
fn scheduler_allows_four_keys_and_preserves_fifo_per_key() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    for key in ["a", "b", "c", "d", "e"] {
        admit(&ledger, &format!("command-{key}"), key);
    }
    admit(&ledger, "command-a-2", "a");

    let mut leased_keys = Vec::new();
    for offset in 0..4 {
        leased_keys.push(
            ledger
                .next_for_dispatch(GENERATION, NOW_MS + 1 + offset)
                .unwrap()
                .unwrap()
                .envelope
                .ordering_key,
        );
    }
    assert_eq!(
        leased_keys.into_iter().collect::<HashSet<_>>(),
        HashSet::from([
            "a".to_string(),
            "b".to_string(),
            "c".to_string(),
            "d".to_string(),
        ])
    );
    assert!(ledger
        .next_for_dispatch(GENERATION, NOW_MS + 10)
        .unwrap()
        .is_none());

    ledger
        .mark_unknown(
            "command-a",
            GENERATION,
            MobileDurableCommandErrorCode::Transport,
            NOW_MS + 11,
        )
        .unwrap();
    let fifth = ledger
        .next_for_dispatch(GENERATION, NOW_MS + 12)
        .unwrap()
        .unwrap();
    assert_eq!(fifth.envelope.ordering_key, "e");
    assert_eq!(
        ledger.get("command-a-2").unwrap().unwrap().state,
        MobileDurableCommandState::Queued as i32
    );
}

#[test]
fn per_scope_record_capacity_is_exact() {
    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    for index in 0..MAX_UNRESOLVED_COMMANDS {
        admit(
            &ledger,
            &format!("command-{index:04}"),
            &format!("key-{index:04}"),
        );
    }
    let error = ledger
        .admit_generated_envelope(&generated_envelope(
            "command-overflow",
            "key-overflow",
            GENERATION,
            0,
        ))
        .unwrap_err();
    assert_eq!(error.code, LedgerErrorCode::CapacityExceeded);
    assert_eq!(
        error.capacity_exhaustion_causes(),
        &[LedgerCapacityExhaustionCause::RecordCount]
    );
    let capacity = ledger.capacity_status().unwrap();
    assert_eq!(capacity.record_count, MAX_UNRESOLVED_COMMANDS);
    assert_eq!(capacity.record_limit, MAX_UNRESOLVED_COMMANDS);
    assert_eq!(
        capacity.exhaustion_causes,
        vec![LedgerCapacityExhaustionCause::RecordCount]
    );
    assert_eq!(
        ledger.list().unwrap().len(),
        MAX_UNRESOLVED_COMMANDS as usize
    );
}

#[test]
fn payload_and_partition_byte_boundaries_fail_closed() {
    let oversized = generated_envelope(
        "command-oversized",
        "key-oversized",
        GENERATION,
        MAX_PAYLOAD_BYTES,
    );
    assert_eq!(
        entry::decode_admission(&oversized, &scope(), GENERATION)
            .unwrap_err()
            .code,
        LedgerErrorCode::PayloadTooLarge
    );

    let directory = TestDirectory::new();
    let ledger = CommandLedger::new();
    activate(
        &ledger,
        &directory.0,
        scope(),
        trusted_key(7, "command-key-1"),
        GENERATION,
    );
    let message_length = 260_000;
    let sample = generated_envelope("sample", "sample", GENERATION, message_length);
    let payload_size = entry::decode_admission(&sample, &scope(), GENERATION)
        .unwrap()
        .payload_size() as u64;
    let accepted = MAX_PARTITION_BYTES / payload_size;
    for index in 0..accepted {
        ledger
            .admit_generated_envelope(&generated_envelope(
                &format!("large-{index:03}"),
                &format!("large-key-{index:03}"),
                GENERATION,
                message_length,
            ))
            .unwrap();
    }
    let error = ledger
        .admit_generated_envelope(&generated_envelope(
            "large-overflow",
            "large-key-overflow",
            GENERATION,
            message_length,
        ))
        .unwrap_err();
    assert_eq!(error.code, LedgerErrorCode::CapacityExceeded);
    assert_eq!(
        error.capacity_exhaustion_causes(),
        &[LedgerCapacityExhaustionCause::ByteCapacity]
    );
    assert!(error.detail().contains("byte capacity"));

    let capacity = ledger.capacity_status().unwrap();
    assert_eq!(capacity.record_count, accepted);
    assert!(capacity.record_count < capacity.record_limit);
    assert!(capacity.byte_usage < capacity.byte_limit);
    assert_eq!(
        capacity.exhaustion_causes,
        vec![LedgerCapacityExhaustionCause::ByteCapacity]
    );
    assert_eq!(ledger.list().unwrap().len(), accepted as usize);

    ledger
        .cancel_before_dispatch(
            "large-000",
            MobileDurableCommandState::Queued,
            GENERATION,
            NOW_MS + 1,
        )
        .unwrap();
    ledger.purge_cancelled("large-000").unwrap();
    assert!(ledger
        .capacity_status()
        .unwrap()
        .exhaustion_causes
        .is_empty());
}
