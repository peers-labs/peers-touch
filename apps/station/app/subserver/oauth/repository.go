package oauth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errOAuthAttemptNotFound      = errors.New("OAuth attempt not found")
	errOAuthAttemptExpired       = errors.New("OAuth attempt expired")
	errOAuthAttemptReplay        = errors.New("OAuth callback already consumed")
	errOAuthAttemptCancelled     = errors.New("OAuth attempt cancelled")
	errOAuthBindingMismatch      = errors.New("OAuth attempt binding mismatch")
	errOAuthCandidateUnavailable = errors.New("OAuth session candidate unavailable")
	errOAuthAccessNotGranted     = errors.New("OAuth access attempt is not granted")
	errOAuthEnvelopeUnavailable  = errors.New("OAuth credential envelope unavailable")
)

const (
	candidateStateInactive           = "inactive"
	candidateStateCredentialDelivery = "credential_delivery"
	candidateStateActive             = "active"
	candidateStateDenied             = "denied"
	candidateStateCancelled          = "cancelled"
)

type attemptBinding struct {
	AttemptID           string
	StationPeerID       string
	AccessAttemptID     string
	DeviceID            string
	LifecycleGeneration uint64
	AttemptSecret       []byte
}

type callbackClaim struct {
	attemptBinding
	Provider      string
	GateID        string
	RedirectURI   string
	StateHash     string
	PKCEChallenge string
	NonceHash     string
	ClaimedAt     time.Time
}

type finalizedCredential struct {
	Session  *session.SessionRecord
	Envelope *dbmodel.OAuthCredentialEnvelope
}

type credentialFactory func(
	context.Context,
	*dbmodel.AccessAttempt,
	*dbmodel.OAuthAttempt,
	*dbmodel.OAuthSessionCandidate,
) (*finalizedCredential, error)

type oauthSnapshot struct {
	Attempt   *dbmodel.OAuthAttempt
	Candidate *dbmodel.OAuthSessionCandidate
	Envelope  *dbmodel.OAuthCredentialEnvelope
}

type oauthRepository interface {
	CreateOrRecoverAttempt(context.Context, *dbmodel.OAuthAttempt) (*dbmodel.OAuthAttempt, error)
	ClaimCallback(context.Context, callbackClaim) (*dbmodel.OAuthAttempt, error)
	SaveCandidate(context.Context, *dbmodel.OAuthAttempt, *dbmodel.OAuthSessionCandidate) error
	FindBoundSnapshot(context.Context, attemptBinding) (*oauthSnapshot, error)
	SetAttemptOutcome(context.Context, string, oauthpb.OAuthAttemptState, oauthpb.OAuthAttemptResult, string) error
	FinalizeGranted(context.Context, attemptBinding, credentialFactory) (*oauthSnapshot, error)
	Acknowledge(context.Context, attemptBinding, time.Time) (oauthpb.OAuthAttemptResult, error)
	CancelAttempt(context.Context, attemptBinding, time.Time) (oauthpb.OAuthAttemptResult, error)
	MarkDenied(context.Context, attemptBinding, string) error
	SweepExpired(context.Context, time.Time) (int, error)
}

type gormOAuthRepository struct {
	db func(context.Context) (*gorm.DB, error)
}

func newGormOAuthRepository(db func(context.Context) (*gorm.DB, error)) *gormOAuthRepository {
	return &gormOAuthRepository{db: db}
}

