package persistence

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAgentRealtimeOutboxAllocatesStableActorOrder(t *testing.T) {
	db := openAgentRealtimeOutboxTestDB(t)
	now := time.Date(2026, 10, 4, 13, 0, 0, 0, time.UTC)
	first := enqueueAgentRealtimeTestIntent(t, db, AgentRealtimeIntent{
		DomainEventID:   "domain-event-1",
		DomainSequence:  1,
		EventType:       "agent.goal.created",
		GoalID:          "goal-1",
		GoalRevision:    1,
		TargetActorPTID: "ptid:actor-1",
		WorkspaceID:     "workspace-1",
		EventClass:      AgentRealtimeClassProgress,
		CommittedAt:     now,
	})
	second := enqueueAgentRealtimeTestIntent(t, db, AgentRealtimeIntent{
		DomainEventID:   "domain-event-2",
		DomainSequence:  2,
		EventType:       "agent.goal.running",
		GoalID:          "goal-1",
		GoalRevision:    2,
		TargetActorPTID: "ptid:actor-1",
		WorkspaceID:     "workspace-1",
		EventClass:      AgentRealtimeClassControl,
		CommittedAt:     now,
	})

	if first.ActorSequence != 1 || second.ActorSequence != 2 {
		t.Fatalf(
			"actor sequences = %d,%d, want 1,2",
			first.ActorSequence,
			second.ActorSequence,
		)
	}
	replayed := enqueueAgentRealtimeTestIntent(t, db, AgentRealtimeIntent{
		DomainEventID:   "domain-event-1",
		DomainSequence:  1,
		EventType:       "agent.goal.created",
		GoalID:          "goal-1",
		GoalRevision:    1,
		TargetActorPTID: "ptid:actor-1",
		WorkspaceID:     "workspace-1",
		EventClass:      AgentRealtimeClassProgress,
		CommittedAt:     now,
	})
	if replayed.OutboxID != first.OutboxID ||
		replayed.RealtimeEventID != first.RealtimeEventID {
		t.Fatalf("idempotent enqueue changed identity: first=%+v replay=%+v", first, replayed)
	}

	if second.DomainEventID != "domain-event-2" ||
		second.DomainSequence != 2 ||
		second.EventType != "agent.goal.running" ||
		second.GoalRevision != 2 {
		t.Fatalf("second outbox intent = %+v", second)
	}
}

