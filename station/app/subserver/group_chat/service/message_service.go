package service

import (
	"context"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type MessageService interface {
	SendMessage(ctx context.Context, groupULID, senderDID string, msgType int, content, replyToULID string, mentionedDIDs []string, mentionAll bool) (*model.GroupMessage, error)
	GetMessages(ctx context.Context, groupULID, beforeULID string, limit int) ([]model.GroupMessage, bool, error)
	GetMessage(ctx context.Context, messageULID string) (*model.GroupMessage, error)
	RecallMessage(ctx context.Context, messageULID, actorDID string) error

	// Offline message management
	CreateOfflineMessages(ctx context.Context, groupULID, messageULID string, receiverDIDs []string) error
	GetOfflineMessages(ctx context.Context, receiverDID string, limit int) ([]model.GroupOfflineMessage, error)
	MarkOfflineMessageDelivered(ctx context.Context, offlineMessageULID string) error
	GetUndeliveredCount(ctx context.Context, receiverDID, groupULID string) (int64, error)
}

type messageService struct {
	dbName string
}

func NewMessageService(dbName string) MessageService {
	return &messageService{dbName: dbName}
}

func (s *messageService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
}

func (s *messageService) SendMessage(ctx context.Context, groupULID, senderDID string, msgType int, content, replyToULID string, mentionedDIDs []string, mentionAll bool) (*model.GroupMessage, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	// Auto-migrate tables
	if err := rds.AutoMigrate(&model.GroupMessage{}, &model.GroupOfflineMessage{}); err != nil {
		return nil, err
	}

	if msgType == 0 {
		msgType = model.MessageTypeText
	}

	now := time.Now()
	msg := &model.GroupMessage{
		ULID:          ulid.Make().String(),
		GroupULID:     groupULID,
		SenderDID:     senderDID,
		Type:          msgType,
		Content:       content,
		ReplyToULID:   replyToULID,
		MentionedDIDs: model.StringSlice(mentionedDIDs),
		MentionAll:    mentionAll,
		SentAt:        now,
	}

	if err := rds.Create(msg).Error; err != nil {
		return nil, err
	}

	// Update group's updated_at
	rds.Model(&model.Group{}).Where("ul_id = ?", groupULID).Update("updated_at", now)

	return msg, nil
}

func (s *messageService) GetMessages(ctx context.Context, groupULID, beforeULID string, limit int) ([]model.GroupMessage, bool, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, false, err
	}

	// Ensure table exists
	if err := rds.AutoMigrate(&model.GroupMessage{}); err != nil {
		return nil, false, err
	}

	if limit <= 0 {
		limit = 50
	}

	query := rds.Where("group_ul_id = ?", groupULID)

	if beforeULID != "" {
		// Get the sent_at of the before message for pagination
		var beforeMsg model.GroupMessage
		if err := rds.Where("ul_id = ?", beforeULID).First(&beforeMsg).Error; err == nil {
			query = query.Where("sent_at < ?", beforeMsg.SentAt)
		}
	}

	var messages []model.GroupMessage
	if err := query.Order("sent_at DESC").Limit(limit + 1).Find(&messages).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	// Reverse to get chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, hasMore, nil
}

func (s *messageService) GetMessage(ctx context.Context, messageULID string) (*model.GroupMessage, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var msg model.GroupMessage
	if err := rds.Where("ul_id = ?", messageULID).First(&msg).Error; err != nil {
		return nil, err
	}

	return &msg, nil
}

func (s *messageService) RecallMessage(ctx context.Context, messageULID, actorDID string) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Only sender can recall their own message
	return rds.Model(&model.GroupMessage{}).
		Where("ul_id = ? AND sender_did = ?", messageULID, actorDID).
		Update("deleted", true).Error
}

// CreateOfflineMessages creates offline message records for receivers
func (s *messageService) CreateOfflineMessages(ctx context.Context, groupULID, messageULID string, receiverDIDs []string) error {
	if len(receiverDIDs) == 0 {
		return nil
	}

	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Ensure table exists
	if err := rds.AutoMigrate(&model.GroupOfflineMessage{}); err != nil {
		return err
	}

	now := time.Now()
	expireAt := now.Add(7 * 24 * time.Hour) // 7 days expiry

	var offlineMessages []model.GroupOfflineMessage
	for _, receiverDID := range receiverDIDs {
		offlineMessages = append(offlineMessages, model.GroupOfflineMessage{
			ULID:        ulid.Make().String(),
			GroupULID:   groupULID,
			ReceiverDID: receiverDID,
			MessageULID: messageULID,
			Status:      model.OfflineStatusPending,
			ExpireAt:    expireAt,
		})
	}

	return rds.CreateInBatches(offlineMessages, 100).Error
}

// GetOfflineMessages retrieves pending offline messages for a receiver
func (s *messageService) GetOfflineMessages(ctx context.Context, receiverDID string, limit int) ([]model.GroupOfflineMessage, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 100
	}

	var offlineMessages []model.GroupOfflineMessage
	if err := rds.Where("receiver_did = ? AND status = ? AND expire_at > ?",
		receiverDID, model.OfflineStatusPending, time.Now()).
		Order("created_at ASC").
		Limit(limit).
		Find(&offlineMessages).Error; err != nil {
		return nil, err
	}

	return offlineMessages, nil
}

// MarkOfflineMessageDelivered marks an offline message as delivered
func (s *messageService) MarkOfflineMessageDelivered(ctx context.Context, offlineMessageULID string) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return rds.Model(&model.GroupOfflineMessage{}).
		Where("ul_id = ?", offlineMessageULID).
		Updates(map[string]interface{}{
			"status":       model.OfflineStatusDelivered,
			"delivered_at": time.Now(),
		}).Error
}

// GetUndeliveredCount returns the count of undelivered messages for a receiver in a group
func (s *messageService) GetUndeliveredCount(ctx context.Context, receiverDID, groupULID string) (int64, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}

	var count int64
	query := rds.Model(&model.GroupOfflineMessage{}).
		Where("receiver_did = ? AND status = ? AND expire_at > ?",
			receiverDID, model.OfflineStatusPending, time.Now())

	if groupULID != "" {
		query = query.Where("group_ul_id = ?", groupULID)
	}

	if err := query.Count(&count).Error; err != nil {
		return 0, err
	}

	return count, nil
}
