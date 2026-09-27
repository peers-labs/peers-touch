package service

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const receiptRecoveryDomain = "peers-touch/agent/tool-receipt-recovery/v1"

func (s *ToolDispatchService) SubmitRecoveryReceipt(
	ctx context.Context,
	request *model.SubmitClientCapabilityRecoveryReceiptRequest,
) (*model.SubmitClientCapabilityRecoveryReceiptResponse, error) {
	if request == nil || request.GetReceipt() == nil || request.GetReceipt().GetRecoveryProof() == nil {
		return &model.SubmitClientCapabilityRecoveryReceiptResponse{
			Result: &model.SubmitClientCapabilityReceiptResponse{
				ErrorCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_REQUIRED,
			},
		}, nil
	}
	if s.capabilityProof == nil || s.capabilityProof.resolver == nil {
		return nil, internalToolError("verify receipt recovery", errors.New("device key resolver is not configured"))
	}
	receipt := request.GetReceipt()
	if receipt.GetStatus() != model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED &&
		receipt.GetStatus() != model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_FAILED &&
		receipt.GetStatus() != model.ClientCapabilityReceiptStatus_CLIENT_CAPABILITY_RECEIPT_STATUS_RECONCILED_UNKNOWN {
		return &model.SubmitClientCapabilityRecoveryReceiptResponse{
			Result: &model.SubmitClientCapabilityReceiptResponse{
				ErrorCode: model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_INVALID_TRANSITION,
			},
		}, nil
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	result := &model.SubmitClientCapabilityReceiptResponse{}
	actorPTID := ""
	consumedCredentialID := ""
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		proof := receipt.GetRecoveryProof()
		var credential persistence.ReceiptRecoveryCredential
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", proof.GetCredentialId()).
			First(&credential).Error; err != nil {
			result.ErrorCode = model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_SCOPE_MISMATCH
			return nil
		}
		now := s.now()
		actorPTID = credential.ActorID
		if credential.InvalidatedAt != nil || !credential.ExpiresAt.After(now) {
			receiptDigest, err := recoveryReceiptDigest(receipt)
			if err != nil {
				return err
			}
			replayed, found, err := loadReceiptReplayTx(tx, receipt, receiptDigest)
			if err != nil {
				return err
			}
			if found {
				result = replayed
				return nil
			}
			code := model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_CREDENTIAL_EXPIRED
			if err := storeReceiptAttemptTx(tx, receipt, receiptDigest, false, code.String(), now); err != nil {
				return err
			}
			result.ErrorCode = code
			return nil
		}
		if subtle.ConstantTimeCompare(
			[]byte(credential.NonceHash),
			[]byte(hashBytes(proof.GetNonce())),
		) != 1 ||
			credential.RequestID != receipt.GetRequestId() ||
			credential.ToolCallID != receipt.GetToolCallId() ||
			credential.DeviceSigningKeyID != proof.GetDeviceSigningKeyId() {
			result.ErrorCode = model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_SCOPE_MISMATCH
			return nil
		}

		receiptDigest, err := recoveryReceiptDigest(receipt)
		if err != nil {
			return err
		}
		if credential.ConsumedAt != nil {
			if credential.ConsumedReceiptDigest != receiptDigest {
				result.ErrorCode = model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_NONCE_CONFLICT
				return nil
			}
			if len(credential.ConsumedAckRef) > 0 {
				if err := proto.Unmarshal(credential.ConsumedAckRef, result); err != nil {
					return internalToolError("decode recovery acknowledgement", err)
				}
			}
			result.Replayed = true
			return nil
		}

		key, err := s.capabilityProof.resolver.ResolveSigningKey(
			ctx,
			credential.ActorID,
			credential.DeviceID,
			credential.DeviceSigningKeyID,
		)
		if err != nil ||
			key == nil ||
			key.GetRevokedAtUnixMs() > 0 ||
			key.GetActorPtid() != credential.ActorID ||
			key.GetActorDeviceId() != credential.DeviceID ||
			key.GetSigningKeyId() != credential.DeviceSigningKeyID ||
			len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
			key.GetVerificationSource() ==
				touchmodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED {
			result.ErrorCode = model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_DEVICE_KEY_REVOKED
			return nil
		}
		signingPayload := &model.ReceiptRecoverySigningPayload{
			Domain:             receiptRecoveryDomain,
			CredentialId:       credential.ID,
			Nonce:              proof.GetNonce(),
			DeviceSigningKeyId: credential.DeviceSigningKeyID,
			ScopeHash:          credential.ScopeHash,
			ReceiptDigest:      decodeHash(receiptDigest),
		}
		signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(signingPayload)
		if err != nil {
			return internalToolError("encode recovery signing payload", err)
		}
		if len(proof.GetSignature()) != ed25519.SignatureSize ||
			!ed25519.Verify(ed25519.PublicKey(key.GetEd25519PublicKey()), signingBytes, proof.GetSignature()) {
			result.ErrorCode = model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_SIGNATURE_INVALID
			return nil
		}

		var call persistence.ToolCall
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("tool_call_id = ?", credential.ToolCallID).
			First(&call).Error; err != nil {
			return notFoundToolError("tool call", err)
		}
		var outbox persistence.ToolDispatchOutbox
		if err := tx.Where("request_id = ?", credential.RequestID).First(&outbox).Error; err != nil {
			return notFoundToolError("client capability request", err)
		}
		if call.ExecutionClaimID != credential.ExecutionClaimID ||
			call.FencingToken != credential.FencingToken ||
			call.PayloadHash != credential.PayloadHash ||
			call.ReceiptRecoveryCredentialID != credential.ID ||
			call.StartedAt == nil ||
			strings.TrimSpace(call.SideEffectReceipt) == "" ||
			outbox.ActorID != credential.ActorID ||
			outbox.TargetDeviceID != credential.DeviceID ||
			outbox.CapabilityLeaseRevision != credential.CapabilityLeaseRevision ||
			receipt.GetCapabilitySessionId() != call.CapabilitySessionID ||
			receipt.GetTargetDeviceId() != credential.DeviceID ||
			receipt.GetTurnId() != call.TurnID ||
			receipt.GetToolBatchId() != call.ToolBatchID ||
			receipt.GetDecisionId() != call.DecisionID ||
			receipt.GetDecisionRevision() != call.DecisionRevision ||
			receipt.GetExecutionClaimId() != call.ExecutionClaimID ||
			receipt.GetExecutorLeaseId() != call.ExecutorLeaseID ||
			receipt.GetFencingToken() != call.FencingToken ||
			receipt.GetDispatchSequence() != call.DispatchSequence ||
			receipt.GetPayloadHash() != call.PayloadHash ||
			!credential.ReconciliationDeadline.After(now) ||
			strings.TrimSpace(receipt.GetResultId()) == "" {
			result.ErrorCode = model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_SCOPE_MISMATCH
			return nil
		}
		if err := storeReceiptAttemptTx(tx, receipt, receiptDigest, true, "", now); err != nil {
			return err
		}
		if err := s.commitTerminalReceiptTx(tx, &call, receipt, now, result); err != nil {
			return err
		}
		ack, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
		if err != nil {
			return internalToolError("encode recovery acknowledgement", err)
		}
		credential.ConsumedReceiptDigest = receiptDigest
		credential.ConsumedResultID = result.GetResultId()
		credential.ConsumedAckRef = ack
		credential.ConsumedAt = &now
		actorPTID = credential.ActorID
		consumedCredentialID = credential.ID
		return tx.Save(&credential).Error
	})
	if err == nil &&
		result.GetErrorCode() ==
			model.ClientCapabilityReceiptErrorCode_CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_RECOVERY_CREDENTIAL_EXPIRED &&
		s.matchesAcceptanceTuple(actorPTID, "ERR-O06", "single") {
		if settleErr := s.settleAcceptanceRejectedReceipt(
			ctx,
			actorPTID,
			receipt.GetToolCallId(),
			result.GetErrorCode().String(),
		); settleErr != nil {
			return nil, settleErr
		}
	}
	if err == nil && result.GetAccepted() && actorPTID != "" &&
		!s.matchesAcceptanceBarrier(
			actorPTID,
			capabilityBarrierResultBeforeContinue,
		) {
		continuationID, ensureErr := s.EnsureReadyContinuationForToolCall(
			ctx,
			actorPTID,
			receipt.GetToolCallId(),
		)
		if ensureErr != nil {
			return nil, ensureErr
		}
		result.ContinuationId = continuationID
		if consumedCredentialID != "" {
			ack, marshalErr := proto.MarshalOptions{Deterministic: true}.Marshal(result)
			if marshalErr != nil {
				return nil, internalToolError(
					"encode recovery acknowledgement",
					marshalErr,
				)
			}
			if updateErr := db.WithContext(ctx).
				Model(&persistence.ReceiptRecoveryCredential{}).
				Where(
					"id = ? AND consumed_result_id = ?",
					consumedCredentialID,
					result.GetResultId(),
				).
				Update("consumed_ack_ref", ack).Error; updateErr != nil {
				return nil, internalToolError(
					"update recovery acknowledgement continuation",
					updateErr,
				)
			}
		}
	}
	return &model.SubmitClientCapabilityRecoveryReceiptResponse{Result: result}, err
}

func recoveryReceiptDigest(receipt *model.ClientCapabilityReceipt) (string, error) {
	cloned := proto.Clone(receipt).(*model.ClientCapabilityReceipt)
	cloned.RecoveryProof = nil
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(cloned)
	if err != nil {
		return "", internalToolError("encode recovery receipt digest", err)
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func decodeHash(value string) []byte {
	decoded, err := hex.DecodeString(value)
	if err != nil {
		return nil
	}
	return decoded
}
