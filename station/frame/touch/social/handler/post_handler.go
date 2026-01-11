package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
	"google.golang.org/protobuf/proto"
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
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req model.CreatePostRequest
	
	// Check Content-Type and parse accordingly
	contentType := string(ctx.GetHeader("Content-Type"))
	if strings.Contains(contentType, model.ContentTypeProtobuf) {
		// Parse Proto binary
		body, err := ctx.Body()
		if err != nil {
			logger.Error(c, "failed to read body", "error", err)
			ctx.JSON(http.StatusBadRequest, map[string]string{"error": "failed to read body"})
			return
		}
		if err := proto.Unmarshal(body, &req); err != nil {
			logger.Error(c, "failed to unmarshal proto", "error", err)
			ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid proto"})
			return
		}
	} else {
		// Parse JSON
		if err := ctx.Bind(&req); err != nil {
			logger.Error(c, "failed to bind request", "error", err)
			ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
	}

	post, err := service.CreatePost(c, &req, userID)
	if err != nil {
		logger.Error(c, "failed to create post", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, post)
}

func GetPost(c context.Context, ctx *app.RequestContext) {
	postID := ctx.Param("id")
	if postID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "post_id is required"})
		return
	}

	var viewerID uint64
	if userID, exists := getUserID(c); exists {
		viewerID = userID
	}

	post, err := service.GetPost(c, postID, viewerID)
	if err != nil {
		logger.Error(c, "failed to get post", "error", err)
		ctx.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, post)
}

func UpdatePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req model.UpdatePostRequest
	if err := ctx.Bind(&req); err != nil {
		logger.Error(c, "failed to bind request", "error", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	post, err := service.UpdatePost(c, &req, userID)
	if err != nil {
		logger.Error(c, "failed to update post", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, post)
}

func DeletePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "post_id is required"})
		return
	}

	err := service.DeletePost(c, postID, userID)
	if err != nil {
		logger.Error(c, "failed to delete post", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, map[string]bool{"success": true})
}

func LikePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "post_id is required"})
		return
	}

	resp, err := service.LikePost(c, postID, userID)
	if err != nil {
		logger.Error(c, "failed to like post", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, resp)
}

func UnlikePost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "post_id is required"})
		return
	}

	resp, err := service.UnlikePost(c, postID, userID)
	if err != nil {
		logger.Error(c, "failed to unlike post", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, resp)
}

func GetPostLikers(c context.Context, ctx *app.RequestContext) {
	var req model.GetPostLikersRequest
	if err := ctx.Bind(&req); err != nil {
		logger.Error(c, "failed to bind request", "error", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	resp, err := service.GetPostLikers(c, &req)
	if err != nil {
		logger.Error(c, "failed to get post likers", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, resp)
}

func RepostPost(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	postID := ctx.Param("id")
	if postID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "post_id is required"})
		return
	}

	var req model.RepostRequest
	if err := ctx.Bind(&req); err != nil {
		logger.Error(c, "failed to bind request", "error", err)
		// Allow empty body for simple repost
	}
	req.PostId = postID

	resp, err := service.RepostPost(c, &req, userID)
	if err != nil {
		logger.Error(c, "failed to repost", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, resp)
}

func GetUserPosts(c context.Context, ctx *app.RequestContext) {
	userID := ctx.Param("userId")
	if userID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "user_id is required"})
		return
	}

	var req model.ListPostsRequest
	if err := ctx.Bind(&req); err != nil {
		logger.Error(c, "failed to bind request", "error", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	// Set filter to get posts by specific user
	if req.Filter == nil {
		req.Filter = &model.PostFilter{}
	}
	req.Filter.AuthorId = userID

	var viewerID uint64
	if vID, exists := getUserID(c); exists {
		viewerID = vID
	}

	resp, err := service.ListPosts(c, &req, viewerID)
	if err != nil {
		logger.Error(c, "failed to get user posts", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, resp)
}

func respondWithProto(c context.Context, ctx *app.RequestContext, statusCode int, msg proto.Message) {
	accept := string(ctx.GetHeader("Accept"))

	if strings.Contains(accept, model.AcceptProtobuf) {
		data, err := proto.Marshal(msg)
		if err != nil {
			logger.Error(c, "failed to marshal protobuf", "error", err)
			ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		ctx.Data(statusCode, model.ContentTypeProtobuf, data)
		return
	}

	data, err := json.Marshal(msg)
	if err != nil {
		logger.Error(c, "failed to marshal json", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}
	var result map[string]interface{}
	json.Unmarshal(data, &result)
	ctx.JSON(statusCode, result)
}
