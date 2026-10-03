package githubstore

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
)

const (
	recordRoot             = "oauth-data"
	transactionKind        = "authorization-transaction"
	identityKind           = "oauth-identity"
	credentialKind         = "oauth-credential"
	refreshOperationKind   = "oauth-refresh-operation"
	auditKind              = "oauth-audit"
	recordSchema           = 1
	refreshOperationSchema = 2
	defaultAdminLimit      = 100
	auditPathTimeLayout    = "20060102T150405.000000000Z"
	auditPathTimeLength    = len(auditPathTimeLayout)
)

type Store struct {
	repository       *Client
	codec            *recordcrypto.Codec
	indexFingerprint *recordcrypto.Fingerprinter
	auditFingerprint *recordcrypto.Fingerprinter
	now              func() time.Time
}

type transactionRecord struct {
	SchemaVersion    int        `json:"schema_version"`
	StateFingerprint string     `json:"state_fingerprint"`
	SiteID           string     `json:"site_id"`
	Provider         string     `json:"provider"`
	ReturnTo         string     `json:"return_to,omitempty"`
	Verifier         string     `json:"verifier"`
	CreatedAt        time.Time  `json:"created_at"`
	ExpiresAt        time.Time  `json:"expires_at"`
	ConsumedAt       *time.Time `json:"consumed_at,omitempty"`
	CompletionID     string     `json:"completion_id,omitempty"`
	IdentityID       string     `json:"identity_id,omitempty"`
}

type refreshOperationRecord struct {
	SchemaVersion        int        `json:"schema_version"`
	IdentityID           string     `json:"identity_id"`
	OperationFingerprint string     `json:"operation_fingerprint"`
	CredentialGeneration uint64     `json:"credential_generation"`
	State                string     `json:"state"`
	ClaimID              string     `json:"claim_id"`
	ClaimedAt            time.Time  `json:"claimed_at"`
	CompletedAt          *time.Time `json:"completed_at,omitempty"`
	ErrorCode            string     `json:"error_code,omitempty"`
}

func NewStore(repositoryClient *Client, codec *recordcrypto.Codec, indexFingerprint, auditFingerprint *recordcrypto.Fingerprinter) (*Store, error) {
	if repositoryClient == nil || codec == nil || indexFingerprint == nil || auditFingerprint == nil {
		return nil, errors.New("invalid_oauth_store_configuration")
	}
	return &Store{
		repository:       repositoryClient,
		codec:            codec,
		indexFingerprint: indexFingerprint,
		auditFingerprint: auditFingerprint,
		now:              func() time.Time { return time.Now().UTC() },
	}, nil
}

func (s *Store) CreateAuthorization(ctx context.Context, session entity.AuthSession) error {
	stateID := s.indexFingerprint.Fingerprint(session.State)
	txPath := transactionPath(stateID)
	tx := transactionRecord{
		SchemaVersion:    recordSchema,
		StateFingerprint: stateID,
		SiteID:           session.SiteID,
		Provider:         string(session.Provider),
		ReturnTo:         session.ReturnTo,
		Verifier:         session.Verifier,
		CreatedAt:        session.CreatedAt.UTC(),
		ExpiresAt:        session.ExpiresAt.UTC(),
	}
	event := entity.AuditEvent{
		SchemaVersion: recordSchema,
		EventID:       s.auditFingerprint.Fingerprint("start\x00" + stateID),
		EventType:     entity.AuditAuthorizationStarted,
		OccurredAt:    session.CreatedAt.UTC(),
		SiteID:        session.SiteID,
		Provider:      session.Provider,
		TransactionID: stateID,
		Result:        "success",
	}
	return s.repository.Update(ctx, "oauth: start authorization", func(snapshot *Snapshot) (map[string][]byte, error) {
		existing, found, err := s.readTransaction(ctx, snapshot, txPath)
		if err != nil {
			return nil, err
		}
		if found {
			if sameTransaction(existing, tx) {
				return map[string][]byte{}, nil
			}
			return nil, repository.ErrAuthorizationExists
		}
		return s.encodeChanges(map[string]recordValue{
			txPath: {
				kind:  transactionKind,
				value: tx,
			},
			auditPath(event): {
				kind:  auditKind,
				value: event,
			},
		})
	})
}

