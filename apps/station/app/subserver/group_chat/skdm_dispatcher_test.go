package group_chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	events_subserver "github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestRelayGroupSkdmTransportSeparatesRelayAndPeerAuthorization(t *testing.T) {
	nativefed.ClearRelayClient()
	defer nativefed.ClearRelayClient()

	var sawRelayAuth string
	var sawPeerAuth string
	var sawPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawRelayAuth = r.Header.Get("Authorization")
		sawPeerAuth = r.Header.Get(nativefed.ForwardAuthorizationHeader)
		sawPath = r.URL.Path

		var req chat.SubmitGroupSkdmEnvelopeRequest
		if err := protojson.Unmarshal(readTestBody(t, r), &req); err != nil {
			t.Fatalf("decode SKDM request: %v", err)
		}
		if req.GetEnvelope().GetIdempotencyKey() != "skdm-1" {
			t.Fatalf("unexpected SKDM envelope: %+v", req.GetEnvelope())
		}
		resp, err := protojson.Marshal(&chat.SubmitGroupSkdmEnvelopeResponse{
			OutboxUlid: "target-skdm-1",
			Status:     skdmOutboxStatusPending,
		})
		if err != nil {
			t.Fatalf("encode SKDM response: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(resp)
	}))
	defer server.Close()
	nativefed.RegisterRelayClient(testRelayClientHandle{baseURL: server.URL, token: "relay-token"})

	resp, err := (relayGroupSkdmTransport{httpClient: server.Client()}).DeliverGroupSkdmEnvelope(
		context.Background(),
		"station-b",
		&chat.SubmitGroupSkdmEnvelopeRequest{Envelope: &chat.GroupSkdmEnvelope{
			GroupUlid:                  "group-1",
			MembershipEpoch:            1,
			SenderDid:                  "alice",
			SenderKeyId:                7,
			RecipientDid:               "bob",
			RecipientDeviceId:          "bob-device-1",
			RecipientHomeStationPeerId: "station-b",
			EncryptedPayload:           []byte("sealed-skdm-payload"),
			IdempotencyKey:             "skdm-1",
		}},
		"peer-jwt",
	)
	if err != nil {
		t.Fatalf("deliver SKDM envelope: %v", err)
	}
	if resp.GetOutboxUlid() != "target-skdm-1" {
		t.Fatalf("unexpected SKDM response: %+v", resp)
	}
	if sawPath != "/relay/forward/station-b/group-chat/skdm/deliver" {
		t.Fatalf("unexpected relay path: %s", sawPath)
	}
	if sawRelayAuth != "Bearer relay-token" {
		t.Fatalf("expected relay Authorization header, got %q", sawRelayAuth)
	}
	if sawPeerAuth != "Bearer peer-jwt" {
		t.Fatalf("expected forwarded peer auth header, got %q", sawPeerAuth)
	}
}

func TestDeliverGroupSkdmRouteRequiresFederationClaims(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		sourceStation = "station-a"
		targetStation = "station-b"
	)
	target := newTestSubServer()
	target.federationSkdmWrapper = serverwrapper.RequireFederationToken(
		groupChatSkdmDeliverScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(targetStation),
	)
	group := target.service.CreateGroup("alice", "Engineering", "")
	addFederatedMemberForTest(t, target, group.ID, "bob", targetStation)
	req := &chat.SubmitGroupSkdmEnvelopeRequest{Envelope: &chat.GroupSkdmEnvelope{
		GroupUlid:                  group.ID,
		MembershipEpoch:            group.MembershipEpoch,
		SenderDid:                  "alice",
		SenderKeyId:                7,
		RecipientDid:               "bob",
		RecipientDeviceId:          "bob-device-1",
		RecipientHomeStationPeerId: targetStation,
		EncryptedPayload:           []byte("sealed-skdm-payload"),
		IdempotencyKey:             "skdm-1",
	}}
	token := mintGroupChatSkdmToken(t, sourceStation, targetStation, req.GetEnvelope())

	response := invokeGroupChatHandler(t, target, "gc-skdm-deliver", req, token)
	if response.status != 200 {
		t.Fatalf("expected 200, got %d body=%s", response.status, response.body.String())
	}
	var decoded chat.SubmitGroupSkdmEnvelopeResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode SKDM delivery response: %v", err)
	}
	if decoded.GetStatus() != skdmOutboxStatusPending || decoded.GetOutboxUlid() == "" {
		t.Fatalf("unexpected SKDM delivery response: %+v", &decoded)
	}
	if item := target.service.skdmOutbox["skdm-1"]; item.IdempotencyKey != "skdm-1" || string(item.EncryptedPayload) != "sealed-skdm-payload" {
		t.Fatalf("expected target Station to store opaque SKDM envelope, got %+v", item)
	}

	mismatched := &chat.SubmitGroupSkdmEnvelopeRequest{Envelope: req.GetEnvelope()}
	mismatched.Envelope = protoCloneGroupSkdmEnvelope(req.GetEnvelope())
	mismatched.Envelope.RecipientDeviceId = "bob-device-2"
	response = invokeGroupChatHandler(t, target, "gc-skdm-deliver", mismatched, token)
	if response.status != 403 {
		t.Fatalf("expected claim mismatch 403, got %d body=%s", response.status, response.body.String())
	}
}

