package infrastructure

import (
	"context"
	"testing"

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
	if !db.Migrator().HasTable(&friendRequestModel{}) {
		t.Fatal("friend request table was not created")
	}
	if !db.Migrator().HasTable(&friendshipModel{}) {
		t.Fatal("friendship table was not created")
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

	repository := NewFriendRequestRepository(db)
	requests, total, err := repository.ListFriendRequests(
		context.Background(),
		"ptid:test:actor",
		0,
		50,
		0,
	)
	if err != nil {
		t.Fatalf("list friend requests on fresh schema: %v", err)
	}
	if total != 0 || len(requests) != 0 {
		t.Fatalf(
			"fresh relationship schema is not empty: total=%d requests=%d",
			total,
			len(requests),
		)
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
