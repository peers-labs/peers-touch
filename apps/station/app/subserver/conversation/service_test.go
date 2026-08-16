package conversation_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation"
	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// memConvRepo is an in-memory Repository for contract testing.
type memConvRepo struct {
	mu       sync.Mutex
	convs    map[string]*chat.Conversation
	members  map[string][]*chat.ConversationMember
	devices  map[string][]conversation.MemberDevice
	events   map[string][]*chat.CommittedConversationEvent
	seqs     map[string]int64
	receipts map[string]*conversation.CommandReceipt
}

func newMemConvRepo() *memConvRepo {
	return &memConvRepo{
		convs:    make(map[string]*chat.Conversation),
		members:  make(map[string][]*chat.ConversationMember),
		devices:  make(map[string][]conversation.MemberDevice),
		events:   make(map[string][]*chat.CommittedConversationEvent),
		seqs:     make(map[string]int64),
		receipts: make(map[string]*conversation.CommandReceipt),
	}
}

func (r *memConvRepo) UpsertConversation(_ context.Context, conv *chat.Conversation) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.convs[conv.ConversationId] = conv
	return nil
}

func (r *memConvRepo) GetConversation(_ context.Context, id string) (*chat.Conversation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.convs[id]; ok {
		return c, nil
	}
	return nil, nil
}

func (r *memConvRepo) GetConversationForUpdate(ctx context.Context, id string) (*chat.Conversation, error) {
	return r.GetConversation(ctx, id)
}

func (r *memConvRepo) ListByActor(_ context.Context, ptid string) ([]*chat.Conversation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []*chat.Conversation
	for convID, members := range r.members {
		for _, m := range members {
			if m.Ptid == ptid && m.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
				if conv, ok := r.convs[convID]; ok {
					result = append(result, conv)
				}
			}
		}
	}
	return result, nil
}

func (r *memConvRepo) UpsertMember(_ context.Context, member *chat.ConversationMember) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	members := r.members[member.ConversationId]
	for i, m := range members {
		if m.Ptid == member.Ptid {
			members[i] = member
			return nil
		}
	}
	r.members[member.ConversationId] = append(members, member)
	return nil
}

func (r *memConvRepo) UpsertMemberDevice(
	_ context.Context,
	conversationID string,
	ptid string,
	deviceID string,
	homeStationPeerID string,
	active bool,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	devices := r.devices[conversationID]
	for index, device := range devices {
		if device.Ptid == ptid && device.DeviceID == deviceID {
			devices[index].HomeStationPeerID = homeStationPeerID
			devices[index].Active = active
			r.devices[conversationID] = devices
			return nil
		}
	}
	r.devices[conversationID] = append(devices, conversation.MemberDevice{
		Ptid:              ptid,
		DeviceID:          deviceID,
		HomeStationPeerID: homeStationPeerID,
		Active:            active,
	})
	return nil
}

func (r *memConvRepo) ListMemberDevices(
	_ context.Context,
	conversationID string,
	activeOnly bool,
) ([]conversation.MemberDevice, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	devices := make([]conversation.MemberDevice, 0, len(r.devices[conversationID]))
	for _, device := range r.devices[conversationID] {
		if activeOnly && !device.Active {
			continue
		}
		devices = append(devices, device)
	}
	return devices, nil
}

func (r *memConvRepo) GetMembers(_ context.Context, conversationID string) ([]*chat.ConversationMember, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.members[conversationID], nil
}

func (r *memConvRepo) GetMember(_ context.Context, conversationID, ptid string) (*chat.ConversationMember, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.members[conversationID] {
		if m.Ptid == ptid {
			return m, nil
		}
	}
	return nil, nil
}

func (r *memConvRepo) AppendEvent(_ context.Context, event *chat.CommittedConversationEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events[event.ConversationId] = append(r.events[event.ConversationId], event)
	if event.GroupSeq > r.seqs[event.ConversationId] {
		r.seqs[event.ConversationId] = event.GroupSeq
	}
	return nil
}

