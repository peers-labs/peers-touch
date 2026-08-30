package service

import (
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigratePreservesAppletIdentityData(t *testing.T) {
	rds := openAppletMigrationDB(t, "applet_identity_preservation")
	execAppletMigrationSQL(t, rds,
		`CREATE TABLE applet_install_states (
			id TEXT PRIMARY KEY,
			actor_id VARCHAR(255) NOT NULL,
			device_id TEXT,
			applet_id TEXT NOT NULL,
			version TEXT NOT NULL
		)`,
		`CREATE TABLE applet_audit_records (
			id TEXT PRIMARY KEY,
			audit_id TEXT NOT NULL UNIQUE,
			actor_id VARCHAR(255),
			device_id TEXT
		)`,
		`INSERT INTO applet_install_states
			(id, actor_id, device_id, applet_id, version)
		 VALUES ('install-1', 'ptid:alice', 'device-1', 'applet-1', '1.0.0')`,
		`INSERT INTO applet_audit_records
			(id, audit_id, actor_id, device_id)
		 VALUES ('audit-row-1', 'audit-1', 'ptid:alice', 'device-1')`,
	)

	if err := migrateAppletStoreIdentityColumns(rds); err != nil {
		t.Fatalf("migrate applet store: %v", err)
	}

	assertAppletIdentity(t, rds, "applet_install_states", "install-1", "ptid:alice")
	assertAppletIdentity(t, rds, "applet_audit_records", "audit-row-1", "ptid:alice")
	if rds.Migrator().HasColumn("applet_install_states", "actor_id") ||
		rds.Migrator().HasColumn("applet_audit_records", "actor_id") {
		t.Fatal("legacy applet identity columns remain after migration")
	}
}

func TestMigrateRollsBackAppletIdentitySetOnConflict(t *testing.T) {
	rds := openAppletMigrationDB(t, "applet_identity_rollback")
	execAppletMigrationSQL(t, rds,
		`CREATE TABLE applet_install_states (
			id TEXT PRIMARY KEY,
			actor_id TEXT NOT NULL
		)`,
		`CREATE TABLE applet_audit_records (
			id TEXT PRIMARY KEY,
			actor_id TEXT,
			actor_ptid TEXT
		)`,
		`INSERT INTO applet_install_states (id, actor_id)
		 VALUES ('install-1', 'ptid:alice')`,
		`INSERT INTO applet_audit_records (id, actor_id, actor_ptid)
		 VALUES ('audit-row-1', 'ptid:alice', 'ptid:mallory')`,
	)

	err := migrateAppletStoreIdentityColumns(rds)
	if err == nil || !strings.Contains(err.Error(), "divergent") {
		t.Fatalf("expected divergent identity error, got %v", err)
	}
	if !rds.Migrator().HasColumn("applet_install_states", "actor_id") ||
		rds.Migrator().HasColumn("applet_install_states", "actor_ptid") {
		t.Fatal("applet install identity migration was not rolled back with the module set")
	}
	var row struct {
		ActorID string `gorm:"column:actor_id"`
	}
	if err := rds.Table("applet_install_states").
		Select("actor_id").
		Where("id = ?", "install-1").
		Take(&row).Error; err != nil {
		t.Fatalf("read rolled-back applet identity: %v", err)
	}
	if row.ActorID != "ptid:alice" {
		t.Fatalf("actor_id = %q, want ptid:alice", row.ActorID)
	}
}

func openAppletMigrationDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	rds, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return rds
}

func execAppletMigrationSQL(t *testing.T, rds *gorm.DB, statements ...string) {
	t.Helper()
	for _, statement := range statements {
		if err := rds.Exec(statement).Error; err != nil {
			t.Fatalf("execute migration fixture: %v", err)
		}
	}
}

func assertAppletIdentity(t *testing.T, rds *gorm.DB, table, id, expected string) {
	t.Helper()
	var row struct {
		ActorPTID string `gorm:"column:actor_ptid"`
	}
	if err := rds.Table(table).
		Select("actor_ptid").
		Where("id = ?", id).
		Take(&row).Error; err != nil {
		t.Fatalf("read %s.actor_ptid: %v", table, err)
	}
	if row.ActorPTID != expected {
		t.Fatalf("%s.actor_ptid = %q, want %q", table, row.ActorPTID, expected)
	}
}
