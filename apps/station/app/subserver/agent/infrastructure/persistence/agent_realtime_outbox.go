package persistence

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AgentRealtimeOutboxPending   = "pending"
	AgentRealtimeOutboxLeased    = "leased"
	AgentRealtimeOutboxDelivered = "delivered"

	AgentRealtimeClassProgress = "progress"
	AgentRealtimeClassControl  = "control"
	AgentRealtimeClassTerminal = "terminal"

	DefaultAgentRealtimePendingLimit    = 1024
	DefaultAgentRealtimeTerminalReserve = 64
)

var (
	ErrAgentRealtimeBacklogReserved = errors.New("agent realtime backlog reached reserved terminal capacity")
	ErrAgentRealtimeBacklogFull     = errors.New("agent realtime backlog is full")

	agentRealtimeIDMu      sync.Mutex
	agentRealtimeIDEntropy = ulid.Monotonic(rand.Reader, 0)
)

// AgentRealtimeOutbox stores one immutable, typed delivery intent. The
// authoritative Goal/Task event remains in its domain event table.
type AgentRealtimeOutbox struct {
	OutboxID        string     `gorm:"column:outbox_id;primaryKey;type:varchar(64)"`
	DomainEventID   string     `gorm:"column:domain_event_id;not null;type:varchar(64);uniqueIndex:idx_agent_realtime_domain_target,priority:1"`
	TargetActorPTID string     `gorm:"column:target_actor_ptid;not null;type:text;uniqueIndex:idx_agent_realtime_domain_target,priority:2;uniqueIndex:idx_agent_realtime_actor_seq,priority:1;uniqueIndex:idx_agent_realtime_actor_cursor,priority:1;index:idx_agent_realtime_pending,priority:1"`
	WorkspaceID     string     `gorm:"column:workspace_id;not null;type:varchar(64);default:'';index:idx_agent_realtime_pending,priority:2"`
	ActorSequence   uint64     `gorm:"column:actor_sequence;not null;uniqueIndex:idx_agent_realtime_actor_seq,priority:2"`
	RealtimeEventID string     `gorm:"column:realtime_event_id;not null;type:varchar(64);uniqueIndex:idx_agent_realtime_actor_cursor,priority:2"`
	DomainSequence  uint64     `gorm:"column:domain_sequence;not null"`
	EventType       string     `gorm:"column:event_type;not null;type:varchar(96)"`
	GoalID          string     `gorm:"column:goal_id;not null;type:varchar(64);default:''"`
	TaskID          string     `gorm:"column:task_id;not null;type:varchar(64);default:''"`
	GoalRevision    uint64     `gorm:"column:goal_revision;not null;default:0"`
	EventClass      string     `gorm:"column:event_class;not null;type:varchar(16)"`
	State           string     `gorm:"column:state;not null;type:varchar(16);index:idx_agent_realtime_pending,priority:3"`
	AttemptCount    uint32     `gorm:"column:attempt_count;not null;default:0"`
	NextAttemptAt   time.Time  `gorm:"column:next_attempt_at;not null;index:idx_agent_realtime_pending,priority:4"`
	LeaseOwner      string     `gorm:"column:lease_owner;not null;type:varchar(64);default:''"`
	LeaseGeneration uint64     `gorm:"column:lease_generation;not null;default:0"`
	LeaseExpiresAt  *time.Time `gorm:"column:lease_expires_at"`
	RealtimeCursor  string     `gorm:"column:realtime_cursor;not null;type:varchar(64);default:''"`
	LastError       string     `gorm:"column:last_error;not null;type:text;default:''"`
	DeliveredAt     *time.Time `gorm:"column:delivered_at"`
	CommittedAt     time.Time  `gorm:"column:committed_at;not null"`
	CreatedAt       time.Time  `gorm:"column:created_at;not null;index"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;not null"`
}

func (AgentRealtimeOutbox) TableName() string {
	return "agent_realtime_outbox"
}

