package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrPrivateObjectRetry = errors.New("social private object retry later")

type PrivateObjectBegin struct {
	Upload dbmodel.SocialPrivateObjectUpload
	Now    time.Time
}

type PrivateObjectBeginResult struct {
	Upload      dbmodel.SocialPrivateObjectUpload
	ExactReplay bool
}

type PrivateObjectPartCommand struct {
	UploadID              string
	Generation            uint64
	ChunkIndex            uint32
	UploaderPTID          string
	UploaderDeviceID      string
	Offset                uint64
	Size                  uint64
	CiphertextSHA256      []byte
	IdempotencyKey        string
	CanonicalCommandHash  []byte
	LeaseOwner            string
	LeaseDuration         time.Duration
	Now                   time.Time
	DeterministicStoreKey string
}

type PrivateObjectPartStage struct {
	Upload      dbmodel.SocialPrivateObjectUpload
	Part        dbmodel.SocialPrivateObjectChunk
	ExactReplay bool
	Write       bool
}

type PrivateObjectCompleteCommand struct {
	UploadID                   string
	Generation                 uint64
	UploaderPTID               string
	UploaderDeviceID           string
	CommandID                  string
	CanonicalCommandBytes      []byte
	CanonicalCommandSHA256     []byte
	DescriptorCommitmentHash   []byte
	LeaseOwner                 string
	LeaseDuration              time.Duration
	Now                        time.Time
	DeterministicFinalStoreKey string
}

type PrivateObjectVerification struct {
	Upload      dbmodel.SocialPrivateObjectUpload
	Parts       []dbmodel.SocialPrivateObjectChunk
	ExactReplay bool
}

type PrivateObjectCompletion struct {
	Upload              dbmodel.SocialPrivateObjectUpload
	Object              dbmodel.SocialPrivateObjectAttachment
	ResponseBytes       []byte
	ResponseSHA256      []byte
	CompletedAt         time.Time
	UnattachedExpiresAt time.Time
}

type PrivateObjectCancelCommand struct {
	UploadID               string
	Generation             uint64
	UploaderPTID           string
	UploaderDeviceID       string
	CommandID              string
	CanonicalCommandBytes  []byte
	CanonicalCommandSHA256 []byte
	Now                    time.Time
}

type PrivateObjectCancelResult struct {
	Upload      dbmodel.SocialPrivateObjectUpload
	ExactReplay bool
}

type PrivateObjectDownload struct {
	Object dbmodel.SocialPrivateObjectAttachment
}

type PrivateObjectCleanupClaim struct {
	Upload      dbmodel.SocialPrivateObjectUpload
	Object      *dbmodel.SocialPrivateObjectAttachment
	StorageKeys []string
	LeaseOwner  string
	LeaseEpoch  uint64
}

type PrivateObjectPlanValidator func(
	context.Context,
	federationdelivery.Transaction,
	dbmodel.SocialPrivateContentPlan,
) (*securecontentpb.ContentEncryptionPlan, error)

type PrivateObjectStore interface {
	BeginPrivateObject(
		context.Context,
		PrivateObjectBegin,
		PrivateObjectPlanValidator,
	) (PrivateObjectBeginResult, error)
	GetPrivateObjectUpload(
		context.Context,
		string,
		uint64,
		string,
		string,
		time.Time,
	) (dbmodel.SocialPrivateObjectUpload, error)
	StagePrivateObjectPart(
		context.Context,
		PrivateObjectPartCommand,
	) (PrivateObjectPartStage, error)
	MarkPrivateObjectPartStored(
		context.Context,
		string,
		uint64,
		uint32,
		string,
		uint64,
		time.Time,
	) (dbmodel.SocialPrivateObjectUpload, error)
	ReleasePrivateObjectPartLease(
		context.Context,
		string,
		uint64,
		uint32,
		string,
		uint64,
		time.Time,
	) error
	MarkPrivateObjectCorrupt(
		context.Context,
		string,
		uint64,
		string,
		uint64,
		string,
		time.Time,
	) error
	StagePrivateObjectVerification(
		context.Context,
		PrivateObjectCompleteCommand,
	) (PrivateObjectVerification, error)
	RetryPrivateObjectVerification(
		context.Context,
		string,
		uint64,
		string,
		uint64,
		time.Time,
	) error
	CompletePrivateObject(
		context.Context,
		PrivateObjectCompletion,
		string,
		uint64,
	) error
	CancelPrivateObject(
		context.Context,
		PrivateObjectCancelCommand,
	) (PrivateObjectCancelResult, error)
	AuthorizePrivateObjectDownload(
		context.Context,
		string,
		string,
		string,
		[]byte,
	) (PrivateObjectDownload, error)
	ClaimPrivateObjectCleanup(
		context.Context,
		string,
		time.Time,
		time.Duration,
		int,
	) ([]PrivateObjectCleanupClaim, error)
	FinishPrivateObjectCleanup(
		context.Context,
		PrivateObjectCleanupClaim,
		time.Time,
	) error
	RetryPrivateObjectCleanup(
		context.Context,
		PrivateObjectCleanupClaim,
		time.Time,
	) error
}

func (s *GORMPrivateContentStore) BeginPrivateObject(
	ctx context.Context,
	command PrivateObjectBegin,
	validatePlan PrivateObjectPlanValidator,
) (PrivateObjectBeginResult, error) {
	upload := command.Upload
	if err := validatePrivateObjectUpload(upload); err != nil {
		return PrivateObjectBeginResult{}, err
	}
	if command.Now.IsZero() {
		return PrivateObjectBeginResult{}, fmt.Errorf(
			"%w: object begin time is required",
			ErrPrivateContentInvalid,
		)
	}
	if validatePlan == nil {
		return PrivateObjectBeginResult{}, fmt.Errorf(
			"%w: signed plan validator is required",
			ErrPrivateContentInvalid,
		)
	}

	var result PrivateObjectBeginResult
	err := s.withSerializedTransaction(
		ctx,
		[]string{
			privateObjectUploaderLock(upload.UploaderPTID),
			"object-begin:" + upload.UploaderPTID + ":" + upload.BeginCommandID,
			"object-id:" + upload.ObjectID,
			"object-upload:" + upload.UploadID,
			"prepare-plan:" + upload.PlanID,
		},
		func(tx *gorm.DB) error {
			var existing dbmodel.SocialPrivateObjectUpload
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where(
					"uploader_ptid = ? AND begin_command_id = ?",
					upload.UploaderPTID,
					upload.BeginCommandID,
				).
				First(&existing).Error
			if err == nil {
				if !bytes.Equal(
					existing.BeginCommandSHA256,
					upload.BeginCommandSHA256,
				) {
					return fmt.Errorf(
						"%w: object begin command hash differs",
						ErrPrivateContentConflict,
					)
				}
				result = PrivateObjectBeginResult{
					Upload:      clonePrivateObjectUpload(existing),
					ExactReplay: true,
				}
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("social private object find begin replay: %w", err)
			}

			plan, err := lockPrivateContentPlan(tx, upload.PlanID)
			if err != nil {
				return err
			}
			if plan.State != dbmodel.SocialPrivatePlanStatePrepared ||
				!plan.ExpiresAt.After(command.Now.UTC()) ||
				plan.AuthorPTID != upload.UploaderPTID ||
				plan.AuthorDeviceID != upload.UploaderDeviceID ||
				plan.ContentID != upload.ContentID {
				return fmt.Errorf(
					"%w: object begin requires the uploader's current PREPARED plan",
					ErrPrivateContentInvalidState,
				)
			}
			prepared, err := validatePlan(
				ctx,
				privateContentValidationTransaction{db: tx},
				clonePlan(plan),
			)
			if err != nil {
				return err
			}
			if prepared.GetResource().GetGeneration() !=
				uploadResourceGeneration(upload.UploadSpecBytes) ||
				prepared.GetResource().GetGeneration() != plan.Generation ||
				prepared.GetResource().GetContentId() != upload.ContentID ||
				prepared.GetResource().GetOwnerDomain() !=
					securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
				!containsString(prepared.GetObjectIds(), upload.ObjectID) {
				return fmt.Errorf(
					"%w: object is not admitted by the PREPARED plan",
					ErrPrivateContentConflict,
				)
			}
			var conflictCount int64
			if err := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
				Where(
					"upload_id = ? OR object_id = ?",
					upload.UploadID,
					upload.ObjectID,
				).
				Count(&conflictCount).Error; err != nil {
				return fmt.Errorf("social private object check identity: %w", err)
			}
			if conflictCount != 0 {
				return fmt.Errorf(
					"%w: upload or object identity already exists",
					ErrPrivateContentConflict,
				)
			}
			var activeUploads int64
			if err := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
				Where(
					"uploader_ptid = ? AND state IN ?",
					upload.UploaderPTID,
					[]string{
						dbmodel.SocialPrivateObjectCreated,
						dbmodel.SocialPrivateObjectReceivingParts,
						dbmodel.SocialPrivateObjectVerifying,
					},
				).
				Count(&activeUploads).Error; err != nil {
				return fmt.Errorf(
					"social private object count active uploads: %w",
					err,
				)
			}
			if activeUploads >=
				int64(securecontentkernel.MaximumActiveUploadCount) {
				return fmt.Errorf(
					"%w: active object upload limit reached",
					ErrPrivateContentInvalidState,
				)
			}
			if err := tx.Create(&upload).Error; err != nil {
				return fmt.Errorf("social private object create upload: %w", err)
			}
			result.Upload = clonePrivateObjectUpload(upload)
			return nil
		},
	)
	return result, err
}

