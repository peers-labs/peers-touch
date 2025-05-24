package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/model"
)

func Signup(c context.Context, ctx *app.RequestContext) {
	var params model.SignupParams
	if err := ctx.BindQuery(&params); err != nil {
		log.Warnf(c, "bind params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}
	if err := params.Check(); err != nil {
		log.Warnf(c, "check params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}
	ctx.JSON(http.StatusOK, "hello world，signup")
}
