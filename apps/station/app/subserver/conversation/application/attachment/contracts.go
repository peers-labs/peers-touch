package attachment

import (
	"context"
	"io"
	"time"

	"github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type UploadSpec struct {
	CiphertextSize uint64
	CiphertextHash valueobject.Hash
	MediaType      string
	ChunkSize      uint32
	ChunkCount     uint32
	Encryption     securecontent.EncryptionSuite
	TagSize        uint32
	NonceStrategy  securecontent.NonceStrategy
	ChunkHashes    []valueobject.Hash
}

type Upload struct {
	UploadID                   string
	Generation                 uint64
	ConversationID             valueobject.ConversationID
	MessageID                  valueobject.MessageID
	AttachmentID               string
	Uploader                   valueobject.Endpoint
	Spec                       UploadSpec
	DescriptorCommitment       valueobject.Hash
	IdempotencyKey             string
	State                      securecontent.TransferState
	ReceivedChunkBitmap        []byte
	ObjectID                   valueobject.ObjectID
	StorageRef                 string
	VerificationToken          string
	VerificationStorageKey     string
	VerificationStartedAt      time.Time
	VerificationLeaseExpiresAt time.Time
	VerificationAttempt        uint32
	ExpiresAt                  time.Time
	CleanupLeaseOwner          string
	CleanupLeaseExpiresAt      time.Time
	CleanupAttempt             uint32
	CleanupNextAttemptAt       time.Time
	CleanupCompletedAt         time.Time
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
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
	ObjectID              valueobject.ObjectID
	StorageRef            string
	StorageKey            string
	ConversationID        valueobject.ConversationID
	MessageID             valueobject.MessageID
	AttachmentID          string
	Uploader              valueobject.PTID
	Spec                  UploadSpec
	DescriptorCommitment  valueobject.Hash
	EventID               valueobject.EventID
	State                 securecontent.ObjectState
	ExpiresAt             time.Time
	CleanupLeaseOwner     string
	CleanupLeaseExpiresAt time.Time
	CleanupAttempt        uint32
	CleanupNextAttemptAt  time.Time
	CleanupCompletedAt    time.Time
	CreatedAt             time.Time
}

type AuditAction string

const (
	AuditActionBegin    AuditAction = "begin"
	AuditActionPart     AuditAction = "part"
	AuditActionComplete AuditAction = "complete"
	AuditActionCancel   AuditAction = "cancel"
	AuditActionGrant    AuditAction = "grant"
	AuditActionDownload AuditAction = "download"
	AuditActionGCClaim  AuditAction = "gc_claim"
	AuditActionGCRetry  AuditAction = "gc_retry"
	AuditActionGCFinish AuditAction = "gc_finish"
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

type MutationAuthorization struct {
	ConversationID valueobject.ConversationID
	Endpoint       valueobject.Endpoint
}

type CleanupClaim struct {
	Object         Object
	StorageKeys    []string
	LeaseOwner     string
	Attempt        uint32
	LeaseExpiresAt time.Time
}

type UploadCleanupClaim struct {
	Upload         Upload
	StorageKeys    []string
	LeaseOwner     string
	Attempt        uint32
	LeaseExpiresAt time.Time
}

type Verification struct {
	Upload Upload
	Parts  []Part
	Object Object
	Lease  VerificationLease
}

type VerificationLease struct {
	Token     string
	Attempt   uint32
	ExpiresAt time.Time
}

type CleanupRetryResult struct {
	Replay   bool
	Terminal bool
}

type SweepResult struct {
	Claimed   int
	Finalized int
	Retried   int
	Terminal  int
}

// Repository owns only the canonical conversation_attachment_* metadata family.
type Repository interface {
	ExecuteAuthorizedMutation(
		ctx context.Context,
		authorization MutationAuthorization,
		operation string,
		fn func(Repository) error,
	) error
	CreateUpload(
		ctx context.Context,
		upload Upload,
		maximumActiveUploads int,
		maximumMessageObjects int,
		audit AuditRecord,
	) (Upload, bool, error)
	GetUpload(ctx context.Context, uploadID string, generation uint64) (Upload, error)
	LockUpload(ctx context.Context, uploadID string, generation uint64) (Upload, error)
	PutPart(
		ctx context.Context,
		part Part,
		updatedAt time.Time,
		audit AuditRecord,
	) (bool, []byte, error)
	ListParts(ctx context.Context, uploadID string, generation uint64) ([]Part, error)
	StageUploadVerification(
		ctx context.Context,
		uploadID string,
		generation uint64,
		lease VerificationLease,
		object Object,
		stagedAt time.Time,
	) (Upload, error)
	FinalizeUploadVerification(
		ctx context.Context,
		uploadID string,
		generation uint64,
		lease VerificationLease,
		object Object,
		finalizedAt time.Time,
		audit AuditRecord,
	) (Object, bool, error)
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
	ClaimExpiredUnattachedObjects(
		ctx context.Context,
		now time.Time,
		leaseOwner string,
		leaseTTL time.Duration,
		limit int,
	) ([]CleanupClaim, error)
	FinalizeObjectCleanup(
		ctx context.Context,
		claim CleanupClaim,
		completedAt time.Time,
	) (bool, error)
	RetryObjectCleanup(
		ctx context.Context,
		claim CleanupClaim,
		failedAt time.Time,
		nextAttemptAt time.Time,
	) (CleanupRetryResult, error)
	ClaimExpiredUploads(
		ctx context.Context,
		now time.Time,
		leaseOwner string,
		leaseTTL time.Duration,
		limit int,
	) ([]UploadCleanupClaim, error)
	FinalizeUploadCleanup(
		ctx context.Context,
		claim UploadCleanupClaim,
		completedAt time.Time,
	) (bool, error)
	RetryUploadCleanup(
		ctx context.Context,
		claim UploadCleanupClaim,
		failedAt time.Time,
		nextAttemptAt time.Time,
	) (CleanupRetryResult, error)
	AppendAudit(ctx context.Context, record AuditRecord) error
	GrantBatch(ctx context.Context, grant ports.ObjectGrantBatch) error
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
	UploadTTL               time.Duration
	UnattachedObjectTTL     time.Duration
	VerificationLeaseTTL    time.Duration
	CleanupLeaseTTL         time.Duration
	MaximumActiveUploads    int
	MaximumConcurrentParts  int
	MaximumCleanupBatchSize int
}
