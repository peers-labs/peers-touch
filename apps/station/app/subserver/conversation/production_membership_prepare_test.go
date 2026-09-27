package conversation

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type productionMembershipPrepareRuntime struct {
	call federationruntime.PeerCall
}

func (*productionMembershipPrepareRuntime) RegisterReceivers(
	federationruntime.ReceiverRegistrar,
) error {
	return errors.New("receiver registration is outside this test")
}

func (*productionMembershipPrepareRuntime) DeliverConversationTyping(
	context.Context,
	*federationdelivery.Frame,
) (federationdelivery.Result, error) {
	return federationdelivery.Result{}, errors.New("typing delivery is outside this test")
}

func (r *productionMembershipPrepareRuntime) CallPeer(
	_ context.Context,
	call federationruntime.PeerCall,
) error {
	r.call = call
	response, ok := call.Response.(*chatmodel.PrepareFederatedConversationCommandResponse)
	if !ok {
		return errors.New("membership prepare response has an unexpected type")
	}
	response.Preparation =
		&chatmodel.PrepareFederatedConversationCommandResponse_MembershipPlan{
			MembershipPlan: &chatmodel.PrepareConversationMembershipResponse{
				AuthorityPlanId:        "plan-1",
				AuthorityStationPeerId: call.TargetStationPeerID,
			},
		}

	return nil
}

func (*productionMembershipPrepareRuntime) OpenPeerStream(
	context.Context,
	federationruntime.PeerStreamCall,
) (*federationruntime.PeerStreamResponse, error) {
	return nil, errors.New("peer streaming is outside this test")
}

func (*productionMembershipPrepareRuntime) VerifyPeerSignature(
	context.Context,
	string,
	string,
	[]byte,
	[]byte,
) error {
	return errors.New("signature verification is outside this test")
}

func (*productionMembershipPrepareRuntime) Signer() federationdelivery.Signer {
	return nil
}

func (*productionMembershipPrepareRuntime) LocalStationPeerID() string {
	return "station-home"
}

func TestForwardPrepareMembershipUsesCanonicalFederationPrepareRoute(t *testing.T) {
	runtime := &productionMembershipPrepareRuntime{}
	server := &subServer{
		localStation: "station-home",
		composition: &ProductionComposition{
			FederationRuntime: func() (ProductionFederationRuntime, error) {
				return runtime, nil
			},
		},
	}
	request := &chatmodel.PrepareConversationMembershipRequest{
		ConversationId: "conversation-1",
		Sender: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:bob",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		Action: chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_LEAVE,
		TargetActor: &actormodel.ActorRef{
			Ptid: "ptid:alice",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
	}
	conversation := aggregate.Snapshot{
		ID:               "conversation-1",
		FederationID:     "federation-1",
		AuthorityStation: "station-authority",
		AuthorityEpoch:   7,
	}

	plan, err := server.forwardPrepareMembership(
		context.Background(),
		request,
		conversation,
	)
	if err != nil {
		t.Fatal(err)
	}
	if plan.GetAuthorityPlanId() != "plan-1" ||
		plan.GetAuthorityStationPeerId() != "station-authority" {
		t.Fatalf("membership plan = %+v", plan)
	}
	call := runtime.call
	if call.TargetStationPeerID != "station-authority" ||
		call.Route != federationruntime.PeerRouteConversationCommandPrepare ||
		call.Subject != "ptid:bob" {
		t.Fatalf("membership prepare peer route = %+v", call)
	}
	for key, expected := range map[string]string{
		federationruntime.ClaimFederationID:        "federation-1",
		federationruntime.ClaimConversationID:      "conversation-1",
		federationruntime.ClaimActorPTID:           "ptid:bob",
		federationruntime.ClaimDeviceID:            "bob-device",
		federationruntime.ClaimAuthorityEpoch:      strconv.FormatInt(7, 10),
		federationruntime.ClaimSourceStationPeerID: "station-home",
		federationruntime.ClaimTargetStationPeerID: "station-authority",
	} {
		if call.Claims[key] != expected {
			t.Fatalf("claim %s = %q, want %q", key, call.Claims[key], expected)
		}
	}
	envelope, ok := call.Request.(*chatmodel.PrepareFederatedConversationCommandRequest)
	if !ok ||
		envelope.GetRequest() != nil ||
		envelope.GetSourceHomeStationPeerId() != "station-home" ||
		!proto.Equal(envelope.GetMembershipRequest(), request) {
		t.Fatalf("membership prepare envelope = %+v", call.Request)
	}
}
