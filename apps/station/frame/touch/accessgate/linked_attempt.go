package accessgate

import (
	"context"
	"errors"
	"strings"
	"time"

	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type linkedPolicyKey struct{}

// linkedEvaluationContext pins the policy in the caller's database transaction.
// All existing registry/gatekeeper policy reads use this owner-only snapshot;
// no gate opens another connection while the coordinator holds its locks.
func linkedEvaluationContext(tx *gorm.DB) (context.Context, error) {
	if tx == nil || tx.Statement == nil {
		return nil, errors.New("Access transaction is required")
	}
	if _, ok := tx.Statement.ConnPool.(gorm.TxCommitter); !ok {
		return nil, errors.New("Access requires an active transaction")
	}
	var policy dbmodel.AccessPolicy
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).First(&policy).Error; err != nil {
		return nil, err
	}
	return context.WithValue(tx.Statement.Context, linkedPolicyKey{}, &policy), nil
}

// CreateLinkedAttemptInTransaction starts an unauthenticated, device-scoped
// Access attempt. A claim or Desktop approval alone does not grant Access.
func CreateLinkedAttemptInTransaction(
	tx *gorm.DB,
	request *pb.StartAccessAttemptRequest,
	expiresAt time.Time,
) (*Attempt, *pb.AccessDecision, error) {
	if request == nil || request.GetClient() == nil || request.GetSessionId() != "" {
		return nil, nil, errors.New("linked Access client request is required")
	}
	client := request.GetClient()
	if err := ValidateStationPeerID(request.GetStationPeerId()); err != nil {
		return nil, nil, err
	}
	if !expiresAt.After(time.Now()) || strings.TrimSpace(client.GetDeviceId()) == "" ||
		client.GetLifecycleGeneration() == 0 ||
		(client.GetPlatform() != "android" && client.GetPlatform() != "ios") {
		return nil, nil, errors.New("linked Access client scope is invalid")
	}
	ctx, err := linkedEvaluationContext(tx)
	if err != nil {
		return nil, nil, err
	}
	attempt := &Attempt{
		ID: newAttemptID(), StationPeerID: request.GetStationPeerId(),
		Platform: client.GetPlatform(), DeviceID: client.GetDeviceId(),
		LifecycleGeneration: client.GetLifecycleGeneration(),
		CompletedActions:    make(map[string]bool), DecisionRevision: 1,
		CreatedAt: time.Now().UTC(), ExpiresAt: expiresAt.UTC(),
	}
	decision := DecisionForAttempt(ctx, attempt)
	attempt.Status = attemptStatusForDecision(decision.GetState())
	attempt.CurrentGateID = decision.GetCurrentGateId()
	row := dbmodel.AccessAttempt{
		ID: attempt.ID, StationPeerID: attempt.StationPeerID, StationURL: request.GetStationUrl(),
		Platform: attempt.Platform, AppVersion: client.GetAppVersion(), DeviceID: attempt.DeviceID,
		LifecycleGeneration: attempt.LifecycleGeneration, DecisionRevision: 1,
		Status: attempt.Status, CurrentGateID: attempt.CurrentGateID,
		CreatedAt: attempt.CreatedAt, ExpiresAt: attempt.ExpiresAt,
	}
	if err := tx.Create(&row).Error; err != nil {
		return nil, nil, err
	}
	return attempt, decision, nil
}

func linkedAttemptRow(tx *gorm.DB, id string, now time.Time) (*dbmodel.AccessAttempt, error) {
	if tx == nil || tx.Statement == nil {
		return nil, errors.New("Access transaction is required")
	}
	if _, ok := tx.Statement.ConnPool.(gorm.TxCommitter); !ok {
		return nil, errors.New("Access requires an active transaction")
	}
	var row dbmodel.AccessAttempt
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).First(&row).Error; err != nil {
		return nil, err
	}
	if isTerminalStatus(row.Status) || !row.ExpiresAt.After(now) {
		return nil, errAttemptNotFound
	}
	return &row, nil
}

