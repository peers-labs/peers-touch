package frontend_telemetry

import (
	"context"
	"fmt"
	"testing"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestSubServer(t *testing.T) *subServer {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	store := newRawEventStore(db)
	if err := store.AutoMigrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return &subServer{store: store}
}

func TestRenameTelemetryPTIDColumnIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:frontend-telemetry-ptid-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, table := range []string{"frontend_telemetry_events", "frontend_telemetry_rollups"} {
		if err := db.Exec("CREATE TABLE " + table + " (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL)").Error; err != nil {
			t.Fatalf("create legacy table %s: %v", table, err)
		}
		if err := db.Exec("INSERT INTO "+table+" (id, actor_id) VALUES (?, ?)", 1, "ptid-telemetry").Error; err != nil {
			t.Fatalf("seed legacy table %s: %v", table, err)
		}
		for run := 1; run <= 2; run++ {
			if err := renameTelemetryPTIDColumn(db, table); err != nil {
				t.Fatalf("migrate %s run %d: %v", table, run, err)
			}
		}
		if db.Migrator().HasColumn(table, "actor_id") || !db.Migrator().HasColumn(table, "actor_ptid") {
			t.Fatalf("%s PTID columns not cut over", table)
		}
		var actorPTID string
		if err := db.Table(table).Select("actor_ptid").Where("id = ?", 1).Scan(&actorPTID).Error; err != nil {
			t.Fatalf("read migrated row from %s: %v", table, err)
		}
		if actorPTID != "ptid-telemetry" {
			t.Fatalf("%s migrated PTID = %q, want ptid-telemetry", table, actorPTID)
		}
	}
}

func testContext() context.Context {
	return coreauth.WithSubject(context.Background(), &coreauth.Subject{
		ID:        "actor-test",
		SessionID: "session-test",
	})
}

func validEvent(id, interactionID string, duration float64) frontendTelemetryEvent {
	return frontendTelemetryEvent{
		ID:            id,
		SchemaVersion: 1,
		TS:            float64(time.Now().UTC().UnixMilli()),
		Kind:          "route.visible",
		Source:        "shell",
		Module:        "desktop-native-telemetry",
		Runtime:       "tauri-webview",
		InteractionID: interactionID,
		DurationMS:    &duration,
		Tags:          map[string]any{"gate": "test"},
		Data:          map[string]any{"state": "visible"},
	}
}

func TestHandleIngestPersistsValidEventsAndRejectsInvalidOnes(t *testing.T) {
	s := newTestSubServer(t)
	ctx := testContext()

	res, err := s.handleIngest(ctx, &ingestRequest{Events: []frontendTelemetryEvent{
		validEvent("event-1", "interaction-1", 12),
		{ID: "bad-event", SchemaVersion: 1, Source: "shell", Module: "desktop-native-telemetry", Runtime: "tauri-webview"},
	}})
	if err != nil {
		t.Fatalf("handleIngest: %v", err)
	}
	if res.Accepted != 1 || res.Rejected != 1 || !res.Uploaded {
		t.Fatalf("ingest result = %+v, want accepted=1 rejected=1 uploaded=true", res)
	}
}

func TestHandleQueryFiltersByInteractionID(t *testing.T) {
	s := newTestSubServer(t)
	ctx := testContext()

	if _, err := s.handleIngest(ctx, &ingestRequest{Events: []frontendTelemetryEvent{
		validEvent("event-2", "interaction-hit", 8),
		validEvent("event-3", "interaction-miss", 9),
	}}); err != nil {
		t.Fatalf("handleIngest: %v", err)
	}

	res, err := s.handleQuery(ctx, &queryRequest{InteractionID: "interaction-hit", Limit: 10})
	if err != nil {
		t.Fatalf("handleQuery: %v", err)
	}
	if len(res.Events) != 1 || res.Events[0].InteractionID != "interaction-hit" {
		t.Fatalf("query result = %+v, want exactly interaction-hit", res.Events)
	}
}

func TestHandleQueryReturnsPersistedTagsAndData(t *testing.T) {
	s := newTestSubServer(t)
	ctx := testContext()

	if _, err := s.handleIngest(ctx, &ingestRequest{Events: []frontendTelemetryEvent{
		validEvent("event-with-context", "interaction-context", 11),
	}}); err != nil {
		t.Fatalf("handleIngest: %v", err)
	}

	res, err := s.handleQuery(ctx, &queryRequest{InteractionID: "interaction-context", Limit: 10})
	if err != nil {
		t.Fatalf("handleQuery: %v", err)
	}
	if len(res.Events) != 1 {
		t.Fatalf("query result count = %d, want 1", len(res.Events))
	}
	event := res.Events[0]
	if event.Tags["gate"] != "test" {
		t.Fatalf("tags = %+v, want gate=test", event.Tags)
	}
	if event.Data["state"] != "visible" {
		t.Fatalf("data = %+v, want state=visible", event.Data)
	}
}

