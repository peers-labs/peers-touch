package key_exchange

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	contentPreKeyTestStation    = "station-local"
	contentPreKeyTestActor      = "ptid:alice"
	contentPreKeyTestDevice     = "alice-device"
	contentPreKeyTestSigningKey = "alice-signing-key"
)

type contentPreKeyOperationalFixture struct {
	db         *gorm.DB
	capability ContentPreKeyCapabilities
	clock      *contentPreKeyClock
	privateKey ed25519.PrivateKey
	resolver   *contentPreKeyTestResolver
}

type contentPreKeyClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *contentPreKeyClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

type contentPreKeyTestResolver struct {
	mu          sync.Mutex
	beforeFence func(*gorm.DB)
}

func (r *contentPreKeyTestResolver) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	repository, err := actoridentitypersistence.NewRepository(transaction.DB())
	if err != nil {
		return nil, err
	}
	key, found, err := repository.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		actorPTID,
		deviceID,
	)
	if err != nil || !found {
		return key, err
	}
	if key.GetSigningKeyId() != signingKeyID {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeDeviceConflict,
			"test.resolve_verified_actor_device_signing_key",
			"signing_key_id",
			"does not match",
		)
	}
	r.mu.Lock()
	hook := r.beforeFence
	r.beforeFence = nil
	r.mu.Unlock()
	if hook != nil {
		hook(transaction.DB())
	}
	return key, nil
}

func (r *contentPreKeyTestResolver) ResolveRetainedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	repository, err := actoridentitypersistence.NewRepository(transaction.DB())
	if err != nil {
		return nil, err
	}
	key, found, err := repository.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		actorPTID,
		deviceID,
	)
	if err != nil || !found {
		return key, err
	}
	if key.GetSigningKeyId() != signingKeyID {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeDeviceConflict,
			"test.resolve_retained_actor_device_signing_key",
			"signing_key_id",
			"does not match",
		)
	}
	return key, nil
}

