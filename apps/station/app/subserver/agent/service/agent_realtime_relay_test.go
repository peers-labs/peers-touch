package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type recordingRealtimePublisher struct {
	mu           sync.Mutex
	failuresLeft int
	eventIDs     []string
}

func (p *recordingRealtimePublisher) Publish(
	_ string,
	event *realtime.StreamEvent,
) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.eventIDs = append(p.eventIDs, event.GetEventId())
	if p.failuresLeft > 0 {
		p.failuresLeft--
		return "", errors.New("injected publish failure")
	}
	return event.GetEventId(), nil
}

func (p *recordingRealtimePublisher) snapshot() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.eventIDs...)
}

func TestAgentRealtimeRelayPublishRetryKeepsStableIDAndActorOrder(t *testing.T) {
	db := openAgentRealtimeRelayTestDB(t)
	now := time.Date(2026, 10, 4, 14, 0, 0, 0, time.UTC)
	first := enqueueRelayTestIntent(t, db, "domain-1", 1, now)
	second := enqueueRelayTestIntent(t, db, "domain-2", 2, now.Add(time.Millisecond))
	publisher := &recordingRealtimePublisher{failuresLeft: 1}
	relay := NewAgentRealtimeRelay(db, func() AgentRealtimePublisher {
		return publisher
	})
	relay.now = func() time.Time { return now.Add(time.Second) }
	relay.retryDelay = func(uint32) time.Duration { return 0 }

	attempted, err := relay.DeliverNext(context.Background())
	if !attempted || err == nil {
		t.Fatalf("first delivery = attempted:%v err:%v, want injected failure", attempted, err)
	}
	assertRealtimeOutboxState(
		t,
		db,
		first.OutboxID,
		persistence.AgentRealtimeOutboxPending,
	)
	if got := publisher.snapshot(); len(got) != 1 ||
		got[0] != first.RealtimeEventID {
		t.Fatalf("first publish IDs = %v", got)
	}

	attempted, err = relay.DeliverNext(context.Background())
	if !attempted || err != nil {
		t.Fatalf("retry delivery = attempted:%v err:%v", attempted, err)
	}
	attempted, err = relay.DeliverNext(context.Background())
	if !attempted || err != nil {
		t.Fatalf("second-row delivery = attempted:%v err:%v", attempted, err)
	}
	got := publisher.snapshot()
	if len(got) != 3 ||
		got[0] != first.RealtimeEventID ||
		got[1] != first.RealtimeEventID ||
		got[2] != second.RealtimeEventID {
		t.Fatalf("publish order = %v", got)
	}
	assertRealtimeOutboxState(
		t,
		db,
		first.OutboxID,
		persistence.AgentRealtimeOutboxDelivered,
	)
	assertRealtimeOutboxState(
		t,
		db,
		second.OutboxID,
		persistence.AgentRealtimeOutboxDelivered,
	)
}

func TestAgentRealtimeRelayCrashWindowRedeliversStableEnvelope(t *testing.T) {
	db := openAgentRealtimeRelayTestDB(t)
	now := time.Date(2026, 10, 4, 15, 0, 0, 0, time.UTC)
	row := enqueueRelayTestIntent(t, db, "domain-crash", 1, now)
	publisher := &recordingRealtimePublisher{}
	relay := NewAgentRealtimeRelay(db, func() AgentRealtimePublisher {
		return publisher
	})
	relay.now = func() time.Time { return now }
	relay.leaseTTL = time.Second

	claimed, err := relay.claimNext(context.Background(), now)
	if err != nil || claimed == nil {
		t.Fatalf("claim outbox: row=%+v err=%v", claimed, err)
	}
	envelope := agentRealtimeEnvelope(claimed)
	if _, err := publisher.Publish(claimed.TargetActorPTID, envelope); err != nil {
		t.Fatalf("publish before simulated crash: %v", err)
	}

	relay.now = func() time.Time { return now.Add(2 * time.Second) }
	attempted, err := relay.DeliverNext(context.Background())
	if !attempted || err != nil {
		t.Fatalf("redelivery = attempted:%v err:%v", attempted, err)
	}
	got := publisher.snapshot()
	if len(got) != 2 || got[0] != row.RealtimeEventID ||
		got[1] != row.RealtimeEventID {
		t.Fatalf("crash-window publish IDs = %v", got)
	}
}

