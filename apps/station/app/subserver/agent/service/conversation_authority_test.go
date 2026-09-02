package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openConversationAuthorityDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open conversation authority database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Conversation{},
		&persistence.AgentMessage{},
		&persistence.AgentTurn{},
		&persistence.TurnAttempt{},
		&persistence.TurnEvent{},
		&persistence.TurnQueueEntry{},
	); err != nil {
		t.Fatalf("migrate conversation authority database: %v", err)
	}
	injectOrchestrationServiceTestStore(t, db)
	return db
}

func TestConversationTurnEventReplayAndSnapshot(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_event_replay")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"
	now := time.Now()

	conversation := persistence.Conversation{
		ID:        "conversation-events",
		AgentID:   "agent-1",
		Ptid:      owner,
		Title:     "Events",
		Status:    "active",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	turns := []persistence.AgentTurn{
		{ID: "turn-1", ConversationID: conversation.ID, AgentID: conversation.AgentID, Status: "running", StartedAt: now},
		{ID: "turn-2", ConversationID: conversation.ID, AgentID: conversation.AgentID, Status: "running", StartedAt: now},
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&turns).Error; err != nil {
		t.Fatalf("seed turns: %v", err)
	}

	for _, event := range []struct {
		turnID string
		text   string
		want   int64
	}{
		{turnID: "turn-1", text: "hello ", want: 1},
		{turnID: "turn-1", text: "world", want: 2},
		{turnID: "turn-2", text: "other", want: 1},
	} {
		seq, err := service.PersistTurnEvent(ctx, conversation.ID, event.turnID, "text", map[string]interface{}{"text": event.text})
		if err != nil {
			t.Fatalf("persist %s event: %v", event.turnID, err)
		}
		if seq != event.want {
			t.Fatalf("%s sequence=%d, want %d", event.turnID, seq, event.want)
		}
	}

	replayed, err := service.ReplayTurnEvents(ctx, owner, conversation.ID, "turn-1", 1)
	if err != nil {
		t.Fatalf("replay turn events: %v", err)
	}
	if len(replayed) != 1 || replayed[0].EventSeq != 2 {
		t.Fatalf("unexpected replay: %+v", replayed)
	}
	if _, err := service.ReplayTurnEvents(ctx, "ptid:person:other", conversation.ID, "turn-1", 0); err != nil {
		t.Fatalf("foreign replay should be an empty actor-scoped result, got %v", err)
	}

	snapshot, err := service.GetTurnEventSnapshot(ctx, owner, conversation.ID, "turn-1")
	if err != nil {
		t.Fatalf("get running snapshot: %v", err)
	}
	if snapshot.LastSequence != 2 || snapshot.Text != "hello world" || snapshot.Status != "running" {
		t.Fatalf("unexpected running snapshot: %+v", snapshot)
	}

	if _, err := service.PersistTurnEvent(
		ctx,
		conversation.ID,
		"turn-1",
		"text",
		map[string]interface{}{"invalid": make(chan struct{})},
	); err == nil {
		t.Fatal("unencodable turn event payload must fail before persistence")
	}
	var eventCount int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ?", "turn-1").
		Count(&eventCount).Error; err != nil {
		t.Fatalf("count turn events after rejected payload: %v", err)
	}
	if eventCount != 2 {
		t.Fatalf("rejected payload changed durable event count: %d", eventCount)
	}
}

func TestTurnEventReplayFencesReopenedTurnToCurrentAttempt(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_attempt_replay")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"
	now := time.Now().UTC()
	conversation := persistence.Conversation{
		ID: "conversation-retry", AgentID: "agent-1", Ptid: owner,
		Title: "Retry", Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	turn := persistence.AgentTurn{
		ID: "turn-retry", ConversationID: conversation.ID, AgentID: conversation.AgentID,
		Status: string(domain.TurnStatusRunning), StartedAt: now.Add(time.Second),
	}
	attempts := []persistence.TurnAttempt{
		{
			ID: "attempt-1", TurnID: turn.ID, AttemptIndex: 1,
			Status: string(domain.TurnStatusFailed), StartedAt: now.Add(-time.Second), EndedAt: &now,
		},
		{
			ID: "attempt-2", TurnID: turn.ID, AttemptIndex: 2,
			Status: string(domain.TurnStatusRunning), StartedAt: now.Add(time.Second),
		},
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&turn).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&attempts).Error; err != nil {
		t.Fatal(err)
	}
	for _, event := range []struct {
		attemptID string
		eventType string
		payload   map[string]interface{}
	}{
		{attemptID: "attempt-1", eventType: "text", payload: map[string]interface{}{"text": "old"}},
		{attemptID: "attempt-1", eventType: "error", payload: map[string]interface{}{"error": "old failure"}},
		{attemptID: "attempt-2", eventType: "progress", payload: map[string]interface{}{"stage": "turn_started"}},
		{attemptID: "attempt-2", eventType: "text", payload: map[string]interface{}{"text": "new"}},
	} {
		if _, err := service.PersistTurnAttemptEvent(
			ctx,
			conversation.ID,
			turn.ID,
			event.attemptID,
			event.eventType,
			event.payload,
		); err != nil {
			t.Fatalf("persist %s event: %v", event.attemptID, err)
		}
	}

	replayed, err := service.ReplayTurnEvents(ctx, owner, conversation.ID, turn.ID, 0)
	if err != nil {
		t.Fatalf("replay current attempt: %v", err)
	}
	if len(replayed) != 2 ||
		replayed[0].AttemptID != "attempt-2" ||
		replayed[1].AttemptID != "attempt-2" ||
		replayed[1].EventType != "text" {
		t.Fatalf("replay crossed attempt fence: %+v", replayed)
	}
	snapshot, err := service.GetTurnEventSnapshot(ctx, owner, conversation.ID, turn.ID)
	if err != nil {
		t.Fatalf("snapshot current attempt: %v", err)
	}
	if snapshot.Status != string(domain.TurnStatusRunning) ||
		snapshot.Text != "new" ||
		snapshot.LastSequence != replayed[1].EventSeq {
		t.Fatalf("snapshot crossed attempt fence: %+v", snapshot)
	}
	var auditCount int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ?", turn.ID).
		Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 4 {
		t.Fatalf("attempt fencing removed audit history: count=%d", auditCount)
	}
}

func TestTurnTextEventAndAssistantProjectionCommitAtomically(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_text_projection")
	ctx := context.Background()
	service := NewConversationService()
	now := time.Now().UTC()
	conversation := persistence.Conversation{
		ID: "conversation-text", AgentID: "agent-1", Ptid: "ptid:person:owner",
		Title: "Text projection", Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	turn := persistence.AgentTurn{
		ID: "turn-text", ConversationID: conversation.ID, AgentID: conversation.AgentID,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}
	attempt := persistence.TurnAttempt{
		ID: "attempt-text", TurnID: turn.ID, AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}
	empty := ""
	message := persistence.AgentMessage{
		ID: "message-text", ConversationID: conversation.ID, TurnID: &turn.ID,
		Role: string(domain.MessageRoleAssistant), Status: "pending", Content: &empty,
		Seq: 1, CreatedAt: now, UpdatedAt: now,
	}
	for name, row := range map[string]interface{}{
		"conversation": &conversation,
		"turn":         &turn,
		"attempt":      &attempt,
		"message":      &message,
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}

	for _, text := range []string{"hello ", "world"} {
		if _, _, err := service.PersistTurnTextEvent(
			ctx,
			conversation.ID,
			turn.ID,
			attempt.ID,
			message.ID,
			"model-1",
			"",
			"",
			"",
			map[string]interface{}{"text": text},
			text,
		); err != nil {
			t.Fatalf("persist text projection: %v", err)
		}
	}

	var projected persistence.AgentMessage
	if err := db.First(&projected, "id = ?", message.ID).Error; err != nil {
		t.Fatal(err)
	}
	if projected.Content == nil || *projected.Content != "hello world" {
		t.Fatalf("assistant partial projection = %+v", projected.Content)
	}
	var eventCount int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND attempt_id = ? AND event_type = ?", turn.ID, attempt.ID, "text").
		Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 2 {
		t.Fatalf("text event count = %d, want 2", eventCount)
	}
	lazyTurn := persistence.AgentTurn{
		ID: "turn-text-lazy", ConversationID: conversation.ID, AgentID: conversation.AgentID,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}
	lazyAttempt := persistence.TurnAttempt{
		ID: "attempt-text-lazy", TurnID: lazyTurn.ID, AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}
	if err := db.Create(&lazyTurn).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&lazyAttempt).Error; err != nil {
		t.Fatal(err)
	}
	_, lazyMessageID, err := service.PersistTurnTextEvent(
		ctx,
		conversation.ID,
		lazyTurn.ID,
		lazyAttempt.ID,
		"",
		"model-1",
		"",
		"",
		"",
		map[string]interface{}{"text": "partial"},
		"partial",
	)
	if err != nil {
		t.Fatalf("create lazy assistant projection: %v", err)
	}
	var lazyMessage persistence.AgentMessage
	if err := db.First(&lazyMessage, "id = ?", lazyMessageID).Error; err != nil {
		t.Fatal(err)
	}
	if lazyMessage.Status != "pending" ||
		lazyMessage.Content == nil ||
		*lazyMessage.Content != "partial" {
		t.Fatalf("lazy assistant projection = %+v", lazyMessage)
	}

	if err := db.Model(&projected).Update("status", "interrupted").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.PersistTurnTextEvent(
		ctx,
		conversation.ID,
		turn.ID,
		attempt.ID,
		message.ID,
		"model-1",
		"",
		"",
		"",
		map[string]interface{}{"text": "late"},
		"late",
	); err == nil {
		t.Fatal("late text event committed after assistant became terminal")
	}
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND attempt_id = ? AND event_type = ?", turn.ID, attempt.ID, "text").
		Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 2 {
		t.Fatalf("failed text projection left a durable event: count=%d", eventCount)
	}

	terminalTurn := persistence.AgentTurn{
		ID: "turn-text-terminal-without-message", ConversationID: conversation.ID,
		AgentID: conversation.AgentID, Status: string(domain.TurnStatusCancelled),
		StartedAt: now, EndedAt: &now,
	}
	terminalAttempt := persistence.TurnAttempt{
		ID: "attempt-text-terminal-without-message", TurnID: terminalTurn.ID,
		AttemptIndex: 1, Status: string(domain.TurnStatusCancelled),
		StartedAt: now, EndedAt: &now,
	}
	if err := db.Create(&terminalTurn).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&terminalAttempt).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.PersistTurnTextEvent(
		ctx,
		conversation.ID,
		terminalTurn.ID,
		terminalAttempt.ID,
		"",
		"model-1",
		"",
		"",
		"",
		map[string]interface{}{"text": "late first delta"},
		"late first delta",
	); err == nil {
		t.Fatal("late first text delta created a message after turn cancellation")
	}
	var terminalMessageCount int64
	if err := db.Model(&persistence.AgentMessage{}).
		Where("turn_id = ?", terminalTurn.ID).
		Count(&terminalMessageCount).Error; err != nil {
		t.Fatal(err)
	}
	if terminalMessageCount != 0 {
		t.Fatalf("terminal turn created %d assistant messages", terminalMessageCount)
	}
}

