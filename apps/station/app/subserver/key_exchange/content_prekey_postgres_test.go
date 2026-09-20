package key_exchange

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestContentPreKeyPostgresPublicationReceiptContention(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("postgres-client-contention", 7),
	)
	service := fixture.capability.(*subServer).composition.contentPreKeyService
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	start := make(chan struct{})
	results := make(chan *securecontentpb.PublishContentPreKeysResponse, 2)
	failures := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			response, err := service.PublishContentPreKeysClient(
				ctx,
				domain.Endpoint{
					ActorPTID: contentPreKeyTestActor,
					DeviceID:  contentPreKeyTestDevice,
				},
				contentPreKeyTestStation,
				contentPreKeyTestSession,
				request,
			)
			if err != nil {
				failures <- err
				return
			}
			results <- response
		}()
	}
	close(start)

	replays := 0
	for range 2 {
		select {
		case err := <-failures:
			t.Fatalf("concurrent publication: %v", err)
		case response := <-results:
			if response.GetExactReplay() {
				replays++
			}
		case <-ctx.Done():
			t.Fatal("concurrent publication timed out")
		}
	}
	if replays != 1 {
		t.Fatalf("exact replay responses = %d, want 1", replays)
	}
	assertContentPreKeyClientRowCounts(t, fixture, 1, 1)
}

func TestContentPreKeyPostgresPublicationReceiptConflictingContention(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("postgres-client-conflict", 7),
	)
	command, err := domain.NormalizeContentPreKeyClientPublication(
		"test.content_prekey.client_conflict",
		contentPreKeyClientEndpoint(),
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
		fixture.clock.Now(),
	)
	if err != nil {
		t.Fatalf("normalize client publication: %v", err)
	}
	conflicting := command
	conflicting.Authorization.RequestBytes = append(
		append([]byte(nil), command.Authorization.RequestBytes...),
		0x01,
	)
	conflicting.Authorization.RequestSHA256 = sha256.Sum256(
		conflicting.Authorization.RequestBytes,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, candidate := range []domain.ContentPreKeyClientPublication{
		command,
		conflicting,
	} {
		go func(candidate domain.ContentPreKeyClientPublication) {
			<-start
			_, err := fixture.capability.(*subServer).composition.
				contentPreKeyStore.PublishContentPreKeysClient(
				ctx,
				candidate,
				fixture.clock.Now(),
			)
			results <- err
		}(candidate)
	}
	close(start)

	successes := 0
	conflicts := 0
	for range 2 {
		select {
		case err := <-results:
			switch domain.CodeOf(err) {
			case "":
				successes++
			case domain.ErrorCodeConflict:
				conflicts++
			default:
				t.Fatalf("conflicting publication contention: %v", err)
			}
		case <-ctx.Done():
			t.Fatal("conflicting publication contention timed out")
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf(
			"conflicting contention successes/conflicts = %d/%d, want 1/1",
			successes,
			conflicts,
		)
	}
	assertContentPreKeyClientRowCounts(t, fixture, 1, 1)
}

func TestContentPreKeyPostgresPublicationAllExistingRollsBackPendingReceipt(
	t *testing.T,
) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	prekey := contentEndpointPreKey("postgres-all-existing", 7)
	request := signedContentPreKeyClientRequest(t, fixture, prekey)
	if _, err := fixture.capability.PublishContentPreKeys(
		context.Background(),
		contentPreKeyEndpointRef(),
		request,
	); err != nil {
		t.Fatalf("seed existing Content PreKey: %v", err)
	}

	_, err := fixture.capability.(*subServer).composition.
		contentPreKeyService.PublishContentPreKeysClient(
		context.Background(),
		contentPreKeyClientEndpoint(),
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeConflict)
	assertContentPreKeyClientRowCounts(t, fixture, 1, 0)
	assertContentPreKeyPublicationReceiptStates(t, fixture, 0, 0)
}

func TestContentPreKeyPostgresPublicationReceiptGrowthBound(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	service := fixture.capability.(*subServer).composition.contentPreKeyService

	for index := range 3 {
		expectedEpoch := uint64(0)
		if index > 0 {
			expectedEpoch = 7
		}
		request := signedContentPreKeyClientRequestAtEpoch(
			t,
			fixture,
			expectedEpoch,
			contentEndpointPreKey(fmt.Sprintf("postgres-growth-%d", index), 7),
		)
		if _, err := service.PublishContentPreKeysClient(
			context.Background(),
			contentPreKeyClientEndpoint(),
			contentPreKeyTestStation,
			contentPreKeyTestSession,
			request,
		); err != nil {
			t.Fatalf("publication %d: %v", index, err)
		}
	}

	assertContentPreKeyClientRowCounts(t, fixture, 3, 3)
	assertContentPreKeyPublicationReceiptStates(t, fixture, 0, 3)
}

