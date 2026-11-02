package persistence

import "time"

// LogicalArtifact connects the immutable versions of one task result
// (TW-D3). Rows are never version-bearing themselves; current_version_id
// points at the latest ArtifactVersion.
type LogicalArtifact struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_logical_artifact_task"`
	ConversationID string    `gorm:"not null;type:varchar(36);index:idx_logical_artifact_conversation"`
	ActorPTID      string    `gorm:"column:actor_ptid;not null;type:text;index:idx_logical_artifact_actor"`
	AgentID        string    `gorm:"column:agent_id;not null;type:varchar(36);index"`
	Kind           string    `gorm:"not null;type:varchar(32)"`
	Name           string    `gorm:"not null;type:varchar(255)"`
	CurrentVersion string    `gorm:"not null;type:varchar(36)"`
	CurrentSeq     uint32    `gorm:"not null;default:0"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime"`
}

func (LogicalArtifact) TableName() string { return "agent_logical_artifacts" }

// ArtifactVersion is an immutable revision. A new id and seq are allocated
// for every byte change; the body table is insert-only by version id.
type ArtifactVersion struct {
	ID                    string    `gorm:"primaryKey;type:varchar(36)"`
	ArtifactID            string    `gorm:"not null;type:varchar(36);uniqueIndex:idx_artifact_version_seq,priority:1;index:idx_artifact_version_artifact"`
	Seq                   uint32    `gorm:"not null;uniqueIndex:idx_artifact_version_seq,priority:2"`
	ParentVersionID       string    `gorm:"not null;type:varchar(36);default:''"`
	Origin                string    `gorm:"not null;type:varchar(32)"`
	ContentType           string    `gorm:"not null;type:varchar(100);default:'text/markdown'"`
	SHA256                string    `gorm:"column:sha256;not null;type:varchar(64)"`
	Size                  uint64    `gorm:"not null;default:0"`
	Summary               string    `gorm:"not null;type:text;default:''"`
	SourceTurnID          string    `gorm:"not null;type:varchar(36);default:'';index"`
	SourceMessageID       string    `gorm:"not null;type:varchar(36);default:'';index"`
	FeedbackID            string    `gorm:"not null;type:varchar(36);default:'';index"`
	AdoptedAttachmentRefs string    `gorm:"not null;type:text;default:''"`
	IdempotencyKey        string    `gorm:"not null;type:varchar(100);default:'';index"`
	CreatedBy             string    `gorm:"not null;type:text"`
	CreatedAt             time.Time `gorm:"not null;autoCreateTime;index"`
}

func (ArtifactVersion) TableName() string { return "agent_artifact_versions" }

// ArtifactVersionBody holds revision bytes. There is no update path by
// contract: claiming a version inserts exactly one row keyed by version id.
type ArtifactVersionBody struct {
	VersionID   string    `gorm:"primaryKey;type:varchar(36)"`
	SHA256      string    `gorm:"column:sha256;not null;type:varchar(64)"`
	ContentType string    `gorm:"not null;type:varchar(100)"`
	Body        []byte    `gorm:"not null;type:bytea"`
	CreatedAt   time.Time `gorm:"not null;autoCreateTime"`
}

func (ArtifactVersionBody) TableName() string { return "agent_artifact_version_bodies" }

// ArtifactFeedback records selection/comment feedback against a base
// version. ResultingVersionID links the revision produced in response.
type ArtifactFeedback struct {
	ID                 string    `gorm:"primaryKey;type:varchar(36)"`
	ArtifactID         string    `gorm:"not null;type:varchar(36);index:idx_artifact_feedback_artifact"`
	BaseVersionID      string    `gorm:"not null;type:varchar(36);index"`
	Kind               string    `gorm:"not null;type:varchar(32)"`
	AnchorText         string    `gorm:"not null;type:text;default:''"`
	Instruction        string    `gorm:"not null;type:text"`
	ResultingVersionID string    `gorm:"not null;type:varchar(36);default:'';index"`
	IdempotencyKey     string    `gorm:"not null;type:varchar(100);default:'';index"`
	CreatedBy          string    `gorm:"not null;type:text"`
	CreatedAt          time.Time `gorm:"not null;autoCreateTime;index"`
}

func (ArtifactFeedback) TableName() string { return "agent_artifact_feedback" }

// ArtifactCheck is an immutable fact recorded against exact version bytes.
// Command/E2E checks are added in TW-D4.
type ArtifactCheck struct {
	ID               string    `gorm:"primaryKey;type:varchar(36)"`
	ArtifactID       string    `gorm:"not null;type:varchar(36);index:idx_artifact_check_artifact"`
	VersionID        string    `gorm:"not null;type:varchar(36);index"`
	SHA256           string    `gorm:"not null;type:varchar(64)"`
	CheckType        string    `gorm:"not null;type:varchar(32)"`
	Result           string    `gorm:"not null;type:varchar(20)"`
	Detail           string    `gorm:"not null;type:text;default:''"`
	CriteriaRevision string    `gorm:"not null;type:varchar(64);default:''"`
	MaterialRevision string    `gorm:"not null;type:varchar(64);default:''"`
	Environment      string    `gorm:"not null;type:varchar(100);default:''"`
	IdempotencyKey   string    `gorm:"not null;type:varchar(100);default:'';index"`
	CreatedBy        string    `gorm:"not null;type:text"`
	CreatedAt        time.Time `gorm:"not null;autoCreateTime;index"`
}

func (ArtifactCheck) TableName() string { return "agent_artifact_checks" }

// ArtifactAcceptance binds an actor's acceptance to one exact version.
// Whether it is the artifact's current acceptance is projected from
// version identity, never copied forward to a new version.
type ArtifactAcceptance struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	ArtifactID     string    `gorm:"not null;type:varchar(36);index:idx_artifact_acceptance_artifact"`
	VersionID      string    `gorm:"not null;type:varchar(36);index"`
	SHA256         string    `gorm:"column:sha256;not null;type:varchar(64)"`
	CheckIDs       string    `gorm:"not null;type:text;default:''"`
	IdempotencyKey string    `gorm:"not null;type:varchar(100);default:'';index"`
	Actor          string    `gorm:"not null;type:text;index:idx_artifact_acceptance_actor"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime;index"`
}

func (ArtifactAcceptance) TableName() string { return "agent_artifact_acceptances" }
