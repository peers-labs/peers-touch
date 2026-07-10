package persistence

import "time"

// TaskArtifactBlob stores Station-owned artifact body content outside the
// projection outbox. Projection events only carry body metadata and body URI.
type TaskArtifactBlob struct {
	BlobID          string     `gorm:"primaryKey;type:varchar(128)"`
	ArtifactID      string     `gorm:"not null;type:varchar(64);index:idx_agent_task_artifact_blobs_artifact"`
	TaskID          string     `gorm:"not null;type:varchar(36);index:idx_agent_task_artifact_blobs_task"`
	StepID          string     `gorm:"type:varchar(36);index:idx_agent_task_artifact_blobs_step"`
	TurnID          string     `gorm:"type:varchar(36);index:idx_agent_task_artifact_blobs_turn"`
	EventID         string     `gorm:"type:varchar(36);index:idx_agent_task_artifact_blobs_event"`
	EventSeq        int64      `gorm:"not null;default:0;index:idx_agent_task_artifact_blobs_event_seq"`
	BodyKind        string     `gorm:"type:varchar(32);index:idx_agent_task_artifact_blobs_body_kind"`
	BodyURI         string     `gorm:"type:text"`
	ContentHash     string     `gorm:"type:text"`
	ByteSize        int64      `gorm:"not null;default:0"`
	RetentionPolicy string     `gorm:"type:varchar(64);index:idx_agent_task_artifact_blobs_retention_policy"`
	RetentionStatus string     `gorm:"type:varchar(32);index:idx_agent_task_artifact_blobs_retention_status"`
	BodyText        string     `gorm:"type:text"`
	CreatedAt       time.Time  `gorm:"not null;default:now();index:idx_agent_task_artifact_blobs_created"`
	ExpiresAt       *time.Time `gorm:"index:idx_agent_task_artifact_blobs_expires"`
}

func (TaskArtifactBlob) TableName() string { return "agent_task_artifact_blobs" }