func TestAgentRealtimeOutboxParticipatesInCallerTransaction(t *testing.T) {
	db := openAgentRealtimeOutboxTestDB(t)
	rollback := errors.New("force rollback")
	err := db.Transaction(func(tx *gorm.DB) error {
		_, enqueueErr := EnqueueAgentRealtimeTx(
			context.Background(),
			tx,
			AgentRealtimeIntent{
				DomainEventID:   "domain-event-rollback",
				DomainSequence:  1,
				EventType:       "agent.goal.updated",
				GoalID:          "goal-rollback",
				GoalRevision:    2,
				TargetActorPTID: "ptid:actor-1",
				EventClass:      AgentRealtimeClassProgress,
				CommittedAt:     time.Now().UTC(),
			},
			DefaultAgentRealtimeBacklogLimits(),
		)
		if enqueueErr != nil {
			return enqueueErr
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("transaction error = %v, want rollback", err)
	}

	var outboxCount int64
	if err := db.Model(&AgentRealtimeOutbox{}).Count(&outboxCount).Error; err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	var cursorCount int64
	if err := db.Model(&AgentRealtimeActorCursor{}).Count(&cursorCount).Error; err != nil {
		t.Fatalf("count actor cursor: %v", err)
	}
	if outboxCount != 0 || cursorCount != 0 {
		t.Fatalf(
			"rolled-back transaction persisted outbox=%d cursor=%d",
			outboxCount,
			cursorCount,
		)
	}
}

func TestAgentRealtimeOutboxReservesTerminalCapacity(t *testing.T) {
	db := openAgentRealtimeOutboxTestDB(t)
	limits := AgentRealtimeBacklogLimits{PendingLimit: 3, TerminalReserve: 1}
	now := time.Now().UTC()
	for index := 1; index <= 2; index++ {
		_, err := enqueueAgentRealtime(
			db,
			AgentRealtimeIntent{
				DomainEventID:   fmt.Sprintf("progress-%d", index),
				DomainSequence:  uint64(index),
				EventType:       "agent.goal.updated",
				GoalID:          fmt.Sprintf("goal-%d", index),
				GoalRevision:    1,
				TargetActorPTID: "ptid:actor-1",
				WorkspaceID:     "workspace-1",
				EventClass:      AgentRealtimeClassProgress,
				CommittedAt:     now,
			},
			limits,
		)
		if err != nil {
			t.Fatalf("enqueue progress %d: %v", index, err)
		}
	}
	_, err := enqueueAgentRealtime(
		db,
		AgentRealtimeIntent{
			DomainEventID:   "progress-blocked",
			DomainSequence:  3,
			EventType:       "agent.goal.updated",
			GoalID:          "goal-3",
			GoalRevision:    1,
			TargetActorPTID: "ptid:actor-1",
			WorkspaceID:     "workspace-1",
			EventClass:      AgentRealtimeClassProgress,
			CommittedAt:     now,
		},
		limits,
	)
	if !errors.Is(err, ErrAgentRealtimeBacklogReserved) {
		t.Fatalf("progress overflow error = %v", err)
	}

	_, err = enqueueAgentRealtime(
		db,
		AgentRealtimeIntent{
			DomainEventID:   "terminal-admitted",
			DomainSequence:  4,
			EventType:       "agent.goal.cancelled",
			GoalID:          "goal-1",
			GoalRevision:    2,
			TargetActorPTID: "ptid:actor-1",
			WorkspaceID:     "workspace-1",
			EventClass:      AgentRealtimeClassTerminal,
			CommittedAt:     now,
		},
		limits,
	)
	if err != nil {
		t.Fatalf("enqueue terminal event: %v", err)
	}
	_, err = enqueueAgentRealtime(
		db,
		AgentRealtimeIntent{
			DomainEventID:   "terminal-blocked",
			DomainSequence:  5,
			EventType:       "agent.goal.cancelled",
			GoalID:          "goal-2",
			GoalRevision:    2,
			TargetActorPTID: "ptid:actor-1",
			WorkspaceID:     "workspace-1",
			EventClass:      AgentRealtimeClassTerminal,
			CommittedAt:     now,
		},
		limits,
	)
	if !errors.Is(err, ErrAgentRealtimeBacklogFull) {
		t.Fatalf("terminal overflow error = %v", err)
	}
}

func enqueueAgentRealtimeTestIntent(
	t *testing.T,
	db *gorm.DB,
	intent AgentRealtimeIntent,
) *AgentRealtimeOutbox {
	t.Helper()
	record, err := enqueueAgentRealtime(
		db,
		intent,
		DefaultAgentRealtimeBacklogLimits(),
	)
	if err != nil {
		t.Fatalf("enqueue realtime intent: %v", err)
	}
	return record
}

func enqueueAgentRealtime(
	db *gorm.DB,
	intent AgentRealtimeIntent,
	limits AgentRealtimeBacklogLimits,
) (*AgentRealtimeOutbox, error) {
	var record *AgentRealtimeOutbox
	err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		record, err = EnqueueAgentRealtimeTx(
			context.Background(),
			tx,
			intent,
			limits,
		)
		return err
	})
	return record, err
}

func openAgentRealtimeOutboxTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(
			"file:"+t.Name()+"-"+
				time.Now().Format("150405.000000000")+
				"?mode=memory&cache=shared",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open outbox test database: %v", err)
	}
	if err := db.AutoMigrate(
		&AgentRealtimeActorCursor{},
		&AgentRealtimeOutbox{},
	); err != nil {
		t.Fatalf("migrate outbox test database: %v", err)
	}
	return db
}
