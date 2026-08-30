package infrastructure

import (
	"context"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateRelationshipSchemaCreatesOwnedTables(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:social_relationship_schema?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open relationship schema database: %v", err)
	}

	if err := MigrateRelationshipSchema(db); err != nil {
		t.Fatalf("migrate relationship schema: %v", err)
	}
	if !db.Migrator().HasTable(&friendRequestModel{}) {
		t.Fatal("friend request table was not created")
	}
	if !db.Migrator().HasTable(&friendshipModel{}) {
		t.Fatal("friendship table was not created")
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
}
