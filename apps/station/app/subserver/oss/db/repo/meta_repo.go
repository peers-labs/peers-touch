package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// MetaRepository is a thin wrapper around the `oss_meta` KV table
// for the bits that *are not* schema-version book-keeping. Today
// the only consumer is the file PATCH path (S5) bumping
// `capability_version`; the dashboard key-rotation paths (S11)
// will piggy-back on the same primitives.
//
// Why a dedicated repo (vs free functions in `bootstrap.go`)?
//
//   - The PATCH service depends on a tiny, mockable surface; a
//     full repo lets tests inject a fake without dragging the
//     bootstrap migration in.
//   - capability_version is read on the hot path (`/capabilities`
//     once per remote-cache validation) so it deserves a single
//     place to host caching later.
//   - Future Meta keys (federation key rotation timestamps,
//     metric counters) want the same sentinel semantics — keeping
//     them in a typed interface beats stringly-typed callers.
type MetaRepository interface {
	// Get returns the value of a Meta key, or "" if no row.
	// Errors only on real DB failures; a missing row is *not*
	// considered an error so callers can treat it the same as a
	// fresh deployment.
	Get(ctx context.Context, key string) (string, error)

	// SetCapabilityVersion writes a freshly-minted ULID into
	// `MetaKeyCapabilityVersion` and bumps `updated_at`. The
	// returned string is the value that was persisted, so callers
	// can echo it into audit rows / response headers without a
	// second round-trip.
	SetCapabilityVersion(ctx context.Context, now time.Time) (string, error)

	// Set writes (key, value, updated_at). Upserts on the
	// composite key. Used by the federation key-rotation flow
	// (write `_prev` slot + rotated_at) and the rotation
	// finalizer worker.
	Set(ctx context.Context, key, value string, now time.Time) error

	// Delete drops the rows matching `keys`. Idempotent —
	// missing rows are not errors. Used by the rotation
	// finalizer to clear the `_prev` keypair after the
	// dual-sign window expires.
	Delete(ctx context.Context, keys ...string) (int64, error)
}

type metaRepo struct {
	dbName string
}

// NewMetaRepository binds a MetaRepository to a named gorm DB. Same
// db handle the file / bucket / blob repos use.
func NewMetaRepository(dbName string) MetaRepository {
	return &metaRepo{dbName: dbName}
}

func (r *metaRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *metaRepo) Get(ctx context.Context, key string) (string, error) {
	if key == "" {
		return "", errors.New("oss: meta get: key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return "", err
	}
	var m ossmodel.Meta
	err = db.Where("key = ?", key).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return m.Value, nil
}

func (r *metaRepo) Set(ctx context.Context, key, value string, now time.Time) error {
	if key == "" {
		return errors.New("oss: meta set: key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	res := db.Model(&ossmodel.Meta{}).
		Where("key = ?", key).
		Updates(map[string]any{"value": value, "updated_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return db.Create(&ossmodel.Meta{
			Key:       key,
			Value:     value,
			UpdatedAt: now,
		}).Error
	}
	return nil
}

func (r *metaRepo) Delete(ctx context.Context, keys ...string) (int64, error) {
	if len(keys) == 0 {
		return 0, nil
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	res := db.Where("key IN ?", keys).Delete(&ossmodel.Meta{})
	return res.RowsAffected, res.Error
}

func (r *metaRepo) SetCapabilityVersion(ctx context.Context, now time.Time) (string, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return "", err
	}
	value := newULID(now)
	res := db.Model(&ossmodel.Meta{}).
		Where("key = ?", ossmodel.MetaKeyCapabilityVersion).
		Updates(map[string]any{"value": value, "updated_at": now})
	if res.Error != nil {
		return "", res.Error
	}
	if res.RowsAffected == 0 {
		// First reach — bootstrap should have seeded this row, but
		// we fall back to insert so the PATCH path is robust to an
		// older deployment / a fresh test DB.
		if err := db.Create(&ossmodel.Meta{
			Key:       ossmodel.MetaKeyCapabilityVersion,
			Value:     value,
			UpdatedAt: now,
		}).Error; err != nil {
			return "", err
		}
	}
	return value, nil
}