func TestHandleRollupQueryReturnsPersistedPercentiles(t *testing.T) {
	s := newTestSubServer(t)
	ctx := testContext()

	if _, err := s.handleIngest(ctx, &ingestRequest{Events: []frontendTelemetryEvent{
		validEvent("event-4", "interaction-rollup", 10),
		validEvent("event-5", "interaction-rollup", 20),
		validEvent("event-6", "interaction-rollup", 30),
	}}); err != nil {
		t.Fatalf("handleIngest: %v", err)
	}

	res, err := s.handleRollupQuery(ctx, &rollupQueryRequest{
		Module: "desktop-native-telemetry",
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("handleRollupQuery: %v", err)
	}
	if len(res.Rollups) == 0 {
		t.Fatal("expected at least one rollup")
	}
	rollup := res.Rollups[0]
	if rollup.DurationCount != 3 || rollup.P50DurationMS == nil || rollup.P95DurationMS == nil || rollup.MaxDurationMS == nil {
		t.Fatalf("rollup = %+v, want duration percentile fields", rollup)
	}
	if *rollup.MaxDurationMS != 30 {
		t.Fatalf("max duration = %v, want 30", *rollup.MaxDurationMS)
	}

	if _, err := s.handleIngest(ctx, &ingestRequest{Events: []frontendTelemetryEvent{
		validEvent("event-7", "interaction-rollup", 40),
	}}); err != nil {
		t.Fatalf("handleIngest second batch: %v", err)
	}
	res, err = s.handleRollupQuery(ctx, &rollupQueryRequest{
		Module: "desktop-native-telemetry",
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("handleRollupQuery second batch: %v", err)
	}
	rollup = res.Rollups[0]
	if rollup.DurationCount != 4 ||
		rollup.P50DurationMS == nil ||
		*rollup.P50DurationMS != 20 ||
		rollup.P95DurationMS == nil ||
		*rollup.P95DurationMS != 30 ||
		rollup.MaxDurationMS == nil ||
		*rollup.MaxDurationMS != 40 {
		t.Fatalf("second-batch rollup = %+v, want exact 20/30/40 percentiles", rollup)
	}
}

func TestPersistBatchLeavesUntouchedRollupWindowsUnchanged(t *testing.T) {
	s := newTestSubServer(t)
	ctx := context.Background()
	const actorID = "actor-window-scope"
	oldObservedAt := time.Now().UTC().
		Add(-24 * time.Hour).
		Truncate(rollupWindowDuration).
		Add(time.Second)
	oldDuration := float64(91)
	oldRow := rawEventModel{
		ActorPTID:     actorID,
		EventID:       "old-event",
		SchemaVersion: 1,
		TS:            float64(oldObservedAt.UnixMilli()),
		Kind:          "route.visible",
		Source:        "shell",
		Module:        "old-module",
		Runtime:       "tauri-webview",
		DurationMS:    &oldDuration,
		CreatedAt:     oldObservedAt,
		ReceivedAt:    oldObservedAt,
	}
	if err := s.store.db.WithContext(ctx).Create(&oldRow).Error; err != nil {
		t.Fatalf("seed old event: %v", err)
	}
	oldWindow := eventWindow(oldRow.TS)
	sentinelUpdatedAt := oldObservedAt.Add(time.Minute)
	oldRollup := rollupModel{
		ActorPTID:      actorID,
		Runtime:        oldRow.Runtime,
		Module:         oldRow.Module,
		Kind:           oldRow.Kind,
		WindowStart:    oldWindow,
		WindowMinutes:  int(rollupWindowDuration / time.Minute),
		Count:          99,
		DurationCount:  99,
		LastObservedAt: oldObservedAt,
		UpdatedAt:      sentinelUpdatedAt,
	}
	if err := s.store.db.WithContext(ctx).Create(&oldRollup).Error; err != nil {
		t.Fatalf("seed old rollup: %v", err)
	}

	current := validEvent("current-event", "current-interaction", 12)
	if _, err := s.store.PersistBatch(
		ctx,
		actorID,
		"session-window-scope",
		[]frontendTelemetryEvent{current},
	); err != nil {
		t.Fatalf("PersistBatch current event: %v", err)
	}

	var preserved rollupModel
	if err := s.store.db.WithContext(ctx).
		Where(
			"actor_ptid = ? AND runtime = ? AND module = ? AND kind = ? AND window_start = ?",
			actorID,
			oldRow.Runtime,
			oldRow.Module,
			oldRow.Kind,
			oldWindow,
		).
		First(&preserved).Error; err != nil {
		t.Fatalf("read old rollup: %v", err)
	}
	if preserved.Count != 99 || preserved.DurationCount != 99 {
		t.Fatalf(
			"untouched old rollup = %+v, want sentinel counts preserved",
			preserved,
		)
	}

	var currentRollup rollupModel
	if err := s.store.db.WithContext(ctx).
		Where(
			"actor_ptid = ? AND runtime = ? AND module = ? AND kind = ? AND window_start = ?",
			actorID,
			current.Runtime,
			current.Module,
			current.Kind,
			eventWindow(current.TS),
		).
		First(&currentRollup).Error; err != nil {
		t.Fatalf("read current rollup: %v", err)
	}
	if currentRollup.Count != 1 || currentRollup.DurationCount != 1 {
		t.Fatalf("current rollup = %+v, want count=1 durationCount=1", currentRollup)
	}
}

func TestPersistBatchReplayDoesNotDoubleCountTouchedRollup(t *testing.T) {
	s := newTestSubServer(t)
	ctx := context.Background()
	const actorID = "actor-idempotent-rollup"
	event := validEvent("idempotent-event", "idempotent-interaction", 42)

	for attempt := 0; attempt < 2; attempt++ {
		if _, err := s.store.PersistBatch(
			ctx,
			actorID,
			"session-idempotent-rollup",
			[]frontendTelemetryEvent{event},
		); err != nil {
			t.Fatalf("PersistBatch attempt %d: %v", attempt+1, err)
		}
	}

	var rollup rollupModel
	if err := s.store.db.WithContext(ctx).
		Where(
			"actor_ptid = ? AND runtime = ? AND module = ? AND kind = ? AND window_start = ?",
			actorID,
			event.Runtime,
			event.Module,
			event.Kind,
			eventWindow(event.TS),
		).
		First(&rollup).Error; err != nil {
		t.Fatalf("read idempotent rollup: %v", err)
	}
	if rollup.Count != 1 || rollup.DurationCount != 1 {
		t.Fatalf("idempotent rollup = %+v, want count=1 durationCount=1", rollup)
	}
}

func TestPersistBatchUpdatesLargeRollupSetInBatches(t *testing.T) {
	s := newTestSubServer(t)
	ctx := context.Background()
	const actorID = "actor-large-rollups"
	const batchSize = 500
	const batchCount = 5

	for batch := 0; batch < batchCount; batch++ {
		events := make([]frontendTelemetryEvent, 0, batchSize)
		for index := 0; index < batchSize; index++ {
			globalIndex := batch*batchSize + index
			duration := float64(globalIndex % 100)
			events = append(events, frontendTelemetryEvent{
				ID:            fmt.Sprintf("large-rollup-event-%d", globalIndex),
				SchemaVersion: 1,
				TS:            float64(time.Now().UTC().Add(time.Duration(globalIndex) * time.Millisecond).UnixMilli()),
				Kind:          "route.visible",
				Source:        "shell",
				Module:        fmt.Sprintf("desktop-large-rollup-module-%d", globalIndex),
				Runtime:       "prod-preview",
				InteractionID: fmt.Sprintf("interaction-%d", globalIndex),
				DurationMS:    &duration,
			})
		}
		if _, err := s.store.PersistBatch(ctx, actorID, "session-large-rollups", events); err != nil {
			t.Fatalf("PersistBatch batch %d: %v", batch, err)
		}
	}

	var rollupCount int64
	if err := s.store.db.WithContext(ctx).
		Model(&rollupModel{}).
		Where("actor_ptid = ? AND runtime = ?", actorID, "prod-preview").
		Count(&rollupCount).Error; err != nil {
		t.Fatalf("count rollups: %v", err)
	}
	if rollupCount != batchSize*batchCount {
		t.Fatalf("rollup count = %d, want %d", rollupCount, batchSize*batchCount)
	}
}
