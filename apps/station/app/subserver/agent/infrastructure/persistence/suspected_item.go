package persistence

import "time"

// SuspectedItem tracks memories and skills that are suspected of causing
// quality degradation based on negative feedback attribution analysis.
type SuspectedItem struct {
	ID                string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID           string    `gorm:"not null;type:varchar(36);index:idx_suspected_agent_id"`
	ItemType          string    `gorm:"not null;type:varchar(10);check:item_type in ('memory','skill')"` // memory or skill
	ItemID            string    `gorm:"not null;type:varchar(36);index:idx_suspected_item_id"`
	ItemContent       string    `gorm:"type:text"`
	NegativeCount     int       `gorm:"not null;default:0"`
	AttributedTurnIDs string    `gorm:"type:text"` // JSON array of turn IDs
	Status            string    `gorm:"not null;type:varchar(20);default:'watching'"` // watching, suspected, cleared
	FirstAttributedAt time.Time `gorm:"not null;default:now()"`
	LastAttributedAt  time.Time `gorm:"not null;default:now()"`
	CreatedAt         time.Time `gorm:"not null;default:now()"`
	UpdatedAt         time.Time `gorm:"not null;default:now()"`
}

func (SuspectedItem) TableName() string { return "agent_suspected_items" }
