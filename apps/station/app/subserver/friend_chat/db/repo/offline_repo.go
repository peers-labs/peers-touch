package repo

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	OfflineStatusPending   int32 = 1
	OfflineStatusDelivered int32 = 2
	OfflineStatusExpired   int32 = 3
)

type OfflineRepository interface {
	Create(ctx context.Context, message *model.OfflineMessage) error
	Delete(ctx context.Context, ulid string) error
	DeleteByULIDs(ctx context.Context, ulids []string) error
	FindByULID(ctx context.Context, ulid string) (*model.OfflineMessage, error)
	FindPendingByReceiverDID(ctx context.Context, receiverDID string, limit int) ([]*model.OfflineMessage, error)
	FindByReceiverDID(ctx context.Context, receiverDID string, status int32, limit, offset int) ([]*model.OfflineMessage, error)
	FindBySessionULID(ctx context.Context, sessionULID string, limit, offset int) ([]*model.OfflineMessage, error)
	MarkAsDelivered(ctx context.Context, ulids []string) error
	MarkAsExpired(ctx context.Context, ulids []string) error
	ExpireOldMessages(ctx context.Context) (int64, error)
	CountPendingByReceiverDID(ctx context.Context, receiverDID string) (int64, error)
	CountByStatus(ctx context.Context, status int32) (int64, error)
}

type offlineRepo struct {
	dbName string
}

func NewOfflineRepository(dbName string) OfflineRepository {
	return &offlineRepo{dbName: dbName}
}

func (r *offlineRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	gdb, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return gdb, nil
}

func (r *offlineRepo) Create(ctx context.Context, message *model.OfflineMessage) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Create(message).Error
}

func (r *offlineRepo) Delete(ctx context.Context, ulid string) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Where("ulid = ?", ulid).Delete(&model.OfflineMessage{}).Error
}

func (r *offlineRepo) DeleteByULIDs(ctx context.Context, ulids []string) error {
	if len(ulids) == 0 {
		return nil
	}
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Where("ulid IN ?", ulids).Delete(&model.OfflineMessage{}).Error
}

func (r *offlineRepo) FindByULID(ctx context.Context, ulid string) (*model.OfflineMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var message model.OfflineMessage
	err = gdb.Where("ulid = ?", ulid).First(&message).Error
	if err != nil {
		return nil, err
	}
	return &message, nil
}

func (r *offlineRepo) FindPendingByReceiverDID(ctx context.Context, receiverDID string, limit int) ([]*model.OfflineMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.OfflineMessage
	err = gdb.Where("receiver_did = ? AND status = ? AND expire_at > ?", receiverDID, OfflineStatusPending, time.Now()).
		Order("created_at ASC").
		Limit(limit).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *offlineRepo) FindByReceiverDID(ctx context.Context, receiverDID string, status int32, limit, offset int) ([]*model.OfflineMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.OfflineMessage
	query := gdb.Where("receiver_did = ?", receiverDID)
	if status > 0 {
		query = query.Where("status = ?", status)
	}
	err = query.Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *offlineRepo) FindBySessionULID(ctx context.Context, sessionULID string, limit, offset int) ([]*model.OfflineMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.OfflineMessage
	err = gdb.Where("session_ulid = ?", sessionULID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *offlineRepo) MarkAsDelivered(ctx context.Context, ulids []string) error {
	if len(ulids) == 0 {
		return nil
	}
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	return gdb.Model(&model.OfflineMessage{}).
		Where("ulid IN ?", ulids).
		Updates(map[string]interface{}{
			"status":       OfflineStatusDelivered,
			"delivered_at": now,
			"updated_at":   now,
		}).Error
}

func (r *offlineRepo) MarkAsExpired(ctx context.Context, ulids []string) error {
	if len(ulids) == 0 {
		return nil
	}
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	return gdb.Model(&model.OfflineMessage{}).
		Where("ulid IN ?", ulids).
		Updates(map[string]interface{}{
			"status":     OfflineStatusExpired,
			"updated_at": now,
		}).Error
}

func (r *offlineRepo) ExpireOldMessages(ctx context.Context) (int64, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	now := time.Now()
	result := gdb.Model(&model.OfflineMessage{}).
		Where("expire_at < ? AND status = ?", now, OfflineStatusPending).
		Updates(map[string]interface{}{
			"status":     OfflineStatusExpired,
			"updated_at": now,
		})
	return result.RowsAffected, result.Error
}

func (r *offlineRepo) CountPendingByReceiverDID(ctx context.Context, receiverDID string) (int64, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	err = gdb.Model(&model.OfflineMessage{}).
		Where("receiver_did = ? AND status = ? AND expire_at > ?", receiverDID, OfflineStatusPending, time.Now()).
		Count(&count).Error
	return count, err
}

func (r *offlineRepo) CountByStatus(ctx context.Context, status int32) (int64, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	err = gdb.Model(&model.OfflineMessage{}).
		Where("status = ?", status).
		Count(&count).Error
	return count, err
}