// BindLinkedCandidateInTransaction is invoked only after the selected claim
// proves its Actor Device certificate. It retains every later Station gate.
func BindLinkedCandidateInTransaction(
	tx *gorm.DB,
	attemptID string,
	actor *dbmodel.Actor,
	now time.Time,
) (*Attempt, *pb.AccessDecision, error) {
	if actor == nil || actor.PTID == "" {
		return nil, nil, errors.New("linked Access actor is required")
	}
	row, err := linkedAttemptRow(tx, attemptID, now)
	if err != nil {
		return nil, nil, err
	}
	if row.ActorPTID != "" && (row.ActorPTID != actor.PTID || row.AuthMethod != "device_link") {
		return nil, nil, errors.New("linked Access actor binding changed")
	}
	attempt := attemptFromRow(row)
	attempt.Actor = touchactor.ProtoActorRef(actor)
	attempt.ActorUsername = actor.PreferredUsername
	attempt.ActorEmail = actor.Email
	attempt.AuthMethod = "device_link"
	return saveLinkedDecision(tx, row, attempt)
}

// ReevaluateLinkedInTransaction rechecks current policy without changing the
// revision for an unchanged decision. Credential AAD remains immutable; a
// changed decision forces the coordinator to prepare a new delivery.
func ReevaluateLinkedInTransaction(
	tx *gorm.DB,
	attemptID string,
	now time.Time,
) (*Attempt, *pb.AccessDecision, error) {
	row, err := linkedAttemptRow(tx, attemptID, now)
	if err != nil {
		return nil, nil, err
	}
	if row.ActorPTID == "" || row.AuthMethod != "device_link" {
		return nil, nil, errors.New("linked Access candidate has not been proved")
	}
	return saveLinkedDecision(tx, row, attemptFromRow(row))
}

func saveLinkedDecision(
	tx *gorm.DB,
	row *dbmodel.AccessAttempt,
	attempt *Attempt,
) (*Attempt, *pb.AccessDecision, error) {
	if attempt.Actor != nil {
		var actor dbmodel.Actor
		if err := tx.Where("ptid = ?", attempt.Actor.GetPtid()).First(&actor).Error; err != nil {
			return nil, nil, err
		}
		attempt.Actor = touchactor.ProtoActorRef(&actor)
		attempt.ActorUsername = actor.PreferredUsername
		attempt.ActorEmail = actor.Email
	}
	ctx, err := linkedEvaluationContext(tx)
	if err != nil {
		return nil, nil, err
	}
	decision := DecisionForAttempt(ctx, attempt)
	status := attemptStatusForDecision(decision.GetState())
	revision := row.DecisionRevision
	actions := encodeCompletedActions(attempt.CompletedActions)
	if status != row.Status || decision.GetCurrentGateId() != row.CurrentGateID ||
		attempt.Actor.GetPtid() != row.ActorPTID || attempt.AuthMethod != row.AuthMethod ||
		attempt.ActorUsername != row.ActorUsername || attempt.ActorEmail != row.ActorEmail ||
		attempt.InvitePassed != row.InvitePassed || actions != row.CompletedActionIDs {
		revision++
	}
	result := tx.Model(&dbmodel.AccessAttempt{}).
		Where("id = ? AND decision_revision = ?", row.ID, row.DecisionRevision).
		Updates(map[string]any{
			"status": status, "current_gate_id": decision.GetCurrentGateId(), "decision_revision": revision,
			"actor_ptid": attempt.Actor.GetPtid(), "actor_kind": int32(attempt.Actor.GetKind()),
			"actor_username": attempt.ActorUsername, "actor_email": attempt.ActorEmail,
			"auth_method": attempt.AuthMethod, "completed_action_ids": actions,
			"invite_passed": attempt.InvitePassed,
		})
	if result.Error != nil {
		return nil, nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, nil, errors.New("linked Access revision changed")
	}
	attempt.Status = status
	attempt.CurrentGateID = decision.GetCurrentGateId()
	attempt.DecisionRevision = revision
	return attempt, decision, nil
}
