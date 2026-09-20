package persistence

import "time"

// EvaluationBenchmark is the actor-owned root for one evaluation rubric.
type EvaluationBenchmark struct {
	BenchmarkID string     `gorm:"column:benchmark_id;primaryKey;type:varchar(64)"`
	PTID        string     `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_benchmarks_actor"`
	Name        string     `gorm:"column:name;not null;type:text"`
	Rubric      string     `gorm:"column:rubric;not null;type:text"`
	Revision    uint64     `gorm:"column:revision;not null;default:1"`
	CreatedAt   time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt   time.Time  `gorm:"column:updated_at;not null"`
	DeletedAt   *time.Time `gorm:"column:deleted_at;index:idx_agent_evaluation_benchmarks_deleted"`
}

func (EvaluationBenchmark) TableName() string {
	return "agent_evaluation_benchmarks"
}

// EvaluationDataset is an actor-owned, revisioned case collection.
type EvaluationDataset struct {
	DatasetID   string     `gorm:"column:dataset_id;primaryKey;type:varchar(64)"`
	BenchmarkID string     `gorm:"column:benchmark_id;not null;type:varchar(64);index:idx_agent_evaluation_datasets_benchmark"`
	PTID        string     `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_datasets_actor"`
	Name        string     `gorm:"column:name;not null;type:text"`
	Description string     `gorm:"column:description;not null;type:text;default:''"`
	Revision    uint64     `gorm:"column:revision;not null;default:1"`
	CreatedAt   time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt   time.Time  `gorm:"column:updated_at;not null"`
	DeletedAt   *time.Time `gorm:"column:deleted_at;index:idx_agent_evaluation_datasets_deleted"`
}

func (EvaluationDataset) TableName() string {
	return "agent_evaluation_datasets"
}

// EvaluationTestCase is a revisioned source case. PTID is duplicated from the
// dataset to keep every repository query fail-closed on actor ownership.
type EvaluationTestCase struct {
	CaseID         string     `gorm:"column:case_id;primaryKey;type:varchar(64)"`
	DatasetID      string     `gorm:"column:dataset_id;not null;type:varchar(64);index:idx_agent_evaluation_cases_dataset"`
	PTID           string     `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_cases_actor"`
	Input          string     `gorm:"column:input;not null;type:text"`
	Expected       string     `gorm:"column:expected;not null;type:text"`
	RubricOverride *string    `gorm:"column:rubric_override;type:text"`
	TagsJSON       []byte     `gorm:"column:tags_json;not null;type:jsonb"`
	Revision       uint64     `gorm:"column:revision;not null;default:1"`
	CreatedAt      time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt      time.Time  `gorm:"column:updated_at;not null"`
	DeletedAt      *time.Time `gorm:"column:deleted_at;index:idx_agent_evaluation_cases_deleted"`
}

func (EvaluationTestCase) TableName() string {
	return "agent_evaluation_test_cases"
}

// EvaluationRun stores the immutable source/runtime snapshot and mutable run
// state. Terminal fields are frozen together by one repository transaction.
type EvaluationRun struct {
	RunID               string     `gorm:"column:run_id;primaryKey;type:varchar(64)"`
	PTID                string     `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_runs_actor"`
	IdempotencyKey      string     `gorm:"column:idempotency_key;not null;type:varchar(128)"`
	PayloadHash         string     `gorm:"column:payload_hash;not null;type:varchar(64)"`
	Revision            uint64     `gorm:"column:revision;not null;default:1"`
	ParentRunID         *string    `gorm:"column:parent_run_id;type:varchar(64);index:idx_agent_evaluation_runs_parent"`
	CommandKind         int32      `gorm:"column:command_kind;not null"`
	MutationScope       string     `gorm:"column:mutation_scope;not null;type:varchar(160)"`
	CancelIntentFence   string     `gorm:"column:cancel_intent_fence;not null;type:varchar(64);default:''"`
	CancelAckDeadline   *time.Time `gorm:"column:cancel_ack_deadline"`
	TerminalFence       string     `gorm:"column:terminal_fence;not null;type:varchar(64);default:''"`
	DatasetID           string     `gorm:"column:dataset_id;not null;type:varchar(64);index:idx_agent_evaluation_runs_dataset"`
	DatasetRevision     uint64     `gorm:"column:dataset_revision;not null"`
	TargetSnapshot      []byte     `gorm:"column:target_snapshot;not null;type:bytea"`
	TargetSnapshotHash  string     `gorm:"column:target_snapshot_hash;not null;type:varchar(64)"`
	TargetConfig        []byte     `gorm:"column:target_config;not null;type:bytea"`
	ReadinessSnapshotID string     `gorm:"column:readiness_snapshot_id;not null;type:varchar(96)"`
	Status              int32      `gorm:"column:status;not null;index:idx_agent_evaluation_runs_status"`
	CompletedCases      uint32     `gorm:"column:completed_cases;not null;default:0"`
	TotalCases          uint32     `gorm:"column:total_cases;not null;default:0"`
	MetricsPayload      []byte     `gorm:"column:metrics_payload;type:bytea"`
	ErrorPayload        []byte     `gorm:"column:error_payload;type:bytea"`
	TargetAgentID       string     `gorm:"column:target_agent_id;not null;type:varchar(64);index:idx_agent_evaluation_runs_agent"`
	TargetAgentRevision uint64     `gorm:"column:target_agent_revision;not null"`
	CreatedAt           time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt           time.Time  `gorm:"column:updated_at;not null"`
	TerminalAt          *time.Time `gorm:"column:terminal_at"`
	DeletedAt           *time.Time `gorm:"column:deleted_at;index:idx_agent_evaluation_runs_deleted"`
}

