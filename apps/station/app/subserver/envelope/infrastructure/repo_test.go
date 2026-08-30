package infrastructure

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAutoMigrateRenamesRecipientIdentityColumn(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:envelope_identity_migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE envelope_inbox (
			id INTEGER PRIMARY KEY,
			inbox_item_id TEXT,
			recipient_did TEXT,
			recipient_device_id TEXT,
			idempotency_key TEXT,
			envelope_bytes BLOB,
			status INTEGER,
			delivery_attempts INTEGER,
			first_queued_at DATETIME
		)`,
		`INSERT INTO envelope_inbox (
			id, inbox_item_id, recipient_did, recipient_device_id, idempotency_key,
			envelope_bytes, status, delivery_attempts, first_queued_at
		) VALUES (
			1, 'inbox-1', 'ptid:alice', 'device-1', 'key-1',
			X'0A00', 1, 0, CURRENT_TIMESTAMP
		)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration setup: %v", err)
		}
	}

	repo := NewPostgresRepository(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate envelope identity: %v", err)
	}

	if db.Migrator().HasColumn("envelope_inbox", "recipient_did") ||
		!db.Migrator().HasColumn("envelope_inbox", "recipient_ptid") {
		t.Fatal("envelope recipient identity column was not hard-cut")
	}

}
