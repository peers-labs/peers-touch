package infrastructure

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/domain"
	"gorm.io/gorm"
)

// ErrMessageNotFound is returned by mutation methods when no row
// matches the (sessionULID, messageULID) tuple. The handler maps it
// to HTTP 404.
var ErrMessageNotFound = errors.New("friend message not found")

// ErrPermissionDenied is returned by mutation methods when the row
// exists but the caller is not its sender. The handler maps it to
// HTTP 404 (we deliberately collapse perm-denied + not-found at the
// HTTP boundary so a non-owner cannot enumerate other actors' ulids;
// see the handler for the exact mapping).
var ErrPermissionDenied = errors.New("not message owner")

// ErrMutationWindowClosed is returned when the mutation arrives
// after the operator-tunable recall / edit window has elapsed. The
// handler maps it to HTTP 422 (Unprocessable Entity) so the client
// can show "this message is too old to recall".
var ErrMutationWindowClosed = errors.New("mutation window closed")

// ErrAlreadyRecalled is returned by edit when the target row has
// already been recalled (an edit on a tombstone makes no sense).
var ErrAlreadyRecalled = errors.New("message already recalled")

// ErrFriendRelationNotFound is returned when a relationship-level delete
// targets a pair that is not currently accepted friends.
var ErrFriendRelationNotFound = errors.New("friend relationship not found")

type SessionModel struct {
	ID              uint      `gorm:"column:id;primaryKey"`
	ULID            string    `gorm:"column:ulid;size:64;uniqueIndex"`
	PairKey         string    `gorm:"column:pair_key;size:255;uniqueIndex"`
	ParticipantADID string    `gorm:"column:participant_a_did;size:255;index"`
	ParticipantBDID string    `gorm:"column:participant_b_did;size:255;index"`
	LastMessageULID string    `gorm:"column:last_message_ulid;size:64"`
	LastMessageAt   time.Time `gorm:"column:last_message_at"`
	UnreadCountA    int32     `gorm:"column:unread_count_a"`
	UnreadCountB    int32     `gorm:"column:unread_count_b"`
	CreatedAt       time.Time `gorm:"column:created_at"`
	UpdatedAt       time.Time `gorm:"column:updated_at"`
}

func (*SessionModel) TableName() string { return "friend_chat_sessions" }

type MessageModel struct {
	ID          uint   `gorm:"column:id;primaryKey"`
	ULID        string `gorm:"column:ulid;size:64;uniqueIndex"`
	SessionULID string `gorm:"column:session_ulid;size:64;index"`
	SenderDID   string `gorm:"column:sender_did;size:255;index"`
	ReceiverDID string `gorm:"column:receiver_did;size:255;index"`
	Type        int32  `gorm:"column:type"`
	Content     string `gorm:"column:content;type:text"`
	// EncryptedPayload is optional E2E ciphertext (PostgreSQL bytea).
	EncryptedPayload []byte `gorm:"column:encrypted_payload;type:bytea"`
	ReplyToULID      string `gorm:"column:reply_to_ulid;size:64"`
	ThreadRootULID   string `gorm:"column:thread_root_ulid;size:64;index;default:''"`
	Status           int32  `gorm:"column:status"`
	// Recalled is set by recall — content + encrypted_payload are
	// cleared at the same time. Once true it never flips back.
	Recalled bool `gorm:"column:recalled"`
	// EditedAt is non-null when the row has been mutated via edit.
	// We use a pointer here so GORM can leave the column NULL on
	// fresh inserts; readers translate nil → zero-value time.Time
	// in toDomainMessage.
	EditedAt  *time.Time `gorm:"column:edited_at"`
	SentAt    time.Time  `gorm:"column:sent_at;index"`
	CreatedAt time.Time  `gorm:"column:created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`
}

func (*MessageModel) TableName() string { return "friend_chat_messages" }

