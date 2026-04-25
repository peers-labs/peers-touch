package infrastructure

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/domain"
	"gorm.io/gorm"
)

type SessionModel struct {
	ID              uint   `gorm:"primaryKey"`
	ULID            string `gorm:"column:ulid;size:64;uniqueIndex"`
	PairKey         string `gorm:"size:255;uniqueIndex"`
	ParticipantADID string `gorm:"column:participant_a_did;size:255;index"`
	ParticipantBDID string `gorm:"column:participant_b_did;size:255;index"`
	LastMessageULID string `gorm:"column:last_message_ulid;size:64"`
	LastMessageAt   time.Time
	UnreadCountA    int32
	UnreadCountB    int32
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type MessageModel struct {
	ID          uint   `gorm:"primaryKey"`
	ULID        string `gorm:"column:ulid;size:64;uniqueIndex"`
	SessionULID string `gorm:"column:session_ulid;size:64;index"`
	SenderDID   string `gorm:"column:sender_did;size:255;index"`
	ReceiverDID string `gorm:"column:receiver_did;size:255;index"`
	Type        int32
	Content     string `gorm:"type:text"`
	// EncryptedPayload is optional E2E ciphertext (PostgreSQL bytea).
	EncryptedPayload []byte `gorm:"type:bytea"`
	ReplyToULID      string `gorm:"column:reply_to_ulid;size:64"`
	Status           int32
	SentAt           time.Time `gorm:"index"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (MessageModel) TableName() string { return "friend_message_models" }

// MessageAttachmentModel stores per-message attachment metadata (blobs addressed by CID).
type MessageAttachmentModel struct {
	ID           uint   `gorm:"primaryKey"`
	MessageULID  string `gorm:"column:message_ulid;size:64;index"`
	CID          string `gorm:"column:cid;size:255"`
	Filename     string `gorm:"size:255"`
	MimeType     string `gorm:"size:128"`
	Size         int64
	ThumbnailCID string `gorm:"column:thumbnail_cid;size:255"`
}

func (MessageAttachmentModel) TableName() string {
	return "friend_message_attachments"
}

type FriendRequestModel struct {
	ID          uint   `gorm:"primaryKey"`
	RequestID   string `gorm:"column:request_id;size:64;uniqueIndex"`
	PairKey     string `gorm:"size:255;uniqueIndex:idx_fr_pair_status"`
	SenderDID   string `gorm:"column:sender_did;size:255;index"`
	ReceiverDID string `gorm:"column:receiver_did;size:255;index"`
	Status      int32  `gorm:"uniqueIndex:idx_fr_pair_status"`
	Message     string `gorm:"type:text"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type OutboxModel struct {
	ID        uint   `gorm:"primaryKey"`
	EventID   string `gorm:"column:event_id;size:64;uniqueIndex"`
	EventType string `gorm:"size:128;index"`
	TargetID  string `gorm:"column:target_id;size:64;index"`
	Payload   string `gorm:"type:text"`
	Status    string `gorm:"size:32;index"`
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
	return r.db.AutoMigrate(&SessionModel{}, &MessageModel{}, &MessageAttachmentModel{}, &OutboxModel{}, &FriendRequestModel{})
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
		ID:               item.ULID,
		SessionID:        item.SessionULID,
		SenderDID:        item.SenderDID,
		ReceiverDID:      item.ReceiverDID,
		Type:             item.Type,
		Content:          item.Content,
		EncryptedPayload: append([]byte(nil), item.EncryptedPayload...),
		ReplyToID:        item.ReplyToULID,
		Status:           item.Status,
		SentAt:           item.SentAt,
		CreatedAt:        item.CreatedAt,
		UpdatedAt:        item.UpdatedAt,
	}
}

func attachmentRowToDomain(m MessageAttachmentModel) domain.Attachment {
	return domain.Attachment{
		CID:          m.CID,
		Filename:     m.Filename,
		MimeType:     m.MimeType,
		Size:         m.Size,
		ThumbnailCID: m.ThumbnailCID,
	}
}

// LoadAttachments returns stored attachments for one message (optional granular load; list APIs batch-load instead).
func (r *GormRepo) LoadAttachments(messageULID string) ([]domain.Attachment, error) {
	var rows []MessageAttachmentModel
	if err := r.db.Where("message_ulid = ?", messageULID).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Attachment, 0, len(rows))
	for _, row := range rows {
		out = append(out, attachmentRowToDomain(row))
	}
	return out, nil
}

func (r *GormRepo) batchAttachmentsByMessageULIDs(messageULIDs []string) (map[string][]domain.Attachment, error) {
	out := make(map[string][]domain.Attachment)
	if len(messageULIDs) == 0 {
		return out, nil
	}
	var rows []MessageAttachmentModel
	if err := r.db.Where("message_ulid IN ?", messageULIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.MessageULID] = append(out[row.MessageULID], attachmentRowToDomain(row))
	}
	return out, nil
}

