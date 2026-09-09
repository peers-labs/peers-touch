package delivery_test

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestPostgresCompetingDispatchersDoNotDuplicateClaims(t *testing.T) {
	fixture := newFrameFixture(t)
	db := openIsolatedPostgres(t)
	repository, err := delivery.NewGORMRepository(db, fixture.clock)
	if err != nil {
		t.Fatalf("create repository: %v", err)
	}
	if err := repository.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate repository: %v", err)
	}

	const frameCount = 24
	for index := 0; index < frameCount; index++ {
		frame := fixture.stringFrame(
			t,
			fmt.Sprintf("frame-%02d", index),
			fmt.Sprintf("idempotency-%02d", index),
			fmt.Sprintf("payload-%02d", index),
		)
		frame.OrderingKey = fmt.Sprintf("lane-%02d", index)
		if err := delivery.SignFrame(
			context.Background(),
			frame,
			fixture.policy,
			fixture.signer,
		); err != nil {
			t.Fatalf("resign frame: %v", err)
		}
		if _, err := repository.Enqueue(
			context.Background(),
			frame,
			fixture.clock.Now(),
		); err != nil {
			t.Fatalf("enqueue frame: %v", err)
		}
	}

	claimedByWorker := make([]map[string]struct{}, 2)
	claimErrors := make([]error, 2)
	var wait sync.WaitGroup
	for index := range claimedByWorker {
		wait.Add(1)
		go func(worker int) {
			defer wait.Done()
			claims, claimErr := repository.Claim(context.Background(), delivery.ClaimRequest{
				WorkerID:      fmt.Sprintf("worker-%d", worker),
				Limit:         frameCount,
				Now:           fixture.clock.Now(),
				LeaseDuration: time.Minute,
			})
			claimErrors[worker] = claimErr
			claimedByWorker[worker] = make(map[string]struct{}, len(claims))
			for _, claim := range claims {
				claimedByWorker[worker][claim.Frame.FrameId] = struct{}{}
			}
		}(index)
	}
	wait.Wait()
	for _, claimErr := range claimErrors {
		if claimErr != nil {
			t.Fatalf("concurrent claim: %v", claimErr)
		}
	}
	union := make(map[string]struct{}, frameCount)
	for _, workerClaims := range claimedByWorker {
		for frameID := range workerClaims {
			if _, duplicate := union[frameID]; duplicate {
				t.Fatalf("frame %s was claimed by two workers", frameID)
			}
			union[frameID] = struct{}{}
		}
	}
	if len(union) != frameCount {
		t.Fatalf("claimed %d frames, want %d", len(union), frameCount)
	}
}

func TestPostgresConcurrentInboxDeliveryCommitsDomainMutationOnce(t *testing.T) {
	fixture := newFrameFixture(t)
	db := openIsolatedPostgres(t)
	repository, err := delivery.NewGORMRepository(db, fixture.clock)
	if err != nil {
		t.Fatalf("create repository: %v", err)
	}
	if err := repository.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate repository: %v", err)
	}
	if err := db.AutoMigrate(&domainRecord{}); err != nil {
		t.Fatalf("migrate domain table: %v", err)
	}
	registry := delivery.NewRegistry()
	if err := registry.Register(
		delivery.PayloadKindSocialFriendRequestCommand,
		delivery.ReceiverFunc(func(
			ctx context.Context,
			tx delivery.Transaction,
			frame *delivery.Frame,
		) (delivery.Result, error) {
			if err := tx.DB().WithContext(ctx).Create(&domainRecord{
				ID:    frame.FrameId,
				Value: frame.PayloadId,
			}).Error; err != nil {
				return delivery.Result{}, err
			}
			return delivery.AcceptedResult(), nil
		}),
	); err != nil {
		t.Fatalf("register receiver: %v", err)
	}
	receiver, err := delivery.NewReceiver(delivery.ReceiverConfig{
		Policy:     fixture.policy,
		Verifier:   fixture.verifier,
		Registry:   registry,
		UnitOfWork: repository,
		Clock:      fixture.clock,
	})
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}
	frame := fixture.stringFrame(t, "concurrent-frame", "concurrent-idempotency", "concurrent")

	results := make([]delivery.Result, 2)
	deliveryErrors := make([]error, 2)
	frames := []*delivery.Frame{cloneFrame(t, frame), cloneFrame(t, frame)}
	var wait sync.WaitGroup
	for index := range results {
		wait.Add(1)
		go func(worker int) {
			defer wait.Done()
			results[worker], deliveryErrors[worker] = receiver.Receive(
				context.Background(),
				frames[worker],
			)
		}(index)
	}
	wait.Wait()
	for _, deliveryErr := range deliveryErrors {
		if deliveryErr != nil {
			t.Fatalf("concurrent receive: %v", deliveryErr)
		}
	}
	accepted, duplicate := 0, 0
	for _, result := range results {
		switch result.Disposition {
		case delivery.DispositionAccepted:
			accepted++
		case delivery.DispositionDuplicate:
			duplicate++
		default:
			t.Fatalf("unexpected concurrent result: %+v", result)
		}
	}
	if accepted != 1 || duplicate != 1 {
		t.Fatalf("accepted=%d duplicate=%d", accepted, duplicate)
	}
	var inboxCount, domainCount int64
	if err := db.Model(&delivery.InboxRecord{}).Count(&inboxCount).Error; err != nil {
		t.Fatalf("count inbox rows: %v", err)
	}
	if err := db.Model(&domainRecord{}).Count(&domainCount).Error; err != nil {
		t.Fatalf("count domain rows: %v", err)
	}
	if inboxCount != 1 || domainCount != 1 {
		t.Fatalf("inbox=%d domain=%d, want one each", inboxCount, domainCount)
	}
}

func openIsolatedPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("FEDERATION_DELIVERY_TEST_POSTGRES_DSN")
	if dsn == "" {
		dsn = os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	}
	if dsn == "" {
		t.Skip("FEDERATION_DELIVERY_TEST_POSTGRES_DSN is not configured")
	}
	admin, err := gorm.Open(
		postgres.Open(dsn),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	schema := "federation_delivery_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create isolated PostgreSQL schema: %v", err)
	}
	t.Cleanup(func() {
		if err := admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop isolated PostgreSQL schema: %v", err)
		}
		sqlDB, dbErr := admin.DB()
		if dbErr == nil {
			if closeErr := sqlDB.Close(); closeErr != nil {
				t.Errorf("close PostgreSQL admin database: %v", closeErr)
			}
		}
	})

	isolated, err := gorm.Open(
		postgres.Open(postgresDSNWithSearchPath(t, dsn, schema)),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatalf("open isolated PostgreSQL schema: %v", err)
	}
	isolatedSQL, err := isolated.DB()
	if err != nil {
		t.Fatalf("resolve isolated PostgreSQL handle: %v", err)
	}
	isolatedSQL.SetMaxOpenConns(8)
	t.Cleanup(func() {
		if err := isolatedSQL.Close(); err != nil {
			t.Errorf("close isolated PostgreSQL database: %v", err)
		}
	})
	return isolated
}

func postgresDSNWithSearchPath(t *testing.T, dsn string, schema string) string {
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
