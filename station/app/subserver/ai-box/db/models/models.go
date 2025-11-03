package models

import (
	"time"
)

// Provider AI服务提供商 - 对应数据库providers表
type Provider struct {
	ID          string    `json:"id" gorm:"primaryKey;type:varchar(64)"`
	Name        string    `json:"name" gorm:"type:text"`                     // 提供商名称 (如: openai, anthropic)
	PeersUserID string    `json:"peers_user_id" gorm:"primaryKey;type:text"` // 用户ID
	Sort        int       `json:"sort" gorm:"type:integer"`                  // 排序权重
	Enabled     bool      `json:"enabled" gorm:"type:boolean"`               // 是否启用
	CheckModel  string    `json:"check_model" gorm:"type:text"`              // 检测模型
	Logo        string    `json:"logo" gorm:"type:text"`                     // Logo URL或base64
	Description string    `json:"description" gorm:"type:text"`              // 描述信息
	KeyVaults   string    `json:"key_vaults" gorm:"type:text"`               // 密钥配置
	SourceType  string    `json:"source_type" gorm:"type:varchar(20)"`       // 源类型
	Settings    string    `json:"settings" gorm:"type:jsonb"`                // 设置配置
	Config      string    `json:"config" gorm:"type:jsonb"`                  // 扩展配置
	AccessedAt  time.Time `json:"accessed_at" gorm:"not null"`
	CreatedAt   time.Time `json:"created_at" gorm:"not null"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"not null"`
}

// TableName 设置表名
func (Provider) TableName() string {
	return "ai_box.providers"
}
