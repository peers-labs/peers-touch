package infrastructure

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
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var errPrivateCommentAdmissionLimited = errors.New(
	"private Comment admission limited",
)

func TestGORMPrivateContentStorePostgresPrivateCommentAdmissionLocksParent(
	t *testing.T,
) {
	const (
		actorLimit = 30
		postLimit  = 600
	)
	for _, testCase := range []struct {
		name       string
		limit      int
		authorPTID func(int) string
	}{
		{
			name:  "actor per Post",
			limit: actorLimit,
			authorPTID: func(int) string {
				return "ptid:alice"
			},
		},
		{
			name:  "Post total",
			limit: postLimit,
			authorPTID: func(index int) string {
				return fmt.Sprintf("ptid:other-%d", index)
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			database, store := openPrivateContentStorePostgres(t)
			postID := "parent-" + strings.ReplaceAll(
				strings.ToLower(testCase.name),
				" ",
				"-",
			)
			seedPrivateCommentAdmissionWindow(
				t,
				database,
				postID,
				testCase.limit-1,
				testCase.authorPTID,
			)
			plans := []dbmodel.SocialPrivateContentPlan{
				seedPreparedPlan(
					t,
					store,
					postID+"-a",
					PrivateContentResourceComment,
				),
				seedPreparedPlan(
					t,
					store,
					postID+"-b",
					PrivateContentResourceComment,
				),
			}

			ready := make(chan struct{}, len(plans))
			release := make(chan struct{})
			results := make(chan error, len(plans))
			for _, plan := range plans {
				plan := plan
				go func() {
					results <- admitPrivateComment(
						context.Background(),
						store,
						plan,
						postID,
						fixedTime(),
						actorLimit,
						postLimit,
						ready,
						release,
					)
				}()
			}
			for range plans {
				select {
				case <-ready:
				case <-time.After(10 * time.Second):
					t.Fatal(
						"concurrent submits did not both reach the parent-lock boundary",
					)
				}
			}
			close(release)

			var admitted, limited int
			for range plans {
				select {
				case err := <-results:
					switch {
					case err == nil:
						admitted++
					case errors.Is(
						err,
						errPrivateCommentAdmissionLimited,
					):
						limited++
					default:
						t.Fatalf("concurrent admission error = %v", err)
					}
				case <-time.After(10 * time.Second):
					t.Fatal("concurrent admission did not complete")
				}
			}
			if admitted != 1 || limited != 1 {
				t.Fatalf(
					"concurrent admission admitted/limited = %d/%d, want 1/1",
					admitted,
					limited,
				)
			}

			assertPrivateCommentAdmissionCount(
				t,
				database,
				postID,
				int64(testCase.limit),
			)
			var consumed, prepared int64
			if err := database.Model(
				&dbmodel.SocialPrivateContentPlan{},
			).Where(
				"plan_id IN ? AND state = ?",
				[]string{plans[0].PlanID, plans[1].PlanID},
				dbmodel.SocialPrivatePlanStateConsumed,
			).Count(&consumed).Error; err != nil {
				t.Fatal(err)
			}
			if err := database.Model(
				&dbmodel.SocialPrivateContentPlan{},
			).Where(
				"plan_id IN ? AND state = ?",
				[]string{plans[0].PlanID, plans[1].PlanID},
				dbmodel.SocialPrivatePlanStatePrepared,
			).Count(&prepared).Error; err != nil {
				t.Fatal(err)
			}
			if consumed != 1 || prepared != 1 {
				t.Fatalf(
					"concurrent plan states consumed/prepared = %d/%d, want 1/1",
					consumed,
					prepared,
				)
			}
		})
	}
}