func (s *Store) FindAuthorization(ctx context.Context, state string) (*entity.AuthSession, error) {
	stateID := s.indexFingerprint.Fingerprint(state)
	payload, found, err := s.repository.Read(ctx, transactionPath(stateID))
	if err != nil || !found {
		return nil, err
	}
	var record transactionRecord
	if err := s.decode(transactionKind, transactionPath(stateID), payload, &record); err != nil {
		return nil, err
	}
	if record.StateFingerprint != stateID {
		return nil, repository.ErrRecordCorrupt
	}
	return &entity.AuthSession{
		State:      state,
		SiteID:     record.SiteID,
		Provider:   valueProvider(record.Provider),
		ReturnTo:   record.ReturnTo,
		Verifier:   record.Verifier,
		CreatedAt:  record.CreatedAt,
		ExpiresAt:  record.ExpiresAt,
		ConsumedAt: record.ConsumedAt,
	}, nil
}

func (s *Store) CompleteAuthorization(ctx context.Context, completion entity.AuthorizationCompletion) (*entity.OAuthIdentity, error) {
	stateID := s.indexFingerprint.Fingerprint(completion.State)
	txPath := transactionPath(stateID)
	var completed *entity.OAuthIdentity
	err := s.repository.Update(ctx, "oauth: complete authorization", func(snapshot *Snapshot) (map[string][]byte, error) {
		tx, found, err := s.readTransaction(ctx, snapshot, txPath)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, repository.ErrAuthorizationNotFound
		}
		if tx.ConsumedAt != nil {
			if completion.CompletionID == "" || tx.CompletionID != completion.CompletionID {
				return nil, repository.ErrAuthorizationConsumed
			}
			identity, found, err := s.readIdentity(ctx, snapshot, identityPath(tx.IdentityID))
			if err != nil {
				return nil, err
			}
			if !found {
				return nil, repository.ErrRecordCorrupt
			}
			completed = identity
			return map[string][]byte{}, nil
		}
		if completion.CompletedAt.After(tx.ExpiresAt) {
			return nil, repository.ErrAuthorizationExpired
		}
		if completion.Identity.ProviderUserID == "" || completion.Tokens.AccessToken == "" {
			return nil, repository.ErrRecordCorrupt
		}
		identityID := s.identityID(tx.SiteID, tx.Provider, completion.Identity.ProviderUserID)
		identityPath := identityPath(identityID)

		identity, found, err := s.readIdentity(ctx, snapshot, identityPath)
		if err != nil {
			return nil, err
		}
		if !found {
			identity = &entity.OAuthIdentity{
				SchemaVersion: recordSchema,
				IdentityID:    identityID,
				SiteID:        tx.SiteID,
				Provider:      valueProvider(tx.Provider),
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

		credential, _, err := s.readCredential(ctx, snapshot, credentialPath(identityID))
		if err != nil {
			return nil, err
		}
		generation := uint64(1)
		refreshToken := completion.Tokens.RefreshToken
		if credential != nil {
			generation = credential.Generation + 1
			if refreshToken == "" {
				refreshToken = credential.RefreshToken
			}
		}
		nextCredential := entity.OAuthCredential{
			SchemaVersion:    recordSchema,
			IdentityID:       identityID,
			SiteID:           tx.SiteID,
			Provider:         valueProvider(tx.Provider),
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
		tx.ConsumedAt = &consumedAt
		tx.CompletionID = completion.CompletionID
		tx.IdentityID = identityID
		event := entity.AuditEvent{
			SchemaVersion:   recordSchema,
			EventID:         s.auditFingerprint.Fingerprint("success\x00" + stateID + "\x00" + completion.CompletionID),
			EventType:       entity.AuditLoginSucceeded,
			OccurredAt:      consumedAt,
			SiteID:          tx.SiteID,
			Provider:        valueProvider(tx.Provider),
			TransactionID:   stateID,
			IdentityID:      identityID,
			CodeFingerprint: completion.CodeFingerprint,
			Result:          "success",
		}
		changes, err := s.encodeChanges(map[string]recordValue{
			txPath: {
				kind:  transactionKind,
				value: tx,
			},
			identityPath: {
				kind:  identityKind,
				value: identity,
			},
			credentialPath(identityID): {
				kind:  credentialKind,
				value: nextCredential,
			},
			auditPath(event): {
				kind:  auditKind,
				value: event,
			},
		})
		if err == nil {
			completed = identity
		}
		return changes, err
	})
	return completed, err
}

func (s *Store) RecordAuthorizationFailure(ctx context.Context, failure entity.AuthorizationFailure) error {
	stateID := s.indexFingerprint.Fingerprint(failure.State)
	return s.repository.Update(ctx, "oauth: record authorization failure", func(snapshot *Snapshot) (map[string][]byte, error) {
		siteID := ""
		provider := failure.Provider
		txPath := transactionPath(stateID)
		tx, transactionFound, err := s.readTransaction(ctx, snapshot, txPath)
		if err != nil {
			return nil, err
		}
		if transactionFound {
			siteID = tx.SiteID
			provider = valueProvider(tx.Provider)
		}
		occurredAt := failure.OccurredAt.UTC()
		event := entity.AuditEvent{
			SchemaVersion:   recordSchema,
			EventID:         s.auditFingerprint.Fingerprint("failure\x00" + stateID + "\x00" + failure.CodeFingerprint + "\x00" + failure.ErrorCode + "\x00" + occurredAt.Format(time.RFC3339Nano)),
			EventType:       entity.AuditLoginFailed,
			OccurredAt:      occurredAt,
			SiteID:          siteID,
			Provider:        provider,
			TransactionID:   stateID,
			CodeFingerprint: failure.CodeFingerprint,
			Result:          "failure",
			ErrorCode:       failure.ErrorCode,
		}
		eventPath := auditPath(event)
		_, eventFound, err := snapshot.Read(ctx, eventPath)
		if err != nil {
			return nil, err
		}
		records := make(map[string]recordValue, 2)
		if !eventFound {
			records[eventPath] = recordValue{
				kind:  auditKind,
				value: event,
			}
		}
		if failure.Terminal && transactionFound && tx.ConsumedAt == nil {
			tx.ConsumedAt = &occurredAt
			tx.CompletionID = "failure:" + failure.ErrorCode
			records[txPath] = recordValue{
				kind:  transactionKind,
				value: tx,
			}
		}
		return s.encodeChanges(records)
	})
}

func (s *Store) LoadCredential(ctx context.Context, identityID string) (*entity.OAuthCredential, error) {
	path := credentialPath(identityID)
	payload, found, err := s.repository.Read(ctx, path)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, repository.ErrCredentialNotFound
	}
	var credential entity.OAuthCredential
	if err := s.decode(credentialKind, path, payload, &credential); err != nil {
		return nil, err
	}
	if credential.SchemaVersion != recordSchema ||
		credential.IdentityID != identityID {
		return nil, repository.ErrRecordCorrupt
	}
	return &credential, nil
}

func (s *Store) ClaimCredentialRefresh(
	ctx context.Context,
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
	operationFingerprint := s.refreshOperationID(identityID, operationID)
	operationPath := refreshOperationPath(identityID, operationFingerprint)
	var result *entity.CredentialRefreshClaim
	err = s.repository.Update(ctx, "oauth: claim credential refresh", func(snapshot *Snapshot) (map[string][]byte, error) {
		current, found, err := s.readCredential(ctx, snapshot, credentialPath(identityID))
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, repository.ErrCredentialNotFound
		}
		operation, found, err := s.readRefreshOperation(
			ctx,
			snapshot,
			operationPath,
		)
		if err != nil {
			return nil, err
		}
		if found {
			if operation.IdentityID != identityID ||
				operation.OperationFingerprint != operationFingerprint ||
				operation.CredentialGeneration > current.Generation {
				return nil, repository.ErrRecordCorrupt
			}
			switch {
			case operation.State == string(entity.CredentialRefreshClaimCommitted):
				result = githubRefreshClaim(
					*current,
					operationID,
					"",
					entity.CredentialRefreshClaimCommitted,
				)
			case operation.State == string(entity.CredentialRefreshClaimAcquired) &&
				operation.ClaimID == claimID:
				result = githubRefreshClaim(
					*current,
					operationID,
					claimID,
					entity.CredentialRefreshClaimAcquired,
				)
			case operation.State == string(entity.CredentialRefreshClaimReleased):
				prefix := recordRoot + "/refresh-operations/" + identityID + "/"
				for _, candidatePath := range snapshot.Paths(prefix) {
					if candidatePath == operationPath {
						continue
					}
					candidate, found, err := s.readRefreshOperation(ctx, snapshot, candidatePath)
					if err != nil {
						return nil, err
					}
					if found &&
						candidate.CredentialGeneration == current.Generation &&
						(candidate.State == string(entity.CredentialRefreshClaimAcquired) ||
							candidate.State == string(entity.CredentialRefreshClaimUncertain)) {
						result = githubRefreshClaim(
							*current,
							operationID,
							"",
							entity.CredentialRefreshClaimUncertain,
						)
						return map[string][]byte{}, nil
					}
				}
				operation.CredentialGeneration = current.Generation
				operation.State = string(entity.CredentialRefreshClaimAcquired)
				operation.ClaimID = claimID
				operation.ClaimedAt = claimedAt.UTC()
				operation.CompletedAt = nil
				operation.ErrorCode = ""
				result = githubRefreshClaim(
					*current,
					operationID,
					claimID,
					entity.CredentialRefreshClaimAcquired,
				)
				return s.encodeChanges(map[string]recordValue{
					operationPath: {
						kind:  refreshOperationKind,
						value: operation,
					},
				})
			default:
				result = githubRefreshClaim(
					*current,
					operationID,
					"",
					entity.CredentialRefreshClaimUncertain,
				)
			}
			return map[string][]byte{}, nil
		}
		if current.LastRefreshOperationID == operationID {
			result = githubRefreshClaim(
				*current,
				operationID,
				"",
				entity.CredentialRefreshClaimCommitted,
			)
			return map[string][]byte{}, nil
		}
		prefix := recordRoot + "/refresh-operations/" + identityID + "/"
		for _, candidatePath := range snapshot.Paths(prefix) {
			candidate, found, err := s.readRefreshOperation(ctx, snapshot, candidatePath)
			if err != nil {
				return nil, err
			}
			if found &&
				candidate.CredentialGeneration == current.Generation &&
				(candidate.State == string(entity.CredentialRefreshClaimAcquired) ||
					candidate.State == string(entity.CredentialRefreshClaimUncertain)) {
				result = githubRefreshClaim(
					*current,
					operationID,
					"",
					entity.CredentialRefreshClaimUncertain,
				)
				return map[string][]byte{}, nil
			}
		}
		operation = &refreshOperationRecord{
			SchemaVersion:        refreshOperationSchema,
			IdentityID:           identityID,
			OperationFingerprint: operationFingerprint,
			CredentialGeneration: current.Generation,
			State:                string(entity.CredentialRefreshClaimAcquired),
			ClaimID:              claimID,
			ClaimedAt:            claimedAt.UTC(),
		}
		result = githubRefreshClaim(
			*current,
			operationID,
			claimID,
			entity.CredentialRefreshClaimAcquired,
		)
		return s.encodeChanges(map[string]recordValue{
			operationPath: {
				kind:  refreshOperationKind,
				value: operation,
			},
		})
	})
	return result, err
}

