package follower

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type activeMembership struct {
	active bool
}

type resyncFetcher struct {
	events []*chat.CommittedConversationEvent
	err    error
}

func (f resyncFetcher) FetchAuthorityEvents(
	context.Context,
	Head,
	int64,
	int32,
) ([]*chat.CommittedConversationEvent, error) {
	return f.events, f.err
}

func (m activeMembership) IsActiveStation(
	context.Context,
	string,
	string,
) (bool, error) {
	return m.active, nil
}

func newFollowerTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := envinf.NewPostgresRepository(db).AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	service := NewService(db, activeMembership{active: true})
	if err := service.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return service, db
}

func TestFollowerAppliesOrderedEventsAndMlsAtomically(t *testing.T) {
	service, db := newFollowerTestService(t)
	ctx := context.Background()
	created := followerEvent(t, 1, nil, nil)
	createdEnvelope := followerEventEnvelope(t, created, "alice", "")
	handled, notifications, err := service.ApplyFederatedDelivery(ctx, createdEnvelope, "station-a")
	if err != nil || !handled || len(notifications) != 1 {
		t.Fatalf("apply created: handled=%v notifications=%d err=%v", handled, len(notifications), err)
	}

	addBob := followerEvent(t, 2, created.EventHash, &chat.MembershipTransitionCommittedEvent{
		TransitionId:        "transition-add-bob",
		FromMembershipEpoch: 0,
		ToMembershipEpoch:   1,
		FromMlsEpoch:        0,
		ToMlsEpoch:          1,
		Changes: []*chat.MembershipTransitionChange{{
			Ptid:                   "bob",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
		OpaqueMlsCommitBytes: []byte("commit-add-bob"),
		CommitSha256:         digest([]byte("commit-add-bob")),
	})
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, addBob, "bob", ""),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerMlsEnvelope(t, addBob, "bob", "bob-device"),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}

	var head Head
	if err := db.First(&head, "conversation_id = ?", "group-1").Error; err != nil {
		t.Fatal(err)
	}
	if head.GroupSeq != 2 || head.MembershipEpoch != 1 || head.MlsEpoch != 1 ||
		head.TransitionID != "transition-add-bob" || head.Status != "active" {
		t.Fatalf("unexpected follower head: %+v", head)
	}
	var member Member
	if err := db.First(&member, "conversation_id = ? AND ptid = ?", "group-1", "bob").Error; err != nil {
		t.Fatal(err)
	}
	if member.Status != int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE) {
		t.Fatalf("bob status = %d", member.Status)
	}
	var inboxRows int64
	if err := db.Model(&envinf.InboxModel{}).Count(&inboxRows).Error; err != nil {
		t.Fatal(err)
	}
	if inboxRows != 3 {
		t.Fatalf("inbox rows = %d, want 3", inboxRows)
	}
}

