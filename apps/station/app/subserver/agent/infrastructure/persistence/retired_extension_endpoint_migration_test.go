package persistence

import (
	"strings"
	"testing"
	"time"
)

func TestRetiredExtensionEndpointMigrationAuditsThenPurges(t *testing.T) {
	db := openEvaluationTestDB(t, "retired-extension-endpoint")
	if err := db.AutoMigrate(&retiredExtensionEndpointRow{}); err != nil {
		t.Fatalf("create retired extension table: %v", err)
	}
	now := time.Date(2026, 9, 18, 18, 0, 0, 0, time.UTC)
	rows := []retiredExtensionEndpointRow{
		{
			ID:             "extension-a",
			Name:           "Private endpoint",
			Endpoint:       "https://secret.example/api",
			Method:         "POST",
			AuthType:       "bearer",
			Enabled:        true,
			OwnerActorPTID: "ptid:person:owner-a",
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		{
			ID:             "extension-b",
			Name:           "Second endpoint",
			Endpoint:       "https://second.example/api",
			Method:         "GET",
			AuthType:       "none",
			Enabled:        false,
			OwnerActorPTID: "ptid:person:owner-b",
			CreatedAt:      now,
			UpdatedAt:      now,
		},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed retired extension rows: %v", err)
	}

	audits, err := ReadRetiredExtensionEndpointAudits(db)
	if err != nil {
		t.Fatalf("read retired extension audit: %v", err)
	}
	if len(audits) != 2 {
		t.Fatalf("audit count = %d, want 2", len(audits))
	}
	for _, audit := range audits {
		if len(audit.ActorScopeHash) != 64 || len(audit.MetadataHash) != 64 {
			t.Fatalf("invalid audit hashes: %+v", audit)
		}
		encoded := audit.ActorScopeHash + audit.MetadataHash
		for _, secret := range []string{"owner-a", "owner-b", "secret.example"} {
			if strings.Contains(encoded, secret) {
				t.Fatalf("audit leaked source metadata %q", secret)
			}
		}
	}

	if err := PurgeRetiredExtensionEndpointTable(db); err != nil {
		t.Fatalf("purge retired extension table: %v", err)
	}
	if db.Migrator().HasTable(retiredExtensionEndpointTable) {
		t.Fatal("retired extension table still exists")
	}
	if err := PurgeRetiredExtensionEndpointTable(db); err != nil {
		t.Fatalf("repeat retired extension purge: %v", err)
	}
}

func TestRetiredExtensionEndpointMigrationRejectsUnscopedRows(t *testing.T) {
	db := openEvaluationTestDB(t, "retired-extension-endpoint-unscoped")
	if err := db.AutoMigrate(&retiredExtensionEndpointRow{}); err != nil {
		t.Fatalf("create retired extension table: %v", err)
	}
	if err := db.Create(&retiredExtensionEndpointRow{
		ID:       "extension-unscoped",
		Name:     "Unscoped",
		Endpoint: "https://example.invalid",
	}).Error; err != nil {
		t.Fatalf("seed unscoped retired extension row: %v", err)
	}

	if _, err := ReadRetiredExtensionEndpointAudits(db); err == nil {
		t.Fatal("unscoped retired extension row was accepted")
	}
	if !db.Migrator().HasTable(retiredExtensionEndpointTable) {
		t.Fatal("retired extension table was dropped after failed audit")
	}
}
