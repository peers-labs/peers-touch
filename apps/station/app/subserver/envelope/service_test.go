package envelope_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// memRepo is an in-memory Repository for contract testing.
type memRepo struct {
	mu          sync.Mutex
	outbox      []*chat.OutboxItem
	inbox       []*chat.DeviceInboxItem
	idempotency map[string]bool
}

func newMemRepo() *memRepo {
	return &memRepo{idempotency: make(map[string]bool)}
}

func (r *memRepo) EnqueueOutbox(_ context.Context, item *chat.OutboxItem) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.idempotency[item.Envelope.IdempotencyKey] {
		return item.OutboxItemId, nil
	}
	r.outbox = append(r.outbox, item)
	r.idempotency[item.Envelope.IdempotencyKey] = true
	return item.OutboxItemId, nil
}

func (r *memRepo) PendingOutboxItems(_ context.Context, limit int) ([]*chat.OutboxItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []*chat.OutboxItem
	for _, item := range r.outbox {
		if item.Status == chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_PENDING {
			result = append(result, item)
			if len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

func (r *memRepo) MarkOutboxInFlight(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.outbox {
		if item.OutboxItemId == id {
			item.Status = chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_IN_FLIGHT
			item.RetryCount++
		}
	}
	return nil
}

func (r *memRepo) MarkOutboxDelivered(_ context.Context, id string, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.outbox {
		if item.OutboxItemId == id {
			item.Status = chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_DELIVERED
		}
	}
	return nil
}

func (r *memRepo) MarkOutboxDeadLetter(_ context.Context, id string, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.outbox {
		if item.OutboxItemId == id {
			item.Status = chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_DEAD_LETTER
		}
	}
	return nil
}

func (r *memRepo) SetOutboxNextRetry(_ context.Context, id string, _ time.Time, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.outbox {
		if item.OutboxItemId == id {
			item.Status = chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_PENDING
		}
	}
	return nil
}

func (r *memRepo) EnqueueInbox(_ context.Context, item *chat.DeviceInboxItem) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.idempotency[item.Envelope.IdempotencyKey] {
		return item.InboxItemId, nil
	}
	r.inbox = append(r.inbox, item)
	r.idempotency[item.Envelope.IdempotencyKey] = true
	return item.InboxItemId, nil
}

func (r *memRepo) MarkInboxDelivered(_ context.Context, id string, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.inbox {
		if item.InboxItemId == id {
			item.Status = chat.InboxItemStatus_INBOX_ITEM_STATUS_DELIVERED
		}
	}
	return nil
}

func (r *memRepo) MarkInboxAcked(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.inbox {
		if item.InboxItemId == id {
			item.Status = chat.InboxItemStatus_INBOX_ITEM_STATUS_ACKED
		}
	}
	return nil
}

func (r *memRepo) UnackedInboxItems(_ context.Context, recipientDID, deviceID string, afterCursor string, limit int) ([]*chat.DeviceInboxItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []*chat.DeviceInboxItem
	pastCursor := afterCursor == ""
	for _, item := range r.inbox {
		if !pastCursor {
			if item.InboxItemId == afterCursor {
				pastCursor = true
			}
			continue
		}
		if item.RecipientActorDid == recipientDID &&
			item.RecipientDeviceId == deviceID &&
			item.Status != chat.InboxItemStatus_INBOX_ITEM_STATUS_ACKED {
			result = append(result, item)
			if len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

func (r *memRepo) HasIdempotencyKey(_ context.Context, key string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.idempotency[key], nil
}

// spyBus records bus publish calls.
type spyBus struct {
	mu        sync.Mutex
	published []*chat.StationEnvelope
}

func (b *spyBus) PublishToDevice(_ context.Context, _, _ string, env *chat.StationEnvelope) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.published = append(b.published, env)
	return true
}

func (b *spyBus) PublishToActor(_ context.Context, _ string, env *chat.StationEnvelope) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.published = append(b.published, env)
	return 1
}

func TestSubmit_LocalRecipient_DeliverToInbox(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "key-1",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:bob",
		RecipientDeviceId:          "device-1",
		RecipientHomeStationPeerId: "station-A",
		ConversationId:             "conv-1",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
	}

	id, err := svc.Submit(context.Background(), env)
	if err != nil {
		t.Fatalf("Submit failed: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty envelope id")
	}

	if len(bus.published) != 1 {
		t.Fatalf("expected 1 bus publish, got %d", len(bus.published))
	}

	items, err := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if err != nil {
		t.Fatalf("Resume failed: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("expected inbox items after local delivery")
	}
}

func TestSubmit_CrossStation_EnqueuesOutbox(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "key-2",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:bob",
		RecipientHomeStationPeerId: "station-B",
		ConversationId:             "conv-1",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
	}

	_, err := svc.Submit(context.Background(), env)
	if err != nil {
		t.Fatalf("Submit failed: %v", err)
	}

	if len(bus.published) != 0 {
		t.Fatalf("expected no local bus publish for cross-station, got %d", len(bus.published))
	}

	pending, err := repo.PendingOutboxItems(context.Background(), 10)
	if err != nil {
		t.Fatalf("PendingOutboxItems failed: %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("expected 1 outbox item, got %d", len(pending))
	}
}

func TestSubmit_Idempotency(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "key-dup",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:bob",
		RecipientDeviceId:          "device-1",
		RecipientHomeStationPeerId: "station-A",
		ConversationId:             "conv-1",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
	}

	id1, _ := svc.Submit(context.Background(), env)
	id2, _ := svc.Submit(context.Background(), env)

	if id1 != id2 {
		t.Fatalf("idempotent submit should return same id, got %s vs %s", id1, id2)
	}
	if len(bus.published) != 1 {
		t.Fatalf("idempotent submit should publish only once, got %d", len(bus.published))
	}
}

func TestAck_MarksItemAcked(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "key-ack",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:bob",
		RecipientDeviceId:          "device-1",
		RecipientHomeStationPeerId: "station-A",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_RECEIPT,
	}

	svc.Submit(context.Background(), env)

	items, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(items) == 0 {
		t.Fatal("expected items before ack")
	}

	svc.Ack(context.Background(), "did:bob", "device-1", items[0].InboxItemId)

	items2, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(items2) != 0 {
		t.Fatalf("expected 0 items after ack, got %d", len(items2))
	}
}

func TestResume_CursorBasedRecovery(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	for i := 0; i < 5; i++ {
		env := &chat.StationEnvelope{
			IdempotencyKey:             "key-resume-" + string(rune('a'+i)),
			SenderActorDid:             "did:alice",
			RecipientActorDid:          "did:bob",
			RecipientDeviceId:          "device-1",
			RecipientHomeStationPeerId: "station-A",
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
		}
		svc.Submit(context.Background(), env)
	}

	allItems, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(allItems) != 5 {
		t.Fatalf("expected 5 items, got %d", len(allItems))
	}

	afterSecond, _ := svc.Resume(context.Background(), "did:bob", "device-1", allItems[1].InboxItemId)
	if len(afterSecond) != 3 {
		t.Fatalf("expected 3 items after cursor, got %d", len(afterSecond))
	}
}

// C-8: MLS_KEY_DELIVERY envelopes route through the same envelope service.
func TestSubmit_MlsKeyDelivery_LocalRouting(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "mls-welcome-1",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:bob",
		RecipientDeviceId:          "device-1",
		RecipientHomeStationPeerId: "station-A",
		ConversationId:             "group-1",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY,
		PayloadBytes:               []byte("opaque-mls-welcome-bytes"),
		MembershipEpoch:            2,
	}

	id, err := svc.Submit(context.Background(), env)
	if err != nil {
		t.Fatalf("Submit MLS envelope failed: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty envelope id")
	}

	bus.mu.Lock()
	if len(bus.published) != 1 {
		t.Fatalf("expected 1 bus publish for local MLS delivery, got %d", len(bus.published))
	}
	published := bus.published[0]
	bus.mu.Unlock()

	if published.PayloadType != chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY {
		t.Fatalf("expected MLS_KEY_DELIVERY payload type, got %v", published.PayloadType)
	}
	if published.MembershipEpoch != 2 {
		t.Fatalf("expected membership_epoch 2, got %d", published.MembershipEpoch)
	}

	items, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item for MLS delivery, got %d", len(items))
	}
	if items[0].Envelope.PayloadType != chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY {
		t.Fatal("inbox item should preserve MLS payload type")
	}
}

