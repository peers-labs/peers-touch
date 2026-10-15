package worker

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const workerLeaseTTL = 30 * time.Second

var ErrStaleWorkerLease = errors.New("oss: worker lease authority is stale")

// DBLeaderLock coordinates the existing OSS Scheduler through shared
// PostgreSQL state. Database time owns expiry; node identity,
// incarnation, and the monotonic token fence every renewal and
// completion.
type DBLeaderLock struct {
	dbName      string
	nodePeerID  string
	incarnation string
	ttl         time.Duration
}

func NewDBLeaderLock(
	dbName string,
	nodePeerID string,
	incarnation string,
	ttl time.Duration,
) (*DBLeaderLock, error) {
	dbName = strings.TrimSpace(dbName)
	nodePeerID = strings.TrimSpace(nodePeerID)
	incarnation = strings.TrimSpace(incarnation)
	if dbName == "" || nodePeerID == "" || incarnation == "" {
		return nil, errors.New("oss: database worker lock requires db, node PeerID, and incarnation")
	}
	if ttl <= 0 {
		ttl = workerLeaseTTL
	}
	return &DBLeaderLock{
		dbName:      dbName,
		nodePeerID:  nodePeerID,
		incarnation: incarnation,
		ttl:         ttl,
	}, nil
}

func (l *DBLeaderLock) TryAcquire(
	ctx context.Context,
	name string,
) (*LeaseAuthority, func(), error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, func() {}, nil
	}
	db, err := l.getDB(ctx)
	if err != nil {
		return nil, func() {}, err
	}
	var authority *LeaseAuthority
	err = db.Transaction(func(tx *gorm.DB) error {
		now, err := workerDatabaseNow(tx)
		if err != nil {
			return err
		}
		var row ossmodel.WorkerLease
		findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("worker_name = ?", name).
			First(&row).Error
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			row = ossmodel.WorkerLease{
				WorkerName:       name,
				OwnerNodePeerID:  l.nodePeerID,
				OwnerIncarnation: l.incarnation,
				FencingToken:     1,
				Status:           ossmodel.WorkerLeaseStatusHeld,
				AcquiredAt:       now,
				HeartbeatAt:      now,
				ExpiresAt:        now.Add(l.ttl),
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			authority = leaseAuthorityFromRow(row)
			return nil
		}
		if findErr != nil {
			return findErr
		}
		if row.Status == ossmodel.WorkerLeaseStatusHeld && row.ExpiresAt.After(now) {
			return nil
		}
		if row.FencingToken == ^uint64(0) {
			return errors.New("oss: worker lease fencing token exhausted")
		}
		nextToken := row.FencingToken + 1
		expiresAt := now.Add(l.ttl)
		result := tx.Model(&ossmodel.WorkerLease{}).
			Where(
				"worker_name = ? AND fencing_token = ?",
				name,
				row.FencingToken,
			).
			Updates(map[string]any{
				"owner_node_peer_id": l.nodePeerID,
				"owner_incarnation":  l.incarnation,
				"fencing_token":      nextToken,
				"status":             ossmodel.WorkerLeaseStatusHeld,
				"acquired_at":        now,
				"heartbeat_at":       now,
				"expires_at":         expiresAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrStaleWorkerLease
		}
		authority = &LeaseAuthority{
			WorkerName:       name,
			OwnerNodePeerID:  l.nodePeerID,
			OwnerIncarnation: l.incarnation,
			FencingToken:     nextToken,
			ExpiresAt:        expiresAt,
		}
		return nil
	})
	if err != nil || authority == nil {
		return authority, func() {}, err
	}
	released := false
	release := func() {
		if released {
			return
		}
		released = true
		_ = l.release(context.Background(), *authority)
	}
	return authority, release, nil
}