func (r *memConvRepo) GetEventByTransitionID(
	_ context.Context,
	conversationID string,
	transitionID string,
) (*chat.CommittedConversationEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, event := range r.events[conversationID] {
		if event.GetMembershipTransitionCommitted().GetTransitionId() == transitionID {
			return event, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func (r *memConvRepo) GetLastEvent(
	_ context.Context,
	conversationID string,
) (*chat.CommittedConversationEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	events := r.events[conversationID]
	if len(events) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return events[len(events)-1], nil
}

func (r *memConvRepo) GetCommandReceipt(
	_ context.Context,
	conversationID string,
	commandID string,
) (*conversation.CommandReceipt, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	receipt, ok := r.receipts[conversationID+":"+commandID]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return receipt, nil
}

func (r *memConvRepo) CreateCommandReceipt(
	_ context.Context,
	receipt *conversation.CommandReceipt,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.receipts[receipt.ConversationID+":"+receipt.CommandID] = receipt
	return nil
}

func (r *memConvRepo) ListEvents(_ context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []*chat.CommittedConversationEvent
	for _, ev := range r.events[conversationID] {
		if ev.GroupSeq > afterSeq {
			result = append(result, ev)
			if len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

func (r *memConvRepo) NextSeq(_ context.Context, conversationID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seqs[conversationID]++
	return r.seqs[conversationID], nil
}

func (r *memConvRepo) BumpMembershipEpoch(_ context.Context, conversationID string, newEpoch int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if conv, ok := r.convs[conversationID]; ok {
		conv.MembershipEpoch = newEpoch
	}
	return nil
}

func (r *memConvRepo) SetMembershipAndMlsEpoch(
	_ context.Context,
	conversationID string,
	membershipEpoch int64,
	mlsEpoch int64,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if conv, ok := r.convs[conversationID]; ok {
		conv.MembershipEpoch = membershipEpoch
		conv.MlsEpoch = mlsEpoch
	}
	return nil
}

func (r *memConvRepo) HaveSharedConversation(_ context.Context, actorA, actorB string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, members := range r.members {
		hasA, hasB := false, false
		for _, m := range members {
			if m.Ptid == actorA && m.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
				hasA = true
			}
			if m.Ptid == actorB && m.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
				hasB = true
			}
		}
		if hasA && hasB {
			return true, nil
		}
	}
	return false, nil
}

func (r *memConvRepo) ListThreadEvents(_ context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	return nil, nil
}

func (r *memConvRepo) CountThreadReplies(_ context.Context, conversationID string, rootIDs []string) (map[string]conversation.ThreadSummary, error) {
	return make(map[string]conversation.ThreadSummary), nil
}

func (r *memConvRepo) GetReadCursor(_ context.Context, conversationID, ptid string) (int64, error) {
	return 0, nil
}

func (r *memConvRepo) SetReadCursor(_ context.Context, conversationID, ptid string, seq int64) error {
	return nil
}

func (r *memConvRepo) CountUnread(_ context.Context, conversationID, ptid string) (int64, error) {
	return 0, nil
}

type spyEnvelope struct {
	mu         sync.Mutex
	events     []*chat.CommittedConversationEvent
	receipts   []*chat.MessageReceipt
	receiptErr error
	inbox      []*chat.DeviceInboxItem
	outbox     []*chat.OutboxItem
	notified   []*chat.DeviceInboxItem
}

func (s *spyEnvelope) SubmitEvent(_ context.Context, _ *chat.Conversation, _ []*chat.ConversationMember, event *chat.CommittedConversationEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
	return nil
}

func (s *spyEnvelope) SubmitReceipt(_ context.Context, receipt *chat.MessageReceipt, _, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.receipts = append(s.receipts, receipt)
	return s.receiptErr
}

func (s *spyEnvelope) NotifyPersisted(_ context.Context, item *chat.DeviceInboxItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.notified = append(s.notified, item)
}

func (s *spyEnvelope) EnqueueOutbox(_ context.Context, item *chat.OutboxItem) (string, error) {
	s.outbox = append(s.outbox, item)
	return item.OutboxItemId, nil
}

func (s *spyEnvelope) PendingOutboxItems(context.Context, int) ([]*chat.OutboxItem, error) {
	return nil, nil
}

func (s *spyEnvelope) MarkOutboxInFlight(context.Context, string) error { return nil }
func (s *spyEnvelope) MarkOutboxDelivered(context.Context, string, time.Time) error {
	return nil
}
func (s *spyEnvelope) MarkOutboxDeadLetter(context.Context, string, string) error {
	return nil
}
func (s *spyEnvelope) SetOutboxNextRetry(context.Context, string, time.Time, string) error {
	return nil
}
func (s *spyEnvelope) EnqueueInbox(_ context.Context, item *chat.DeviceInboxItem) (string, error) {
	s.inbox = append(s.inbox, item)
	return item.InboxItemId, nil
}
func (s *spyEnvelope) MarkInboxDelivered(context.Context, string, time.Time) error { return nil }
func (s *spyEnvelope) MarkInboxAcked(context.Context, string) error                { return nil }
func (s *spyEnvelope) UnackedInboxItems(context.Context, string, string, string, int) ([]*chat.DeviceInboxItem, error) {
	return nil, nil
}
func (s *spyEnvelope) HasIdempotencyKey(context.Context, string) (bool, error) {
	return false, nil
}

type memUnitOfWork struct {
	repo     *memConvRepo
	envelope envpkg.Repository
}

func (u memUnitOfWork) Execute(
	ctx context.Context,
	fn func(conversation.TransitionRepositories) error,
) error {
	return fn(conversation.TransitionRepositories{
		Conversation: u.repo,
		Envelope:     u.envelope,
	})
}

func newMemService(repo *memConvRepo, spy *spyEnvelope) *conversation.DefaultService {
	return conversation.NewConversationService(
		repo,
		spy,
		"station-A",
		memUnitOfWork{repo: repo, envelope: spy},
	)
}

func seedGroup(t *testing.T, repo *memConvRepo, members ...*chat.ConversationMember) *chat.Conversation {
	t.Helper()
	now := timestamppb.New(time.Now())
	conv := &chat.Conversation{
		ConversationId:         "group-" + time.Now().Format("150405.000000000"),
		Kind:                   chat.ConversationKind_CONVERSATION_KIND_GROUP,
		AuthorityStationPeerId: "station-A",
		MembershipEpoch:        1,
		MlsEpoch:               1,
		Status:                 chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE,
		OwnerPtid:              "did:alice",
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	if err := repo.UpsertConversation(context.Background(), conv); err != nil {
		t.Fatal(err)
	}
	for _, member := range members {
		member.ConversationId = conv.ConversationId
		if member.JoinedAt == nil {
			member.JoinedAt = now
		}
		if err := repo.UpsertMember(context.Background(), member); err != nil {
			t.Fatal(err)
		}
	}
	return conv
}

func directPayload(ptid, deviceID, ciphertext string) *chat.DeviceEncryptedPayload {
	return &chat.DeviceEncryptedPayload{
		RecipientPtid:     ptid,
		RecipientDeviceId: deviceID,
		SessionId:         "session:" + ptid + ":" + deviceID,
		EncryptedEnvelope: []byte(ciphertext),
	}
}

func TestCreateDirect_DeterministicID(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)

	conv1, err := svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-B")
	if err != nil {
		t.Fatalf("CreateDirect failed: %v", err)
	}

	conv2, err := svc.CreateDirect(context.Background(), "did:bob", "did:alice", "station-B", "station-A")
	if err != nil {
		t.Fatalf("CreateDirect (reverse) failed: %v", err)
	}

	if conv1.ConversationId != conv2.ConversationId {
		t.Fatalf("expected deterministic ID, got %s vs %s", conv1.ConversationId, conv2.ConversationId)
	}
	if conv1.Kind != chat.ConversationKind_CONVERSATION_KIND_DIRECT {
		t.Fatalf("expected DIRECT kind, got %v", conv1.Kind)
	}
}

func TestCreateDirect_Idempotent(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)

	conv1, _ := svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	conv2, _ := svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")

	if conv1.ConversationId != conv2.ConversationId {
		t.Fatal("expected same conversation on repeated create")
	}
}

func TestSubmitCommand_SendMessage(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: convID,
		SenderPtid:     "did:alice",
		SenderDeviceId: "device-1",
		ClientTs:       timestamppb.New(time.Now()),
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				DevicePayloads: []*chat.DeviceEncryptedPayload{
					directPayload("did:bob", "bob-device", "hello bob"),
				},
				ContentType: chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}

	event, err := svc.SubmitCommand(context.Background(), cmd)
	if err != nil {
		t.Fatalf("SubmitCommand failed: %v", err)
	}
	if event == nil {
		t.Fatal("expected non-nil event")
	}

	msgEvent := event.GetMessageCommitted()
	if msgEvent == nil {
		t.Fatal("expected MessageCommittedEvent")
	}
	if msgEvent.SenderPtid != "did:alice" {
		t.Fatalf("expected sender did:alice, got %s", msgEvent.SenderPtid)
	}
	if len(msgEvent.DevicePayloads) != 1 ||
		string(msgEvent.DevicePayloads[0].EncryptedEnvelope) != "hello bob" {
		t.Fatalf("payload mismatch")
	}
	if len(event.EventHash) != 32 {
		t.Fatalf("event hash length = %d, want 32", len(event.EventHash))
	}
	if len(event.PrevEventHash) != 32 {
		t.Fatalf("previous event hash length = %d, want 32", len(event.PrevEventHash))
	}

	if len(spy.events) != 1 || len(spy.inbox) != 1 {
		t.Fatalf(
			"delivery facts = events:%d inbox:%d, want create event:1 command inbox:1",
			len(spy.events),
			len(spy.inbox),
		)
	}
	if spy.inbox[0].RecipientPtid != "did:bob" ||
		spy.inbox[0].RecipientDeviceId != "bob-device" {
		t.Fatalf("direct delivery target = %s/%s", spy.inbox[0].RecipientPtid, spy.inbox[0].RecipientDeviceId)
	}
}

func TestSubmitCommand_DirectRejectsIncompleteDevicePayloads(t *testing.T) {
	tests := map[string][]*chat.DeviceEncryptedPayload{
		"empty": nil,
		"blank recipient device": {{
			RecipientPtid:     "did:bob",
			SessionId:         "session-1",
			EncryptedEnvelope: []byte("ciphertext"),
		}},
		"non-member recipient": {
			directPayload("did:mallory", "mallory-device", "ciphertext"),
		},
		"sending endpoint": {
			directPayload("did:alice", "alice-device", "ciphertext"),
		},
		"duplicate target": {
			directPayload("did:bob", "bob-device", "ciphertext-1"),
			directPayload("did:bob", "bob-device", "ciphertext-2"),
		},
	}
	for name, payloads := range tests {
		t.Run(name, func(t *testing.T) {
			repo := newMemConvRepo()
			spy := &spyEnvelope{}
			svc := newMemService(repo, spy)
			_, err := svc.CreateDirect(
				context.Background(),
				"did:alice",
				"did:bob",
				"station-A",
				"station-A",
			)
			if err != nil {
				t.Fatal(err)
			}
			convID := conversation.DeterministicDirectID("did:alice", "did:bob")
			eventCount := len(repo.events[convID])
			_, err = svc.SubmitCommand(context.Background(), &chat.ConversationCommand{
				CommandId:      uuid.NewString(),
				ConversationId: convID,
				SenderPtid:     "did:alice",
				SenderDeviceId: "alice-device",
				Payload: &chat.ConversationCommand_SendMessage{
					SendMessage: &chat.SendMessageCommand{
						DevicePayloads: payloads,
					},
				},
			})
			if err == nil {
				t.Fatal("expected incomplete direct payload rejection")
			}
			if len(repo.events[convID]) != eventCount || len(spy.inbox) != 0 {
				t.Fatal("invalid direct payload mutated authority or inbox state")
			}
		})
	}
}

func TestSubmitCommand_GroupRequiresOnlyGroupCiphertext(t *testing.T) {
	for name, send := range map[string]*chat.SendMessageCommand{
		"missing group ciphertext": {},
		"device payload on group": {
			DevicePayloads: []*chat.DeviceEncryptedPayload{
				directPayload("did:bob", "bob-device", "ciphertext"),
			},
			GroupEncryptedPayload: []byte("group-ciphertext"),
		},
	} {
		t.Run(name, func(t *testing.T) {
			repo := newMemConvRepo()
			spy := &spyEnvelope{}
			svc := newMemService(repo, spy)
			conv := seedGroup(t, repo, &chat.ConversationMember{
				Ptid:         "did:alice",
				Role:         chat.MemberRole_MEMBER_ROLE_OWNER,
				MemberStatus: chat.MemberStatus_MEMBER_STATUS_ACTIVE,
			})
			_, err := svc.SubmitCommand(context.Background(), &chat.ConversationCommand{
				CommandId:      uuid.NewString(),
				ConversationId: conv.ConversationId,
				SenderPtid:     "did:alice",
				SenderDeviceId: "alice-device",
				Payload: &chat.ConversationCommand_SendMessage{
					SendMessage: send,
				},
			})
			if err == nil {
				t.Fatal("expected invalid group ciphertext shape rejection")
			}
			if len(repo.events[conv.ConversationId]) != 0 ||
				len(spy.inbox) != 0 ||
				len(spy.outbox) != 0 {
				t.Fatal("invalid group payload mutated authority or delivery state")
			}
		})
	}
}

func TestSubmitCommand_DirectEditCommitsAndDeliversDevicePayload(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)
	_, err := svc.CreateDirect(
		context.Background(),
		"did:alice",
		"did:bob",
		"station-A",
		"station-A",
	)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.SubmitCommand(context.Background(), &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conversation.DeterministicDirectID("did:alice", "did:bob"),
		SenderPtid:     "did:alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_EditMessage{
			EditMessage: &chat.EditMessageCommand{
				TargetMessageId: "message-1",
				DevicePayloads: []*chat.DeviceEncryptedPayload{
					directPayload("did:bob", "bob-device", "edited-ciphertext"),
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit direct edit: %v", err)
	}
	edited := event.GetMessageEdited()
	if edited == nil ||
		len(edited.DevicePayloads) != 1 ||
		string(edited.DevicePayloads[0].EncryptedEnvelope) != "edited-ciphertext" {
		t.Fatalf("unexpected committed edit: %+v", edited)
	}
	if len(spy.inbox) != 1 ||
		spy.inbox[0].RecipientPtid != "did:bob" ||
		spy.inbox[0].RecipientDeviceId != "bob-device" {
		t.Fatalf("unexpected direct edit delivery: %+v", spy.inbox)
	}
}

func TestSubmitCommand_ExactReplayReturnsCanonicalEvent(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)
	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	command := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conversation.DeterministicDirectID("did:alice", "did:bob"),
		SenderPtid:     "did:alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				DevicePayloads: []*chat.DeviceEncryptedPayload{
					directPayload("did:bob", "bob-device", "ciphertext"),
				},
				ContentType: chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	first, err := svc.SubmitCommand(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	inboxCount := len(spy.inbox)
	second, err := svc.SubmitCommand(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if first.EventId != second.EventId || !proto.Equal(first, second) {
		t.Fatal("exact replay did not return the canonical event")
	}
	if len(spy.inbox) != inboxCount {
		t.Fatal("exact replay enqueued duplicate delivery")
	}
}

func TestSubmitCommand_CommandHashConflictRejectsBeforeMutation(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)
	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	command := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conversation.DeterministicDirectID("did:alice", "did:bob"),
		SenderPtid:     "did:alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				DevicePayloads: []*chat.DeviceEncryptedPayload{
					directPayload("did:bob", "bob-device", "ciphertext-a"),
				},
				ContentType: chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	if _, err := svc.SubmitCommand(context.Background(), command); err != nil {
		t.Fatal(err)
	}
	conflict := proto.Clone(command).(*chat.ConversationCommand)
	conflict.GetSendMessage().DevicePayloads[0].EncryptedEnvelope = []byte("ciphertext-b")
	eventCount := len(repo.events[command.ConversationId])
	if _, err := svc.SubmitCommand(context.Background(), conflict); err == nil {
		t.Fatal("expected command hash conflict")
	}
	if len(repo.events[command.ConversationId]) != eventCount {
		t.Fatal("command hash conflict mutated the event log")
	}
}

func TestSubmitCommand_NonMember_Rejected(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: convID,
		SenderPtid:     "did:charlie",
		SenderDeviceId: "charlie-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				DevicePayloads: []*chat.DeviceEncryptedPayload{
					directPayload("did:bob", "bob-device", "intrusion"),
				},
				ContentType: chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}

	_, err := svc.SubmitCommand(context.Background(), cmd)
	if err == nil {
		t.Fatal("expected error for non-member")
	}
}

