package oauth

import (
	"context"
	"crypto/ecdh"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	touchauth "github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	accessgatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	oauthAttemptLifetime   = 10 * time.Minute
	oauthCandidateLifetime = 10 * time.Minute
)

var pkceVerifierPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

type accessCoordinator interface {
	ValidateStation(context.Context, string) error
	Validate(context.Context, string, string, string, string, uint64, accessgatepb.AccessGateType) error
	BindCandidate(
		context.Context,
		string,
		string,
		string,
		string,
		uint64,
		*model.ActorRef,
		string,
		string,
	) (*accessgatepb.AccessDecision, error)
	Reevaluate(context.Context, string, string) (*accessgatepb.AccessDecision, error)
}

type actorResolver interface {
	Resolve(context.Context, *coreauth.OAuth2Identity) (*dbmodel.Actor, *model.ActorRef, error)
	ResolveReference(context.Context, string) (*model.ActorRef, error)
}

type sessionCredentialIssuer interface {
	Prepare(
		context.Context,
		*dbmodel.OAuthSessionCandidate,
		string,
		uint64,
		time.Time,
	) (*session.SessionRecord, *model.LoginResponse, error)
}

type oauthService struct {
	repository oauthRepository
	providers  providerExchange
	access     accessCoordinator
	actors     actorResolver
	issuer     sessionCredentialIssuer
	sealer     credentialSealer
	now        func() time.Time
}

func newOAuthService(
	repository oauthRepository,
	providers providerExchange,
	access accessCoordinator,
	actors actorResolver,
	issuer sessionCredentialIssuer,
) *oauthService {
	return &oauthService{
		repository: repository,
		providers:  providers,
		access:     access,
		actors:     actors,
		issuer:     issuer,
		sealer:     x25519CredentialSealer{},
		now:        func() time.Time { return time.Now().UTC() },
	}
}

func (s *oauthService) SweepExpired(ctx context.Context) (int, error) {
	return s.repository.SweepExpired(ctx, s.now())
}

func (s *oauthService) Start(
	ctx context.Context,
	req *oauthpb.StartOAuthAttemptRequest,
) (*oauthpb.StartOAuthAttemptResponse, error) {
	if err := validateStartRequest(req); err != nil {
		return nil, err
	}
	if err := s.access.Validate(
		ctx,
		strings.TrimSpace(req.GetAccessAttemptId()),
		strings.TrimSpace(req.GetStationPeerId()),
		strings.TrimSpace(req.GetGateId()),
		strings.TrimSpace(req.GetDeviceId()),
		req.GetLifecycleGeneration(),
		req.GetActionType(),
	); err != nil {
		return nil, fmt.Errorf("validate OAuth access binding: %w", err)
	}

	provider, err := providerConfiguration(req.GetProvider(), req.GetRedirectUri())
	if err != nil {
		return nil, err
	}
	attemptID, err := randomPrefixedID("oauth-attempt-", 16)
	if err != nil {
		return nil, fmt.Errorf("generate OAuth attempt ID: %w", err)
	}
	state := deriveOAuthState(attemptID, req.GetAttemptSecretHash())

	now := s.now()
	expiresAt := now.Add(oauthAttemptLifetime)
	liveBindingKey := oauthLiveBindingKey(
		req.GetAccessAttemptId(),
		req.GetDeviceId(),
		req.GetLifecycleGeneration(),
	)
	attempt := &dbmodel.OAuthAttempt{
		ID:                          attemptID,
		Provider:                    provider.ID,
		StationPeerID:               strings.TrimSpace(req.GetStationPeerId()),
		AccessAttemptID:             strings.TrimSpace(req.GetAccessAttemptId()),
		GateID:                      strings.TrimSpace(req.GetGateId()),
		RedirectURI:                 strings.TrimSpace(req.GetRedirectUri()),
		PKCEChallenge:               req.GetPkceChallenge(),
		NonceHash:                   req.GetNonceHash(),
		StateHash:                   hashBinding(state),
		DeviceID:                    strings.TrimSpace(req.GetDeviceId()),
		LifecycleGeneration:         req.GetLifecycleGeneration(),
		AttemptSecretHash:           append([]byte(nil), req.GetAttemptSecretHash()...),
		CredentialDeliveryPublicKey: append([]byte(nil), req.GetCredentialDeliveryPublicKey()...),
		LiveBindingKey:              &liveBindingKey,
		State:                       int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER),
		Result:                      int32(oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_PENDING),
		ExpiresAt:                   expiresAt,
	}
	persisted, err := s.repository.CreateOrRecoverAttempt(ctx, attempt)
	if err != nil {
		return nil, fmt.Errorf("persist or recover OAuth attempt: %w", err)
	}
	state = deriveOAuthState(persisted.ID, persisted.AttemptSecretHash)
	if persisted.StateHash != hashBinding(state) {
		return nil, errOAuthBindingMismatch
	}
	authorizeURL, err := s.providers.AuthorizeURL(provider, state, persisted.PKCEChallenge)
	if err != nil {
		return nil, fmt.Errorf("build provider authorization URL: %w", err)
	}
	return &oauthpb.StartOAuthAttemptResponse{
		OauthAttemptId: persisted.ID,
		State:          state,
		AuthorizeUrl:   authorizeURL,
		ExpiresAt:      timestamppb.New(persisted.ExpiresAt),
	}, nil
}

