// Package domain contains the core domain models (aggregate roots) for the
// dashboard SubServer. These models are persistence-aware via GORM tags but
// carry no business logic themselves — that lives in the application layer.
//
// Change History:
// - 2026-04-10: Initial implementation — DashboardAdmin, DashboardSession,
//   DashboardAuditLog aggregate roots with complete GORM mapping.
// - 2026-04-10: Refactored from flat package to DDD domain layer.
package domain

import (
	"time"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// DashboardAdmin is the aggregate root for dashboard administrators.
// This is completely separate from the Peers actor system — it has its
// own user table, own JWT tokens, and own session management.
// ---------------------------------------------------------------------------

type DashboardAdmin struct {
	ID           uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	Username     string         `gorm:"uniqueIndex;size:100;not null" json:"username"`
	PasswordHash string         `gorm:"size:255;not null" json:"-"`
	DisplayName  string         `gorm:"size:100" json:"display_name"`
	Role         AdminRole      `gorm:"size:20;not null;default:'admin'" json:"role"`
	IsSuperUser  bool           `gorm:"default:false" json:"is_super_user"`
	DID          string         `gorm:"size:255;index" json:"did,omitempty"`
	Disabled     bool           `gorm:"default:false" json:"disabled"`
	LastLoginAt  *time.Time     `json:"last_login_at,omitempty"`
	LastLoginIP  string         `gorm:"size:50" json:"last_login_ip,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
}

func (DashboardAdmin) TableName() string {
	return "dashboard_admins"
}

// AdminRole enumerates the valid admin roles.
type AdminRole string

const (
	AdminRoleSuper AdminRole = "super"
	AdminRoleAdmin AdminRole = "admin"
)

// ---------------------------------------------------------------------------
// DashboardSession is the aggregate root for active admin sessions.
// ---------------------------------------------------------------------------

type DashboardSession struct {
	ID           uint64     `gorm:"primaryKey;autoIncrement"`
	SessionID    string     `gorm:"uniqueIndex;size:100;not null"`
	AdminID      uint64     `gorm:"index;not null"`
	IPAddress    string     `gorm:"size:50"`
	UserAgent    string     `gorm:"size:500"`
	CreatedAt    time.Time  `gorm:"not null"`
	ExpiresAt    time.Time  `gorm:"not null"`
	LastActiveAt time.Time  `gorm:"not null"`
	Revoked      bool       `gorm:"default:false"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
}

func (DashboardSession) TableName() string {
	return "dashboard_sessions"
}

// ---------------------------------------------------------------------------
// DashboardAuditLog records all admin operations for security auditing.
// ---------------------------------------------------------------------------

type DashboardAuditLog struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement"`
	AdminID   uint64    `gorm:"index;not null"`
	Username  string    `gorm:"size:100;not null"`
	Action    string    `gorm:"size:100;not null;index"`
	Resource  string    `gorm:"size:100"`
	Detail    string    `gorm:"type:text"`
	IPAddress string    `gorm:"size:50"`
	UserAgent string    `gorm:"size:500"`
	CreatedAt time.Time `gorm:"not null;index"`
}

func (DashboardAuditLog) TableName() string {
	return "dashboard_audit_logs"
}