func TestDeterministicDirectID_Symmetric(t *testing.T) {
	id1 := conversation.DeterministicDirectID("did:alice", "did:bob")
	id2 := conversation.DeterministicDirectID("did:bob", "did:alice")
	if id1 != id2 {
		t.Fatalf("DeterministicDirectID must be symmetric: %s vs %s", id1, id2)
	}
	if id1[:2] != "d-" {
		t.Fatalf("expected d- prefix, got %s", id1[:2])
	}
}

func TestSubmitReceipt_RoutesToOtherMembers(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	receipt := &chat.MessageReceipt{
		ConversationId: convID,
		MessageId:      "msg-001",
		Ptid:           "did:bob",
		DeviceId:       "device-1",
		ReceiptType:    chat.ReceiptType_RECEIPT_TYPE_READ,
	}

	err := svc.SubmitReceipt(context.Background(), receipt)
	if err != nil {
		t.Fatalf("SubmitReceipt failed: %v", err)
	}

	if len(spy.receipts) != 1 {
		t.Fatalf("expected 1 receipt routed, got %d", len(spy.receipts))
	}
	if spy.receipts[0].MessageId != "msg-001" {
		t.Fatalf("expected message_id msg-001, got %s", spy.receipts[0].MessageId)
	}
}

func TestSubmitReceipt_PropagatesDeliveryFailure(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{receiptErr: errors.New("delivery unavailable")}
	svc := newMemService(repo, spy)

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	err := svc.SubmitReceipt(context.Background(), &chat.MessageReceipt{
		ConversationId: convID,
		MessageId:      "msg-001",
		Ptid:           "did:bob",
		DeviceId:       "device-1",
		ReceiptType:    chat.ReceiptType_RECEIPT_TYPE_DELIVERED,
	})
	if err == nil || !strings.Contains(err.Error(), "route receipt failed") {
		t.Fatalf("expected routed receipt failure, got %v", err)
	}
}

