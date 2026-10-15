package model

import (
	"time"

	"gorm.io/gorm"
)

const (
	BlobLifecycleWriting  = "writing"
	BlobLifecycleLive     = "live"
	BlobLifecycleDeleting = "deleting"

	WorkerLeaseStatusHeld     = "held"
	WorkerLeaseStatusReleased = "released"
)

// Blob is the physical-object record that stands behind one or more
// `oss_files` rows. We split the object plane into two tables on
// purpose:
//
//   - `oss_files` is the *claim*: per-actor metadata (owner,
//     visibility, bucket, expiry). Two actors uploading the same CAS
//     bytes get separate rows here so policy stays per-actor.
//   - `oss_blobs` is the *truth on disk*: the physical bytes managed
//     by the active storage backend, plus a reference counter so we
//     can answer "is anyone still pointing at this?" without scanning
//     `oss_files`.
//
// `RefCount` is mutated through atomic UPDATEs (`SET ref_count =
// ref_count + 1` / `- 1` with a positive predicate). The blob GC
// worker is the only path that physically removes bytes; it requires
// `ref_count = 0` AND `last_seen_at < now - blob-gc-grace-hours` so
// a delete-then-immediate-reupload race does not churn S3 objects.
//
// We do *not* store paths here — `oss_files.Path` keeps that detail
// for compatibility with rendering code; the GC worker resolves the
// physical key by passing `(Backend, Key)` to the matching driver.
type Blob struct {
	// Backend names the driver that owns the bytes (`local`, `s3`).
	// Composite primary key with Key — the same content-addressed
	// key may legitimately exist on two backends if an operator
	// migrates between drivers, so the (backend, key) tuple is the
	// uniqueness contract, not the key alone.
	Backend string `json:"backend" gorm:"primaryKey;type:varchar(50)"`

	// Key is the storage-backend object key; same shape as
	// `oss_files.Key`. Composite PK with Backend.
	Key string `json:"key" gorm:"primaryKey;type:varchar(255)"`

	// Size in bytes, measured by the backend on Save. Persisted so
	// the GC worker and dashboard can report storage totals without
	// joining `oss_files`.
	Size int64 `json:"size" gorm:"type:bigint;not null"`

	// Sha256 is the content hash of the bytes; also stamped into
	// the `oss_files.Sha256` column on every claim. We persist it
	// here (in addition to oss_files) so the reconciler can verify
	// blob integrity without needing any claim row.
	Sha256 string `json:"sha256" gorm:"type:varchar(64);index"`

	// Generation identifies one immutable physical incarnation of
	// this logical object key. Generation 1 keeps the historical
	// physical key for in-place upgrades. A replacement created
	// while GC owns an older incarnation advances this value and
	// writes to a distinct StorageKey.
	Generation uint64 `json:"generation" gorm:"not null;default:1"`

	// StorageKey is the immutable backend key for Generation.
	// Existing rows may be empty after an additive migration; callers
	// resolve that shape as StorageKey == Key for generation 1.
	StorageKey string `json:"storage_key" gorm:"type:varchar(512);not null;default:''"`

	// LifecycleState prevents a new reference from attaching to a
	// generation already claimed for deletion.
	LifecycleState string `json:"lifecycle_state" gorm:"type:varchar(16);not null;default:'live';index"`

	// RefCount is the number of *non-deleted* `oss_files` rows
	// pointing at this blob. The upload writer increments on claim
	// creation, the lifecycle path (delete / TTL sweep) decrements.
	// The reconciler periodically corrects drift against the source
	// of truth (`COUNT(oss_files WHERE deleted_at IS NULL)`).
	RefCount int64 `json:"ref_count" gorm:"type:bigint;not null;index"`

	// LastSeenAt is bumped on every successful reference commit. The GC worker
	// uses it as the second predicate (after RefCount=0) to delay
	// physical deletion past the configured grace window.
	LastSeenAt time.Time `json:"last_seen_at" gorm:"not null;index"`

	GCClaimWorkerName       string     `json:"gc_claim_worker_name,omitempty" gorm:"type:varchar(64);not null;default:''"`
	GCClaimOwnerNodePeerID  string     `json:"gc_claim_owner_node_peer_id,omitempty" gorm:"type:varchar(255);not null;default:''"`
	GCClaimOwnerIncarnation string     `json:"gc_claim_owner_incarnation,omitempty" gorm:"type:varchar(64);not null;default:''"`
	GCClaimFencingToken     uint64     `json:"gc_claim_fencing_token,omitempty" gorm:"not null;default:0"`
	GCClaimedAt             *time.Time `json:"gc_claimed_at,omitempty" gorm:"index"`

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// TableName binds Blob to its `oss_blobs` table.
func (Blob) TableName() string { return "oss_blobs" }

func (b *Blob) BeforeCreate(*gorm.DB) error {
	if b.Generation == 0 {
		b.Generation = 1
	}
	if b.StorageKey == "" {
		b.StorageKey = b.Key
	}
	if b.LifecycleState == "" {
		b.LifecycleState = BlobLifecycleLive
	}
	return nil
}

// BlobGCGeneration preserves a claimed immutable physical generation
// independently from the current logical Blob row. A replacement may
// advance Blob.Generation while this record remains available for
// idempotent takeover and cleanup.
type BlobGCGeneration struct {
	Backend    string `json:"backend" gorm:"primaryKey;type:varchar(50)"`
	Key        string `json:"key" gorm:"primaryKey;type:varchar(255)"`
	Generation uint64 `json:"generation" gorm:"primaryKey;not null"`
	StorageKey string `json:"storage_key" gorm:"type:varchar(512);not null"`
	Size       int64  `json:"size" gorm:"type:bigint;not null"`

	LastSeenAt      time.Time `json:"last_seen_at" gorm:"not null;index"`
	ClaimWorkerName string    `json:"claim_worker_name" gorm:"type:varchar(64);not null"`

	ClaimOwnerNodePeerID  string    `json:"claim_owner_node_peer_id" gorm:"type:varchar(255);not null"`
	ClaimOwnerIncarnation string    `json:"claim_owner_incarnation" gorm:"type:varchar(64);not null"`
	ClaimFencingToken     uint64    `json:"claim_fencing_token" gorm:"not null"`
	ClaimedAt             time.Time `json:"claimed_at" gorm:"not null;index"`
}

func (BlobGCGeneration) TableName() string { return "oss_blob_gc_generations" }

// WorkerLease is the shared, database-time authority for one OSS
// lifecycle worker name. The single row is advanced in place so the
// fencing token remains monotonic across process restarts.
type WorkerLease struct {
	WorkerName       string    `json:"worker_name" gorm:"primaryKey;type:varchar(64)"`
	OwnerNodePeerID  string    `json:"owner_node_peer_id" gorm:"type:varchar(255);not null"`
	OwnerIncarnation string    `json:"owner_incarnation" gorm:"type:varchar(64);not null"`
	FencingToken     uint64    `json:"fencing_token" gorm:"not null"`
	Status           string    `json:"status" gorm:"type:varchar(16);not null;index"`
	AcquiredAt       time.Time `json:"acquired_at" gorm:"not null"`
	HeartbeatAt      time.Time `json:"heartbeat_at" gorm:"not null"`
	ExpiresAt        time.Time `json:"expires_at" gorm:"not null;index"`
}

func (WorkerLease) TableName() string { return "oss_worker_leases" }
