package attachment

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository owns the canonical Conversation attachment metadata family.
type Repository struct {
	db              *gorm.DB
	sqliteMutex     sync.Mutex
	serializeSQLite bool
}

func NewRepository(db *gorm.DB) (*Repository, error) {
	if db == nil {
		return nil, attachment.NewError(
			attachment.ErrorCodeInvalidArgument,
			"attachment_repository.new",
			"database",
			"is required",
		)
	}

	return &Repository{
		db:              db,
		serializeSQLite: db.Dialector.Name() == "sqlite",
	}, nil
}

// AutoMigrate is test-only preparation. Production schema ownership remains at CA-W5.
func (r *Repository) AutoMigrate() error {
	if err := r.db.AutoMigrate(
		&UploadModel{},
		&UploadPartModel{},
		&ObjectModel{},
		&GrantModel{},
		&AuditModel{},
	); err != nil {
		return attachment.WrapError(
			attachment.ErrorCodePersistence,
			"attachment_repository.auto_migrate",
			err,
		)
	}

	return nil
}

func (r *Repository) CreateUpload(
	ctx context.Context,
	upload attachment.Upload,
	maximumActiveUploads int,
	audit attachment.AuditRecord,
) (attachment.Upload, bool, error) {
	if maximumActiveUploads <= 0 {
		return attachment.Upload{}, false, invalid("create_upload", "maximum_active_uploads")
	}
	model := uploadModel(upload)
	var persisted attachment.Upload
	var inserted bool
	err := r.transaction(ctx, "attachment_repository.create_upload", func(tx *gorm.DB) error {
		existing, found, err := findUploadByIdempotency(
			tx,
			upload.Uploader,
			upload.IdempotencyKey,
		)
		if err != nil {
			return err
		}
		if found {
			if !sameUpload(existing, model) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.create_upload",
					"idempotency_key",
					"already identifies a different upload",
				)
			}
			persisted, err = uploadFromModel(*existing)
			if err != nil {
				return err
			}
			audit.Outcome = attachment.AuditOutcomeReplay
			audit.UploadID = persisted.UploadID

			return appendAudit(tx, audit)
		}

		var active int64
		if err := tx.Model(&UploadModel{}).
			Where(
				"uploader_ptid = ? AND state IN ? AND expires_at > ?",
				string(upload.Uploader.Actor),
				[]int32{
					int32(attachment.TransferStateQueued),
					int32(attachment.TransferStateTransferring),
					int32(attachment.TransferStateVerifying),
				},
				upload.CreatedAt,
			).
			Count(&active).Error; err != nil {
			return err
		}
		if active >= int64(maximumActiveUploads) {
			return attachment.NewError(
				attachment.ErrorCodeQuotaExceeded,
				"attachment_repository.create_upload",
				"active_uploads",
				"would exceed the per-actor transfer limit",
			)
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			existing, found, err = findUploadByIdempotency(
				tx,
				upload.Uploader,
				upload.IdempotencyKey,
			)
			if err != nil {
				return err
			}
			if !found || !sameUpload(existing, model) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.create_upload",
					"idempotency_key",
					"raced with a different upload",
				)
			}
			persisted, err = uploadFromModel(*existing)
			if err != nil {
				return err
			}
			audit.Outcome = attachment.AuditOutcomeReplay
			audit.UploadID = persisted.UploadID

			return appendAudit(tx, audit)
		}
		inserted = true
		persisted, err = uploadFromModel(model)
		if err != nil {
			return err
		}

		return appendAudit(tx, audit)
	})
	if err != nil {
		return attachment.Upload{}, false, err
	}

	return persisted, inserted, nil
}

func (r *Repository) GetUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
) (attachment.Upload, error) {
	var model UploadModel
	err := r.db.WithContext(ctx).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		First(&model).Error
	if err != nil {
		return attachment.Upload{}, mapPersistenceError(
			"attachment_repository.get_upload",
			err,
		)
	}

	return uploadFromModel(model)
}

