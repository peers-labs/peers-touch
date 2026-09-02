package service

import (
	"bytes"
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxPreparedTakeoversPerLease = 100

// ReconcilePreparedCapabilityTakeovers re-authorizes eligible PREPARED work
// through the newest active matching lease. Recovery credentials remain
// terminal-only and are never used to execute.
func (s *ToolDispatchService) ReconcilePreparedCapabilityTakeovers(
	ctx context.Context,
) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	now := s.now()
	var leases []persistence.ClientCapabilityLease
	if err := db.WithContext(ctx).
		Where("revoked_at IS NULL AND expires_at > ?", now).
		Order("created_at DESC, session_id DESC").
		Find(&leases).Error; err != nil {
		return 0, internalToolError("load active capability leases for takeover", err)
	}

	var affected int64
	for i := range leases {
		var taken int64
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var leaseRow persistence.ClientCapabilityLease
			if err := tx.Where("session_id = ?", leases[i].SessionID).
				First(&leaseRow).Error; err != nil {
				if err == gorm.ErrRecordNotFound {
					return nil
				}
				return internalToolError("lock takeover capability lease", err)
			}
			var err error
			taken, err = s.takeOverPreparedCallsForLeaseTx(tx, &leaseRow, now)
			return err
		})
		if err != nil {
			return affected, err
		}
		affected += taken
	}
	return affected, nil
}

func (s *ToolDispatchService) takeOverPreparedCallsForLeaseTx(
	tx *gorm.DB,
	leaseRow *persistence.ClientCapabilityLease,
	now time.Time,
) (int64, error) {
	var candidates []persistence.ToolCall
	if err := tx.Where(
		"actor_id = ? AND target_device_id = ? AND capability_session_id <> ? "+
			"AND status = ? AND result_persisted = ? AND replay_policy = ? "+
			"AND external_idempotency_key <> '' AND execution_deadline > ? "+
			"AND reconciliation_deadline > ?",
		leaseRow.ActorID,
		leaseRow.DeviceID,
		leaseRow.SessionID,
		persistence.ToolCallStatusPrepared,
		false,
		persistence.ClientExecutionReplayPolicyExternalIdempotency,
		now,
		now,
	).
		Order("updated_at ASC").
		Limit(maxPreparedTakeoversPerLease).
		Find(&candidates).Error; err != nil {
		return 0, internalToolError("load prepared capability takeover candidates", err)
	}

	var affected int64
	for i := range candidates {
		taken, err := s.takeOverPreparedCallTx(tx, &candidates[i], leaseRow)
		if err != nil {
			return affected, err
		}
		if taken {
			affected++
		}
	}
	return affected, nil
}

