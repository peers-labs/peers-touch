package touch

import (
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/session/handler"
)

const (
	RouterURLSessionVerify RouterPath = "/api/v1/session/verify"
)

type SessionRouters struct{}

var _ server.Routers = (*SessionRouters)(nil)

func (sr *SessionRouters) Handlers() []server.Handler {
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := httpadapter.RequireJWT(provider)

	return []server.Handler{
		server.NewHandler(
			RouterURLSessionVerify,
			handler.VerifySession,
			server.WithMethod("GET"),
			server.WithWrappers(jwtWrapper),
		),
	}
}

func (sr *SessionRouters) Name() string {
	return ""
}

func NewSessionRouter() *SessionRouters {
	return &SessionRouters{}
}
