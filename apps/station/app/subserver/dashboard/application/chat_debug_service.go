package application

import (
	"context"
	"time"

	friendchatinfra "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/infrastructure"
	"gorm.io/gorm"
)

type FriendChatStats struct {
	Sessions       int64     `json:"sessions"`
	Messages       int64     `json:"messages"`
	FriendRequests int64     `json:"friend_requests"`
	Outbox         int64     `json:"outbox"`
	Attachments    int64     `json:"attachments"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// ChatDebugService exposes read-only debug stats for chat-related domains.
// It is used exclusively by the Station dashboard (admin-facing).
type ChatDebugService struct {
	db *gorm.DB
}

func NewChatDebugService(db *gorm.DB) *ChatDebugService {
	return &ChatDebugService{db: db}
}

func (s *ChatDebugService) FriendChatStats(ctx context.Context) (FriendChatStats, error) {
	var out FriendChatStats
	out.UpdatedAt = time.Now()

	if err := s.db.WithContext(ctx).Model(&friendchatinfra.SessionModel{}).Count(&out.Sessions).Error; err != nil {
		return FriendChatStats{}, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.MessageModel{}).Count(&out.Messages).Error; err != nil {
		return FriendChatStats{}, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.FriendRequestModel{}).Count(&out.FriendRequests).Error; err != nil {
		return FriendChatStats{}, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.OutboxModel{}).Count(&out.Outbox).Error; err != nil {
		return FriendChatStats{}, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.MessageAttachmentModel{}).Count(&out.Attachments).Error; err != nil {
		return FriendChatStats{}, err
	}

	return out, nil
}
