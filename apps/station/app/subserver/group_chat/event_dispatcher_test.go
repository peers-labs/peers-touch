package group_chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestRelayGroupEventTransportSeparatesRelayAndPeerAuthorization(t *testing.T) {
	nativefed.ClearRelayClient()
	defer nativefed.ClearRelayClient()

	var sawRelayAuth string
	var sawPeerAuth string
	var sawPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawRelayAuth = r.Header.Get("Authorization")
		sawPeerAuth = r.Header.Get(nativefed.ForwardAuthorizationHeader)
		sawPath = r.URL.Path

		var req chat.ApplyGroupEventRequest
		if err := protojson.Unmarshal(readTestBody(t, r), &req); err != nil {
			t.Fatalf("decode event apply request: %v", err)
		}
		if req.GetEvent().GetEventUlid() != "event-1" {
			t.Fatalf("unexpected event apply request: %+v", req.GetEvent())
		}
		resp, err := protojson.Marshal(&chat.ApplyGroupEventResponse{
			LastAcceptedSeq: req.GetEvent().GetSeq(),
			LastEventHash:   req.GetEvent().GetEventHash(),
			Status:          followerProjectionStatusActive,
		})
		if err != nil {
			t.Fatalf("encode event apply response: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(resp)
	}))
	defer server.Close()
	nativefed.RegisterRelayClient(testRelayClientHandle{baseURL: server.URL, token: "relay-token"})

	resp, err := (relayGroupEventTransport{httpClient: server.Client()}).ApplyGroupEvent(
		context.Background(),
		"station-b",
		&chat.ApplyGroupEventRequest{Event: &chat.GroupEvent{
			EventUlid:              "event-1",
			GroupUlid:              "group-1",
			Seq:                    1,
			EventHash:              "hash-1",
			EventType:              "group.proposal.accepted",
			AuthorityStationPeerId: "station-a",
			AuthorityEpoch:         1,
			MembershipEpoch:        1,
		}},
		"peer-jwt",
	)
	if err != nil {
		t.Fatalf("apply event: %v", err)
	}
	if resp.GetLastAcceptedSeq() != 1 || resp.GetLastEventHash() != "hash-1" {
		t.Fatalf("unexpected apply response: %+v", resp)
	}
	if sawPath != "/relay/forward/station-b/group-chat/event/apply" {
		t.Fatalf("unexpected relay path: %s", sawPath)
	}
	if sawRelayAuth != "Bearer relay-token" {
		t.Fatalf("expected relay Authorization header, got %q", sawRelayAuth)
	}
	if sawPeerAuth != "Bearer peer-jwt" {
		t.Fatalf("expected forwarded peer auth header, got %q", sawPeerAuth)
	}
}

func TestRelayGroupEventTransportSyncSeparatesRelayAndPeerAuthorization(t *testing.T) {
	nativefed.ClearRelayClient()
	defer nativefed.ClearRelayClient()

	var sawRelayAuth string
	var sawPeerAuth string
	var sawPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawRelayAuth = r.Header.Get("Authorization")
		sawPeerAuth = r.Header.Get(nativefed.ForwardAuthorizationHeader)
		sawPath = r.URL.Path

		var req chat.SyncGroupEventsRequest
		if err := protojson.Unmarshal(readTestBody(t, r), &req); err != nil {
			t.Fatalf("decode event sync request: %v", err)
		}
		if req.GetGroupUlid() != "group-1" || req.GetAfterSeq() != 1 {
			t.Fatalf("unexpected event sync request: %+v", &req)
		}
		resp, err := protojson.Marshal(&chat.SyncGroupEventsResponse{
			LastSeq:       2,
			LastEventHash: "hash-2",
			Events: []*chat.GroupEvent{
				{EventUlid: "event-2", GroupUlid: "group-1", Seq: 2, PrevHash: "hash-1", EventHash: "hash-2"},
			},
		})
		if err != nil {
			t.Fatalf("encode event sync response: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(resp)
	}))
	defer server.Close()
	nativefed.RegisterRelayClient(testRelayClientHandle{baseURL: server.URL, token: "relay-token"})

	resp, err := (relayGroupEventTransport{httpClient: server.Client()}).SyncGroupEvents(
		context.Background(),
		"station-a",
		&chat.SyncGroupEventsRequest{GroupUlid: "group-1", AfterSeq: 1, Limit: 100},
		"peer-jwt",
	)
	if err != nil {
		t.Fatalf("sync events: %v", err)
	}
	if resp.GetLastSeq() != 2 || len(resp.GetEvents()) != 1 {
		t.Fatalf("unexpected sync response: %+v", resp)
	}
	if sawPath != "/relay/forward/station-a/group-chat/event/sync" {
		t.Fatalf("unexpected relay path: %s", sawPath)
	}
	if sawRelayAuth != "Bearer relay-token" {
		t.Fatalf("expected relay Authorization header, got %q", sawRelayAuth)
	}
	if sawPeerAuth != "Bearer peer-jwt" {
		t.Fatalf("expected forwarded peer auth header, got %q", sawPeerAuth)
	}
}

