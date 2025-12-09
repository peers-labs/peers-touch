package touch

import (
	"github.com/peers-labs/peers-touch/station/frame/core/server"
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
	MastodonURLDirectory         RouterPath = "/api/v1/directory"
)

type MastodonRouters struct{}

var _ server.Routers = (*MastodonRouters)(nil)

func (mr *MastodonRouters) Handlers() []server.Handler {
	commonWrapper := CommonAccessControlWrapper(RoutersNameActivityPub)
	return []server.Handler{
		server.NewHandler(MastodonURLApps, MastodonApps, server.WithMethod(server.POST), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLVerifyCredentials, MastodonVerifyCredentials, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLStatuses, MastodonCreateStatus, server.WithMethod(server.POST), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLStatus, MastodonGetStatus, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLFavourite, MastodonFavourite, server.WithMethod(server.POST), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLUnfavourite, MastodonUnfavourite, server.WithMethod(server.POST), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLReblog, MastodonReblog, server.WithMethod(server.POST), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLUnreblog, MastodonUnreblog, server.WithMethod(server.POST), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLTimelinesHome, MastodonTimelinesHome, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLTimelinesPublic, MastodonTimelinesPublic, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
		server.NewHandler(MastodonURLDirectory, MastodonDirectory, server.WithMethod(server.GET), server.WithWrappers(commonWrapper)),
	}
}

func (mr *MastodonRouters) Name() string { return "mastodon" }

func NewMastodonRouter() *MastodonRouters { return &MastodonRouters{} }
