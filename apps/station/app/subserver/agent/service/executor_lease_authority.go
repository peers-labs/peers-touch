package service

import (
	"fmt"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

const (
	executorLeaseStatusActive   = "active"
	executorLeaseStatusReleased = "released"
	executorLeaseStatusExpired  = "expired"
)

func executorLeaseDatabaseNow(tx *gorm.DB) (time.Time, error) {
	var row struct {
		UnixSeconds int64
	}
	query := "SELECT CAST(FLOOR(EXTRACT(EPOCH FROM clock_timestamp())) AS BIGINT) AS unix_seconds"
	if tx.Dialector.Name() == "sqlite" {
		query = "SELECT CAST(strftime('%s', 'now') AS INTEGER) AS unix_seconds"
	}
	if err := tx.Raw(query).Scan(&row).Error; err != nil {
		return time.Time{}, fmt.Errorf("read database clock: %w", err)
	}
	if row.UnixSeconds <= 0 {
		return time.Time{}, fmt.Errorf("database clock returned zero time")
	}
	return time.Unix(row.UnixSeconds, 0).UTC(), nil
}

func assertCurrentExecutorLeaseTx(
	tx *gorm.DB,
	lease *persistence.ExecutorLease,
	now time.Time,
) error {
	if lease == nil ||
		lease.FencingToken == 0 ||
		lease.OwnerNodePeerID == "" ||
		lease.OwnerIncarnation == "" ||
		lease.Status != executorLeaseStatusActive ||
		!lease.ExpiresAt.After(now) {
		return staleExecutorLeaseError()
	}
	var newerCount int64
	if err := tx.Model(&persistence.ExecutorLease{}).
		Where(
			"task_id = ? AND step_id = ? AND fencing_token > ?",
			lease.TaskID,
			lease.StepID,
			lease.FencingToken,
		).
		Count(&newerCount).Error; err != nil {
		return err
	}
	if newerCount != 0 {
		return staleExecutorLeaseError()
	}
	return nil
}

func renewCurrentExecutorLeaseTx(
	tx *gorm.DB,
	lease *persistence.ExecutorLease,
	now time.Time,
	ttl time.Duration,
) error {
	if err := assertCurrentExecutorLeaseTx(tx, lease, now); err != nil {
		return err
	}
	expiresAt := now.Add(ttl)
	if err := mutateCurrentExecutorLeaseTx(
		tx,
		lease,
		now,
		map[string]interface{}{
			"heartbeat_at": now,
			"expires_at":   expiresAt,
		},
	); err != nil {
		return err
	}
	lease.HeartbeatAt = now
	lease.ExpiresAt = expiresAt
	return nil
}

func releaseCurrentExecutorLeaseTx(
	tx *gorm.DB,
	lease *persistence.ExecutorLease,
	now time.Time,
) error {
	if err := assertCurrentExecutorLeaseTx(tx, lease, now); err != nil {
		return err
	}
	if err := mutateCurrentExecutorLeaseTx(
		tx,
		lease,
		now,
		map[string]interface{}{
			"status":       executorLeaseStatusReleased,
			"heartbeat_at": now,
		},
	); err != nil {
		return err
	}
	lease.Status = executorLeaseStatusReleased
	lease.HeartbeatAt = now
	return nil
}

func mutateCurrentExecutorLeaseTx(
	tx *gorm.DB,
	lease *persistence.ExecutorLease,
	now time.Time,
	updates map[string]interface{},
) error {
	result := tx.Model(&persistence.ExecutorLease{}).
		Where(
			"lease_id = ? AND task_id = ? AND step_id = ? AND executor_id = ? AND owner_node_peer_id = ? AND owner_incarnation = ? AND fencing_token = ? AND status = ? AND expires_at > ?",
			lease.LeaseID,
			lease.TaskID,
			lease.StepID,
			lease.ExecutorID,
			lease.OwnerNodePeerID,
			lease.OwnerIncarnation,
			lease.FencingToken,
			executorLeaseStatusActive,
			now,
		).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return staleExecutorLeaseError()
	}
	return nil
}

func expireExecutorLeaseTx(
	tx *gorm.DB,
	lease *persistence.ExecutorLease,
	now time.Time,
) error {
	if lease == nil {
		return staleExecutorLeaseError()
	}
	result := tx.Model(&persistence.ExecutorLease{}).
		Where(
			"lease_id = ? AND status = ? AND fencing_token = ?",
			lease.LeaseID,
			executorLeaseStatusActive,
			lease.FencingToken,
		).
		Updates(map[string]interface{}{
			"status":       executorLeaseStatusExpired,
			"heartbeat_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return staleExecutorLeaseError()
	}
	lease.Status = executorLeaseStatusExpired
	lease.HeartbeatAt = now
	return nil
}

func staleExecutorLeaseError() error {
	return errcode.New(
		errcode.AgentVersionConflict,
		http.StatusConflict,
		"executor lease authority is stale",
		nil,
	)
}
