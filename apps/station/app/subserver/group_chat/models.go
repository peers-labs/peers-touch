package group_chat

import "time"

type groupModel struct {
	ID          uint   `gorm:"primaryKey"`
	ULID        string `gorm:"size:64;uniqueIndex"`
	Name        string `gorm:"size:255;index"`
	Description string `gorm:"type:text"`
	OwnerDID    string `gorm:"size:255;index"`
	MemberCount int32
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type memberModel struct {
	ID        uint   `gorm:"primaryKey"`
	GroupULID string `gorm:"size:64;index:idx_gc_member,priority:1"`
	ActorDID  string `gorm:"size:255;index:idx_gc_member,priority:2"`
	Role      int32
	Nickname  string `gorm:"size:255"`
	Muted     bool
	JoinedAt  time.Time
	InvitedBy string `gorm:"size:255"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

type messageModel struct {
	ID               uint   `gorm:"primaryKey"`
	ULID             string `gorm:"size:64;uniqueIndex"`
	GroupULID        string `gorm:"size:64;index"`
	SenderDID        string `gorm:"size:255;index"`
	Type             int32
	Content          string `gorm:"type:text"`
	EncryptedPayload []byte `gorm:"type:bytea"`
	ReplyToID        string `gorm:"size:64"`
	Deleted          bool
	SentAt           time.Time `gorm:"index"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// MessageAttachmentModel stores per-message attachment metadata for group chat.
type MessageAttachmentModel struct {
	ID           uint   `gorm:"primaryKey"`
	MessageULID  string `gorm:"size:64;index"`
	CID          string `gorm:"size:255"`
	Filename     string `gorm:"size:255"`
	MimeType     string `gorm:"size:128"`
	Size         int64
	ThumbnailCID string `gorm:"size:255"`
}

func (MessageAttachmentModel) TableName() string {
	return "group_message_attachments"
}

type outboxModel struct {
	ID        uint   `gorm:"primaryKey"`
	EventID   string `gorm:"size:64;uniqueIndex"`
	EventType string `gorm:"size:128;index"`
	TargetID  string `gorm:"size:64;index"`
	Payload   string `gorm:"type:text"`
	Status    string `gorm:"size:32;index"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

type invitationModel struct {
	ID         uint   `gorm:"primaryKey"`
	ULID       string `gorm:"size:64;uniqueIndex"`
	GroupULID  string `gorm:"size:64;index"`
	InviterDID string `gorm:"size:255;index"`
	InviteeDID string `gorm:"size:255;index"`
	Status     int32
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type settingModel struct {
	ID                 uint   `gorm:"primaryKey"`
	GroupULID          string `gorm:"size:64;index:idx_gc_setting,priority:1"`
	ActorDID           string `gorm:"size:255;index:idx_gc_setting,priority:2"`
	IsMuted            bool
	IsPinned           bool
	ShowMemberNickname bool
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type offlineModel struct {
	ID          uint   `gorm:"primaryKey"`
	ULID        string `gorm:"size:64;uniqueIndex"`
	GroupULID   string `gorm:"size:64;index"`
	MessageULID string `gorm:"size:64;index"`
	ReceiverID  string `gorm:"size:255;index"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
