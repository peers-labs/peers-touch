package touch

import (
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
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
	_ = provider
	return []server.Handler{
		server.NewHTTPHandler(MastodonURLApps.Name(), MastodonURLApps.SubPath(), server.POST, server.HertzHandlerFunc(MastodonApps), commonWrapper),
		server.NewHTTPHandler(MastodonURLVerifyCredentials.Name(), MastodonURLVerifyCredentials.SubPath(), server.GET, server.HertzHandlerFunc(MastodonVerifyCredentials), commonWrapper),
		server.NewHTTPHandler(MastodonURLStatuses.Name(), MastodonURLStatuses.SubPath(), server.POST, server.HertzHandlerFunc(MastodonCreateStatus), commonWrapper),
		server.NewHTTPHandler(MastodonURLStatus.Name(), MastodonURLStatus.SubPath(), server.GET, server.HertzHandlerFunc(MastodonGetStatus), commonWrapper),
		server.NewHTTPHandler(MastodonURLFavourite.Name(), MastodonURLFavourite.SubPath(), server.POST, server.HertzHandlerFunc(MastodonFavourite), commonWrapper),
		server.NewHTTPHandler(MastodonURLUnfavourite.Name(), MastodonURLUnfavourite.SubPath(), server.POST, server.HertzHandlerFunc(MastodonUnfavourite), commonWrapper),
		server.NewHTTPHandler(MastodonURLReblog.Name(), MastodonURLReblog.SubPath(), server.POST, server.HertzHandlerFunc(MastodonReblog), commonWrapper),
		server.NewHTTPHandler(MastodonURLUnreblog.Name(), MastodonURLUnreblog.SubPath(), server.POST, server.HertzHandlerFunc(MastodonUnreblog), commonWrapper),
		server.NewHTTPHandler(MastodonURLTimelinesHome.Name(), MastodonURLTimelinesHome.SubPath(), server.GET, server.HertzHandlerFunc(MastodonTimelinesHome), commonWrapper),
		server.NewHTTPHandler(MastodonURLTimelinesPublic.Name(), MastodonURLTimelinesPublic.SubPath(), server.GET, server.HertzHandlerFunc(MastodonTimelinesPublic), commonWrapper),
		server.NewHTTPHandler(MastodonURLInstance.Name(), MastodonURLInstance.SubPath(), server.GET, server.HertzHandlerFunc(MastodonInstance), commonWrapper),
		server.NewHTTPHandler(MastodonURLDirectory.Name(), MastodonURLDirectory.SubPath(), server.GET, server.HertzHandlerFunc(MastodonDirectory), commonWrapper),
	}
}

func (mr *MastodonRouters) Name() string {
	// Return empty string to mount Mastodon API at root (e.g. /api/v1/...)
	// This is required for compatibility with Mastodon clients.
	return ""
}

func NewMastodonRouter() *MastodonRouters { return &MastodonRouters{} }
