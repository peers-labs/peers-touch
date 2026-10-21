package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type bridgeTestExecutor struct {
	mu          sync.Mutex
	admitCalls  []TurnAdmissionInput
	snapshots   map[string]TurnSnapshot
	outputs     map[string][]byte
	decisions   []ToolDecisionInput
	feedback    []TurnFeedbackInput
	cancelCalls int
}

func (e *bridgeTestExecutor) EnsureConversation(
	_ context.Context,
	_, _, _, _ string,
) error {
	return nil
}

func (e *bridgeTestExecutor) AdmitTurn(
	_ context.Context,
	input TurnAdmissionInput,
) (TurnAdmissionResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.admitCalls = append(e.admitCalls, input)
	turnID := fmt.Sprintf("turn-%d", len(e.admitCalls))
	if e.snapshots == nil {
		e.snapshots = map[string]TurnSnapshot{}
	}
	e.snapshots[turnID] = TurnSnapshot{
		TurnID: turnID, Status: "running", Revision: 1,
	}
	return TurnAdmissionResult{
		TurnID: turnID, AdmissionID: input.IdempotencyKey, Status: "started",
	}, nil
}

func (e *bridgeTestExecutor) ResolveAdmission(
	_ context.Context,
	_, _, _ string,
) (TurnAdmissionResult, error) {
	return TurnAdmissionResult{}, errors.New("admission not found")
}

func (e *bridgeTestExecutor) Snapshot(
	_ context.Context,
	_, _, turnID string,
) (TurnSnapshot, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	snapshot, ok := e.snapshots[turnID]
	if !ok {
		return TurnSnapshot{}, errors.New("turn not found")
	}
	return snapshot, nil
}

func (e *bridgeTestExecutor) ReadOutput(
	_ context.Context,
	_, _ string,
	output TurnOutput,
) ([]byte, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	body, ok := e.outputs[output.OutputID]
	if !ok {
		return nil, errors.New("output not found")
	}
	return append([]byte(nil), body...), nil
}

func (e *bridgeTestExecutor) CancelTurn(
	_ context.Context,
	_, _ string,
) error {
	e.mu.Lock()
	e.cancelCalls++
	e.mu.Unlock()
	return nil
}

func (e *bridgeTestExecutor) SubmitToolDecision(
	_ context.Context,
	_ string,
	input ToolDecisionInput,
) error {
	e.mu.Lock()
	e.decisions = append(e.decisions, input)
	e.mu.Unlock()
	return nil
}

func (e *bridgeTestExecutor) RecordFeedback(
	_ context.Context,
	_ string,
	input TurnFeedbackInput,
) error {
	e.mu.Lock()
	e.feedback = append(e.feedback, input)
	e.mu.Unlock()
	return nil
}

func (e *bridgeTestExecutor) setSnapshot(snapshot TurnSnapshot) {
	e.mu.Lock()
	if e.snapshots == nil {
		e.snapshots = map[string]TurnSnapshot{}
	}
	e.snapshots[snapshot.TurnID] = snapshot
	e.mu.Unlock()
}

type bridgeTestProvider struct {
	mu         sync.Mutex
	deliveries []*model.DeliveryRequest
	receipts   []*model.DeliveryReceipt
	fetched    AttachmentPayload
	uploaded   []byte
}

func (p *bridgeTestProvider) FetchResource(
	_ context.Context,
	_, _ string,
	_ *model.ChannelResourceRef,
) (AttachmentPayload, error) {
	return p.fetched, nil
}

func (p *bridgeTestProvider) Deliver(
	_ context.Context,
	request *model.DeliveryRequest,
) (*model.DeliveryReceipt, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.deliveries = append(
		p.deliveries,
		proto.Clone(request).(*model.DeliveryRequest),
	)
	if len(p.receipts) == 0 {
		return &model.DeliveryReceipt{
			DeliveryId: request.GetDeliveryId(), Ok: true,
			ProviderMessageId: request.GetProviderMessageId(),
		}, nil
	}
	receipt := p.receipts[0]
	p.receipts = p.receipts[1:]
	return proto.Clone(receipt).(*model.DeliveryReceipt), nil
}

