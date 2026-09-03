package service

import (
	"context"
	"crypto/ed25519"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestToolDispatchServiceRenewCapabilityLease(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	original := fixture.session
	fixture.now = fixture.now.Add(time.Minute)
	fixture.service.now = func() time.Time { return fixture.now }

	renew := &model.RenewClientCapabilityLeaseRequest{
		CapabilitySessionId:   original.GetCapabilitySessionId(),
		LeaseId:               original.GetLeaseId(),
		ExpectedLeaseRevision: original.GetLeaseRevision(),
		CapabilitySetHash:     original.GetCapabilitySetHash(),
		DeviceSigningKeyId:    original.GetDeviceSigningKeyId(),
	}
	fixture.signRequest(
		t,
		renew,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE,
		"renew-success",
		21,
	)
	response, err := fixture.service.RenewCapabilityLease(
		context.Background(),
		fixture.actorID,
		"auth-session-1",
		fixture.deviceID,
		renew,
	)
	if err != nil {
		t.Fatalf("renew capability lease: %v", err)
	}
	renewed := response.GetLease()
	if renewed.GetLeaseRevision() != original.GetLeaseRevision()+1 {
		t.Fatalf("renewed lease revision = %d, want %d", renewed.GetLeaseRevision(), original.GetLeaseRevision()+1)
	}
	if renewed.GetCapabilitySetHash() != original.GetCapabilitySetHash() ||
		renewed.GetConnectionId() != original.GetConnectionId() ||
		renewed.GetDeviceSigningKeyId() != original.GetDeviceSigningKeyId() {
		t.Fatalf("renew changed immutable lease bindings: original=%+v renewed=%+v", original, renewed)
	}
	if !renewed.GetExpiresAt().AsTime().After(original.GetExpiresAt().AsTime()) {
		t.Fatalf("renewed expiry %s did not advance beyond %s", renewed.GetExpiresAt().AsTime(), original.GetExpiresAt().AsTime())
	}

	stale := &model.RenewClientCapabilityLeaseRequest{
		CapabilitySessionId:   original.GetCapabilitySessionId(),
		LeaseId:               original.GetLeaseId(),
		ExpectedLeaseRevision: original.GetLeaseRevision(),
		CapabilitySetHash:     original.GetCapabilitySetHash(),
		DeviceSigningKeyId:    original.GetDeviceSigningKeyId(),
	}
	fixture.signRequest(
		t,
		stale,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE,
		"renew-stale",
		22,
	)
	if _, err := fixture.service.RenewCapabilityLease(
		context.Background(),
		fixture.actorID,
		"auth-session-1",
		fixture.deviceID,
		stale,
	); err == nil {
		t.Fatal("stale lease revision renewal succeeded")
	}

	var stored persistence.ClientCapabilityLease
	if err := fixture.db.First(&stored, "session_id = ?", original.GetCapabilitySessionId()).Error; err != nil {
		t.Fatalf("reload renewed capability lease: %v", err)
	}
	if stored.LeaseRevision != renewed.GetLeaseRevision() {
		t.Fatalf("stale renewal changed stored revision to %d, want %d", stored.LeaseRevision, renewed.GetLeaseRevision())
	}
}

func TestToolDispatchServiceRevokeCapabilityLeaseBlocksPull(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-revoked")

	revoke := &model.RevokeClientCapabilityLeaseRequest{
		CapabilitySessionId:   fixture.session.GetCapabilitySessionId(),
		LeaseId:               fixture.session.GetLeaseId(),
		ExpectedLeaseRevision: fixture.session.GetLeaseRevision(),
		Reason:                model.ClientCapabilityLeaseRevokeReason_CLIENT_CAPABILITY_LEASE_REVOKE_REASON_USER_LOGOUT,
	}
	fixture.signRequest(
		t,
		revoke,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REVOKE_LEASE,
		"revoke-before-pull",
		23,
	)
	response, err := fixture.service.RevokeCapabilityLease(
		context.Background(),
		fixture.actorID,
		"auth-session-1",
		fixture.deviceID,
		revoke,
	)
	if err != nil {
		t.Fatalf("revoke capability lease: %v", err)
	}
	if response.GetLeaseRevision() != fixture.session.GetLeaseRevision()+1 || response.GetRevokedAt() == nil {
		t.Fatalf("unexpected revoke acknowledgement: %+v", response)
	}

	pull := fixture.signedPullRequest(t, "after-revoke", 24)
	if pulled, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		pull,
	); err == nil {
		t.Fatalf("revoked capability lease pulled requests: %+v", pulled)
	}
}

