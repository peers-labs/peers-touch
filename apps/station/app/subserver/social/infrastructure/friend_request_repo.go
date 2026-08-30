package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"gorm.io/gorm"
)

type friendRequestModel struct {
	ID           uint      `gorm:"column:id;primaryKey"`
	RequestID    string    `gorm:"column:request_id;size:64;uniqueIndex"`
	PairKey      string    `gorm:"column:pair_key;size:255;uniqueIndex:idx_fr_pair_status"`
	SenderPtid   string    `gorm:"column:sender_ptid;size:255;index"`
	ReceiverPtid string    `gorm:"column:receiver_ptid;size:255;index"`
	Status       int32     `gorm:"column:status;uniqueIndex:idx_fr_pair_status"`
	Message      string    `gorm:"column:message;type:text"`
	CreatedAt    time.Time `gorm:"column:created_at"`
	UpdatedAt    time.Time `gorm:"column:updated_at"`
}

func (*friendRequestModel) TableName() string { return "friend_chat_friend_requests" }

type FriendRequestRepository interface {
	CreateFriendRequest(ctx context.Context, senderPTID, receiverPTID, message string) (domain.FriendRequest, error)
	GetFriendRequest(ctx context.Context, requestID string) (*domain.FriendRequest, error)
	AcceptFriendRequest(ctx context.Context, requestID string) (*domain.FriendRequest, error)
	RejectFriendRequest(ctx context.Context, requestID string) (*domain.FriendRequest, error)
	ListFriendRequests(ctx context.Context, actorPTID string, status int32, limit, offset int) ([]domain.FriendRequest, int, error)
}

type friendRequestRepository struct {
	db *gorm.DB
}

func NewFriendRequestRepository(gdb *gorm.DB) FriendRequestRepository {
	return &friendRequestRepository{db: gdb}
}

func friendRequestPairKey(a, b string) string {
	items := []string{a, b}
	sort.Strings(items)
	return strings.Join(items, "|")
}

func toDomainFriendRequest(m friendRequestModel) domain.FriendRequest {
	return domain.FriendRequest{
		ID:           m.RequestID,
		SenderPtid:   m.SenderPtid,
		ReceiverPtid: m.ReceiverPtid,
		Status:       m.Status,
		Message:      m.Message,
		CreatedAt:    m.CreatedAt,
		UpdatedAt:    m.UpdatedAt,
	}
}

func (r *friendRequestRepository) CreateFriendRequest(ctx context.Context, senderPTID, receiverPTID, message string) (domain.FriendRequest, error) {
	now := time.Now()
	key := friendRequestPairKey(senderPTID, receiverPTID)

	var existing friendRequestModel
	err := r.db.WithContext(ctx).Where("pair_key = ? AND status = ?", key, domain.FriendRequestStatusPending).First(&existing).Error
	if err == nil {
		return toDomainFriendRequest(existing), nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.FriendRequest{}, err
	}

	err = r.db.WithContext(ctx).Where("pair_key = ? AND status = ?", key, domain.FriendRequestStatusAccepted).First(&existing).Error
	if err == nil {
		return domain.FriendRequest{}, errors.New("already friends")
	}

	record := friendRequestModel{
		RequestID:    fmt.Sprintf("fr-%d", now.UnixNano()),
		PairKey:      key,
		SenderPtid:   senderPTID,
		ReceiverPtid: receiverPTID,
		Status:       domain.FriendRequestStatusPending,
		Message:      message,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := r.db.WithContext(ctx).Create(&record).Error; err != nil {
		return domain.FriendRequest{}, err
	}
	return toDomainFriendRequest(record), nil
}

func (r *friendRequestRepository) GetFriendRequest(ctx context.Context, requestID string) (*domain.FriendRequest, error) {
	var record friendRequestModel
	if err := r.db.WithContext(ctx).Where("request_id = ?", requestID).First(&record).Error; err != nil {
		return nil, err
	}
	fr := toDomainFriendRequest(record)
	return &fr, nil
}

func (r *friendRequestRepository) AcceptFriendRequest(ctx context.Context, requestID string) (*domain.FriendRequest, error) {
	var fr domain.FriendRequest
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record friendRequestModel
		if err := tx.Where("request_id = ? AND status = ?", requestID, domain.FriendRequestStatusPending).First(&record).Error; err != nil {
			return err
		}
		record.Status = domain.FriendRequestStatusAccepted
		record.UpdatedAt = time.Now()
		if err := tx.Save(&record).Error; err != nil {
			return err
		}
		fr = toDomainFriendRequest(record)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &fr, nil
}

func (r *friendRequestRepository) RejectFriendRequest(ctx context.Context, requestID string) (*domain.FriendRequest, error) {
	var record friendRequestModel
	if err := r.db.WithContext(ctx).Where("request_id = ? AND status = ?", requestID, domain.FriendRequestStatusPending).First(&record).Error; err != nil {
		return nil, err
	}
	record.Status = domain.FriendRequestStatusRejected
	record.UpdatedAt = time.Now()
	if err := r.db.WithContext(ctx).Save(&record).Error; err != nil {
		return nil, err
	}
	fr := toDomainFriendRequest(record)
	return &fr, nil
}

func (r *friendRequestRepository) ListFriendRequests(ctx context.Context, actorPTID string, status int32, limit, offset int) ([]domain.FriendRequest, int, error) {
	query := r.db.WithContext(ctx).Model(&friendRequestModel{}).Where("(receiver_ptid = ? OR sender_ptid = ?)", actorPTID, actorPTID)
	if status > 0 {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	var items []friendRequestModel
	if err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	out := make([]domain.FriendRequest, 0, len(items))
	for _, item := range items {
		out = append(out, toDomainFriendRequest(item))
	}
	return out, int(total), nil
}
