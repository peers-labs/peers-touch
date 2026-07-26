package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ProviderHandlers struct {
	providerConfig *service.ProviderConfigService
	modelConfig    *service.ModelConfigService
	credentialCfg  *service.CredentialConfigService
}

func NewProviderHandlers(
	providerConfig *service.ProviderConfigService,
	modelConfig *service.ModelConfigService,
	credentialCfg *service.CredentialConfigService,
) *ProviderHandlers {
	return &ProviderHandlers{
		providerConfig: providerConfig,
		modelConfig:    modelConfig,
		credentialCfg:  credentialCfg,
	}
}

func (h *ProviderHandlers) HandleVerifyCli(_ context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "application/json")

	var input struct {
		CliCommand string `json:"cli_command"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"available":false,"error":"invalid request body"}`))
		return nil
	}
	if input.CliCommand == "" {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"available":false,"error":"cli_command is required"}`))
		return nil
	}

	result := cli.VerifyCliBinary(input.CliCommand)
	data, _ := json.Marshal(result)
	_, _ = resp.Write(data)
	return nil
}

func (h *ProviderHandlers) HandleProviderList(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	providers, err := h.providerConfig.List(ctx, actorID)
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"providers": providers})
}

func (h *ProviderHandlers) HandleProviderCreate(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID  string          `json:"provider_id"`
		DisplayName string          `json:"display_name"`
		BaseURL     string          `json:"base_url"`
		Protocol    string          `json:"protocol"`
		ConfigJSON  json.RawMessage `json:"config_json"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	provider, err := h.providerConfig.Create(ctx, service.ProviderCreateRequest{
		ActorID:     actorID,
		ProviderID:  input.ProviderID,
		DisplayName: input.DisplayName,
		BaseURL:     input.BaseURL,
		Protocol:    input.Protocol,
		ConfigJSON:  input.ConfigJSON,
	})
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"provider": provider})
}

func (h *ProviderHandlers) HandleProviderUpdate(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID  string          `json:"provider_id"`
		Version     int64           `json:"version"`
		DisplayName *string         `json:"display_name"`
		BaseURL     *string         `json:"base_url"`
		Enabled     *bool           `json:"enabled"`
		ConfigJSON  json.RawMessage `json:"config_json"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	provider, err := h.providerConfig.Update(ctx, service.ProviderUpdateRequest{
		ActorID:     actorID,
		ProviderID:  input.ProviderID,
		Version:     input.Version,
		DisplayName: input.DisplayName,
		BaseURL:     input.BaseURL,
		Enabled:     input.Enabled,
		ConfigJSON:  input.ConfigJSON,
	})
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"provider": provider})
}

func (h *ProviderHandlers) HandleProviderDelete(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
		Version    int64  `json:"version"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	if err := h.providerConfig.Delete(ctx, service.ProviderDeleteRequest{
		ActorID:    actorID,
		ProviderID: input.ProviderID,
		Version:    input.Version,
	}); err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"deleted": true})
}

func (h *ProviderHandlers) HandleModelList(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	models, err := h.modelConfig.List(ctx, actorID, input.ProviderID)
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"models": models})
}

func (h *ProviderHandlers) HandleModelUpdate(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID  string  `json:"provider_id"`
		ModelID     string  `json:"model_id"`
		Version     int64   `json:"version"`
		DisplayName *string `json:"display_name"`
		Enabled     *bool   `json:"enabled"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	model, err := h.modelConfig.Update(ctx, service.ModelUpdateRequest{
		ActorID:     actorID,
		ProviderID:  input.ProviderID,
		ModelID:     input.ModelID,
		Version:     input.Version,
		DisplayName: input.DisplayName,
		Enabled:     input.Enabled,
	})
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"model": model})
}

func (h *ProviderHandlers) HandleCredentialSet(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
		APIKey     string `json:"api_key"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	status, err := h.credentialCfg.Set(ctx, service.CredentialSetRequest{
		ActorID:    actorID,
		ProviderID: input.ProviderID,
		APIKey:     input.APIKey,
	})
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, status)
}

func (h *ProviderHandlers) HandleCredentialDelete(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
		Version    int64  `json:"version"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	if err := h.credentialCfg.Delete(ctx, service.CredentialDeleteRequest{
		ActorID:    actorID,
		ProviderID: input.ProviderID,
		Version:    input.Version,
	}); err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"deleted": true})
}

func (h *ProviderHandlers) HandleCredentialStatus(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	status, err := h.credentialCfg.Status(ctx, actorID, input.ProviderID)
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, status)
}

func (h *ProviderHandlers) HandleCredentialResolve(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	resolved, err := h.credentialCfg.Resolve(ctx, actorID, input.ProviderID)
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, resolved)
}

func (h *ProviderHandlers) HandleModelHide(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
		ModelID    string `json:"model_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}
	if input.ProviderID == "" || input.ModelID == "" {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider_id and model_id required", nil))
	}

	if err := h.providerConfig.HideModel(ctx, actorID, input.ProviderID, input.ModelID); err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"ok": true})
}

func (h *ProviderHandlers) HandleModelHiddenList(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := auth.GetSubject(ctx).ID

	var input struct {
		ProviderID string `json:"provider_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		return writeError(resp, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid request body", err))
	}

	hidden, err := h.providerConfig.GetHiddenModels(ctx, actorID, input.ProviderID)
	if err != nil {
		return writeError(resp, err)
	}

	return writeJSON(resp, http.StatusOK, map[string]interface{}{"hidden_models": hidden})
}

func writeJSON(resp server.Response, status int, data interface{}) error {
	resp.SetHeader("Content-Type", "application/json")
	resp.WriteHeader(status)
	out, _ := json.Marshal(data)
	_, _ = resp.Write(out)
	return nil
}

func writeError(resp server.Response, err error) error {
	bizErr, ok := err.(*errcode.BizError)
	if !ok {
		resp.SetHeader("Content-Type", "application/json")
		resp.WriteHeader(http.StatusInternalServerError)
		_, _ = resp.Write([]byte(`{"error":"internal error"}`))
		return nil
	}

	resp.SetHeader("Content-Type", "application/json")
	resp.WriteHeader(bizErr.HTTPStatus)
	out, _ := json.Marshal(map[string]interface{}{
		"error": bizErr.Message,
		"code":  bizErr.Code,
	})
	_, _ = resp.Write(out)
	return nil
}
