package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	actoridentity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	actorservice "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/crypto"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// DefaultSessionDuration is the lifetime of an actor's session record in the
// Station session table. Tokens issued for that session inherit the same TTL
// (see `IssueTokenAndSession`). We default to 30 days because:
//
//   - The chat client is treated as a long-lived "trusted device" — kicking
//     people out every 24h forces them through the picker → PIN dance for no
//     security gain (the PIN protects the encrypted token at rest, and the
//     server still revokes on logout / `CreateWithKick`).
//   - `CreateWithKick` is the authoritative takeover boundary: within one
//     Station, a successful login for an actor revokes older sessions for that
//     actor on the *same device type*. Different device types (Desktop native,
//     Browser, Mobile) may hold concurrent sessions per MCA-D19.
//
// Operators that want a shorter window can override this via a session config
// once we wire one up; today this constant is the single source of truth.
const DefaultSessionDuration = 30 * 24 * time.Hour

var sessionManager *session.Manager

func InitSessionManager(ctx context.Context) {
	dbStore := session.NewDBStore(func(ctx context.Context) (*gorm.DB, error) {
		return store.GetRDS(ctx)
	}, DefaultSessionDuration)

	if err := dbStore.AutoMigrate(ctx); err != nil {
		panic(fmt.Errorf("session store auto migrate failed: %v", err))
	}

	sessionManager = session.NewManager(dbStore, DefaultSessionDuration)

	coreauth.SetGlobalSessionValidator(sessionManager)
}

func SessionManager() *session.Manager {
	if sessionManager == nil {
		panic("session manager not initialized: store not ready")
	}
	return sessionManager
}

type AuthMethod string

const (
	AuthMethodJWT    AuthMethod = "jwt"
	AuthMethodOAuth2 AuthMethod = "oauth2"
)

type AuthProvider interface {
	Authenticate(ctx context.Context, credentials *Credentials) (*AuthResult, error)
	ValidateToken(ctx context.Context, token string) (*TokenInfo, error)
	RefreshToken(ctx context.Context, refreshToken string) (*AuthResult, error)
	RevokeToken(ctx context.Context, token string) error
	GetMethod() AuthMethod
}

// Credentials represents user login credentials
type Credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	// For OAuth2 future use
	Provider     string `json:"provider,omitempty"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// AuthResult represents the result of authentication
type AuthResult struct {
	Actor        *db.Actor `json:"actor"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"` // "Bearer", etc.
}

// TokenInfo represents information extracted from a validated token
type TokenInfo struct {
	ActorPTID string    `json:"ptid"`
	Email     string    `json:"email"`
	ExpiresAt time.Time `json:"expires_at"`
	IssuedAt  time.Time `json:"issued_at"`
}

// AuthService manages authentication providers
type AuthService struct {
	providers     map[AuthMethod]AuthProvider
	defaultMethod AuthMethod
}

// NewAuthService creates a new authentication service
func NewAuthService() *AuthService {
	return &AuthService{
		providers:     make(map[AuthMethod]AuthProvider),
		defaultMethod: AuthMethodJWT, // Default to JWT
	}
}

// RegisterProvider registers an authentication provider
func (s *AuthService) RegisterProvider(provider AuthProvider) {
	s.providers[provider.GetMethod()] = provider
}

// GetProvider returns the authentication provider for the specified method
func (s *AuthService) GetProvider(method AuthMethod) AuthProvider {
	return s.providers[method]
}

// GetDefaultProvider returns the default authentication provider
func (s *AuthService) GetDefaultProvider() AuthProvider {
	return s.providers[s.defaultMethod]
}

// Authenticate authenticates user with the default provider
func (s *AuthService) Authenticate(ctx context.Context, credentials *Credentials) (*AuthResult, error) {
	provider := s.GetDefaultProvider()
	if provider == nil {
		return nil, ErrNoAuthProvider
	}
	return provider.Authenticate(ctx, credentials)
}

// ValidateToken validates a token using the default provider
func (s *AuthService) ValidateToken(ctx context.Context, token string) (*TokenInfo, error) {
	provider := s.GetDefaultProvider()
	if provider == nil {
		return nil, ErrNoAuthProvider
	}

	return provider.ValidateToken(ctx, token)
}

// SessionLoginResult contains the result of a successful login with session
type SessionLoginResult struct {
	AccessToken   string    `json:"access_token"`
	RefreshToken  string    `json:"refresh_token"`
	TokenType     string    `json:"token_type"`
	ExpiresAt     time.Time `json:"expires_at"`
	SessionID     string    `json:"session_id"`
	Actor         *db.Actor `json:"-"`
	KickedSession bool      `json:"kicked_session,omitempty"` // True if another session was kicked
}

