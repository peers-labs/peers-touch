package actor

import (
	"context"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSeedDevFriendshipsCreatesCanonicalMutualFollowsWithoutLegacyTable(t *testing.T) {
	dsn := fmt.Sprintf("file:seed_dev_friends_%s?mode=memory&cache=shared", t.Name())
	gdb, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&db.Actor{}, &db.Follow{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	usernames := []string{"alice", "bob", "carol"}
	for index, username := range usernames {
		actor := db.Actor{
			ID:                uint64(index + 1),
			PreferredUsername: username,
			Email:             username + "@p.t",
			PTID:              "ptid:test:" + username,
			FederatedHandle:   "@" + username + "@station.test",
		}
		if err := gdb.Create(&actor).Error; err != nil {
			t.Fatalf("create %s: %v", username, err)
		}
	}

	for run := 0; run < 2; run++ {
		if err := seedDevFriendshipsWithDB(context.Background(), gdb, usernames); err != nil {
			t.Fatalf("seed run %d: %v", run, err)
		}
	}

	var follows []db.Follow
	if err := gdb.Order("follower_id, following_id").Find(&follows).Error; err != nil {
		t.Fatalf("list follows: %v", err)
	}
	if len(follows) != 6 {
		t.Fatalf("follow edge count = %d, want 6", len(follows))
	}
}
