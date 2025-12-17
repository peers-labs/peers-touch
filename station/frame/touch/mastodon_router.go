package touch

import (
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	hertzadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/hertz"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	MastodonURLApps              RouterPath = "/api/v1/apps"
	MastodonURLVerifyCredentials RouterPath = "/api/v1/accounts/verify_credentials"
	MastodonURLStatuses          RouterPath = "/api/v1/statuses"
	MastodonURLStatus            RouterPath = "/api/v1/statuses/:id"
	MastodonURLFavourite         RouterPath = "/api/v1/statuses/:id/favourite"
	MastodonURLUnfavourite       RouterPath = "/api/v1/statuses/:id/unfavourite"
	MastodonURLReblog            RouterPath = "/api/v1/statuses/:id/reblog"
	MastodonURLUnreblog          RouterPath = "/api/v1/statuses/:id/unreblog"
	MastodonURLTimelinesHome     RouterPath = "/api/v1/timelines/home"
	MastodonURLTimelinesPublic   RouterPath = "/api/v1/timelines/public"
	MastodonURLInstance          RouterPath = "/api/v1/instance"
	MastodonURLDirectory         RouterPath = "/api/v1/directory"
)

type MastodonRouters struct{}

var _ server.Routers = (*MastodonRouters)(nil)

func (mr *MastodonRouters) Handlers() []server.Handler {
	commonWrapper := CommonAccessControlWrapper(model.RouteNameMastodon)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	return []server.Handler{
		server.NewHandler(MastodonURLApps, MastodonApps, server.WithMethod(server.POST), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLVerifyCredentials, MastodonVerifyCredentials, server.WithMethod(server.GET), server.WithWrappers(commonWrapper), server.WithHertzMiddlewares(hertzadapter.RequireJWT(provider))),
		server.NewHandler(MastodonURLStatuses, MastodonCreateStatus, server.WithMethod(server.POST), server.WithWrappers(commonWrapper), server.WithHertzMiddlewares(hertzadapter.RequireJWT(provider))),
		server.NewHandler(MastodonURLStatus, MastodonGetStatus, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLFavourite, MastodonFavourite, server.WithMethod(server.POST), server.WithWrappers(commonWrapper), server.WithHertzMiddlewares(hertzadapter.RequireJWT(provider))),
		server.NewHandler(MastodonURLUnfavourite, MastodonUnfavourite, server.WithMethod(server.POST), server.WithWrappers(commonWrapper), server.WithHertzMiddlewares(hertzadapter.RequireJWT(provider))),
		server.NewHandler(MastodonURLReblog, MastodonReblog, server.WithMethod(server.POST), server.WithWrappers(commonWrapper), server.WithHertzMiddlewares(hertzadapter.RequireJWT(provider))),
		server.NewHandler(MastodonURLUnreblog, MastodonUnreblog, server.WithMethod(server.POST), server.WithWrappers(commonWrapper), server.WithHertzMiddlewares(hertzadapter.RequireJWT(provider))),
		server.NewHandler(MastodonURLTimelinesHome, MastodonTimelinesHome, server.WithMethod(server.GET), server.WithWrappers(commonWrapper), server.WithHertzMiddlewares(hertzadapter.RequireJWT(provider))),
		server.NewHandler(MastodonURLTimelinesPublic, MastodonTimelinesPublic, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLInstance, MastodonInstance, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLDirectory, MastodonDirectory, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
	}
}

func (mr *MastodonRouters) Name() string {
	// Return empty string to mount Mastodon API at root (e.g. /api/v1/...)
	// This is required for compatibility with Mastodon clients.
	return ""
}

func NewMastodonRouter() *MastodonRouters { return &MastodonRouters{} }
