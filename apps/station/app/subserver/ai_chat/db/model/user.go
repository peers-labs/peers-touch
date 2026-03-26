package model

import (
	"time"
)

// User 用户表
type User struct {
	ID          string    `gorm:"primaryKey;type:text"`
	PeersUserID *string   `gorm:"unique;type:text"`
	DisplayName *string   `gorm:"unique;type:text"`
	CreatedAt   time.Time `gorm:"not null;default:now()"`
	UpdatedAt   time.Time `gorm:"not null;default:now()"`
}

// TableName 设置表名
func (User) TableName() string {
	return "ai_chat_users"
}
