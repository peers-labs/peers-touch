package application

import (
	"bytes"
	"time"

	link "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	actorpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/loginapproval"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func bytesEqual(a, b []byte) bool { return bytes.Equal(a, b) }

// gormForUpdate takes a row lock on Postgres and is a tolerated no-op on the
// sqlite used by tests.
func gormForUpdate() clause.Expression {
	return clause.Locking{Strength: "UPDATE"}
}

// save advances the revision with compare-and-swap so a concurrent writer can
// never silently overwrite a newer projection.
func save(tx *gorm.DB, record *rows.Transaction) error {
	previous := record.Revision
	record.Revision++
	result := tx.Model(&rows.Transaction{}).Where("id = ? AND revision = ?", record.ID, previous).
		Select("*").Updates(record)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_REVISION_CONFLICT)
	}
	return nil
}

func cas(tx *gorm.DB, record *rows.Transaction, observed uint64) error {
	if observed != 0 && observed != record.Revision {
		return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_REVISION_CONFLICT)
	}
	return save(tx, record)
}

func audit(tx *gorm.DB, approvalID, actorPTID, approverDeviceID string, revision uint64, event string, now time.Time) error {
	return tx.Create(&rows.Audit{ApprovalID: approvalID, ActorPTID: actorPTID,
		ApproverDeviceID: approverDeviceID, Revision: revision, Event: event, CreatedAt: now}).Error
}

func project(record *rows.Transaction) *pb.LoginApprovalProjection {
	return &pb.LoginApprovalProjection{
		ApprovalId: record.ID, State: record.State, Revision: record.Revision,
		ExpiresAtUnixMs: record.ExpiresAt.UnixMilli(), ComparisonCode: record.ComparisonCode,
		Reason: record.Reason,
	}
}

func subjectActor(subject *coreauth.Subject) *actorpb.ActorRef {
	if subject == nil {
		return nil
	}
	return &actorpb.ActorRef{Ptid: subject.ID}
}