func (s *Store) ReleaseCredentialRefreshClaim(
	ctx context.Context,
	claim entity.CredentialRefreshClaim,
) error {
	claim.IdentityID = strings.TrimSpace(claim.IdentityID)
	claim.OperationID = strings.TrimSpace(claim.OperationID)
	claim.ClaimID = strings.TrimSpace(claim.ClaimID)
	if claim.IdentityID == "" ||
		claim.OperationID == "" ||
		claim.ClaimID == "" ||
		claim.CredentialGeneration == 0 {
		return repository.ErrRecordCorrupt
	}
	operationFingerprint := s.refreshOperationID(claim.IdentityID, claim.OperationID)
	operationPath := refreshOperationPath(claim.IdentityID, operationFingerprint)
	return s.repository.Update(ctx, "oauth: release credential refresh claim", func(snapshot *Snapshot) (map[string][]byte, error) {
		operation, found, err := s.readRefreshOperation(ctx, snapshot, operationPath)
		if err != nil {
			return nil, err
		}
		if !found ||
			operation.IdentityID != claim.IdentityID ||
			operation.OperationFingerprint != operationFingerprint ||
			operation.ClaimID != claim.ClaimID ||
			operation.CredentialGeneration != claim.CredentialGeneration {
			return nil, repository.ErrCredentialRefreshUncertain
		}
		switch operation.State {
		case string(entity.CredentialRefreshClaimCommitted),
			string(entity.CredentialRefreshClaimReleased):
			return map[string][]byte{}, nil
		case string(entity.CredentialRefreshClaimAcquired):
			operation.State = string(entity.CredentialRefreshClaimReleased)
			operation.ErrorCode = ""
			return s.encodeChanges(map[string]recordValue{
				operationPath: {
					kind:  refreshOperationKind,
					value: operation,
				},
			})
		default:
			return nil, repository.ErrCredentialRefreshUncertain
		}
	})
}

