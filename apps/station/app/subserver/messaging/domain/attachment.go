package domain

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const (
	AttachmentChunkSize         uint32 = 1024 * 1024
	AttachmentTagSize           uint32 = 16
	AttachmentMaxChunkCount     uint32 = 2048
	AttachmentMaxPlaintextSize  uint64 = 2 * 1024 * 1024 * 1024
	AttachmentMaxActiveUploads         = 4
	AttachmentMaxMessageObjects        = 10
)

var (
	ErrAttachmentDescriptor = errors.New("messaging: attachment descriptor is invalid")
	ErrAttachmentTooLarge   = errors.New("messaging: attachment exceeds policy")
	ErrAttachmentExpired    = errors.New("messaging: attachment upload expired")
	ErrAttachmentConflict   = errors.New("messaging: attachment part conflicts with persisted commitment")
	ErrAttachmentState      = errors.New("messaging: attachment upload state is invalid")
	ErrAttachmentNotGranted = errors.New("messaging: attachment object is not granted")
	ErrAttachmentETag       = errors.New("messaging: attachment object ETag mismatch")
	ErrAttachmentRange      = errors.New("messaging: attachment object range is invalid")
	ErrAttachmentQuota      = errors.New("messaging: attachment quota exceeded")
)

type AttachmentUpload struct {
	UploadID                   string
	Generation                 uint64
	ConversationID             string
	MessageID                  string
	AttachmentID               string
	Uploader                   *chat.CryptoEndpoint
	Object                     *chat.EncryptedObjectUploadSpec
	DescriptorCommitmentSHA256 []byte
	IdempotencyKey             string
	State                      chat.AttachmentTransferState
	ReceivedChunkBitmap        []byte
	ObjectID                   string
	StorageRef                 string
	ExpiresAt                  time.Time
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
}

type AttachmentPart struct {
	UploadID         string
	Generation       uint64
	ChunkIndex       uint32
	ByteOffset       uint64
	CiphertextSize   uint64
	CiphertextSHA256 []byte
	StorageKey       string
	CreatedAt        time.Time
}

type AttachmentObject struct {
	Descriptor     *chat.EncryptedObjectDescriptor
	StorageKey     string
	UploaderPTID   string
	ConversationID string
	MessageID      string
	CreatedAt      time.Time
}

type AttachmentRepository interface {
	CreateUpload(ctx context.Context, upload *AttachmentUpload) (*AttachmentUpload, bool, error)
	GetUpload(ctx context.Context, uploadID string, generation uint64) (*AttachmentUpload, error)
	LockUpload(ctx context.Context, uploadID string, generation uint64) (*AttachmentUpload, error)
	PutPart(ctx context.Context, part *AttachmentPart) (bool, error)
	ListParts(ctx context.Context, uploadID string, generation uint64) ([]AttachmentPart, error)
	SetUploadBitmap(
		ctx context.Context,
		uploadID string,
		generation uint64,
		bitmap []byte,
		updatedAt time.Time,
	) error
	CompleteUpload(
		ctx context.Context,
		uploadID string,
		generation uint64,
		object *AttachmentObject,
		completedAt time.Time,
	) error
	CancelUpload(ctx context.Context, uploadID string, generation uint64, cancelledAt time.Time) error
	ExpireUploads(ctx context.Context, now time.Time, limit int) ([]AttachmentPart, error)
	GetObject(ctx context.Context, objectID string) (*AttachmentObject, error)
	GrantMessageObjects(
		ctx context.Context,
		conversationID string,
		messageID string,
		senderPTID string,
		descriptors []*chat.EncryptedObjectDescriptor,
		recipientPTIDs []string,
		grantedAt time.Time,
	) error
	GetGrantedObject(
		ctx context.Context,
		conversationID string,
		objectID string,
		recipientPTID string,
	) (*AttachmentObject, error)
}

type AttachmentBlobStore interface {
	Save(ctx context.Context, storageKey string, reader io.Reader) error
	Open(
		ctx context.Context,
		storageKey string,
		start int64,
		end int64,
	) (io.ReadCloser, int64, error)
	Delete(ctx context.Context, storageKey string) error
}

func ValidateEncryptedObjectUploadSpec(spec *chat.EncryptedObjectUploadSpec) error {
	if spec == nil ||
		len(spec.CiphertextSha256) != 32 ||
		strings.TrimSpace(spec.MediaType) == "" ||
		len(spec.MediaType) > 255 ||
		spec.ChunkSize != AttachmentChunkSize ||
		spec.ChunkCount == 0 ||
		spec.TagSize != AttachmentTagSize ||
		spec.EncryptionSuite != chat.AttachmentEncryptionSuite_ATTACHMENT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED ||
		spec.NonceStrategy != chat.AttachmentNonceStrategy_ATTACHMENT_NONCE_STRATEGY_COUNTER32_BE ||
		uint32(len(spec.ChunkCiphertextSha256)) != spec.ChunkCount {
		return ErrAttachmentDescriptor
	}
	if spec.ChunkCount > AttachmentMaxChunkCount {
		return ErrAttachmentTooLarge
	}
	for _, hash := range spec.ChunkCiphertextSha256 {
		if len(hash) != 32 {
			return ErrAttachmentDescriptor
		}
	}
	minimumSize := uint64(spec.ChunkCount-1)*uint64(spec.ChunkSize+spec.TagSize) +
		uint64(spec.TagSize) + 1
	maximumSize := uint64(spec.ChunkCount) * uint64(spec.ChunkSize+spec.TagSize)
	maximumPolicySize := AttachmentMaxPlaintextSize +
		uint64(AttachmentMaxChunkCount)*uint64(AttachmentTagSize)
	if spec.CiphertextSize < minimumSize || spec.CiphertextSize > maximumSize {
		return ErrAttachmentDescriptor
	}
	if spec.CiphertextSize > maximumPolicySize {
		return ErrAttachmentTooLarge
	}
	return nil
}

func ValidateEncryptedObjectDescriptor(descriptor *chat.EncryptedObjectDescriptor) error {
	if descriptor == nil ||
		strings.TrimSpace(descriptor.ObjectId) == "" ||
		strings.TrimSpace(descriptor.StorageRef) == "" {
		return ErrAttachmentDescriptor
	}
	return ValidateEncryptedObjectUploadSpec(&chat.EncryptedObjectUploadSpec{
		CiphertextSize:        descriptor.CiphertextSize,
		CiphertextSha256:      descriptor.CiphertextSha256,
		MediaType:             descriptor.MediaType,
		ChunkSize:             descriptor.ChunkSize,
		ChunkCount:            descriptor.ChunkCount,
		EncryptionSuite:       descriptor.EncryptionSuite,
		TagSize:               descriptor.TagSize,
		NonceStrategy:         descriptor.NonceStrategy,
		ChunkCiphertextSha256: descriptor.ChunkCiphertextSha256,
	})
}