func (s *oauthService) Complete(
	ctx context.Context,
	req *oauthpb.CompleteOAuthAttemptRequest,
) (*oauthpb.CompleteOAuthAttemptResponse, error) {
	if err := validateCompleteRequest(req); err != nil {
		return nil, err
	}
	if err := s.access.ValidateStation(ctx, strings.TrimSpace(req.GetStationPeerId())); err != nil {
		return completeFailure(errOAuthBindingMismatch), nil
	}

	binding := completeAttemptBinding(req)
	attempt, err := s.repository.ClaimCallback(ctx, callbackClaim{
		attemptBinding: binding,
		Provider:       strings.ToLower(strings.TrimSpace(req.GetProvider())),
		GateID:         strings.TrimSpace(req.GetGateId()),
		RedirectURI:    strings.TrimSpace(req.GetRedirectUri()),
		StateHash:      hashBinding(req.GetState()),
		PKCEChallenge:  pkceChallenge(req.GetPkceVerifier()),
		NonceHash:      hashBinding(req.GetNonce()),
		ClaimedAt:      s.now(),
	})
	if err != nil {
		return completeFailure(err), nil
	}
	provider, err := providerConfiguration(req.GetProvider(), req.GetRedirectUri())
	if err != nil {
		return s.failProvider(ctx, attempt.ID, "OAUTH_PROVIDER_UNAVAILABLE")
	}
	identity, err := s.providers.Exchange(ctx, provider, req.GetCode(), req.GetPkceVerifier())
	if err != nil {
		return s.failProvider(ctx, attempt.ID, "OAUTH_PROVIDER_ERROR")
	}

	actorRecord, actorRef, err := s.actors.Resolve(ctx, identity)
	if err != nil {
		_ = s.repository.SetAttemptOutcome(
			ctx,
			attempt.ID,
			oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FAILED,
			oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_PROVIDER_ERROR,
			"OAUTH_IDENTITY_RESOLUTION_FAILED",
		)
		return nil, fmt.Errorf("resolve OAuth actor: %w", err)
	}
	candidateID, err := randomPrefixedID("oauth-candidate-", 16)
	if err != nil {
		return nil, fmt.Errorf("generate OAuth candidate ID: %w", err)
	}
	now := s.now()
	expiresAt := now.Add(oauthCandidateLifetime)
	if attempt.ExpiresAt.Before(expiresAt) {
		expiresAt = attempt.ExpiresAt
	}
	candidate := &dbmodel.OAuthSessionCandidate{
		ID:                  candidateID,
		OAuthAttemptID:      attempt.ID,
		AccessAttemptID:     attempt.AccessAttemptID,
		StationPeerID:       attempt.StationPeerID,
		DeviceID:            attempt.DeviceID,
		LifecycleGeneration: attempt.LifecycleGeneration,
		LiveBindingKey:      attempt.LiveBindingKey,
		ActorID:             actorRecord.ID,
		ActorPTID:           actorRef.GetPtid(),
		ActorKind:           int32(actorRef.GetKind()),
		ActorUsername:       actorRecord.PreferredUsername,
		ActorEmail:          actorRecord.Email,
		State:               candidateStateInactive,
		ExpiresAt:           expiresAt,
	}
	if err := s.repository.SaveCandidate(ctx, attempt, candidate); err != nil {
		return nil, fmt.Errorf("persist OAuth session candidate: %w", err)
	}

	decision, err := s.access.BindCandidate(
		ctx,
		attempt.AccessAttemptID,
		attempt.StationPeerID,
		attempt.GateID,
		attempt.DeviceID,
		attempt.LifecycleGeneration,
		actorRef,
		candidate.ActorUsername,
		candidate.ActorEmail,
	)
	if err != nil {
		if markErr := s.repository.MarkDenied(
			ctx,
			binding,
			"OAUTH_ACCESS_REEVALUATION_FAILED",
		); markErr != nil {
			return nil, fmt.Errorf(
				"re-evaluate Access Gate after OAuth: %w; persist denial: %v",
				err,
				markErr,
			)
		}
		return nil, fmt.Errorf("re-evaluate Access Gate after OAuth: %w", err)
	}
	return s.completeFromDecision(ctx, binding, candidate, decision)
}

