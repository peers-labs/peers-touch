package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type federationDeviceAccess struct {
	active map[string]bool
}

func (a federationDeviceAccess) IsActiveDevice(
	_ context.Context,
	ptid string,
	deviceID string,
) (bool, error) {
	return a.active[ptid+"\x00"+deviceID], nil
}

type federationAuthorityService struct {
	submitted                   int
	receivedSourceHomeStationID string
	expectedSourceHomeStationID string
	expectedSender              *chat.CryptoEndpoint
}

func (s *federationAuthorityService) SubmitFederated(
	_ context.Context,
	sourceHomeStationID string,
	command *chat.ChatCommand,
) (*chat.ConversationEvent, error) {
	if command == nil ||
		command.Sender == nil ||
		sourceHomeStationID != s.expectedSourceHomeStationID ||
		s.expectedSender == nil ||
		command.Sender.Ptid != s.expectedSender.Ptid ||
		command.Sender.DeviceId != s.expectedSender.DeviceId {
		return nil, messaging.ErrSenderUnauthorized
	}
	s.submitted++
	s.receivedSourceHomeStationID = sourceHomeStationID

	return &chat.ConversationEvent{}, nil
}

type federationFollowerReplayClient struct{}

func (federationFollowerReplayClient) FetchFollowerEvents(
	context.Context,
	string,
	string,
	*chat.GetMessagingFollowerEventsRequest,
) (*chat.MessagingFollowerEventsPage, error) {
	return nil, messaging.ErrFollowerReplayUnavailable
}

func newFederationInboxFixture(
	t *testing.T,
	limits messaging.QueueLimits,
	devices federationDeviceAccess,
) (*gorm.DB, *application.FederationService) {
	t.Helper()
	db, service, _ := newFederationInboxFixtureWithManifest(
		t,
		limits,
		devices,
		testBatchManifest(),
	)

	return db, service
}

func newFederationInboxFixtureWithManifest(
	t *testing.T,
	limits messaging.QueueLimits,
	devices federationDeviceAccess,
	manifest *chat.FederatedEndpointManifest,
) (*gorm.DB, *application.FederationService, *federationAuthorityService) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	uow := infrastructure.NewFederationInboxUnitOfWork(db, limits)
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	followerRepository, err := infrastructure.NewFollowerRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	followerService, err := application.NewFollowerProjectionService(
		uow,
		followerRepository,
		federationFollowerReplayClient{},
		messaging.FederationPeerTrustResolveFunc(
			func(context.Context, string, string) error {
				return nil
			},
		),
		"station-b",
		application.FollowerProjectionPolicy{
			MaxPendingEvents: 128,
			MaxPendingBytes:  4 << 20,
			PendingTTL:       10 * time.Minute,
			ReplayPageLimit:  128,
		},
		time.Now,
	)
	if err != nil {
		t.Fatal(err)
	}
	authority := &federationAuthorityService{}
	if manifest != nil && len(manifest.ActiveEndpoints) > 0 {
		authority.expectedSourceHomeStationID = manifest.HomeStationId
		authority.expectedSender = manifest.ActiveEndpoints[0].Endpoint
	}
	service, err := application.NewFederationService(
		uow,
		devices,
		authority,
		messaging.EndpointManifestResolveFunc(func(
			_ context.Context,
			actorPTID string,
		) (*chat.FederatedEndpointManifest, error) {
			if manifest == nil || manifest.ActorPtid != actorPTID {
				return nil, messaging.ErrNotFound
			}

			return manifest, nil
		}),
		messaging.LocalEndpointManifestVerifyFunc(func(
			context.Context,
			*chat.FederatedEndpointManifest,
			string,
			time.Time,
		) error {
			return nil
		}),
		followerService,
		application.FederationPolicy{MaxBatchWrites: 100},
	)
	if err != nil {
		t.Fatal(err)
	}

	return db, service, authority
}

