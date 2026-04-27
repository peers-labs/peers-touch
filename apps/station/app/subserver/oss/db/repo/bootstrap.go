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
// (`SchemaVersionCurrent`) and writes an `oss_meta` sentinel so
// subsequent boots are no-ops.
//
// Architecturally we do *not* enumerate actors at boot, do *not*
// pre-seed system buckets, and do *not* backfill files. System
// buckets are created lazily on first use by each actor — the
// upload-path service calls `BucketRepository.EnsureSystem`
// inline. This keeps OSS decoupled from any other subserver
// (notably friend_chat) and removes a class of "what happens when
// the universe of actors changes after boot" race conditions.
//
// On every reach to a *new* schema version we also seed
// `MetaKeyCapabilityVersion` if missing — the value is a ULID that
// the `/sub-oss/capabilities` response surfaces, and which
// downstream caches use to detect policy changes. Bootstrap only
// seeds it on first reach; subsequent rerolls (e.g. visibility
// tightening, key rotation) are written by the relevant code path.
type BootstrapResult struct {
	Skipped   bool
	ElapsedMs int64
}

// ErrAlreadyBootstrapped is returned when Bootstrap is called on a
// database whose `oss_meta(schema_version)` already matches the
// current schema sentinel. Callers can safely ignore it.
var ErrAlreadyBootstrapped = errors.New("oss: bootstrap: already at current schema version")

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
	// separate migrate call. The migration order is alphabetic to
	// make the diff stable across schema additions.
	if err := db.AutoMigrate(
		&ossmodel.Audit{},
		&ossmodel.Blob{},
		&ossmodel.Bucket{},
		&ossmodel.FileMeta{},
		&ossmodel.Meta{},
		&ossmodel.PeerKey{},
	); err != nil {
		return nil, err
	}

	if v, err := readSchemaVersion(db); err == nil && v == ossmodel.SchemaVersionCurrent {
		// Even on the no-op path we make sure capability_version
		// exists — deployments that bootstrapped under v2 (or older)
		// will still have a missing row, and the /capabilities
		// handler must always have *something* to surface.
		if err := ensureCapabilityVersion(db, deps.Clock()); err != nil {
			return nil, err
		}
		return &BootstrapResult{Skipped: true}, ErrAlreadyBootstrapped
	}

	start := time.Now()

	if err := ensureCapabilityVersion(db, deps.Clock()); err != nil {
		return nil, err
	}

	if err := writeSchemaVersion(db, deps.Clock(), ossmodel.SchemaVersionCurrent); err != nil {
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

// ensureCapabilityVersion mints a fresh ULID into
// `MetaKeyCapabilityVersion` when the row is missing. Idempotent:
// once a value exists Bootstrap leaves it alone; the dashboard /
// PATCH paths are the only writers thereafter.
func ensureCapabilityVersion(db *gorm.DB, now time.Time) error {
	var m ossmodel.Meta
	err := db.Where("key = ?", ossmodel.MetaKeyCapabilityVersion).First(&m).Error
	if err == nil {
		// Already present; nothing to do.
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return db.Create(&ossmodel.Meta{
		Key:       ossmodel.MetaKeyCapabilityVersion,
		Value:     newULID(now),
		UpdatedAt: now,
	}).Error
}