func (s *oauthService) Status(
	ctx context.Context,
	req *oauthpb.GetOAuthAttemptRequest,
) (*oauthpb.GetOAuthAttemptResponse, error) {
	binding, err := statusAttemptBinding(req)
	if err != nil {
		return nil, err
	}
	if err := s.access.ValidateStation(ctx, binding.StationPeerID); err != nil {
		return bindingMismatchStatus(), nil
	}
	snapshot, err := s.repository.FindBoundSnapshot(ctx, binding)
	if err != nil {
		if errors.Is(err, errOAuthBindingMismatch) {
			return bindingMismatchStatus(), nil
		}
		return nil, err
	}
	response, err := s.snapshotStatus(ctx, snapshot)
	if err != nil {
		return nil, err
	}
	if snapshot.Candidate == nil ||
		snapshot.Envelope != nil ||
		snapshot.Candidate.State == candidateStateActive ||
		isTerminalOAuthState(oauthpb.OAuthAttemptState(snapshot.Attempt.State)) {
		return response, nil
	}

	decision, err := s.access.Reevaluate(ctx, snapshot.Attempt.AccessAttemptID, snapshot.Attempt.StationPeerID)
	if err != nil {
		return nil, fmt.Errorf("re-evaluate OAuth Access Gate: %w", err)
	}
	response.AccessDecision = decision
	switch decision.GetState() {
	case accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED:
		finalized, err := s.finalize(ctx, binding)
		if err != nil {
			if errors.Is(err, errOAuthAttemptCancelled) ||
				errors.Is(err, errOAuthAttemptExpired) ||
				errors.Is(err, errOAuthAccessNotGranted) {
				refreshed, readErr := s.repository.FindBoundSnapshot(ctx, binding)
				if readErr != nil {
					return nil, readErr
				}
				return s.snapshotStatus(ctx, refreshed)
			}
			return nil, err
		}
		return s.snapshotStatus(ctx, finalized)
	case accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED,
		accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_FAILED:
		if err := s.repository.MarkDenied(ctx, binding, "OAUTH_ACCESS_DENIED"); err != nil {
			return nil, err
		}
		response.State = oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FAILED
		response.Result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_DENIED
		response.ErrorCode = "OAUTH_ACCESS_DENIED"
	default:
		response.State = oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FOLLOWING_GATE
		response.Result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED
	}
	return response, nil
}

