package service

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

type recordingAgentEventBus struct {
	mu     sync.Mutex
	events []domain.DomainEvent
}

func (b *recordingAgentEventBus) Publish(_ context.Context, event domain.DomainEvent) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, event)
	return nil
}

func (b *recordingAgentEventBus) Subscribe(string, domain.EventHandler) {}

func (b *recordingAgentEventBus) SubscribeAll(domain.EventHandler) {}

func (b *recordingAgentEventBus) Unsubscribe(string, domain.EventHandler) {}

func (b *recordingAgentEventBus) snapshot() []domain.DomainEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]domain.DomainEvent(nil), b.events...)
}

func TestAgentUpdateRebasesLiveBindingsAndPublishesInvalidation(t *testing.T) {
	db := openAgentServiceTestDB(t, "agent_update_binding_rebase")
	service := NewAgentService()
	eventBus := &recordingAgentEventBus{}
	service.SetEventBus(eventBus)
	agent := seedAgentServiceTestAgent(t, db)
	now := time.Now().UTC()
	tombstonedAt := now.Add(-time.Minute)
	bindings := []persistence.AgentCapabilityBinding{
		{
			BindingID: "binding-live-1", Ptid: agent.OwnerActorID, AgentID: agent.ID,
			CapabilityID: "builtin.search", CapabilityVersion: "1",
			Enabled: true, AgentVersion: 1, Revision: 4, UpdatedAt: now,
		},
		{
			BindingID: "binding-live-2", Ptid: agent.OwnerActorID, AgentID: agent.ID,
			CapabilityID: "builtin.memory", CapabilityVersion: "1",
			Enabled: true, AgentVersion: 1, Revision: 8, UpdatedAt: now,
		},
		{
			BindingID: "binding-deleted", Ptid: agent.OwnerActorID, AgentID: agent.ID,
			CapabilityID: "builtin.deleted", CapabilityVersion: "1",
			Enabled: true, AgentVersion: 1, Revision: 3, UpdatedAt: now,
			TombstonedAt: &tombstonedAt,
		},
	}
	if err := db.Create(&bindings).Error; err != nil {
		t.Fatalf("seed capability bindings: %v", err)
	}

	updated, err := service.UpdateAgent(context.Background(), domain.AgentUpsertOptions{
		ActorID: agent.OwnerActorID,
		AgentID: agent.ID,
		Name:    "Updated Agent",
		Version: agent.Version,
	})
	if err != nil {
		t.Fatalf("update agent: %v", err)
	}
	if updated.Version != 2 {
		t.Fatalf("agent version = %d, want 2", updated.Version)
	}

	var stored []persistence.AgentCapabilityBinding
	if err := db.Order("binding_id").Find(&stored).Error; err != nil {
		t.Fatalf("load rebased bindings: %v", err)
	}
	revisions := map[string]uint64{}
	agentVersions := map[string]uint64{}
	for i := range stored {
		revisions[stored[i].BindingID] = stored[i].Revision
		agentVersions[stored[i].BindingID] = stored[i].AgentVersion
	}
	if revisions["binding-live-1"] != 5 || revisions["binding-live-2"] != 9 {
		t.Fatalf("live binding revisions were not incremented: %+v", revisions)
	}
	if agentVersions["binding-live-1"] != 2 || agentVersions["binding-live-2"] != 2 {
		t.Fatalf("live bindings were not rebased to agent version 2: %+v", agentVersions)
	}
	if revisions["binding-deleted"] != 3 || agentVersions["binding-deleted"] != 1 {
		t.Fatalf("tombstoned binding changed during rebase: revisions=%+v versions=%+v",
			revisions, agentVersions)
	}

	events := eventBus.snapshot()
	if len(events) != 1 {
		t.Fatalf("invalidation event count = %d, want 1", len(events))
	}
	assertAgentAuthorityInvalidation(
		t,
		events[0],
		domain.AgentAuthorityInvalidationAgentUpdated,
		agent.ID,
		2,
		"",
		0,
	)
}