func TestToolDispatchServiceSubmitRecoveryReceipt(t *testing.T) {
	t.Run("accepts terminal signature from envelope credential", func(t *testing.T) {
		fixture, envelope, receipt := preparedRecoveryReceipt(t, "signed")
		signRecoveryReceipt(t, fixture, envelope, receipt)

		response, err := fixture.service.SubmitRecoveryReceipt(
			context.Background(),
			&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: receipt},
		)
		if err != nil {
			t.Fatalf("submit recovery receipt: %v", err)
		}
		if !response.GetResult().GetAccepted() ||
			response.GetResult().GetResultId() != receipt.GetResultId() ||
			response.GetResult().GetContinuationId() == "" {
			t.Fatalf("unexpected recovery acknowledgement: %+v", response.GetResult())
		}
	})

	t.Run("returns stored acknowledgement for identical replay", func(t *testing.T) {
		fixture, envelope, receipt := preparedRecoveryReceipt(t, "replay")
		signRecoveryReceipt(t, fixture, envelope, receipt)
		request := &model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: receipt}

		first, err := fixture.service.SubmitRecoveryReceipt(context.Background(), request)
		if err != nil {
			t.Fatalf("submit first recovery receipt: %v", err)
		}
		replayed, err := fixture.service.SubmitRecoveryReceipt(context.Background(), request)
		if err != nil {
			t.Fatalf("replay recovery receipt: %v", err)
		}
		if !replayed.GetResult().GetAccepted() || !replayed.GetResult().GetReplayed() {
			t.Fatalf("identical recovery replay was not accepted as replay: %+v", replayed.GetResult())
		}
		if replayed.GetResult().GetResultId() != first.GetResult().GetResultId() ||
			replayed.GetResult().GetContinuationId() != first.GetResult().GetContinuationId() {
			t.Fatalf("recovery replay changed acknowledgement: first=%+v replay=%+v", first.GetResult(), replayed.GetResult())
		}
	})

	t.Run("rejects conflicting digest for consumed nonce", func(t *testing.T) {
		fixture, envelope, receipt := preparedRecoveryReceipt(t, "conflict")
		signRecoveryReceipt(t, fixture, envelope, receipt)
		if response, err := fixture.service.SubmitRecoveryReceipt(
			context.Background(),
			&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: receipt},
		); err != nil || !response.GetResult().GetAccepted() {
			t.Fatalf("submit first recovery receipt: response=%+v err=%v", response, err)
		}

		conflicting := proto.Clone(receipt).(*model.ClientCapabilityReceipt)
		conflicting.ResultId = "result-conflict-other"
		conflicting.BoundedResult = []byte(`{"value":"other"}`)
		signRecoveryReceipt(t, fixture, envelope, conflicting)
		response, err := fixture.service.SubmitRecoveryReceipt(
			context.Background(),
			&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: conflicting},
		)
		if err != nil {
			t.Fatalf("submit conflicting recovery receipt: %v", err)
		}
		if response.GetResult().GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_NONCE_CONFLICT {
			t.Fatalf("conflicting recovery digest error = %s, want recovery nonce conflict", response.GetResult().GetErrorCode())
		}
	})

	t.Run("rejects altered authority tuple", func(t *testing.T) {
		fixture, envelope, receipt := preparedRecoveryReceipt(t, "authority")
		receipt.TurnId = "turn-other"
		signRecoveryReceipt(t, fixture, envelope, receipt)

		response, err := fixture.service.SubmitRecoveryReceipt(
			context.Background(),
			&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: receipt},
		)
		if err != nil {
			t.Fatalf("submit altered recovery receipt: %v", err)
		}
		if response.GetResult().GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_SCOPE_MISMATCH {
			t.Fatalf("altered authority tuple error = %s, want recovery scope mismatch", response.GetResult().GetErrorCode())
		}
		var resultCount int64
		if err := fixture.db.Model(&persistence.ToolResult{}).Count(&resultCount).Error; err != nil {
			t.Fatalf("count tool results: %v", err)
		}
		if resultCount != 0 {
			t.Fatalf("altered authority tuple persisted %d tool results", resultCount)
		}
	})

	t.Run("rejects invalid recovery signature", func(t *testing.T) {
		fixture, envelope, receipt := preparedRecoveryReceipt(t, "invalid-signature")
		signRecoveryReceipt(t, fixture, envelope, receipt)
		receipt.GetRecoveryProof().Signature[0] ^= 0xff

		response, err := fixture.service.SubmitRecoveryReceipt(
			context.Background(),
			&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: receipt},
		)
		if err != nil {
			t.Fatalf("submit recovery receipt with invalid signature: %v", err)
		}
		if response.GetResult().GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_SIGNATURE_INVALID {
			t.Fatalf("invalid recovery signature error = %s, want recovery signature invalid", response.GetResult().GetErrorCode())
		}
	})

	t.Run("rejects revoked recovery signing key", func(t *testing.T) {
		fixture, envelope, receipt := preparedRecoveryReceipt(t, "revoked-key")
		signRecoveryReceipt(t, fixture, envelope, receipt)
		publicKey := fixture.privateKey.Public().(ed25519.PublicKey)
		revokedKey := verifiedProofTestKey(publicKey)
		revokedKey.RevokedAtUnixMs = fixture.now.UnixMilli()
		fixture.service.capabilityProof.resolver = &deterministicDeviceSigningKeyResolver{
			key: revokedKey,
		}

		response, err := fixture.service.SubmitRecoveryReceipt(
			context.Background(),
			&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: receipt},
		)
		if err != nil {
			t.Fatalf("submit recovery receipt with revoked key: %v", err)
		}
		if response.GetResult().GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_DEVICE_KEY_REVOKED {
			t.Fatalf("revoked recovery key error = %s, want recovery device key revoked", response.GetResult().GetErrorCode())
		}
	})
}