func (EvaluationRun) TableName() string {
	return "agent_evaluation_runs"
}

// EvaluationRunCase freezes a source case at run creation. Later source edits
// or tombstones cannot alter an admitted run.
type EvaluationRunCase struct {
	RunID           string  `gorm:"column:run_id;primaryKey;type:varchar(64)"`
	CaseID          string  `gorm:"column:case_id;primaryKey;type:varchar(64)"`
	PTID            string  `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_run_cases_actor"`
	Ordinal         uint32  `gorm:"column:ordinal;not null"`
	SourceRevision  uint64  `gorm:"column:source_revision;not null"`
	Input           string  `gorm:"column:input;not null;type:text"`
	Expected        string  `gorm:"column:expected;not null;type:text"`
	RubricOverride  *string `gorm:"column:rubric_override;type:text"`
	Rubric          string  `gorm:"column:rubric;not null;type:varchar(64);default:'exact_match'"`
	RubricVersion   string  `gorm:"column:rubric_version;not null;type:varchar(64);default:'exact-match-v1'"`
	TagsJSON        []byte  `gorm:"column:tags_json;not null;type:jsonb"`
	SourceAttemptID *string `gorm:"column:source_attempt_id;type:varchar(64)"`
	SourceResultID  *string `gorm:"column:source_result_id;type:varchar(64)"`
	SourceAttemptNo uint32  `gorm:"column:source_attempt_no;not null;default:0"`
}

func (EvaluationRunCase) TableName() string {
	return "agent_evaluation_run_cases"
}

// EvaluationCaseAttempt is both the case execution record and the unique
// scheduler-claim row for (run, case, attempt).
type EvaluationCaseAttempt struct {
	AttemptID               string     `gorm:"column:attempt_id;primaryKey;type:varchar(64)"`
	RunID                   string     `gorm:"column:run_id;not null;type:varchar(64);uniqueIndex:idx_agent_evaluation_attempt_identity,priority:1;index:idx_agent_evaluation_attempts_run"`
	CaseID                  string     `gorm:"column:case_id;not null;type:varchar(64);uniqueIndex:idx_agent_evaluation_attempt_identity,priority:2"`
	Attempt                 uint32     `gorm:"column:attempt;not null;uniqueIndex:idx_agent_evaluation_attempt_identity,priority:3"`
	PTID                    string     `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_attempts_actor"`
	IdempotencyKey          string     `gorm:"column:idempotency_key;not null;type:varchar(128)"`
	SourceAttemptID         *string    `gorm:"column:source_attempt_id;type:varchar(64)"`
	SourceResultID          *string    `gorm:"column:source_result_id;type:varchar(64)"`
	TurnID                  *string    `gorm:"column:turn_id;type:varchar(64);uniqueIndex:idx_agent_evaluation_attempt_turn"`
	ConversationID          string     `gorm:"column:conversation_id;not null;type:varchar(64);default:''"`
	Status                  int32      `gorm:"column:status;not null;index:idx_agent_evaluation_attempts_status"`
	OutputRef               string     `gorm:"column:output_ref;not null;type:text;default:''"`
	Score                   *float64   `gorm:"column:score"`
	ErrorPayload            []byte     `gorm:"column:error_payload;type:bytea"`
	CancellationAckAt       *time.Time `gorm:"column:cancellation_ack_at"`
	TerminalAt              *time.Time `gorm:"column:terminal_at"`
	StartedAt               *time.Time `gorm:"column:started_at"`
	SchedulerClaim          *string    `gorm:"column:scheduler_claim;type:varchar(64);uniqueIndex:idx_agent_evaluation_scheduler_claim"`
	SchedulerClaimedAt      *time.Time `gorm:"column:scheduler_claimed_at"`
	SchedulerClaimExpiresAt *time.Time `gorm:"column:scheduler_claim_expires_at;index:idx_agent_evaluation_scheduler_expiry"`
	CreatedAt               time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt               time.Time  `gorm:"column:updated_at;not null"`
}

