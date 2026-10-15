package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMemoryAccessKeepsAggregateReadsWithinVisibleAgents(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&persistence.Agent{}, &persistence.Memory{}); err != nil {
		t.Fatal(err)
	}
	for _, agent := range []persistence.Agent{
		{ID: "own", Name: "own", OwnerActorPTID: "alice", Visibility: "private"},
		{ID: "foreign", Name: "foreign", OwnerActorPTID: "bob", Visibility: "private"},
		{ID: "shared", Name: "shared", OwnerActorPTID: "bob", Visibility: "workspace"},
	} {
		if err := db.Create(&agent).Error; err != nil {
			t.Fatal(err)
		}
		row := persistence.Memory{ID: agent.ID, AgentID: agent.ID, Target: "user", Content: "memory"}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "alice"})
	var visible []string
	if err := memoryAccessQuery(ctx, db.Model(&persistence.Memory{}), false).
		Order("id").Pluck("id", &visible).Error; err != nil {
		t.Fatal(err)
	}
	if len(visible) != 2 || visible[0] != "own" || visible[1] != "shared" {
		t.Fatalf("aggregate read leaked or lost memory: %v", visible)
	}
	var writable []string
	if err := memoryAccessQuery(ctx, db.Model(&persistence.Memory{}), true).
		Pluck("id", &writable).Error; err != nil {
		t.Fatal(err)
	}
	if len(writable) != 1 || writable[0] != "own" {
		t.Fatalf("write scope includes another owner's memory: %v", writable)
	}
	var count int64
	if err := memoryAccessQuery(ctx, db.Model(&persistence.Memory{}).Where("id = ?", "foreign"), false).
		Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("foreign ID read: count=%d err=%v", count, err)
	}
}
