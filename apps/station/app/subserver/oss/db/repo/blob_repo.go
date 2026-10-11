package repo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// BlobRepository is the persistence boundary for `oss_blobs`. It is
// the source of truth for "is anyone still pointing at these bytes?"
// — the upload writer increments on claim creation, the lifecycle
// path (DELETE / TTL sweep / admin_delete) decrements, and the
// `BlobGC` worker physically removes rows where `RefCount == 0`
// after the configured grace window.
//
// Reference commits and releases use conditional updates under the
// generation row lock, so concurrent uploads cannot attach to a
// deleting generation or drift the counter.
//
// `Get` and `ListGCCandidates` are the read primitives the GC worker
// uses; they live on the repository (rather than as ad-hoc queries
// inside the worker) so they can be stubbed in unit tests without
// standing up a SQLite database.
type BlobRepository interface {
	// StageWrite resolves one immutable physical generation before
	// bytes move. Existing live bytes are reused without a write.
	// A generation already claimed by GC is replaced by a new
	// StorageKey, so a paused stale delete cannot target it.
	StageWrite(ctx context.Context, backend, key string, size int64, sha256 string) (*BlobWrite, error)

	// CommitWrite publishes one reference only when the staged
	// generation is still current.
	CommitWrite(ctx context.Context, write BlobWrite) (*ossmodel.Blob, error)

	// Release decrements the counter, with a positive predicate so
	// it cannot go negative. Returns the new RefCount and a flag
	// indicating whether the row dropped to zero (so the caller can
	// short-circuit `backend.Delete` synchronously when the grace
	// window is zero / a test forces immediate cleanup).
	//
	// Returns ErrBlobNotFound if no row exists; callers (the
	// lifecycle path) should treat this as an audit anomaly rather
	// than a fatal error.
	Release(ctx context.Context, backend, key string) (refCount int64, droppedToZero bool, err error)

	// Get returns the row, or (nil, nil) when absent. The blob GC
	// worker uses it to confirm a row before issuing a physical
	// delete; the reconciler uses it to compare counters.
	Get(ctx context.Context, backend, key string) (*ossmodel.Blob, error)

	// ListGCCandidates returns rows where `RefCount = 0` and
	// `LastSeenAt < olderThan`, ordered by `LastSeenAt ASC` so the
	// worker drains the oldest first. The `limit` argument bounds
	// the worker's batch size to avoid a runaway DELETE on a backlog.
	ListGCCandidates(ctx context.Context, olderThan time.Time, limit int) ([]ossmodel.Blob, error)

	// ClaimGC atomically revalidates zero references and binds the
	// immutable generation to the current worker fencing authority.
	ClaimGC(ctx context.Context, candidate ossmodel.Blob, olderThan time.Time, authority BlobGCAuthority) (*BlobGCClaim, error)

	// CompleteGC removes metadata only for the exact generation and
	// authority that performed the physical delete.
	CompleteGC(ctx context.Context, claim BlobGCClaim) error

	// ResolveStorageKey maps the public logical key to the current
	// immutable backend key. Only a live generation is readable.
	ResolveStorageKey(ctx context.Context, backend, key string) (string, error)
}

// ErrBlobNotFound is returned by `Release` when the (backend, key)
// row is absent. Callers should record an audit row with
// `outcome=error, reason=blob_missing` rather than propagating.
var ErrBlobNotFound = errors.New("oss: blob: not found")

var (
	ErrBlobWriteInProgress = errors.New("oss: blob generation write is in progress")
	ErrBlobGenerationStale = errors.New("oss: blob generation is stale")
	ErrBlobGCClaimStale    = errors.New("oss: blob gc claim is stale")
)

type BlobWrite struct {
	Backend       string
	Key           string
	Generation    uint64
	StorageKey    string
	Size          int64
	Sha256        string
	RequiresWrite bool
}

type BlobGCAuthority struct {
	WorkerName       string
	OwnerNodePeerID  string
	OwnerIncarnation string
	FencingToken     uint64
}

