// Package model — Bucket / Audit / Meta tables for the OSS management
// plane.
//
// Buckets are *logical* groupings of objects, decoupled from any
// physical storage container (the active `storage.Backend` is still
// single-rooted). They give us:
//
//  1. A quota unit. `QuotaBytes` + `UsedBytes` lets the OSS subserver
//     refuse uploads before they touch the backend.
//  2. A default visibility. New uploads inherit `DefaultVisibility`
//     unless the caller explicitly overrides it on a per-object basis.
//  3. A scoping handle for the dashboard portal.
//
// System-managed buckets are created **lazily on first use** by each
// actor — the service layer calls `BucketRepository.EnsureSystem`
// inline on the upload path. There is no startup-time enumeration of
// the actor universe, which keeps OSS decoupled from the friend_chat
// schema.
package model

import (
	"time"

	"gorm.io/gorm"
)

// Visibility levels enforced at /sub-oss/file GET.
//
// `chat`/`private` require an authenticated subject; the actual
// audience check happens in the OSS handler against the friend_chat
// session table (for `chat`) or against `OwnerPTID` (for `private`).
//
// `public` skips the audience check but the operator-managed
// `sign-secret` HMAC gate still applies if it is configured.
const (
	VisibilityPublic  = "public"
	VisibilityChat    = "chat"
	VisibilityPrivate = "private"
)

// IsKnownVisibility reports whether v is one of the values the OSS
// subserver knows how to enforce. Unknown values are rejected at
// the service layer; there is no implicit coercion.
func IsKnownVisibility(v string) bool {
	switch v {
	case VisibilityPublic, VisibilityChat, VisibilityPrivate:
		return true
	}
	return false
}

// Bucket kinds. The kind is informational for the dashboard but it
// also drives policy:
//
//   - `system` buckets are auto-created and protected from deletion;
//     the bootstrap routine recognises them by `SystemKey`.
//   - `user` buckets are operator-created, deletable when empty.
//   - `applet` buckets are reserved for a future applets-managed
//     namespace; treated like `user` today.
const (
	BucketKindSystem = "system"
	BucketKindUser   = "user"
	BucketKindApplet = "applet"
)

// Reserved system bucket names. The bootstrap routine creates one
// row per (actor, system bucket) pair; the OSS upload flow uses
// `SystemBucketChat` as the implicit fallback when the client does
// not specify a bucket.
const (
	SystemBucketAvatar   = "avatar"
	SystemBucketChat     = "chat"
	SystemBucketMoments  = "moments"
	SystemBucketPersonal = "personal"
)

// Bucket is the on-disk record for a logical OSS bucket.
//
// Lookup keys:
//   - by ID (ULID, `idx_bucket_id_pk`)
//   - by (OwnerPTID, Name) (`idx_bucket_owner_ptid_name`, unique)
//
// The unique index on the (owner, name) pair is what makes
// `Bootstrap` idempotent — repeated runs will collide on the index
// and we treat the collision as success.
type Bucket struct {
	ID                string `json:"id"             gorm:"primaryKey;type:varchar(64)"`
	Name              string `json:"name"       gorm:"uniqueIndex:idx_bucket_owner_ptid_name;type:varchar(120)"`
	OwnerPTID         string `json:"owner_ptid" gorm:"column:owner_ptid;uniqueIndex:idx_bucket_owner_ptid_name;index;type:varchar(255)"`
	Kind              string `json:"kind"           gorm:"type:varchar(16);index"`
	SystemKey         string `json:"system_key"     gorm:"type:varchar(32);index"`
	DefaultVisibility string `json:"default_visibility" gorm:"type:varchar(16)"`

	// QuotaBytes is the maximum aggregate size (in bytes) the bucket
	// will accept. 0 means unlimited. Enforcement is at upload time;
	// the subserver subtracts UsedBytes from QuotaBytes and rejects
	// the upload (with `oss: bucket quota exceeded`) when the new
	// object would push the bucket over.
	QuotaBytes int64 `json:"quota_bytes" gorm:"type:bigint;not null"`

	// UsedBytes / ObjectCount are *cached* aggregates. They are
	// updated atomically inside the upload + delete code paths;
	// the bootstrap routine recomputes them once on first migration.
	// A periodic reconciliation (out of scope here) can recompute
	// them from the source-of-truth `oss_files` rows if drift is
	// suspected.
	UsedBytes   int64 `json:"used_bytes"   gorm:"type:bigint;not null"`
	ObjectCount int64 `json:"object_count" gorm:"type:bigint;not null"`

	// TTLDays, if non-zero, instructs a (future) lifecycle GC to
	// delete objects older than this many days from this bucket.
	// We persist it now so dashboards can show the policy; actual
	// enforcement is deferred to a follow-up round.
	TTLDays int32 `json:"ttl_days" gorm:"type:int;not null"`

	Description string    `json:"description" gorm:"type:varchar(500)"`
	CreatedAt   time.Time `json:"created_at"  gorm:"autoCreateTime"`
	UpdatedAt   time.Time `json:"updated_at"  gorm:"autoUpdateTime"`

	// DeletedAt is GORM's built-in soft-delete column. Buckets are
	// rarely deleted (only via the dashboard `force=true` path) and
	// when they are, default queries should hide them — operators
	// should not see deleted buckets in the bucket list, owners
	// should not be able to upload into them. The dashboard force-
	// delete path uses `Unscoped()` for either hard delete or list-
	// including-deleted views.
	//
	// Note: the unique index on (owner_ptid, name) is *not*
	// scoped by deleted_at, so the operator must hard-delete (or
	// rename) before recreating a bucket with the same name. This
	// is an explicit operator-friction trade for keeping the index
	// portable across SQLite / Postgres.
	DeletedAt gorm.DeletedAt `json:"deleted_at,omitempty" gorm:"index"`
}

