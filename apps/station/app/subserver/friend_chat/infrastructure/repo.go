package infrastructure

import (
	"fmt"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/domain"
	"gorm.io/gorm"
)

type SessionModel struct {
	ID              uint      `gorm:"primaryKey"`
	ULID            string    `gorm:"size:64;uniqueIndex"`
	PairKey         string    `gorm:"size:255;uniqueIndex"`
	ParticipantADID string    `gorm:"size:255;index"`
	ParticipantBDID string    `gorm:"size:255;index"`
	LastMessageULID string    `gorm:"size:64"`
	LastMessageAt   time.Time
	UnreadCountA    int32
	UnreadCountB    int32
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type MessageModel struct {
	ID          uint      `gorm:"primaryKey"`
	ULID        string    `gorm:"size:64;uniqueIndex"`
	SessionULID string    `gorm:"size:64;index"`
	SenderDID   string    `gorm:"size:255;index"`
	ReceiverDID string    `gorm:"size:255;index"`
	Type        int32
	Content     string    `gorm:"type:text"`
	ReplyToULID string    `gorm:"size:64"`
	Status      int32
	SentAt      time.Time `gorm:"index"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type OutboxModel struct {
	ID        uint      `gorm:"primaryKey"`
	EventID   string    `gorm:"size:64;uniqueIndex"`
	EventType string    `gorm:"size:128;index"`
	TargetID  string    `gorm:"size:64;index"`
	Payload   string    `gorm:"type:text"`
	Status    string    `gorm:"size:32;index"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	return r.db.AutoMigrate(&SessionModel{}, &MessageModel{}, &OutboxModel{})
}

func pairKey(a, b string) string {
	items := []string{a, b}
	sort.Strings(items)
	return strings.Join(items, "|")
}

func toDomainSession(item SessionModel) domain.Session {
	return domain.Session{
		ID:              item.ULID,
		ParticipantADID: item.ParticipantADID,
		ParticipantBDID: item.ParticipantBDID,
		LastMessageID:   item.LastMessageULID,
		LastMessageAt:   item.LastMessageAt,
		UnreadCountA:    item.UnreadCountA,
		UnreadCountB:    item.UnreadCountB,
		CreatedAt:       item.CreatedAt,
		UpdatedAt:       item.UpdatedAt,
	}
}

func toDomainMessage(item MessageModel) domain.Message {
	return domain.Message{
		ID:          item.ULID,
		SessionID:   item.SessionULID,
		SenderDID:   item.SenderDID,
		ReceiverDID: item.ReceiverDID,
		Type:        item.Type,
		Content:     item.Content,
		ReplyToID:   item.ReplyToULID,
		Status:      item.Status,
		SentAt:      item.SentAt,
		CreatedAt:   item.CreatedAt,
		UpdatedAt:   item.UpdatedAt,
	}
}

func (r *GormRepo) GetOrCreateSession(actorDID, participantDID string) (*domain.Session, bool, error) {
	key := pairKey(actorDID, participantDID)
	var session SessionModel
	err := r.db.Where("pair_key = ?", key).First(&session).Error
	if err == nil {
		out := toDomainSession(session)
		return &out, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	now := time.Now()
	session = SessionModel{
		ULID:            fmt.Sprintf("fcs-%d", now.UnixNano()),
		PairKey:         key,
		ParticipantADID: actorDID,
		ParticipantBDID: participantDID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := r.db.Create(&session).Error; err != nil {
		if err2 := r.db.Where("pair_key = ?", key).First(&session).Error; err2 == nil {
			out := toDomainSession(session)
			return &out, false, nil
		}
		return nil, false, err
	}
	out := toDomainSession(session)
	return &out, true, nil
}

func (r *GormRepo) GetSession(sessionID string) (*domain.Session, error) {
	var session SessionModel
	if err := r.db.Where("ulid = ?", sessionID).First(&session).Error; err != nil {
		return nil, err
	}
	out := toDomainSession(session)
	return &out, nil
}

func (r *GormRepo) ListSessions(actorDID string, limit, offset int) ([]domain.Session, int, error) {
	var total int64
	base := r.db.Model(&SessionModel{}).Where("participant_a_did = ? OR participant_b_did = ?", actorDID, actorDID)
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var sessions []SessionModel
	if err := base.Order("updated_at DESC").Limit(limit).Offset(offset).Find(&sessions).Error; err != nil {
		return nil, 0, err
	}
	out := make([]domain.Session, 0, len(sessions))
	for _, item := range sessions {
		out = append(out, toDomainSession(item))
	}
	return out, int(total), nil
}

func (r *GormRepo) AppendMessage(message domain.Message) (domain.Message, error) {
	now := time.Now()
	record := MessageModel{
		ULID:        fmt.Sprintf("fcm-%d", now.UnixNano()),
		SessionULID: message.SessionID,
		SenderDID:   message.SenderDID,
		ReceiverDID: message.ReceiverDID,
		Type:        message.Type,
		Content:     message.Content,
		ReplyToULID: message.ReplyToID,
		Status:      message.Status,
		SentAt:      now,
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		var session SessionModel
		if err := tx.Where("ulid = ?", message.SessionID).First(&session).Error; err != nil {
			return err
		}
		session.LastMessageULID = record.ULID
		session.LastMessageAt = now
		session.UpdatedAt = now
		if message.ReceiverDID == session.ParticipantADID {
			session.UnreadCountA++
		}
		if message.ReceiverDID == session.ParticipantBDID {
			session.UnreadCountB++
		}
		if err := tx.Save(&session).Error; err != nil {
			return err
		}
		outbox := OutboxModel{
			EventID:   fmt.Sprintf("fce-%d", now.UnixNano()),
			EventType: "friend.message.appended",
			TargetID:  message.SessionID,
			Payload:   fmt.Sprintf(`{"message_ulid":"%s","sender_did":"%s","receiver_did":"%s"}`, record.ULID, message.SenderDID, message.ReceiverDID),
			Status:    "pending",
		}
		return tx.Create(&outbox).Error
	})
	if err != nil {
		return domain.Message{}, err
	}
	return toDomainMessage(record), nil
}

func (r *GormRepo) ListMessages(sessionID, beforeUlid string, limit int) ([]domain.Message, error) {
	var items []MessageModel
	query := r.db.Where("session_ulid = ?", sessionID)
	if strings.HasPrefix(beforeUlid, "since:") {
		cursor := strings.TrimSpace(strings.TrimPrefix(beforeUlid, "since:"))
		if cursor != "" {
			query = query.Where("ulid > ?", cursor).Order("ulid ASC")
		} else {
			query = query.Order("ulid ASC")
		}
		if err := query.Limit(limit).Find(&items).Error; err != nil {
			return nil, err
		}
		out := make([]domain.Message, 0, len(items))
		for _, item := range items {
			out = append(out, toDomainMessage(item))
		}
		return out, nil
	}
	if beforeUlid != "" {
		query = query.Where("ulid < ?", beforeUlid)
	}
	if err := query.Order("sent_at DESC").Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].SentAt.Before(items[j].SentAt)
	})
	out := make([]domain.Message, 0, len(items))
	for _, item := range items {
		out = append(out, toDomainMessage(item))
	}
	return out, nil
}

