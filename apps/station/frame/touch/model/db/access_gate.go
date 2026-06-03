package db

import "time"

type AccessPolicy struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement"`
	Mode             string    `gorm:"size:32;not null;default:'open';uniqueIndex:idx_access_policy_singleton"`
	AllowedEmails    string    `gorm:"type:text"`
	AllowedUsernames string    `gorm:"type:text"`
	AllowedActorIDs  string    `gorm:"type:text"`
	UpdatedBy        string    `gorm:"size:128"`
	CreatedAt        time.Time `gorm:"autoCreateTime"`
	UpdatedAt        time.Time `gorm:"autoUpdateTime"`
}

func (*AccessPolicy) TableName() string { return "access_gate_policies" }
