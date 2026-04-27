package model

import "time"

// SchemaVersionV2 is the marker the bootstrap routine writes once it
// has finished provisioning system buckets and backfilling existing
// FileMeta rows. The boot sequence reads `oss_meta` first; if a row
// with this version is present, the bootstrap is skipped.
//
// Bumping this constant is a deliberate schema change — *do not* do
// it casually. Any future migration that needs to re-run bootstrap
// for already-upgraded stations should add a *new* version constant
// (V3, V4, …) and a corresponding migration function, leaving V2
// in place.
const SchemaVersionV2 = "v2"

// Meta is a tiny key/value table used for schema-version markers and
// other infrequently-touched bootstrap state. We keep it separate
// from `oss_files` so it survives `TRUNCATE oss_files` operations
// (which an operator might run while debugging) without losing the
// migration history.
type Meta struct {
	Key       string    `json:"key"        gorm:"primaryKey;type:varchar(64)"`
	Value     string    `json:"value"      gorm:"type:varchar(500)"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// TableName binds Meta to `oss_meta`.
func (Meta) TableName() string { return "oss_meta" }

// MetaKeySchemaVersion is the row that records the most recent
// migration the bootstrap routine has completed.
const MetaKeySchemaVersion = "schema_version"
