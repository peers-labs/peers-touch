package model

import "time"

// FileMeta is the on-disk + DB record for a stored object.
//
// All identity-bearing columns (`BucketID`, `OwnerPTID`,
// `Visibility`) are *required*. The service layer rejects writes
// missing any of them; there is no fallback / sentinel / "legacy"
// row shape. CAS-keyed rows must additionally carry `Sha256`.
//
// `BucketID` is FK-shaped (string ULID) but we do not declare a hard
// SQL foreign key — that would force every test that exercises file
// metadata to also migrate the buckets table. Referential integrity
// is enforced at the service layer where a bucket lookup precedes
// every Create.
type FileMeta struct {
	ID string `json:"id"  gorm:"primaryKey;type:varchar(64)"`
	// Key is the storage-backend key (e.g. `cas/aa/abc…`). It is
	// *not* unique by itself: two actors uploading identical CAS
	// bytes converge on the same key but each gets their own row
	// (different visibility / bucket / quota). Uniqueness is
	// enforced via the composite index `idx_oss_files_owner_ptid_key`
	// declared on `OwnerPTID`.
	Key     string `json:"key" gorm:"uniqueIndex:idx_oss_files_owner_ptid_key;index;type:varchar(255)"`
	Name    string `json:"name"    gorm:"type:varchar(255)"`
	Size    int64  `json:"size"    gorm:"type:bigint;not null"`
	Mime    string `json:"mime"    gorm:"type:varchar(100)"`
	Backend string `json:"backend" gorm:"type:varchar(50);not null"`
	Path    string `json:"path"    gorm:"type:varchar(1000)"`
	Sha256  string `json:"sha256,omitempty" gorm:"index;type:varchar(64)"`

	// BucketID points at the owning oss_buckets row. Required; the
	// service layer EnsureSystems the bucket inline if the actor
	// has not used it before, so callers always have a valid id
	// to write here.
	BucketID string `json:"bucket_id" gorm:"index;type:varchar(64);not null"`

	// OwnerPTID is the PTID of the actor that uploaded the file.
	// Required. Used by `private` visibility checks, as the audit
	// attribution, and as the leading column of the composite
	// `(owner_ptid, key)` unique index that lets two actors
	// independently claim the same CAS blob.
	OwnerPTID string `json:"owner_ptid" gorm:"column:owner_ptid;uniqueIndex:idx_oss_files_owner_ptid_key;index;type:varchar(255);not null"`

	// Visibility is exactly one of `public` / `chat` / `private`.
	// Required. Defaults to the bucket's DefaultVisibility when the
	// upload request omits it; the service layer rejects unknown
	// values rather than silently coercing them.
	Visibility string `json:"visibility" gorm:"type:varchar(16);not null;index"`

	// ChatSessionID is required iff Visibility=chat; it is the ULID
	// of the friend_chat session whose participants form the
	// audience. Empty for `public`/`private` rows.
	ChatSessionID string `json:"chat_session_id,omitempty" gorm:"index;type:varchar(64)"`

	// ExpiresAt is the wall-clock deadline after which the TTL
	// sweeper soft-deletes this row. NULL means "no expiry". The
	// upload path defaults this from `oss_buckets.ttl_days` when
	// the bucket has a TTL; the user can override via PATCH or
	// clear it back to NULL. Indexed because the sweeper uses it
	// as the leading predicate.
	ExpiresAt *time.Time `json:"expires_at,omitempty" gorm:"index"`

	// DeletedAt is the wall-clock instant at which this row entered
	// the soft-delete state. NULL = live. We deliberately use a
	// pointer here rather than `gorm.DeletedAt` because the OSS
	// lifecycle path needs explicit control over which queries
	// observe deleted rows (restore, blob GC) and which do not
	// (user reads, owner listings, sweeper). Indexed because both
	// the restore window check and the GC predicate hinge on it.
	DeletedAt *time.Time `json:"deleted_at,omitempty" gorm:"index"`

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`

	// UpdatedAt is bumped by GORM on any column-level update; the
	// PATCH handler relies on this to surface "edited" state to
	// the dashboard without a per-mutation column dance.
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// TableName pins FileMeta to its `oss_files` table.
func (FileMeta) TableName() string { return "oss_files" }
