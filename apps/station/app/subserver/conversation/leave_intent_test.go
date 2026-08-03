package conversation

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func TestMlsLeaveIntentVerifiesActorDeviceAndListsForNonTargetCommitter(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	authority := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"leave-intent-genesis",
		0,
		[]*chat.MembershipTransitionChange{
			{
				Ptid:                   "alice",
				ActorHomeStationPeerId: "station-a",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
				DeviceId:               "alice-device",
			},
			{
				Ptid:                   "bob",
				ActorHomeStationPeerId: "station-b",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
				DeviceId:               "bob-device",
			},
		},
		testWelcome("bob", "bob-device", "station-b", "welcome-bob"),
	)
	conversation, _, err := authority.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"federation-family",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	intent := &chat.MlsLeaveIntent{
		Version:                 mlsLeaveIntentVersion,
		IntentId:                "leave-intent-bob",
		FederationId:            "federation-family",
		AuthorityStationPeerId:  "station-a",
		AuthorityEpoch:          conversation.AuthorityEpoch,
		HomeStationPeerId:       "station-b",
		ConversationId:          conversation.ConversationId,
		ActorPtid:               "bob",
		ActorDeviceId:           "bob-device",
		ActorSigningKeyId:       "bob-key-1",
		ObservedMembershipEpoch: 1,
		ObservedMlsEpoch:        1,
		CreatedAtUnixMs:         now.UnixMilli(),
		ExpiresAtUnixMs:         now.Add(5 * time.Minute).UnixMilli(),
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		leaveIntentSigningInput(intent),
	)
	if err != nil {
		t.Fatal(err)
	}
	intent.ActorSignature = ed25519.Sign(privateKey, signingBytes)

	service := NewMlsLeaveIntentService(
		repo,
		newPostgresLeaveIntentRepository(db),
		proposalKeyResolver{key: &actormodel.VerifiedActorDeviceSigningKey{
			ActorPtid:         "bob",
			ActorDeviceId:     "bob-device",
			SigningKeyId:      "bob-key-1",
			HomeStationPeerId: "station-b",
			Ed25519PublicKey:  publicKey,
		}},
		"station-a",
	)
	service.clock = func() time.Time { return now }
	accepted, err := service.Submit(ctx, "bob", "bob-device", intent)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(accepted, intent) {
		t.Fatal("accepted leave intent differs from signed input")
	}
	pending, err := service.ListPending(
		ctx,
		"alice",
		"alice-device",
		conversation.ConversationId,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || !proto.Equal(pending[0], intent) {
		t.Fatalf("unexpected pending leave intents: %+v", pending)
	}
	targetView, err := service.ListPending(
		ctx,
		"bob",
		"bob-device",
		conversation.ConversationId,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(targetView) != 1 {
		t.Fatal("departing actor must retain durable pending leave visibility")
	}

	forged := proto.Clone(intent).(*chat.MlsLeaveIntent)
	forged.IntentId = "leave-intent-forged"
	forged.ActorSignature[0] ^= 0xff
	if _, err := service.Submit(ctx, "bob", "bob-device", forged); err == nil {
		t.Fatal("forged leave intent was accepted")
	}
}
