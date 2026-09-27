package infrastructure_test

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"testing"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestFederatedRelationshipBlockAndUnblockConvergeWithoutRestoringFollows(
	t *testing.T,
) {
	fixture := newFederatedFriendRequestFixture(t)
	seedRelationshipFollows(t, fixture.a)
	seedRelationshipFollows(t, fixture.b)

	block := signedRelationshipCommand(
		t,
		fixture.actorKeys[alicePTID],
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_BLOCK,
		"relationship-block",
		0,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	result, err := fixture.a.relationship.SubmitRelationshipCommand(
		context.Background(),
		alicePTID,
		block,
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.GetKind() !=
		model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_COMMITTED ||
		!result.GetProjection().GetBlockedByViewer() ||
		result.GetProjection().GetInteractionAllowed() {
		t.Fatalf("block result = %+v", result)
	}
	assertNoRelationshipFollows(t, fixture.a)

	commandBytes, err := proto.MarshalOptions{
		Deterministic: true,
	}.Marshal(block)
	if err != nil {
		t.Fatal(err)
	}
	commandHash := sha256.Sum256(commandBytes)
	lookup, err := fixture.a.relationship.LookupRelationshipCommandResult(
		context.Background(),
		alicePTID,
		&model.LookupSocialRelationshipCommandResultRequest{
			CommandId:            block.GetBody().GetCommandId(),
			CommandPayloadSha256: commandHash[:],
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if lookup.GetState() !=
		model.SocialRelationshipCommandLookupState_SOCIAL_RELATIONSHIP_COMMAND_LOOKUP_STATE_TERMINAL_RESULT {
		t.Fatalf("block lookup = %+v", lookup)
	}
	foreignLookup, err := fixture.a.relationship.LookupRelationshipCommandResult(
		context.Background(),
		bobPTID,
		&model.LookupSocialRelationshipCommandResultRequest{
			CommandId:            block.GetBody().GetCommandId(),
			CommandPayloadSha256: commandHash[:],
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if foreignLookup.GetState() !=
		model.SocialRelationshipCommandLookupState_SOCIAL_RELATIONSHIP_COMMAND_LOOKUP_STATE_NOT_FOUND {
		t.Fatalf("foreign actor lookup = %+v", foreignLookup)
	}

	list, err := fixture.a.relationship.ListBlockedActors(
		context.Background(),
		alicePTID,
		&model.ListBlockedActorsRequest{Limit: 1},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.GetItems()) != 1 ||
		list.GetItems()[0].GetActor().GetPtid() != bobPTID ||
		list.GetItems()[0].GetHomeStationPeerId() != stationB {
		t.Fatalf("blocked list = %+v", list)
	}

	fixture.dispatchOnce(t, fixture.a)
	remoteStatus, err := fixture.b.relationship.RelationshipStatus(
		context.Background(),
		bobPTID,
		&model.GetSocialRelationshipStatusRequest{
			TargetActorPtid: alicePTID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if remoteStatus.GetRelationship().GetBlockedByViewer() ||
		remoteStatus.GetRelationship().GetInteractionAllowed() ||
		remoteStatus.GetRelationship().GetDeniedReason() !=
			model.SocialRelationshipDeniedReason_SOCIAL_RELATIONSHIP_DENIED_REASON_INTERACTION_DENIED {
		t.Fatalf("privacy-safe remote status = %+v", remoteStatus)
	}
	assertNoRelationshipFollows(t, fixture.b)
	remoteList, err := fixture.b.relationship.ListBlockedActors(
		context.Background(),
		bobPTID,
		&model.ListBlockedActorsRequest{Limit: 10},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(remoteList.GetItems()) != 0 {
		t.Fatalf("remote incoming block leaked into outgoing list: %+v", remoteList)
	}

	fixture.clock.Advance(time.Minute)
	unblock := signedRelationshipCommand(
		t,
		fixture.actorKeys[alicePTID],
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_UNBLOCK,
		"relationship-unblock",
		1,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	unblockResult, err := fixture.a.relationship.SubmitRelationshipCommand(
		context.Background(),
		alicePTID,
		unblock,
	)
	if err != nil {
		t.Fatal(err)
	}
	if unblockResult.GetProjection().GetBlockedByViewer() ||
		!unblockResult.GetProjection().GetInteractionAllowed() ||
		unblockResult.GetProjection().GetFollowing() ||
		unblockResult.GetProjection().GetFollowedBy() {
		t.Fatalf("unblock result restored relationship = %+v", unblockResult)
	}
	fixture.dispatchOnce(t, fixture.a)
	remoteStatus, err = fixture.b.relationship.RelationshipStatus(
		context.Background(),
		bobPTID,
		&model.GetSocialRelationshipStatusRequest{
			TargetActorPtid: alicePTID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !remoteStatus.GetRelationship().GetInteractionAllowed() ||
		remoteStatus.GetRelationship().GetFollowing() ||
		remoteStatus.GetRelationship().GetFollowedBy() {
		t.Fatalf("remote unblock restored relationship = %+v", remoteStatus)
	}
}

func TestSameStationRelationshipEventUsesSharedReceiver(t *testing.T) {
	clock := newFriendRequestClock()
	stationKey := newTestKey(0x51)
	actorKeys := map[string]testKey{
		alicePTID: newTestKey(0x61),
		bobPTID:   newTestKey(0x71),
	}
	local := newFriendRequestStation(
		t,
		"station-local",
		clock,
		stationKey,
		stationKeyring{
			"station-local": {
				keyID:     stationKey.keyID,
				publicKey: stationKey.publicKey,
			},
		},
		actorKeys,
	)
	command := signedRelationshipCommand(
		t,
		actorKeys[alicePTID],
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_BLOCK,
		"relationship-local-block",
		0,
		"station-local",
		"station-local",
		clock.Now(),
	)
	if _, err := local.relationship.SubmitRelationshipCommand(
		context.Background(),
		alicePTID,
		command,
	); err != nil {
		t.Fatal(err)
	}
	transport := &routingFriendRequestTransport{
		localStationID: "station-local",
		local:          local.localTransport,
		receivers:      map[string]delivery.FrameReceiver{"station-local": local.receiver},
	}
	dispatchStationOnce(t, local, transport)
	if transport.LocalCallCount() != 1 {
		t.Fatalf("same-Station relationship deliveries = %d, want 1", transport.LocalCallCount())
	}
}

func signedRelationshipCommand(
	t *testing.T,
	key testKey,
	action model.SocialRelationshipAction,
	commandID string,
	observedRevision int64,
	actorHomeStationPeerID string,
	targetHomeStationPeerID string,
	createdAt time.Time,
) *model.SocialRelationshipCommand {
	t.Helper()
	actor := &model.ActorRef{
		Ptid: alicePTID,
		Acct: "alice@" + actorHomeStationPeerID,
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
	command := &model.SocialRelationshipCommand{
		Body: &model.SocialRelationshipCommandBody{
			FormatVersion:           domain.SocialRelationshipCommandFormatVersion,
			CommandId:               commandID,
			Action:                  action,
			Actor:                   actor,
			TargetActor:             &model.ActorRef{Ptid: bobPTID, Acct: "bob@" + targetHomeStationPeerID, Kind: model.ActorKind_ACTOR_KIND_PERSON},
			ActorHomeStationPeerId:  actorHomeStationPeerID,
			TargetHomeStationPeerId: targetHomeStationPeerID,
			ObservedRevision:        observedRevision,
			CreatedAt:               timestamppb.New(createdAt),
			ExpiresAt:               timestamppb.New(createdAt.Add(time.Hour)),
			AuthorizingDevice: &model.ActorDeviceRef{
				Actor:    actor,
				DeviceId: alicePTID + ":device",
			},
		},
		SigningKeyId: key.keyID,
	}
	signingBytes, err := domain.CanonicalSocialRelationshipSigningBytes(command)
	if err != nil {
		t.Fatal(err)
	}
	command.ActorDeviceSignature = ed25519.Sign(key.privateKey, signingBytes)
	return command
}

func seedRelationshipFollows(
	t *testing.T,
	station *friendRequestStation,
) {
	t.Helper()
	if err := station.db.Create([]dbmodel.Follow{
		{ID: 101, FollowerID: 1, FollowingID: 2},
		{ID: 102, FollowerID: 2, FollowingID: 1},
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func assertNoRelationshipFollows(
	t *testing.T,
	station *friendRequestStation,
) {
	t.Helper()
	var count int64
	if err := station.db.Model(&dbmodel.Follow{}).
		Where(
			"(follower_id = ? AND following_id = ?) OR "+
				"(follower_id = ? AND following_id = ?)",
			1,
			2,
			2,
			1,
		).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("relationship follow rows = %d, want 0", count)
	}
}
