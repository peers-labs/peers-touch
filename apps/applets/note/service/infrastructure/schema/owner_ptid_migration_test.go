package schema

import (
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateOwnerPTIDColumn(t *testing.T) {
	t.Run("renames legacy column and preserves data", func(t *testing.T) {
		db := openMigrationDB(t, "note_owner_legacy")
		mustExec(t, db, `CREATE TABLE official_applet_notes (note_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL)`)
		mustExec(t, db, `INSERT INTO official_applet_notes (note_id, owner_id) VALUES ('note-1', 'ptid:alice')`)

		if err := MigrateOwnerPTIDColumn(db); err != nil {
			t.Fatal(err)
		}
		if err := MigrateOwnerPTIDColumn(db); err != nil {
			t.Fatalf("idempotent migration: %v", err)
		}

		if db.Migrator().HasColumn(noteTable, legacyOwnerColumn) {
			t.Fatal("legacy owner_id column still exists")
		}
		if !db.Migrator().HasColumn(noteTable, canonicalOwnerColumn) {
			t.Fatal("canonical owner_ptid column is missing")
		}

		var ownerPtid string
		if err := db.Table(noteTable).
			Select(canonicalOwnerColumn).
			Where("note_id = ?", "note-1").
			Scan(&ownerPtid).Error; err != nil {
			t.Fatal(err)
		}
		if ownerPtid != "ptid:alice" {
			t.Fatalf("owner_ptid = %q, want %q", ownerPtid, "ptid:alice")
		}
	})

	t.Run("rejects dual columns without mutating data", func(t *testing.T) {
		db := openMigrationDB(t, "note_owner_conflict")
		mustExec(t, db, `CREATE TABLE official_applet_notes (note_id TEXT PRIMARY KEY, owner_id TEXT, owner_ptid TEXT)`)
		mustExec(t, db, `INSERT INTO official_applet_notes (note_id, owner_id, owner_ptid) VALUES ('note-1', 'ptid:alice', 'ptid:bob')`)

		err := MigrateOwnerPTIDColumn(db)
		if err == nil || !strings.Contains(err.Error(), "both owner_id and owner_ptid exist") {
			t.Fatalf("expected dual-column conflict, got %v", err)
		}
		if !db.Migrator().HasColumn(noteTable, legacyOwnerColumn) ||
			!db.Migrator().HasColumn(noteTable, canonicalOwnerColumn) {
			t.Fatal("conflicting schema changed after failed migration")
		}

		var row struct {
			OwnerID   string `gorm:"column:owner_id"`
			OwnerPTID string `gorm:"column:owner_ptid"`
		}
		if err := db.Table(noteTable).
			Select("owner_id, owner_ptid").
			Where("note_id = ?", "note-1").
			Scan(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.OwnerID != "ptid:alice" || row.OwnerPTID != "ptid:bob" {
			t.Fatalf("conflicting row changed: %+v", row)
		}
	})

	t.Run("leaves canonical schema unchanged", func(t *testing.T) {
		db := openMigrationDB(t, "note_owner_canonical")
		mustExec(t, db, `CREATE TABLE official_applet_notes (note_id TEXT PRIMARY KEY, owner_ptid TEXT NOT NULL)`)
		mustExec(t, db, `INSERT INTO official_applet_notes (note_id, owner_ptid) VALUES ('note-1', 'ptid:alice')`)

		if err := MigrateOwnerPTIDColumn(db); err != nil {
			t.Fatal(err)
		}

		var ownerPtid string
		if err := db.Table(noteTable).
			Select(canonicalOwnerColumn).
			Where("note_id = ?", "note-1").
			Scan(&ownerPtid).Error; err != nil {
			t.Fatal(err)
		}
		if ownerPtid != "ptid:alice" {
			t.Fatalf("owner_ptid = %q, want %q", ownerPtid, "ptid:alice")
		}
	})
}

func openMigrationDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func mustExec(t *testing.T, db *gorm.DB, statement string) {
	t.Helper()
	if err := db.Exec(statement).Error; err != nil {
		t.Fatal(err)
	}
}