// OAuthSessionBinding is the immutable authorization metadata persisted with a
// candidate-keyed session before credential delivery is acknowledged.
type OAuthSessionBinding struct {
	CandidateID            string
	AccessAttemptID        string
	StationPeerID          string
	AccessDecisionRevision uint64
	DeviceType             session.DeviceType
	DeviceID               string
	LifecycleGeneration    uint64
}

// AccessGateSessionBinding is the immutable Station-owned scope used when a
// non-OAuth Access Gate attempt reaches its final GRANTED decision.
type AccessGateSessionBinding struct {
	AccessAttemptID        string
	StationPeerID          string
	AccessDecisionRevision uint64
	DeviceType             session.DeviceType
	DeviceID               string
	LifecycleGeneration    uint64
}

// PrepareOAuthSession creates bearer material and its inactive persistent
// session row without writing either. The OAuth finalizer owns the surrounding
// database transaction and encrypts the returned LoginResponse before commit.
func PrepareOAuthSession(
	ctx context.Context,
	actor *db.Actor,
	binding OAuthSessionBinding,
	now time.Time,
) (*session.SessionRecord, *model.LoginResponse, error) {
	if actor == nil {
		return nil, nil, errors.New("cannot prepare OAuth session without actor")
	}
	ptid := strings.TrimSpace(actor.PTID)
	if _, err := actoridentity.Parse(ptid); err != nil {
		return nil, nil, fmt.Errorf("cannot prepare OAuth session for actor without valid PTID: %w", err)
	}
	if err := binding.DeviceType.Validate(); err != nil {
		return nil, nil, errors.New("OAuth session binding has a non-canonical client class")
	}
	if strings.TrimSpace(binding.CandidateID) == "" ||
		strings.TrimSpace(binding.AccessAttemptID) == "" ||
		strings.TrimSpace(binding.StationPeerID) == "" ||
		strings.TrimSpace(binding.DeviceID) == "" ||
		binding.LifecycleGeneration == 0 ||
		binding.AccessDecisionRevision == 0 {
		return nil, nil, errors.New("OAuth session binding is incomplete")
	}

	sessionID, err := generateSessionID()
	if err != nil {
		return nil, nil, fmt.Errorf("generate OAuth session ID: %w", err)
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	_, token, err := provider.Authenticate(ctx, coreauth.Credentials{
		SubjectID:  ptid,
		SessionID:  sessionID,
		Attributes: map[string]string{"email": actor.Email},
	})
	if err != nil {
		return nil, nil, fmt.Errorf("issue OAuth session credential: %w", err)
	}

	expiresAt := now.Add(DefaultSessionDuration)
	record := &session.SessionRecord{
		SessionID:              sessionID,
		UserID:                 actor.ID,
		Email:                  actor.Email,
		DeviceType:             binding.DeviceType,
		OAuthCandidateID:       binding.CandidateID,
		AccessAttemptID:        binding.AccessAttemptID,
		StationPeerID:          binding.StationPeerID,
		AccessDecisionRevision: binding.AccessDecisionRevision,
		DeviceID:               binding.DeviceID,
		LifecycleGeneration:    binding.LifecycleGeneration,
		AuthMethod:             "oauth",
		CreatedAt:              now,
		ExpiresAt:              expiresAt,
		LastActiveAt:           now,
		Revoked:                true,
		RevokedReason:          "credential_delivery_pending",
	}
	return record, &model.LoginResponse{
		Tokens: &model.AuthTokens{
			Token:       token.Value,
			AccessToken: token.Value,
			TokenType:   token.Type,
			ExpiresAt:   token.ExpiresAt.Format(time.RFC3339),
		},
		SessionId: sessionID,
		ActorRef:  actorservice.ProtoActorRef(actor),
	}, nil
}

func LoginWithSession(ctx context.Context, credentials *Credentials, clientIP, userAgent, deviceType string) (*SessionLoginResult, error) {
	user, err := AuthenticatePassword(ctx, credentials)
	if err != nil {
		return nil, err
	}

	return IssueTokenAndSession(ctx, user, clientIP, userAgent, deviceType, nil)
}

// AuthenticatePassword resolves a password credential to an Actor without
// creating a token or session. Access Gate uses this to keep the identity
// attempt-scoped until every Station-owned gate has passed.
func AuthenticatePassword(ctx context.Context, credentials *Credentials) (*db.Actor, error) {
	if credentials == nil {
		return nil, ErrInvalidCredentials
	}
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	var user db.Actor
	if err := rds.WithContext(ctx).Where("email = ?", credentials.Email).First(&user).Error; err != nil {
		return nil, ErrUserNotFound
	}
	if !crypto.VerifyPassword(user.PasswordHash, credentials.Password) {
		return nil, ErrInvalidCredentials
	}

	return &user, nil
}

// PrepareAccessGateSession creates one active client-class session record and
// its credential response without persisting either. The Access Gate finalizer
// persists both the session and the attempt binding in one transaction.
func PrepareAccessGateSession(
	ctx context.Context,
	actor *db.Actor,
	binding AccessGateSessionBinding,
	clientIP, userAgent string,
	now time.Time,
) (*session.SessionRecord, *model.LoginResponse, error) {
	if actor == nil {
		return nil, nil, errors.New("cannot prepare Access Gate session without actor")
	}
	ptid := strings.TrimSpace(actor.PTID)
	if _, err := actoridentity.Parse(ptid); err != nil {
		return nil, nil, fmt.Errorf("cannot prepare Access Gate session for actor without valid PTID: %w", err)
	}
	if err := binding.DeviceType.Validate(); err != nil {
		return nil, nil, errors.New("Access Gate session binding has a non-canonical client class")
	}
	if strings.TrimSpace(binding.AccessAttemptID) == "" ||
		strings.TrimSpace(binding.StationPeerID) == "" ||
		strings.TrimSpace(binding.DeviceID) == "" ||
		binding.LifecycleGeneration == 0 ||
		binding.AccessDecisionRevision == 0 {
		return nil, nil, errors.New("Access Gate session binding is incomplete")
	}

	sessionID, err := generateSessionID()
	if err != nil {
		return nil, nil, fmt.Errorf("generate Access Gate session ID: %w", err)
	}
	response, err := issueSessionCredential(ctx, actor, sessionID)
	if err != nil {
		return nil, nil, err
	}
	expiresAt := now.Add(DefaultSessionDuration)
	return &session.SessionRecord{
		SessionID:              sessionID,
		UserID:                 actor.ID,
		Email:                  actor.Email,
		DeviceType:             binding.DeviceType,
		IPAddress:              clientIP,
		UserAgent:              userAgent,
		AccessAttemptID:        binding.AccessAttemptID,
		StationPeerID:          binding.StationPeerID,
		AccessDecisionRevision: binding.AccessDecisionRevision,
		DeviceID:               binding.DeviceID,
		LifecycleGeneration:    binding.LifecycleGeneration,
		AuthMethod:             "access_gate",
		CreatedAt:              now,
		ExpiresAt:              expiresAt,
		LastActiveAt:           now,
	}, response, nil
}

// ResumeAccessGateSession reissues bearer material for the same durable
// session identity. It is used only for an idempotent submission replay after
// the original Rust caller failed before persisting the credential.
func ResumeAccessGateSession(
	ctx context.Context,
	actor *db.Actor,
	record *session.SessionRecord,
) (*model.LoginResponse, error) {
	if actor == nil || record == nil ||
		record.Revoked || !record.ExpiresAt.After(time.Now()) ||
		strings.TrimSpace(record.SessionID) == "" {
		return nil, errors.New("Access Gate session is unavailable")
	}
	return issueSessionCredential(ctx, actor, record.SessionID)
}

func issueSessionCredential(
	ctx context.Context,
	actor *db.Actor,
	sessionID string,
) (*model.LoginResponse, error) {
	ptid := strings.TrimSpace(actor.PTID)
	if _, err := actoridentity.Parse(ptid); err != nil {
		return nil, fmt.Errorf("cannot issue session for actor without valid PTID: %w", err)
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	_, token, err := provider.Authenticate(ctx, coreauth.Credentials{
		SubjectID:  ptid,
		SessionID:  sessionID,
		Attributes: map[string]string{"email": actor.Email},
	})
	if err != nil {
		return nil, fmt.Errorf("issue Access Gate session credential: %w", err)
	}
	return &model.LoginResponse{
		Tokens: &model.AuthTokens{
			Token:       token.Value,
			AccessToken: token.Value,
			TokenType:   token.Type,
			ExpiresAt:   token.ExpiresAt.Format(time.RFC3339),
		},
		SessionId: sessionID,
		ActorRef:  actorservice.ProtoActorRef(actor),
	}, nil
}

// IssueTokenAndSession creates a JWT token + session for an already-authenticated Actor.
// extraData is merged into session.Data (e.g. {"auth_method": "oauth_bridge"}).
func IssueTokenAndSession(ctx context.Context, actor *db.Actor, clientIP, userAgent, deviceType string, extraData map[string]interface{}) (*SessionLoginResult, error) {
	clientClass, err := session.ParseDeviceType(deviceType)
	if err != nil {
		return nil, err
	}

	data := map[string]interface{}{"device_type": string(clientClass)}
	for k, v := range extraData {
		data[k] = v
	}
	sess, token, err := prepareSessionCredential(
		ctx,
		actor,
		clientIP,
		userAgent,
		data,
	)
	if err != nil {
		return nil, err
	}

	_, kickedCount, err := SessionManager().CreateWithKick(ctx, sess, clientClass)
	if err != nil {
		return nil, err
	}

	return sessionLoginResult(actor, sess.ID, token, kickedCount), nil
}

func prepareSessionCredential(
	ctx context.Context,
	actor *db.Actor,
	clientIP string,
	userAgent string,
	data map[string]interface{},
) (*session.Session, *coreauth.Token, error) {
	if actor == nil {
		return nil, nil, errors.New("cannot issue session without actor")
	}
	ptid := strings.TrimSpace(actor.PTID)
	if _, err := actoridentity.Parse(ptid); err != nil {
		return nil, nil, fmt.Errorf(
			"cannot issue session for actor without valid PTID: %w",
			err,
		)
	}

	sessionID, err := generateSessionID()
	if err != nil {
		return nil, nil, err
	}
	provider := coreauth.NewJWTProvider(
		coreauth.Get().Secret,
		coreauth.Get().AccessTTL,
	)
	_, token, err := provider.Authenticate(ctx, coreauth.Credentials{
		SubjectID:  ptid,
		SessionID:  sessionID,
		Attributes: map[string]string{"email": actor.Email},
	})
	if err != nil {
		return nil, nil, err
	}

	now := time.Now()
	return &session.Session{
		ID:        sessionID,
		UserID:    uint64(actor.ID),
		Email:     actor.Email,
		CreatedAt: now,
		ExpiresAt: now.Add(DefaultSessionDuration),
		LastSeen:  now,
		IPAddress: clientIP,
		UserAgent: userAgent,
		Data:      data,
	}, token, nil
}

func sessionLoginResult(
	actor *db.Actor,
	sessionID string,
	token *coreauth.Token,
	kickedCount int64,
) *SessionLoginResult {
	return &SessionLoginResult{
		AccessToken:   token.Value,
		RefreshToken:  "",
		TokenType:     token.Type,
		ExpiresAt:     token.ExpiresAt,
		SessionID:     sessionID,
		Actor:         actor,
		KickedSession: kickedCount > 0,
	}
}

// IssueTakeoverTokenAndSession rotates one existing Session without changing
// its canonical client class or installation identity.
func IssueTakeoverTokenAndSession(
	ctx context.Context,
	actor *db.Actor,
	previousSessionID string,
	clientIP, userAgent, requestedClass string,
) (*SessionLoginResult, error) {
	if actor == nil {
		return nil, errors.New("cannot take over session without actor")
	}
	clientClass, err := session.ParseDeviceType(requestedClass)
	if err != nil {
		return nil, err
	}
	sess, token, err := prepareSessionCredential(
		ctx,
		actor,
		clientIP,
		userAgent,
		map[string]interface{}{"auth_method": "session_takeover"},
	)
	if err != nil {
		return nil, err
	}
	_, kickedCount, err := SessionManager().Takeover(
		ctx,
		previousSessionID,
		sess,
		clientClass,
	)
	if err != nil {
		return nil, err
	}
	return sessionLoginResult(actor, sess.ID, token, kickedCount), nil
}

func ValidateSession(ctx context.Context, sessionID string) (bool, string) {
	return SessionManager().CheckValid(ctx, sessionID)
}

func LogoutSession(ctx context.Context, sessionID string) error {
	return SessionManager().Delete(ctx, sessionID)
}

func ChangePassword(ctx context.Context, userID uint64, oldPassword, newPassword string) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	var user db.Actor
	if err := rds.WithContext(ctx).Where("id = ?", userID).First(&user).Error; err != nil {
		return ErrUserNotFound
	}

	if !crypto.VerifyPassword(user.PasswordHash, oldPassword) {
		return ErrInvalidCredentials
	}

	hash, err := crypto.HashPassword(newPassword)
	if err != nil {
		return err
	}

	if err := rds.WithContext(ctx).Model(&db.Actor{}).Where("id = ?", userID).Update("password_hash", hash).Error; err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	return nil
}

// ResetActorPassword overwrites an actor's password without requiring the old
// one. It is the single canonical admin/Dashboard reset path: it resolves the
// actor by PTID, hashes through the shared crypto helper, and writes the same
// password_hash column verified by AuthenticatePassword.
func ResetActorPassword(ctx context.Context, actorPTID, newPassword string) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	var user db.Actor
	if err := rds.WithContext(ctx).Where("ptid = ?", actorPTID).First(&user).Error; err != nil {
		return ErrUserNotFound
	}

	hash, err := crypto.HashPassword(newPassword)
	if err != nil {
		return err
	}

	if err := rds.WithContext(ctx).Model(&db.Actor{}).Where("id = ?", user.ID).Update("password_hash", hash).Error; err != nil {
		return fmt.Errorf("reset password: %w", err)
	}

	return nil
}

// generateSessionID generates a random session ID
func generateSessionID() (string, error) {
	bytes := make([]byte, 32)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
