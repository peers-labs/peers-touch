package key_exchange

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"testing"
	"time"

	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const contentPreKeyTestSession = "session-1"

func TestContentPreKeyClientRoutesAreExactlyOwnedByKeyExchange(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	subserver := fixture.capability.(*subServer)
	subserver.api = &recordingCanonicalAPI{}
	subserver.jwtWrapper = keyExchangeTestJWTWrapper()
	subserver.contentPreKeyJWTWrapper = keyExchangeTestJWTWrapper()
	subserver.localStationID = contentPreKeyTestStation

	handlers := subserver.Handlers()
	for _, path := range []string{
		publishContentPreKeysPath,
		inventoryContentPreKeysPath,
	} {
		handler := findKeyExchangeHandler(t, handlers, path)
		if handler.Method() != server.POST || len(handler.Wrappers()) != 3 {
			t.Fatalf(
				"handler %q method/wrappers = %s/%d, want POST/3",
				path,
				handler.Method(),
				len(handler.Wrappers()),
			)
		}
	}
}

func TestContentPreKeyClientPublicationExactReplay(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("client-replay", 7),
	)
	service := fixture.capability.(*subServer).composition.contentPreKeyService

	first, err := service.PublishContentPreKeysClient(
		context.Background(),
		domain.Endpoint{
			ActorPTID: contentPreKeyTestActor,
			DeviceID:  contentPreKeyTestDevice,
		},
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	if err != nil {
		t.Fatalf("first client publication: %v", err)
	}
	if err := fixture.db.Where(
		"kind = ? AND principal_ptid = ? AND principal_device_id = ?",
		int32(securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT),
		contentPreKeyTestActor,
		contentPreKeyTestDevice,
	).Delete(&infrastructure.ContentPreKeyPoolModel{}).Error; err != nil {
		t.Fatalf("remove pool before completed replay: %v", err)
	}
	second, err := service.PublishContentPreKeysClient(
		context.Background(),
		domain.Endpoint{
			ActorPTID: contentPreKeyTestActor,
			DeviceID:  contentPreKeyTestDevice,
		},
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	if err != nil {
		t.Fatalf("replay client publication: %v", err)
	}
	if first.GetExactReplay() || !second.GetExactReplay() {
		t.Fatalf(
			"exact replay flags first/second = %t/%t, want false/true",
			first.GetExactReplay(),
			second.GetExactReplay(),
		)
	}
	assertContentPreKeyClientRowCounts(t, fixture, 1, 1)
	var pools int64
	if err := fixture.db.Model(&infrastructure.ContentPreKeyPoolModel{}).
		Count(&pools).Error; err != nil {
		t.Fatalf("count pools after completed replay: %v", err)
	}
	if pools != 0 {
		t.Fatalf("completed replay recreated %d pools, want 0", pools)
	}
	assertDirectAndMLSInventoryUntouched(t, fixture.db)
}

func TestContentPreKeyClientReplayValidatesCompletedReceipt(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*testing.T, *contentPreKeyOperationalFixture,
			infrastructure.ContentPreKeyPublicationReceiptModel)
	}{
		{
			name: "state",
			mutate: func(
				t *testing.T,
				fixture *contentPreKeyOperationalFixture,
				receipt infrastructure.ContentPreKeyPublicationReceiptModel,
			) {
				if err := fixture.db.Model(&receipt).
					Update("state", "PENDING").Error; err != nil {
					t.Fatalf("corrupt receipt state: %v", err)
				}
			},
		},
		{
			name: "request hash",
			mutate: func(
				t *testing.T,
				fixture *contentPreKeyOperationalFixture,
				receipt infrastructure.ContentPreKeyPublicationReceiptModel,
			) {
				if err := fixture.db.Model(&receipt).
					Update("request_sha256", []byte{0x01}).Error; err != nil {
					t.Fatalf("corrupt receipt request hash: %v", err)
				}
			},
		},
		{
			name: "response hash",
			mutate: func(
				t *testing.T,
				fixture *contentPreKeyOperationalFixture,
				receipt infrastructure.ContentPreKeyPublicationReceiptModel,
			) {
				if err := fixture.db.Model(&receipt).
					Update("response_sha256", []byte{0x01}).Error; err != nil {
					t.Fatalf("corrupt receipt response hash: %v", err)
				}
			},
		},
		{
			name: "inventory epoch",
			mutate: func(
				t *testing.T,
				fixture *contentPreKeyOperationalFixture,
				receipt infrastructure.ContentPreKeyPublicationReceiptModel,
			) {
				var response securecontentpb.PublishContentPreKeysResponse
				if err := proto.Unmarshal(receipt.ResponseBytes, &response); err != nil {
					t.Fatalf("decode receipt response: %v", err)
				}
				response.Inventory.CurrentEpoch++
				responseBytes, err := proto.MarshalOptions{
					Deterministic: true,
				}.Marshal(&response)
				if err != nil {
					t.Fatalf("encode corrupt receipt response: %v", err)
				}
				responseHash := sha256.Sum256(responseBytes)
				if err := fixture.db.Model(&receipt).Updates(map[string]any{
					"response_bytes":  responseBytes,
					"response_sha256": responseHash[:],
				}).Error; err != nil {
					t.Fatalf("corrupt receipt inventory: %v", err)
				}
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newContentPreKeyOperationalFixture(t)
			request := signedContentPreKeyClientRequest(
				t,
				fixture,
				contentEndpointPreKey("receipt-"+testCase.name, 7),
			)
			service := fixture.capability.(*subServer).composition.
				contentPreKeyService
			if _, err := service.PublishContentPreKeysClient(
				context.Background(),
				domain.Endpoint{
					ActorPTID: contentPreKeyTestActor,
					DeviceID:  contentPreKeyTestDevice,
				},
				contentPreKeyTestStation,
				contentPreKeyTestSession,
				request,
			); err != nil {
				t.Fatalf("initial publication: %v", err)
			}
			var receipt infrastructure.ContentPreKeyPublicationReceiptModel
			if err := fixture.db.First(&receipt).Error; err != nil {
				t.Fatalf("load publication receipt: %v", err)
			}
			testCase.mutate(t, fixture, receipt)

			_, err := service.PublishContentPreKeysClient(
				context.Background(),
				domain.Endpoint{
					ActorPTID: contentPreKeyTestActor,
					DeviceID:  contentPreKeyTestDevice,
				},
				contentPreKeyTestStation,
				contentPreKeyTestSession,
				request,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeInvalidMaterial)
			assertContentPreKeyClientRowCounts(t, fixture, 1, 1)
		})
	}
}

