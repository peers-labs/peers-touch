package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/model"
)

func Webfinger(c context.Context, ctx *app.RequestContext) {
	var params model.WebFingerParams

	if err := ctx.BindQuery(&params); err != nil {
		log.Warnf(c, "bind params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Resource.Check(); err != nil {
		log.Warnf(c, "check resource failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	ctx.JSON(http.StatusOK, "hello world，webfinger")
}
