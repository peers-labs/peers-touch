package service

import (
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

const clientCapabilityCommandRetention = 10 * time.Minute

func bindCapabilityCommandTx(
	tx *gorm.DB,
	actorID string,
	domain model.ClientCapabilityCommandDomain,
	verified *VerifiedCapabilityCommand,
	now time.Time,
) (*persistence.ClientCapabilityCommand, bool, error) {
	var existing persistence.ClientCapabilityCommand
	err := tx.Where(
		"actor_id = ? AND device_id = ? AND device_signing_key_id = ? AND nonce_hash = ?",
		actorID,
		verified.DeviceID,
		verified.SigningKeyID,
		verified.NonceHash,
	).First(&existing).Error
	if err == nil {
		if existing.CommandID != verified.CommandID ||
			existing.CommandDomain != int32(domain) ||
			existing.BodyHash != verified.BodyHash {
			return nil, false, &ClientCapabilityCommandProofError{
				Code:  model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_NONCE_CONFLICT,
				Cause: errors.New("capability command nonce is bound to another payload"),
			}
		}
		return &existing, true, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, internalToolError("load capability command replay", err)
	}
	row := &persistence.ClientCapabilityCommand{
		ActorID:            actorID,
		DeviceID:           verified.DeviceID,
		DeviceSigningKeyID: verified.SigningKeyID,
		NonceHash:          verified.NonceHash,
		CommandID:          verified.CommandID,
		CommandDomain:      int32(domain),
		BodyHash:           verified.BodyHash,
		IssuedAt:           verified.IssuedAt,
		CommittedAt:        now,
		ExpiresAt:          now.Add(clientCapabilityCommandRetention),
	}
	if err := tx.Create(row).Error; err != nil {
		return nil, false, internalToolError("persist capability command", err)
	}
	return row, false, nil
}

func storeCapabilityCommandOutcomeTx(
	tx *gorm.DB,
	commandID string,
	outcome int32,
	leaseID string,
	leaseRevision uint64,
	response []byte,
) error {
	result := tx.Model(&persistence.ClientCapabilityCommand{}).
		Where("command_id = ?", commandID).
		Updates(map[string]interface{}{
			"outcome_code":   outcome,
			"lease_id":       leaseID,
			"lease_revision": leaseRevision,
			"response_ref":   response,
		})
	if result.Error != nil {
		return internalToolError("persist capability command outcome", result.Error)
	}
	if result.RowsAffected != 1 {
		return invalidToolState("capability command outcome target changed")
	}
	return nil
}