func TestDispatchGroupSkdmOutboxDeliversToTargetStation(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		sourceStation = "station-a"
		targetStation = "station-b"
	)
	target := newTestSubServer()
	target.federationSkdmWrapper = serverwrapper.RequireFederationToken(
		groupChatSkdmDeliverScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(targetStation),
	)
	group := target.service.CreateGroup("alice", "Engineering", "")
	addFederatedMemberForTest(t, target, group.ID, "bob", targetStation)

	source := newTestSubServer()
	source.localStationID = sourceStation
	source.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	if _, err := source.proposalKeyCache.Get(context.Background()); err != nil {
		t.Fatalf("warm source federation key cache: %v", err)
	}
	source.skdmTransport = localGroupSkdmTransport{t: t, target: target}
	envelope, replay, err := source.service.EnqueueGroupSkdmOutbox(domain.GroupSkdmEnvelope{
		GroupID:                    group.ID,
		MembershipEpoch:            group.MembershipEpoch,
		SenderDID:                  "alice",
		SenderKeyID:                7,
		RecipientDID:               "bob",
		RecipientDeviceID:          "bob-device-1",
		RecipientHomeStationPeerID: targetStation,
		EncryptedPayload:           []byte("sealed-skdm-payload"),
		IdempotencyKey:             "skdm-dispatch-1",
		CreatedAt:                  time.Now(),
	})
	if err != nil || replay {
		t.Fatalf("enqueue source SKDM outbox: item=%+v replay=%v err=%v", envelope, replay, err)
	}

	if dispatched := source.dispatchGroupSkdmOutbox(context.Background(), 10); dispatched != 1 {
		t.Fatalf("expected one SKDM dispatch, got %d", dispatched)
	}
	pending, err := source.service.ListPendingGroupSkdmOutbox(10, time.Now())
	if err != nil {
		t.Fatalf("list source SKDM pending: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("expected source SKDM outbox to be delivered, got pending %+v", pending)
	}
	if item := target.service.skdmOutbox["skdm-dispatch-1"]; item.IdempotencyKey != "skdm-dispatch-1" || item.RecipientHomeStationPeerID != targetStation {
		t.Fatalf("expected target Station to receive SKDM envelope, got %+v", item)
	}
}

