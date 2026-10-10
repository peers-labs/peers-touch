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

func TestActorQueryRepositoryCountsEncryptedPrivateContent(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(
		&touchdb.Actor{},
		&touchdb.SocialPublicPost{},
		&touchdb.SocialPrivateContentPost{},
		&touchdb.SocialComment{},
		&touchdb.SocialPrivateContentComment{},
	); err != nil {
		t.Fatalf("migrate content fixtures: %v", err)
	}

	now := time.Now().UTC()
	actor := touchdb.Actor{
		ID:                41,
		PTID:              "ptid:alice",
		PreferredUsername: "alice",
		Email:             "alice@example.test",
		PasswordHash:      "test-only",
	}
	if err := database.Create(&actor).Error; err != nil {
		t.Fatalf("seed actor: %v", err)
	}
	if err := database.Create(&touchdb.SocialPublicPost{
		ID:        101,
		AuthorID:  actor.ID,
		Type:      "TEXT",
		TextBody:  "public",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed public post: %v", err)
	}
	if err := database.Create(&touchdb.SocialPrivateContentPost{
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
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}).Error; err != nil {
		t.Fatalf("seed private post: %v", err)
	}
	if err := database.Create(&touchdb.SocialPrivateContentComment{
		CommentID:                 "private-comment",
		ContentID:                 "private-comment-content",
		PostID:                    "private-post",
		AuthorPTID:                actor.PTID,
		Generation:                1,
		InteractionSnapshotID:     "snapshot-2",
		EncryptedPayloadBytes:     []byte("ciphertext"),
		EncryptedPayloadSHA256:    []byte("payload-hash"),
		ObjectDescriptorSetSHA256: []byte("descriptor-hash"),
		LifecycleState:            "ACTIVE",
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}).Error; err != nil {
		t.Fatalf("seed private comment: %v", err)
	}

	repository := NewActorQueryRepository(database)
	ctx := context.Background()

	byAuthor, err := repository.CountPostsByAuthor(ctx, actor.PTID)
	if err != nil {
		t.Fatalf("count posts by author: %v", err)
	}
	if byAuthor != 2 {
		t.Fatalf("posts by author = %d, want 2", byAuthor)
	}
	total, err := repository.CountPosts(ctx)
	if err != nil {
		t.Fatalf("count posts: %v", err)
	}
	if total != 2 {
		t.Fatalf("posts = %d, want 2", total)
	}
	recent, err := repository.CountPostsSince(ctx, now.Add(-time.Minute))
	if err != nil {
		t.Fatalf("count recent posts: %v", err)
	}
	if recent != 2 {
		t.Fatalf("recent posts = %d, want 2", recent)
	}
	comments, err := repository.CountComments(ctx)
	if err != nil {
		t.Fatalf("count comments: %v", err)
	}
	if comments != 1 {
		t.Fatalf("comments = %d, want 1", comments)
	}
}