func (s *oauthService) Cancel(
	ctx context.Context,
	req *oauthpb.CancelOAuthAttemptRequest,
) (*oauthpb.CancelOAuthAttemptResponse, error) {
	binding, err := cancelAttemptBinding(req)
	if err != nil {
		return nil, err
	}
	if err := s.access.ValidateStation(ctx, binding.StationPeerID); err != nil {
		return &oauthpb.CancelOAuthAttemptResponse{
			Result: oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH,
		}, nil
	}
	result, err := s.repository.CancelAttempt(ctx, binding, s.now())
	if err != nil {
		if errors.Is(err, errOAuthBindingMismatch) {
			return &oauthpb.CancelOAuthAttemptResponse{
				Result: oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH,
			}, nil
		}
		return nil, err
	}
	return &oauthpb.CancelOAuthAttemptResponse{Result: result}, nil
}

func (s *oauthService) Acknowledge(
	ctx context.Context,
	req *oauthpb.AcknowledgeOAuthCredentialRequest,
) (*oauthpb.AcknowledgeOAuthCredentialResponse, error) {
	binding, err := acknowledgeAttemptBinding(req)
	if err != nil {
		return nil, err
	}
	if err := s.access.ValidateStation(ctx, binding.StationPeerID); err != nil {
		return &oauthpb.AcknowledgeOAuthCredentialResponse{
			Result: oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH,
		}, nil
	}
	result, err := s.repository.Acknowledge(ctx, binding, s.now())
	if err != nil {
		if errors.Is(err, errOAuthBindingMismatch) {
			return &oauthpb.AcknowledgeOAuthCredentialResponse{
				Result: oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH,
			}, nil
		}
		return nil, err
	}
	return &oauthpb.AcknowledgeOAuthCredentialResponse{Result: result}, nil
}

func (s *oauthService) completeFromDecision(
	ctx context.Context,
	binding attemptBinding,
	candidate *dbmodel.OAuthSessionCandidate,
	decision *accessgatepb.AccessDecision,
) (*oauthpb.CompleteOAuthAttemptResponse, error) {
	response := &oauthpb.CompleteOAuthAttemptResponse{
		Result:           oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED,
		SessionCandidate: candidateProto(candidate),
		AccessDecision:   decision,
	}
	switch decision.GetState() {
	case accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED:
		snapshot, err := s.finalize(ctx, binding)
		if err != nil {
			if errors.Is(err, errOAuthAttemptCancelled) ||
				errors.Is(err, errOAuthAttemptExpired) {
				return completeFailure(err), nil
			}
			return nil, err
		}
		response.Result = oauthpb.OAuthAttemptResult(snapshot.Attempt.Result)
		response.SessionCandidate = candidateProto(snapshot.Candidate)
		response.CredentialEnvelope, err = s.envelopeForSnapshot(
			ctx,
			snapshot,
		)
		if err != nil {
			return nil, err
		}
	case accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED,
		accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_FAILED:
		if err := s.repository.MarkDenied(ctx, binding, "OAUTH_ACCESS_DENIED"); err != nil {
			return nil, err
		}
		response.Result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_DENIED
		response.ErrorCode = "OAUTH_ACCESS_DENIED"
	default:
		if err := s.repository.SetAttemptOutcome(
			ctx,
			candidate.OAuthAttemptID,
			oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FOLLOWING_GATE,
			oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED,
			"",
		); err != nil {
			return nil, err
		}
	}
	return response, nil
}

func (s *oauthService) finalize(
	ctx context.Context,
	binding attemptBinding,
) (*oauthSnapshot, error) {
	return s.repository.FinalizeGranted(ctx, binding, func(
		ctx context.Context,
		accessAttempt *dbmodel.AccessAttempt,
		attempt *dbmodel.OAuthAttempt,
		candidate *dbmodel.OAuthSessionCandidate,
	) (*finalizedCredential, error) {
		record, credential, err := s.issuer.Prepare(
			ctx,
			candidate,
			accessAttempt.Platform,
			accessAttempt.DecisionRevision,
			s.now(),
		)
		if err != nil {
			return nil, err
		}
		expiresAt := candidate.ExpiresAt
		if record.ExpiresAt.Before(expiresAt) {
			expiresAt = record.ExpiresAt
		}
		envelope, err := s.sealer.Seal(
			ctx,
			accessAttempt,
			attempt,
			candidate,
			record.SessionID,
			credential,
			expiresAt,
		)
		if err != nil {
			return nil, err
		}
		return &finalizedCredential{Session: record, Envelope: envelope}, nil
	})
}

