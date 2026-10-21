package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func automationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestParseAutomationScheduleSupportsStructuredTimezoneAndNaturalWeekly(t *testing.T) {
	now := time.Date(2026, 10, 16, 8, 0, 0, 0, time.UTC)
	_, next, window, err := parseAutomationSchedule(
		`{"kind":"weekly","weekdays":[5],"time":"17:00","timezone":"Asia/Shanghai","missed_window_seconds":600}`,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC); !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}
	if window != 10*time.Minute {
		t.Fatalf("window = %s", window)
	}

	_, next, _, err = parseAutomationSchedule("Every Friday at 5 PM", now)
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 10, 16, 17, 0, 0, 0, time.UTC); !next.Equal(want) {
		t.Fatalf("natural next = %s, want %s", next, want)
	}
}

func TestScheduleDueAutomationIsExactlyOnceAcrossSchedulerPasses(t *testing.T) {
	db := automationTestDB(t)
	now := time.Date(2026, 10, 16, 10, 0, 0, 0, time.UTC)
	due := now.Add(-time.Minute)
	automation := persistence.ChannelAutomation{
		ID: "automation-1", BindingID: "binding-1",
		TriggerType:  "schedule",
		TriggerValue: `{"kind":"once","at":"2026-10-16T09:59:00Z","missed_window_seconds":300}`,
		ActionPrompt: "Summarize", AgentID: "agent-1",
		DestinationChatID: "chat-1", Enabled: true, Revision: 1,
		NextDueAt: &due, MissedWindowSecs: 300,
		LastRunStatus: "never", CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	if err := db.Create(&automation).Error; err != nil {
		t.Fatal(err)
	}
	bridge := &DurableBridge{db: db, now: func() time.Time { return now }}
	bridge.scheduleDueAutomations(context.Background())
	bridge.scheduleDueAutomations(context.Background())

	var count int64
	if err := db.Model(&persistence.ChannelAutomationRun{}).
		Where("automation_id = ?", automation.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("automation runs = %d, want 1", count)
	}
	var stored persistence.ChannelAutomation
	if err := db.First(&stored, "id = ?", automation.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.NextDueAt != nil || stored.LastRunStatus != "queued" {
		t.Fatalf("unexpected schedule projection: %+v", stored)
	}
}

func TestMessageAutomationEventCreatesOneDurableRun(t *testing.T) {
	db := automationTestDB(t)
	now := time.Date(2026, 10, 16, 10, 0, 0, 0, time.UTC)
	automation := persistence.ChannelAutomation{
		ID: "automation-message", BindingID: "binding-1",
		TriggerType: "message", TriggerValue: "incident",
		ActionPrompt: "Triage", AgentID: "agent-1", DestinationChatID: "chat-ops",
		Enabled: true, Revision: 1, LastRunStatus: "never",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&automation).Error; err != nil {
		t.Fatal(err)
	}
	bridge := &DurableBridge{db: db, now: func() time.Time { return now }}
	binding := &persistence.ChannelBinding{ID: "binding-1"}
	inbound := &persistence.ChannelInboundEvent{ID: "inbound-1"}
	event := &model.NormalizedInboundEvent{
		EventId: "event-1", MessageId: "message-1", ChatId: "chat-1",
		ChatType: "private", MessageType: "text", Text: "Incident detected",
	}
	for range 2 {
		if err := bridge.enqueueMatchingEventAutomations(
			context.Background(), binding, inbound, event,
		); err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	if err := db.Model(&persistence.ChannelAutomationRun{}).
		Where("automation_id = ?", automation.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("automation runs = %d, want 1", count)
	}
}
