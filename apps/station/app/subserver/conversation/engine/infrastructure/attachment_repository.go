package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AttachmentUploadModel struct {
	UploadID                   string    `gorm:"column:upload_id;size:64;primaryKey"`
	Generation                 uint64    `gorm:"column:generation;not null"`
	ConversationID             string    `gorm:"column:conversation_id;size:128;not null;index"`
	MessageID                  string    `gorm:"column:message_id;size:128;not null"`
	AttachmentID               string    `gorm:"column:attachment_id;size:128;not null"`
	UploaderPTID               string    `gorm:"column:uploader_ptid;size:255;not null;uniqueIndex:uidx_messaging_attachment_upload_idempotency"`
	UploaderDeviceID           string    `gorm:"column:uploader_device_id;size:255;not null;uniqueIndex:uidx_messaging_attachment_upload_idempotency"`
	ObjectSpecBytes            []byte    `gorm:"column:object_spec_bytes;type:bytea;not null"`
	DescriptorCommitmentSHA256 []byte    `gorm:"column:descriptor_commitment_sha256;type:bytea;not null"`
	IdempotencyKey             string    `gorm:"column:idempotency_key;size:128;not null;uniqueIndex:uidx_messaging_attachment_upload_idempotency"`
	State                      int32     `gorm:"column:state;not null;index"`
	ReceivedChunkBitmap        []byte    `gorm:"column:received_chunk_bitmap;type:bytea;not null"`
	ObjectID                   string    `gorm:"column:object_id;size:64"`
	StorageRef                 string    `gorm:"column:storage_ref;size:128"`
	ExpiresAt                  time.Time `gorm:"column:expires_at;not null;index"`
	CreatedAt                  time.Time `gorm:"column:created_at;not null"`
	UpdatedAt                  time.Time `gorm:"column:updated_at;not null"`
}

func (*AttachmentUploadModel) TableName() string {
	return "messaging_attachment_uploads"
}

type AttachmentUploadPartModel struct {
	UploadID         string    `gorm:"column:upload_id;size:64;primaryKey"`
	Generation       uint64    `gorm:"column:generation;primaryKey"`
	ChunkIndex       uint32    `gorm:"column:chunk_index;primaryKey"`
	ByteOffset       uint64    `gorm:"column:byte_offset;not null"`
	CiphertextSize   uint64    `gorm:"column:ciphertext_size;not null"`
	CiphertextSHA256 []byte    `gorm:"column:ciphertext_sha256;type:bytea;not null"`
	StorageKey       string    `gorm:"column:storage_key;size:255;not null"`
	CreatedAt        time.Time `gorm:"column:created_at;not null"`
}

func (*AttachmentUploadPartModel) TableName() string {
	return "messaging_attachment_upload_parts"
}

type AttachmentObjectModel struct {
	ObjectID         string    `gorm:"column:object_id;size:64;primaryKey"`
	StorageRef       string    `gorm:"column:storage_ref;size:128;not null;uniqueIndex"`
	DescriptorBytes  []byte    `gorm:"column:descriptor_bytes;type:bytea;not null"`
	StorageKey       string    `gorm:"column:storage_key;size:255;not null"`
	UploaderPTID     string    `gorm:"column:uploader_ptid;size:255;not null"`
	ConversationID   string    `gorm:"column:conversation_id;size:128;not null;index"`
	MessageID        string    `gorm:"column:message_id;size:128;not null"`
	AttachmentID     string    `gorm:"column:attachment_id;size:128;not null;default:''"`
	CiphertextSize   uint64    `gorm:"column:ciphertext_size;not null;default:0"`
	CiphertextSHA256 []byte    `gorm:"column:ciphertext_sha256;type:bytea"`
	EventID          string    `gorm:"column:event_id;size:64;index"`
	State            string    `gorm:"column:state;size:32;not null;default:complete_unattached;index"`
	CreatedAt        time.Time `gorm:"column:created_at;not null"`
}

