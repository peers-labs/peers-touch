package handler

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
)

type ManagementHandlers struct {
	bindings   *channelsvc.BindingService
	management *channelsvc.ManagementService
	bridge     func() *channelsvc.DurableBridge
}

func NewManagementHandlers(
	bindings *channelsvc.BindingService,
	management *channelsvc.ManagementService,
	bridge func() *channelsvc.DurableBridge,
) *ManagementHandlers {
	return &ManagementHandlers{
		bindings: bindings, management: management, bridge: bridge,
	}
}

func (h *ManagementHandlers) HandleUpsertRoute(
	ctx context.Context,
	req *model.UpsertChannelRouteRequest,
) (*model.UpsertChannelRouteResponse, error) {
	view, err := h.management.UpsertRoute(ctx, actorPTID(ctx), channelsvc.RouteView{
		ID: req.GetRouteId(), BindingID: req.GetBindingId(),
		ChatID: req.GetChatId(), ChatName: req.GetChatName(),
		AgentID: req.GetAgentId(), Enabled: req.GetEnabled(),
	})
	if err != nil {
		return nil, err
	}
	return &model.UpsertChannelRouteResponse{Route: routeToProto(view)}, nil
}

func (h *ManagementHandlers) HandleDeleteRoute(
	ctx context.Context,
	req *model.DeleteChannelRouteRequest,
) (*model.DeleteChannelRouteResponse, error) {
	if err := h.management.DeleteRoute(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetRouteId(),
	); err != nil {
		return nil, err
	}
	return &model.DeleteChannelRouteResponse{}, nil
}

func (h *ManagementHandlers) HandleListRoutes(
	ctx context.Context,
	req *model.ListChannelRoutesRequest,
) (*model.ListChannelRoutesResponse, error) {
	views, err := h.management.ListRoutes(ctx, actorPTID(ctx), req.GetBindingId())
	if err != nil {
		return nil, err
	}
	response := &model.ListChannelRoutesResponse{
		Routes: make([]*model.ChannelRoute, 0, len(views)),
	}
	for _, view := range views {
		response.Routes = append(response.Routes, routeToProto(view))
	}
	return response, nil
}

func (h *ManagementHandlers) HandleUpsertAutomation(
	ctx context.Context,
	req *model.UpsertChannelAutomationRequest,
) (*model.UpsertChannelAutomationResponse, error) {
	view, err := h.management.UpsertAutomation(
		ctx, actorPTID(ctx), channelsvc.AutomationView{
			ID: req.GetAutomationId(), BindingID: req.GetBindingId(),
			TriggerType: req.GetTriggerType(), TriggerValue: req.GetTriggerValue(),
			ActionPrompt: req.GetActionPrompt(), AgentID: req.GetAgentId(),
			DestinationChatID: req.GetDestinationChatId(), Enabled: req.GetEnabled(),
		},
	)
	if err != nil {
		return nil, err
	}
	if bridge := h.bridge(); bridge != nil {
		if err := bridge.SyncAutomationTrigger(ctx, actorPTID(ctx), view); err != nil {
			return nil, err
		}
		if err := bridge.ReconcileAutomationMutation(
			ctx, actorPTID(ctx), req.GetBindingId(), view.ID,
		); err != nil {
			return nil, err
		}
	}
	return &model.UpsertChannelAutomationResponse{Automation: automationToProto(view)}, nil
}

func (h *ManagementHandlers) HandleDeleteAutomation(
	ctx context.Context,
	req *model.DeleteChannelAutomationRequest,
) (*model.DeleteChannelAutomationResponse, error) {
	existing, err := h.management.Automation(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetAutomationId(),
	)
	if err != nil {
		return nil, err
	}
	if err := h.management.DeleteAutomation(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetAutomationId(),
	); err != nil {
		return nil, err
	}
	if bridge := h.bridge(); bridge != nil {
		view := channelsvc.AutomationView{
			ID: existing.ID, BindingID: existing.BindingID,
			TriggerType: existing.TriggerType, TriggerValue: existing.TriggerValue,
			Enabled: false,
		}
		_ = bridge.SyncAutomationTrigger(ctx, actorPTID(ctx), view)
		if err := bridge.ReconcileAutomationMutation(
			ctx, actorPTID(ctx), req.GetBindingId(), req.GetAutomationId(),
		); err != nil {
			return nil, err
		}
	}
	return &model.DeleteChannelAutomationResponse{}, nil
}

func (h *ManagementHandlers) HandleListAutomations(
	ctx context.Context,
	req *model.ListChannelAutomationsRequest,
) (*model.ListChannelAutomationsResponse, error) {
	views, err := h.management.ListAutomations(
		ctx, actorPTID(ctx), req.GetBindingId(),
	)
	if err != nil {
		return nil, err
	}
	response := &model.ListChannelAutomationsResponse{
		Automations: make([]*model.ChannelAutomation, 0, len(views)),
	}
	for _, view := range views {
		response.Automations = append(response.Automations, automationToProto(view))
	}
	return response, nil
}

