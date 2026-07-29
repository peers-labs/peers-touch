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
		Module:        "desktop-telemetry-live-gate",
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
		{ID: "bad-event", SchemaVersion: 1, Source: "shell", Module: "desktop-telemetry-live-gate", Runtime: "tauri-webview"},
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
		Module: "desktop-telemetry-live-gate",
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
}

func TestPersistBatchRebuildsLargeRollupSetInBatches(t *testing.T) {
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
		Where("actor_id = ? AND runtime = ?", actorID, "prod-preview").
		Count(&rollupCount).Error; err != nil {
		t.Fatalf("count rollups: %v", err)
	}
	if rollupCount != batchSize*batchCount {
		t.Fatalf("rollup count = %d, want %d", rollupCount, batchSize*batchCount)
	}
}
