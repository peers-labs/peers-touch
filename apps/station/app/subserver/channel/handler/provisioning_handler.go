package handler

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
)

const defaultProviderKind = "lark"
const defaultPluginID = "lark"

type ProvisioningHandlers struct {
	coordinator *channelsvc.ProvisioningCoordinator
}

func NewProvisioningHandlers(
	coordinator *channelsvc.ProvisioningCoordinator,
) *ProvisioningHandlers {
	return &ProvisioningHandlers{coordinator: coordinator}
}

func (h *ProvisioningHandlers) HandleStart(
	ctx context.Context,
	req *model.StartChannelProvisioningRequest,
) (*model.StartChannelProvisioningResponse, error) {
	start, jobID, err := h.coordinator.Start(
		ctx, actorPTID(ctx), req.GetAppName(),
		req.GetAppDescription(), req.GetRegion(),
	)
	if err != nil {
		return nil, err
	}
	return &model.StartChannelProvisioningResponse{
		SessionId: start.SessionID, QrPayload: start.QRPayload,
		ExpiresInSeconds: int64(start.ExpiresIn.Seconds()), JobId: jobID,
	}, nil
}

func (h *ProvisioningHandlers) HandlePoll(
	ctx context.Context,
	req *model.PollChannelProvisioningRequest,
) (*model.PollChannelProvisioningResponse, error) {
	view, err := h.coordinator.Poll(
		ctx, actorPTID(ctx), req.GetJobId(), req.GetSessionId(),
	)
	if err != nil {
		return nil, err
	}
	response := &model.PollChannelProvisioningResponse{
		Status: view.Status, ErrorMessage: view.ErrorMessage,
		ConsoleUrl: view.ConsoleURL, RecoveryAction: view.RecoveryAction,
		Steps: make([]*model.ProvisioningStep, 0, len(view.Steps)),
	}
	for _, step := range view.Steps {
		response.Steps = append(response.Steps, &model.ProvisioningStep{
			StepId: step.ID, Label: step.Label, Status: step.Status,
			Detail: step.Detail,
		})
	}
	if view.Bot != nil {
		response.Bot = &model.ProvisionedBotInfo{
			AppId: view.Bot.AppID, AppName: view.Bot.AppName,
			AvatarUrl: view.Bot.AvatarURL, ConsoleUrl: view.Bot.ConsoleURL,
			PublishedOnline:     view.Bot.PublishedOnline,
			OwnerProviderUserId: view.Bot.OwnerProviderUserID,
		}
	}
	return response, nil
}

func (h *ProvisioningHandlers) HandleConfirm(
	ctx context.Context,
	req *model.ConfirmChannelProvisioningRequest,
) (*model.ConfirmChannelProvisioningResponse, error) {
	providerKind := strings.TrimSpace(req.GetProviderKind())
	if providerKind == "" {
		providerKind = defaultProviderKind
	}
	pluginID := strings.TrimSpace(req.GetPluginId())
	if pluginID == "" {
		pluginID = defaultPluginID
	}
	view, replayed, err := h.coordinator.Confirm(
		ctx, actorPTID(ctx), req.GetJobId(), req.GetSessionId(),
		channelsvc.CreateBindingInput{
			PluginID: pluginID, ProviderKind: providerKind,
			Domain: req.GetDomain(), AgentID: req.GetAgentId(),
			Enabled: req.GetEnabled(), Name: req.GetName(),
		},
	)
	if err != nil {
		return nil, err
	}
	return &model.ConfirmChannelProvisioningResponse{
		Binding: bindingViewToProto(view), Replayed: replayed,
	}, nil
}

func (h *ProvisioningHandlers) HandleCancel(
	ctx context.Context,
	req *model.CancelChannelProvisioningRequest,
) (*model.CancelChannelProvisioningResponse, error) {
	if err := h.coordinator.Cancel(
		ctx, actorPTID(ctx), req.GetJobId(), req.GetSessionId(),
	); err != nil {
		return nil, err
	}
	return &model.CancelChannelProvisioningResponse{}, nil
}
