package touch

import (
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/handler"
)

type SocialHandlerInfo struct {
	Handler server.Handler
}

func GetSocialHandlers() []SocialHandlerInfo {
	commonWrapper := CommonAccessControlWrapper(model.RouteNameSocial)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	return []SocialHandlerInfo{
		{Handler: server.NewTypedHandler("social-create-post", string(RouterURLSocialPosts), server.POST, handler.HandleCreatePost, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-post", string(RouterURLSocialPost), server.POST, handler.HandleGetPost, commonWrapper)},
		{Handler: server.NewTypedHandler("social-update-post", string(RouterURLSocialPost), server.POST, handler.HandleUpdatePost, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-delete-post", string(RouterURLSocialPost), server.POST, handler.HandleDeletePost, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-like-post", string(RouterURLSocialPostLike), server.POST, handler.HandleLikePost, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-unlike-post", string(RouterURLSocialPostUnlike), server.POST, handler.HandleUnlikePost, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-post-likers", string(RouterURLSocialPostLikers), server.POST, handler.HandleGetPostLikers, commonWrapper)},
		{Handler: server.NewTypedHandler("social-repost-post", string(RouterURLSocialPostRepost), server.POST, handler.HandleRepostPost, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-timeline", string(RouterURLSocialTimeline), server.POST, handler.HandleGetTimeline, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-user-posts", string(RouterURLSocialUserPosts), server.POST, handler.HandleGetUserPosts, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-post-comments", string(RouterURLSocialPostComments), server.POST, handler.HandleGetPostComments, commonWrapper)},
		{Handler: server.NewTypedHandler("social-create-comment", string(RouterURLSocialPostComments), server.POST, handler.HandleCreateComment, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-delete-comment", string(RouterURLSocialComment), server.POST, handler.HandleDeleteComment, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-follow", string(RouterURLSocialFollow), server.POST, handler.HandleFollow, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-unfollow", string(RouterURLSocialUnfollow), server.POST, handler.HandleUnfollow, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-relationship", string(RouterURLSocialRelationship), server.POST, handler.HandleGetRelationship, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-relationships", string(RouterURLSocialRelationship), server.POST, handler.HandleGetRelationships, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-followers", string(RouterURLSocialFollowers), server.POST, handler.HandleGetFollowers, commonWrapper, jwtWrapper)},
		{Handler: server.NewTypedHandler("social-get-following", string(RouterURLSocialFollowing), server.POST, handler.HandleGetFollowing, commonWrapper, jwtWrapper)},
	}
}
