package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type FederationInboxModel struct {
	SourceStationID string    `gorm:"column:source_station_id;size:255;primaryKey"`
	IdempotencyKey  string    `gorm:"column:idempotency_key;size:255;primaryKey"`
	FrameID         string    `gorm:"column:frame_id;size:128;not null"`
	FrameSHA256     []byte    `gorm:"column:frame_sha256;type:bytea;not null"`
	ReceivedAt      time.Time `gorm:"column:received_at;not null"`
}

func (*FederationInboxModel) TableName() string {
	return "messaging_federation_inbox"
}

type FederationInboxUnitOfWork struct {
	db     *gorm.DB
	limits messaging.QueueLimits
}

func NewFederationInboxUnitOfWork(
	db *gorm.DB,
	limits messaging.QueueLimits,
) *FederationInboxUnitOfWork {
	return &FederationInboxUnitOfWork{db: db, limits: limits}
}

func (u *FederationInboxUnitOfWork) AutoMigrate() error {
	if err := u.db.AutoMigrate(&FederationInboxModel{}); err != nil {
		return err
	}
	follower, err := NewFollowerRepository(u.db)
	if err != nil {
		return err
	}
	if err := follower.AutoMigrate(); err != nil {
		return err
	}
	queue, err := NewQueueRepository(u.db, u.limits)
	if err != nil {
		return err
	}
	return queue.AutoMigrate()
}

func (u *FederationInboxUnitOfWork) MatchFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
) (bool, error) {
	frameBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		return false, err
	}
	frameHash := sha256.Sum256(frameBytes)
	var existing FederationInboxModel
	err = u.db.WithContext(ctx).Where(
		"source_station_id = ? AND idempotency_key = ?",
		frame.SourceStationId,
		frame.IdempotencyKey,
	).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if existing.FrameID != frame.FrameId ||
		!bytes.Equal(existing.FrameSHA256, frameHash[:]) {
		return false, messaging.ErrFederationFrameConflict
	}
	return true, nil
}

func (u *FederationInboxUnitOfWork) IngestFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	receivedAt time.Time,
	fn func(messaging.FederationInboxRepositories) (messaging.FederationInboxMutation, error),
) (bool, bool, error) {
	frameBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		return false, false, err
	}
	frameHash := sha256.Sum256(frameBytes)
	duplicate := false
	acknowledged := false
	err = u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing FederationInboxModel
		err := tx.Where(
			"source_station_id = ? AND idempotency_key = ?",
			frame.SourceStationId,
			frame.IdempotencyKey,
		).First(&existing).Error
		if err == nil {
			if existing.FrameID != frame.FrameId ||
				!bytes.Equal(existing.FrameSHA256, frameHash[:]) {
				return messaging.ErrFederationFrameConflict
			}
			duplicate = true
			acknowledged = true
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		queue, err := NewQueueRepository(tx, u.limits)
		if err != nil {
			return err
		}
		follower, err := NewFollowerRepository(tx)
		if err != nil {
			return err
		}
		mutation, err := fn(messaging.FederationInboxRepositories{
			Queue:    queue,
			Follower: follower,
		})
		if err != nil {
			return err
		}
		if !mutation.Acknowledge {
			return nil
		}
		if err := tx.Create(&FederationInboxModel{
			SourceStationID: frame.SourceStationId,
			IdempotencyKey:  frame.IdempotencyKey,
			FrameID:         frame.FrameId,
			FrameSHA256:     frameHash[:],
			ReceivedAt:      receivedAt,
		}).Error; err != nil {
			return err
		}
		acknowledged = true
		return nil
	})
	return duplicate, acknowledged, err
}

func (u *FederationInboxUnitOfWork) ExecuteFollower(
	ctx context.Context,
	fn func(messaging.FollowerRepository) error,
) error {
	return u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		follower, err := NewFollowerRepository(tx)
		if err != nil {
			return err
		}
		return fn(follower)
	})
}

var _ messaging.FederationInboxUnitOfWork = (*FederationInboxUnitOfWork)(nil)