func TestToolDispatchServiceLateAppliedAfterCancellationPersistsWithoutContinuation(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	now := fixture.now
	conversation := &persistence.Conversation{
		ID:        "conversation-1",
		AgentID:   "agent-1",
		ActorPTID: fixture.actorID,
		Title:     "Recovery cancellation",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}
	turn := &persistence.AgentTurn{
		ID:             "turn-1",
		ConversationID: conversation.ID,
		AgentID:        conversation.AgentID,
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}
	attempt := &persistence.TurnAttempt{
		ID:           "attempt-1",
		TurnID:       turn.ID,
		AttemptIndex: 1,
		Status:       string(domain.TurnStatusWaitingLocalTool),
		StartedAt:    now,
	}
	for label, value := range map[string]interface{}{
		"conversation": conversation,
		"turn":         turn,
		"attempt":      attempt,
	} {
		if err := fixture.db.Create(value).Error; err != nil {
			t.Fatalf("seed %s: %v", label, err)
		}
	}

	fixture.propose(t, "tool-call-late-applied")
	envelope := fixture.pullSingleEnvelope(t)
	prepared := receiptForEnvelope(
		envelope,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}
	if err := (&TurnService{}).cancelTurn(
		context.Background(),
		conversation.AgentID,
		turn.ID,
		"",
		"",
	); err != nil {
		t.Fatalf("cancel waiting tool turn: %v", err)
	}

	fixture.service.now = func() time.Time { return envelope.GetExecutionDeadline().AsTime().Add(time.Second) }
	applied := receiptForEnvelope(
		envelope,
		2,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	applied.ResultId = "result-late-applied"
	applied.BoundedResult = []byte(`{"applied":true}`)
	signRecoveryReceipt(t, fixture, envelope, applied)
	response, err := fixture.service.SubmitRecoveryReceipt(
		context.Background(),
		&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: applied},
	)
	if err != nil {
		t.Fatalf("submit late applied recovery receipt: %v", err)
	}
	if !response.GetResult().GetAccepted() || response.GetResult().GetContinuationId() != "" {
		t.Fatalf("late applied acknowledgement = %+v, want accepted without continuation", response.GetResult())
	}

	var resultCount int64
	if err := fixture.db.Model(&persistence.ToolResult{}).
		Where("tool_call_id = ?", envelope.GetToolCallId()).
		Count(&resultCount).Error; err != nil {
		t.Fatalf("count late tool results: %v", err)
	}
	if resultCount != 1 {
		t.Fatalf("late applied receipt persisted %d tool results, want 1", resultCount)
	}
	var continuationCount int64
	if err := fixture.db.Model(&persistence.ToolContinuation{}).
		Where("tool_batch_id = ?", envelope.GetToolBatchId()).
		Count(&continuationCount).Error; err != nil {
		t.Fatalf("count late continuations: %v", err)
	}
	if continuationCount != 0 {
		t.Fatalf("late applied receipt created %d continuations, want 0", continuationCount)
	}
	var call persistence.ToolCall
	if err := fixture.db.First(&call, "tool_call_id = ?", envelope.GetToolCallId()).Error; err != nil {
		t.Fatalf("reload cancelled tool call: %v", err)
	}
	if call.Status != persistence.ToolCallStatusUnknownSideEffect || !call.ResultPersisted {
		t.Fatalf("late result changed cancelled call authority: %+v", call)
	}
	var batch persistence.ToolBatch
	if err := fixture.db.First(&batch, "id = ?", envelope.GetToolBatchId()).Error; err != nil {
		t.Fatalf("reload cancelled tool batch: %v", err)
	}
	if batch.Status != persistence.ToolBatchStatusBlocked {
		t.Fatalf("late result reopened cancelled batch with status %s", batch.Status)
	}
}

