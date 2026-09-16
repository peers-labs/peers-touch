package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var errPrivateContentFailpoint = errors.New("private content injected failure")

func TestGORMPrivateContentStoreSchema(t *testing.T) {
	db, store := openPrivateContentStore(t, "")
	if store == nil {
		t.Fatal("store is nil")
	}

	expectedTables := []struct {
		model any
		name  string
	}{
		{&dbmodel.SocialPrivateContentPlan{}, "social_private_content_plans"},
		{&dbmodel.SocialPrivateContentPlanSlot{}, "social_private_content_plan_slots"},
		{&dbmodel.SocialPrivateCommandReceipt{}, "social_private_command_receipts"},
		{&dbmodel.SocialPrivateContentPost{}, "social_private_posts"},
		{&dbmodel.SocialPrivateContentComment{}, "social_private_comments"},
		{&dbmodel.SocialPrivateAudienceSnapshot{}, "social_private_audience_snapshots"},
		{&dbmodel.SocialPrivateRecipientGrant{}, "social_private_recipient_grants"},
		{&dbmodel.SocialPrivateContentEnvelope{}, "social_private_content_envelopes"},
		{&dbmodel.SocialPrivateDeliveryIntent{}, "social_private_delivery_intents"},
		{&dbmodel.SocialPrivateObjectUpload{}, "social_private_object_uploads"},
		{&dbmodel.SocialPrivateObjectChunk{}, "social_private_object_parts"},
		{&dbmodel.SocialPrivateObjectAttachment{}, "social_private_objects"},
		{&dbmodel.SocialPrivateObjectGrant{}, "social_private_object_grants"},
		{&dbmodel.SocialPrivateCommitProof{}, "social_private_commit_proofs"},
	}
	for _, expected := range expectedTables {
		t.Run(expected.name, func(t *testing.T) {
			if !db.Migrator().HasTable(expected.model) {
				t.Fatalf("table %q is missing", expected.name)
			}
			statement := &gorm.Statement{DB: db}
			if err := statement.Parse(expected.model); err != nil {
				t.Fatal(err)
			}
			if statement.Schema.Table != expected.name {
				t.Fatalf(
					"model table = %q, want %q",
					statement.Schema.Table,
					expected.name,
				)
			}
		})
	}

	for _, model := range []any{
		&dbmodel.SocialPrivateContentPost{},
		&dbmodel.SocialPrivateContentComment{},
		&dbmodel.SocialPrivateContentPlan{},
		&dbmodel.SocialPrivateContentEnvelope{},
		&dbmodel.SocialPrivateObjectAttachment{},
	} {
		for _, forbidden := range []string{
			"text_body",
			"plaintext",
			"plaintext_sha256",
			"object_key",
			"base_nonce",
		} {
			if db.Migrator().HasColumn(model, forbidden) {
				t.Fatalf("%T exposes forbidden column %q", model, forbidden)
			}
		}
	}
}

func TestGORMPrivateContentStoreMigratesAlongsideLegacyPrivatePost(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(
			"file:"+uuid.NewString()+"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if closeErr := sqlDB.Close(); closeErr != nil {
			t.Errorf("close private content database: %v", closeErr)
		}
	})

	if err := database.AutoMigrate(
		&dbmodel.Actor{},
		&dbmodel.SocialPrivatePost{},
	); err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&dbmodel.Actor{
		ID:                1,
		PTID:              "ptid:alice",
		Namespace:         "peers",
		PreferredUsername: "alice",
		Email:             "alice@example.test",
		PasswordHash:      "test-only",
	}).Error; err != nil {
		t.Fatal(err)
	}
	legacy := dbmodel.SocialPrivatePost{
		ID:           101,
		AuthorID:     1,
		Type:         "TEXT",
		AudienceKind: "SELF",
		TextBody:     "legacy private plaintext",
		CreatedAt:    fixedTime(),
		UpdatedAt:    fixedTime(),
	}
	if err := database.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	store, err := NewGORMPrivateContentStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}

	payload := []byte("encrypted-private-content")
	post := dbmodel.SocialPrivateContentPost{
		PostID:                    "post-coexistence",
		ContentID:                 "content-coexistence",
		AuthorPTID:                "ptid:alice",
		Generation:                1,
		AudienceSnapshotID:        "snapshot-coexistence",
		Kind:                      "TEXT",
		EncryptedPayloadBytes:     payload,
		EncryptedPayloadSHA256:    digest(payload),
		ObjectDescriptorSetSHA256: digest([]byte("objects-coexistence")),
		LifecycleState:            "ACTIVE",
		CreatedAt:                 fixedTime(),
		UpdatedAt:                 fixedTime(),
	}
	err = (&gormPrivateContentTransaction{
		db: database,
		plan: &dbmodel.SocialPrivateContentPlan{
			ResourceKind: PrivateContentResourcePost,
			ContentID:    post.ContentID,
			Generation:   post.Generation,
			AuthorPTID:   post.AuthorPTID,
		},
		domainCommitID: "commit-coexistence",
	}).CreatePost(context.Background(), post)
	if err != nil {
		t.Fatalf("insert encrypted Post alongside legacy schema: %v", err)
	}

	var legacyID uint64
	if err := database.Table("social_private_posts").
		Select("id").
		Where("content_id = ?", "content-coexistence").
		Scan(&legacyID).Error; err != nil {
		t.Fatal(err)
	}
	var preserved dbmodel.SocialPrivatePost
	if err := database.First(&preserved, "id = ?", legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	if preserved.TextBody != legacy.TextBody {
		t.Fatalf("legacy row changed during staged migration: %+v", preserved)
	}
	legacyRepository := NewPrivatePostRepository(
		database,
		NewAudienceGrantRepository(database),
	)
	exposed, err := legacyRepository.GetByID(
		context.Background(),
		legacyID,
		"ptid:alice",
	)
	if err != nil {
		t.Fatal(err)
	}
	if exposed != nil {
		t.Fatal("legacy private repository exposed an encrypted hard-cut row")
	}
}

