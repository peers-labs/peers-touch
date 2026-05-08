package model

import "time"

// Schema-version sentinels. The bootstrap routine reads `oss_meta`
// first; if a row stamped with the current sentinel is present,
// bootstrap exits early on subsequent restarts. There is no backfill
// or data-migration step — peers-oss is a greenfield application and
// the schema is the only source of truth.
//
// Bumping the *current* version is a deliberate schema change. The
// only operation we perform on an existing database is GORM's
// AutoMigrate, which adds new columns / tables idempotently and
// leaves existing rows untouched. Anything heavier (re-shaping
// existing columns, changing semantics of existing values) requires
// wiping `oss_*` and re-bootstrapping.
const (
	// SchemaVersionV2 was the round-2 sentinel: oss_buckets +
	// per-actor CAS + chat-session resolver. Kept for the equality
	// check in `Bootstrap` so a v2 database upgrades cleanly to v3.
	SchemaVersionV2 = "v2"

	// SchemaVersionV3 is the round-3 (terminal) sentinel:
	//
	//   - `oss_blobs` table for refcounted physical blobs.
	//   - `oss_files`: + expires_at / deleted_at / updated_at
	//     for the lifecycle path (PATCH / DELETE / restore / TTL).
	//   - `oss_buckets`: + soft-delete column.
	//   - `oss_audit`: + dashboard_actor_id / request_id / file_id
	//     and the expanded action enum.
	//   - `oss_peer_keys`: + pinned_by_actor / pinned_at.
	//   - `oss_meta`: + capability_version + federation_*_prev
	//     keys for the rotation flow.
	SchemaVersionV3 = "v3"

	// SchemaVersionCurrent is the version Bootstrap stamps on
	// first reach to the current schema. Bumping this constant is
	// the only place a developer needs to change to roll a new
	// schema version.
	SchemaVersionCurrent = SchemaVersionV3
)

// Meta is a tiny key/value table used for schema-version markers and
// other infrequently-touched bootstrap state. We keep it separate
// from `oss_files` so it survives `TRUNCATE oss_files` operations
// (which an operator might run while debugging) without losing the
// migration history.
type Meta struct {
	Key       string    `json:"key"        gorm:"column:key;primaryKey;type:varchar(64)"`
	Value     string    `json:"value"      gorm:"column:value;type:varchar(500)"`
	UpdatedAt time.Time `json:"updated_at" gorm:"column:updated_at;autoUpdateTime"`
}

// TableName binds Meta to `oss_meta`.
func (Meta) TableName() string { return "oss_meta" }

// Well-known oss_meta row keys. Federation-specific keys live in
// `oss_peer_keys.go` next to the PeerKey model — they belong to the
// same trust subsystem.
const (
	// MetaKeySchemaVersion is the row that records the most recent
	// migration the bootstrap routine has completed.
	MetaKeySchemaVersion = "schema_version"

	// MetaKeyCapabilityVersion is a ULID re-rolled whenever a
	// policy change should invalidate cross-station caches —
	// notably, when a user tightens a file's visibility via PATCH
	// or when an operator rotates the federation key. The
	// `/sub-oss/capabilities` response surfaces it; clients re-read
	// capabilities and bust caches when the value changes.
	//
	// We use a ULID rather than a counter so multi-instance writes
	// do not need coordination — every write produces a globally
	// fresh value, which is the only contract clients care about.
	MetaKeyCapabilityVersion = "capability_version"
)
