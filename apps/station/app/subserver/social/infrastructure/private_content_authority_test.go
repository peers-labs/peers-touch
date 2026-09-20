package infrastructure

import (
	"context"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestPrivateAudienceAuthorityUsesAcceptedProjectionOnly(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:private_audience?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&federatedRelationshipProjectionModel{},
		&friendshipModel{},
	); err != nil {
		t.Fatal(err)
	}
	acceptedAt := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	if err := database.Create([]federatedRelationshipProjectionModel{
		{
			OwnerPTID:         "ptid:alice",
			PeerPTID:          "ptid:bob",
			RequestID:         "request-bob",
			AcceptedEventID:   "event-bob",
			AcceptedEventHash: []byte("event-hash-bob"),
			AcceptedAt:        acceptedAt,
		},
		{
			OwnerPTID:         "ptid:alice",
			PeerPTID:          "ptid:eve",
			RequestID:         "request-eve",
			AcceptedEventID:   "event-eve",
			AcceptedEventHash: []byte("event-hash-eve"),
			AcceptedAt:        acceptedAt,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create([]friendshipModel{
		{
			ActorPTID: "ptid:alice",
			PeerPTID:  "ptid:eve",
			Status:    friendshipStatusBlocked,
		},
		{
			ActorPTID: "ptid:alice",
			PeerPTID:  "ptid:mallory",
			Status:    friendRequestPolicyRelationshipAccepted,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}

	authority, err := NewGORMPrivateAudienceAuthority(database)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := authority.ResolveFriendsPostSnapshot(
		context.Background(),
		nil,
		"ptid:alice",
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SourceRevision != 2 ||
		len(snapshot.SourceHeadSHA256) != 32 ||
		len(snapshot.RecipientPTIDs) != 1 ||
		snapshot.RecipientPTIDs[0] != "ptid:bob" {
		t.Fatalf("unexpected FRIENDS snapshot: %+v", snapshot)
	}
}