func TestContentPreKeyOperationalLifecycle(t *testing.T) {
	t.Run("valid signed endpoint and recovery publication", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		publisher := contentPreKeyEndpointRef()

		endpoint := contentEndpointPreKey("endpoint-001", 7)
		inventory := fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			endpoint,
		)
		assertContentPreKeyInventory(t, inventory, 7, 1)

		recovery := contentRecoveryPreKey("recovery-001", 1)
		inventory = fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			recovery,
		)
		assertContentPreKeyInventory(t, inventory, 1, 1)
		assertDirectAndMLSInventoryUntouched(t, fixture.db)
	})

	t.Run("signature wrong key key-id and profile", func(t *testing.T) {
		t.Run("wrong key", func(t *testing.T) {
			fixture := newContentPreKeyOperationalFixture(t)
			wrongKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x77}, 32))
			request := signedContentPreKeyRequest(
				t,
				contentPreKeyEndpointRef(),
				contentPreKeyTestSigningKey,
				7,
				0,
				wrongKey,
				contentEndpointPreKey("wrong-signer", 7),
			)
			_, err := fixture.capability.PublishContentPreKeys(
				context.Background(),
				contentPreKeyEndpointRef(),
				request,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeInvalidMaterial)
			assertContentPreKeyTableCounts(t, fixture.db, 0, 0)
		})

		t.Run("wrong key id", func(t *testing.T) {
			fixture := newContentPreKeyOperationalFixture(t)
			request := signedContentPreKeyRequest(
				t,
				contentPreKeyEndpointRef(),
				"wrong-signing-key",
				7,
				0,
				fixture.privateKey,
				contentEndpointPreKey("wrong-key-id", 7),
			)
			_, err := fixture.capability.PublishContentPreKeys(
				context.Background(),
				contentPreKeyEndpointRef(),
				request,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeInvalidMaterial)
			assertContentPreKeyTableCounts(t, fixture.db, 0, 0)
		})

		t.Run("wrong profile", func(t *testing.T) {
			fixture := newContentPreKeyOperationalFixture(t)
			request := signedContentPreKeyRequest(
				t,
				contentPreKeyEndpointRef(),
				contentPreKeyTestSigningKey,
				6,
				0,
				fixture.privateKey,
				contentEndpointPreKey("wrong-profile", 6),
			)
			_, err := fixture.capability.PublishContentPreKeys(
				context.Background(),
				contentPreKeyEndpointRef(),
				request,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeStaleMaterial)
			assertContentPreKeyTableCounts(t, fixture.db, 0, 0)
		})
	})

	t.Run("recursive unknown fields", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		request := signedContentPreKeyRequest(
			t,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("nested-unknown", 7),
		)
		request.GetPrekeys()[0].GetEndpoint().GetActor().
			ProtoReflect().SetUnknown([]byte{0x98, 0x06, 0x01})
		_, err := fixture.capability.PublishContentPreKeys(
			context.Background(),
			contentPreKeyEndpointRef(),
			request,
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeInvalidArgument)
		assertContentPreKeyTableCounts(t, fixture.db, 0, 0)
	})

	t.Run("noncanonical actor metadata", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		request := signedContentPreKeyRequest(
			t,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("actor-metadata", 7),
		)
		request.GetPublisher().GetActor().Acct = "alice@example.test"
		_, err := fixture.capability.PublishContentPreKeys(
			context.Background(),
			contentPreKeyEndpointRef(),
			request,
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeInvalidArgument)
		assertContentPreKeyTableCounts(t, fixture.db, 0, 0)
	})

	t.Run("recovery CAS replenish rotate stale and jump", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		publisher := contentPreKeyEndpointRef()

		fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentRecoveryPreKey("recovery-1", 1),
		)
		inventory := fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			1,
			fixture.privateKey,
			contentRecoveryPreKey("recovery-1b", 1),
		)
		assertContentPreKeyInventory(t, inventory, 1, 2)
		inventory = fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			1,
			fixture.privateKey,
			contentRecoveryPreKey("recovery-2", 2),
		)
		assertContentPreKeyInventory(t, inventory, 2, 1)

		for name, epochs := range map[string][2]uint64{
			"stale": {1, 2},
			"jump":  {2, 4},
		} {
			t.Run(name, func(t *testing.T) {
				request := signedContentPreKeyRequest(
					t,
					publisher,
					contentPreKeyTestSigningKey,
					7,
					epochs[0],
					fixture.privateKey,
					contentRecoveryPreKey("recovery-"+name, epochs[1]),
				)
				_, err := fixture.capability.PublishContentPreKeys(
					ctx,
					publisher,
					request,
				)
				assertContentPreKeyError(t, err, domain.ErrorCodeStaleMaterial)
			})
		}
		assertContentPreKeyInventoryForTarget(
			t,
			fixture,
			contentPreKeyRecoveryTarget(),
			2,
			1,
		)
	})

	t.Run("endpoint epoch follows Actor Identity", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		publisher := contentPreKeyEndpointRef()
		fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("endpoint-7", 7),
		)
		updateContentPreKeyPublisher(t, fixture.db, map[string]any{
			"profile_version": 8,
		})
		assertContentPreKeyInventoryForTarget(
			t,
			fixture,
			contentPreKeyEndpointTarget(),
			7,
			0,
		)

		stale := signedContentPreKeyRequest(
			t,
			publisher,
			contentPreKeyTestSigningKey,
			8,
			7,
			fixture.privateKey,
			contentEndpointPreKey("endpoint-stale", 8),
		)
		stale.GetPrekeys()[0].ProfileOrRecoveryEpoch = 7
		_, err := fixture.capability.PublishContentPreKeys(ctx, publisher, stale)
		assertContentPreKeyError(t, err, domain.ErrorCodeStaleMaterial)

		inventory := fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			8,
			7,
			fixture.privateKey,
			contentEndpointPreKey("endpoint-8", 8),
		)
		assertContentPreKeyInventory(t, inventory, 8, 1)
		assertContentPreKeyTombstone(t, fixture.db, "endpoint-7", false, true)
	})

	t.Run("failed signed batch is atomic", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		request := signedContentPreKeyRequest(
			t,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("batch-valid", 7),
			contentEndpointPreKey("batch-invalid", 7),
		)
		request.Prekeys[1].IssuerSignature[0] ^= 0xff
		_, err := fixture.capability.PublishContentPreKeys(
			context.Background(),
			contentPreKeyEndpointRef(),
			request,
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeInvalidMaterial)
		assertContentPreKeyTableCounts(t, fixture.db, 0, 0)
	})

	t.Run("row fence rejects resolve-to-commit rotation", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		fixture.resolver.beforeFence = func(tx *gorm.DB) {
			if err := tx.Model(&actoridentitypersistence.ActorDeviceModel{}).
				Where(
					"ptid = ? AND device_id = ?",
					contentPreKeyTestActor,
					contentPreKeyTestDevice,
				).
				Update("profile_version", 8).Error; err != nil {
				t.Fatalf("rotate publisher inside fence test: %v", err)
			}
		}
		request := signedContentPreKeyRequest(
			t,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("fenced", 7),
		)
		_, err := fixture.capability.PublishContentPreKeys(
			context.Background(),
			contentPreKeyEndpointRef(),
			request,
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeStaleMaterial)
		assertContentPreKeyTableCounts(t, fixture.db, 0, 0)
	})

	t.Run("claim rejects revoked and rotated publishers", func(t *testing.T) {
		for _, testCase := range []struct {
			name   string
			update map[string]any
			code   domain.ErrorCode
		}{
			{
				name: "revoked",
				update: map[string]any{
					"revoked":    true,
					"revoked_at": time.Unix(1_800_000_100, 0).UTC(),
				},
				code: domain.ErrorCodeUnauthorized,
			},
			{
				name: "rotated",
				update: map[string]any{
					"profile_version": 8,
				},
				code: domain.ErrorCodeStaleMaterial,
			},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				fixture := newContentPreKeyOperationalFixture(t)
				fixture.publish(
					t,
					context.Background(),
					contentPreKeyEndpointRef(),
					contentPreKeyTestSigningKey,
					7,
					0,
					fixture.privateKey,
					contentEndpointPreKey("claim-"+testCase.name, 7),
				)
				updateContentPreKeyPublisher(t, fixture.db, testCase.update)
				_, err := fixture.capability.ClaimContentPreKeys(
					context.Background(),
					contentPreKeyClaimRequest(
						"claim-"+testCase.name,
						contentPreKeyEndpointTarget(),
					),
				)
				assertContentPreKeyError(t, err, testCase.code)
				assertContentPreKeyTombstone(
					t,
					fixture.db,
					"claim-"+testCase.name,
					false,
					true,
				)
				assertContentPreKeyReceiptCount(t, fixture.db, 0)
			})
		}
	})

	t.Run("claim rejects persisted tamper", func(t *testing.T) {
		for _, testCase := range []struct {
			name    string
			updates map[string]any
		}{
			{
				name: "public-key",
				updates: map[string]any{
					"public_key": bytes.Repeat([]byte{0x5a}, 32),
				},
			},
			{
				name: "signature",
				updates: map[string]any{
					"issuer_signature": bytes.Repeat([]byte{0x6b}, 64),
				},
			},
			{
				name: "signing-key-id",
				updates: map[string]any{
					"publisher_signing_key_id": "tampered-signing-key",
				},
			},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				fixture := newContentPreKeyOperationalFixture(t)
				keyID := "tamper-" + testCase.name
				fixture.publish(
					t,
					context.Background(),
					contentPreKeyEndpointRef(),
					contentPreKeyTestSigningKey,
					7,
					0,
					fixture.privateKey,
					contentEndpointPreKey(keyID, 7),
				)
				if err := fixture.db.Model(&infrastructure.ContentPreKeyModel{}).
					Where("key_id = ?", keyID).
					Updates(testCase.updates).Error; err != nil {
					t.Fatal(err)
				}
				_, err := fixture.capability.ClaimContentPreKeys(
					context.Background(),
					contentPreKeyClaimRequest(
						"tamper-"+testCase.name,
						contentPreKeyEndpointTarget(),
					),
				)
				assertContentPreKeyError(t, err, domain.ErrorCodeInvalidMaterial)
				assertContentPreKeyTombstone(t, fixture.db, keyID, false, false)
				assertContentPreKeyReceiptCount(t, fixture.db, 0)
			})
		}
	})

	t.Run("depletion replenishment and no revival", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		publisher := contentPreKeyEndpointRef()
		firstRequest := signedContentPreKeyRequest(
			t,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("depletion-1", 7),
		)
		if _, err := fixture.capability.PublishContentPreKeys(
			ctx,
			publisher,
			firstRequest,
		); err != nil {
			t.Fatal(err)
		}
		firstClaim, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"depletion-plan-1",
				contentPreKeyEndpointTarget(),
			),
		)
		if err != nil {
			t.Fatal(err)
		}
		if firstClaim.GetExactReplay() {
			t.Fatal("initial claim reported replay")
		}

		response, err := fixture.capability.PublishContentPreKeys(
			ctx,
			publisher,
			proto.Clone(firstRequest).(*securecontentpb.PublishContentPreKeysRequest),
		)
		if err != nil {
			t.Fatalf("exact publication replay: %v", err)
		}
		assertContentPreKeyInventory(t, response.GetInventory(), 7, 0)
		assertContentPreKeyTombstone(t, fixture.db, "depletion-1", true, false)

		_, err = fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"depletion-plan-2",
				contentPreKeyEndpointTarget(),
			),
		)
		assertContentPreKeyError(t, err, domain.ErrorCodePoolDepleted)

		inventory := fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			7,
			fixture.privateKey,
			contentEndpointPreKey("depletion-2", 7),
		)
		assertContentPreKeyInventory(t, inventory, 7, 1)
		if _, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"depletion-plan-3",
				contentPreKeyEndpointTarget(),
			),
		); err != nil {
			t.Fatalf("claim replenished key: %v", err)
		}
	})

	t.Run("rotation leaves immutable tombstones", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		publisher := contentPreKeyEndpointRef()
		epochOne := signedContentPreKeyRequest(
			t,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentRecoveryPreKey("recovery-tombstone-1", 1),
		)
		if _, err := fixture.capability.PublishContentPreKeys(
			ctx,
			publisher,
			epochOne,
		); err != nil {
			t.Fatal(err)
		}
		fixture.publish(
			t,
			ctx,
			publisher,
			contentPreKeyTestSigningKey,
			7,
			1,
			fixture.privateKey,
			contentRecoveryPreKey("recovery-tombstone-2", 2),
		)
		assertContentPreKeyTombstone(
			t,
			fixture.db,
			"recovery-tombstone-1",
			false,
			true,
		)
		response, err := fixture.capability.PublishContentPreKeys(
			ctx,
			publisher,
			proto.Clone(epochOne).(*securecontentpb.PublishContentPreKeysRequest),
		)
		if err != nil {
			t.Fatalf("replay retired publication: %v", err)
		}
		assertContentPreKeyInventory(t, response.GetInventory(), 2, 1)
		assertContentPreKeyTombstone(
			t,
			fixture.db,
			"recovery-tombstone-1",
			false,
			true,
		)
	})

	t.Run("completed receipt replays after publisher revoke", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("replay-after-revoke", 7),
			contentEndpointPreKey("replay-after-revoke-unclaimed", 7),
		)
		request := contentPreKeyClaimRequest(
			"replay-after-revoke-plan",
			contentPreKeyEndpointTarget(),
		)
		claimed, err := fixture.capability.ClaimContentPreKeys(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		conflicting := proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest)
		conflicting.PlanRequestSha256 = bytes.Repeat([]byte{0x7f}, sha256.Size)
		_, err = fixture.capability.ClaimContentPreKeys(ctx, conflicting)
		assertContentPreKeyError(t, err, domain.ErrorCodeConflict)

		updateContentPreKeyPublisher(t, fixture.db, map[string]any{
			"revoked":    true,
			"revoked_at": time.Unix(1_800_000_200, 0).UTC(),
		})
		replayed, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
		)
		if err != nil {
			t.Fatalf("completed receipt replay after revoke: %v", err)
		}
		if !replayed.GetExactReplay() {
			t.Fatal("completed receipt did not report exact replay")
		}
		assertSameContentPreKeyClaims(t, claimed, replayed)

		_, err = fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"new-plan-after-revoke",
				contentPreKeyEndpointTarget(),
			),
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeUnauthorized)
	})

	t.Run("completed receipt replays after publisher profile advance", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("replay-after-profile-advance", 7),
		)
		request := contentPreKeyClaimRequest(
			"replay-after-profile-advance-plan",
			contentPreKeyEndpointTarget(),
		)
		claimed, err := fixture.capability.ClaimContentPreKeys(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		updateContentPreKeyPublisher(t, fixture.db, map[string]any{
			"profile_version": 8,
		})
		replayed, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
		)
		if err != nil {
			t.Fatalf("completed receipt replay after profile advance: %v", err)
		}
		if !replayed.GetExactReplay() {
			t.Fatal("completed receipt did not report exact replay")
		}
		assertSameContentPreKeyClaims(t, claimed, replayed)
	})

	t.Run("historical replay rejects publisher and signature drift", func(t *testing.T) {
		tests := []struct {
			name             string
			publisherUpdates map[string]any
			prekeyUpdates    map[string]any
		}{
			{
				name: "publisher key",
				publisherUpdates: map[string]any{
					"profile_version": 8,
					"public_key":      bytes.Repeat([]byte{0x5a}, ed25519.PublicKeySize),
				},
			},
			{
				name: "verification source",
				publisherUpdates: map[string]any{
					"profile_version": 8,
					"verification_source": int32(
						actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
					),
				},
			},
			{
				name: "issuer signature",
				publisherUpdates: map[string]any{
					"profile_version": 8,
				},
				prekeyUpdates: map[string]any{
					"issuer_signature": bytes.Repeat(
						[]byte{0x5a},
						ed25519.SignatureSize,
					),
				},
			},
		}
		for _, testCase := range tests {
			t.Run(testCase.name, func(t *testing.T) {
				fixture := newContentPreKeyOperationalFixture(t)
				ctx := context.Background()
				keyID := "historical-replay-" + testCase.name
				fixture.publish(
					t,
					ctx,
					contentPreKeyEndpointRef(),
					contentPreKeyTestSigningKey,
					7,
					0,
					fixture.privateKey,
					contentEndpointPreKey(keyID, 7),
				)
				request := contentPreKeyClaimRequest(
					keyID+"-plan",
					contentPreKeyEndpointTarget(),
				)
				if _, err := fixture.capability.ClaimContentPreKeys(
					ctx,
					request,
				); err != nil {
					t.Fatal(err)
				}
				updateContentPreKeyPublisher(
					t,
					fixture.db,
					testCase.publisherUpdates,
				)
				if len(testCase.prekeyUpdates) > 0 {
					if err := fixture.db.Model(
						&infrastructure.ContentPreKeyModel{},
					).Where(
						"key_id = ?",
						keyID,
					).Updates(testCase.prekeyUpdates).Error; err != nil {
						t.Fatal(err)
					}
				}
				_, err := fixture.capability.ClaimContentPreKeys(
					ctx,
					proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
				)
				assertContentPreKeyError(
					t,
					err,
					domain.ErrorCodeInvalidMaterial,
				)
			})
		}
	})

	t.Run("cleared consumed timestamp cannot revive a claimed key", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("cleared-consumed-at", 7),
		)
		if _, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"cleared-consumed-at-original",
				contentPreKeyEndpointTarget(),
			),
		); err != nil {
			t.Fatal(err)
		}
		if err := fixture.db.Model(
			&infrastructure.ContentPreKeyModel{},
		).Where(
			"key_id = ?",
			"cleared-consumed-at",
		).Update("consumed_at", nil).Error; err != nil {
			t.Fatal(err)
		}

		_, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"cleared-consumed-at-second",
				contentPreKeyEndpointTarget(),
			),
		)
		assertContentPreKeyError(t, err, domain.ErrorCodePoolDepleted)
	})

	t.Run("multi target failure rolls back every claim", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("multi-target-endpoint", 7),
		)

		_, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"multi-target-missing-recovery",
				contentPreKeyEndpointTarget(),
				contentPreKeyRecoveryTarget(),
			),
		)
		assertContentPreKeyError(t, err, domain.ErrorCodePoolDepleted)
		assertContentPreKeyTombstone(
			t,
			fixture.db,
			"multi-target-endpoint",
			false,
			false,
		)
		assertContentPreKeyReceiptCount(t, fixture.db, 0)

		if _, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"multi-target-endpoint-only",
				contentPreKeyEndpointTarget(),
			),
		); err != nil {
			t.Fatalf("claim rolled-back endpoint key: %v", err)
		}
	})

	t.Run("mixed recovery publishers skip revoked keys", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		secondPublisher, secondPrivateKey := addContentPreKeyPublisher(
			t,
			fixture.db,
			"alice-device-2",
			"alice-signing-key-2",
			0x42,
		)
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentRecoveryPreKey("a-revoked-recovery", 1),
		)
		fixture.publish(
			t,
			ctx,
			secondPublisher,
			"alice-signing-key-2",
			7,
			1,
			secondPrivateKey,
			contentRecoveryPreKey("b-active-recovery", 1),
		)
		updateContentPreKeyPublisherByDevice(
			t,
			fixture.db,
			contentPreKeyTestDevice,
			map[string]any{
				"revoked":    true,
				"revoked_at": time.Unix(1_800_000_300, 0).UTC(),
			},
		)

		inventoryResponse, err :=
			fixture.capability.GetContentPreKeyInventory(
				ctx,
				secondPublisher,
				&securecontentpb.GetContentPreKeyInventoryRequest{
					Publisher: proto.Clone(secondPublisher).(*actormodel.ActorDeviceRef),
					Target:    contentPreKeyRecoveryTarget(),
				},
			)
		if err != nil {
			t.Fatalf("read mixed recovery inventory: %v", err)
		}
		assertContentPreKeyInventory(
			t,
			inventoryResponse.GetInventory(),
			1,
			1,
		)
		assertContentPreKeyTombstone(
			t,
			fixture.db,
			"a-revoked-recovery",
			false,
			true,
		)

		response, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			contentPreKeyClaimRequest(
				"mixed-recovery-publishers",
				contentPreKeyRecoveryTarget(),
			),
		)
		if err != nil {
			t.Fatalf("claim active recovery publisher: %v", err)
		}
		if got := response.GetClaims()[0].GetPrekey().GetKeyId(); got !=
			"b-active-recovery" {
			t.Fatalf("claimed key = %q, want active publisher key", got)
		}
		assertContentPreKeyTombstone(
			t,
			fixture.db,
			"a-revoked-recovery",
			false,
			true,
		)
	})

	t.Run("revoked recovery capacity does not block replenishment", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		secondPublisher, secondPrivateKey := addContentPreKeyPublisher(
			t,
			fixture.db,
			"alice-device-2",
			"alice-signing-key-2",
			0x42,
		)
		staleKeys := make(
			[]*securecontentpb.ContentOneTimePreKey,
			0,
			domain.MaxContentPreKeysPerPool,
		)
		for index := 0; index < domain.MaxContentPreKeysPerPool; index++ {
			staleKeys = append(
				staleKeys,
				contentRecoveryPreKey(
					"stale-capacity-"+strconv.Itoa(index),
					1,
				),
			)
		}
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			staleKeys...,
		)
		updateContentPreKeyPublisherByDevice(
			t,
			fixture.db,
			contentPreKeyTestDevice,
			map[string]any{
				"revoked":    true,
				"revoked_at": time.Unix(1_800_000_300, 0).UTC(),
			},
		)

		inventory := fixture.publish(
			t,
			ctx,
			secondPublisher,
			"alice-signing-key-2",
			7,
			1,
			secondPrivateKey,
			contentRecoveryPreKey("active-after-revoke", 1),
		)
		assertContentPreKeyInventory(t, inventory, 1, 1)
		assertContentPreKeyTombstone(
			t,
			fixture.db,
			"stale-capacity-0",
			false,
			true,
		)
		assertContentPreKeyTombstone(
			t,
			fixture.db,
			"stale-capacity-99",
			false,
			true,
		)
	})

	t.Run("coherent receipt and row tamper fails replay", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("receipt-tamper", 7),
		)
		request := contentPreKeyClaimRequest(
			"receipt-tamper-plan",
			contentPreKeyEndpointTarget(),
		)
		claimed, err := fixture.capability.ClaimContentPreKeys(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		tamperedKey := bytes.Repeat([]byte{0x5a}, 32)
		tamperedKeySHA256 := sha256.Sum256(tamperedKey)
		claimed.GetClaims()[0].GetPrekey().X25519PublicKey = tamperedKey
		responseBytes, err := proto.MarshalOptions{Deterministic: true}.
			Marshal(claimed)
		if err != nil {
			t.Fatal(err)
		}
		responseSHA256 := sha256.Sum256(responseBytes)
		if err := fixture.db.Model(
			&infrastructure.ContentPreKeyClaimReceiptModel{},
		).Where(
			"plan_id = ?",
			request.GetPlanId(),
		).Updates(map[string]any{
			"response_bytes":  responseBytes,
			"response_sha256": responseSHA256[:],
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := fixture.db.Model(&infrastructure.ContentPreKeyModel{}).
			Where("claim_plan_id = ?", request.GetPlanId()).
			Updates(map[string]any{
				"public_key":        tamperedKey,
				"public_key_sha256": tamperedKeySHA256[:],
			}).Error; err != nil {
			t.Fatal(err)
		}

		_, err = fixture.capability.ClaimContentPreKeys(
			ctx,
			proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeInvalidMaterial)
	})
}

