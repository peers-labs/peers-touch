package touch

import (
	"context"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/webfinger"
)

// WellKnownHandlerInfo represents a single handler's information
type WellKnownHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// GetWellKnownHandlers returns all well-known handler configurations
func GetWellKnownHandlers() []WellKnownHandlerInfo {
	return []WellKnownHandlerInfo{
		{
			RouterURL: RouterURLWellKnown,
			Handler:   WellKnownHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{CommonAccessControlWrapper(model.RouteNameWellKnown)},
		},
		{
			RouterURL: RouterURLWellKnownWebFinger,
			Handler:   WebfingerHandler,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{CommonAccessControlWrapper(model.RouteNameWellKnown)},
		},
		{
			RouterURL: RouterURLWellKnownHostMeta,
			Handler:   HostMetaHandler,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{CommonAccessControlWrapper(model.RouteNameWellKnown)},
		},
		{
			RouterURL: RouterURLWellKnownNodeInfo,
			Handler:   NodeInfoWellKnown,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{CommonAccessControlWrapper(model.RouteNameWellKnown)},
		},
	}
}

// Handler implementations

func WellKnownHandler(c context.Context, ctx *app.RequestContext) {
	ctx.String(http.StatusOK, "hello world, well-known")
}

func WebfingerHandler(c context.Context, ctx *app.RequestContext) {
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

	// Discover the actor
	response, err := webfinger.DiscoverActor(c, &params, requestedRels)
	if err != nil {
		log.Error(c, "[Webfinger] discovery failed: %v", err)

		if strings.Contains(err.Error(), "actor not found") {
			ctx.JSON(http.StatusNotFound, map[string]string{
				"error":   "not_found",
				"message": "Resource not found",
			})
			return
		}

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

	// Set WebFinger content type
	ctx.Header("Content-Type", model.ContentTypeJRDUTF8)
	ctx.Header("Access-Control-Allow-Origin", "*")
	ctx.Header("Access-Control-Allow-Methods", "GET")
	ctx.Header("Access-Control-Allow-Headers", "Content-Type")

	ctx.JSON(http.StatusOK, response)
}

// NodeInfo Well-Known: returns a link to the NodeInfo schema document
func NodeInfoWellKnown(c context.Context, ctx *app.RequestContext) {
	base := string(ctx.URI().Scheme())
	if base == "" {
		base = "https"
	}
	host := string(ctx.Host())
	href := base + "://" + host + "/nodeinfo/2.1"
	resp := map[string]interface{}{
		"links": []map[string]string{
			{
				"rel":  "http://nodeinfo.diaspora.software/ns/schema/2.1",
				"href": href,
			},
		},
	}
	ctx.Header("Content-Type", model.ContentTypeJSONUTF8)
	ctx.JSON(http.StatusOK, resp)
}

// HostMetaHandler handles /.well-known/host-meta requests
// Returns an XML response pointing to the WebFinger endpoint
func HostMetaHandler(c context.Context, ctx *app.RequestContext) {
	base := string(ctx.URI().Scheme())
	if base == "" {
		base = "https"
	}
	host := string(ctx.Host())
	// Construct the WebFinger URL template
	// e.g. https://example.com/.well-known/webfinger?resource={uri}
	template := base + "://" + host + "/.well-known/webfinger?resource={uri}"

	xmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd" type="application/xrd+xml" template="` + template + `"/>
</XRD>`

	ctx.Header("Content-Type", "application/xrd+xml; charset=utf-8")
	ctx.Header("Access-Control-Allow-Origin", "*")
	ctx.Data(http.StatusOK, "application/xrd+xml; charset=utf-8", []byte(xmlContent))
}