func (s *GORMPrivateContentStore) GetPrivateObjectUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
	uploaderPTID string,
	uploaderDeviceID string,
	now time.Time,
) (dbmodel.SocialPrivateObjectUpload, error) {
	var result dbmodel.SocialPrivateObjectUpload
	err := s.withSerializedTransaction(
		ctx,
		[]string{privateObjectUploadLock(uploadID, generation)},
		func(tx *gorm.DB) error {
			upload, err := lockPrivateObjectUpload(tx, uploadID, generation)
			if err != nil {
				return err
			}
			if upload.UploaderPTID != uploaderPTID ||
				upload.UploaderDeviceID != uploaderDeviceID {
				return ErrPrivateContentNotFound
			}
			if objectUploadCanExpire(upload.State) &&
				!upload.ExpiresAt.After(now.UTC()) {
				if err := expirePrivateObjectUpload(
					tx,
					&upload,
					now,
				); err != nil {
					return err
				}
			}
			result = clonePrivateObjectUpload(upload)
			return nil
		},
	)
	return result, err
}

func (s *GORMPrivateContentStore) StagePrivateObjectPart(
	ctx context.Context,
	command PrivateObjectPartCommand,
) (PrivateObjectPartStage, error) {
	if err := validatePrivateObjectPartCommand(command); err != nil {
		return PrivateObjectPartStage{}, err
	}
	var (
		result      PrivateObjectPartStage
		terminalErr error
	)
	err := s.withSerializedTransaction(
		ctx,
		[]string{
			privateObjectUploadLock(command.UploadID, command.Generation),
			fmt.Sprintf(
				"object-part:%s:%d:%d",
				command.UploadID,
				command.Generation,
				command.ChunkIndex,
			),
			"object-part-command:" + command.UploadID + ":" +
				fmt.Sprint(command.Generation) + ":" + command.IdempotencyKey,
		},
		func(tx *gorm.DB) error {
			upload, err := lockPrivateObjectUpload(
				tx,
				command.UploadID,
				command.Generation,
			)
			if err != nil {
				return err
			}
			if upload.UploaderPTID != command.UploaderPTID ||
				upload.UploaderDeviceID != command.UploaderDeviceID {
				return ErrPrivateContentNotFound
			}
			spec, err := decodePrivateObjectUploadSpec(upload)
			if err != nil {
				return err
			}
			offset, size, digest, err := securecontentkernel.ExpectedChunk(
				securecontentkernel.ObjectCommitmentFromProto(spec),
				command.ChunkIndex,
				securecontentkernel.DefaultPolicy(),
			)
			if err != nil ||
				offset != command.Offset ||
				size != command.Size ||
				!bytes.Equal(digest, command.CiphertextSHA256) {
				return fmt.Errorf(
					"%w: chunk metadata differs from upload commitment",
					ErrPrivateContentConflict,
				)
			}

			var byCommand dbmodel.SocialPrivateObjectChunk
			err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where(
					"upload_id = ? AND generation = ? AND idempotency_key = ?",
					command.UploadID,
					command.Generation,
					command.IdempotencyKey,
				).
				First(&byCommand).Error
			if err == nil && byCommand.ChunkIndex != command.ChunkIndex {
				return fmt.Errorf(
					"%w: part idempotency key was reused",
					ErrPrivateContentConflict,
				)
			}
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}

			var part dbmodel.SocialPrivateObjectChunk
			err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where(
					"upload_id = ? AND generation = ? AND chunk_index = ?",
					command.UploadID,
					command.Generation,
					command.ChunkIndex,
				).
				First(&part).Error
			if err == nil && part.State == dbmodel.SocialPrivateObjectPartStored {
				if !samePrivateObjectPart(part, command) {
					return fmt.Errorf(
						"%w: object part command differs",
						ErrPrivateContentConflict,
					)
				}
				result = PrivateObjectPartStage{
					Upload:      clonePrivateObjectUpload(upload),
					Part:        clonePrivateObjectPart(part),
					ExactReplay: true,
				}
				return nil
			}
			if !upload.ExpiresAt.After(command.Now.UTC()) {
				if err := expirePrivateObjectUpload(
					tx,
					&upload,
					command.Now,
				); err != nil {
					return err
				}
				terminalErr = fmt.Errorf(
					"%w: upload expired",
					ErrPrivateContentInvalidState,
				)
				return nil
			}
			if upload.State != dbmodel.SocialPrivateObjectCreated &&
				upload.State != dbmodel.SocialPrivateObjectReceivingParts {
				return fmt.Errorf(
					"%w: upload is %s",
					ErrPrivateContentInvalidState,
					upload.State,
				)
			}
			if err == nil {
				if !samePrivateObjectPart(part, command) {
					return fmt.Errorf(
						"%w: object part command differs",
						ErrPrivateContentConflict,
					)
				}
				if part.State != dbmodel.SocialPrivateObjectPartWriting ||
					(part.LeaseExpiresAt != nil &&
						part.LeaseExpiresAt.After(command.Now.UTC())) {
					return ErrPrivateObjectRetry
				}
				leaseExpiry := command.Now.UTC().Add(command.LeaseDuration)
				part.LeaseOwner = command.LeaseOwner
				part.LeaseEpoch++
				part.LeaseExpiresAt = &leaseExpiry
				part.Attempts++
				part.NextAttemptAt = nil
				part.UpdatedAt = command.Now.UTC()
				if err := tx.Save(&part).Error; err != nil {
					return fmt.Errorf("social private object renew part lease: %w", err)
				}
				result = PrivateObjectPartStage{
					Upload: clonePrivateObjectUpload(upload),
					Part:   clonePrivateObjectPart(part),
					Write:  true,
				}
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}

			leaseExpiry := command.Now.UTC().Add(command.LeaseDuration)
			part = dbmodel.SocialPrivateObjectChunk{
				UploadID:               command.UploadID,
				Generation:             command.Generation,
				ChunkIndex:             command.ChunkIndex,
				Offset:                 command.Offset,
				Size:                   command.Size,
				CiphertextSHA256:       cloneBytes(command.CiphertextSHA256),
				IdempotencyKey:         command.IdempotencyKey,
				CanonicalCommandSHA256: cloneBytes(command.CanonicalCommandHash),
				StorageKey:             command.DeterministicStoreKey,
				State:                  dbmodel.SocialPrivateObjectPartWriting,
				LeaseOwner:             command.LeaseOwner,
				LeaseEpoch:             1,
				LeaseExpiresAt:         &leaseExpiry,
				Attempts:               1,
				CreatedAt:              command.Now.UTC(),
				UpdatedAt:              command.Now.UTC(),
			}
			if err := tx.Create(&part).Error; err != nil {
				return fmt.Errorf("social private object stage part: %w", err)
			}
			if upload.State == dbmodel.SocialPrivateObjectCreated {
				update := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
					Where(
						"upload_id = ? AND generation = ? AND state = ?",
						upload.UploadID,
						upload.Generation,
						dbmodel.SocialPrivateObjectCreated,
					).
					Updates(map[string]any{
						"state":      dbmodel.SocialPrivateObjectReceivingParts,
						"updated_at": command.Now.UTC(),
					})
				if update.Error != nil {
					return update.Error
				}
				if update.RowsAffected != 1 {
					return fmt.Errorf(
						"%w: upload no longer accepts object parts",
						ErrPrivateContentInvalidState,
					)
				}
				upload.State = dbmodel.SocialPrivateObjectReceivingParts
			}
			result = PrivateObjectPartStage{
				Upload: clonePrivateObjectUpload(upload),
				Part:   clonePrivateObjectPart(part),
				Write:  true,
			}
			return nil
		},
	)
	if err == nil && terminalErr != nil {
		return PrivateObjectPartStage{}, terminalErr
	}
	return result, err
}