func TestToolDispatchServiceRegisterLeaseTakesOverExternalPreparedCall(t *testing.T) {
	fixture, original := preparedExternalReplayCall(t, "takeover")
	originalClaim := original.GetExecutionClaimId()
	originalDeadline := original.GetExecutionDeadline().AsTime()
	originalCredentialID := original.GetRecoveryCredential().GetCredentialId()

	fixture.now = fixture.now.Add(time.Second)
	fixture.service.now = func() time.Time { return fixture.now }
	fixture.session = fixture.registerReplacementLease(
		t,
		"takeover",
		fixture.session.GetCapabilities(),
		31,
	)
	replayedLease := fixture.registerReplacementLease(
		t,
		"takeover",
		fixture.session.GetCapabilities(),
		31,
	)
	if replayedLease.GetCapabilitySessionId() != fixture.session.GetCapabilitySessionId() ||
		replayedLease.GetLeaseId() != fixture.session.GetLeaseId() ||
		replayedLease.GetLeaseRevision() != fixture.session.GetLeaseRevision() {
		t.Fatalf("replacement registration replay changed lease: %+v", replayedLease)
	}
	var takeoverOutboxCount int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Where("capability_session_id = ?", fixture.session.GetCapabilitySessionId()).
		Count(&takeoverOutboxCount).Error; err != nil {
		t.Fatalf("count replayed takeover outbox rows: %v", err)
	}
	if takeoverOutboxCount != 1 {
		t.Fatalf("replacement registration replay created %d takeover rows, want 1", takeoverOutboxCount)
	}
	pulled, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedPullRequest(t, "takeover", 32),
	)
	if err != nil {
		t.Fatalf("pull takeover capability request: %v", err)
	}
	if len(pulled.GetRequests()) != 1 {
		t.Fatalf("takeover request count = %d, want 1", len(pulled.GetRequests()))
	}
	takeover := pulled.GetRequests()[0]

	if takeover.GetExecutionClaimId() != originalClaim {
		t.Fatalf("takeover claim = %s, want %s", takeover.GetExecutionClaimId(), originalClaim)
	}
	if takeover.GetFencingToken() != original.GetFencingToken()+1 {
		t.Fatalf("takeover fence = %d, want %d", takeover.GetFencingToken(), original.GetFencingToken()+1)
	}
	if takeover.GetExternalIdempotencyKey() != "external-key-takeover" {
		t.Fatalf("takeover external key = %q", takeover.GetExternalIdempotencyKey())
	}
	if !takeover.GetExecutionDeadline().AsTime().Equal(originalDeadline) {
		t.Fatalf(
			"takeover execution deadline = %s, want %s",
			takeover.GetExecutionDeadline().AsTime(),
			originalDeadline,
		)
	}
	if takeover.GetCapabilitySessionId() != fixture.session.GetCapabilitySessionId() ||
		takeover.GetExecutorLeaseId() != fixture.session.GetLeaseId() ||
		takeover.GetCapabilityLeaseRevision() != fixture.session.GetLeaseRevision() {
		t.Fatalf("takeover did not bind replacement lease: %+v", takeover)
	}

	var previousCredential persistence.ReceiptRecoveryCredential
	if err := fixture.db.First(&previousCredential, "id = ?", originalCredentialID).Error; err != nil {
		t.Fatalf("reload previous recovery credential: %v", err)
	}
	if previousCredential.InvalidatedAt == nil {
		t.Fatal("takeover did not invalidate previous recovery credential")
	}

	oldActive := receiptForEnvelope(
		original,
		10,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	oldActive.ResultId = "old-active-fence-result"
	oldActiveResponse, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, oldActive),
	)
	if err != nil {
		t.Fatalf("submit old-fence active receipt: %v", err)
	}
	if oldActiveResponse.GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH {
		t.Fatalf("old active receipt error = %s", oldActiveResponse.GetErrorCode())
	}

	oldTerminal := receiptForEnvelope(
		original,
		2,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	oldTerminal.ResultId = "old-fence-result"
	signRecoveryReceipt(t, fixture, original, oldTerminal)
	oldResponse, err := fixture.service.SubmitRecoveryReceipt(
		context.Background(),
		&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: oldTerminal},
	)
	if err != nil {
		t.Fatalf("submit invalidated recovery receipt: %v", err)
	}
	if oldResponse.GetResult().GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_CREDENTIAL_EXPIRED {
		t.Fatalf("old recovery credential error = %s", oldResponse.GetResult().GetErrorCode())
	}
	var rejectedRecovery persistence.ToolReceiptAttempt
	if err := fixture.db.Where(
		"request_id = ? AND sequence = ?",
		oldTerminal.GetRequestId(),
		oldTerminal.GetSequence(),
	).First(&rejectedRecovery).Error; err != nil {
		t.Fatalf("load rejected old-fence recovery attempt: %v", err)
	}
	if rejectedRecovery.Accepted ||
		rejectedRecovery.RejectionCode != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_CREDENTIAL_EXPIRED.String() {
		t.Fatalf("old-fence recovery audit row = %+v", rejectedRecovery)
	}
	replayedOldResponse, err := fixture.service.SubmitRecoveryReceipt(
		context.Background(),
		&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: oldTerminal},
	)
	if err != nil {
		t.Fatalf("replay invalidated recovery receipt: %v", err)
	}
	if !replayedOldResponse.GetResult().GetReplayed() ||
		replayedOldResponse.GetResult().GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_CREDENTIAL_EXPIRED {
		t.Fatalf("old-fence recovery replay = %+v", replayedOldResponse.GetResult())
	}

	terminalBeforePrepared := receiptForEnvelope(
		takeover,
		7,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	terminalBeforePrepared.ResultId = "takeover-terminal-before-prepared"
	rejected, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, terminalBeforePrepared),
	)
	if err != nil {
		t.Fatalf("submit takeover terminal before PREPARED: %v", err)
	}
	if rejected.GetErrorCode() != model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_INVALID_TRANSITION {
		t.Fatalf("takeover terminal-before-PREPARED error = %s", rejected.GetErrorCode())
	}

	prepared := receiptForEnvelope(
		takeover,
		8,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit takeover PREPARED: response=%+v err=%v", response, err)
	}
	if affected, err := fixture.service.ReconcilePreparedCapabilityTakeovers(context.Background()); err != nil {
		t.Fatalf("reconcile completed takeover: %v", err)
	} else if affected != 0 {
		t.Fatalf("completed takeover reconciled %d additional attempts", affected)
	}

	applied := receiptForEnvelope(
		takeover,
		9,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	applied.ResultId = "takeover-result"
	applied.BoundedResult = []byte(`{"applied":true}`)
	response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, applied),
	)
	if err != nil || !response.GetAccepted() {
		t.Fatalf("submit takeover APPLIED: response=%+v err=%v", response, err)
	}
}

