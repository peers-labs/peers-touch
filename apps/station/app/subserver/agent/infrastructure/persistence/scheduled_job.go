package persistence

import "time"

// ScheduledJob is the single Station-authoritative source for user-visible
// scheduling. Each job owns one dedicated conversation where its triggered
// turns accumulate; deleting the job retains that conversation history.
type ScheduledJob struct {
	ID                   string     `gorm:"primaryKey;type:varchar(36)"`
	AgentID              string     `gorm:"not null;type:varchar(36);index:idx_scheduled_jobs_agent"`
	ActorPTID            string     `gorm:"column:actor_ptid;not null;type:varchar(128);index:idx_scheduled_jobs_due,priority:3"`
	Name                 string     `gorm:"not null;type:varchar(200)"`
	Description          string     `gorm:"not null;type:text;default:''"`
	ScheduleKind         string     `gorm:"not null;type:varchar(20)"`
	CronExpr             string     `gorm:"not null;type:varchar(120);default:''"`
	IntervalSec          int64      `gorm:"not null;default:0"`
	RunAt                string     `gorm:"not null;type:varchar(40);default:''"`
	Timezone             string     `gorm:"not null;type:varchar(64);default:''"`
	Prompt               string     `gorm:"not null;type:text"`
	OverrideModel        *string    `gorm:"type:varchar(120)"`
	OverrideProvider     *string    `gorm:"type:varchar(120)"`
	OverrideEffort       *string    `gorm:"type:varchar(20)"`
	TimeoutSec           uint32     `gorm:"not null;default:0"`
	DeleteAfterRun       bool       `gorm:"not null;default:false"`
	Enabled              bool       `gorm:"not null;default:true"`
	ConversationID       string     `gorm:"not null;type:varchar(36);index:idx_scheduled_jobs_conversation"`
	NextDueAt            *time.Time `gorm:"type:timestamp;index:idx_scheduled_jobs_due,priority:1"`
	LastRunAt            *time.Time `gorm:"type:timestamp"`
	LastStatus           string     `gorm:"not null;type:varchar(20);default:''"`
	LastError            string     `gorm:"not null;type:text;default:''"`
	Revision             uint64     `gorm:"not null;default:1"`
	CreateIdempotencyKey *string    `gorm:"type:varchar(80);uniqueIndex"`
	CreatedAt            time.Time  `gorm:"not null"`
	UpdatedAt            time.Time  `gorm:"not null"`
}

func (ScheduledJob) TableName() string { return "agent_scheduled_jobs" }

// ScheduledJobRun is the auditable trigger history for one ScheduledJob.
// OccurrenceKey makes sweep claims idempotent across restarts and retries.
type ScheduledJobRun struct {
	ID             string     `gorm:"primaryKey;type:varchar(36)"`
	JobID          string     `gorm:"not null;type:varchar(36);index:idx_scheduled_job_runs_job"`
	AgentID        string     `gorm:"not null;type:varchar(36)"`
	ConversationID string     `gorm:"not null;type:varchar(36)"`
	TurnID         string     `gorm:"not null;type:varchar(36);default:''"`
	Status         string     `gorm:"not null;type:varchar(20);index"`
	Trigger        string     `gorm:"not null;type:varchar(10)"`
	ErrorMessage   string     `gorm:"not null;type:text;default:''"`
	OccurrenceKey  string     `gorm:"not null;type:varchar(120);uniqueIndex"`
	ScheduledFor   *time.Time `gorm:"type:timestamp"`
	StartedAt      *time.Time `gorm:"type:timestamp"`
	FinishedAt     *time.Time `gorm:"type:timestamp"`
	DurationMs     int64      `gorm:"not null;default:0"`
	CreatedAt      time.Time  `gorm:"not null"`
}

func (ScheduledJobRun) TableName() string { return "agent_scheduled_job_runs" }
