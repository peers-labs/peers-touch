package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// Bootstrap migrates the OSS database to the current schema version
// and writes an `oss_meta` sentinel so subsequent boots are no-ops.
//
// Architecturally we do *not* enumerate actors at boot, do *not*
// pre-seed system buckets, and do *not* backfill files. System
// buckets are created lazily on first use by each actor — the
// upload-path service calls `BucketRepository.EnsureSystem`
// inline. This keeps OSS decoupled from any other subserver
// (notably friend_chat) and removes a class of "what happens when
// the universe of actors changes after boot" race conditions.
//
// The sentinel still earns its keep: it gives future migrations
// (v3, v4, …) a known starting point so they can decide whether
// to run a one-shot fixup.
type BootstrapResult struct {
	Skipped   bool
	ElapsedMs int64
}

// ErrAlreadyBootstrapped is returned when Bootstrap is called on a
// database whose `oss_meta(schema_version) >= V2`. Callers can
// safely ignore it.
var ErrAlreadyBootstrapped = errors.New("oss: bootstrap: already at v2")

// BootstrapDeps is the parameter envelope; today only DBName and
// Clock are needed but the struct stays so future migrations can
// add knobs without changing the call sites.
type BootstrapDeps struct {
	DBName string
	Clock  func() time.Time
}

// Bootstrap brings the OSS database up to the current schema
// version. Safe to call from server startup. Returns
// ErrAlreadyBootstrapped if the migration has already been applied.
func Bootstrap(ctx context.Context, deps BootstrapDeps) (*BootstrapResult, error) {
	if deps.DBName == "" {
		return nil, errors.New("oss: bootstrap: DBName required")
	}
	if deps.Clock == nil {
		deps.Clock = time.Now
	}

	db, err := store.GetRDS(ctx, store.WithRDSDBName(deps.DBName))
	if err != nil {
		return nil, err
	}

	// AutoMigrate is idempotent. We invoke it defensively so callers
	// reaching Bootstrap directly (e.g. unit tests) do not need a
	// separate migrate call.
	if err := db.AutoMigrate(
		&ossmodel.FileMeta{},
		&ossmodel.Bucket{},
		&ossmodel.Audit{},
		&ossmodel.Meta{},
		&ossmodel.PeerKey{},
	); err != nil {
		return nil, err
	}

	if v, err := readSchemaVersion(db); err == nil && v == ossmodel.SchemaVersionV2 {
		return &BootstrapResult{Skipped: true}, ErrAlreadyBootstrapped
	}

	start := time.Now()
	if err := writeSchemaVersion(db, deps.Clock(), ossmodel.SchemaVersionV2); err != nil {
		return nil, err
	}
	return &BootstrapResult{ElapsedMs: time.Since(start).Milliseconds()}, nil
}

// readSchemaVersion returns the schema_version stored in oss_meta,
// or "" if the row is missing.
func readSchemaVersion(db *gorm.DB) (string, error) {
	var m ossmodel.Meta
	err := db.Where("key = ?", ossmodel.MetaKeySchemaVersion).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return m.Value, nil
}

func writeSchemaVersion(db *gorm.DB, now time.Time, version string) error {
	res := db.Model(&ossmodel.Meta{}).
		Where("key = ?", ossmodel.MetaKeySchemaVersion).
		Updates(map[string]any{"value": version, "updated_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return db.Create(&ossmodel.Meta{
			Key:       ossmodel.MetaKeySchemaVersion,
			Value:     version,
			UpdatedAt: now,
		}).Error
	}
	return nil
}