func (r *Repository) PutPart(
	ctx context.Context,
	part attachment.Part,
	updatedAt time.Time,
	audit attachment.AuditRecord,
) (bool, []byte, error) {
	var duplicate bool
	var bitmap []byte
	err := r.transaction(ctx, "attachment_repository.put_part", func(tx *gorm.DB) error {
		upload, err := lockUpload(tx, part.UploadID, part.Generation)
		if err != nil {
			return err
		}
		if upload.State != int32(attachment.TransferStateQueued) &&
			upload.State != int32(attachment.TransferStateTransferring) {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.put_part",
				"state",
				"is not receiving chunks",
			)
		}
		if !upload.ExpiresAt.After(updatedAt) {
			return attachment.NewError(
				attachment.ErrorCodeUploadExpired,
				"attachment_repository.put_part",
				"expires_at",
				"has elapsed",
			)
		}
		if part.ChunkIndex >= upload.ChunkCount {
			return invalid("put_part", "chunk_index")
		}

		var existing UploadPartModel
		findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"upload_id = ? AND generation = ? AND chunk_index = ?",
				part.UploadID,
				part.Generation,
				part.ChunkIndex,
			).
			First(&existing).Error
		switch {
		case findErr == nil:
			if !samePart(existing, part) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.put_part",
					"chunk_index",
					"already identifies different bytes",
				)
			}
			duplicate = true
			bitmap = append([]byte(nil), upload.ReceivedChunkBitmap...)
			audit.Outcome = attachment.AuditOutcomeReplay

			return appendAudit(tx, audit)
		case !errors.Is(findErr, gorm.ErrRecordNotFound):
			return findErr
		}

		if err := tx.Create(&UploadPartModel{
			UploadID:         part.UploadID,
			Generation:       part.Generation,
			ChunkIndex:       part.ChunkIndex,
			ByteOffset:       part.ByteOffset,
			CiphertextSize:   part.CiphertextSize,
			CiphertextSHA256: part.CiphertextHash.Bytes(),
			StorageKey:       part.StorageKey,
			CreatedAt:        part.CreatedAt.UTC(),
		}).Error; err != nil {
			return err
		}
		bitmap = append([]byte(nil), upload.ReceivedChunkBitmap...)
		bitmap[part.ChunkIndex/8] |= 1 << (part.ChunkIndex % 8)
		result := tx.Model(&UploadModel{}).
			Where(
				"upload_id = ? AND generation = ? AND state IN ?",
				part.UploadID,
				part.Generation,
				[]int32{
					int32(attachment.TransferStateQueued),
					int32(attachment.TransferStateTransferring),
				},
			).
			Updates(map[string]any{
				"received_chunk_bitmap": bitmap,
				"state":                 int32(attachment.TransferStateTransferring),
				"updated_at":            updatedAt.UTC(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.put_part",
				"state",
				"changed before the part commit",
			)
		}

		return appendAudit(tx, audit)
	})
	if err != nil {
		return false, nil, err
	}

	return duplicate, bitmap, nil
}

func (r *Repository) ListParts(
	ctx context.Context,
	uploadID string,
	generation uint64,
) ([]attachment.Part, error) {
	var models []UploadPartModel
	if err := r.db.WithContext(ctx).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		Order("chunk_index ASC").
		Find(&models).Error; err != nil {
		return nil, attachment.WrapError(
			attachment.ErrorCodePersistence,
			"attachment_repository.list_parts",
			err,
		)
	}
	parts := make([]attachment.Part, 0, len(models))
	for _, model := range models {
		hash, err := valueobject.NewHash(model.CiphertextSHA256)
		if err != nil {
			return nil, attachment.WrapError(
				attachment.ErrorCodeIntegrityFailed,
				"attachment_repository.list_parts",
				err,
			)
		}
		parts = append(parts, attachment.Part{
			UploadID:       model.UploadID,
			Generation:     model.Generation,
			ChunkIndex:     model.ChunkIndex,
			ByteOffset:     model.ByteOffset,
			CiphertextSize: model.CiphertextSize,
			CiphertextHash: hash,
			StorageKey:     model.StorageKey,
			CreatedAt:      model.CreatedAt,
		})
	}

	return parts, nil
}