func TestContentPreKeyPostgresPublicationReplayAfterProfileRotation(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("postgres-profile-rotation", 7),
	)
	service := fixture.capability.(*subServer).composition.contentPreKeyService
	endpoint := domain.Endpoint{
		ActorPTID: contentPreKeyTestActor,
		DeviceID:  contentPreKeyTestDevice,
	}
	if _, err := service.PublishContentPreKeysClient(
		context.Background(),
		endpoint,
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	); err != nil {
		t.Fatalf("initial publication: %v", err)
	}

	rotatedPrivateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x55}, 32))
	if err := database.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", endpoint.ActorPTID, endpoint.DeviceID).
		Updates(map[string]any{
			"signing_key_id": "alice-signing-key-rotated",
			"public_key": append(
				[]byte(nil),
				rotatedPrivateKey.Public().(ed25519.PublicKey)...,
			),
			"profile_version": int64(8),
		}).Error; err != nil {
		t.Fatalf("rotate publisher profile: %v", err)
	}
	if err := database.Where(
		"kind = ? AND principal_ptid = ? AND principal_device_id = ?",
		int32(securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT),
		endpoint.ActorPTID,
		endpoint.DeviceID,
	).Delete(&infrastructure.ContentPreKeyPoolModel{}).Error; err != nil {
		t.Fatalf("remove pool before completed replay: %v", err)
	}
	authorizeContentPreKeyClientRequest(
		t,
		request,
		"alice-signing-key-rotated",
		8,
		rotatedPrivateKey,
		fixture.clock.Now(),
	)
	replayed, err := service.PublishContentPreKeysClient(
		context.Background(),
		endpoint,
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	if err != nil {
		t.Fatalf("publication replay after profile rotation: %v", err)
	}
	if !replayed.GetExactReplay() {
		t.Fatal("profile-rotation replay was not marked exact")
	}
	assertContentPreKeyClientRowCounts(t, fixture, 1, 1)
	var pools int64
	if err := database.Model(&infrastructure.ContentPreKeyPoolModel{}).
		Count(&pools).Error; err != nil {
		t.Fatalf("count pools after completed replay: %v", err)
	}
	if pools != 0 {
		t.Fatalf("completed replay recreated %d pools, want 0", pools)
	}
}

func TestContentPreKeyPostgresPublicationReplayRejectsRevokedEndpoint(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("postgres-revoked-replay", 7),
	)
	service := fixture.capability.(*subServer).composition.contentPreKeyService
	endpoint := domain.Endpoint{
		ActorPTID: contentPreKeyTestActor,
		DeviceID:  contentPreKeyTestDevice,
	}
	if _, err := service.PublishContentPreKeysClient(
		context.Background(),
		endpoint,
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	); err != nil {
		t.Fatalf("initial publication: %v", err)
	}
	revokedAt := fixture.clock.Now()
	if err := database.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", endpoint.ActorPTID, endpoint.DeviceID).
		Updates(map[string]any{
			"revoked":    true,
			"revoked_at": &revokedAt,
		}).Error; err != nil {
		t.Fatalf("revoke publisher endpoint: %v", err)
	}
	_, err := service.PublishContentPreKeysClient(
		context.Background(),
		endpoint,
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeUnauthorized)
	assertContentPreKeyClientRowCounts(t, fixture, 1, 1)
}

func TestContentPreKeyPostgresPublicationRevocationRace(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("postgres-publication-revocation-race", 7),
	)
	revokedAt := fixture.clock.Now()
	fixture.resolver.mu.Lock()
	fixture.resolver.beforeFence = func(*gorm.DB) {
		if err := database.Model(&actoridentitypersistence.ActorDeviceModel{}).
			Where(
				"ptid = ? AND device_id = ?",
				contentPreKeyTestActor,
				contentPreKeyTestDevice,
			).
			Updates(map[string]any{
				"revoked":    true,
				"revoked_at": &revokedAt,
			}).Error; err != nil {
			t.Errorf("race publisher revocation: %v", err)
		}
	}
	fixture.resolver.mu.Unlock()

	_, err := fixture.capability.(*subServer).composition.
		contentPreKeyService.PublishContentPreKeysClient(
		context.Background(),
		contentPreKeyClientEndpoint(),
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeUnauthorized)
	assertContentPreKeyClientRowCounts(t, fixture, 0, 0)
	assertContentPreKeyPublicationReceiptStates(t, fixture, 0, 0)
}

