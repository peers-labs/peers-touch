package group_chat

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRelayMediatedThreeStationProposalPressureAcceptance(t *testing.T) {
	registerGroupChatFederationScope()
	nativefed.ClearRelayClient()
	defer nativefed.ClearRelayClient()

	const (
		stationA     = "station-a"
		stationB     = "station-b"
		stationC     = "station-c"
		remoteActors = 100
		activeSender = 10
		messageCount = 1000
	)

	authority := newDBBackedAcceptanceSubServer(t, "relay_pressure_authority")
	authority.localStationID = stationA
	authority.federationProposalWrapper = serverwrapper.RequireFederationToken(
		groupChatProposalScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(stationA),
	)
	authority.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))

	stationBHome := newTestSubServer()
	stationBHome.localStationID = stationB
	stationBHome.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	stationBHome.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(stationB),
	)

	stationCHome := newTestSubServer()
	stationCHome.localStationID = stationC
	stationCHome.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	stationCHome.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(stationC),
	)

	relay := httptest.NewServer(newGroupChatAcceptanceRelay(t, map[string]*subServer{
		stationA: authority,
		stationB: stationBHome,
		stationC: stationCHome,
	}))
	defer relay.Close()
	nativefed.RegisterRelayClient(testRelayClientHandle{baseURL: relay.URL, token: "relay-token"})
	stationBHome.proposalTransport = relayGroupProposalTransport{httpClient: relay.Client()}
	stationCHome.proposalTransport = relayGroupProposalTransport{httpClient: relay.Client()}
	authority.eventTransport = relayGroupEventTransport{httpClient: relay.Client()}

	group := authority.service.CreateGroup("alice", "Foundation Pressure Group", "")
	if strings.TrimSpace(group.ID) == "" {
		t.Fatal("expected group to be created")
	}
	created := readAuthorityEventBySeq(t, authority.service.db, group.ID, 1)
	seedFollowerProjection(stationBHome, group.ID, stationA, created.EventHash)
	seedFollowerProjection(stationCHome, group.ID, stationA, created.EventHash)

	members := make([]memberModel, 0, remoteActors)
	actors := make([]domain.FederatedActorRef, 0, remoteActors)
	now := time.Now()
	for i := 0; i < remoteActors; i++ {
		homeStation := stationB
		if i%2 == 1 {
			homeStation = stationC
		}
		actorDID := fmt.Sprintf("remote-actor-%03d", i)
		actors = append(actors, domain.FederatedActorRef{ActorDID: actorDID, HomeStationPeerID: homeStation})
		members = append(members, memberModel{
			GroupULID:              group.ID,
			ActorDID:               actorDID,
			ActorHomeStationPeerID: homeStation,
			Role:                   domain.GroupRoleMember,
			JoinedAt:               now,
			CreatedAt:              now,
			UpdatedAt:              now,
		})
	}
	if err := authority.service.db.Create(&members).Error; err != nil {
		t.Fatalf("seed remote members: %v", err)
	}

	enqueueStarted := time.Now()
	for i := 0; i < messageCount; i++ {
		actor := actors[(i%(activeSender/2))*2]
		if i%2 == 1 {
			actor = actors[(i%(activeSender/2))*2+1]
		}
		source := stationBHome
		if actor.HomeStationPeerID == stationC {
			source = stationCHome
		}
		proposalID := fmt.Sprintf("proposal-pressure-%04d", i)
		proposal := domain.GroupProposal{
			ProposalULID:            proposalID,
			GroupID:                 group.ID,
			Actor:                   actor,
			Command:                 int32(chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND),
			CommandPayload:          []byte(fmt.Sprintf("opaque-e2ee-message-command-%04d", i)),
			ObservedMembershipEpoch: group.MembershipEpoch,
			AuthorityStationPeerID:  stationA,
			AuthorityEpoch:          foundationAuthorityEpoch,
			IdempotencyKey:          proposalID,
			SigningKeyID:            actor.ActorDID + "#1",
			Signature:               []byte("signature"),
			CreatedAt:               time.Now(),
		}
		if _, replay, err := source.service.EnqueueProposalOutbox(proposal); err != nil || replay {
			t.Fatalf("enqueue proposal %s replay=%v err=%v", proposalID, replay, err)
		}
	}
	enqueueDuration := time.Since(enqueueStarted)

	ctx := context.Background()
	proposalDispatchStarted := time.Now()
	dispatchedProposals := dispatchAllGroupProposalOutbox(t, ctx, messageCount, 100, stationBHome, stationCHome)
	proposalDispatchDuration := time.Since(proposalDispatchStarted)
	if dispatchedProposals != messageCount {
		t.Fatalf("expected %d dispatched proposals, got %d", messageCount, dispatchedProposals)
	}

	var acceptedCount int64
	if err := authority.service.db.Model(&groupEventModel{}).
		Where("group_ulid = ? AND event_type = ?", group.ID, "group.proposal.accepted").
		Count(&acceptedCount).Error; err != nil {
		t.Fatalf("count accepted events: %v", err)
	}
	if acceptedCount != messageCount {
		t.Fatalf("expected %d accepted proposal events, got %d", messageCount, acceptedCount)
	}

	fanoutStarted := time.Now()
	dispatchedEvents := dispatchAllFederationOutbox(t, ctx, authority, messageCount*2, 200)
	fanoutDuration := time.Since(fanoutStarted)
	if dispatchedEvents != messageCount*2 {
		t.Fatalf("expected %d federated event deliveries, got %d", messageCount*2, dispatchedEvents)
	}

	last := readAuthorityEventBySeq(t, authority.service.db, group.ID, int64(messageCount+1))
	for _, follower := range []struct {
		name string
		sub  *subServer
	}{
		{name: stationB, sub: stationBHome},
		{name: stationC, sub: stationCHome},
	} {
		projection := follower.sub.service.followers[group.ID+"\x00"+stationA]
		if projection.LastSeq != last.Seq || projection.LastEventHash != last.EventHash || projection.Status != followerProjectionStatusActive {
			t.Fatalf("unexpected follower projection for %s: %+v last=%+v", follower.name, projection, last)
		}
	}

	t.Logf(
		"3-station federated pressure actors=%d active_senders=%d proposals=%d fanout_deliveries=%d enqueue_ms=%d proposal_dispatch_ms=%d fanout_ms=%d",
		remoteActors,
		activeSender,
		messageCount,
		dispatchedEvents,
		enqueueDuration.Milliseconds(),
		proposalDispatchDuration.Milliseconds(),
		fanoutDuration.Milliseconds(),
	)
}

