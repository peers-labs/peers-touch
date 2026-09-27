package infrastructure

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMomentsStatsRepositoryCountsEncryptedPrivateContent(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(
		&db.Actor{},
		&db.SocialPublicPost{},
		&db.SocialPrivateContentPost{},
		&db.SocialComment{},
		&db.SocialPrivateContentComment{},
		&db.SocialReaction{},
		&db.SocialCircle{},
	); err != nil {
		t.Fatalf("migrate stats fixtures: %v", err)
	}

	now := time.Now().UTC()
	actor := db.Actor{
		ID:                41,
		PTID:              "ptid:alice",
		PreferredUsername: "alice",
		Email:             "alice@example.test",
		PasswordHash:      "test-only",
	}
	if err := database.Create(&actor).Error; err != nil {
		t.Fatalf("seed actor: %v", err)
	}
	if err := database.Create(&db.SocialPublicPost{
		ID:            101,
		AuthorID:      actor.ID,
		Type:          "TEXT",
		AudienceKind:  "PUBLIC",
		TextBody:      "public",
		CommentsCount: 4,
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Error; err != nil {
		t.Fatalf("seed public post: %v", err)
	}
	if err := database.Create(&db.SocialPrivateContentPost{
		PostID:                    "private-post",
		ContentID:                 "private-content",
		AuthorPTID:                actor.PTID,
		Generation:                1,
		AudienceSnapshotID:        "snapshot-1",
		Kind:                      "TEXT",
		EncryptedPayloadBytes:     []byte("ciphertext"),
		EncryptedPayloadSHA256:    []byte("payload-hash"),
		ObjectDescriptorSetSHA256: []byte("descriptor-hash"),
		LifecycleState:            "ACTIVE",
		CommentsCount:             2,
		ReactionsCount:            3,
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}).Error; err != nil {
		t.Fatalf("seed private post: %v", err)
	}

	repository := NewMomentsStatsRepository(database, NewActorIdentity(database))
	stats, err := repository.GetByActorPTID(context.Background(), actor.PTID)
	if err != nil {
		t.Fatalf("read moments stats: %v", err)
	}
	if stats.PostsCount != 2 {
		t.Fatalf("posts count = %d, want 2", stats.PostsCount)
	}
	if stats.CommentsReceivedCount != 6 {
		t.Fatalf("comments received = %d, want 6", stats.CommentsReceivedCount)
	}
	if stats.ReactionsReceivedCount != 3 {
		t.Fatalf("reactions received = %d, want 3", stats.ReactionsReceivedCount)
	}
}