func TestListEvents_PaginatedHistory(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	for i := 0; i < 5; i++ {
		cmd := &chat.ConversationCommand{
			CommandId:      uuid.NewString(),
			ConversationId: convID,
			SenderPtid:     "did:alice",
			SenderDeviceId: "device-1",
			Payload: &chat.ConversationCommand_SendMessage{
				SendMessage: &chat.SendMessageCommand{
					DevicePayloads: []*chat.DeviceEncryptedPayload{
						directPayload("did:bob", "bob-device", "msg"),
					},
					ContentType: chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
				},
			},
		}
		svc.SubmitCommand(context.Background(), cmd)
	}

	events, err := svc.ListEvents(context.Background(), convID, 0, 10)
	if err != nil {
		t.Fatalf("ListEvents failed: %v", err)
	}
	if len(events) < 5 {
		t.Fatalf("expected at least 5 events (create + 5 msgs), got %d", len(events))
	}

	afterThird, err := svc.ListEvents(context.Background(), convID, 3, 10)
	if err != nil {
		t.Fatalf("ListEvents with cursor failed: %v", err)
	}
	if len(afterThird) != 3 {
		t.Fatalf("expected 3 events after seq 3 (seq 4 through 6), got %d", len(afterThird))
	}
}

// P2 gate: removed member cannot submit commands.
func TestRemovedMember_CannotSendMessage(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)
	conv := seedGroup(t, repo,
		&chat.ConversationMember{
			Ptid:         "did:alice",
			Role:         chat.MemberRole_MEMBER_ROLE_OWNER,
			MemberStatus: chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		},
		&chat.ConversationMember{
			Ptid:         "did:bob",
			Role:         chat.MemberRole_MEMBER_ROLE_MEMBER,
			MemberStatus: chat.MemberStatus_MEMBER_STATUS_REMOVED,
		},
	)

	sendCmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conv.ConversationId,
		SenderPtid:     "did:bob",
		SenderDeviceId: "bob-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				GroupEncryptedPayload: []byte("should fail"),
				ContentType:           chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	_, err := svc.SubmitCommand(context.Background(), sendCmd)
	if err == nil {
		t.Fatal("expected removed member to be rejected")
	}
}