func TestToolDispatchServicePreparedTakeoverFailsClosed(t *testing.T) {
	testCases := []struct {
		name   string
		mutate func(t *testing.T, fixture toolDispatchFixture)
		caps   func(toolDispatchFixture) []*model.ClientCapability
	}{
		{
			name: "no replay",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				if err := fixture.db.Model(&persistence.ToolCall{}).
					Where("tool_call_id = ?", "tool-call-no_replay").
					Update("replay_policy", persistence.ClientExecutionReplayPolicyNoReplayAfterPrepared).Error; err != nil {
					t.Fatalf("set no-replay policy: %v", err)
				}
			},
		},
		{
			name: "empty external key",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				if err := fixture.db.Model(&persistence.ToolCall{}).
					Where("tool_call_id = ?", "tool-call-empty_external_key").
					Update("external_idempotency_key", "").Error; err != nil {
					t.Fatalf("clear external idempotency key: %v", err)
				}
			},
		},
		{
			name: "expired execution deadline",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				if err := fixture.db.Model(&persistence.ToolCall{}).
					Where("tool_call_id = ?", "tool-call-expired_execution_deadline").
					Update("execution_deadline", fixture.now.Add(-time.Second)).Error; err != nil {
					t.Fatalf("expire execution deadline: %v", err)
				}
			},
		},
		{
			name: "immutable argument drift",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				if err := fixture.db.Model(&persistence.ToolCall{}).
					Where("tool_call_id = ?", "tool-call-immutable_argument_drift").
					Update("bounded_arguments", []byte(`{"changed":true}`)).Error; err != nil {
					t.Fatalf("mutate bounded arguments: %v", err)
				}
			},
		},
		{
			name: "coordinated argument drift without hash",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				const toolCallID = "tool-call-coordinated_argument_drift_without_hash"
				var outbox persistence.ToolDispatchOutbox
				if err := fixture.db.First(&outbox, "tool_call_id = ?", toolCallID).Error; err != nil {
					t.Fatalf("load immutable outbox envelope: %v", err)
				}
				var envelope model.ClientCapabilityRequest
				if err := proto.Unmarshal(outbox.Envelope, &envelope); err != nil {
					t.Fatalf("decode immutable outbox envelope: %v", err)
				}
				changedArguments := []byte(`{"changed":true}`)
				envelope.BoundedArguments = changedArguments
				encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(&envelope)
				if err != nil {
					t.Fatalf("encode drifted outbox envelope: %v", err)
				}
				if err := fixture.db.Model(&persistence.ToolCall{}).
					Where("tool_call_id = ?", toolCallID).
					Update("bounded_arguments", changedArguments).Error; err != nil {
					t.Fatalf("mutate tool call arguments: %v", err)
				}
				if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
					Where("request_id = ?", outbox.RequestID).
					Update("envelope", encoded).Error; err != nil {
					t.Fatalf("mutate outbox envelope without hash: %v", err)
				}
			},
		},
		{
			name: "actor mismatch",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				if err := fixture.db.Model(&persistence.ToolCall{}).
					Where("tool_call_id = ?", "tool-call-actor_mismatch").
					Update("actor_id", "actor-other").Error; err != nil {
					t.Fatalf("mutate takeover actor: %v", err)
				}
			},
		},
		{
			name: "device mismatch",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				if err := fixture.db.Model(&persistence.ToolCall{}).
					Where("tool_call_id = ?", "tool-call-device_mismatch").
					Update("target_device_id", "device-other").Error; err != nil {
					t.Fatalf("mutate takeover device: %v", err)
				}
			},
		},
		{
			name: "signing key mismatch",
			mutate: func(t *testing.T, fixture toolDispatchFixture) {
				t.Helper()
				if err := fixture.db.Model(&persistence.ReceiptRecoveryCredential{}).
					Where("tool_call_id = ?", "tool-call-signing_key_mismatch").
					Update("device_signing_key_id", "signing-key-other").Error; err != nil {
					t.Fatalf("mutate takeover signing key: %v", err)
				}
			},
		},
		{
			name:   "capability mismatch",
			mutate: func(*testing.T, toolDispatchFixture) {},
			caps: func(toolDispatchFixture) []*model.ClientCapability {
				return []*model.ClientCapability{{
					CapabilityId:  "shell.execute",
					SchemaVersion: "1",
					Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
					Constraints:   &model.CapabilityConstraints{MaxRequestBytes: 4096},
				}}
			},
		},
		{
			name:   "schema mismatch",
			mutate: func(*testing.T, toolDispatchFixture) {},
			caps: func(toolDispatchFixture) []*model.ClientCapability {
				return []*model.ClientCapability{{
					CapabilityId:  "filesystem.read",
					SchemaVersion: "2",
					Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
					Constraints:   &model.CapabilityConstraints{MaxRequestBytes: 4096},
				}}
			},
		},
	}

	for index, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			suffix := strings.ReplaceAll(testCase.name, " ", "_")
			fixture, original := preparedExternalReplayCall(t, suffix)
			testCase.mutate(t, fixture)
			capabilities := fixture.session.GetCapabilities()
			if testCase.caps != nil {
				capabilities = testCase.caps(fixture)
			}
			fixture.now = fixture.now.Add(time.Second)
			fixture.service.now = func() time.Time { return fixture.now }
			replacement := fixture.registerReplacementLease(
				t,
				suffix,
				capabilities,
				byte(40+index),
			)

			var outboxCount int64
			if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
				Where("capability_session_id = ?", replacement.GetCapabilitySessionId()).
				Count(&outboxCount).Error; err != nil {
				t.Fatalf("count replacement outbox rows: %v", err)
			}
			if outboxCount != 0 {
				t.Fatalf("ineligible takeover created %d replacement outbox rows", outboxCount)
			}
			var call persistence.ToolCall
			if err := fixture.db.First(&call, "tool_call_id = ?", original.GetToolCallId()).Error; err != nil {
				t.Fatalf("reload ineligible takeover call: %v", err)
			}
			if call.Status != persistence.ToolCallStatusPrepared ||
				call.FencingToken != original.GetFencingToken() {
				t.Fatalf("ineligible takeover changed call: %+v", call)
			}
		})
	}
}

func TestToolDispatchServicePreparedTakeoverRejectsResourceBearingEnvelope(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-resource-bearing")
	original := fixture.pullSingleEnvelope(t)
	original.ResourceRefs = []*model.ClientResourceRef{{
		ResourceRef:         "opaque-resource",
		Ptid:                fixture.actorID,
		DeviceId:            fixture.deviceID,
		CapabilitySessionId: fixture.session.GetCapabilitySessionId(),
		CapabilityId:        "filesystem.read",
	}}
	markPreparedExternalReplay(t, fixture, original, "external-key-resource-bearing")
	prepared := receiptForEnvelope(
		original,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit resource-bearing PREPARED: response=%+v err=%v", response, err)
	}

	fixture.now = fixture.now.Add(time.Second)
	fixture.service.now = func() time.Time { return fixture.now }
	replacement := fixture.registerReplacementLease(
		t,
		"resource-bearing",
		fixture.session.GetCapabilities(),
		51,
	)
	var outboxCount int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Where("capability_session_id = ?", replacement.GetCapabilitySessionId()).
		Count(&outboxCount).Error; err != nil {
		t.Fatalf("count resource-bearing replacement outbox rows: %v", err)
	}
	if outboxCount != 0 {
		t.Fatalf("resource-bearing PREPARED created %d takeover rows", outboxCount)
	}
}

