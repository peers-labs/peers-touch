package groupcall

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// Retries durable tombstones and closes authorization at Session expiry.
// This is not the normal revoke path: original permission mutations await
// ejection synchronously. A failed mutation/admission has an observable retry.
func (s *subServer) maintainGrants(ctx context.Context) error {
	now := time.Now().UTC()
	if err := s.revokeHome(ctx, s.db.Where(
		"side = ? AND (status = ? OR expires_at <= ?)", grantHome, grantRevoked, now)); err != nil {
		return err
	}
	var grants []endpointGrant
	if err := s.db.WithContext(ctx).Where(
		"side = ? AND ejected = false AND (status = ? OR expires_at <= ? OR status = ?)",
		grantAuthority, grantRevoked, now, grantAdmitting).Find(&grants).Error; err != nil {
		return err
	}
	for _, grant := range grants {
		// An in-progress admission owns its row lock. Do not retire it on a
		// periodic tick; only abandoned attempts older than the bounded join.
		if grant.Status == grantAdmitting && grant.ExpiresAt.After(now) &&
			grant.UpdatedAt.After(now.Add(-time.Minute)) {
			continue
		}
		if err := s.revokeAuthority(ctx, grant); err != nil {
			return err
		}
	}
	return nil
}

func (s *subServer) runGrantMaintenance(ctx context.Context) {
	defer close(s.maintenanceDone)
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			tick, cancel := context.WithTimeout(ctx, 15*time.Second)
			err := s.maintainGrants(tick)
			cancel()
			if err != nil && ctx.Err() == nil {
				logger.DefaultHelper.Warnf("groupcall: grant retirement retry failed: %v", err)
			}
		}
	}
}