func TestContentPreKeyClientPublicationRejectsArbitraryCommandID(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("arbitrary-command", 7),
	)
	request.CommandId = "caller-selected-command"
	service := fixture.capability.(*subServer).composition.contentPreKeyService

	_, err := service.PublishContentPreKeysClient(
		context.Background(),
		domain.Endpoint{
			ActorPTID: contentPreKeyTestActor,
			DeviceID:  contentPreKeyTestDevice,
		},
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeConflict)
	assertContentPreKeyClientRowCounts(t, fixture, 0, 0)
}

func TestContentPreKeyClientRejectsNULRequestIdentifiers(t *testing.T) {
	t.Run("publication command", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		request := signedContentPreKeyClientRequest(
			t,
			fixture,
			contentEndpointPreKey("nul-command", 7),
		)
		request.CommandId = "command\x00id"

		_, err := fixture.capability.(*subServer).composition.
			contentPreKeyService.PublishContentPreKeysClient(
			context.Background(),
			domain.Endpoint{
				ActorPTID: contentPreKeyTestActor,
				DeviceID:  contentPreKeyTestDevice,
			},
			contentPreKeyTestStation,
			contentPreKeyTestSession,
			request,
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeInvalidArgument)
		assertContentPreKeyClientRowCounts(t, fixture, 0, 0)
	})

	t.Run("inventory request", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		request := signedContentPreKeyInventoryRequest(t, fixture)
		request.RequestId = "request\x00id"

		_, err := fixture.capability.(*subServer).composition.
			contentPreKeyService.ContentPreKeyInventoryClient(
			context.Background(),
			domain.Endpoint{
				ActorPTID: contentPreKeyTestActor,
				DeviceID:  contentPreKeyTestDevice,
			},
			contentPreKeyTestStation,
			contentPreKeyTestSession,
			request,
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeInvalidArgument)
	})
}