func (s *oauthService) failProvider(
	ctx context.Context,
	attemptID, errorCode string,
) (*oauthpb.CompleteOAuthAttemptResponse, error) {
	if err := s.repository.SetAttemptOutcome(
		ctx,
		attemptID,
		oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FAILED,
		oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_PROVIDER_ERROR,
		errorCode,
	); err != nil {
		return nil, err
	}
	return &oauthpb.CompleteOAuthAttemptResponse{
		Result:    oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_PROVIDER_ERROR,
		ErrorCode: errorCode,
	}, nil
}

func (s *oauthService) snapshotStatus(
	ctx context.Context,
	snapshot *oauthSnapshot,
) (*oauthpb.GetOAuthAttemptResponse, error) {
	response := &oauthpb.GetOAuthAttemptResponse{
		State:     oauthpb.OAuthAttemptState(snapshot.Attempt.State),
		Result:    oauthpb.OAuthAttemptResult(snapshot.Attempt.Result),
		ExpiresAt: timestamppb.New(snapshot.Attempt.ExpiresAt),
		ErrorCode: snapshot.Attempt.ErrorCode,
	}
	if snapshot.Candidate != nil {
		response.SessionCandidate = candidateProto(snapshot.Candidate)
		var err error
		response.CredentialEnvelope, err = s.envelopeForSnapshot(ctx, snapshot)
		if err != nil {
			return nil, err
		}
	}
	return response, nil
}

func (s *oauthService) envelopeForSnapshot(
	ctx context.Context,
	snapshot *oauthSnapshot,
) (*oauthpb.OAuthCredentialEnvelope, error) {
	if snapshot == nil || snapshot.Envelope == nil || snapshot.Candidate == nil {
		return nil, nil
	}
	actorRef, err := s.actors.ResolveReference(
		ctx,
		snapshot.Candidate.ActorPTID,
	)
	if err != nil {
		return nil, fmt.Errorf("resolve OAuth credential actor reference: %w", err)
	}
	if actorRef == nil || actorRef.GetPtid() != snapshot.Candidate.ActorPTID {
		return nil, errors.New("OAuth credential actor reference is invalid")
	}
	actorRef.Kind = model.ActorKind(snapshot.Candidate.ActorKind)
	return envelopeProto(snapshot.Envelope, snapshot.Candidate, actorRef), nil
}

func bindingMismatchStatus() *oauthpb.GetOAuthAttemptResponse {
	return &oauthpb.GetOAuthAttemptResponse{
		Result:    oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH,
		ErrorCode: "OAUTH_BINDING_MISMATCH",
	}
}

func completeFailure(err error) *oauthpb.CompleteOAuthAttemptResponse {
	result := oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH
	code := "OAUTH_BINDING_MISMATCH"
	switch {
	case errors.Is(err, errOAuthAttemptExpired):
		result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED
		code = "OAUTH_ATTEMPT_EXPIRED"
	case errors.Is(err, errOAuthAttemptReplay):
		result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_REPLAYED
		code = "OAUTH_CALLBACK_REPLAYED"
	case errors.Is(err, errOAuthAttemptCancelled):
		result = oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_CANCELLED
		code = "OAUTH_ATTEMPT_CANCELLED"
	}
	return &oauthpb.CompleteOAuthAttemptResponse{Result: result, ErrorCode: code}
}

