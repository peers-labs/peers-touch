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
const rollupWindowDuration = 5 * time.Minute

type rawEventModel struct {
	ID            uint       `gorm:"column:id;primaryKey"`
	ActorPTID     string     `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_frontend_telemetry_actor_ptid_event,priority:1;index"`
	EventID       string     `gorm:"column:event_id;size:128;uniqueIndex:idx_frontend_telemetry_actor_ptid_event,priority:2;index"`
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
	ActorPTID       string    `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_frontend_telemetry_rollup,priority:1;index"`
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
	for _, table := range []string{rawEventModel{}.TableName(), rollupModel{}.TableName()} {
		if err := renameTelemetryPTIDColumn(s.db, table); err != nil {
			return err
		}
	}
	return s.db.AutoMigrate(&rawEventModel{}, &rollupModel{})
}

func (s *rawEventStore) PersistBatch(ctx context.Context, actorPTID, sessionID string, events []frontendTelemetryEvent) (ingestResult, error) {
	if actorPTID == "" {
		return ingestResult{}, fmt.Errorf("frontend telemetry: actorPTID is required")
	}
	if len(events) == 0 {
		return ingestResult{}, fmt.Errorf("events must not be empty")
	}

	now := time.Now().UTC()
	rows := make([]rawEventModel, 0, len(events))
	rejected := make([]string, 0)
	for _, event := range events {
		row, reason := event.toRawEventModel(actorPTID, sessionID, now)
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
		if err := lockActorTelemetryRollups(ctx, tx, actorPTID); err != nil {
			return err
		}
		newRows, err := telemetryRowsMissingFromStore(ctx, tx, actorPTID, rows)
		if err != nil {
			return err
		}
		if len(newRows) == 0 {
			return nil
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
			CreateInBatches(&newRows, rollupInsertBatchSize).Error; err != nil {
			return fmt.Errorf("persist frontend telemetry events: %w", err)
		}
		return s.rebuildRollupWindows(
			ctx,
			tx,
			actorPTID,
			affectedRollupWindows(newRows),
		)
	})
	if err != nil {
		return ingestResult{}, err
	}
	return ingestResult{Accepted: len(rows), Rejected: len(rejected), RejectedReasons: rejected}, nil
}

func telemetryRowsMissingFromStore(
	ctx context.Context,
	tx *gorm.DB,
	actorPTID string,
	rows []rawEventModel,
) ([]rawEventModel, error) {
	uniqueRows := make([]rawEventModel, 0, len(rows))
	eventIDs := make([]string, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		if _, duplicate := seen[row.EventID]; duplicate {
			continue
		}
		seen[row.EventID] = struct{}{}
		uniqueRows = append(uniqueRows, row)
		eventIDs = append(eventIDs, row.EventID)
	}

	var existingIDs []string
	if err := tx.WithContext(ctx).
		Model(&rawEventModel{}).
		Where("actor_ptid = ? AND event_id IN ?", actorPTID, eventIDs).
		Pluck("event_id", &existingIDs).Error; err != nil {
		return nil, fmt.Errorf("load existing frontend telemetry event ids: %w", err)
	}
	existing := make(map[string]struct{}, len(existingIDs))
	for _, eventID := range existingIDs {
		existing[eventID] = struct{}{}
	}

	missing := make([]rawEventModel, 0, len(uniqueRows)-len(existing))
	for _, row := range uniqueRows {
		if _, found := existing[row.EventID]; !found {
			missing = append(missing, row)
		}
	}
	return missing, nil
}

func affectedRollupWindows(rows []rawEventModel) []time.Time {
	byUnixMilli := make(map[int64]time.Time, len(rows))
	for _, row := range rows {
		window := eventWindow(row.TS)
		byUnixMilli[window.UnixMilli()] = window
	}
	unixMillis := make([]int64, 0, len(byUnixMilli))
	for unixMilli := range byUnixMilli {
		unixMillis = append(unixMillis, unixMilli)
	}
	sort.Slice(unixMillis, func(i, j int) bool {
		return unixMillis[i] < unixMillis[j]
	})
	windows := make([]time.Time, 0, len(unixMillis))
	for _, unixMilli := range unixMillis {
		windows = append(windows, byUnixMilli[unixMilli])
	}
	return windows
}

