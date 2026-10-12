package infrastructure

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTxProducerTestDB(t *testing.T) *GormRepo {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:notification-tx-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return repo
}

func TestTxProducerProducesAndBumpsUnread(t *testing.T) {
	repo := newTxProducerTestDB(t)
	producer := NewTxProducer(repo.db)
	now := time.Now().UTC()

	result, err := producer.ProduceInTx(context.Background(), TxInput{
		RecipientPTID:  "ptid:owner",
		ActorPTID:      "ptid:bot",
		Type:           410,
		Category:       domain.CategoryTask,
		TargetType:     "conversation",
		TargetID:       "conv-1",
		Title:          "Build Bot",
		Body:           "任务完成",
		IdempotencyKey: "bot-event:req-1",
	}, now)
	if err != nil {
		t.Fatalf("ProduceInTx: %v", err)
	}
	if !result.Produced {
		t.Fatal("first production should report produced=true")
	}
	if result.NotificationID != "ntf-bot-event:req-1" {
		t.Fatalf("notification id = %q, want ntf-bot-event:req-1", result.NotificationID)
	}
	counts, err := repo.GetUnreadCounts("ptid:owner")
	if err != nil {
		t.Fatalf("counts: %v", err)
	}
	if counts.ByCategory[domain.CategoryTask] != 1 {
		t.Fatalf("task unread = %d, want 1", counts.ByCategory[domain.CategoryTask])
	}
}

func TestTxProducerReplayCollapses(t *testing.T) {
	repo := newTxProducerTestDB(t)
	producer := NewTxProducer(repo.db)
	now := time.Now().UTC()
	input := TxInput{
		RecipientPTID:  "ptid:owner",
		ActorPTID:      "ptid:bot",
		Type:           410,
		Category:       domain.CategoryTask,
		TargetID:       "conv-1",
		IdempotencyKey: "bot-event:req-1",
	}
	if _, err := producer.ProduceInTx(context.Background(), input, now); err != nil {
		t.Fatalf("first: %v", err)
	}
	replay, err := producer.ProduceInTx(context.Background(), input, now)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.Produced {
		t.Fatal("replayed request must collapse without a second row")
	}
	counts, _ := repo.GetUnreadCounts("ptid:owner")
	if counts.ByCategory[domain.CategoryTask] != 1 {
		t.Fatalf("task unread = %d, still want 1", counts.ByCategory[domain.CategoryTask])
	}
}

func TestTxProducerHonorsMutedPreference(t *testing.T) {
	repo := newTxProducerTestDB(t)
	now := time.Now().UTC()
	if _, err := repo.UpdatePreferences("ptid:owner", 1, []domain.NotificationPreferencePatch{
		{Category: domain.CategoryTask, Enabled: false, PushEnabled: true, SoundEnabled: true},
	}); err != nil {
		t.Fatalf("mute task category: %v", err)
	}
	muted, err := NewTxProducer(repo.db).ProduceInTx(context.Background(), TxInput{
		RecipientPTID:  "ptid:owner",
		ActorPTID:      "ptid:bot",
		Type:           410,
		Category:       domain.CategoryTask,
		IdempotencyKey: "bot-event:req-1",
	}, now)
	if err != nil {
		t.Fatalf("produce muted: %v", err)
	}
	if muted.Produced {
		t.Fatal("muted category must not produce a notification row")
	}
	counts, _ := repo.GetUnreadCounts("ptid:owner")
	if counts.ByCategory[domain.CategoryTask] != 0 {
		t.Fatalf("task unread = %d, want 0 when muted", counts.ByCategory[domain.CategoryTask])
	}
}