func (r *gormOAuthRepository) CreateOrRecoverAttempt(
	ctx context.Context,
	attempt *dbmodel.OAuthAttempt,
) (*dbmodel.OAuthAttempt, error) {
	database, err := r.db(ctx)
	if err != nil {
		return nil, err
	}
	var persisted *dbmodel.OAuthAttempt
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if attempt.LiveBindingKey != nil {
			if err := releaseExpiredAttempts(tx, *attempt.LiveBindingKey, time.Now().UTC()); err != nil {
				return err
			}

			existing, err := findLiveAttempt(tx, *attempt.LiveBindingKey)
			if err == nil {
				if err := verifyStartRetryBinding(existing, attempt); err != nil {
					return err
				}
				persisted = existing
				return nil
			}
			if !errors.Is(err, errOAuthAttemptNotFound) {
				return err
			}
		}
		if err := tx.Create(attempt).Error; err != nil {
			return err
		}
		persisted = attempt
		return nil
	})
	if err == nil {
		return persisted, nil
	}

	// A concurrent creator can win after the transaction observes no live row.
	// The unique live-binding constraint serializes that race; recover only when
	// the committed row has the exact same immutable request binding.
	if attempt.LiveBindingKey != nil {
		existing, lookupErr := findLiveAttempt(database.WithContext(ctx), *attempt.LiveBindingKey)
		if lookupErr == nil {
			if bindingErr := verifyStartRetryBinding(existing, attempt); bindingErr != nil {
				return nil, bindingErr
			}
			return existing, nil
		}
	}
	return nil, err
}

func releaseExpiredAttempts(tx *gorm.DB, liveBindingKey string, now time.Time) error {
	var expiredAttempts []dbmodel.OAuthAttempt
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("live_binding_key = ? AND expires_at <= ?", liveBindingKey, now).
		Find(&expiredAttempts).Error; err != nil {
		return err
	}
	for i := range expiredAttempts {
		expired := &expiredAttempts[i]
		if err := expireAttemptRows(tx, expired, now); err != nil {
			return err
		}
	}
	return nil
}

func (r *gormOAuthRepository) SweepExpired(
	ctx context.Context,
	now time.Time,
) (int, error) {
	database, err := r.db(ctx)
	if err != nil {
		return 0, err
	}
	expiredCount := 0
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var expiredAttempts []dbmodel.OAuthAttempt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("live_binding_key IS NOT NULL AND expires_at <= ?", now.UTC()).
			Order("expires_at ASC, id ASC").
			Find(&expiredAttempts).Error; err != nil {
			return err
		}
		for index := range expiredAttempts {
			if err := expireAttemptRows(tx, &expiredAttempts[index], now.UTC()); err != nil {
				return err
			}
			expiredCount++
		}
		return nil
	})
	return expiredCount, err
}