func (h *ManagementHandlers) HandleRunAutomation(
	ctx context.Context,
	req *model.RunChannelAutomationRequest,
) (*model.RunChannelAutomationResponse, error) {
	bridge := h.bridge()
	if bridge == nil {
		return nil, fmt.Errorf("channel runtime is not ready")
	}
	view, err := bridge.RunAutomation(
		ctx, actorPTID(ctx), req.GetBindingId(),
		req.GetAutomationId(), req.GetIdempotencyKey(),
	)
	if err != nil {
		return nil, err
	}
	return &model.RunChannelAutomationResponse{Automation: automationToProto(view)}, nil
}

func (h *ManagementHandlers) HandleSend(
	ctx context.Context,
	req *model.SendChannelMessageRequest,
) (*model.SendChannelMessageResponse, error) {
	if _, err := h.bindings.Get(ctx, actorPTID(ctx), req.GetBindingId()); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetTargetChatId()) == "" || strings.TrimSpace(req.GetText()) == "" {
		return nil, fmt.Errorf("target and text are required")
	}
	bridge := h.bridge()
	if bridge == nil {
		return nil, fmt.Errorf("channel runtime is not ready")
	}
	deliveryID, err := bridge.Send(
		ctx, req.GetBindingId(), req.GetTargetChatId(),
		req.GetText(), req.GetIdempotencyKey(),
	)
	if err != nil {
		return nil, err
	}
	status, err := bridge.WaitDelivery(
		ctx, actorPTID(ctx), req.GetBindingId(), deliveryID, 10*time.Second,
	)
	if err != nil {
		return nil, err
	}
	return &model.SendChannelMessageResponse{
		DeliveryId: status.ID, Status: status.Status,
		ProviderMessageId: status.ProviderMessageID,
		ErrorMessage:      status.LastError,
	}, nil
}

func (h *ManagementHandlers) HandleListChats(
	ctx context.Context,
	req *model.ListChannelChatsRequest,
) (*model.ListChannelChatsResponse, error) {
	views, err := h.management.ListChats(ctx, actorPTID(ctx), req.GetBindingId())
	if err != nil {
		return nil, err
	}
	response := &model.ListChannelChatsResponse{
		Chats: make([]*model.ChannelChat, 0, len(views)),
	}
	for _, view := range views {
		response.Chats = append(response.Chats, &model.ChannelChat{
			ChatId: view.ChatID, Name: view.Name, ChatType: view.ChatType,
			LastSenderName:      view.LastSenderName,
			LastMessageAtUnixMs: view.LastMessageAt.UnixMilli(),
		})
	}
	return response, nil
}

func (h *ManagementHandlers) HandleListEvents(
	ctx context.Context,
	req *model.ListChannelEventsRequest,
) (*model.ListChannelEventsResponse, error) {
	views, total, err := h.management.ListDiagnostics(
		ctx, actorPTID(ctx), req.GetBindingId(),
		int(req.GetLimit()), int(req.GetOffset()),
	)
	if err != nil {
		return nil, err
	}
	response := &model.ListChannelEventsResponse{
		Events: make([]*model.ChannelEventInfo, 0, len(views)), Total: total,
	}
	for _, view := range views {
		response.Events = append(response.Events, &model.ChannelEventInfo{
			EventId: view.ID, BindingId: view.BindingID, Direction: view.Direction,
			Phase: view.Phase, MessageType: view.MessageType, Summary: view.Summary,
			SenderId: view.SenderID, SenderName: view.SenderName,
			TargetId: view.TargetID, ChatType: view.ChatType, TurnId: view.TurnID,
			DeliveryId: view.DeliveryID, ErrorCode: view.ErrorCode,
			ErrorMessage:     view.ErrorMessage,
			OccurredAtUnixMs: view.OccurredAt.UnixMilli(), LatencyMs: view.LatencyMS,
		})
	}
	return response, nil
}

func (h *ManagementHandlers) HandleStats(
	ctx context.Context,
	req *model.ChannelStatsRequest,
) (*model.ChannelStatsResponse, error) {
	stats, err := h.management.Stats(ctx, actorPTID(ctx), req.GetBindingId())
	if err != nil {
		return nil, err
	}
	return &model.ChannelStatsResponse{
		TotalInbound: stats.TotalInbound, TotalOutbound: stats.TotalOutbound,
		TotalErrors: stats.TotalErrors, TodayInbound: stats.TodayInbound,
		TodayOutbound: stats.TodayOutbound, AverageLatencyMs: stats.AverageLatencyMS,
	}, nil
}

func (h *ManagementHandlers) HandleRetryDelivery(
	ctx context.Context,
	req *model.RetryChannelDeliveryRequest,
) (*model.RetryChannelDeliveryResponse, error) {
	bridge := h.bridge()
	if bridge == nil {
		return nil, fmt.Errorf("channel runtime is not ready")
	}
	if err := bridge.RetryDelivery(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetDeliveryId(),
	); err != nil {
		return nil, err
	}
	return &model.RetryChannelDeliveryResponse{}, nil
}

