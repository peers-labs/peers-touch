package actor

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBackfillPresetAvatar(t *testing.T) {
	rds, err := gorm.Open(sqlite.Open("file:preset-avatar?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := rds.AutoMigrate(&db.Actor{}); err != nil {
		t.Fatalf("migrate actor: %v", err)
	}

	empty := db.Actor{
		ID:                1,
		PTID:              "alice",
		PreferredUsername: "alice",
		Email:             "alice@p.t",
		PasswordHash:      "hash",
		FederatedHandle:   "@alice@station.local",
	}
	custom := db.Actor{
		ID:                2,
		PTID:              "bob",
		PreferredUsername: "bob",
		Email:             "bob@p.t",
		PasswordHash:      "hash",
		FederatedHandle:   "@bob@station.local",
		Icon:              "https://example.test/custom-bob.png",
	}
	if err := rds.Create(&empty).Error; err != nil {
		t.Fatalf("create actor without avatar: %v", err)
	}
	if err := rds.Create(&custom).Error; err != nil {
		t.Fatalf("create actor with custom avatar: %v", err)
	}

	const presetAvatar = "https://example.test/preset.png"
	if err := backfillPresetAvatar(rds, &empty, presetAvatar); err != nil {
		t.Fatalf("backfill empty avatar: %v", err)
	}
	if err := backfillPresetAvatar(rds, &custom, presetAvatar); err != nil {
		t.Fatalf("preserve custom avatar: %v", err)
	}

	var actors []db.Actor
	if err := rds.Order("id").Find(&actors).Error; err != nil {
		t.Fatalf("read actors: %v", err)
	}
	if got := actors[0].Icon; got != presetAvatar {
		t.Fatalf("backfilled avatar = %q, want %q", got, presetAvatar)
	}
	if got := actors[1].Icon; got != custom.Icon {
		t.Fatalf("custom avatar = %q, want %q", got, custom.Icon)
	}
}
