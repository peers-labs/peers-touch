package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentityapp "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	attachmentapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	deliveryapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	attachmentinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	keyexchangedomain "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	keyexchangeinfra "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var productionAdapterTestTime = time.Date(
	2026,
	time.September,
	7,
	12,
	0,
	0,
	0,
	time.UTC,
)

type productionAdapterTestClock struct {
	now time.Time
}

func (c productionAdapterTestClock) Now() time.Time {
	return c.now
}

type productionAdapterTestSigner struct {
	privateKey ed25519.PrivateKey
}

func (s productionAdapterTestSigner) KeyID() string {
	return "station-signing-key"
}

func (s productionAdapterTestSigner) Sign(
	_ context.Context,
	canonical []byte,
) ([]byte, error) {
	return ed25519.Sign(s.privateKey, canonical), nil
}

type productionAdapterKeyExchangeCall struct {
	requestID       string
	authorityPlanID string
	target          keyexchangedomain.Endpoint
	homeStationID   string
	expiresAt       time.Time
}

type productionAdapterTestKeyExchange struct {
	calls []productionAdapterKeyExchangeCall
}

func (s *productionAdapterTestKeyExchange) ReserveMLSKeyPackageForVerifiedRoute(
	_ context.Context,
	requestID string,
	authorityPlanID string,
	target keyexchangedomain.Endpoint,
	homeStationID string,
	expiresAt time.Time,
) (keyexchangedomain.MLSKeyPackageReservation, error) {
	s.calls = append(s.calls, productionAdapterKeyExchangeCall{
		requestID:       requestID,
		authorityPlanID: authorityPlanID,
		target:          target,
		homeStationID:   homeStationID,
		expiresAt:       expiresAt,
	})
	keyPackage := []byte("remote-canonical-mls-key-package")

	return keyexchangedomain.MLSKeyPackageReservation{
		PlanID:               authorityPlanID,
		Target:               target,
		PackageID:            "remote-package",
		KeyPackage:           keyPackage,
		PackageHash:          keyexchangedomain.HashMLSKeyPackage(keyPackage),
		HomeStation:          homeStationID,
		PlanExpiresAt:        expiresAt,
		IrreversiblyConsumed: true,
	}, nil
}

type productionAdapterFixture struct {
	db          *gorm.DB
	factory     *ProductionTransactionalAdapterFactory
	keyExchange *productionAdapterTestKeyExchange
	alice       valueobject.Endpoint
	bob         valueobject.Endpoint
	bobPrivate  ed25519.PrivateKey
	objectID    valueobject.ObjectID
}