func expireAttemptRows(tx *gorm.DB, attempt *dbmodel.OAuthAttempt, now time.Time) error {
	if attempt.CandidateID != "" {
		var candidate dbmodel.OAuthSessionCandidate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", attempt.CandidateID).
			First(&candidate).Error; err != nil {
			return translateNotFound(err, errOAuthCandidateUnavailable)
		}
		if candidate.State == candidateStateActive {
			return errOAuthCandidateUnavailable
		}
		if candidate.SessionID != "" {
			if err := tx.Model(&session.SessionRecord{}).
				Where("session_id = ? AND oauth_candidate_id = ?", candidate.SessionID, candidate.ID).
				Updates(map[string]any{
					"revoked":        true,
					"revoked_at":     now,
					"revoked_reason": "oauth_expired",
				}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("candidate_id = ?", candidate.ID).
			Delete(&dbmodel.OAuthCredentialEnvelope{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&candidate).Updates(map[string]any{
			"state":            candidateStateCancelled,
			"live_binding_key": nil,
		}).Error; err != nil {
			return err
		}
	}
	if err := terminalizeAttempt(
		tx,
		attempt,
		oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED,
		oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED,
		"OAUTH_ATTEMPT_EXPIRED",
	); err != nil {
		return err
	}
	attempt.State = int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED)
	attempt.Result = int32(oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED)
	attempt.ErrorCode = "OAUTH_ATTEMPT_EXPIRED"
	attempt.LiveBindingKey = nil
	return nil
}

func findLiveAttempt(tx *gorm.DB, liveBindingKey string) (*dbmodel.OAuthAttempt, error) {
	var attempt dbmodel.OAuthAttempt
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("live_binding_key = ?", liveBindingKey).
		First(&attempt).Error; err != nil {
		return nil, translateNotFound(err, errOAuthAttemptNotFound)
	}
	return &attempt, nil
}

func verifyStartRetryBinding(existing, requested *dbmodel.OAuthAttempt) error {
	if existing.Provider != requested.Provider ||
		existing.StationPeerID != requested.StationPeerID ||
		existing.AccessAttemptID != requested.AccessAttemptID ||
		existing.GateID != requested.GateID ||
		existing.RedirectURI != requested.RedirectURI ||
		existing.PKCEChallenge != requested.PKCEChallenge ||
		existing.NonceHash != requested.NonceHash ||
		existing.DeviceID != requested.DeviceID ||
		existing.LifecycleGeneration != requested.LifecycleGeneration ||
		len(existing.AttemptSecretHash) != len(requested.AttemptSecretHash) ||
		subtle.ConstantTimeCompare(existing.AttemptSecretHash, requested.AttemptSecretHash) != 1 ||
		len(existing.CredentialDeliveryPublicKey) != len(requested.CredentialDeliveryPublicKey) ||
		subtle.ConstantTimeCompare(
			existing.CredentialDeliveryPublicKey,
			requested.CredentialDeliveryPublicKey,
		) != 1 ||
		existing.StateHash != hashBinding(deriveOAuthState(existing.ID, existing.AttemptSecretHash)) {
		return errOAuthBindingMismatch
	}
	return nil
}

func (r *gormOAuthRepository) ClaimCallback(
	ctx context.Context,
	claim callbackClaim,
) (*dbmodel.OAuthAttempt, error) {
	database, err := r.db(ctx)
	if err != nil {
		return nil, err
	}

	var (
		claimed dbmodel.OAuthAttempt
		expired bool
	)
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOAuthAttempt(tx, claim.AttemptID, &claimed); err != nil {
			return err
		}
		if err := verifyAttemptBinding(&claimed, claim.attemptBinding); err != nil {
			return err
		}
		if !claimed.ExpiresAt.After(claim.ClaimedAt) {
			if err := terminalizeAttempt(
				tx,
				&claimed,
				oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED,
				oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED,
				"OAUTH_ATTEMPT_EXPIRED",
			); err != nil {
				return err
			}
			expired = true
			return nil
		}
		switch oauthpb.OAuthAttemptState(claimed.State) {
		case oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CANCELLED:
			return errOAuthAttemptCancelled
		case oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER:
		default:
			return errOAuthAttemptReplay
		}
		if claimed.Provider != claim.Provider ||
			claimed.GateID != claim.GateID ||
			claimed.RedirectURI != claim.RedirectURI ||
			claimed.StateHash != claim.StateHash ||
			claimed.PKCEChallenge != claim.PKCEChallenge ||
			claimed.NonceHash != claim.NonceHash {
			return errOAuthBindingMismatch
		}

		result := tx.Model(&dbmodel.OAuthAttempt{}).
			Where("id = ? AND state = ?", claimed.ID, oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER).
			Updates(map[string]any{
				"state":       oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CALLBACK_CLAIMED,
				"claimed_at":  claim.ClaimedAt,
				"consumed_at": claim.ClaimedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errOAuthAttemptReplay
		}
		claimed.State = int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CALLBACK_CLAIMED)
		claimed.ClaimedAt = &claim.ClaimedAt
		claimed.ConsumedAt = &claim.ClaimedAt
		return nil
	})
	if err == nil && expired {
		return nil, errOAuthAttemptExpired
	}
	return &claimed, err
}

func (r *gormOAuthRepository) SaveCandidate(
	ctx context.Context,
	attempt *dbmodel.OAuthAttempt,
	candidate *dbmodel.OAuthSessionCandidate,
) error {
	database, err := r.db(ctx)
	if err != nil {
		return err
	}
	return database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked dbmodel.OAuthAttempt
		if err := lockOAuthAttempt(tx, attempt.ID, &locked); err != nil {
			return err
		}
		if locked.State != int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CALLBACK_CLAIMED) {
			return errOAuthAttemptReplay
		}
		if err := tx.Create(candidate).Error; err != nil {
			return fmt.Errorf("create OAuth session candidate: %w", err)
		}
		result := tx.Model(&dbmodel.OAuthAttempt{}).
			Where("id = ? AND state = ?", attempt.ID, oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CALLBACK_CLAIMED).
			Updates(map[string]any{
				"state":        oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_SESSION_CANDIDATE_ISSUED,
				"result":       oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED,
				"candidate_id": candidate.ID,
				"error_code":   "",
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errOAuthAttemptReplay
		}
		return nil
	})
}