func (*AttachmentObjectModel) TableName() string {
	return "messaging_attachment_objects"
}

type AttachmentGrantModel struct {
	ObjectID       string    `gorm:"column:object_id;size:64;primaryKey"`
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey"`
	RecipientPTID  string    `gorm:"column:recipient_ptid;size:255;primaryKey"`
	MessageID      string    `gorm:"column:message_id;size:128;not null"`
	EventID        string    `gorm:"column:event_id;size:64;not null;default:'';index"`
	GrantedAt      time.Time `gorm:"column:granted_at;not null"`
}

func (*AttachmentGrantModel) TableName() string {
	return "messaging_attachment_grants"
}

type AttachmentAuditModel struct {
	AuditID        string    `gorm:"column:audit_id;size:64;primaryKey"`
	Action         string    `gorm:"column:action;size:32;not null;index:idx_messaging_attachment_audit_metric"`
	Outcome        string    `gorm:"column:outcome;size:32;not null;index:idx_messaging_attachment_audit_metric"`
	ConversationID string    `gorm:"column:conversation_id;size:128;index"`
	MessageID      string    `gorm:"column:message_id;size:128"`
	AttachmentID   string    `gorm:"column:attachment_id;size:128"`
	UploadID       string    `gorm:"column:upload_id;size:64;index"`
	ObjectID       string    `gorm:"column:object_id;size:64;index"`
	EventID        string    `gorm:"column:event_id;size:64;index"`
	ActorPTID      string    `gorm:"column:actor_ptid;size:255"`
	DeviceID       string    `gorm:"column:device_id;size:255"`
	ChunkIndex     uint32    `gorm:"column:chunk_index;not null"`
	ByteCount      uint64    `gorm:"column:byte_count;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;not null;index"`
}

func (*AttachmentAuditModel) TableName() string {
	return "messaging_attachment_audit"
}

type AttachmentRepository struct {
	db *gorm.DB
}

func NewAttachmentRepository(db *gorm.DB) *AttachmentRepository {
	return &AttachmentRepository{db: db}
}

func (r *AttachmentRepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&AttachmentUploadModel{},
		&AttachmentUploadPartModel{},
		&AttachmentObjectModel{},
		&AttachmentGrantModel{},
		&AttachmentAuditModel{},
	)
}

func (r *AttachmentRepository) CreateUpload(
	ctx context.Context,
	upload *messaging.AttachmentUpload,
) (*messaging.AttachmentUpload, bool, error) {
	if upload == nil || upload.Uploader == nil || upload.Object == nil {
		return nil, false, messaging.ErrAttachmentDescriptor
	}
	objectBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(upload.Object)
	if err != nil {
		return nil, false, fmt.Errorf("messaging: marshal attachment upload spec: %w", err)
	}
	var existing AttachmentUploadModel
	findExisting := r.db.WithContext(ctx).
		Where(
			"uploader_ptid = ? AND uploader_device_id = ? AND idempotency_key = ?",
			upload.Uploader.Ptid,
			upload.Uploader.DeviceId,
			upload.IdempotencyKey,
		).
		First(&existing).Error
	if findExisting == nil {
		return replayedAttachmentUpload(existing, upload, objectBytes)
	}
	if !errors.Is(findExisting, gorm.ErrRecordNotFound) {
		return nil, false, findExisting
	}
	var activeUploads int64
	if err := r.db.WithContext(ctx).
		Model(&AttachmentUploadModel{}).
		Where(
			"uploader_ptid = ? AND state IN ? AND expires_at > ?",
			upload.Uploader.Ptid,
			[]int32{
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED),
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING),
			},
			upload.CreatedAt,
		).
		Count(&activeUploads).Error; err != nil {
		return nil, false, err
	}
	if activeUploads >= messaging.AttachmentMaxActiveUploads {
		return nil, false, messaging.ErrAttachmentQuota
	}
	model := attachmentUploadModel(upload, objectBytes)
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		created, err := uploadFromModel(model)
		return created, true, err
	}
	if err := r.db.WithContext(ctx).
		Where(
			"uploader_ptid = ? AND uploader_device_id = ? AND idempotency_key = ?",
			upload.Uploader.Ptid,
			upload.Uploader.DeviceId,
			upload.IdempotencyKey,
		).
		First(&existing).Error; err != nil {
		return nil, false, mapNotFound(err)
	}
	return replayedAttachmentUpload(existing, upload, objectBytes)
}

