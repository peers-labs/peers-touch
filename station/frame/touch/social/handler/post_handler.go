package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

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
	if err := ctx.Bind(&req); err != nil {
		logger.Error(c, "failed to bind request", "error", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	post, err := service.CreatePost(c, &req, userID)
	if err != nil {
		logger.Error(c, "failed to create post", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, protoToJSON(post))
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

	ctx.JSON(http.StatusOK, protoToJSON(post))
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

	ctx.JSON(http.StatusOK, protoToJSON(post))
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

	ctx.JSON(http.StatusOK, protoToJSON(resp))
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

	ctx.JSON(http.StatusOK, protoToJSON(resp))
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

	ctx.JSON(http.StatusOK, protoToJSON(resp))
}

func protoToJSON(msg proto.Message) map[string]interface{} {
	data, _ := json.Marshal(msg)
	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result
}