func (r *Repository) CompleteUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
	object attachment.Object,
	completedAt time.Time,
	audit attachment.AuditRecord,
) (bool, error) {
	var duplicate bool
	err := r.transaction(ctx, "attachment_repository.complete_upload", func(tx *gorm.DB) error {
		upload, err := lockUpload(tx, uploadID, generation)
		if err != nil {
			return err
		}
		if upload.State == int32(attachment.TransferStateComplete) {
			existing, err := getObject(tx, valueobject.ObjectID(upload.ObjectID))
			if err != nil {
				return err
			}
			if !sameObject(existing, object) {
				return attachment.NewError(
					attachment.ErrorCodePartConflict,
					"attachment_repository.complete_upload",
					"object",
					"does not match the completed upload",
				)
			}
			duplicate = true
			audit.Outcome = attachment.AuditOutcomeReplay

			return appendAudit(tx, audit)
		}
		if upload.State != int32(attachment.TransferStateTransferring) {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.complete_upload",
				"state",
				"is not ready for completion",
			)
		}
		if !bytes.Equal(
			upload.DescriptorCommitmentSHA256,
			object.DescriptorCommitment.Bytes(),
		) || !objectMatchesUpload(object, upload) {
			return attachment.NewError(
				attachment.ErrorCodePartConflict,
				"attachment_repository.complete_upload",
				"object",
				"does not match the immutable upload",
			)
		}
		var partCount int64
		if err := tx.Model(&UploadPartModel{}).
			Where("upload_id = ? AND generation = ?", uploadID, generation).
			Count(&partCount).Error; err != nil {
			return err
		}
		if partCount != int64(upload.ChunkCount) {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.complete_upload",
				"parts",
				"are incomplete",
			)
		}

		model := objectModel(object)
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model)
		if result.Error != nil {
			return result.Error
		}
		existing, err := getObject(tx, object.ObjectID)
		if err != nil {
			return err
		}
		if !sameObject(existing, object) {
			return attachment.NewError(
				attachment.ErrorCodePartConflict,
				"attachment_repository.complete_upload",
				"object_id",
				"already identifies a different object",
			)
		}
		update := tx.Model(&UploadModel{}).
			Where(
				"upload_id = ? AND generation = ? AND state = ?",
				uploadID,
				generation,
				int32(attachment.TransferStateTransferring),
			).
			Updates(map[string]any{
				"state":       int32(attachment.TransferStateComplete),
				"object_id":   string(object.ObjectID),
				"storage_ref": object.StorageRef,
				"updated_at":  completedAt.UTC(),
			})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.complete_upload",
				"state",
				"changed before completion",
			)
		}

		return appendAudit(tx, audit)
	})

	return duplicate, err
}

func (r *Repository) CancelUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
	cancelledAt time.Time,
	audit attachment.AuditRecord,
) ([]attachment.Part, bool, error) {
	var parts []attachment.Part
	var duplicate bool
	err := r.transaction(ctx, "attachment_repository.cancel_upload", func(tx *gorm.DB) error {
		upload, err := lockUpload(tx, uploadID, generation)
		if err != nil {
			return err
		}
		switch attachment.TransferState(upload.State) {
		case attachment.TransferStateCancelled:
			duplicate = true
			audit.Outcome = attachment.AuditOutcomeReplay
		case attachment.TransferStateQueued, attachment.TransferStateTransferring:
			if err := tx.Model(&UploadModel{}).
				Where("upload_id = ? AND generation = ?", uploadID, generation).
				Updates(map[string]any{
					"state":      int32(attachment.TransferStateCancelled),
					"updated_at": cancelledAt.UTC(),
				}).Error; err != nil {
				return err
			}
		default:
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.cancel_upload",
				"state",
				"cannot be cancelled",
			)
		}
		var models []UploadPartModel
		if err := tx.Where("upload_id = ? AND generation = ?", uploadID, generation).
			Order("chunk_index ASC").
			Find(&models).Error; err != nil {
			return err
		}
		for _, model := range models {
			hash, err := valueobject.NewHash(model.CiphertextSHA256)
			if err != nil {
				return err
			}
			parts = append(parts, attachment.Part{
				UploadID:       model.UploadID,
				Generation:     model.Generation,
				ChunkIndex:     model.ChunkIndex,
				ByteOffset:     model.ByteOffset,
				CiphertextSize: model.CiphertextSize,
				CiphertextHash: hash,
				StorageKey:     model.StorageKey,
				CreatedAt:      model.CreatedAt,
			})
		}

		return appendAudit(tx, audit)
	})
	if err != nil {
		return nil, false, err
	}

	return parts, duplicate, nil
}

