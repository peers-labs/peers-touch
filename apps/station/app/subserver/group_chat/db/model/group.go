package model

import (
	"time"
)

// Group visibility constants
const (
	GroupVisibilityPublic  = 1
	GroupVisibilityPrivate = 2
)

// Group type constants
const (
	GroupTypeNormal       = 1
	GroupTypeAnnouncement = 2
	GroupTypeDiscussion   = 3
)

// Group represents a chat group
type Group struct {
	ID          uint64    `gorm:"primaryKey;autoIncrement"`
	ULID        string    `gorm:"column:ul_id;uniqueIndex;size:26;not null"`
	Name        string    `gorm:"size:100;not null"`
	Description string    `gorm:"type:text"`
	AvatarCID   string    `gorm:"column:avatar_cid;size:100"`
	OwnerDID    string    `gorm:"column:owner_did;size:50;not null;index"`
	Type        int       `gorm:"default:1"`
	Visibility  int       `gorm:"default:1"`
	MemberCount int       `gorm:"default:0"`
	MaxMembers  int       `gorm:"default:500"`
	Muted       bool      `gorm:"default:false"`
	CreatedAt   time.Time `gorm:"autoCreateTime"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime"`
}

func (Group) TableName() string {
	return "touch_group"
}

// GroupInvitation represents a group invitation
type GroupInvitation struct {
	ID         uint64    `gorm:"primaryKey;autoIncrement"`
	ULID       string    `gorm:"column:ul_id;uniqueIndex;size:26;not null"`
	GroupULID  string    `gorm:"column:group_ul_id;size:26;not null;index"`
	InviterDID string    `gorm:"column:inviter_did;size:50;not null"`
	InviteeDID string    `gorm:"column:invitee_did;size:50;not null;index"`
	Status     int       `gorm:"default:1"` // 1=pending, 2=accepted, 3=rejected, 4=expired
	ExpireAt   time.Time `gorm:"index"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}

func (GroupInvitation) TableName() string {
	return "touch_group_invitation"
}

// Invitation status constants
const (
	InvitationStatusPending  = 1
	InvitationStatusAccepted = 2
	InvitationStatusRejected = 3
	InvitationStatusExpired  = 4
)
