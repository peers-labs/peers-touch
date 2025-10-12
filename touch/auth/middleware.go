package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

// Default durations for tokens and sessions
const (
	DefaultAccessTokenDuration  = 24 * time.Hour
	DefaultRefreshTokenDuration = 7 * 24 * time.Hour
	DefaultSessionDuration      = 24 * time.Hour
)

// AuthMiddleware provides authentication middleware functionality
type AuthMiddleware struct {
	jwtProvider    *JWTProvider
	sessionManager *SessionManager
}

// NewAuthMiddleware creates a new authentication middleware
func NewAuthMiddleware(jwtProvider *JWTProvider, sessionManager *SessionManager) *AuthMiddleware {
	return &AuthMiddleware{
		jwtProvider:    jwtProvider,
		sessionManager: sessionManager,
	}
}

// RequireAuth is a middleware that requires authentication
// Note: This returns a function that can be used as a wrapper for Hertz handlers
func (m *AuthMiddleware) RequireAuth() func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		// Try to authenticate using JWT token first
		if userInfo := m.authenticateWithJWT(c, ctx); userInfo != nil {
			// Set user info in context for use in handlers
			ctx.Set("user_id", userInfo.UserID)
			ctx.Set("user_email", userInfo.Email)
			return
		}

		// Try to authenticate using session
		if userInfo := m.authenticateWithSession(c, ctx); userInfo != nil {
			// Set user info in context for use in handlers
			ctx.Set("user_id", userInfo.UserID)
			ctx.Set("user_email", userInfo.Email)
			return
		}

		// Authentication failed
		log.Warnf(c, "Authentication required but no valid credentials provided")
		ctx.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}
}

// RequireJWT is a middleware that specifically requires JWT authentication
func (m *AuthMiddleware) RequireJWT() func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		userInfo := m.authenticateWithJWT(c, ctx)
		if userInfo == nil {
			log.Warnf(c, "JWT authentication required but no valid token provided")
			ctx.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Valid JWT token required",
			})
			return
		}

		// Set user info in context for use in handlers
		ctx.Set("user_id", userInfo.UserID)
		ctx.Set("user_email", userInfo.Email)
	}
}

// RequireSession is a middleware that specifically requires session authentication
func (m *AuthMiddleware) RequireSession() func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		userInfo := m.authenticateWithSession(c, ctx)
		if userInfo == nil {
			log.Warnf(c, "Session authentication required but no valid session provided")
			ctx.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Valid session required",
			})
			return
		}

		// Set user info in context for use in handlers
		ctx.Set("user_id", userInfo.UserID)
		ctx.Set("user_email", userInfo.Email)
	}
}

// authenticateWithJWT attempts to authenticate using JWT token from Authorization header
func (m *AuthMiddleware) authenticateWithJWT(c context.Context, ctx *app.RequestContext) *TokenInfo {
	if m.jwtProvider == nil {
		return nil
	}

	// Get Authorization header
	authHeader := string(ctx.GetHeader("Authorization"))
	if authHeader == "" {
		return nil
	}

	// Check if it's a Bearer token
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return nil
	}

	// Extract token
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == "" {
		return nil
	}

	// Validate token
	tokenInfo, err := m.jwtProvider.ValidateToken(c, token)
	if err != nil {
		log.Debugf(c, "JWT token validation failed: %v", err)
		return nil
	}

	return tokenInfo
}

// authenticateWithSession attempts to authenticate using session cookie
func (m *AuthMiddleware) authenticateWithSession(c context.Context, ctx *app.RequestContext) *TokenInfo {
	if m.sessionManager == nil {
		return nil
	}

	// Get session ID from cookie
	sessionID := string(ctx.Cookie("session_id"))
	if sessionID == "" {
		return nil
	}

	// Validate session
	session, err := m.sessionManager.GetSession(c, sessionID)
	if err != nil {
		log.Debugf(c, "Session validation failed: %v", err)
		return nil
	}

	// Convert session to TokenInfo
	return &TokenInfo{
		UserID:    session.UserID,
		Email:     session.Email,
		ExpiresAt: session.ExpiresAt,
		IssuedAt:  session.CreatedAt,
	}
}

// CreateAuthMiddleware is a helper function to create middleware with database connection
func CreateAuthMiddleware(c context.Context, jwtSecret string) (*AuthMiddleware, error) {
	// Get database connection
	rds, err := store.GetRDS(c)
	if err != nil {
		return nil, err
	}

	// Create JWT provider
	jwtProvider := NewJWTProvider(rds, jwtSecret, DefaultAccessTokenDuration, DefaultRefreshTokenDuration)

	// Create session store and manager
	sessionStore := NewMemorySessionStore(DefaultSessionDuration)
	sessionManager := NewSessionManager(sessionStore, DefaultSessionDuration)

	return NewAuthMiddleware(jwtProvider, sessionManager), nil
}