func TestAgentRealtimeRelayPublishFailurePreservesGoalReadback(t *testing.T) {
	db := openAgentRealtimeRelayTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-publish-failure" }
	created, err := goals.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Committed before publish",
			Outcome:        "Refresh reads durable progress",
			IdempotencyKey: "goal-publish-failure-create",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}
	publisher := &recordingRealtimePublisher{failuresLeft: 1}
	relay := NewAgentRealtimeRelay(db, func() AgentRealtimePublisher {
		return publisher
	})
	relay.retryDelay = func(uint32) time.Duration { return 0 }

	attempted, err := relay.DeliverNext(context.Background())
	if !attempted || err == nil {
		t.Fatalf("delivery = attempted:%v err:%v, want publish failure", attempted, err)
	}
	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		created.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("refresh Goal after publish failure: %v", err)
	}
	if reopened.GetGoalId() != created.GetGoalId() ||
		reopened.GetRevision() != created.GetRevision() ||
		reopened.GetStatus() != created.GetStatus() {
		t.Fatalf("publish failure changed Goal readback: %+v", reopened)
	}
}

func TestTaskEventWriterDomainCommitFailureDoesNotPublish(t *testing.T) {
	eventBus := &recordingAgentEventBus{}
	writer := NewTaskEventWriter(eventBus)
	writer.openDB = func(context.Context) (*gorm.DB, error) {
		return nil, errors.New("injected domain commit failure")
	}

	writer.Publish(
		context.Background(),
		"agent-1",
		"agent.collaboration.node.running",
		map[string]any{"status": "running"},
		"task-1",
		"step-1",
		"",
		nil,
	)
	if events := eventBus.snapshot(); len(events) != 0 {
		t.Fatalf("failed domain commit published %d receiver-visible events", len(events))
	}
}

func enqueueRelayTestIntent(
	t *testing.T,
	db *gorm.DB,
	domainEventID string,
	sequence uint64,
	at time.Time,
) *persistence.AgentRealtimeOutbox {
	t.Helper()
	var row *persistence.AgentRealtimeOutbox
	err := db.Transaction(func(tx *gorm.DB) error {
		var enqueueErr error
		row, enqueueErr = persistence.EnqueueAgentRealtimeTx(
			context.Background(),
			tx,
			persistence.AgentRealtimeIntent{
				DomainEventID:   domainEventID,
				DomainSequence:  sequence,
				EventType:       "agent.goal.updated",
				GoalID:          "goal-1",
				GoalRevision:    sequence,
				TargetActorPTID: "ptid:actor-1",
				WorkspaceID:     "workspace-1",
				EventClass:      persistence.AgentRealtimeClassProgress,
				CommittedAt:     at,
			},
			persistence.DefaultAgentRealtimeBacklogLimits(),
		)
		return enqueueErr
	})
	if err != nil {
		t.Fatalf("enqueue relay test row: %v", err)
	}
	return row
}

func assertRealtimeOutboxState(
	t *testing.T,
	db *gorm.DB,
	outboxID string,
	want string,
) {
	t.Helper()
	var row persistence.AgentRealtimeOutbox
	if err := db.First(&row, "outbox_id = ?", outboxID).Error; err != nil {
		t.Fatalf("load realtime outbox %s: %v", outboxID, err)
	}
	if row.State != want {
		t.Fatalf("outbox %s state = %q, want %q", outboxID, row.State, want)
	}
	if want == persistence.AgentRealtimeOutboxDelivered &&
		row.RealtimeCursor != row.RealtimeEventID {
		t.Fatalf(
			"delivered cursor = %q, want %q",
			row.RealtimeCursor,
			row.RealtimeEventID,
		)
	}
}

func openAgentRealtimeRelayTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	db, err := gorm.Open(
		sqlite.Open(
			"file:"+name+"-"+
				time.Now().Format("150405.000000000")+
				"?mode=memory&cache=shared",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open relay test database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.AgentGoal{},
		&persistence.AgentGoalEvent{},
		&persistence.AgentRealtimeActorCursor{},
		&persistence.AgentRealtimeOutbox{},
		&persistence.RevisionCommand{},
	); err != nil {
		t.Fatalf("migrate relay test database: %v", err)
	}
	return db
}
