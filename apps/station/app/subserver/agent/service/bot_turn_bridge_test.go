package service

import (
	"context"
	"testing"
	"time"

	agentpersistence "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type scriptedTurnExecutor struct {
	ensureCalls   int
	admitCalls    int
	snapshotCalls int
	snapshot      channelsvc.TurnSnapshot
	snapshotErr   error
	admitErr      error
}

func (e *scriptedTurnExecutor) EnsureConversation(
	context.Context, string, string, string, string,
) error {
	e.ensureCalls++
	return nil
}

func (e *scriptedTurnExecutor) AdmitTurn(
	_ context.Context,
	input channelsvc.TurnAdmissionInput,
) (channelsvc.TurnAdmissionResult, error) {
	e.admitCalls++
	if e.admitErr != nil {
		return channelsvc.TurnAdmissionResult{}, e.admitErr
	}
	return channelsvc.TurnAdmissionResult{
		TurnID:      "turn-1",
		AdmissionID: input.IdempotencyKey,
		Status:      "started",
	}, nil
}

func (e *scriptedTurnExecutor) ResolveAdmission(
	context.Context, string, string, string,
) (channelsvc.TurnAdmissionResult, error) {
	return channelsvc.TurnAdmissionResult{TurnID: "turn-1", Status: "started"}, nil
}

func (e *scriptedTurnExecutor) Snapshot(
	context.Context, string, string, string,
) (channelsvc.TurnSnapshot, error) {
	e.snapshotCalls++
	return e.snapshot, e.snapshotErr
}

func (e *scriptedTurnExecutor) ReadOutput(
	context.Context, string, string, channelsvc.TurnOutput,
) ([]byte, error) {
	return nil, nil
}

func (e *scriptedTurnExecutor) CancelTurn(context.Context, string, string) error {
	return nil
}

func (e *scriptedTurnExecutor) SubmitToolDecision(
	context.Context, string, channelsvc.ToolDecisionInput,
) error {
	return nil
}

func (e *scriptedTurnExecutor) RecordFeedback(
	context.Context, string, channelsvc.TurnFeedbackInput,
) error {
	return nil
}

type fakeBotBindingReader struct {
	bindings map[string]BotBindingView
}

func (r fakeBotBindingReader) ActiveAgentBinding(
	_ context.Context,
	botPTID string,
) (BotBindingView, bool, error) {
	binding, ok := r.bindings[botPTID]
	return binding, ok, nil
}

type fakeBotReplyPublisher struct {
	calls    []publishedBotReply
	failNext int
}

type publishedBotReply struct {
	publishingID   string
	senderPTID     string
	ownerPTID      string
	conversationID string
	replyKey       string
	text           string
}

func (p *fakeBotReplyPublisher) PublishBotReply(
	_ context.Context,
	publishingID string,
	senderPTID string,
	ownerPTID string,
	conversationID string,
	replyKey string,
	text string,
) error {
	if p.failNext > 0 {
		p.failNext--
		return context.DeadlineExceeded
	}
	p.calls = append(p.calls, publishedBotReply{
		publishingID:   publishingID,
		senderPTID:     senderPTID,
		ownerPTID:      ownerPTID,
		conversationID: conversationID,
		replyKey:       replyKey,
		text:           text,
	})
	return nil
}

func newBotTurnTestBridge(
	t *testing.T,
	reader BotBindingReader,
	publisher BotReplyPublisher,
	executor channelsvc.TurnExecutor,
) (*BotTurnBridge, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&agentpersistence.BotInboundTurn{}); err != nil {
		t.Fatal(err)
	}
	bridge := NewBotTurnBridge(db, executor, reader, publisher)
	now := time.Date(2026, time.October, 26, 10, 0, 0, 0, time.UTC)
	bridge.now = func() time.Time { return now }
	return bridge, db
}

func botTurnTestEvent() BotInboundEvent {
	return BotInboundEvent{
		PublishingID:   "publishing-1",
		SenderPTID:     "ptid:v1:actor:peers:b:bot:test",
		OwnerPTID:      "ptid:v1:actor:peers:p:owner:test",
		ConversationID: "direct-1",
		MessageID:      "publishing-message:publishing-1:cmd-1",
		Text:           "deploy the build",
	}
}

