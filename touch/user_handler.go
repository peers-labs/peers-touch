package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
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
