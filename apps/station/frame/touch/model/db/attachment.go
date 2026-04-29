package db

import (
	"time"
)

type Attachment struct {
	CID       string    `gorm:"column:cid;primary_key;size:128"`
	ConvID    string    `gorm:"column:conv_id;index;size:64"`
	MsgULID   string    `gorm:"column:msg_ulid;index;size:32"`
	MIME      string    `gorm:"column:mime;size:64"`
	Bytes     int64     `gorm:"column:bytes;index"`
	Digest    string    `gorm:"column:digest;size:128"`
	Store     string    `gorm:"column:store;size:32"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*Attachment) TableName() string { return "touch_attachment" }