func (r *AttachmentRepository) GetUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
) (*messaging.AttachmentUpload, error) {
	return r.getUpload(ctx, uploadID, generation, false)
}

func (r *AttachmentRepository) LockUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
) (*messaging.AttachmentUpload, error) {
	return r.getUpload(ctx, uploadID, generation, true)
}

func (r *AttachmentRepository) getUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
	lock bool,
) (*messaging.AttachmentUpload, error) {
	query := r.db.WithContext(ctx)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var model AttachmentUploadModel
	if err := query.Where("upload_id = ? AND generation = ?", uploadID, generation).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return uploadFromModel(model)
}

func (r *AttachmentRepository) PutPart(
	ctx context.Context,
	part *messaging.AttachmentPart,
) (bool, error) {
	if part == nil || len(part.CiphertextSHA256) != 32 {
		return false, messaging.ErrAttachmentDescriptor
	}
	model := AttachmentUploadPartModel{
		UploadID:         part.UploadID,
		Generation:       part.Generation,
		ChunkIndex:       part.ChunkIndex,
		ByteOffset:       part.ByteOffset,
		CiphertextSize:   part.CiphertextSize,
		CiphertextSHA256: append([]byte(nil), part.CiphertextSHA256...),
		StorageKey:       part.StorageKey,
		CreatedAt:        part.CreatedAt,
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return false, nil
	}
	var existing AttachmentUploadPartModel
	if err := r.db.WithContext(ctx).
		Where(
			"upload_id = ? AND generation = ? AND chunk_index = ?",
			part.UploadID,
			part.Generation,
			part.ChunkIndex,
		).
		First(&existing).Error; err != nil {
		return false, mapNotFound(err)
	}
	if existing.ByteOffset != part.ByteOffset ||
		existing.CiphertextSize != part.CiphertextSize ||
		!bytes.Equal(existing.CiphertextSHA256, part.CiphertextSHA256) {
		return false, messaging.ErrAttachmentConflict
	}
	return true, nil
}

func (r *AttachmentRepository) ListParts(
	ctx context.Context,
	uploadID string,
	generation uint64,
) ([]messaging.AttachmentPart, error) {
	var models []AttachmentUploadPartModel
	if err := r.db.WithContext(ctx).
		Where("upload_id = ? AND generation = ?", uploadID, generation).
		Order("chunk_index ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	parts := make([]messaging.AttachmentPart, 0, len(models))
	for _, model := range models {
		parts = append(parts, messaging.AttachmentPart{
			UploadID:         model.UploadID,
			Generation:       model.Generation,
			ChunkIndex:       model.ChunkIndex,
			ByteOffset:       model.ByteOffset,
			CiphertextSize:   model.CiphertextSize,
			CiphertextSHA256: append([]byte(nil), model.CiphertextSHA256...),
			StorageKey:       model.StorageKey,
			CreatedAt:        model.CreatedAt,
		})
	}
	return parts, nil
}

func (r *AttachmentRepository) SetUploadBitmap(
	ctx context.Context,
	uploadID string,
	generation uint64,
	bitmap []byte,
	updatedAt time.Time,
) error {
	result := r.db.WithContext(ctx).
		Model(&AttachmentUploadModel{}).
		Where(
			"upload_id = ? AND generation = ? AND state IN ?",
			uploadID,
			generation,
			[]int32{
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED),
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING),
			},
		).
		Updates(map[string]any{
			"received_chunk_bitmap": append([]byte(nil), bitmap...),
			"state": int32(
				chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING,
			),
			"updated_at": updatedAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrAttachmentState
	}
	return nil
}