func TestContentPreKeyClientPossessionFailuresAreUnauthorizedBeforeState(t *testing.T) {
	tests := []struct {
		name    string
		prepare func(*testing.T, *contentPreKeyOperationalFixture,
			*securecontentpb.PublishContentPreKeysRequest)
	}{
		{
			name: "device conflict",
			prepare: func(
				t *testing.T,
				fixture *contentPreKeyOperationalFixture,
				request *securecontentpb.PublishContentPreKeysRequest,
			) {
				authorizeContentPreKeyClientRequest(
					t,
					request,
					"other-signing-key",
					7,
					fixture.privateKey,
					fixture.clock.Now(),
				)
			},
		},
		{
			name: "invalid proof",
			prepare: func(
				t *testing.T,
				fixture *contentPreKeyOperationalFixture,
				_ *securecontentpb.PublishContentPreKeysRequest,
			) {
				if err := fixture.db.Model(
					&actoridentitypersistence.ActorDeviceModel{},
				).Where(
					"ptid = ? AND device_id = ?",
					contentPreKeyTestActor,
					contentPreKeyTestDevice,
				).Update("public_key", []byte{0x01}).Error; err != nil {
					t.Fatalf("corrupt publisher proof: %v", err)
				}
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newContentPreKeyOperationalFixture(t)
			request := signedContentPreKeyClientRequest(
				t,
				fixture,
				contentEndpointPreKey("possession-"+testCase.name, 7),
			)
			testCase.prepare(t, fixture, request)

			_, err := fixture.capability.(*subServer).composition.
				contentPreKeyService.PublishContentPreKeysClient(
				context.Background(),
				domain.Endpoint{
					ActorPTID: contentPreKeyTestActor,
					DeviceID:  contentPreKeyTestDevice,
				},
				contentPreKeyTestStation,
				contentPreKeyTestSession,
				request,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeUnauthorized)
			assertContentPreKeyClientRowCounts(t, fixture, 0, 0)
		})
	}
}

func TestContentPreKeyClientPublicationAllExistingRollsBackReceipt(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	prekey := contentEndpointPreKey("all-existing", 7)
	request := signedContentPreKeyClientRequest(t, fixture, prekey)
	if _, err := fixture.capability.PublishContentPreKeys(
		context.Background(),
		contentPreKeyEndpointRef(),
		request,
	); err != nil {
		t.Fatalf("seed internal publication: %v", err)
	}
	service := fixture.capability.(*subServer).composition.contentPreKeyService

	_, err := service.PublishContentPreKeysClient(
		context.Background(),
		domain.Endpoint{
			ActorPTID: contentPreKeyTestActor,
			DeviceID:  contentPreKeyTestDevice,
		},
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeConflict)
	assertContentPreKeyClientRowCounts(t, fixture, 1, 0)
}