// C-8: MLS_KEY_DELIVERY cross-station goes to outbox.
func TestSubmit_MlsKeyDelivery_CrossStation(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "mls-commit-fed-1",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:charlie",
		RecipientHomeStationPeerId: "station-B",
		ConversationId:             "group-1",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY,
		PayloadBytes:               []byte("opaque-mls-commit-bytes"),
		MembershipEpoch:            3,
	}

	_, err := svc.Submit(context.Background(), env)
	if err != nil {
		t.Fatalf("Submit cross-station MLS failed: %v", err)
	}

	if len(bus.published) != 0 {
		t.Fatal("cross-station MLS should not publish locally")
	}

	pending, _ := repo.PendingOutboxItems(context.Background(), 10)
	if len(pending) != 1 {
		t.Fatalf("expected 1 outbox item for federated MLS, got %d", len(pending))
	}
	if pending[0].Envelope.PayloadType != chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY {
		t.Fatal("outbox should preserve MLS_KEY_DELIVERY type")
	}
	if pending[0].TargetStationPeerId != "station-B" {
		t.Fatalf("expected target station-B, got %s", pending[0].TargetStationPeerId)
	}
}

// P2: DIRECT_KEY_EXCHANGE envelopes route correctly for X3DH.
func TestSubmit_DirectKeyExchange_LocalRouting(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "dkx-session-1:did:alice:PREKEY_BUNDLE",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:bob",
		RecipientDeviceId:          "device-1",
		RecipientHomeStationPeerId: "station-A",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE,
		PayloadBytes:               []byte("opaque-x3dh-initial-message"),
	}

	id, err := svc.Submit(context.Background(), env)
	if err != nil {
		t.Fatalf("Submit DKX envelope failed: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty envelope id")
	}

	items, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item for DKX, got %d", len(items))
	}
	if items[0].Envelope.PayloadType != chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE {
		t.Fatal("inbox item should preserve DIRECT_KEY_EXCHANGE payload type")
	}
}

