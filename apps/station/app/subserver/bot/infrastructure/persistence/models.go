package persistence

import "time"

// BotRegistrationModel is the bot_registration table. Plaintext secret is
// never stored; only a SHA-256 hash and a non-reversible last-4 hint.
type BotRegistrationModel struct {
	ID                 uint64     `gorm:"column:id;primaryKey;autoIncrement:true"`
	BotPtid            string     `gorm:"column:bot_ptid;size:255;uniqueIndex;not null"`
	OwnerPtid          string     `gorm:"column:owner_ptid;size:255;not null;index:idx_bot_owner"`
	Name               string     `gorm:"column:name;size:100;not null;index:idx_bot_owner"`
	State              int32      `gorm:"column:state;not null;index"`
	WebhookID          string     `gorm:"column:webhook_id;size:64;uniqueIndex;not null"`
	SecretHash         string     `gorm:"column:secret_hash;size:64;not null;default:''"`
	SecretHint         string     `gorm:"column:secret_hint;size:16;not null;default:''"`
	SecretDelivered    bool       `gorm:"column:secret_delivered;not null;default:false"`
	DeliveryScope      int32      `gorm:"column:delivery_scope;not null;default:1"`
	RateLimitPerMinute int32      `gorm:"column:rate_limit_per_minute;not null;default:120"`
	CreatedAt          time.Time  `gorm:"column:created_at"`
	DisabledAt         *time.Time `gorm:"column:disabled_at"`
	RevokedAt          *time.Time `gorm:"column:revoked_at"`
}

func (BotRegistrationModel) TableName() string { return "bot_registration" }