func (r *gormOAuthRepository) FindBoundSnapshot(
	ctx context.Context,
	binding attemptBinding,
) (*oauthSnapshot, error) {
	database, err := r.db(ctx)
	if err != nil {
		return nil, err
	}
	var attempt dbmodel.OAuthAttempt
	if err := database.WithContext(ctx).Where("id = ?", binding.AttemptID).First(&attempt).Error; err != nil {
		return nil, translateNotFound(err, errOAuthAttemptNotFound)
	}
	if err := verifyAttemptBinding(&attempt, binding); err != nil {
		return nil, err
	}
	if !attempt.ExpiresAt.After(time.Now().UTC()) &&
		attempt.State != int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_ACTIVATED) {
		now := time.Now().UTC()
		if err := database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var locked dbmodel.OAuthAttempt
			if err := lockOAuthAttempt(tx, binding.AttemptID, &locked); err != nil {
				return err
			}
			if err := verifyAttemptBinding(&locked, binding); err != nil {
				return err
			}
			if !locked.ExpiresAt.After(now) &&
				locked.State != int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_ACTIVATED) {
				if err := expireAttemptRows(tx, &locked, now); err != nil {
					return err
				}
			}
			attempt = locked
			return nil
		}); err != nil {
			return nil, err
		}
	}

	snapshot := &oauthSnapshot{Attempt: &attempt}
	if attempt.CandidateID == "" {
		return snapshot, nil
	}
	var candidate dbmodel.OAuthSessionCandidate
	if err := database.WithContext(ctx).Where("id = ?", attempt.CandidateID).First(&candidate).Error; err != nil {
		return nil, translateNotFound(err, errOAuthCandidateUnavailable)
	}
	if err := verifyCandidateBinding(&candidate, &attempt); err != nil {
		return nil, err
	}
	snapshot.Candidate = &candidate

	var envelope dbmodel.OAuthCredentialEnvelope
	err = database.WithContext(ctx).Where("candidate_id = ?", candidate.ID).First(&envelope).Error
	if err == nil {
		snapshot.Envelope = &envelope
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return snapshot, nil
}

func (r *gormOAuthRepository) SetAttemptOutcome(
	ctx context.Context,
	id string,
	state oauthpb.OAuthAttemptState,
	result oauthpb.OAuthAttemptResult,
	errorCode string,
) error {
	database, err := r.db(ctx)
	if err != nil {
		return err
	}
	updates := map[string]any{
		"state":      state,
		"result":     result,
		"error_code": errorCode,
	}
	if isTerminalOAuthState(state) {
		updates["live_binding_key"] = nil
	}
	return database.WithContext(ctx).Model(&dbmodel.OAuthAttempt{}).
		Where(
			"id = ? AND state NOT IN ?",
			id,
			[]oauthpb.OAuthAttemptState{
				oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_ACTIVATED,
				oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CANCELLED,
				oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED,
			},
		).
		Updates(updates).Error
}