func (p *bridgeTestProvider) UploadResource(
	_ context.Context,
	request *model.ResourceUploadRequest,
) (*model.ResourceUploadResponse, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if request.GetOffset() != uint64(len(p.uploaded)) {
		return nil, errors.New("upload offset mismatch")
	}
	p.uploaded = append(p.uploaded, request.GetData()...)
	return &model.ResourceUploadResponse{
		UploadId:       request.GetUploadId(),
		AcceptedOffset: uint64(len(p.uploaded)),
		Complete:       request.GetEof(),
		ProviderKey: func() string {
			if request.GetEof() {
				return "provider-resource-1"
			}
			return ""
		}(),
	}, nil
}

func (p *bridgeTestProvider) SyncAutomationTrigger(
	_ context.Context,
	_ *model.SyncAutomationTriggerRequest,
) error {
	return nil
}

type bridgeTestFixture struct {
	db         *gorm.DB
	binding    BindingView
	bindings   *BindingService
	management *ManagementService
	executor   *bridgeTestExecutor
	provider   *bridgeTestProvider
	bridge     *DurableBridge
}

func newBridgeTestFixture(t *testing.T) *bridgeTestFixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:bridge-%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	secrets := secret.NewService(db, secret.StaticKEKProvider{
		Material: []byte("0123456789abcdef0123456789abcdef"),
	})
	bindings := NewBindingService(db, secrets)
	binding, err := bindings.Create(context.Background(), CreateBindingInput{
		ActorPTID: "actor-1", PluginID: "lark", ProviderKind: "lark",
		ProviderAppID: "cli_bridge", AppSecret: "secret",
		AgentID: "agent-1", Enabled: true, AccessMode: AccessModeOpen,
	})
	if err != nil {
		t.Fatal(err)
	}
	management := NewManagementService(db, bindings)
	executor := &bridgeTestExecutor{
		snapshots: map[string]TurnSnapshot{},
		outputs:   map[string][]byte{},
	}
	provider := &bridgeTestProvider{}
	bridge := NewDurableBridge(
		db, bindings, management, executor, provider, provider,
	)
	return &bridgeTestFixture{
		db: db, binding: binding, bindings: bindings,
		management: management, executor: executor,
		provider: provider, bridge: bridge,
	}
}

func bridgeInbound(bindingID, eventID, messageID string) *model.NormalizedInboundEvent {
	return &model.NormalizedInboundEvent{
		BindingId: bindingID, ProviderKind: "lark",
		EventId: eventID, MessageId: messageID,
		ChatId: "chat-1", ChatType: "private",
		SenderId: "user-1", SenderUserId: "user-1",
		MessageType: "text", Text: "hello",
	}
}

func TestDurableBridgeAdmitsOnceAcrossDuplicateAndRestart(t *testing.T) {
	fixture := newBridgeTestFixture(t)
	ctx := context.Background()
	event := bridgeInbound(fixture.binding.ID, "event-1", "message-1")

	first, err := fixture.bridge.AdmitInbound(ctx, "lark", event)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fixture.bridge.AdmitInbound(ctx, "lark", event)
	if err != nil {
		t.Fatal(err)
	}
	if first.GetState() != model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED ||
		second.GetState() != model.InboundAckState_INBOUND_ACK_STATE_DUPLICATE {
		t.Fatalf("unexpected acknowledgements: first=%v second=%v", first, second)
	}
	if len(fixture.executor.admitCalls) != 1 {
		t.Fatalf("turn admissions = %d, want 1", len(fixture.executor.admitCalls))
	}

	restartedExecutor := &bridgeTestExecutor{
		snapshots: map[string]TurnSnapshot{},
		outputs:   map[string][]byte{},
	}
	restarted := NewDurableBridge(
		fixture.db,
		fixture.bindings,
		fixture.management,
		restartedExecutor,
		fixture.provider,
		fixture.provider,
	)
	replayed, err := restarted.AdmitInbound(ctx, "lark", event)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.GetState() != model.InboundAckState_INBOUND_ACK_STATE_DUPLICATE ||
		len(restartedExecutor.admitCalls) != 0 {
		t.Fatalf("restart replay was not suppressed: ack=%v admissions=%d",
			replayed, len(restartedExecutor.admitCalls))
	}

	conflict := proto.Clone(event).(*model.NormalizedInboundEvent)
	conflict.Text = "different"
	if _, err := restarted.AdmitInbound(ctx, "lark", conflict); err == nil {
		t.Fatal("same event identity with a different payload must fail")
	}
}

