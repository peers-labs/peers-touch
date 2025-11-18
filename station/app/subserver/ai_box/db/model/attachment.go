package model

import (
	"encoding/json"
	"time"
)

// Attachment 附件表
type Attachment struct {
	ID           string          `gorm:"primaryKey;type:varchar(36)"`
	MessageID    string          `gorm:"not null;type:varchar(36);index:idx_attachments_message_id,priority:1"`
	Name         string          `gorm:"not null;type:varchar(255)"`
	Size         *int64          `gorm:"type:bigint"`
	Type         *string         `gorm:"type:varchar(100);index:idx_attachments_type,priority:1"`
	URL          *string         `gorm:"type:varchar(1000)"`
	MetadataJSON json.RawMessage `gorm:"type:jsonb;column:metadata_json"`
	CreatedAt    time.Time       `gorm:"not null;default:now()"`

	// 关联关系
	Message Message `gorm:"foreignKey:MessageID;references:ID"`
}

// TableName 设置表名
func (Attachment) TableName() string {
	return "ai_box.attachments"
}
