package memory

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
)

type Store struct {
	mu          sync.RWMutex
	sessions    map[string]entity.AuthSession
	identities  map[string]entity.OAuthIdentity
	credentials map[string]entity.OAuthCredential
	refreshOps  map[string]map[string]refreshOperation
	events      map[string]entity.AuditEvent
}

type refreshOperation struct {
	claimID              string
	credentialGeneration uint64
	state                entity.CredentialRefreshClaimState
	claimedAt            time.Time
	errorCode            string
}

func NewStore() *Store {
	return &Store{
		sessions:    make(map[string]entity.AuthSession),
		identities:  make(map[string]entity.OAuthIdentity),
		credentials: make(map[string]entity.OAuthCredential),
		refreshOps:  make(map[string]map[string]refreshOperation),
		events:      make(map[string]entity.AuditEvent),
	}
}

func (s *Store) CreateAuthorization(_ context.Context, session entity.AuthSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.sessions[session.State]; ok {
		if sameSession(existing, session) {
			return nil
		}
		return repository.ErrAuthorizationExists
	}
	s.sessions[session.State] = session
	transactionID := digest(session.State)
	event := entity.AuditEvent{
		SchemaVersion: 1,
		EventID:       digest("start\x00" + transactionID),
		EventType:     entity.AuditAuthorizationStarted,
		OccurredAt:    session.CreatedAt.UTC(),
		SiteID:        session.SiteID,
		Provider:      session.Provider,
		TransactionID: transactionID,
		Result:        "success",
	}
	s.events[event.EventID] = event
	return nil
}

func (s *Store) FindAuthorization(_ context.Context, state string) (*entity.AuthSession, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[state]
	if !ok {
		return nil, nil
	}
	out := session
	return &out, nil
}

func (s *Store) CompleteAuthorization(_ context.Context, completion entity.AuthorizationCompletion) (*entity.OAuthIdentity, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[completion.State]
	if !ok {
		return nil, repository.ErrAuthorizationNotFound
	}
	if session.ConsumedAt != nil {
		eventID := digest("success\x00" + digest(completion.State) + "\x00" + completion.CompletionID)
		event, exists := s.events[eventID]
		if !exists || event.IdentityID == "" {
			return nil, repository.ErrAuthorizationConsumed
		}
		identity := s.identities[event.IdentityID]
		return cloneIdentity(identity), nil
	}
	if completion.CompletedAt.After(session.ExpiresAt) {
		return nil, repository.ErrAuthorizationExpired
	}
	if completion.Identity.ProviderUserID == "" || completion.Tokens.AccessToken == "" {
		return nil, repository.ErrRecordCorrupt
	}

	identityID := digest(strings.Join([]string{
		session.SiteID,
		string(session.Provider),
		completion.Identity.ProviderUserID,
	}, "\x00"))
	identity, exists := s.identities[identityID]
	if !exists {
		identity = entity.OAuthIdentity{
			SchemaVersion: 1,
			IdentityID:    identityID,
			SiteID:        session.SiteID,
			Provider:      session.Provider,
			FirstLoginAt:  completion.CompletedAt.UTC(),
		}
	}
	identity.ProviderUserID = completion.Identity.ProviderUserID
	identity.UnionID = completion.Identity.UnionID
	identity.Username = completion.Identity.Username
	identity.DisplayName = completion.Identity.DisplayName
	identity.AvatarURL = completion.Identity.AvatarURL
	identity.Email = completion.Identity.Email
	identity.EmailVerified = completion.Identity.EmailVerified
	identity.LastLoginAt = completion.CompletedAt.UTC()
	identity.LoginCount++

	currentCredential, hasCredential := s.credentials[identityID]
	refreshToken := completion.Tokens.RefreshToken
	if refreshToken == "" && hasCredential {
		refreshToken = currentCredential.RefreshToken
	}
	generation := uint64(1)
	if hasCredential {
		generation = currentCredential.Generation + 1
	}
	credential := entity.OAuthCredential{
		SchemaVersion:    1,
		IdentityID:       identityID,
		SiteID:           session.SiteID,
		Provider:         session.Provider,
		AccessToken:      completion.Tokens.AccessToken,
		RefreshToken:     refreshToken,
		TokenType:        completion.Tokens.TokenType,
		Scope:            completion.Tokens.Scope,
		ObtainedAt:       completion.Tokens.ObtainedAt.UTC(),
		AccessExpiresAt:  completion.Tokens.AccessExpiresAt,
		RefreshExpiresAt: completion.Tokens.RefreshExpiresAt,
		Generation:       generation,
	}
	consumedAt := completion.CompletedAt.UTC()
	session.ConsumedAt = &consumedAt
	s.sessions[completion.State] = session
	s.identities[identityID] = identity
	s.credentials[identityID] = credential
	event := entity.AuditEvent{
		SchemaVersion:   1,
		EventID:         digest("success\x00" + digest(completion.State) + "\x00" + completion.CompletionID),
		EventType:       entity.AuditLoginSucceeded,
		OccurredAt:      consumedAt,
		SiteID:          session.SiteID,
		Provider:        session.Provider,
		TransactionID:   digest(completion.State),
		IdentityID:      identityID,
		CodeFingerprint: completion.CodeFingerprint,
		Result:          "success",
	}
	s.events[event.EventID] = event
	return cloneIdentity(identity), nil
}

