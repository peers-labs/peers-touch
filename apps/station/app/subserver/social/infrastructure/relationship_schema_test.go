package infrastructure

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateIdentitySchemaCreatesOwnedTables(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:social_relationship_schema?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open relationship schema database: %v", err)
	}

	if err := MigrateIdentitySchema(db); err != nil {
		t.Fatalf("migrate social identity schema: %v", err)
	}
	if !db.Migrator().HasTable(&friendshipModel{}) {
		t.Fatal("friendship table was not created")
	}
	if !db.Migrator().HasTable(&socialDirectionalRelationshipModel{}) {
		t.Fatal("directional relationship table was not created")
	}
	for _, column := range []string{"actor_ptid", "peer_ptid"} {
		if !db.Migrator().HasColumn(&friendshipModel{}, column) {
			t.Fatalf("friendship table is missing %s", column)
		}
	}
	for _, legacyColumn := range []string{"actor_did", "peer_did"} {
		if db.Migrator().HasColumn(&friendshipModel{}, legacyColumn) {
			t.Fatalf("friendship table retained legacy column %s", legacyColumn)
		}
	}
	blocked, err := NewBlockGraphRepository(db).IsBlockedBetween(
		context.Background(),
		"ptid:alice",
		"ptid:bob",
	)
	if err != nil {
		t.Fatalf("query fresh friendship schema: %v", err)
	}
	if blocked {
		t.Fatal("fresh friendship schema reported an unexpected block")
	}
}

func TestRelationshipAuthorityMigrationMovesLegacyBlocksToTheSingleOwner(
	t *testing.T,
) {
	db, err := gorm.Open(
		sqlite.Open("file:social_relationship_migration?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateIdentitySchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&friendshipModel{
		ActorPTID: "ptid:alice",
		PeerPTID:  "ptid:bob",
		Status:    friendshipStatusBlocked,
	}).Error; err != nil {
		t.Fatal(err)
	}
	store, err := NewGORMFederatedFriendRequestStore(db, delivery.SystemClock{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	var legacyCount int64
	if err := db.Model(&friendshipModel{}).
		Where("status = ?", friendshipStatusBlocked).
		Count(&legacyCount).Error; err != nil {
		t.Fatal(err)
	}
	var canonicalCount int64
	if err := db.Model(&socialDirectionalRelationshipModel{}).
		Where(
			"actor_ptid = ? AND target_actor_ptid = ? AND blocked = ?",
			"ptid:alice",
			"ptid:bob",
			true,
		).
		Count(&canonicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 || canonicalCount != 1 {
		t.Fatalf(
			"legacy blocks=%d canonical blocks=%d, want 0 and 1",
			legacyCount,
			canonicalCount,
		)
	}
}
