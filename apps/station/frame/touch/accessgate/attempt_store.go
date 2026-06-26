package accessgate

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// Attempt status values. The lifecycle is pending -> action_required ->
// granted | blocked | failed, with cancelled and expired as terminal outcomes
// driven by the client or the timeout sweep rather than the gate chain.
const (
	attemptStatusPending        = "pending"
	attemptStatusActionRequired = "action_required"
	attemptStatusGranted        = "granted"
	attemptStatusBlocked        = "blocked"
	attemptStatusFailed         = "failed"
	attemptStatusCancelled      = "cancelled"
	attemptStatusExpired        = "expired"
)

// errAttemptNotFound signals a missing, expired, or terminally-closed attempt so
// callers can map it to a single user-facing message.
var errAttemptNotFound = errors.New("access attempt expired or not found")

// createAttempt persists a fresh attempt row. The caller has already minted the
// attempt ID and resolved any session-bound actor.
func createAttempt(ctx context.Context, attempt *Attempt, req *pb.StartAccessAttemptRequest) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	row := &dbmodel.AccessAttempt{
		ID:         attempt.ID,
		Status:     attemptStatusPending,
		SessionID:  attempt.SessionID,
		StationURL: req.GetStationUrl(),
		ExpiresAt:  attempt.ExpiresAt,
	}
	if attempt.Actor != nil {
		row.ActorID = attempt.Actor.GetActorId()
		row.ActorUsername = attempt.Actor.GetUsername()
		row.ActorEmail = attempt.Actor.GetEmail()
	}
	if client := req.GetClient(); client != nil {
		row.Platform = client.GetPlatform()
		row.AppVersion = client.GetAppVersion()
		row.DeviceID = client.GetDeviceId()
	}

	return rds.WithContext(ctx).Create(row).Error
}

// findAttempt loads a live attempt. Expired-but-not-swept rows are flagged
// expired and reported as not found so callers treat them uniformly.
func findAttempt(ctx context.Context, id string) (*Attempt, bool) {
	if id == "" {
		return nil, false
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, false
	}

	var row dbmodel.AccessAttempt
	if err := rds.WithContext(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		return nil, false
	}

	if isTerminalStatus(row.Status) {
		return nil, false
	}
	if !row.ExpiresAt.IsZero() && time.Now().After(row.ExpiresAt) {
		_ = rds.WithContext(ctx).Model(&dbmodel.AccessAttempt{}).
			Where("id = ?", id).Update("status", attemptStatusExpired).Error
		return nil, false
	}

	return attemptFromRow(&row), true
}

// saveAttemptDecision writes the gate-chain outcome back onto the attempt so the
// persisted status and current gate stay in sync with the decision the client
// receives. The actor identity is refreshed because login fills it in mid-chain.
func saveAttemptDecision(ctx context.Context, attempt *Attempt, decision *pb.AccessDecision) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	updates := map[string]any{
		"status":          attemptStatusForDecision(decision.GetState()),
		"current_gate_id": decision.GetCurrentGateId(),
		"session_id":      attempt.SessionID,
	}
	if attempt.Actor != nil {
		updates["actor_id"] = attempt.Actor.GetActorId()
		updates["actor_username"] = attempt.Actor.GetUsername()
		updates["actor_email"] = attempt.Actor.GetEmail()
	}

	return rds.WithContext(ctx).Model(&dbmodel.AccessAttempt{}).
		Where("id = ?", attempt.ID).Updates(updates).Error
}

// cancelAttempt moves a live attempt to the cancelled terminal state. It returns
// false when the attempt is already gone or terminal so the endpoint stays
// idempotent without surfacing an error.
func cancelAttempt(ctx context.Context, id string) (bool, error) {
	if id == "" {
		return false, nil
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return false, err
	}

	res := rds.WithContext(ctx).Model(&dbmodel.AccessAttempt{}).
		Where("id = ? AND status IN ?", id, []string{attemptStatusPending, attemptStatusActionRequired}).
		Update("status", attemptStatusCancelled)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// markAttemptInvitePassed records that the attempt redeemed a valid invite code
// so the invite.code gate stays satisfied on subsequent decision passes.
func markAttemptInvitePassed(ctx context.Context, id string) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	return rds.WithContext(ctx).Model(&dbmodel.AccessAttempt{}).
		Where("id = ?", id).Update("invite_passed", true).Error
}

func attemptFromRow(row *dbmodel.AccessAttempt) *Attempt {
	attempt := &Attempt{
		ID:           row.ID,
		SessionID:    row.SessionID,
		InvitePassed: row.InvitePassed,
		CreatedAt:    row.CreatedAt,
		ExpiresAt:    row.ExpiresAt,
	}
	if row.ActorID > 0 {
		attempt.Actor = &pb.AccessGateActorRef{
			Id:       strconv.FormatInt(row.ActorID, 10),
			ActorId:  row.ActorID,
			Username: row.ActorUsername,
			Email:    row.ActorEmail,
		}
	}
	return attempt
}

func isTerminalStatus(status string) bool {
	switch status {
	case attemptStatusCancelled, attemptStatusExpired:
		return true
	default:
		return false
	}
}

func attemptStatusForDecision(state pb.AccessDecisionState) string {
	switch state {
	case pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED:
		return attemptStatusActionRequired
	case pb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED:
		return attemptStatusGranted
	case pb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED:
		return attemptStatusBlocked
	case pb.AccessDecisionState_ACCESS_DECISION_STATE_FAILED:
		return attemptStatusFailed
	default:
		return attemptStatusPending
	}
}