// MessageAttachmentModel stores per-message attachment metadata (blobs addressed by CID).
//
// Visibility mirrors the OSS subserver's `oss_files.visibility`
// (the values are kept in lock-step on purpose). It is recorded
// here at write time so the receiver does not have to call back
// to the OSS subserver just to render a tiny chip on the bubble.
// Empty string is the legacy / "not declared" sentinel.
type MessageAttachmentModel struct {
	ID           uint   `gorm:"column:id;primaryKey"`
	MessageULID  string `gorm:"column:message_ulid;size:64;index"`
	CID          string `gorm:"column:cid;size:255"`
	Filename     string `gorm:"column:filename;size:255"`
	MimeType     string `gorm:"column:mime_type;size:128"`
	Size         int64  `gorm:"column:size"`
	ThumbnailCID string `gorm:"column:thumbnail_cid;size:255"`
	Visibility   string `gorm:"column:visibility;size:16"`
}

func (MessageAttachmentModel) TableName() string {
	return "friend_chat_message_attachments"
}

type ThreadReadModel struct {
	ID           uint      `gorm:"column:id;primaryKey"`
	SessionULID  string    `gorm:"column:session_ulid;size:64;uniqueIndex:idx_fctr_actor_thread,priority:1;index"`
	RootULID     string    `gorm:"column:root_ulid;size:64;uniqueIndex:idx_fctr_actor_thread,priority:2;index"`
	ActorDID     string    `gorm:"column:actor_did;size:255;uniqueIndex:idx_fctr_actor_thread,priority:3;index"`
	LastReadULID string    `gorm:"column:last_read_ulid;size:64"`
	LastReadAt   time.Time `gorm:"column:last_read_at;index"`
	CreatedAt    time.Time `gorm:"column:created_at"`
	UpdatedAt    time.Time `gorm:"column:updated_at"`
}

func (ThreadReadModel) TableName() string {
	return "friend_chat_thread_reads"
}

type FriendRequestModel struct {
	ID          uint      `gorm:"column:id;primaryKey"`
	RequestID   string    `gorm:"column:request_id;size:64;uniqueIndex"`
	PairKey     string    `gorm:"column:pair_key;size:255;uniqueIndex:idx_fr_pair_status"`
	SenderDID   string    `gorm:"column:sender_did;size:255;index"`
	ReceiverDID string    `gorm:"column:receiver_did;size:255;index"`
	Status      int32     `gorm:"column:status;uniqueIndex:idx_fr_pair_status"`
	Message     string    `gorm:"column:message;type:text"`
	CreatedAt   time.Time `gorm:"column:created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at"`
}

func (*FriendRequestModel) TableName() string { return "friend_chat_friend_requests" }

type OutboxModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	EventID   string    `gorm:"column:event_id;size:64;uniqueIndex"`
	EventType string    `gorm:"column:event_type;size:128;index"`
	TargetID  string    `gorm:"column:target_id;size:64;index"`
	Payload   string    `gorm:"column:payload;type:text"`
	Status    string    `gorm:"column:status;size:32;index"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*OutboxModel) TableName() string { return "friend_chat_outbox" }

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	if err := r.db.AutoMigrate(&SessionModel{}, &MessageModel{}, &MessageAttachmentModel{}, &ThreadReadModel{}, &OutboxModel{}, &FriendRequestModel{}); err != nil {
		return err
	}
	return r.backfillThreadRootULIDs()
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
	var editedAt time.Time
	if item.EditedAt != nil {
		editedAt = *item.EditedAt
	}
	return domain.Message{
		ID:               item.ULID,
		SessionID:        item.SessionULID,
		SenderDID:        item.SenderDID,
		ReceiverDID:      item.ReceiverDID,
		Type:             item.Type,
		Content:          item.Content,
		EncryptedPayload: append([]byte(nil), item.EncryptedPayload...),
		ReplyToID:        item.ReplyToULID,
		ThreadRootID:     item.ThreadRootULID,
		Status:           item.Status,
		Recalled:         item.Recalled,
		EditedAt:         editedAt,
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
		Visibility:   m.Visibility,
	}
}

func (r *GormRepo) resolveThreadRootULID(db *gorm.DB, sessionID, replyToULID, explicitRootULID string) (string, error) {
	if explicitRootULID != "" {
		return explicitRootULID, nil
	}
	if replyToULID == "" {
		return "", nil
	}
	var parent MessageModel
	if err := db.Where("session_ulid = ? AND ulid = ?", sessionID, replyToULID).First(&parent).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return replyToULID, nil
		}
		return "", err
	}
	if parent.ThreadRootULID != "" {
		return parent.ThreadRootULID, nil
	}
	return parent.ULID, nil
}

func (r *GormRepo) threadRepliesQuery(db *gorm.DB, sessionID, rootULID string) *gorm.DB {
	return db.Where(
		"session_ulid = ? AND (thread_root_ulid = ? OR (COALESCE(thread_root_ulid, '') = '' AND reply_to_ulid = ?))",
		sessionID,
		rootULID,
		rootULID,
	)
}

func (r *GormRepo) backfillThreadRootULIDs() error {
	var rows []MessageModel
	if err := r.db.
		Where("reply_to_ulid <> ''").
		Order("sent_at ASC, ulid ASC").
		Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}

	byULID := make(map[string]MessageModel, len(rows))
	for _, row := range rows {
		byULID[row.ULID] = row
	}
	resolving := make(map[string]bool, len(rows))
	resolved := make(map[string]string, len(rows))
	var resolve func(MessageModel) string
	resolve = func(row MessageModel) string {
		if row.ThreadRootULID != "" {
			return row.ThreadRootULID
		}
		if cached, ok := resolved[row.ULID]; ok {
			return cached
		}
		if row.ReplyToULID == "" || resolving[row.ULID] {
			return ""
		}
		resolving[row.ULID] = true
		root := row.ReplyToULID
		if parent, ok := byULID[row.ReplyToULID]; ok {
			if parentRoot := resolve(parent); parentRoot != "" {
				root = parentRoot
			}
		}
		resolving[row.ULID] = false
		resolved[row.ULID] = root
		return root
	}

	for _, row := range rows {
		root := resolve(row)
		if root == "" || root == row.ThreadRootULID {
			continue
		}
		if err := r.db.Model(&MessageModel{}).
			Where("id = ?", row.ID).
			Update("thread_root_ulid", root).Error; err != nil {
			return err
		}
	}
	return nil
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
	threadRootULID, err := r.resolveThreadRootULID(r.db, message.SessionID, message.ReplyToID, message.ThreadRootID)
	if err != nil {
		return domain.Message{}, err
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
		ThreadRootULID:   threadRootULID,
		Status:           message.Status,
		SentAt:           now,
	}
	err = r.db.Transaction(func(tx *gorm.DB) error {
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
				Visibility:   a.Visibility,
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

func (r *GormRepo) ListThreadMessages(sessionID, rootUlid, afterUlid string, limit int) ([]domain.Message, error) {
	if limit <= 0 {
		limit = 100
	}
	var root MessageModel
	if err := r.db.Where("session_ulid = ? AND ulid = ?", sessionID, rootUlid).First(&root).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return []domain.Message{}, nil
		}
		return nil, err
	}

	var replies []MessageModel
	query := r.threadRepliesQuery(r.db, sessionID, rootUlid)
	if afterUlid != "" && afterUlid != rootUlid {
		var cursor MessageModel
		err := r.threadRepliesQuery(r.db, sessionID, rootUlid).
			Where("ulid = ?", afterUlid).
			First(&cursor).Error
		if err == nil {
			query = query.Where("(sent_at > ? OR (sent_at = ? AND ulid > ?))", cursor.SentAt, cursor.SentAt, cursor.ULID)
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			query = query.Where("1 = 0")
		} else {
			return nil, err
		}
	}
	if err := query.
		Order("sent_at ASC, ulid ASC").
		Limit(limit).
		Find(&replies).Error; err != nil {
		return nil, err
	}

	out := make([]domain.Message, 0, 1+len(replies))
	out = append(out, toDomainMessage(root))
	for _, item := range replies {
		out = append(out, toDomainMessage(item))
	}
	if err := r.mergeAttachmentsIntoMessages(out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *GormRepo) ThreadCounts(sessionID, actorDID string, rootULIDs []string) ([]domain.ThreadCount, error) {
	out := make([]domain.ThreadCount, 0, len(rootULIDs))
	if len(rootULIDs) == 0 {
		return out, nil
	}

	readRows := make([]ThreadReadModel, 0, len(rootULIDs))
	if err := r.db.
		Where("session_ulid = ? AND actor_did = ? AND root_ulid IN ?", sessionID, actorDID, rootULIDs).
		Find(&readRows).Error; err != nil {
		return nil, err
	}
	readByRoot := make(map[string]ThreadReadModel, len(readRows))
	for _, row := range readRows {
		readByRoot[row.RootULID] = row
	}

	for _, rootULID := range rootULIDs {
		item := domain.ThreadCount{RootULID: rootULID}
		if err := r.threadRepliesQuery(r.db.Model(&MessageModel{}), sessionID, rootULID).
			Count(&item.ReplyCount).Error; err != nil {
			return nil, err
		}

		var latest MessageModel
		if err := r.threadRepliesQuery(r.db, sessionID, rootULID).
			Order("sent_at DESC, ulid DESC").
			First(&latest).Error; err == nil {
			item.LatestReplyULID = latest.ULID
			item.LatestReplyAt = latest.SentAt
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		readAt := time.Time{}
		if read, ok := readByRoot[rootULID]; ok {
			readAt = read.LastReadAt
		}
		if err := r.threadRepliesQuery(r.db.Model(&MessageModel{}), sessionID, rootULID).
			Where("sent_at > ? AND sender_did <> ?", readAt, actorDID).
			Count(&item.UnreadCount).Error; err != nil {
			return nil, err
		}

		out = append(out, item)
	}

	return out, nil
}

func (r *GormRepo) MarkThreadRead(actorDID, sessionID, rootULID, lastReadULID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var root MessageModel
		if err := tx.Where("session_ulid = ? AND ulid = ?", sessionID, rootULID).First(&root).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrMessageNotFound
			}
			return err
		}

		cursorULID := root.ULID
		cursorAt := root.SentAt
		if lastReadULID != "" {
			var provided MessageModel
			err := tx.
				Where("session_ulid = ? AND ulid = ? AND (ulid = ? OR thread_root_ulid = ? OR (COALESCE(thread_root_ulid, '') = '' AND reply_to_ulid = ?))", sessionID, lastReadULID, rootULID, rootULID, rootULID).
				First(&provided).Error
			if err == nil {
				cursorULID = provided.ULID
				cursorAt = provided.SentAt
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			} else if latestULID, latestAt, ok, latestErr := latestFriendThreadCursor(tx, sessionID, rootULID); latestErr != nil {
				return latestErr
			} else if ok {
				cursorULID = latestULID
				cursorAt = latestAt
			}
		} else if latestULID, latestAt, ok, err := latestFriendThreadCursor(tx, sessionID, rootULID); err != nil {
			return err
		} else if ok {
			cursorULID = latestULID
			cursorAt = latestAt
		}

		now := time.Now()
		var read ThreadReadModel
		return tx.
			Where("session_ulid = ? AND root_ulid = ? AND actor_did = ?", sessionID, rootULID, actorDID).
			Assign(ThreadReadModel{
				LastReadULID: cursorULID,
				LastReadAt:   cursorAt,
				UpdatedAt:    now,
			}).
			FirstOrCreate(&read, ThreadReadModel{
				SessionULID: sessionID,
				RootULID:    rootULID,
				ActorDID:    actorDID,
				CreatedAt:   now,
			}).Error
	})
}

func latestFriendThreadCursor(tx *gorm.DB, sessionID, rootULID string) (string, time.Time, bool, error) {
	var latest MessageModel
	if err := (&GormRepo{}).threadRepliesQuery(tx, sessionID, rootULID).
		Order("sent_at DESC, ulid DESC").
		First(&latest).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", time.Time{}, false, nil
		}
		return "", time.Time{}, false, err
	}

	return latest.ULID, latest.SentAt, true, nil
}

// MarkRead persists a status flip (DELIVERED/READ/FAILED…) on a batch
// of message ulids and returns one AckedMessage per row that was
// actually updated. The caller (application.Service) uses that slice
// to fan out realtime MessageReceipt events to each original sender.
//
// Why we resolve the message rows *inside* the transaction rather
// than letting the caller pre-look-up the senders:
//
//  1. We need to ignore ulids the receiver doesn't own — both for
//     security (don't leak that some unrelated ulid exists) and to
//     avoid publishing receipts for messages the receiver never
//     legitimately received. The cheapest filter is "must appear in
//     `(ulid IN ?, receiver_did = actor)`" right next to the UPDATE.
//  2. Doing the lookup in the same tx as the UPDATE means the
//     returned slice is exactly the slice of rows that were flipped,
//     even if a concurrent ack races us — the receipt fan-out and
//     the persistence stay consistent.
func (r *GormRepo) MarkRead(actorDID string, messageIDs []string, status int32) ([]domain.AckedMessage, error) {
	var acked []domain.AckedMessage
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Resolve the rows the receiver actually owns. We pluck
		// (ulid, sender_did, session_ulid) so the realtime publisher
		// has all three without a second round-trip. The
		// `receiver_did = actorDID` clause is the security gate.
		type ackRow struct {
			ULID        string
			SenderDID   string
			SessionULID string
		}
		var rows []ackRow
		if err := tx.Model(&MessageModel{}).
			Where("ulid IN ? AND receiver_did = ?", messageIDs, actorDID).
			Select("ulid", "sender_did", "session_ulid").
			Scan(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		legitULIDs := make([]string, 0, len(rows))
		for _, row := range rows {
			legitULIDs = append(legitULIDs, row.ULID)
		}

		// Only forward-flips: never downgrade an already-READ row to
		// DELIVERED when a stale ack arrives out of order. Status
		// progression follows FriendMessageStatus enum ordering
		// (SENT=2 < DELIVERED=3 < READ=4) so a strict-greater filter
		// is correct. UNSPECIFIED(0) and SENDING(1) won't appear on
		// already-persisted server rows.
		if err := tx.Model(&MessageModel{}).
			Where("ulid IN ? AND status < ?", legitULIDs, status).
			Updates(map[string]interface{}{
				"status":     status,
				"updated_at": time.Now(),
			}).Error; err != nil {
			return err
		}

		// Scope unread reset to only sessions that contain the acked
		// messages, and only when this ack is at-least READ.
		// Otherwise a DELIVERED ack would zero the receiver's unread
		// counter prematurely.
		if status >= 4 { // FriendMessageStatus.READ
			sessionULIDs := make([]string, 0, len(rows))
			seen := map[string]struct{}{}
			for _, row := range rows {
				if _, ok := seen[row.SessionULID]; ok {
					continue
				}
				seen[row.SessionULID] = struct{}{}
				sessionULIDs = append(sessionULIDs, row.SessionULID)
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
		}

		outbox := OutboxModel{
			EventID:   fmt.Sprintf("fce-%d", time.Now().UnixNano()),
			EventType: "friend.message.acked",
			TargetID:  actorDID,
			Payload:   fmt.Sprintf(`{"count":%d,"status":%d}`, len(rows), status),
			Status:    "pending",
		}
		if err := tx.Create(&outbox).Error; err != nil {
			return err
		}
		acked = make([]domain.AckedMessage, len(rows))
		for i, row := range rows {
			acked[i] = domain.AckedMessage{
				Ulid:        row.ULID,
				SenderDID:   row.SenderDID,
				SessionULID: row.SessionULID,
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return acked, nil
}

// ============================================================================
// Message Mutations: recall / edit / delete
// ============================================================================
//
// All three share the same authorization gate: only the row's
// `sender_did` may invoke the mutation, and we resolve that gate
// inside the repo so application/service does not have to hand-craft
// a second SELECT. Each mutation also returns a `MutationOutcome`
// the handler uses to fan-out a realtime MessageMutation event so
// peers learn about the change in real time.

// RecallMessage clears the content + encrypted_payload of one message
// and flips `recalled = true`. Returns ErrPermissionDenied when the
// caller is not the sender, ErrMessageNotFound when no row matches,
// or the underlying error from the DB. Idempotent: a recall on an
// already-recalled message is a no-op (no event re-published).
//
// `recallWindow` is the operator-tunable time-after-send during
// which a recall is permitted. Pass 0 to disable the window check
// (only the sender-ownership rule applies).
func (r *GormRepo) RecallMessage(actorDID, sessionULID, messageULID string, recallWindow time.Duration) (domain.MutationOutcome, error) {
	var out domain.MutationOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var row MessageModel
		if err := tx.Where("ulid = ? AND session_ulid = ?", messageULID, sessionULID).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrMessageNotFound
			}
			return err
		}
		if row.SenderDID != actorDID {
			// Surfacing ErrPermissionDenied (rather than NotFound)
			// to the sender's own UI is fine — they already know the
			// row exists; what we are denying is the *action*. To a
			// non-owner we still want NotFound for opacity, which
			// the handler maps from this same error.
			return ErrPermissionDenied
		}
		if recallWindow > 0 && time.Since(row.SentAt) > recallWindow {
			return ErrMutationWindowClosed
		}
		if row.Recalled {
			// Idempotent: still return the row's metadata so the
			// caller can decide whether to skip the event publish.
			out = mutationOutcomeFrom(row, int32(realtimeKindRecall), nil, "")
			return nil
		}
		now := time.Now()
		if err := tx.Model(&row).Updates(map[string]interface{}{
			"content":           "",
			"encrypted_payload": nil,
			"recalled":          true,
			"updated_at":        now,
		}).Error; err != nil {
			return err
		}
		row.Content = ""
		row.EncryptedPayload = nil
		row.Recalled = true
		row.UpdatedAt = now
		out = mutationOutcomeFrom(row, int32(realtimeKindRecall), nil, "")
		return nil
	})
	if err != nil {
		return domain.MutationOutcome{}, err
	}
	return out, nil
}

// EditMessage replaces a message's body. Both `newContent` and
// `newCiphertext` may be set; for E2EE chats the ciphertext is the
// authoritative replacement and `newContent` is typically a
// non-secret placeholder. We persist whatever the caller sends so
// catch-up clients (cold sync) see the post-edit state without
// needing a separate edit-history query.
//
// Edits on a recalled row are rejected: the recall is the terminal
// state for a kept-but-cleared message. The caller surfaces this as
// ErrMessageNotFound to mask the existence of the row from a
// non-owner observer; the owner gets ErrAlreadyRecalled.
func (r *GormRepo) EditMessage(actorDID, sessionULID, messageULID string, newContent string, newCiphertext []byte, editWindow time.Duration) (domain.MutationOutcome, error) {
	var out domain.MutationOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var row MessageModel
		if err := tx.Where("ulid = ? AND session_ulid = ?", messageULID, sessionULID).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrMessageNotFound
			}
			return err
		}
		if row.SenderDID != actorDID {
			return ErrPermissionDenied
		}
		if row.Recalled {
			return ErrAlreadyRecalled
		}
		if editWindow > 0 && time.Since(row.SentAt) > editWindow {
			return ErrMutationWindowClosed
		}
		now := time.Now()
		updates := map[string]interface{}{
			"content":           newContent,
			"encrypted_payload": append([]byte(nil), newCiphertext...),
			"edited_at":         &now,
			"updated_at":        now,
		}
		if err := tx.Model(&row).Updates(updates).Error; err != nil {
			return err
		}
		row.Content = newContent
		row.EncryptedPayload = append([]byte(nil), newCiphertext...)
		row.EditedAt = &now
		row.UpdatedAt = now
		out = mutationOutcomeFrom(row, int32(realtimeKindEdit), append([]byte(nil), newCiphertext...), newContent)
		return nil
	})
	if err != nil {
		return domain.MutationOutcome{}, err
	}
	return out, nil
}

// DeleteMessage hard-deletes the row plus its attachment rows in a
// single transaction. We also clear the parent session's
// `last_message_*` pointer when it referred to the deleted ulid, so
// the conversation list does not display a deleted snippet on its
// next refresh.
//
// We deliberately do not decrement unread_count_*: the receiver may
// have already counted (and displayed) this message, and a delete
// from the sender side should not retroactively change the
// receiver's unread tally. The receiver's UI will re-read the
// session next time and naturally drop the slot.
func (r *GormRepo) DeleteMessage(actorDID, sessionULID, messageULID string) (domain.MutationOutcome, error) {
	var out domain.MutationOutcome
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var row MessageModel
		if err := tx.Where("ulid = ? AND session_ulid = ?", messageULID, sessionULID).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrMessageNotFound
			}
			return err
		}
		if row.SenderDID != actorDID {
			return ErrPermissionDenied
		}
		// Capture the outcome metadata BEFORE the delete so the
		// caller still has SenderDID / SessionULID for the realtime
		// fan-out, even though the row is about to vanish.
		out = mutationOutcomeFrom(row, int32(realtimeKindDelete), nil, "")
		if err := tx.Where("message_ulid = ?", messageULID).Delete(&MessageAttachmentModel{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&row).Error; err != nil {
			return err
		}
		var session SessionModel
		if err := tx.Where("ulid = ?", sessionULID).First(&session).Error; err == nil {
			if session.LastMessageULID == messageULID {
				// Best-effort: pick the next-newest message in the
				// session, or zero out the pointer if this was the
				// only message. We do not block on this — the
				// previous_at/ulid recovery is a UI nicety.
				var prev MessageModel
				err := tx.Where("session_ulid = ?", sessionULID).Order("sent_at DESC").First(&prev).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					session.LastMessageULID = ""
					session.LastMessageAt = time.Time{}
				} else if err == nil {
					session.LastMessageULID = prev.ULID
					session.LastMessageAt = prev.SentAt
				}
				session.UpdatedAt = time.Now()
				_ = tx.Save(&session).Error
			}
		}
		return nil
	})
	if err != nil {
		return domain.MutationOutcome{}, err
	}
	return out, nil
}

// realtimeKind* mirror the realtime.MessageMutation_Kind enum on the
// wire. We can't import the realtime proto from the repo package
// without taking a heavier dependency, and these three values are
// stable per the proto contract — adding a new kind requires
// growing the enum and this list together.
const (
	realtimeKindRecall = 1
	realtimeKindEdit   = 2
	realtimeKindDelete = 3
)

func mutationOutcomeFrom(row MessageModel, kind int32, ciphertext []byte, content string) domain.MutationOutcome {
	return domain.MutationOutcome{
		Ulid:          row.ULID,
		SessionULID:   row.SessionULID,
		SenderDID:     row.SenderDID,
		ReceiverDID:   row.ReceiverDID,
		Kind:          kind,
		NewContent:    content,
		NewCiphertext: ciphertext,
		MutatedAt:     time.Now(),
	}
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

func (r *GormRepo) DeleteFriend(actorDID, peerDID string) error {
	key := pairKey(actorDID, peerDID)

	return r.db.Transaction(func(tx *gorm.DB) error {
		var relationCount int64
		if err := tx.Model(&FriendRequestModel{}).
			Where("pair_key = ? AND status = ?", key, domain.FriendRequestStatusAccepted).
			Count(&relationCount).Error; err != nil {
			return err
		}
		if relationCount == 0 {
			return ErrFriendRelationNotFound
		}

		if err := tx.
			Where("pair_key = ? AND status IN ?", key, []int32{
				domain.FriendRequestStatusPending,
				domain.FriendRequestStatusAccepted,
				domain.FriendRequestStatusRejected,
				domain.FriendRequestStatusRemoved,
			}).
			Delete(&FriendRequestModel{}).Error; err != nil {
			return err
		}

		var session SessionModel
		err := tx.Where("pair_key = ?", key).First(&session).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}

		var messageULIDs []string
		if err := tx.Model(&MessageModel{}).
			Where("session_ulid = ?", session.ULID).
			Pluck("ulid", &messageULIDs).Error; err != nil {
			return err
		}
		if len(messageULIDs) > 0 {
			if err := tx.Where("message_ulid IN ?", messageULIDs).Delete(&MessageAttachmentModel{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("session_ulid = ?", session.ULID).Delete(&ThreadReadModel{}).Error; err != nil {
			return err
		}
		if err := tx.Where("session_ulid = ?", session.ULID).Delete(&MessageModel{}).Error; err != nil {
			return err
		}
		return tx.Delete(&session).Error
	})
}

// BatchLoadActorSummaries looks up display name + avatar for a set of actor IDs.
// IDs are numeric strings (strconv'd actor primary keys).
func (r *GormRepo) BatchLoadActorSummaries(ids []string) map[string]application.ActorSummary {
	result := make(map[string]application.ActorSummary, len(ids))
	if len(ids) == 0 {
		return result
	}
	type row struct {
		ID   uint64 `gorm:"column:id"`
		Name string `gorm:"column:name"`
		Icon string `gorm:"column:icon"`
	}
	var rows []row
	r.db.Table("touch_actor").Select("id, name, icon").Where("id IN ?", ids).Find(&rows)
	for _, r := range rows {
		result[fmt.Sprintf("%d", r.ID)] = application.ActorSummary{
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
