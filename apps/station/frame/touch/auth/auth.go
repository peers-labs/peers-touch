package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const DefaultSessionDuration = 24 * time.Hour

var sessionManager *session.Manager

func InitSessionManager(ctx context.Context) {
	dbStore := session.NewDBStore(func(ctx context.Context) (*gorm.DB, error) {
		return store.GetRDS(ctx)
	}, DefaultSessionDuration)

	if err := dbStore.AutoMigrate(ctx); err != nil {
		panic(fmt.Errorf("session store auto migrate failed: %v", err))
	}

	sessionManager = session.NewManager(dbStore, DefaultSessionDuration)
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
	ActorID   uint64    `json:"user_id"`
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
	AccessToken   string                 `json:"access_token"`
	RefreshToken  string                 `json:"refresh_token"`
	TokenType     string                 `json:"token_type"`
	ExpiresAt     time.Time              `json:"expires_at"`
	SessionID     string                 `json:"session_id"`
	User          map[string]interface{} `json:"user"`
	KickedSession bool                   `json:"kicked_session,omitempty"` // True if another session was kicked
}

func LoginWithSession(ctx context.Context, credentials *Credentials, clientIP, userAgent, deviceType string) (*SessionLoginResult, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	var user db.Actor
	if err := rds.WithContext(ctx).Where("email = ?", credentials.Email).First(&user).Error; err != nil {
		return nil, ErrUserNotFound
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(credentials.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	_, token, err := provider.Authenticate(ctx, coreauth.Credentials{SubjectID: fmt.Sprintf("%d", user.ID), Attributes: map[string]string{"email": user.Email}})
	if err != nil {
		return nil, err
	}

	sessionID, err := generateSessionID()
	if err != nil {
		return nil, err
	}

	if deviceType == "" {
		deviceType = "desktop"
	}

	sess := &session.Session{
		ID:        sessionID,
		UserID:    uint64(user.ID),
		Email:     user.Email,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(DefaultSessionDuration),
		LastSeen:  time.Now(),
		IPAddress: clientIP,
		UserAgent: userAgent,
		Data:      map[string]interface{}{"device_type": deviceType},
	}

	_, kickedCount, err := SessionManager().CreateWithKick(ctx, sess, session.DeviceType(deviceType))
	if err != nil {
		return nil, err
	}

	return &SessionLoginResult{
		AccessToken:   token.Value,
		RefreshToken:  "",
		TokenType:     token.Type,
		ExpiresAt:     token.ExpiresAt,
		SessionID:     sessionID,
		KickedSession: kickedCount > 0,
		User: map[string]interface{}{
			"id":           user.ID,
			"actor_id":     user.ID,
			"name":         user.PreferredUsername,
			"display_name": user.Name,
			"email":        user.Email,
			"username":     user.PreferredUsername,
		},
	}, nil
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

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return ErrInvalidCredentials
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password failed: %w", err)
	}

	if err := rds.WithContext(ctx).Model(&db.Actor{}).Where("id = ?", userID).Update("password_hash", string(hash)).Error; err != nil {
		return fmt.Errorf("update password failed: %w", err)
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
