package model

import "time"

// FileMeta is the on-disk + DB record for a stored object.
//
// All identity-bearing columns (`BucketID`, `OwnerActorID`,
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
	ID        string `json:"id"      gorm:"primaryKey;type:varchar(64)"`
	Key       string `json:"key"     gorm:"uniqueIndex;type:varchar(255)"`
	Name      string `json:"name"    gorm:"type:varchar(255)"`
	Size      int64  `json:"size"    gorm:"type:bigint;not null"`
	Mime      string `json:"mime"    gorm:"type:varchar(100)"`
	Backend   string `json:"backend" gorm:"type:varchar(50);not null"`
	Path      string `json:"path"    gorm:"type:varchar(1000)"`
	Sha256    string `json:"sha256,omitempty" gorm:"index;type:varchar(64)"`

	// BucketID points at the owning oss_buckets row. Required; the
	// service layer EnsureSystems the bucket inline if the actor
	// has not used it before, so callers always have a valid id
	// to write here.
	BucketID string `json:"bucket_id" gorm:"index;type:varchar(64);not null"`

	// OwnerActorID is the DID of the actor that uploaded the file.
	// Required. Used by `private` visibility checks and as the
	// audit attribution.
	OwnerActorID string `json:"owner_actor_id" gorm:"index;type:varchar(255);not null"`

	// Visibility is exactly one of `public` / `chat` / `private`.
	// Required. Defaults to the bucket's DefaultVisibility when the
	// upload request omits it; the service layer rejects unknown
	// values rather than silently coercing them.
	Visibility string `json:"visibility" gorm:"type:varchar(16);not null;index"`

	// ChatSessionID is required iff Visibility=chat; it is the ULID
	// of the friend_chat session whose participants form the
	// audience. Empty for `public`/`private` rows.
	ChatSessionID string `json:"chat_session_id,omitempty" gorm:"index;type:varchar(64)"`

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// TableName pins FileMeta to its `oss_files` table.
func (FileMeta) TableName() string { return "oss_files" }