func botTurnTestBinding(enabled bool) BotBindingView {
	return BotBindingView{
		BotPtid:   "ptid:v1:actor:peers:b:bot:test",
		OwnerPtid: "ptid:v1:actor:peers:p:owner:test",
		AgentID:   "agent-1",
		Enabled:   enabled,
		Version:   1,
	}
}

func loadBotInboundRow(t *testing.T, db *gorm.DB, id string) *agentpersistence.BotInboundTurn {
	t.Helper()
	var row agentpersistence.BotInboundTurn
	if err := db.Where("id = ?", id).First(&row).Error; err != nil {
		t.Fatalf("load inbound row %s: %v", id, err)
	}
	return &row
}

func TestBotInboundWithoutBindingCreatesNoProjection(t *testing.T) {
	executor := &scriptedTurnExecutor{}
	bridge, db := newBotTurnTestBridge(
		t,
		fakeBotBindingReader{bindings: map[string]BotBindingView{}},
		&fakeBotReplyPublisher{},
		executor,
	)
	if err := bridge.OnInboundPublished(context.Background(), botTurnTestEvent()); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&agentpersistence.BotInboundTurn{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 || executor.admitCalls != 0 {
		t.Fatalf("unbound inbound must stay receive-only: rows=%d admits=%d", count, executor.admitCalls)
	}
}

func TestBotInboundProjectsToReplyAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	reader := fakeBotBindingReader{bindings: map[string]BotBindingView{
		botTurnTestBinding(true).BotPtid: botTurnTestBinding(true),
	}}
	publisher := &fakeBotReplyPublisher{}
	executor := &scriptedTurnExecutor{
		snapshot: channelsvc.TurnSnapshot{Status: "running"},
	}
	bridge, db := newBotTurnTestBridge(t, reader, publisher, executor)
	event := botTurnTestEvent()
	if err := bridge.OnInboundPublished(ctx, event); err != nil {
		t.Fatal(err)
	}
	if err := bridge.OnInboundPublished(ctx, event); err != nil {
		t.Fatal(err)
	}
	var rows []agentpersistence.BotInboundTurn
	if err := db.Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("projection must be idempotent on message id: rows=%d", len(rows))
	}
	rowID := rows[0].ID

	// First transition: ensure conversation + admit the turn.
	bridge.projectPending(ctx)
	row := loadBotInboundRow(t, db, rowID)
	if row.Status != agentpersistence.BotInboundStatusAdmitted || row.TurnID != "turn-1" {
		t.Fatalf("after admit status=%s turn=%s", row.Status, row.TurnID)
	}

	// Second transition: turn still running.
	bridge.projectPending(ctx)
	row = loadBotInboundRow(t, db, rowID)
	if row.Status != agentpersistence.BotInboundStatusProcessing {
		t.Fatalf("non-terminal snapshot status=%s", row.Status)
	}

	// Third transition: completed turn republishes the agent output as the bot.
	executor.snapshot = channelsvc.TurnSnapshot{Status: "completed", Text: "  Build deployed  "}
	bridge.projectPending(ctx)
	row = loadBotInboundRow(t, db, rowID)
	if row.Status != agentpersistence.BotInboundStatusDelivered || row.DeliveredAt == nil {
		t.Fatalf("delivered status=%s deliveredAt=%v err=%s", row.Status, row.DeliveredAt, row.LastError)
	}
	if len(publisher.calls) != 1 {
		t.Fatalf("reply calls = %d", len(publisher.calls))
	}
	reply := publisher.calls[0]
	if reply.text != "Build deployed" || reply.replyKey != rowID ||
		reply.publishingID != "publishing-1" || reply.senderPTID != event.SenderPTID ||
		reply.conversationID != "direct-1" {
		t.Fatalf("published reply = %+v", reply)
	}
}