func (s *Store) ReplaceCredential(ctx context.Context, refresh entity.CredentialRefresh) (*entity.OAuthCredential, error) {
	refresh.IdentityID = strings.TrimSpace(refresh.IdentityID)
	refresh.OperationID = strings.TrimSpace(refresh.OperationID)
	if refresh.IdentityID == "" ||
		refresh.OperationID == "" ||
		refresh.ClaimID == "" ||
		refresh.ExpectedGeneration == 0 {
		return nil, repository.ErrRecordCorrupt
	}
	operationFingerprint := s.refreshOperationID(refresh.IdentityID, refresh.OperationID)
	operationPath := refreshOperationPath(refresh.IdentityID, operationFingerprint)
	var replaced *entity.OAuthCredential
	err := s.repository.Update(ctx, "oauth: refresh credential", func(snapshot *Snapshot) (map[string][]byte, error) {
		path := credentialPath(refresh.IdentityID)
		current, found, err := s.readCredential(ctx, snapshot, path)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, repository.ErrCredentialNotFound
		}
		operation, found, err := s.readRefreshOperation(ctx, snapshot, operationPath)
		if err != nil {
			return nil, err
		}
		if found {
			if operation.IdentityID != refresh.IdentityID ||
				operation.OperationFingerprint != operationFingerprint ||
				operation.CredentialGeneration > current.Generation {
				return nil, repository.ErrRecordCorrupt
			}
			if operation.State == string(entity.CredentialRefreshClaimCommitted) {
				replaced = current
				return map[string][]byte{}, nil
			}
			if operation.State != string(entity.CredentialRefreshClaimAcquired) ||
				operation.ClaimID != refresh.ClaimID ||
				operation.CredentialGeneration != refresh.ExpectedGeneration {
				return nil, repository.ErrCredentialRefreshUncertain
			}
		} else {
			return nil, repository.ErrCredentialRefreshUncertain
		}
		if current.LastRefreshOperationID == refresh.OperationID {
			replaced = current
			return map[string][]byte{}, nil
		}
		if current.Generation != refresh.ExpectedGeneration {
			return nil, repository.ErrCredentialRefreshUncertain
		}
		if strings.TrimSpace(refresh.Tokens.AccessToken) == "" {
			return nil, repository.ErrRecordCorrupt
		}
		refreshToken := refresh.Tokens.RefreshToken
		if refreshToken == "" {
			refreshToken = current.RefreshToken
		}
		if refreshToken == "" {
			return nil, repository.ErrCredentialNotRefreshable
		}
		tokenType := refresh.Tokens.TokenType
		if tokenType == "" {
			tokenType = current.TokenType
		}
		scope := refresh.Tokens.Scope
		if scope == "" {
			scope = current.Scope
		}
		refreshExpiresAt := refresh.Tokens.RefreshExpiresAt
		if refreshExpiresAt == nil {
			refreshExpiresAt = current.RefreshExpiresAt
		}
		next := *current
		next.AccessToken = refresh.Tokens.AccessToken
		next.RefreshToken = refreshToken
		next.TokenType = tokenType
		next.Scope = scope
		next.ObtainedAt = refresh.Tokens.ObtainedAt.UTC()
		next.AccessExpiresAt = refresh.Tokens.AccessExpiresAt
		next.RefreshExpiresAt = refreshExpiresAt
		next.Generation++
		next.LastRefreshOperationID = refresh.OperationID
		completedAt := refresh.RefreshedAt.UTC()
		operation.CredentialGeneration = next.Generation
		operation.State = string(entity.CredentialRefreshClaimCommitted)
		operation.CompletedAt = &completedAt
		operation.ErrorCode = ""
		event := entity.AuditEvent{
			SchemaVersion: recordSchema,
			EventID:       s.auditFingerprint.Fingerprint("refresh\x00" + refresh.IdentityID + "\x00" + refresh.OperationID),
			EventType:     entity.AuditCredentialRefreshed,
			OccurredAt:    refresh.RefreshedAt.UTC(),
			SiteID:        current.SiteID,
			Provider:      current.Provider,
			IdentityID:    current.IdentityID,
			Result:        "success",
		}
		changes, err := s.encodeChanges(map[string]recordValue{
			path: {
				kind:  credentialKind,
				value: next,
			},
			operationPath: {
				kind:  refreshOperationKind,
				value: operation,
			},
			auditPath(event): {
				kind:  auditKind,
				value: event,
			},
		})
		if err == nil {
			replaced = &next
		}
		return changes, err
	})
	return replaced, err
}

