package events

import (
	"fmt"
	"time"

	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// realtimeEventModel is the durable event log for the canonical realtime plane.
// The in-memory ring buffer remains a hot cache; this table is the recovery
// source after process restart, ring eviction, and disconnected clients.
type realtimeEventModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorPTID string    `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_realtime_actor_ptid_event,priority:1;index"`
	EventID   string    `gorm:"column:event_id;size:64;uniqueIndex:idx_realtime_actor_ptid_event,priority:2;index"`
	KindBytes []byte    `gorm:"column:kind_bytes;type:bytea"`
	CreatedAt time.Time `gorm:"column:created_at;index"`
}

func (realtimeEventModel) TableName() string { return "realtime_events" }

type durableEventStore interface {
	Persist(actorPTID string, ev *realtime.StreamEvent) error
	ReplayAfter(actorPTID, cursor string, limit int) ([]*realtime.StreamEvent, error)
	NewestEventID(actorPTID string) (string, bool, error)
}

type gormEventStore struct {
	db *gorm.DB
}

func newGormEventStore(db *gorm.DB) *gormEventStore {
	return &gormEventStore{db: db}
}

func (s *gormEventStore) AutoMigrate() error {
	if err := renamePTIDColumn(s.db, realtimeEventModel{}.TableName(), "actor_id", "actor_ptid"); err != nil {
		return fmt.Errorf("migrate realtime event actor PTID column: %w", err)
	}
	return s.db.AutoMigrate(&realtimeEventModel{})
}

func (s *gormEventStore) Persist(actorPTID string, ev *realtime.StreamEvent) error {
	if actorPTID == "" {
		return fmt.Errorf("events: empty actorPTID")
	}
	if ev == nil || ev.GetEventId() == "" {
		return fmt.Errorf("events: event must be stamped before persist")
	}
	payload, err := proto.Marshal(ev)
	if err != nil {
		return fmt.Errorf("marshal realtime event: %w", err)
	}
	now := time.UnixMilli(ev.GetTsUnixMs()).UTC()
	if ev.GetTsUnixMs() == 0 {
		now = time.Now().UTC()
	}
	item := realtimeEventModel{
		ActorPTID: actorPTID,
		EventID:   ev.GetEventId(),
		KindBytes: payload,
		CreatedAt: now,
	}
	if err := s.db.Create(&item).Error; err != nil {
		return fmt.Errorf("persist realtime event: %w", err)
	}
	return nil
}

func (s *gormEventStore) ReplayAfter(actorPTID, cursor string, limit int) ([]*realtime.StreamEvent, error) {
	if actorPTID == "" || cursor == "" {
		return nil, nil
	}
	var rows []realtimeEventModel
	query := s.db.
		Where("actor_ptid = ? AND event_id > ?", actorPTID, cursor).
		Order("event_id ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("replay realtime events: %w", err)
	}
	events := make([]*realtime.StreamEvent, 0, len(rows))
	for _, row := range rows {
		ev := &realtime.StreamEvent{}
		if err := proto.Unmarshal(row.KindBytes, ev); err != nil {
			return nil, fmt.Errorf("unmarshal realtime event %s: %w", row.EventID, err)
		}
		events = append(events, ev)
	}
	return events, nil
}

func (s *gormEventStore) NewestEventID(actorPTID string) (string, bool, error) {
	var row realtimeEventModel
	err := s.db.
		Where("actor_ptid = ?", actorPTID).
		Order("event_id DESC").
		Limit(1).
		Find(&row).Error
	if err != nil {
		return "", false, fmt.Errorf("load newest realtime event: %w", err)
	}
	if row.EventID == "" {
		return "", false, nil
	}
	return row.EventID, true, nil
}

func renamePTIDColumn(db *gorm.DB, table, legacy, canonical string) error {
	if !db.Migrator().HasTable(table) || !db.Migrator().HasColumn(table, legacy) {
		return nil
	}
	if db.Migrator().HasColumn(table, canonical) {
		return fmt.Errorf("%s contains both %s and %s", table, legacy, canonical)
	}
	return db.Migrator().RenameColumn(table, legacy, canonical)
}