func TestToolDispatchServicePeriodicTakeoverUsesNewestMatchingLease(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-periodic")
	original := fixture.pullSingleEnvelope(t)

	fixture.now = fixture.now.Add(time.Second)
	fixture.service.now = func() time.Time { return fixture.now }
	replacement := fixture.registerReplacementLease(
		t,
		"periodic",
		fixture.session.GetCapabilities(),
		61,
	)

	markPreparedExternalReplay(t, fixture, original, "external-key-periodic")
	prepared := receiptForEnvelope(
		original,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit periodic PREPARED: response=%+v err=%v", response, err)
	}

	fixture.now = fixture.now.Add(time.Second)
	affected, err := fixture.service.ReconcilePreparedCapabilityTakeovers(context.Background())
	if err != nil {
		t.Fatalf("reconcile periodic takeover: %v", err)
	}
	if affected != 1 {
		t.Fatalf("periodic takeover affected %d calls, want 1", affected)
	}

	fixture.session = replacement
	pulled, err := fixture.service.PullCapabilityRequests(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedPullRequest(t, "periodic-takeover", 62),
	)
	if err != nil {
		t.Fatalf("pull periodic takeover: %v", err)
	}
	if len(pulled.GetRequests()) != 1 ||
		pulled.GetRequests()[0].GetFencingToken() != original.GetFencingToken()+1 {
		t.Fatalf("periodic takeover requests = %+v", pulled.GetRequests())
	}
}

func TestToolDispatchServicePeriodicTakeoverSkipsNewerIncompatibleLease(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-matching-lease")
	original := fixture.pullSingleEnvelope(t)

	fixture.now = fixture.now.Add(time.Second)
	fixture.service.now = func() time.Time { return fixture.now }
	matching := fixture.registerReplacementLease(
		t,
		"matching",
		fixture.session.GetCapabilities(),
		64,
	)
	fixture.now = fixture.now.Add(time.Second)
	incompatible := fixture.registerReplacementLease(
		t,
		"incompatible",
		[]*model.ClientCapability{{
			CapabilityId:  "shell.execute",
			SchemaVersion: "1",
			Permission:    model.CapabilityPermissionState_CAPABILITY_PERMISSION_STATE_GRANTED,
			Constraints:   &model.CapabilityConstraints{MaxRequestBytes: 4096},
		}},
		65,
	)

	markPreparedExternalReplay(t, fixture, original, "external-key-matching-lease")
	prepared := receiptForEnvelope(
		original,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit matching-lease PREPARED: response=%+v err=%v", response, err)
	}

	fixture.now = fixture.now.Add(time.Second)
	affected, err := fixture.service.ReconcilePreparedCapabilityTakeovers(context.Background())
	if err != nil {
		t.Fatalf("reconcile matching-lease takeover: %v", err)
	}
	if affected != 1 {
		t.Fatalf("matching-lease takeover affected %d calls, want 1", affected)
	}
	var matchingCount int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Where("capability_session_id = ?", matching.GetCapabilitySessionId()).
		Count(&matchingCount).Error; err != nil {
		t.Fatalf("count matching lease outbox rows: %v", err)
	}
	var incompatibleCount int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Where("capability_session_id = ?", incompatible.GetCapabilitySessionId()).
		Count(&incompatibleCount).Error; err != nil {
		t.Fatalf("count incompatible lease outbox rows: %v", err)
	}
	if matchingCount != 1 || incompatibleCount != 0 {
		t.Fatalf(
			"takeover outbox counts: matching=%d incompatible=%d",
			matchingCount,
			incompatibleCount,
		)
	}
}

func TestToolDispatchServicePreparedTakeoverRechecksDeadlineAfterLock(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-fresh-clock")
	original := fixture.pullSingleEnvelope(t)

	fixture.now = fixture.now.Add(time.Second)
	fixture.service.now = func() time.Time { return fixture.now }
	replacement := fixture.registerReplacementLease(
		t,
		"fresh-clock",
		fixture.session.GetCapabilities(),
		63,
	)

	markPreparedExternalReplay(t, fixture, original, "external-key-fresh-clock")
	prepared := receiptForEnvelope(
		original,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit fresh-clock PREPARED: response=%+v err=%v", response, err)
	}

	scanNow := fixture.now.Add(time.Second)
	expiredNow := original.GetExecutionDeadline().AsTime().Add(time.Second)
	clockReads := 0
	fixture.service.now = func() time.Time {
		clockReads++
		if clockReads == 1 {
			return scanNow
		}
		return expiredNow
	}
	affected, err := fixture.service.ReconcilePreparedCapabilityTakeovers(context.Background())
	if err != nil {
		t.Fatalf("reconcile fresh-clock takeover: %v", err)
	}
	if affected != 0 {
		t.Fatalf("fresh-clock takeover affected %d calls, want 0", affected)
	}

	var call persistence.ToolCall
	if err := fixture.db.First(&call, "tool_call_id = ?", original.GetToolCallId()).Error; err != nil {
		t.Fatalf("reload fresh-clock tool call: %v", err)
	}
	if call.Status != persistence.ToolCallStatusPrepared ||
		call.FencingToken != original.GetFencingToken() ||
		call.ReceiptRecoveryCredentialID != original.GetRecoveryCredential().GetCredentialId() {
		t.Fatalf("fresh-clock rejection changed tool call authority: %+v", call)
	}
	var credential persistence.ReceiptRecoveryCredential
	if err := fixture.db.First(
		&credential,
		"id = ?",
		original.GetRecoveryCredential().GetCredentialId(),
	).Error; err != nil {
		t.Fatalf("reload fresh-clock recovery credential: %v", err)
	}
	if credential.InvalidatedAt != nil || credential.ConsumedAt != nil {
		t.Fatalf("fresh-clock rejection consumed credential: %+v", credential)
	}
	var replacementOutboxCount int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Where("capability_session_id = ?", replacement.GetCapabilitySessionId()).
		Count(&replacementOutboxCount).Error; err != nil {
		t.Fatalf("count fresh-clock replacement outbox rows: %v", err)
	}
	if replacementOutboxCount != 0 {
		t.Fatalf("fresh-clock rejection created %d replacement outbox rows", replacementOutboxCount)
	}
}