func (r *GormRepo) mergeAttachmentsIntoMessages(messages []domain.Message) error {
	if len(messages) == 0 {
		return nil
	}
	ids := make([]string, len(messages))
	for i := range messages {
		ids[i] = messages[i].ID
	}
	m, err := r.batchAttachmentsByMessageULIDs(ids)
	if err != nil {
		return err
	}
	for i := range messages {
		if atts, ok := m[messages[i].ID]; ok {
			messages[i].Attachments = atts
		}
	}
	return nil
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
	messageULID := strings.TrimSpace(message.ID)
	if messageULID == "" {
		messageULID = fmt.Sprintf("fcm-%d", now.UnixNano())
	} else {
		var existing MessageModel
		if err := r.db.Where("ulid = ?", messageULID).First(&existing).Error; err == nil {
			out := toDomainMessage(existing)
			if atts, loadErr := r.LoadAttachments(existing.ULID); loadErr == nil {
				out.Attachments = atts
			}
			return out, nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.Message{}, err
		}
	}
	record := MessageModel{
		ULID:             messageULID,
		SessionULID:      message.SessionID,
		SenderDID:        message.SenderDID,
		ReceiverDID:      message.ReceiverDID,
		Type:             message.Type,
		Content:          message.Content,
		EncryptedPayload: append([]byte(nil), message.EncryptedPayload...),
		ReplyToULID:      message.ReplyToID,
		Status:           message.Status,
		SentAt:           now,
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		for _, a := range message.Attachments {
			row := MessageAttachmentModel{
				MessageULID:  record.ULID,
				CID:          a.CID,
				Filename:     a.Filename,
				MimeType:     a.MimeType,
				Size:         a.Size,
				ThumbnailCID: a.ThumbnailCID,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
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
	out := toDomainMessage(record)
	if len(message.Attachments) > 0 {
		out.Attachments = append([]domain.Attachment(nil), message.Attachments...)
	}
	return out, nil
}

// SearchMessages returns messages whose content matches query (case-insensitive substring) across sessions
// the actor participates in, optionally scoped to one session. Uses LOWER/LIKE so PostgreSQL and SQLite agree.
func (r *GormRepo) SearchMessages(actorDID, query, sessionUlid string, limit, offset int) ([]domain.Message, int, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	searchPattern := "%" + query + "%"
	base := r.db.Model(&MessageModel{}).
		Joins("INNER JOIN session_models AS s ON message_models.session_ulid = s.ulid").
		Where("(s.participant_a_did = ? OR s.participant_b_did = ?)", actorDID, actorDID).
		Where("LOWER(message_models.content) LIKE LOWER(?)", searchPattern)
	if sessionUlid != "" {
		base = base.Where("message_models.session_ulid = ?", sessionUlid)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []MessageModel
	if err := base.Order("message_models.sent_at DESC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	out := make([]domain.Message, 0, len(items))
	for _, item := range items {
		out = append(out, toDomainMessage(item))
	}
	if len(out) > 0 {
		if err := r.mergeAttachmentsIntoMessages(out); err != nil {
			return nil, 0, err
		}
	}
	return out, int(total), nil
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
		if err := r.mergeAttachmentsIntoMessages(out); err != nil {
			return nil, err
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
	if err := r.mergeAttachmentsIntoMessages(out); err != nil {
		return nil, err
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

		// Scope unread reset to only sessions that contain the acked messages
		var sessionULIDs []string
		if err := tx.Model(&MessageModel{}).
			Where("ulid IN ?", messageIDs).
			Distinct("session_ulid").
			Pluck("session_ulid", &sessionULIDs).Error; err != nil {
			return err
		}
		if len(sessionULIDs) > 0 {
			if err := tx.Model(&SessionModel{}).
				Where("ulid IN ? AND participant_a_did = ?", sessionULIDs, actorDID).
				Update("unread_count_a", 0).Error; err != nil {
				return err
			}
			if err := tx.Model(&SessionModel{}).
				Where("ulid IN ? AND participant_b_did = ?", sessionULIDs, actorDID).
				Update("unread_count_b", 0).Error; err != nil {
				return err
			}
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

// ============================================================================
// Friend Request Operations
// ============================================================================

func toDomainFriendRequest(m FriendRequestModel) domain.FriendRequest {
	return domain.FriendRequest{
		ID:          m.RequestID,
		SenderDID:   m.SenderDID,
		ReceiverDID: m.ReceiverDID,
		Status:      m.Status,
		Message:     m.Message,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}
}

func (r *GormRepo) CreateFriendRequest(senderDID, receiverDID, message string) (domain.FriendRequest, error) {
	now := time.Now()
	key := pairKey(senderDID, receiverDID)

	// Check for existing pending request in either direction
	var existing FriendRequestModel
	err := r.db.Where("pair_key = ? AND status = ?", key, domain.FriendRequestStatusPending).First(&existing).Error
	if err == nil {
		return toDomainFriendRequest(existing), nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.FriendRequest{}, err
	}

	// Check for already-accepted relationship
	err = r.db.Where("pair_key = ? AND status = ?", key, domain.FriendRequestStatusAccepted).First(&existing).Error
	if err == nil {
		return domain.FriendRequest{}, errors.New("already friends")
	}

	record := FriendRequestModel{
		RequestID:   fmt.Sprintf("fr-%d", now.UnixNano()),
		PairKey:     key,
		SenderDID:   senderDID,
		ReceiverDID: receiverDID,
		Status:      domain.FriendRequestStatusPending,
		Message:     message,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := r.db.Create(&record).Error; err != nil {
		return domain.FriendRequest{}, err
	}
	return toDomainFriendRequest(record), nil
}

func (r *GormRepo) GetFriendRequest(requestID string) (*domain.FriendRequest, error) {
	var record FriendRequestModel
	if err := r.db.Where("request_id = ?", requestID).First(&record).Error; err != nil {
		return nil, err
	}
	fr := toDomainFriendRequest(record)
	return &fr, nil
}

func (r *GormRepo) AcceptFriendRequest(requestID string) (*domain.FriendRequest, *domain.Session, error) {
	var fr domain.FriendRequest
	var session domain.Session

	err := r.db.Transaction(func(tx *gorm.DB) error {
		var record FriendRequestModel
		if err := tx.Where("request_id = ? AND status = ?", requestID, domain.FriendRequestStatusPending).First(&record).Error; err != nil {
			return err
		}
		record.Status = domain.FriendRequestStatusAccepted
		record.UpdatedAt = time.Now()
		if err := tx.Save(&record).Error; err != nil {
			return err
		}
		fr = toDomainFriendRequest(record)

		// Create chat session for the new friendship
		now := time.Now()
		key := pairKey(record.SenderDID, record.ReceiverDID)
		var existingSession SessionModel
		err := tx.Where("pair_key = ?", key).First(&existingSession).Error
		if err == nil {
			session = toDomainSession(existingSession)
			return nil
		}
		newSession := SessionModel{
			ULID:            fmt.Sprintf("fcs-%d", now.UnixNano()),
			PairKey:         key,
			ParticipantADID: record.SenderDID,
			ParticipantBDID: record.ReceiverDID,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if err := tx.Create(&newSession).Error; err != nil {
			return err
		}
		session = toDomainSession(newSession)
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return &fr, &session, nil
}

func (r *GormRepo) RejectFriendRequest(requestID string) (*domain.FriendRequest, error) {
	var record FriendRequestModel
	if err := r.db.Where("request_id = ? AND status = ?", requestID, domain.FriendRequestStatusPending).First(&record).Error; err != nil {
		return nil, err
	}
	record.Status = domain.FriendRequestStatusRejected
	record.UpdatedAt = time.Now()
	if err := r.db.Save(&record).Error; err != nil {
		return nil, err
	}
	fr := toDomainFriendRequest(record)
	return &fr, nil
}

func (r *GormRepo) ListFriendRequests(actorDID string, status int32, limit, offset int) ([]domain.FriendRequest, int, error) {
	// Include both incoming and outgoing requests so the client can show Received vs Sent.
	query := r.db.Model(&FriendRequestModel{}).Where("(receiver_did = ? OR sender_did = ?)", actorDID, actorDID)
	if status > 0 {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []FriendRequestModel
	if err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	out := make([]domain.FriendRequest, 0, len(items))
	for _, item := range items {
		out = append(out, toDomainFriendRequest(item))
	}
	return out, int(total), nil
}

// ActorSummary holds the minimal profile fields needed for enrichment.
type ActorSummary struct {
	ID          uint64
	DisplayName string
	Avatar      string
}

// BatchLoadActorSummaries looks up display name + avatar for a set of actor IDs.
// IDs are numeric strings (strconv'd actor primary keys).
func (r *GormRepo) BatchLoadActorSummaries(ids []string) map[string]ActorSummary {
	result := make(map[string]ActorSummary, len(ids))
	if len(ids) == 0 {
		return result
	}
	type row struct {
		ID   uint64 `gorm:"column:id"`
		Name string `gorm:"column:name"`
		Icon string `gorm:"column:icon"`
	}
	var rows []row
	r.db.Table("touch_actors").Select("id, name, icon").Where("id IN ?", ids).Find(&rows)
	for _, r := range rows {
		result[fmt.Sprintf("%d", r.ID)] = ActorSummary{
			ID:          r.ID,
			DisplayName: r.Name,
			Avatar:      r.Icon,
		}
	}
	return result
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