func TestGORMPrivateContentStorePreparePersistence(t *testing.T) {
	t.Run("durable PREPARING and exact replay", func(t *testing.T) {
		db, store := openPrivateContentStore(t, "")
		candidate := preparingPlan("post", PrivateContentResourcePost)

		created, err := store.ClaimPreparing(context.Background(), candidate)
		if err != nil {
			t.Fatal(err)
		}
		if created.ExactReplay {
			t.Fatal("first prepare was reported as replay")
		}
		if created.Plan.State != dbmodel.SocialPrivatePlanStatePreparing {
			t.Fatalf("plan state = %q", created.Plan.State)
		}
		assertBytesEqual(
			t,
			created.Plan.ClaimRequestBytes,
			candidate.ClaimRequestBytes,
			"claim request",
		)

		retry := candidate
		retry.ExpiresAt = candidate.ExpiresAt.Add(time.Minute)
		replayed, err := store.ClaimPreparing(context.Background(), retry)
		if err != nil {
			t.Fatal(err)
		}
		if !replayed.ExactReplay || replayed.Plan.PlanID != candidate.PlanID {
			t.Fatalf("prepare replay = %+v", replayed)
		}
		if !replayed.Plan.ExpiresAt.Equal(candidate.ExpiresAt) {
			t.Fatalf(
				"prepare replay changed expiry: got %s want %s",
				replayed.Plan.ExpiresAt,
				candidate.ExpiresAt,
			)
		}
		driftedSnapshot := candidate
		driftedSnapshot.AuthorizationSnapshotSHA256 = digest(
			[]byte("changed-current-snapshot"),
		)
		driftedSnapshot.ClaimRequestBytes = []byte("changed-current-targets")
		driftedSnapshot.ClaimRequestSHA256 = digest(
			driftedSnapshot.ClaimRequestBytes,
		)
		racedReplay, err := store.ClaimPreparing(
			context.Background(),
			driftedSnapshot,
		)
		if err != nil {
			t.Fatal(err)
		}
		if !racedReplay.ExactReplay ||
			!bytes.Equal(
				racedReplay.Plan.ClaimRequestBytes,
				candidate.ClaimRequestBytes,
			) {
			t.Fatal("prepare race did not preserve the original claim request")
		}

		conflict := candidate
		conflict.CanonicalPrepareBytes = []byte("different-prepare")
		conflict.CanonicalPrepareSHA256 = digest(conflict.CanonicalPrepareBytes)
		if _, err := store.ClaimPreparing(
			context.Background(),
			conflict,
		); !errors.Is(err, ErrPrivateContentConflict) {
			t.Fatalf("conflicting prepare error = %v", err)
		}
		assertCount(t, db, &dbmodel.SocialPrivateContentPlan{}, 1)
	})

	t.Run("PREPARED stores exact response slots and signed plan", func(t *testing.T) {
		db, store := openPrivateContentStore(t, "")
		plan := preparingPlan("post", PrivateContentResourcePost)
		if _, err := store.ClaimPreparing(context.Background(), plan); err != nil {
			t.Fatal(err)
		}
		prepared := preparedPlan(plan)

		result, err := store.MarkPrepared(context.Background(), prepared)
		if err != nil {
			t.Fatal(err)
		}
		if result.ExactReplay {
			t.Fatal("first PREPARED transition was reported as replay")
		}
		if result.Plan.State != dbmodel.SocialPrivatePlanStatePrepared {
			t.Fatalf("plan state = %q", result.Plan.State)
		}
		if len(result.Slots) != len(prepared.Slots) {
			t.Fatalf("slot count = %d", len(result.Slots))
		}
		assertBytesEqual(
			t,
			result.Plan.ClaimResponseBytes,
			prepared.ClaimResponseBytes,
			"claim response",
		)
		assertBytesEqual(
			t,
			result.Plan.SignedPlanBytes,
			prepared.SignedPlanBytes,
			"signed plan",
		)

		replayed, err := store.MarkPrepared(context.Background(), prepared)
		if err != nil {
			t.Fatal(err)
		}
		if !replayed.ExactReplay {
			t.Fatal("exact PREPARED replay was not reported")
		}

		conflict := prepared
		conflict.ClaimResponseBytes = []byte("different-response")
		conflict.ClaimResponseSHA256 = digest(conflict.ClaimResponseBytes)
		if _, err := store.MarkPrepared(
			context.Background(),
			conflict,
		); !errors.Is(err, ErrPrivateContentConflict) {
			t.Fatalf("conflicting PREPARED error = %v", err)
		}

		assertCount(t, db, &dbmodel.SocialPrivateContentPlanSlot{}, 2)
	})

	t.Run("concurrent exact prepare has one durable identity", func(t *testing.T) {
		db, store := openPrivateContentStore(t, "")
		candidate := preparingPlan("concurrent", PrivateContentResourcePost)
		const writers = 16
		var created atomic.Int32
		var replayed atomic.Int32
		var waitGroup sync.WaitGroup
		errs := make(chan error, writers)
		for range writers {
			waitGroup.Add(1)
			go func() {
				defer waitGroup.Done()
				result, err := store.ClaimPreparing(context.Background(), candidate)
				if err != nil {
					errs <- err
					return
				}
				if result.ExactReplay {
					replayed.Add(1)
				} else {
					created.Add(1)
				}
			}()
		}
		waitGroup.Wait()
		close(errs)
		for err := range errs {
			t.Errorf("concurrent prepare: %v", err)
		}
		if created.Load() != 1 || replayed.Load() != writers-1 {
			t.Fatalf(
				"created=%d replayed=%d",
				created.Load(),
				replayed.Load(),
			)
		}
		assertCount(t, db, &dbmodel.SocialPrivateContentPlan{}, 1)
	})
}