func newContentPreKeyOperationalFixture(
	t *testing.T,
) *contentPreKeyOperationalFixture {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "key-exchange-content-prekey.db")
	db, err := gorm.Open(
		sqlite.Open(
			"file:"+databasePath+
				"?_busy_timeout=10000&_journal_mode=WAL",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open Content PreKey database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open Content PreKey SQL database: %v", err)
	}
	sqlDB.SetMaxOpenConns(8)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
	return newContentPreKeyOperationalFixtureWithDatabase(t, db)
}

func newContentPreKeyOperationalFixtureWithDatabase(
	t *testing.T,
	db *gorm.DB,
) *contentPreKeyOperationalFixture {
	t.Helper()
	if err := db.AutoMigrate(
		&actoridentitypersistence.ActorDeviceModel{},
		&infrastructure.OneTimePreKeyModel{},
		&infrastructure.MLSKeyPackageModel{},
	); err != nil {
		t.Fatalf("migrate actor device authorization: %v", err)
	}
	_, privateKey := addContentPreKeyPublisher(
		t,
		db,
		contentPreKeyTestDevice,
		contentPreKeyTestSigningKey,
		0x01,
	)

	resolver := &contentPreKeyTestResolver{}
	contentStore, err := infrastructure.NewContentPreKeyStore(db, resolver)
	if err != nil {
		t.Fatalf("create Content PreKey store: %v", err)
	}
	if err := contentStore.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate Content PreKey store: %v", err)
	}
	clock := &contentPreKeyClock{
		now: time.Unix(1_800_000_000, 123_456_000).UTC(),
	}
	service, err := application.NewContentPreKeyService(contentStore, clock)
	if err != nil {
		t.Fatalf("create Content PreKey service: %v", err)
	}
	composition := &canonicalComposition{
		contentPreKeyStore:   contentStore,
		contentPreKeyService: service,
	}
	return &contentPreKeyOperationalFixture{
		db:         db,
		capability: &subServer{composition: composition},
		clock:      clock,
		privateKey: privateKey,
		resolver:   resolver,
	}
}

