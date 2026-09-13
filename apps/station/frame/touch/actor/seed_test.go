package actor

import (
	"context"
	"testing"

	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
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

	const presetAvatar = "data:image/svg+xml;base64,PHN2Zz4="
	const legacyInlineAvatar = "data:image/svg+xml;base64,bGVnYWN5"
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
	legacy := db.Actor{
		ID:                3,
		PTID:              "carol",
		PreferredUsername: "carol",
		Email:             "carol@p.t",
		PasswordHash:      "hash",
		FederatedHandle:   "@carol@station.local",
		Icon:              legacyGeneratedPresetAvatarPrefix + "prompt=carol",
	}
	legacyInline := db.Actor{
		ID:                4,
		PTID:              "alice-inline",
		PreferredUsername: "dave",
		Email:             "alice-inline@p.t",
		PasswordHash:      "hash",
		FederatedHandle:   "@alice-inline@station.local",
		Icon:              legacyInlineAvatar,
	}
	customInline := db.Actor{
		ID:                5,
		PTID:              "bob-inline",
		PreferredUsername: "erin",
		Email:             "bob-inline@p.t",
		PasswordHash:      "hash",
		FederatedHandle:   "@bob-inline@station.local",
		Icon:              "data:image/svg+xml;base64,Y3VzdG9t",
	}
	remoteCached := db.Actor{
		ID:                6,
		PTID:              "remote-bob",
		PreferredUsername: "@bob@remote.example",
		Email:             "remote-bob@cache.invalid",
		PasswordHash:      "unusable",
		FederatedHandle:   "@bob@remote.example",
		Icon:              legacyGeneratedPresetAvatarPrefix + "prompt=remote-bob",
		Origin:            OriginRemoteCached,
	}
	if err := rds.Create(&empty).Error; err != nil {
		t.Fatalf("create actor without avatar: %v", err)
	}
	if err := rds.Create(&custom).Error; err != nil {
		t.Fatalf("create actor with custom avatar: %v", err)
	}
	if err := rds.Create(&legacy).Error; err != nil {
		t.Fatalf("create actor with legacy preset avatar: %v", err)
	}
	if err := rds.Create(&legacyInline).Error; err != nil {
		t.Fatalf("create actor with legacy inline avatar: %v", err)
	}
	if err := rds.Create(&customInline).Error; err != nil {
		t.Fatalf("create actor with custom inline avatar: %v", err)
	}
	if err := rds.Create(&remoteCached).Error; err != nil {
		t.Fatalf("create remote cached actor: %v", err)
	}

	legacyAvatars := []string{legacyInlineAvatar}
	if err := backfillPresetAvatar(rds, &empty, presetAvatar, legacyAvatars); err != nil {
		t.Fatalf("backfill empty avatar: %v", err)
	}
	if err := backfillPresetAvatar(rds, &custom, presetAvatar, legacyAvatars); err != nil {
		t.Fatalf("preserve custom avatar: %v", err)
	}
	if err := backfillPresetAvatar(rds, &legacy, presetAvatar, legacyAvatars); err != nil {
		t.Fatalf("migrate legacy preset avatar: %v", err)
	}
	if err := backfillPresetAvatar(rds, &legacyInline, presetAvatar, legacyAvatars); err != nil {
		t.Fatalf("migrate legacy inline avatar: %v", err)
	}
	if err := backfillPresetAvatar(rds, &customInline, presetAvatar, legacyAvatars); err != nil {
		t.Fatalf("preserve custom inline avatar: %v", err)
	}
	if err := backfillPresetAvatar(rds, &remoteCached, presetAvatar, legacyAvatars); err != nil {
		t.Fatalf("preserve remote cached avatar: %v", err)
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
	if got := actors[2].Icon; got != presetAvatar {
		t.Fatalf("migrated avatar = %q, want %q", got, presetAvatar)
	}
	if got := actors[3].Icon; got != presetAvatar {
		t.Fatalf("migrated inline avatar = %q, want %q", got, presetAvatar)
	}
	if got := actors[4].Icon; got != customInline.Icon {
		t.Fatalf("custom inline avatar = %q, want %q", got, customInline.Icon)
	}
	if got := actors[5].Icon; got != remoteCached.Icon {
		t.Fatalf("remote cached avatar = %q, want %q", got, remoteCached.Icon)
	}
}

func TestEnsurePresetActorIdentityMigratesLegacyPTID(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open("file:preset_actor_identity?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&db.Actor{}, &identity.Identity{}, &identity.Key{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const canonicalPTID = "ptid:v1:actor:peers:p:alice:fingerprint"
	actorRecord := db.Actor{
		ID:                347760575104679938,
		PreferredUsername: "alice",
		Email:             "alice@p.t",
		PTID:              "alice",
	}
	if err := gdb.Create(&actorRecord).Error; err != nil {
		t.Fatalf("create actor: %v", err)
	}
	if err := gdb.Create(&identity.Identity{
		PTID:        canonicalPTID,
		Username:    "alice",
		Namespace:   presetActorNamespace,
		Type:        string(identity.TypePerson),
		Fingerprint: "fingerprint",
		Version:     "v1",
		Status:      "active",
	}).Error; err != nil {
		t.Fatalf("create identity: %v", err)
	}

	if err := ensurePresetActorIdentity(context.Background(), gdb, &actorRecord); err != nil {
		t.Fatalf("ensure identity: %v", err)
	}

	var stored db.Actor
	if err := gdb.First(&stored, actorRecord.ID).Error; err != nil {
		t.Fatalf("reload actor: %v", err)
	}
	if stored.PTID != canonicalPTID {
		t.Fatalf("ptid = %q, want %q", stored.PTID, canonicalPTID)
	}
}