func (r *gormOAuthRepository) FinalizeGranted(
	ctx context.Context,
	binding attemptBinding,
	factory credentialFactory,
) (*oauthSnapshot, error) {
	database, err := r.db(ctx)
	if err != nil {
		return nil, err
	}

	snapshot := &oauthSnapshot{}
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var accessAttempt dbmodel.AccessAttempt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", binding.AccessAttemptID).
			First(&accessAttempt).Error; err != nil {
			return translateNotFound(err, errOAuthAccessNotGranted)
		}

		var attempt dbmodel.OAuthAttempt
		if err := lockOAuthAttempt(tx, binding.AttemptID, &attempt); err != nil {
			return err
		}
		if err := verifyAttemptBinding(&attempt, binding); err != nil {
			return err
		}
		if !attempt.ExpiresAt.After(time.Now().UTC()) {
			return errOAuthAttemptExpired
		}
		if attempt.State != int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_SESSION_CANDIDATE_ISSUED) &&
			attempt.State != int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FOLLOWING_GATE) {
			switch oauthpb.OAuthAttemptState(attempt.State) {
			case oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CANCELLED:
				return errOAuthAttemptCancelled
			case oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED:
				return errOAuthAttemptExpired
			default:
				return errOAuthCandidateUnavailable
			}
		}
		if attempt.LiveBindingKey == nil {
			return errOAuthCandidateUnavailable
		}

		var candidate dbmodel.OAuthSessionCandidate
		if attempt.CandidateID == "" {
			return errOAuthCandidateUnavailable
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", attempt.CandidateID).
			First(&candidate).Error; err != nil {
			return translateNotFound(err, errOAuthCandidateUnavailable)
		}
		if err := verifyCandidateBinding(&candidate, &attempt); err != nil {
			return err
		}
		snapshot.Attempt = &attempt
		snapshot.Candidate = &candidate

		if candidate.State == candidateStateActive {
			return nil
		}
		if candidate.State == candidateStateCancelled {
			return errOAuthAttemptCancelled
		}
		if candidate.State == candidateStateDenied {
			return errOAuthAccessNotGranted
		}
		if accessAttempt.Status != "granted" ||
			accessAttempt.StationPeerID != attempt.StationPeerID ||
			accessAttempt.ActorPTID != candidate.ActorPTID ||
			accessAttempt.DecisionRevision == 0 ||
			!accessAttempt.ExpiresAt.After(time.Now().UTC()) {
			return errOAuthAccessNotGranted
		}

		var existingEnvelope dbmodel.OAuthCredentialEnvelope
		envelopeErr := tx.Where("candidate_id = ?", candidate.ID).First(&existingEnvelope).Error
		if envelopeErr == nil {
			if candidate.SessionID == "" || existingEnvelope.SessionID != candidate.SessionID {
				return errOAuthEnvelopeUnavailable
			}
			snapshot.Envelope = &existingEnvelope
			return nil
		}
		if !errors.Is(envelopeErr, gorm.ErrRecordNotFound) {
			return envelopeErr
		}

		prepared, err := factory(ctx, &accessAttempt, &attempt, &candidate)
		if err != nil {
			return err
		}
		if prepared == nil || prepared.Session == nil || prepared.Envelope == nil {
			return errors.New("OAuth credential factory returned incomplete data")
		}
		if prepared.Session.OAuthCandidateID != candidate.ID ||
			prepared.Session.AccessAttemptID != accessAttempt.ID ||
			prepared.Session.StationPeerID != accessAttempt.StationPeerID ||
			prepared.Session.DeviceID != attempt.DeviceID ||
			prepared.Session.LifecycleGeneration != attempt.LifecycleGeneration ||
			prepared.Session.AccessDecisionRevision != accessAttempt.DecisionRevision ||
			prepared.Envelope.CandidateID != candidate.ID ||
			prepared.Envelope.SessionID != prepared.Session.SessionID {
			return errOAuthBindingMismatch
		}
		if err := tx.Create(prepared.Session).Error; err != nil {
			return fmt.Errorf("persist candidate-keyed OAuth session: %w", err)
		}
		if err := tx.Create(prepared.Envelope).Error; err != nil {
			return fmt.Errorf("persist OAuth credential envelope: %w", err)
		}

		result := tx.Model(&dbmodel.OAuthSessionCandidate{}).
			Where("id = ? AND state = ?", candidate.ID, candidateStateInactive).
			Updates(map[string]any{
				"state":             candidateStateCredentialDelivery,
				"session_id":        prepared.Session.SessionID,
				"decision_revision": accessAttempt.DecisionRevision,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errOAuthCandidateUnavailable
		}
		attemptUpdate := tx.Model(&dbmodel.OAuthAttempt{}).
			Where(
				"id = ? AND state IN ? AND live_binding_key = ?",
				attempt.ID,
				[]oauthpb.OAuthAttemptState{
					oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_SESSION_CANDIDATE_ISSUED,
					oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FOLLOWING_GATE,
				},
				*attempt.LiveBindingKey,
			).
			Updates(map[string]any{
				"state":      oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_SESSION_CANDIDATE_ISSUED,
				"result":     oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED,
				"error_code": "",
			})
		if attemptUpdate.Error != nil {
			return attemptUpdate.Error
		}
		if attemptUpdate.RowsAffected != 1 {
			return errOAuthAttemptCancelled
		}
		accessFence := tx.Model(&dbmodel.AccessAttempt{}).
			Where(
				"id = ? AND status = ? AND station_peer_id = ? AND actor_ptid = ? AND decision_revision = ?",
				accessAttempt.ID,
				"granted",
				accessAttempt.StationPeerID,
				accessAttempt.ActorPTID,
				accessAttempt.DecisionRevision,
			).
			UpdateColumn("decision_revision", accessAttempt.DecisionRevision)
		if accessFence.Error != nil {
			return accessFence.Error
		}
		if accessFence.RowsAffected != 1 {
			return errOAuthAccessNotGranted
		}

		candidate.State = candidateStateCredentialDelivery
		candidate.SessionID = prepared.Session.SessionID
		candidate.DecisionRevision = accessAttempt.DecisionRevision
		attempt.Result = int32(oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED)
		snapshot.Attempt = &attempt
		snapshot.Candidate = &candidate
		snapshot.Envelope = prepared.Envelope
		return nil
	})
	return snapshot, err
}