func addContentPreKeyPublisher(
	t *testing.T,
	db *gorm.DB,
	deviceID string,
	signingKeyID string,
	seedStart byte,
) (*actormodel.ActorDeviceRef, ed25519.PrivateKey) {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	for index := range seed {
		seed[index] = seedStart + byte(index)
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	if err := db.Create(&actoridentitypersistence.ActorDeviceModel{
		PTID:               contentPreKeyTestActor,
		ActorAccount:       "alice@example.test",
		ActorKind:          1,
		DeviceID:           deviceID,
		Label:              "Alice Device",
		HomeStationPeerID:  contentPreKeyTestStation,
		SigningKeyID:       signingKeyID,
		PublicKey:          append([]byte(nil), privateKey.Public().(ed25519.PublicKey)...),
		ProfileVersion:     7,
		VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
		CreatedAt:          time.Unix(1_800_000_000, 0).UTC(),
	}).Error; err != nil {
		t.Fatalf("seed Content PreKey publisher: %v", err)
	}
	return &actormodel.ActorDeviceRef{
		Actor:    &actormodel.ActorRef{Ptid: contentPreKeyTestActor},
		DeviceId: deviceID,
	}, privateKey
}

func (f *contentPreKeyOperationalFixture) publish(
	t *testing.T,
	ctx context.Context,
	publisher *actormodel.ActorDeviceRef,
	signingKeyID string,
	profileVersion uint64,
	expectedPoolEpoch uint64,
	privateKey ed25519.PrivateKey,
	prekeys ...*securecontentpb.ContentOneTimePreKey,
) *securecontentpb.ContentPreKeyInventory {
	t.Helper()
	request := signedContentPreKeyRequest(
		t,
		publisher,
		signingKeyID,
		profileVersion,
		expectedPoolEpoch,
		privateKey,
		prekeys...,
	)
	response, err := f.capability.PublishContentPreKeys(ctx, publisher, request)
	if err != nil {
		t.Fatalf("publish Content PreKeys: %v", err)
	}
	return response.GetInventory()
}

func signedContentPreKeyRequest(
	t *testing.T,
	publisher *actormodel.ActorDeviceRef,
	signingKeyID string,
	profileVersion uint64,
	expectedPoolEpoch uint64,
	privateKey ed25519.PrivateKey,
	prekeys ...*securecontentpb.ContentOneTimePreKey,
) *securecontentpb.PublishContentPreKeysRequest {
	t.Helper()
	request := &securecontentpb.PublishContentPreKeysRequest{
		Publisher:               proto.Clone(publisher).(*actormodel.ActorDeviceRef),
		PublisherSigningKeyId:   signingKeyID,
		PublisherProfileVersion: profileVersion,
		ExpectedPoolEpoch:       expectedPoolEpoch,
		Prekeys: make(
			[]*securecontentpb.ContentOneTimePreKey,
			0,
			len(prekeys),
		),
	}
	for _, prekey := range prekeys {
		cloned := proto.Clone(prekey).(*securecontentpb.ContentOneTimePreKey)
		cloned.IssuerSignature = bytes.Repeat([]byte{0x01}, ed25519.SignatureSize)
		request.Prekeys = append(request.Prekeys, cloned)
	}
	authenticated := domain.Endpoint{
		ActorPTID: publisher.GetActor().GetPtid(),
		DeviceID:  publisher.GetDeviceId(),
	}
	publication, err := domain.NormalizePublishContentPreKeysRequest(
		"test.sign_content_prekeys",
		authenticated,
		request,
	)
	if err != nil {
		t.Fatalf("normalize publication for signing: %v", err)
	}
	for _, prekey := range request.Prekeys {
		signingBytes, err := securecontentkernel.ContentPreKeySigningBytes(
			publication.SigningInput(prekey),
		)
		if err != nil {
			t.Fatalf("canonicalize Content PreKey signing input: %v", err)
		}
		prekey.IssuerSignature = ed25519.Sign(privateKey, signingBytes)
	}
	return request
}

func contentPreKeyEndpointRef() *actormodel.ActorDeviceRef {
	return &actormodel.ActorDeviceRef{
		Actor:    &actormodel.ActorRef{Ptid: contentPreKeyTestActor},
		DeviceId: contentPreKeyTestDevice,
	}
}

func contentPreKeyEndpointTarget() *securecontentpb.ContentPreKeyClaimTarget {
	return &securecontentpb.ContentPreKeyClaimTarget{
		Kind: securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
		Principal: &securecontentpb.ContentPreKeyClaimTarget_Endpoint{
			Endpoint: contentPreKeyEndpointRef(),
		},
	}
}

func contentPreKeyRecoveryTarget() *securecontentpb.ContentPreKeyClaimTarget {
	return &securecontentpb.ContentPreKeyClaimTarget{
		Kind: securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY,
		Principal: &securecontentpb.ContentPreKeyClaimTarget_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{Ptid: contentPreKeyTestActor},
		},
	}
}

