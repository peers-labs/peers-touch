package conversation

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMemberSettingsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func newMemberSettingsTestStore(t *testing.T) *memberSettingsStore {
	t.Helper()
	db := newMemberSettingsTestDB(t)
	if err := db.AutoMigrate(&conversationMemberSettingsModel{}); err != nil {
		t.Fatal(err)
	}
	return newMemberSettingsStore(db)
}

func TestMemberSettingsStoreMigrationPreservesLegacyValuesIdempotently(t *testing.T) {
	ctx := context.Background()
	db := newMemberSettingsTestDB(t)
	if err := db.AutoMigrate(&conversationMemberModel{}); err != nil {
		t.Fatal(err)
	}
	joinedAt := time.Date(2026, time.August, 1, 2, 3, 4, 0, time.UTC)
	legacyMembers := []conversationMemberModel{
		{
			ConversationID: "conversation-1",
			Ptid:           "ptid:alice",
			Nickname:       "Legacy Alice",
			Muted:          true,
			JoinedAt:       joinedAt,
		},
		{
			ConversationID: "conversation-1",
			Ptid:           "ptid:bob",
			Nickname:       "Legacy Bob",
			Muted:          false,
			JoinedAt:       joinedAt.Add(time.Minute),
		},
	}
	if err := db.Create(&legacyMembers).Error; err != nil {
		t.Fatal(err)
	}

	store := newMemberSettingsStore(db)
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	alice, err := store.Get(ctx, "conversation-1", "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if alice.Nickname != "Legacy Alice" || !alice.Muted || alice.AlertEnabled {
		t.Fatalf("legacy alice settings not preserved: %+v", alice)
	}
	bob, err := store.Get(ctx, "conversation-1", "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if bob.Nickname != "Legacy Bob" || bob.Muted || !bob.AlertEnabled {
		t.Fatalf("legacy bob settings not preserved: %+v", bob)
	}

	nickname := "Current Alice"
	pinned := true
	if _, err := store.Update(ctx, "conversation-1", "ptid:alice", memberSettingsPatch{
		Nickname: &nickname,
		Pinned:   &pinned,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	alice, err = store.Get(ctx, "conversation-1", "ptid:alice")
	if err != nil {
		t.Fatal(err)
	}
	if alice.Nickname != "Current Alice" || !alice.Pinned || !alice.Muted || alice.AlertEnabled {
		t.Fatalf("repeat migration overwrote current settings: %+v", alice)
	}
	var count int64
	if err := db.Model(&conversationMemberSettingsModel{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("settings row count = %d, want 2", count)
	}
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
	nickname := "Project room"
	background := "mint"
	backgroundImage := "oss://station/object"
	clearedAt := int64(1234)
	updated, err := store.Update(ctx, "conversation-1", "ptid:alice", memberSettingsPatch{
		Nickname:            &nickname,
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
	if updated.Nickname != nickname ||
		!updated.Muted || !updated.Pinned || updated.AlertEnabled ||
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
	if updated.Nickname != nickname ||
		updated.Pinned || !updated.Muted || updated.AlertEnabled ||
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