func (s *Store) MarkCredentialRefreshUncertain(
	ctx context.Context,
	claim entity.CredentialRefreshClaim,
	errorCode string,
	occurredAt time.Time,
) error {
	operationFingerprint := s.refreshOperationID(claim.IdentityID, claim.OperationID)
	operationPath := refreshOperationPath(claim.IdentityID, operationFingerprint)
	return s.repository.Update(ctx, "oauth: mark credential refresh uncertain", func(snapshot *Snapshot) (map[string][]byte, error) {
		operation, found, err := s.readRefreshOperation(ctx, snapshot, operationPath)
		if err != nil {
			return nil, err
		}
		if !found ||
			operation.IdentityID != claim.IdentityID ||
			operation.OperationFingerprint != operationFingerprint ||
			operation.ClaimID != claim.ClaimID ||
			operation.CredentialGeneration != claim.CredentialGeneration {
			return nil, repository.ErrCredentialRefreshUncertain
		}
		if operation.State == string(entity.CredentialRefreshClaimCommitted) ||
			operation.State == string(entity.CredentialRefreshClaimUncertain) {
			return map[string][]byte{}, nil
		}
		if operation.State != string(entity.CredentialRefreshClaimAcquired) {
			return nil, repository.ErrRecordCorrupt
		}
		operation.State = string(entity.CredentialRefreshClaimUncertain)
		operation.ErrorCode = errorCode
		event := entity.AuditEvent{
			SchemaVersion: recordSchema,
			EventID:       s.auditFingerprint.Fingerprint("refresh-uncertain\x00" + claim.IdentityID + "\x00" + claim.OperationID),
			EventType:     entity.AuditCredentialRefreshUncertain,
			OccurredAt:    occurredAt.UTC(),
			SiteID:        claim.Credential.SiteID,
			Provider:      claim.Credential.Provider,
			IdentityID:    claim.IdentityID,
			Result:        "failure",
			ErrorCode:     errorCode,
		}
		return s.encodeChanges(map[string]recordValue{
			operationPath: {
				kind:  refreshOperationKind,
				value: operation,
			},
			auditPath(event): {
				kind:  auditKind,
				value: event,
			},
		})
	})
}

