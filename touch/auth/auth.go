package auth

import (
	"context"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
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
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"` // "Bearer", etc.
}

// TokenInfo represents information extracted from a validated token
type TokenInfo struct {
	UserID    uint64    `json:"user_id"`
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