package applet_store

import (
	"encoding/json"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type AppletHandler struct {
	pathBase string
	service  *service.StoreService
	handlers *AppletHandlers
	// authWrapper guards actor-scoped routes (catalog/installed/install/
	// uninstall/version/audit). It is nil for unauthenticated contexts such
	// as the CLI test harness, in which case those routes carry only the
	// LogID wrapper.
	authWrapper server.Wrapper
}

// NewAppletHandler builds the HTTP handler set. The optional authWrapper, when
// provided, is applied to actor-scoped routes so unauthenticated callers cannot
// read or mutate per-actor install state.
func NewAppletHandler(pathBase string, svc *service.StoreService, authWrapper ...server.Wrapper) *AppletHandler {
	h := &AppletHandler{
		pathBase: pathBase,
		service:  svc,
		handlers: NewAppletHandlers(svc),
	}
	if len(authWrapper) > 0 {
		h.authWrapper = authWrapper[0]
	}
	return h
}

func (h *AppletHandler) Handlers() []server.Handler {
	base := h.pathBase
	logIDWrapper := serverwrapper.LogID()

	// publicWrappers cover open/admin/CLI routes; actorWrappers additionally
	// enforce authentication when an auth wrapper was supplied.
	publicWrappers := []server.Wrapper{logIDWrapper}
	actorWrappers := publicWrappers
	if h.authWrapper != nil {
		actorWrappers = []server.Wrapper{logIDWrapper, h.authWrapper}
	}

	return []server.Handler{
		server.NewTypedHandler(
			"list-applets",
			base,
			server.GET,
			h.handlers.HandleListApplets,
			publicWrappers...,
		),
		server.NewTypedHandler(
			"get-applet",
			base+"/details",
			server.GET,
			h.handlers.HandleGetAppletDetails,
			publicWrappers...,
		),
		server.NewHTTPHandler("publish-applet", base+"/publish", server.POST, server.HTTPHandlerFunc(h.handlePublish), publicWrappers...),
		server.NewHTTPHandler("get-bundle", base+"/bundle", server.GET, server.HTTPHandlerFunc(h.handleGetBundle), publicWrappers...),
		server.NewTypedHandler("publish-applet-version", base+"/publish/typed", server.POST, h.handlers.HandlePublishAppletVersion, publicWrappers...),
		server.NewTypedHandler("list-applet-catalog", base+"/catalog", server.GET, h.handlers.HandleListAppletCatalog, actorWrappers...),
		server.NewTypedHandler("get-applet-version", base+"/version", server.GET, h.handlers.HandleGetAppletVersion, actorWrappers...),
		server.NewTypedHandler("install-applet", base+"/install", server.POST, h.handlers.HandleInstallApplet, actorWrappers...),
		server.NewTypedHandler("uninstall-applet", base+"/uninstall", server.POST, h.handlers.HandleUninstallApplet, actorWrappers...),
		server.NewTypedHandler("list-installed-applets", base+"/installed", server.GET, h.handlers.HandleListInstalledApplets, actorWrappers...),
		server.NewTypedHandler("revoke-applet-version", base+"/revoke", server.POST, h.handlers.HandleRevokeAppletVersion, publicWrappers...),
		server.NewTypedHandler("rollback-applet-channel", base+"/rollback", server.POST, h.handlers.HandleRollbackAppletChannel, publicWrappers...),
		server.NewTypedHandler("ingest-applet-audit", base+"/audit/ingest", server.POST, h.handlers.HandleIngestAppletAudit, actorWrappers...),
		server.NewTypedHandler("query-applet-audit", base+"/audit/query", server.GET, h.handlers.HandleQueryAppletAudit, publicWrappers...),
	}
}

func (h *AppletHandler) handlePublish(w http.ResponseWriter, r *http.Request) {
	// Simple implementation for demo
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "invalid multipart form", http.StatusBadRequest)
		return
	}

	name := r.FormValue("name")
	version := r.FormValue("version")
	desc := r.FormValue("description")
	devID := r.FormValue("developer_id")

	file, header, err := r.FormFile("bundle")
	if err != nil {
		http.Error(w, "missing bundle file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	ver, err := h.service.PublishApplet(name, desc, version, devID, file, header)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ver)
}

func (h *AppletHandler) handleGetBundle(w http.ResponseWriter, r *http.Request) {
	bundlePath := r.URL.Query().Get("path")
	if bundlePath == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	filePath, err := h.service.ResolveBundlePath(bundlePath)
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	http.ServeFile(w, r, filePath)
}