func TestGORMPrivateContentStorePrepareFailpointsRollBack(t *testing.T) {
	t.Run(string(PrivateContentBoundaryPlanPreparing), func(t *testing.T) {
		db, store := openPrivateContentStore(
			t,
			PrivateContentBoundaryPlanPreparing,
		)
		if _, err := store.ClaimPreparing(
			context.Background(),
			preparingPlan("preparing-failure", PrivateContentResourcePost),
		); !errors.Is(err, errPrivateContentFailpoint) {
			t.Fatalf("prepare failpoint error = %v", err)
		}
		assertCount(t, db, &dbmodel.SocialPrivateContentPlan{}, 0)
	})

	for _, boundary := range []PrivateContentWriteBoundary{
		PrivateContentBoundaryClaimResponse,
		PrivateContentBoundaryPlanSlots,
		PrivateContentBoundaryPlanPrepared,
	} {
		t.Run(string(boundary), func(t *testing.T) {
			db, store := openPrivateContentStore(t, boundary)
			plan := preparingPlan(string(boundary), PrivateContentResourcePost)
			if _, err := store.ClaimPreparing(context.Background(), plan); err != nil {
				t.Fatal(err)
			}
			if _, err := store.MarkPrepared(
				context.Background(),
				preparedPlan(plan),
			); !errors.Is(err, errPrivateContentFailpoint) {
				t.Fatalf("PREPARED failpoint error = %v", err)
			}

			var persisted dbmodel.SocialPrivateContentPlan
			if err := db.First(&persisted, "plan_id = ?", plan.PlanID).Error; err != nil {
				t.Fatal(err)
			}
			if persisted.State != dbmodel.SocialPrivatePlanStatePreparing ||
				len(persisted.ClaimResponseBytes) != 0 ||
				len(persisted.SignedPlanBytes) != 0 {
				t.Fatalf("partially prepared plan persisted: %+v", persisted)
			}
			assertCount(t, db, &dbmodel.SocialPrivateContentPlanSlot{}, 0)
		})
	}
}