func (r *AttachmentRepository) CompleteUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
	object *messaging.AttachmentObject,
	completedAt time.Time,
) error {
	if object == nil || object.Descriptor == nil {
		return messaging.ErrAttachmentDescriptor
	}
	descriptorBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(object.Descriptor)
	if err != nil {
		return err
	}
	model := AttachmentObjectModel{
		ObjectID:         object.Descriptor.ObjectId,
		StorageRef:       object.Descriptor.StorageRef,
		DescriptorBytes:  descriptorBytes,
		StorageKey:       object.StorageKey,
		UploaderPTID:     object.UploaderPTID,
		ConversationID:   object.ConversationID,
		MessageID:        object.MessageID,
		AttachmentID:     object.AttachmentID,
		CiphertextSize:   object.Descriptor.CiphertextSize,
		CiphertextSHA256: append([]byte(nil), object.Descriptor.CiphertextSha256...),
		EventID:          object.EventID,
		State:            messaging.AttachmentObjectStateCompleteUnattached,
		CreatedAt:        object.CreatedAt,
	}
	if err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model).Error; err != nil {
		return err
	}
	var persisted AttachmentObjectModel
	if err := r.db.WithContext(ctx).
		First(&persisted, "object_id = ?", model.ObjectID).Error; err != nil {
		return err
	}
	if !bytes.Equal(persisted.DescriptorBytes, descriptorBytes) ||
		persisted.StorageKey != model.StorageKey ||
		persisted.UploaderPTID != model.UploaderPTID ||
		persisted.ConversationID != model.ConversationID ||
		persisted.MessageID != model.MessageID ||
		persisted.AttachmentID != model.AttachmentID ||
		persisted.CiphertextSize != model.CiphertextSize ||
		!bytes.Equal(persisted.CiphertextSHA256, model.CiphertextSHA256) {
		return messaging.ErrAttachmentConflict
	}
	result := r.db.WithContext(ctx).
		Model(&AttachmentUploadModel{}).
		Where(
			"upload_id = ? AND generation = ? AND state IN ?",
			uploadID,
			generation,
			[]int32{
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED),
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING),
			},
		).
		Updates(map[string]any{
			"state":       int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_COMPLETE),
			"object_id":   object.Descriptor.ObjectId,
			"storage_ref": object.Descriptor.StorageRef,
			"updated_at":  completedAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var upload AttachmentUploadModel
	if err := r.db.WithContext(ctx).
		First(&upload, "upload_id = ? AND generation = ?", uploadID, generation).Error; err != nil {
		return mapNotFound(err)
	}
	if upload.State == int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_COMPLETE) &&
		upload.ObjectID == object.Descriptor.ObjectId &&
		upload.StorageRef == object.Descriptor.StorageRef {
		return nil
	}
	return messaging.ErrAttachmentState
}

func (r *AttachmentRepository) CancelUpload(
	ctx context.Context,
	uploadID string,
	generation uint64,
	cancelledAt time.Time,
) error {
	result := r.db.WithContext(ctx).
		Model(&AttachmentUploadModel{}).
		Where(
			"upload_id = ? AND generation = ? AND state IN ?",
			uploadID,
			generation,
			[]int32{
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED),
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING),
			},
		).
		Updates(map[string]any{
			"state":      int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_CANCELLED),
			"updated_at": cancelledAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var upload AttachmentUploadModel
	if err := r.db.WithContext(ctx).
		First(&upload, "upload_id = ? AND generation = ?", uploadID, generation).Error; err != nil {
		return mapNotFound(err)
	}
	if upload.State == int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_CANCELLED) {
		return nil
	}
	return messaging.ErrAttachmentState
}

