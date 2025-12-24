package aibox

import (
    "context"
    "net/http"

    "github.com/cloudwego/hertz/pkg/app"
    "github.com/peers-labs/peers-touch/station/app/subserver/ai_box/service"
    "github.com/peers-labs/peers-touch/station/frame/core/types"
)

func (s *aiBoxSubServer) handleNewProvider(c context.Context, ctx *app.RequestContext) {
    var req serviceRequestCreateProvider
    if err := ctx.Bind(&req); err != nil { ctx.String(http.StatusBadRequest, "invalid request: %v", err); return }

    provider, err := service.CreateProvider(c, req.ToProto())
    if err != nil { ctx.String(http.StatusInternalServerError, "create failed: %v", err); return }
    ctx.JSON(http.StatusOK, provider)
}

func (s *aiBoxSubServer) handleUpdateProvider(c context.Context, ctx *app.RequestContext) {
    var req serviceRequestUpdateProvider
    if err := ctx.Bind(&req); err != nil { ctx.String(http.StatusBadRequest, "invalid request: %v", err); return }

    provider, err := service.UpdateProvider(c, req.ToProto())
    if err != nil { ctx.String(http.StatusInternalServerError, "update failed: %v", err); return }
    ctx.JSON(http.StatusOK, provider)
}

func (s *aiBoxSubServer) handleDeleteProvider(c context.Context, ctx *app.RequestContext) {
    var req struct { Id string `json:"id"` }
    if err := ctx.Bind(&req); err != nil || req.Id == "" { ctx.String(http.StatusBadRequest, "invalid request: id required"); return }
    if err := service.DeleteProvider(c, req.Id); err != nil { ctx.String(http.StatusInternalServerError, "delete failed: %v", err); return }
    ctx.JSON(http.StatusOK, map[string]interface{}{"deleted": true})
}

func (s *aiBoxSubServer) handleGetProvider(c context.Context, ctx *app.RequestContext) {
    id := string(ctx.Query("id"))
    if id == "" { ctx.String(http.StatusBadRequest, "id is required"); return }
    provider, err := service.GetProvider(c, id)
    if err != nil { ctx.String(http.StatusInternalServerError, "get failed: %v", err); return }
    ctx.JSON(http.StatusOK, provider)
}

func (s *aiBoxSubServer) handleListProviders(c context.Context, ctx *app.RequestContext) {
    pg := types.PageQuery{ PageNumber: 1, PageSize: 10 }
    if err := ctx.BindQuery(&pg); err != nil { ctx.String(http.StatusBadRequest, "invalid request: %v", err); return }

    enabledOnly := false
    if v := ctx.Query("enabled_only"); len(v) > 0 && string(v) == "true" { enabledOnly = true }
    data, err := service.ListProviders(c, pg, enabledOnly)
    if err != nil { ctx.String(http.StatusInternalServerError, "list failed: %v", err); return }
    ctx.JSON(http.StatusOK, data)
}

func (s *aiBoxSubServer) handleTestProvider(c context.Context, ctx *app.RequestContext) {
    var req struct { Id string `json:"id"` }
    if err := ctx.Bind(&req); err != nil || req.Id == "" { ctx.String(http.StatusBadRequest, "invalid request: id required"); return }
    ok, msg, err := service.TestProvider(c, req.Id)
    if err != nil { ctx.String(http.StatusInternalServerError, "test failed: %v", err); return }
    ctx.JSON(http.StatusOK, map[string]interface{}{"ok": ok, "message": msg})
}