func TestRelayMediatedThreeStationProposalFanoutAcceptance(t *testing.T) {
	registerGroupChatFederationScope()
	nativefed.ClearRelayClient()
	defer nativefed.ClearRelayClient()

	const (
		stationA = "station-a"
		stationB = "station-b"
		stationC = "station-c"
	)

	authority := newDBBackedAcceptanceSubServer(t, "relay_acceptance_authority")
	authority.localStationID = stationA
	authority.federationProposalWrapper = serverwrapper.RequireFederationToken(
		groupChatProposalScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(stationA),
	)
	authority.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))

	bobHome := newTestSubServer()
	bobHome.localStationID = stationB
	bobHome.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	bobFollower := newTestSubServer()
	bobFollower.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(stationB),
	)
	carolHome := newTestSubServer()
	carolHome.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(stationC),
	)

	relay := httptest.NewServer(newGroupChatAcceptanceRelay(t, map[string]*subServer{
		stationA: authority,
		stationB: bobFollower,
		stationC: carolHome,
	}))
	defer relay.Close()
	nativefed.RegisterRelayClient(testRelayClientHandle{baseURL: relay.URL, token: "relay-token"})
	bobHome.proposalTransport = relayGroupProposalTransport{httpClient: relay.Client()}
	authority.eventTransport = relayGroupEventTransport{httpClient: relay.Client()}

	group := authority.service.CreateGroup("alice", "Foundation Group", "")
	if strings.TrimSpace(group.ID) == "" {
		t.Fatal("expected group to be created")
	}
	created := readAuthorityEventBySeq(t, authority.service.db, group.ID, 1)
	seedFollowerProjection(bobFollower, group.ID, stationA, created.EventHash)
	seedFollowerProjection(carolHome, group.ID, stationA, created.EventHash)
	if err := authority.service.db.Create([]memberModel{
		{
			GroupULID:              group.ID,
			ActorDID:               "bob",
			ActorHomeStationPeerID: stationB,
			Role:                   domain.GroupRoleMember,
			JoinedAt:               time.Now(),
			CreatedAt:              time.Now(),
			UpdatedAt:              time.Now(),
		},
		{
			GroupULID:              group.ID,
			ActorDID:               "carol",
			ActorHomeStationPeerID: stationC,
			Role:                   domain.GroupRoleMember,
			JoinedAt:               time.Now(),
			CreatedAt:              time.Now(),
			UpdatedAt:              time.Now(),
		},
	}).Error; err != nil {
		t.Fatalf("seed remote members: %v", err)
	}

	proposal := domain.GroupProposal{
		ProposalULID:            "proposal-bob-message-1",
		GroupID:                 group.ID,
		Actor:                   domain.FederatedActorRef{ActorDID: "bob", HomeStationPeerID: stationB},
		Command:                 int32(chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND),
		CommandPayload:          []byte("opaque-e2ee-message-command"),
		ObservedMembershipEpoch: group.MembershipEpoch,
		AuthorityStationPeerID:  stationA,
		AuthorityEpoch:          foundationAuthorityEpoch,
		IdempotencyKey:          "proposal-bob-message-1",
		SigningKeyID:            "bob#1",
		Signature:               []byte("signature"),
		CreatedAt:               time.Now(),
	}
	if _, replay, err := bobHome.service.EnqueueProposalOutbox(proposal); err != nil || replay {
		t.Fatalf("enqueue proposal replay=%v err=%v", replay, err)
	}
	if dispatched := bobHome.dispatchProposalOutbox(context.Background(), 10); dispatched != 1 {
		t.Fatalf("expected Bob Home Station to dispatch one proposal, got %d", dispatched)
	}
	if item := bobHome.service.proposals[proposal.IdempotencyKey]; item.Status != proposalOutboxStatusAccepted {
		t.Fatalf("expected Bob proposal outbox accepted, got %+v", item)
	}

	accepted := readAuthorityEventBySeq(t, authority.service.db, group.ID, 2)
	if accepted.ProposalULID != proposal.ProposalULID || accepted.EventType != "group.proposal.accepted" {
		t.Fatalf("unexpected accepted authority event: %+v", accepted)
	}
	if dispatched := authority.dispatchFederationOutbox(context.Background(), 10); dispatched != 2 {
		var rows []federationOutboxModel
		if err := authority.service.db.Order("target_station_peer_id ASC").Find(&rows).Error; err != nil {
			t.Fatalf("read federation outbox after dispatch: %v", err)
		}
		t.Fatalf("expected Authority to dispatch to Bob and Carol Home Stations, got %d rows=%+v", dispatched, rows)
	}
	for _, follower := range []struct {
		name string
		sub  *subServer
	}{
		{name: stationB, sub: bobFollower},
		{name: stationC, sub: carolHome},
	} {
		projection := follower.sub.service.followers[group.ID+"\x00"+stationA]
		if projection.LastSeq != 2 || projection.LastEventHash != accepted.EventHash || projection.Status != followerProjectionStatusActive {
			t.Fatalf("unexpected follower projection for %s: %+v", follower.name, projection)
		}
	}
}

