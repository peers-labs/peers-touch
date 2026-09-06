package attachment

import (
	"context"
	"io"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const (
	ChunkSize                  uint32 = 1024 * 1024
	TagSize                    uint32 = 16
	MaximumChunkCount          uint32 = 2048
	MaximumPlaintextSize       uint64 = 2 * 1024 * 1024 * 1024
	MaximumMessageObjects             = 10
	MaximumActiveUploadCount          = 4
	MaximumConcurrentPartCount        = 4
	MaximumUploadTTL                  = 24 * time.Hour
)

type EncryptionSuite int32

const (
	EncryptionSuiteAES256GCMChunked EncryptionSuite = 1
)

type NonceStrategy int32

const (
	NonceStrategyCounter32BE NonceStrategy = 1
)

type TransferState int32

const (
	TransferStateQueued       TransferState = 1
	TransferStateTransferring TransferState = 2
	TransferStateVerifying    TransferState = 3
	TransferStateComplete     TransferState = 4
	TransferStateRetryWait    TransferState = 5
	TransferStateCancelled    TransferState = 6
	TransferStateTerminal     TransferState = 7
)

type ObjectState string

const (
	ObjectStateCompleteUnattached ObjectState = "complete_unattached"
	ObjectStateAttached           ObjectState = "attached"
)

type UploadSpec struct {
	CiphertextSize uint64
	CiphertextHash valueobject.Hash
	MediaType      string
	ChunkSize      uint32
	ChunkCount     uint32
	Encryption     EncryptionSuite
	TagSize        uint32
	NonceStrategy  NonceStrategy
	ChunkHashes    []valueobject.Hash
}

type Upload struct {
	UploadID             string
	Generation           uint64
	ConversationID       valueobject.ConversationID
	MessageID            valueobject.MessageID
	AttachmentID         string
	Uploader             valueobject.Endpoint
	Spec                 UploadSpec
	DescriptorCommitment valueobject.Hash
	IdempotencyKey       string
	State                TransferState
	ReceivedChunkBitmap  []byte
	ObjectID             valueobject.ObjectID
	StorageRef           string
	ExpiresAt            time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type Part struct {
	UploadID       string
	Generation     uint64
	ChunkIndex     uint32
	ByteOffset     uint64
	CiphertextSize uint64
	CiphertextHash valueobject.Hash
	StorageKey     string
	CreatedAt      time.Time
}

type Object struct {
	ObjectID             valueobject.ObjectID
	StorageRef           string
	StorageKey           string
	ConversationID       valueobject.ConversationID
	MessageID            valueobject.MessageID
	AttachmentID         string
	Uploader             valueobject.PTID
	Spec                 UploadSpec
	DescriptorCommitment valueobject.Hash
	EventID              valueobject.EventID
	State                ObjectState
	CreatedAt            time.Time
}

type AuditAction string

const (
	AuditActionBegin    AuditAction = "begin"
	AuditActionPart     AuditAction = "part"
	AuditActionComplete AuditAction = "complete"
	AuditActionCancel   AuditAction = "cancel"
	AuditActionGrant    AuditAction = "grant"
	AuditActionDownload AuditAction = "download"
)

type AuditOutcome string

const (
	AuditOutcomeCommitted AuditOutcome = "committed"
	AuditOutcomeReplay    AuditOutcome = "replay"
)

type AuditRecord struct {
	AuditID        string
	Action         AuditAction
	Outcome        AuditOutcome
	ConversationID valueobject.ConversationID
	MessageID      valueobject.MessageID
	AttachmentID   string
	UploadID       string
	ObjectID       valueobject.ObjectID
	EventID        valueobject.EventID
	Actor          valueobject.PTID
	Device         valueobject.DeviceID
	ChunkIndex     uint32
	ByteCount      uint64
	CreatedAt      time.Time
}

type BeginRequest struct {
	ConversationID       valueobject.ConversationID
	MessageID            valueobject.MessageID
	AttachmentID         string
	Uploader             valueobject.Endpoint
	Spec                 UploadSpec
	CanonicalSpecBytes   []byte
	DescriptorCommitment valueobject.Hash
	IdempotencyKey       string
	AuthorityStation     valueobject.StationID
}

type BeginResult struct {
	Upload    Upload
	Duplicate bool
}

type StatusRequest struct {
	UploadID         string
	Generation       uint64
	ConversationID   valueobject.ConversationID
	AuthorityStation valueobject.StationID
}

type PutChunkRequest struct {
	UploadID         string
	Generation       uint64
	ConversationID   valueobject.ConversationID
	AuthorityStation valueobject.StationID
	ChunkIndex       uint32
	ByteOffset       uint64
	CiphertextSize   uint64
	CiphertextHash   valueobject.Hash
	IdempotencyKey   string
}

type PutChunkResult struct {
	ChunkIndex          uint32
	Duplicate           bool
	ReceivedChunkBitmap []byte
}

type CompleteRequest struct {
	UploadID             string
	Generation           uint64
	ConversationID       valueobject.ConversationID
	AuthorityStation     valueobject.StationID
	DescriptorCommitment valueobject.Hash
}

type CompleteResult struct {
	Object    Object
	Duplicate bool
}

type CancelRequest struct {
	UploadID         string
	Generation       uint64
	ConversationID   valueobject.ConversationID
	AuthorityStation valueobject.StationID
}

type DownloadRequest struct {
	ConversationID   valueobject.ConversationID
	ObjectID         valueobject.ObjectID
	ExpectedETag     valueobject.Hash
	AuthorityStation valueobject.StationID
	Start            int64
	End              int64
}

type DownloadResult struct {
	Object    Object
	Body      io.ReadCloser
	TotalSize int64
	Start     int64
	End       int64
}

// Repository owns only the canonical conversation_attachment_* metadata family.
type Repository interface {
	CreateUpload(
		ctx context.Context,
		upload Upload,
		maximumActiveUploads int,
		audit AuditRecord,
	) (Upload, bool, error)
	GetUpload(ctx context.Context, uploadID string, generation uint64) (Upload, error)
	PutPart(
		ctx context.Context,
		part Part,
		updatedAt time.Time,
		audit AuditRecord,
	) (bool, []byte, error)
	ListParts(ctx context.Context, uploadID string, generation uint64) ([]Part, error)
	CompleteUpload(
		ctx context.Context,
		uploadID string,
		generation uint64,
		object Object,
		completedAt time.Time,
		audit AuditRecord,
	) (bool, error)
	CancelUpload(
		ctx context.Context,
		uploadID string,
		generation uint64,
		cancelledAt time.Time,
		audit AuditRecord,
	) ([]Part, bool, error)
	GetObject(ctx context.Context, objectID valueobject.ObjectID) (Object, error)
	GetGrantedObject(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		objectID valueobject.ObjectID,
		recipient valueobject.PTID,
	) (Object, error)
	AppendAudit(ctx context.Context, record AuditRecord) error
	Grant(ctx context.Context, grant ports.ObjectGrant) error
}

type BlobStore interface {
	Save(ctx context.Context, storageKey string, reader io.Reader) error
	Open(
		ctx context.Context,
		storageKey string,
		start int64,
		end int64,
	) (io.ReadCloser, int64, error)
	Delete(ctx context.Context, storageKey string) error
}

// ConversationReader is implemented directly by the CA-W2 query service.
type ConversationReader interface {
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) (query.ConversationView, error)
}

type DeviceAccess interface {
	IsActive(ctx context.Context, endpoint valueobject.Endpoint) (bool, error)
}

type Clock interface {
	Now() time.Time
}

type IDGenerator interface {
	NewID() string
}

type Policy struct {
	UploadTTL              time.Duration
	MaximumActiveUploads   int
	MaximumConcurrentParts int
}