func contentEndpointPreKey(
	keyID string,
	epoch uint64,
) *securecontentpb.ContentOneTimePreKey {
	return &securecontentpb.ContentOneTimePreKey{
		Kind:                   securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
		KeyId:                  keyID,
		X25519PublicKey:        contentPreKeyPublicMaterial("endpoint:" + keyID),
		ProfileOrRecoveryEpoch: epoch,
		Principal: &securecontentpb.ContentOneTimePreKey_Endpoint{
			Endpoint: contentPreKeyEndpointRef(),
		},
	}
}

func contentRecoveryPreKey(
	keyID string,
	epoch uint64,
) *securecontentpb.ContentOneTimePreKey {
	return &securecontentpb.ContentOneTimePreKey{
		Kind:                   securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY,
		KeyId:                  keyID,
		X25519PublicKey:        contentPreKeyPublicMaterial("recovery:" + keyID),
		ProfileOrRecoveryEpoch: epoch,
		Principal: &securecontentpb.ContentOneTimePreKey_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{Ptid: contentPreKeyTestActor},
		},
	}
}

func contentPreKeyPublicMaterial(seed string) []byte {
	value := sha256.Sum256([]byte(seed))
	return append([]byte(nil), value[:]...)
}

func contentPreKeyClaimRequest(
	planID string,
	targets ...*securecontentpb.ContentPreKeyClaimTarget,
) *securecontentpb.ClaimContentPreKeysRequest {
	hash := sha256.Sum256([]byte(planID + ":v1"))
	return &securecontentpb.ClaimContentPreKeysRequest{
		PlanId:            planID,
		PlanRequestSha256: hash[:],
		Targets:           targets,
	}
}