func TestContentPreKeyPostgresPublicationReplayRevocationRace(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	request := signedContentPreKeyClientRequest(
		t,
		fixture,
		contentEndpointPreKey("postgres-replay-revocation-race", 7),
	)
	service := fixture.capability.(*subServer).composition.contentPreKeyService
	if _, err := service.PublishContentPreKeysClient(
		context.Background(),
		contentPreKeyClientEndpoint(),
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	); err != nil {
		t.Fatalf("initial publication: %v", err)
	}

	revokedAt := fixture.clock.Now()
	fixture.resolver.mu.Lock()
	fixture.resolver.beforeFence = func(*gorm.DB) {
		if err := database.Model(&actoridentitypersistence.ActorDeviceModel{}).
			Where(
				"ptid = ? AND device_id = ?",
				contentPreKeyTestActor,
				contentPreKeyTestDevice,
			).
			Updates(map[string]any{
				"revoked":    true,
				"revoked_at": &revokedAt,
			}).Error; err != nil {
			t.Errorf("race replay publisher revocation: %v", err)
		}
	}
	fixture.resolver.mu.Unlock()

	_, err := service.PublishContentPreKeysClient(
		context.Background(),
		contentPreKeyClientEndpoint(),
		contentPreKeyTestStation,
		contentPreKeyTestSession,
		request,
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeUnauthorized)
	assertContentPreKeyClientRowCounts(t, fixture, 1, 1)
	assertContentPreKeyPublicationReceiptStates(t, fixture, 0, 1)
}

func TestContentPreKeyPostgresClaimRevocationRace(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	fixture.publish(
		t,
		context.Background(),
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("postgres-claim-revocation-race", 7),
	)
	revokedAt := fixture.clock.Now()
	fixture.resolver.mu.Lock()
	fixture.resolver.beforeFence = func(*gorm.DB) {
		if err := database.Model(&actoridentitypersistence.ActorDeviceModel{}).
			Where(
				"ptid = ? AND device_id = ?",
				contentPreKeyTestActor,
				contentPreKeyTestDevice,
			).
			Updates(map[string]any{
				"revoked":    true,
				"revoked_at": &revokedAt,
			}).Error; err != nil {
			t.Errorf("race claim publisher revocation: %v", err)
		}
	}
	fixture.resolver.mu.Unlock()

	_, err := fixture.capability.ClaimContentPreKeys(
		context.Background(),
		contentPreKeyClaimRequest(
			"postgres-claim-revocation-race",
			contentPreKeyEndpointTarget(),
		),
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeUnauthorized)

	var receipts int64
	if err := database.Model(&infrastructure.ContentPreKeyClaimReceiptModel{}).
		Count(&receipts).Error; err != nil {
		t.Fatalf("count claim receipts: %v", err)
	}
	var consumed int64
	if err := database.Model(&infrastructure.ContentPreKeyModel{}).
		Where("consumed_at IS NOT NULL").
		Count(&consumed).Error; err != nil {
		t.Fatalf("count consumed Content PreKeys: %v", err)
	}
	if receipts != 0 || consumed != 0 {
		t.Fatalf(
			"revocation race claim receipts/consumed = %d/%d, want 0/0",
			receipts,
			consumed,
		)
	}
}

