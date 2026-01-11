package touch

import (
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const (
	RouterURLSocialPosts        RouterPath = "/api/v1/social/posts"
	RouterURLSocialPost         RouterPath = "/api/v1/social/posts/:id"
	RouterURLSocialPostLike     RouterPath = "/api/v1/social/posts/:id/like"
	RouterURLSocialPostUnlike   RouterPath = "/api/v1/social/posts/:id/unlike"
	RouterURLSocialPostRepost   RouterPath = "/api/v1/social/posts/:id/repost"
	RouterURLSocialPostLikers   RouterPath = "/api/v1/social/posts/:id/likers"
	RouterURLSocialTimeline     RouterPath = "/api/v1/social/timeline"
	RouterURLSocialUserPosts    RouterPath = "/api/v1/social/users/:userId/posts"
)

type SocialRouters struct{}

var _ server.Routers = (*SocialRouters)(nil)

func (sr *SocialRouters) Handlers() []server.Handler {
	handlerInfos := GetSocialHandlers()
	handlers := make([]server.Handler, len(handlerInfos))

	for i, info := range handlerInfos {
		handlers[i] = server.NewHandler(
			info.RouterURL,
			info.Handler,
			server.WithMethod(info.Method),
			server.WithWrappers(info.Wrappers...),
		)
	}

	return handlers
}

func (sr *SocialRouters) Name() string {
	return ""
}

func NewSocialRouter() *SocialRouters {
	return &SocialRouters{}
}
