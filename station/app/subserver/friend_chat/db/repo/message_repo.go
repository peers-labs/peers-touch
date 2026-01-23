package repo

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type MessageRepository interface {
	Create(ctx context.Context, message *model.FriendChatMessage) error
	Update(ctx context.Context, message *model.FriendChatMessage) error
	Delete(ctx context.Context, ulid string) error
	FindByULID(ctx context.Context, ulid string) (*model.FriendChatMessage, error)
	FindBySessionULID(ctx context.Context, sessionULID string, limit, offset int) ([]*model.FriendChatMessage, error)
	FindBySessionULIDBeforeULID(ctx context.Context, sessionULID, beforeULID string, limit int) ([]*model.FriendChatMessage, error)
	FindBySessionULIDAfterULID(ctx context.Context, sessionULID, afterULID string, limit int) ([]*model.FriendChatMessage, error)
	FindBySenderDID(ctx context.Context, senderDID string, limit, offset int) ([]*model.FriendChatMessage, error)
	FindByReceiverDID(ctx context.Context, receiverDID string, limit, offset int) ([]*model.FriendChatMessage, error)
	UpdateStatus(ctx context.Context, ulid string, status int32) error
	UpdateDeliveredAt(ctx context.Context, ulid string, deliveredAt time.Time) error
	UpdateReadAt(ctx context.Context, ulid string, readAt time.Time) error
	MarkAsDelivered(ctx context.Context, ulids []string) error
	MarkAsRead(ctx context.Context, ulids []string) error
	CountBySessionULID(ctx context.Context, sessionULID string) (int64, error)
	CountUnreadBySessionULID(ctx context.Context, sessionULID, receiverDID string) (int64, error)
	CreateAttachment(ctx context.Context, attachment *model.FriendMessageAttachment) error
	FindAttachmentsByMessageULID(ctx context.Context, messageULID string) ([]*model.FriendMessageAttachment, error)
}

type messageRepo struct {
	dbName string
}

func NewMessageRepository(dbName string) MessageRepository {
	return &messageRepo{dbName: dbName}
}

func (r *messageRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	gdb, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return gdb, nil
}

func (r *messageRepo) Create(ctx context.Context, message *model.FriendChatMessage) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Create(message).Error
}

func (r *messageRepo) Update(ctx context.Context, message *model.FriendChatMessage) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Save(message).Error
}

func (r *messageRepo) Delete(ctx context.Context, ulid string) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Where("ulid = ?", ulid).Delete(&model.FriendChatMessage{}).Error
}

func (r *messageRepo) FindByULID(ctx context.Context, ulid string) (*model.FriendChatMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var message model.FriendChatMessage
	err = gdb.Where("ulid = ?", ulid).First(&message).Error
	if err != nil {
		return nil, err
	}
	return &message, nil
}

func (r *messageRepo) FindBySessionULID(ctx context.Context, sessionULID string, limit, offset int) ([]*model.FriendChatMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.FriendChatMessage
	err = gdb.Where("session_ulid = ?", sessionULID).
		Order("ulid DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *messageRepo) FindBySessionULIDBeforeULID(ctx context.Context, sessionULID, beforeULID string, limit int) ([]*model.FriendChatMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.FriendChatMessage
	err = gdb.Where("session_ulid = ? AND ulid < ?", sessionULID, beforeULID).
		Order("ulid DESC").
		Limit(limit).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *messageRepo) FindBySessionULIDAfterULID(ctx context.Context, sessionULID, afterULID string, limit int) ([]*model.FriendChatMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.FriendChatMessage
	err = gdb.Where("session_ulid = ? AND ulid > ?", sessionULID, afterULID).
		Order("ulid ASC").
		Limit(limit).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *messageRepo) FindBySenderDID(ctx context.Context, senderDID string, limit, offset int) ([]*model.FriendChatMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.FriendChatMessage
	err = gdb.Where("sender_did = ?", senderDID).
		Order("ulid DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *messageRepo) FindByReceiverDID(ctx context.Context, receiverDID string, limit, offset int) ([]*model.FriendChatMessage, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var messages []*model.FriendChatMessage
	err = gdb.Where("receiver_did = ?", receiverDID).
		Order("ulid DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *messageRepo) UpdateStatus(ctx context.Context, ulid string, status int32) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Model(&model.FriendChatMessage{}).
		Where("ulid = ?", ulid).
		Update("status", status).Error
}

func (r *messageRepo) UpdateDeliveredAt(ctx context.Context, ulid string, deliveredAt time.Time) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Model(&model.FriendChatMessage{}).
		Where("ulid = ?", ulid).
		Updates(map[string]interface{}{
			"delivered_at": deliveredAt,
			"status":       2,
		}).Error
}

func (r *messageRepo) UpdateReadAt(ctx context.Context, ulid string, readAt time.Time) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Model(&model.FriendChatMessage{}).
		Where("ulid = ?", ulid).
		Updates(map[string]interface{}{
			"read_at": readAt,
			"status":  3,
		}).Error
}

func (r *messageRepo) MarkAsDelivered(ctx context.Context, ulids []string) error {
	if len(ulids) == 0 {
		return nil
	}
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	return gdb.Model(&model.FriendChatMessage{}).
		Where("ulid IN ? AND status = 1", ulids).
		Updates(map[string]interface{}{
			"delivered_at": now,
			"status":       2,
			"updated_at":   now,
		}).Error
}

func (r *messageRepo) MarkAsRead(ctx context.Context, ulids []string) error {
	if len(ulids) == 0 {
		return nil
	}
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	return gdb.Model(&model.FriendChatMessage{}).
		Where("ulid IN ? AND status IN (1, 2)", ulids).
		Updates(map[string]interface{}{
			"read_at":    now,
			"status":     3,
			"updated_at": now,
		}).Error
}

func (r *messageRepo) CountBySessionULID(ctx context.Context, sessionULID string) (int64, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	err = gdb.Model(&model.FriendChatMessage{}).
		Where("session_ulid = ?", sessionULID).
		Count(&count).Error
	return count, err
}

func (r *messageRepo) CountUnreadBySessionULID(ctx context.Context, sessionULID, receiverDID string) (int64, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	err = gdb.Model(&model.FriendChatMessage{}).
		Where("session_ulid = ? AND receiver_did = ? AND status < 3", sessionULID, receiverDID).
		Count(&count).Error
	return count, err
}

func (r *messageRepo) CreateAttachment(ctx context.Context, attachment *model.FriendMessageAttachment) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Create(attachment).Error
}

func (r *messageRepo) FindAttachmentsByMessageULID(ctx context.Context, messageULID string) ([]*model.FriendMessageAttachment, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var attachments []*model.FriendMessageAttachment
	err = gdb.Where("message_ulid = ?", messageULID).Find(&attachments).Error
	if err != nil {
		return nil, err
	}
	return attachments, nil
}