func TestToolDispatchServiceTerminalRecoveryWinsBeforeTakeover(t *testing.T) {
	fixture, original := preparedExternalReplayCall(t, "recovery-first")
	revokedAt := fixture.now
	if err := fixture.db.Model(&persistence.ClientCapabilityLease{}).
		Where("session_id = ?", original.GetCapabilitySessionId()).
		Updates(map[string]interface{}{
			"revoked_at":     revokedAt,
			"lease_revision": original.GetCapabilityLeaseRevision() + 1,
		}).Error; err != nil {
		t.Fatalf("revoke original capability lease: %v", err)
	}
	terminal := receiptForEnvelope(
		original,
		2,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	terminal.ResultId = "recovery-first-result"
	terminal.BoundedResult = []byte(`{"applied":true}`)
	signRecoveryReceipt(t, fixture, original, terminal)
	response, err := fixture.service.SubmitRecoveryReceipt(
		context.Background(),
		&model.SubmitClientCapabilityRecoveryReceiptRequest{Receipt: terminal},
	)
	if err != nil || !response.GetResult().GetAccepted() {
		t.Fatalf("commit recovery before takeover: response=%+v err=%v", response, err)
	}

	fixture.now = fixture.now.Add(time.Second)
	fixture.service.now = func() time.Time { return fixture.now }
	replacement := fixture.registerReplacementLease(
		t,
		"recovery-first",
		fixture.session.GetCapabilities(),
		71,
	)
	var outboxCount int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Where("capability_session_id = ?", replacement.GetCapabilitySessionId()).
		Count(&outboxCount).Error; err != nil {
		t.Fatalf("count recovery-first replacement outbox rows: %v", err)
	}
	if outboxCount != 0 {
		t.Fatalf("terminal recovery created %d takeover rows", outboxCount)
	}
	var call persistence.ToolCall
	if err := fixture.db.First(&call, "tool_call_id = ?", original.GetToolCallId()).Error; err != nil {
		t.Fatalf("reload recovery-first tool call: %v", err)
	}
	if call.Status != persistence.ToolCallStatusSucceeded ||
		call.FencingToken != original.GetFencingToken() {
		t.Fatalf("takeover changed terminal recovery state: %+v", call)
	}
}

func preparedRecoveryReceipt(
	t *testing.T,
	suffix string,
) (toolDispatchFixture, *model.ClientCapabilityRequest, *model.ClientCapabilityReceipt) {
	t.Helper()
	fixture := newToolDispatchFixture(t)
	fixture.propose(t, "tool-call-"+suffix)
	envelope := fixture.pullSingleEnvelope(t)
	if envelope.GetRecoveryCredential() == nil {
		t.Fatal("dispatch envelope has no recovery credential")
	}

	prepared := receiptForEnvelope(
		envelope,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit prepared receipt: response=%+v err=%v", response, err)
	}

	fixture.service.now = func() time.Time { return envelope.GetExecutionDeadline().AsTime().Add(time.Second) }
	terminal := receiptForEnvelope(
		envelope,
		2,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED,
	)
	terminal.ResultId = "result-" + suffix
	terminal.BoundedResult = []byte(`{"applied":true}`)
	terminal.OccurredAt = timestamppb.New(fixture.service.now())
	return fixture, envelope, terminal
}

func preparedExternalReplayCall(
	t *testing.T,
	suffix string,
) (toolDispatchFixture, *model.ClientCapabilityRequest) {
	t.Helper()
	fixture := newToolDispatchFixture(t)
	toolCallID := "tool-call-" + suffix
	fixture.propose(t, toolCallID)
	envelope := fixture.pullSingleEnvelope(t)
	markPreparedExternalReplay(t, fixture, envelope, "external-key-"+suffix)
	prepared := receiptForEnvelope(
		envelope,
		1,
		model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED,
	)
	if response, err := fixture.service.SubmitReceipt(
		context.Background(),
		fixture.actorID,
		fixture.deviceID,
		fixture.signedReceiptRequest(t, prepared),
	); err != nil || !response.GetAccepted() {
		t.Fatalf("submit external replay PREPARED: response=%+v err=%v", response, err)
	}
	return fixture, envelope
}

func markPreparedExternalReplay(
	t *testing.T,
	fixture toolDispatchFixture,
	envelope *model.ClientCapabilityRequest,
	externalKey string,
) {
	t.Helper()
	envelope.ReplayPolicy =
		model.ClientExecutionReplayPolicy_CLIENT_EXECUTION_REPLAY_POLICY_WITH_EXTERNAL_IDEMPOTENCY
	envelope.ExternalIdempotencyKey = externalKey
	envelope.PayloadHash = protoPayloadHash(envelope)
	credential := envelope.GetRecoveryCredential()
	scope := &model.ReceiptRecoveryScopePayload{
		ActorPtid:               fixture.actorID,
		DeviceId:                fixture.deviceID,
		RequestId:               envelope.GetRequestId(),
		ToolCallId:              envelope.GetToolCallId(),
		ExecutionClaimId:        envelope.GetExecutionClaimId(),
		CapabilityLeaseRevision: envelope.GetCapabilityLeaseRevision(),
		FencingToken:            envelope.GetFencingToken(),
		PayloadHash:             envelope.GetPayloadHash(),
		ReplayPolicy:            envelope.GetReplayPolicy(),
		ExecutionDeadline:       envelope.GetExecutionDeadline(),
		ReconciliationDeadline:  envelope.GetReconciliationDeadline(),
		CredentialId:            credential.GetCredentialId(),
		DeviceSigningKeyId:      credential.GetDeviceSigningKeyId(),
		Nonce:                   credential.GetNonce(),
	}
	scopeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(scope)
	if err != nil {
		t.Fatalf("encode external replay recovery scope: %v", err)
	}
	credential.ScopeHash = hashBytes(scopeBytes)
	encodedEnvelope, err := proto.MarshalOptions{Deterministic: true}.Marshal(envelope)
	if err != nil {
		t.Fatalf("encode external replay envelope: %v", err)
	}
	encodedResourceRefs, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ClientCapabilityRequest{ResourceRefs: envelope.GetResourceRefs()},
	)
	if err != nil {
		t.Fatalf("encode external replay resource references: %v", err)
	}
	if err := fixture.db.Model(&persistence.ToolCall{}).
		Where("tool_call_id = ?", envelope.GetToolCallId()).
		Updates(map[string]interface{}{
			"replay_policy":            persistence.ClientExecutionReplayPolicyExternalIdempotency,
			"external_idempotency_key": externalKey,
			"payload_hash":             envelope.GetPayloadHash(),
			"resource_refs":            encodedResourceRefs,
		}).Error; err != nil {
		t.Fatalf("seed externally idempotent PREPARED call: %v", err)
	}
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Where("request_id = ?", envelope.GetRequestId()).
		Updates(map[string]interface{}{
			"payload_hash": envelope.GetPayloadHash(),
			"envelope":     encodedEnvelope,
		}).Error; err != nil {
		t.Fatalf("seed externally idempotent outbox envelope: %v", err)
	}
	if err := fixture.db.Model(&persistence.ReceiptRecoveryCredential{}).
		Where("id = ?", envelope.GetRecoveryCredential().GetCredentialId()).
		Updates(map[string]interface{}{
			"replay_policy": persistence.ClientExecutionReplayPolicyExternalIdempotency,
			"payload_hash":  envelope.GetPayloadHash(),
			"scope_hash":    credential.GetScopeHash(),
		}).Error; err != nil {
		t.Fatalf("seed externally idempotent recovery credential: %v", err)
	}
}