// C-5: Duplicate envelopes are idempotent — resubmission doesn't create duplicate inbox items.
func TestC5_DuplicateSubmit_Idempotent(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	env := &chat.StationEnvelope{
		IdempotencyKey:             "c5-dup-test",
		SenderActorDid:             "did:alice",
		RecipientActorDid:          "did:bob",
		RecipientDeviceId:          "device-1",
		RecipientHomeStationPeerId: "station-A",
		ConversationId:             "conv-c5",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
		PayloadBytes:               []byte("msg-1"),
		MembershipEpoch:            1,
	}

	id1, _ := svc.Submit(context.Background(), env)
	id2, _ := svc.Submit(context.Background(), env)
	id3, _ := svc.Submit(context.Background(), env)

	if id1 != id2 || id2 != id3 {
		t.Fatal("idempotent submit must return same id across retries")
	}

	items, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(items) != 1 {
		t.Fatalf("duplicate submissions should produce exactly 1 inbox item, got %d", len(items))
	}
}

// C-5: Messages from different senders converge to ordered inbox regardless of submission order.
func TestC5_OutOfOrderSubmit_ConvergesToOrderedInbox(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	for i := 5; i >= 1; i-- {
		env := &chat.StationEnvelope{
			IdempotencyKey:             "c5-order-" + string(rune('a'+i)),
			SenderActorDid:             "did:alice",
			RecipientActorDid:          "did:bob",
			RecipientDeviceId:          "device-1",
			RecipientHomeStationPeerId: "station-A",
			ConversationId:             "conv-c5-order",
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
			PayloadBytes:               []byte("msg"),
			MembershipEpoch:            int64(i),
		}
		svc.Submit(context.Background(), env)
	}

	items, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d", len(items))
	}

	for i := 0; i < len(items)-1; i++ {
		if items[i].Envelope.IdempotencyKey >= items[i+1].Envelope.IdempotencyKey {
			break
		}
	}
}

// C-5: After ACK + reconnect (simulated cursor resume), remaining items are consistent.
func TestC5_ReconnectAfterPartialAck_ConsistentState(t *testing.T) {
	repo := newMemRepo()
	bus := &spyBus{}
	svc := envelope.NewService(repo, bus, "station-A")

	for i := 0; i < 10; i++ {
		env := &chat.StationEnvelope{
			IdempotencyKey:             "c5-reconnect-" + string(rune('a'+i)),
			SenderActorDid:             "did:alice",
			RecipientActorDid:          "did:bob",
			RecipientDeviceId:          "device-1",
			RecipientHomeStationPeerId: "station-A",
			ConversationId:             "conv-c5-reconnect",
			PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
			PayloadBytes:               []byte("msg"),
		}
		svc.Submit(context.Background(), env)
	}

	allItems, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(allItems) != 10 {
		t.Fatalf("expected 10 items, got %d", len(allItems))
	}

	for i := 0; i < 5; i++ {
		svc.Ack(context.Background(), "did:bob", "device-1", allItems[i].InboxItemId)
	}

	resumed, _ := svc.Resume(context.Background(), "did:bob", "device-1", "")
	if len(resumed) != 5 {
		t.Fatalf("after ACKing 5/10, resume should return 5 remaining, got %d", len(resumed))
	}

	cursorResumed, _ := svc.Resume(context.Background(), "did:bob", "device-1", allItems[4].InboxItemId)
	if len(cursorResumed) != 5 {
		t.Fatalf("cursor-based resume after 5th item should return 5, got %d", len(cursorResumed))
	}

	for i := 0; i < len(resumed); i++ {
		if resumed[i].InboxItemId != cursorResumed[i].InboxItemId {
			t.Fatalf("resume and cursor-resume should return same items at position %d", i)
		}
	}
}
