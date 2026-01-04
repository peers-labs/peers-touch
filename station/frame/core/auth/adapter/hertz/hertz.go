package hertz

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

type contextKey string

const SubjectContextKey contextKey = "auth_subject"

func RequireJWT(p coreauth.Provider) func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		h := string(ctx.GetHeader("Authorization"))
		if len(h) < 7 || h[:7] != "Bearer " {
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]string{"error": "Valid JWT token required"})
			return
		}
		token := h[7:]
		subject, err := p.Validate(c, token)
		if err != nil {
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]string{"error": "Invalid or expired token"})
			return
		}
		ctx.Set(string(SubjectContextKey), subject)
	}
}

func GetSubject(ctx *app.RequestContext) *coreauth.Subject {
	if v, exists := ctx.Get(string(SubjectContextKey)); exists {
		if subject, ok := v.(*coreauth.Subject); ok {
			return subject
		}
	}
	return nil
}
