package attachment_test

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	attachmentapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	attachmentinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	conversationpersistence "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestPostgresActorUploadQuotaUsesCanonicalIdentityLock(t *testing.T) {
	database := openAttachmentPostgres(t)
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(16)

	repository, err := attachmentinfra.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&actoridentity.ActorIdentityModel{},
		&actoridentity.ActorDeviceModel{},
		&conversationpersistence.ConversationModel{},
		&conversationpersistence.ConversationMemberModel{},
		&conversationpersistence.ConversationMemberDeviceModel{},
	); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, time.September, 7, 10, 0, 0, 0, time.UTC)
	actor := valueobject.PTID("ptid:postgres-quota")
	if err := database.Create(&actoridentity.ActorIdentityModel{
		PTID:           string(actor),
		PublicKey:      bytes.Repeat([]byte{0x41}, 32),
		Fingerprint:    bytes.Repeat([]byte{0x42}, 32),
		ProfileVersion: 1,
		CreatedAt:      now.Add(-time.Hour),
		UpdatedAt:      now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}

	const contenders = 12
	for index := 0; index < contenders; index++ {
		seedPostgresQuotaAuthorization(t, database, actor, index, now)
	}

	lockReady := make(chan struct{})
	releaseLock := make(chan struct{})
	lockResult := make(chan error, 1)
	go func() {
		lockResult <- database.Transaction(func(tx *gorm.DB) error {
			var identity actoridentity.ActorIdentityModel
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Select("ptid").
				Where("ptid = ?", string(actor)).
				First(&identity).Error; err != nil {
				return err
			}
			close(lockReady)
			<-releaseLock

			return nil
		})
	}()
	<-lockReady

	start := make(chan struct{})
	results := make(chan error, contenders)
	var workers sync.WaitGroup
	for index := 0; index < contenders; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			<-start
			endpoint := valueobject.Endpoint{
				Actor:  actor,
				Device: valueobject.DeviceID(fmt.Sprintf("device-%02d", index)),
			}
			conversationID := valueobject.ConversationID(
				fmt.Sprintf("conversation-%02d", index),
			)
			hash := valueobject.HashBytes([]byte(fmt.Sprintf("ciphertext-%02d", index)))
			createdAt := now.Add(time.Duration(index) * time.Microsecond)
			upload := attachmentapp.Upload{
				UploadID:       fmt.Sprintf("upload-%02d", index),
				Generation:     1,
				ConversationID: conversationID,
				MessageID: valueobject.MessageID(
					fmt.Sprintf("message-%02d", index),
				),
				AttachmentID: fmt.Sprintf("attachment-%02d", index),
				Uploader:     endpoint,
				Spec: attachmentapp.UploadSpec{
					CiphertextSize: uint64(attachmentapp.TagSize + 1),
					CiphertextHash: hash,
					MediaType:      "application/octet-stream",
					ChunkSize:      attachmentapp.ChunkSize,
					ChunkCount:     1,
					Encryption:     attachmentapp.EncryptionSuiteAES256GCMChunked,
					TagSize:        attachmentapp.TagSize,
					NonceStrategy:  attachmentapp.NonceStrategyCounter32BE,
					ChunkHashes:    []valueobject.Hash{hash},
				},
				DescriptorCommitment: valueobject.HashBytes(
					[]byte(fmt.Sprintf("descriptor-%02d", index)),
				),
				IdempotencyKey:       fmt.Sprintf("idempotency-%02d", index),
				State:                attachmentapp.TransferStateQueued,
				ReceivedChunkBitmap:  []byte{0},
				ExpiresAt:            createdAt.Add(time.Hour),
				CleanupNextAttemptAt: createdAt.Add(time.Hour),
				CreatedAt:            createdAt,
				UpdatedAt:            createdAt,
			}
			audit := attachmentapp.AuditRecord{
				AuditID:        fmt.Sprintf("audit-%02d", index),
				Action:         attachmentapp.AuditActionBegin,
				Outcome:        attachmentapp.AuditOutcomeCommitted,
				ConversationID: conversationID,
				MessageID:      upload.MessageID,
				AttachmentID:   upload.AttachmentID,
				UploadID:       upload.UploadID,
				Actor:          actor,
				Device:         endpoint.Device,
				ByteCount:      upload.Spec.CiphertextSize,
				CreatedAt:      createdAt,
			}
			results <- repository.ExecuteAuthorizedMutation(
				context.Background(),
				attachmentapp.MutationAuthorization{
					ConversationID: conversationID,
					Endpoint:       endpoint,
				},
				"attachment.postgres_quota_test",
				func(transaction attachmentapp.Repository) error {
					_, _, createErr := transaction.CreateUpload(
						context.Background(),
						upload,
						attachmentapp.MaximumActiveUploadCount,
						attachmentapp.MaximumMessageObjects,
						audit,
					)

					return createErr
				},
			)
		}(index)
	}
	close(start)
	select {
	case early := <-results:
		close(releaseLock)
		t.Fatalf("upload admission bypassed the actor identity lock: %v", early)
	case <-time.After(100 * time.Millisecond):
	}
	close(releaseLock)
	if err := <-lockResult; err != nil {
		t.Fatalf("release actor identity lock: %v", err)
	}
	workers.Wait()
	close(results)

	var admitted int
	var rejected int
	for err := range results {
		switch {
		case err == nil:
			admitted++
		case attachmentapp.IsCode(err, attachmentapp.ErrorCodeQuotaExceeded):
			rejected++
		default:
			t.Fatalf("unexpected concurrent quota result: %v", err)
		}
	}
	if admitted != attachmentapp.MaximumActiveUploadCount ||
		rejected != contenders-attachmentapp.MaximumActiveUploadCount {
		t.Fatalf("actor quota admitted=%d rejected=%d", admitted, rejected)
	}
	var persisted int64
	if err := database.Model(&attachmentinfra.UploadModel{}).
		Where("uploader_ptid = ?", string(actor)).
		Count(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted != attachmentapp.MaximumActiveUploadCount {
		t.Fatalf("persisted active uploads = %d", persisted)
	}
}