func (s *GORMPrivateContentStore) MarkPrivateObjectPartStored(
	ctx context.Context,
	uploadID string,
	generation uint64,
	chunkIndex uint32,
	leaseOwner string,
	leaseEpoch uint64,
	storedAt time.Time,
) (dbmodel.SocialPrivateObjectUpload, error) {
	var (
		result      dbmodel.SocialPrivateObjectUpload
		terminalErr error
	)
	err := s.withSerializedTransaction(
		ctx,
		[]string{privateObjectUploadLock(uploadID, generation)},
		func(tx *gorm.DB) error {
			upload, err := lockPrivateObjectUpload(tx, uploadID, generation)
			if err != nil {
				return err
			}
			if upload.State != dbmodel.SocialPrivateObjectCreated &&
				upload.State != dbmodel.SocialPrivateObjectReceivingParts {
				return fmt.Errorf(
					"%w: upload is %s",
					ErrPrivateContentInvalidState,
					upload.State,
				)
			}
			if !upload.ExpiresAt.After(storedAt.UTC()) {
				if err := expirePrivateObjectUpload(
					tx,
					&upload,
					storedAt,
				); err != nil {
					return err
				}
				terminalErr = fmt.Errorf(
					"%w: upload expired",
					ErrPrivateContentInvalidState,
				)
				return nil
			}
			var part dbmodel.SocialPrivateObjectChunk
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where(
					"upload_id = ? AND generation = ? AND chunk_index = ?",
					uploadID,
					generation,
					chunkIndex,
				).
				First(&part).Error; err != nil {
				return err
			}
			if part.State == dbmodel.SocialPrivateObjectPartStored {
				result = clonePrivateObjectUpload(upload)
				return nil
			}
			if part.State != dbmodel.SocialPrivateObjectPartWriting ||
				part.LeaseOwner != leaseOwner ||
				part.LeaseEpoch != leaseEpoch {
				return fmt.Errorf(
					"%w: object part lease was lost",
					ErrPrivateContentInvalidState,
				)
			}
			bitmap := cloneBytes(upload.ReceivedChunkBitmap)
			bitmap[chunkIndex/8] |= byte(1 << (chunkIndex % 8))
			stored := storedAt.UTC()
			if err := tx.Model(&part).Updates(map[string]any{
				"state":            dbmodel.SocialPrivateObjectPartStored,
				"stored_at":        stored,
				"lease_owner":      "",
				"lease_expires_at": nil,
				"updated_at":       stored,
			}).Error; err != nil {
				return err
			}
			update := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
				Where(
					"upload_id = ? AND generation = ? AND state IN ?",
					uploadID,
					generation,
					[]string{
						dbmodel.SocialPrivateObjectCreated,
						dbmodel.SocialPrivateObjectReceivingParts,
					},
				).
				Updates(map[string]any{
					"received_chunk_bitmap": bitmap,
					"state":                 dbmodel.SocialPrivateObjectReceivingParts,
					"updated_at":            stored,
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return fmt.Errorf(
					"%w: upload no longer accepts object parts",
					ErrPrivateContentInvalidState,
				)
			}
			upload.ReceivedChunkBitmap = bitmap
			upload.State = dbmodel.SocialPrivateObjectReceivingParts
			upload.UpdatedAt = stored
			result = clonePrivateObjectUpload(upload)
			return nil
		},
	)
	if err == nil && terminalErr != nil {
		return dbmodel.SocialPrivateObjectUpload{}, terminalErr
	}
	return result, err
}

func (s *GORMPrivateContentStore) ReleasePrivateObjectPartLease(
	ctx context.Context,
	uploadID string,
	generation uint64,
	chunkIndex uint32,
	leaseOwner string,
	leaseEpoch uint64,
	retryAt time.Time,
) error {
	return s.db.WithContext(ctx).Model(&dbmodel.SocialPrivateObjectChunk{}).
		Where(
			"upload_id = ? AND generation = ? AND chunk_index = ? AND state = ? AND lease_owner = ? AND lease_epoch = ?",
			uploadID,
			generation,
			chunkIndex,
			dbmodel.SocialPrivateObjectPartWriting,
			leaseOwner,
			leaseEpoch,
		).
		Updates(map[string]any{
			"lease_expires_at": retryAt.UTC(),
			"next_attempt_at":  retryAt.UTC(),
			"updated_at":       retryAt.UTC(),
		}).Error
}

func (s *GORMPrivateContentStore) StagePrivateObjectVerification(
	ctx context.Context,
	command PrivateObjectCompleteCommand,
) (PrivateObjectVerification, error) {
	if err := validatePrivateObjectCompleteCommand(command); err != nil {
		return PrivateObjectVerification{}, err
	}
	var (
		result      PrivateObjectVerification
		terminalErr error
	)
	err := s.withSerializedTransaction(
		ctx,
		[]string{privateObjectUploadLock(command.UploadID, command.Generation)},
		func(tx *gorm.DB) error {
			upload, err := lockPrivateObjectUpload(
				tx,
				command.UploadID,
				command.Generation,
			)
			if err != nil {
				return err
			}
			if upload.UploaderPTID != command.UploaderPTID ||
				upload.UploaderDeviceID != command.UploaderDeviceID {
				return ErrPrivateContentNotFound
			}
			if upload.CompleteCommandID != "" {
				if upload.CompleteCommandID != command.CommandID ||
					!bytes.Equal(
						upload.CompleteCommandSHA256,
						command.CanonicalCommandSHA256,
					) {
					return fmt.Errorf(
						"%w: complete command differs",
						ErrPrivateContentConflict,
					)
				}
				if len(upload.CompleteResponseBytes) != 0 &&
					len(upload.CompleteResponseSHA256) == sha256.Size {
					result = PrivateObjectVerification{
						Upload:      clonePrivateObjectUpload(upload),
						ExactReplay: true,
					}
					return nil
				}
			}
			if !upload.ExpiresAt.After(command.Now.UTC()) {
				if err := expirePrivateObjectUpload(
					tx,
					&upload,
					command.Now,
				); err != nil {
					return err
				}
				terminalErr = fmt.Errorf(
					"%w: upload expired",
					ErrPrivateContentInvalidState,
				)
				return nil
			}
			if upload.State == dbmodel.SocialPrivateObjectVerifying &&
				upload.VerificationLeaseExpiry != nil &&
				upload.VerificationLeaseExpiry.After(command.Now.UTC()) {
				return ErrPrivateObjectRetry
			}
			if upload.VerificationNextAttempt != nil &&
				upload.VerificationNextAttempt.After(command.Now.UTC()) {
				return ErrPrivateObjectRetry
			}
			if upload.VerificationAttempts >=
				securecontentkernel.MaximumVerificationAttemptCount {
				return fmt.Errorf(
					"%w: verification attempt limit reached",
					ErrPrivateContentInvalidState,
				)
			}
			if upload.State != dbmodel.SocialPrivateObjectCreated &&
				upload.State != dbmodel.SocialPrivateObjectReceivingParts &&
				upload.State != dbmodel.SocialPrivateObjectVerifying {
				return fmt.Errorf(
					"%w: upload is %s",
					ErrPrivateContentInvalidState,
					upload.State,
				)
			}
			if !bytes.Equal(
				upload.DescriptorCommitmentSHA256,
				command.DescriptorCommitmentHash,
			) {
				return fmt.Errorf(
					"%w: descriptor commitment differs",
					ErrPrivateContentConflict,
				)
			}
			spec, err := decodePrivateObjectUploadSpec(upload)
			if err != nil {
				return err
			}
			if err := securecontentkernel.ValidateReceivedChunkBitmap(
				upload.ReceivedChunkBitmap,
				spec.GetChunkCount(),
			); err != nil ||
				!completePrivateObjectBitmap(
					upload.ReceivedChunkBitmap,
					spec.GetChunkCount(),
				) {
				return fmt.Errorf(
					"%w: upload parts are incomplete",
					ErrPrivateContentInvalidState,
				)
			}
			var parts []dbmodel.SocialPrivateObjectChunk
			if err := tx.Where(
				"upload_id = ? AND generation = ? AND state = ?",
				upload.UploadID,
				upload.Generation,
				dbmodel.SocialPrivateObjectPartStored,
			).Order("chunk_index ASC").Find(&parts).Error; err != nil {
				return err
			}
			if len(parts) != int(spec.GetChunkCount()) {
				return fmt.Errorf(
					"%w: stored part rows are incomplete",
					ErrPrivateContentInvalidState,
				)
			}
			leaseExpiry := command.Now.UTC().Add(command.LeaseDuration)
			updates := map[string]any{
				"state":                         dbmodel.SocialPrivateObjectVerifying,
				"complete_command_id":           command.CommandID,
				"complete_command_bytes":        cloneBytes(command.CanonicalCommandBytes),
				"complete_command_sha256":       cloneBytes(command.CanonicalCommandSHA256),
				"final_storage_key":             command.DeterministicFinalStoreKey,
				"verification_lease_owner":      command.LeaseOwner,
				"verification_lease_epoch":      upload.VerificationLeaseEpoch + 1,
				"verification_lease_expires_at": leaseExpiry,
				"verification_attempts":         upload.VerificationAttempts + 1,
				"verification_next_attempt_at":  nil,
				"updated_at":                    command.Now.UTC(),
			}
			if err := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
				Where(
					"upload_id = ? AND generation = ?",
					upload.UploadID,
					upload.Generation,
				).
				Updates(updates).Error; err != nil {
				return err
			}
			upload.State = dbmodel.SocialPrivateObjectVerifying
			upload.CompleteCommandID = command.CommandID
			upload.CompleteCommandBytes = cloneBytes(command.CanonicalCommandBytes)
			upload.CompleteCommandSHA256 = cloneBytes(command.CanonicalCommandSHA256)
			upload.FinalStorageKey = command.DeterministicFinalStoreKey
			upload.VerificationLeaseOwner = command.LeaseOwner
			upload.VerificationLeaseEpoch++
			upload.VerificationLeaseExpiry = &leaseExpiry
			upload.VerificationAttempts++
			result = PrivateObjectVerification{
				Upload: clonePrivateObjectUpload(upload),
				Parts:  clonePrivateObjectParts(parts),
			}
			return nil
		},
	)
	if err == nil && terminalErr != nil {
		return PrivateObjectVerification{}, terminalErr
	}
	return result, err
}

func (s *GORMPrivateContentStore) RetryPrivateObjectVerification(
	ctx context.Context,
	uploadID string,
	generation uint64,
	leaseOwner string,
	leaseEpoch uint64,
	retryAt time.Time,
) error {
	update := s.db.WithContext(ctx).
		Model(&dbmodel.SocialPrivateObjectUpload{}).
		Where(
			"upload_id = ? AND generation = ? AND state = ? AND verification_lease_owner = ? AND verification_lease_epoch = ?",
			uploadID,
			generation,
			dbmodel.SocialPrivateObjectVerifying,
			leaseOwner,
			leaseEpoch,
		).
		Updates(map[string]any{
			"state":                         dbmodel.SocialPrivateObjectReceivingParts,
			"verification_lease_owner":      "",
			"verification_lease_expires_at": nil,
			"verification_next_attempt_at":  retryAt.UTC(),
			"updated_at":                    retryAt.UTC(),
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return fmt.Errorf(
			"%w: verification lease was lost",
			ErrPrivateContentInvalidState,
		)
	}
	return nil
}

func (s *GORMPrivateContentStore) MarkPrivateObjectCorrupt(
	ctx context.Context,
	uploadID string,
	generation uint64,
	leaseOwner string,
	leaseEpoch uint64,
	reason string,
	now time.Time,
) error {
	updates := map[string]any{
		"state":                         dbmodel.SocialPrivateObjectTerminalCorrupt,
		"terminal_reason":               reason,
		"verification_lease_owner":      "",
		"verification_lease_expires_at": nil,
		"cleanup_next_attempt_at":       now.UTC(),
		"updated_at":                    now.UTC(),
	}
	if leaseOwner != "" {
		responseBytes, err := proto.MarshalOptions{
			Deterministic: true,
		}.Marshal(&securecontentpb.CompleteEncryptedObjectUploadResponse{
			State: securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_TERMINAL_CORRUPT,
		})
		if err != nil {
			return fmt.Errorf(
				"social private object encode terminal response: %w",
				err,
			)
		}
		responseHash := sha256.Sum256(responseBytes)
		updates["complete_response_bytes"] = responseBytes
		updates["complete_response_sha256"] = responseHash[:]
	}
	update := s.db.WithContext(ctx).
		Model(&dbmodel.SocialPrivateObjectUpload{}).
		Where(
			"upload_id = ? AND generation = ? AND state IN ? AND (? = '' OR verification_lease_owner = ?) AND (? = 0 OR verification_lease_epoch = ?)",
			uploadID,
			generation,
			[]string{
				dbmodel.SocialPrivateObjectCreated,
				dbmodel.SocialPrivateObjectReceivingParts,
				dbmodel.SocialPrivateObjectVerifying,
			},
			leaseOwner,
			leaseOwner,
			leaseEpoch,
			leaseEpoch,
		).
		Updates(updates)
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return fmt.Errorf(
			"%w: corrupt upload transition lost its lease",
			ErrPrivateContentInvalidState,
		)
	}
	return nil
}

func (s *GORMPrivateContentStore) CompletePrivateObject(
	ctx context.Context,
	completion PrivateObjectCompletion,
	leaseOwner string,
	leaseEpoch uint64,
) error {
	if err := validatePrivateObjectCompletion(completion); err != nil {
		return err
	}
	return s.withSerializedTransaction(
		ctx,
		[]string{
			privateObjectUploadLock(
				completion.Upload.UploadID,
				completion.Upload.Generation,
			),
			"object-id:" + completion.Object.ObjectID,
		},
		func(tx *gorm.DB) error {
			upload, err := lockPrivateObjectUpload(
				tx,
				completion.Upload.UploadID,
				completion.Upload.Generation,
			)
			if err != nil {
				return err
			}
			if upload.State ==
				dbmodel.SocialPrivateObjectCompleteUnattached {
				if bytes.Equal(
					upload.CompleteResponseSHA256,
					completion.ResponseSHA256,
				) {
					return nil
				}
				return fmt.Errorf(
					"%w: completed object response differs",
					ErrPrivateContentConflict,
				)
			}
			if upload.State != dbmodel.SocialPrivateObjectVerifying ||
				upload.VerificationLeaseOwner != leaseOwner ||
				upload.VerificationLeaseEpoch != leaseEpoch {
				return fmt.Errorf(
					"%w: verification lease was lost",
					ErrPrivateContentInvalidState,
				)
			}
			if err := tx.Create(&completion.Object).Error; err != nil {
				return fmt.Errorf("social private object create object row: %w", err)
			}
			update := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
				Where(
					"upload_id = ? AND generation = ? AND state = ? AND verification_lease_owner = ? AND verification_lease_epoch = ?",
					upload.UploadID,
					upload.Generation,
					dbmodel.SocialPrivateObjectVerifying,
					leaseOwner,
					leaseEpoch,
				).
				Updates(map[string]any{
					"state":                         dbmodel.SocialPrivateObjectCompleteUnattached,
					"complete_response_bytes":       cloneBytes(completion.ResponseBytes),
					"complete_response_sha256":      cloneBytes(completion.ResponseSHA256),
					"verification_lease_owner":      "",
					"verification_lease_expires_at": nil,
					"updated_at":                    completion.CompletedAt.UTC(),
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return fmt.Errorf(
					"%w: complete object CAS failed",
					ErrPrivateContentInvalidState,
				)
			}
			return nil
		},
	)
}

func (s *GORMPrivateContentStore) CancelPrivateObject(
	ctx context.Context,
	command PrivateObjectCancelCommand,
) (PrivateObjectCancelResult, error) {
	if err := validatePrivateObjectCancelCommand(command); err != nil {
		return PrivateObjectCancelResult{}, err
	}
	var result PrivateObjectCancelResult
	err := s.withSerializedTransaction(
		ctx,
		[]string{privateObjectUploadLock(command.UploadID, command.Generation)},
		func(tx *gorm.DB) error {
			upload, err := lockPrivateObjectUpload(
				tx,
				command.UploadID,
				command.Generation,
			)
			if err != nil {
				return err
			}
			if upload.UploaderPTID != command.UploaderPTID ||
				upload.UploaderDeviceID != command.UploaderDeviceID {
				return ErrPrivateContentNotFound
			}
			if upload.CancelCommandID != "" {
				if upload.CancelCommandID != command.CommandID ||
					!bytes.Equal(
						upload.CancelCommandSHA256,
						command.CanonicalCommandSHA256,
					) {
					return fmt.Errorf(
						"%w: cancel command differs",
						ErrPrivateContentConflict,
					)
				}
				result = PrivateObjectCancelResult{
					Upload:      clonePrivateObjectUpload(upload),
					ExactReplay: true,
				}
				return nil
			}
			activePartLease, err := hasActivePrivateObjectPartLease(
				tx,
				upload.UploadID,
				upload.Generation,
				command.Now,
			)
			if err != nil {
				return err
			}
			if activePartLease {
				return ErrPrivateObjectRetry
			}
			if upload.State != dbmodel.SocialPrivateObjectCreated &&
				upload.State != dbmodel.SocialPrivateObjectReceivingParts {
				return fmt.Errorf(
					"%w: upload is %s",
					ErrPrivateContentInvalidState,
					upload.State,
				)
			}
			if err := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
				Where(
					"upload_id = ? AND generation = ? AND state IN ?",
					upload.UploadID,
					upload.Generation,
					[]string{
						dbmodel.SocialPrivateObjectCreated,
						dbmodel.SocialPrivateObjectReceivingParts,
					},
				).
				Updates(map[string]any{
					"state":                   dbmodel.SocialPrivateObjectCancelled,
					"cancel_command_id":       command.CommandID,
					"cancel_command_bytes":    cloneBytes(command.CanonicalCommandBytes),
					"cancel_command_sha256":   cloneBytes(command.CanonicalCommandSHA256),
					"cleanup_next_attempt_at": command.Now.UTC(),
					"updated_at":              command.Now.UTC(),
				}).Error; err != nil {
				return err
			}
			upload.State = dbmodel.SocialPrivateObjectCancelled
			upload.CancelCommandID = command.CommandID
			upload.CancelCommandBytes = cloneBytes(command.CanonicalCommandBytes)
			upload.CancelCommandSHA256 = cloneBytes(command.CanonicalCommandSHA256)
			result.Upload = clonePrivateObjectUpload(upload)
			return nil
		},
	)
	return result, err
}

func (s *GORMPrivateContentStore) AuthorizePrivateObjectDownload(
	ctx context.Context,
	objectID string,
	viewerPTID string,
	viewerDeviceID string,
	expectedDescriptorSHA256 []byte,
) (PrivateObjectDownload, error) {
	var result PrivateObjectDownload
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var object dbmodel.SocialPrivateObjectAttachment
		if err := tx.Where(
			"object_id = ? AND state = ? AND descriptor_sha256 = ? AND domain_commit_id <> ''",
			objectID,
			dbmodel.SocialPrivateObjectAttached,
			expectedDescriptorSHA256,
		).First(&object).Error; err != nil {
			return ErrPrivateContentNotFound
		}
		var grantCount int64
		if err := tx.Model(&dbmodel.SocialPrivateObjectGrant{}).
			Where(
				"object_id = ? AND principal_ptid = ? AND revoked_at IS NULL AND ((principal_kind = ? AND principal_device_id = ?) OR (principal_kind = ? AND principal_device_id = ''))",
				object.ObjectID,
				viewerPTID,
				PrivateContentKeyKindEndpoint,
				viewerDeviceID,
				PrivateContentKeyKindActorRecovery,
			).
			Count(&grantCount).Error; err != nil {
			return err
		}
		if grantCount == 0 {
			return ErrPrivateContentNotFound
		}
		if err := authorizeCurrentPrivateObjectResource(
			tx,
			object.ContentID,
			viewerPTID,
		); err != nil {
			return err
		}
		result.Object = clonePrivateObject(object)
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) ||
		errors.Is(err, ErrPrivateContentNotFound) {
		return PrivateObjectDownload{}, ErrPrivateContentNotFound
	}
	if err != nil {
		return PrivateObjectDownload{}, fmt.Errorf(
			"social private object authorize download: %w",
			err,
		)
	}
	return result, nil
}

func (s *GORMPrivateContentStore) ClaimPrivateObjectCleanup(
	ctx context.Context,
	leaseOwner string,
	now time.Time,
	leaseDuration time.Duration,
	limit int,
) ([]PrivateObjectCleanupClaim, error) {
	if strings.TrimSpace(leaseOwner) == "" ||
		now.IsZero() ||
		leaseDuration <= 0 ||
		limit <= 0 ||
		limit > 100 {
		return nil, fmt.Errorf(
			"%w: bounded cleanup lease is required",
			ErrPrivateContentInvalid,
		)
	}
	var claims []PrivateObjectCleanupClaim
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var uploads []dbmodel.SocialPrivateObjectUpload
		if err := tx.Clauses(clause.Locking{
			Strength: "UPDATE",
			Options:  "SKIP LOCKED",
		}).Where(
			"((state IN ? AND cleanup_next_attempt_at <= ?) OR (state = ? AND expires_at <= ? AND (verification_lease_expires_at IS NULL OR verification_lease_expires_at <= ?)) OR (state = ? AND cleanup_lease_expires_at <= ?)) AND NOT EXISTS (SELECT 1 FROM social_private_object_parts AS active_part WHERE active_part.upload_id = social_private_object_uploads.upload_id AND active_part.generation = social_private_object_uploads.generation AND active_part.state = ? AND active_part.lease_expires_at > ?)",
			[]string{
				dbmodel.SocialPrivateObjectCancelled,
				dbmodel.SocialPrivateObjectExpired,
				dbmodel.SocialPrivateObjectTerminalCorrupt,
				dbmodel.SocialPrivateObjectRetryWait,
			},
			now.UTC(),
			dbmodel.SocialPrivateObjectVerifying,
			now.UTC(),
			now.UTC(),
			dbmodel.SocialPrivateObjectGCClaimed,
			now.UTC(),
			dbmodel.SocialPrivateObjectPartWriting,
			now.UTC(),
		).Order("updated_at ASC").Limit(limit).Find(&uploads).Error; err != nil {
			return err
		}
		if err := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
			Where(
				"state IN ? AND expires_at <= ?",
				[]string{
					dbmodel.SocialPrivateObjectCreated,
					dbmodel.SocialPrivateObjectReceivingParts,
				},
				now.UTC(),
			).
			Updates(map[string]any{
				"state":                   dbmodel.SocialPrivateObjectExpired,
				"cleanup_next_attempt_at": now.UTC(),
				"updated_at":              now.UTC(),
			}).Error; err != nil {
			return fmt.Errorf(
				"social private object persist background expiry: %w",
				err,
			)
		}
		remaining := limit - len(uploads)
		if remaining > 0 {
			var objects []dbmodel.SocialPrivateObjectAttachment
			if err := tx.Clauses(clause.Locking{
				Strength: "UPDATE",
				Options:  "SKIP LOCKED",
			}).Where(
				"state = ? AND expires_at <= ?",
				dbmodel.SocialPrivateObjectCompleteUnattached,
				now.UTC(),
			).Order("expires_at ASC").Limit(remaining).Find(&objects).Error; err != nil {
				return err
			}
			for index := range objects {
				var upload dbmodel.SocialPrivateObjectUpload
				if err := tx.Where(
					"upload_id = ? AND generation = ?",
					objects[index].UploadID,
					objects[index].UploadGeneration,
				).First(&upload).Error; err != nil {
					return err
				}
				claim, err := claimPrivateObjectCleanup(
					tx,
					upload,
					&objects[index],
					leaseOwner,
					now,
					leaseDuration,
				)
				if err != nil {
					return err
				}
				claims = append(claims, claim)
			}
		}
		for _, upload := range uploads {
			var object *dbmodel.SocialPrivateObjectAttachment
			var persistedObject dbmodel.SocialPrivateObjectAttachment
			if err := tx.Where(
				"upload_id = ? AND upload_generation = ? AND state IN ?",
				upload.UploadID,
				upload.Generation,
				[]string{
					dbmodel.SocialPrivateObjectRetryWait,
					dbmodel.SocialPrivateObjectGCClaimed,
				},
			).First(&persistedObject).Error; err == nil {
				object = &persistedObject
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			claim, err := claimPrivateObjectCleanup(
				tx,
				upload,
				object,
				leaseOwner,
				now,
				leaseDuration,
			)
			if err != nil {
				return err
			}
			claims = append(claims, claim)
		}
		return nil
	})
	return claims, err
}