func admitPrivateComment(
	ctx context.Context,
	store *GORMPrivateContentStore,
	plan dbmodel.SocialPrivateContentPlan,
	postID string,
	admittedAt time.Time,
	actorLimit int64,
	postLimit int64,
	ready chan<- struct{},
	release <-chan struct{},
) error {
	_, err := store.ExecuteSubmit(
		ctx,
		submitCommand(plan, plan.PlanID),
		func(
			ctx context.Context,
			tx PrivateContentTransaction,
			locked dbmodel.SocialPrivateContentPlan,
		) (SubmitMutationResult, error) {
			ready <- struct{}{}
			<-release
			retryAfter, err := tx.PrivateCommentRetryAfter(
				ctx,
				postID,
				locked.AuthorPTID,
				admittedAt,
				time.Hour,
				actorLimit,
				postLimit,
			)
			if err != nil {
				return SubmitMutationResult{}, err
			}
			if retryAfter > 0 {
				return SubmitMutationResult{}, fmt.Errorf(
					"%w: retry after %s",
					errPrivateCommentAdmissionLimited,
					retryAfter,
				)
			}
			payload := []byte("payload-" + locked.ContentID)
			if err := tx.CreateComment(
				ctx,
				dbmodel.SocialPrivateContentComment{
					CommentID:                 "comment-" + locked.ContentID,
					ContentID:                 locked.ContentID,
					PostID:                    postID,
					AuthorPTID:                locked.AuthorPTID,
					Generation:                locked.Generation,
					InteractionSnapshotID:     locked.AudienceSnapshotID,
					EncryptedPayloadBytes:     payload,
					EncryptedPayloadSHA256:    digest(payload),
					ObjectDescriptorSetSHA256: digest([]byte("objects")),
					LifecycleState:            privateContentLifecycleActive,
					CreatedAt:                 admittedAt,
					UpdatedAt:                 admittedAt,
				},
			); err != nil {
				return SubmitMutationResult{}, err
			}
			return SubmitMutationResult{
				ResponseBytes: []byte("response-" + locked.ContentID),
				CompletedAt:   admittedAt,
			}, nil
		},
	)
	return err
}

func seedPrivateCommentAdmissionWindow(
	t *testing.T,
	database *gorm.DB,
	postID string,
	count int,
	authorPTID func(int) string,
) {
	t.Helper()
	payload := []byte("parent-" + postID)
	if err := database.Create(&dbmodel.SocialPrivateContentPost{
		PostID:                    postID,
		ContentID:                 "content-" + postID,
		AuthorPTID:                "ptid:parent",
		Generation:                1,
		AudienceSnapshotID:        "snapshot-" + postID,
		Kind:                      "TEXT",
		EncryptedPayloadBytes:     payload,
		EncryptedPayloadSHA256:    digest(payload),
		ObjectDescriptorSetSHA256: digest([]byte("parent-objects")),
		LifecycleState:            privateContentLifecycleActive,
		CommentsCount:             int64(count),
		CreatedAt:                 fixedTime().Add(-time.Hour),
		UpdatedAt:                 fixedTime(),
	}).Error; err != nil {
		t.Fatal(err)
	}

	comments := make(
		[]dbmodel.SocialPrivateContentComment,
		0,
		count,
	)
	for index := range count {
		commentID := fmt.Sprintf("%s-seed-%04d", postID, index)
		comments = append(
			comments,
			dbmodel.SocialPrivateContentComment{
				CommentID:                 commentID,
				ContentID:                 "content-" + commentID,
				PostID:                    postID,
				AuthorPTID:                authorPTID(index),
				Generation:                1,
				InteractionSnapshotID:     "snapshot-" + commentID,
				EncryptedPayloadBytes:     []byte("payload"),
				EncryptedPayloadSHA256:    digest([]byte("payload")),
				ObjectDescriptorSetSHA256: digest([]byte("objects")),
				LifecycleState:            privateContentLifecycleActive,
				CreatedAt: fixedTime().
					Add(-time.Minute).
					Add(time.Duration(index)),
				UpdatedAt: fixedTime(),
			},
		)
	}
	if err := database.CreateInBatches(comments, 100).Error; err != nil {
		t.Fatal(err)
	}
}