func updateContentPreKeyPublisher(
	t *testing.T,
	db *gorm.DB,
	updates map[string]any,
) {
	updateContentPreKeyPublisherByDevice(
		t,
		db,
		contentPreKeyTestDevice,
		updates,
	)
}

func updateContentPreKeyPublisherByDevice(
	t *testing.T,
	db *gorm.DB,
	deviceID string,
	updates map[string]any,
) {
	t.Helper()
	result := db.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ?",
			contentPreKeyTestActor,
			deviceID,
		).
		Updates(updates)
	if result.Error != nil {
		t.Fatal(result.Error)
	}
	if result.RowsAffected != 1 {
		t.Fatalf("publisher update affected %d rows", result.RowsAffected)
	}
}

func assertContentPreKeyInventoryForTarget(
	t *testing.T,
	fixture *contentPreKeyOperationalFixture,
	target *securecontentpb.ContentPreKeyClaimTarget,
	epoch uint64,
	available int,
) {
	t.Helper()
	response, err := fixture.capability.GetContentPreKeyInventory(
		context.Background(),
		contentPreKeyEndpointRef(),
		&securecontentpb.GetContentPreKeyInventoryRequest{
			Publisher: contentPreKeyEndpointRef(),
			Target:    target,
		},
	)
	if err != nil {
		t.Fatalf("read Content PreKey inventory: %v", err)
	}
	assertContentPreKeyInventory(t, response.GetInventory(), epoch, available)
}