func (s *GORMPrivateContentStore) FinishPrivateObjectCleanup(
	ctx context.Context,
	claim PrivateObjectCleanupClaim,
	now time.Time,
) error {
	return s.finishPrivateObjectCleanup(ctx, claim, now, true)
}

func (s *GORMPrivateContentStore) RetryPrivateObjectCleanup(
	ctx context.Context,
	claim PrivateObjectCleanupClaim,
	now time.Time,
) error {
	return s.finishPrivateObjectCleanup(ctx, claim, now, false)
}

func (s *GORMPrivateContentStore) finishPrivateObjectCleanup(
	ctx context.Context,
	claim PrivateObjectCleanupClaim,
	now time.Time,
	success bool,
) error {
	return s.withSerializedTransaction(
		ctx,
		[]string{
			privateObjectUploadLock(
				claim.Upload.UploadID,
				claim.Upload.Generation,
			),
		},
		func(tx *gorm.DB) error {
			state := dbmodel.SocialPrivateObjectRetryWait
			if !success &&
				claim.Upload.CleanupAttempts >=
					securecontentkernel.MaximumCleanupAttemptCount {
				state = dbmodel.SocialPrivateObjectCleanupFailed
			}
			updates := map[string]any{
				"state":                    state,
				"cleanup_lease_owner":      "",
				"cleanup_lease_expires_at": nil,
				"cleanup_next_attempt_at":  now.UTC().Add(time.Minute),
				"updated_at":               now.UTC(),
			}
			if success {
				state = dbmodel.SocialPrivateObjectGarbageCollected
				updates["state"] = state
				updates["cleanup_next_attempt_at"] = nil
				updates["tombstoned_at"] = now.UTC()
			}
			update := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
				Where(
					"upload_id = ? AND generation = ? AND state = ? AND cleanup_lease_owner = ? AND cleanup_lease_epoch = ?",
					claim.Upload.UploadID,
					claim.Upload.Generation,
					dbmodel.SocialPrivateObjectGCClaimed,
					claim.LeaseOwner,
					claim.LeaseEpoch,
				).
				Updates(updates)
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return fmt.Errorf(
					"%w: cleanup upload lease was lost",
					ErrPrivateContentInvalidState,
				)
			}
			if claim.Object != nil {
				objectUpdate := tx.Model(
					&dbmodel.SocialPrivateObjectAttachment{},
				).Where(
					"object_id = ? AND state = ? AND cleanup_lease_owner = ? AND cleanup_lease_epoch = ?",
					claim.Object.ObjectID,
					dbmodel.SocialPrivateObjectGCClaimed,
					claim.LeaseOwner,
					claim.LeaseEpoch,
				).Updates(updates)
				if objectUpdate.Error != nil {
					return objectUpdate.Error
				}
				if objectUpdate.RowsAffected != 1 {
					return fmt.Errorf(
						"%w: cleanup object lease was lost",
						ErrPrivateContentInvalidState,
					)
				}
			}
			return nil
		},
	)
}

