package handler

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
)

type ProviderHandlers struct{}

func NewProviderHandlers() *ProviderHandlers {
	return &ProviderHandlers{}
}

func (h *ProviderHandlers) HandleCreateProvider(ctx context.Context, req *model.CreateProviderRequest) (*model.CreateProviderResponse, error) {
	if req.Name == "" {
		return nil, toHandlerError(errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "name is required", nil))
	}

	protoReq := &model.Provider{
		Name:         req.Name,
		Description:  req.Description,
		Logo:         req.Logo,
		KeyVaults:    req.KeyVaults,
		SettingsJson: req.SettingsJson,
		ConfigJson:   req.ConfigJson,
	}

	provider, err := service.CreateProvider(ctx, protoReq)
	if err != nil {
		logger.Error(ctx, "Failed to create provider", "error", err)
		return nil, toHandlerError(err)
	}

	logger.Info(ctx, "Provider created", "name", req.Name)

	return &model.CreateProviderResponse{
		Provider: provider,
	}, nil
}

func (h *ProviderHandlers) HandleUpdateProvider(ctx context.Context, req *model.UpdateProviderRequest) (*model.UpdateProviderResponse, error) {
	if req.Id == "" {
		return nil, toHandlerError(errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "id is required", nil))
	}

	protoReq := &model.Provider{
		Id: req.Id,
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
		logger.Error(ctx, "Failed to update provider", "error", err, "id", req.Id)
		return nil, toHandlerError(err)
	}

	logger.Info(ctx, "Provider updated", "id", req.Id)

	return &model.UpdateProviderResponse{
		Provider: provider,
	}, nil
}

func (h *ProviderHandlers) HandleDeleteProvider(ctx context.Context, req *model.DeleteProviderRequest) (*model.DeleteProviderResponse, error) {
	if req.Id == "" {
		return nil, toHandlerError(errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "id is required", nil))
	}

	if err := service.DeleteProvider(ctx, req.Id); err != nil {
		logger.Error(ctx, "Failed to delete provider", "error", err, "id", req.Id)
		return nil, toHandlerError(err)
	}

	logger.Info(ctx, "Provider deleted", "id", req.Id)

	return &model.DeleteProviderResponse{
		Success: true,
	}, nil
}

func (h *ProviderHandlers) HandleGetProvider(ctx context.Context, req *model.GetProviderRequest) (*model.GetProviderResponse, error) {
	if req.Id == "" {
		return nil, toHandlerError(errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "id is required", nil))
	}

	provider, err := service.GetProvider(ctx, req.Id)
	if err != nil {
		logger.Error(ctx, "Failed to get provider", "error", err, "id", req.Id)
		return nil, toHandlerError(err)
	}

	return &model.GetProviderResponse{
		Provider: provider,
	}, nil
}

func (h *ProviderHandlers) HandleListProviders(ctx context.Context, req *model.ListProvidersRequest) (*model.ListProvidersResponse, error) {
	pageNumber := req.PageNumber
	if pageNumber <= 0 {
		pageNumber = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 10
	}

	pageQuery := types.PageQuery{
		PageNumber: pageNumber,
		PageSize:   pageSize,
	}

	data, err := service.ListProviders(ctx, pageQuery, req.EnabledOnly)
	if err != nil {
		logger.Error(ctx, "Failed to list providers", "error", err)
		return nil, toHandlerError(err)
	}

	providers := data["items"].([]interface{})
	protoProviders := make([]*model.Provider, len(providers))
	for i, p := range providers {
		protoProviders[i] = p.(*model.Provider)
	}

	return &model.ListProvidersResponse{
		Providers:  protoProviders,
		Total:      data["total"].(int64),
		PageNumber: pageNumber,
		PageSize:   pageSize,
	}, nil
}

func (h *ProviderHandlers) HandleTestProvider(ctx context.Context, req *model.TestProviderRequest) (*model.TestProviderResponse, error) {
	if req.Id == "" {
		return nil, toHandlerError(errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "id is required", nil))
	}

	ok, msg, err := service.TestProvider(ctx, req.Id)
	if err != nil {
		logger.Error(ctx, "Failed to test provider", "error", err, "id", req.Id)
		return nil, toHandlerError(err)
	}

	return &model.TestProviderResponse{
		Ok:      ok,
		Message: msg,
	}, nil
}
