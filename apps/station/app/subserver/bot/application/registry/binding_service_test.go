package registry

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
)

type memoryBindingRepository struct {
	memoryRepository
	bindings map[string]*domain.AgentBinding
}

func (r *memoryBindingRepository) bindingStore() map[string]*domain.AgentBinding {
	if r.bindings == nil {
		r.bindings = make(map[string]*domain.AgentBinding)
	}
	return r.bindings
}

func (r *memoryBindingRepository) CreateAgentBinding(
	_ context.Context,
	binding *domain.AgentBinding,
) error {
	store := r.bindingStore()
	if _, exists := store[binding.BotPtid]; exists {
		return domain.NewError(domain.CodeStateConflict, "binding exists")
	}
	copy := *binding
	store[binding.BotPtid] = &copy
	return nil
}

func (r *memoryBindingRepository) UpdateAgentBinding(
	_ context.Context,
	binding *domain.AgentBinding,
) (bool, error) {
	existing, ok := r.bindingStore()[binding.BotPtid]
	if !ok || existing.Version != binding.Version-1 {
		return false, nil
	}
	copy := *binding
	r.bindingStore()[binding.BotPtid] = &copy
	return true, nil
}

func (r *memoryBindingRepository) GetAgentBinding(
	_ context.Context,
	botPtid string,
) (*domain.AgentBinding, bool, error) {
	binding, ok := r.bindingStore()[botPtid]
	if !ok {
		return nil, false, nil
	}
	copy := *binding
	return &copy, true, nil
}

func (r *memoryBindingRepository) ListAgentBindings(
	_ context.Context,
	ownerPtid string,
) ([]*domain.AgentBinding, error) {
	var result []*domain.AgentBinding
	for _, binding := range r.bindingStore() {
		if binding.OwnerPtid == ownerPtid {
			copy := *binding
			result = append(result, &copy)
		}
	}
	return result, nil
}

func (r *memoryBindingRepository) DeleteAgentBinding(
	_ context.Context,
	botPtid string,
	expectedVersion int64,
) (bool, error) {
	existing, ok := r.bindingStore()[botPtid]
	if !ok || existing.Version != expectedVersion {
		return false, nil
	}
	delete(r.bindingStore(), botPtid)
	return true, nil
}

func (r *memoryBindingRepository) AgentBindingRevision(
	_ context.Context,
	botPtid string,
) (int64, error) {
	if binding, ok := r.bindingStore()[botPtid]; ok {
		return binding.Version, nil
	}
	return 0, nil
}

type fakeAgentRoster struct {
	owned map[string]bool
}

func (r fakeAgentRoster) IsAgentOwnedBy(
	_ context.Context,
	ownerPtid string,
	agentID string,
) (bool, error) {
	return r.owned[ownerPtid+"|"+agentID], nil
}

func newBindingService() (*Service, *fakePublishingManager) {
	publishing := &fakePublishingManager{}
	service := NewService(
		&memoryBindingRepository{memoryRepository: memoryRepository{}},
		fakeMinter{},
		publishing,
		WithAgentRoster(fakeAgentRoster{owned: map[string]bool{}}),
	)
	service.now = func() time.Time {
		return time.Date(2026, time.October, 14, 0, 0, 0, 0, time.UTC)
	}
	return service, publishing
}

func createTestBot(t *testing.T, service *Service) *domain.Bot {
	t.Helper()
	created, err := service.Create(
		context.Background(),
		"ptid:v1:actor:peers:p:owner:test",
		"Build Bot",
		"peers",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	return created.Bot
}

func TestSetAgentBindingCreatesFirstRevision(t *testing.T) {
	service, _ := newBindingService()
	bot := createTestBot(t, service)
	service.roster = fakeAgentRoster{owned: map[string]bool{
		bot.OwnerPtid + "|agent-1": true,
	}}

	binding, err := service.SetAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, "agent-1", true, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if binding.Version != 1 || !binding.Enabled || binding.AgentID != "agent-1" {
		t.Fatalf("binding = %+v", binding)
	}
	active, found, err := service.ActiveBindingForBot(context.Background(), bot.BotPtid)
	if err != nil || !found || active.AgentID != "agent-1" {
		t.Fatalf("active binding = %+v found=%v err=%v", active, found, err)
	}
}

func TestSetAgentBindingRejectsForeignAgent(t *testing.T) {
	service, _ := newBindingService()
	bot := createTestBot(t, service)

	_, err := service.SetAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, "agent-other", true, 0,
	)
	if de, ok := domain.AsError(err); !ok || de.Code != domain.CodeInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestSetAgentBindingRequiresRevisionOnUpdate(t *testing.T) {
	service, _ := newBindingService()
	bot := createTestBot(t, service)
	service.roster = fakeAgentRoster{owned: map[string]bool{
		bot.OwnerPtid + "|agent-1": true,
		bot.OwnerPtid + "|agent-2": true,
	}}
	first, err := service.SetAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, "agent-1", true, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, "agent-2", true, 0,
	); err == nil {
		t.Fatal("expected conflict on create with existing binding")
	}
	updated, err := service.SetAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, "agent-2", false, first.Version,
	)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != 2 || updated.Enabled || updated.AgentID != "agent-2" {
		t.Fatalf("updated binding = %+v", updated)
	}
	if _, found, _ := service.ActiveBindingForBot(context.Background(), bot.BotPtid); found {
		t.Fatal("paused binding must not project inbound turns")
	}
}

func TestDeleteAgentBindingStopsProjection(t *testing.T) {
	service, _ := newBindingService()
	bot := createTestBot(t, service)
	service.roster = fakeAgentRoster{owned: map[string]bool{
		bot.OwnerPtid + "|agent-1": true,
	}}
	binding, err := service.SetAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, "agent-1", true, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, binding.Version,
	); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := service.ActiveBindingForBot(context.Background(), bot.BotPtid); found {
		t.Fatal("deleted binding must fail closed")
	}
	if err := service.DeleteAgentBinding(
		context.Background(), bot.OwnerPtid, bot.BotPtid, binding.Version,
	); err == nil {
		t.Fatal("deleting an absent binding must report not found")
	}
}

func TestAgentBindingRejectsUnknownBot(t *testing.T) {
	service, _ := newBindingService()
	if _, err := service.SetAgentBinding(
		context.Background(),
		"ptid:v1:actor:peers:p:owner:test",
		"ptid:v1:actor:peers:b:bot:missing",
		"agent-1",
		true,
		0,
	); err == nil {
		t.Fatal("expected not found for unknown bot")
	}
}
