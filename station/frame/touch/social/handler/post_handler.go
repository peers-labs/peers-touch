package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
)

const SubjectContextKey = "auth_subject"

func getUserID(c context.Context) (uint64, bool) {
	if subject, ok := c.Value(SubjectContextKey).(*coreauth.Subject); ok {
		userID, err := strconv.ParseUint(subject.ID, 10, 64)
		if err != nil {
			return 0, false
		}
		return userID, true
	}
	return 0, false
}

func CreatePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.CreatePostRequest{})
	if err != nil {
		return
	}

	post, err := service.CreatePost(c, req, userID)
	if err != nil {
		logger.Error(c, "failed to create post", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_CREATE_POST_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, post)
}

func GetPost(c context.Context, ctx *app.RequestContext) {
	postID := ctx.Param("id")
	if postID == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_POST_ID_REQUIRED))
		return
	}

	var viewerID uint64
	if userID, exists := getUserID(c); exists {
		viewerID = userID
	}

	post, err := service.GetPost(c, postID, viewerID)
	if err != nil {
		logger.Error(c, "failed to get post", "error", err)
		util.RspError(c, ctx, http.StatusNotFound, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_GET_POST_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, post)
}

func UpdatePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.UpdatePostRequest{})
	if err != nil {
		return
	}

	post, err := service.UpdatePost(c, req, userID)
	if err != nil {
		logger.Error(c, "failed to update post", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UPDATE_POST_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, post)
}

func DeletePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_POST_ID_REQUIRED))
		return
	}

	err := service.DeletePost(c, postID, userID)
	if err != nil {
		logger.Error(c, "failed to delete post", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_DELETE_POST_FAILED, err.Error()))
		return
	}

	ctx.JSON(http.StatusOK, map[string]bool{"success": true})
}

func LikePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_POST_ID_REQUIRED))
		return
	}

	resp, err := service.LikePost(c, postID, userID)
	if err != nil {
		logger.Error(c, "failed to like post", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_LIKE_POST_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, resp)
}

func UnlikePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_POST_ID_REQUIRED))
		return
	}

	resp, err := service.UnlikePost(c, postID, userID)
	if err != nil {
		logger.Error(c, "failed to unlike post", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNLIKE_POST_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, resp)
}

func GetPostLikers(c context.Context, ctx *app.RequestContext) {
	req, err := util.ReqBind(c, ctx, &model.GetPostLikersRequest{})
	if err != nil {
		return
	}

	resp, err := service.GetPostLikers(c, req)
	if err != nil {
		logger.Error(c, "failed to get post likers", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_GET_LIKERS_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, resp)
}

func RepostPost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_POST_ID_REQUIRED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.RepostRequest{})
	if err != nil {
		logger.Error(c, "failed to bind request", "error", err)
	}
	req.PostId = postID

	resp, err := service.RepostPost(c, req, userID)
	if err != nil {
		logger.Error(c, "failed to repost", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_REPOST_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, resp)
}

func GetUserPosts(c context.Context, ctx *app.RequestContext) {
	userID := ctx.Param("userId")
	if userID == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_USER_ID_REQUIRED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.ListPostsRequest{})
	if err != nil {
		return
	}

	if req.Filter == nil {
		req.Filter = &model.PostFilter{}
	}
	req.Filter.AuthorId = userID

	var viewerID uint64
	if vID, exists := getUserID(c); exists {
		viewerID = vID
	}

	resp, err := service.ListPosts(c, req, viewerID)
	if err != nil {
		logger.Error(c, "failed to get user posts", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_LIST_POSTS_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, resp)
}