func (r *GormRepo) MarkRead(actorDID string, messageIDs []string, status int32) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&MessageModel{}).Where("ulid IN ?", messageIDs).Updates(map[string]interface{}{
			"status":     status,
			"updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&SessionModel{}).Where("participant_a_did = ?", actorDID).Update("unread_count_a", 0).Error; err != nil {
			return err
		}
		if err := tx.Model(&SessionModel{}).Where("participant_b_did = ?", actorDID).Update("unread_count_b", 0).Error; err != nil {
			return err
		}
		outbox := OutboxModel{
			EventID:   fmt.Sprintf("fce-%d", time.Now().UnixNano()),
			EventType: "friend.message.acked",
			TargetID:  actorDID,
			Payload:   fmt.Sprintf(`{"count":%d,"status":%d}`, len(messageIDs), status),
			Status:    "pending",
		}
		return tx.Create(&outbox).Error
	})
}

func (r *GormRepo) DispatchOutbox(limit int) (int64, error) {
	var items []OutboxModel
	if err := r.db.Where("status = ?", "pending").Order("id ASC").Limit(limit).Find(&items).Error; err != nil {
		return 0, err
	}
	if len(items) == 0 {
		return 0, nil
	}
	ids := make([]uint, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	err := r.db.Model(&OutboxModel{}).Where("id IN ?", ids).Updates(map[string]interface{}{
		"status":     "acked",
		"updated_at": time.Now(),
	}).Error
	if err != nil {
		return 0, err
	}
	return int64(len(ids)), nil
}
