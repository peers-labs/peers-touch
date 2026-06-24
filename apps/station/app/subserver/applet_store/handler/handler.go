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
}

func NewAppletHandler(pathBase string, svc *service.StoreService) *AppletHandler {
	return &AppletHandler{
		pathBase: pathBase,
		service:  svc,
		handlers: NewAppletHandlers(svc),
	}
}

func (h *AppletHandler) Handlers() []server.Handler {
	base := h.pathBase
	logIDWrapper := serverwrapper.LogID()

	return []server.Handler{
		server.NewTypedHandler(
			"list-applets",
			base,
			server.GET,
			h.handlers.HandleListApplets,
			logIDWrapper,
		),
		server.NewTypedHandler(
			"get-applet",
			base+"/details",
			server.GET,
			h.handlers.HandleGetAppletDetails,
			logIDWrapper,
		),
		server.NewHTTPHandler("publish-applet", base+"/publish", server.POST, server.HTTPHandlerFunc(h.handlePublish), logIDWrapper),
		server.NewHTTPHandler("get-bundle", base+"/bundle", server.GET, server.HTTPHandlerFunc(h.handleGetBundle), logIDWrapper),
		server.NewTypedHandler("publish-applet-version", base+"/publish/typed", server.POST, h.handlers.HandlePublishAppletVersion, logIDWrapper),
		server.NewTypedHandler("list-applet-catalog", base+"/catalog", server.GET, h.handlers.HandleListAppletCatalog, logIDWrapper),
		server.NewTypedHandler("get-applet-version", base+"/version", server.GET, h.handlers.HandleGetAppletVersion, logIDWrapper),
		server.NewTypedHandler("install-applet", base+"/install", server.POST, h.handlers.HandleInstallApplet, logIDWrapper),
		server.NewTypedHandler("uninstall-applet", base+"/uninstall", server.POST, h.handlers.HandleUninstallApplet, logIDWrapper),
		server.NewTypedHandler("list-installed-applets", base+"/installed", server.GET, h.handlers.HandleListInstalledApplets, logIDWrapper),
		server.NewTypedHandler("revoke-applet-version", base+"/revoke", server.POST, h.handlers.HandleRevokeAppletVersion, logIDWrapper),
		server.NewTypedHandler("rollback-applet-channel", base+"/rollback", server.POST, h.handlers.HandleRollbackAppletChannel, logIDWrapper),
		server.NewTypedHandler("ingest-applet-audit", base+"/audit/ingest", server.POST, h.handlers.HandleIngestAppletAudit, logIDWrapper),
		server.NewTypedHandler("query-applet-audit", base+"/audit/query", server.GET, h.handlers.HandleQueryAppletAudit, logIDWrapper),
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
