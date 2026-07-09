package frontend_telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const rollupInsertBatchSize = 500

type rawEventModel struct {
	ID            uint       `gorm:"column:id;primaryKey"`
	ActorID       string     `gorm:"column:actor_id;size:255;uniqueIndex:idx_frontend_telemetry_actor_event,priority:1;index"`
	EventID       string     `gorm:"column:event_id;size:128;uniqueIndex:idx_frontend_telemetry_actor_event,priority:2;index"`
	SchemaVersion int        `gorm:"column:schema_version;not null"`
	TS            float64    `gorm:"column:ts;not null;index"`
	Kind          string     `gorm:"column:kind;size:128;not null;index"`
	Source        string     `gorm:"column:source;size:128;not null;index"`
	Module        string     `gorm:"column:module;size:255;not null;index"`
	Runtime       string     `gorm:"column:runtime;size:64;not null;index"`
	DeviceID      string     `gorm:"column:device_id;size:255;index"`
	SessionID     string     `gorm:"column:session_id;size:255;index"`
	Owner         string     `gorm:"column:owner;size:255;index"`
	PageID        string     `gorm:"column:page_id;size:255;index"`
	SectionID     string     `gorm:"column:section_id;size:255;index"`
	InteractionID string     `gorm:"column:interaction_id;size:255;index"`
	Phase         string     `gorm:"column:phase;size:64;index"`
	Severity      string     `gorm:"column:severity;size:32;index"`
	DurationMS    *float64   `gorm:"column:duration_ms"`
	TagsJSON      string     `gorm:"column:tags_json;type:text"`
	DataJSON      string     `gorm:"column:data_json;type:text"`
	CreatedAt     time.Time  `gorm:"column:created_at;not null;index"`
	ReceivedAt    time.Time  `gorm:"column:received_at;not null;index"`
	DeletedAt     *time.Time `gorm:"column:deleted_at;index"`
}

func (rawEventModel) TableName() string { return "frontend_telemetry_events" }

type rollupModel struct {
	ID              uint      `gorm:"column:id;primaryKey"`
	ActorID         string    `gorm:"column:actor_id;size:255;uniqueIndex:idx_frontend_telemetry_rollup,priority:1;index"`
	Runtime         string    `gorm:"column:runtime;size:64;uniqueIndex:idx_frontend_telemetry_rollup,priority:2;index"`
	Module          string    `gorm:"column:module;size:255;uniqueIndex:idx_frontend_telemetry_rollup,priority:3;index"`
	Kind            string    `gorm:"column:kind;size:128;uniqueIndex:idx_frontend_telemetry_rollup,priority:4;index"`
	WindowStart     time.Time `gorm:"column:window_start;not null;uniqueIndex:idx_frontend_telemetry_rollup,priority:5;index"`
	WindowMinutes   int       `gorm:"column:window_minutes;not null;uniqueIndex:idx_frontend_telemetry_rollup,priority:6"`
	Count           int       `gorm:"column:count;not null;default:0"`
	DurationCount   int       `gorm:"column:duration_count;not null;default:0"`
	P50DurationMS   *float64  `gorm:"column:p50_duration_ms"`
	P95DurationMS   *float64  `gorm:"column:p95_duration_ms"`
	MaxDurationMS   *float64  `gorm:"column:max_duration_ms"`
	LastObservedAt  time.Time `gorm:"column:last_observed_at;not null;index"`
	LastInteraction string    `gorm:"column:last_interaction_id;size:255;index"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null;index"`
}

func (rollupModel) TableName() string { return "frontend_telemetry_rollups" }

type rawEventStore struct {
	db *gorm.DB
}

func newRawEventStore(db *gorm.DB) *rawEventStore {
	return &rawEventStore{db: db}
}

func (s *rawEventStore) AutoMigrate() error {
	return s.db.AutoMigrate(&rawEventModel{}, &rollupModel{})
}

func (s *rawEventStore) PersistBatch(ctx context.Context, actorID, sessionID string, events []frontendTelemetryEvent) (ingestResult, error) {
	if actorID == "" {
		return ingestResult{}, fmt.Errorf("frontend telemetry: actorID is required")
	}
	if len(events) == 0 {
		return ingestResult{}, fmt.Errorf("events must not be empty")
	}

	now := time.Now().UTC()
	rows := make([]rawEventModel, 0, len(events))
	rejected := make([]string, 0)
	for _, event := range events {
		row, reason := event.toRawEventModel(actorID, sessionID, now)
		if reason != "" {
			rejected = append(rejected, reason)
			continue
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return ingestResult{Rejected: len(rejected), RejectedReasons: rejected}, fmt.Errorf("no valid telemetry events")
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
			return fmt.Errorf("persist frontend telemetry events: %w", err)
		}
		return s.rebuildRollups(ctx, tx, actorID)
	})
	if err != nil {
		return ingestResult{}, err
	}
	return ingestResult{Accepted: len(rows), Rejected: len(rejected), RejectedReasons: rejected}, nil
}

