package model

import (
	"encoding/json"
	"time"
)

// Message 消息表
type Message struct {
	ID              string          `gorm:"primaryKey;type:varchar(36)"`
	SessionID       string          `gorm:"not null;type:varchar(36);index:idx_messages_session_id,priority:1"`
	TopicID         *string         `gorm:"type:varchar(36);index:idx_messages_topic_id,priority:1"`
	ModelName       *string         `gorm:"type:varchar(100)"`
	Role            string          `gorm:"not null;type:varchar(20);check:role in ('user', 'assistant', 'system')"`
	Content         *string         `gorm:"type:text;index:idx_messages_content_search,priority:1,type:gin"`
	ErrorJSON       json.RawMessage `gorm:"type:jsonb;column:error_json"`
	AttachmentsJSON json.RawMessage `gorm:"type:jsonb;column:attachments_json"`
	ImagesJSON      json.RawMessage `gorm:"type:jsonb;column:images_json"`
	MetadataJSON    json.RawMessage `gorm:"type:jsonb;column:metadata_json"`
	PluginJSON      json.RawMessage `gorm:"type:jsonb;column:plugin_json"`
	ToolCallsJSON   json.RawMessage `gorm:"type:jsonb;column:tool_calls_json"`
	ReasoningJSON   json.RawMessage `gorm:"type:jsonb;column:reasoning_json"`
	CreatedAt       time.Time       `gorm:"not null;default:now();index:idx_messages_created_at,priority:1"`
	UpdatedAt       time.Time       `gorm:"not null;default:now()"`

	// 关联关系
	Session     Session      `gorm:"foreignKey:SessionID;references:ID"`
	Topic       *Topic       `gorm:"foreignKey:TopicID;references:ID"`
	Attachments []Attachment `gorm:"foreignKey:MessageID;references:ID"`
}

// TableName 设置表名
func (Message) TableName() string {
	return "ai_box.messages"
}