func (r *Repository) GetObject(
	ctx context.Context,
	objectID valueobject.ObjectID,
) (attachment.Object, error) {
	return getObject(r.db.WithContext(ctx), objectID)
}

func (r *Repository) GetGrantedObject(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	objectID valueobject.ObjectID,
	recipient valueobject.PTID,
) (attachment.Object, error) {
	var model ObjectModel
	err := r.db.WithContext(ctx).
		Table("conversation_attachment_objects AS objects").
		Select("objects.*").
		Joins(
			"JOIN conversation_attachment_grants AS grants "+
				"ON grants.object_id = objects.object_id "+
				"AND grants.conversation_id = objects.conversation_id",
		).
		Where(
			"objects.object_id = ? AND objects.conversation_id = ? "+
				"AND objects.state = ? AND grants.recipient_ptid = ?",
			string(objectID),
			string(conversationID),
			string(attachment.ObjectStateAttached),
			string(recipient),
		).
		First(&model).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.Object{}, attachment.NewError(
			attachment.ErrorCodeNotGranted,
			"attachment_repository.get_granted_object",
			"grant",
			"does not authorize this actor and object",
		)
	}
	if err != nil {
		return attachment.Object{}, attachment.WrapError(
			attachment.ErrorCodePersistence,
			"attachment_repository.get_granted_object",
			err,
		)
	}

	return objectFromModel(model)
}

func (r *Repository) AppendAudit(
	ctx context.Context,
	record attachment.AuditRecord,
) error {
	return r.transaction(ctx, "attachment_repository.append_audit", func(tx *gorm.DB) error {
		return appendAudit(tx, record)
	})
}