func TestProductionIdentityAndFederationAdaptersUseOwnerTruth(t *testing.T) {
	fixture := newProductionAdapterFixture(t)
	adapters, err := fixture.factory.Bind(fixture.db)
	if err != nil {
		t.Fatal(err)
	}

	active, err := adapters.Identity.IsActive(context.Background(), fixture.bob)
	if err != nil {
		t.Fatal(err)
	}
	if !active {
		t.Fatal("Actor Identity active device was not visible")
	}

	identityKey, err := adapters.Identity.ActorIdentityPublicKey(
		context.Background(),
		fixture.bob.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(identityKey, fixture.bobPrivate.Public().(ed25519.PublicKey)) {
		t.Fatalf("actor identity key = %x", identityKey)
	}

	payload := []byte("signed Conversation proposal")
	signature := ed25519.Sign(fixture.bobPrivate, payload)
	verification, err := adapters.Identity.VerifyDeviceSignature(
		context.Background(),
		fixture.bob,
		"bob-signing-key",
		payload,
		signature,
	)
	if err != nil {
		t.Fatal(err)
	}
	if verification.KeyRevoked {
		t.Fatal("active key was reported revoked")
	}

	routes, err := adapters.Identity.ListActiveEndpoints(
		context.Background(),
		[]valueobject.PTID{fixture.bob.Actor, fixture.bob.Actor},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 1 ||
		routes[0].Endpoint != fixture.bob ||
		routes[0].HomeStation != "station-a" {
		t.Fatalf("active routes = %+v", routes)
	}

	federationActive, err := adapters.Federation.IsActiveStation(
		context.Background(),
		"federation-1",
		"station-b",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !federationActive {
		t.Fatal("active Federation membership was not visible")
	}

	if err := fixture.db.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ?",
			string(fixture.bob.Actor),
			string(fixture.bob.Device),
		).
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}
	verification, err = adapters.Identity.VerifyDeviceSignature(
		context.Background(),
		fixture.bob,
		"bob-signing-key",
		payload,
		signature,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !verification.KeyRevoked {
		t.Fatal("historically valid revoked key did not retain revocation state")
	}
	active, err = adapters.Identity.IsActive(context.Background(), fixture.bob)
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Fatal("revoked Actor Identity device remained active")
	}

	_, err = adapters.Identity.VerifyDeviceSignature(
		context.Background(),
		fixture.bob,
		"bob-signing-key",
		payload,
		bytes.Repeat([]byte{0x7f}, ed25519.SignatureSize),
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalSignature) {
		t.Fatalf("invalid signature error = %v", err)
	}
}

// TestProductionMembershipEventWireRoundTripPreservesCanonicalHash verifies that
// federation decoding retains every field covered by the authority event hash.
func TestProductionMembershipEventWireRoundTripPreservesCanonicalHash(t *testing.T) {
	owner := valueobject.Endpoint{
		Actor:  "ptid:wire-owner",
		Device: "owner-device",
	}
	member := valueobject.Endpoint{
		Actor:  "ptid:wire-member",
		Device: "member-device",
	}
	mlsCommitHash := valueobject.HashBytes([]byte("wire-mls-commit"))
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chatmodel.ChatCommand{
			CommandId:      "wire-membership-remove",
			ConversationId: "wire-membership-group",
			Sender: &chatmodel.CryptoEndpoint{
				Ptid:     string(owner.Actor),
				DeviceId: string(owner.Device),
			},
			Payload: &chatmodel.ChatCommand_MembershipTransition{
				MembershipTransition: &chatmodel.MembershipTransitionIntent{
					TransitionId:        "wire-membership-transition",
					FromMembershipEpoch: 1,
					FromMlsEpoch:        1,
					ToMlsEpoch:          2,
					MlsCommitSha256:     mlsCommitHash.Bytes(),
				},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	event, err := (conversationhttp.ProtobufEventSealer{}).Seal(
		domainevent.RecordInput{
			ID:               "wire-membership-event",
			ConversationID:   "wire-membership-group",
			Sequence:         2,
			CommandID:        "wire-membership-remove",
			Actor:            owner,
			PreviousHash:     valueobject.HashBytes([]byte("wire-previous-event")),
			CommittedAt:      productionAdapterTestTime,
			MembershipEpoch:  2,
			MLSEpoch:         2,
			AuthorityStation: "station-authority",
			DeliveryCommitments: []valueobject.Hash{
				valueobject.HashBytes([]byte("wire-delivery")),
			},
			Fact: domainevent.Fact{
				Kind:    domainevent.KindMembershipCommitted,
				Payload: commandBytes,
				MembershipChanges: []entity.MembershipChange{{
					Action: entity.MembershipActionRemoveActor,
					Actor:  member.Actor,
				}},
				PostState: &domainevent.ConversationState{
					Kind:           valueobject.ConversationKindGroup,
					FederationID:   "wire-federation",
					AuthorityEpoch: 1,
					Owner:          owner.Actor,
					Settings: valueobject.ConversationSettings{
						Name: "Wire group",
					},
					ActiveMembers: []entity.Member{{
						Actor:       owner.Actor,
						Role:        valueobject.MemberRoleOwner,
						Status:      valueobject.MemberStatusActive,
						HomeStation: "station-authority",
						JoinedAt:    1,
					}},
					ActiveEndpoints: []valueobject.Endpoint{owner},
					ActiveDevices: []entity.MemberDevice{{
						Endpoint:    owner,
						HomeStation: "station-authority",
						Active:      true,
						JoinedAt:    1,
					}},
					MembershipEpoch: 2,
					MLSEpoch:        2,
				},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := conversationhttp.MapEvent(event)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := productionRecordFromWire(wire)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := domainevent.Verify(
		decoded,
		conversationhttp.ProtobufEventSealer{},
	); err != nil {
		t.Fatalf("verify federated membership event round-trip: %v", err)
	}
	current := aggregate.Snapshot{
		ID:               event.ConversationID,
		Kind:             valueobject.ConversationKindGroup,
		Status:           valueobject.ConversationStatusActive,
		FederationID:     "wire-federation",
		AuthorityStation: event.AuthorityStation,
		AuthorityEpoch:   1,
		Owner:            owner.Actor,
		Head: valueobject.AuthorityHead{
			Sequence:        1,
			EventHash:       event.PreviousHash,
			MembershipEpoch: 1,
			MLSEpoch:        1,
		},
		Settings: valueobject.ConversationSettings{Name: "Wire group"},
		Members: []entity.Member{
			{
				Actor:       owner.Actor,
				Role:        valueobject.MemberRoleOwner,
				Status:      valueobject.MemberStatusActive,
				HomeStation: "station-authority",
				JoinedAt:    1,
			},
			{
				Actor:       member.Actor,
				Role:        valueobject.MemberRoleMember,
				Status:      valueobject.MemberStatusActive,
				HomeStation: "station-remote",
				JoinedAt:    1,
			},
		},
		Devices: []entity.MemberDevice{
			{
				Endpoint:    owner,
				HomeStation: "station-authority",
				Active:      true,
				JoinedAt:    1,
			},
			{
				Endpoint:    member,
				HomeStation: "station-remote",
				Active:      true,
				JoinedAt:    1,
			},
		},
		CreatedAt: productionAdapterTestTime.Add(-time.Minute),
		UpdatedAt: productionAdapterTestTime.Add(-time.Minute),
	}
	decodedState := decoded.Fact.PostState
	post := aggregate.Snapshot{
		ID:               event.ConversationID,
		Kind:             decodedState.Kind,
		Status:           current.Status,
		FederationID:     decodedState.FederationID,
		AuthorityStation: event.AuthorityStation,
		AuthorityEpoch:   decodedState.AuthorityEpoch,
		Owner:            decodedState.Owner,
		Head: valueobject.AuthorityHead{
			Sequence:        event.Sequence,
			EventHash:       event.Hash,
			MembershipEpoch: event.MembershipEpoch,
			MLSEpoch:        event.MLSEpoch,
		},
		Settings:  decodedState.Settings,
		Members:   decodedState.ActiveMembers,
		Devices:   decodedState.ActiveDevices,
		CreatedAt: current.CreatedAt,
		UpdatedAt: event.CommittedAt,
	}
	reconciled, err := aggregate.ReconcileCommittedMembershipProjection(
		current,
		decoded.Fact.MembershipChanges,
		post,
	)
	if err != nil {
		t.Fatalf("reconcile federated membership projection: %v", err)
	}
	if len(reconciled.Members) != 1 ||
		reconciled.Members[0].Actor != owner.Actor ||
		reconciled.Members[0].JoinedAt != 1 ||
		len(reconciled.Devices) != 1 ||
		reconciled.Devices[0].Endpoint != owner ||
		reconciled.Devices[0].JoinedAt != 1 {
		t.Fatalf("reconciled membership lifecycle = %+v", reconciled)
	}
}

// TestReconcileCommittedMembershipProjectionRestoresAddedLifecycle verifies
// that active-state wire snapshots cannot rewrite retained join history.
func TestReconcileCommittedMembershipProjectionRestoresAddedLifecycle(t *testing.T) {
	owner := valueobject.Endpoint{
		Actor:  "ptid:wire-add-owner",
		Device: "owner-device",
	}
	member := valueobject.Endpoint{
		Actor:  "ptid:wire-add-member",
		Device: "member-device",
	}
	current := aggregate.Snapshot{
		ID:               "wire-add-group",
		Kind:             valueobject.ConversationKindGroup,
		Status:           valueobject.ConversationStatusActive,
		FederationID:     "wire-federation",
		AuthorityStation: "station-authority",
		AuthorityEpoch:   1,
		Owner:            owner.Actor,
		Head: valueobject.AuthorityHead{
			Sequence:        1,
			EventHash:       valueobject.HashBytes([]byte("wire-add-previous")),
			MembershipEpoch: 1,
			MLSEpoch:        1,
		},
		Settings: valueobject.ConversationSettings{Name: "Wire add group"},
		Members: []entity.Member{{
			Actor:       owner.Actor,
			Role:        valueobject.MemberRoleOwner,
			Status:      valueobject.MemberStatusActive,
			HomeStation: "station-authority",
			JoinedAt:    1,
		}},
		Devices: []entity.MemberDevice{{
			Endpoint:    owner,
			HomeStation: "station-authority",
			Active:      true,
			JoinedAt:    1,
		}},
		CreatedAt: productionAdapterTestTime.Add(-time.Minute),
		UpdatedAt: productionAdapterTestTime.Add(-time.Minute),
	}
	post := current
	post.Head = valueobject.AuthorityHead{
		Sequence:        2,
		EventHash:       valueobject.HashBytes([]byte("wire-add-event")),
		MembershipEpoch: 2,
		MLSEpoch:        2,
	}
	post.Members = []entity.Member{
		{
			Actor:       member.Actor,
			Role:        valueobject.MemberRoleMember,
			Status:      valueobject.MemberStatusActive,
			HomeStation: "station-remote",
			JoinedAt:    1,
		},
		current.Members[0],
	}
	post.Devices = []entity.MemberDevice{
		{
			Endpoint:    member,
			HomeStation: "station-remote",
			Active:      true,
			JoinedAt:    2,
		},
		{
			Endpoint:    owner,
			HomeStation: "station-authority",
			Active:      true,
			JoinedAt:    2,
		},
	}
	post.UpdatedAt = productionAdapterTestTime
	change := entity.MembershipChange{
		Action:      entity.MembershipActionAddActor,
		Actor:       member.Actor,
		Device:      member.Device,
		HomeStation: "station-remote",
		Role:        valueobject.MemberRoleMember,
	}

	reconciled, err := aggregate.ReconcileCommittedMembershipProjection(
		current,
		[]entity.MembershipChange{change},
		post,
	)
	if err != nil {
		t.Fatalf("reconcile added membership projection: %v", err)
	}
	memberJoinedAt := make(map[valueobject.PTID]valueobject.Sequence)
	for _, projected := range reconciled.Members {
		memberJoinedAt[projected.Actor] = projected.JoinedAt
	}
	deviceJoinedAt := make(map[string]valueobject.Sequence)
	for _, projected := range reconciled.Devices {
		deviceJoinedAt[projected.Endpoint.Key()] = projected.JoinedAt
	}
	if memberJoinedAt[owner.Actor] != 1 ||
		memberJoinedAt[member.Actor] != 2 ||
		deviceJoinedAt[owner.Key()] != 1 ||
		deviceJoinedAt[member.Key()] != 2 {
		t.Fatalf("reconciled added lifecycle = %+v", reconciled)
	}

	tampered := post
	tampered.Members = append([]entity.Member(nil), post.Members...)
	tampered.Members[1].HomeStation = "station-forged"
	if _, err := aggregate.ReconcileCommittedMembershipProjection(
		current,
		[]entity.MembershipChange{change},
		tampered,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("tampered authority-visible state error = %v", err)
	}
}

func TestAcceptedRemoteManifestSuppliesConversationDeliveryIdentity(t *testing.T) {
	fixture := newProductionAdapterFixture(t)
	if err := fixture.db.Where(
		"ptid = ?",
		string(fixture.bob.Actor),
	).Delete(&actoridentitypersistence.ActorIdentityModel{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ?",
			string(fixture.bob.Actor),
			string(fixture.bob.Device),
		).
		Updates(map[string]interface{}{
			"home_station_peer_id": "station-b",
			"verification_source": int32(
				actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
			),
		}).Error; err != nil {
		t.Fatal(err)
	}
	identityRepository, err := actoridentitypersistence.NewRepository(fixture.db)
	if err != nil {
		t.Fatal(err)
	}
	if err := identityRepository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	bobIdentityKey := fixture.bobPrivate.Public().(ed25519.PublicKey)
	deviceKeyHash := valueobject.HashBytes(bobIdentityKey)
	manifest := &actormodel.ActorEndpointManifest{
		FormatVersion: actoridentityapp.EndpointManifestFormatVersion,
		ManifestId:    "remote-bob-manifest",
		Actor: &actormodel.ActorRef{
			Ptid: string(fixture.bob.Actor),
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		HomeStationPeerId: "station-b",
		DirectoryVersion:  1,
		ActiveEndpoints: []*actormodel.ActorEndpointManifestEntry{{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: string(fixture.bob.Actor),
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
				DeviceId: string(fixture.bob.Device),
			},
			SigningKeyId: "bob-signing-key",
			PublicMaterialSha256: [][]byte{
				deviceKeyHash.Bytes(),
			},
		}},
		IssuedAt:               timestamppb.New(productionAdapterTestTime),
		ExpiresAt:              timestamppb.New(productionAdapterTestTime.Add(time.Minute)),
		ActorIdentityPublicKey: append([]byte(nil), bobIdentityKey...),
		ActorProfileVersion:    1,
	}
	stationPrivateKey := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x44}, ed25519.SeedSize),
	)
	if err := actoridentityapp.SignEndpointManifest(
		manifest,
		"station-b-signing-key",
		stationPrivateKey,
	); err != nil {
		t.Fatal(err)
	}
	if err := actoridentityapp.VerifyEndpointManifest(
		manifest,
		string(fixture.bob.Actor),
		"station-b",
		"station-b-signing-key",
		stationPrivateKey.Public().(ed25519.PublicKey),
		productionAdapterTestTime,
	); err != nil {
		t.Fatal(err)
	}
	if err := identityRepository.AcceptVerifiedEndpointManifest(
		context.Background(),
		manifest,
		productionAdapterTestTime,
	); err != nil {
		t.Fatal(err)
	}
	if err := identityRepository.AcceptVerifiedEndpointManifest(
		context.Background(),
		manifest,
		productionAdapterTestTime,
	); err != nil {
		t.Fatalf("replay verified endpoint manifest: %v", err)
	}

	adapters, err := fixture.factory.Bind(fixture.db)
	if err != nil {
		t.Fatal(err)
	}
	senderIdentityKey, err := adapters.Identity.ActorIdentityPublicKey(
		context.Background(),
		fixture.bob.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	delivery, err := valueobject.NewPreparedDelivery(
		fixture.alice,
		"station-a",
		valueobject.DeliveryKindDirectCiphertext,
		[]byte("remote-bob-ciphertext"),
	)
	if err != nil {
		t.Fatal(err)
	}
	commitments, err := domainservice.BuildDeliveryCommitments(
		"conversation-remote-bob",
		"event-remote-bob",
		[]valueobject.PreparedDelivery{delivery},
	)
	if err != nil {
		t.Fatal(err)
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chatmodel.ChatCommand{
			CommandId:      "command-remote-bob",
			ConversationId: "conversation-remote-bob",
			Sender: &chatmodel.CryptoEndpoint{
				Ptid:     string(fixture.bob.Actor),
				DeviceId: string(fixture.bob.Device),
			},
			Payload: &chatmodel.ChatCommand_SendMessage{
				SendMessage: &chatmodel.SendMessageIntent{
					MessageId:   "message-remote-bob",
					ContentKind: chatmodel.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
				},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	event, err := (conversationhttp.ProtobufEventSealer{}).Seal(
		domainevent.RecordInput{
			ID:               "event-remote-bob",
			ConversationID:   "conversation-remote-bob",
			Sequence:         2,
			CommandID:        "command-remote-bob",
			Actor:            fixture.bob,
			PreviousHash:     valueobject.HashBytes([]byte("previous-event")),
			CommittedAt:      productionAdapterTestTime,
			MembershipEpoch:  1,
			MLSEpoch:         1,
			AuthorityStation: "station-a",
			DeliveryCommitments: []valueobject.Hash{
				commitments[0].Hash,
			},
			Fact: domainevent.NewCommandCommittedFact(
				domainevent.KindMessageCommitted,
				"message-remote-bob",
				commandBytes,
			),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := (conversationhttp.ProtobufDeviceEventEncoder{}).
		EncodeDeviceEvent(
			event,
			delivery,
			commitments[0].Hash,
			senderIdentityKey,
		)
	if err != nil {
		t.Fatalf("seal remote-sender delivery: %v", err)
	}
	var projected chatmodel.DeviceEventDelivery
	if err := proto.Unmarshal(encoded, &projected); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(
		projected.GetSenderActorIdentityPublicKey(),
		bobIdentityKey,
	) {
		t.Fatal("sealed delivery lost the verified remote Actor identity key")
	}
}

func TestProductionDeliveryReceiptForwarderUsesSharedDurableFederation(
	t *testing.T,
) {
	fixture := newProductionAdapterFixture(t)
	forwarder := &productionDeliveryReceiptForwarder{
		database:     fixture.db,
		sender:       fixture.factory.federationSender,
		clock:        productionAdapterTestClock{now: productionAdapterTestTime},
		localStation: "station-a",
	}
	receipt := interactionapp.DeliveryReceipt{
		ReceiptID:      "device-consumed:item-1",
		ConversationID: "conversation-1",
		EventID:        "event-1",
		Consumer:       fixture.alice,
		EventSequence:  1,
		LaneSequence:   7,
		PayloadHash:    valueobject.HashBytes([]byte("queue-payload")),
		ConsumedAt:     productionAdapterTestTime.Add(-48 * time.Hour),
	}
	receipt = seedProductionFollowerReceiptItem(
		t,
		fixture.db,
		receipt,
		"station-b",
	)
	replay, err := forwarder.ForwardDeliveryReceipt(
		context.Background(),
		"station-b",
		receipt,
	)
	if err != nil || replay {
		t.Fatalf("forward delivery receipt: replay=%v error=%v", replay, err)
	}
	replay, err = forwarder.ForwardDeliveryReceipt(
		context.Background(),
		"station-b",
		receipt,
	)
	if err != nil || !replay {
		t.Fatalf("replay delivery receipt: replay=%v error=%v", replay, err)
	}

	var record federationdelivery.OutboxRecord
	if err := fixture.db.Where(
		"payload_kind = ? AND payload_id = ?",
		int32(federationdelivery.PayloadKindConversationDeliveryReceipt),
		receipt.ReceiptID,
	).First(&record).Error; err != nil {
		t.Fatal(err)
	}
	var frame federationdelivery.Frame
	if err := proto.Unmarshal(record.FrameBytes, &frame); err != nil {
		t.Fatal(err)
	}
	var encoded chatmodel.DeviceConsumptionReceipt
	if err := proto.Unmarshal(frame.GetOpaquePayload(), &encoded); err != nil {
		t.Fatal(err)
	}
	if frame.GetSourceStationPeerId() != "station-a" ||
		frame.GetTargetStationPeerId() != "station-b" ||
		!frame.GetIssuedAt().AsTime().Equal(productionAdapterTestTime) ||
		encoded.GetReceiptId() != receipt.ReceiptID ||
		encoded.GetConsumer().GetPtid() != string(receipt.Consumer.Actor) ||
		encoded.GetConsumer().GetDeviceId() != string(receipt.Consumer.Device) {
		t.Fatalf("delivery receipt frame=%+v payload=%+v", &frame, &encoded)
	}

	conflicting := receipt
	conflicting.LaneSequence++
	if _, err := forwarder.ForwardDeliveryReceipt(
		context.Background(),
		"station-b",
		conflicting,
	); !interactionapp.IsCode(err, interactionapp.ErrorCodeIdempotencyConflict) {
		t.Fatalf("delivery receipt conflict error = %v", err)
	}
	unbound := receipt
	unbound.ReceiptID = "device-consumed:missing-item"
	if _, err := forwarder.ForwardDeliveryReceipt(
		context.Background(),
		"station-b",
		unbound,
	); !interactionapp.IsCode(err, interactionapp.ErrorCodeIntegrityFailed) {
		t.Fatalf("unbound delivery receipt error = %v", err)
	}

	concurrent := receipt
	concurrent.ReceiptID = "device-consumed:item-concurrent"
	concurrent.LaneSequence = receipt.LaneSequence + 1
	concurrent = seedProductionFollowerReceiptItem(
		t,
		fixture.db,
		concurrent,
		"station-b",
	)
	const workers = 8
	var wait sync.WaitGroup
	results := make(chan bool, workers)
	errs := make(chan error, workers)
	for range workers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			replay, err := forwarder.ForwardDeliveryReceipt(
				context.Background(),
				"station-b",
				concurrent,
			)
			results <- replay
			errs <- err
		}()
	}
	wait.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent receipt replay: %v", err)
		}
	}
	var created int
	for replay := range results {
		if !replay {
			created++
		}
	}
	if created != 1 {
		t.Fatalf("concurrent receipt creators = %d, want 1", created)
	}
}

func seedProductionFollowerReceiptItem(
	t *testing.T,
	database *gorm.DB,
	receipt interactionapp.DeliveryReceipt,
	authority valueobject.StationID,
) interactionapp.DeliveryReceipt {
	t.Helper()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chatmodel.DeviceEventDelivery{
			Event: &chatmodel.ConversationEvent{
				EventId:                string(receipt.EventID),
				ConversationId:         string(receipt.ConversationID),
				Sequence:               int64(receipt.EventSequence),
				Actor:                  &chatmodel.CryptoEndpoint{Ptid: "ptid:sender", DeviceId: "sender-device"},
				AuthorityStationPeerId: string(authority),
				CommittedAt:            timestamppb.New(productionAdapterTestTime.Add(-time.Hour)),
			},
			Recipient: &chatmodel.CryptoEndpoint{
				Ptid:     string(receipt.Consumer.Actor),
				DeviceId: string(receipt.Consumer.Device),
			},
			DeliveryCommitment: bytes.Repeat([]byte{0x66}, 32),
		})
	if err != nil {
		t.Fatal(err)
	}
	receipt.PayloadHash = valueobject.HashBytes(payload)
	ackedAt := productionAdapterTestTime
	if err := database.Create(&deliveryinfra.DeviceQueueItemModel{
		ItemID:            strings.TrimPrefix(receipt.ReceiptID, "device-consumed:"),
		RecipientPTID:     string(receipt.Consumer.Actor),
		RecipientDeviceID: string(receipt.Consumer.Device),
		LaneSequence:      receipt.LaneSequence,
		IdempotencyKey:    receipt.ReceiptID,
		EventID:           string(receipt.EventID),
		EventSequence:     uint64(receipt.EventSequence),
		ConversationID:    string(receipt.ConversationID),
		PayloadType:       int32(chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_CONVERSATION_EVENT),
		OpaquePayload:     payload,
		PayloadSHA256:     receipt.PayloadHash.Bytes(),
		State:             int32(chatmodel.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_ACKED),
		FirstQueuedAt:     productionAdapterTestTime.Add(-time.Hour),
		NextAttemptAt:     productionAdapterTestTime.Add(-time.Hour),
		AckedAt:           &ackedAt,
	}).Error; err != nil {
		t.Fatal(err)
	}

	return receipt
}

func TestFollowerDeviceReceiptRequiresPinnedAuthoritySource(t *testing.T) {
	view := query.ConversationView{
		Conversation: aggregate.Snapshot{
			AuthorityStation: "station-b",
		},
		Source:         query.SourceFollower,
		FollowerStatus: repository.FollowerStatusActive,
	}
	if err := validateFollowerDeviceDeliverySource(
		view,
		"station-a",
		"station-b",
	); err != nil {
		t.Fatalf("valid follower authority source: %v", err)
	}
	for _, source := range []valueobject.StationID{"station-a", "station-c"} {
		if err := validateFollowerDeviceDeliverySource(
			view,
			"station-a",
			source,
		); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
			t.Fatalf("source %s error = %v", source, err)
		}
	}
	view.FollowerStatus = repository.FollowerStatusReadOnly
	if err := validateFollowerDeviceDeliverySource(
		view,
		"station-a",
		"station-b",
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("read-only follower source error = %v", err)
	}
}

func TestProductionDeliveryReceiptProjectionUsesTransactionBoundRoutes(
	t *testing.T,
) {
	fixture := newProductionAdapterFixture(t)
	remoteOriginator := valueobject.Endpoint{
		Actor:  fixture.alice.Actor,
		Device: "alice-remote-device",
	}
	receipt := interactionapp.DeliveryReceipt{
		ReceiptID:      "device-consumed:item-2",
		ConversationID: "conversation-1",
		EventID:        "event-2",
		Consumer:       fixture.bob,
		EventSequence:  2,
		LaneSequence:   8,
		PayloadHash:    valueobject.HashBytes([]byte("queue-payload-2")),
		ConsumedAt:     productionAdapterTestTime,
	}
	recorded := interactionapp.DeliveryRecordResult{
		Aggregate: interactionapp.DeliveryAggregate{
			ConversationID:      receipt.ConversationID,
			EventID:             receipt.EventID,
			EventSequence:       receipt.EventSequence,
			RequiredDeviceCount: 1,
			ConsumedDeviceCount: 1,
			Delivered:           true,
			FullyDelivered:      true,
		},
		MessageID:  "message-2",
		Originator: fixture.alice.Actor,
		OriginatorRoutes: []interactionapp.EndpointRoute{
			{Endpoint: fixture.alice, HomeStation: "station-a"},
			{Endpoint: remoteOriginator, HomeStation: "station-b"},
		},
	}
	if err := fixture.db.Transaction(func(tx *gorm.DB) error {
		adapters, err := fixture.factory.Bind(tx)
		if err != nil {
			return err
		}

		return enqueueDeliveryReceiptProjections(
			context.Background(),
			tx,
			adapters,
			"station-a",
			productionAdapterTestTime,
			receipt,
			recorded,
		)
	}); err != nil {
		t.Fatal(err)
	}

	var localItem deliveryinfra.DeviceQueueItemModel
	if err := fixture.db.Where(
		"recipient_ptid = ? AND recipient_device_id = ? AND event_id = ?",
		string(fixture.alice.Actor),
		string(fixture.alice.Device),
		string(recorded.MessageID),
	).First(&localItem).Error; err != nil {
		t.Fatal(err)
	}
	var localReceipt chatmodel.MessageReceipt
	if err := proto.Unmarshal(localItem.OpaquePayload, &localReceipt); err != nil {
		t.Fatal(err)
	}
	if localReceipt.GetMessageId() != string(recorded.MessageID) ||
		localReceipt.GetPtid() != string(receipt.Consumer.Actor) ||
		localReceipt.GetDeviceId() != string(receipt.Consumer.Device) {
		t.Fatalf("local delivery receipt = %+v", &localReceipt)
	}

	var remoteFrame federationdelivery.OutboxRecord
	if err := fixture.db.Where(
		"payload_kind = ? AND target_station_peer_id = ?",
		int32(federationdelivery.PayloadKindConversationDeviceDelivery),
		"station-b",
	).First(&remoteFrame).Error; err != nil {
		t.Fatal(err)
	}
	var frame federationdelivery.Frame
	if err := proto.Unmarshal(remoteFrame.FrameBytes, &frame); err != nil {
		t.Fatal(err)
	}
	var item chatmodel.DurableDeviceInboxItem
	if err := proto.Unmarshal(frame.GetOpaquePayload(), &item); err != nil {
		t.Fatal(err)
	}
	if item.GetRecipient().GetActor().GetPtid() != string(remoteOriginator.Actor) ||
		item.GetRecipient().GetDeviceId() != string(remoteOriginator.Device) ||
		item.GetEventId() != string(recorded.MessageID) ||
		frame.GetOrderingSequence() != int64(receipt.EventSequence) {
		t.Fatalf("remote delivery receipt frame=%+v item=%+v", &frame, &item)
	}
	if err := fixture.db.Transaction(func(tx *gorm.DB) error {
		adapters, err := fixture.factory.Bind(tx)
		if err != nil {
			return err
		}

		return enqueueDeliveryReceiptProjections(
			context.Background(),
			tx,
			adapters,
			"station-a",
			productionAdapterTestTime.Add(time.Hour),
			receipt,
			recorded,
		)
	}); err != nil {
		t.Fatalf("repair exact receipt projection replay: %v", err)
	}
	secondReceipt := receipt
	secondReceipt.ReceiptID = "device-consumed:item-2b"
	secondReceipt.Consumer = valueobject.Endpoint{
		Actor:  receipt.Consumer.Actor,
		Device: "bob-device-2",
	}
	if err := fixture.db.Transaction(func(tx *gorm.DB) error {
		adapters, err := fixture.factory.Bind(tx)
		if err != nil {
			return err
		}

		return enqueueDeliveryReceiptProjections(
			context.Background(),
			tx,
			adapters,
			"station-a",
			productionAdapterTestTime,
			secondReceipt,
			recorded,
		)
	}); err != nil {
		t.Fatalf("enqueue second same-sequence receipt: %v", err)
	}
	var remoteCount int64
	if err := fixture.db.Model(&federationdelivery.OutboxRecord{}).
		Where(
			"payload_kind = ? AND target_station_peer_id = ? AND ordering_sequence = ?",
			int32(federationdelivery.PayloadKindConversationDeviceDelivery),
			"station-b",
			int64(receipt.EventSequence),
		).
		Count(&remoteCount).Error; err != nil {
		t.Fatal(err)
	}
	if remoteCount != 2 {
		t.Fatalf("same-sequence remote delivery receipts = %d, want 2", remoteCount)
	}

	failedReceipt := receipt
	failedReceipt.ReceiptID = "device-consumed:item-3"
	failedReceipt.EventID = "event-3"
	failedReceipt.EventSequence = 3
	failedResult := recorded
	failedResult.Aggregate.EventID = failedReceipt.EventID
	failedResult.Aggregate.EventSequence = failedReceipt.EventSequence
	failedResult.MessageID = "message-3"
	failedResult.OriginatorRoutes = []interactionapp.EndpointRoute{
		{Endpoint: fixture.alice, HomeStation: "station-a"},
		{
			Endpoint:    valueobject.Endpoint{Actor: fixture.alice.Actor},
			HomeStation: "station-b",
		},
	}
	err := fixture.db.Transaction(func(tx *gorm.DB) error {
		adapters, err := fixture.factory.Bind(tx)
		if err != nil {
			return err
		}

		return enqueueDeliveryReceiptProjections(
			context.Background(),
			tx,
			adapters,
			"station-a",
			productionAdapterTestTime,
			failedReceipt,
			failedResult,
		)
	})
	if err == nil {
		t.Fatal("invalid remote originator route was accepted")
	}
	var rolledBack int64
	if err := fixture.db.Model(&deliveryinfra.DeviceQueueItemModel{}).
		Where("event_id = ?", string(failedResult.MessageID)).
		Count(&rolledBack).Error; err != nil {
		t.Fatal(err)
	}
	if rolledBack != 0 {
		t.Fatalf("failed receipt projection retained %d local queue rows", rolledBack)
	}
}

func TestProductionAdaptersRollbackWithConversationTransaction(t *testing.T) {
	fixture := newProductionAdapterFixture(t)
	ctx := context.Background()
	receiptPayload := productionAdapterReceiptPayload(t)
	payloadHash := valueobject.HashBytes(receiptPayload)
	eventID := valueobject.EventID(payloadHash.String())
	rollback := errors.New("rollback production adapter transaction")

	err := fixture.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		adapters, bindErr := fixture.factory.Bind(tx)
		if bindErr != nil {
			return bindErr
		}

		localIntent := ports.DeviceInboxIntent{
			IntentID:       "local-inbox-item",
			ConversationID: "conversation-1",
			EventID:        eventID,
			EventSequence:  1,
			Recipient:      fixture.bob,
			IdempotencyKey: valueobject.HashBytes(
				[]byte("local-inbox-idempotency"),
			).String(),
			PayloadKind:   ports.DeviceInboxPayloadDeviceReceipt,
			OpaquePayload: receiptPayload,
			PayloadHash:   payloadHash,
			CreatedAt:     productionAdapterTestTime,
		}
		if enqueueErr := adapters.DeviceInbox.Enqueue(ctx, localIntent); enqueueErr != nil {
			return enqueueErr
		}

		remoteIntent := ports.FederationOutboxIntent{
			IntentID:       "remote-inbox-item",
			ConversationID: "conversation-1",
			EventID:        eventID,
			EventSequence:  1,
			Recipient:      fixture.bob,
			TargetStation:  "station-b",
			IdempotencyKey: valueobject.HashBytes(
				[]byte("remote-inbox-idempotency"),
			).String(),
			PayloadKind:   ports.DeviceInboxPayloadDeviceReceipt,
			OpaquePayload: receiptPayload,
			PayloadHash:   payloadHash,
			CreatedAt:     productionAdapterTestTime,
		}
		if enqueueErr := adapters.FederationOutbox.Enqueue(ctx, remoteIntent); enqueueErr != nil {
			return enqueueErr
		}

		delivery, buildErr := valueobject.NewPreparedDelivery(
			fixture.bob,
			"station-a",
			valueobject.DeliveryKindConversation,
			receiptPayload,
		)
		if buildErr != nil {
			return buildErr
		}
		commitments, buildErr := domainservice.BuildDeliveryCommitments(
			"conversation-1",
			eventID,
			[]valueobject.PreparedDelivery{delivery},
		)
		if buildErr != nil {
			return buildErr
		}
		if recordErr := adapters.DeliveryCommitments.RecordCommitments(
			ctx,
			[]ports.AuthorityDeliveryCommitment{{
				ConversationID:      "conversation-1",
				EventID:             eventID,
				EventSequence:       1,
				Originator:          fixture.alice.Actor,
				Recipient:           fixture.bob,
				HomeStation:         "station-a",
				PayloadKind:         delivery.Kind,
				EndpointPayloadHash: delivery.PayloadHash,
				Commitment:          commitments[0].Hash,
				QueueItemID:         localIntent.IntentID,
				QueuePayloadHash:    payloadHash,
				RequiredRecipient:   true,
				CreatedAt:           productionAdapterTestTime,
			}},
		); recordErr != nil {
			return recordErr
		}

		if grantErr := adapters.ObjectGrants.GrantBatch(
			ctx,
			ports.ObjectGrantBatch{
				ConversationID: "conversation-1",
				MessageID:      "message-1",
				Uploader:       fixture.alice.Actor,
				EventID:        eventID,
				ObjectIDs:      []valueobject.ObjectID{fixture.objectID},
				Recipients:     []valueobject.PTID{fixture.bob.Actor},
				GrantedAt:      productionAdapterTestTime,
			},
		); grantErr != nil {
			return grantErr
		}

		reservations, reserveErr := adapters.KeyPackageReservations.Reserve(
			ctx,
			"plan-rollback",
			[]ports.EndpointRoute{{
				Endpoint:    fixture.bob,
				HomeStation: "station-a",
			}},
			productionAdapterTestTime.Add(time.Minute),
		)
		if reserveErr != nil {
			return reserveErr
		}
		if len(reservations) != 1 {
			t.Fatalf("reservations = %d, want 1", len(reservations))
		}

		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("transaction error = %v", err)
	}

	assertProductionAdapterCount(t, fixture.db, &deliveryinfra.DeviceQueueItemModel{}, 0)
	assertProductionAdapterCount(t, fixture.db, &federationdelivery.OutboxRecord{}, 0)
	assertProductionAdapterCount(
		t,
		fixture.db,
		&deliveryinfra.AuthorityDeliveryCommitmentModel{},
		0,
	)
	assertProductionAdapterCount(t, fixture.db, &attachmentinfra.GrantModel{}, 0)

	var object attachmentinfra.ObjectModel
	if err := fixture.db.First(&object, "object_id = ?", string(fixture.objectID)).Error; err != nil {
		t.Fatal(err)
	}
	if object.EventID != "" ||
		object.State != string(attachmentapp.ObjectStateCompleteUnattached) {
		t.Fatalf("rolled-back object = %+v", object)
	}

	var keyPackage keyexchangeinfra.MLSKeyPackageModel
	if err := fixture.db.First(&keyPackage).Error; err != nil {
		t.Fatal(err)
	}
	if keyPackage.ReservedPlanID != "" ||
		keyPackage.ReservedUntil != nil ||
		keyPackage.ConsumedAt != nil {
		t.Fatalf("rolled-back KeyPackage = %+v", keyPackage)
	}
}

func TestProductionKeyPackageReservationsUseCanonicalLifecycle(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		transition func(
			context.Context,
			ports.KeyPackageReservations,
			[]valueobject.KeyPackageReservation,
			time.Time,
		) error
		wantConsumed bool
	}{
		{
			name: "consume",
			transition: func(
				ctx context.Context,
				port ports.KeyPackageReservations,
				reservations []valueobject.KeyPackageReservation,
				at time.Time,
			) error {
				return port.Consume(ctx, reservations, at)
			},
			wantConsumed: true,
		},
		{
			name: "release",
			transition: func(
				ctx context.Context,
				port ports.KeyPackageReservations,
				reservations []valueobject.KeyPackageReservation,
				at time.Time,
			) error {
				return port.Release(ctx, reservations, at)
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newProductionAdapterFixture(t)
			adapters, err := fixture.factory.Bind(fixture.db)
			if err != nil {
				t.Fatal(err)
			}
			reservations, err := adapters.KeyPackageReservations.Reserve(
				context.Background(),
				valueobject.PlanID("plan-"+testCase.name),
				[]ports.EndpointRoute{{
					Endpoint:    fixture.bob,
					HomeStation: "station-a",
				}},
				productionAdapterTestTime.Add(time.Minute),
			)
			if err != nil {
				t.Fatal(err)
			}
			if len(reservations) != 1 ||
				reservations[0].Endpoint != fixture.bob ||
				reservations[0].ID == "" {
				t.Fatalf("reservations = %+v", reservations)
			}
			if err := testCase.transition(
				context.Background(),
				adapters.KeyPackageReservations,
				reservations,
				productionAdapterTestTime.Add(30*time.Second),
			); err != nil {
				t.Fatal(err)
			}

			var model keyexchangeinfra.MLSKeyPackageModel
			if err := fixture.db.First(&model).Error; err != nil {
				t.Fatal(err)
			}
			if model.ReservedPlanID != "" || model.ReservedUntil != nil {
				t.Fatalf("terminal KeyPackage retained reservation = %+v", model)
			}
			if (model.ConsumedAt != nil) != testCase.wantConsumed {
				t.Fatalf(
					"consumed = %t, want %t",
					model.ConsumedAt != nil,
					testCase.wantConsumed,
				)
			}
		})
	}
}

func TestProductionKeyPackageReservationsUseKeyExchangeForRemoteEndpoint(
	t *testing.T,
) {
	fixture := newProductionAdapterFixture(t)
	adapters, err := fixture.factory.Bind(fixture.db)
	if err != nil {
		t.Fatal(err)
	}
	expiresAt := productionAdapterTestTime.Add(time.Minute)
	reservations, err := adapters.KeyPackageReservations.Reserve(
		context.Background(),
		"remote-plan",
		[]ports.EndpointRoute{{
			Endpoint:    fixture.bob,
			HomeStation: "station-b",
		}},
		expiresAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(reservations) != 1 ||
		reservations[0].Endpoint != fixture.bob ||
		reservations[0].HomeStation != "station-b" ||
		!reservations[0].IrreversiblyConsumed {
		t.Fatalf("remote reservations = %+v", reservations)
	}
	if len(fixture.keyExchange.calls) != 1 {
		t.Fatalf("Key Exchange reservation calls = %d, want 1", len(fixture.keyExchange.calls))
	}
	call := fixture.keyExchange.calls[0]
	if call.requestID != productionKeyPackageClaimRequestID(
		"station-a",
		"remote-plan",
		fixture.bob,
	) ||
		call.authorityPlanID != "remote-plan" ||
		call.target != (keyexchangedomain.Endpoint{
			ActorPTID: string(fixture.bob.Actor),
			DeviceID:  string(fixture.bob.Device),
		}) ||
		call.homeStationID != "station-b" ||
		!call.expiresAt.Equal(expiresAt) {
		t.Fatalf("remote Key Exchange reservation call = %+v", call)
	}
	if err := adapters.KeyPackageReservations.Consume(
		context.Background(),
		reservations,
		productionAdapterTestTime.Add(30*time.Second),
	); err != nil {
		t.Fatal(err)
	}

	var local keyexchangeinfra.MLSKeyPackageModel
	if err := fixture.db.First(&local).Error; err != nil {
		t.Fatal(err)
	}
	if local.ReservedPlanID != "" ||
		local.ReservedUntil != nil ||
		local.ConsumedAt != nil {
		t.Fatalf("remote claim mutated local Key Exchange material = %+v", local)
	}
}

func newProductionAdapterFixture(t *testing.T) productionAdapterFixture {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(
			"file:conversation-production-adapters-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})

	if err := database.AutoMigrate(
		&actoridentitypersistence.ActorIdentityModel{},
		&actoridentitypersistence.ActorDeviceModel{},
	); err != nil {
		t.Fatal(err)
	}
	if err := federationinfra.MigrateSchema(database); err != nil {
		t.Fatal(err)
	}
	deviceInbox, err := deliveryinfra.NewRepository(
		database,
		productionAdapterQueueLimits(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := deviceInbox.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&deliveryinfra.AuthorityDeliveryCommitmentModel{},
		&deliveryinfra.AuthorityDeliveryReceiptModel{},
	); err != nil {
		t.Fatal(err)
	}
	attachments, err := attachmentinfra.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := attachments.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	keyPackages, err := keyexchangeinfra.NewCanonicalStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := keyPackages.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	sharedFederation, err := federationdelivery.NewGORMRepository(
		database,
		productionAdapterTestClock{now: productionAdapterTestTime},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := sharedFederation.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}

	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"}
	bob := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-device"}
	alicePrivate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x11}, ed25519.SeedSize))
	bobPrivate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x22}, ed25519.SeedSize))
	seedProductionAdapterIdentity(t, database, alice, alicePrivate, "alice-signing-key")
	seedProductionAdapterIdentity(t, database, bob, bobPrivate, "bob-signing-key")
	if err := federationinfra.NewRepos(database).Membership.Upsert(
		context.Background(),
		&federationdomain.MembershipRecord{
			FederationID:  "federation-1",
			StationPeerID: "station-b",
			Status:        "active",
		},
	); err != nil {
		t.Fatal(err)
	}
	keyPackage := []byte("canonical-mls-key-package")
	keyPackageHash := valueobject.HashBytes(keyPackage)
	if err := database.Create(&keyexchangeinfra.MLSKeyPackageModel{
		ActorPTID:     string(bob.Actor),
		DeviceID:      string(bob.Device),
		HomeStationID: "station-a",
		Data:          keyPackage,
		DataSHA256:    keyPackageHash.Bytes(),
		CreatedAt:     productionAdapterTestTime.Add(-time.Minute),
	}).Error; err != nil {
		t.Fatal(err)
	}
	objectID := seedProductionAdapterGrantObject(t, database)

	stationPrivate := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x33}, ed25519.SeedSize),
	)
	keyExchange := &productionAdapterTestKeyExchange{}
	factory, err := NewProductionTransactionalAdapterFactory(
		ProductionTransactionalAdapterFactoryConfig{
			LocalStationID:          "station-a",
			DeviceInboxLimits:       productionAdapterQueueLimits(),
			FederationSigner:        productionAdapterTestSigner{privateKey: stationPrivate},
			Clock:                   productionAdapterTestClock{now: productionAdapterTestTime},
			FederationFrameLifetime: time.Hour,
			KeyExchange:             keyExchange,
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	return productionAdapterFixture{
		db:          database,
		factory:     factory,
		keyExchange: keyExchange,
		alice:       alice,
		bob:         bob,
		bobPrivate:  bobPrivate,
		objectID:    objectID,
	}
}

func productionAdapterQueueLimits() deliveryapp.QueueLimits {
	return deliveryapp.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1 << 20,
	}
}