// TableName binds the Bucket struct to `oss_buckets`. We intentionally
// keep the table prefix `oss_` so it sorts next to `oss_files` and
// `oss_audit` in dashboard storage views.
func (Bucket) TableName() string { return "oss_buckets" }

// SystemBucketSpec describes a built-in bucket that bootstrap will
// create per actor. Keeping the specs as a Go-level constant — instead
// of an `init()` table — makes them easy to reference from tests.
type SystemBucketSpec struct {
	Name              string
	SystemKey         string
	Kind              string
	DefaultVisibility string
	QuotaBytes        int64
	TTLDays           int32
	Description       string
}

// SystemBucketSpecs is the canonical list of built-in buckets created
// per actor. The numbers match the plan document
// (`.dev-workflow/20260427-142337/plan.md`); changing them here is
// considered a schema change and should ship behind a migration bump.
// FindSystemBucketSpec returns the spec whose Name matches `name`,
// or nil when the name does not refer to a system bucket. The
// service layer calls this on every upload to decide whether to
// EnsureSystem (system bucket) or FindByOwnerName (user bucket).
func FindSystemBucketSpec(name string) *SystemBucketSpec {
	for i := range SystemBucketSpecs {
		if SystemBucketSpecs[i].Name == name {
			return &SystemBucketSpecs[i]
		}
	}
	return nil
}

var SystemBucketSpecs = []SystemBucketSpec{
	{
		Name:              SystemBucketAvatar,
		SystemKey:         SystemBucketAvatar,
		Kind:              BucketKindSystem,
		DefaultVisibility: VisibilityPublic,
		QuotaBytes:        50 * 1024 * 1024,
		TTLDays:           0,
		Description:       "Profile pictures and other public-by-default assets.",
	},
	{
		Name:              SystemBucketChat,
		SystemKey:         SystemBucketChat,
		Kind:              BucketKindSystem,
		DefaultVisibility: VisibilityChat,
		QuotaBytes:        5 * 1024 * 1024 * 1024,
		TTLDays:           90,
		Description:       "Attachments shared in chats; visible to chat audience members.",
	},
	{
		Name:              SystemBucketMoments,
		SystemKey:         SystemBucketMoments,
		Kind:              BucketKindSystem,
		DefaultVisibility: VisibilityPublic,
		QuotaBytes:        5 * 1024 * 1024 * 1024,
		TTLDays:           0,
		Description:       "Images attached to Moments posts; public-readable and retained with the post.",
	},
	{
		Name:              SystemBucketPersonal,
		SystemKey:         SystemBucketPersonal,
		Kind:              BucketKindSystem,
		DefaultVisibility: VisibilityPrivate,
		QuotaBytes:        10 * 1024 * 1024 * 1024,
		TTLDays:           0,
		Description:       "Personal storage; only the owning actor can read.",
	},
}
