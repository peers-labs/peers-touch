package memory

import (
	"context"
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
	refreshOps  map[string]map[string]struct{}
	events      map[string]entity.AuditEvent
}

func NewStore() *Store {
	return &Store{
		sessions:    make(map[string]entity.AuthSession),
		identities:  make(map[string]entity.OAuthIdentity),
		credentials: make(map[string]entity.OAuthCredential),
		refreshOps:  make(map[string]map[string]struct{}),
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
	eventID := digest("failure\x00" + transactionID + "\x00" + failure.CodeFingerprint + "\x00" + failure.ErrorCode)
	if _, exists := s.events[eventID]; exists {
		return nil
	}
	siteID := ""
	provider := failure.Provider
	if session, ok := s.sessions[failure.State]; ok {
		siteID = session.SiteID
		provider = session.Provider
	}
	s.events[eventID] = entity.AuditEvent{
		SchemaVersion:   1,
		EventID:         eventID,
		EventType:       entity.AuditLoginFailed,
		OccurredAt:      failure.OccurredAt.UTC(),
		SiteID:          siteID,
		Provider:        provider,
		TransactionID:   transactionID,
		CodeFingerprint: failure.CodeFingerprint,
		Result:          "failure",
		ErrorCode:       failure.ErrorCode,
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

func (s *Store) LoadCredentialForRefresh(_ context.Context, identityID, operationID string) (*entity.OAuthCredential, bool, error) {
	identityID = strings.TrimSpace(identityID)
	operationID = strings.TrimSpace(operationID)
	if identityID == "" || operationID == "" {
		return nil, false, repository.ErrRecordCorrupt
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	credential, ok := s.credentials[identityID]
	if !ok {
		return nil, false, repository.ErrCredentialNotFound
	}
	_, completed := s.refreshOps[identityID][operationID]
	if credential.LastRefreshOperationID == operationID {
		completed = true
	}
	out := credential
	return &out, completed, nil
}

func (s *Store) ReplaceCredential(_ context.Context, refresh entity.CredentialRefresh) (*entity.OAuthCredential, error) {
	refresh.IdentityID = strings.TrimSpace(refresh.IdentityID)
	refresh.OperationID = strings.TrimSpace(refresh.OperationID)
	if refresh.IdentityID == "" ||
		refresh.OperationID == "" ||
		refresh.ExpectedGeneration == 0 {
		return nil, repository.ErrRecordCorrupt
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	credential, ok := s.credentials[refresh.IdentityID]
	if !ok {
		return nil, repository.ErrCredentialNotFound
	}
	if _, completed := s.refreshOps[refresh.IdentityID][refresh.OperationID]; completed ||
		credential.LastRefreshOperationID == refresh.OperationID {
		out := credential
		return &out, nil
	}
	if credential.Generation != refresh.ExpectedGeneration {
		return nil, repository.ErrCredentialGeneration
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
	if s.refreshOps[refresh.IdentityID] == nil {
		s.refreshOps[refresh.IdentityID] = make(map[string]struct{})
	}
	s.refreshOps[refresh.IdentityID][refresh.OperationID] = struct{}{}
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