func (r *AttachmentRepository) ExpireUploads(
	ctx context.Context,
	now time.Time,
	limit int,
) ([]messaging.AttachmentPart, error) {
	if limit <= 0 {
		return nil, messaging.ErrAttachmentDescriptor
	}
	var uploads []AttachmentUploadModel
	if err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"state IN ? AND expires_at <= ?",
			[]int32{
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED),
				int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING),
			},
			now,
		).
		Order("expires_at ASC").
		Limit(limit).
		Find(&uploads).Error; err != nil {
		return nil, err
	}
	if len(uploads) == 0 {
		return nil, nil
	}
	uploadIDs := make([]string, 0, len(uploads))
	for _, upload := range uploads {
		uploadIDs = append(uploadIDs, upload.UploadID)
	}
	if err := r.db.WithContext(ctx).
		Model(&AttachmentUploadModel{}).
		Where("upload_id IN ?", uploadIDs).
		Updates(map[string]any{
			"state":      int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TERMINAL),
			"updated_at": now,
		}).Error; err != nil {
		return nil, err
	}
	for _, upload := range uploads {
		if err := r.AppendAudit(ctx, messaging.AttachmentAuditRecord{
			AuditID:        uuid.NewString(),
			Action:         messaging.AttachmentAuditExpire,
			Outcome:        messaging.AttachmentAuditOutcomeCommitted,
			ConversationID: upload.ConversationID,
			MessageID:      upload.MessageID,
			AttachmentID:   upload.AttachmentID,
			UploadID:       upload.UploadID,
			ActorPTID:      upload.UploaderPTID,
			DeviceID:       upload.UploaderDeviceID,
			CreatedAt:      now,
		}); err != nil {
			return nil, err
		}
	}
	var models []AttachmentUploadPartModel
	if err := r.db.WithContext(ctx).
		Where("upload_id IN ?", uploadIDs).
		Order("upload_id ASC, chunk_index ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	parts := make([]messaging.AttachmentPart, 0, len(models))
	for _, model := range models {
		parts = append(parts, messaging.AttachmentPart{
			UploadID:         model.UploadID,
			Generation:       model.Generation,
			ChunkIndex:       model.ChunkIndex,
			ByteOffset:       model.ByteOffset,
			CiphertextSize:   model.CiphertextSize,
			CiphertextSHA256: append([]byte(nil), model.CiphertextSHA256...),
			StorageKey:       model.StorageKey,
			CreatedAt:        model.CreatedAt,
		})
	}
	return parts, nil
}

func (r *AttachmentRepository) GetObject(
	ctx context.Context,
	objectID string,
) (*messaging.AttachmentObject, error) {
	var model AttachmentObjectModel
	if err := r.db.WithContext(ctx).
		First(&model, "object_id = ?", objectID).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return attachmentObjectFromModel(model)
}