func (s *Store) RecordAuthorizationFailure(_ context.Context, failure entity.AuthorizationFailure) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	transactionID := digest(failure.State)
	occurredAt := failure.OccurredAt.UTC()
	eventID := digest("failure\x00" + transactionID + "\x00" + failure.CodeFingerprint + "\x00" + failure.ErrorCode + "\x00" + occurredAt.Format(time.RFC3339Nano))
	_, eventExists := s.events[eventID]
	siteID := ""
	provider := failure.Provider
	if session, ok := s.sessions[failure.State]; ok {
		siteID = session.SiteID
		provider = session.Provider
		if failure.Terminal && session.ConsumedAt == nil {
			session.ConsumedAt = &occurredAt
			s.sessions[failure.State] = session
		}
	}
	if !eventExists {
		s.events[eventID] = entity.AuditEvent{
			SchemaVersion:   1,
			EventID:         eventID,
			EventType:       entity.AuditLoginFailed,
			OccurredAt:      occurredAt,
			SiteID:          siteID,
			Provider:        provider,
			TransactionID:   transactionID,
			CodeFingerprint: failure.CodeFingerprint,
			Result:          "failure",
			ErrorCode:       failure.ErrorCode,
		}
	}
	return nil
}

func (s *Store) LoadCredential(_ context.Context, identityID string) (*entity.OAuthCredential, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	credential, ok := s.credentials[identityID]
	if !ok {
		return nil, repository.ErrCredentialNotFound
	}
	out := credential
	return &out, nil
}

