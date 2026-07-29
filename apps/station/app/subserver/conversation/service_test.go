package conversation_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// memConvRepo is an in-memory Repository for contract testing.
type memConvRepo struct {
	mu      sync.Mutex
	convs   map[string]*chat.Conversation
	members map[string][]*chat.ConversationMember
	events  map[string][]*chat.CommittedConversationEvent
	seqs    map[string]int64
}

func newMemConvRepo() *memConvRepo {
	return &memConvRepo{
		convs:   make(map[string]*chat.Conversation),
		members: make(map[string][]*chat.ConversationMember),
		events:  make(map[string][]*chat.CommittedConversationEvent),
		seqs:    make(map[string]int64),
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

type spyEnvelope struct {
	mu       sync.Mutex
	events   []*chat.CommittedConversationEvent
	receipts []*chat.MessageReceipt
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
	return nil
}

func TestCreateDirect_DeterministicID(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

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
	svc := conversation.NewConversationService(repo, spy, "station-A")

	conv1, _ := svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	conv2, _ := svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")

	if conv1.ConversationId != conv2.ConversationId {
		t.Fatal("expected same conversation on repeated create")
	}
}

func TestSubmitCommand_SendMessage(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	cmd := &chat.ConversationCommand{
		ConversationId: convID,
		SenderPtid: "did:alice",
		SenderDeviceId: "device-1",
		ClientTs:       timestamppb.New(time.Now()),
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload: []byte("hello bob"),
				ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
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
	if string(msgEvent.EncryptedPayload) != "hello bob" {
		t.Fatalf("payload mismatch")
	}

	if len(spy.events) != 2 {
		t.Fatalf("expected 2 envelope submissions (create + send), got %d", len(spy.events))
	}
}

func TestSubmitCommand_NonMember_Rejected(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	cmd := &chat.ConversationCommand{
		ConversationId: convID,
		SenderPtid: "did:charlie",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload: []byte("intrusion"),
				ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
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

func TestCreateGroup_And_MembershipEpochBinding(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	members := []conversation.MemberEntry{
		{Ptid: "did:alice", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_OWNER},
		{Ptid: "did:bob", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
		{Ptid: "did:charlie", StationID: "station-B", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
	}

	conv, err := svc.CreateGroup(context.Background(), "Test Group", "did:alice", "station-A", members)
	if err != nil {
		t.Fatalf("CreateGroup failed: %v", err)
	}
	if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_GROUP {
		t.Fatalf("expected GROUP kind")
	}
	if conv.MembershipEpoch != 1 {
		t.Fatalf("expected epoch 1, got %d", conv.MembershipEpoch)
	}

	addCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_AddMembers{
			AddMembers: &chat.AddMembersCommand{
				Members: []*chat.MemberAddEntry{
					{Ptid: "did:dave", ActorHomeStationPeerId: "station-C", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
				},
			},
		},
	}

	event, err := svc.SubmitCommand(context.Background(), addCmd)
	if err != nil {
		t.Fatalf("AddMembers failed: %v", err)
	}
	if event.MembershipEpoch != 2 {
		t.Fatalf("expected epoch 2 after add, got %d", event.MembershipEpoch)
	}

	membershipEvent := event.GetMembershipChanged()
	if membershipEvent == nil {
		t.Fatal("expected MembershipChangedEvent")
	}
	if membershipEvent.NewMembershipEpoch != 2 {
		t.Fatalf("expected new_membership_epoch=2, got %d", membershipEvent.NewMembershipEpoch)
	}

	removeCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_RemoveMembers{
			RemoveMembers: &chat.RemoveMembersCommand{
				Ptids: []string{"did:bob"},
			},
		},
	}

	event2, err := svc.SubmitCommand(context.Background(), removeCmd)
	if err != nil {
		t.Fatalf("RemoveMembers failed: %v", err)
	}
	if event2.MembershipEpoch != 3 {
		t.Fatalf("expected epoch 3 after remove, got %d", event2.MembershipEpoch)
	}
}

func TestSubmitReceipt_RoutesToOtherMembers(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	receipt := &chat.MessageReceipt{
		ConversationId: convID,
		MessageId:      "msg-001",
		Ptid:       "did:bob",
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

func TestListEvents_PaginatedHistory(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	svc.CreateDirect(context.Background(), "did:alice", "did:bob", "station-A", "station-A")
	convID := conversation.DeterministicDirectID("did:alice", "did:bob")

	for i := 0; i < 5; i++ {
		cmd := &chat.ConversationCommand{
			ConversationId: convID,
			SenderPtid: "did:alice",
			SenderDeviceId: "device-1",
			Payload: &chat.ConversationCommand_SendMessage{
				SendMessage: &chat.SendMessageCommand{
					EncryptedPayload: []byte("msg"),
					ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
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
	if len(afterThird) != 2 {
		t.Fatalf("expected 2 events after seq 3 (seq 4 and 5), got %d", len(afterThird))
	}
}

// P2 gate: removed member cannot submit commands.
func TestRemovedMember_CannotSendMessage(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	members := []conversation.MemberEntry{
		{Ptid: "did:alice", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_OWNER},
		{Ptid: "did:bob", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
	}
	conv, _ := svc.CreateGroup(context.Background(), "Test", "did:alice", "station-A", members)

	removeCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_RemoveMembers{
			RemoveMembers: &chat.RemoveMembersCommand{
				Ptids: []string{"did:bob"},
			},
		},
	}
	svc.SubmitCommand(context.Background(), removeCmd)

	sendCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:bob",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload: []byte("should fail"),
				ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
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
	svc := conversation.NewConversationService(repo, spy, "station-A")

	members := []conversation.MemberEntry{
		{Ptid: "did:alice", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_OWNER},
		{Ptid: "did:bob", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
	}
	conv, _ := svc.CreateGroup(context.Background(), "Test", "did:alice", "station-A", members)

	leaveCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:bob",
		Payload:        &chat.ConversationCommand_Leave{Leave: &chat.LeaveCommand{}},
	}
	svc.SubmitCommand(context.Background(), leaveCmd)

	sendCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:bob",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload: []byte("should fail"),
				ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	_, err := svc.SubmitCommand(context.Background(), sendCmd)
	if err == nil {
		t.Fatal("expected left member to be rejected")
	}
}

// C-4 partial: membership epoch monotonically increases across mutations.
func TestMembershipEpoch_MonotonicallyIncreases(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	members := []conversation.MemberEntry{
		{Ptid: "did:alice", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_OWNER},
		{Ptid: "did:bob", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
	}
	conv, _ := svc.CreateGroup(context.Background(), "Epoch Test", "did:alice", "station-A", members)
	if conv.MembershipEpoch != 1 {
		t.Fatalf("initial epoch should be 1, got %d", conv.MembershipEpoch)
	}

	addCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_AddMembers{
			AddMembers: &chat.AddMembersCommand{
				Members: []*chat.MemberAddEntry{
					{Ptid: "did:charlie", ActorHomeStationPeerId: "station-A", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
				},
			},
		},
	}
	ev1, _ := svc.SubmitCommand(context.Background(), addCmd)
	if ev1.MembershipEpoch != 2 {
		t.Fatalf("epoch after add should be 2, got %d", ev1.MembershipEpoch)
	}

	leaveCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:charlie",
		Payload:        &chat.ConversationCommand_Leave{Leave: &chat.LeaveCommand{}},
	}
	ev2, _ := svc.SubmitCommand(context.Background(), leaveCmd)
	if ev2.MembershipEpoch != 3 {
		t.Fatalf("epoch after leave should be 3, got %d", ev2.MembershipEpoch)
	}

	removeCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_RemoveMembers{
			RemoveMembers: &chat.RemoveMembersCommand{
				Ptids: []string{"did:bob"},
			},
		},
	}
	ev3, _ := svc.SubmitCommand(context.Background(), removeCmd)
	if ev3.MembershipEpoch != 4 {
		t.Fatalf("epoch after remove should be 4, got %d", ev3.MembershipEpoch)
	}

	// Non-membership commands should NOT bump epoch
	sendCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload: []byte("hello"),
				ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	ev4, _ := svc.SubmitCommand(context.Background(), sendCmd)
	if ev4.MembershipEpoch != 4 {
		t.Fatalf("epoch should stay 4 for message command, got %d", ev4.MembershipEpoch)
	}
}

// C-8 partial: envelope bridge fans out to all active members.
func TestEnvelopeFanout_OnlyActiveMembers(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

	members := []conversation.MemberEntry{
		{Ptid: "did:alice", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_OWNER},
		{Ptid: "did:bob", StationID: "station-A", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
		{Ptid: "did:charlie", StationID: "station-B", Role: chat.MemberRole_MEMBER_ROLE_MEMBER},
	}
	conv, _ := svc.CreateGroup(context.Background(), "Fanout Test", "did:alice", "station-A", members)

	spy.mu.Lock()
	spy.events = nil
	spy.mu.Unlock()

	// Remove bob
	removeCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_RemoveMembers{
			RemoveMembers: &chat.RemoveMembersCommand{
				Ptids: []string{"did:bob"},
			},
		},
	}
	svc.SubmitCommand(context.Background(), removeCmd)

	spy.mu.Lock()
	spy.events = nil
	spy.mu.Unlock()

	// Send message — should only fan out to alice + charlie (bob removed)
	sendCmd := &chat.ConversationCommand{
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload: []byte("private post-removal"),
				ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
			},
		},
	}
	svc.SubmitCommand(context.Background(), sendCmd)

	spy.mu.Lock()
	defer spy.mu.Unlock()
	if len(spy.events) != 1 {
		t.Fatalf("expected 1 envelope submission event, got %d", len(spy.events))
	}
}

func TestCrossStation_DirectMessage_E2E(t *testing.T) {
	repo := newMemConvRepo()
	spy := &spyEnvelope{}
	svc := conversation.NewConversationService(repo, spy, "station-A")

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
		ConversationId: conv.ConversationId,
		SenderPtid: "did:alice",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload: []byte("encrypted-dm-payload"),
				ContentType:      chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT,
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
	if len(spy.events) != 1 {
		t.Fatalf("expected 1 event submission (message), got %d", len(spy.events))
	}
	committed := spy.events[0]
	msgEvt := committed.GetMessageCommitted()
	if msgEvt == nil {
		t.Fatal("expected MessageCommittedEvent payload")
	}
	if string(msgEvt.EncryptedPayload) != "encrypted-dm-payload" {
		t.Fatalf("payload mismatch: %s", string(msgEvt.EncryptedPayload))
	}
	if msgEvt.SenderPtid != "did:alice" {
		t.Fatalf("sender expected did:alice, got %s", msgEvt.SenderPtid)
	}
}
