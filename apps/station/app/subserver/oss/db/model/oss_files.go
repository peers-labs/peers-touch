package model

import "time"

// FileMeta is the on-disk + DB record for a stored object.
//
// Field history:
//   - 2026-04 (CAS):  added `Sha256` to support content-addressable
//     keys and integrity checks. Nullable on purpose; legacy rows
//     uploaded before CAS keep an empty Sha256 and continue to work.
//   - 2026-04 (mgmt): added `BucketID`, `OwnerActorID`, `Visibility`,
//     `ChatSessionID` to support the management plane and per-object
//     access control. Existing rows are backfilled by `repo.Bootstrap`
//     during the v2 migration; rows uploaded before that migration
//     either get the actor's `system:chat` bucket (if linked to a
//     friend_chat attachment) or the `_legacy` sentinel owner.
//
// `BucketID` is FK-shaped (string ULID) but we do not declare a hard
// SQL foreign key — that would force every test to migrate the
// buckets table even when only file metadata is exercised. Integrity
// is enforced at the service layer.
type FileMeta struct {
	ID        string    `json:"id"      gorm:"primaryKey;type:varchar(64)"`
	Key       string    `json:"key"     gorm:"uniqueIndex;type:varchar(255)"`
	Name      string    `json:"name"    gorm:"type:varchar(255)"`
	Size      int64     `json:"size"    gorm:"type:bigint"`
	Mime      string    `json:"mime"    gorm:"type:varchar(100)"`
	Backend   string    `json:"backend" gorm:"type:varchar(50)"`
	Path      string    `json:"path"    gorm:"type:varchar(1000)"`
	Sha256    string    `json:"sha256,omitempty" gorm:"index;type:varchar(64)"`

	// BucketID points at the owning oss_buckets row. Empty for
	// pre-bootstrap rows; the OSS subserver treats empty as "no
	// quota tracking" and refuses to delete such rows from the
	// dashboard except via the `force=true` flag.
	BucketID string `json:"bucket_id,omitempty" gorm:"index;type:varchar(64)"`

	// OwnerActorID is the DID of the actor that uploaded the file.
	// Used by `private` visibility checks. May be set to the sentinel
	// `_legacy` for bootstrap-time rows whose uploader cannot be
	// recovered.
	OwnerActorID string `json:"owner_actor_id,omitempty" gorm:"index;type:varchar(255)"`

	// Visibility is one of `public` / `chat` / `private`. Empty rows
	// (legacy) are treated as `chat` at enforcement time, preserving
	// the pre-mgmt-plane behaviour.
	Visibility string `json:"visibility,omitempty" gorm:"type:varchar(16);index"`

	// ChatSessionID populates only when Visibility=chat; it is the
	// ULID of the friend_chat session whose participants form the
	// audience. Empty for `public`/`private` rows.
	ChatSessionID string `json:"chat_session_id,omitempty" gorm:"index;type:varchar(64)"`

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// TableName pins FileMeta to the historical `oss_files` table name.
func (FileMeta) TableName() string { return "oss_files" }

// LegacyOwnerActorID is written into `OwnerActorID` for pre-bootstrap
// rows whose uploader cannot be identified during the v2 migration.
// It is *not* an actor that can authenticate — it serves as a flag
// for the dashboard so operators can spot legacy data.
const LegacyOwnerActorID = "_legacy"