func TestTurnEventSubscriptionKeepsOneAttemptFenceAcrossRetry(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_subscription_attempt_fence")
	ctx := context.Background()
	service := NewConversationService()
	now := time.Now().UTC()
	conversation := persistence.Conversation{
		ID: "conversation-fenced-retry", AgentID: "agent-1", Ptid: "ptid:person:owner",
		Title: "Fenced retry", Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	turn := persistence.AgentTurn{
		ID: "turn-fenced-retry", ConversationID: conversation.ID, AgentID: conversation.AgentID,
		Status: string(domain.TurnStatusFailed), StartedAt: now.Add(-time.Minute), EndedAt: &now,
	}
	firstAttempt := persistence.TurnAttempt{
		ID: "attempt-fenced-1", TurnID: turn.ID, AttemptIndex: 1,
		Status: string(domain.TurnStatusFailed), StartedAt: now.Add(-time.Minute), EndedAt: &now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&turn).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&firstAttempt).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.PersistTurnAttemptEvent(
		ctx,
		conversation.ID,
		turn.ID,
		firstAttempt.ID,
		"text",
		map[string]interface{}{"text": "first attempt partial"},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PersistTurnAttemptEvent(
		ctx,
		conversation.ID,
		turn.ID,
		firstAttempt.ID,
		"error",
		map[string]interface{}{"error": "first attempt failed"},
	); err != nil {
		t.Fatal(err)
	}

	_, boundary, fence, unsubscribe, err := service.SubscribeTurnEvents(
		ctx,
		conversation.Ptid,
		conversation.ID,
		turn.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()

	if err := db.Model(&persistence.AgentTurn{}).
		Where("id = ?", turn.ID).
		Updates(map[string]interface{}{
			"status":          string(domain.TurnStatusRunning),
			"terminal_reason": "",
			"ended_at":        nil,
		}).Error; err != nil {
		t.Fatal(err)
	}
	secondAttempt := persistence.TurnAttempt{
		ID: "attempt-fenced-2", TurnID: turn.ID, AttemptIndex: 2,
		Status: string(domain.TurnStatusRunning), StartedAt: now.Add(time.Second),
	}
	if err := db.Create(&secondAttempt).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.PersistTurnAttemptEvent(
		ctx,
		conversation.ID,
		turn.ID,
		secondAttempt.ID,
		"progress",
		map[string]interface{}{"stage": "retry_started"},
	); err != nil {
		t.Fatal(err)
	}

	replayed, err := service.ReplayTurnEventsThroughFence(
		ctx,
		conversation.Ptid,
		conversation.ID,
		turn.ID,
		0,
		boundary,
		fence,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed) != 2 ||
		replayed[0].AttemptID != firstAttempt.ID ||
		replayed[1].AttemptID != firstAttempt.ID ||
		replayed[1].EventType != "error" {
		t.Fatalf("subscription replay drifted to retry attempt: %+v", replayed)
	}
	snapshot, err := service.GetTurnEventSnapshotAtFence(
		ctx,
		conversation.Ptid,
		conversation.ID,
		turn.ID,
		boundary,
		fence,
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != string(domain.TurnStatusFailed) ||
		snapshot.Text != "first attempt partial" ||
		snapshot.TerminalReason != "first attempt failed" ||
		snapshot.LastSequence != replayed[1].EventSeq {
		t.Fatalf("subscription snapshot drifted to retry attempt: %+v", snapshot)
	}
}

func TestTurnEventSubscriptionSignalsDurableReplayWithoutLostWindow(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_event_tail")
	now := time.Now()
	conversation := persistence.Conversation{
		ID: "conversation-tail", AgentID: "agent-1", Ptid: "ptid:person:owner",
		Title: "Tail", Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	turn := persistence.AgentTurn{
		ID: "turn-tail", ConversationID: conversation.ID, AgentID: conversation.AgentID,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&turn).Error; err != nil {
		t.Fatal(err)
	}

	service := NewConversationService()
	notifications, boundary, _, unsubscribe, err := service.SubscribeTurnEvents(
		context.Background(),
		conversation.Ptid,
		conversation.ID,
		turn.ID,
	)
	if err != nil {
		t.Fatalf("subscribe before replay: %v", err)
	}
	defer unsubscribe()
	if boundary != 0 {
		t.Fatalf("initial replay boundary = %d, want 0", boundary)
	}
	if _, err := service.PersistTurnEvent(
		context.Background(),
		conversation.ID,
		turn.ID,
		"text",
		map[string]interface{}{"text": "after-subscribe"},
	); err != nil {
		t.Fatalf("persist tail event: %v", err)
	}
	select {
	case <-notifications:
	case <-time.After(time.Second):
		t.Fatal("committed turn event did not wake live subscriber")
	}
	events, err := service.ReplayTurnEvents(
		context.Background(),
		conversation.Ptid,
		conversation.ID,
		turn.ID,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].EventSeq != 1 {
		t.Fatalf("durable replay after subscribe = %+v", events)
	}
}

func TestTurnEventSubscriptionBoundaryDoesNotSkipReplaySnapshotWindow(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_event_boundary")
	now := time.Now()
	conversation := persistence.Conversation{
		ID: "conversation-boundary", AgentID: "agent-1", Ptid: "ptid:person:owner",
		Title: "Boundary", Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	turn := persistence.AgentTurn{
		ID: "turn-boundary", ConversationID: conversation.ID, AgentID: conversation.AgentID,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&turn).Error; err != nil {
		t.Fatal(err)
	}

	service := NewConversationService()
	if _, err := service.PersistTurnEvent(
		context.Background(),
		conversation.ID,
		turn.ID,
		"text",
		map[string]interface{}{"text": "before-boundary"},
	); err != nil {
		t.Fatal(err)
	}
	notifications, boundary, fence, unsubscribe, err := service.SubscribeTurnEvents(
		context.Background(),
		conversation.Ptid,
		conversation.ID,
		turn.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	if boundary != 1 {
		t.Fatalf("replay boundary = %d, want 1", boundary)
	}
	initial, err := service.ReplayTurnEventsThroughFence(
		context.Background(),
		conversation.Ptid,
		conversation.ID,
		turn.ID,
		0,
		boundary,
		fence,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(initial) != 1 || initial[0].EventSeq != 1 {
		t.Fatalf("initial bounded replay = %+v", initial)
	}

	if _, err := service.PersistTurnEvent(
		context.Background(),
		conversation.ID,
		turn.ID,
		"text",
		map[string]interface{}{"text": "-after-replay"},
	); err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.GetTurnEventSnapshotAtFence(
		context.Background(),
		conversation.Ptid,
		conversation.ID,
		turn.ID,
		boundary,
		fence,
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.LastSequence != 1 || snapshot.Text != "before-boundary" {
		t.Fatalf("bounded snapshot advanced over unseen event: %+v", snapshot)
	}
	select {
	case <-notifications:
	case <-time.After(time.Second):
		t.Fatal("post-boundary durable event did not notify subscriber")
	}
	tail, err := service.ReplayTurnEvents(
		context.Background(),
		conversation.Ptid,
		conversation.ID,
		turn.ID,
		boundary,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail) != 1 || tail[0].EventSeq != 2 {
		t.Fatalf("post-boundary replay = %+v", tail)
	}
}

func TestTurnEventSubscriptionsEnforceTurnActorAndGlobalLimits(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_turn_event_limits")
	now := time.Now()
	conversations := []persistence.Conversation{
		{ID: "conversation-owner-1", AgentID: "agent-1", Ptid: "ptid:person:owner", Title: "Owner 1", Status: "active", CreatedAt: now, UpdatedAt: now},
		{ID: "conversation-owner-2", AgentID: "agent-1", Ptid: "ptid:person:owner", Title: "Owner 2", Status: "active", CreatedAt: now, UpdatedAt: now},
		{ID: "conversation-other", AgentID: "agent-1", Ptid: "ptid:person:other", Title: "Other", Status: "active", CreatedAt: now, UpdatedAt: now},
		{ID: "conversation-third", AgentID: "agent-1", Ptid: "ptid:person:third", Title: "Third", Status: "active", CreatedAt: now, UpdatedAt: now},
	}
	turns := []persistence.AgentTurn{
		{ID: "turn-owner-1", ConversationID: conversations[0].ID, AgentID: "agent-1", Status: string(domain.TurnStatusRunning), StartedAt: now},
		{ID: "turn-owner-2", ConversationID: conversations[1].ID, AgentID: "agent-1", Status: string(domain.TurnStatusRunning), StartedAt: now},
		{ID: "turn-other", ConversationID: conversations[2].ID, AgentID: "agent-1", Status: string(domain.TurnStatusRunning), StartedAt: now},
		{ID: "turn-third", ConversationID: conversations[3].ID, AgentID: "agent-1", Status: string(domain.TurnStatusRunning), StartedAt: now},
	}
	if err := db.Create(&conversations).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&turns).Error; err != nil {
		t.Fatal(err)
	}

	subscribe := func(
		t *testing.T,
		service *ConversationService,
		actorID string,
		conversationID string,
		turnID string,
	) func() {
		t.Helper()
		_, _, _, unsubscribe, err := service.SubscribeTurnEvents(
			context.Background(),
			actorID,
			conversationID,
			turnID,
		)
		if err != nil {
			t.Fatalf("subscribe %s/%s: %v", actorID, turnID, err)
		}
		return unsubscribe
	}

	t.Run("turn", func(t *testing.T) {
		service := newConversationServiceWithSubscriptionLimits(turnEventSubscriptionLimits{
			perTurn: 2, perActor: 4, global: 8,
		})
		cancelFirst := subscribe(t, service, conversations[0].Ptid, conversations[0].ID, turns[0].ID)
		cancelSecond := subscribe(t, service, conversations[0].Ptid, conversations[0].ID, turns[0].ID)
		defer cancelSecond()
		if _, _, _, _, err := service.SubscribeTurnEvents(
			context.Background(),
			conversations[0].Ptid,
			conversations[0].ID,
			turns[0].ID,
		); err == nil || !strings.Contains(err.Error(), "limit exceeded: turn") {
			t.Fatalf("turn limit rejection = %v", err)
		}
		cancelFirst()
		cancelReplacement := subscribe(t, service, conversations[0].Ptid, conversations[0].ID, turns[0].ID)
		cancelReplacement()
		cancelFirst()
	})

	t.Run("actor", func(t *testing.T) {
		service := newConversationServiceWithSubscriptionLimits(turnEventSubscriptionLimits{
			perTurn: 4, perActor: 2, global: 8,
		})
		cancelFirst := subscribe(t, service, conversations[0].Ptid, conversations[0].ID, turns[0].ID)
		defer cancelFirst()
		cancelSecond := subscribe(t, service, conversations[1].Ptid, conversations[1].ID, turns[1].ID)
		defer cancelSecond()
		if _, _, _, _, err := service.SubscribeTurnEvents(
			context.Background(),
			conversations[0].Ptid,
			conversations[0].ID,
			turns[0].ID,
		); err == nil || !strings.Contains(err.Error(), "limit exceeded: actor") {
			t.Fatalf("actor limit rejection = %v", err)
		}
	})

	t.Run("global", func(t *testing.T) {
		service := newConversationServiceWithSubscriptionLimits(turnEventSubscriptionLimits{
			perTurn: 4, perActor: 4, global: 2,
		})
		cancelFirst := subscribe(t, service, conversations[0].Ptid, conversations[0].ID, turns[0].ID)
		defer cancelFirst()
		cancelSecond := subscribe(t, service, conversations[2].Ptid, conversations[2].ID, turns[2].ID)
		defer cancelSecond()
		if _, _, _, _, err := service.SubscribeTurnEvents(
			context.Background(),
			conversations[3].Ptid,
			conversations[3].ID,
			turns[3].ID,
		); err == nil || !strings.Contains(err.Error(), "limit exceeded: global") {
			t.Fatalf("global limit rejection = %v", err)
		}
	})
}

func requireBizCode(t *testing.T, err error, code errcode.Code) {
	t.Helper()
	var biz *errcode.BizError
	if !errors.As(err, &biz) || biz.Code != code {
		t.Fatalf("expected %s, got %T: %v", code, err, err)
	}
}

func TestConversationArchiveRestoreAndDeleteDependencyGuard(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_lifecycle")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"

	conversation, err := service.CreateConversation(
		ctx,
		"agent-1",
		owner,
		"Lifecycle",
		"",
		"model-1",
		"provider-1",
	)
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := service.ArchiveConversation(
		ctx,
		owner,
		conversation.ConversationID,
		false,
		conversation.Version,
	); err != nil {
		t.Fatalf("archive conversation: %v", err)
	}
	archived, err := service.GetConversation(ctx, owner, conversation.ConversationID)
	if err != nil {
		t.Fatalf("read archived conversation: %v", err)
	}
	if archived.Status != domain.ConversationStatusArchived {
		t.Fatalf("status=%q, want archived", archived.Status)
	}
	restored, err := service.RestoreConversation(
		ctx,
		owner,
		conversation.ConversationID,
		archived.Version,
	)
	if err != nil {
		t.Fatalf("restore conversation: %v", err)
	}
	if restored.Status != domain.ConversationStatusActive ||
		restored.Version <= archived.Version {
		t.Fatalf("unexpected restored conversation: %+v", restored)
	}

	now := time.Now().UTC()
	if err := db.Create(&persistence.AgentTurn{
		ID:             "active-turn",
		ConversationID: conversation.ConversationID,
		AgentID:        "agent-1",
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed active turn: %v", err)
	}
	err = service.ArchiveConversation(
		ctx,
		owner,
		conversation.ConversationID,
		true,
		restored.Version,
	)
	requireBizCode(t, err, errcode.AgentActiveDependency)

	if err := db.Model(&persistence.AgentTurn{}).
		Where("id = ?", "active-turn").
		Updates(map[string]any{
			"status":   string(domain.TurnStatusCompleted),
			"ended_at": now.Add(time.Second),
		}).Error; err != nil {
		t.Fatalf("settle active turn: %v", err)
	}
	if err := db.Create(&persistence.TurnQueueEntry{
		ID:                   "pending-turn",
		ConversationID:       conversation.ConversationID,
		AgentID:              "agent-1",
		Ptid:                 owner,
		ClientIdempotencyKey: "pending",
		AdmissionPayloadHash: "hash",
		RequestPayload:       []byte{1},
		QueueSequence:        1,
		Status:               queueStatusPending,
		CreatedAt:            now,
		UpdatedAt:            now,
	}).Error; err != nil {
		t.Fatalf("seed pending turn: %v", err)
	}
	err = service.ArchiveConversation(
		ctx,
		owner,
		conversation.ConversationID,
		true,
		restored.Version,
	)
	requireBizCode(t, err, errcode.AgentActiveDependency)

	if err := db.Model(&persistence.TurnQueueEntry{}).
		Where("id = ?", "pending-turn").
		Update("status", queueStatusCancelled).Error; err != nil {
		t.Fatalf("cancel pending turn: %v", err)
	}
	if err := service.ArchiveConversation(
		ctx,
		owner,
		conversation.ConversationID,
		true,
		restored.Version,
	); err != nil {
		t.Fatalf("delete settled conversation: %v", err)
	}
	var deleted persistence.Conversation
	if err := db.First(&deleted, "id = ?", conversation.ConversationID).Error; err != nil {
		t.Fatalf("read deleted conversation row: %v", err)
	}
	if deleted.Status != string(domain.ConversationStatusDeleted) {
		t.Fatalf("status=%q, want deleted", deleted.Status)
	}
}

func TestConversationAuthorityIsActorScopedAndVersioned(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_authority")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"
	other := "ptid:person:other"

	conversation, err := service.CreateConversation(
		ctx,
		"agent-1",
		owner,
		"Owner topic",
		"",
		"model-1",
		"provider-1",
	)
	if err != nil {
		t.Fatalf("create owner conversation: %v", err)
	}
	if conversation.Ptid != owner || conversation.Version != 1 {
		t.Fatalf("unexpected conversation readback: %+v", conversation)
	}

	if _, err := service.GetConversation(ctx, other, conversation.ConversationID); err == nil {
		t.Fatal("other actor read owner conversation")
	} else {
		requireBizCode(t, err, errcode.AgentNotFound)
	}
	if messages, _, _, err := service.ListMessages(
		ctx,
		other,
		conversation.ConversationID,
		0,
		0,
		20,
	); err != nil || len(messages) != 0 {
		t.Fatalf("other actor message projection leaked: messages=%+v err=%v", messages, err)
	}

	activeBranch := "message-branch-1"
	updated, err := service.UpdateConversation(
		ctx,
		owner,
		conversation.ConversationID,
		1,
		"Renamed topic",
		"",
		"",
		map[string]string{"pinned": "true"},
		&activeBranch,
	)
	if err != nil {
		t.Fatalf("update owner conversation: %v", err)
	}
	if updated.Version != 2 ||
		updated.Title != "Renamed topic" ||
		updated.ActiveBranchMessageID != activeBranch {
		t.Fatalf("unexpected updated conversation: %+v", updated)
	}

	if _, err := service.UpdateConversation(
		ctx,
		owner,
		conversation.ConversationID,
		1,
		"Stale overwrite",
		"",
		"",
		nil,
		nil,
	); err == nil {
		t.Fatal("stale version update succeeded")
	} else {
		requireBizCode(t, err, errcode.AgentVersionConflict)
	}

	if err := service.ArchiveConversation(
		ctx,
		other,
		conversation.ConversationID,
		false,
		2,
	); err == nil {
		t.Fatal("other actor archived owner conversation")
	} else {
		requireBizCode(t, err, errcode.AgentVersionConflict)
	}

	var row persistence.Conversation
	if err := db.First(&row, "id = ?", conversation.ConversationID).Error; err != nil {
		t.Fatalf("read conversation row: %v", err)
	}
	if row.Title != "Renamed topic" || row.Status != "active" || row.Version != 2 {
		t.Fatalf("unauthorized/stale mutation changed row: %+v", row)
	}
}

func TestConversationMessageMutationRequiresOwner(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_message_authority")
	ctx := context.Background()
	service := NewConversationService()
	owner := "ptid:person:owner"
	other := "ptid:person:other"
	now := time.Now()
	conversation := persistence.Conversation{
		ID:        "conversation-1",
		AgentID:   "agent-1",
		Ptid:      owner,
		Title:     "Owner topic",
		Status:    "active",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	message := persistence.AgentMessage{
		ID:             "message-1",
		ConversationID: conversation.ID,
		Role:           "assistant",
		Seq:            1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatalf("seed message: %v", err)
	}

	if err := service.SetMessageTranslation(ctx, other, message.ID, "leak"); err == nil {
		t.Fatal("other actor mutated message translation")
	}
	if err := service.SetMessageTranslation(ctx, owner, message.ID, "translated"); err != nil {
		t.Fatalf("owner translated message: %v", err)
	}

	var got persistence.AgentMessage
	if err := db.First(&got, "id = ?", message.ID).Error; err != nil {
		t.Fatalf("read message: %v", err)
	}
	if string(got.MetadataJSON) != `{"translation":"translated"}` {
		t.Fatalf("unexpected translation metadata: %s", got.MetadataJSON)
	}
}

func TestConversationMetadataUpdatesMergeAndBranchProjectionHidesTombstones(t *testing.T) {
	db := openConversationAuthorityDB(t, "conversation_projection")
	ctx := context.Background()
	service := NewConversationService()
	now := time.Now()
	parent := "user-root"
	tombstonedAt := now
	conversation := persistence.Conversation{
		ID:                    "conversation-projection",
		AgentID:               "agent-1",
		Ptid:                  "ptid:person:owner",
		Title:                 "Projection",
		Status:                "active",
		ActiveBranchMessageID: "assistant-active",
		Version:               1,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	for _, message := range []persistence.AgentMessage{
		{
			ID:             "user-root",
			ConversationID: conversation.ID,
			Role:           "user",
			Status:         "completed",
			Seq:            1,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		{
			ID:              "assistant-active",
			ConversationID:  conversation.ID,
			Role:            "assistant",
			Status:          "completed",
			Seq:             2,
			ParentMessageID: &parent,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              "assistant-sibling",
			ConversationID:  conversation.ID,
			Role:            "assistant",
			Status:          "completed",
			Seq:             3,
			ParentMessageID: &parent,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              "assistant-tombstoned",
			ConversationID:  conversation.ID,
			Role:            "assistant",
			Status:          "completed",
			Seq:             4,
			ParentMessageID: &parent,
			TombstonedAt:    &tombstonedAt,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
	} {
		if err := db.Create(&message).Error; err != nil {
			t.Fatal(err)
		}
	}

	updated, err := service.UpdateConversation(
		ctx,
		conversation.Ptid,
		conversation.ID,
		1,
		"",
		"",
		"",
		map[string]string{"pinned": "true"},
		nil,
	)
	if err != nil {
		t.Fatalf("pin conversation: %v", err)
	}
	updated, err = service.UpdateConversation(
		ctx,
		conversation.Ptid,
		conversation.ID,
		updated.Version,
		"",
		"",
		"",
		map[string]string{"favorite": "true"},
		nil,
	)
	if err != nil {
		t.Fatalf("favorite conversation: %v", err)
	}
	if updated.Meta["pinned"] != "true" || updated.Meta["favorite"] != "true" {
		t.Fatalf("metadata update replaced prior keys: %+v", updated.Meta)
	}

	messages, _, hasMore, err := service.ListMessages(
		ctx,
		conversation.Ptid,
		conversation.ID,
		0,
		0,
		20,
	)
	if err != nil {
		t.Fatalf("list active branch: %v", err)
	}
	if hasMore || len(messages) != 2 ||
		messages[0].MessageID != "user-root" ||
		messages[1].MessageID != "assistant-active" {
		t.Fatalf("unexpected active branch projection: %+v", messages)
	}
}