func (r *gormOAuthRepository) Acknowledge(
	ctx context.Context,
	binding attemptBinding,
	now time.Time,
) (oauthpb.OAuthAttemptResult, error) {
	database, err := r.db(ctx)
	if err != nil {
		return oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_UNSPECIFIED, err
	}
	result := oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_UNSPECIFIED
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		accessAttempt, attempt, candidate, err := lockAuthorizationRows(tx, binding)
		if err != nil {
			return err
		}
		if candidate.State == candidateStateActive {
			result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED
			return nil
		}
		if !attempt.ExpiresAt.After(now) || !candidate.ExpiresAt.After(now) {
			if err := expireAttemptRows(tx, attempt, now); err != nil {
				return err
			}
			result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED
			return nil
		}
		if candidate.State != candidateStateCredentialDelivery ||
			accessAttempt.Status != "granted" ||
			candidate.SessionID == "" {
			return errOAuthEnvelopeUnavailable
		}

		var envelope dbmodel.OAuthCredentialEnvelope
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("candidate_id = ?", candidate.ID).
			First(&envelope).Error; err != nil {
			return translateNotFound(err, errOAuthEnvelopeUnavailable)
		}
		if !envelope.ExpiresAt.After(now) {
			if err := expireAttemptRows(tx, attempt, now); err != nil {
				return err
			}
			result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED
			return nil
		}

		if err := tx.Model(&session.SessionRecord{}).
			Where("user_id = ? AND session_id <> ? AND revoked = ?", candidate.ActorID, candidate.SessionID, false).
			Updates(map[string]any{
				"revoked":        true,
				"revoked_at":     now,
				"revoked_reason": "kicked",
			}).Error; err != nil {
			return err
		}
		sessionUpdate := tx.Model(&session.SessionRecord{}).
			Where(
				"session_id = ? AND oauth_candidate_id = ? AND revoked = ? AND revoked_reason = ?",
				candidate.SessionID,
				candidate.ID,
				true,
				"credential_delivery_pending",
			).
			Updates(map[string]any{
				"revoked":        false,
				"revoked_at":     nil,
				"revoked_reason": "",
				"last_active_at": now,
			})
		if sessionUpdate.Error != nil {
			return sessionUpdate.Error
		}
		if sessionUpdate.RowsAffected != 1 {
			return errOAuthEnvelopeUnavailable
		}
		if err := tx.Delete(&envelope).Error; err != nil {
			return err
		}
		if err := tx.Model(candidate).Updates(map[string]any{
			"state":            candidateStateActive,
			"activated_at":     now,
			"live_binding_key": nil,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(attempt).Updates(map[string]any{
			"state":            oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_ACTIVATED,
			"result":           oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED,
			"error_code":       "",
			"live_binding_key": nil,
		}).Error; err != nil {
			return err
		}
		result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED
		return nil
	})
	return result, err
}