func assertPrivateCommentAdmissionCount(
	t *testing.T,
	database *gorm.DB,
	postID string,
	want int64,
) {
	t.Helper()
	var comments int64
	if err := database.Model(
		&dbmodel.SocialPrivateContentComment{},
	).Where("post_id = ?", postID).Count(&comments).Error; err != nil {
		t.Fatal(err)
	}
	var parent dbmodel.SocialPrivateContentPost
	if err := database.First(
		&parent,
		"post_id = ?",
		postID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if comments != want || parent.CommentsCount != want {
		t.Fatalf(
			"Comment rows/parent count = %d/%d, want %d/%d",
			comments,
			parent.CommentsCount,
			want,
			want,
		)
	}
}

func TestSecureContentResetPostgresRebuildsLegacyPrivatePostSchema(
	t *testing.T,
) {
	database, _ := openPrivateContentStorePostgres(t)
	if err := database.AutoMigrate(
		&dbmodel.SocialPublicPost{},
		&dbmodel.SocialComment{},
		&dbmodel.SocialReaction{},
		&dbmodel.SocialMomentDelivery{},
		&dbmodel.Actor{},
	); err != nil {
		t.Fatal(err)
	}
	for _, definition := range []string{
		`id BIGINT NOT NULL`,
		`author_id BIGINT NOT NULL`,
		`type VARCHAR(32) NOT NULL`,
		`audience_kind VARCHAR(32) NOT NULL`,
	} {
		if err := database.Exec(
			`ALTER TABLE social_private_posts ADD COLUMN ` + definition,
		).Error; err != nil {
			t.Fatal(err)
		}
	}

	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	canonical := dbmodel.SocialPrivateContentPost{
		PostID:                    "canonical-post",
		ContentID:                 "canonical-content",
		AuthorPTID:                "ptid:alice",
		Generation:                1,
		AudienceSnapshotID:        "snapshot-1",
		Kind:                      "TEXT",
		EncryptedPayloadBytes:     []byte("ciphertext"),
		EncryptedPayloadSHA256:    make([]byte, 32),
		ObjectDescriptorSetSHA256: make([]byte, 32),
		LifecycleState:            "ACTIVE",
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}
	if err := database.Create(&canonical).Error; err == nil {
		t.Fatal("canonical insert unexpectedly passed against legacy NOT NULL columns")
	}

	resetStore, err := NewGORMSecureContentResetStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := resetStore.MigrateControlSchema(context.Background()); err != nil {
		t.Fatal(err)
	}
	prepared, err := resetStore.PrepareManifest(
		context.Background(),
		resetScopeFixture(),
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := resetStore.SaveAuditedManifest(
		context.Background(),
		prepared,
	); err != nil {
		t.Fatal(err)
	}
	invocation := resetInvocationFixture(prepared.Manifest, now)
	if _, replay, err := resetStore.AcceptInvocation(
		context.Background(),
		invocation,
		&prepared,
		now,
	); err != nil || replay {
		t.Fatalf("AcceptInvocation() replay=%v error=%v", replay, err)
	}
	if err := resetStore.CommitDatabase(
		context.Background(),
		prepared.Manifest.ResetID,
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}

	canonical.PostID = "canonical-post-after-reset"
	canonical.ContentID = "canonical-content-after-reset"
	if err := database.Create(&canonical).Error; err != nil {
		t.Fatalf("canonical insert after reset: %v", err)
	}
}

func openPrivateContentStorePostgres(
	t *testing.T,
) (*gorm.DB, *GORMPrivateContentStore) {
	t.Helper()
	dsn := os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("MESSAGING_TEST_POSTGRES_DSN is not configured")
	}

	admin, err := gorm.Open(
		postgres.Open(dsn),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatalf("open PostgreSQL test database: %v", err)
	}
	schema := "social_comment_admission_" +
		strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create isolated PostgreSQL schema: %v", err)
	}
	isolated, err := gorm.Open(
		postgres.Open(
			privateContentPostgresDSNWithSearchPath(t, dsn, schema),
		),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
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

	store, err := NewGORMPrivateContentStore(isolated)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return isolated, store
}

func privateContentPostgresDSNWithSearchPath(
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
