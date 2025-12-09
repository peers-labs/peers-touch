package touch

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	mastodonsvc "github.com/peers-labs/peers-touch/station/frame/touch/mastodon"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
)

func MastodonApps(c context.Context, ctx *app.RequestContext) {
	clientName := string(ctx.PostForm("client_name"))
	redirectURIs := string(ctx.PostForm("redirect_uris"))
	scopes := string(ctx.PostForm("scopes"))
	website := string(ctx.PostForm("website"))
	if clientName == "" || redirectURIs == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	resp, err := mastodonsvc.RegisterApp(c, clientName, redirectURIs, scopes, website)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ctx.JSON(http.StatusOK, resp)
}

func MastodonVerifyCredentials(c context.Context, ctx *app.RequestContext) {
	auth := string(ctx.Request.Header.Peek("Authorization"))
	actor := string(ctx.Query("actor"))
	acc, err := mastodonsvc.VerifyCredentials(c, auth, actor)
	if err != nil {
		ctx.JSON(http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	b, _ := util.ProtoMarshal(acc)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func MastodonCreateStatus(c context.Context, ctx *app.RequestContext) {
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
	st, err := mastodonsvc.CreateStatus(c, username, req, baseURL)
	if err != nil {
		log.Warnf(c, "create status failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusCreated, "application/json; charset=utf-8", b)
}

func MastodonGetStatus(c context.Context, ctx *app.RequestContext) {
	id := string(ctx.Param("id"))
	if id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "id_required"})
		return
	}
	st, err := mastodonsvc.GetStatus(c, id)
	if err != nil {
		ctx.JSON(http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func MastodonInstance(c context.Context, ctx *app.RequestContext) {
	baseURL := baseURLFrom(ctx)
	instance, err := mastodonsvc.GetInstance(c, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ctx.JSON(http.StatusOK, instance)
}

func MastodonFavourite(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := mastodonsvc.Favourite(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func MastodonUnfavourite(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := mastodonsvc.Unfavourite(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func MastodonReblog(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := mastodonsvc.Reblog(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func MastodonUnreblog(c context.Context, ctx *app.RequestContext) {
	username := string(ctx.Query("actor"))
	id := string(ctx.Param("id"))
	if username == "" || id == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor_or_id_required"})
		return
	}
	baseURL := baseURLFrom(ctx)
	st, err := mastodonsvc.Unreblog(c, username, id, baseURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	b, _ := util.ProtoMarshal(st)
	ctx.Data(http.StatusOK, "application/json; charset=utf-8", b)
}

func MastodonTimelinesHome(c context.Context, ctx *app.RequestContext) {
	ctx.JSON(http.StatusNotImplemented, map[string]string{"error": "not_implemented"})
}
func MastodonTimelinesPublic(c context.Context, ctx *app.RequestContext) {
	ctx.JSON(http.StatusNotImplemented, map[string]string{"error": "not_implemented"})
}

func MastodonDirectory(c context.Context, ctx *app.RequestContext) {
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
	items, err := mastodonsvc.Directory(c, limit, offset)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ctx.JSON(http.StatusOK, items)
}

func baseURLFrom(ctx *app.RequestContext) string {
	// 1. Try to get scheme from X-Forwarded-Proto
	scheme := string(ctx.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		scheme = string(ctx.URI().Scheme())
	}
	if scheme == "" {
		scheme = "https"
	}

	// 2. Try to get host from X-Forwarded-Host
	host := string(ctx.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = string(ctx.Host())
	}

	// 3. Handle port
	// Check if host has port
	if _, _, err := net.SplitHostPort(host); err != nil {
		// Host likely doesn't have a port, check X-Forwarded-Port
		port := string(ctx.GetHeader("X-Forwarded-Port"))

		// Only append port if it's not standard (80/443) and not empty
		if port != "" && port != "80" && port != "443" {
			host = net.JoinHostPort(host, port)
		}
	}

	return fmt.Sprintf("%s://%s", scheme, host)
}