func TestDurableBridgeStreamsTerminalCardAndRecordsFeedbackOnce(t *testing.T) {
	fixture := newBridgeTestFixture(t)
	ctx := context.Background()
	event := bridgeInbound(fixture.binding.ID, "event-card", "message-card")
	ack, err := fixture.bridge.AdmitInbound(ctx, "lark", event)
	if err != nil {
		t.Fatal(err)
	}
	turnID := ack.GetTurnId()
	fixture.executor.setSnapshot(TurnSnapshot{
		TurnID: turnID, Status: "running", Text: "Working",
		Revision: 1,
	})
	fixture.bridge.projectPendingTurns(ctx)
	fixture.provider.receipts = append(fixture.provider.receipts,
		&model.DeliveryReceipt{
			Ok: true, ProviderMessageId: "provider-card",
			DeliveredAtUnixMs: time.Now().UnixMilli(),
		},
	)
	fixture.bridge.deliverPending(ctx)

	fixture.executor.setSnapshot(TurnSnapshot{
		TurnID: turnID, Status: "completed", Text: "Done",
		Revision: 2,
	})
	fixture.bridge.projectPendingTurns(ctx)
	fixture.provider.receipts = append(fixture.provider.receipts,
		&model.DeliveryReceipt{
			Ok: true, ProviderMessageId: "provider-card",
			DeliveredAtUnixMs: time.Now().UnixMilli(),
		},
	)
	fixture.bridge.deliverPending(ctx)

	if len(fixture.provider.deliveries) != 2 {
		t.Fatalf("deliveries = %d, want 2", len(fixture.provider.deliveries))
	}
	if fixture.provider.deliveries[0].GetOperation() !=
		model.DeliveryOperation_DELIVERY_OPERATION_REPLY {
		t.Fatalf("first operation = %s", fixture.provider.deliveries[0].GetOperation())
	}
	if fixture.provider.deliveries[1].GetOperation() !=
		model.DeliveryOperation_DELIVERY_OPERATION_UPDATE {
		t.Fatalf("terminal operation = %s", fixture.provider.deliveries[1].GetOperation())
	}

	fixture.executor.setSnapshot(TurnSnapshot{
		TurnID: turnID, Status: "running", Text: "stale",
		Revision: 1,
	})
	fixture.bridge.projectPendingTurns(ctx)
	var intent persistence.ChannelDeliveryIntent
	if err := fixture.db.Where(
		"inbound_id = ? AND intent_kind = ?", ack.GetInboundId(), "turn_reply",
	).First(&intent).Error; err != nil {
		t.Fatal(err)
	}
	if !intent.Terminal || intent.Revision != 2 || intent.Text != "Done" {
		t.Fatalf("terminal fence regressed: %+v", intent)
	}

	fixture.executor.setSnapshot(TurnSnapshot{
		TurnID: turnID, Status: "completed", Text: "Done",
		Revision: 2,
	})
	value, _ := json.Marshal(map[string]any{
		"action": "positive_feedback", "turn_id": turnID,
		"snapshot_revision": 2,
	})
	action := &model.CardActionEvent{
		BindingId: fixture.binding.ID, ActionId: "feedback-1",
		MessageId: "provider-card", OpenId: "user-1",
		Action: "positive_feedback", ValueJson: string(value),
	}
	for range 2 {
		result, err := fixture.bridge.HandleCardAction(ctx, "lark", action)
		if err != nil || !result.GetOk() {
			t.Fatalf("feedback action failed: result=%v err=%v", result, err)
		}
	}
	if len(fixture.executor.feedback) != 1 ||
		!fixture.executor.feedback[0].Positive {
		t.Fatalf("feedback was not recorded once: %+v", fixture.executor.feedback)
	}
}

