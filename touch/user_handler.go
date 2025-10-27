package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-touch/peers-touch-go/core/server"
	"github.com/peers-touch/peers-touch-go/touch/model"
)

// UserHandlerInfo represents a single user handler's information
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
			Handler:   UserSignUpHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{},
		},
		{
			RouterURL: RouterURLUserLogin,
			Handler:   UserLoginHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{},
		},
		{
			RouterURL: RouterURLUserProfile,
			Handler:   UserProfileHandler,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{},
		},
	}
}

// Handler implementations

// UserSignUpHandler handles user registration
func UserSignUpHandler(ctx context.Context, c *app.RequestContext) {
	c.JSON(http.StatusOK, model.NewSuccessResponse("to-do", map[string]string{
		"message": "User sign up endpoint",
	}))
}

// UserLoginHandler handles user login
func UserLoginHandler(ctx context.Context, c *app.RequestContext) {
	c.JSON(http.StatusOK, model.NewSuccessResponse("to-do", map[string]string{
		"message": "User login endpoint",
	}))
}

// UserProfileHandler handles user profile retrieval
func UserProfileHandler(ctx context.Context, c *app.RequestContext) {
	c.JSON(http.StatusOK, model.NewSuccessResponse("to-do", map[string]string{
		"message": "User profile endpoint",
	}))
}
