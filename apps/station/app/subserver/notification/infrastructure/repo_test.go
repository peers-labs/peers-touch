package infrastructure

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNotificationRepositoryUsesRecipientPTIDColumns(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate notification schema: %v", err)
	}

	created, err := repo.Create(domain.Notification{
		RecipientPTID: "ptid:recipient",
		ActorPTID:     "ptid:actor",
		Type:          domain.TypeFriendRequest,
		Category:      domain.CategorySocial,
	})
	if err != nil {
		t.Fatalf("create notification: %v", err)
	}
	if created.RecipientPTID != "ptid:recipient" {
		t.Fatalf("created recipient PTID = %q", created.RecipientPTID)
	}

	items, err := repo.List("ptid:recipient", domain.CategorySocial, domain.StatusUnread, "", 10)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	if len(items) != 1 || items[0].RecipientPTID != "ptid:recipient" {
		t.Fatalf("listed notifications = %#v", items)
	}

	if db.Migrator().HasColumn("notifications", "recipient_id") ||
		db.Migrator().HasColumn("notification_unread_counts", "recipient_id") {
		t.Fatal("fresh notification schema contains a legacy recipient_id column")
	}
}

func TestMigrateNotificationPTIDColumnsIsAtomicAndIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	statements := []string{
		"CREATE TABLE notifications (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, recipient_id TEXT NOT NULL)",
		"CREATE TABLE notification_preferences (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL)",
		"CREATE TABLE notification_unread_counts (id INTEGER PRIMARY KEY, recipient_id TEXT NOT NULL)",
		"INSERT INTO notifications (id, actor_id, recipient_id) VALUES (1, 'ptid:actor', 'ptid:recipient')",
		"INSERT INTO notification_preferences (id, actor_id) VALUES (1, 'ptid:actor')",
		"INSERT INTO notification_unread_counts (id, recipient_id) VALUES (1, 'ptid:recipient')",
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare legacy notification schema: %v", err)
		}
	}

	for run := 1; run <= 2; run++ {
		if err := migrateNotificationPTIDColumns(db); err != nil {
			t.Fatalf("migrate notification PTID columns run %d: %v", run, err)
		}
	}

	for _, migration := range notificationPTIDColumnMigrations {
		if db.Migrator().HasColumn(migration.table, migration.legacy) {
			t.Fatalf("%s.%s still exists", migration.table, migration.legacy)
		}
		if !db.Migrator().HasColumn(migration.table, migration.canonical) {
			t.Fatalf("%s.%s is missing", migration.table, migration.canonical)
		}
		var ptid string
		if err := db.Table(migration.table).Select(migration.canonical).Where("id = ?", 1).Scan(&ptid).Error; err != nil {
			t.Fatalf("read migrated %s.%s: %v", migration.table, migration.canonical, err)
		}
		if ptid == "" {
			t.Fatalf("%s.%s lost its PTID value", migration.table, migration.canonical)
		}
	}
}

func TestMigrateNotificationPTIDColumnsRejectsDualColumnsWithoutPartialRename(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	statements := []string{
		"CREATE TABLE notifications (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, recipient_id TEXT NOT NULL, recipient_ptid TEXT NOT NULL)",
		"CREATE TABLE notification_preferences (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL)",
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare conflicting notification schema: %v", err)
		}
	}

	if err := migrateNotificationPTIDColumns(db); err == nil {
		t.Fatal("expected conflicting recipient columns to fail")
	}
	if !db.Migrator().HasColumn("notification_preferences", "actor_id") ||
		db.Migrator().HasColumn("notification_preferences", "actor_ptid") {
		t.Fatal("migration committed a partial rename before conflict detection")
	}
}
