package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/user"
)

func UserSignup(c context.Context, ctx *app.RequestContext) {
	var params model.UserSignParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Singup bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Check(); err != nil {
		log.Warnf(c, "Singup checked params failed: %v", err)
		failedResponse(ctx, err)
		return
	}

	err := user.SignUp(c, &params)
	if err != nil {
		log.Warnf(c, "Singup executed failed: %v", err)
		failedResponse(ctx, err)
		return
	}

	successResponse(ctx, "signup success", params)
}
