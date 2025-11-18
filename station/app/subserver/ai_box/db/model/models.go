package model

import (
	"gorm.io/gorm"
)

// RegisterModels 注册所有模型到GORM
func RegisterModels(db *gorm.DB) error {
	return db.AutoMigrate(
		&User{},
		&Provider{},
		&Session{},
		&Topic{},
		&Message{},
		&Attachment{},
	)
}

// GetAllModels 返回所有模型切片，用于手动注册
func GetAllModels() []interface{} {
	return []interface{}{
		&User{},
		&Provider{},
		&Session{},
		&Topic{},
		&Message{},
		&Attachment{},
	}
}