// P2 gate: left member cannot submit commands.
func TestLeftMember_CannotSendMessage(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)
	conv := seedGroup(t, repo,
		&chat.ConversationMember{
			Ptid:         "did:alice",
			Role:         chat.MemberRole_MEMBER_ROLE_OWNER,
			MemberStatus: chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		},
		&chat.ConversationMember{
			Ptid:         "did:bob",
			Role:         chat.MemberRole_MEMBER_ROLE_MEMBER,
			MemberStatus: chat.MemberStatus_MEMBER_STATUS_LEFT,
		},
	)

	sendCmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conv.ConversationId,
		SenderPtid:     "did:bob",
		SenderDeviceId: "bob-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				GroupEncryptedPayload: []byte("should fail"),
				ContentType:           chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	_, err := svc.SubmitCommand(context.Background(), sendCmd)
	if err == nil {
		t.Fatal("expected left member to be rejected")
	}
}

func TestNonMembershipCommandDoesNotChangeEpoch(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)
	conv := seedGroup(t, repo, &chat.ConversationMember{
		Ptid:         "did:alice",
		Role:         chat.MemberRole_MEMBER_ROLE_OWNER,
		MemberStatus: chat.MemberStatus_MEMBER_STATUS_ACTIVE,
	})
	sendCmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conv.ConversationId,
		SenderPtid:     "did:alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				GroupEncryptedPayload: []byte("hello"),
				ContentType:           chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	event, err := svc.SubmitCommand(context.Background(), sendCmd)
	if err != nil {
		t.Fatal(err)
	}
	if event.MembershipEpoch != 1 {
		t.Fatalf("epoch should stay 1 for message command, got %d", event.MembershipEpoch)
	}
}

