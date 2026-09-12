package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	actoridentityapplication "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	deliveryapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	productionManifestTestLocalStation  = "station-four"
	productionManifestTestRemoteStation = "station-five"
)

var productionManifestTestTime = time.Date(
	2026,
	time.September,
	7,
	15,
	0,
	0,
	0,
	time.UTC,
)

func TestProductionConversationHandlerErrorExposesTypedContext(t *testing.T) {
	cause := conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		"aggregate.rehydrate",
		"snapshot",
		"must contain members and member devices",
	)
	mapped := productionConversationHandlerError(
		http.StatusBadRequest,
		"invalid Conversation request",
		conversationdomain.ErrorCodeInvalidArgument,
		cause,
	)

	if mapped.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", mapped.Code, http.StatusBadRequest)
	}
	if got := mapped.Headers["X-Peers-Error-Code"]; got != "CONVERSATION_INVALID_ARGUMENT" {
		t.Fatalf("error code = %q", got)
	}
	var details map[string]string
	if err := json.Unmarshal(
		[]byte(mapped.Headers["X-Peers-Error-Details"]),
		&details,
	); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if details["operation"] != "aggregate.rehydrate" ||
		details["field"] != "snapshot" ||
		details["reason"] != "must contain members and member devices" {
		t.Fatalf("details = %#v", details)
	}
	if !errors.Is(mapped, cause) {
		t.Fatal("mapped error did not retain its domain cause")
	}
}

func TestMapProductionConversationErrorPreservesInteractionContext(t *testing.T) {
	cause := interactionapp.NewError(
		interactionapp.ErrorCodeIntegrityFailed,
		"delivery_receipt_recorder.record",
		"conversation_member_devices",
		"is missing a required delivery endpoint",
	)
	mapped := mapProductionConversationError(context.Background(), cause)
	handlerError, ok := mapped.(*server.HandlerError)
	if !ok {
		t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
	}
	if handlerError.Code != http.StatusConflict {
		t.Fatalf(
			"status = %d, want %d",
			handlerError.Code,
			http.StatusConflict,
		)
	}
	if got := handlerError.Headers["X-Peers-Error-Code"]; got !=
		string(interactionapp.ErrorCodeIntegrityFailed) {
		t.Fatalf("error code = %q", got)
	}
	var details map[string]string
	if err := json.Unmarshal(
		[]byte(handlerError.Headers["X-Peers-Error-Details"]),
		&details,
	); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if details["operation"] != "delivery_receipt_recorder.record" ||
		details["field"] != "conversation_member_devices" ||
		details["reason"] != "is missing a required delivery endpoint" {
		t.Fatalf("details = %#v", details)
	}
	if !errors.Is(handlerError, cause) {
		t.Fatal("mapped error did not retain its interaction cause")
	}
}

func TestMapProductionConversationErrorPreservesDeviceInboxContext(t *testing.T) {
	cause := deliveryapp.NewError(
		deliveryapp.ErrorCodeUnauthorized,
		"delivery.claim",
		"device",
		"is not active for the authenticated actor",
	)
	mapped := mapProductionConversationError(context.Background(), cause)
	handlerError, ok := mapped.(*server.HandlerError)
	if !ok {
		t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
	}
	if handlerError.Code != http.StatusForbidden {
		t.Fatalf(
			"status = %d, want %d",
			handlerError.Code,
			http.StatusForbidden,
		)
	}
	if got := handlerError.Headers["X-Peers-Error-Code"]; got !=
		string(deliveryapp.ErrorCodeUnauthorized) {
		t.Fatalf("error code = %q", got)
	}
	var details map[string]string
	if err := json.Unmarshal(
		[]byte(handlerError.Headers["X-Peers-Error-Details"]),
		&details,
	); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if details["operation"] != "delivery.claim" ||
		details["field"] != "device" ||
		details["reason"] != "is not active for the authenticated actor" {
		t.Fatalf("details = %#v", details)
	}
	if !errors.Is(handlerError, cause) {
		t.Fatal("mapped error did not retain its Device Inbox cause")
	}
}

