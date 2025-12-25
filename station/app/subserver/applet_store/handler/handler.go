package applet_store

import (
	"encoding/json"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type appletURL struct{ name, path string }

func (u appletURL) SubPath() string { return u.path }
func (u appletURL) Name() string    { return u.name }

type AppletHandler struct {
	pathBase string
	service  *service.StoreService
}

func NewAppletHandler(pathBase string, svc *service.StoreService) *AppletHandler {
	return &AppletHandler{
		pathBase: pathBase,
		service:  svc,
	}
}

func (h *AppletHandler) Handlers() []server.Handler {
	// Base path is usually /api/v1/applets
	base := h.pathBase

	return []server.Handler{
		server.NewHandler(appletURL{name: "list-applets", path: base}, http.HandlerFunc(h.handleList), server.WithMethod(server.GET)),
		server.NewHandler(appletURL{name: "get-applet", path: base + "/details"}, http.HandlerFunc(h.handleGetDetails), server.WithMethod(server.GET)),
		server.NewHandler(appletURL{name: "publish-applet", path: base + "/publish"}, http.HandlerFunc(h.handlePublish), server.WithMethod(server.POST)),
		// Serve bundle files directly
		server.NewHandler(appletURL{name: "get-bundle", path: base + "/bundle"}, http.HandlerFunc(h.handleGetBundle), server.WithMethod(server.GET)),
	}
}

func (h *AppletHandler) handleList(w http.ResponseWriter, r *http.Request) {
	// limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	// offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	applets, err := h.service.GenerateMockApplets()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(applets)
}

func (h *AppletHandler) handleGetDetails(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}

	applet, version, err := h.service.GetAppletDetails(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := map[string]any{
		"applet":         applet,
		"latest_version": version,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
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
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	// Delegate to service storage logic to serve file
	// Assuming service exposes a method to open file or we implement it here
	// For MVP, if storage is local fs, we can use http.ServeFile but need to know the root
	// Better to add a GetBundle method to service

	http.Error(w, "not implemented yet", http.StatusNotImplemented)
}