func newDBBackedAcceptanceSubServer(t *testing.T, name string) *subServer {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&groupModel{}, &memberModel{}, &groupEventModel{}, &outboxModel{}, &federationOutboxModel{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	sub := newTestSubServer()
	sub.service.db = db
	return sub
}

func readAuthorityEventBySeq(t *testing.T, db *gorm.DB, groupID string, seq int64) groupEventModel {
	t.Helper()
	var row groupEventModel
	if err := db.Where("group_ulid = ? AND seq = ?", groupID, seq).First(&row).Error; err != nil {
		t.Fatalf("read authority event seq=%d: %v", seq, err)
	}
	return row
}

func seedFollowerProjection(sub *subServer, groupID, authorityStationPeerID, eventHash string) {
	sub.service.followers[groupID+"\x00"+authorityStationPeerID] = domain.FollowerProjection{
		GroupID:                groupID,
		AuthorityStationPeerID: authorityStationPeerID,
		AuthorityEpoch:         foundationAuthorityEpoch,
		LastSeq:                1,
		LastEventHash:          eventHash,
		Status:                 followerProjectionStatusActive,
	}
}

func dispatchAllGroupProposalOutbox(t *testing.T, ctx context.Context, expected, limit int, sources ...*subServer) int {
	t.Helper()
	dispatched := 0
	for dispatched < expected {
		progress := 0
		for _, source := range sources {
			progress += source.dispatchProposalOutbox(ctx, limit)
		}
		if progress == 0 {
			t.Fatalf("proposal outbox made no progress after %d/%d dispatched", dispatched, expected)
		}
		dispatched += progress
	}
	return dispatched
}

func dispatchAllFederationOutbox(t *testing.T, ctx context.Context, authority *subServer, expected, limit int) int {
	t.Helper()
	dispatched := 0
	for dispatched < expected {
		progress := authority.dispatchFederationOutbox(ctx, limit)
		if progress == 0 {
			t.Fatalf("federation outbox made no progress after %d/%d dispatched", dispatched, expected)
		}
		dispatched += progress
	}
	return dispatched
}

type groupChatAcceptanceRelay struct {
	t        *testing.T
	stations map[string]*subServer
}

func newGroupChatAcceptanceRelay(t *testing.T, stations map[string]*subServer) http.Handler {
	t.Helper()
	return groupChatAcceptanceRelay{t: t, stations: stations}
}

func (r groupChatAcceptanceRelay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.t.Helper()
	if req.Header.Get("Authorization") != "Bearer relay-token" {
		http.Error(w, "invalid relay token", http.StatusUnauthorized)
		return
	}
	forwardAuth := strings.TrimSpace(req.Header.Get(nativefed.ForwardAuthorizationHeader))
	if forwardAuth == "" {
		http.Error(w, "missing forwarded authorization", http.StatusUnauthorized)
		return
	}
	rest, ok := strings.CutPrefix(req.URL.Path, "/relay/forward/")
	if !ok {
		http.NotFound(w, req)
		return
	}
	stationID, targetPath, ok := strings.Cut(rest, "/")
	if !ok {
		http.NotFound(w, req)
		return
	}
	target, ok := r.stations[stationID]
	if !ok {
		http.NotFound(w, req)
		return
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	token := strings.TrimPrefix(forwardAuth, "Bearer ")
	var response *testResponse
	switch "/" + targetPath {
	case "/group-chat/proposal/accept":
		var decoded chat.AcceptGroupProposalRequest
		if err := protojson.Unmarshal(body, &decoded); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		response = invokeGroupChatHandler(r.t, target, "gc-proposal-accept", &decoded, token)
	case "/group-chat/event/apply":
		var decoded chat.ApplyGroupEventRequest
		if err := protojson.Unmarshal(body, &decoded); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		response = invokeGroupChatHandler(r.t, target, "gc-event-apply", &decoded, token)
	default:
		http.NotFound(w, req)
		return
	}
	for key, value := range response.header {
		w.Header().Set(key, value)
	}
	if response.status != 0 {
		w.WriteHeader(response.status)
	}
	_, _ = w.Write(response.body.Bytes())
}
