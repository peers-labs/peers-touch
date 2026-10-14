package infrastructure

import (
	"context"
	"testing"
	"time"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateInteractionSchemaWidensReactionPostIDAndPreservesRows(
	t *testing.T,
) {
	database, err := gorm.Open(
		sqlite.Open("file:interaction_migration?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`
CREATE TABLE social_reactions (
	post_id INTEGER NOT NULL,
	actor_id INTEGER NOT NULL,
	kind TEXT NOT NULL,
	post_class TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (post_id, actor_id, kind)
)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`
INSERT INTO social_reactions (
	post_id, actor_id, kind, post_class, created_at
) VALUES (?, ?, ?, ?, ?)`,
		101,
		1,
		"REACTION_LIKE",
		"public",
		time.Now().UTC(),
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateInteractionSchema(database); err != nil {
		t.Fatal(err)
	}
	if err := MigrateInteractionSchema(database); err != nil {
		t.Fatalf("idempotent migration failed: %v", err)
	}

	var public dbmodel.SocialReaction
	if err := database.WithContext(context.Background()).
		Where("post_id = ?", "101").
		First(&public).Error; err != nil {
		t.Fatalf("read preserved public reaction: %v", err)
	}
	if public.PostID != "101" {
		t.Fatalf("public reaction post_id = %q, want 101", public.PostID)
	}

	private := dbmodel.SocialReaction{
		PostID:    "01M3CWYN3NCPM35ZVMBQG20NCP",
		ActorID:   2,
		Kind:      "REACTION_LOVE",
		PostClass: "private",
		CreatedAt: time.Now().UTC(),
	}
	if err := database.Create(&private).Error; err != nil {
		t.Fatalf("insert private ULID reaction: %v", err)
	}
	if err := database.Create(&private).Error; err == nil {
		t.Fatal("duplicate private reaction bypassed the composite primary key")
	}
}

func TestMigrateInteractionSchemaWidensReactionKindAndPreservesRows(
	t *testing.T,
) {
	database, err := gorm.Open(
		sqlite.Open("file:reaction_kind_migration?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`
CREATE TABLE social_reactions (
	post_id TEXT NOT NULL,
	actor_id INTEGER NOT NULL,
	kind VARCHAR(16) NOT NULL,
	post_class TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (post_id, actor_id, kind)
)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&dbmodel.SocialReaction{
		PostID:    "post-1",
		ActorID:   1,
		Kind:      "REACTION_LIKE",
		PostClass: "public",
		CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateInteractionSchema(database); err != nil {
		t.Fatal(err)
	}
	if err := MigrateInteractionSchema(database); err != nil {
		t.Fatalf("idempotent migration failed: %v", err)
	}

	if err := database.Create(&dbmodel.SocialReaction{
		PostID:    "post-1",
		ActorID:   2,
		Kind:      "REACTION_HEART_HANDS",
		PostClass: "public",
		CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatalf("insert expanded reaction kind: %v", err)
	}
	var count int64
	if err := database.Model(&dbmodel.SocialReaction{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("reaction row count = %d, want 2", count)
	}
}
