package persistence

import "time"

type RecoveryRevisionModel struct {
	RevisionID             string    `gorm:"column:revision_id;size:128;primaryKey;index:idx_recovery_latest,priority:3,sort:desc"`
	PTID                   string    `gorm:"column:ptid;size:255;not null;index:idx_recovery_latest,priority:1"`
	FormatVersion          uint32    `gorm:"column:format_version;not null"`
	EncryptedArchive       []byte    `gorm:"column:encrypted_archive;type:bytea;not null"`
	EncryptedArchiveSHA256 []byte    `gorm:"column:encrypted_archive_sha256;type:bytea;not null"`
	CreatedByDeviceID      string    `gorm:"column:created_by_device_id;size:255;not null"`
	CreatedAt              time.Time `gorm:"column:created_at;not null;index:idx_recovery_latest,priority:2,sort:desc"`
}

func (*RecoveryRevisionModel) TableName() string {
	return "recovery_revisions"
}