func validateStartRequest(req *oauthpb.StartOAuthAttemptRequest) error {
	if req == nil ||
		strings.TrimSpace(req.GetProvider()) == "" ||
		strings.TrimSpace(req.GetStationPeerId()) == "" ||
		strings.TrimSpace(req.GetAccessAttemptId()) == "" ||
		strings.TrimSpace(req.GetGateId()) == "" ||
		strings.TrimSpace(req.GetRedirectUri()) == "" ||
		strings.TrimSpace(req.GetPkceChallenge()) == "" ||
		strings.TrimSpace(req.GetNonceHash()) == "" ||
		strings.TrimSpace(req.GetDeviceId()) == "" ||
		req.GetLifecycleGeneration() == 0 {
		return fmt.Errorf("OAuth provider and all binding fields are required")
	}
	if req.GetActionType() != accessgatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH {
		return fmt.Errorf("OAuth action type must be AUTH_OAUTH")
	}
	if req.GetPkceMethod() != "S256" {
		return fmt.Errorf("OAuth PKCE method must be S256")
	}
	if !validSHA256Binding(req.GetPkceChallenge()) {
		return fmt.Errorf("OAuth PKCE challenge must be an unpadded SHA-256 base64url value")
	}
	if !validSHA256Binding(req.GetNonceHash()) {
		return fmt.Errorf("OAuth nonce hash must be an unpadded SHA-256 base64url value")
	}
	if len(req.GetAttemptSecretHash()) != sha256.Size {
		return fmt.Errorf("OAuth attempt secret hash must be SHA-256")
	}
	if _, err := ecdh.X25519().NewPublicKey(req.GetCredentialDeliveryPublicKey()); err != nil {
		return fmt.Errorf("OAuth credential delivery public key is invalid: %w", err)
	}
	return nil
}

func validateCompleteRequest(req *oauthpb.CompleteOAuthAttemptRequest) error {
	if req == nil ||
		strings.TrimSpace(req.GetOauthAttemptId()) == "" ||
		strings.TrimSpace(req.GetState()) == "" ||
		strings.TrimSpace(req.GetCode()) == "" ||
		strings.TrimSpace(req.GetPkceVerifier()) == "" ||
		strings.TrimSpace(req.GetNonce()) == "" ||
		strings.TrimSpace(req.GetProvider()) == "" ||
		strings.TrimSpace(req.GetStationPeerId()) == "" ||
		strings.TrimSpace(req.GetAccessAttemptId()) == "" ||
		strings.TrimSpace(req.GetGateId()) == "" ||
		strings.TrimSpace(req.GetRedirectUri()) == "" ||
		len(req.GetAttemptSecret()) == 0 ||
		strings.TrimSpace(req.GetDeviceId()) == "" ||
		req.GetLifecycleGeneration() == 0 {
		return fmt.Errorf("OAuth callback and all binding fields are required")
	}
	if !pkceVerifierPattern.MatchString(req.GetPkceVerifier()) {
		return fmt.Errorf("OAuth PKCE verifier is invalid")
	}
	return nil
}

func statusAttemptBinding(req *oauthpb.GetOAuthAttemptRequest) (attemptBinding, error) {
	if req == nil {
		return attemptBinding{}, errors.New("OAuth status request is required")
	}
	return validateAttemptBinding(attemptBinding{
		AttemptID:           strings.TrimSpace(req.GetOauthAttemptId()),
		StationPeerID:       strings.TrimSpace(req.GetStationPeerId()),
		AccessAttemptID:     strings.TrimSpace(req.GetAccessAttemptId()),
		DeviceID:            strings.TrimSpace(req.GetDeviceId()),
		LifecycleGeneration: req.GetLifecycleGeneration(),
		AttemptSecret:       append([]byte(nil), req.GetAttemptSecret()...),
	})
}

func cancelAttemptBinding(req *oauthpb.CancelOAuthAttemptRequest) (attemptBinding, error) {
	if req == nil {
		return attemptBinding{}, errors.New("OAuth cancellation request is required")
	}
	return validateAttemptBinding(attemptBinding{
		AttemptID:           strings.TrimSpace(req.GetOauthAttemptId()),
		StationPeerID:       strings.TrimSpace(req.GetStationPeerId()),
		AccessAttemptID:     strings.TrimSpace(req.GetAccessAttemptId()),
		DeviceID:            strings.TrimSpace(req.GetDeviceId()),
		LifecycleGeneration: req.GetLifecycleGeneration(),
		AttemptSecret:       append([]byte(nil), req.GetAttemptSecret()...),
	})
}