func TestDispatchFederationOutboxAppliesToFollowerHandler(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		followerStation  = "station-b"
	)
	db, openErr := gorm.Open(sqlite.Open("file:federation_outbox_dispatch?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&federationOutboxModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	event := domain.GroupEvent{
		EventULID:              "event-1",
		GroupID:                "group-1",
		Seq:                    1,
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		MembershipEpoch:        1,
		AuthorityStationPeerID: authorityStation,
		AuthorityEpoch:         1,
		CreatedAt:              time.Now(),
	}
	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal event payload: %v", err)
	}
	if err := db.Create(&federationOutboxModel{
		EventULID:              event.EventULID,
		GroupULID:              event.GroupID,
		Seq:                    event.Seq,
		TargetStationPeerID:    followerStation,
		AuthorityStationPeerID: authorityStation,
		AuthorityEpoch:         event.AuthorityEpoch,
		Status:                 federationOutboxStatusPending,
		Payload:                string(payload),
		CreatedAt:              time.Now(),
		UpdatedAt:              time.Now(),
	}).Error; err != nil {
		t.Fatalf("create federation outbox: %v", err)
	}

	follower := newTestSubServer()
	follower.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(followerStation),
	)
	authority := newTestSubServer()
	authority.service = &service{db: db}
	authority.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	authority.eventTransport = localGroupEventTransport{t: t, follower: follower}

	if dispatched := authority.dispatchFederationOutbox(context.Background(), 10); dispatched != 1 {
		t.Fatalf("expected one dispatched event, got %d", dispatched)
	}
	var row federationOutboxModel
	if err := db.Where("event_ulid = ? AND target_station_peer_id = ?", event.EventULID, followerStation).First(&row).Error; err != nil {
		t.Fatalf("read federation outbox: %v", err)
	}
	if row.Status != federationOutboxStatusApplied || row.LastError != "" || row.AttemptCount != 0 {
		t.Fatalf("expected applied outbox row, got %+v", row)
	}
	projection, ok := follower.service.followers["group-1\x00station-a"]
	if !ok {
		t.Fatalf("expected follower projection to be advanced")
	}
	if projection.LastSeq != 1 || projection.LastEventHash != "hash-1" || projection.Status != followerProjectionStatusActive {
		t.Fatalf("unexpected follower projection: %+v", projection)
	}
}

func TestDispatchFollowerEventSyncPullsFromAuthorityHandler(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		followerStation  = "station-b"
	)
	authority := newTestSubServer()
	authority.federationSyncWrapper = serverwrapper.RequireFederationToken(
		groupChatEventSyncScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(authorityStation),
	)
	group := authority.service.CreateGroup("owner", "Engineering", "")
	authority.service.groupEvents[group.ID] = []domain.GroupEvent{
		{
			EventULID:              "event-1",
			GroupID:                group.ID,
			Seq:                    1,
			EventHash:              "hash-1",
			EventType:              "group.created",
			AuthorityStationPeerID: authorityStation,
			AuthorityEpoch:         1,
			MembershipEpoch:        1,
		},
		{
			EventULID:              "event-2",
			GroupID:                group.ID,
			Seq:                    2,
			PrevHash:               "hash-1",
			EventHash:              "hash-2",
			EventType:              "group.proposal.accepted",
			AuthorityStationPeerID: authorityStation,
			AuthorityEpoch:         1,
			MembershipEpoch:        1,
		},
	}

	follower := newTestSubServer()
	follower.localStationID = followerStation
	follower.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	follower.eventTransport = localGroupEventTransport{t: t, authority: authority}
	follower.service.followers[group.ID+"\x00"+authorityStation] = domain.FollowerProjection{
		GroupID:                group.ID,
		AuthorityStationPeerID: authorityStation,
		AuthorityEpoch:         1,
		LastSeq:                1,
		LastEventHash:          "hash-1",
		Status:                 followerProjectionStatusActive,
	}

	if synced := follower.dispatchFollowerEventSync(context.Background(), 10); synced != 1 {
		t.Fatalf("expected one follower sync, got %d", synced)
	}
	projection := follower.service.followers[group.ID+"\x00"+authorityStation]
	if projection.LastSeq != 2 || projection.LastEventHash != "hash-2" || projection.Status != followerProjectionStatusActive {
		t.Fatalf("unexpected follower projection after sync: %+v", projection)
	}
}

