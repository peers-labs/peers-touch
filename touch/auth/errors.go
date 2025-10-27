package auth

import (
	"errors"
)

var (
	// Authentication errors
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserNotFound      = errors.New("user not found")
	ErrInvalidToken      = errors.New("invalid or expired token")
	ErrTokenExpired      = errors.New("token has expired")
	ErrTokenRevoked      = errors.New("token has been revoked")
	ErrNoAuthProvider    = errors.New("no authentication provider available")
	
	// Session errors
	ErrSessionNotFound   = errors.New("session not found")
	ErrSessionExpired    = errors.New("session has expired")
	
	// JWT specific errors
	ErrJWTSigningFailed   = errors.New("failed to sign JWT token")
	ErrJWTParsingFailed   = errors.New("failed to parse JWT token")
	ErrJWTInvalidClaims   = errors.New("invalid JWT claims")
	ErrJWTSecretNotSet    = errors.New("JWT secret not configured")
	
	// OAuth2 specific errors (for future use)
	ErrOAuth2InvalidGrant    = errors.New("invalid OAuth2 grant")
	ErrOAuth2InvalidClient   = errors.New("invalid OAuth2 client")
	ErrOAuth2InvalidScope    = errors.New("invalid OAuth2 scope")
	ErrOAuth2ProviderError   = errors.New("OAuth2 provider error")
)