func TestGORMPrivateContentStoreSubmitReceiptReplayAndConflict(t *testing.T) {
	db, store := openPrivateContentStore(t, "")
	plan := seedPreparedPlan(t, store, "submit", PrivateContentResourcePost)
	seedUnattachedObject(t, store, plan)
	command := submitCommand(plan, "submit")
	var calls atomic.Int32

	first, err := store.ExecuteSubmit(
		context.Background(),
		command,
		func(
			ctx context.Context,
			tx PrivateContentTransaction,
			locked dbmodel.SocialPrivateContentPlan,
		) (SubmitMutationResult, error) {
			calls.Add(1)
			response, err := persistSubmitMutation(
				ctx,
				tx,
				locked,
				"submit",
			)
			return SubmitMutationResult{
				ResponseBytes: response,
				CompletedAt:   fixedTime().Add(time.Minute),
			}, err
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if first.ExactReplay {
		t.Fatal("first submit was reported as replay")
	}

	expectedResponse := cloneTestBytes(first.Receipt.ResponseBytes)
	first.Receipt.ResponseBytes[0] ^= 0xff
	replayed, err := store.ExecuteSubmit(
		context.Background(),
		command,
		func(
			context.Context,
			PrivateContentTransaction,
			dbmodel.SocialPrivateContentPlan,
		) (SubmitMutationResult, error) {
			calls.Add(1)
			return SubmitMutationResult{},
				errors.New("replay invoked mutation callback")
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.ExactReplay {
		t.Fatal("exact submit replay was not reported")
	}
	assertBytesEqual(t, replayed.Receipt.ResponseBytes, expectedResponse, "response")
	if calls.Load() != 1 {
		t.Fatalf("submit mutation calls = %d", calls.Load())
	}

	conflict := command
	conflict.CanonicalSubmitSHA256 = digest([]byte("different-submit"))
	if _, err := store.ExecuteSubmit(
		context.Background(),
		conflict,
		func(
			context.Context,
			PrivateContentTransaction,
			dbmodel.SocialPrivateContentPlan,
		) (SubmitMutationResult, error) {
			return SubmitMutationResult{
				ResponseBytes: []byte("must-not-run"),
				CompletedAt:   fixedTime().Add(time.Minute),
			}, nil
		},
	); !errors.Is(err, ErrPrivateContentConflict) {
		t.Fatalf("conflicting submit error = %v", err)
	}

	assertCommittedSubmitRows(t, db, PrivateContentResourcePost)
	var persistedPlan dbmodel.SocialPrivateContentPlan
	if err := db.First(&persistedPlan, "plan_id = ?", plan.PlanID).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != dbmodel.SocialPrivatePlanStateConsumed ||
		persistedPlan.DomainCommitID != command.DomainCommitID {
		t.Fatalf("consumed plan = %+v", persistedPlan)
	}
}

func TestGORMPrivateContentStoreAuthorizedPointReadAllowsMissingEndpointEnvelope(
	t *testing.T,
) {
	_, store := openPrivateContentStore(t, "")
	plan := seedPreparedPlan(
		t,
		store,
		"recovery-point-read",
		PrivateContentResourcePost,
	)
	seedUnattachedObject(t, store, plan)
	command := submitCommand(plan, "recovery-point-read")
	if _, err := store.ExecuteSubmit(
		context.Background(),
		command,
		func(
			ctx context.Context,
			tx PrivateContentTransaction,
			locked dbmodel.SocialPrivateContentPlan,
		) (SubmitMutationResult, error) {
			response, err := persistSubmitMutation(
				ctx,
				tx,
				locked,
				"recovery-point-read",
			)
			return SubmitMutationResult{
				ResponseBytes: response,
				CompletedAt:   fixedTime().Add(time.Minute),
			}, err
		},
	); err != nil {
		t.Fatal(err)
	}

	read, err := store.GetPrivatePost(
		context.Background(),
		"post-recovery-point-read",
		"ptid:alice",
		"alice-recovered-device",
	)
	if err != nil {
		t.Fatal(err)
	}
	if read.Envelope != nil {
		t.Fatalf("new device received an unrelated endpoint envelope: %+v", read.Envelope)
	}
	if !bytes.Equal(read.CanonicalPlanSHA256, plan.CanonicalPlanSHA256) {
		t.Fatalf(
			"point read canonical plan hash = %x, want %x",
			read.CanonicalPlanSHA256,
			plan.CanonicalPlanSHA256,
		)
	}
	if read.Post.PostID != "post-recovery-point-read" {
		t.Fatalf("point read post = %+v", read.Post)
	}
}

func TestGORMPrivateContentStoreConcurrentSubmitRunsMutationOnce(t *testing.T) {
	db, store := openPrivateContentStore(t, "")
	plan := seedPreparedPlan(t, store, "submit-race", PrivateContentResourcePost)
	seedUnattachedObject(t, store, plan)
	command := submitCommand(plan, "submit-race")
	var calls atomic.Int32

	const writers = 16
	results := make(chan SubmitResult, writers)
	errs := make(chan error, writers)
	var waitGroup sync.WaitGroup
	for range writers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			result, err := store.ExecuteSubmit(
				context.Background(),
				command,
				func(
					ctx context.Context,
					tx PrivateContentTransaction,
					locked dbmodel.SocialPrivateContentPlan,
				) (SubmitMutationResult, error) {
					calls.Add(1)
					response, err := persistSubmitMutation(
						ctx,
						tx,
						locked,
						"submit-race",
					)
					return SubmitMutationResult{
						ResponseBytes: response,
						CompletedAt:   fixedTime().Add(time.Minute),
					}, err
				},
			)
			if err != nil {
				errs <- err
				return
			}
			results <- result
		}()
	}
	waitGroup.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Errorf("concurrent submit: %v", err)
	}
	var first int
	var replay int
	for result := range results {
		if result.ExactReplay {
			replay++
		} else {
			first++
		}
	}
	if calls.Load() != 1 || first != 1 || replay != writers-1 {
		t.Fatalf(
			"mutation calls=%d first=%d replay=%d",
			calls.Load(),
			first,
			replay,
		)
	}
	assertCommittedSubmitRows(t, db, PrivateContentResourcePost)
}

func TestGORMPrivateContentStoreCommitsRejectedStaleWithoutDomainRows(
	t *testing.T,
) {
	database, store := openPrivateContentStore(t, "")
	plan := seedPreparedPlan(
		t,
		store,
		"submit-stale",
		PrivateContentResourcePost,
	)
	command := submitCommand(plan, "submit-stale")

	_, err := store.ExecuteSubmit(
		context.Background(),
		command,
		func(
			ctx context.Context,
			transaction PrivateContentTransaction,
			_ dbmodel.SocialPrivateContentPlan,
		) (SubmitMutationResult, error) {
			if err := transaction.RejectStale(ctx); err != nil {
				return SubmitMutationResult{}, err
			}
			return SubmitMutationResult{}, nil
		},
	)
	if !errors.Is(err, ErrPrivateContentStalePlan) {
		t.Fatalf("stale submit error = %v", err)
	}

	var persisted dbmodel.SocialPrivateContentPlan
	if err := database.First(
		&persisted,
		"plan_id = ?",
		plan.PlanID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != dbmodel.SocialPrivatePlanStateRejectedStale ||
		persisted.DomainCommitID != "" ||
		persisted.ConsumedAt != nil {
		t.Fatalf("stale plan transition = %+v", persisted)
	}
	for _, model := range []any{
		&dbmodel.SocialPrivateContentPost{},
		&dbmodel.SocialPrivateContentComment{},
		&dbmodel.SocialPrivateAudienceSnapshot{},
		&dbmodel.SocialPrivateRecipientGrant{},
		&dbmodel.SocialPrivateContentEnvelope{},
		&dbmodel.SocialPrivateDeliveryIntent{},
		&dbmodel.SocialPrivateObjectGrant{},
		&dbmodel.SocialPrivateCommitProof{},
		&dbmodel.SocialPrivateCommandReceipt{},
	} {
		assertCount(t, database, model, 0)
	}
}

func TestGORMPrivateContentStoreSubmitFailpointsRollBack(t *testing.T) {
	cases := []struct {
		resourceKind string
		boundaries   []PrivateContentWriteBoundary
	}{
		{
			resourceKind: PrivateContentResourcePost,
			boundaries: append(
				[]PrivateContentWriteBoundary{
					PrivateContentBoundaryPostFact,
				},
				commonSubmitBoundaries()...,
			),
		},
		{
			resourceKind: PrivateContentResourceComment,
			boundaries: append(
				[]PrivateContentWriteBoundary{
					PrivateContentBoundaryCommentFact,
				},
				commonSubmitBoundaries()...,
			),
		},
	}

	for _, testCase := range cases {
		for _, boundary := range testCase.boundaries {
			t.Run(
				testCase.resourceKind+"/"+string(boundary),
				func(t *testing.T) {
					db, store := openPrivateContentStore(t, boundary)
					suffix := stringsForTest(testCase.resourceKind, boundary)
					plan := seedPreparedPlan(
						t,
						store,
						suffix,
						testCase.resourceKind,
					)
					seedUnattachedObject(t, store, plan)
					command := submitCommand(plan, suffix)

					if _, err := store.ExecuteSubmit(
						context.Background(),
						command,
						func(
							ctx context.Context,
							tx PrivateContentTransaction,
							locked dbmodel.SocialPrivateContentPlan,
						) (SubmitMutationResult, error) {
							response, err := persistSubmitMutation(
								ctx,
								tx,
								locked,
								suffix,
							)
							return SubmitMutationResult{
								ResponseBytes: response,
								CompletedAt: fixedTime().
									Add(time.Minute),
							}, err
						},
					); !errors.Is(err, errPrivateContentFailpoint) {
						t.Fatalf("submit failpoint error = %v", err)
					}
					assertSubmitRolledBack(t, db, plan)
				},
			)
		}
	}
}

func commonSubmitBoundaries() []PrivateContentWriteBoundary {
	return []PrivateContentWriteBoundary{
		PrivateContentBoundaryPlanConsumed,
		PrivateContentBoundaryAudienceSnapshot,
		PrivateContentBoundaryRecipientGrants,
		PrivateContentBoundaryEndpointEnvelopes,
		PrivateContentBoundaryRecoveryEnvelopes,
		PrivateContentBoundaryDeliveryIntents,
		PrivateContentBoundaryObjectAttachment,
		PrivateContentBoundaryObjectGrants,
		PrivateContentBoundaryCommitProof,
		PrivateContentBoundaryCommandReceipt,
	}
}

func openPrivateContentStore(
	t *testing.T,
	failAt PrivateContentWriteBoundary,
) (*gorm.DB, *GORMPrivateContentStore) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(
			"file:"+uuid.NewString()+"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close private content database: %v", err)
		}
	})

	options := make([]PrivateContentStoreOption, 0, 1)
	if failAt != "" {
		options = append(
			options,
			WithPrivateContentFailpoint(PrivateContentFailpointFunc(
				func(
					_ context.Context,
					boundary PrivateContentWriteBoundary,
				) error {
					if boundary == failAt {
						return errPrivateContentFailpoint
					}
					return nil
				},
			)),
		)
	}
	store, err := NewGORMPrivateContentStore(db, options...)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return db, store
}