func (r *gormOAuthRepository) CancelAttempt(
	ctx context.Context,
	binding attemptBinding,
	now time.Time,
) (oauthpb.OAuthAttemptResult, error) {
	database, err := r.db(ctx)
	if err != nil {
		return oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_UNSPECIFIED, err
	}
	outcome := oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_UNSPECIFIED
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		accessAttempt, attempt, candidate, err := lockAuthorizationRowsAllowMissingCandidate(tx, binding)
		if err != nil {
			return err
		}
		if attempt.State == int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_ACTIVATED) ||
			(candidate != nil && candidate.State == candidateStateActive) {
			outcome = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED
			return nil
		}
		if candidate != nil {
			if candidate.SessionID != "" {
				if err := tx.Model(&session.SessionRecord{}).
					Where("session_id = ? AND oauth_candidate_id = ?", candidate.SessionID, candidate.ID).
					Updates(map[string]any{
						"revoked":        true,
						"revoked_at":     now,
						"revoked_reason": "oauth_cancelled",
					}).Error; err != nil {
					return err
				}
			}
			if err := tx.Where("candidate_id = ?", candidate.ID).
				Delete(&dbmodel.OAuthCredentialEnvelope{}).Error; err != nil {
				return err
			}
			if err := tx.Model(candidate).Updates(map[string]any{
				"state":            candidateStateCancelled,
				"live_binding_key": nil,
			}).Error; err != nil {
				return err
			}
		}
		if attempt.State == int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED) {
			outcome = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED
			return nil
		}
		if err := terminalizeAttempt(
			tx,
			attempt,
			oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CANCELLED,
			oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_CANCELLED,
			"OAUTH_ATTEMPT_CANCELLED",
		); err != nil {
			return err
		}
		if err := tx.Model(accessAttempt).
			Where("status NOT IN ?", []string{"cancelled", "expired"}).
			Update("status", "cancelled").Error; err != nil {
			return err
		}
		outcome = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_CANCELLED
		return nil
	})
	return outcome, err
}

func (r *gormOAuthRepository) MarkDenied(
	ctx context.Context,
	binding attemptBinding,
	errorCode string,
) error {
	database, err := r.db(ctx)
	if err != nil {
		return err
	}
	return database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, attempt, candidate, err := lockAuthorizationRows(tx, binding)
		if err != nil {
			return err
		}
		if candidate.SessionID != "" {
			if err := tx.Model(&session.SessionRecord{}).
				Where("session_id = ?", candidate.SessionID).
				Updates(map[string]any{
					"revoked":        true,
					"revoked_at":     time.Now().UTC(),
					"revoked_reason": "oauth_access_denied",
				}).Error; err != nil {
				return err
			}
			if err := tx.Where("candidate_id = ?", candidate.ID).
				Delete(&dbmodel.OAuthCredentialEnvelope{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&candidate).Updates(map[string]any{
			"state":            candidateStateDenied,
			"live_binding_key": nil,
		}).Error; err != nil {
			return err
		}
		return terminalizeAttempt(
			tx,
			attempt,
			oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FAILED,
			oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_DENIED,
			errorCode,
		)
	})
}

func lockAuthorizationRows(
	tx *gorm.DB,
	binding attemptBinding,
) (*dbmodel.AccessAttempt, *dbmodel.OAuthAttempt, *dbmodel.OAuthSessionCandidate, error) {
	accessAttempt, attempt, candidate, err := lockAuthorizationRowsAllowMissingCandidate(tx, binding)
	if err != nil {
		return nil, nil, nil, err
	}
	if candidate == nil {
		return nil, nil, nil, errOAuthCandidateUnavailable
	}
	return accessAttempt, attempt, candidate, nil
}

