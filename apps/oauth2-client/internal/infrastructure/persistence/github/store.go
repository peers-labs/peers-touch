package githubstore

import (
	"context"
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
	recordRoot        = "oauth-data"
	transactionKind   = "authorization-transaction"
	identityKind      = "oauth-identity"
	credentialKind    = "oauth-credential"
	auditKind         = "oauth-audit"
	recordSchema      = 1
	defaultAdminLimit = 100
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
		if tx, found, err := s.readTransaction(ctx, snapshot, transactionPath(stateID)); err != nil {
			return nil, err
		} else if found {
			siteID = tx.SiteID
			provider = valueProvider(tx.Provider)
		}
		event := entity.AuditEvent{
			SchemaVersion:   recordSchema,
			EventID:         s.auditFingerprint.Fingerprint("failure\x00" + stateID + "\x00" + failure.CodeFingerprint + "\x00" + failure.ErrorCode),
			EventType:       entity.AuditLoginFailed,
			OccurredAt:      failure.OccurredAt.UTC(),
			SiteID:          siteID,
			Provider:        provider,
			TransactionID:   stateID,
			CodeFingerprint: failure.CodeFingerprint,
			Result:          "failure",
			ErrorCode:       failure.ErrorCode,
		}
		eventPath := auditPath(event)
		if _, found, err := snapshot.Read(ctx, eventPath); err != nil {
			return nil, err
		} else if found {
			return map[string][]byte{}, nil
		}
		return s.encodeChanges(map[string]recordValue{
			eventPath: {
				kind:  auditKind,
				value: event,
			},
		})
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

func (s *Store) ReplaceCredential(ctx context.Context, refresh entity.CredentialRefresh) (*entity.OAuthCredential, error) {
	if strings.TrimSpace(refresh.IdentityID) == "" ||
		strings.TrimSpace(refresh.OperationID) == "" {
		return nil, repository.ErrRecordCorrupt
	}
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
		if current.LastRefreshOperationID == refresh.OperationID && refresh.OperationID != "" {
			replaced = current
			return map[string][]byte{}, nil
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

func (s *Store) AdminSnapshot(ctx context.Context, limit int) (entity.AdminSnapshot, error) {
	if limit <= 0 {
		limit = defaultAdminLimit
	}
	result := entity.AdminSnapshot{GeneratedAt: s.now()}
	err := s.repository.View(ctx, func(snapshot *Snapshot) error {
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
		auditPaths := snapshot.Paths(recordRoot + "/audits/")
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
	var recordFailure error
	err := s.repository.Update(ctx, "oauth: rotate encrypted records", func(snapshot *Snapshot) (map[string][]byte, error) {
		attempt := entity.RotationResult{}
		attemptFailure := error(nil)
		changes := make(map[string][]byte)
		paths := snapshot.Paths(recordRoot + "/")
		for _, path := range paths {
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
			if len(changes) >= limit {
				continue
			}
			rotated, err := s.codec.Encrypt(kind, path, plaintext)
			if err != nil {
				return nil, err
			}
			changes[path] = rotated
			attempt.Rotated++
		}
		result = attempt
		recordFailure = attemptFailure
		return changes, nil
	})
	if err != nil {
		return result, err
	}
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

func (s *Store) identityID(siteID, provider, providerUserID string) string {
	return s.indexFingerprint.Fingerprint(strings.Join([]string{siteID, provider, providerUserID}, "\x00"))
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

func recordKindForPath(path string) (string, bool) {
	switch {
	case strings.HasPrefix(path, recordRoot+"/transactions/"):
		return transactionKind, true
	case strings.HasPrefix(path, recordRoot+"/identities/"):
		return identityKind, true
	case strings.HasPrefix(path, recordRoot+"/credentials/"):
		return credentialKind, true
	case strings.HasPrefix(path, recordRoot+"/audits/"):
		return auditKind, true
	default:
		return "", false
	}
}

func auditPath(event entity.AuditEvent) string {
	return fmt.Sprintf(
		"%s/audits/%04d/%02d/%s.json",
		recordRoot,
		event.OccurredAt.UTC().Year(),
		event.OccurredAt.UTC().Month(),
		event.EventID,
	)
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