func (l *DBLeaderLock) Renew(
	ctx context.Context,
	authority LeaseAuthority,
) (*LeaseAuthority, error) {
	db, err := l.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now, err := workerDatabaseNow(db)
	if err != nil {
		return nil, err
	}
	expiresAt := now.Add(l.ttl)
	result := db.Model(&ossmodel.WorkerLease{}).
		Where(
			"worker_name = ? AND owner_node_peer_id = ? AND owner_incarnation = ? AND fencing_token = ? AND status = ? AND expires_at > ?",
			authority.WorkerName,
			authority.OwnerNodePeerID,
			authority.OwnerIncarnation,
			authority.FencingToken,
			ossmodel.WorkerLeaseStatusHeld,
			now,
		).
		Updates(map[string]any{
			"heartbeat_at": now,
			"expires_at":   expiresAt,
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrStaleWorkerLease
	}
	authority.ExpiresAt = expiresAt
	return &authority, nil
}

func (l *DBLeaderLock) Validate(ctx context.Context, authority LeaseAuthority) error {
	db, err := l.getDB(ctx)
	if err != nil {
		return err
	}
	now, err := workerDatabaseNow(db)
	if err != nil {
		return err
	}
	var count int64
	if err := db.Model(&ossmodel.WorkerLease{}).
		Where(
			"worker_name = ? AND owner_node_peer_id = ? AND owner_incarnation = ? AND fencing_token = ? AND status = ? AND expires_at > ?",
			authority.WorkerName,
			authority.OwnerNodePeerID,
			authority.OwnerIncarnation,
			authority.FencingToken,
			ossmodel.WorkerLeaseStatusHeld,
			now,
		).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrStaleWorkerLease
	}
	return nil
}

func (l *DBLeaderLock) release(ctx context.Context, authority LeaseAuthority) error {
	db, err := l.getDB(ctx)
	if err != nil {
		return err
	}
	now, err := workerDatabaseNow(db)
	if err != nil {
		return err
	}
	result := db.Model(&ossmodel.WorkerLease{}).
		Where(
			"worker_name = ? AND owner_node_peer_id = ? AND owner_incarnation = ? AND fencing_token = ? AND status = ?",
			authority.WorkerName,
			authority.OwnerNodePeerID,
			authority.OwnerIncarnation,
			authority.FencingToken,
			ossmodel.WorkerLeaseStatusHeld,
		).
		Updates(map[string]any{
			"status":       ossmodel.WorkerLeaseStatusReleased,
			"heartbeat_at": now,
			"expires_at":   now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrStaleWorkerLease
	}
	return nil
}

func (l *DBLeaderLock) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(l.dbName))
	if err != nil {
		return nil, fmt.Errorf("oss: worker lock database %q: %w", l.dbName, err)
	}
	return db.WithContext(ctx), nil
}

func workerDatabaseNow(db *gorm.DB) (time.Time, error) {
	var row struct {
		UnixSeconds int64
	}
	query := "SELECT CAST(FLOOR(EXTRACT(EPOCH FROM clock_timestamp())) AS BIGINT) AS unix_seconds"
	if db.Dialector.Name() == "sqlite" {
		query = "SELECT CAST(strftime('%s', 'now') AS INTEGER) AS unix_seconds"
	}
	if err := db.Raw(query).Scan(&row).Error; err != nil {
		return time.Time{}, fmt.Errorf("oss: read worker database clock: %w", err)
	}
	if row.UnixSeconds <= 0 {
		return time.Time{}, errors.New("oss: worker database clock returned zero time")
	}
	return time.Unix(row.UnixSeconds, 0).UTC(), nil
}

func leaseAuthorityFromRow(row ossmodel.WorkerLease) *LeaseAuthority {
	return &LeaseAuthority{
		WorkerName:       row.WorkerName,
		OwnerNodePeerID:  row.OwnerNodePeerID,
		OwnerIncarnation: row.OwnerIncarnation,
		FencingToken:     row.FencingToken,
		ExpiresAt:        row.ExpiresAt,
	}
}
