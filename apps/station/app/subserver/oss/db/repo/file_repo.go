package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// FileRepository is the persistence boundary for `oss_files`. It
// exposes two read paths because the (owner, key) tuple is the new
// uniqueness contract while plain `key` lookups remain useful for
// federation/public reads where the caller may not yet know the
// owner DID.
//
// All "Find" methods return only *live* rows by default — soft-
// deleted rows are filtered out so user-visible reads behave
// correctly. The upload writer needs the deleted rows to detect
// "CAS bytes match an existing-but-deleted row → revive instead of
// re-create"; it goes through the explicit `…IncludeDeleted`
// variant rather than the default.
type FileRepository interface {
	Create(ctx context.Context, meta *ossmodel.FileMeta) error

	// FindByKey returns *any* live meta for the key — the oldest
	// one by CreatedAt. Use for public reads / federation lookups
	// where the caller has not (or cannot) supply an owner. For
	// permission-aware reads prefer `FindByOwnerKey`.
	FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error)

	// FindByOwnerKey returns the live (owner, key) row, if any.
	// This is the read-side primitive — handlers reading bytes use
	// it; dedup short-circuits on the upload write path go through
	// `FindByOwnerKeyIncludeDeleted` so they observe revivable
	// deleted rows.
	FindByOwnerKey(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error)

	// FindByOwnerKeyIncludeDeleted is the same lookup but does NOT
	// filter `deleted_at IS NULL`. The upload writer uses it to
	// distinguish three cases:
	//
	//   - no row at all → fresh upload
	//   - live row → CAS dedup short-circuit (existing behaviour)
	//   - soft-deleted row → revive (clear DeletedAt, bump
	//     blob ref_count, addUsage)
	//
	// Callers MUST inspect `meta.DeletedAt` before treating the
	// row as a dedup hit.
	FindByOwnerKeyIncludeDeleted(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error)

	// Restore clears `DeletedAt`, bumps `UpdatedAt`, and optionally
	// resets `ExpiresAt` (when `newExpires` is non-nil). It is the
	// inverse of `MarkDeleted`. Returns ErrFileNotFound if the row
	// is missing entirely.
	//
	// Used by:
	//   - the upload writer when CAS hits a soft-deleted row;
	//   - the explicit `POST /sub-oss/file/restore` handler
	//     (within the soft-delete grace window).
	Restore(ctx context.Context, id string, now time.Time, newExpires *time.Time) error

	// MarkDeleted sets `DeletedAt = now` and bumps `UpdatedAt` for
	// the row, but only when it is currently live (i.e.
	// `deleted_at IS NULL`). A second concurrent or repeated DELETE
	// returns ErrFileAlreadyDeleted so the caller can short-circuit
	// without double-debiting bucket usage or double-releasing the
	// blob refcount. ErrFileNotFound when the id matches no row.
	//
	// Used by:
	//   - the explicit `DELETE /sub-oss/file?key=…` handler;
	//   - dashboard admin force-delete (S10) — same primitive,
	//     different audit reason.
	MarkDeleted(ctx context.Context, id string, now time.Time) error

	// Patch applies a partial mutate to the row. Each non-nil
	// pointer in `patch` is set; nil pointers are left alone.
	// `Patch.ExpiresAtSet` is the explicit "clear vs leave alone"
	// signal because `*time.Time` cannot distinguish "set to NULL"
	// from "leave unchanged". `UpdatedAt` is always refreshed.
	//
	// Returns ErrFileNotFound if the row is missing or already
	// soft-deleted; the caller is expected to disallow PATCH on
	// tombstones at the service layer with a clearer error.
	Patch(ctx context.Context, id string, patch FilePatch, now time.Time) error

	// ListByOwner returns the rows owned by `owner` matching the
	// `filter`, ordered by `created_at DESC, id DESC` for stable
	// pagination, sliced by `[offset, offset+limit)`. The second
	// return value is the total count after `filter` is applied
	// (i.e. NOT bounded by limit/offset) so the caller can render
	// page indicators without a second round-trip.
	//
	// Limit ≤ 0 falls back to 50; values > 200 are clamped at the
	// service layer rather than here so the repo stays
	// policy-free. Offset ≤ 0 means "start at row 0".
	//
	// Soft-deleted rows are excluded by default; set
	// `Filter.IncludeDeleted = true` to surface them (used by the
	// dashboard "trash" view).
	ListByOwner(ctx context.Context, owner string, filter ListByOwnerFilter, limit, offset int) ([]ossmodel.FileMeta, int64, error)

	// ListExpired returns live rows whose `expires_at` is non-NULL
	// and < `now`, ordered by `expires_at ASC` so the worker
	// drains the oldest first. `limit` bounds the worker's batch
	// size to avoid runaway DELETEs on a backlog. The TTLSweeper
	// worker uses this to drive bulk soft-delete + bucket usage
	// debit + blob refcount release; per the v3 plan, drift in
	// any of those follow-on writes is corrected by the
	// BucketReconciler / BlobGC workers.
	//
	// Soft-deleted rows are excluded — there is nothing to expire
	// when the file is already in the tombstone state.
	ListExpired(ctx context.Context, now time.Time, limit int) ([]ossmodel.FileMeta, error)
}