func preparingPlan(
	suffix string,
	resourceKind string,
) dbmodel.SocialPrivateContentPlan {
	prepareBytes := []byte("prepare-" + suffix)
	claimBytes := []byte("claim-" + suffix)
	return dbmodel.SocialPrivateContentPlan{
		PlanID:                  "plan-" + suffix,
		AuthorPTID:              "ptid:alice",
		PrepareCommandID:        "prepare-command-" + suffix,
		ContentID:               "content-" + suffix,
		Generation:              1,
		ResourceKind:            resourceKind,
		AuthorDeviceID:          "alice-device",
		AuthorHomeStationPeerID: "station-local",
		AudienceSnapshotID:      "snapshot-" + suffix,
		AuthorizationSnapshotSHA256: digest(
			[]byte("authorization-snapshot-" + suffix),
		),
		CanonicalPrepareBytes:  prepareBytes,
		CanonicalPrepareSHA256: digest(prepareBytes),
		ClaimRequestBytes:      claimBytes,
		ClaimRequestSHA256:     digest(claimBytes),
		State:                  dbmodel.SocialPrivatePlanStatePreparing,
		ExpiresAt:              fixedTime().Add(time.Hour),
	}
}

func preparedPlan(plan dbmodel.SocialPrivateContentPlan) PreparedPlan {
	claimResponse := []byte("claim-response-" + plan.PlanID)
	signedPlan := []byte("signed-plan-" + plan.PlanID)
	return PreparedPlan{
		PlanID:                 plan.PlanID,
		CanonicalPrepareSHA256: cloneTestBytes(plan.CanonicalPrepareSHA256),
		ClaimResponseBytes:     claimResponse,
		ClaimResponseSHA256:    digest(claimResponse),
		CanonicalPlanSHA256:    digest([]byte("canonical-" + plan.PlanID)),
		SignedPlanBytes:        signedPlan,
		SignedPlanSHA256:       digest(signedPlan),
		Slots: []dbmodel.SocialPrivateContentPlanSlot{
			{
				RecipientSlotID:    "slot-1",
				ClaimID:            "claim-endpoint-" + plan.PlanID,
				OneTimeKeyID:       "key-endpoint-" + plan.PlanID,
				KeyKind:            PrivateContentKeyKindEndpoint,
				RecipientPTID:      "ptid:bob",
				RecipientDeviceID:  "bob-device",
				PrincipalEpoch:     7,
				ClaimedPreKeyBytes: []byte("endpoint-prekey-" + plan.PlanID),
				ClaimedPreKeySHA256: digest(
					[]byte("endpoint-prekey-" + plan.PlanID),
				),
				PrincipalBindingSHA256: digest(
					[]byte("endpoint-binding-" + plan.PlanID),
				),
				CreatedAt: fixedTime(),
			},
			{
				RecipientSlotID:    "slot-2",
				ClaimID:            "claim-recovery-" + plan.PlanID,
				OneTimeKeyID:       "key-recovery-" + plan.PlanID,
				KeyKind:            PrivateContentKeyKindActorRecovery,
				RecipientPTID:      "ptid:bob",
				PrincipalEpoch:     11,
				ClaimedPreKeyBytes: []byte("recovery-prekey-" + plan.PlanID),
				ClaimedPreKeySHA256: digest(
					[]byte("recovery-prekey-" + plan.PlanID),
				),
				PrincipalBindingSHA256: digest(
					[]byte("recovery-binding-" + plan.PlanID),
				),
				CreatedAt: fixedTime(),
			},
		},
		PreparedAt: fixedTime(),
	}
}

