package persistence

import "time"

// AgentPackageImportReceipt preserves the exact result of an atomic package import.
type AgentPackageImportReceipt struct {
	ID             string    `gorm:"column:id;primaryKey;type:varchar(64)"`
	Ptid           string    `gorm:"column:ptid;not null;type:text;uniqueIndex:idx_agent_package_import_receipt,priority:1"`
	IdempotencyKey string    `gorm:"column:idempotency_key;not null;type:varchar(160);uniqueIndex:idx_agent_package_import_receipt,priority:2"`
	PayloadHash    string    `gorm:"column:payload_hash;not null;type:varchar(64)"`
	AgentID        string    `gorm:"column:agent_id;not null;type:varchar(36);index"`
	ResultPayload  []byte    `gorm:"column:result_payload;not null;type:bytea"`
	CreatedAt      time.Time `gorm:"column:created_at;not null"`
}

func (AgentPackageImportReceipt) TableName() string {
	return "agent_package_import_receipts"
}