func acknowledgeAttemptBinding(req *oauthpb.AcknowledgeOAuthCredentialRequest) (attemptBinding, error) {
	if req == nil {
		return attemptBinding{}, errors.New("OAuth acknowledgement request is required")
	}
	return validateAttemptBinding(attemptBinding{
		AttemptID:           strings.TrimSpace(req.GetOauthAttemptId()),
		StationPeerID:       strings.TrimSpace(req.GetStationPeerId()),
		AccessAttemptID:     strings.TrimSpace(req.GetAccessAttemptId()),
		DeviceID:            strings.TrimSpace(req.GetDeviceId()),
		LifecycleGeneration: req.GetLifecycleGeneration(),
		AttemptSecret:       append([]byte(nil), req.GetAttemptSecret()...),
	})
}

func completeAttemptBinding(req *oauthpb.CompleteOAuthAttemptRequest) attemptBinding {
	return attemptBinding{
		AttemptID:           strings.TrimSpace(req.GetOauthAttemptId()),
		StationPeerID:       strings.TrimSpace(req.GetStationPeerId()),
		AccessAttemptID:     strings.TrimSpace(req.GetAccessAttemptId()),
		DeviceID:            strings.TrimSpace(req.GetDeviceId()),
		LifecycleGeneration: req.GetLifecycleGeneration(),
		AttemptSecret:       append([]byte(nil), req.GetAttemptSecret()...),
	}
}

func validateAttemptBinding(binding attemptBinding) (attemptBinding, error) {
	if binding.AttemptID == "" ||
		binding.StationPeerID == "" ||
		binding.AccessAttemptID == "" ||
		binding.DeviceID == "" ||
		binding.LifecycleGeneration == 0 ||
		len(binding.AttemptSecret) == 0 {
		return attemptBinding{}, errors.New("OAuth attempt and all device bindings are required")
	}
	return binding, nil
}