func seedPreparedPlan(
	t *testing.T,
	store *GORMPrivateContentStore,
	suffix string,
	resourceKind string,
) dbmodel.SocialPrivateContentPlan {
	t.Helper()
	candidate := preparingPlan(suffix, resourceKind)
	if _, err := store.ClaimPreparing(context.Background(), candidate); err != nil {
		t.Fatal(err)
	}
	prepared, err := store.MarkPrepared(
		context.Background(),
		preparedPlan(candidate),
	)
	if err != nil {
		t.Fatal(err)
	}
	return prepared.Plan
}

func seedUnattachedObject(
	t *testing.T,
	store *GORMPrivateContentStore,
	plan dbmodel.SocialPrivateContentPlan,
) {
	t.Helper()
	descriptor := []byte("descriptor-" + plan.PlanID)
	uploadSpec := []byte("upload-spec-" + plan.PlanID)
	beginCommand := []byte("begin-command-" + plan.PlanID)
	upload := dbmodel.SocialPrivateObjectUpload{
		UploadID:                   "upload-" + plan.PlanID,
		Generation:                 plan.Generation,
		PlanID:                     plan.PlanID,
		ObjectID:                   "object-" + plan.PlanID,
		ContentID:                  plan.ContentID,
		UploaderPTID:               plan.AuthorPTID,
		UploaderDeviceID:           plan.AuthorDeviceID,
		UploadSpecBytes:            uploadSpec,
		UploadSpecSHA256:           digest(uploadSpec),
		DescriptorCommitmentSHA256: digest(descriptor),
		BeginCommandID:             "begin-command-" + plan.PlanID,
		BeginCommandBytes:          beginCommand,
		BeginCommandSHA256:         digest(beginCommand),
		ReceivedChunkBitmap:        []byte{1},
		State:                      dbmodel.SocialPrivateObjectCompleteUnattached,
		ExpiresAt:                  fixedTime().Add(time.Hour),
		CreatedAt:                  fixedTime(),
		UpdatedAt:                  fixedTime(),
	}
	if err := store.db.Create(&upload).Error; err != nil {
		t.Fatal(err)
	}
	chunkBytes := []byte("chunk-" + plan.PlanID)
	chunk := dbmodel.SocialPrivateObjectChunk{
		UploadID:         upload.UploadID,
		Generation:       upload.Generation,
		ChunkIndex:       0,
		Offset:           0,
		Size:             uint64(len(chunkBytes)),
		CiphertextSHA256: digest(chunkBytes),
		IdempotencyKey:   "part-command-" + plan.PlanID,
		CanonicalCommandSHA256: digest(
			[]byte("part-command-" + plan.PlanID),
		),
		StorageKey: "private/" + plan.PlanID + "/0",
		State:      dbmodel.SocialPrivateObjectPartStored,
		CreatedAt:  fixedTime(),
		UpdatedAt:  fixedTime(),
	}
	if err := store.db.Create(&chunk).Error; err != nil {
		t.Fatal(err)
	}
	object := dbmodel.SocialPrivateObjectAttachment{
		ObjectID:                 "object-" + plan.PlanID,
		UploadID:                 upload.UploadID,
		UploadGeneration:         upload.Generation,
		ContentID:                plan.ContentID,
		UploaderPTID:             plan.AuthorPTID,
		UploaderDeviceID:         plan.AuthorDeviceID,
		CanonicalDescriptorBytes: descriptor,
		DescriptorSHA256:         digest(descriptor),
		StorageKey:               "private/" + plan.PlanID + "/object",
		TotalCiphertextSize:      uint64(len(chunkBytes)),
		CiphertextSHA256:         digest(chunkBytes),
		State:                    dbmodel.SocialPrivateObjectCompleteUnattached,
		CreatedAt:                fixedTime(),
		UpdatedAt:                fixedTime(),
		ExpiresAt:                fixedTime().Add(time.Hour),
	}
	if err := store.db.Create(&object).Error; err != nil {
		t.Fatal(err)
	}
}

func submitCommand(
	plan dbmodel.SocialPrivateContentPlan,
	suffix string,
) SubmitCommand {
	return SubmitCommand{
		PlanID:                plan.PlanID,
		AuthorPTID:            plan.AuthorPTID,
		CommandID:             "submit-command-" + suffix,
		CanonicalSubmitSHA256: digest([]byte("submit-" + suffix)),
		DomainCommitID:        "commit-" + suffix,
	}
}

