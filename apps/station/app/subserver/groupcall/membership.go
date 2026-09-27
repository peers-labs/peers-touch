package groupcall

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// gormMemberLister queries the conversation domain's membership table
// to resolve group member PTIDs. This is a cross-domain bridge: the
// groupcall subserver reads the conversation_members table directly
// (same pattern as the social subserver's group membership checks).
//
// The table schema is owned by the conversation subserver; see
// conversation/infrastructure/persistence/models.go for the
// authoritative GORM model (ConversationMemberModel).
type gormMemberLister struct {
	db *gorm.DB
}

// NewGormMemberLister returns a GroupMemberLister backed by the shared
// PostgreSQL instance. Expects the conversation_members table to exist.
func NewGormMemberLister(db *gorm.DB) GroupMemberLister {
	return &gormMemberLister{db: db}
}

// memberRow is a lightweight projection — we only need the PTID column.
type memberRow struct {
	PTID string `gorm:"column:ptid"`
}

// ListGroupMemberPTIDs returns the PTIDs of all active members in the
// specified group (conversation). Only members with status = 'active'
// are included; removed/left members are excluded.
func (m *gormMemberLister) ListGroupMemberPTIDs(ctx context.Context, groupULID string) ([]string, error) {
	var rows []memberRow
	result := m.db.WithContext(ctx).
		Table("conversation_members").
		Select("ptid").
		Where("conversation_id = ? AND member_status = ?", groupULID, "active").
		Find(&rows)
	if result.Error != nil {
		return nil, fmt.Errorf("groupcall: membership query failed group_ulid=%s: %w", groupULID, result.Error)
	}

	ptids := make([]string, 0, len(rows))
	for _, r := range rows {
		ptids = append(ptids, r.PTID)
	}
	return ptids, nil
}