func claimPrivateObjectCleanup(
	tx *gorm.DB,
	upload dbmodel.SocialPrivateObjectUpload,
	object *dbmodel.SocialPrivateObjectAttachment,
	leaseOwner string,
	now time.Time,
	leaseDuration time.Duration,
) (PrivateObjectCleanupClaim, error) {
	expiry := now.UTC().Add(leaseDuration)
	epoch := upload.CleanupLeaseEpoch + 1
	uploadUpdate := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
		Where(
			"upload_id = ? AND generation = ? AND state = ?",
			upload.UploadID,
			upload.Generation,
			upload.State,
		).
		Updates(map[string]any{
			"state":                    dbmodel.SocialPrivateObjectGCClaimed,
			"cleanup_lease_owner":      leaseOwner,
			"cleanup_lease_epoch":      epoch,
			"cleanup_lease_expires_at": expiry,
			"cleanup_attempts":         upload.CleanupAttempts + 1,
			"updated_at":               now.UTC(),
		})
	if uploadUpdate.Error != nil {
		return PrivateObjectCleanupClaim{}, uploadUpdate.Error
	}
	if uploadUpdate.RowsAffected != 1 {
		return PrivateObjectCleanupClaim{}, fmt.Errorf(
			"%w: cleanup upload claim raced",
			ErrPrivateContentInvalidState,
		)
	}
	if object != nil {
		objectUpdate := tx.Model(&dbmodel.SocialPrivateObjectAttachment{}).
			Where(
				"object_id = ? AND state = ?",
				object.ObjectID,
				object.State,
			).
			Updates(map[string]any{
				"state":                    dbmodel.SocialPrivateObjectGCClaimed,
				"cleanup_lease_owner":      leaseOwner,
				"cleanup_lease_epoch":      epoch,
				"cleanup_lease_expires_at": expiry,
				"cleanup_attempts":         object.CleanupAttempts + 1,
			})
		if objectUpdate.Error != nil {
			return PrivateObjectCleanupClaim{}, objectUpdate.Error
		}
		if objectUpdate.RowsAffected != 1 {
			return PrivateObjectCleanupClaim{}, fmt.Errorf(
				"%w: cleanup object claim raced",
				ErrPrivateContentInvalidState,
			)
		}
	}
	var parts []dbmodel.SocialPrivateObjectChunk
	if err := tx.Where(
		"upload_id = ? AND generation = ?",
		upload.UploadID,
		upload.Generation,
	).Order("chunk_index ASC").Find(&parts).Error; err != nil {
		return PrivateObjectCleanupClaim{}, err
	}
	keys := make([]string, 0, len(parts)+1)
	for _, part := range parts {
		keys = append(keys, part.StorageKey)
	}
	if upload.FinalStorageKey != "" {
		keys = append(keys, upload.FinalStorageKey)
	}
	upload.State = dbmodel.SocialPrivateObjectGCClaimed
	upload.CleanupLeaseOwner = leaseOwner
	upload.CleanupLeaseEpoch = epoch
	upload.CleanupAttempts++
	if object != nil {
		object.State = dbmodel.SocialPrivateObjectGCClaimed
		object.CleanupLeaseOwner = leaseOwner
		object.CleanupLeaseEpoch = epoch
		object.CleanupAttempts++
	}
	return PrivateObjectCleanupClaim{
		Upload:      clonePrivateObjectUpload(upload),
		Object:      cloneOptionalPrivateObject(object),
		StorageKeys: uniqueSortedStrings(keys),
		LeaseOwner:  leaseOwner,
		LeaseEpoch:  epoch,
	}, nil
}

