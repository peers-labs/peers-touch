package conversation

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/follower"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type recordingLeaveIntentForwarder struct {
	submitCalls int
	listCalls   int
	intent      *chat.MlsLeaveIntent
}

func (f *recordingLeaveIntentForwarder) Submit(
	_ context.Context,
	intent *chat.MlsLeaveIntent,
) (*chat.MlsLeaveIntent, error) {
	f.submitCalls++
	f.intent = intent
	return intent, nil
}

func (f *recordingLeaveIntentForwarder) ListPending(
	_ context.Context,
	_ MlsLeaveIntentRoute,
) ([]*chat.MlsLeaveIntent, error) {
	f.listCalls++
	return []*chat.MlsLeaveIntent{f.intent}, nil
}

func TestHomeStationForwardsRemoteLeaveIntentAndPendingList(t *testing.T) {
	subserver, forwarder := newLeaveIntentForwardingFixture(t)
	intent := remoteLeaveIntent()
	accepted, err := subserver.submitAuthenticatedMlsLeaveIntent(
		context.Background(),
		"bob",
		"bob-device",
		intent,
	)
	if err != nil {
		t.Fatal(err)
	}
	if accepted != intent || forwarder.submitCalls != 1 {
		t.Fatalf("accepted=%+v submit_calls=%d", accepted, forwarder.submitCalls)
	}
	pending, err := subserver.listAuthenticatedMlsLeaveIntents(
		context.Background(),
		"alice",
		"alice-device",
		intent.ConversationId,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0] != intent || forwarder.listCalls != 1 {
		t.Fatalf("pending=%+v list_calls=%d", pending, forwarder.listCalls)
	}
}

func TestHomeStationRejectsRemoteLeaveIntentBeforeForward(t *testing.T) {
	tests := []struct {
		name   string
		ptid   string
		device string
		mutate func(*chat.MlsLeaveIntent)
	}{
		{
			name:   "wrong authenticated device",
			ptid:   "bob",
			device: "other-device",
			mutate: func(*chat.MlsLeaveIntent) {},
		},
		{
			name:   "wrong Home Station",
			ptid:   "bob",
			device: "bob-device",
			mutate: func(intent *chat.MlsLeaveIntent) {
				intent.HomeStationPeerId = "station-c"
			},
		},
		{
			name:   "wrong authority epoch",
			ptid:   "bob",
			device: "bob-device",
			mutate: func(intent *chat.MlsLeaveIntent) {
				intent.AuthorityEpoch++
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			subserver, forwarder := newLeaveIntentForwardingFixture(t)
			intent := remoteLeaveIntent()
			test.mutate(intent)
			if _, err := subserver.submitAuthenticatedMlsLeaveIntent(
				context.Background(),
				test.ptid,
				test.device,
				intent,
			); err == nil {
				t.Fatal("unbound leave intent was accepted")
			}
			if forwarder.submitCalls != 0 {
				t.Fatalf("unbound leave intent reached forwarder: %d", forwarder.submitCalls)
			}
		})
	}
}

func newLeaveIntentForwardingFixture(
	t *testing.T,
) (*subServer, *recordingLeaveIntentForwarder) {
	t.Helper()
	db := newTransitionTestDB(t)
	followerService := follower.NewService(db)
	if err := followerService.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	const conversationID = "remote-leave-conversation"
	if err := db.Create(&follower.Head{
		ConversationID:         conversationID,
		FederationID:           "federation-1",
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         4,
		GroupSeq:               8,
		MembershipEpoch:        3,
		MlsEpoch:               3,
		Status:                 "active",
	}).Error; err != nil {
		t.Fatal(err)
	}
	for _, member := range []follower.Member{
		{
			ConversationID: conversationID,
			Ptid:           "alice",
			Status:         int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE),
		},
		{
			ConversationID: conversationID,
			Ptid:           "bob",
			Status:         int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE),
		},
	} {
		if err := db.Create(&member).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, device := range []follower.MemberDevice{
		{
			ConversationID: conversationID,
			Ptid:           "alice",
			DeviceID:       "alice-device",
			Active:         true,
		},
		{
			ConversationID: conversationID,
			Ptid:           "bob",
			DeviceID:       "bob-device",
			Active:         true,
		},
	} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	forwarder := &recordingLeaveIntentForwarder{}
	return &subServer{
		repo:                 newPostgresConversationRepo(db),
		leaveIntentForwarder: forwarder,
		localStationID:       "station-b",
		db:                   db,
	}, forwarder
}

func remoteLeaveIntent() *chat.MlsLeaveIntent {
	return &chat.MlsLeaveIntent{
		Version:                 mlsLeaveIntentVersion,
		IntentId:                "remote-leave-intent",
		FederationId:            "federation-1",
		AuthorityStationPeerId:  "station-a",
		AuthorityEpoch:          4,
		HomeStationPeerId:       "station-b",
		ConversationId:          "remote-leave-conversation",
		ActorPtid:               "bob",
		ActorDeviceId:           "bob-device",
		ActorSigningKeyId:       "bob-key",
		ObservedMembershipEpoch: 3,
		ObservedMlsEpoch:        3,
		ActorSignature:          make([]byte, 64),
	}
}
