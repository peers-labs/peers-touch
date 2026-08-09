package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	federationOutboxPending    = "pending"
	federationOutboxClaimed    = "claimed"
	federationOutboxRetryWait  = "retry_wait"
	federationOutboxDelivered  = "delivered"
	federationOutboxDeadLetter = "dead_letter"
)

type FederationOutboxModel struct {
	FrameID         string     `gorm:"column:frame_id;size:128;primaryKey"`
	SourceStationID string     `gorm:"column:source_station_id;size:255;not null;uniqueIndex:uidx_federation_idempotency"`
	TargetStationID string     `gorm:"column:target_station_id;size:255;not null;index"`
	IdempotencyKey  string     `gorm:"column:idempotency_key;size:255;not null;uniqueIndex:uidx_federation_idempotency"`
	FrameBytes      []byte     `gorm:"column:frame_bytes;type:bytea;not null"`
	FrameSHA256     []byte     `gorm:"column:frame_sha256;type:bytea;not null"`
	State           string     `gorm:"column:state;size:32;not null;index"`
	AttemptCount    uint32     `gorm:"column:attempt_count;not null"`
	NextAttemptAt   time.Time  `gorm:"column:next_attempt_at;not null;index"`
	LeaseOwner      string     `gorm:"column:lease_owner;size:255"`
	LeaseGeneration uint64     `gorm:"column:lease_generation;not null"`
	LeaseExpiresAt  *time.Time `gorm:"column:lease_expires_at;index"`
	CreatedAt       time.Time  `gorm:"column:created_at;not null"`
	DeliveredAt     *time.Time `gorm:"column:delivered_at"`
	LastErrorCode   string     `gorm:"column:last_error_code;size:128"`
}

func (*FederationOutboxModel) TableName() string {
	return "messaging_federation_outbox"
}

type FederationRepository struct {
	db *gorm.DB
}

func NewFederationRepository(db *gorm.DB) *FederationRepository {
	return &FederationRepository{db: db}
}

func (r *FederationRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&FederationOutboxModel{})
}

func (r *FederationRepository) EnqueueFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	now time.Time,
) error {
	if frame == nil || frame.FrameId == "" || frame.IdempotencyKey == "" {
		return messaging.ErrFederationFrameInvalid
	}
	frameBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		return err
	}
	frameHash := sha256.Sum256(frameBytes)
	model := &FederationOutboxModel{
		FrameID:         frame.FrameId,
		SourceStationID: frame.SourceStationId,
		TargetStationID: frame.TargetStationId,
		IdempotencyKey:  frame.IdempotencyKey,
		FrameBytes:      frameBytes,
		FrameSHA256:     frameHash[:],
		State:           federationOutboxPending,
		NextAttemptAt:   now,
		CreatedAt:       now,
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing FederationOutboxModel
	if err := r.db.WithContext(ctx).
		Where("source_station_id = ? AND idempotency_key = ?", frame.SourceStationId, frame.IdempotencyKey).
		First(&existing).Error; err != nil {
		return err
	}
	if existing.FrameID != frame.FrameId || !bytes.Equal(existing.FrameSHA256, frameHash[:]) {
		return messaging.ErrFederationFrameConflict
	}
	return nil
}

func (r *FederationRepository) ClaimFederationFrames(
	ctx context.Context,
	dispatcherID string,
	limit int,
	now time.Time,
	leaseDuration time.Duration,
) ([]messaging.FederationOutboxClaim, error) {
	if dispatcherID == "" || limit <= 0 || limit > 100 || leaseDuration <= 0 {
		return nil, fmt.Errorf("messaging: invalid federation claim")
	}
	var claims []messaging.FederationOutboxClaim
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var models []FederationOutboxModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where(
				"(state IN ? AND next_attempt_at <= ?) OR (state = ? AND lease_expires_at <= ?)",
				[]string{federationOutboxPending, federationOutboxRetryWait},
				now,
				federationOutboxClaimed,
				now,
			).
			Order("created_at ASC, frame_id ASC").
			Limit(limit).
			Find(&models).Error; err != nil {
			return err
		}
		leaseExpiresAt := now.Add(leaseDuration)
		for index := range models {
			model := &models[index]
			model.State = federationOutboxClaimed
			model.LeaseOwner = dispatcherID
			model.LeaseGeneration++
			model.LeaseExpiresAt = &leaseExpiresAt
			model.AttemptCount++
			if err := tx.Save(model).Error; err != nil {
				return err
			}
			frame := &chat.MessagingFederationFrame{}
			if err := proto.Unmarshal(model.FrameBytes, frame); err != nil {
				return err
			}
			claims = append(claims, messaging.FederationOutboxClaim{
				Frame:           frame,
				LeaseGeneration: model.LeaseGeneration,
				AttemptCount:    model.AttemptCount,
			})
		}
		return nil
	})
	return claims, err
}

func (r *FederationRepository) MarkFederationDelivered(
	ctx context.Context,
	frameID string,
	dispatcherID string,
	leaseGeneration uint64,
	deliveredAt time.Time,
) error {
	return r.updateClaimed(
		ctx,
		frameID,
		dispatcherID,
		leaseGeneration,
		map[string]any{
			"state":            federationOutboxDelivered,
			"delivered_at":     deliveredAt,
			"lease_owner":      "",
			"lease_expires_at": nil,
		},
	)
}

func (r *FederationRepository) ScheduleFederationRetry(
	ctx context.Context,
	frameID string,
	dispatcherID string,
	leaseGeneration uint64,
	nextAttemptAt time.Time,
	errorCode string,
) error {
	return r.updateClaimed(
		ctx,
		frameID,
		dispatcherID,
		leaseGeneration,
		map[string]any{
			"state":            federationOutboxRetryWait,
			"next_attempt_at":  nextAttemptAt,
			"last_error_code":  errorCode,
			"lease_owner":      "",
			"lease_expires_at": nil,
		},
	)
}

func (r *FederationRepository) MarkFederationDeadLetter(
	ctx context.Context,
	frameID string,
	dispatcherID string,
	leaseGeneration uint64,
	errorCode string,
) error {
	return r.updateClaimed(
		ctx,
		frameID,
		dispatcherID,
		leaseGeneration,
		map[string]any{
			"state":            federationOutboxDeadLetter,
			"last_error_code":  errorCode,
			"lease_owner":      "",
			"lease_expires_at": nil,
		},
	)
}

func (r *FederationRepository) updateClaimed(
	ctx context.Context,
	frameID string,
	dispatcherID string,
	leaseGeneration uint64,
	updates map[string]any,
) error {
	result := r.db.WithContext(ctx).
		Model(&FederationOutboxModel{}).
		Where(
			"frame_id = ? AND state = ? AND lease_owner = ? AND lease_generation = ?",
			frameID,
			federationOutboxClaimed,
			dispatcherID,
			leaseGeneration,
		).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrFederationDispatcherFenced
	}
	return nil
}

var _ messaging.FederationOutboxRepository = (*FederationRepository)(nil)