func seedPostgresQuotaAuthorization(
	t *testing.T,
	database *gorm.DB,
	actor valueobject.PTID,
	index int,
	now time.Time,
) {
	t.Helper()
	conversationID := fmt.Sprintf("conversation-%02d", index)
	deviceID := fmt.Sprintf("device-%02d", index)
	if err := database.Create(&conversationpersistence.ConversationModel{
		ConversationID:         conversationID,
		Kind:                   string(valueobject.ConversationKindGroup),
		Status:                 string(valueobject.ConversationStatusActive),
		FederationID:           "federation-1",
		AuthorityStationPeerID: "station:local",
		AuthorityEpoch:         1,
		OwnerPTID:              string(actor),
		CreatedAt:              now.Add(-time.Hour),
		UpdatedAt:              now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&conversationpersistence.ConversationMemberModel{
		ConversationID: conversationID,
		PTID:           string(actor),
		Role:           string(valueobject.MemberRoleOwner),
		Status:         string(valueobject.MemberStatusActive),
		HomeStation:    "station:local",
		JoinedSequence: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&conversationpersistence.ConversationMemberDeviceModel{
		ConversationID: conversationID,
		PTID:           string(actor),
		DeviceID:       deviceID,
		HomeStation:    "station:local",
		Active:         true,
		JoinedSequence: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&actoridentity.ActorDeviceModel{
		PTID:               string(actor),
		ActorAccount:       string(actor),
		ActorKind:          1,
		DeviceID:           deviceID,
		Label:              "quota-test-device",
		HomeStationPeerID:  "station:local",
		SigningKeyID:       fmt.Sprintf("signing-key-%02d", index),
		PublicKey:          bytes.Repeat([]byte{byte(index + 1)}, 32),
		ProfileVersion:     1,
		VerificationSource: 1,
		CreatedAt:          now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func openAttachmentPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("MESSAGING_TEST_POSTGRES_DSN is not configured")
	}
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open PostgreSQL test database: %v", err)
	}
	schema := "conversation_attachment_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create isolated PostgreSQL schema: %v", err)
	}
	t.Cleanup(func() {
		sqlDatabase, databaseErr := admin.DB()
		if databaseErr == nil {
			_ = sqlDatabase.Close()
		}
	})
	t.Cleanup(func() {
		if err := admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop isolated PostgreSQL schema: %v", err)
		}
	})

	isolated, err := gorm.Open(
		postgres.Open(attachmentPostgresDSNWithSearchPath(t, dsn, schema)),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open isolated PostgreSQL schema: %v", err)
	}
	t.Cleanup(func() {
		sqlDatabase, databaseErr := isolated.DB()
		if databaseErr == nil {
			_ = sqlDatabase.Close()
		}
	})

	return isolated
}

func attachmentPostgresDSNWithSearchPath(
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