func seedProductionAdapterIdentity(
	t *testing.T,
	database *gorm.DB,
	endpoint valueobject.Endpoint,
	privateKey ed25519.PrivateKey,
	signingKeyID string,
) {
	t.Helper()
	publicKey := privateKey.Public().(ed25519.PublicKey)
	if err := database.Create(&actoridentitypersistence.ActorIdentityModel{
		PTID:           string(endpoint.Actor),
		PublicKey:      append([]byte(nil), publicKey...),
		Fingerprint:    valueobject.HashBytes(publicKey).Bytes(),
		ProfileVersion: 1,
		CreatedAt:      productionAdapterTestTime.Add(-time.Hour),
		UpdatedAt:      productionAdapterTestTime.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&actoridentitypersistence.ActorDeviceModel{
		PTID:              string(endpoint.Actor),
		ActorAccount:      string(endpoint.Actor),
		ActorKind:         1,
		DeviceID:          string(endpoint.Device),
		Label:             string(endpoint.Device),
		HomeStationPeerID: "station-a",
		SigningKeyID:      signingKeyID,
		PublicKey:         append([]byte(nil), publicKey...),
		ProfileVersion:    1,
		VerificationSource: int32(
			actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
		),
		CreatedAt: productionAdapterTestTime.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func seedProductionAdapterGrantObject(
	t *testing.T,
	database *gorm.DB,
) valueobject.ObjectID {
	t.Helper()
	commitment := valueobject.HashBytes([]byte("attachment-descriptor"))
	ciphertextHash := valueobject.HashBytes([]byte("attachment-ciphertext"))
	objectID, storageRef, _ := attachmentapp.ImmutableObjectIdentity(
		"upload-1",
		commitment,
	)
	createdAt := productionAdapterTestTime.Add(-time.Minute)
	expiresAt := productionAdapterTestTime.Add(time.Hour)
	verificationExpiresAt := createdAt.Add(10 * time.Minute)
	verificationToken := attachmentapp.VerificationToken(
		"upload-1",
		1,
		commitment,
		1,
	)
	storageKey := attachmentapp.VerificationObjectStorageKey(
		storageRef,
		verificationToken,
	)
	ciphertextSize := uint64(attachmentapp.TagSize + 1)
	if err := database.Create(&attachmentinfra.UploadModel{
		UploadID:                   "upload-1",
		Generation:                 1,
		ConversationID:             "conversation-1",
		MessageID:                  "message-1",
		AttachmentID:               "attachment-1",
		UploaderPTID:               "ptid:alice",
		UploaderDeviceID:           "alice-device",
		CiphertextSize:             ciphertextSize,
		CiphertextSHA256:           ciphertextHash.Bytes(),
		MediaType:                  "application/octet-stream",
		ChunkSize:                  attachmentapp.ChunkSize,
		ChunkCount:                 1,
		EncryptionSuite:            int32(attachmentapp.EncryptionSuiteAES256GCMChunked),
		TagSize:                    attachmentapp.TagSize,
		NonceStrategy:              int32(attachmentapp.NonceStrategyCounter32BE),
		ChunkCiphertextSHA256:      ciphertextHash.Bytes(),
		DescriptorCommitmentSHA256: commitment.Bytes(),
		IdempotencyKey:             "attachment-idempotency",
		State:                      int32(attachmentapp.TransferStateComplete),
		ReceivedChunkBitmap:        []byte{1},
		ObjectID:                   string(objectID),
		StorageRef:                 storageRef,
		VerificationToken:          verificationToken,
		VerificationStorageKey:     storageKey,
		VerificationStartedAt:      &createdAt,
		VerificationLeaseExpiresAt: &verificationExpiresAt,
		VerificationAttemptCount:   1,
		ExpiresAt:                  expiresAt,
		CleanupNextAttemptAt:       expiresAt,
		CreatedAt:                  createdAt,
		UpdatedAt:                  createdAt,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&attachmentinfra.ObjectModel{
		ObjectID:                   string(objectID),
		StorageRef:                 storageRef,
		StorageKey:                 storageKey,
		ConversationID:             "conversation-1",
		MessageID:                  "message-1",
		AttachmentID:               "attachment-1",
		UploaderPTID:               "ptid:alice",
		CiphertextSize:             ciphertextSize,
		CiphertextSHA256:           ciphertextHash.Bytes(),
		MediaType:                  "application/octet-stream",
		ChunkSize:                  attachmentapp.ChunkSize,
		ChunkCount:                 1,
		EncryptionSuite:            int32(attachmentapp.EncryptionSuiteAES256GCMChunked),
		TagSize:                    attachmentapp.TagSize,
		NonceStrategy:              int32(attachmentapp.NonceStrategyCounter32BE),
		ChunkCiphertextSHA256:      ciphertextHash.Bytes(),
		DescriptorCommitmentSHA256: commitment.Bytes(),
		State:                      string(attachmentapp.ObjectStateCompleteUnattached),
		ExpiresAt:                  expiresAt,
		CleanupNextAttemptAt:       expiresAt,
		CreatedAt:                  createdAt,
	}).Error; err != nil {
		t.Fatal(err)
	}

	return objectID
}

func productionAdapterReceiptPayload(t *testing.T) []byte {
	t.Helper()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chatmodel.ActorReadCursor{
			ConversationId:   "conversation-1",
			ReaderPtid:       "ptid:alice",
			LastReadSequence: 1,
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	return payload
}

func assertProductionAdapterCount(
	t *testing.T,
	database *gorm.DB,
	model any,
	expected int64,
) {
	t.Helper()
	var count int64
	if err := database.Model(model).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != expected {
		t.Fatalf("%T count = %d, want %d", model, count, expected)
	}
}