func federatedWrite(
	t *testing.T,
	event *chat.ConversationEvent,
	ptid string,
	deviceID string,
) *chat.FederatedDeviceQueueWrite {
	t.Helper()
	endpointPayload := []byte("delivery:" + ptid + ":" + deviceID)
	endpointPayloadHash := sha256.Sum256(endpointPayload)
	recipient := &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID}
	commitment := testDeliveryCommitment(
		event.ConversationId,
		event.EventId,
		recipient,
		chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT,
		endpointPayloadHash[:],
	)
	deliveryBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.DeviceEventDelivery{
			Event:                 event,
			Recipient:             recipient,
			PayloadKind:           chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT,
			EndpointPayload:       endpointPayload,
			EndpointPayloadSha256: endpointPayloadHash[:],
			DeliveryCommitment:    commitment,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(deliveryBytes)
	return &chat.FederatedDeviceQueueWrite{
		Recipient:      recipient,
		EventId:        event.EventId,
		ConversationId: event.ConversationId,
		IdempotencyKey: "event-1:" + ptid + ":" + deviceID,
		PayloadType:    chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_CONVERSATION_EVENT,
		OpaquePayload:  deliveryBytes,
		PayloadSha256:  hash[:],
	}
}

func signedBatchFrame(
	t *testing.T,
	privateKey ed25519.PrivateKey,
	frameID string,
	idempotencyKey string,
	now time.Time,
) *chat.MessagingFederationFrame {
	t.Helper()
	event := &chat.ConversationEvent{
		EventId:            "event-1",
		ConversationId:     "conversation-1",
		Sequence:           1,
		CommandId:          "command-1",
		Actor:              &chat.CryptoEndpoint{Ptid: "ptid:owner", DeviceId: "owner-device"},
		CommittedAt:        timestamppb.New(now),
		MembershipEpoch:    1,
		AuthorityStationId: "station-a",
		Payload: &chat.ConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedFact{
				Kind:      chat.ConversationKind_CONVERSATION_KIND_DIRECT,
				OwnerPtid: "ptid:owner",
				Members: []*chat.ConversationAuthorityMember{
					{
						Ptid:          "ptid:alice",
						HomeStationId: "station-b",
						Role:          "member",
					},
					{
						Ptid:          "ptid:owner",
						HomeStationId: "station-a",
						Role:          "owner",
					},
				},
			},
		},
	}
	for _, deviceID := range []string{"active-device", "revoked-device"} {
		payloadHash := sha256.Sum256(
			[]byte("delivery:ptid:alice:" + deviceID),
		)
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			testDeliveryCommitment(
				event.ConversationId,
				event.EventId,
				&chat.CryptoEndpoint{Ptid: "ptid:alice", DeviceId: deviceID},
				chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT,
				payloadHash[:],
			),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	hashInput := proto.Clone(event).(*chat.ConversationEvent)
	eventHashInput, err := proto.MarshalOptions{Deterministic: true}.Marshal(hashInput)
	if err != nil {
		t.Fatal(err)
	}
	eventHash := sha256.Sum256(eventHashInput)
	event.EventHash = eventHash[:]
	batchBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.FederatedDeviceQueueBatch{
			Writes: []*chat.FederatedDeviceQueueWrite{
				federatedWrite(t, event, "ptid:alice", "active-device"),
				federatedWrite(t, event, "ptid:alice", "revoked-device"),
			},
			EndpointManifests: []*chat.FederatedEndpointManifest{
				testBatchManifest(),
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(batchBytes)
	frame := &chat.MessagingFederationFrame{
		FrameId:           frameID,
		SourceStationId:   "station-a",
		TargetStationId:   "station-b",
		IdempotencyKey:    idempotencyKey,
		PayloadType:       chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH,
		ConversationId:    "conversation-1",
		EventId:           "event-1",
		AuthoritySequence: 1,
		OpaquePayload:     batchBytes,
		PayloadSha256:     hash[:],
		IssuedAt:          timestamppb.New(now),
		ExpiresAt:         timestamppb.New(now.Add(time.Minute)),
	}
	if err := application.SignFederationFrame(frame, "key-1", privateKey); err != nil {
		t.Fatal(err)
	}
	return frame
}

func signedProjectionFrame(
	t *testing.T,
	privateKey ed25519.PrivateKey,
	deviceFrame *chat.MessagingFederationFrame,
	now time.Time,
) *chat.MessagingFederationFrame {
	t.Helper()
	batch := &chat.FederatedDeviceQueueBatch{}
	if err := proto.Unmarshal(deviceFrame.OpaquePayload, batch); err != nil {
		t.Fatal(err)
	}
	if len(batch.Writes) == 0 {
		t.Fatal("device frame has no writes")
	}
	delivery := &chat.DeviceEventDelivery{}
	if err := proto.Unmarshal(batch.Writes[0].OpaquePayload, delivery); err != nil {
		t.Fatal(err)
	}
	projectionBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.MessagingFollowerProjection{
			FormatVersion:       application.MessagingFollowerProjectionFormatVersion,
			AuthorityStationId:  deviceFrame.SourceStationId,
			TargetHomeStationId: deviceFrame.TargetStationId,
			ConversationEvent:   delivery.Event,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	payloadHash := sha256.Sum256(projectionBytes)
	frame := &chat.MessagingFederationFrame{
		FrameId:           "projection-" + deviceFrame.FrameId,
		SourceStationId:   deviceFrame.SourceStationId,
		TargetStationId:   deviceFrame.TargetStationId,
		IdempotencyKey:    "projection-" + deviceFrame.IdempotencyKey,
		PayloadType:       chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_FOLLOWER_PROJECTION,
		ConversationId:    deviceFrame.ConversationId,
		EventId:           deviceFrame.EventId,
		AuthoritySequence: deviceFrame.AuthoritySequence,
		OpaquePayload:     projectionBytes,
		PayloadSha256:     payloadHash[:],
		IssuedAt:          timestamppb.New(now),
		ExpiresAt:         timestamppb.New(now.Add(time.Minute)),
	}
	if err := application.SignFederationFrame(frame, "key-1", privateKey); err != nil {
		t.Fatal(err)
	}
	return frame
}

func signedAuthorityCommandFrame(
	t *testing.T,
	privateKey ed25519.PrivateKey,
	sourceStationID string,
	sender *chat.CryptoEndpoint,
	now time.Time,
) *chat.MessagingFederationFrame {
	t.Helper()
	command := &chat.ChatCommand{
		CommandId:          "command-1",
		ConversationId:     "conversation-1",
		Sender:             sender,
		AuthorityStationId: "station-a",
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.FederatedAuthorityCommand{
			Command:             command,
			SourceHomeStationId: sourceStationID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	payloadHash := sha256.Sum256(payloadBytes)
	frame := &chat.MessagingFederationFrame{
		FrameId:         "authority-command-frame",
		SourceStationId: sourceStationID,
		TargetStationId: "station-a",
		IdempotencyKey:  "authority-command:command-1",
		PayloadType:     chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_AUTHORITY_COMMAND,
		ConversationId:  "conversation-1",
		OpaquePayload:   payloadBytes,
		PayloadSha256:   payloadHash[:],
		IssuedAt:        timestamppb.New(now),
		ExpiresAt:       timestamppb.New(now.Add(time.Minute)),
	}
	if err := application.SignFederationFrame(frame, "key-1", privateKey); err != nil {
		t.Fatal(err)
	}

	return frame
}

func testDeliveryCommitment(
	conversationID string,
	eventID string,
	recipient *chat.CryptoEndpoint,
	kind chat.PreparedEndpointPayloadKind,
	payloadHash []byte,
) []byte {
	var input bytes.Buffer
	input.WriteString("peers-touch/device-delivery-commitment")
	input.WriteByte(0)
	var encoded [4]byte
	binary.BigEndian.PutUint32(encoded[:], 1)
	input.Write(encoded[:])
	for _, value := range []string{
		conversationID,
		eventID,
		recipient.Ptid,
		recipient.DeviceId,
	} {
		binary.BigEndian.PutUint32(encoded[:], uint32(len(value)))
		input.Write(encoded[:])
		input.WriteString(value)
	}
	binary.BigEndian.PutUint32(encoded[:], uint32(kind))
	input.Write(encoded[:])
	input.Write(payloadHash)
	digest := sha256.Sum256(input.Bytes())
	return digest[:]
}

func testBatchManifest() *chat.FederatedEndpointManifest {
	materialHash := sha256.Sum256([]byte("device-material"))
	return &chat.FederatedEndpointManifest{
		FormatVersion:    application.EndpointManifestFormatVersion,
		ManifestId:       "manifest-1",
		ActorPtid:        "ptid:alice",
		HomeStationId:    "station-b",
		DirectoryVersion: 1,
		ActiveEndpoints: []*chat.FederatedEndpointManifestEntry{
			{
				Endpoint: &chat.CryptoEndpoint{
					Ptid:     "ptid:alice",
					DeviceId: "active-device",
				},
				SigningKeyId:         "active-key",
				PublicMaterialSha256: [][]byte{materialHash[:]},
			},
			{
				Endpoint: &chat.CryptoEndpoint{
					Ptid:     "ptid:alice",
					DeviceId: "revoked-device",
				},
				SigningKeyId:         "revoked-key",
				PublicMaterialSha256: [][]byte{materialHash[:]},
			},
		},
		IssuedAt:               timestamppb.New(time.Unix(1_700_000_000, 0).UTC()),
		ExpiresAt:              timestamppb.New(time.Unix(1_700_000_000, 0).UTC().Add(time.Minute)),
		SigningKeyId:           "station-key",
		StationSignature:       make([]byte, ed25519.SignatureSize),
		ActorIdentityPublicKey: bytes.Repeat([]byte{1}, ed25519.PublicKeySize),
		ActorProfileVersion:    1,
	}
}

func TestFederationAuthorityCommandUsesRemoteSenderManifest(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	sender := &chat.CryptoEndpoint{
		Ptid:     "ptid:alice",
		DeviceId: "active-device",
	}
	db, service, authority := newFederationInboxFixtureWithManifest(
		t,
		messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1024 * 1024},
		federationDeviceAccess{},
		testBatchManifest(),
	)
	response, err := service.Deliver(
		context.Background(),
		signedAuthorityCommandFrame(t, privateKey, "station-b", sender, now),
		"station-a",
		publicKey,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !response.Accepted || response.Duplicate {
		t.Fatalf("response = %+v", response)
	}
	if authority.submitted != 1 {
		t.Fatalf("submitted commands = %d, want 1", authority.submitted)
	}
	if authority.receivedSourceHomeStationID != "station-b" {
		t.Fatalf(
			"source Home Station = %q, want station-b",
			authority.receivedSourceHomeStationID,
		)
	}
	var inboxCount int64
	if err := db.Model(&infrastructure.FederationInboxModel{}).
		Count(&inboxCount).Error; err != nil {
		t.Fatal(err)
	}
	if inboxCount != 1 {
		t.Fatalf("inbox rows = %d, want 1", inboxCount)
	}
}

func TestFederationAuthorityCommandRejectsUnverifiedSenderRoute(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	tests := []struct {
		name            string
		sourceStationID string
		sender          *chat.CryptoEndpoint
	}{
		{
			name:            "wrong Home Station",
			sourceStationID: "station-c",
			sender: &chat.CryptoEndpoint{
				Ptid:     "ptid:alice",
				DeviceId: "active-device",
			},
		},
		{
			name:            "endpoint absent from active manifest",
			sourceStationID: "station-b",
			sender: &chat.CryptoEndpoint{
				Ptid:     "ptid:alice",
				DeviceId: "missing-device",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db, service, authority := newFederationInboxFixtureWithManifest(
				t,
				messaging.QueueLimits{
					MaxUnackedItems: 100,
					MaxUnackedBytes: 1024 * 1024,
				},
				federationDeviceAccess{},
				testBatchManifest(),
			)
			_, err := service.Deliver(
				context.Background(),
				signedAuthorityCommandFrame(
					t,
					privateKey,
					test.sourceStationID,
					test.sender,
					now,
				),
				"station-a",
				publicKey,
				now,
			)
			if !errors.Is(err, messaging.ErrSenderUnauthorized) {
				t.Fatalf("delivery error = %v, want ErrSenderUnauthorized", err)
			}
			if authority.submitted != 0 {
				t.Fatalf("submitted commands = %d, want 0", authority.submitted)
			}
			var inboxCount int64
			if err := db.Model(&infrastructure.FederationInboxModel{}).
				Count(&inboxCount).Error; err != nil {
				t.Fatal(err)
			}
			if inboxCount != 0 {
				t.Fatalf("inbox rows = %d, want 0", inboxCount)
			}
		})
	}
}

func TestFederationIngestAtomicallyWritesOnlyActiveDeviceLanesAndDeduplicates(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	db, service := newFederationInboxFixture(
		t,
		messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1024 * 1024},
		federationDeviceAccess{active: map[string]bool{
			"ptid:alice\x00active-device": true,
		}},
	)
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := signedBatchFrame(t, privateKey, "frame-1", "idempotency-1", now)
	projectionFrame := signedProjectionFrame(t, privateKey, frame, now)
	if _, err := service.Deliver(
		context.Background(),
		projectionFrame,
		"station-b",
		publicKey,
		now,
	); err != nil {
		t.Fatal(err)
	}
	response, err := service.Deliver(context.Background(), frame, "station-b", publicKey, now)
	if err != nil {
		t.Fatal(err)
	}
	if !response.Accepted || response.Duplicate {
		t.Fatalf("first response = %+v", response)
	}
	var queueRows []infrastructure.DeviceQueueItemModel
	if err := db.Find(&queueRows).Error; err != nil {
		t.Fatal(err)
	}
	if len(queueRows) != 1 ||
		queueRows[0].RecipientDeviceID != "active-device" ||
		queueRows[0].EventID != "event-1" {
		t.Fatalf("queue rows = %+v", queueRows)
	}
	replay, err := service.Deliver(
		context.Background(),
		frame,
		"station-b",
		publicKey,
		now.Add(2*time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Duplicate {
		t.Fatal("exact frame replay was not identified as duplicate")
	}
	var inboxCount, queueCount int64
	db.Model(&infrastructure.FederationInboxModel{}).Count(&inboxCount)
	db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount)
	if inboxCount != 2 || queueCount != 1 {
		t.Fatalf("replay duplicated state: inbox=%d queue=%d", inboxCount, queueCount)
	}
}

func TestDeviceFrameWaitsForSeparateFollowerProjection(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	db, service := newFederationInboxFixture(
		t,
		messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1024 * 1024},
		federationDeviceAccess{active: map[string]bool{
			"ptid:alice\x00active-device": true,
		}},
	)
	now := time.Unix(1_700_000_000, 0).UTC()
	deviceFrame := signedBatchFrame(t, privateKey, "device-frame", "device-key", now)
	if _, err := service.Deliver(
		context.Background(),
		deviceFrame,
		"station-b",
		publicKey,
		now,
	); !errors.Is(err, messaging.ErrFollowerGap) {
		t.Fatalf("device-before-projection error = %v, want follower gap", err)
	}
	var inboxCount, queueCount int64
	db.Model(&infrastructure.FederationInboxModel{}).Count(&inboxCount)
	db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount)
	if inboxCount != 0 || queueCount != 0 {
		t.Fatalf("device frame established follower truth: inbox=%d queue=%d", inboxCount, queueCount)
	}

	projectionFrame := signedProjectionFrame(t, privateKey, deviceFrame, now)
	if _, err := service.Deliver(
		context.Background(),
		projectionFrame,
		"station-b",
		publicKey,
		now,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Deliver(
		context.Background(),
		deviceFrame,
		"station-b",
		publicKey,
		now,
	); err != nil {
		t.Fatal(err)
	}
	db.Model(&infrastructure.FederationInboxModel{}).Count(&inboxCount)
	db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount)
	if inboxCount != 2 || queueCount != 1 {
		t.Fatalf("projection/device convergence: inbox=%d queue=%d", inboxCount, queueCount)
	}
}

func TestFederationIngestConflictAndQueueFailureRollBackInbox(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	db, service := newFederationInboxFixture(
		t,
		messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1},
		federationDeviceAccess{active: map[string]bool{
			"ptid:alice\x00active-device": true,
		}},
	)
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := signedBatchFrame(t, privateKey, "frame-1", "idempotency-1", now)
	projectionFrame := signedProjectionFrame(t, privateKey, frame, now)
	if _, err := service.Deliver(
		context.Background(),
		projectionFrame,
		"station-b",
		publicKey,
		now,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Deliver(
		context.Background(),
		frame,
		"station-b",
		publicKey,
		now,
	); !errors.Is(err, messaging.ErrQueueQuotaExceeded) {
		t.Fatalf("delivery error = %v, want ErrQueueQuotaExceeded", err)
	}
	var inboxCount, queueCount int64
	db.Model(&infrastructure.FederationInboxModel{}).Count(&inboxCount)
	db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount)
	if inboxCount != 1 || queueCount != 0 {
		t.Fatalf("partial ingest survived: inbox=%d queue=%d", inboxCount, queueCount)
	}
}
