package groupcall

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/mediaaccess"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
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
	allowed      bool
	ejected      bool
	err          error
}

func (f *groupCallTestFederation) LocalStationPeerID() string {
	return f.localStation
}

func (f *groupCallTestFederation) CallPeer(
	_ context.Context,
	call federationruntime.PeerCall,
) error {
	f.call = &call
	if f.err != nil {
		return f.err
	}
	if response, ok := call.Response.(*realtime.GroupCallEndpointControlResponse); ok {
		response.Allowed = f.allowed
		response.Ejected = f.ejected
		return nil
	}
	response := call.Response.(*realtime.GroupCallAuthorityJoinResponse)
	response.Decision = f.decision
	if f.decision ==
		realtime.GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_AUTHORIZED {
		response.Url = "ws://livekit.example.test"
		response.Token = "authority-token"
		response.RoomName = "gc-" + testGroupCallID
		grant := call.Request.(*realtime.GroupCallAuthorityJoinRequest).GetEndpointGrant()
		response.GrantId = grant.GetGrantId()
		response.ParticipantIdentity = "gce-" + grant.GetGrantId()
	}
	return nil
}

type groupCallTestRoomProvider struct {
	createdFor  string
	tokenFor    string
	admittedSID string
	admitErr    error
	removeErr   error
	removed     []string
	roomStatus  RoomStatus
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

func (p *groupCallTestRoomProvider) AdmitParticipant(_ context.Context, _, _, sid, _ string) error {
	p.admittedSID = sid
	return p.admitErr
}

func (p *groupCallTestRoomProvider) ReadRoom(context.Context, string) (*RoomStatus, error) {
	status := p.roomStatus
	return &status, nil
}

func (p *groupCallTestRoomProvider) RemoveParticipant(
	_ context.Context,
	_ string,
	identity string,
) error {
	p.removed = append(p.removed, identity)
	return p.removeErr
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

func TestIssueAtAuthorityMintsLocallyOnlyAtConversationAuthority(t *testing.T) {
	subserver, roomProvider, federation := newGroupCallFixture(t)
	grant := testEndpointGrant()

	response, err := subserver.issueAtAuthority(context.Background(), grant)
	if err != nil {
		t.Fatal(err)
	}
	if response.Token != "local-token" ||
		roomProvider.createdFor != testGroupCallID ||
		roomProvider.tokenFor != grant.identity() ||
		response.ParticipantIdentity != grant.identity() {
		t.Fatalf("local authority grant = %+v", response)
	}
	if federation.call == nil || federation.call.Route != federationruntime.PeerRouteGroupCallEndpointControl {
		t.Fatal("local authority did not recheck the endpoint's remote Home")
	}
}

func TestIssueAtAuthorityForwardsRemoteMemberToConversationAuthority(t *testing.T) {
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

	grant := testEndpointGrant()
	response, err := subserver.issueAtAuthority(context.Background(), grant)
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
		input.GetAuthorityEpoch() != testGroupCallEpoch ||
		input.GetEndpointGrant().GetSessionId() != grant.SessionID ||
		federation.call.Claims[federationruntime.ClaimCanonicalRequestSHA256] != groupRequestDigest(input) {
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
		EndpointGrant:           testEndpointGrant().wire(),
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
			subserver, roomProvider, _ := newGroupCallFixture(t)
			subserver.authority = groupCallTestAuthority{
				authority:  testGroupCallAuthority,
				memberHome: testGroupCallHome,
				member:     testCase.member,
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
		EndpointGrant:           testEndpointGrant().wire(),
	}
	claims := &authfed.VerifiedClaims{
		Issuer:   testGroupCallHome,
		Audience: testGroupCallAuthority,
		Subject:  testGroupCallActor,
		Custom: map[string]string{
			federationruntime.ClaimFederationID:           testGroupCallFederation,
			federationruntime.ClaimConversationID:         testGroupCallID,
			federationruntime.ClaimActorPTID:              testGroupCallActor,
			federationruntime.ClaimAuthorityEpoch:         "7",
			federationruntime.ClaimSourceStationPeerID:    testGroupCallHome,
			federationruntime.ClaimTargetStationPeerID:    testGroupCallAuthority,
			federationruntime.ClaimCanonicalRequestSHA256: groupRequestDigest(input),
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
	claims.Custom[federationruntime.ClaimAuthorityEpoch] = "7"
	input.EndpointGrant.ActorDeviceId = "another-device"
	if err := validateAuthorityJoinClaims(claims, input, testGroupCallAuthority); err == nil {
		t.Fatal("changed endpoint with old signed digest was accepted")
	}
}

func groupCallActorContext() context.Context {
	return coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: testGroupCallActor, SessionID: "session-alice"},
	)
}

type groupCallTestFence struct{}

func (groupCallTestFence) WithGroupCallFence(_ context.Context, _ string,
	_ mediaaccess.Endpoint, _ string, _ uint64, action func() error) error {
	return action()
}

func testEndpointGrant() endpointGrant {
	return endpointGrant{
		GrantID: strings.Repeat("a", 64), Side: grantAuthority,
		ConversationID: testGroupCallID, ActorPTID: testGroupCallActor,
		DeviceID: "device-alice", SessionID: "session-alice",
		Home: testGroupCallHome, Authority: testGroupCallAuthority,
		FederationID: testGroupCallFederation, AuthorityEpoch: testGroupCallEpoch,
		ExpiresAt: time.Now().Add(time.Hour).UTC().Truncate(time.Millisecond),
		Status:    grantIssued,
	}
}

func newGroupCallFixture(t *testing.T) (*subServer, *groupCallTestRoomProvider, *groupCallTestFederation) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "grants.db")),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&endpointGrant{}, &invitationDecision{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	provider := &groupCallTestRoomProvider{}
	federation := &groupCallTestFederation{localStation: testGroupCallAuthority, allowed: true, ejected: true}
	s := &subServer{
		db: db, provider: provider, federation: federation, authorityFence: groupCallTestFence{},
		authority: groupCallTestAuthority{authority: testGroupCallAuthority, memberHome: testGroupCallHome, member: true},
		members:   groupCallTestMembers{testGroupCallActor},
	}
	return s, provider, federation
}

type groupCallTestMembers []string

func (m groupCallTestMembers) ListGroupMemberPTIDs(context.Context, string) ([]string, error) {
	return m, nil
}
