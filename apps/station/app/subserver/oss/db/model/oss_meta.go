package model

import "time"

// SchemaVersionV2 is the marker the bootstrap routine writes after a
// successful AutoMigrate. The boot sequence reads `oss_meta` first;
// if a row with this version is present, bootstrap is skipped on
// subsequent restarts. There is no backfill / data-migration step —
// peers-oss is a greenfield application and the schema is the only
// source of truth.
//
// Bumping this constant is a deliberate schema change — *do not* do
// it casually. Any future migration that needs to re-run bootstrap
// should add a *new* version constant (V3, V4, …) and the
// corresponding `AutoMigrate` invocation, leaving V2 in place.
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
