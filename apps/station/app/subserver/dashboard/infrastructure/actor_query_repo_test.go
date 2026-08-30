package infrastructure

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	coresession "github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	touchdb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestActorQueryRepositoryResolvesPTIDInsidePersistenceAdapter(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&touchdb.Actor{}, &coresession.SessionRecord{}); err != nil {
		t.Fatalf("migrate actor fixtures: %v", err)
	}

	actors := []touchdb.Actor{
		{ID: 41, PTID: "ptid:alice", PreferredUsername: "alice", Email: "alice@example.test", PasswordHash: "old-alice", FederatedHandle: "@alice@example.test"},
		{ID: 42, PTID: "41", PreferredUsername: "numeric-looking", Email: "numeric@example.test", PasswordHash: "old-numeric", FederatedHandle: "@numeric@example.test"},
	}
	if err := db.Create(&actors).Error; err != nil {
		t.Fatalf("seed actors: %v", err)
	}

	now := time.Now()
	sessions := []coresession.SessionRecord{
		{SessionID: "alice-session", UserID: 41, DeviceType: coresession.DeviceTypeDesktop, CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastActiveAt: now},
		{SessionID: "numeric-session", UserID: 42, DeviceType: coresession.DeviceTypeMobile, CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastActiveAt: now},
	}
	if err := db.Create(&sessions).Error; err != nil {
		t.Fatalf("seed sessions: %v", err)
	}

	repo := NewActorQueryRepository(db)
	ctx := context.Background()

	found, total, err := repo.ListActors(ctx, domain.ActorListQuery{Search: "ptid:alice", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("search actors by PTID: %v", err)
	}
	if total != 1 || len(found) != 1 || found[0].PTID != "ptid:alice" {
		t.Fatalf("PTID search mismatch: total=%d actors=%+v", total, found)
	}

	if err := repo.ResetPassword(ctx, "ptid:alice", "new-alice"); err != nil {
		t.Fatalf("reset password by PTID: %v", err)
	}
	var persisted []touchdb.Actor
	if err := db.Order("id").Find(&persisted).Error; err != nil {
		t.Fatalf("read actors: %v", err)
	}
	if persisted[0].PasswordHash != "new-alice" || persisted[1].PasswordHash != "old-numeric" {
		t.Fatalf("PTID resolution updated wrong actor: %+v", persisted)
	}

	actorSessions, err := repo.ListActorSessions(ctx, "ptid:alice")
	if err != nil {
		t.Fatalf("list sessions by PTID: %v", err)
	}
	if len(actorSessions) != 1 || actorSessions[0].SessionID != "alice-session" {
		t.Fatalf("unexpected actor sessions: %+v", actorSessions)
	}

	active, err := repo.ListActivePeersSessions(ctx, 10)
	if err != nil {
		t.Fatalf("list active sessions before revoke: %v", err)
	}
	if len(active) != 2 {
		t.Fatalf("active sessions before revoke = %+v, want two", active)
	}

	if err := repo.RevokeActorSession(ctx, "41", "alice-session"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-actor revoke error = %v, want record not found", err)
	}
	if err := repo.RevokeActorSession(ctx, "ptid:alice", "alice-session"); err != nil {
		t.Fatalf("revoke session by PTID: %v", err)
	}

	active, err = repo.ListActivePeersSessions(ctx, 10)
	if err != nil {
		t.Fatalf("list active sessions: %v", err)
	}
	if len(active) != 1 || active[0].ActorPTID != "41" || active[0].SessionID != "numeric-session" {
		t.Fatalf("active session PTID projection mismatch: %+v", active)
	}
}