// C-8 partial: envelope bridge fans out to all active members.
func TestEnvelopeFanout_OnlyActiveMembers(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)
	conv := seedGroup(t, repo,
		&chat.ConversationMember{
			Ptid:         "did:alice",
			Role:         chat.MemberRole_MEMBER_ROLE_OWNER,
			MemberStatus: chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		},
		&chat.ConversationMember{
			Ptid:         "did:bob",
			Role:         chat.MemberRole_MEMBER_ROLE_MEMBER,
			MemberStatus: chat.MemberStatus_MEMBER_STATUS_REMOVED,
		},
		&chat.ConversationMember{
			Ptid:                   "did:charlie",
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
			MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
			ActorHomeStationPeerId: "station-B",
		},
	)
	if err := repo.UpsertMemberDevice(
		context.Background(),
		conv.ConversationId,
		"did:alice",
		"alice-device",
		"station-A",
		true,
	); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpsertMemberDevice(
		context.Background(),
		conv.ConversationId,
		"did:charlie",
		"charlie-device",
		"station-B",
		true,
	); err != nil {
		t.Fatal(err)
	}

	spy.mu.Lock()
	spy.events = nil
	spy.mu.Unlock()

	// Send message — should only fan out to alice + charlie (bob removed)
	sendCmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conv.ConversationId,
		SenderPtid:     "did:alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				GroupEncryptedPayload: []byte("private post-removal"),
				ContentType:           chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	svc.SubmitCommand(context.Background(), sendCmd)

	spy.mu.Lock()
	defer spy.mu.Unlock()
	if len(spy.inbox) != 1 || len(spy.outbox) != 1 {
		t.Fatalf(
			"command deliveries = inbox:%d outbox:%d, want 1 local and 1 remote",
			len(spy.inbox),
			len(spy.outbox),
		)
	}
	if spy.inbox[0].RecipientDeviceId != "alice-device" ||
		spy.outbox[0].Envelope.RecipientDeviceId != "charlie-device" {
		t.Fatalf(
			"group command fan-out was not device scoped: local=%q remote=%q",
			spy.inbox[0].RecipientDeviceId,
			spy.outbox[0].Envelope.RecipientDeviceId,
		)
	}
}

