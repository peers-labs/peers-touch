package model

import "time"

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

	// RefCount is the number of *non-deleted* `oss_files` rows
	// pointing at this blob. The upload writer increments on claim
	// creation, the lifecycle path (delete / TTL sweep) decrements.
	// The reconciler periodically corrects drift against the source
	// of truth (`COUNT(oss_files WHERE deleted_at IS NULL)`).
	RefCount int64 `json:"ref_count" gorm:"type:bigint;not null;index"`

	// LastSeenAt is bumped on every successful Touch. The GC worker
	// uses it as the second predicate (after RefCount=0) to delay
	// physical deletion past the configured grace window.
	LastSeenAt time.Time `json:"last_seen_at" gorm:"not null;index"`

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// TableName binds Blob to its `oss_blobs` table.
func (Blob) TableName() string { return "oss_blobs" }