func persistSubmitMutation(
	ctx context.Context,
	tx PrivateContentTransaction,
	plan dbmodel.SocialPrivateContentPlan,
	suffix string,
) ([]byte, error) {
	payload := []byte("ciphertext-" + suffix)
	resourceID := ""
	switch plan.ResourceKind {
	case PrivateContentResourcePost:
		resourceID = "post-" + suffix
		if err := tx.CreatePost(ctx, dbmodel.SocialPrivateContentPost{
			PostID:                    resourceID,
			ContentID:                 plan.ContentID,
			AuthorPTID:                plan.AuthorPTID,
			Generation:                plan.Generation,
			AudienceSnapshotID:        plan.AudienceSnapshotID,
			Kind:                      "TEXT",
			EncryptedPayloadBytes:     payload,
			EncryptedPayloadSHA256:    digest(payload),
			ObjectDescriptorSetSHA256: digest([]byte("objects-" + suffix)),
			MentionRoutingSHA256:      digest([]byte("mentions-" + suffix)),
			LifecycleState:            "ACTIVE",
			CreatedAt:                 fixedTime(),
			UpdatedAt:                 fixedTime(),
		}); err != nil {
			return nil, err
		}
	case PrivateContentResourceComment:
		resourceID = "comment-" + suffix
		if err := tx.CreateComment(ctx, dbmodel.SocialPrivateContentComment{
			CommentID:                 resourceID,
			ContentID:                 plan.ContentID,
			PostID:                    "parent-post-" + suffix,
			AuthorPTID:                plan.AuthorPTID,
			Generation:                plan.Generation,
			InteractionSnapshotID:     plan.AudienceSnapshotID,
			EncryptedPayloadBytes:     payload,
			EncryptedPayloadSHA256:    digest(payload),
			ObjectDescriptorSetSHA256: digest([]byte("objects-" + suffix)),
			MentionRoutingSHA256:      digest([]byte("mentions-" + suffix)),
			LifecycleState:            "ACTIVE",
			CreatedAt:                 fixedTime(),
			UpdatedAt:                 fixedTime(),
		}); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unexpected resource kind %q", plan.ResourceKind)
	}

	if err := tx.CreateAudienceSnapshot(
		ctx,
		dbmodel.SocialPrivateAudienceSnapshot{
			SnapshotID:     plan.AudienceSnapshotID,
			ResourceKind:   plan.ResourceKind,
			ResourceID:     resourceID,
			PostID:         postIDForResource(plan.ResourceKind, suffix),
			AudienceKind:   "FRIENDS",
			SourceRevision: 23,
			CanonicalSnapshotSHA256: digest(
				[]byte("snapshot-" + suffix),
			),
			CreatedAt: fixedTime(),
		},
	); err != nil {
		return nil, err
	}
	if err := tx.CreateRecipientGrants(
		ctx,
		[]dbmodel.SocialPrivateRecipientGrant{
			{
				SnapshotID:    plan.AudienceSnapshotID,
				RecipientPTID: "ptid:bob",
				GrantedAt:     fixedTime(),
			},
		},
	); err != nil {
		return nil, err
	}

	prepared := preparedPlan(preparingPlan(suffix, plan.ResourceKind))
	endpointEnvelope := []byte("endpoint-envelope-" + suffix)
	recoveryEnvelope := []byte("recovery-envelope-" + suffix)
	if err := tx.CreateEnvelopes(
		ctx,
		[]dbmodel.SocialPrivateContentEnvelope{
			{
				ContentID:             plan.ContentID,
				KeyKind:               PrivateContentKeyKindEndpoint,
				RecipientPTID:         "ptid:bob",
				RecipientDeviceID:     "bob-device",
				OneTimeKeyID:          prepared.Slots[0].OneTimeKeyID,
				PlanID:                plan.PlanID,
				RecipientSlotID:       prepared.Slots[0].RecipientSlotID,
				PrincipalEpoch:        prepared.Slots[0].PrincipalEpoch,
				PreparedEnvelopeBytes: endpointEnvelope,
				CanonicalPlanSHA256:   plan.CanonicalPlanSHA256,
				PrincipalBindingSHA256: prepared.Slots[0].
					PrincipalBindingSHA256,
				BindingSHA256: digest(
					[]byte("endpoint-envelope-binding-" + suffix),
				),
				EnvelopeSHA256:        digest(endpointEnvelope),
				SenderSignatureSHA256: digest([]byte("endpoint-signature-" + suffix)),
				CreatedAt:             fixedTime(),
			},
			{
				ContentID:             plan.ContentID,
				KeyKind:               PrivateContentKeyKindActorRecovery,
				RecipientPTID:         "ptid:bob",
				OneTimeKeyID:          prepared.Slots[1].OneTimeKeyID,
				PlanID:                plan.PlanID,
				RecipientSlotID:       prepared.Slots[1].RecipientSlotID,
				PrincipalEpoch:        prepared.Slots[1].PrincipalEpoch,
				PreparedEnvelopeBytes: recoveryEnvelope,
				CanonicalPlanSHA256:   plan.CanonicalPlanSHA256,
				PrincipalBindingSHA256: prepared.Slots[1].
					PrincipalBindingSHA256,
				BindingSHA256: digest(
					[]byte("recovery-envelope-binding-" + suffix),
				),
				EnvelopeSHA256:        digest(recoveryEnvelope),
				SenderSignatureSHA256: digest([]byte("recovery-signature-" + suffix)),
				CreatedAt:             fixedTime(),
			},
		},
	); err != nil {
		return nil, err
	}

	deliveryPayload := []byte("opaque-delivery-" + suffix)
	domainCommitID := "commit-" + suffix
	if err := tx.CreateDeliveryIntents(
		ctx,
		[]dbmodel.SocialPrivateDeliveryIntent{
			{
				IntentID:          "delivery-" + suffix,
				ContentID:         plan.ContentID,
				DomainCommitID:    domainCommitID,
				RecipientPTID:     "ptid:bob",
				RecipientDeviceID: "bob-device",
				IdempotencyKey:    "delivery-key-" + suffix,
				OpaquePayload:     deliveryPayload,
				PayloadSHA256:     digest(deliveryPayload),
				State:             dbmodel.SocialPrivateDeliveryIntentStatePending,
				CreatedAt:         fixedTime(),
			},
		},
	); err != nil {
		return nil, err
	}

	descriptor := []byte("descriptor-" + plan.PlanID)
	if err := tx.AttachObjects(
		ctx,
		[]PrivateObjectAttachment{
			{
				ObjectID:         "object-" + plan.PlanID,
				ContentID:        plan.ContentID,
				DescriptorSHA256: digest(descriptor),
				DomainCommitID:   domainCommitID,
				AttachedAt:       fixedTime(),
			},
		},
	); err != nil {
		return nil, err
	}
	if err := tx.CreateObjectGrants(
		ctx,
		[]dbmodel.SocialPrivateObjectGrant{
			{
				ObjectID:       "object-" + plan.PlanID,
				PrincipalKind:  "ACTOR",
				PrincipalPTID:  "ptid:bob",
				DomainCommitID: domainCommitID,
				GrantedAt:      fixedTime(),
			},
		},
	); err != nil {
		return nil, err
	}

	proof := []byte("commit-proof-" + suffix)
	if err := tx.CreateCommitProof(
		ctx,
		dbmodel.SocialPrivateCommitProof{
			ContentID:            plan.ContentID,
			Generation:           plan.Generation,
			DomainCommitID:       domainCommitID,
			ResourceKind:         plan.ResourceKind,
			CanonicalProofBytes:  proof,
			CanonicalProofSHA256: digest(proof),
			StationSigningKeyID:  "station-signing-key",
			CommittedAt:          fixedTime(),
		},
	); err != nil {
		return nil, err
	}
	return []byte("response-" + suffix), nil
}

