package service

import (
	"context"
	"time"

	"github.com/oklog/ulid/v2"
	fcmodel "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	OfflineStatusPending   int32 = 1
	OfflineStatusDelivered int32 = 2
	OfflineStatusExpired   int32 = 3
)

type RelayService interface {
	StoreOfflineMessage(ctx context.Context, req *StoreOfflineRequest) (*fcmodel.OfflineMessage, error)
	GetPendingMessages(ctx context.Context, receiverDID string, limit int) ([]*fcmodel.OfflineMessage, error)
	AcknowledgeMessages(ctx context.Context, ulids []string) error
	CleanupExpiredMessages(ctx context.Context) (int64, error)
	GetPendingCount(ctx context.Context, receiverDID string) (int64, error)
}

type StoreOfflineRequest struct {
	MessageULID      string
	SenderDID        string
	ReceiverDID      string
	SessionULID      string
	EncryptedPayload []byte
	ExpireDuration   time.Duration
}

type relayService struct {
	dbName string
}

func NewRelayService(dbName string) RelayService {
	return &relayService{dbName: dbName}
}

func (s *relayService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
}

func (s *relayService) StoreOfflineMessage(ctx context.Context, req *StoreOfflineRequest) (*fcmodel.OfflineMessage, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	msgULID := req.MessageULID
	if msgULID == "" {
		msgULID = ulid.Make().String()
	}

	expireDuration := req.ExpireDuration
	if expireDuration <= 0 {
		expireDuration = 7 * 24 * time.Hour
	}

	now := time.Now()
	msg := &fcmodel.OfflineMessage{
		ULID:             msgULID,
		ReceiverDID:      req.ReceiverDID,
		SenderDID:        req.SenderDID,
		SessionULID:      req.SessionULID,
		EncryptedPayload: req.EncryptedPayload,
		Status:           OfflineStatusPending,
		ExpireAt:         now.Add(expireDuration),
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	if err := db.Create(msg).Error; err != nil {
		return nil, err
	}

	return msg, nil
}

func (s *relayService) GetPendingMessages(ctx context.Context, receiverDID string, limit int) ([]*fcmodel.OfflineMessage, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 100
	}

	var messages []*fcmodel.OfflineMessage
	if err := db.Where("receiver_did = ? AND status = ? AND expire_at > ?", receiverDID, OfflineStatusPending, time.Now()).
		Order("created_at ASC").
		Limit(limit).
		Find(&messages).Error; err != nil {
		return nil, err
	}

	return messages, nil
}

func (s *relayService) AcknowledgeMessages(ctx context.Context, ulids []string) error {
	if len(ulids) == 0 {
		return nil
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	return db.Model(&fcmodel.OfflineMessage{}).
		Where("ulid IN ?", ulids).
		Updates(map[string]interface{}{
			"status":       OfflineStatusDelivered,
			"delivered_at": now,
			"updated_at":   now,
		}).Error
}

func (s *relayService) CleanupExpiredMessages(ctx context.Context) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}

	result := db.Model(&fcmodel.OfflineMessage{}).
		Where("expire_at < ? AND status = ?", time.Now(), OfflineStatusPending).
		Updates(map[string]interface{}{
			"status":     OfflineStatusExpired,
			"updated_at": time.Now(),
		})

	return result.RowsAffected, result.Error
}

func (s *relayService) GetPendingCount(ctx context.Context, receiverDID string) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}

	var count int64
	if err := db.Model(&fcmodel.OfflineMessage{}).
		Where("receiver_did = ? AND status = ? AND expire_at > ?", receiverDID, OfflineStatusPending, time.Now()).
		Count(&count).Error; err != nil {
		return 0, err
	}

	return count, nil
}
