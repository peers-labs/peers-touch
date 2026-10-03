package oauth

import (
	"context"
	"crypto/ecdh"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchauth "github.com/peers-labs/peers-touch/station/frame/touch/auth"
	accessgatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	oauthbridge "github.com/peers-labs/peers-touch/station/frame/touch/model/oauthbridge"
	"gorm.io/gorm"
)

// CompleteBrokerBridge converts a verified broker assertion into the canonical
// Station OAuth candidate lifecycle. The returned credential remains inactive
// until the existing OAuth acknowledgement endpoint activates it.
func CompleteBrokerBridge(
	ctx context.Context,
	req *oauthbridge.BrokerOAuthBridgeRequest,
) (*oauthpb.CompleteOAuthAttemptResponse, error) {
	database := func(ctx context.Context) (*gorm.DB, error) {
		return store.GetRDS(ctx)
	}
	return newStationOAuthService(database).CompleteBrokerBridge(
		ctx,
		req,
	)
}

func (s *oauthService) CompleteBrokerBridge(
	ctx context.Context,
	req *oauthbridge.BrokerOAuthBridgeRequest,
) (*oauthpb.CompleteOAuthAttemptResponse, error) {
	attemptSecretHash, err := validateBrokerBridgeBinding(req)
	if err != nil {
		return nil, err
	}
	if err := s.access.Validate(
		ctx,
		req.GetAccessAttemptId(),
		req.GetStationPeerId(),
		req.GetGateId(),
		req.GetDeviceId(),
		req.GetLifecycleGeneration(),
		accessgatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH,
	); err != nil {
		return nil, fmt.Errorf("validate broker OAuth access binding: %w", err)
	}
	identity, err := touchauth.BridgeIdentity(req)
	if err != nil {
		return nil, err
	}
	actorRecord, actorRef, err := s.actors.Resolve(ctx, identity)
	if err != nil {
		return nil, fmt.Errorf("resolve broker OAuth actor: %w", err)
	}

	attemptID, err := randomPrefixedID("oauth-broker-", 16)
	if err != nil {
		return nil, fmt.Errorf("generate broker OAuth attempt ID: %w", err)
	}
	now := s.now()
	liveBindingKey := oauthLiveBindingKey(
		req.GetAccessAttemptId(),
		req.GetDeviceId(),
		req.GetLifecycleGeneration(),
	)
	attempt := &dbmodel.OAuthAttempt{
		ID:                          attemptID,
		Provider:                    strings.ToLower(strings.TrimSpace(req.GetProvider())),
		StationPeerID:               strings.TrimSpace(req.GetStationPeerId()),
		AccessAttemptID:             strings.TrimSpace(req.GetAccessAttemptId()),
		GateID:                      strings.TrimSpace(req.GetGateId()),
		RedirectURI:                 "broker:" + strings.TrimSpace(req.GetSiteId()),
		PKCEChallenge:               strings.TrimSpace(req.GetReceiverChallenge()),
		NonceHash:                   hashBinding(req.GetAssertionId()),
		DeviceID:                    strings.TrimSpace(req.GetDeviceId()),
		LifecycleGeneration:         req.GetLifecycleGeneration(),
		AttemptSecretHash:           append([]byte(nil), attemptSecretHash...),
		CredentialDeliveryPublicKey: append([]byte(nil), req.GetCredentialDeliveryPublicKey()...),
		LiveBindingKey:              &liveBindingKey,
		State:                       int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_CALLBACK_CLAIMED),
		Result:                      int32(oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_PENDING),
		ClaimedAt:                   &now,
		ConsumedAt:                  &now,
		ExpiresAt:                   now.Add(oauthAttemptLifetime),
	}
	attempt.StateHash = hashBinding(deriveOAuthState(attempt.ID, attempt.AttemptSecretHash))
	attempt, err = s.repository.CreateOrRecoverAttempt(ctx, attempt)
	if err != nil {
		return nil, fmt.Errorf("persist broker OAuth attempt: %w", err)
	}

	candidateID, err := randomPrefixedID("oauth-candidate-", 16)
	if err != nil {
		return nil, fmt.Errorf("generate broker OAuth candidate ID: %w", err)
	}
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
		return nil, fmt.Errorf("persist broker OAuth candidate: %w", err)
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
		binding := brokerAttemptBinding(req, attempt.ID)
		if markErr := s.repository.MarkDenied(
			ctx,
			binding,
			"OAUTH_ACCESS_REEVALUATION_FAILED",
		); markErr != nil {
			return nil, fmt.Errorf(
				"re-evaluate Access Gate after broker OAuth: %w; persist denial: %v",
				err,
				markErr,
			)
		}
		return nil, fmt.Errorf("re-evaluate Access Gate after broker OAuth: %w", err)
	}
	return s.completeFromDecision(
		ctx,
		brokerAttemptBinding(req, attempt.ID),
		candidate,
		decision,
	)
}

func validateBrokerBridgeBinding(
	req *oauthbridge.BrokerOAuthBridgeRequest,
) ([]byte, error) {
	if req == nil ||
		req.GetPurpose() != "account_login" ||
		strings.TrimSpace(req.GetProvider()) == "" ||
		strings.TrimSpace(req.GetSiteId()) == "" ||
		strings.TrimSpace(req.GetAssertionId()) == "" ||
		strings.TrimSpace(req.GetStationPeerId()) == "" ||
		strings.TrimSpace(req.GetAccessAttemptId()) == "" ||
		strings.TrimSpace(req.GetGateId()) == "" ||
		strings.TrimSpace(req.GetDeviceId()) == "" ||
		req.GetLifecycleGeneration() == 0 {
		return nil, errors.New("broker OAuth binding is incomplete")
	}
	challenge, err := base64.RawURLEncoding.DecodeString(
		strings.TrimSpace(req.GetReceiverChallenge()),
	)
	if err != nil || len(challenge) != sha256.Size {
		return nil, errors.New("broker OAuth receiver challenge is invalid")
	}
	verifier := []byte(req.GetReceiverVerifier())
	sum := sha256.Sum256(verifier)
	if !pkceVerifierPattern.MatchString(req.GetReceiverVerifier()) ||
		subtle.ConstantTimeCompare(challenge, sum[:]) != 1 {
		return nil, errors.New("broker OAuth receiver proof is invalid")
	}
	if _, err := ecdh.X25519().NewPublicKey(req.GetCredentialDeliveryPublicKey()); err != nil {
		return nil, fmt.Errorf("broker OAuth credential delivery public key is invalid: %w", err)
	}
	return sum[:], nil
}

func brokerAttemptBinding(
	req *oauthbridge.BrokerOAuthBridgeRequest,
	attemptID string,
) attemptBinding {
	return attemptBinding{
		AttemptID:           attemptID,
		StationPeerID:       strings.TrimSpace(req.GetStationPeerId()),
		AccessAttemptID:     strings.TrimSpace(req.GetAccessAttemptId()),
		DeviceID:            strings.TrimSpace(req.GetDeviceId()),
		LifecycleGeneration: req.GetLifecycleGeneration(),
		AttemptSecret:       []byte(req.GetReceiverVerifier()),
	}
}