func TestCrossStation_DirectMessage_E2E(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := newMemService(repo, spy)

	conv, err := svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-B")
	if err != nil {
		t.Fatalf("CreateDirect cross-station failed: %v", err)
	}

	members, _ := svc.GetMembers(context.Background(), conv.ConversationId)
	if len(members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(members))
	}

	var aliceMember, bobMember *chat.ConversationMember
	for _, m := range members {
		switch m.Ptid {
		case "did:alice":
			aliceMember = m
		case "did:bob":
			bobMember = m
		}
	}
	if aliceMember == nil || bobMember == nil {
		t.Fatal("expected both alice and bob as members")
	}
	if aliceMember.ActorHomeStationPeerId != "station-A" {
		t.Fatalf("alice station expected station-A, got %s", aliceMember.ActorHomeStationPeerId)
	}
	if bobMember.ActorHomeStationPeerId != "station-B" {
		t.Fatalf("bob station expected station-B, got %s", bobMember.ActorHomeStationPeerId)
	}

	spy.mu.Lock()
	spy.events = nil
	spy.mu.Unlock()

	sendCmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: conv.ConversationId,
		SenderPtid:     "did:alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				DevicePayloads: []*chat.DeviceEncryptedPayload{
					directPayload("did:alice", "alice-device-2", "encrypted-dm-payload"),
					directPayload("did:bob", "bob-device", "encrypted-dm-payload"),
				},
				ContentType: chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	event, err := svc.SubmitCommand(context.Background(), sendCmd)
	if err != nil {
		t.Fatalf("SubmitCommand failed: %v", err)
	}
	if event == nil {
		t.Fatal("expected committed event from SubmitCommand")
	}

	spy.mu.Lock()
	defer spy.mu.Unlock()
	if len(spy.inbox) != 1 || len(spy.outbox) != 1 {
		t.Fatalf(
			"cross-Station command deliveries = inbox:%d outbox:%d, want 1 each",
			len(spy.inbox),
			len(spy.outbox),
		)
	}
	localEvent := &chat.CommittedConversationEvent{}
	if err := proto.Unmarshal(spy.inbox[0].Envelope.PayloadBytes, localEvent); err != nil {
		t.Fatalf("decode local delivery event: %v", err)
	}
	remoteEvent := &chat.CommittedConversationEvent{}
	if err := proto.Unmarshal(spy.outbox[0].Envelope.PayloadBytes, remoteEvent); err != nil {
		t.Fatalf("decode remote delivery event: %v", err)
	}
	if !proto.Equal(event, localEvent) || !proto.Equal(event, remoteEvent) {
		t.Fatal("direct payload deliveries must carry the same canonical authority event")
	}
	msgEvt := event.GetMessageCommitted()
	if msgEvt == nil {
		t.Fatal("expected MessageCommittedEvent payload")
	}
	if len(msgEvt.DevicePayloads) != 2 {
		t.Fatalf("device payload count = %d, want 2", len(msgEvt.DevicePayloads))
	}
	if msgEvt.SenderPtid != "did:alice" {
		t.Fatalf("sender expected did:alice, got %s", msgEvt.SenderPtid)
	}
}