type productionManifestTestClock struct {
	now time.Time
}

func (c productionManifestTestClock) Now() time.Time {
	return c.now
}

type productionManifestTestSigner struct {
	privateKey ed25519.PrivateKey
}

func (s productionManifestTestSigner) KeyID() string {
	return "station-four-key"
}

func (s productionManifestTestSigner) Sign(
	_ context.Context,
	canonical []byte,
) ([]byte, error) {
	return ed25519.Sign(s.privateKey, canonical), nil
}

type productionManifestTestActorCapabilities struct {
	homes         map[string]string
	localManifest *actormodel.ActorEndpointManifest
	versions      map[string]uint64
}

func (c productionManifestTestActorCapabilities) ResolveActorHomeStationPeerID(
	_ context.Context,
	actorPTID string,
) (string, error) {
	homeStation := c.homes[actorPTID]
	if homeStation == "" {
		return "", errors.New("Actor Home Station is unavailable")
	}

	return homeStation, nil
}

func (productionManifestTestActorCapabilities) ValidateEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	expectedActorPTID string,
	expectedHomeStationPeerID string,
	now time.Time,
) error {
	return actoridentityapplication.ValidateEndpointManifest(
		manifest,
		expectedActorPTID,
		expectedHomeStationPeerID,
		now,
	)
}

func (c *productionManifestTestActorCapabilities) AcceptVerifiedEndpointManifest(
	_ context.Context,
	manifest *actormodel.ActorEndpointManifest,
) error {
	actorPTID := manifest.GetActor().GetPtid()
	if accepted := c.versions[actorPTID]; manifest.GetDirectoryVersion() < accepted {
		return errors.New("endpoint manifest directory version rollback")
	}
	c.versions[actorPTID] = manifest.GetDirectoryVersion()

	return nil
}

func (c *productionManifestTestActorCapabilities) GetEndpointManifest(
	_ context.Context,
	sourceStationPeerID string,
	request *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	if sourceStationPeerID != productionManifestTestLocalStation ||
		request.GetActor().GetPtid() != c.localManifest.GetActor().GetPtid() {
		return nil, errors.New("unexpected local endpoint manifest request")
	}

	return &actormodel.GetActorEndpointManifestResponse{
		Manifest: proto.Clone(c.localManifest).(*actormodel.ActorEndpointManifest),
	}, nil
}

func (productionManifestTestActorCapabilities) ResolveVerifiedActorDeviceSigningKey(
	context.Context,
	federationdelivery.Transaction,
	string,
	string,
	string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	return nil, errors.New("device signing key resolution is outside this test")
}

type productionManifestTestRuntime struct {
	remoteManifest  *actormodel.ActorEndpointManifest
	remotePublicKey ed25519.PublicKey
	remoteKeyID     string
}

func (productionManifestTestRuntime) RegisterReceivers(
	federationruntime.ReceiverRegistrar,
) error {
	return errors.New("receiver registration is outside this test")
}

func (r productionManifestTestRuntime) CallPeer(
	_ context.Context,
	call federationruntime.PeerCall,
) error {
	if call.TargetStationPeerID != productionManifestTestRemoteStation ||
		call.Route != federationruntime.PeerRouteActorEndpointManifest {
		return errors.New("unexpected endpoint manifest peer call")
	}
	request, requestOK := call.Request.(*actormodel.GetActorEndpointManifestRequest)
	response, responseOK := call.Response.(*actormodel.GetActorEndpointManifestResponse)
	if !requestOK || !responseOK ||
		request.GetActor().GetPtid() != r.remoteManifest.GetActor().GetPtid() {
		return errors.New("endpoint manifest peer call is not canonically bound")
	}
	response.Manifest = proto.Clone(r.remoteManifest).(*actormodel.ActorEndpointManifest)

	return nil
}

