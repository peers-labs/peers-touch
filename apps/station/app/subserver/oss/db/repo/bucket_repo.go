package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// BucketRepository abstracts the persistence layer for OSS buckets.
// It is intentionally narrow — the domain operations the OSS
// subserver actually performs are: lookup by id / by (owner, name),
// list, create, atomic-add-usage, decrement-usage, delete.
//
// We do NOT expose generic Update / Save helpers; mutations go
// through dedicated methods so the repo stays the single point of
// concurrency control for `UsedBytes` / `ObjectCount` accounting.
type BucketRepository interface {
	FindByID(ctx context.Context, id string) (*ossmodel.Bucket, error)
	FindByOwnerName(ctx context.Context, owner, name string) (*ossmodel.Bucket, error)
	ListByOwner(ctx context.Context, owner string) ([]ossmodel.Bucket, error)
	ListAll(ctx context.Context) ([]ossmodel.Bucket, error)

	// Create inserts a bucket. Returns ErrBucketExists if the
	// (OwnerActorID, Name) pair already exists.
	Create(ctx context.Context, b *ossmodel.Bucket) error

	// EnsureSystem creates one of the canonical system buckets if
	// it does not already exist for the actor; otherwise it
	// returns the existing row. Idempotent — safe to call from
	// repeated boots.
	EnsureSystem(ctx context.Context, actorID string, spec ossmodel.SystemBucketSpec) (*ossmodel.Bucket, error)

	// AddUsage atomically adds delta bytes (and 1 to ObjectCount)
	// to the bucket. If quota is non-zero and the new total would
	// exceed it, the row is left untouched and ErrQuotaExceeded
	// is returned. The signed delta lets callers also pass a
	// negative number on delete (object count is then -1).
	AddUsage(ctx context.Context, bucketID string, deltaBytes int64) error

	// UpdatePolicy mutates DefaultVisibility / Description / TTL /
	// QuotaBytes in one statement. Used by the dashboard PATCH
	// endpoint.
	UpdatePolicy(ctx context.Context, bucketID string, defaults BucketPolicyUpdate) error

	// Delete removes a bucket row. Returns ErrBucketNotEmpty if
	// `ObjectCount > 0` and force is false.
	Delete(ctx context.Context, bucketID string, force bool) error

	// SetUsage writes absolute (used_bytes, object_count) values.
	// Used exclusively by the BucketReconciler worker to
	// reconcile drift between the cached counters and the
	// authoritative SUM(oss_files.size). The user-facing upload
	// and delete paths must keep using `AddUsage` so the in-flight
	// quota check stays atomic.
	//
	// We do not enforce the quota predicate here — by definition
	// the reconciler is correcting an already-observed reality;
	// rejecting the write because the new total exceeds the (now
	// stale) quota would just leave the row drifted forever.
	// The dashboard surfaces "over-quota" as a separate alert.
	SetUsage(ctx context.Context, bucketID string, usedBytes int64, objectCount int64) error
}

// BucketPolicyUpdate is the patch envelope for UpdatePolicy. nil
// pointer fields mean "leave unchanged" — the zero value of a Go
// type is a legitimate target for some columns (e.g. TTLDays=0
// means "no TTL"), so we cannot use the zero value as a sentinel.
type BucketPolicyUpdate struct {
	DefaultVisibility *string
	QuotaBytes        *int64
	TTLDays           *int32
	Description       *string
}

// Errors returned by the bucket repo. Callers should test against
// these with errors.Is so they can be wrapped without breaking
// detection.
var (
	ErrBucketNotFound = errors.New("oss: bucket not found")
	ErrBucketExists   = errors.New("oss: bucket already exists")
	ErrQuotaExceeded  = errors.New("oss: bucket quota exceeded")
	ErrBucketNotEmpty = errors.New("oss: bucket not empty (use force=true)")
)

type bucketRepo struct {
	dbName string
	clock  func() time.Time
}

// NewBucketRepository binds the repo to a specific named gorm DB
// (the same `dbName` the file repo uses). The clock indirection
// is for tests — production callers leave it nil and get
// `time.Now`.
func NewBucketRepository(dbName string) BucketRepository {
	return &bucketRepo{dbName: dbName, clock: time.Now}
}

func (r *bucketRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *bucketRepo) FindByID(ctx context.Context, id string) (*ossmodel.Bucket, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var b ossmodel.Bucket
	if err := db.Where("id = ?", id).First(&b).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrBucketNotFound
		}
		return nil, err
	}
	return &b, nil
}

func (r *bucketRepo) FindByOwnerName(ctx context.Context, owner, name string) (*ossmodel.Bucket, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var b ossmodel.Bucket
	if err := db.Where("owner_actor_id = ? AND name = ?", owner, name).First(&b).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrBucketNotFound
		}
		return nil, err
	}
	return &b, nil
}