func TestCrossStationSkdmAcceptanceEntitlementAndOpaqueDelivery(t *testing.T) {
	registerGroupChatFederationScope()
	eventsServer := events_subserver.NewEventsSubServer()
	if err := eventsServer.Init(context.Background()); err != nil {
		t.Fatalf("init events subserver: %v", err)
	}
	defer func() {
		if err := eventsServer.Stop(context.Background()); err != nil {
			t.Fatalf("stop events subserver: %v", err)
		}
	}()
	bus := events_subserver.GetBus()
	if bus == nil {
		t.Fatal("expected realtime event bus")
	}

	const (
		sourceStation = "station-a"
		targetStation = "station-b"
	)
	target := newTestSubServer()
	target.federationSkdmWrapper = serverwrapper.RequireFederationToken(
		groupChatSkdmDeliverScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(targetStation),
	)
	group := target.service.CreateGroup("alice", "Engineering", "")
	addFederatedMemberForTest(t, target, group.ID, "bob", targetStation)
	currentGroup, ok := target.service.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected group after Bob join")
	}

	streamCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bobSub, unsubscribeBob, err := bus.Subscribe(streamCtx, "bob", "bob-device-1", "")
	if err != nil {
		t.Fatalf("subscribe bob device: %v", err)
	}
	defer unsubscribeBob()
	carolSub, unsubscribeCarol, err := bus.Subscribe(streamCtx, "carol", "carol-device-1", "")
	if err != nil {
		t.Fatalf("subscribe carol device: %v", err)
	}
	defer unsubscribeCarol()

	source := newTestSubServer()
	source.localStationID = sourceStation
	source.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	if _, err := source.proposalKeyCache.Get(context.Background()); err != nil {
		t.Fatalf("warm source federation key cache: %v", err)
	}
	source.skdmTransport = localGroupSkdmTransport{t: t, target: target}

	enqueueSourceSkdm(t, source, domain.GroupSkdmEnvelope{
		GroupID:                    group.ID,
		MembershipEpoch:            currentGroup.MembershipEpoch,
		SenderDID:                  "alice",
		SenderKeyID:                7,
		RecipientDID:               "bob",
		RecipientDeviceID:          "bob-device-1",
		RecipientHomeStationPeerID: targetStation,
		EncryptedPayload:           []byte("sealed-post-join"),
		IdempotencyKey:             "skdm-post-join-bob",
		CreatedAt:                  time.Now(),
	})
	if dispatched := source.dispatchGroupSkdmOutbox(context.Background(), 10); dispatched != 1 {
		t.Fatalf("expected post-join SKDM dispatch, got %d", dispatched)
	}
	delivered := waitRealtimeEvent(t, bobSub.Events, 100*time.Millisecond).GetGroupSkdmEnvelopeDelivered()
	if delivered == nil ||
		delivered.GetSenderHomeStationPeerId() != sourceStation ||
		delivered.GetRecipientDid() != "bob" ||
		delivered.GetRecipientDeviceId() != "bob-device-1" ||
		string(delivered.GetEncryptedPayload()) != "sealed-post-join" {
		t.Fatalf("unexpected Bob post-join SKDM event: %+v", delivered)
	}

	enqueueSourceSkdm(t, source, domain.GroupSkdmEnvelope{
		GroupID:                    group.ID,
		MembershipEpoch:            currentGroup.MembershipEpoch,
		SenderDID:                  "alice",
		SenderKeyID:                8,
		RecipientDID:               "carol",
		RecipientDeviceID:          "carol-device-1",
		RecipientHomeStationPeerID: targetStation,
		EncryptedPayload:           []byte("sealed-before-join"),
		IdempotencyKey:             "skdm-before-join-carol",
		CreatedAt:                  time.Now(),
	})
	if dispatched := source.dispatchGroupSkdmOutbox(context.Background(), 10); dispatched != 0 {
		t.Fatalf("expected pre-join Carol SKDM not to dispatch, got %d", dispatched)
	}
	assertNoRealtimeEvent(t, carolSub.Events, 20*time.Millisecond)

	addFederatedMemberWithEpochForTest(t, target, group.ID, "carol", targetStation)
	afterCarolJoin, _ := target.service.GetGroup(group.ID)
	if afterCarolJoin.MembershipEpoch <= currentGroup.MembershipEpoch {
		t.Fatalf("expected Carol join to advance membership epoch, before=%d after=%d", currentGroup.MembershipEpoch, afterCarolJoin.MembershipEpoch)
	}
	enqueueSourceSkdm(t, source, domain.GroupSkdmEnvelope{
		GroupID:                    group.ID,
		MembershipEpoch:            currentGroup.MembershipEpoch,
		SenderDID:                  "alice",
		SenderKeyID:                9,
		RecipientDID:               "carol",
		RecipientDeviceID:          "carol-device-1",
		RecipientHomeStationPeerID: targetStation,
		EncryptedPayload:           []byte("sealed-stale-epoch"),
		IdempotencyKey:             "skdm-stale-epoch-carol",
		CreatedAt:                  time.Now(),
	})
	if dispatched := source.dispatchGroupSkdmOutbox(context.Background(), 10); dispatched != 0 {
		t.Fatalf("expected stale-epoch Carol SKDM not to dispatch, got %d", dispatched)
	}
	assertNoRealtimeEvent(t, carolSub.Events, 20*time.Millisecond)

	raw, err := proto.Marshal(&chat.SenderKeyDistributionMessage{
		GroupUlid:   group.ID,
		SenderDid:   "alice",
		SenderKeyId: 10,
		ChainKey:    []byte("raw-chain-key"),
	})
	if err != nil {
		t.Fatalf("marshal raw SKDM: %v", err)
	}
	if _, err := target.handleDeliverGroupSkdmEnvelope(context.Background(), &chat.SubmitGroupSkdmEnvelopeRequest{
		Envelope: &chat.GroupSkdmEnvelope{
			GroupUlid:                  group.ID,
			MembershipEpoch:            afterCarolJoin.MembershipEpoch,
			SenderDid:                  "alice",
			SenderKeyId:                10,
			RecipientDid:               "carol",
			RecipientDeviceId:          "carol-device-1",
			RecipientHomeStationPeerId: targetStation,
			EncryptedPayload:           raw,
			IdempotencyKey:             "skdm-raw-chain-carol",
		},
	}); err == nil {
		t.Fatal("expected target Station to reject raw Sender Key material")
	}
	assertNoRealtimeEvent(t, carolSub.Events, 20*time.Millisecond)

	if !target.service.RemoveMember(group.ID, "bob") {
		t.Fatal("expected Bob removal to succeed")
	}
	afterBobRemove, _ := target.service.GetGroup(group.ID)
	enqueueSourceSkdm(t, source, domain.GroupSkdmEnvelope{
		GroupID:                    group.ID,
		MembershipEpoch:            afterBobRemove.MembershipEpoch,
		SenderDID:                  "alice",
		SenderKeyID:                11,
		RecipientDID:               "bob",
		RecipientDeviceID:          "bob-device-1",
		RecipientHomeStationPeerID: targetStation,
		EncryptedPayload:           []byte("sealed-after-remove"),
		IdempotencyKey:             "skdm-after-remove-bob",
		CreatedAt:                  time.Now(),
	})
	if dispatched := source.dispatchGroupSkdmOutbox(context.Background(), 10); dispatched != 0 {
		t.Fatalf("expected removed Bob SKDM not to dispatch, got %d", dispatched)
	}
	assertNoRealtimeEvent(t, bobSub.Events, 20*time.Millisecond)
}

