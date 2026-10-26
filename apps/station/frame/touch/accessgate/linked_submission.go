package accessgate

import (
	"errors"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// SubmitLinkedActionInTransaction uses the existing descriptor, schema and
// completion rules. The coordinator must first authenticate the selected
// device PoP and offer CAS. This port cannot submit a second login action.
func SubmitLinkedActionInTransaction(
	tx *gorm.DB,
	request *pb.SubmitAccessGateRequest,
	now time.Time,
) (*Attempt, *pb.AccessDecision, error) {
	if request == nil || request.GetSubmissionId() == "" {
		return nil, nil, errors.New("linked Access submission is required")
	}
	row, err := linkedAttemptRow(tx, request.GetAttemptId(), now)
	if err != nil {
		return nil, nil, err
	}
	if row.AuthMethod != "device_link" || row.ActorPTID == "" {
		return nil, nil, errors.New("linked Access candidate has not been proved")
	}
	attempt := attemptFromRow(row)
	if err := validateSubmissionScope(attempt, request); err != nil {
		return nil, nil, err
	}
	ctx, err := linkedEvaluationContext(tx)
	if err != nil {
		return nil, nil, err
	}
	keyring, err := coreauth.StationAccessKeyringInTransaction(tx)
	if err != nil {
		return nil, nil, err
	}
	var previous dbmodel.AccessGateSubmission
	findErr := tx.Where("attempt_id = ? AND submission_id = ?", row.ID, request.GetSubmissionId()).
		First(&previous).Error
	if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
		return nil, nil, findErr
	}
	var key coreauth.StationAccessKey
	if findErr == nil {
		key, err = keyring.Resolve(ctx, previous.FingerprintKeyID)
	} else {
		key, err = keyring.Current(ctx)
	}
	if err != nil {
		return nil, nil, err
	}
	payloadHash, err := submissionPayloadHashWithKey(request, key.Material)
	if err != nil {
		return nil, nil, err
	}
	if findErr == nil {
		if previous.PayloadHash != payloadHash || previous.State != submissionStateCompleted {
			return nil, nil, errors.New("linked Access submission retry changed")
		}
		return saveLinkedDecision(tx, row, attempt)
	}
	decision := DecisionForAttempt(ctx, attempt)
	gate, action, err := validateSubmissionDecision(decision, request)
	if err != nil {
		return nil, nil, err
	}
	if err := validateActionInput(gate, action, request); err != nil {
		return nil, nil, err
	}
	switch action.GetType() {
	case pb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE:
		if err := redeemInviteCodeWithDB(ctx, tx, row.ID, normalizeCode(request.GetInviteCode())); err != nil {
			return nil, nil, err
		}
		attempt.InvitePassed = true
	case pb.AccessGateType_ACCESS_GATE_TYPE_TERMS_ACCEPTANCE,
		pb.AccessGateType_ACCESS_GATE_TYPE_CUSTOM:
		if err := validateGenericCompletion(request.GetActionId(), request.GetGeneric()); err != nil {
			return nil, nil, err
		}
		attempt.CompletedActions[request.GetActionId()] = true
	default:
		return nil, nil, errors.New("linked Access action is not supported by its owner")
	}
	updated, decision, err := saveLinkedDecision(tx, row, attempt)
	if err != nil {
		return nil, nil, err
	}
	submission := dbmodel.AccessGateSubmission{
		AttemptID: row.ID, SubmissionID: request.GetSubmissionId(), GateID: request.GetGateId(),
		ActionID: request.GetActionId(), FingerprintKeyID: key.ID, PayloadHash: payloadHash,
		State: submissionStateCompleted, DecisionRevision: updated.DecisionRevision,
	}
	if err := tx.Create(&submission).Error; err != nil {
		return nil, nil, err
	}
	return updated, decision, nil
}

// CancelLinkedAttemptInTransaction releases only the offer's Access scope.
func CancelLinkedAttemptInTransaction(tx *gorm.DB, id string) error {
	return tx.Model(&dbmodel.AccessAttempt{}).
		Where("id = ? AND auth_method IN ?", id, []string{"", "device_link"}).
		Update("status", attemptStatusCancelled).Error
}