func (productionManifestTestRuntime) OpenPeerStream(
	context.Context,
	federationruntime.PeerStreamCall,
) (*federationruntime.PeerStreamResponse, error) {
	return nil, errors.New("peer streaming is outside this test")
}

func (r productionManifestTestRuntime) VerifyPeerSignature(
	_ context.Context,
	sourceStationPeerID string,
	signingKeyID string,
	canonical []byte,
	signature []byte,
) error {
	if sourceStationPeerID != productionManifestTestRemoteStation ||
		signingKeyID != r.remoteKeyID ||
		!ed25519.Verify(r.remotePublicKey, canonical, signature) {
		return errors.New("endpoint manifest Station signature is invalid")
	}

	return nil
}

func (r productionManifestTestRuntime) Signer() federationdelivery.Signer {
	return productionManifestTestSigner{
		privateKey: ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x41}, ed25519.SeedSize)),
	}
}

func (productionManifestTestRuntime) LocalStationPeerID() string {
	return productionManifestTestLocalStation
}

func TestProductionEndpointRoutesUseSignedRemoteManifest(t *testing.T) {
	alice := valueobject.PTID("ptid:v1:actor:peers:p:manifest-alice")
	bob := valueobject.PTID("ptid:v1:actor:peers:p:manifest-bob")
	localPrivateKey := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x51}, ed25519.SeedSize),
	)
	remotePrivateKey := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x61}, ed25519.SeedSize),
	)
	localManifest := signedProductionManifest(
		t,
		alice,
		"alice-device",
		productionManifestTestLocalStation,
		"station-four-key",
		localPrivateKey,
	)
	validRemoteManifest := signedProductionManifest(
		t,
		bob,
		"bob-device",
		productionManifestTestRemoteStation,
		"station-five-key",
		remotePrivateKey,
	)

	t.Run("manifest-only remote peer", func(t *testing.T) {
		server := newProductionManifestTestServer(
			alice,
			bob,
			localManifest,
			validRemoteManifest,
			remotePrivateKey.Public().(ed25519.PublicKey),
		)
		routes, err := server.productionEndpointRoutes(
			context.Background(),
			[]valueobject.PTID{alice, bob},
		)
		if err != nil {
			t.Fatal(err)
		}
		routesByActor := make(map[valueobject.PTID]valueobject.StationID, len(routes))
		for _, route := range routes {
			routesByActor[route.Endpoint.Actor] = route.HomeStation
		}
		if len(routes) != 2 ||
			routesByActor[alice] != productionManifestTestLocalStation ||
			routesByActor[bob] != productionManifestTestRemoteStation {
			t.Fatalf("resolved routes = %+v", routes)
		}
	})

	for _, testCase := range []struct {
		name   string
		mutate func(*actormodel.ActorEndpointManifest)
	}{
		{
			name: "wrong Home Station",
			mutate: func(manifest *actormodel.ActorEndpointManifest) {
				manifest.HomeStationPeerId = "station-six"
			},
		},
		{
			name: "expired manifest",
			mutate: func(manifest *actormodel.ActorEndpointManifest) {
				manifest.ExpiresAt = timestamppb.New(productionManifestTestTime)
			},
		},
		{
			name: "invalid Station signature",
			mutate: func(manifest *actormodel.ActorEndpointManifest) {
				manifest.StationSignature[0] ^= 0xff
			},
		},
		{
			name: "no active endpoint",
			mutate: func(manifest *actormodel.ActorEndpointManifest) {
				manifest.ActiveEndpoints = nil
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			remoteManifest := proto.Clone(validRemoteManifest).(*actormodel.ActorEndpointManifest)
			testCase.mutate(remoteManifest)
			if testCase.name != "invalid Station signature" {
				signProductionManifest(t, remoteManifest, remotePrivateKey)
			}
			server := newProductionManifestTestServer(
				alice,
				bob,
				localManifest,
				remoteManifest,
				remotePrivateKey.Public().(ed25519.PublicKey),
			)
			if _, err := server.productionEndpointRoutes(
				context.Background(),
				[]valueobject.PTID{alice, bob},
			); err == nil {
				t.Fatal("invalid remote endpoint manifest was accepted")
			}
		})
	}

	t.Run("signed directory version rollback", func(t *testing.T) {
		remoteManifest := proto.Clone(validRemoteManifest).(*actormodel.ActorEndpointManifest)
		remoteManifest.DirectoryVersion = 2
		signProductionManifest(t, remoteManifest, remotePrivateKey)
		server := newProductionManifestTestServer(
			alice,
			bob,
			localManifest,
			remoteManifest,
			remotePrivateKey.Public().(ed25519.PublicKey),
		)
		if _, err := server.productionEndpointRoutes(
			context.Background(),
			[]valueobject.PTID{alice, bob},
		); err != nil {
			t.Fatal(err)
		}
		remoteManifest.DirectoryVersion = 1
		signProductionManifest(t, remoteManifest, remotePrivateKey)
		if _, err := server.productionEndpointRoutes(
			context.Background(),
			[]valueobject.PTID{alice, bob},
		); err == nil {
			t.Fatal("signed endpoint manifest rollback was accepted")
		}
	})

	t.Run("manifest binding changes with directory version", func(t *testing.T) {
		preparedHash, preparedStateHash, err := productionEndpointManifestSetHashes(
			[]*actormodel.ActorEndpointManifest{localManifest, validRemoteManifest},
		)
		if err != nil {
			t.Fatal(err)
		}
		reorderedHash, reorderedStateHash, err := productionEndpointManifestSetHashes(
			[]*actormodel.ActorEndpointManifest{validRemoteManifest, localManifest},
		)
		if err != nil {
			t.Fatal(err)
		}
		if reorderedHash != preparedHash || reorderedStateHash != preparedStateHash {
			t.Fatal("manifest set hash depends on response ordering")
		}

		advanced := proto.Clone(validRemoteManifest).(*actormodel.ActorEndpointManifest)
		advanced.DirectoryVersion++
		signProductionManifest(t, advanced, remotePrivateKey)
		advancedHash, advancedStateHash, err := productionEndpointManifestSetHashes(
			[]*actormodel.ActorEndpointManifest{localManifest, advanced},
		)
		if err != nil {
			t.Fatal(err)
		}
		if advancedHash == preparedHash || advancedStateHash == preparedStateHash {
			t.Fatal("manifest directory version was not bound to the plan hash")
		}

		reissued := proto.Clone(validRemoteManifest).(*actormodel.ActorEndpointManifest)
		reissued.IssuedAt = timestamppb.New(productionManifestTestTime.Add(time.Second))
		reissued.ExpiresAt = timestamppb.New(productionManifestTestTime.Add(2 * time.Minute))
		signProductionManifest(t, reissued, remotePrivateKey)
		reissuedHash, reissuedStateHash, err := productionEndpointManifestSetHashes(
			[]*actormodel.ActorEndpointManifest{localManifest, reissued},
		)
		if err != nil {
			t.Fatal(err)
		}
		if reissuedHash == preparedHash || reissuedStateHash != preparedStateHash {
			t.Fatal("manifest binding and stable directory state were not separated")
		}
	})
}

