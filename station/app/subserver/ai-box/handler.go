package aibox

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-touch/peers-touch/station/app/subserver/ai-box/service"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"github.com/peers-touch/peers-touch/station/frame/core/types"
)

func (s *aiBoxSubServer) handleNewProvider(c context.Context, ctx *app.RequestContext) {
	rds, err := store.GetRDS(c, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		ctx.String(http.StatusInternalServerError, "db error: %v", err)
		return
	}
	svc := service.NewProviderService(rds)

	var req serviceRequestCreateProvider
	if err := ctx.Bind(&req); err != nil {
		ctx.String(http.StatusBadRequest, "invalid request: %v", err)
		return
	}

	provider, err := svc.CreateProvider(c, req.ToProto())
	if err != nil {
		ctx.String(http.StatusInternalServerError, "create failed: %v", err)
		return
	}
	ctx.JSON(http.StatusOK, provider)
}

func (s *aiBoxSubServer) handleUpdateProvider(c context.Context, ctx *app.RequestContext) {
	rds, err := store.GetRDS(c, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		ctx.String(http.StatusInternalServerError, "db error: %v", err)
		return
	}
	svc := service.NewProviderService(rds)

	var req serviceRequestUpdateProvider
	if err := ctx.Bind(&req); err != nil {
		ctx.String(http.StatusBadRequest, "invalid request: %v", err)
		return
	}

	provider, err := svc.UpdateProvider(c, req.ToProto())
	if err != nil {
		ctx.String(http.StatusInternalServerError, "update failed: %v", err)
		return
	}
	ctx.JSON(http.StatusOK, provider)
}

func (s *aiBoxSubServer) handleDeleteProvider(c context.Context, ctx *app.RequestContext) {
	rds, err := store.GetRDS(c, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		ctx.String(http.StatusInternalServerError, "db error: %v", err)
		return
	}
	svc := service.NewProviderService(rds)

	var req struct {
		Id string `json:"id"`
	}
	if err := ctx.Bind(&req); err != nil || req.Id == "" {
		ctx.String(http.StatusBadRequest, "invalid request: id required")
		return
	}

	if err := svc.DeleteProvider(c, req.Id); err != nil {
		ctx.String(http.StatusInternalServerError, "delete failed: %v", err)
		return
	}
	ctx.JSON(http.StatusOK, map[string]interface{}{"deleted": true})
}

func (s *aiBoxSubServer) handleGetProvider(c context.Context, ctx *app.RequestContext) {
	rds, err := store.GetRDS(c, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		ctx.String(http.StatusInternalServerError, "db error: %v", err)
		return
	}
	svc := service.NewProviderService(rds)

	id := string(ctx.Query("id"))
	if id == "" {
		ctx.String(http.StatusBadRequest, "id is required")
		return
	}

	provider, err := svc.GetProvider(c, id)
	if err != nil {
		ctx.String(http.StatusInternalServerError, "get failed: %v", err)
		return
	}
	ctx.JSON(http.StatusOK, provider)
}

func (s *aiBoxSubServer) handleListProviders(c context.Context, ctx *app.RequestContext) {
	rds, err := store.GetRDS(c, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		ctx.String(http.StatusInternalServerError, "db error: %v", err)
		return
	}
	svc := service.NewProviderService(rds)

	pg := types.PageQuery{
		Page: 1,
		Size: 10,
	}
	err = ctx.BindQuery(&pg)
	if err != nil {
		ctx.String(http.StatusBadRequest, "invalid request: %v", err)
		return
	}

	enabledOnly := false
	if v := ctx.Query("enabled_only"); len(v) > 0 && string(v) == "true" {
		enabledOnly = true
	}

	providers, total, err := svc.ListProviders(c, pg.Page, pg.Size, enabledOnly)
	if err != nil {
		ctx.String(http.StatusInternalServerError, "list failed: %v", err)
		return
	}
	ctx.JSON(http.StatusOK, map[string]interface{}{"total": total, "providers": providers})
}

func (s *aiBoxSubServer) handleTestProvider(c context.Context, ctx *app.RequestContext) {
	rds, err := store.GetRDS(c, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		ctx.String(http.StatusInternalServerError, "db error: %v", err)
		return
	}
	svc := service.NewProviderService(rds)

	var req struct {
		Id string `json:"id"`
	}
	if err := ctx.Bind(&req); err != nil || req.Id == "" {
		ctx.String(http.StatusBadRequest, "invalid request: id required")
		return
	}

	ok, msg, err := svc.TestProvider(c, req.Id)
	if err != nil {
		ctx.String(http.StatusInternalServerError, "test failed: %v", err)
		return
	}
	ctx.JSON(http.StatusOK, map[string]interface{}{"ok": ok, "message": msg})
}
