package service

import (
	"context"
	"time"

	"github.com/oklog/ulid/v2"
	fcmodel "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type MessageService interface {
	SendMessage(ctx context.Context, msg *SendMessageRequest) (*fcmodel.FriendChatMessage, error)
	GetMessage(ctx context.Context, msgULID string) (*fcmodel.FriendChatMessage, error)
	GetMessagesBySession(ctx context.Context, sessionULID string, beforeULID string, limit int) ([]*fcmodel.FriendChatMessage, bool, error)
	SyncMessages(ctx context.Context, sessionULID string, afterULID string, limit int) ([]*fcmodel.FriendChatMessage, error)
	UpdateMessageStatus(ctx context.Context, msgULID string, status int32) error
	MarkAsDelivered(ctx context.Context, msgULIDs []string) error
	MarkAsRead(ctx context.Context, msgULIDs []string) error
}

type SendMessageRequest struct {
	SessionULID string
	SenderDID   string
	ReceiverDID string
	Type        int32
	Content     string
	ReplyToULID string
}

type messageService struct {
	dbName         string
	sessionService SessionService
}

func NewMessageService(dbName string, sessionService SessionService) MessageService {
	return &messageService{
		dbName:         dbName,
		sessionService: sessionService,
	}
}

func (s *messageService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
}

func (s *messageService) SendMessage(ctx context.Context, req *SendMessageRequest) (*fcmodel.FriendChatMessage, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	msgULID := ulid.Make().String()

	msg := &fcmodel.FriendChatMessage{
		ULID:        msgULID,
		SessionULID: req.SessionULID,
		SenderDID:   req.SenderDID,
		ReceiverDID: req.ReceiverDID,
		Type:        req.Type,
		Content:     req.Content,
		ReplyToULID: req.ReplyToULID,
		Status:      1,
		SentAt:      now,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := db.Create(msg).Error; err != nil {
		return nil, err
	}

	if err := s.sessionService.UpdateLastMessage(ctx, req.SessionULID, msgULID, now); err != nil {
		return msg, err
	}

	if err := s.sessionService.IncrementUnreadCount(ctx, req.SessionULID, req.ReceiverDID); err != nil {
		return msg, err
	}

	return msg, nil
}

func (s *messageService) GetMessage(ctx context.Context, msgULID string) (*fcmodel.FriendChatMessage, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var msg fcmodel.FriendChatMessage
	if err := db.Where("ulid = ?", msgULID).First(&msg).Error; err != nil {
		return nil, err
	}

	return &msg, nil
}

func (s *messageService) GetMessagesBySession(ctx context.Context, sessionULID string, beforeULID string, limit int) ([]*fcmodel.FriendChatMessage, bool, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, false, err
	}

	if limit <= 0 {
		limit = 50
	}

	query := db.Where("session_ulid = ?", sessionULID)
	if beforeULID != "" {
		query = query.Where("ulid < ?", beforeULID)
	}

	var messages []*fcmodel.FriendChatMessage
	if err := query.Order("ulid DESC").Limit(limit + 1).Find(&messages).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	return messages, hasMore, nil
}

func (s *messageService) SyncMessages(ctx context.Context, sessionULID string, afterULID string, limit int) ([]*fcmodel.FriendChatMessage, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 100
	}

	query := db.Where("session_ulid = ?", sessionULID)
	if afterULID != "" {
		query = query.Where("ulid > ?", afterULID)
	}

	var messages []*fcmodel.FriendChatMessage
	if err := query.Order("ulid ASC").Limit(limit).Find(&messages).Error; err != nil {
		return nil, err
	}

	return messages, nil
}

func (s *messageService) UpdateMessageStatus(ctx context.Context, msgULID string, status int32) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.Model(&fcmodel.FriendChatMessage{}).
		Where("ulid = ?", msgULID).
		Updates(map[string]interface{}{
			"status":     status,
			"updated_at": time.Now(),
		}).Error
}

func (s *messageService) MarkAsDelivered(ctx context.Context, msgULIDs []string) error {
	if len(msgULIDs) == 0 {
		return nil
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	return db.Model(&fcmodel.FriendChatMessage{}).
		Where("ulid IN ? AND delivered_at IS NULL", msgULIDs).
		Updates(map[string]interface{}{
			"status":       3,
			"delivered_at": now,
			"updated_at":   now,
		}).Error
}

func (s *messageService) MarkAsRead(ctx context.Context, msgULIDs []string) error {
	if len(msgULIDs) == 0 {
		return nil
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	return db.Model(&fcmodel.FriendChatMessage{}).
		Where("ulid IN ? AND read_at IS NULL", msgULIDs).
		Updates(map[string]interface{}{
			"status":     4,
			"read_at":    now,
			"updated_at": now,
		}).Error
}
