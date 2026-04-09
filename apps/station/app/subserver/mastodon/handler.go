package mastodon

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
)

// Route path constants for Mastodon API compatibility.
// Mounted directly at root (no prefix) for Mastodon client compatibility.
const (
	urlApps              = "/api/v1/apps"
	urlVerifyCredentials = "/api/v1/accounts/verify_credentials"
	urlStatuses          = "/api/v1/statuses"
	urlStatus            = "/api/v1/statuses/:id"
	urlFavourite         = "/api/v1/statuses/:id/favourite"
	urlUnfavourite       = "/api/v1/statuses/:id/unfavourite"
	urlReblog            = "/api/v1/statuses/:id/reblog"
	urlUnreblog          = "/api/v1/statuses/:id/unreblog"
	urlTimelinesHome     = "/api/v1/timelines/home"
	urlTimelinesPublic   = "/api/v1/timelines/public"
	urlInstance          = "/api/v1/instance"
	urlDirectory         = "/api/v1/directory"
)

// Handlers returns all Mastodon API HTTP handlers for route registration.
func (s *subServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHTTPHandler(urlApps, urlApps, server.POST, server.HertzHandlerFunc(handleApps)),
		server.NewHTTPHandler(urlVerifyCredentials, urlVerifyCredentials, server.GET, server.HertzHandlerFunc(handleVerifyCredentials)),
		server.NewHTTPHandler(urlStatuses, urlStatuses, server.POST, server.HertzHandlerFunc(handleCreateStatus)),
		server.NewHTTPHandler(urlStatus, urlStatus, server.GET, server.HertzHandlerFunc(handleGetStatus)),
		server.NewHTTPHandler(urlFavourite, urlFavourite, server.POST, server.HertzHandlerFunc(handleFavourite)),
		server.NewHTTPHandler(urlUnfavourite, urlUnfavourite, server.POST, server.HertzHandlerFunc(handleUnfavourite)),
		server.NewHTTPHandler(urlReblog, urlReblog, server.POST, server.HertzHandlerFunc(handleReblog)),
		server.NewHTTPHandler(urlUnreblog, urlUnreblog, server.POST, server.HertzHandlerFunc(handleUnreblog)),
		server.NewHTTPHandler(urlTimelinesHome, urlTimelinesHome, server.GET, server.HertzHandlerFunc(handleTimelinesHome)),
		server.NewHTTPHandler(urlTimelinesPublic, urlTimelinesPublic, server.GET, server.HertzHandlerFunc(handleTimelinesPublic)),
		server.NewHTTPHandler(urlInstance, urlInstance, server.GET, server.HertzHandlerFunc(handleInstance)),
		server.NewHTTPHandler(urlDirectory, urlDirectory, server.GET, server.HertzHandlerFunc(handleDirectory)),
	}
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

func handleApps(c context.Context, ctx *app.RequestContext) {
	clientName := string(ctx.PostForm("client_name"))
	redirectURIs := string(ctx.PostForm("redirect_uris"))
	scopes := string(ctx.PostForm("scopes"))
	website := string(ctx.PostForm("website"))
	if clientName == "" || redirectURIs == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	resp, err := RegisterApp(c, clientName, redirectURIs, scopes, website)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ctx.JSON(http.StatusOK, resp)
}

func handleVerifyCredentials(c context.Context, ctx *app.RequestContext) {
	auth := string(ctx.Request.Header.Peek("Authorization"))
	actor := string(ctx.Query("actor"))
	acc, err := VerifyCredentials(c, auth, actor)
	if err != nil {
		ctx.JSON(http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	b, _ := util.ProtoMarshal(acc)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func handleCreateStatus(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	if username == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_required"})
		return
	}
	body, err := ctx.Body()
	if err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	var req model.MastodonCreateStatusRequest
	if err := util.ProtoUnmarshal(body, &req); err != nil || req.Status == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_payload"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := CreateStatus(c, username, req, baseURL)
	if err != nil {
		log.Warnf(c, "create status failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusCreated, "application/json; charset=utf-8", b)
}

func handleGetStatus(c context.Context, ctx *app.RequestContext) {
	id := string(ctx.Param("id"))
	if id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "id_required"})
		return
	}
	st, err := GetStatus(c, id)
	if err != nil {
		ctx.JSON(http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func handleInstance(c context.Context, ctx *app.RequestContext) {
	baseURL := baseURLFrom(ctx)
	instance, err := GetInstance(c, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ctx.JSON(http.StatusOK, instance)
}

func handleFavourite(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := Favourite(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func handleUnfavourite(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := Unfavourite(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func handleReblog(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := Reblog(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func handleUnreblog(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := Unreblog(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func handleTimelinesHome(c context.Context, ctx *app.RequestContext) {
	ctx.JSON(http.StatusNotImplemented, map[string]string{"error": "not_implemented"})
}

func handleTimelinesPublic(c context.Context, ctx *app.RequestContext) {
	ctx.JSON(http.StatusNotImplemented, map[string]string{"error": "not_implemented"})
}

func handleDirectory(c context.Context, ctx *app.RequestContext) {
	limitStr := string(ctx.Query("limit"))
	offsetStr := string(ctx.Query("offset"))
	limit := 20
	offset := 0
	if limitStr != "" {
		if v, e := strconv.Atoi(limitStr); e == nil && v > 0 {
			limit = v
		}
	}
	if offsetStr != "" {
		if v, e := strconv.Atoi(offsetStr); e == nil && v >= 0 {
			offset = v
		}
	}
	items, err := Directory(c, limit, offset)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ctx.JSON(http.StatusOK, items)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// baseURLFrom derives the public-facing base URL from reverse-proxy headers.
func baseURLFrom(ctx *app.RequestContext) string {
	scheme := string(ctx.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		scheme = string(ctx.URI().Scheme())
	}
	if scheme == "" {
		scheme = "https"
	}

	host := string(ctx.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = string(ctx.Host())
	}

	if _, _, err := net.SplitHostPort(host); err != nil {
		port := string(ctx.GetHeader("X-Forwarded-Port"))
		if port != "" && port != "80" && port != "443" {
			host = net.JoinHostPort(host, port)
		}
	}

	return fmt.Sprintf("%s://%s", scheme, host)
}