type BlobGCClaim struct {
	Backend          string
	Key              string
	Generation       uint64
	StorageKey       string
	Size             int64
	WorkerName       string
	OwnerNodePeerID  string
	OwnerIncarnation string
	FencingToken     uint64
}

type blobRepo struct {
	dbName string
	clock  func() time.Time
}

// NewBlobRepository wires the repo to its named gorm DB.
func NewBlobRepository(dbName string) BlobRepository {
	return &blobRepo{dbName: dbName, clock: time.Now}
}

func (r *blobRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *blobRepo) StageWrite(ctx context.Context, backend, key string, size int64, digest string) (*BlobWrite, error) {
	if backend == "" || key == "" {
		return nil, errors.New("oss: blob stage write: backend and key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := r.clock()
	var staged BlobWrite
	err = db.Transaction(func(tx *gorm.DB) error {
		var row ossmodel.Blob
		findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("backend = ? AND key = ?", backend, key).
			First(&row).Error
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			fresh := ossmodel.Blob{
				Backend:        backend,
				Key:            key,
				Size:           size,
				Sha256:         digest,
				Generation:     1,
				StorageKey:     key,
				LifecycleState: ossmodel.BlobLifecycleWriting,
				RefCount:       0,
				LastSeenAt:     now,
				CreatedAt:      now,
			}
			if err := tx.Create(&fresh).Error; err != nil {
				return err
			}
			staged = blobWriteFromRow(fresh, true)
			return nil
		}
		if findErr != nil {
			return findErr
		}
		normalizeBlobGeneration(&row)
		switch row.LifecycleState {
		case ossmodel.BlobLifecycleLive:
			if row.Size != size || (row.Sha256 != "" && digest != "" && row.Sha256 != digest) {
				return fmt.Errorf("oss: blob identity mismatch for %s/%s", backend, key)
			}
			staged = blobWriteFromRow(row, false)
			return nil
		case ossmodel.BlobLifecycleWriting:
			if row.Size != size || (row.Sha256 != "" && digest != "" && row.Sha256 != digest) {
				return fmt.Errorf("oss: blob identity mismatch for %s/%s", backend, key)
			}
			staged = blobWriteFromRow(row, true)
			return nil
		case ossmodel.BlobLifecycleDeleting:
			if row.Generation == ^uint64(0) {
				return errors.New("oss: blob generation exhausted")
			}
			nextGeneration := row.Generation + 1
			nextStorageKey := immutableGenerationKey(key, nextGeneration)
			result := tx.Model(&ossmodel.Blob{}).
				Where(
					"backend = ? AND key = ? AND generation = ? AND lifecycle_state = ?",
					backend,
					key,
					row.Generation,
					ossmodel.BlobLifecycleDeleting,
				).
				Updates(map[string]any{
					"generation":                  nextGeneration,
					"storage_key":                 nextStorageKey,
					"size":                        size,
					"sha256":                      digest,
					"lifecycle_state":             ossmodel.BlobLifecycleWriting,
					"ref_count":                   0,
					"last_seen_at":                now,
					"gc_claim_worker_name":        "",
					"gc_claim_owner_node_peer_id": "",
					"gc_claim_owner_incarnation":  "",
					"gc_claim_fencing_token":      0,
					"gc_claimed_at":               nil,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrBlobGenerationStale
			}
			row.Generation = nextGeneration
			row.StorageKey = nextStorageKey
			row.Size = size
			row.Sha256 = digest
			row.LifecycleState = ossmodel.BlobLifecycleWriting
			row.RefCount = 0
			staged = blobWriteFromRow(row, true)
			return nil
		default:
			return fmt.Errorf("oss: unknown blob lifecycle state %q", row.LifecycleState)
		}
	})
	if err != nil {
		return nil, err
	}
	return &staged, nil
}

func (r *blobRepo) CommitWrite(ctx context.Context, write BlobWrite) (*ossmodel.Blob, error) {
	if write.Backend == "" || write.Key == "" || write.Generation == 0 || write.StorageKey == "" {
		return nil, errors.New("oss: blob commit write: complete generation identity required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := r.clock()
	var row ossmodel.Blob
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("backend = ? AND key = ?", write.Backend, write.Key).
			First(&row).Error; err != nil {
			return err
		}
		normalizeBlobGeneration(&row)
		if row.Generation != write.Generation ||
			row.StorageKey != write.StorageKey ||
			row.Size != write.Size ||
			(row.Sha256 != "" && write.Sha256 != "" && row.Sha256 != write.Sha256) ||
			(row.LifecycleState != ossmodel.BlobLifecycleWriting &&
				row.LifecycleState != ossmodel.BlobLifecycleLive) {
			return ErrBlobGenerationStale
		}
		result := tx.Model(&ossmodel.Blob{}).
			Where(
				"backend = ? AND key = ? AND generation = ? AND storage_key = ? AND lifecycle_state IN ?",
				write.Backend,
				write.Key,
				write.Generation,
				write.StorageKey,
				[]string{ossmodel.BlobLifecycleWriting, ossmodel.BlobLifecycleLive},
			).
			Updates(map[string]any{
				"lifecycle_state": ossmodel.BlobLifecycleLive,
				"ref_count":       gorm.Expr("ref_count + 1"),
				"last_seen_at":    now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBlobGenerationStale
		}
		return tx.Where("backend = ? AND key = ?", write.Backend, write.Key).
			First(&row).Error
	})
	if err != nil {
		return nil, err
	}
	normalizeBlobGeneration(&row)
	return &row, nil
}

func (r *blobRepo) Release(ctx context.Context, backend, key string) (int64, bool, error) {
	if backend == "" || key == "" {
		return 0, false, errors.New("oss: blob release: backend and key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return 0, false, err
	}

	var newCount int64
	var droppedToZero bool
	err = db.Transaction(func(tx *gorm.DB) error {
		// Positive predicate is the safety belt: a buggy caller
		// double-releasing cannot push the counter below zero.
		res := tx.Model(&ossmodel.Blob{}).
			Where(
				"backend = ? AND key = ? AND ref_count > 0 AND lifecycle_state IN ?",
				backend,
				key,
				[]string{"", ossmodel.BlobLifecycleLive},
			).
			Updates(map[string]any{
				"ref_count": gorm.Expr("ref_count - 1"),
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// Two cases: no row, or row at zero already. Disambiguate.
			var probe ossmodel.Blob
			err := tx.Where("backend = ? AND key = ?", backend, key).First(&probe).Error
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrBlobNotFound
				}
				return err
			}
			// Row exists with ref_count == 0 — caller is double-
			// releasing. We surface this as a benign zero result
			// rather than an error so the lifecycle path stays
			// idempotent on retries.
			newCount = 0
			droppedToZero = false
			return nil
		}
		var row ossmodel.Blob
		if err := tx.Where("backend = ? AND key = ?", backend, key).First(&row).Error; err != nil {
			return err
		}
		newCount = row.RefCount
		droppedToZero = row.RefCount == 0
		return nil
	})
	if err != nil {
		return 0, false, err
	}
	return newCount, droppedToZero, nil
}

func (r *blobRepo) Get(ctx context.Context, backend, key string) (*ossmodel.Blob, error) {
	if backend == "" || key == "" {
		return nil, errors.New("oss: blob get: backend and key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row ossmodel.Blob
	err = db.Where("backend = ? AND key = ?", backend, key).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	normalizeBlobGeneration(&row)
	return &row, nil
}

func (r *blobRepo) ListGCCandidates(ctx context.Context, olderThan time.Time, limit int) ([]ossmodel.Blob, error) {
	if limit <= 0 {
		limit = 100
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []ossmodel.Blob
	if err := db.Where(
		"ref_count = 0 AND last_seen_at < ? AND lifecycle_state IN ?",
		olderThan,
		[]string{"", ossmodel.BlobLifecycleLive, ossmodel.BlobLifecycleWriting},
	).
		Order("last_seen_at ASC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for index := range rows {
		normalizeBlobGeneration(&rows[index])
	}
	remaining := limit - len(rows)
	if remaining <= 0 {
		return rows, nil
	}
	var generations []ossmodel.BlobGCGeneration
	if err := db.Where("last_seen_at < ?", olderThan).
		Order("last_seen_at ASC").
		Limit(remaining).
		Find(&generations).Error; err != nil {
		return nil, err
	}
	for _, generation := range generations {
		rows = append(rows, ossmodel.Blob{
			Backend:        generation.Backend,
			Key:            generation.Key,
			Size:           generation.Size,
			Generation:     generation.Generation,
			StorageKey:     generation.StorageKey,
			LifecycleState: ossmodel.BlobLifecycleDeleting,
			RefCount:       0,
			LastSeenAt:     generation.LastSeenAt,
		})
	}
	return rows, nil
}

func (r *blobRepo) ClaimGC(
	ctx context.Context,
	candidate ossmodel.Blob,
	olderThan time.Time,
	authority BlobGCAuthority,
) (*BlobGCClaim, error) {
	if candidate.Backend == "" || candidate.Key == "" || candidate.Generation == 0 {
		return nil, errors.New("oss: blob gc claim: generation identity required")
	}
	if authority.OwnerNodePeerID == "" ||
		authority.WorkerName == "" ||
		authority.OwnerIncarnation == "" ||
		authority.FencingToken == 0 {
		return nil, errors.New("oss: blob gc claim: fenced worker authority required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var claim BlobGCClaim
	err = db.Transaction(func(tx *gorm.DB) error {
		now, err := blobDatabaseNow(tx)
		if err != nil {
			return err
		}
		var activeLeaseCount int64
		if err := tx.Model(&ossmodel.WorkerLease{}).
			Where(
				"worker_name = ? AND owner_node_peer_id = ? AND owner_incarnation = ? AND fencing_token = ? AND status = ? AND expires_at > ?",
				authority.WorkerName,
				authority.OwnerNodePeerID,
				authority.OwnerIncarnation,
				authority.FencingToken,
				ossmodel.WorkerLeaseStatusHeld,
				now,
			).
			Count(&activeLeaseCount).Error; err != nil {
			return err
		}
		if activeLeaseCount != 1 {
			return ErrBlobGCClaimStale
		}
		var row ossmodel.Blob
		rowErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("backend = ? AND key = ?", candidate.Backend, candidate.Key).
			First(&row).Error
		if rowErr != nil && !errors.Is(rowErr, gorm.ErrRecordNotFound) {
			return rowErr
		}

		var generation ossmodel.BlobGCGeneration
		if rowErr == nil {
			normalizeBlobGeneration(&row)
		}
		if rowErr == nil &&
			row.Generation == candidate.Generation &&
			row.RefCount == 0 &&
			(row.LifecycleState == ossmodel.BlobLifecycleLive ||
				row.LifecycleState == ossmodel.BlobLifecycleWriting ||
				row.LifecycleState == ossmodel.BlobLifecycleDeleting) &&
			row.LastSeenAt.Before(olderThan) {
			generation = ossmodel.BlobGCGeneration{
				Backend:               row.Backend,
				Key:                   row.Key,
				Generation:            row.Generation,
				StorageKey:            row.StorageKey,
				Size:                  row.Size,
				LastSeenAt:            row.LastSeenAt,
				ClaimWorkerName:       authority.WorkerName,
				ClaimOwnerNodePeerID:  authority.OwnerNodePeerID,
				ClaimOwnerIncarnation: authority.OwnerIncarnation,
				ClaimFencingToken:     authority.FencingToken,
				ClaimedAt:             now,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{
					{Name: "backend"},
					{Name: "key"},
					{Name: "generation"},
				},
				DoUpdates: clause.AssignmentColumns([]string{
					"claim_worker_name",
					"claim_owner_node_peer_id",
					"claim_owner_incarnation",
					"claim_fencing_token",
					"claimed_at",
				}),
			}).Create(&generation).Error; err != nil {
				return err
			}
			result := tx.Model(&ossmodel.Blob{}).
				Where(
					"backend = ? AND key = ? AND generation = ? AND ref_count = 0 AND lifecycle_state IN ? AND last_seen_at < ?",
					row.Backend,
					row.Key,
					row.Generation,
					[]string{
						ossmodel.BlobLifecycleLive,
						ossmodel.BlobLifecycleWriting,
						ossmodel.BlobLifecycleDeleting,
					},
					olderThan,
				).
				Updates(map[string]any{
					"lifecycle_state":             ossmodel.BlobLifecycleDeleting,
					"gc_claim_worker_name":        authority.WorkerName,
					"gc_claim_owner_node_peer_id": authority.OwnerNodePeerID,
					"gc_claim_owner_incarnation":  authority.OwnerIncarnation,
					"gc_claim_fencing_token":      authority.FencingToken,
					"gc_claimed_at":               now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrBlobGCClaimStale
			}
		} else {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where(
					"backend = ? AND key = ? AND generation = ? AND storage_key = ? AND last_seen_at < ?",
					candidate.Backend,
					candidate.Key,
					candidate.Generation,
					candidate.StorageKey,
					olderThan,
				).
				First(&generation).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrBlobGCClaimStale
				}
				return err
			}
			result := tx.Model(&ossmodel.BlobGCGeneration{}).
				Where(
					"backend = ? AND key = ? AND generation = ? AND storage_key = ?",
					generation.Backend,
					generation.Key,
					generation.Generation,
					generation.StorageKey,
				).
				Updates(map[string]any{
					"claim_worker_name":        authority.WorkerName,
					"claim_owner_node_peer_id": authority.OwnerNodePeerID,
					"claim_owner_incarnation":  authority.OwnerIncarnation,
					"claim_fencing_token":      authority.FencingToken,
					"claimed_at":               now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrBlobGCClaimStale
			}
		}
		claim = BlobGCClaim{
			Backend:          generation.Backend,
			Key:              generation.Key,
			Generation:       generation.Generation,
			StorageKey:       generation.StorageKey,
			Size:             generation.Size,
			WorkerName:       authority.WorkerName,
			OwnerNodePeerID:  authority.OwnerNodePeerID,
			OwnerIncarnation: authority.OwnerIncarnation,
			FencingToken:     authority.FencingToken,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &claim, nil
}

func (r *blobRepo) CompleteGC(ctx context.Context, claim BlobGCClaim) error {
	if claim.Backend == "" ||
		claim.Key == "" ||
		claim.Generation == 0 ||
		claim.StorageKey == "" ||
		claim.WorkerName == "" ||
		claim.OwnerNodePeerID == "" ||
		claim.OwnerIncarnation == "" ||
		claim.FencingToken == 0 {
		return errors.New("oss: blob gc complete: complete claim identity required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	staleCurrentGeneration := false
	err = db.Transaction(func(tx *gorm.DB) error {
		now, err := blobDatabaseNow(tx)
		if err != nil {
			return err
		}
		var activeLeaseCount int64
		if err := tx.Model(&ossmodel.WorkerLease{}).
			Where(
				"worker_name = ? AND owner_node_peer_id = ? AND owner_incarnation = ? AND fencing_token = ? AND status = ? AND expires_at > ?",
				claim.WorkerName,
				claim.OwnerNodePeerID,
				claim.OwnerIncarnation,
				claim.FencingToken,
				ossmodel.WorkerLeaseStatusHeld,
				now,
			).
			Count(&activeLeaseCount).Error; err != nil {
			return err
		}
		if activeLeaseCount != 1 {
			return ErrBlobGCClaimStale
		}
		result := tx.Where(
			"backend = ? AND key = ? AND generation = ? AND storage_key = ? AND claim_worker_name = ? AND claim_owner_node_peer_id = ? AND claim_owner_incarnation = ? AND claim_fencing_token = ?",
			claim.Backend,
			claim.Key,
			claim.Generation,
			claim.StorageKey,
			claim.WorkerName,
			claim.OwnerNodePeerID,
			claim.OwnerIncarnation,
			claim.FencingToken,
		).Delete(&ossmodel.BlobGCGeneration{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBlobGCClaimStale
		}
		currentDelete := tx.Where(
			"backend = ? AND key = ? AND generation = ? AND storage_key = ? AND ref_count = 0 AND lifecycle_state = ? AND gc_claim_worker_name = ? AND gc_claim_owner_node_peer_id = ? AND gc_claim_owner_incarnation = ? AND gc_claim_fencing_token = ?",
			claim.Backend,
			claim.Key,
			claim.Generation,
			claim.StorageKey,
			ossmodel.BlobLifecycleDeleting,
			claim.WorkerName,
			claim.OwnerNodePeerID,
			claim.OwnerIncarnation,
			claim.FencingToken,
		).Delete(&ossmodel.Blob{})
		if currentDelete.Error != nil {
			return currentDelete.Error
		}
		staleCurrentGeneration = currentDelete.RowsAffected != 1
		return nil
	})
	if err != nil {
		return err
	}
	if staleCurrentGeneration {
		return ErrBlobGCClaimStale
	}
	return nil
}

func (r *blobRepo) ResolveStorageKey(ctx context.Context, backend, key string) (string, error) {
	row, err := r.Get(ctx, backend, key)
	if err != nil {
		return "", err
	}
	if row == nil {
		return "", ErrBlobNotFound
	}
	if row.LifecycleState != ossmodel.BlobLifecycleLive {
		return "", ErrBlobWriteInProgress
	}
	return row.StorageKey, nil
}

func blobWriteFromRow(row ossmodel.Blob, requiresWrite bool) BlobWrite {
	normalizeBlobGeneration(&row)
	return BlobWrite{
		Backend:       row.Backend,
		Key:           row.Key,
		Generation:    row.Generation,
		StorageKey:    row.StorageKey,
		Size:          row.Size,
		Sha256:        row.Sha256,
		RequiresWrite: requiresWrite,
	}
}

func normalizeBlobGeneration(row *ossmodel.Blob) {
	if row.Generation == 0 {
		row.Generation = 1
	}
	if row.StorageKey == "" {
		row.StorageKey = row.Key
	}
	if row.LifecycleState == "" {
		row.LifecycleState = ossmodel.BlobLifecycleLive
	}
}

func immutableGenerationKey(logicalKey string, generation uint64) string {
	sum := sha256.Sum256([]byte(logicalKey))
	return "__pt_generations/" +
		hex.EncodeToString(sum[:]) +
		"/" +
		strconv.FormatUint(generation, 10)
}

func blobDatabaseNow(db *gorm.DB) (time.Time, error) {
	var row struct {
		UnixSeconds int64
	}
	query := "SELECT CAST(FLOOR(EXTRACT(EPOCH FROM clock_timestamp())) AS BIGINT) AS unix_seconds"
	if db.Dialector.Name() == "sqlite" {
		query = "SELECT CAST(strftime('%s', 'now') AS INTEGER) AS unix_seconds"
	}
	if err := db.Raw(query).Scan(&row).Error; err != nil {
		return time.Time{}, fmt.Errorf("oss: read database clock: %w", err)
	}
	if row.UnixSeconds <= 0 {
		return time.Time{}, errors.New("oss: database clock returned zero time")
	}
	return time.Unix(row.UnixSeconds, 0).UTC(), nil
}