func mintGroupChatSkdmToken(t *testing.T, issuer, audience string, envelope *chat.GroupSkdmEnvelope) string {
	t.Helper()
	cache := authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm federation key cache: %v", err)
	}
	token, err := authfed.Mint(context.Background(), cache, authfed.MintRequest{
		Scope:    groupChatSkdmDeliverScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  envelope.GetSenderDid(),
		TTL:      30 * time.Second,
		Custom: map[string]string{
			groupChatProposalClaimGroup:   envelope.GetGroupUlid(),
			groupChatProposalClaimActor:   envelope.GetSenderDid(),
			groupChatSkdmClaimIdempotency: envelope.GetIdempotencyKey(),
			groupChatSkdmClaimRecipient:   envelope.GetRecipientDid(),
			groupChatSkdmClaimDevice:      envelope.GetRecipientDeviceId(),
		},
	})
	if err != nil {
		t.Fatalf("mint SKDM federation token: %v", err)
	}
	return token
}

func enqueueSourceSkdm(t *testing.T, sub *subServer, envelope domain.GroupSkdmEnvelope) {
	t.Helper()
	if _, replay, err := sub.service.EnqueueGroupSkdmOutbox(envelope); err != nil || replay {
		t.Fatalf("enqueue source SKDM outbox replay=%v err=%v envelope=%+v", replay, err, envelope)
	}
}

func addFederatedMemberWithEpochForTest(t *testing.T, sub *subServer, groupID, actorDID, homeStationPeerID string) {
	t.Helper()
	if _, ok := sub.service.AddMember(groupID, actorDID, "alice"); !ok {
		t.Fatalf("add member %s", actorDID)
	}
	if item, ok := sub.service.members[groupID][actorDID]; ok && item != nil {
		item.Actor = domain.FederatedActorRef{
			ActorDID:          actorDID,
			HomeStationPeerID: homeStationPeerID,
		}
		return
	}
	t.Fatalf("member %s not found after add", actorDID)
}

func assertNoRealtimeEvent(t *testing.T, events <-chan *realtime.StreamEvent, timeout time.Duration) {
	t.Helper()
	select {
	case ev := <-events:
		t.Fatalf("unexpected realtime event: %+v", ev)
	case <-time.After(timeout):
	}
}

func protoCloneGroupSkdmEnvelope(in *chat.GroupSkdmEnvelope) *chat.GroupSkdmEnvelope {
	if in == nil {
		return nil
	}
	return proto.Clone(in).(*chat.GroupSkdmEnvelope)
}

type localGroupSkdmTransport struct {
	t      *testing.T
	target *subServer
}

func (tr localGroupSkdmTransport) DeliverGroupSkdmEnvelope(ctx context.Context, targetStationPeerID string, req *chat.SubmitGroupSkdmEnvelopeRequest, token string) (*chat.SubmitGroupSkdmEnvelopeResponse, error) {
	_ = ctx
	_ = targetStationPeerID
	response := invokeGroupChatHandler(tr.t, tr.target, "gc-skdm-deliver", req, token)
	if response.status != 200 {
		return nil, proposalDispatchError(response.status, response.body.String())
	}
	var decoded chat.SubmitGroupSkdmEnvelopeResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}
