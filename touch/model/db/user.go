package db

import "time"

type User struct {
	ID           uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	Name         string `gorm:"size:100;not null"`               // User's display name
	Email        string `gorm:"uniqueIndex;size:255;not null"`   // Unique email address
	PasswordHash string `gorm:"size:128;not null"`               // bcrypt hashed password

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (User) TableName() string {
	return "users"
}