func (r *AttachmentRepository) GrantMessageObjects(
	ctx context.Context,
	conversationID string,
	messageID string,
	eventID string,
	senderPTID string,
	descriptors []*chat.EncryptedObjectDescriptor,
	recipientPTIDs []string,
	grantedAt time.Time,
) error {
	if eventID == "" {
		return messaging.ErrAttachmentDescriptor
	}
	if len(descriptors) > messaging.AttachmentMaxMessageObjects {
		return messaging.ErrAttachmentQuota
	}
	var totalCiphertextSize uint64
	for _, descriptor := range descriptors {
		if err := messaging.ValidateEncryptedObjectDescriptor(descriptor); err != nil {
			return err
		}
		totalCiphertextSize += descriptor.CiphertextSize
		if totalCiphertextSize >
			messaging.AttachmentMaxPlaintextSize+
				uint64(messaging.AttachmentMaxChunkCount*messaging.AttachmentTagSize) {
			return messaging.ErrAttachmentQuota
		}
		descriptorBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(descriptor)
		if err != nil {
			return err
		}
		var object AttachmentObjectModel
		if err := r.db.WithContext(ctx).
			First(&object, "object_id = ?", descriptor.ObjectId).Error; err != nil {
			return mapNotFound(err)
		}
		if object.UploaderPTID != senderPTID ||
			object.ConversationID != conversationID ||
			object.MessageID != messageID ||
			!bytes.Equal(object.DescriptorBytes, descriptorBytes) {
			return messaging.ErrAttachmentConflict
		}
		if object.State != messaging.AttachmentObjectStateCompleteUnattached &&
			!(object.State == messaging.AttachmentObjectStateAttached &&
				object.EventID == eventID) {
			return messaging.ErrAttachmentState
		}
		for _, recipientPTID := range recipientPTIDs {
			if recipientPTID == "" {
				return messaging.ErrAttachmentDescriptor
			}
			grant := AttachmentGrantModel{
				ObjectID:       descriptor.ObjectId,
				ConversationID: conversationID,
				RecipientPTID:  recipientPTID,
				MessageID:      messageID,
				EventID:        eventID,
				GrantedAt:      grantedAt,
			}
			if err := r.db.WithContext(ctx).
				Clauses(clause.OnConflict{DoNothing: true}).
				Create(&grant).Error; err != nil {
				return err
			}
			var persistedGrant AttachmentGrantModel
			if err := r.db.WithContext(ctx).First(
				&persistedGrant,
				"object_id = ? AND conversation_id = ? AND recipient_ptid = ?",
				descriptor.ObjectId,
				conversationID,
				recipientPTID,
			).Error; err != nil {
				return err
			}
			if persistedGrant.MessageID != messageID || persistedGrant.EventID != eventID {
				return messaging.ErrAttachmentConflict
			}
		}
		result := r.db.WithContext(ctx).
			Model(&AttachmentObjectModel{}).
			Where(
				"object_id = ? AND state = ? AND event_id = ?",
				descriptor.ObjectId,
				messaging.AttachmentObjectStateCompleteUnattached,
				"",
			).
			Updates(map[string]any{
				"event_id": eventID,
				"state":    messaging.AttachmentObjectStateAttached,
			})
		if result.Error != nil {
			return result.Error
		}
		auditOutcome := messaging.AttachmentAuditOutcomeCommitted
		if result.RowsAffected == 0 {
			var attached AttachmentObjectModel
			if err := r.db.WithContext(ctx).
				First(&attached, "object_id = ?", descriptor.ObjectId).Error; err != nil {
				return err
			}
			if attached.State != messaging.AttachmentObjectStateAttached ||
				attached.EventID != eventID {
				return messaging.ErrAttachmentState
			}
			auditOutcome = messaging.AttachmentAuditOutcomeReplay
		}
		if err := r.AppendAudit(ctx, messaging.AttachmentAuditRecord{
			AuditID:        uuid.NewString(),
			Action:         messaging.AttachmentAuditAttach,
			Outcome:        auditOutcome,
			ConversationID: conversationID,
			MessageID:      messageID,
			AttachmentID:   object.AttachmentID,
			ObjectID:       descriptor.ObjectId,
			EventID:        eventID,
			ActorPTID:      senderPTID,
			ByteCount:      descriptor.CiphertextSize,
			CreatedAt:      grantedAt,
		}); err != nil {
			return err
		}
	}
	return nil
}

func replayedAttachmentUpload(
	existing AttachmentUploadModel,
	upload *messaging.AttachmentUpload,
	objectBytes []byte,
) (*messaging.AttachmentUpload, bool, error) {
	if existing.ConversationID != upload.ConversationID ||
		existing.MessageID != upload.MessageID ||
		existing.AttachmentID != upload.AttachmentID ||
		!bytes.Equal(existing.ObjectSpecBytes, objectBytes) ||
		!bytes.Equal(existing.DescriptorCommitmentSHA256, upload.DescriptorCommitmentSHA256) {
		return nil, false, messaging.ErrAttachmentConflict
	}
	decoded, err := uploadFromModel(existing)
	return decoded, false, err
}

