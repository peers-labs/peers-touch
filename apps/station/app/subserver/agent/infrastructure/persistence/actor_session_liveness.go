package persistence

import "time"

// ActorSessionLiveness is a read-only projection of the identity frame's
// actor_sessions table. A client capability lease is a child credential of
// the actor session that registered it: when a renderer reload, takeover,
// logout, or expiry revokes the parent, the lease becomes unroutable even if
// the client never delivered an explicit lease revoke.
//
// Active-lease reads join this projection through
// ActiveLeaseParentAuthSessionCondition. The agent subserver never creates or
// migrates the production table — the identity frame owns its full schema;
// this minimal model exists for typed reads and test migrations.
type ActorSessionLiveness struct {
	SessionID string    `gorm:"primaryKey;column:session_id;type:varchar(100)"`
	Revoked   bool      `gorm:"column:revoked;not null;default:false"`
	ExpiresAt time.Time `gorm:"column:expires_at;not null"`
}

// TableName binds the read model to the identity frame table.
func (ActorSessionLiveness) TableName() string { return "actor_sessions" }
