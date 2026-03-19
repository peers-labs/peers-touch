package service

import (
	"context"
	"time"

	"github.com/oklog/ulid/v2"
	fcmodel "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type SessionService interface {
	CreateSession(ctx context.Context, participantADID, participantBDID string) (*fcmodel.FriendChatSession, error)
	GetSession(ctx context.Context, ulid string) (*fcmodel.FriendChatSession, error)
	GetSessionByParticipants(ctx context.Context, participantADID, participantBDID string) (*fcmodel.FriendChatSession, error)
	GetOrCreateSession(ctx context.Context, participantADID, participantBDID string) (*fcmodel.FriendChatSession, error)
	GetSessionsByDID(ctx context.Context, did string, limit int) ([]*fcmodel.FriendChatSession, error)
	UpdateLastMessage(ctx context.Context, sessionULID, messageULID string, messageAt time.Time) error
	IncrementUnreadCount(ctx context.Context, sessionULID, receiverDID string) error
	ResetUnreadCount(ctx context.Context, sessionULID, readerDID string) error
}

type sessionService struct {
	dbName string
}

func NewSessionService(dbName string) SessionService {
	return &sessionService{dbName: dbName}
}

func (s *sessionService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
}

func (s *sessionService) CreateSession(ctx context.Context, participantADID, participantBDID string) (*fcmodel.FriendChatSession, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if participantADID > participantBDID {
		participantADID, participantBDID = participantBDID, participantADID
	}

	session := &fcmodel.FriendChatSession{
		ULID:            ulid.Make().String(),
		ParticipantADID: participantADID,
		ParticipantBDID: participantBDID,
		LastMessageAt:   time.Now(),
		UnreadCountA:    0,
		UnreadCountB:    0,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	if err := db.Create(session).Error; err != nil {
		return nil, err
	}

	return session, nil
}

func (s *sessionService) GetSession(ctx context.Context, sessionULID string) (*fcmodel.FriendChatSession, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var session fcmodel.FriendChatSession
	if err := db.Where("ulid = ?", sessionULID).First(&session).Error; err != nil {
		return nil, err
	}

	return &session, nil
}

func (s *sessionService) GetSessionByParticipants(ctx context.Context, participantADID, participantBDID string) (*fcmodel.FriendChatSession, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if participantADID > participantBDID {
		participantADID, participantBDID = participantBDID, participantADID
	}

	var session fcmodel.FriendChatSession
	if err := db.Where("participant_a_did = ? AND participant_b_did = ?", participantADID, participantBDID).First(&session).Error; err != nil {
		return nil, err
	}

	return &session, nil
}

func (s *sessionService) GetOrCreateSession(ctx context.Context, participantADID, participantBDID string) (*fcmodel.FriendChatSession, error) {
	session, err := s.GetSessionByParticipants(ctx, participantADID, participantBDID)
	if err == nil {
		return session, nil
	}

	if err == gorm.ErrRecordNotFound {
		return s.CreateSession(ctx, participantADID, participantBDID)
	}

	return nil, err
}

func (s *sessionService) GetSessionsByDID(ctx context.Context, did string, limit int) ([]*fcmodel.FriendChatSession, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}

	var sessions []*fcmodel.FriendChatSession
	if err := db.Where("participant_a_did = ? OR participant_b_did = ?", did, did).
		Order("last_message_at DESC").
		Limit(limit).
		Find(&sessions).Error; err != nil {
		return nil, err
	}

	return sessions, nil
}

func (s *sessionService) UpdateLastMessage(ctx context.Context, sessionULID, messageULID string, messageAt time.Time) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.Model(&fcmodel.FriendChatSession{}).
		Where("ulid = ?", sessionULID).
		Updates(map[string]interface{}{
			"last_message_ulid": messageULID,
			"last_message_at":   messageAt,
			"updated_at":        time.Now(),
		}).Error
}

func (s *sessionService) IncrementUnreadCount(ctx context.Context, sessionULID, receiverDID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var session fcmodel.FriendChatSession
	if err := db.Where("ulid = ?", sessionULID).First(&session).Error; err != nil {
		return err
	}

	updateField := "unread_count_a"
	if session.ParticipantBDID == receiverDID {
		updateField = "unread_count_b"
	}

	return db.Model(&fcmodel.FriendChatSession{}).
		Where("ulid = ?", sessionULID).
		Update(updateField, gorm.Expr(updateField+" + 1")).Error
}

func (s *sessionService) ResetUnreadCount(ctx context.Context, sessionULID, readerDID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var session fcmodel.FriendChatSession
	if err := db.Where("ulid = ?", sessionULID).First(&session).Error; err != nil {
		return err
	}

	updateField := "unread_count_a"
	if session.ParticipantBDID == readerDID {
		updateField = "unread_count_b"
	}

	return db.Model(&fcmodel.FriendChatSession{}).
		Where("ulid = ?", sessionULID).
		Updates(map[string]interface{}{
			updateField:  0,
			"updated_at": time.Now(),
		}).Error
}