func authorizeCurrentPrivateObjectResource(
	tx *gorm.DB,
	contentID string,
	viewerPTID string,
) error {
	var post dbmodel.SocialPrivateContentPost
	err := tx.Where(
		"content_id = ? AND deleted_at IS NULL",
		contentID,
	).First(&post).Error
	if err == nil {
		return authorizePrivatePostViewer(tx, post, viewerPTID)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var comment dbmodel.SocialPrivateContentComment
	if err := tx.Where(
		"content_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
		contentID,
		privateContentLifecycleActive,
	).First(&comment).Error; err != nil {
		return ErrPrivateContentNotFound
	}
	var parent dbmodel.SocialPrivateContentPost
	if err := tx.Where(
		"post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL",
		comment.PostID,
		privateContentLifecycleActive,
	).First(&parent).Error; err != nil {
		return ErrPrivateContentNotFound
	}
	if err := authorizePrivatePostViewer(tx, parent, viewerPTID); err != nil {
		return err
	}
	if viewerPTID == comment.AuthorPTID {
		return nil
	}
	if err := requirePrivateSnapshotGrant(
		tx,
		comment.InteractionSnapshotID,
		viewerPTID,
	); err != nil {
		return err
	}
	return authorizePrivateBlockBoundary(
		tx,
		comment.AuthorPTID,
		viewerPTID,
	)
}

func authorizePrivatePostViewer(
	tx *gorm.DB,
	post dbmodel.SocialPrivateContentPost,
	viewerPTID string,
) error {
	if viewerPTID == post.AuthorPTID {
		return nil
	}
	var snapshot dbmodel.SocialPrivateAudienceSnapshot
	if err := tx.Where(
		"snapshot_id = ?",
		post.AudienceSnapshotID,
	).First(&snapshot).Error; err != nil {
		return ErrPrivateContentNotFound
	}
	if err := requirePrivateSnapshotGrant(
		tx,
		post.AudienceSnapshotID,
		viewerPTID,
	); err != nil {
		return err
	}
	audience, err := loadPrivatePostAudience(tx, post, snapshot)
	if err != nil {
		return err
	}
	return authorizePrivateCurrentAudience(
		tx,
		snapshot,
		audience,
		post.AuthorPTID,
		viewerPTID,
	)
}

func authorizePrivateCurrentAudience(
	tx *gorm.DB,
	snapshot dbmodel.SocialPrivateAudienceSnapshot,
	audience *actormodel.Audience,
	ownerPTID string,
	viewerPTID string,
) error {
	if audience == nil ||
		audience.GetKind().String() != snapshot.AudienceKind {
		return ErrPrivateContentNotFound
	}
	if err := authorizePrivateBlockBoundary(tx, ownerPTID, viewerPTID); err != nil {
		return err
	}
	switch snapshot.AudienceKind {
	case "FRIENDS":
		var count int64
		if err := tx.Model(&federatedRelationshipProjectionModel{}).
			Where(
				"owner_ptid = ? AND peer_ptid = ?",
				ownerPTID,
				viewerPTID,
			).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return ErrPrivateContentNotFound
		}
	case "FOLLOWERS":
		return authorizePrivateFollower(tx, ownerPTID, viewerPTID)
	case "CIRCLE":
		targetID := audience.GetCircleId()
		if targetID == 0 ||
			snapshot.AudienceTarget != strconv.FormatUint(targetID, 10) {
			return ErrPrivateContentNotFound
		}
		var count int64
		if err := tx.Table("social_circle_members AS member").
			Joins("JOIN social_circles AS circle ON circle.id = member.circle_id").
			Joins("JOIN touch_actor AS owner ON owner.id = circle.owner_id").
			Where(
				"member.circle_id = ? AND member.actor_ptid = ? AND circle.deleted_at IS NULL AND owner.ptid = ?",
				targetID,
				viewerPTID,
				ownerPTID,
			).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return ErrPrivateContentNotFound
		}
	case "GROUP":
		if audience.GetGroupConversationId() == "" ||
			snapshot.AudienceTarget != audience.GetGroupConversationId() {
			return ErrPrivateContentNotFound
		}
	case "CUSTOM_ALLOW", "CUSTOM_DENY":
		if audience.GetKind() == actormodel.Audience_CUSTOM_DENY &&
			audience.GetBaseKind() == actormodel.Audience_FOLLOWERS {
			return authorizePrivateFollower(tx, ownerPTID, viewerPTID)
		}
	default:
		return ErrPrivateContentNotFound
	}
	return nil
}