func TestContentPreKeyPostgresPublicationReceiptPoolActorLockOrder(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	fixture.publish(
		t,
		context.Background(),
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("postgres-lock-order-seed", 7),
	)
	request := signedContentPreKeyClientRequestAtEpoch(
		t,
		fixture,
		7,
		contentEndpointPreKey("postgres-lock-order-client", 7),
	)

	actorLock := database.Begin()
	if actorLock.Error != nil {
		t.Fatalf("begin Actor lock transaction: %v", actorLock.Error)
	}
	defer actorLock.Rollback()
	var device actoridentitypersistence.ActorDeviceModel
	if err := actorLock.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"ptid = ? AND device_id = ?",
			contentPreKeyTestActor,
			contentPreKeyTestDevice,
		).
		First(&device).Error; err != nil {
		t.Fatalf("lock Actor device: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := fixture.capability.(*subServer).composition.
			contentPreKeyService.PublishContentPreKeysClient(
			ctx,
			contentPreKeyClientEndpoint(),
			contentPreKeyTestStation,
			contentPreKeyTestSession,
			request,
		)
		result <- err
	}()

	deadline := time.Now().Add(5 * time.Second)
	for {
		if err := requireContentPreKeyPoolLocked(
			database,
			contentPreKeyEndpointTarget(),
		); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(
				"publication did not lock its pool before waiting on Actor fence",
			)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := actorLock.Rollback().Error; err != nil {
		t.Fatalf("release Actor device lock: %v", err)
	}

	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("client publication after Actor fence release: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("client publication remained blocked after Actor fence release")
	}
	assertContentPreKeyClientRowCounts(t, fixture, 2, 1)
	assertContentPreKeyPublicationReceiptStates(t, fixture, 0, 1)
}

func TestContentPreKeyPostgresPoolLockOrder(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
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
		contentEndpointPreKey("postgres-lock-initial", 7),
	)

	tests := []struct {
		name string
		run  func() error
	}{
		{
			name: "publish",
			run: func() error {
				_, err := fixture.capability.PublishContentPreKeys(
					ctx,
					publisher,
					signedContentPreKeyRequest(
						t,
						publisher,
						contentPreKeyTestSigningKey,
						7,
						7,
						fixture.privateKey,
						contentEndpointPreKey("postgres-lock-publish", 7),
					),
				)
				return err
			},
		},
		{
			name: "inventory",
			run: func() error {
				_, err := fixture.capability.GetContentPreKeyInventory(
					ctx,
					publisher,
					&securecontentpb.GetContentPreKeyInventoryRequest{
						Publisher: publisher,
						Target:    contentPreKeyEndpointTarget(),
					},
				)
				return err
			},
		},
		{
			name: "claim",
			run: func() error {
				_, err := fixture.capability.ClaimContentPreKeys(
					ctx,
					contentPreKeyClaimRequest(
						"postgres-lock-claim",
						contentPreKeyEndpointTarget(),
					),
				)
				return err
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			probeResult := make(chan error, 1)
			fixture.resolver.mu.Lock()
			fixture.resolver.beforeFence = func(*gorm.DB) {
				probeResult <- requireContentPreKeyPoolLocked(
					database,
					contentPreKeyEndpointTarget(),
				)
			}
			fixture.resolver.mu.Unlock()

			if err := testCase.run(); err != nil {
				t.Fatalf("%s Content PreKey operation: %v", testCase.name, err)
			}
			select {
			case err := <-probeResult:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("Content PreKey pool lock probe did not complete")
			}
		})
	}
}

func TestContentPreKeyPostgresConcurrentInitialRecoveryPublication(t *testing.T) {
	database := openContentPreKeyPostgres(t)
	fixture := newContentPreKeyOperationalFixtureWithDatabase(t, database)
	secondPublisher, secondPrivateKey := addContentPreKeyPublisher(
		t,
		database,
		"alice-device-2",
		"alice-signing-key-2",
		0x42,
	)
	firstPublisher := contentPreKeyEndpointRef()
	firstRequest := signedContentPreKeyRequest(
		t,
		firstPublisher,
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentRecoveryPreKey("postgres-initial-a", 1),
	)
	secondRequest := signedContentPreKeyRequest(
		t,
		secondPublisher,
		"alice-signing-key-2",
		7,
		0,
		secondPrivateKey,
		contentRecoveryPreKey("postgres-initial-b", 1),
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, invocation := range []func() error{
		func() error {
			_, err := fixture.capability.PublishContentPreKeys(
				ctx,
				firstPublisher,
				firstRequest,
			)
			return err
		},
		func() error {
			_, err := fixture.capability.PublishContentPreKeys(
				ctx,
				secondPublisher,
				secondRequest,
			)
			return err
		},
	} {
		go func(run func() error) {
			<-start
			results <- run()
		}(invocation)
	}
	close(start)

	successes := 0
	stale := 0
	for range 2 {
		select {
		case err := <-results:
			switch domain.CodeOf(err) {
			case "":
				successes++
			case domain.ErrorCodeStaleMaterial, domain.ErrorCodeConflict:
				stale++
			default:
				t.Fatalf("concurrent initial publication: %v", err)
			}
		case <-ctx.Done():
			t.Fatal("concurrent initial publication timed out")
		}
	}
	if successes != 1 || stale != 1 {
		t.Fatalf(
			"concurrent initial publication successes/stale = %d/%d, want 1/1",
			successes,
			stale,
		)
	}
}

func requireContentPreKeyPoolLocked(
	database *gorm.DB,
	target *securecontentpb.ContentPreKeyClaimTarget,
) error {
	principal, err := contentPreKeyPrincipalForLockProbe(target)
	if err != nil {
		return err
	}
	err = database.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL lock_timeout = '1s'").Error; err != nil {
			return err
		}
		var pool infrastructure.ContentPreKeyPoolModel
		return tx.Clauses(clause.Locking{
			Strength: "UPDATE",
			Options:  "NOWAIT",
		}).
			Where(
				"kind = ? AND principal_ptid = ? AND principal_device_id = ?",
				principal.kind,
				principal.actorPTID,
				principal.deviceID,
			).
			First(&pool).Error
	})
	if err == nil {
		return errors.New(
			"Content PreKey operation reached the Actor Identity fence " +
				"without first locking its pool",
		)
	}
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) || postgresError.Code != "55P03" {
		return fmt.Errorf("probe Content PreKey pool lock: %w", err)
	}
	return nil
}