func (s *Store) ClaimCredentialRefresh(
	_ context.Context,
	identityID, operationID string,
	claimedAt time.Time,
) (*entity.CredentialRefreshClaim, error) {
	identityID = strings.TrimSpace(identityID)
	operationID = strings.TrimSpace(operationID)
	if identityID == "" || operationID == "" {
		return nil, repository.ErrRecordCorrupt
	}
	claimID, err := newRefreshClaimID()
	if err != nil {
		return nil, repository.ErrStorageUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	credential, ok := s.credentials[identityID]
	if !ok {
		return nil, repository.ErrCredentialNotFound
	}
	if operation, found := s.refreshOps[identityID][operationID]; found {
		state := operation.state
		if state == entity.CredentialRefreshClaimCommitted {
			return refreshClaim(credential, operationID, "", state), nil
		}
		if state == entity.CredentialRefreshClaimReleased {
			for candidateID, candidate := range s.refreshOps[identityID] {
				if candidateID != operationID &&
					candidate.credentialGeneration == credential.Generation &&
					(candidate.state == entity.CredentialRefreshClaimAcquired ||
						candidate.state == entity.CredentialRefreshClaimUncertain) {
					return refreshClaim(
						credential,
						operationID,
						"",
						entity.CredentialRefreshClaimUncertain,
					), nil
				}
			}
			operation.claimID = claimID
			operation.credentialGeneration = credential.Generation
			operation.state = entity.CredentialRefreshClaimAcquired
			operation.claimedAt = claimedAt.UTC()
			operation.errorCode = ""
			s.refreshOps[identityID][operationID] = operation
			return refreshClaim(
				credential,
				operationID,
				claimID,
				entity.CredentialRefreshClaimAcquired,
			), nil
		}
		return refreshClaim(
			credential,
			operationID,
			"",
			entity.CredentialRefreshClaimUncertain,
		), nil
	}
	if credential.LastRefreshOperationID == operationID {
		return refreshClaim(
			credential,
			operationID,
			"",
			entity.CredentialRefreshClaimCommitted,
		), nil
	}
	for _, operation := range s.refreshOps[identityID] {
		if operation.credentialGeneration == credential.Generation &&
			(operation.state == entity.CredentialRefreshClaimAcquired ||
				operation.state == entity.CredentialRefreshClaimUncertain) {
			return refreshClaim(
				credential,
				operationID,
				"",
				entity.CredentialRefreshClaimUncertain,
			), nil
		}
	}
	if s.refreshOps[identityID] == nil {
		s.refreshOps[identityID] = make(map[string]refreshOperation)
	}
	s.refreshOps[identityID][operationID] = refreshOperation{
		claimID:              claimID,
		credentialGeneration: credential.Generation,
		state:                entity.CredentialRefreshClaimAcquired,
		claimedAt:            claimedAt.UTC(),
	}
	return refreshClaim(
		credential,
		operationID,
		claimID,
		entity.CredentialRefreshClaimAcquired,
	), nil
}

func (s *Store) ReleaseCredentialRefreshClaim(
	_ context.Context,
	claim entity.CredentialRefreshClaim,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, found := s.refreshOps[claim.IdentityID][claim.OperationID]
	if !found ||
		operation.claimID != claim.ClaimID ||
		operation.credentialGeneration != claim.CredentialGeneration {
		return repository.ErrCredentialRefreshUncertain
	}
	switch operation.state {
	case entity.CredentialRefreshClaimCommitted,
		entity.CredentialRefreshClaimReleased:
		return nil
	case entity.CredentialRefreshClaimAcquired:
		operation.state = entity.CredentialRefreshClaimReleased
		operation.errorCode = ""
		s.refreshOps[claim.IdentityID][claim.OperationID] = operation
		return nil
	default:
		return repository.ErrCredentialRefreshUncertain
	}
}

func (s *Store) ReplaceCredential(_ context.Context, refresh entity.CredentialRefresh) (*entity.OAuthCredential, error) {
	refresh.IdentityID = strings.TrimSpace(refresh.IdentityID)
	refresh.OperationID = strings.TrimSpace(refresh.OperationID)
	if refresh.IdentityID == "" ||
		refresh.OperationID == "" ||
		refresh.ClaimID == "" ||
		refresh.ExpectedGeneration == 0 {
		return nil, repository.ErrRecordCorrupt
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	credential, ok := s.credentials[refresh.IdentityID]
	if !ok {
		return nil, repository.ErrCredentialNotFound
	}
	operation, found := s.refreshOps[refresh.IdentityID][refresh.OperationID]
	if (found && operation.state == entity.CredentialRefreshClaimCommitted) ||
		credential.LastRefreshOperationID == refresh.OperationID {
		out := credential
		return &out, nil
	}
	if !found ||
		operation.claimID != refresh.ClaimID ||
		operation.credentialGeneration != refresh.ExpectedGeneration ||
		operation.state != entity.CredentialRefreshClaimAcquired {
		return nil, repository.ErrCredentialRefreshUncertain
	}
	if credential.Generation != refresh.ExpectedGeneration {
		return nil, repository.ErrCredentialRefreshUncertain
	}
	if strings.TrimSpace(refresh.Tokens.AccessToken) == "" {
		return nil, repository.ErrRecordCorrupt
	}
	refreshToken := refresh.Tokens.RefreshToken
	if refreshToken == "" {
		refreshToken = credential.RefreshToken
	}
	if refreshToken == "" {
		return nil, repository.ErrCredentialNotRefreshable
	}
	tokenType := refresh.Tokens.TokenType
	if tokenType == "" {
		tokenType = credential.TokenType
	}
	scope := refresh.Tokens.Scope
	if scope == "" {
		scope = credential.Scope
	}
	refreshExpiresAt := refresh.Tokens.RefreshExpiresAt
	if refreshExpiresAt == nil {
		refreshExpiresAt = credential.RefreshExpiresAt
	}
	credential.AccessToken = refresh.Tokens.AccessToken
	credential.RefreshToken = refreshToken
	credential.TokenType = tokenType
	credential.Scope = scope
	credential.ObtainedAt = refresh.Tokens.ObtainedAt.UTC()
	credential.AccessExpiresAt = refresh.Tokens.AccessExpiresAt
	credential.RefreshExpiresAt = refreshExpiresAt
	credential.Generation++
	credential.LastRefreshOperationID = refresh.OperationID
	s.credentials[refresh.IdentityID] = credential
	operation.state = entity.CredentialRefreshClaimCommitted
	s.refreshOps[refresh.IdentityID][refresh.OperationID] = operation
	event := entity.AuditEvent{
		SchemaVersion: 1,
		EventID:       digest("refresh\x00" + refresh.IdentityID + "\x00" + refresh.OperationID),
		EventType:     entity.AuditCredentialRefreshed,
		OccurredAt:    refresh.RefreshedAt.UTC(),
		SiteID:        credential.SiteID,
		Provider:      credential.Provider,
		IdentityID:    credential.IdentityID,
		Result:        "success",
	}
	s.events[event.EventID] = event
	out := credential
	return &out, nil
}

func (s *Store) MarkCredentialRefreshUncertain(
	_ context.Context,
	claim entity.CredentialRefreshClaim,
	errorCode string,
	occurredAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, found := s.refreshOps[claim.IdentityID][claim.OperationID]
	if !found ||
		operation.claimID != claim.ClaimID ||
		operation.credentialGeneration != claim.CredentialGeneration {
		return repository.ErrCredentialRefreshUncertain
	}
	if operation.state == entity.CredentialRefreshClaimCommitted ||
		operation.state == entity.CredentialRefreshClaimUncertain {
		return nil
	}
	operation.state = entity.CredentialRefreshClaimUncertain
	operation.errorCode = errorCode
	s.refreshOps[claim.IdentityID][claim.OperationID] = operation
	credential, found := s.credentials[claim.IdentityID]
	if !found {
		return repository.ErrCredentialNotFound
	}
	event := entity.AuditEvent{
		SchemaVersion: 1,
		EventID:       digest("refresh-uncertain\x00" + claim.IdentityID + "\x00" + claim.OperationID),
		EventType:     entity.AuditCredentialRefreshUncertain,
		OccurredAt:    occurredAt.UTC(),
		SiteID:        credential.SiteID,
		Provider:      credential.Provider,
		IdentityID:    credential.IdentityID,
		Result:        "failure",
		ErrorCode:     errorCode,
	}
	s.events[event.EventID] = event
	return nil
}

func (s *Store) AdminSnapshot(_ context.Context, limit int) (entity.AdminSnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 {
		limit = 100
	}
	result := entity.AdminSnapshot{GeneratedAt: time.Now().UTC()}
	for _, identity := range s.identities {
		admin := entity.AdminIdentity{
			IdentityID:    identity.IdentityID,
			SiteID:        identity.SiteID,
			Provider:      identity.Provider,
			Username:      identity.Username,
			DisplayName:   identity.DisplayName,
			Email:         identity.Email,
			EmailVerified: identity.EmailVerified,
			FirstLoginAt:  identity.FirstLoginAt,
			LastLoginAt:   identity.LastLoginAt,
			LoginCount:    identity.LoginCount,
		}
		if credential, ok := s.credentials[identity.IdentityID]; ok {
			admin.HasAccessToken = credential.AccessToken != ""
			admin.HasRefreshToken = credential.RefreshToken != ""
			admin.AccessExpiresAt = credential.AccessExpiresAt
			admin.RefreshExpiresAt = credential.RefreshExpiresAt
		}
		result.Identities = append(result.Identities, admin)
	}
	sort.Slice(result.Identities, func(i, j int) bool {
		return result.Identities[i].LastLoginAt.After(result.Identities[j].LastLoginAt)
	})
	events := make([]entity.AdminAuditEvent, 0, len(s.events))
	for _, event := range s.events {
		events = append(events, entity.AdminAuditEvent{
			EventID:    event.EventID,
			EventType:  event.EventType,
			OccurredAt: event.OccurredAt,
			SiteID:     event.SiteID,
			Provider:   event.Provider,
			IdentityID: event.IdentityID,
			Result:     event.Result,
			ErrorCode:  event.ErrorCode,
		})
	}
	sort.Slice(events, func(i, j int) bool {
		return events[i].OccurredAt.After(events[j].OccurredAt)
	})
	if len(events) > limit {
		events = events[:limit]
	}
	result.Events = events
	return result, nil
}

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func newRefreshClaimID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func refreshClaim(
	credential entity.OAuthCredential,
	operationID, claimID string,
	state entity.CredentialRefreshClaimState,
) *entity.CredentialRefreshClaim {
	return &entity.CredentialRefreshClaim{
		IdentityID:           credential.IdentityID,
		OperationID:          operationID,
		ClaimID:              claimID,
		CredentialGeneration: credential.Generation,
		State:                state,
		Credential:           credential,
	}
}

func cloneIdentity(value entity.OAuthIdentity) *entity.OAuthIdentity {
	out := value
	return &out
}

func sameSession(left, right entity.AuthSession) bool {
	return left.State == right.State &&
		left.SiteID == right.SiteID &&
		left.Provider == right.Provider &&
		left.ReturnTo == right.ReturnTo &&
		left.Verifier == right.Verifier &&
		left.CreatedAt.Equal(right.CreatedAt) &&
		left.ExpiresAt.Equal(right.ExpiresAt)
}
