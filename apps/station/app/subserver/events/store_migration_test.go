package events

import (
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
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

func TestEventStoreMigrationBackfillsPerActorSequence(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:event-sequence-migration?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&legacyRealtimeEventModel{}); err != nil {
		t.Fatal(err)
	}
	for index, eventID := range []string{"legacy-one", "legacy-two"} {
		event := msg(eventID)
		event.EventId = eventID
		payload, err := proto.Marshal(event)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&legacyRealtimeEventModel{
			ID:        uint64(index + 1),
			ActorID:   "alice",
			EventID:   eventID,
			KindBytes: payload,
			CreatedAt: time.Unix(int64(index+1), 0).UTC(),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	store := newGormEventStore(db)
	for run := 1; run <= 2; run++ {
		if err := store.AutoMigrate(); err != nil {
			t.Fatalf("migration run %d: %v", run, err)
		}
	}
	replayed, err := store.ReplayRange("alice", 0, 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed) != 2 ||
		replayed[0].Sequence != 1 ||
		replayed[1].Sequence != 2 ||
		replayed[0].Event.GetEventId() != "legacy-one" ||
		replayed[1].Event.GetEventId() != "legacy-two" {
		t.Fatalf("migrated events = %+v", replayed)
	}
	head, ok, err := store.Head("alice")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || head.Sequence != 2 || head.EventID != "legacy-two" {
		t.Fatalf("migrated head = %+v ok=%v", head, ok)
	}
}

type legacyRealtimeEventModel struct {
	ID        uint64    `gorm:"column:id;primaryKey"`
	ActorID   string    `gorm:"column:actor_id;size:255;uniqueIndex:idx_realtime_actor_ptid_event,priority:1;index"`
	EventID   string    `gorm:"column:event_id;size:64;uniqueIndex:idx_realtime_actor_ptid_event,priority:2;index"`
	KindBytes []byte    `gorm:"column:kind_bytes;type:bytea"`
	CreatedAt time.Time `gorm:"column:created_at;index"`
}

func (legacyRealtimeEventModel) TableName() string {
	return "realtime_events"
}
