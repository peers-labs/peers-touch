package touch

import (
	"context"
	"net/http"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
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
		{
			RouterURL: RouterURLUserProfile,
			Handler:   GetUserProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{CommonAccessControlWrapper("User")},
		},
		{
			RouterURL: RouterURLUserProfile,
			Handler:   UpdateUserProfile,
			Method:    server.PUT,
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

	// Prepare credentials
	credentials := &auth.Credentials{
		Email:    params.Email,
		Password: params.Password,
	}

	// Get client IP and user agent
	clientIP := ctx.ClientIP()
	userAgent := string(ctx.GetHeader("User-Agent"))

	// Use auth service to handle login with session
	result, err := auth.LoginWithSession(c, credentials, clientIP, userAgent)
	if err != nil {
		log.Warnf(c, "Login failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Set session cookie
	ctx.SetCookie("session_id", result.SessionID, int(24*time.Hour.Seconds()), "/", "", protocol.CookieSameSiteDisabled, false, true)

	// Return success response
	SuccessResponse(ctx, "Login successful", result)
}

func GetUserProfile(c context.Context, ctx *app.RequestContext) {
	// TODO: Extract user ID from JWT token or session
	// For now, we'll use a placeholder - this should be implemented with proper authentication
	userID := uint64(1) // This should come from authenticated user context

	profile, err := user.GetProfile(c, userID)
	if err != nil {
		log.Warnf(c, "Get profile failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Profile retrieved successfully", profile)
}

func UpdateUserProfile(c context.Context, ctx *app.RequestContext) {
	var params model.ProfileUpdateParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Update profile bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	// TODO: Extract user ID from JWT token or session
	// For now, we'll use a placeholder - this should be implemented with proper authentication
	userID := uint64(1) // This should come from authenticated user context

	if err := user.UpdateProfile(c, userID, &params); err != nil {
		log.Warnf(c, "Update profile failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Profile updated successfully", nil)
}