func TestFollowerReadProjectionServesActiveConversationAndMembers(t *testing.T) {
	service, _ := newFollowerTestService(t)
	ctx := context.Background()
	created := followerEvent(t, 1, nil, nil)
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, created, "alice", "alice-device"),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	addBob := followerTransitionEvent(t, 2, created.EventHash, "add-bob")
	addBob.GetMembershipTransitionCommitted().Changes = []*chat.MembershipTransitionChange{{
		Ptid:                   "bob",
		ActorHomeStationPeerId: "station-b",
		Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
		Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		DeviceId:               "bob-device",
	}}
	addBob.EventHash, _ = committedEventHash(addBob)
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, addBob, "bob", "bob-device"),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}

	conversations, err := service.ListConversationsForActor(ctx, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 1 ||
		conversations[0].AuthorityStationPeerId != "station-a" ||
		conversations[0].FederationId != "federation-1" ||
		conversations[0].MembershipEpoch != 1 ||
		conversations[0].MlsEpoch != 1 {
		t.Fatalf("unexpected follower conversations: %+v", conversations)
	}
	members, err := service.ListMembers(ctx, "group-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 ||
		members[0].Ptid != "bob" ||
		members[0].ActorHomeStationPeerId != "station-b" {
		t.Fatalf("unexpected follower members: %+v", members)
	}
}

func TestFollowerProjectsDeviceLeavesAndActorLeaveSeparately(t *testing.T) {
	_, db := newFollowerTestService(t)
	add := &chat.CommittedConversationEvent{
		ConversationId: "group-device-leaves",
		Payload: &chat.CommittedConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chat.MembershipTransitionCommittedEvent{
				Changes: []*chat.MembershipTransitionChange{
					{
						Ptid:     "bob",
						Action:   chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
						Role:     chat.MemberRole_MEMBER_ROLE_MEMBER,
						DeviceId: "bob-device-1",
					},
					{
						Ptid:     "bob",
						Action:   chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE,
						DeviceId: "bob-device-2",
					},
				},
			},
		},
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return applyProjection(tx, add)
	}); err != nil {
		t.Fatal(err)
	}
	var active int64
	if err := db.Model(&MemberDevice{}).
		Where("conversation_id = ? AND ptid = ? AND active = ?", "group-device-leaves", "bob", true).
		Count(&active).Error; err != nil {
		t.Fatal(err)
	}
	if active != 2 {
		t.Fatalf("active device leaves = %d, want 2", active)
	}

	removeDevice := &chat.CommittedConversationEvent{
		ConversationId: "group-device-leaves",
		Payload: &chat.CommittedConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chat.MembershipTransitionCommittedEvent{
				Changes: []*chat.MembershipTransitionChange{{
					Ptid:     "bob",
					Action:   chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE_DEVICE,
					DeviceId: "bob-device-1",
				}},
			},
		},
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return applyProjection(tx, removeDevice)
	}); err != nil {
		t.Fatal(err)
	}
	var sibling MemberDevice
	if err := db.First(
		&sibling,
		"conversation_id = ? AND ptid = ? AND device_id = ?",
		"group-device-leaves",
		"bob",
		"bob-device-2",
	).Error; err != nil {
		t.Fatal(err)
	}
	if !sibling.Active {
		t.Fatal("removing one device deactivated its sibling")
	}

	leave := &chat.CommittedConversationEvent{
		ConversationId: "group-device-leaves",
		Payload: &chat.CommittedConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chat.MembershipTransitionCommittedEvent{
				Changes: []*chat.MembershipTransitionChange{{
					Ptid:   "bob",
					Action: chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE,
				}},
			},
		},
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return applyProjection(tx, leave)
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&MemberDevice{}).
		Where("conversation_id = ? AND ptid = ? AND active = ?", "group-device-leaves", "bob", true).
		Count(&active).Error; err != nil {
		t.Fatal(err)
	}
	if active != 0 {
		t.Fatalf("active device leaves after leave = %d, want 0", active)
	}
	var member Member
	if err := db.First(
		&member,
		"conversation_id = ? AND ptid = ?",
		"group-device-leaves",
		"bob",
	).Error; err != nil {
		t.Fatal(err)
	}
	if member.Status != int32(chat.MemberStatus_MEMBER_STATUS_LEFT) {
		t.Fatalf("member status = %d, want left", member.Status)
	}
}

func TestFollowerBuffersReorderAndDrainsAfterGap(t *testing.T) {
	service, db := newFollowerTestService(t)
	ctx := context.Background()
	created := followerEvent(t, 1, nil, nil)
	event2 := followerTransitionEvent(t, 2, created.EventHash, "transition-2")
	event3 := followerTransitionEvent(t, 3, event2.EventHash, "transition-3")

	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, event3, "alice", ""),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	assertFollowerHead(t, db, 0, "resync_required")
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, created, "alice", ""),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	assertFollowerHead(t, db, 1, "resync_required")
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, event2, "alice", ""),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	assertFollowerHead(t, db, 3, "active")
	var buffered int64
	if err := db.Model(&bufferedEnvelope{}).Count(&buffered).Error; err != nil {
		t.Fatal(err)
	}
	if buffered != 0 {
		t.Fatalf("buffer rows = %d, want 0", buffered)
	}
}

func TestFollowerDuplicateRecipientsAndForkProtectionSurviveRestart(t *testing.T) {
	service, db := newFollowerTestService(t)
	ctx := context.Background()
	created := followerEvent(t, 1, nil, nil)
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, created, "alice", "device-a"),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	restarted := NewService(db, activeMembership{active: true})
	if _, _, err := restarted.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, created, "bob", "device-b"),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	var inboxRows int64
	if err := db.Model(&envinf.InboxModel{}).Count(&inboxRows).Error; err != nil {
		t.Fatal(err)
	}
	if inboxRows != 2 {
		t.Fatalf("duplicate event recipient inbox rows = %d, want 2", inboxRows)
	}

	fork := proto.Clone(created).(*chat.CommittedConversationEvent)
	fork.EventId = "fork-event"
	fork.Payload = &chat.CommittedConversationEvent_ConversationCreated{
		ConversationCreated: &chat.ConversationCreatedEvent{
			Conversation: &chat.Conversation{
				ConversationId: "group-1",
				Name:           "forged",
			},
		},
	}
	fork.EventHash = nil
	fork.EventHash, _ = committedEventHash(fork)
	_, _, err := restarted.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, fork, "alice", "device-a"),
		"station-a",
	)
	if err == nil {
		t.Fatal("same-sequence fork was accepted")
	}
	assertFollowerHead(t, db, 1, "read_only")
}

