package touch

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/touch/auth"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/user"
)

// UserHandlerInfo represents a single handler's information
type UserHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// GetUserHandlers returns all user handler configurations
func GetUserHandlers() []UserHandlerInfo {
	return []UserHandlerInfo{
		{
			RouterURL: RouterURLUserSignUP,
			Handler:   UserSignup,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{CommonAccessControlWrapper("User")},
		},
		{
			RouterURL: RouterURLUserLogin,
			Handler:   UserLogin,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{CommonAccessControlWrapper("User")},
		},
	}
}

// Handler implementations

func UserSignup(c context.Context, ctx *app.RequestContext) {
	var params model.UserSignParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Singup bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Check(); err != nil {
		log.Warnf(c, "Singup checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	err := user.SignUp(c, &params)
	if err != nil {
		log.Warnf(c, "Singup failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "User signup successful", nil)
}

func UserLogin(c context.Context, ctx *app.RequestContext) {
	var params model.UserLoginParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Login bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Check(); err != nil {
		log.Warnf(c, "Login checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Get database connection
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "Login get db failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	// Initialize JWT provider
	jwtProvider := auth.NewJWTProvider(rds, "your-secret-key", 24*time.Hour, 7*24*time.Hour)

	// Authenticate user
	credentials := &auth.Credentials{
		Email:    params.Email,
		Password: params.Password,
	}

	authResult, err := jwtProvider.Authenticate(c, credentials)
	if err != nil {
		log.Warnf(c, "Login authentication failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Generate session ID
	sessionID, err := generateSessionID()
	if err != nil {
		log.Warnf(c, "Login generate session ID failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to generate session")
		return
	}

	// Create session manager and store session
	sessionStore := auth.NewMemorySessionStore(24 * time.Hour)
	sessionManager := auth.NewSessionManager(sessionStore, 24*time.Hour)

	// Get client IP and user agent
	clientIP := ctx.ClientIP()
	userAgent := string(ctx.GetHeader("User-Agent"))

	session, err := sessionManager.CreateSession(c, authResult.User, sessionID, clientIP, userAgent)
	if err != nil {
		log.Warnf(c, "Login create session failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Failed to create session")
		return
	}

	// Set session cookie
	ctx.SetCookie("session_id", sessionID, int(24*time.Hour.Seconds()), "/", "", protocol.CookieSameSiteDisabled, false, true)

	// Return success response with tokens and user info
	responseData := map[string]interface{}{
		"access_token":  authResult.AccessToken,
		"refresh_token": authResult.RefreshToken,
		"token_type":    authResult.TokenType,
		"expires_at":    authResult.ExpiresAt,
		"session_id":    session.ID,
		"user": map[string]interface{}{
			"id":    authResult.User.ID,
			"name":  authResult.User.Name,
			"email": authResult.User.Email,
		},
	}

	SuccessResponse(ctx, "Login successful", responseData)
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