// ListByOwnerFilter captures the user-facing search predicates the
// `GET /sub-oss/my-files` endpoint exposes. All fields are
// optional; the empty value disables the corresponding predicate.
//
// `MimePrefix` is matched with SQL `LIKE '<prefix>%'` after escaping
// the LIKE meta-characters at the repo layer, so callers can pass
// "image/" without worrying about `%` / `_` injection.
type ListByOwnerFilter struct {
	BucketID       string
	Visibility     string
	MimePrefix     string
	IncludeDeleted bool
}

// FilePatch is the patch envelope consumed by FileRepository.Patch.
// Pointer fields use the standard Go convention: nil = leave
// unchanged, non-nil = set to value (zero values welcome). For
// `expires_at` we cannot collapse "set to NULL" into the zero time
// (`time.Time{}` is itself a legal stamp), so the dedicated
// `ExpiresAtSet` flag carries the intent.
type FilePatch struct {
	Visibility    *string
	ChatSessionID *string
	BucketID      *string
	Filename      *string

	// ExpiresAtSet must be true for either a "set" or a "clear";
	// when true and ExpiresAt is nil, the column is set to NULL.
	// when false, the column is left alone.
	ExpiresAtSet bool
	ExpiresAt    *time.Time
}

// ErrFileNotFound is returned by repository methods that need to
// signal "no row exists" without exposing the underlying GORM
// sentinel. Callers branch on this rather than checking
// `errors.Is(err, gorm.ErrRecordNotFound)` so the abstraction
// stays portable across drivers.
var ErrFileNotFound = errors.New("oss: file not found")

// ErrFileAlreadyDeleted is returned by `MarkDeleted` when the row
// exists but is already in the soft-delete state. Distinct from
// ErrFileNotFound so the handler can map it to 410 Gone (idempotent
// re-DELETE) versus 404 (caller passed a key that never existed).
var ErrFileAlreadyDeleted = errors.New("oss: file already deleted")

type fileRepo struct {
	dbName string
}

func NewFileRepository(dbName string) FileRepository {
	return &fileRepo{dbName: dbName}
}

func (r *fileRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *fileRepo) Create(ctx context.Context, meta *ossmodel.FileMeta) error {
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return db.Create(meta).Error
}

func (r *fileRepo) FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var meta ossmodel.FileMeta
	err = db.Where("key = ? AND deleted_at IS NULL", key).
		Order("created_at ASC").
		First(&meta).Error
	return &meta, err
}

func (r *fileRepo) FindByOwnerKey(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var meta ossmodel.FileMeta
	err = db.Where("owner_actor_id = ? AND key = ? AND deleted_at IS NULL", owner, key).
		First(&meta).Error
	return &meta, err
}

func (r *fileRepo) FindByOwnerKeyIncludeDeleted(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var meta ossmodel.FileMeta
	err = db.Where("owner_actor_id = ? AND key = ?", owner, key).First(&meta).Error
	return &meta, err
}

