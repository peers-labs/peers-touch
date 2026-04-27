package model

import "time"

// FileMeta is the on-disk + DB record for a stored object.
//
// `Sha256` was added in 2026-04 to support the `cas` key strategy and
// content-integrity checks. It is *nullable* on purpose: legacy rows
// (uploaded by Stations that pre-date CAS) carry an empty string and
// continue to work — only newly uploaded files via the CAS strategy
// will populate it.
type FileMeta struct {
    ID        string    `json:"id" gorm:"primaryKey;type:varchar(64)"`
    Key       string    `json:"key" gorm:"uniqueIndex;type:varchar(255)"`
    Name      string    `json:"name" gorm:"type:varchar(255)"`
    Size      int64     `json:"size" gorm:"type:bigint"`
    Mime      string    `json:"mime" gorm:"type:varchar(100)"`
    Backend   string    `json:"backend" gorm:"type:varchar(50)"`
    Path      string    `json:"path" gorm:"type:varchar(1000)"`
    Sha256    string    `json:"sha256,omitempty" gorm:"index;type:varchar(64)"`
    CreatedAt time.Time `json:"created_at" gorm:"not null;default:now()"`
}

func (FileMeta) TableName() string { return "oss_files" }

