package persistence

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSystemTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:bot-system-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("registry migration: %v", err)
	}
	if err := repo.AutoMigrateSystemTables(); err != nil {
		t.Fatalf("system migration: %v", err)
	}
	return db
}

func activeBotRow(botPtid, ownerPtid string, state domain.State) *domain.Bot {
	bot, err := domain.NewActive(
		botPtid,
		ownerPtid,
		"Build Bot",
		"wh_"+botPtid,
		"ptsec_secret-"+botPtid,
		time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC),
	)
	if err != nil {
		panic(err)
	}
	bot.State = state
	return bot
}

func TestEnsureActiveGrantRecordsOnceAndAuthorizes(t *testing.T) {
	db := newSystemTestDB(t)
	repo := NewGormRepo(db)
	bot := activeBotRow("ptid:bot-1", "ptid:owner-1", domain.StateActive)
	if err := repo.Create(context.Background(), bot); err != nil {
		t.Fatalf("create bot: %v", err)
	}
	store := NewSystemStore(db)
	now := time.Now().UTC()
	ctx := context.Background()

	if err := store.EnsureActiveGrant(
		ctx, "ptid:bot-1", "ptid:owner-1", "conv-1", now,
	); err != nil {
		t.Fatalf("EnsureActiveGrant: %v", err)
	}
	// Idempotent.
	if err := store.EnsureActiveGrant(
		ctx, "ptid:bot-1", "ptid:owner-1", "conv-1", now,
	); err != nil {
		t.Fatalf("EnsureActiveGrant replay: %v", err)
	}
	if err := store.Authorize(ctx, "ptid:bot-1", "ptid:owner-1", "conv-1"); err != nil {
		t.Fatalf("Authorize after grant: %v", err)
	}
	// Wrong conversation / owner fails closed.
	if err := store.Authorize(ctx, "ptid:bot-1", "ptid:owner-1", "conv-other"); err == nil {
		t.Fatal("expected rejection for ungranted conversation")
	}
	if err := store.Authorize(ctx, "ptid:bot-1", "ptid:intruder", "conv-1"); err == nil {
		t.Fatal("expected rejection for foreign owner")
	}
	var count int64
	db.Model(&BotSystemGrantModel{}).Count(&count)
	if count != 1 {
		t.Fatalf("grant rows = %d, want 1", count)
	}
}

func TestEnsureActiveGrantRejectsInactiveOrForeignBot(t *testing.T) {
	db := newSystemTestDB(t)
	repo := NewGormRepo(db)
	ctx := context.Background()

	disabled := activeBotRow("ptid:bot-off", "ptid:owner-1", domain.StateDisabled)
	if err := repo.Create(ctx, disabled); err != nil {
		t.Fatalf("create disabled bot: %v", err)
	}
	store := NewSystemStore(db)
	if err := store.EnsureActiveGrant(
		ctx, "ptid:bot-off", "ptid:owner-1", "conv", time.Now(),
	); err == nil {
		t.Fatal("disabled bot must not receive a grant")
	}
	if err := store.EnsureActiveGrant(
		ctx, "ptid:missing", "ptid:owner-1", "conv", time.Now(),
	); err == nil {
		t.Fatal("unknown bot must not receive a grant")
	}
}

func TestIngestionIdempotencyWindow(t *testing.T) {
	db := newSystemTestDB(t)
	store := NewSystemStore(db)
	ctx := context.Background()
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)

	if _, found, err := store.LoadIngestion(ctx, "ptid:bot-1", "req-1", now); err != nil || found {
		t.Fatalf("first load = (%v,%v), want not found", found, err)
	}
	if err := store.RecordIngestion(ctx, "ptid:bot-1", "req-1", "evt-1", now); err != nil {
		t.Fatalf("RecordIngestion: %v", err)
	}
	eventID, found, err := store.LoadIngestion(ctx, "ptid:bot-1", "req-1", now.Add(time.Hour))
	if err != nil || !found || eventID != "evt-1" {
		t.Fatalf("replay = (%q,%v,%v), want evt-1", eventID, found, err)
	}
	// Outside the 24h window.
	if _, found, err := store.LoadIngestion(
		ctx, "ptid:bot-1", "req-1", now.Add(25*time.Hour),
	); err != nil || found {
		t.Fatalf("expired load = (%v,%v), want not found", found, err)
	}
}