func (s *Store) AdminSnapshot(ctx context.Context, limit int) (entity.AdminSnapshot, error) {
	if limit <= 0 {
		limit = defaultAdminLimit
	}
	result := entity.AdminSnapshot{GeneratedAt: s.now()}
	err := s.repository.View(ctx, func(snapshot *Snapshot) error {
		auditPaths := snapshot.Paths(recordRoot + "/audits/")
		for _, path := range auditPaths {
			if !validAuditPath(path) {
				return repository.ErrRecordCorrupt
			}
		}
		sort.Sort(sort.Reverse(sort.StringSlice(auditPaths)))
		if len(auditPaths) > limit {
			auditPaths = auditPaths[:limit]
		}
		for _, path := range snapshot.Paths(recordRoot + "/identities/") {
			identity, found, err := s.readIdentity(ctx, snapshot, path)
			if err != nil {
				return err
			}
			if !found {
				continue
			}
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
			if credential, found, err := s.readCredential(ctx, snapshot, credentialPath(identity.IdentityID)); err != nil {
				return err
			} else if found {
				admin.HasAccessToken = credential.AccessToken != ""
				admin.HasRefreshToken = credential.RefreshToken != ""
				admin.AccessExpiresAt = credential.AccessExpiresAt
				admin.RefreshExpiresAt = credential.RefreshExpiresAt
			}
			result.Identities = append(result.Identities, admin)
		}
		for _, path := range auditPaths {
			var event entity.AuditEvent
			payload, found, err := snapshot.Read(ctx, path)
			if err != nil {
				return err
			}
			if !found {
				continue
			}
			if err := s.decode(auditKind, path, payload, &event); err != nil {
				return err
			}
			result.Events = append(result.Events, entity.AdminAuditEvent{
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
		return nil
	})
	sort.Slice(result.Identities, func(i, j int) bool {
		return result.Identities[i].LastLoginAt.After(result.Identities[j].LastLoginAt)
	})
	sort.Slice(result.Events, func(i, j int) bool {
		return result.Events[i].OccurredAt.After(result.Events[j].OccurredAt)
	})
	if len(result.Events) > limit {
		result.Events = result.Events[:limit]
	}
	return result, err
}

func (s *Store) RotateEncryption(ctx context.Context, limit int) (entity.RotationResult, error) {
	if limit <= 0 {
		limit = 1000
	}
	var result entity.RotationResult
	var candidates map[string][]byte
	var confirmedRotations int
	var finalStagedRotations int
	var recordFailure error
	err := s.repository.Update(ctx, "oauth: rotate encrypted records", func(snapshot *Snapshot) (map[string][]byte, error) {
		if candidates != nil {
			result.Complete = false
			changes := make(map[string][]byte)
			confirmedRotations = 0
			for path, candidate := range candidates {
				payload, found, err := snapshot.Read(ctx, path)
				if err != nil {
					return nil, err
				}
				if !found {
					result.Failed++
					return nil, repository.ErrRecordCorrupt
				}
				if bytes.Equal(payload, candidate) {
					confirmedRotations++
					continue
				}
				kind, ok := recordKindForPath(path)
				if !ok {
					result.Failed++
					return nil, repository.ErrRecordCorrupt
				}
				plaintext, needsRotation, err := s.codec.Decrypt(kind, path, payload)
				if err != nil {
					result.Failed++
					return nil, err
				}
				if !needsRotation {
					continue
				}
				rotated, err := s.codec.Encrypt(kind, path, plaintext)
				if err != nil {
					return nil, err
				}
				candidates[path] = rotated
				changes[path] = rotated
			}
			finalStagedRotations = len(changes)
			return changes, nil
		}

		attempt := entity.RotationResult{}
		attempt.Complete = true
		attemptFailure := error(nil)
		changes := make(map[string][]byte)
		paths := snapshot.Paths(recordRoot + "/")
		for _, path := range paths {
			if len(changes) >= limit {
				attempt.Complete = false
				break
			}
			kind, ok := recordKindForPath(path)
			if !ok {
				continue
			}
			attempt.Scanned++
			payload, found, err := snapshot.Read(ctx, path)
			if err != nil {
				return nil, err
			}
			if !found {
				attempt.Failed++
				if attemptFailure == nil {
					attemptFailure = repository.ErrRecordCorrupt
				}
				continue
			}
			plaintext, needsRotation, err := s.codec.Decrypt(kind, path, payload)
			if err != nil {
				attempt.Failed++
				if attemptFailure == nil {
					attemptFailure = err
				}
				continue
			}
			if !needsRotation {
				attempt.Unchanged++
				continue
			}
			rotated, err := s.codec.Encrypt(kind, path, plaintext)
			if err != nil {
				return nil, err
			}
			changes[path] = rotated
		}
		result = attempt
		recordFailure = attemptFailure
		candidates = make(map[string][]byte, len(changes))
		for path, payload := range changes {
			candidates[path] = payload
		}
		finalStagedRotations = len(changes)
		return changes, nil
	})
	if err != nil {
		result.Rotated = confirmedRotations
		return result, err
	}
	result.Rotated = confirmedRotations + finalStagedRotations
	if result.Failed > 0 {
		if recordFailure != nil {
			return result, recordFailure
		}
		return result, repository.ErrRecordCorrupt
	}
	return result, nil
}

type recordValue struct {
	kind  string
	value any
}

func (s *Store) encodeChanges(records map[string]recordValue) (map[string][]byte, error) {
	changes := make(map[string][]byte, len(records))
	for path, record := range records {
		plaintext, err := json.Marshal(record.value)
		if err != nil {
			return nil, repository.ErrRecordCorrupt
		}
		encrypted, err := s.codec.Encrypt(record.kind, path, plaintext)
		if err != nil {
			return nil, err
		}
		changes[path] = encrypted
	}
	return changes, nil
}

func (s *Store) decode(kind, path string, payload []byte, output any) error {
	plaintext, _, err := s.codec.Decrypt(kind, path, payload)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(plaintext, output); err != nil {
		return repository.ErrRecordCorrupt
	}
	return nil
}

func (s *Store) readTransaction(ctx context.Context, snapshot *Snapshot, path string) (transactionRecord, bool, error) {
	var record transactionRecord
	payload, found, err := snapshot.Read(ctx, path)
	if err != nil || !found {
		return record, found, err
	}
	if err := s.decode(transactionKind, path, payload, &record); err != nil {
		return record, false, err
	}
	if record.SchemaVersion != recordSchema {
		return record, false, repository.ErrRecordCorrupt
	}
	return record, true, nil
}

func (s *Store) readIdentity(ctx context.Context, snapshot *Snapshot, path string) (*entity.OAuthIdentity, bool, error) {
	payload, found, err := snapshot.Read(ctx, path)
	if err != nil || !found {
		return nil, found, err
	}
	var identity entity.OAuthIdentity
	if err := s.decode(identityKind, path, payload, &identity); err != nil {
		return nil, false, err
	}
	if identity.SchemaVersion != recordSchema {
		return nil, false, repository.ErrRecordCorrupt
	}
	return &identity, true, nil
}

func (s *Store) readCredential(ctx context.Context, snapshot *Snapshot, path string) (*entity.OAuthCredential, bool, error) {
	payload, found, err := snapshot.Read(ctx, path)
	if err != nil || !found {
		return nil, found, err
	}
	var credential entity.OAuthCredential
	if err := s.decode(credentialKind, path, payload, &credential); err != nil {
		return nil, false, err
	}
	if credential.SchemaVersion != recordSchema {
		return nil, false, repository.ErrRecordCorrupt
	}
	return &credential, true, nil
}

func (s *Store) readRefreshOperation(ctx context.Context, snapshot *Snapshot, path string) (*refreshOperationRecord, bool, error) {
	payload, found, err := snapshot.Read(ctx, path)
	if err != nil || !found {
		return nil, found, err
	}
	var operation refreshOperationRecord
	if err := s.decode(refreshOperationKind, path, payload, &operation); err != nil {
		return nil, false, err
	}
	if operation.SchemaVersion == recordSchema &&
		operation.CompletedAt != nil &&
		!operation.CompletedAt.IsZero() {
		operation.State = string(entity.CredentialRefreshClaimCommitted)
		return &operation, true, nil
	}
	if operation.SchemaVersion != refreshOperationSchema ||
		operation.IdentityID == "" ||
		operation.OperationFingerprint == "" ||
		operation.CredentialGeneration == 0 ||
		operation.ClaimID == "" ||
		operation.ClaimedAt.IsZero() {
		return nil, false, repository.ErrRecordCorrupt
	}
	switch entity.CredentialRefreshClaimState(operation.State) {
	case entity.CredentialRefreshClaimAcquired,
		entity.CredentialRefreshClaimUncertain,
		entity.CredentialRefreshClaimReleased:
		if operation.CompletedAt != nil {
			return nil, false, repository.ErrRecordCorrupt
		}
	case entity.CredentialRefreshClaimCommitted:
		if operation.CompletedAt == nil || operation.CompletedAt.IsZero() {
			return nil, false, repository.ErrRecordCorrupt
		}
	default:
		return nil, false, repository.ErrRecordCorrupt
	}
	return &operation, true, nil
}

func newRefreshClaimID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func githubRefreshClaim(
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

func (s *Store) identityID(siteID, provider, providerUserID string) string {
	return s.indexFingerprint.Fingerprint(strings.Join([]string{siteID, provider, providerUserID}, "\x00"))
}

func (s *Store) refreshOperationID(identityID, operationID string) string {
	return s.indexFingerprint.Fingerprint(
		strings.Join([]string{"refresh", identityID, operationID}, "\x00"),
	)
}

func transactionPath(stateID string) string {
	return recordRoot + "/transactions/" + stateID + ".json"
}

func identityPath(identityID string) string {
	return recordRoot + "/identities/" + identityID + ".json"
}

func credentialPath(identityID string) string {
	return recordRoot + "/credentials/" + identityID + ".json"
}

func refreshOperationPath(identityID, operationFingerprint string) string {
	return recordRoot + "/refresh-operations/" + identityID + "/" + operationFingerprint + ".json"
}

func recordKindForPath(path string) (string, bool) {
	switch {
	case strings.HasPrefix(path, recordRoot+"/transactions/"):
		return transactionKind, true
	case strings.HasPrefix(path, recordRoot+"/identities/"):
		return identityKind, true
	case strings.HasPrefix(path, recordRoot+"/credentials/"):
		return credentialKind, true
	case strings.HasPrefix(path, recordRoot+"/refresh-operations/"):
		return refreshOperationKind, true
	case strings.HasPrefix(path, recordRoot+"/audits/"):
		return auditKind, true
	default:
		return "", false
	}
}

func auditPath(event entity.AuditEvent) string {
	occurredAt := event.OccurredAt.UTC()
	return fmt.Sprintf(
		"%s/audits/%04d/%02d/%s-%s.json",
		recordRoot,
		occurredAt.Year(),
		occurredAt.Month(),
		occurredAt.Format(auditPathTimeLayout),
		event.EventID,
	)
}

func validAuditPath(recordPath string) bool {
	relative, found := strings.CutPrefix(recordPath, recordRoot+"/audits/")
	if !found {
		return false
	}
	parts := strings.Split(relative, "/")
	if len(parts) != 3 || !strings.HasSuffix(parts[2], ".json") {
		return false
	}
	filename := strings.TrimSuffix(parts[2], ".json")
	if len(filename) <= auditPathTimeLength+1 || filename[auditPathTimeLength] != '-' {
		return false
	}
	occurredAt, err := time.Parse(auditPathTimeLayout, filename[:auditPathTimeLength])
	if err != nil {
		return false
	}
	return parts[0] == fmt.Sprintf("%04d", occurredAt.Year()) &&
		parts[1] == fmt.Sprintf("%02d", occurredAt.Month())
}

func sameTransaction(left, right transactionRecord) bool {
	return left.SchemaVersion == right.SchemaVersion &&
		left.StateFingerprint == right.StateFingerprint &&
		left.SiteID == right.SiteID &&
		left.Provider == right.Provider &&
		left.ReturnTo == right.ReturnTo &&
		left.Verifier == right.Verifier &&
		left.CreatedAt.Equal(right.CreatedAt) &&
		left.ExpiresAt.Equal(right.ExpiresAt)
}

func valueProvider(value string) valueobject.Provider {
	provider, _ := valueobject.ParseProvider(value)
	return provider
}
