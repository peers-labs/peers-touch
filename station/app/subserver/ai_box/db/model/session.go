package model

import (
	"encoding/json"
	"time"
)

// Session 会话表
type Session struct {
	ID              string          `gorm:"primaryKey;type:varchar(36)"`
	Title           string          `gorm:"not null;type:varchar(255)"`
	Description     *string         `gorm:"type:text"`
	Avatar          *string         `gorm:"type:varchar(500)"`
	BackgroundColor *string         `gorm:"type:varchar(7)"`
	ProviderID      string          `gorm:"not null;type:varchar(64);index"`
	UserID          string          `gorm:"not null;type:text;index"`
	ModelName       *string         `gorm:"type:varchar(100)"`
	Pinned          *bool           `gorm:"default:false;type:boolean;index:idx_sessions_pinned,priority:1,where:pinned = true"`
	GroupName       *string         `gorm:"type:varchar(100)"`
	CreatedAt       time.Time       `gorm:"not null;default:now();index:idx_sessions_created_at,priority:1"`
	UpdatedAt       time.Time       `gorm:"not null;default:now()"`
	Meta            json.RawMessage `gorm:"type:jsonb"`
	ConfigJSON      json.RawMessage `gorm:"type:jsonb;column:config_json"`

	// 关联关系
	Provider Provider  `gorm:"foreignKey:ProviderID;references:ID"`
	User     User      `gorm:"foreignKey:UserID;references:ID"`
	Topics   []Topic   `gorm:"foreignKey:SessionID;references:ID"`
	Messages []Message `gorm:"foreignKey:SessionID;references:ID"`
}

// TableName 设置表名
func (Session) TableName() string {
	return "ai_box.sessions"
}
