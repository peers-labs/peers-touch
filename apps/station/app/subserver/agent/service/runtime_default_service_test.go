package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openRuntimeDefaultTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open runtime default test database: %v", err)
	}
	if err := db.AutoMigrate(&persistence.AgentRuntimeDefault{}); err != nil {
		t.Fatalf("migrate runtime default test database: %v", err)
	}
	injectOrchestrationServiceTestStore(t, db)
	return db
}

func TestRuntimeDefaultPersistsAndRevisesOptimistically(t *testing.T) {
	openRuntimeDefaultTestDB(t, "runtime_default_lifecycle")
	svc := NewRuntimeDefaultService()
	ctx := context.Background()

	if _, found, err := svc.GetRuntimeDefault(ctx, "actor-1"); err != nil || found {
		t.Fatalf("missing default should be found=false, got found=%v err=%v", found, err)
	}

	created, err := svc.SetRuntimeDefault(ctx, "actor-1", "provider-a", "provider-a/model-a", 0)
	if err != nil {
		t.Fatalf("create default: %v", err)
	}
	if created.Revision != 1 ||
		created.DefaultProviderID != "provider-a" ||
		created.DefaultModelID != "provider-a/model-a" {
		t.Fatalf("created default = %+v", created)
	}

	if _, err := svc.SetRuntimeDefault(ctx, "actor-1", "provider-b", "provider-b/model-b", 1); err != nil {
		t.Fatalf("update default at current revision: %v", err)
	}
	stale, err := svc.SetRuntimeDefault(ctx, "actor-1", "provider-a", "provider-a/model-a", 1)
	if err == nil {
		t.Fatalf("expected revision conflict, got row %+v", stale)
	}

	loaded, found, err := svc.GetRuntimeDefault(ctx, "actor-1")
	if err != nil || !found {
		t.Fatalf("reload default: found=%v err=%v", found, err)
	}
	if loaded.Revision != 2 ||
		loaded.DefaultProviderID != "provider-b" ||
		loaded.DefaultModelID != "provider-b/model-b" {
		t.Fatalf("loaded default = %+v", loaded)
	}

	// A different actor keeps an independent default row.
	other, err := svc.SetRuntimeDefault(ctx, "actor-2", "provider-c", "provider-c/model-c", 0)
	if err != nil || other.Revision != 1 {
		t.Fatalf("other actor default = %+v err=%v", other, err)
	}
}

func TestRuntimeDefaultRejectsCreateAtNonZeroRevision(t *testing.T) {
	openRuntimeDefaultTestDB(t, "runtime_default_revision")
	svc := NewRuntimeDefaultService()

	if _, err := svc.SetRuntimeDefault(
		context.Background(),
		"actor-9",
		"provider-a",
		"provider-a/model-a",
		7,
	); err == nil {
		t.Fatal("expected revision conflict when no row exists")
	}
}
