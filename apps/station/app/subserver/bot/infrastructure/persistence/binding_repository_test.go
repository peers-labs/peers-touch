package persistence

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newBindingTestDB(t *testing.T) *GormRepo {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return repo
}

func seedTestBot(t *testing.T, repo *GormRepo, botPtid string) {
	t.Helper()
	now := time.Now().UTC()
	if err := repo.Create(context.Background(), &domain.Bot{
		BotPtid:      botPtid,
		OwnerPtid:    "ptid:v1:actor:peers:p:owner:test",
		PublishingID: "publishing-1",
		Name:         "Build Bot",
		State:        domain.StateActive,
		CreatedAt:    now,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestAgentBindingCasLifecycle(t *testing.T) {
	repo := newBindingTestDB(t)
	ctx := context.Background()
	botPtid := "ptid:v1:actor:peers:b:bot:test"
	seedTestBot(t, repo, botPtid)

	first, err := domain.NewAgentBinding(
		botPtid,
		"ptid:v1:actor:peers:p:owner:test",
		"agent-1",
		true,
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateAgentBinding(ctx, first); err != nil {
		t.Fatalf("create binding: %v", err)
	}
	if err := repo.CreateAgentBinding(ctx, first); err == nil {
		t.Fatal("second create for the same bot must conflict")
	}

	loaded, found, err := repo.GetAgentBinding(ctx, botPtid)
	if err != nil || !found {
		t.Fatalf("get binding found=%v err=%v", found, err)
	}
	if loaded.Version != 1 || loaded.AgentID != "agent-1" {
		t.Fatalf("loaded binding = %+v", loaded)
	}

	stale := *loaded
	stale.AgentID = "agent-2"
	if matched, err := repo.UpdateAgentBinding(ctx, &stale); err != nil || matched {
		t.Fatalf("stale update must not match: matched=%v err=%v", matched, err)
	}

	current := *loaded
	if err := current.Rebind("agent-2", false, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	matched, err := repo.UpdateAgentBinding(ctx, &current)
	if err != nil || !matched {
		t.Fatalf("versioned update failed: matched=%v err=%v", matched, err)
	}
	version, err := repo.AgentBindingRevision(ctx, botPtid)
	if err != nil || version != 2 {
		t.Fatalf("revision = %d err=%v", version, err)
	}

	bindings, err := repo.ListAgentBindings(ctx, "ptid:v1:actor:peers:p:owner:test")
	if err != nil || len(bindings) != 1 || bindings[0].AgentID != "agent-2" || bindings[0].Enabled {
		t.Fatalf("list bindings = %+v err=%v", bindings, err)
	}

	if matched, err := repo.DeleteAgentBinding(ctx, botPtid, 99); err != nil || matched {
		t.Fatalf("stale delete must not match: matched=%v err=%v", matched, err)
	}
	if matched, err := repo.DeleteAgentBinding(ctx, botPtid, 2); err != nil || !matched {
		t.Fatalf("delete binding matched=%v err=%v", matched, err)
	}
	if _, found, err := repo.GetAgentBinding(ctx, botPtid); err != nil || found {
		t.Fatalf("binding after delete found=%v err=%v", found, err)
	}
}