// Grant implements the CA-W2 ObjectGrantWriter against the same canonical
// attachment family used by upload and download.
func (r *Repository) Grant(ctx context.Context, grant ports.ObjectGrant) error {
	if grant.ObjectID == "" || grant.ConversationID == "" ||
		grant.EventID == "" || grant.Recipient == "" || grant.GrantedAt.IsZero() {
		return invalid("grant", "grant")
	}

	return r.transaction(ctx, "attachment_repository.grant", func(tx *gorm.DB) error {
		var model ObjectModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("object_id = ?", string(grant.ObjectID)).
			First(&model).Error; err != nil {
			return mapPersistenceError("attachment_repository.grant.load_object", err)
		}
		if model.ConversationID != string(grant.ConversationID) {
			return attachment.NewError(
				attachment.ErrorCodePartConflict,
				"attachment_repository.grant",
				"conversation_id",
				"does not match the completed object",
			)
		}
		if model.State != string(attachment.ObjectStateCompleteUnattached) &&
			!(model.State == string(attachment.ObjectStateAttached) &&
				model.EventID == string(grant.EventID)) {
			return attachment.NewError(
				attachment.ErrorCodeInvalidState,
				"attachment_repository.grant",
				"object",
				"is not grantable for this event",
			)
		}

		candidate := GrantModel{
			ObjectID:       string(grant.ObjectID),
			ConversationID: string(grant.ConversationID),
			RecipientPTID:  string(grant.Recipient),
			MessageID:      model.MessageID,
			EventID:        string(grant.EventID),
			GrantedAt:      grant.GrantedAt.UTC(),
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
		if result.Error != nil {
			return result.Error
		}
		var persisted GrantModel
		if err := tx.Where(
			"object_id = ? AND conversation_id = ? AND recipient_ptid = ?",
			candidate.ObjectID,
			candidate.ConversationID,
			candidate.RecipientPTID,
		).First(&persisted).Error; err != nil {
			return err
		}
		if persisted.MessageID != candidate.MessageID ||
			persisted.EventID != candidate.EventID {
			return attachment.NewError(
				attachment.ErrorCodePartConflict,
				"attachment_repository.grant",
				"grant",
				"already binds the actor to a different event",
			)
		}

		update := tx.Model(&ObjectModel{}).
			Where(
				"object_id = ? AND state = ? AND event_id = ?",
				candidate.ObjectID,
				string(attachment.ObjectStateCompleteUnattached),
				"",
			).
			Updates(map[string]any{
				"event_id": candidate.EventID,
				"state":    string(attachment.ObjectStateAttached),
			})
		if update.Error != nil {
			return update.Error
		}
		outcome := attachment.AuditOutcomeCommitted
		if result.RowsAffected == 0 && update.RowsAffected == 0 {
			outcome = attachment.AuditOutcomeReplay
		}
		auditID := valueobject.HashBytes(valueobject.CanonicalTuple(
			[]byte("conversation-attachment-grant-audit"),
			[]byte(candidate.ObjectID),
			[]byte(candidate.ConversationID),
			[]byte(candidate.RecipientPTID),
			[]byte(candidate.EventID),
			[]byte(outcome),
		)).String()

		return appendAudit(tx, attachment.AuditRecord{
			AuditID:        auditID,
			Action:         attachment.AuditActionGrant,
			Outcome:        outcome,
			ConversationID: grant.ConversationID,
			MessageID:      valueobject.MessageID(model.MessageID),
			AttachmentID:   model.AttachmentID,
			ObjectID:       grant.ObjectID,
			EventID:        grant.EventID,
			Actor:          grant.Recipient,
			ByteCount:      model.CiphertextSize,
			CreatedAt:      grant.GrantedAt.UTC(),
		})
	})
}

func (r *Repository) transaction(
	ctx context.Context,
	operation string,
	fn func(*gorm.DB) error,
) error {
	if r.serializeSQLite {
		r.sqliteMutex.Lock()
		defer r.sqliteMutex.Unlock()
	}
	err := r.db.WithContext(ctx).Transaction(fn)
	if err == nil || attachment.CodeOf(err) != "" {
		return err
	}

	return attachment.WrapError(attachment.ErrorCodePersistence, operation, err)
}

func findUploadByIdempotency(
	tx *gorm.DB,
	uploader valueobject.Endpoint,
	idempotencyKey string,
) (*UploadModel, bool, error) {
	var model UploadModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"uploader_ptid = ? AND uploader_device_id = ? AND idempotency_key = ?",
			string(uploader.Actor),
			string(uploader.Device),
			idempotencyKey,
		).
		First(&model).Error
	switch {
	case err == nil:
		return &model, true, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil, false, nil
	default:
		return nil, false, err
	}
}

func lockUpload(tx *gorm.DB, uploadID string, generation uint64) (*UploadModel, error) {
	var model UploadModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		First(&model).Error
	if err != nil {
		return nil, mapPersistenceError("attachment_repository.lock_upload", err)
	}

	return &model, nil
}

func getObject(tx *gorm.DB, objectID valueobject.ObjectID) (attachment.Object, error) {
	var model ObjectModel
	if err := tx.Where("object_id = ?", string(objectID)).First(&model).Error; err != nil {
		return attachment.Object{}, mapPersistenceError(
			"attachment_repository.get_object",
			err,
		)
	}

	return objectFromModel(model)
}

func appendAudit(tx *gorm.DB, record attachment.AuditRecord) error {
	if strings.TrimSpace(record.AuditID) == "" ||
		!validAuditAction(record.Action) ||
		!validAuditOutcome(record.Outcome) ||
		record.CreatedAt.IsZero() {
		return invalid("append_audit", "record")
	}

	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&AuditModel{
		AuditID:        record.AuditID,
		Action:         string(record.Action),
		Outcome:        string(record.Outcome),
		ConversationID: string(record.ConversationID),
		MessageID:      string(record.MessageID),
		AttachmentID:   record.AttachmentID,
		UploadID:       record.UploadID,
		ObjectID:       string(record.ObjectID),
		EventID:        string(record.EventID),
		ActorPTID:      string(record.Actor),
		DeviceID:       string(record.Device),
		ChunkIndex:     record.ChunkIndex,
		ByteCount:      record.ByteCount,
		CreatedAt:      record.CreatedAt.UTC(),
	}).Error
}