func (r *AttachmentRepository) GetGrantedObject(
	ctx context.Context,
	conversationID string,
	objectID string,
	recipientPTID string,
) (*messaging.AttachmentObject, error) {
	var model AttachmentObjectModel
	err := r.db.WithContext(ctx).
		Table("messaging_attachment_objects objects").
		Select("objects.*").
		Joins(
			"JOIN messaging_attachment_grants grants ON grants.object_id = objects.object_id "+
				"AND grants.conversation_id = objects.conversation_id",
		).
		Where(
			"objects.object_id = ? AND objects.conversation_id = ? AND grants.recipient_ptid = ?",
			objectID,
			conversationID,
			recipientPTID,
		).
		First(&model).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, messaging.ErrAttachmentNotGranted
	}
	if err != nil {
		return nil, err
	}
	return attachmentObjectFromModel(model)
}

func (r *AttachmentRepository) AppendAudit(
	ctx context.Context,
	record messaging.AttachmentAuditRecord,
) error {
	if record.AuditID == "" ||
		!validAttachmentAuditAction(record.Action) ||
		!validAttachmentAuditOutcome(record.Outcome) ||
		record.CreatedAt.IsZero() {
		return messaging.ErrAttachmentDescriptor
	}
	return r.db.WithContext(ctx).Create(&AttachmentAuditModel{
		AuditID:        record.AuditID,
		Action:         record.Action,
		Outcome:        record.Outcome,
		ConversationID: record.ConversationID,
		MessageID:      record.MessageID,
		AttachmentID:   record.AttachmentID,
		UploadID:       record.UploadID,
		ObjectID:       record.ObjectID,
		EventID:        record.EventID,
		ActorPTID:      record.ActorPTID,
		DeviceID:       record.DeviceID,
		ChunkIndex:     record.ChunkIndex,
		ByteCount:      record.ByteCount,
		CreatedAt:      record.CreatedAt,
	}).Error
}

func validAttachmentAuditAction(action string) bool {
	switch action {
	case messaging.AttachmentAuditBegin,
		messaging.AttachmentAuditPart,
		messaging.AttachmentAuditComplete,
		messaging.AttachmentAuditCancel,
		messaging.AttachmentAuditExpire,
		messaging.AttachmentAuditAttach,
		messaging.AttachmentAuditDownload:
		return true
	default:
		return false
	}
}

func validAttachmentAuditOutcome(outcome string) bool {
	switch outcome {
	case messaging.AttachmentAuditOutcomeCommitted,
		messaging.AttachmentAuditOutcomeReplay:
		return true
	default:
		return false
	}
}

func (r *AttachmentRepository) MetricsSnapshot(
	ctx context.Context,
) (*messaging.AttachmentMetricsSnapshot, error) {
	type metricRow struct {
		Action    string
		Outcome   string
		Count     int64
		ByteCount uint64
	}
	var rows []metricRow
	if err := r.db.WithContext(ctx).
		Model(&AttachmentAuditModel{}).
		Select("action, outcome, count(*) AS count, coalesce(sum(byte_count), 0) AS byte_count").
		Group("action, outcome").
		Order("action ASC, outcome ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	snapshot := &messaging.AttachmentMetricsSnapshot{
		Events: make([]messaging.AttachmentMetric, 0, len(rows)),
	}
	for _, row := range rows {
		snapshot.Events = append(snapshot.Events, messaging.AttachmentMetric{
			Action:  row.Action,
			Outcome: row.Outcome,
			Count:   row.Count,
			Bytes:   row.ByteCount,
		})
	}
	if err := r.db.WithContext(ctx).
		Model(&AttachmentUploadModel{}).
		Where("state IN ?", []int32{
			int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED),
			int32(chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING),
		}).
		Count(&snapshot.ActiveUploads).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).
		Model(&AttachmentObjectModel{}).
		Where("state = ?", messaging.AttachmentObjectStateCompleteUnattached).
		Count(&snapshot.CompleteUnattachedObjects).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).
		Model(&AttachmentObjectModel{}).
		Where("state = ?", messaging.AttachmentObjectStateAttached).
		Count(&snapshot.AttachedObjects).Error; err != nil {
		return nil, err
	}
	return snapshot, nil
}