func (s *rawEventStore) Query(ctx context.Context, actorID string, req queryRequest) ([]rawEventModel, error) {
	if actorID == "" {
		return nil, fmt.Errorf("frontend telemetry: actorID is required")
	}
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := s.db.WithContext(ctx).Where("actor_id = ?", actorID)
	if req.InteractionID != "" {
		query = query.Where("interaction_id = ?", req.InteractionID)
	}
	if req.Runtime != "" {
		query = query.Where("runtime = ?", req.Runtime)
	}
	if req.Module != "" {
		query = query.Where("module = ?", req.Module)
	}
	if req.Kind != "" {
		query = query.Where("kind = ?", req.Kind)
	}
	if req.Since > 0 {
		query = query.Where("ts >= ?", req.Since)
	}
	if req.Until > 0 {
		query = query.Where("ts <= ?", req.Until)
	}

	var rows []rawEventModel
	if err := query.Order("ts DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("query frontend telemetry events: %w", err)
	}
	return rows, nil
}

func (s *rawEventStore) QueryRollups(ctx context.Context, actorID string, req rollupQueryRequest) ([]rollupModel, error) {
	if actorID == "" {
		return nil, fmt.Errorf("frontend telemetry: actorID is required")
	}
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := s.db.WithContext(ctx).Where("actor_id = ?", actorID)
	if req.Runtime != "" {
		query = query.Where("runtime = ?", req.Runtime)
	}
	if req.Module != "" {
		query = query.Where("module = ?", req.Module)
	}
	if req.Kind != "" {
		query = query.Where("kind = ?", req.Kind)
	}

	var rows []rollupModel
	if err := query.Order("window_start DESC, module ASC, kind ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("query frontend telemetry rollups: %w", err)
	}
	return rows, nil
}

func (s *rawEventStore) rebuildRollups(ctx context.Context, tx *gorm.DB, actorID string) error {
	if err := tx.WithContext(ctx).Where("actor_id = ?", actorID).Delete(&rollupModel{}).Error; err != nil {
		return fmt.Errorf("clear frontend telemetry rollups: %w", err)
	}

	var rows []rawEventModel
	if err := tx.WithContext(ctx).Where("actor_id = ?", actorID).Find(&rows).Error; err != nil {
		return fmt.Errorf("load frontend telemetry events for rollup: %w", err)
	}

	type key struct {
		runtime string
		module  string
		kind    string
		window  time.Time
	}
	type bucket struct {
		count           int
		durationValues  []float64
		lastObservedAt  time.Time
		lastInteraction string
	}
	buckets := map[key]*bucket{}
	for _, row := range rows {
		window := eventWindow(row.TS)
		k := key{runtime: row.Runtime, module: row.Module, kind: row.Kind, window: window}
		b := buckets[k]
		if b == nil {
			b = &bucket{}
			buckets[k] = b
		}
		b.count++
		if row.DurationMS != nil {
			b.durationValues = append(b.durationValues, *row.DurationMS)
		}
		observedAt := time.UnixMilli(int64(row.TS)).UTC()
		if observedAt.After(b.lastObservedAt) {
			b.lastObservedAt = observedAt
			b.lastInteraction = row.InteractionID
		}
	}

	rollups := make([]rollupModel, 0, len(buckets))
	now := time.Now().UTC()
	for k, b := range buckets {
		p50, p95, max := durationStats(b.durationValues)
		rollups = append(rollups, rollupModel{
			ActorID:         actorID,
			Runtime:         k.runtime,
			Module:          k.module,
			Kind:            k.kind,
			WindowStart:     k.window,
			WindowMinutes:   5,
			Count:           b.count,
			DurationCount:   len(b.durationValues),
			P50DurationMS:   p50,
			P95DurationMS:   p95,
			MaxDurationMS:   max,
			LastObservedAt:  b.lastObservedAt,
			LastInteraction: b.lastInteraction,
			UpdatedAt:       now,
		})
	}
	if len(rollups) == 0 {
		return nil
	}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(&rollups, rollupInsertBatchSize).Error; err != nil {
		return fmt.Errorf("persist frontend telemetry rollups: %w", err)
	}
	return nil
}

func eventWindow(ts float64) time.Time {
	if ts <= 0 {
		return time.Now().UTC().Truncate(5 * time.Minute)
	}
	return time.UnixMilli(int64(ts)).UTC().Truncate(5 * time.Minute)
}

func durationStats(values []float64) (*float64, *float64, *float64) {
	if len(values) == 0 {
		return nil, nil, nil
	}
	sort.Float64s(values)
	p50 := percentile(values, 0.50)
	p95 := percentile(values, 0.95)
	max := values[len(values)-1]
	return &p50, &p95, &max
}

func percentile(values []float64, p float64) float64 {
	if len(values) == 1 {
		return values[0]
	}
	idx := int(float64(len(values)-1) * p)
	if idx < 0 {
		idx = 0
	}
	if idx >= len(values) {
		idx = len(values) - 1
	}
	return values[idx]
}

func jsonString(value map[string]any) string {
	if len(value) == 0 {
		return ""
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}