// AgentRealtimeActorCursor serializes delivery sequence allocation for one
// target actor across concurrent Goal and Task transactions.
type AgentRealtimeActorCursor struct {
	TargetActorPTID string    `gorm:"column:target_actor_ptid;primaryKey;type:text"`
	NextSequence    uint64    `gorm:"column:next_sequence;not null"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null"`
}

func (AgentRealtimeActorCursor) TableName() string {
	return "agent_realtime_actor_cursors"
}

type AgentRealtimeBacklogLimits struct {
	PendingLimit    int64
	TerminalReserve int64
}

func DefaultAgentRealtimeBacklogLimits() AgentRealtimeBacklogLimits {
	return AgentRealtimeBacklogLimits{
		PendingLimit:    DefaultAgentRealtimePendingLimit,
		TerminalReserve: DefaultAgentRealtimeTerminalReserve,
	}
}

type AgentRealtimeIntent struct {
	DomainEventID   string
	DomainSequence  uint64
	EventType       string
	GoalID          string
	TaskID          string
	GoalRevision    uint64
	TargetActorPTID string
	WorkspaceID     string
	EventClass      string
	CommittedAt     time.Time
}

func EnqueueAgentRealtimeTx(
	ctx context.Context,
	tx *gorm.DB,
	intent AgentRealtimeIntent,
	limits AgentRealtimeBacklogLimits,
) (*AgentRealtimeOutbox, error) {
	if tx == nil {
		return nil, fmt.Errorf("agent realtime outbox requires transaction")
	}
	if intent.DomainEventID == "" || intent.EventType == "" ||
		intent.TargetActorPTID == "" || intent.DomainSequence == 0 {
		return nil, fmt.Errorf("agent realtime outbox intent is incomplete")
	}
	if intent.EventClass != AgentRealtimeClassProgress &&
		intent.EventClass != AgentRealtimeClassControl &&
		intent.EventClass != AgentRealtimeClassTerminal {
		return nil, fmt.Errorf("agent realtime outbox class %q is invalid", intent.EventClass)
	}
	limits = normalizedAgentRealtimeLimits(limits)

	var existing AgentRealtimeOutbox
	existingResult := tx.WithContext(ctx).
		Where(
			"domain_event_id = ? AND target_actor_ptid = ?",
			intent.DomainEventID,
			intent.TargetActorPTID,
		).
		Limit(1).
		Find(&existing)
	if existingResult.Error != nil {
		return nil, existingResult.Error
	}
	if existingResult.RowsAffected == 1 {
		if !agentRealtimeIntentMatches(&existing, intent) {
			return nil, fmt.Errorf(
				"agent realtime outbox identity conflict for %s",
				intent.DomainEventID,
			)
		}
		return &existing, nil
	}

	committedAt := intent.CommittedAt.UTC()
	if committedAt.IsZero() {
		committedAt = time.Now().UTC()
	}
	actorSequence, err := allocateAgentRealtimeActorSequenceTx(
		ctx,
		tx,
		intent.TargetActorPTID,
		committedAt,
	)
	if err != nil {
		return nil, err
	}

	var pending int64
	if err := tx.WithContext(ctx).
		Model(&AgentRealtimeOutbox{}).
		Where(
			"target_actor_ptid = ? AND workspace_id = ? AND state <> ?",
			intent.TargetActorPTID,
			intent.WorkspaceID,
			AgentRealtimeOutboxDelivered,
		).
		Count(&pending).Error; err != nil {
		return nil, err
	}
	if pending >= limits.PendingLimit {
		return nil, ErrAgentRealtimeBacklogFull
	}
	if intent.EventClass == AgentRealtimeClassProgress &&
		pending >= limits.PendingLimit-limits.TerminalReserve {
		return nil, ErrAgentRealtimeBacklogReserved
	}

	realtimeEventID, err := nextAgentRealtimeEventID(committedAt)
	if err != nil {
		return nil, err
	}
	record := &AgentRealtimeOutbox{
		OutboxID:        "outbox_" + realtimeEventID,
		DomainEventID:   intent.DomainEventID,
		TargetActorPTID: intent.TargetActorPTID,
		WorkspaceID:     intent.WorkspaceID,
		ActorSequence:   actorSequence,
		RealtimeEventID: realtimeEventID,
		DomainSequence:  intent.DomainSequence,
		EventType:       intent.EventType,
		GoalID:          intent.GoalID,
		TaskID:          intent.TaskID,
		GoalRevision:    intent.GoalRevision,
		EventClass:      intent.EventClass,
		State:           AgentRealtimeOutboxPending,
		NextAttemptAt:   committedAt,
		CommittedAt:     committedAt,
		CreatedAt:       committedAt,
		UpdatedAt:       committedAt,
	}
	if err := tx.WithContext(ctx).Create(record).Error; err != nil {
		return nil, err
	}
	return record, nil
}