func assertContentPreKeyInventory(
	t *testing.T,
	inventory *securecontentpb.ContentPreKeyInventory,
	epoch uint64,
	available int,
) {
	t.Helper()
	if inventory == nil ||
		inventory.GetCurrentEpoch() != epoch ||
		inventory.GetAvailable() != uint32(available) ||
		inventory.GetCapacity() != uint32(domain.MaxContentPreKeysPerPool) ||
		inventory.GetReplenishAtOrBelow() !=
			uint32(domain.ContentPreKeyReplenishThreshold) ||
		inventory.GetNeedsReplenishment() !=
			(int64(available) <= domain.ContentPreKeyReplenishThreshold) {
		t.Fatalf("unexpected Content PreKey inventory: %+v", inventory)
	}
}

func assertContentPreKeyError(
	t *testing.T,
	err error,
	code domain.ErrorCode,
) {
	t.Helper()
	if !domain.IsCode(err, code) {
		t.Fatalf("error = %v, want %s", err, code)
	}
}

func assertContentPreKeyTableCounts(
	t *testing.T,
	db *gorm.DB,
	pools int64,
	keys int64,
) {
	t.Helper()
	var poolCount int64
	if err := db.Model(&infrastructure.ContentPreKeyPoolModel{}).
		Count(&poolCount).Error; err != nil {
		t.Fatal(err)
	}
	var keyCount int64
	if err := db.Model(&infrastructure.ContentPreKeyModel{}).
		Count(&keyCount).Error; err != nil {
		t.Fatal(err)
	}
	if poolCount != pools || keyCount != keys {
		t.Fatalf(
			"Content PreKey tables pools=%d keys=%d, want %d/%d",
			poolCount,
			keyCount,
			pools,
			keys,
		)
	}
}