func (f toolDispatchFixture) registerReplacementLease(
	t *testing.T,
	suffix string,
	capabilities []*model.ClientCapability,
	nonceByte byte,
) *model.ClientCapabilityLease {
	t.Helper()
	request := &model.RegisterClientCapabilityLeaseRequest{
		Advertisement: &model.ClientCapabilityAdvertisement{
			AdvertisementId:    "replacement-" + suffix,
			DeviceId:           f.deviceID,
			DeviceSigningKeyId: proofTestSigningKeyID,
			Platform:           model.ClientPlatform_CLIENT_PLATFORM_DESKTOP,
			ConnectionId:       "replacement-connection-" + suffix,
			Capabilities:       capabilities,
		},
	}
	f.signRequest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE,
		"replacement-register-"+suffix,
		nonceByte,
	)
	response, err := f.service.RegisterCapabilityLease(
		context.Background(),
		f.actorID,
		"replacement-auth-session-"+suffix,
		f.deviceID,
		request,
	)
	if err != nil {
		t.Fatalf("register replacement capability lease: %v", err)
	}
	if response.GetLease() == nil {
		t.Fatalf("replacement capability lease response = %+v", response)
	}
	return response.GetLease()
}

func signRecoveryReceipt(
	t *testing.T,
	fixture toolDispatchFixture,
	envelope *model.ClientCapabilityRequest,
	receipt *model.ClientCapabilityReceipt,
) {
	t.Helper()
	credential := envelope.GetRecoveryCredential()
	if credential == nil {
		t.Fatal("recovery credential is required")
	}
	receipt.RecoveryProof = &model.ReceiptRecoveryProof{
		CredentialId:       credential.GetCredentialId(),
		Nonce:              append([]byte(nil), credential.GetNonce()...),
		DeviceSigningKeyId: credential.GetDeviceSigningKeyId(),
	}
	digest, err := recoveryReceiptDigest(receipt)
	if err != nil {
		t.Fatalf("digest recovery receipt: %v", err)
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ReceiptRecoverySigningPayload{
			Domain:             receiptRecoveryDomain,
			CredentialId:       credential.GetCredentialId(),
			Nonce:              credential.GetNonce(),
			DeviceSigningKeyId: credential.GetDeviceSigningKeyId(),
			ScopeHash:          credential.GetScopeHash(),
			ReceiptDigest:      decodeHash(digest),
		},
	)
	if err != nil {
		t.Fatalf("marshal recovery signing payload: %v", err)
	}
	receipt.RecoveryProof.Signature = ed25519.Sign(fixture.privateKey, signingBytes)
}
