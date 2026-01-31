package model

import (
	"time"
)

// Group role constants
const (
	GroupRoleMember = 1
	GroupRoleAdmin  = 2
	GroupRoleOwner  = 3
)

// GroupMember represents a group member
type GroupMember struct {
	ID         uint64    `gorm:"primaryKey;autoIncrement"`
	GroupULID  string    `gorm:"column:group_ul_id;size:26;not null;index:idx_group_member,unique"`
	ActorDID   string    `gorm:"column:actor_did;size:50;not null;index:idx_group_member,unique;index:idx_actor_groups"`
	Role       int       `gorm:"default:1"` // 1=member, 2=admin, 3=owner
	Nickname   string    `gorm:"size:50"`
	Muted      bool      `gorm:"default:false"`
	MutedUntil time.Time
	JoinedAt   time.Time `gorm:"autoCreateTime"`
	InvitedBy  string    `gorm:"column:invited_by;size:50"`
}

func (GroupMember) TableName() string {
	return "touch_group_member"
}