func TestAgentUpdateRollsBackWhenBindingRebaseFails(t *testing.T) {
	db := openAgentServiceTestDB(t, "agent_update_binding_rollback")
	service := NewAgentService()
	agent := seedAgentServiceTestAgent(t, db)
	if err := db.Create(&persistence.AgentCapabilityBinding{
		BindingID: "binding-live", Ptid: agent.OwnerActorID, AgentID: agent.ID,
		CapabilityID: "builtin.search", CapabilityVersion: "1",
		Enabled: true, AgentVersion: 1, Revision: 1, UpdatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatalf("seed capability binding: %v", err)
	}
	if err := db.Exec(`
		CREATE TRIGGER reject_agent_binding_rebase
		BEFORE UPDATE OF agent_version ON agent_capability_bindings
		BEGIN
			SELECT RAISE(ABORT, 'binding rebase rejected');
		END
	`).Error; err != nil {
		t.Fatalf("create rollback trigger: %v", err)
	}

	_, err := service.UpdateAgent(context.Background(), domain.AgentUpsertOptions{
		ActorID: agent.OwnerActorID,
		AgentID: agent.ID,
		Name:    "Must Roll Back",
		Version: agent.Version,
	})
	if !isAgentServiceError(err, errcode.AgentInternal) {
		t.Fatalf("expected binding rebase failure, got %v", err)
	}

	var storedAgent persistence.Agent
	if err := db.First(&storedAgent, "id = ?", agent.ID).Error; err != nil {
		t.Fatalf("load rolled back agent: %v", err)
	}
	if storedAgent.Version != 1 || storedAgent.Name != agent.Name {
		t.Fatalf("agent update was not rolled back: %+v", storedAgent)
	}
	var storedBinding persistence.AgentCapabilityBinding
	if err := db.First(&storedBinding, "binding_id = ?", "binding-live").Error; err != nil {
		t.Fatalf("load rolled back binding: %v", err)
	}
	if storedBinding.AgentVersion != 1 || storedBinding.Revision != 1 {
		t.Fatalf("binding changed despite rollback: %+v", storedBinding)
	}
}

func TestConcurrentAgentUpdatesAllowOneCASWinner(t *testing.T) {
	db := openAgentServiceTestDB(t, "agent_update_concurrent_cas")
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	agent := seedAgentServiceTestAgent(t, db)
	service := NewAgentService()

	start := make(chan struct{})
	results := make(chan error, 2)
	for _, name := range []string{"Concurrent A", "Concurrent B"} {
		name := name
		go func() {
			<-start
			_, updateErr := service.UpdateAgent(context.Background(), domain.AgentUpsertOptions{
				ActorID: agent.OwnerActorID,
				AgentID: agent.ID,
				Name:    name,
				Version: agent.Version,
			})
			results <- updateErr
		}()
	}
	close(start)

	successes := 0
	conflicts := 0
	for range 2 {
		resultErr := <-results
		switch {
		case resultErr == nil:
			successes++
		case isAgentServiceError(resultErr, errcode.AgentVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent update result: %v", resultErr)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent CAS results: successes=%d conflicts=%d", successes, conflicts)
	}
}

func openAgentServiceTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db := openRuntimeAuthorityDB(t, name)
	if err := db.AutoMigrate(&persistence.AgentCapabilityBinding{}); err != nil {
		t.Fatalf("migrate agent capability binding: %v", err)
	}
	return db
}

func seedAgentServiceTestAgent(t *testing.T, db *gorm.DB) persistence.Agent {
	t.Helper()
	now := time.Now().UTC()
	agent := persistence.Agent{
		ID:           "agent-1",
		Name:         "Original Agent",
		ThinkingMode: string(domain.ThinkingModeAuto),
		Visibility:   string(domain.AgentVisibilityPrivate),
		OwnerActorID: "ptid:person:owner",
		Version:      1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := db.Create(&agent).Error; err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	return agent
}

func assertAgentAuthorityInvalidation(
	t *testing.T,
	event domain.DomainEvent,
	reason domain.AgentAuthorityInvalidationReason,
	agentID string,
	agentVersion uint64,
	bindingID string,
	bindingRevision uint64,
) {
	t.Helper()
	if event.EventType != string(domain.EventTypeAgentAuthorityInvalidated) {
		t.Fatalf("event type = %q", event.EventType)
	}
	payload, ok := event.Payload.(domain.AgentAuthorityInvalidation)
	if !ok {
		t.Fatalf("event payload type = %T", event.Payload)
	}
	if payload.Reason != reason ||
		payload.AgentID != agentID ||
		payload.AgentVersion != agentVersion ||
		payload.BindingID != bindingID ||
		payload.BindingRevision != bindingRevision {
		t.Fatalf("unexpected invalidation payload: %+v", payload)
	}
	if event.Metadata["agent_id"] != agentID {
		t.Fatalf("event metadata missing agent_id: %+v", event.Metadata)
	}
	var serialized struct {
		EventType string                            `json:"event_type"`
		Payload   domain.AgentAuthorityInvalidation `json:"payload"`
	}
	if err := json.Unmarshal(SerializeEvent(event), &serialized); err != nil {
		t.Fatalf("decode serialized invalidation: %v", err)
	}
	if serialized.EventType != string(domain.EventTypeAgentAuthorityInvalidated) ||
		serialized.Payload != payload {
		t.Fatalf("serialized invalidation mismatch: %+v", serialized)
	}
}

func isAgentServiceError(err error, code errcode.Code) bool {
	var bizErr *errcode.BizError
	return errors.As(err, &bizErr) && bizErr.Code == code
}
