package infrastructure

import (
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateSchemaCreatesAllFederationTables(t *testing.T) {
	db := openMigrationTestDB(t)

	for run := 0; run < 2; run++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatalf("migrate federation schema run %d: %v", run, err)
		}
	}

	for _, model := range []any{
		&federationModel{},
		&ledgerEventModel{},
		&membershipModel{},
		&actorRoleModel{},
		&actorSigningKeyModel{},
		&syncCursorModel{},
	} {
		if !db.Migrator().HasTable(model) {
			t.Fatalf("migration did not create table for %T", model)
		}
	}

	for _, column := range []struct {
		model any
		name  string
	}{
		{model: &federationModel{}, name: "created_by_actor_ptid"},
		{model: &ledgerEventModel{}, name: "actor_ptid"},
		{model: &actorRoleModel{}, name: "actor_ptid"},
		{model: &actorSigningKeyModel{}, name: "actor_ptid"},
	} {
		if !db.Migrator().HasColumn(column.model, column.name) {
			t.Fatalf("migration did not create %T.%s", column.model, column.name)
		}
	}
}

func TestMigrateSchemaPreservesLegacyFederationCreatorIdentity(t *testing.T) {
	db := openMigrationTestDB(t)
	if err := db.Exec(`CREATE TABLE federation (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		federation_id VARCHAR(30) NOT NULL UNIQUE,
		name VARCHAR(255) NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		status VARCHAR(20) NOT NULL DEFAULT 'active',
		policy_type VARCHAR(30) NOT NULL DEFAULT 'single_admin',
		sequencer_station_peer_id VARCHAR(128) NOT NULL,
		genesis_hash BLOB NOT NULL,
		head_hash BLOB NOT NULL,
		head_seq INTEGER NOT NULL DEFAULT 0,
		created_by_actor_id VARCHAR(255) NOT NULL,
		created_by_station_peer_id VARCHAR(128) NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`).Error; err != nil {
		t.Fatalf("create legacy federation table: %v", err)
	}
	if err := db.Exec(`INSERT INTO federation (
		federation_id,
		name,
		sequencer_station_peer_id,
		genesis_hash,
		head_hash,
		created_by_actor_id,
		created_by_station_peer_id
	) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"fed_legacy",
		"Legacy Federation",
		"station-peer",
		[]byte("genesis"),
		[]byte("head"),
		"ptid:legacy-creator",
		"station-peer",
	).Error; err != nil {
		t.Fatalf("insert legacy federation: %v", err)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migrate legacy federation schema: %v", err)
	}

	var creatorPTID string
	if err := db.Table("federation").
		Select("created_by_actor_ptid").
		Where("federation_id = ?", "fed_legacy").
		Scan(&creatorPTID).Error; err != nil {
		t.Fatalf("read migrated creator PTID: %v", err)
	}
	if creatorPTID != "ptid:legacy-creator" {
		t.Fatalf("migrated creator PTID = %q, want ptid:legacy-creator", creatorPTID)
	}
	if db.Migrator().HasColumn("federation", "created_by_actor_id") {
		t.Fatal("legacy created_by_actor_id column remains after migration")
	}
}

func openMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open migration test database: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get migration test database: %v", err)
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close migration test database: %v", err)
		}
	})

	return db
}