func (r *bucketRepo) ListByOwner(ctx context.Context, owner string) ([]ossmodel.Bucket, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []ossmodel.Bucket
	if err := db.Where("owner_actor_id = ?", owner).Order("kind ASC, name ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *bucketRepo) ListAll(ctx context.Context) ([]ossmodel.Bucket, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []ossmodel.Bucket
	if err := db.Order("owner_actor_id ASC, kind ASC, name ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *bucketRepo) Create(ctx context.Context, b *ossmodel.Bucket) error {
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	if b.CreatedAt.IsZero() {
		b.CreatedAt = r.clock()
	}
	b.UpdatedAt = r.clock()
	err = db.Create(b).Error
	if err != nil && isUniqueViolation(err) {
		return ErrBucketExists
	}
	return err
}

// EnsureSystem implements the idempotent bootstrap path. We look up
// the bucket first; if it exists we return as-is (preserving any
// operator changes to QuotaBytes / Description). If it does not
// exist, we INSERT — and treat a unique-index collision as a benign
// "another worker raced ahead", not an error.
func (r *bucketRepo) EnsureSystem(ctx context.Context, actorID string, spec ossmodel.SystemBucketSpec) (*ossmodel.Bucket, error) {
	if existing, err := r.FindByOwnerName(ctx, actorID, spec.Name); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrBucketNotFound) {
		return nil, err
	}
	now := r.clock()
	b := &ossmodel.Bucket{
		ID:                newULID(now),
		Name:              spec.Name,
		OwnerActorID:      actorID,
		Kind:              spec.Kind,
		SystemKey:         spec.SystemKey,
		DefaultVisibility: spec.DefaultVisibility,
		QuotaBytes:        spec.QuotaBytes,
		TTLDays:           spec.TTLDays,
		Description:       spec.Description,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := r.Create(ctx, b); err != nil {
		if errors.Is(err, ErrBucketExists) {
			return r.FindByOwnerName(ctx, actorID, spec.Name)
		}
		return nil, err
	}
	return b, nil
}

// AddUsage uses an `UPDATE … WHERE …` with a quota predicate so
// concurrent uploads serialize through Postgres' row-level locking
// without a separate SELECT-then-UPDATE round trip. The caller
// distinguishes "bucket missing" (RowsAffected=0 + bucket actually
// missing) from "quota exceeded" (RowsAffected=0 + bucket present)
// by passing through ErrQuotaExceeded only when the row is found.
func (r *bucketRepo) AddUsage(ctx context.Context, bucketID string, deltaBytes int64) error {
	if deltaBytes == 0 {
		return nil
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	deltaCount := int64(1)
	if deltaBytes < 0 {
		deltaCount = -1
	}

	// Build the update. Negative delta unconditionally applies (we
	// never want a delete to fail on quota); positive delta enforces
	// the predicate `quota_bytes = 0 OR used_bytes + delta <= quota_bytes`.
	tx := db.Model(&ossmodel.Bucket{}).Where("id = ?", bucketID)
	if deltaBytes > 0 {
		tx = tx.Where("quota_bytes = 0 OR used_bytes + ? <= quota_bytes", deltaBytes)
	}
	res := tx.Updates(map[string]any{
		"used_bytes":   gorm.Expr("used_bytes + ?", deltaBytes),
		"object_count": gorm.Expr("object_count + ?", deltaCount),
		"updated_at":   r.clock(),
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		// Distinguish missing vs quota-exceeded.
		if _, err := r.FindByID(ctx, bucketID); err != nil {
			return err
		}
		return ErrQuotaExceeded
	}
	return nil
}

func (r *bucketRepo) UpdatePolicy(ctx context.Context, bucketID string, p BucketPolicyUpdate) error {
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	updates := map[string]any{"updated_at": r.clock()}
	if p.DefaultVisibility != nil {
		updates["default_visibility"] = *p.DefaultVisibility
	}
	if p.QuotaBytes != nil {
		updates["quota_bytes"] = *p.QuotaBytes
	}
	if p.TTLDays != nil {
		updates["ttl_days"] = *p.TTLDays
	}
	if p.Description != nil {
		updates["description"] = *p.Description
	}
	if len(updates) == 1 {
		// only updated_at — nothing meaningful to update
		return nil
	}
	res := db.Model(&ossmodel.Bucket{}).Where("id = ?", bucketID).Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrBucketNotFound
	}
	return nil
}

func (r *bucketRepo) Delete(ctx context.Context, bucketID string, force bool) error {
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	if !force {
		var b ossmodel.Bucket
		if err := db.Where("id = ?", bucketID).First(&b).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrBucketNotFound
			}
			return err
		}
		if b.ObjectCount > 0 {
			return ErrBucketNotEmpty
		}
	}
	res := db.Where("id = ?", bucketID).Delete(&ossmodel.Bucket{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrBucketNotFound
	}
	return nil
}

func (r *bucketRepo) SetUsage(ctx context.Context, bucketID string, usedBytes int64, objectCount int64) error {
	if bucketID == "" {
		return errors.New("oss: bucket set-usage: bucketID required")
	}
	if usedBytes < 0 {
		usedBytes = 0
	}
	if objectCount < 0 {
		objectCount = 0
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	res := db.Model(&ossmodel.Bucket{}).
		Where("id = ?", bucketID).
		Updates(map[string]any{
			"used_bytes":   usedBytes,
			"object_count": objectCount,
			"updated_at":   r.clock(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrBucketNotFound
	}
	return nil
}

// upsertOnConflict is reserved for future use (admin-side
// re-import / restore flows). Kept here to centralise the conflict
// strategy so we do not sprinkle gorm.OnConflict clauses across
// the codebase.
func upsertOnConflict() clause.OnConflict { //nolint:unused
	return clause.OnConflict{
		Columns:   []clause.Column{{Name: "owner_actor_id"}, {Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{"updated_at"}),
	}
}
