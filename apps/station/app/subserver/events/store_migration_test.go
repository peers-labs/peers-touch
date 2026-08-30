package events

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRenamePTIDColumnIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	const table = "realtime_events"
	if err := db.Exec("CREATE TABLE " + table + " (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL)").Error; err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if err := db.Exec("INSERT INTO "+table+" (id, actor_id) VALUES (?, ?)", 1, "ptid-event").Error; err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	for run := 1; run <= 2; run++ {
		if err := renamePTIDColumn(db, table, "actor_id", "actor_ptid"); err != nil {
			t.Fatalf("migration run %d: %v", run, err)
		}
	}
	if db.Migrator().HasColumn(table, "actor_id") || !db.Migrator().HasColumn(table, "actor_ptid") {
		t.Fatalf("realtime event PTID columns not cut over")
	}
	var actorPTID string
	if err := db.Table(table).Select("actor_ptid").Where("id = ?", 1).Scan(&actorPTID).Error; err != nil {
		t.Fatalf("read migrated row: %v", err)
	}
	if actorPTID != "ptid-event" {
		t.Fatalf("migrated PTID = %q, want ptid-event", actorPTID)
	}
}