func TestAcceptedRelationshipDirectMatchesExactActivePair(t *testing.T) {
	alice := valueobject.PTID("ptid:v1:actor:peers:p:existing-alice")
	bob := valueobject.PTID("ptid:v1:actor:peers:p:existing-bob")
	snapshot := aggregate.Snapshot{
		ID:               "existing-direct",
		Kind:             valueobject.ConversationKindDirect,
		Status:           valueobject.ConversationStatusActive,
		FederationID:     "federation-one",
		AuthorityStation: productionManifestTestRemoteStation,
		AuthorityEpoch:   1,
		Members: []entity.Member{
			{Actor: alice, Status: valueobject.MemberStatusActive},
			{Actor: bob, Status: valueobject.MemberStatusActive},
		},
	}
	view := query.ConversationView{
		Conversation:   snapshot,
		Source:         query.SourceFollower,
		FollowerStatus: repository.FollowerStatusActive,
	}
	if !existingDirectCanReopen(
		view,
		"federation-one",
		alice,
		bob,
		productionManifestTestLocalStation,
	) {
		t.Fatal("compatible follower Direct was not reusable")
	}

	view.FollowerStatus = repository.FollowerStatusReadOnly
	if existingDirectCanReopen(
		view,
		"federation-one",
		alice,
		bob,
		productionManifestTestLocalStation,
	) {
		t.Fatal("read-only follower Direct was reusable")
	}
	view.FollowerStatus = repository.FollowerStatusActive
	view.Conversation.FederationID = "federation-two"
	if existingDirectCanReopen(
		view,
		"federation-one",
		alice,
		bob,
		productionManifestTestLocalStation,
	) {
		t.Fatal("Direct from another Federation was reusable")
	}
}