func (s *ToolDispatchService) takeOverPreparedCallTx(
	tx *gorm.DB,
	snapshot *persistence.ToolCall,
	leaseRow *persistence.ClientCapabilityLease,
) (bool, error) {
	if strings.TrimSpace(snapshot.ReceiptRecoveryCredentialID) == "" {
		return false, nil
	}

	var previousCredential persistence.ReceiptRecoveryCredential
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"id = ? AND invalidated_at IS NULL AND consumed_at IS NULL",
			snapshot.ReceiptRecoveryCredentialID,
		).
		First(&previousCredential).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, internalToolError("lock previous receipt recovery credential", err)
	}
	if !leaseRow.CreatedAt.After(previousCredential.IssuedAt) ||
		previousCredential.ActorID != leaseRow.ActorID ||
		previousCredential.DeviceID != leaseRow.DeviceID ||
		previousCredential.DeviceSigningKeyID != leaseRow.DeviceSigningKeyID ||
		previousCredential.ReplayPolicy != persistence.ClientExecutionReplayPolicyExternalIdempotency {
		return false, nil
	}

	var previousOutbox persistence.ToolDispatchOutbox
	if err := tx.Where("request_id = ?", previousCredential.RequestID).
		First(&previousOutbox).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, internalToolError("load previous capability dispatch", err)
	}
	var previousEnvelope model.ClientCapabilityRequest
	if err := proto.Unmarshal(previousOutbox.Envelope, &previousEnvelope); err != nil {
		return false, internalToolError("decode previous capability dispatch", err)
	}

	var call persistence.ToolCall
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", snapshot.ID).
		First(&call).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, internalToolError("lock prepared capability takeover", err)
	}
	var refs model.ClientCapabilityRequest
	if len(call.ResourceRefs) > 0 {
		if err := proto.Unmarshal(call.ResourceRefs, &refs); err != nil {
			return false, internalToolError("decode takeover resource references", err)
		}
	}
	if len(refs.GetResourceRefs()) > 0 {
		return false, nil
	}

	var preparedCount int64
	if err := tx.Model(&persistence.ToolReceiptAttempt{}).
		Where(
			"request_id = ? AND tool_call_id = ? AND fencing_token = ? "+
				"AND payload_hash = ? AND status = ? AND accepted = ?",
			previousCredential.RequestID,
			call.ToolCallID,
			call.FencingToken,
			call.PayloadHash,
			model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED.String(),
			true,
		).
		Count(&preparedCount).Error; err != nil {
		return false, internalToolError("verify prepared receipt before takeover", err)
	}
	if preparedCount != 1 {
		return false, nil
	}

	var batch persistence.ToolBatch
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND status = ?", call.ToolBatchID, persistence.ToolBatchStatusOpen).
		First(&batch).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, internalToolError("lock takeover tool batch", err)
	}

	var currentLeaseRow persistence.ClientCapabilityLease
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("session_id = ?", leaseRow.SessionID).
		First(&currentLeaseRow).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, internalToolError("lock current takeover capability lease", err)
	}
	var currentLease model.ClientCapabilityLease
	if err := proto.Unmarshal(currentLeaseRow.LeasePayload, &currentLease); err != nil {
		return false, internalToolError("decode current takeover capability lease", err)
	}
	commitNow := s.now()
	if !preparedCallMatchesTakeover(
		&call,
		&previousCredential,
		&previousOutbox,
		&previousEnvelope,
		&currentLeaseRow,
		&currentLease,
		commitNow,
	) {
		return false, nil
	}

	expectedFence := call.FencingToken
	previousCredentialID := call.ReceiptRecoveryCredentialID
	if err := s.issueCapabilityRequestTx(
		tx,
		&call,
		&currentLeaseRow,
		commitNow,
		persistence.ToolCallStatusPrepared,
		expectedFence,
		previousCredentialID,
	); err != nil {
		return false, err
	}
	return true, nil
}