func (h *ManagementHandlers) HandleExportDiagnostics(
	ctx context.Context,
	req *model.ExportChannelDiagnosticsRequest,
) (*model.ExportChannelDiagnosticsResponse, error) {
	body, err := h.management.ExportDiagnostics(
		ctx, actorPTID(ctx), req.GetBindingId(),
	)
	if err != nil {
		return nil, err
	}
	return &model.ExportChannelDiagnosticsResponse{
		JsonData: body, FileName: "lark-diagnostics-" + req.GetBindingId() + ".json",
	}, nil
}

func (h *ManagementHandlers) HandleHealth(
	ctx context.Context,
	req *model.CheckChannelHealthRequest,
) (*model.CheckChannelHealthResponse, error) {
	view, err := h.bindings.Get(ctx, actorPTID(ctx), req.GetBindingId())
	if err != nil {
		return nil, err
	}
	checks := []*model.ChannelCapabilityCheck{
		healthCheck("identity", view.BotOpenID != "", "Reconnect the Lark app."),
		healthCheck("message_connection", view.ConnectionState == channelsvc.BindingStateConnected, "Repair app permissions or reconnect."),
		healthCheck("agent", strings.TrimSpace(view.AgentID) != "", "Choose an Agent."),
	}
	status := "ready"
	for _, check := range checks {
		if check.GetStatus() != "ready" {
			status = "attention"
			break
		}
	}
	return &model.CheckChannelHealthResponse{
		Status: status, Checks: checks, CheckedAtUnixMs: time.Now().UnixMilli(),
	}, nil
}

func (h *ManagementHandlers) HandleListMemberAccess(
	ctx context.Context,
	req *model.ListChannelMemberAccessRequest,
) (*model.ListChannelMemberAccessResponse, error) {
	views, err := h.management.ListMemberAccess(
		ctx, actorPTID(ctx), req.GetBindingId(),
	)
	if err != nil {
		return nil, err
	}
	response := &model.ListChannelMemberAccessResponse{
		Members: make([]*model.ChannelMemberAccess, 0, len(views)),
	}
	for _, view := range views {
		item := &model.ChannelMemberAccess{
			AccessId: view.ID, BindingId: view.BindingID,
			ProviderUserId: view.ProviderUserID, DisplayName: view.DisplayName,
			Status: view.Status, RequestedAtUnixMs: view.RequestedAt.UnixMilli(),
		}
		if view.DecidedAt != nil {
			item.DecidedAtUnixMs = view.DecidedAt.UnixMilli()
		}
		response.Members = append(response.Members, item)
	}
	return response, nil
}

func (h *ManagementHandlers) HandleDecideMemberAccess(
	ctx context.Context,
	req *model.DecideChannelMemberAccessRequest,
) (*model.ChannelMemberAccess, error) {
	view, err := h.management.DecideMemberAccess(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetAccessId(),
		req.GetDecision(), req.GetIdempotencyKey(),
	)
	if err != nil {
		return nil, err
	}
	response := &model.ChannelMemberAccess{
		AccessId: view.ID, BindingId: view.BindingID,
		ProviderUserId: view.ProviderUserID, DisplayName: view.DisplayName,
		Status: view.Status, RequestedAtUnixMs: view.RequestedAt.UnixMilli(),
	}
	if view.DecidedAt != nil {
		response.DecidedAtUnixMs = view.DecidedAt.UnixMilli()
	}
	return response, nil
}

func routeToProto(view channelsvc.RouteView) *model.ChannelRoute {
	return &model.ChannelRoute{
		RouteId: view.ID, BindingId: view.BindingID, ChatId: view.ChatID,
		ChatName: view.ChatName, AgentId: view.AgentID, Enabled: view.Enabled,
		CreatedAtUnixMs: view.CreatedAt.UnixMilli(),
		UpdatedAtUnixMs: view.UpdatedAt.UnixMilli(),
	}
}

func automationToProto(view channelsvc.AutomationView) *model.ChannelAutomation {
	result := &model.ChannelAutomation{
		AutomationId: view.ID, BindingId: view.BindingID,
		TriggerType: view.TriggerType, TriggerValue: view.TriggerValue,
		ActionPrompt: view.ActionPrompt, AgentId: view.AgentID,
		DestinationChatId: view.DestinationChatID, Enabled: view.Enabled,
		LastRunStatus: view.LastRunStatus, LastError: view.LastError,
		CreatedAtUnixMs: view.CreatedAt.UnixMilli(),
		UpdatedAtUnixMs: view.UpdatedAt.UnixMilli(),
	}
	if view.LastRunAt != nil {
		result.LastRunAtUnixMs = view.LastRunAt.UnixMilli()
	}
	return result
}

func healthCheck(
	capability string,
	ready bool,
	recovery string,
) *model.ChannelCapabilityCheck {
	status := "ready"
	if !ready {
		status = "missing"
	}
	return &model.ChannelCapabilityCheck{
		Capability: capability, Status: status, RecoveryAction: recovery,
	}
}
