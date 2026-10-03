package accessgate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	touchauth "github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func accessGateSessionDeviceType(platform string) (session.DeviceType, error) {
	switch strings.TrimSpace(platform) {
	case string(session.DeviceTypeDesktop):
		return session.DeviceTypeDesktop, nil
	case string(session.DeviceTypeMobile):
		return session.DeviceTypeMobile, nil
	case string(session.DeviceTypeWeb):
		return session.DeviceTypeWeb, nil
	default:
		return "", fmt.Errorf("unsupported Access Gate client platform %q", platform)
	}
}

func revokeReplacedAccessGateSessions(
	tx *gorm.DB,
	userID uint64,
	deviceID, currentSessionID string,
	now time.Time,
) error {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return errors.New("cannot replace Access Gate session without device id")
	}
	return tx.Model(&session.SessionRecord{}).
		Where(
			"user_id = ? AND device_id = ? AND session_id <> ? AND revoked = ?",
			userID,
			deviceID,
			currentSessionID,
			false,
		).
		Updates(map[string]any{
			"revoked":        true,
			"revoked_at":     now,
			"revoked_reason": "kicked",
		}).Error
}

// FinalizeGrantedSession is the sole password/generic Access Gate credential
// finalizer. It creates at most one session for a granted attempt, replaces an
// older session only for the same canonical device, and reissues credentials
// for that same session on an idempotent retry.
func FinalizeGrantedSession(
	ctx context.Context,
	attemptID, stationPeerID, deviceID string,
	lifecycleGeneration uint64,
	clientIP, userAgent string,
) (*model.LoginResponse, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	var response *model.LoginResponse
	err = rds.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var attempt dbmodel.AccessAttempt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", attemptID).
			First(&attempt).Error; err != nil {
			return err
		}
		if attempt.Status != attemptStatusGranted ||
			strings.TrimSpace(attempt.ActorPTID) == "" ||
			attempt.StationPeerID != stationPeerID ||
			attempt.DeviceID != deviceID ||
			attempt.LifecycleGeneration != lifecycleGeneration {
			return errors.New("access gate attempt is not ready for session finalization")
		}
		if attempt.AuthMethod != "password" {
			return nil
		}
		deviceType, err := accessGateSessionDeviceType(attempt.Platform)
		if err != nil {
			return err
		}

		var actor dbmodel.Actor
		if err := tx.Where("ptid = ?", attempt.ActorPTID).First(&actor).Error; err != nil {
			return fmt.Errorf("load Access Gate actor: %w", err)
		}

		if attempt.SessionID != "" {
			var record session.SessionRecord
			if err := tx.Where("session_id = ?", attempt.SessionID).First(&record).Error; err != nil {
				return fmt.Errorf("load finalized Access Gate session: %w", err)
			}
			if record.AccessAttemptID != attempt.ID ||
				record.StationPeerID != attempt.StationPeerID ||
				record.AccessDecisionRevision != attempt.DecisionRevision ||
				record.DeviceType != deviceType ||
				record.DeviceID != attempt.DeviceID ||
				record.LifecycleGeneration != attempt.LifecycleGeneration ||
				record.AuthMethod != "access_gate" {
				return errors.New("finalized Access Gate session binding mismatch")
			}
			response, err = touchauth.ResumeAccessGateSession(ctx, &actor, &record)
			return err
		}

		record, credential, err := touchauth.PrepareAccessGateSession(
			ctx,
			&actor,
			touchauth.AccessGateSessionBinding{
				AccessAttemptID:        attempt.ID,
				StationPeerID:          attempt.StationPeerID,
				AccessDecisionRevision: attempt.DecisionRevision,
				DeviceType:             deviceType,
				DeviceID:               attempt.DeviceID,
				LifecycleGeneration:    attempt.LifecycleGeneration,
			},
			clientIP,
			userAgent,
			time.Now().UTC(),
		)
		if err != nil {
			return err
		}

		now := time.Now().UTC()
		if err := revokeReplacedAccessGateSessions(
			tx, actor.ID, attempt.DeviceID, record.SessionID, now,
		); err != nil {
			return err
		}
		if err := tx.Create(record).Error; err != nil {
			return fmt.Errorf("persist Access Gate session: %w", err)
		}
		result := tx.Model(&dbmodel.AccessAttempt{}).
			Where(
				"id = ? AND status = ? AND session_id = ? AND decision_revision = ?",
				attempt.ID,
				attemptStatusGranted,
				"",
				attempt.DecisionRevision,
			).
			Update("session_id", record.SessionID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("Access Gate session finalization lost its attempt fence")
		}
		response = credential
		return nil
	})
	return response, err
}

// MarkGrantedActorOnline updates the shared Actor presence only after the
// Station finalizer has committed the session.
func MarkGrantedActorOnline(
	ctx context.Context,
	response *model.LoginResponse,
	userAgent string,
) {
	ptid := strings.TrimSpace(response.GetActorRef().GetPtid())
	if ptid == "" {
		return
	}
	actor, err := touchactor.GetActorByPTID(ctx, ptid)
	if err == nil && actor != nil {
		_ = touchactor.UpdateActorStatus(ctx, actor.ID, dbmodel.ActorStatusOnline, userAgent)
	}
}
