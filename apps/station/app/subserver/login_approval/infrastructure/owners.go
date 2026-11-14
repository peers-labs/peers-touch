// Package infrastructure adapts the login approval ports to the existing
// Access, Session and Actor Identity owners. It holds no business state of its
// own and never opens a second source of truth.
package infrastructure

import (
	"context"
	"time"

	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/login_approval/application"
	link "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/domain"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/loginapproval"
	"gorm.io/gorm"
)

// AttemptOwner resolves a credential-passed Access attempt into the Actor
// binding required to open a login approval transaction.
type AttemptOwner struct{}

func (AttemptOwner) ResolveCredentialAttempt(ctx context.Context, tx *gorm.DB, attemptID string,
	revision uint64, claimantDeviceID string) (*application.AttemptBinding, error) {
	var attempt db.AccessAttempt
	if err := tx.WithContext(ctx).Where("id = ?", attemptID).First(&attempt).Error; err != nil {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNAUTHORIZED_ATTEMPT)
	}
	if attempt.DecisionRevision != revision || attempt.DeviceID != claimantDeviceID ||
		isTerminal(attempt.Status) || !attempt.ExpiresAt.After(time.Now().UTC()) {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNAUTHORIZED_ATTEMPT)
	}
	// A bound Actor means the AUTH_LOGIN credential gate has already passed.
	if attempt.ActorPTID == "" {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNAUTHORIZED_ATTEMPT)
	}
	var actor db.Actor
	if err := tx.Where("ptid = ?", attempt.ActorPTID).First(&actor).Error; err != nil {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNAUTHORIZED_ATTEMPT)
	}
	var enrolled int64
	if err := tx.Model(&identitydb.ActorDeviceModel{}).
		Where("ptid = ? AND revoked = ?", attempt.ActorPTID, false).
		Count(&enrolled).Error; err != nil {
		return nil, err
	}
	return &application.AttemptBinding{
		UserID: actor.ID, ActorPTID: attempt.ActorPTID,
		StationPeerID: attempt.StationPeerID, EnrolledDeviceCount: int(enrolled),
	}, nil
}

// ApproverOwner validates the authenticated session of an approving device.
type ApproverOwner struct{}

func (ApproverOwner) RequireApprover(ctx context.Context, tx *gorm.DB, actorPTID, claimantDeviceID string) (string, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || subject.ID != actorPTID || subject.SessionID == "" {
		return "", link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVER_REVOKED)
	}
	var record session.SessionRecord
	if err := tx.WithContext(ctx).Where("session_id = ?", subject.SessionID).First(&record).Error; err != nil {
		return "", link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVER_REVOKED)
	}
	now := time.Now().UTC()
	if record.Revoked || !record.ExpiresAt.After(now) || record.DeviceID == "" ||
		record.DeviceID == claimantDeviceID {
		return "", link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVER_REVOKED)
	}
	var device identitydb.ActorDeviceModel
	if err := tx.Where("ptid = ? AND device_id = ? AND revoked = ?",
		actorPTID, record.DeviceID, false).First(&device).Error; err != nil {
		return "", link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVER_REVOKED)
	}
	return record.DeviceID, nil
}

func isTerminal(status string) bool {
	switch status {
	case "granted", "blocked", "failed", "cancelled", "expired":
		return true
	default:
		return false
	}
}
