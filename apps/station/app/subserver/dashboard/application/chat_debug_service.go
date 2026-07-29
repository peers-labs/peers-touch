package application

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"gorm.io/gorm"
)

type ChatDebugService struct {
	db *gorm.DB
}

func NewChatDebugService(db *gorm.DB) *ChatDebugService {
	return &ChatDebugService{db: db}
}

func (s *ChatDebugService) FriendChatStats(ctx context.Context) (*domain.FriendChatStatsResponse, error) {
	return &domain.FriendChatStatsResponse{UpdatedAt: time.Now()}, nil
}