func uploadModel(upload attachment.Upload) UploadModel {
	return UploadModel{
		UploadID:                   upload.UploadID,
		Generation:                 upload.Generation,
		ConversationID:             string(upload.ConversationID),
		MessageID:                  string(upload.MessageID),
		AttachmentID:               upload.AttachmentID,
		UploaderPTID:               string(upload.Uploader.Actor),
		UploaderDeviceID:           string(upload.Uploader.Device),
		CiphertextSize:             upload.Spec.CiphertextSize,
		CiphertextSHA256:           upload.Spec.CiphertextHash.Bytes(),
		MediaType:                  upload.Spec.MediaType,
		ChunkSize:                  upload.Spec.ChunkSize,
		ChunkCount:                 upload.Spec.ChunkCount,
		EncryptionSuite:            int32(upload.Spec.Encryption),
		TagSize:                    upload.Spec.TagSize,
		NonceStrategy:              int32(upload.Spec.NonceStrategy),
		ChunkCiphertextSHA256:      encodeHashes(upload.Spec.ChunkHashes),
		DescriptorCommitmentSHA256: upload.DescriptorCommitment.Bytes(),
		IdempotencyKey:             upload.IdempotencyKey,
		State:                      int32(upload.State),
		ReceivedChunkBitmap:        append([]byte(nil), upload.ReceivedChunkBitmap...),
		ObjectID:                   string(upload.ObjectID),
		StorageRef:                 upload.StorageRef,
		ExpiresAt:                  upload.ExpiresAt.UTC(),
		CreatedAt:                  upload.CreatedAt.UTC(),
		UpdatedAt:                  upload.UpdatedAt.UTC(),
	}
}

func uploadFromModel(model UploadModel) (attachment.Upload, error) {
	ciphertextHash, err := valueobject.NewHash(model.CiphertextSHA256)
	if err != nil {
		return attachment.Upload{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_upload_hash",
			err,
		)
	}
	commitment, err := valueobject.NewHash(model.DescriptorCommitmentSHA256)
	if err != nil {
		return attachment.Upload{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_upload_commitment",
			err,
		)
	}
	chunkHashes, err := decodeHashes(model.ChunkCiphertextSHA256, model.ChunkCount)
	if err != nil {
		return attachment.Upload{}, err
	}

	return attachment.Upload{
		UploadID:       model.UploadID,
		Generation:     model.Generation,
		ConversationID: valueobject.ConversationID(model.ConversationID),
		MessageID:      valueobject.MessageID(model.MessageID),
		AttachmentID:   model.AttachmentID,
		Uploader: valueobject.Endpoint{
			Actor:  valueobject.PTID(model.UploaderPTID),
			Device: valueobject.DeviceID(model.UploaderDeviceID),
		},
		Spec: attachment.UploadSpec{
			CiphertextSize: model.CiphertextSize,
			CiphertextHash: ciphertextHash,
			MediaType:      model.MediaType,
			ChunkSize:      model.ChunkSize,
			ChunkCount:     model.ChunkCount,
			Encryption:     attachment.EncryptionSuite(model.EncryptionSuite),
			TagSize:        model.TagSize,
			NonceStrategy:  attachment.NonceStrategy(model.NonceStrategy),
			ChunkHashes:    chunkHashes,
		},
		DescriptorCommitment: commitment,
		IdempotencyKey:       model.IdempotencyKey,
		State:                attachment.TransferState(model.State),
		ReceivedChunkBitmap:  append([]byte(nil), model.ReceivedChunkBitmap...),
		ObjectID:             valueobject.ObjectID(model.ObjectID),
		StorageRef:           model.StorageRef,
		ExpiresAt:            model.ExpiresAt,
		CreatedAt:            model.CreatedAt,
		UpdatedAt:            model.UpdatedAt,
	}, nil
}

