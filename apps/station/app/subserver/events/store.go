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
	ActorID   string    `gorm:"column:actor_id;size:255;uniqueIndex:idx_realtime_actor_event,priority:1;index"`
	EventID   string    `gorm:"column:event_id;size:64;uniqueIndex:idx_realtime_actor_event,priority:2;index"`
	KindBytes []byte    `gorm:"column:kind_bytes;type:bytea"`
	CreatedAt time.Time `gorm:"column:created_at;index"`
}

func (realtimeEventModel) TableName() string { return "realtime_events" }

type durableEventStore interface {
	Persist(actorID string, ev *realtime.StreamEvent) error
	ReplayAfter(actorID, cursor string, limit int) ([]*realtime.StreamEvent, error)
	NewestEventID(actorID string) (string, bool, error)
}

type gormEventStore struct {
	db *gorm.DB
}

func newGormEventStore(db *gorm.DB) *gormEventStore {
	return &gormEventStore{db: db}
}

func (s *gormEventStore) AutoMigrate() error {
	return s.db.AutoMigrate(&realtimeEventModel{})
}

func (s *gormEventStore) Persist(actorID string, ev *realtime.StreamEvent) error {
	if actorID == "" {
		return fmt.Errorf("events: empty actorID")
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
		ActorID:   actorID,
		EventID:   ev.GetEventId(),
		KindBytes: payload,
		CreatedAt: now,
	}
	if err := s.db.Create(&item).Error; err != nil {
		return fmt.Errorf("persist realtime event: %w", err)
	}
	return nil
}

func (s *gormEventStore) ReplayAfter(actorID, cursor string, limit int) ([]*realtime.StreamEvent, error) {
	if actorID == "" || cursor == "" {
		return nil, nil
	}
	var rows []realtimeEventModel
	query := s.db.
		Where("actor_id = ? AND event_id > ?", actorID, cursor).
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

func (s *gormEventStore) NewestEventID(actorID string) (string, bool, error) {
	var row realtimeEventModel
	err := s.db.
		Where("actor_id = ?", actorID).
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