func TestContentPreKeyClientInventoryRequiresPossessionProof(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	fixture.publish(
		t,
		context.Background(),
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("inventory-proof", 7),
	)
	request := signedContentPreKeyInventoryRequest(t, fixture)
	service := fixture.capability.(*subServer).composition.contentPreKeyService
	response, err := service.ContentPreKeyInventoryClient(
		context.Background(),
		domain.Endpoint{
			ActorPTID: contentPreKeyTestActor,
			DeviceID:  contentPreKeyTestDevice,
		},
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	if err != nil {
		t.Fatalf("authorized inventory: %v", err)
	}
	if response.GetInventory().GetAvailable() != 1 {
		t.Fatalf(
			"inventory available = %d, want 1",
			response.GetInventory().GetAvailable(),
		)
	}
	_, err = service.ContentPreKeyInventoryClient(
		context.Background(),
		domain.Endpoint{
			ActorPTID: contentPreKeyTestActor,
			DeviceID:  contentPreKeyTestDevice,
		},
		contentPreKeyTestStation,
		"other-session",
		request,
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeUnauthorized)
}

func signedContentPreKeyClientRequest(
	t *testing.T,
	fixture *contentPreKeyOperationalFixture,
	prekeys ...*securecontentpb.ContentOneTimePreKey,
) *securecontentpb.PublishContentPreKeysRequest {
	t.Helper()
	request := signedContentPreKeyRequest(
		t,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		prekeys...,
	)
	commandID, err := domain.ContentPreKeyPublicationCommandID(request)
	if err != nil {
		t.Fatalf("derive Content PreKey command ID: %v", err)
	}
	request.CommandId = commandID
	authorizeContentPreKeyClientRequest(
		t,
		request,
		contentPreKeyTestSigningKey,
		7,
		fixture.privateKey,
		fixture.clock.Now(),
	)
	return request
}

func authorizeContentPreKeyClientRequest(
	t *testing.T,
	request *securecontentpb.PublishContentPreKeysRequest,
	signingKeyID string,
	profileVersion uint64,
	privateKey ed25519.PrivateKey,
	issuedAt time.Time,
) {
	t.Helper()
	proofFree := proto.Clone(request).(*securecontentpb.PublishContentPreKeysRequest)
	proofFree.Proof = nil
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(proofFree)
	if err != nil {
		t.Fatalf("marshal proof-free publication: %v", err)
	}
	requestHash := sha256.Sum256(requestBytes)
	input := &securecontentpb.ContentPreKeyClientSigningInput{
		FormatVersion:           domain.ContentPreKeyClientFormatVersion,
		CapabilityId:            domain.ContentPreKeyPublishCapability,
		StationPeerId:           contentPreKeyTestStation,
		SessionId:               contentPreKeyTestSession,
		Publisher:               proto.Clone(contentPreKeyEndpointRef()).(*actormodel.ActorDeviceRef),
		PublisherSigningKeyId:   signingKeyID,
		PublisherProfileVersion: profileVersion,
		RequestId:               request.GetCommandId(),
		RequestSha256:           requestHash[:],
		Nonce:                   make([]byte, domain.ContentPreKeyClientNonceBytes),
		IssuedAt:                timestamppb.New(issuedAt),
	}
	signingBytes, err := domain.ContentPreKeyClientSigningBytes(input)
	if err != nil {
		t.Fatalf("build possession proof signing bytes: %v", err)
	}
	request.Proof = &securecontentpb.ContentPreKeyClientProof{
		Input:     input,
		Signature: ed25519.Sign(privateKey, signingBytes),
	}
}

func signedContentPreKeyInventoryRequest(
	t *testing.T,
	fixture *contentPreKeyOperationalFixture,
) *securecontentpb.GetContentPreKeyInventoryRequest {
	t.Helper()
	request := &securecontentpb.GetContentPreKeyInventoryRequest{
		Publisher: proto.Clone(
			contentPreKeyEndpointRef(),
		).(*actormodel.ActorDeviceRef),
		Target:    contentPreKeyEndpointTarget(),
		RequestId: "inventory-request-1",
	}
	proofFree := proto.Clone(request).(*securecontentpb.GetContentPreKeyInventoryRequest)
	proofFree.Proof = nil
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(proofFree)
	if err != nil {
		t.Fatalf("marshal proof-free inventory: %v", err)
	}
	requestHash := sha256.Sum256(requestBytes)
	input := &securecontentpb.ContentPreKeyClientSigningInput{
		FormatVersion:           domain.ContentPreKeyClientFormatVersion,
		CapabilityId:            domain.ContentPreKeyInventoryCapability,
		StationPeerId:           contentPreKeyTestStation,
		SessionId:               contentPreKeyTestSession,
		Publisher:               proto.Clone(contentPreKeyEndpointRef()).(*actormodel.ActorDeviceRef),
		PublisherSigningKeyId:   contentPreKeyTestSigningKey,
		PublisherProfileVersion: 7,
		RequestId:               request.GetRequestId(),
		RequestSha256:           requestHash[:],
		Nonce:                   make([]byte, domain.ContentPreKeyClientNonceBytes),
		IssuedAt:                timestamppb.New(fixture.clock.Now()),
	}
	signingBytes, err := domain.ContentPreKeyClientSigningBytes(input)
	if err != nil {
		t.Fatalf("build inventory proof signing bytes: %v", err)
	}
	request.Proof = &securecontentpb.ContentPreKeyClientProof{
		Input:     input,
		Signature: ed25519.Sign(fixture.privateKey, signingBytes),
	}
	return request
}

func assertContentPreKeyClientRowCounts(
	t *testing.T,
	fixture *contentPreKeyOperationalFixture,
	wantKeys int64,
	wantReceipts int64,
) {
	t.Helper()
	var keys int64
	if err := fixture.db.Model(&infrastructure.ContentPreKeyModel{}).
		Count(&keys).Error; err != nil {
		t.Fatalf("count Content PreKeys: %v", err)
	}
	var receipts int64
	if err := fixture.db.Model(
		&infrastructure.ContentPreKeyPublicationReceiptModel{},
	).Count(&receipts).Error; err != nil {
		t.Fatalf("count publication receipts: %v", err)
	}
	if keys != wantKeys || receipts != wantReceipts {
		t.Fatalf(
			"key/receipt counts = %d/%d, want %d/%d",
			keys,
			receipts,
			wantKeys,
			wantReceipts,
		)
	}
}