func TestDispatchFollowerEventSyncMarksDegradedOnAuthorityFailure(t *testing.T) {
	follower := newTestSubServer()
	const authorityStation = "station-a"
	groupID := "group-1"
	follower.localStationID = "station-b"
	follower.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	follower.eventTransport = failingGroupEventTransport{err: errors.New("authority unavailable")}
	follower.service.followers[groupID+"\x00"+authorityStation] = domain.FollowerProjection{
		GroupID:                groupID,
		AuthorityStationPeerID: authorityStation,
		AuthorityEpoch:         1,
		LastSeq:                1,
		LastEventHash:          "hash-1",
		Status:                 followerProjectionStatusActive,
	}

	if synced := follower.dispatchFollowerEventSync(context.Background(), 10); synced != 0 {
		t.Fatalf("expected no successful syncs, got %d", synced)
	}
	projection := follower.service.followers[groupID+"\x00"+authorityStation]
	if projection.Status != followerProjectionStatusDegraded || projection.ProtectionReason == "" {
		t.Fatalf("expected degraded projection after authority failure, got %+v", projection)
	}
	if retryable, err := follower.service.ListFollowerProjections(10); err != nil || len(retryable) != 1 || retryable[0].Status != followerProjectionStatusDegraded {
		t.Fatalf("expected degraded projection to remain retryable, projections=%+v err=%v", retryable, err)
	}
}

func TestDispatchFollowerEventSyncRestoresActiveAfterAuthorityRecovery(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		followerStation  = "station-b"
	)
	authority := newTestSubServer()
	authority.federationSyncWrapper = serverwrapper.RequireFederationToken(
		groupChatEventSyncScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(authorityStation),
	)
	group := authority.service.CreateGroup("owner", "Engineering", "")

	follower := newTestSubServer()
	follower.localStationID = followerStation
	follower.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	follower.eventTransport = localGroupEventTransport{t: t, authority: authority}
	follower.service.followers[group.ID+"\x00"+authorityStation] = domain.FollowerProjection{
		GroupID:                group.ID,
		AuthorityStationPeerID: authorityStation,
		AuthorityEpoch:         1,
		LastSeq:                1,
		LastEventHash:          "hash-1",
		Status:                 followerProjectionStatusDegraded,
		ProtectionReason:       "authority unavailable",
	}

	if synced := follower.dispatchFollowerEventSync(context.Background(), 10); synced != 1 {
		t.Fatalf("expected one successful sync, got %d", synced)
	}
	projection := follower.service.followers[group.ID+"\x00"+authorityStation]
	if projection.Status != followerProjectionStatusActive || projection.ProtectionReason != "" {
		t.Fatalf("expected recovered projection to become active, got %+v", projection)
	}
}

type localGroupEventTransport struct {
	t         *testing.T
	follower  *subServer
	authority *subServer
}

func (tr localGroupEventTransport) ApplyGroupEvent(ctx context.Context, targetStationPeerID string, req *chat.ApplyGroupEventRequest, token string) (*chat.ApplyGroupEventResponse, error) {
	_ = ctx
	_ = targetStationPeerID
	response := invokeGroupChatHandler(tr.t, tr.follower, "gc-event-apply", req, token)
	if response.status != 200 {
		return nil, proposalDispatchError(response.status, response.body.String())
	}
	var decoded chat.ApplyGroupEventResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}

type failingGroupEventTransport struct {
	err error
}

func (tr failingGroupEventTransport) ApplyGroupEvent(ctx context.Context, targetStationPeerID string, req *chat.ApplyGroupEventRequest, token string) (*chat.ApplyGroupEventResponse, error) {
	return nil, tr.err
}

func (tr failingGroupEventTransport) SyncGroupEvents(ctx context.Context, targetStationPeerID string, req *chat.SyncGroupEventsRequest, token string) (*chat.SyncGroupEventsResponse, error) {
	return nil, tr.err
}

func (tr localGroupEventTransport) SyncGroupEvents(ctx context.Context, targetStationPeerID string, req *chat.SyncGroupEventsRequest, token string) (*chat.SyncGroupEventsResponse, error) {
	_ = ctx
	_ = targetStationPeerID
	response := invokeGroupChatHandler(tr.t, tr.authority, "gc-event-sync", req, token)
	if response.status != 200 {
		return nil, proposalDispatchError(response.status, response.body.String())
	}
	var decoded chat.SyncGroupEventsResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}