func loadPrivatePostAudience(
	tx *gorm.DB,
	post dbmodel.SocialPrivateContentPost,
	snapshot dbmodel.SocialPrivateAudienceSnapshot,
) (*actormodel.Audience, error) {
	var model dbmodel.SocialPrivateContentPlan
	if err := tx.Select(
		"plan_id",
		"audience_bytes",
		"audience_sha256",
		"group_recipient_snapshot_bytes",
		"group_recipient_snapshot_sha256",
		"subtype_prepare_authority_bytes",
		"subtype_prepare_authority_sha256",
	).Where(
		"content_id = ? AND generation = ?",
		post.ContentID,
		post.Generation,
	).First(&model).Error; err != nil {
		return nil, ErrPrivateContentNotFound
	}
	binding := PrivatePrepareBinding{
		AudienceBytes:  cloneBytes(model.AudienceBytes),
		AudienceSHA256: cloneBytes(model.AudienceSHA256),
		GroupRecipientSnapshotBytes: cloneBytes(
			model.GroupRecipientSnapshotBytes,
		),
		GroupRecipientSnapshotSHA256: cloneBytes(
			model.GroupRecipientSnapshotSHA256,
		),
		SubtypePrepareAuthorityBytes: cloneBytes(model.SubtypePrepareAuthorityBytes),
		SubtypePrepareAuthoritySHA256: cloneBytes(
			model.SubtypePrepareAuthoritySHA256,
		),
	}
	if err := validatePrepareBinding(binding); err != nil {
		return nil, ErrPrivateContentNotFound
	}
	audience := &actormodel.Audience{}
	if err := proto.Unmarshal(binding.AudienceBytes, audience); err != nil ||
		socialdomain.ValidateAudience(audience) != nil ||
		audience.GetKind().String() != snapshot.AudienceKind {
		return nil, ErrPrivateContentNotFound
	}
	return audience, nil
}

func authorizePrivateFollower(
	tx *gorm.DB,
	ownerPTID string,
	viewerPTID string,
) error {
	var count int64
	if err := tx.Table("follows AS follow").
		Joins("JOIN touch_actor AS follower ON follower.id = follow.follower_id").
		Joins("JOIN touch_actor AS owner ON owner.id = follow.following_id").
		Where("follower.ptid = ? AND owner.ptid = ?", viewerPTID, ownerPTID).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrPrivateContentNotFound
	}
	return nil
}

func authorizePrivateBlockBoundary(
	tx *gorm.DB,
	ownerPTID string,
	viewerPTID string,
) error {
	var blockCount int64
	if err := tx.Model(&socialDirectionalRelationshipModel{}).
		Where(
			"blocked = ? AND ((actor_ptid = ? AND target_actor_ptid = ?) OR (actor_ptid = ? AND target_actor_ptid = ?))",
			true,
			ownerPTID,
			viewerPTID,
			viewerPTID,
			ownerPTID,
		).
		Count(&blockCount).Error; err != nil {
		return err
	}
	if blockCount != 0 {
		return ErrPrivateContentNotFound
	}
	return nil
}

func requirePrivateSnapshotGrant(
	tx *gorm.DB,
	snapshotID string,
	viewerPTID string,
) error {
	var count int64
	if err := tx.Model(&dbmodel.SocialPrivateRecipientGrant{}).
		Where(
			"snapshot_id = ? AND recipient_ptid = ? AND revoked_at IS NULL",
			snapshotID,
			viewerPTID,
		).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrPrivateContentNotFound
	}
	return nil
}

func validatePrivateObjectUpload(
	upload dbmodel.SocialPrivateObjectUpload,
) error {
	for name, value := range map[string]string{
		"upload ID":          upload.UploadID,
		"plan ID":            upload.PlanID,
		"object ID":          upload.ObjectID,
		"content ID":         upload.ContentID,
		"uploader PTID":      upload.UploaderPTID,
		"uploader device ID": upload.UploaderDeviceID,
		"begin command ID":   upload.BeginCommandID,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf(
				"%w: %s is required",
				ErrPrivateContentInvalid,
				name,
			)
		}
	}
	if upload.Generation == 0 ||
		upload.State != dbmodel.SocialPrivateObjectCreated ||
		upload.ExpiresAt.IsZero() ||
		len(upload.ReceivedChunkBitmap) == 0 {
		return fmt.Errorf(
			"%w: object upload lifecycle is invalid",
			ErrPrivateContentInvalid,
		)
	}
	for name, value := range map[string][]byte{
		"upload spec":           upload.UploadSpecBytes,
		"begin command":         upload.BeginCommandBytes,
		"descriptor commitment": upload.DescriptorCommitmentSHA256,
	} {
		if len(value) == 0 {
			return fmt.Errorf(
				"%w: %s is required",
				ErrPrivateContentInvalid,
				name,
			)
		}
	}
	for name, digest := range map[string][]byte{
		"upload spec":           upload.UploadSpecSHA256,
		"begin command":         upload.BeginCommandSHA256,
		"descriptor commitment": upload.DescriptorCommitmentSHA256,
	} {
		if len(digest) != sha256.Size {
			return fmt.Errorf(
				"%w: %s hash is invalid",
				ErrPrivateContentInvalid,
				name,
			)
		}
	}
	return nil
}

func validatePrivateObjectPartCommand(
	command PrivateObjectPartCommand,
) error {
	if strings.TrimSpace(command.UploadID) == "" ||
		command.Generation == 0 ||
		strings.TrimSpace(command.UploaderPTID) == "" ||
		strings.TrimSpace(command.UploaderDeviceID) == "" ||
		command.Size == 0 ||
		strings.TrimSpace(command.IdempotencyKey) == "" ||
		strings.TrimSpace(command.LeaseOwner) == "" ||
		command.LeaseDuration <= 0 ||
		command.Now.IsZero() ||
		strings.TrimSpace(command.DeterministicStoreKey) == "" ||
		len(command.CiphertextSHA256) != sha256.Size ||
		len(command.CanonicalCommandHash) != sha256.Size {
		return fmt.Errorf(
			"%w: object part command is incomplete",
			ErrPrivateContentInvalid,
		)
	}
	return nil
}

func validatePrivateObjectCompleteCommand(
	command PrivateObjectCompleteCommand,
) error {
	if strings.TrimSpace(command.UploadID) == "" ||
		command.Generation == 0 ||
		strings.TrimSpace(command.UploaderPTID) == "" ||
		strings.TrimSpace(command.UploaderDeviceID) == "" ||
		strings.TrimSpace(command.CommandID) == "" ||
		len(command.CanonicalCommandBytes) == 0 ||
		len(command.CanonicalCommandSHA256) != sha256.Size ||
		len(command.DescriptorCommitmentHash) != sha256.Size ||
		strings.TrimSpace(command.LeaseOwner) == "" ||
		command.LeaseDuration <= 0 ||
		command.Now.IsZero() ||
		strings.TrimSpace(command.DeterministicFinalStoreKey) == "" {
		return fmt.Errorf(
			"%w: object complete command is incomplete",
			ErrPrivateContentInvalid,
		)
	}
	return nil
}

func validatePrivateObjectCancelCommand(
	command PrivateObjectCancelCommand,
) error {
	if strings.TrimSpace(command.UploadID) == "" ||
		command.Generation == 0 ||
		strings.TrimSpace(command.UploaderPTID) == "" ||
		strings.TrimSpace(command.UploaderDeviceID) == "" ||
		strings.TrimSpace(command.CommandID) == "" ||
		len(command.CanonicalCommandBytes) == 0 ||
		len(command.CanonicalCommandSHA256) != sha256.Size ||
		command.Now.IsZero() {
		return fmt.Errorf(
			"%w: object cancel command is incomplete",
			ErrPrivateContentInvalid,
		)
	}
	return nil
}