func postIDForResource(resourceKind string, suffix string) string {
	if resourceKind == PrivateContentResourcePost {
		return "post-" + suffix
	}
	return "parent-post-" + suffix
}

func assertCommittedSubmitRows(
	t *testing.T,
	db *gorm.DB,
	resourceKind string,
) {
	t.Helper()
	if resourceKind == PrivateContentResourcePost {
		assertCount(t, db, &dbmodel.SocialPrivateContentPost{}, 1)
		assertCount(t, db, &dbmodel.SocialPrivateContentComment{}, 0)
	} else {
		assertCount(t, db, &dbmodel.SocialPrivateContentPost{}, 0)
		assertCount(t, db, &dbmodel.SocialPrivateContentComment{}, 1)
	}
	for _, model := range []any{
		&dbmodel.SocialPrivateAudienceSnapshot{},
		&dbmodel.SocialPrivateRecipientGrant{},
		&dbmodel.SocialPrivateDeliveryIntent{},
		&dbmodel.SocialPrivateObjectGrant{},
		&dbmodel.SocialPrivateCommitProof{},
		&dbmodel.SocialPrivateCommandReceipt{},
	} {
		assertCount(t, db, model, 1)
	}
	assertCount(t, db, &dbmodel.SocialPrivateContentEnvelope{}, 2)
	var object dbmodel.SocialPrivateObjectAttachment
	if err := db.First(&object).Error; err != nil {
		t.Fatal(err)
	}
	if object.State != dbmodel.SocialPrivateObjectAttached ||
		object.DomainCommitID == "" ||
		object.AttachedAt == nil {
		t.Fatalf("object was not attached atomically: %+v", object)
	}
}

func assertSubmitRolledBack(
	t *testing.T,
	db *gorm.DB,
	plan dbmodel.SocialPrivateContentPlan,
) {
	t.Helper()
	for _, model := range []any{
		&dbmodel.SocialPrivateContentPost{},
		&dbmodel.SocialPrivateContentComment{},
		&dbmodel.SocialPrivateAudienceSnapshot{},
		&dbmodel.SocialPrivateRecipientGrant{},
		&dbmodel.SocialPrivateContentEnvelope{},
		&dbmodel.SocialPrivateDeliveryIntent{},
		&dbmodel.SocialPrivateObjectGrant{},
		&dbmodel.SocialPrivateCommitProof{},
		&dbmodel.SocialPrivateCommandReceipt{},
	} {
		assertCount(t, db, model, 0)
	}

	var persistedPlan dbmodel.SocialPrivateContentPlan
	if err := db.First(&persistedPlan, "plan_id = ?", plan.PlanID).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != dbmodel.SocialPrivatePlanStatePrepared ||
		persistedPlan.DomainCommitID != "" ||
		persistedPlan.ConsumedAt != nil {
		t.Fatalf("submit left a partially consumed plan: %+v", persistedPlan)
	}

	var object dbmodel.SocialPrivateObjectAttachment
	if err := db.First(&object, "content_id = ?", plan.ContentID).Error; err != nil {
		t.Fatal(err)
	}
	if object.State != dbmodel.SocialPrivateObjectCompleteUnattached ||
		object.DomainCommitID != "" ||
		object.AttachedAt != nil {
		t.Fatalf("submit left a partially attached object: %+v", object)
	}
}

func assertCount(t *testing.T, db *gorm.DB, model any, expected int64) {
	t.Helper()
	var actual int64
	if err := db.Model(model).Count(&actual).Error; err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%T row count = %d, want %d", model, actual, expected)
	}
}

func assertBytesEqual(t *testing.T, actual, expected []byte, name string) {
	t.Helper()
	if !bytes.Equal(actual, expected) {
		t.Fatalf("%s = %x, want %x", name, actual, expected)
	}
}

func digest(value []byte) []byte {
	sum := sha256.Sum256(value)
	return cloneTestBytes(sum[:])
}

func cloneTestBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

func fixedTime() time.Time {
	return time.Date(2026, time.September, 14, 9, 30, 0, 0, time.UTC)
}

func stringsForTest(
	resourceKind string,
	boundary PrivateContentWriteBoundary,
) string {
	return strings.ToLower(resourceKind) + "-" +
		strings.ReplaceAll(string(boundary), "_", "-")
}