func TestFollowerRejectsInactiveAuthority(t *testing.T) {
	_, db := newFollowerTestService(t)
	service := NewService(db, activeMembership{active: false})
	event := followerEvent(t, 1, nil, nil)
	if _, _, err := service.ApplyFederatedDelivery(
		context.Background(),
		followerEventEnvelope(t, event, "alice", ""),
		"station-a",
	); err == nil {
		t.Fatal("inactive authority was accepted")
	}
	var heads int64
	if err := db.Model(&Head{}).Count(&heads).Error; err != nil {
		t.Fatal(err)
	}
	if heads != 0 {
		t.Fatalf("inactive authority wrote %d heads", heads)
	}
}

func TestFollowerBufferOverflowEntersReadOnly(t *testing.T) {
	service, db := newFollowerTestService(t)
	ctx := context.Background()
	for seq := int64(2); seq <= maxBufferedEnvelopes+2; seq++ {
		event := followerTransitionEvent(
			t,
			seq,
			digest([]byte(fmt.Sprintf("missing-%d", seq-1))),
			fmt.Sprintf("transition-%d", seq),
		)
		_, _, _ = service.ApplyFederatedDelivery(
			ctx,
			followerEventEnvelope(t, event, "alice", ""),
			"station-a",
		)
	}
	assertFollowerHead(t, db, 0, "read_only")
}

func TestResyncManagerFetchesGapAndDrainsBufferedEvents(t *testing.T) {
	service, db := newFollowerTestService(t)
	ctx := context.Background()
	created := followerEvent(t, 1, nil, nil)
	event2 := followerTransitionEvent(t, 2, created.EventHash, "transition-2")
	event3 := followerTransitionEvent(t, 3, event2.EventHash, "transition-3")
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, created, "alice", ""),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, event3, "alice", ""),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	assertFollowerHead(t, db, 1, "resync_required")

	restarted := NewService(db, activeMembership{active: true})
	manager := NewResyncManager(restarted, resyncFetcher{
		events: []*chat.CommittedConversationEvent{event2, event3},
	})
	if err := manager.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	assertFollowerHead(t, db, 3, "active")
	var buffered int64
	if err := db.Model(&bufferedEnvelope{}).Count(&buffered).Error; err != nil {
		t.Fatal(err)
	}
	if buffered != 0 {
		t.Fatalf("buffer rows after resync = %d, want 0", buffered)
	}
}

func TestResyncManagerMarksAuthorityFailureDegraded(t *testing.T) {
	service, db := newFollowerTestService(t)
	ctx := context.Background()
	future := followerTransitionEvent(t, 2, nil, "transition-2")
	if _, _, err := service.ApplyFederatedDelivery(
		ctx,
		followerEventEnvelope(t, future, "alice", ""),
		"station-a",
	); err != nil {
		t.Fatal(err)
	}
	manager := NewResyncManager(service, resyncFetcher{
		err: errors.New("authority unavailable"),
	})
	if err := manager.RunOnce(ctx); err == nil {
		t.Fatal("authority fetch failure was hidden")
	}
	assertFollowerHead(t, db, 0, "degraded")
}

func followerEvent(
	t *testing.T,
	seq int64,
	prevHash []byte,
	transition *chat.MembershipTransitionCommittedEvent,
) *chat.CommittedConversationEvent {
	t.Helper()
	event := &chat.CommittedConversationEvent{
		EventId:                  fmt.Sprintf("event-%d", seq),
		ConversationId:           "group-1",
		GroupSeq:                 seq,
		MembershipEpoch:          max(seq-1, 0),
		CommittedByStationPeerId: "station-a",
		CommittedAt:              timestamppb.New(time.Unix(1_800_000_000+seq, 0)),
		PrevEventHash:            prevHash,
	}
	if transition == nil {
		event.Payload = &chat.CommittedConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedEvent{
				Conversation: &chat.Conversation{
					ConversationId:         "group-1",
					Kind:                   chat.ConversationKind_CONVERSATION_KIND_GROUP,
					AuthorityStationPeerId: "station-a",
					FederationId:           "federation-1",
					AuthorityEpoch:         1,
				},
			},
		}
	} else {
		event.Payload = &chat.CommittedConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: transition,
		}
	}
	var err error
	event.EventHash, err = committedEventHash(event)
	if err != nil {
		t.Fatal(err)
	}
	return event
}