type contentPreKeyLockPrincipal struct {
	kind      int32
	actorPTID string
	deviceID  string
}

func contentPreKeyPrincipalForLockProbe(
	target *securecontentpb.ContentPreKeyClaimTarget,
) (contentPreKeyLockPrincipal, error) {
	switch target.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		return contentPreKeyLockPrincipal{
			kind:      int32(target.GetKind()),
			actorPTID: target.GetEndpoint().GetActor().GetPtid(),
			deviceID:  target.GetEndpoint().GetDeviceId(),
		}, nil
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		return contentPreKeyLockPrincipal{
			kind:      int32(target.GetKind()),
			actorPTID: target.GetRecoveryActor().GetPtid(),
		}, nil
	default:
		return contentPreKeyLockPrincipal{}, errors.New(
			"unsupported Content PreKey lock-probe target",
		)
	}
}

func contentPreKeyClientEndpoint() domain.Endpoint {
	return domain.Endpoint{
		ActorPTID: contentPreKeyTestActor,
		DeviceID:  contentPreKeyTestDevice,
	}
}

func signedContentPreKeyClientRequestAtEpoch(
	t *testing.T,
	fixture *contentPreKeyOperationalFixture,
	expectedPoolEpoch uint64,
	prekeys ...*securecontentpb.ContentOneTimePreKey,
) *securecontentpb.PublishContentPreKeysRequest {
	t.Helper()
	request := signedContentPreKeyRequest(
		t,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		expectedPoolEpoch,
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

func assertContentPreKeyPublicationReceiptStates(
	t *testing.T,
	fixture *contentPreKeyOperationalFixture,
	wantPending int64,
	wantCompleted int64,
) {
	t.Helper()
	var pending int64
	if err := fixture.db.Model(
		&infrastructure.ContentPreKeyPublicationReceiptModel{},
	).Where("state = ?", "PENDING").Count(&pending).Error; err != nil {
		t.Fatalf("count pending publication receipts: %v", err)
	}
	var completed int64
	if err := fixture.db.Model(
		&infrastructure.ContentPreKeyPublicationReceiptModel{},
	).Where("state = ?", "COMPLETED").Count(&completed).Error; err != nil {
		t.Fatalf("count completed publication receipts: %v", err)
	}
	if pending != wantPending || completed != wantCompleted {
		t.Fatalf(
			"publication receipt states pending/completed = %d/%d, want %d/%d",
			pending,
			completed,
			wantPending,
			wantCompleted,
		)
	}
}

func openContentPreKeyPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("MESSAGING_TEST_POSTGRES_DSN is not configured")
	}

	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open PostgreSQL test database: %v", err)
	}
	schema := "content_prekey_test_" +
		strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create isolated PostgreSQL schema: %v", err)
	}
	isolated, err := gorm.Open(
		postgres.Open(contentPreKeyPostgresDSNWithSearchPath(t, dsn, schema)),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open isolated PostgreSQL schema: %v", err)
	}
	sqlDatabase, err := isolated.DB()
	if err != nil {
		t.Fatalf("open isolated PostgreSQL connection pool: %v", err)
	}
	sqlDatabase.SetMaxOpenConns(8)
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
		if err := admin.Exec(
			`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`,
		).Error; err != nil {
			t.Errorf("drop isolated PostgreSQL schema: %v", err)
		}
		adminDatabase, dbErr := admin.DB()
		if dbErr == nil {
			_ = adminDatabase.Close()
		}
	})
	return isolated
}

func contentPreKeyPostgresDSNWithSearchPath(
	t *testing.T,
	dsn string,
	schema string,
) string {
	t.Helper()
	if strings.Contains(dsn, "://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatalf("parse PostgreSQL DSN: %v", err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema
}
