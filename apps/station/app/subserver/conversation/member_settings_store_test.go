package conversation

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMemberSettingsTestStore(t *testing.T) *memberSettingsStore {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&conversationMemberSettingsModel{}); err != nil {
		t.Fatal(err)
	}
	return newMemberSettingsStore(db)
}

func TestMemberSettingsStoreDefaultsAndPartialUpdates(t *testing.T) {
	ctx := context.Background()
	store := newMemberSettingsTestStore(t)

	initial, err := store.Get(ctx, "conversation-1", "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if initial.Muted || initial.Pinned || !initial.AlertEnabled ||
		initial.Background != "default" || initial.BackgroundImage != "" ||
		initial.ClearedAtUnixMillis != 0 {
		t.Fatalf("unexpected defaults: %+v", initial)
	}

	muted := true
	alertEnabled := false
	pinned := true
	background := "mint"
	backgroundImage := "oss://station/object"
	clearedAt := int64(1234)
	updated, err := store.Update(ctx, "conversation-1", "ptid:alice", memberSettingsPatch{
		Muted:               &muted,
		Pinned:              &pinned,
		AlertEnabled:        &alertEnabled,
		Background:          &background,
		BackgroundImage:     &backgroundImage,
		ClearedAtUnixMillis: &clearedAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Muted || !updated.Pinned || updated.AlertEnabled ||
		updated.Background != "mint" ||
		updated.BackgroundImage != "oss://station/object" ||
		updated.ClearedAtUnixMillis != 1234 {
		t.Fatalf("unexpected update: %+v", updated)
	}

	pinned = false
	updated, err = store.Update(ctx, "conversation-1", "ptid:alice", memberSettingsPatch{
		Pinned: &pinned,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Pinned || !updated.Muted || updated.AlertEnabled ||
		updated.BackgroundImage != "oss://station/object" {
		t.Fatalf("partial update overwrote unrelated fields: %+v", updated)
	}
}

func TestMemberSettingsStoreIsActorScoped(t *testing.T) {
	ctx := context.Background()
	store := newMemberSettingsTestStore(t)
	muted := true
	if _, err := store.Update(ctx, "conversation-1", "ptid:alice", memberSettingsPatch{
		Muted: &muted,
	}); err != nil {
		t.Fatal(err)
	}

	bob, err := store.Get(ctx, "conversation-1", "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if bob.Muted || !bob.AlertEnabled {
		t.Fatalf("alice settings leaked to bob: %+v", bob)
	}
}

func TestMemberSettingsStoreNormalizesUnknownBackground(t *testing.T) {
	ctx := context.Background()
	store := newMemberSettingsTestStore(t)
	background := "unknown"
	updated, err := store.Update(ctx, "conversation-1", "ptid:alice", memberSettingsPatch{
		Background: &background,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Background != "default" {
		t.Fatalf("background = %q, want default", updated.Background)
	}
}