func TestDurableBridgeUnknownDeliveryRetriesWithoutTurnExecution(t *testing.T) {
	fixture := newBridgeTestFixture(t)
	ctx := context.Background()
	deliveryID, err := fixture.bridge.Send(
		ctx, fixture.binding.ID, "chat-1", "test", "manual-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.provider.receipts = append(fixture.provider.receipts,
		&model.DeliveryReceipt{
			DeliveryId: deliveryID, ErrorCategory: "unknown",
			ErrorMessage: "timeout after submit",
		},
	)
	fixture.bridge.deliverPending(ctx)
	status, err := fixture.bridge.deliveryStatus(
		ctx, fixture.binding.ID, deliveryID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != deliveryStatusUnknown {
		t.Fatalf("status = %q, want unknown", status.Status)
	}
	if err := fixture.bridge.RetryDelivery(
		ctx, "actor-1", fixture.binding.ID, deliveryID,
	); err != nil {
		t.Fatal(err)
	}
	fixture.provider.receipts = append(fixture.provider.receipts,
		&model.DeliveryReceipt{
			DeliveryId: deliveryID, Ok: true,
			ProviderMessageId: "provider-manual",
		},
	)
	fixture.bridge.deliverPending(ctx)
	if len(fixture.provider.deliveries) != 2 {
		t.Fatalf("delivery attempts = %d, want 2", len(fixture.provider.deliveries))
	}
	if len(fixture.executor.admitCalls) != 0 {
		t.Fatalf("delivery retry reran a turn: %d admissions", len(fixture.executor.admitCalls))
	}
}

func TestDurableBridgeCarriesImageBytesAndIsolatesGroupTopics(t *testing.T) {
	fixture := newBridgeTestFixture(t)
	ctx := context.Background()
	fixture.provider.fetched = AttachmentPayload{
		AttachmentID: "attachment-1", FileName: "proof.png",
		MIMEType: "image/png", Body: []byte("image-bytes"),
	}
	image := bridgeInbound(fixture.binding.ID, "event-image", "message-image")
	image.MessageType = "image"
	image.Text = ""
	image.Resources = []*model.ChannelResourceRef{{
		ProviderKey: "image-key", Kind: "image", MimeType: "image/png",
	}}
	if _, err := fixture.bridge.AdmitInbound(ctx, "lark", image); err != nil {
		t.Fatal(err)
	}
	if got := fixture.executor.admitCalls[0].Attachments; len(got) != 1 ||
		string(got[0].Body) != "image-bytes" {
		t.Fatalf("image bytes did not reach admission: %+v", got)
	}

	mode := "all"
	threadIsolation := true
	if _, _, err := fixture.bindings.Update(
		ctx,
		"actor-1",
		fixture.binding.ID,
		UpdateInput{
			GroupResponseMode: &mode,
			ThreadIsolation:   &threadIsolation,
		},
	); err != nil {
		t.Fatal(err)
	}
	for index, rootID := range []string{"root-a", "root-b"} {
		event := bridgeInbound(
			fixture.binding.ID,
			fmt.Sprintf("event-group-%d", index),
			fmt.Sprintf("message-group-%d", index),
		)
		event.ChatType = "group"
		event.ChatId = "group-1"
		event.RootId = rootID
		if _, err := fixture.bridge.AdmitInbound(ctx, "lark", event); err != nil {
			t.Fatal(err)
		}
	}
	var links []persistence.ChannelConversationLink
	if err := fixture.db.Where(
		"binding_id = ? AND chat_id = ?", fixture.binding.ID, "group-1",
	).Find(&links).Error; err != nil {
		t.Fatal(err)
	}
	if len(links) != 2 || links[0].ConversationID == links[1].ConversationID {
		t.Fatalf("group topics were not isolated: %+v", links)
	}

	botEvent := bridgeInbound(fixture.binding.ID, "event-bot", "message-bot")
	botEvent.SenderIsBot = true
	result, err := fixture.bridge.AdmitInbound(ctx, "lark", botEvent)
	if err != nil {
		t.Fatal(err)
	}
	if result.GetState() != model.InboundAckState_INBOUND_ACK_STATE_IGNORED {
		t.Fatalf("bot loop was not suppressed: %+v", result)
	}
}
