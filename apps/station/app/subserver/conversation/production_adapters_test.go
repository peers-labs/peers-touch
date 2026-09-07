package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	attachmentapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	deliveryapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	attachmentinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	keyexchangedomain "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	keyexchangeinfra "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
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
	expiresAt       time.Time
}

type productionAdapterTestKeyExchange struct {
	calls []productionAdapterKeyExchangeCall
}

func (s *productionAdapterTestKeyExchange) ReserveMLSKeyPackage(
	_ context.Context,
	requestID string,
	authorityPlanID string,
	target keyexchangedomain.Endpoint,
	expiresAt time.Time,
) (keyexchangedomain.MLSKeyPackageReservation, error) {
	s.calls = append(s.calls, productionAdapterKeyExchangeCall{
		requestID:       requestID,
		authorityPlanID: authorityPlanID,
		target:          target,
		expiresAt:       expiresAt,
	})
	keyPackage := []byte("remote-canonical-mls-key-package")

	return keyexchangedomain.MLSKeyPackageReservation{
		PlanID:               authorityPlanID,
		Target:               target,
		PackageID:            "remote-package",
		KeyPackage:           keyPackage,
		PackageHash:          keyexchangedomain.HashMLSKeyPackage(keyPackage),
		HomeStation:          "station-b",
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
			[]valueobject.Endpoint{fixture.bob},
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
				[]valueobject.Endpoint{fixture.bob},
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
	if err := fixture.db.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ?",
			string(fixture.bob.Actor),
			string(fixture.bob.Device),
		).
		Update("home_station_peer_id", "station-b").Error; err != nil {
		t.Fatal(err)
	}
	adapters, err := fixture.factory.Bind(fixture.db)
	if err != nil {
		t.Fatal(err)
	}
	expiresAt := productionAdapterTestTime.Add(time.Minute)
	reservations, err := adapters.KeyPackageReservations.Reserve(
		context.Background(),
		"remote-plan",
		[]valueobject.Endpoint{fixture.bob},
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
