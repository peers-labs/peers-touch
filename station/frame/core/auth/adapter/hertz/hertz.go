package hertz

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

func RequireJWT(p coreauth.Provider) func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		h := string(ctx.GetHeader("Authorization"))
		if len(h) < 7 || h[:7] != "Bearer " {
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]string{"error": "Valid JWT token required"})
			return
		}
		token := h[7:]
		_, err := p.Validate(c, token)
		if err != nil {
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]string{"error": "Invalid or expired token"})
			return
		}
	}
}
