package infrastructure

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateDashboardPTIDColumnIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	table := domain.DashboardAdmin{}.TableName()
	if err := db.Exec("CREATE TABLE " + table + " (id INTEGER PRIMARY KEY, did TEXT NOT NULL)").Error; err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if err := db.Exec("INSERT INTO "+table+" (id, did) VALUES (?, ?)", 7, "ptid-admin").Error; err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	for run := 1; run <= 2; run++ {
		if err := MigrateDashboardPTIDColumn(db); err != nil {
			t.Fatalf("migration run %d: %v", run, err)
		}
	}
	if db.Migrator().HasColumn(table, "did") || !db.Migrator().HasColumn(table, "ptid") {
		t.Fatalf("dashboard PTID columns not cut over")
	}
	var ptid string
	if err := db.Table(table).Select("ptid").Where("id = ?", 7).Scan(&ptid).Error; err != nil {
		t.Fatalf("read migrated row: %v", err)
	}
	if ptid != "ptid-admin" {
		t.Fatalf("migrated PTID = %q, want ptid-admin", ptid)
	}
}