func (EvaluationCaseAttempt) TableName() string {
	return "agent_evaluation_case_attempts"
}

// EvaluationResult is immutable and unique per terminal attempt.
type EvaluationResult struct {
	ResultID       string    `gorm:"column:result_id;primaryKey;type:varchar(64)"`
	RunID          string    `gorm:"column:run_id;not null;type:varchar(64);index:idx_agent_evaluation_results_run"`
	CaseID         string    `gorm:"column:case_id;not null;type:varchar(64)"`
	AttemptID      string    `gorm:"column:attempt_id;not null;type:varchar(64);uniqueIndex:idx_agent_evaluation_results_attempt"`
	PTID           string    `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_results_actor"`
	OutputRef      string    `gorm:"column:output_ref;not null;type:text;default:''"`
	Output         string    `gorm:"column:output;not null;type:text;default:''"`
	Score          float64   `gorm:"column:score;not null;default:0"`
	RubricVersion  string    `gorm:"column:rubric_version;not null;type:varchar(64)"`
	TerminalStatus int32     `gorm:"column:terminal_status;not null"`
	LatencyMS      uint64    `gorm:"column:latency_ms;not null;default:0"`
	TurnTraceID    string    `gorm:"column:turn_trace_id;not null;type:varchar(64);default:''"`
	CreatedAt      time.Time `gorm:"column:created_at;not null"`
}

func (EvaluationResult) TableName() string {
	return "agent_evaluation_results"
}

// EvaluationRunEvent is the durable cursor stream used for run recovery.
type EvaluationRunEvent struct {
	EventID        string    `gorm:"column:event_id;primaryKey;type:varchar(64)"`
	RunID          string    `gorm:"column:run_id;not null;type:varchar(64);uniqueIndex:idx_agent_evaluation_events_run_sequence,priority:1"`
	PTID           string    `gorm:"column:ptid;not null;type:text;index:idx_agent_evaluation_events_actor"`
	Sequence       uint64    `gorm:"column:sequence;not null;uniqueIndex:idx_agent_evaluation_events_run_sequence,priority:2"`
	Status         int32     `gorm:"column:status;not null"`
	CompletedCases uint32    `gorm:"column:completed_cases;not null;default:0"`
	TotalCases     uint32    `gorm:"column:total_cases;not null;default:0"`
	CaseID         string    `gorm:"column:case_id;not null;type:varchar(64);default:''"`
	AttemptID      string    `gorm:"column:attempt_id;not null;type:varchar(64);default:''"`
	ErrorPayload   []byte    `gorm:"column:error_payload;type:bytea"`
	ResultID       string    `gorm:"column:result_id;not null;type:varchar(64);default:''"`
	OccurredAt     time.Time `gorm:"column:occurred_at;not null"`
}

func (EvaluationRunEvent) TableName() string {
	return "agent_evaluation_run_events"
}

// EvaluationCommand stores the exact response for actor-scoped idempotent
// mutations. Mutation scope is payload/audit metadata, not a uniqueness key.
type EvaluationCommand struct {
	CommandID       string    `gorm:"column:command_id;primaryKey;type:varchar(64)"`
	PTID            string    `gorm:"column:ptid;not null;type:text;uniqueIndex:idx_agent_evaluation_command_idempotency,priority:1"`
	CommandKind     string    `gorm:"column:command_kind;not null;type:varchar(64);uniqueIndex:idx_agent_evaluation_command_idempotency,priority:2"`
	IdempotencyKey  string    `gorm:"column:idempotency_key;not null;type:varchar(128);uniqueIndex:idx_agent_evaluation_command_idempotency,priority:3"`
	PayloadHash     string    `gorm:"column:payload_hash;not null;type:varchar(64)"`
	MutationScope   string    `gorm:"column:mutation_scope;not null;type:varchar(160)"`
	ResourceID      string    `gorm:"column:resource_id;not null;type:varchar(64)"`
	ResponsePayload []byte    `gorm:"column:response_payload;not null;type:bytea"`
	CreatedAt       time.Time `gorm:"column:created_at;not null"`
}

func (EvaluationCommand) TableName() string {
	return "agent_evaluation_commands"
}