func preparedCallMatchesTakeover(
	call *persistence.ToolCall,
	credential *persistence.ReceiptRecoveryCredential,
	outbox *persistence.ToolDispatchOutbox,
	envelope *model.ClientCapabilityRequest,
	leaseRow *persistence.ClientCapabilityLease,
	lease *model.ClientCapabilityLease,
	now time.Time,
) bool {
	storedResourceRefs, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ClientCapabilityRequest{ResourceRefs: envelope.GetResourceRefs()},
	)
	if err != nil {
		return false
	}
	recovery := envelope.GetRecoveryCredential()
	return call.Status == persistence.ToolCallStatusPrepared &&
		!call.ResultPersisted &&
		call.ReplayPolicy == persistence.ClientExecutionReplayPolicyExternalIdempotency &&
		strings.TrimSpace(call.ExternalIdempotencyKey) != "" &&
		call.ExecutionDeadline != nil &&
		call.ExecutionDeadline.After(now) &&
		call.ReconciliationDeadline != nil &&
		call.ReconciliationDeadline.After(now) &&
		envelope.GetExecutionDeadline() != nil &&
		envelope.GetReconciliationDeadline() != nil &&
		call.StartedAt != nil &&
		strings.TrimSpace(call.SideEffectReceipt) != "" &&
		call.ActorID == leaseRow.ActorID &&
		call.TargetDeviceID == leaseRow.DeviceID &&
		call.CapabilitySessionID != leaseRow.SessionID &&
		call.ReceiptRecoveryCredentialID == credential.ID &&
		call.ExecutionClaimID == credential.ExecutionClaimID &&
		call.FencingToken == credential.FencingToken &&
		call.PayloadHash == credential.PayloadHash &&
		call.ToolCallID == envelope.GetToolCallId() &&
		call.TurnID == envelope.GetTurnId() &&
		call.AttemptID == envelope.GetAttemptId() &&
		call.ToolBatchID == envelope.GetToolBatchId() &&
		call.CapabilitySessionID == envelope.GetCapabilitySessionId() &&
		call.TargetDeviceID == envelope.GetTargetDeviceId() &&
		call.CapabilityID == envelope.GetCapabilityId() &&
		call.SchemaVersion == envelope.GetSchemaVersion() &&
		bytes.Equal(call.BoundedArguments, envelope.GetBoundedArguments()) &&
		bytes.Equal(call.ResourceRefs, storedResourceRefs) &&
		call.ApprovalID == envelope.GetApprovalId() &&
		call.DecisionID == envelope.GetDecisionId() &&
		call.DecisionRevision == envelope.GetDecisionRevision() &&
		call.ExecutionClaimID == envelope.GetExecutionClaimId() &&
		call.ExecutorLeaseID == envelope.GetExecutorLeaseId() &&
		call.FencingToken == envelope.GetFencingToken() &&
		envelope.GetSequence() == envelope.GetDispatchSequence() &&
		call.DispatchSequence == envelope.GetDispatchSequence() &&
		call.CapabilityLeaseRevision == envelope.GetCapabilityLeaseRevision() &&
		call.PayloadHash == envelope.GetPayloadHash() &&
		protoPayloadHash(envelope) == envelope.GetPayloadHash() &&
		call.ReplayPolicy == int32(envelope.GetReplayPolicy()) &&
		call.ExternalIdempotencyKey == envelope.GetExternalIdempotencyKey() &&
		call.ExecutionDeadline.Equal(envelope.GetExecutionDeadline().AsTime()) &&
		call.ReconciliationDeadline.Equal(envelope.GetReconciliationDeadline().AsTime()) &&
		outbox.RequestID == envelope.GetRequestId() &&
		outbox.ActorID == call.ActorID &&
		outbox.CapabilitySessionID == call.CapabilitySessionID &&
		outbox.TargetDeviceID == call.TargetDeviceID &&
		outbox.ToolCallID == call.ToolCallID &&
		outbox.FencingToken == call.FencingToken &&
		outbox.CapabilityLeaseRevision == call.CapabilityLeaseRevision &&
		outbox.PayloadHash == call.PayloadHash &&
		outbox.AcknowledgedAt != nil &&
		recovery != nil &&
		recovery.GetCredentialId() == credential.ID &&
		recovery.GetDeviceSigningKeyId() == credential.DeviceSigningKeyID &&
		recovery.GetScopeHash() == credential.ScopeHash &&
		hashBytes(recovery.GetNonce()) == credential.NonceHash &&
		recovery.GetExpiresAt() != nil &&
		recovery.GetExpiresAt().AsTime().Equal(credential.ExpiresAt) &&
		credential.ExecutionDeadline.Equal(call.ExecutionDeadline.UTC()) &&
		credential.ReconciliationDeadline.Equal(call.ReconciliationDeadline.UTC()) &&
		credential.ExpiresAt.After(now) &&
		lease.GetCapabilitySessionId() == leaseRow.SessionID &&
		lease.GetPtid() == leaseRow.ActorID &&
		lease.GetDeviceId() == leaseRow.DeviceID &&
		lease.GetLeaseId() == leaseRow.LeaseID &&
		lease.GetLeaseRevision() == leaseRow.LeaseRevision &&
		lease.GetDeviceSigningKeyId() == leaseRow.DeviceSigningKeyID &&
		leaseAllowsCapability(lease, call.CapabilityID, call.SchemaVersion, len(call.BoundedArguments))
}