func (r *fileRepo) MarkDeleted(ctx context.Context, id string, now time.Time) error {
	if id == "" {
		return errors.New("oss: file mark-deleted: id required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	// Single-row UPDATE with the `deleted_at IS NULL` predicate
	// inline so concurrent DELETEs serialise without a SELECT
	// round-trip. RowsAffected==0 means either the row is gone
	// or it is already deleted; we disambiguate with a follow-up
	// existence check that bypasses the soft-delete filter.
	res := db.Model(&ossmodel.FileMeta{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(map[string]any{
			"deleted_at": now,
			"updated_at": now,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 1 {
		return nil
	}
	// 0 rows: either missing or already-deleted. Branch via a
	// raw-find that ignores the soft-delete filter.
	var meta ossmodel.FileMeta
	if err := db.Where("id = ?", id).First(&meta).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrFileNotFound
		}
		return err
	}
	if meta.DeletedAt != nil {
		return ErrFileAlreadyDeleted
	}
	// Should not happen — row is live but UPDATE matched 0 rows.
	// Treat as a transient repo error.
	return errors.New("oss: file mark-deleted: zero rows affected on live row")
}

func (r *fileRepo) Restore(ctx context.Context, id string, now time.Time, newExpires *time.Time) error {
	if id == "" {
		return errors.New("oss: file restore: id required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	updates := map[string]any{
		"deleted_at": nil,
		"updated_at": now,
	}
	if newExpires != nil {
		// nil pointer would otherwise leave the column alone; a
		// non-nil pointer means "set to this value (which may be
		// the zero time, signalling NULL)".
		if newExpires.IsZero() {
			updates["expires_at"] = nil
		} else {
			updates["expires_at"] = *newExpires
		}
	}
	res := db.Model(&ossmodel.FileMeta{}).
		Where("id = ?", id).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrFileNotFound
	}
	return nil
}

func (r *fileRepo) Patch(ctx context.Context, id string, patch FilePatch, now time.Time) error {
	if id == "" {
		return errors.New("oss: file patch: id required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}

	updates := map[string]any{"updated_at": now}
	if patch.Visibility != nil {
		updates["visibility"] = *patch.Visibility
	}
	if patch.ChatSessionID != nil {
		updates["chat_session_id"] = *patch.ChatSessionID
	}
	if patch.BucketID != nil {
		updates["bucket_id"] = *patch.BucketID
	}
	if patch.Filename != nil {
		updates["name"] = *patch.Filename
	}
	if patch.ExpiresAtSet {
		if patch.ExpiresAt == nil {
			updates["expires_at"] = nil
		} else {
			updates["expires_at"] = *patch.ExpiresAt
		}
	}
	// If the only key is `updated_at` the caller passed an empty
	// patch — that is a programming error in the service layer,
	// but we still reject it here rather than silently bumping
	// the row's mtime.
	if len(updates) == 1 {
		return errors.New("oss: file patch: empty patch")
	}

	// Match only live rows so a PATCH on a tombstone is rejected
	// with ErrFileNotFound — the service layer translates this to
	// a clearer "patch on deleted file" error before bubbling up.
	res := db.Model(&ossmodel.FileMeta{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrFileNotFound
	}
	return nil
}

func (r *fileRepo) ListByOwner(ctx context.Context, owner string, filter ListByOwnerFilter, limit, offset int) ([]ossmodel.FileMeta, int64, error) {
	if owner == "" {
		return nil, 0, errors.New("oss: list-by-owner: owner required")
	}
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	db, err := r.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	q := db.Model(&ossmodel.FileMeta{}).Where("owner_actor_id = ?", owner)
	if !filter.IncludeDeleted {
		q = q.Where("deleted_at IS NULL")
	}
	if filter.BucketID != "" {
		q = q.Where("bucket_id = ?", filter.BucketID)
	}
	if filter.Visibility != "" {
		q = q.Where("visibility = ?", filter.Visibility)
	}
	if filter.MimePrefix != "" {
		// Escape LIKE meta-characters so a caller-supplied prefix
		// like "application/x_z" does not unintentionally match
		// any single character. Backslash is the standard SQL
		// escape; we declare it explicitly because some drivers
		// default it differently.
		esc := likeEscape(filter.MimePrefix)
		q = q.Where("mime LIKE ? ESCAPE '\\'", esc+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []ossmodel.FileMeta
	if err := q.
		Order("created_at DESC").
		Order("id DESC").
		Limit(limit).
		Offset(offset).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *fileRepo) ListExpired(ctx context.Context, now time.Time, limit int) ([]ossmodel.FileMeta, error) {
	if limit <= 0 {
		limit = 100
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []ossmodel.FileMeta
	err = db.Model(&ossmodel.FileMeta{}).
		Where("deleted_at IS NULL").
		Where("expires_at IS NOT NULL").
		Where("expires_at < ?", now).
		Order("expires_at ASC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

// likeEscape escapes the SQL LIKE meta-characters `%`, `_`, and the
// backslash itself so a caller-supplied prefix can be embedded in a
// LIKE pattern without introducing unintended wildcards. We use a
// backslash escape rather than a raw replacement so the escaped
// pattern survives parameterised binding unchanged.
func likeEscape(s string) string {
	if s == "" {
		return s
	}
	out := make([]byte, 0, len(s))
	for _, c := range []byte(s) {
		switch c {
		case '\\', '%', '_':
			out = append(out, '\\', c)
		default:
			out = append(out, c)
		}
	}
	return string(out)
}