func lockActorTelemetryRollups(ctx context.Context, tx *gorm.DB, actorPTID string) error {
	if tx.Dialector == nil || tx.Dialector.Name() != "postgres" {
		return nil
	}
	if err := tx.WithContext(ctx).Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", actorPTID).Error; err != nil {
		return fmt.Errorf("lock frontend telemetry actor rollups: %w", err)
	}
	return nil
}

func (s *rawEventStore) Query(ctx context.Context, actorPTID string, req queryRequest) ([]rawEventModel, error) {
	if actorPTID == "" {
		return nil, fmt.Errorf("frontend telemetry: actorPTID is required")
	}
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := s.db.WithContext(ctx).Where("actor_ptid = ?", actorPTID)
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

func (s *rawEventStore) QueryRollups(ctx context.Context, actorPTID string, req rollupQueryRequest) ([]rollupModel, error) {
	if actorPTID == "" {
		return nil, fmt.Errorf("frontend telemetry: actorPTID is required")
	}
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := s.db.WithContext(ctx).Where("actor_ptid = ?", actorPTID)
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

func (s *rawEventStore) rebuildRollupWindows(
	ctx context.Context,
	tx *gorm.DB,
	actorPTID string,
	windows []time.Time,
) error {
	for _, window := range windows {
		var rows []rawEventModel
		if err := tx.WithContext(ctx).
			Where(
				"actor_ptid = ? AND ts >= ? AND ts < ?",
				actorPTID,
				float64(window.UnixMilli()),
				float64(window.Add(rollupWindowDuration).UnixMilli()),
			).
			Find(&rows).Error; err != nil {
			return fmt.Errorf(
				"load frontend telemetry events for rollup window: %w",
				err,
			)
		}
		if err := persistRollups(ctx, tx, actorPTID, rows); err != nil {
			return err
		}
	}
	return nil
}

func persistRollups(
	ctx context.Context,
	tx *gorm.DB,
	actorPTID string,
	rows []rawEventModel,
) error {
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
			ActorPTID:       actorPTID,
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
	sort.Slice(rollups, func(i, j int) bool {
		left := rollups[i]
		right := rollups[j]
		if left.WindowStart != right.WindowStart {
			return left.WindowStart.Before(right.WindowStart)
		}
		if left.Runtime != right.Runtime {
			return left.Runtime < right.Runtime
		}
		if left.Module != right.Module {
			return left.Module < right.Module
		}
		return left.Kind < right.Kind
	})
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "actor_ptid"},
			{Name: "runtime"},
			{Name: "module"},
			{Name: "kind"},
			{Name: "window_start"},
			{Name: "window_minutes"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"count",
			"duration_count",
			"p50_duration_ms",
			"p95_duration_ms",
			"max_duration_ms",
			"last_observed_at",
			"last_interaction_id",
			"updated_at",
		}),
	}).CreateInBatches(&rollups, rollupInsertBatchSize).Error; err != nil {
		return fmt.Errorf("persist frontend telemetry rollups: %w", err)
	}
	return nil
}

func renameTelemetryPTIDColumn(db *gorm.DB, table string) error {
	const legacy, canonical = "actor_id", "actor_ptid"
	if !db.Migrator().HasTable(table) || !db.Migrator().HasColumn(table, legacy) {
		return nil
	}
	if db.Migrator().HasColumn(table, canonical) {
		return fmt.Errorf("frontend telemetry: %s contains both %s and %s", table, legacy, canonical)
	}
	if err := db.Migrator().RenameColumn(table, legacy, canonical); err != nil {
		return fmt.Errorf("frontend telemetry: rename %s.%s to %s: %w", table, legacy, canonical, err)
	}
	return nil
}

func eventWindow(ts float64) time.Time {
	if ts <= 0 {
		return time.Now().UTC().Truncate(5 * time.Minute)
	}
	return time.UnixMilli(int64(ts)).UTC().Truncate(rollupWindowDuration)
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
