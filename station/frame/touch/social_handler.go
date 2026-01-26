package touch

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/handler"
)

type SocialHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

func GetSocialHandlers() []SocialHandlerInfo {
	commonWrapper := CommonAccessControlWrapper(model.RouteNameSocial)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	return []SocialHandlerInfo{
		{
			RouterURL: RouterURLSocialPosts,
			Handler:   handler.CreatePost,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialPost,
			Handler:   handler.GetPost,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: RouterURLSocialPost,
			Handler:   handler.UpdatePost,
			Method:    server.PUT,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialPost,
			Handler:   handler.DeletePost,
			Method:    server.DELETE,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialPostLike,
			Handler:   handler.LikePost,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialPostUnlike,
			Handler:   handler.UnlikePost,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialPostLikers,
			Handler:   handler.GetPostLikers,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: RouterURLSocialPostRepost,
			Handler:   handler.RepostPost,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialTimeline,
			Handler:   handler.GetTimeline,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialUserPosts,
			Handler:   handler.GetUserPosts,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialPostComments,
			Handler:   handler.GetPostComments,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: RouterURLSocialPostComments,
			Handler:   handler.CreateComment,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialComment,
			Handler:   handler.DeleteComment,
			Method:    server.DELETE,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialFollow,
			Handler:   handler.Follow,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialUnfollow,
			Handler:   handler.Unfollow,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialRelationship,
			Handler:   handler.GetRelationship,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialRelationship,
			Handler:   handler.GetRelationships,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialFollowers,
			Handler:   handler.GetFollowers,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLSocialFollowing,
			Handler:   handler.GetFollowing,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper, jwtWrapper},
		},
	}
}