func validatePrivateObjectCompletion(
	completion PrivateObjectCompletion,
) error {
	if strings.TrimSpace(completion.Object.ObjectID) == "" ||
		completion.Object.State !=
			dbmodel.SocialPrivateObjectCompleteUnattached ||
		len(completion.Object.CanonicalDescriptorBytes) == 0 ||
		len(completion.Object.DescriptorSHA256) != sha256.Size ||
		strings.TrimSpace(completion.Object.StorageKey) == "" ||
		completion.Object.TotalCiphertextSize == 0 ||
		len(completion.Object.CiphertextSHA256) != sha256.Size ||
		len(completion.ResponseBytes) == 0 ||
		len(completion.ResponseSHA256) != sha256.Size ||
		completion.CompletedAt.IsZero() ||
		completion.UnattachedExpiresAt.IsZero() {
		return fmt.Errorf(
			"%w: private object completion is incomplete",
			ErrPrivateContentInvalid,
		)
	}
	return nil
}

func lockPrivateObjectUpload(
	tx *gorm.DB,
	uploadID string,
	generation uint64,
) (dbmodel.SocialPrivateObjectUpload, error) {
	var upload dbmodel.SocialPrivateObjectUpload
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"upload_id = ? AND generation = ?",
			uploadID,
			generation,
		).
		First(&upload).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return upload, ErrPrivateContentNotFound
	}
	return upload, err
}

func expirePrivateObjectUpload(
	tx *gorm.DB,
	upload *dbmodel.SocialPrivateObjectUpload,
	now time.Time,
) error {
	update := tx.Model(&dbmodel.SocialPrivateObjectUpload{}).
		Where(
			"upload_id = ? AND generation = ? AND state IN ?",
			upload.UploadID,
			upload.Generation,
			[]string{
				dbmodel.SocialPrivateObjectCreated,
				dbmodel.SocialPrivateObjectReceivingParts,
			},
		).
		Updates(map[string]any{
			"state":                   dbmodel.SocialPrivateObjectExpired,
			"cleanup_next_attempt_at": now.UTC(),
			"updated_at":              now.UTC(),
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return fmt.Errorf(
			"%w: object expiry transition raced",
			ErrPrivateContentInvalidState,
		)
	}
	upload.State = dbmodel.SocialPrivateObjectExpired
	cleanupAt := now.UTC()
	upload.CleanupNextAttempt = &cleanupAt
	upload.UpdatedAt = cleanupAt
	return nil
}

func decodePrivateObjectUploadSpec(
	upload dbmodel.SocialPrivateObjectUpload,
) (*securecontentpb.EncryptedObjectUploadSpec, error) {
	if err := validateExactDigest(
		"persisted object upload spec",
		upload.UploadSpecBytes,
		upload.UploadSpecSHA256,
	); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPrivateContentConflict, err)
	}
	var spec securecontentpb.EncryptedObjectUploadSpec
	if err := proto.Unmarshal(upload.UploadSpecBytes, &spec); err != nil {
		return nil, fmt.Errorf(
			"%w: decode object upload spec: %v",
			ErrPrivateContentConflict,
			err,
		)
	}
	if err := securecontentkernel.ValidateEncryptedObjectUploadSpec(
		&spec,
		securecontentkernel.DefaultPolicy(),
	); err != nil {
		return nil, fmt.Errorf(
			"%w: persisted object upload spec is invalid",
			ErrPrivateContentConflict,
		)
	}
	return &spec, nil
}

func uploadResourceGeneration(uploadSpecBytes []byte) uint64 {
	var spec securecontentpb.EncryptedObjectUploadSpec
	if proto.Unmarshal(uploadSpecBytes, &spec) != nil {
		return 0
	}
	return spec.GetResource().GetGeneration()
}

func samePrivateObjectPart(
	part dbmodel.SocialPrivateObjectChunk,
	command PrivateObjectPartCommand,
) bool {
	return part.UploadID == command.UploadID &&
		part.Generation == command.Generation &&
		part.ChunkIndex == command.ChunkIndex &&
		part.Offset == command.Offset &&
		part.Size == command.Size &&
		part.IdempotencyKey == command.IdempotencyKey &&
		part.StorageKey == command.DeterministicStoreKey &&
		bytes.Equal(part.CiphertextSHA256, command.CiphertextSHA256) &&
		bytes.Equal(
			part.CanonicalCommandSHA256,
			command.CanonicalCommandHash,
		)
}

func completePrivateObjectBitmap(bitmap []byte, chunkCount uint32) bool {
	for index := uint32(0); index < chunkCount; index++ {
		if bitmap[index/8]&byte(1<<(index%8)) == 0 {
			return false
		}
	}
	return true
}

func objectUploadCanExpire(state string) bool {
	return state == dbmodel.SocialPrivateObjectCreated ||
		state == dbmodel.SocialPrivateObjectReceivingParts
}

func hasActivePrivateObjectPartLease(
	tx *gorm.DB,
	uploadID string,
	generation uint64,
	now time.Time,
) (bool, error) {
	var count int64
	if err := tx.Model(&dbmodel.SocialPrivateObjectChunk{}).
		Where(
			"upload_id = ? AND generation = ? AND state = ? AND lease_expires_at > ?",
			uploadID,
			generation,
			dbmodel.SocialPrivateObjectPartWriting,
			now.UTC(),
		).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count != 0, nil
}

func privateObjectUploadLock(uploadID string, generation uint64) string {
	return fmt.Sprintf("object-upload:%s:%d", uploadID, generation)
}

func privateObjectUploaderLock(uploaderPTID string) string {
	return "object-uploader:" + uploaderPTID
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func clonePrivateObjectUpload(
	upload dbmodel.SocialPrivateObjectUpload,
) dbmodel.SocialPrivateObjectUpload {
	upload.UploadSpecBytes = cloneBytes(upload.UploadSpecBytes)
	upload.UploadSpecSHA256 = cloneBytes(upload.UploadSpecSHA256)
	upload.DescriptorCommitmentSHA256 = cloneBytes(
		upload.DescriptorCommitmentSHA256,
	)
	upload.BeginCommandBytes = cloneBytes(upload.BeginCommandBytes)
	upload.BeginCommandSHA256 = cloneBytes(upload.BeginCommandSHA256)
	upload.ReceivedChunkBitmap = cloneBytes(upload.ReceivedChunkBitmap)
	upload.CompleteCommandBytes = cloneBytes(upload.CompleteCommandBytes)
	upload.CompleteCommandSHA256 = cloneBytes(upload.CompleteCommandSHA256)
	upload.CompleteResponseBytes = cloneBytes(upload.CompleteResponseBytes)
	upload.CompleteResponseSHA256 = cloneBytes(upload.CompleteResponseSHA256)
	upload.CancelCommandBytes = cloneBytes(upload.CancelCommandBytes)
	upload.CancelCommandSHA256 = cloneBytes(upload.CancelCommandSHA256)
	return upload
}

func clonePrivateObjectPart(
	part dbmodel.SocialPrivateObjectChunk,
) dbmodel.SocialPrivateObjectChunk {
	part.CiphertextSHA256 = cloneBytes(part.CiphertextSHA256)
	part.CanonicalCommandSHA256 = cloneBytes(part.CanonicalCommandSHA256)
	return part
}

func clonePrivateObjectParts(
	parts []dbmodel.SocialPrivateObjectChunk,
) []dbmodel.SocialPrivateObjectChunk {
	result := make([]dbmodel.SocialPrivateObjectChunk, len(parts))
	for index := range parts {
		result[index] = clonePrivateObjectPart(parts[index])
	}
	return result
}

func clonePrivateObject(
	object dbmodel.SocialPrivateObjectAttachment,
) dbmodel.SocialPrivateObjectAttachment {
	object.CanonicalDescriptorBytes = cloneBytes(
		object.CanonicalDescriptorBytes,
	)
	object.DescriptorSHA256 = cloneBytes(object.DescriptorSHA256)
	object.CiphertextSHA256 = cloneBytes(object.CiphertextSHA256)
	return object
}

func cloneOptionalPrivateObject(
	object *dbmodel.SocialPrivateObjectAttachment,
) *dbmodel.SocialPrivateObjectAttachment {
	if object == nil {
		return nil
	}
	cloned := clonePrivateObject(*object)
	return &cloned
}

var _ PrivateObjectStore = (*GORMPrivateContentStore)(nil)