func objectModel(object attachment.Object) ObjectModel {
	return ObjectModel{
		ObjectID:                   string(object.ObjectID),
		StorageRef:                 object.StorageRef,
		StorageKey:                 object.StorageKey,
		ConversationID:             string(object.ConversationID),
		MessageID:                  string(object.MessageID),
		AttachmentID:               object.AttachmentID,
		UploaderPTID:               string(object.Uploader),
		CiphertextSize:             object.Spec.CiphertextSize,
		CiphertextSHA256:           object.Spec.CiphertextHash.Bytes(),
		MediaType:                  object.Spec.MediaType,
		ChunkSize:                  object.Spec.ChunkSize,
		ChunkCount:                 object.Spec.ChunkCount,
		EncryptionSuite:            int32(object.Spec.Encryption),
		TagSize:                    object.Spec.TagSize,
		NonceStrategy:              int32(object.Spec.NonceStrategy),
		ChunkCiphertextSHA256:      encodeHashes(object.Spec.ChunkHashes),
		DescriptorCommitmentSHA256: object.DescriptorCommitment.Bytes(),
		EventID:                    string(object.EventID),
		State:                      string(object.State),
		CreatedAt:                  object.CreatedAt.UTC(),
	}
}

func objectFromModel(model ObjectModel) (attachment.Object, error) {
	ciphertextHash, err := valueobject.NewHash(model.CiphertextSHA256)
	if err != nil {
		return attachment.Object{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_object_hash",
			err,
		)
	}
	commitment, err := valueobject.NewHash(model.DescriptorCommitmentSHA256)
	if err != nil {
		return attachment.Object{}, attachment.WrapError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_object_commitment",
			err,
		)
	}
	chunkHashes, err := decodeHashes(model.ChunkCiphertextSHA256, model.ChunkCount)
	if err != nil {
		return attachment.Object{}, err
	}

	return attachment.Object{
		ObjectID:       valueobject.ObjectID(model.ObjectID),
		StorageRef:     model.StorageRef,
		StorageKey:     model.StorageKey,
		ConversationID: valueobject.ConversationID(model.ConversationID),
		MessageID:      valueobject.MessageID(model.MessageID),
		AttachmentID:   model.AttachmentID,
		Uploader:       valueobject.PTID(model.UploaderPTID),
		Spec: attachment.UploadSpec{
			CiphertextSize: model.CiphertextSize,
			CiphertextHash: ciphertextHash,
			MediaType:      model.MediaType,
			ChunkSize:      model.ChunkSize,
			ChunkCount:     model.ChunkCount,
			Encryption:     attachment.EncryptionSuite(model.EncryptionSuite),
			TagSize:        model.TagSize,
			NonceStrategy:  attachment.NonceStrategy(model.NonceStrategy),
			ChunkHashes:    chunkHashes,
		},
		DescriptorCommitment: commitment,
		EventID:              valueobject.EventID(model.EventID),
		State:                attachment.ObjectState(model.State),
		CreatedAt:            model.CreatedAt,
	}, nil
}

func sameUpload(left *UploadModel, right UploadModel) bool {
	return left.ConversationID == right.ConversationID &&
		left.MessageID == right.MessageID &&
		left.AttachmentID == right.AttachmentID &&
		left.UploaderPTID == right.UploaderPTID &&
		left.UploaderDeviceID == right.UploaderDeviceID &&
		left.CiphertextSize == right.CiphertextSize &&
		bytes.Equal(left.CiphertextSHA256, right.CiphertextSHA256) &&
		left.MediaType == right.MediaType &&
		left.ChunkSize == right.ChunkSize &&
		left.ChunkCount == right.ChunkCount &&
		left.EncryptionSuite == right.EncryptionSuite &&
		left.TagSize == right.TagSize &&
		left.NonceStrategy == right.NonceStrategy &&
		bytes.Equal(left.ChunkCiphertextSHA256, right.ChunkCiphertextSHA256) &&
		bytes.Equal(
			left.DescriptorCommitmentSHA256,
			right.DescriptorCommitmentSHA256,
		)
}

func samePart(model UploadPartModel, part attachment.Part) bool {
	return model.ByteOffset == part.ByteOffset &&
		model.CiphertextSize == part.CiphertextSize &&
		bytes.Equal(model.CiphertextSHA256, part.CiphertextHash.Bytes()) &&
		model.StorageKey == part.StorageKey
}

