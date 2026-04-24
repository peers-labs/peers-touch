// Package application — ChatDebugService exposes read-only debug stats
// for chat-related domains, used exclusively by the Station dashboard.
//
// Change History:
//   - 2026-04-10: Initial implementation — friend chat table counts.
//   - 2026-04-22: Migrated FriendChatStats DTO to domain layer for proper
//     DDD layering; return type changed to *domain.FriendChatStatsResponse.
package application

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	friendchatinfra "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/infrastructure"
	"gorm.io/gorm"
)

// ChatDebugService exposes read-only debug stats for chat-related domains.
// It is used exclusively by the Station dashboard (admin-facing).
type ChatDebugService struct {
	db *gorm.DB
}

func NewChatDebugService(db *gorm.DB) *ChatDebugService {
	return &ChatDebugService{db: db}
}

// FriendChatStats returns aggregate table counts for all friend-chat tables.
func (s *ChatDebugService) FriendChatStats(ctx context.Context) (*domain.FriendChatStatsResponse, error) {
	out := &domain.FriendChatStatsResponse{UpdatedAt: time.Now()}

	if err := s.db.WithContext(ctx).Model(&friendchatinfra.SessionModel{}).Count(&out.Sessions).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.MessageModel{}).Count(&out.Messages).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.FriendRequestModel{}).Count(&out.FriendRequests).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.OutboxModel{}).Count(&out.Outbox).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Model(&friendchatinfra.MessageAttachmentModel{}).Count(&out.Attachments).Error; err != nil {
		return nil, err
	}

	return out, nil
}
