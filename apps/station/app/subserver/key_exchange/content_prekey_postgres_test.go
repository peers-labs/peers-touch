package key_exchange

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

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