func sameObject(persisted attachment.Object, candidate attachment.Object) bool {
	return persisted.ObjectID == candidate.ObjectID &&
		persisted.StorageRef == candidate.StorageRef &&
		persisted.StorageKey == candidate.StorageKey &&
		persisted.ConversationID == candidate.ConversationID &&
		persisted.MessageID == candidate.MessageID &&
		persisted.AttachmentID == candidate.AttachmentID &&
		persisted.Uploader == candidate.Uploader &&
		persisted.DescriptorCommitment == candidate.DescriptorCommitment &&
		sameSpec(persisted.Spec, candidate.Spec)
}

func objectMatchesUpload(object attachment.Object, upload *UploadModel) bool {
	return string(object.ConversationID) == upload.ConversationID &&
		string(object.MessageID) == upload.MessageID &&
		object.AttachmentID == upload.AttachmentID &&
		string(object.Uploader) == upload.UploaderPTID &&
		object.Spec.CiphertextSize == upload.CiphertextSize &&
		bytes.Equal(object.Spec.CiphertextHash.Bytes(), upload.CiphertextSHA256) &&
		object.Spec.MediaType == upload.MediaType &&
		object.Spec.ChunkSize == upload.ChunkSize &&
		object.Spec.ChunkCount == upload.ChunkCount &&
		int32(object.Spec.Encryption) == upload.EncryptionSuite &&
		object.Spec.TagSize == upload.TagSize &&
		int32(object.Spec.NonceStrategy) == upload.NonceStrategy &&
		bytes.Equal(
			encodeHashes(object.Spec.ChunkHashes),
			upload.ChunkCiphertextSHA256,
		)
}

func sameSpec(left attachment.UploadSpec, right attachment.UploadSpec) bool {
	if left.CiphertextSize != right.CiphertextSize ||
		left.CiphertextHash != right.CiphertextHash ||
		left.MediaType != right.MediaType ||
		left.ChunkSize != right.ChunkSize ||
		left.ChunkCount != right.ChunkCount ||
		left.Encryption != right.Encryption ||
		left.TagSize != right.TagSize ||
		left.NonceStrategy != right.NonceStrategy ||
		len(left.ChunkHashes) != len(right.ChunkHashes) {
		return false
	}
	for index := range left.ChunkHashes {
		if left.ChunkHashes[index] != right.ChunkHashes[index] {
			return false
		}
	}

	return true
}

func encodeHashes(values []valueobject.Hash) []byte {
	encoded := make([]byte, 0, len(values)*32)
	for _, value := range values {
		encoded = append(encoded, value[:]...)
	}

	return encoded
}

func decodeHashes(encoded []byte, count uint32) ([]valueobject.Hash, error) {
	if len(encoded) != int(count)*32 {
		return nil, attachment.NewError(
			attachment.ErrorCodeIntegrityFailed,
			"attachment_repository.decode_chunk_hashes",
			"chunk_ciphertext_sha256",
			"does not match the stored chunk count",
		)
	}
	hashes := make([]valueobject.Hash, count)
	for index := range hashes {
		copy(hashes[index][:], encoded[index*32:(index+1)*32])
	}

	return hashes, nil
}

func validAuditAction(action attachment.AuditAction) bool {
	switch action {
	case attachment.AuditActionBegin,
		attachment.AuditActionPart,
		attachment.AuditActionComplete,
		attachment.AuditActionCancel,
		attachment.AuditActionGrant,
		attachment.AuditActionDownload:
		return true
	default:
		return false
	}
}

func validAuditOutcome(outcome attachment.AuditOutcome) bool {
	switch outcome {
	case attachment.AuditOutcomeCommitted, attachment.AuditOutcomeReplay:
		return true
	default:
		return false
	}
}

func mapPersistenceError(operation string, err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return attachment.NewError(
			attachment.ErrorCodeNotFound,
			operation,
			"record",
			"was not found",
		)
	}
	if attachment.CodeOf(err) != "" {
		return err
	}

	return attachment.WrapError(attachment.ErrorCodePersistence, operation, err)
}

func invalid(operation string, field string) error {
	return attachment.NewError(
		attachment.ErrorCodeInvalidArgument,
		"attachment_repository."+operation,
		field,
		"is invalid",
	)
}

var _ attachment.Repository = (*Repository)(nil)
var _ ports.ObjectGrantWriter = (*Repository)(nil)
