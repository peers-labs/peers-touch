package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-touch/peers-touch-go/core/store"
	"github.com/peers-touch/peers-touch-go/touch/model/db"
)

// AuthMethod represents different authentication methods
type AuthMethod string

const (
	AuthMethodJWT    AuthMethod = "jwt"
	AuthMethodOAuth2 AuthMethod = "oauth2"
)

// AuthProvider defines the interface for authentication providers
type AuthProvider interface {
	// Authenticate validates user credentials and returns authentication result
	Authenticate(ctx context.Context, credentials *Credentials) (*AuthResult, error)

	// ValidateToken validates an authentication token and returns user info
	ValidateToken(ctx context.Context, token string) (*TokenInfo, error)

	// RefreshToken refreshes an existing token
	RefreshToken(ctx context.Context, refreshToken string) (*AuthResult, error)

	// RevokeToken revokes/invalidates a token
	RevokeToken(ctx context.Context, token string) error

	// GetMethod returns the authentication method this provider supports
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
	User         *db.User  `json:"user"`
	Actor        *db.Actor `json:"actor,omitempty"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"` // "Bearer", etc.
}

// TokenInfo represents information about a validated token
type TokenInfo struct {
	UserID    uint64    `json:"user_id"`
	ActorID   uint64    `json:"actor_id"`
	Email     string    `json:"email"`
	ExpiresAt time.Time `json:"expires_at"`
	IssuedAt  time.Time `json:"issued_at"`
}

// AuthService manages authentication providers
type AuthService struct {
	providers     map[AuthMethod]AuthProvider
	defaultMethod AuthMethod
}

// NewAuthService creates a new authentication node
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
	AccessToken  string                 `json:"access_token"`
	RefreshToken string                 `json:"refresh_token"`
	TokenType    string                 `json:"token_type"`
	ExpiresAt    time.Time              `json:"expires_at"`
	SessionID    string                 `json:"session_id"`
	User         map[string]interface{} `json:"user"`
}

// LoginWithSession handles JWT authentication and session creation
func LoginWithSession(ctx context.Context, credentials *Credentials, clientIP, userAgent string) (*SessionLoginResult, error) {
	// Get database connection for JWT provider
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	// Initialize JWT provider
	jwtProvider := NewJWTProvider(rds, "your-secret-key", 24*time.Hour, 7*24*time.Hour)

	// Authenticate user
	authResult, err := jwtProvider.Authenticate(ctx, credentials)
	if err != nil {
		return nil, err
	}

	// Generate session ID
	sessionID, err := generateSessionID()
	if err != nil {
		return nil, err
	}

	// Create session manager and store session
	sessionStore := NewMemorySessionStore(24 * time.Hour)
	sessionManager := NewSessionManager(sessionStore, 24*time.Hour)

	// Create session
	session, err := sessionManager.CreateSession(ctx, authResult.Actor, sessionID, clientIP, userAgent)
	if err != nil {
		return nil, err
	}

	// Return login result
	return &SessionLoginResult{
		AccessToken:  authResult.AccessToken,
		RefreshToken: authResult.RefreshToken,
		TokenType:    authResult.TokenType,
		ExpiresAt:    authResult.ExpiresAt,
		SessionID:    session.ID,
		User: map[string]interface{}{
			"id":    authResult.Actor.ID,
			"name":  authResult.Actor.Name,
			"email": authResult.Actor.Email,
		},
	}, nil
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

// GetCurrentActor extracts the current actor from the request context
// Returns nil if no actor is found or if the actor is not authenticated
func GetCurrentActor(ctx *app.RequestContext) *db.Actor {
	// Try to get user ID from context (set by middleware)
	userIDInterface, exists := ctx.Get("user_id")
	if !exists {
		return nil
	}

	userID, ok := userIDInterface.(uint64)
	if !ok {
		return nil
	}

	// Get database connection
	rds, err := store.GetRDS(context.Background())
	if err != nil {
		return nil
	}

	// Find the actor by user ID
	var actor db.Actor
	if err := rds.Where("internal_id = ?", userID).First(&actor).Error; err != nil {
		return nil
	}

	return &actor
}