func assertContentPreKeyTombstone(
	t *testing.T,
	db *gorm.DB,
	keyID string,
	consumed bool,
	retired bool,
) {
	t.Helper()
	var record infrastructure.ContentPreKeyModel
	if err := db.Where("key_id = ?", keyID).First(&record).Error; err != nil {
		t.Fatal(err)
	}
	if (record.ConsumedAt != nil) != consumed ||
		(record.RetiredAt != nil) != retired {
		t.Fatalf(
			"key %q tombstone consumed=%t retired=%t, want %t/%t",
			keyID,
			record.ConsumedAt != nil,
			record.RetiredAt != nil,
			consumed,
			retired,
		)
	}
}

func assertContentPreKeyReceiptCount(
	t *testing.T,
	db *gorm.DB,
	want int64,
) {
	t.Helper()
	var count int64
	if err := db.Model(&infrastructure.ContentPreKeyClaimReceiptModel{}).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("claim receipt count = %d, want %d", count, want)
	}
}

func assertSameContentPreKeyClaims(
	t *testing.T,
	left *securecontentpb.ClaimContentPreKeysResponse,
	right *securecontentpb.ClaimContentPreKeysResponse,
) {
	t.Helper()
	leftClone := proto.Clone(left).(*securecontentpb.ClaimContentPreKeysResponse)
	rightClone := proto.Clone(right).(*securecontentpb.ClaimContentPreKeysResponse)
	leftClone.ExactReplay = false
	rightClone.ExactReplay = false
	if !proto.Equal(leftClone, rightClone) {
		t.Fatalf(
			"Content PreKey replay changed claims: left=%+v right=%+v",
			left,
			right,
		)
	}
}

func assertDirectAndMLSInventoryUntouched(t *testing.T, db *gorm.DB) {
	t.Helper()
	var directCount int64
	if err := db.Model(&infrastructure.OneTimePreKeyModel{}).
		Count(&directCount).Error; err != nil {
		t.Fatal(err)
	}
	var mlsCount int64
	if err := db.Model(&infrastructure.MLSKeyPackageModel{}).
		Count(&mlsCount).Error; err != nil {
		t.Fatal(err)
	}
	if directCount != 0 || mlsCount != 0 {
		t.Fatalf(
			"Content PreKey lifecycle mutated Direct/MLS inventory: direct=%d mls=%d",
			directCount,
			mlsCount,
		)
	}
}

func TestContentPreKeyConcurrentClaimsConverge(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	ctx := context.Background()
	fixture.publish(
		t,
		ctx,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("concurrent", 7),
	)
	request := contentPreKeyClaimRequest(
		"concurrent-plan",
		contentPreKeyEndpointTarget(),
	)

	const callers = 4
	responses := make(chan *securecontentpb.ClaimContentPreKeysResponse, callers)
	errs := make(chan error, callers)
	var wait sync.WaitGroup
	for range callers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			response, err := fixture.capability.ClaimContentPreKeys(
				ctx,
				proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
			)
			responses <- response
			errs <- err
		}()
	}
	wait.Wait()
	close(responses)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent exact claim: %v", err)
		}
	}
	initial := 0
	replay := 0
	var canonical *securecontentpb.ClaimContentPreKeysResponse
	for response := range responses {
		if response.GetExactReplay() {
			replay++
		} else {
			initial++
		}
		if canonical == nil {
			canonical = response
		} else {
			assertSameContentPreKeyClaims(t, canonical, response)
		}
	}
	if initial != 1 || replay != callers-1 {
		t.Fatalf(
			"concurrent claim modes initial=%d replay=%d",
			initial,
			replay,
		)
	}
}

func TestContentPreKeyDifferentPlansConsumeDistinctKeys(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	ctx := context.Background()
	fixture.publish(
		t,
		ctx,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("different-plan-a", 7),
		contentEndpointPreKey("different-plan-b", 7),
	)

	requests := []*securecontentpb.ClaimContentPreKeysRequest{
		contentPreKeyClaimRequest(
			"different-plan-1",
			contentPreKeyEndpointTarget(),
		),
		contentPreKeyClaimRequest(
			"different-plan-2",
			contentPreKeyEndpointTarget(),
		),
	}
	responses := make(chan *securecontentpb.ClaimContentPreKeysResponse, 2)
	errs := make(chan error, 2)
	var wait sync.WaitGroup
	for _, request := range requests {
		request := request
		wait.Add(1)
		go func() {
			defer wait.Done()
			response, err := fixture.capability.ClaimContentPreKeys(ctx, request)
			responses <- response
			errs <- err
		}()
	}
	wait.Wait()
	close(responses)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("different-plan claim: %v", err)
		}
	}
	keyIDs := make(map[string]struct{}, 2)
	for response := range responses {
		if response.GetExactReplay() || len(response.GetClaims()) != 1 {
			t.Fatalf("unexpected different-plan response: %+v", response)
		}
		keyIDs[response.GetClaims()[0].GetPrekey().GetKeyId()] = struct{}{}
	}
	if len(keyIDs) != 2 {
		t.Fatalf("different plans consumed %d distinct keys, want 2", len(keyIDs))
	}
}
