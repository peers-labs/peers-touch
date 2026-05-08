package group_chat

import "time"

type groupModel struct {
	ID          uint      `gorm:"column:id;primaryKey"`
	ULID        string    `gorm:"column:ulid;size:64;uniqueIndex"`
	Name        string    `gorm:"column:name;size:255;index"`
	Description string    `gorm:"column:description;type:text"`
	OwnerDID    string    `gorm:"column:owner_did;size:255;index"`
	MemberCount int32     `gorm:"column:member_count"`
	CreatedAt   time.Time `gorm:"column:created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at"`
}

func (groupModel) TableName() string { return "group_chat_groups" }

type memberModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	GroupULID string    `gorm:"column:group_ulid;size:64;index:idx_gc_member,priority:1"`
	ActorDID  string    `gorm:"column:actor_did;size:255;index:idx_gc_member,priority:2"`
	Role      int32     `gorm:"column:role"`
	Nickname  string    `gorm:"column:nickname;size:255"`
	Muted     bool      `gorm:"column:muted"`
	JoinedAt  time.Time `gorm:"column:joined_at"`
	InvitedBy string    `gorm:"column:invited_by;size:255"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (memberModel) TableName() string { return "group_chat_members" }

type messageModel struct {
	ID               uint   `gorm:"column:id;primaryKey"`
	ULID             string `gorm:"column:ulid;size:64;uniqueIndex"`
	GroupULID        string `gorm:"column:group_ulid;size:64;index"`
	SenderDID        string `gorm:"column:sender_did;size:255;index"`
	Type             int32  `gorm:"column:type"`
	Content          string `gorm:"column:content;type:text"`
	EncryptedPayload []byte `gorm:"column:encrypted_payload;type:bytea"`
	ReplyToID        string `gorm:"column:reply_to_id;size:64"`
	ThreadRootID     string `gorm:"column:thread_root_ulid;size:64;index;default:''"`
	// Recalled flips on recall — content + encrypted_payload are
	// cleared at the same time. The on-disk column is still
	// `deleted` for backward DB compat (preserves existing rows
	// without a migration); the field rename here aligns with the
	// proto + friend_chat parity. Renaming the column itself can
	// land in a follow-up migration.
	Recalled bool `gorm:"column:deleted"`
	// EditedAt is non-null when the row has been mutated via edit.
	// Pointer so GORM leaves the column NULL on fresh inserts;
	// readers translate nil → zero-value time.Time downstream.
	EditedAt  *time.Time `gorm:"column:edited_at"`
	SentAt    time.Time  `gorm:"column:sent_at;index"`
	CreatedAt time.Time  `gorm:"column:created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`
}

func (messageModel) TableName() string { return "group_chat_messages" }

// MessageAttachmentModel stores per-message attachment metadata for group chat.
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
	return "group_chat_message_attachments"
}

type groupThreadReadModel struct {
	ID           uint      `gorm:"column:id;primaryKey"`
	GroupULID    string    `gorm:"column:group_ulid;size:64;uniqueIndex:idx_gctr_actor_thread,priority:1;index"`
	RootULID     string    `gorm:"column:root_ulid;size:64;uniqueIndex:idx_gctr_actor_thread,priority:2;index"`
	ActorDID     string    `gorm:"column:actor_did;size:255;uniqueIndex:idx_gctr_actor_thread,priority:3;index"`
	LastReadULID string    `gorm:"column:last_read_ulid;size:64"`
	LastReadAt   time.Time `gorm:"column:last_read_at;index"`
	CreatedAt    time.Time `gorm:"column:created_at"`
	UpdatedAt    time.Time `gorm:"column:updated_at"`
}

func (groupThreadReadModel) TableName() string {
	return "group_chat_thread_reads"
}

type outboxModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	EventID   string    `gorm:"column:event_id;size:64;uniqueIndex"`
	EventType string    `gorm:"column:event_type;size:128;index"`
	TargetID  string    `gorm:"column:target_id;size:64;index"`
	Payload   string    `gorm:"column:payload;type:text"`
	Status    string    `gorm:"column:status;size:32;index"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (outboxModel) TableName() string { return "group_chat_outbox" }

type invitationModel struct {
	ID         uint      `gorm:"column:id;primaryKey"`
	ULID       string    `gorm:"column:ulid;size:64;uniqueIndex"`
	GroupULID  string    `gorm:"column:group_ulid;size:64;index"`
	InviterDID string    `gorm:"column:inviter_did;size:255;index"`
	InviteeDID string    `gorm:"column:invitee_did;size:255;index"`
	Status     int32     `gorm:"column:status"`
	CreatedAt  time.Time `gorm:"column:created_at"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
}

func (invitationModel) TableName() string { return "group_chat_invitations" }

type settingModel struct {
	ID                 uint      `gorm:"column:id;primaryKey"`
	GroupULID          string    `gorm:"column:group_ulid;size:64;index:idx_gc_setting,priority:1"`
	ActorDID           string    `gorm:"column:actor_did;size:255;index:idx_gc_setting,priority:2"`
	IsMuted            bool      `gorm:"column:is_muted"`
	IsPinned           bool      `gorm:"column:is_pinned"`
	ShowMemberNickname bool      `gorm:"column:show_member_nickname"`
	CreatedAt          time.Time `gorm:"column:created_at"`
	UpdatedAt          time.Time `gorm:"column:updated_at"`
}

func (settingModel) TableName() string { return "group_chat_settings" }

type offlineModel struct {
	ID          uint      `gorm:"column:id;primaryKey"`
	ULID        string    `gorm:"column:ulid;size:64;uniqueIndex"`
	GroupULID   string    `gorm:"column:group_ulid;size:64;index"`
	MessageULID string    `gorm:"column:message_ulid;size:64;index"`
	ReceiverID  string    `gorm:"column:receiver_id;size:255;index"`
	CreatedAt   time.Time `gorm:"column:created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at"`
}

func (offlineModel) TableName() string { return "group_chat_offline" }