func lockAuthorizationRowsAllowMissingCandidate(
	tx *gorm.DB,
	binding attemptBinding,
) (*dbmodel.AccessAttempt, *dbmodel.OAuthAttempt, *dbmodel.OAuthSessionCandidate, error) {
	var accessAttempt dbmodel.AccessAttempt
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", binding.AccessAttemptID).
		First(&accessAttempt).Error; err != nil {
		return nil, nil, nil, translateNotFound(err, errOAuthBindingMismatch)
	}
	var attempt dbmodel.OAuthAttempt
	if err := lockOAuthAttempt(tx, binding.AttemptID, &attempt); err != nil {
		return nil, nil, nil, err
	}
	if err := verifyAttemptBinding(&attempt, binding); err != nil {
		return nil, nil, nil, err
	}
	if accessAttempt.StationPeerID != attempt.StationPeerID {
		return nil, nil, nil, errOAuthBindingMismatch
	}
	if attempt.CandidateID == "" {
		return &accessAttempt, &attempt, nil, nil
	}
	var candidate dbmodel.OAuthSessionCandidate
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", attempt.CandidateID).
		First(&candidate).Error; err != nil {
		return nil, nil, nil, translateNotFound(err, errOAuthCandidateUnavailable)
	}
	if err := verifyCandidateBinding(&candidate, &attempt); err != nil {
		return nil, nil, nil, err
	}
	return &accessAttempt, &attempt, &candidate, nil
}

func lockOAuthAttempt(tx *gorm.DB, id string, attempt *dbmodel.OAuthAttempt) error {
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).
		First(attempt).Error; err != nil {
		return translateNotFound(err, errOAuthAttemptNotFound)
	}
	return nil
}

func verifyAttemptBinding(attempt *dbmodel.OAuthAttempt, binding attemptBinding) error {
	if attempt.ID != strings.TrimSpace(binding.AttemptID) ||
		attempt.StationPeerID != strings.TrimSpace(binding.StationPeerID) ||
		attempt.AccessAttemptID != strings.TrimSpace(binding.AccessAttemptID) ||
		attempt.DeviceID != strings.TrimSpace(binding.DeviceID) ||
		attempt.LifecycleGeneration != binding.LifecycleGeneration {
		return errOAuthBindingMismatch
	}
	presentedHash := sha256.Sum256(binding.AttemptSecret)
	if len(attempt.AttemptSecretHash) != sha256.Size ||
		subtle.ConstantTimeCompare(attempt.AttemptSecretHash, presentedHash[:]) != 1 {
		return errOAuthBindingMismatch
	}
	return nil
}

func verifyCandidateBinding(candidate *dbmodel.OAuthSessionCandidate, attempt *dbmodel.OAuthAttempt) error {
	if candidate.OAuthAttemptID != attempt.ID ||
		candidate.AccessAttemptID != attempt.AccessAttemptID ||
		candidate.StationPeerID != attempt.StationPeerID ||
		candidate.DeviceID != attempt.DeviceID ||
		candidate.LifecycleGeneration != attempt.LifecycleGeneration {
		return errOAuthBindingMismatch
	}
	return nil
}

func terminalizeAttempt(
	tx *gorm.DB,
	attempt *dbmodel.OAuthAttempt,
	state oauthpb.OAuthAttemptState,
	result oauthpb.OAuthAttemptResult,
	errorCode string,
) error {
	return tx.Model(attempt).Updates(map[string]any{
		"state":            state,
		"result":           result,
		"error_code":       errorCode,
		"live_binding_key": nil,
	}).Error
}

func isTerminalOAuthState(state oauthpb.OAuthAttemptState) bool {
	switch state {
	case oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_ACTIVATED,
		oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CANCELLED,
		oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED,
		oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FAILED:
		return true
	default:
		return false
	}
}

func translateNotFound(err, replacement error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return replacement
	}
	return err
}
