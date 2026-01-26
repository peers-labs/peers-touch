package wrapper

import (
	"context"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func JWT(provider coreauth.Provider) server.Wrapper {
	return server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
}

func GetSubject(ctx context.Context, req server.Request) *coreauth.Subject {
	if subject, ok := ctx.Value(httpadapter.SubjectContextKey).(*coreauth.Subject); ok {
		return subject
	}
	return nil
}