func newProductionManifestTestServer(
	alice valueobject.PTID,
	bob valueobject.PTID,
	localManifest *actormodel.ActorEndpointManifest,
	remoteManifest *actormodel.ActorEndpointManifest,
	remotePublicKey ed25519.PublicKey,
) *subServer {
	actorCapabilities := &productionManifestTestActorCapabilities{
		homes: map[string]string{
			string(alice): productionManifestTestLocalStation,
			string(bob):   productionManifestTestRemoteStation,
		},
		localManifest: localManifest,
		versions:      make(map[string]uint64),
	}
	runtime := productionManifestTestRuntime{
		remoteManifest: remoteManifest,
		remotePublicKey: append(
			ed25519.PublicKey(nil),
			remotePublicKey...,
		),
		remoteKeyID: remoteManifest.GetSigningKeyId(),
	}

	return &subServer{
		localStation: productionManifestTestLocalStation,
		composition: &ProductionComposition{
			ActorCapabilities: actorCapabilities,
			FederationRuntime: func() (ProductionFederationRuntime, error) {
				return runtime, nil
			},
			localStation: productionManifestTestLocalStation,
			clock:        productionManifestTestClock{now: productionManifestTestTime},
		},
	}
}

func signedProductionManifest(
	t *testing.T,
	actor valueobject.PTID,
	deviceID string,
	homeStation string,
	signingKeyID string,
	privateKey ed25519.PrivateKey,
) *actormodel.ActorEndpointManifest {
	t.Helper()

	manifest := &actormodel.ActorEndpointManifest{
		FormatVersion: actoridentityapplication.EndpointManifestFormatVersion,
		ManifestId:    "manifest-" + deviceID,
		Actor: &actormodel.ActorRef{
			Ptid: string(actor),
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		HomeStationPeerId: homeStation,
		DirectoryVersion:  1,
		ActiveEndpoints: []*actormodel.ActorEndpointManifestEntry{{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: string(actor),
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
				DeviceId: deviceID,
			},
			SigningKeyId:         "device-key-" + deviceID,
			PublicMaterialSha256: [][]byte{bytes.Repeat([]byte{0x71}, 32)},
		}},
		IssuedAt:               timestamppb.New(productionManifestTestTime.Add(-time.Minute)),
		ExpiresAt:              timestamppb.New(productionManifestTestTime.Add(time.Minute)),
		SigningKeyId:           signingKeyID,
		ActorIdentityPublicKey: bytes.Repeat([]byte{0x31}, ed25519.PublicKeySize),
		ActorProfileVersion:    1,
	}
	signProductionManifest(t, manifest, privateKey)

	return manifest
}

func signProductionManifest(
	t *testing.T,
	manifest *actormodel.ActorEndpointManifest,
	privateKey ed25519.PrivateKey,
) {
	t.Helper()

	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		productionEndpointManifestSigningInput(manifest),
	)
	if err != nil {
		t.Fatal(err)
	}
	manifest.StationSignature = ed25519.Sign(privateKey, signingBytes)
}
