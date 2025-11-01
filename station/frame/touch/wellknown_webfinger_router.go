package touch

import (
	"context"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/touch/model"
	"github.com/peers-touch/peers-touch/station/frame/touch/webfinger"
)

func Webfinger(c context.Context, ctx *app.RequestContext) {
	var params model.WebFingerParams

	// Bind query parameters
	if err := ctx.BindQuery(&params); err != nil {
		log.Warnf(c, "[Webfinger] bind params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error":   "invalid_request",
			"message": "Failed to parse query parameters",
		})
		return
	}

	// Validate parameters
	if err := params.Check(); err != nil {
		log.Warnf(c, "[Webfinger] check resource failed: %v", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error":   "invalid_resource",
			"message": err.Error(),
		})
		return
	}

	// Parse requested relationships (rel parameter can appear multiple times)
	requestedRels := make([]string, 0)
	if relParam := ctx.Query("rel"); relParam != "" {
		// Handle comma-separated values or multiple rel parameters
		rels := strings.Split(relParam, ",")
		for _, rel := range rels {
			rel = strings.TrimSpace(rel)
			if rel != "" {
				requestedRels = append(requestedRels, rel)
			}
		}
	}

	// Discover the user
	response, err := webfinger.DiscoverUser(c, &params)
	if err != nil {
		log.Warnf(c, "[Webfinger] user discovery failed: %v", err)

		// Check if it's a "not found" error
		if strings.Contains(err.Error(), "user not found") {
			ctx.JSON(http.StatusNotFound, map[string]string{
				"error":   "not_found",
				"message": "The requested resource was not found",
			})
			return
		}

		// Other errors are internal server errors
		ctx.JSON(http.StatusInternalServerError, map[string]string{
			"error":   "server_error",
			"message": "Internal server error occurred",
		})
		return
	}

	// Filter response based on requested relationships
	if len(requestedRels) > 0 {
		response = webfinger.FilterRequestedRelationships(response, requestedRels)
	}

	// Set appropriate content type for WebFinger response
	ctx.Header("Content-Type", "application/jrd+json; charset=utf-8")
	ctx.Header("Access-Control-Allow-Origin", "*")
	ctx.Header("Access-Control-Allow-Methods", "GET")
	ctx.Header("Access-Control-Allow-Headers", "Content-Type")

	// Return the WebFinger response
	ctx.JSON(http.StatusOK, response)
}