func TestBotInboundCancelsWhenBindingRemovedMidFlight(t *testing.T) {
	ctx := context.Background()
	binding := botTurnTestBinding(true)
	reader := fakeBotBindingReader{bindings: map[string]BotBindingView{binding.BotPtid: binding}}
	bridge, db := newBotTurnTestBridge(t, reader, &fakeBotReplyPublisher{}, &scriptedTurnExecutor{})
	if err := bridge.OnInboundPublished(ctx, botTurnTestEvent()); err != nil {
		t.Fatal(err)
	}
	bridge.projectPending(ctx)
	var row agentpersistence.BotInboundTurn
	if err := db.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != agentpersistence.BotInboundStatusAdmitted {
		t.Fatalf("status=%s", row.Status)
	}

	delete(reader.bindings, binding.BotPtid)
	bridge.projectPending(ctx)
	reloaded := loadBotInboundRow(t, db, row.ID)
	if reloaded.Status != agentpersistence.BotInboundStatusCancelled {
		t.Fatalf("unbind must cancel in-flight projection, status=%s", reloaded.Status)
	}
}

func TestBotInboundFailedTurnFailsProjection(t *testing.T) {
	ctx := context.Background()
	binding := botTurnTestBinding(true)
	reader := fakeBotBindingReader{bindings: map[string]BotBindingView{binding.BotPtid: binding}}
	publisher := &fakeBotReplyPublisher{}
	executor := &scriptedTurnExecutor{
		snapshot: channelsvc.TurnSnapshot{Status: "failed", TerminalReason: "provider unavailable"},
	}
	bridge, db := newBotTurnTestBridge(t, reader, publisher, executor)
	if err := bridge.OnInboundPublished(ctx, botTurnTestEvent()); err != nil {
		t.Fatal(err)
	}
	bridge.projectPending(ctx) // admit
	bridge.projectPending(ctx) // failed snapshot
	var row agentpersistence.BotInboundTurn
	if err := db.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != agentpersistence.BotInboundStatusFailed ||
		row.LastError != "provider unavailable" {
		t.Fatalf("status=%s lastError=%q", row.Status, row.LastError)
	}
	if len(publisher.calls) != 0 {
		t.Fatal("failed turns must never publish a reply")
	}
}

func TestBotInboundEmptyCompletionNeedsNoReply(t *testing.T) {
	ctx := context.Background()
	binding := botTurnTestBinding(true)
	reader := fakeBotBindingReader{bindings: map[string]BotBindingView{binding.BotPtid: binding}}
	publisher := &fakeBotReplyPublisher{}
	executor := &scriptedTurnExecutor{
		snapshot: channelsvc.TurnSnapshot{Status: "completed", Text: "   "},
	}
	bridge, db := newBotTurnTestBridge(t, reader, publisher, executor)
	if err := bridge.OnInboundPublished(ctx, botTurnTestEvent()); err != nil {
		t.Fatal(err)
	}
	bridge.projectPending(ctx)
	bridge.projectPending(ctx)
	var row agentpersistence.BotInboundTurn
	if err := db.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != agentpersistence.BotInboundStatusNoReply {
		t.Fatalf("status=%s", row.Status)
	}
	if len(publisher.calls) != 0 {
		t.Fatalf("empty completion must not publish: %d calls", len(publisher.calls))
	}
}

func TestBotInboundRetriesTransientReplyFailure(t *testing.T) {
	ctx := context.Background()
	binding := botTurnTestBinding(true)
	reader := fakeBotBindingReader{bindings: map[string]BotBindingView{binding.BotPtid: binding}}
	publisher := &fakeBotReplyPublisher{failNext: 1}
	executor := &scriptedTurnExecutor{
		snapshot: channelsvc.TurnSnapshot{Status: "completed", Text: "done"},
	}
	bridge, db := newBotTurnTestBridge(t, reader, publisher, executor)
	if err := bridge.OnInboundPublished(ctx, botTurnTestEvent()); err != nil {
		t.Fatal(err)
	}
	bridge.projectPending(ctx) // admit
	bridge.projectPending(ctx) // reply fails transiently
	var row agentpersistence.BotInboundTurn
	if err := db.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != agentpersistence.BotInboundStatusAdmitted || row.Attempts != 1 {
		t.Fatalf("transient reply failure keeps row active: status=%s attempts=%d", row.Status, row.Attempts)
	}
	bridge.projectPending(ctx) // reply succeeds
	reloaded := loadBotInboundRow(t, db, row.ID)
	if reloaded.Status != agentpersistence.BotInboundStatusDelivered {
		t.Fatalf("status=%s", reloaded.Status)
	}
	if len(publisher.calls) != 1 {
		t.Fatalf("reply calls = %d", len(publisher.calls))
	}
}