func agentRealtimeIntentMatches(
	existing *AgentRealtimeOutbox,
	intent AgentRealtimeIntent,
) bool {
	if existing == nil ||
		existing.WorkspaceID != intent.WorkspaceID ||
		existing.EventClass != intent.EventClass ||
		existing.DomainSequence != intent.DomainSequence ||
		existing.EventType != intent.EventType ||
		existing.GoalID != intent.GoalID ||
		existing.TaskID != intent.TaskID ||
		existing.GoalRevision != intent.GoalRevision {
		return false
	}
	committedAt := intent.CommittedAt.UTC()
	return committedAt.IsZero() || existing.CommittedAt.Equal(committedAt)
}

func normalizedAgentRealtimeLimits(
	limits AgentRealtimeBacklogLimits,
) AgentRealtimeBacklogLimits {
	if limits.PendingLimit <= 0 {
		limits.PendingLimit = DefaultAgentRealtimePendingLimit
	}
	if limits.TerminalReserve <= 0 ||
		limits.TerminalReserve >= limits.PendingLimit {
		limits.TerminalReserve = DefaultAgentRealtimeTerminalReserve
		if limits.TerminalReserve >= limits.PendingLimit {
			limits.TerminalReserve = 1
		}
	}
	return limits
}

func allocateAgentRealtimeActorSequenceTx(
	ctx context.Context,
	tx *gorm.DB,
	actorPTID string,
	now time.Time,
) (uint64, error) {
	seed := AgentRealtimeActorCursor{
		TargetActorPTID: actorPTID,
		NextSequence:    1,
		UpdatedAt:       now,
	}
	if err := tx.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&seed).Error; err != nil {
		return 0, err
	}

	var cursor AgentRealtimeActorCursor
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("target_actor_ptid = ?", actorPTID).
		First(&cursor).Error; err != nil {
		return 0, err
	}
	if cursor.NextSequence == 0 {
		return 0, fmt.Errorf("agent realtime actor sequence is invalid")
	}
	result := tx.WithContext(ctx).
		Model(&AgentRealtimeActorCursor{}).
		Where(
			"target_actor_ptid = ? AND next_sequence = ?",
			actorPTID,
			cursor.NextSequence,
		).
		Updates(map[string]any{
			"next_sequence": cursor.NextSequence + 1,
			"updated_at":    now,
		})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, fmt.Errorf("agent realtime actor sequence changed concurrently")
	}
	return cursor.NextSequence, nil
}

func nextAgentRealtimeEventID(at time.Time) (string, error) {
	agentRealtimeIDMu.Lock()
	defer agentRealtimeIDMu.Unlock()
	id, err := ulid.New(ulid.Timestamp(at), agentRealtimeIDEntropy)
	if err != nil {
		return "", fmt.Errorf("generate agent realtime event id: %w", err)
	}
	return id.String(), nil
}
