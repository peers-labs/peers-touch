package groupcall

import (
	"context"
	"errors"
	"net/http"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

const (
	testGroupCallID         = "01K5Q2E43C7FJ0Y3KJB4H8M7NP"
	testGroupCallActor      = "ptid:alice"
	testGroupCallHome       = "station-home"
	testGroupCallAuthority  = "station-authority"
	testGroupCallFederation = "01K5Q2E43C7FJ0Y3KJB4H8M7NQ"
	testGroupCallEpoch      = uint64(7)
)

type groupCallTestAuthority struct {
	authority  string
	memberHome string
	member     bool
}

func (a groupCallTestAuthority) ResolveGroupCallAuthority(
	context.Context,
	string,
	string,
) (string, string, uint64, string, bool, error) {
	return a.authority,
		testGroupCallFederation,
		testGroupCallEpoch,
		a.memberHome,
		a.member,
		nil
}

type groupCallTestFederation struct {
	localStation string
	call         *federationruntime.PeerCall
	decision     realtime.GroupCallAuthorityJoinDecision
}

func (f *groupCallTestFederation) LocalStationPeerID() string {
	return f.localStation
}

func (f *groupCallTestFederation) CallPeer(
	_ context.Context,
	call federationruntime.PeerCall,
) error {
	f.call = &call
	response := call.Response.(*realtime.GroupCallAuthorityJoinResponse)
	response.Decision = f.decision
	if f.decision ==
		realtime.GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_AUTHORIZED {
		response.Url = "ws://livekit.example.test"
		response.Token = "authority-token"
		response.RoomName = "gc-" + testGroupCallID
	}
	return nil
}

type groupCallTestRoomProvider struct {
	createdFor string
	tokenFor   string
}

func (p *groupCallTestRoomProvider) CreateRoom(
	_ context.Context,
	groupULID string,
) (string, error) {
	p.createdFor = groupULID
	return "gc-" + groupULID, nil
}

func (p *groupCallTestRoomProvider) GenerateToken(
	_ context.Context,
	roomName string,
	actorPTID string,
) (string, string, error) {
	p.tokenFor = actorPTID
	return "ws://livekit.example.test", "local-token", nil
}

func (*groupCallTestRoomProvider) RemoveParticipant(
	context.Context,
	string,
	string,
) error {
	return nil
}

func (*groupCallTestRoomProvider) CloseRoom(context.Context, string) error {
	return nil
}

func (*groupCallTestRoomProvider) HandleWebhook(
	context.Context,
	*http.Request,
) error {
	return nil
}

func TestHandleJoinMintsLocallyOnlyAtConversationAuthority(t *testing.T) {
	roomProvider := &groupCallTestRoomProvider{}
	federation := &groupCallTestFederation{
		localStation: testGroupCallAuthority,
	}
	subserver := &subServer{
		provider: roomProvider,
		authority: groupCallTestAuthority{
			authority:  testGroupCallAuthority,
			memberHome: testGroupCallAuthority,
			member:     true,
		},
		federation: federation,
	}

	response, err := subserver.handleJoin(
		groupCallActorContext(),
		&JoinRequest{GroupULID: testGroupCallID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Token != "local-token" ||
		roomProvider.createdFor != testGroupCallID ||
		roomProvider.tokenFor != testGroupCallActor {
		t.Fatalf("local authority grant = %+v", response)
	}
	if federation.call != nil {
		t.Fatal("local authority unexpectedly forwarded the join")
	}
}

func TestHandleJoinForwardsRemoteMemberToConversationAuthority(t *testing.T) {
	roomProvider := &groupCallTestRoomProvider{}
	federation := &groupCallTestFederation{
		localStation: testGroupCallHome,
		decision: realtime.
			GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_AUTHORIZED,
	}
	subserver := &subServer{
		provider: roomProvider,
		authority: groupCallTestAuthority{
			authority:  testGroupCallAuthority,
			memberHome: testGroupCallHome,
			member:     true,
		},
		federation: federation,
	}

	response, err := subserver.handleJoin(
		groupCallActorContext(),
		&JoinRequest{GroupULID: testGroupCallID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Token != "authority-token" {
		t.Fatalf("remote authority grant = %+v", response)
	}
	if roomProvider.createdFor != "" {
		t.Fatal("Home Station minted a group-call token")
	}
	if federation.call == nil ||
		federation.call.TargetStationPeerID != testGroupCallAuthority ||
		federation.call.Route != federationruntime.PeerRouteGroupCallAuthorityJoin ||
		federation.call.Subject != testGroupCallActor {
		t.Fatalf("Federation call = %+v", federation.call)
	}
	input := federation.call.Request.(*realtime.GroupCallAuthorityJoinRequest)
	if input.GetConversationId() != testGroupCallID ||
		input.GetActorPtid() != testGroupCallActor ||
		input.GetSourceHomeStationPeerId() != testGroupCallHome ||
		input.GetFederationId() != testGroupCallFederation ||
		input.GetAuthorityEpoch() != testGroupCallEpoch {
		t.Fatalf("authority request = %+v", input)
	}
}

func TestHandleJoinRejectsNonMemberWithoutForwardingOrMinting(t *testing.T) {
	roomProvider := &groupCallTestRoomProvider{}
	federation := &groupCallTestFederation{localStation: testGroupCallHome}
	subserver := &subServer{
		provider: roomProvider,
		authority: groupCallTestAuthority{
			authority:  testGroupCallAuthority,
			memberHome: testGroupCallHome,
			member:     false,
		},
		federation: federation,
	}

	_, err := subserver.handleJoin(
		groupCallActorContext(),
		&JoinRequest{GroupULID: testGroupCallID},
	)
	var handlerError *server.HandlerError
	if !errors.As(err, &handlerError) ||
		handlerError.Code != http.StatusForbidden {
		t.Fatalf("non-member error = %v", err)
	}
	if federation.call != nil || roomProvider.createdFor != "" {
		t.Fatal("non-member reached forwarding or token issuance")
	}
}

func TestFederatedAuthorityRevalidatesMembershipBeforeMinting(t *testing.T) {
	input := &realtime.GroupCallAuthorityJoinRequest{
		ConversationId:          testGroupCallID,
		ActorPtid:               testGroupCallActor,
		SourceHomeStationPeerId: testGroupCallHome,
		FederationId:            testGroupCallFederation,
		AuthorityEpoch:          testGroupCallEpoch,
	}
	for _, testCase := range []struct {
		name         string
		member       bool
		wantDecision realtime.GroupCallAuthorityJoinDecision
		wantMint     bool
	}{
		{
			name:   "active member",
			member: true,
			wantDecision: realtime.
				GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_AUTHORIZED,
			wantMint: true,
		},
		{
			name:   "removed member",
			member: false,
			wantDecision: realtime.
				GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_NOT_MEMBER,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			roomProvider := &groupCallTestRoomProvider{}
			subserver := &subServer{
				provider: roomProvider,
				authority: groupCallTestAuthority{
					authority:  testGroupCallAuthority,
					memberHome: testGroupCallHome,
					member:     testCase.member,
				},
				federation: &groupCallTestFederation{
					localStation: testGroupCallAuthority,
				},
			}

			response, err := subserver.joinForFederatedAuthority(
				context.Background(),
				input,
			)
			if err != nil {
				t.Fatal(err)
			}
			if response.GetDecision() != testCase.wantDecision {
				t.Fatalf("decision = %s", response.GetDecision())
			}
			if got := roomProvider.createdFor != ""; got != testCase.wantMint {
				t.Fatalf("minted = %t, want %t", got, testCase.wantMint)
			}
		})
	}
}

func TestValidateAuthorityJoinClaimsBindsAuthorityScope(t *testing.T) {
	input := &realtime.GroupCallAuthorityJoinRequest{
		ConversationId:          testGroupCallID,
		ActorPtid:               testGroupCallActor,
		SourceHomeStationPeerId: testGroupCallHome,
		FederationId:            testGroupCallFederation,
		AuthorityEpoch:          testGroupCallEpoch,
	}
	claims := &authfed.VerifiedClaims{
		Issuer:   testGroupCallHome,
		Audience: testGroupCallAuthority,
		Subject:  testGroupCallActor,
		Custom: map[string]string{
			federationruntime.ClaimFederationID:        testGroupCallFederation,
			federationruntime.ClaimConversationID:      testGroupCallID,
			federationruntime.ClaimActorPTID:           testGroupCallActor,
			federationruntime.ClaimAuthorityEpoch:      "7",
			federationruntime.ClaimSourceStationPeerID: testGroupCallHome,
			federationruntime.ClaimTargetStationPeerID: testGroupCallAuthority,
		},
	}
	if err := validateAuthorityJoinClaims(
		claims,
		input,
		testGroupCallAuthority,
	); err != nil {
		t.Fatal(err)
	}

	claims.Custom[federationruntime.ClaimAuthorityEpoch] = "8"
	if err := validateAuthorityJoinClaims(
		claims,
		input,
		testGroupCallAuthority,
	); err == nil {
		t.Fatal("mismatched authority epoch was accepted")
	}
}

func groupCallActorContext() context.Context {
	return coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: testGroupCallActor},
	)
}
