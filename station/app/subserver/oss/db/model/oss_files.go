package model

import "time"

type FileMeta struct {
    ID        string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
    Key       string    `json:"key" gorm:"uniqueIndex;type:varchar(255)"`
    Name      string    `json:"name" gorm:"type:varchar(255)"`
    Size      int64     `json:"size" gorm:"type:bigint"`
    Mime      string    `json:"mime" gorm:"type:varchar(100)"`
    Backend   string    `json:"backend" gorm:"type:varchar(50)"`
    Path      string    `json:"path" gorm:"type:varchar(1000)"`
    CreatedAt time.Time `json:"created_at" gorm:"not null;default:now()"`
}

func (FileMeta) TableName() string { return "oss_files" }