func followerTransitionEvent(
	t *testing.T,
	seq int64,
	prevHash []byte,
	transitionID string,
) *chat.CommittedConversationEvent {
	return followerEvent(t, seq, prevHash, &chat.MembershipTransitionCommittedEvent{
		TransitionId:         transitionID,
		FromMembershipEpoch:  seq - 2,
		ToMembershipEpoch:    seq - 1,
		FromMlsEpoch:         seq - 2,
		ToMlsEpoch:           seq - 1,
		OpaqueMlsCommitBytes: []byte("commit-" + transitionID),
		CommitSha256:         digest([]byte("commit-" + transitionID)),
	})
}

func followerEventEnvelope(
	t *testing.T,
	event *chat.CommittedConversationEvent,
	recipientPtid string,
	deviceID string,
) *chat.StationEnvelope {
	t.Helper()
	payload, err := proto.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	transitionID := ""
	fromMembership, toMembership, fromMls, toMls := int64(0), event.MembershipEpoch, int64(0), int64(0)
	if transition := event.GetMembershipTransitionCommitted(); transition != nil {
		transitionID = transition.TransitionId
		fromMembership = transition.FromMembershipEpoch
		toMembership = transition.ToMembershipEpoch
		fromMls = transition.FromMlsEpoch
		toMls = transition.ToMlsEpoch
	}
	return &chat.StationEnvelope{
		EnvelopeId:                 fmt.Sprintf("event-envelope-%d-%s-%s", event.GroupSeq, recipientPtid, deviceID),
		IdempotencyKey:             fmt.Sprintf("event-%d-%s-%s", event.GroupSeq, recipientPtid, deviceID),
		ConversationId:             event.ConversationId,
		SenderPtid:                 "alice",
		RecipientPtid:              recipientPtid,
		RecipientDeviceId:          deviceID,
		RecipientHomeStationPeerId: "station-b",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
		PayloadBytes:               payload,
		PayloadSha256:              event.EventHash,
		GroupSeq:                   event.GroupSeq,
		TransitionId:               transitionID,
		FromMembershipEpoch:        fromMembership,
		ToMembershipEpoch:          toMembership,
		FromMlsEpoch:               fromMls,
		ToMlsEpoch:                 toMls,
		AuthorityStationPeerId:     "station-a",
		FederationId:               "federation-1",
		AuthorityEpoch:             1,
	}
}

func followerMlsEnvelope(
	t *testing.T,
	event *chat.CommittedConversationEvent,
	recipientPtid string,
	deviceID string,
) *chat.StationEnvelope {
	t.Helper()
	transition := event.GetMembershipTransitionCommitted()
	opaque := []byte("welcome-" + transition.TransitionId)
	hash := digest(opaque)
	payload, err := proto.Marshal(&chat.MlsTransitionDeliveryPayload{
		ConversationId:      event.ConversationId,
		TransitionId:        transition.TransitionId,
		GroupSeq:            event.GroupSeq,
		FromMembershipEpoch: transition.FromMembershipEpoch,
		ToMembershipEpoch:   transition.ToMembershipEpoch,
		FromMlsEpoch:        transition.FromMlsEpoch,
		ToMlsEpoch:          transition.ToMlsEpoch,
		Kind:                chat.MlsTransitionDeliveryKind_MLS_TRANSITION_DELIVERY_KIND_WELCOME,
		OpaqueMlsBytes:      opaque,
		PayloadSha256:       hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &chat.StationEnvelope{
		EnvelopeId:                 "mls-" + transition.TransitionId + "-" + deviceID,
		IdempotencyKey:             "mls-" + transition.TransitionId + "-" + deviceID,
		ConversationId:             event.ConversationId,
		SenderPtid:                 "alice",
		RecipientPtid:              recipientPtid,
		RecipientDeviceId:          deviceID,
		RecipientHomeStationPeerId: "station-b",
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY,
		PayloadBytes:               payload,
		PayloadSha256:              hash,
		GroupSeq:                   event.GroupSeq,
		TransitionId:               transition.TransitionId,
		FromMembershipEpoch:        transition.FromMembershipEpoch,
		ToMembershipEpoch:          transition.ToMembershipEpoch,
		FromMlsEpoch:               transition.FromMlsEpoch,
		ToMlsEpoch:                 transition.ToMlsEpoch,
		AuthorityStationPeerId:     "station-a",
		FederationId:               "federation-1",
		AuthorityEpoch:             1,
	}
}

func assertFollowerHead(t *testing.T, db *gorm.DB, seq int64, status string) {
	t.Helper()
	var head Head
	if err := db.First(&head, "conversation_id = ?", "group-1").Error; err != nil {
		t.Fatal(err)
	}
	if head.GroupSeq != seq || head.Status != status {
		t.Fatalf("head = seq:%d status:%s, want seq:%d status:%s", head.GroupSeq, head.Status, seq, status)
	}
}

func digest(value []byte) []byte {
	hash := sha256.Sum256(value)
	return hash[:]
}