func attachmentUploadModel(
	upload *messaging.AttachmentUpload,
	objectBytes []byte,
) AttachmentUploadModel {
	return AttachmentUploadModel{
		UploadID:                   upload.UploadID,
		Generation:                 upload.Generation,
		ConversationID:             upload.ConversationID,
		MessageID:                  upload.MessageID,
		AttachmentID:               upload.AttachmentID,
		UploaderPTID:               upload.Uploader.Ptid,
		UploaderDeviceID:           upload.Uploader.DeviceId,
		ObjectSpecBytes:            objectBytes,
		DescriptorCommitmentSHA256: append([]byte(nil), upload.DescriptorCommitmentSHA256...),
		IdempotencyKey:             upload.IdempotencyKey,
		State:                      int32(upload.State),
		ReceivedChunkBitmap:        append([]byte(nil), upload.ReceivedChunkBitmap...),
		ObjectID:                   upload.ObjectID,
		StorageRef:                 upload.StorageRef,
		ExpiresAt:                  upload.ExpiresAt,
		CreatedAt:                  upload.CreatedAt,
		UpdatedAt:                  upload.UpdatedAt,
	}
}

func uploadFromModel(model AttachmentUploadModel) (*messaging.AttachmentUpload, error) {
	spec := &chat.EncryptedObjectUploadSpec{}
	if err := proto.Unmarshal(model.ObjectSpecBytes, spec); err != nil {
		return nil, err
	}
	return &messaging.AttachmentUpload{
		UploadID:       model.UploadID,
		Generation:     model.Generation,
		ConversationID: model.ConversationID,
		MessageID:      model.MessageID,
		AttachmentID:   model.AttachmentID,
		Uploader: &chat.CryptoEndpoint{
			Ptid:     model.UploaderPTID,
			DeviceId: model.UploaderDeviceID,
		},
		Object:                     spec,
		DescriptorCommitmentSHA256: append([]byte(nil), model.DescriptorCommitmentSHA256...),
		IdempotencyKey:             model.IdempotencyKey,
		State:                      chat.AttachmentTransferState(model.State),
		ReceivedChunkBitmap:        append([]byte(nil), model.ReceivedChunkBitmap...),
		ObjectID:                   model.ObjectID,
		StorageRef:                 model.StorageRef,
		ExpiresAt:                  model.ExpiresAt,
		CreatedAt:                  model.CreatedAt,
		UpdatedAt:                  model.UpdatedAt,
	}, nil
}

func attachmentObjectFromModel(
	model AttachmentObjectModel,
) (*messaging.AttachmentObject, error) {
	descriptor := &chat.EncryptedObjectDescriptor{}
	if err := proto.Unmarshal(model.DescriptorBytes, descriptor); err != nil {
		return nil, err
	}
	return &messaging.AttachmentObject{
		Descriptor:     descriptor,
		StorageKey:     model.StorageKey,
		UploaderPTID:   model.UploaderPTID,
		ConversationID: model.ConversationID,
		MessageID:      model.MessageID,
		AttachmentID:   model.AttachmentID,
		EventID:        model.EventID,
		State:          model.State,
		CreatedAt:      model.CreatedAt,
	}, nil
}