func validSHA256Binding(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && !strings.Contains(value, "=")
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func hashBinding(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func deriveOAuthState(attemptID string, attemptSecretHash []byte) string {
	mac := hmac.New(sha256.New, attemptSecretHash)
	_, _ = mac.Write([]byte("peers-touch/oauth-state/v1\x00"))
	_, _ = mac.Write([]byte(attemptID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func oauthLiveBindingKey(accessAttemptID, deviceID string, lifecycleGeneration uint64) string {
	return fmt.Sprintf("%s\x00%s\x00%d", strings.TrimSpace(accessAttemptID), strings.TrimSpace(deviceID), lifecycleGeneration)
}

func randomOpaqueValue(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func randomPrefixedID(prefix string, size int) (string, error) {
	value, err := randomOpaqueValue(size)
	if err != nil {
		return "", err
	}
	return prefix + value, nil
}

func candidateProto(candidate *dbmodel.OAuthSessionCandidate) *model.AuthSessionCandidate {
	if candidate == nil {
		return nil
	}
	return &model.AuthSessionCandidate{
		CandidateId: candidate.ID,
		ActorRef: &model.ActorRef{
			Ptid: candidate.ActorPTID,
			Kind: model.ActorKind(candidate.ActorKind),
		},
		OauthAttemptId:      candidate.OAuthAttemptID,
		AccessAttemptId:     candidate.AccessAttemptID,
		StationPeerId:       candidate.StationPeerID,
		IssuedAt:            timestamppb.New(candidate.CreatedAt),
		ExpiresAt:           timestamppb.New(candidate.ExpiresAt),
		DeviceId:            candidate.DeviceID,
		LifecycleGeneration: candidate.LifecycleGeneration,
		DecisionRevision:    candidate.DecisionRevision,
	}
}

type stationAccessCoordinator struct{}

func (stationAccessCoordinator) ValidateStation(_ context.Context, stationPeerID string) error {
	return accessgate.ValidateStationPeerID(stationPeerID)
}

func (stationAccessCoordinator) Validate(
	ctx context.Context,
	accessAttemptID, stationPeerID, gateID, deviceID string,
	lifecycleGeneration uint64,
	actionType accessgatepb.AccessGateType,
) error {
	return accessgate.ValidateOAuthBinding(
		ctx,
		accessAttemptID,
		stationPeerID,
		gateID,
		deviceID,
		lifecycleGeneration,
		actionType,
	)
}

func (stationAccessCoordinator) BindCandidate(
	ctx context.Context,
	accessAttemptID, stationPeerID, gateID, deviceID string,
	lifecycleGeneration uint64,
	actorRef *model.ActorRef,
	username, email string,
) (*accessgatepb.AccessDecision, error) {
	return accessgate.BindOAuthCandidate(
		ctx,
		accessAttemptID,
		stationPeerID,
		gateID,
		deviceID,
		lifecycleGeneration,
		actorRef,
		username,
		email,
	)
}

func (stationAccessCoordinator) Reevaluate(
	ctx context.Context,
	accessAttemptID, stationPeerID string,
) (*accessgatepb.AccessDecision, error) {
	return accessgate.ReevaluateOAuthCandidate(ctx, accessAttemptID, stationPeerID)
}

type stationActorResolver struct{}

func (stationActorResolver) Resolve(
	ctx context.Context,
	identity *coreauth.OAuth2Identity,
) (*dbmodel.Actor, *model.ActorRef, error) {
	baseURL := strings.TrimSpace(config.Get("peers", "node", "server", "baseurl").String(""))
	actorRecord, err := touchauth.ResolveOAuthIdentityActor(ctx, identity, baseURL)
	if err != nil {
		return nil, nil, err
	}
	actorRef := touchactor.ProtoActorRef(actorRecord)
	if actorRef == nil || strings.TrimSpace(actorRef.GetPtid()) == "" {
		return nil, nil, fmt.Errorf("resolved OAuth actor has no PTID")
	}
	return actorRecord, actorRef, nil
}

func (stationActorResolver) ResolveReference(
	ctx context.Context,
	ptid string,
) (*model.ActorRef, error) {
	actorRecord, err := touchactor.GetActorByPTID(ctx, ptid)
	if err != nil {
		return nil, err
	}
	actorRef := touchactor.ProtoActorRef(actorRecord)
	if actorRef == nil || strings.TrimSpace(actorRef.GetPtid()) == "" {
		return nil, fmt.Errorf("resolved OAuth actor has no PTID")
	}
	return actorRef, nil
}

type stationSessionCredentialIssuer struct{}

func (stationSessionCredentialIssuer) Prepare(
	ctx context.Context,
	candidate *dbmodel.OAuthSessionCandidate,
	platform string,
	decisionRevision uint64,
	now time.Time,
) (*session.SessionRecord, *model.LoginResponse, error) {
	actorRecord, err := touchactor.GetActorByPTID(ctx, candidate.ActorPTID)
	if err != nil {
		return nil, nil, err
	}
	deviceType, err := oauthSessionDeviceType(platform)
	if err != nil {
		return nil, nil, err
	}
	record, response, err := touchauth.PrepareOAuthSession(
		ctx,
		actorRecord,
		touchauth.OAuthSessionBinding{
			CandidateID:            candidate.ID,
			AccessAttemptID:        candidate.AccessAttemptID,
			StationPeerID:          candidate.StationPeerID,
			AccessDecisionRevision: decisionRevision,
			DeviceType:             deviceType,
			DeviceID:               candidate.DeviceID,
			LifecycleGeneration:    candidate.LifecycleGeneration,
		},
		now,
	)
	if err != nil {
		return nil, nil, err
	}
	response.ActorRef.Kind = model.ActorKind(candidate.ActorKind)
	return record, response, nil
}

func oauthSessionDeviceType(platform string) (session.DeviceType, error) {
	switch strings.TrimSpace(platform) {
	case string(session.DeviceTypeDesktop):
		return session.DeviceTypeDesktop, nil
	case string(session.DeviceTypeMobile):
		return session.DeviceTypeMobile, nil
	case string(session.DeviceTypeWeb):
		return session.DeviceTypeWeb, nil
	default:
		return "", fmt.Errorf("unsupported OAuth client platform %q", platform)
	}
}
