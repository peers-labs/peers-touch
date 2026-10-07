package infrastructure

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAutoMigratePurgesLegacyInvitePlaintext(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-legacy-invite?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	if err := db.Exec(`
		CREATE TABLE relay_invite (
			id INTEGER PRIMARY KEY,
			token TEXT,
			station_peer_id TEXT,
			status INTEGER
		)
	`).Error; err != nil {
		t.Fatalf("create legacy invite table: %v", err)
	}
	if err := db.Exec(
		"CREATE UNIQUE INDEX idx_relay_invite_token ON relay_invite(token)",
	).Error; err != nil {
		t.Fatalf("create legacy invite index: %v", err)
	}
	if err := db.Exec(
		"CREATE INDEX idx_relay_invite_station_peer_id ON relay_invite(station_peer_id)",
	).Error; err != nil {
		t.Fatalf("create legacy invite identity index: %v", err)
	}
	if err := db.Exec(
		"INSERT INTO relay_invite (id, token, station_peer_id, status) VALUES (?, ?, ?, ?)",
		1,
		"legacy-plaintext-secret",
		"legacy-station",
		domain.InviteStatusActive,
	).Error; err != nil {
		t.Fatalf("insert legacy invite: %v", err)
	}

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	if db.Migrator().HasColumn(&invitePO{}, "token") {
		t.Fatal("legacy plaintext token column still exists")
	}
	if db.Migrator().HasColumn(&invitePO{}, "station_peer_id") {
		t.Fatal("legacy invite Station identity column still exists")
	}
	var count int64
	if err := db.Model(&invitePO{}).Count(&count).Error; err != nil {
		t.Fatalf("count migrated invites: %v", err)
	}
	if count != 0 {
		t.Fatalf("legacy invites survived hard-cut migration: %d", count)
	}
	var schema string
	if err := db.Raw(
		"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'relay_invite'",
	).Scan(&schema).Error; err != nil {
		t.Fatalf("read Relay invite schema: %v", err)
	}
	if strings.Contains(strings.ToLower(schema), "token") {
		t.Fatalf("Relay invite schema still contains token column: %s", schema)
	}
}

func TestConsumeInviteAndActivateMountIsAtomic(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-atomic-enrollment?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	invite := &domain.Invite{
		SecretDigest: "digest",
		Status:       domain.InviteStatusActive,
		ExpiresAt:    time.Now().UTC().Add(time.Hour),
	}
	if err := repo.CreateInvite(context.Background(), invite); err != nil {
		t.Fatalf("create invite: %v", err)
	}
	mount := &domain.Mount{
		StationPeerID: "station-peer",
		HostPublicKey: []byte{1, 2, 3},
		CredentialJTI: "jti-1",
	}
	activated, err := repo.ConsumeInviteAndActivateMount(
		context.Background(),
		invite.ID,
		mount,
		1,
	)
	if err != nil {
		t.Fatalf("activate mount: %v", err)
	}
	if activated.Generation != 1 ||
		activated.Status != domain.MountStatusOffline {
		t.Fatalf("unexpected activated mount: %+v", activated)
	}
	if _, err := repo.ConsumeInviteAndActivateMount(
		context.Background(),
		invite.ID,
		mount,
		1,
	); err == nil {
		t.Fatal("consumed invite won a second enrollment")
	}
}
