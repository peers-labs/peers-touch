package aibox

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_box/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_box/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
)

// ==================== Request/Response types ====================

type createProviderReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Logo        string `json:"logo"`
	KeyVaults   string `json:"key_vaults"`
	SettingsJson string `json:"settings_json"`
	ConfigJson  string `json:"config_json"`
}

type updateProviderReq struct {
	ID          string  `json:"id"`
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Logo        *string `json:"logo"`
	Enabled     *bool   `json:"enabled"`
	KeyVaults   *string `json:"key_vaults"`
	SettingsJson *string `json:"settings_json"`
	ConfigJson  *string `json:"config_json"`
}

// ==================== Handlers ====================

func (s *aiBoxSubServer) handleNewProvider(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	var req createProviderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		logger.Errorf(ctx, "[%s] Invalid create provider request: err=%v", logID, err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	protoReq := &model.Provider{
		Name:        req.Name,
		Description: req.Description,
		Logo:        req.Logo,
		KeyVaults:   req.KeyVaults,
		SettingsJson: req.SettingsJson,
		ConfigJson:  req.ConfigJson,
	}

	provider, err := service.CreateProvider(ctx, protoReq)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to create provider: %v", logID, err)
		http.Error(w, "create failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Provider created: name=%s", logID, req.Name)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"provider": provider,
	})
}

func (s *aiBoxSubServer) handleUpdateProvider(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	var req updateProviderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		logger.Errorf(ctx, "[%s] Invalid update provider request: err=%v", logID, err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	protoReq := &model.Provider{
		Id: req.ID,
	}
	if req.Name != nil {
		protoReq.Name = *req.Name
	}
	if req.Description != nil {
		protoReq.Description = *req.Description
	}
	if req.Logo != nil {
		protoReq.Logo = *req.Logo
	}
	if req.Enabled != nil {
		protoReq.Enabled = *req.Enabled
	}
	if req.KeyVaults != nil {
		protoReq.KeyVaults = *req.KeyVaults
	}
	if req.SettingsJson != nil {
		protoReq.SettingsJson = *req.SettingsJson
	}
	if req.ConfigJson != nil {
		protoReq.ConfigJson = *req.ConfigJson
	}

	provider, err := service.UpdateProvider(ctx, protoReq)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to update provider: %v", logID, err)
		http.Error(w, "update failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Provider updated: id=%s", logID, req.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"provider": provider,
	})
}

func (s *aiBoxSubServer) handleDeleteProvider(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		http.Error(w, "invalid request: id required", http.StatusBadRequest)
		return
	}

	if err := service.DeleteProvider(ctx, req.ID); err != nil {
		logger.Errorf(ctx, "[%s] Failed to delete provider: %v", logID, err)
		http.Error(w, "delete failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Provider deleted: id=%s", logID, req.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *aiBoxSubServer) handleGetProvider(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}

	provider, err := service.GetProvider(ctx, id)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to get provider: %v", logID, err)
		http.Error(w, "get failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"provider": provider,
	})
}

func (s *aiBoxSubServer) handleListProviders(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	pageNumber, _ := strconv.Atoi(r.URL.Query().Get("page_number"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageNumber <= 0 {
		pageNumber = 1
	}
	if pageSize <= 0 {
		pageSize = 10
	}

	enabledOnly := r.URL.Query().Get("enabled_only") == "true"

	pageQuery := types.PageQuery{
		PageNumber: int32(pageNumber),
		PageSize:   int32(pageSize),
	}

	data, err := service.ListProviders(ctx, pageQuery, enabledOnly)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to list providers: %v", logID, err)
		http.Error(w, "list failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func (s *aiBoxSubServer) handleTestProvider(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		http.Error(w, "invalid request: id required", http.StatusBadRequest)
		return
	}

	ok, msg, err := service.TestProvider(ctx, req.ID)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to test provider: %v", logID, err)
		http.Error(w, "test failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      ok,
		"message": msg,
	})
}
