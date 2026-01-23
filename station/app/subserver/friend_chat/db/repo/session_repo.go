package repo

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type SessionRepository interface {
	Create(ctx context.Context, session *model.FriendChatSession) error
	Update(ctx context.Context, session *model.FriendChatSession) error
	Delete(ctx context.Context, ulid string) error
	FindByULID(ctx context.Context, ulid string) (*model.FriendChatSession, error)
	FindByParticipants(ctx context.Context, participantADID, participantBDID string) (*model.FriendChatSession, error)
	FindByParticipantDID(ctx context.Context, did string, limit, offset int) ([]*model.FriendChatSession, error)
	UpdateLastMessage(ctx context.Context, ulid, lastMessageULID string) error
	IncrementUnreadCount(ctx context.Context, ulid string, isParticipantA bool) error
	ResetUnreadCount(ctx context.Context, ulid string, isParticipantA bool) error
	CountByParticipantDID(ctx context.Context, did string) (int64, error)
}

type sessionRepo struct {
	dbName string
}

func NewSessionRepository(dbName string) SessionRepository {
	return &sessionRepo{dbName: dbName}
}

func (r *sessionRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *sessionRepo) Create(ctx context.Context, session *model.FriendChatSession) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Create(session).Error
}

func (r *sessionRepo) Update(ctx context.Context, session *model.FriendChatSession) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Save(session).Error
}

func (r *sessionRepo) Delete(ctx context.Context, ulid string) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Where("ulid = ?", ulid).Delete(&model.FriendChatSession{}).Error
}

func (r *sessionRepo) FindByULID(ctx context.Context, ulid string) (*model.FriendChatSession, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var session model.FriendChatSession
	err = gdb.Where("ulid = ?", ulid).First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *sessionRepo) FindByParticipants(ctx context.Context, participantADID, participantBDID string) (*model.FriendChatSession, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var session model.FriendChatSession
	err = gdb.Where(
		"(participant_a_did = ? AND participant_b_did = ?) OR (participant_a_did = ? AND participant_b_did = ?)",
		participantADID, participantBDID, participantBDID, participantADID,
	).First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *sessionRepo) FindByParticipantDID(ctx context.Context, did string, limit, offset int) ([]*model.FriendChatSession, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var sessions []*model.FriendChatSession
	err = gdb.Where("participant_a_did = ? OR participant_b_did = ?", did, did).
		Order("last_message_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&sessions).Error
	if err != nil {
		return nil, err
	}
	return sessions, nil
}

func (r *sessionRepo) UpdateLastMessage(ctx context.Context, ulid, lastMessageULID string) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return gdb.Model(&model.FriendChatSession{}).
		Where("ulid = ?", ulid).
		Updates(map[string]interface{}{
			"last_message_ulid": lastMessageULID,
			"last_message_at":   gorm.Expr("NOW()"),
		}).Error
}

func (r *sessionRepo) IncrementUnreadCount(ctx context.Context, ulid string, isParticipantA bool) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	column := "unread_count_b"
	if isParticipantA {
		column = "unread_count_a"
	}
	return gdb.Model(&model.FriendChatSession{}).
		Where("ulid = ?", ulid).
		Update(column, gorm.Expr(column+" + 1")).Error
}

func (r *sessionRepo) ResetUnreadCount(ctx context.Context, ulid string, isParticipantA bool) error {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	column := "unread_count_b"
	if isParticipantA {
		column = "unread_count_a"
	}
	return gdb.Model(&model.FriendChatSession{}).
		Where("ulid = ?", ulid).
		Update(column, 0).Error
}

func (r *sessionRepo) CountByParticipantDID(ctx context.Context, did string) (int64, error) {
	gdb, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	err = gdb.Model(&model.FriendChatSession{}).
		Where("participant_a_did = ? OR participant_b_did = ?", did, did).
		Count(&count).Error
	return count, err
}
