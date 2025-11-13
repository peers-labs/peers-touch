package db

import (
    "time"
)

type Attachment struct {
    CID       string    `gorm:"primary_key;size:128"`
    ConvID    string    `gorm:"index;size:64"`
    MsgULID   string    `gorm:"index;size:32"`
    MIME      string    `gorm:"size:64"`
    Bytes     int64     `gorm:"index"`
    Digest    string    `gorm:"size:128"`
    Store     string    `gorm:"size:32"`
    CreatedAt time.Time `gorm:"created_at"`
    UpdatedAt time.Time `gorm:"updated_at"`
}

func (*Attachment) TableName() string { return "touch_attachment" }