package handler

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginlark"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

// BindingHandlers exposes the channel binding management API. Credentials
// are write-only: app_secret is sealed into the vault on create/update and
// never returned in responses.
type BindingHandlers struct {
	bindings       *channelsvc.BindingService
	runtime        *channelsvc.RuntimeHost
	authorizations *channelsvc.RequesterAuthorizationService
}

func (h *BindingHandlers) HandleValidateApp(
	ctx context.Context,
	req *model.ValidateChannelAppRequest,
) (*model.ValidateChannelAppResponse, error) {
	result := pluginlark.ValidateApplication(
		ctx, req.GetProviderAppId(), req.GetAppSecret(),
		req.GetDomain(), req.GetRegion(),
	)
	response := &model.ValidateChannelAppResponse{
		Valid: result.Valid, AppName: result.AppName,
		BotOpenId: result.BotOpenID, TenantKey: result.TenantKey,
		ConsoleUrl: result.ConsoleURL, ErrorMessage: result.ErrorMessage,
		Checks: make([]*model.ChannelCapabilityCheck, 0, len(result.Checks)),
	}
	for _, check := range result.Checks {
		response.Checks = append(response.Checks, &model.ChannelCapabilityCheck{
			Capability: check.Capability, Status: check.Status,
			RecoveryAction: check.RecoveryAction,
		})
	}
	return response, nil
}

func NewBindingHandlers(
	bindings *channelsvc.BindingService,
	runtime *channelsvc.RuntimeHost,
	authorizations *channelsvc.RequesterAuthorizationService,
) *BindingHandlers {
	return &BindingHandlers{
		bindings: bindings, runtime: runtime, authorizations: authorizations,
	}
}

func actorPTID(ctx context.Context) string {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return ""
	}
	return subject.ID
}

// HandleCreate seals the credential, creates the binding, and starts it when
// enabled.
func (h *BindingHandlers) HandleCreate(ctx context.Context, req *model.CreateChannelBindingRequest) (*model.CreateChannelBindingResponse, error) {
	view, err := h.bindings.Create(ctx, channelsvc.CreateBindingInput{
		ActorPTID:     actorPTID(ctx),
		PluginID:      req.GetPluginId(),
		ProviderKind:  req.GetProviderKind(),
		ProviderAppID: req.GetProviderAppId(),
		Domain:        req.GetDomain(),
		AgentID:       req.GetAgentId(),
		Enabled:       req.GetEnabled(),
		AppSecret:     req.GetAppSecret(),
		Name:          req.GetName(),
		Description:   req.GetDescription(),
		Region:        req.GetRegion(),
		AppMode:       req.GetAppMode(),
	})
	if err != nil {
		return nil, err
	}
	if view.Enabled && h.runtime != nil {
		_ = h.runtime.StartBinding(ctx, view.ID)
	}
	return &model.CreateChannelBindingResponse{Binding: bindingViewToProto(view)}, nil
}

// HandleUpdate changes agent/enabled/credentials and reconciles the
// connection generation.
func (h *BindingHandlers) HandleUpdate(ctx context.Context, req *model.UpdateChannelBindingRequest) (*model.UpdateChannelBindingResponse, error) {
	if req.PersonalOauthConnectionId != nil {
		return nil, fmt.Errorf(
			"%w: personal authorization is managed by requester authorization endpoints",
			channelsvc.ErrInvalidBinding,
		)
	}
	in := channelsvc.UpdateInput{}
	if req.AgentId != nil {
		in.AgentID = req.AgentId
	}
	if req.Enabled != nil {
		in.Enabled = req.Enabled
	}
	if req.AppSecret != nil && req.GetAppSecret() != "" {
		secret := req.GetAppSecret()
		in.AppSecret = &secret
	}
	in.Name = req.Name
	in.Description = req.Description
	in.GroupResponseMode = req.GroupResponseMode
	in.ThreadIsolation = req.ThreadIsolation
	in.OutputMode = req.OutputMode
	in.AccessMode = req.AccessMode
	view, rotated, err := h.bindings.Update(ctx, actorPTID(ctx), req.GetBindingId(), in)
	if err != nil {
		return nil, err
	}
	if h.runtime != nil {
		switch {
		case rotated:
			// Credential rotation: restart the generation with the new secret.
			_ = h.runtime.StopBinding(ctx, view.ID)
			if view.Enabled {
				_ = h.runtime.StartBinding(ctx, view.ID)
			}
		case !view.Enabled:
			_ = h.runtime.StopBinding(ctx, view.ID)
		case view.Enabled:
			_ = h.runtime.StartBinding(ctx, view.ID)
		}
	}
	return &model.UpdateChannelBindingResponse{
		Binding:           bindingViewToProto(view),
		CredentialRotated: rotated,
	}, nil
}

// HandleDelete stops and removes a binding and its credential.
func (h *BindingHandlers) HandleDelete(ctx context.Context, req *model.DeleteChannelBindingRequest) (*model.DeleteChannelBindingResponse, error) {
	if _, err := h.bindings.Get(ctx, actorPTID(ctx), req.GetBindingId()); err != nil {
		return nil, err
	}
	if h.runtime != nil {
		_ = h.runtime.StopBinding(ctx, req.GetBindingId())
	}
	if h.authorizations != nil {
		if err := h.authorizations.RevokeForBinding(
			ctx, actorPTID(ctx), req.GetBindingId(),
		); err != nil {
			return nil, err
		}
	}
	if err := h.bindings.Delete(ctx, actorPTID(ctx), req.GetBindingId()); err != nil {
		return nil, err
	}
	return &model.DeleteChannelBindingResponse{}, nil
}

// HandleList returns the actor's bindings.
func (h *BindingHandlers) HandleList(ctx context.Context, _ *model.ListChannelBindingsRequest) (*model.ListChannelBindingsResponse, error) {
	views, err := h.bindings.List(ctx, actorPTID(ctx))
	if err != nil {
		return nil, err
	}
	resp := &model.ListChannelBindingsResponse{Bindings: make([]*model.ChannelBindingInfo, 0, len(views))}
	for i := range views {
		resp.Bindings = append(resp.Bindings, bindingViewToProto(views[i]))
	}
	return resp, nil
}

// HandleStart explicitly enables/starts one binding.
func (h *BindingHandlers) HandleStart(ctx context.Context, req *model.StartChannelBindingRequest) (*model.StartChannelBindingResponse, error) {
	enabled := true
	if _, _, err := h.bindings.Update(
		ctx, actorPTID(ctx), req.GetBindingId(),
		channelsvc.UpdateInput{Enabled: &enabled},
	); err != nil {
		return nil, err
	}
	if err := h.runtime.StartBinding(ctx, req.GetBindingId()); err != nil {
		return nil, err
	}
	return &model.StartChannelBindingResponse{}, nil
}

// HandleStop explicitly stops one binding without deleting it.
func (h *BindingHandlers) HandleStop(ctx context.Context, req *model.StopChannelBindingRequest) (*model.StopChannelBindingResponse, error) {
	enabled := false
	if _, _, err := h.bindings.Update(
		ctx, actorPTID(ctx), req.GetBindingId(),
		channelsvc.UpdateInput{Enabled: &enabled},
	); err != nil {
		return nil, err
	}
	if err := h.runtime.StopBinding(ctx, req.GetBindingId()); err != nil {
		return nil, err
	}
	return &model.StopChannelBindingResponse{}, nil
}

func (h *BindingHandlers) HandleSetDefault(
	ctx context.Context,
	req *model.SetDefaultChannelBindingRequest,
) (*model.SetDefaultChannelBindingResponse, error) {
	view, err := h.bindings.SetDefault(ctx, actorPTID(ctx), req.GetBindingId())
	if err != nil {
		return nil, err
	}
	return &model.SetDefaultChannelBindingResponse{Binding: bindingViewToProto(view)}, nil
}

func bindingViewToProto(v channelsvc.BindingView) *model.ChannelBindingInfo {
	return &model.ChannelBindingInfo{
		BindingId:                 v.ID,
		PluginId:                  v.PluginID,
		ProviderKind:              v.ProviderKind,
		ProviderAppId:             v.ProviderAppID,
		Domain:                    v.Domain,
		Name:                      v.Name,
		Description:               v.Description,
		Region:                    v.Region,
		AppMode:                   v.AppMode,
		IsDefault:                 v.IsDefault,
		AgentId:                   v.AgentID,
		Enabled:                   v.Enabled,
		GroupResponseMode:         v.GroupResponseMode,
		ThreadIsolation:           v.ThreadIsolation,
		OutputMode:                v.OutputMode,
		AccessMode:                v.AccessMode,
		OwnerProviderUserId:       v.OwnerProviderUserID,
		PersonalOauthConnectionId: v.PersonalOAuthConnectionID,
		PersonalOauthStatus:       v.PersonalOAuthStatus,
		ConnectionState:           v.ConnectionState,
		LastError:                 v.LastError,
		BotOpenId:                 v.BotOpenID,
		TenantKey:                 v.TenantKey,
		Readiness:                 bindingReadiness(v),
		RouteCount:                v.RouteCount,
		AutomationCount:           v.AutomationCount,
		CreatedAtUnixMs:           v.CreatedAt.UnixMilli(),
		UpdatedAtUnixMs:           v.UpdatedAt.UnixMilli(),
	}
}

func bindingReadiness(v channelsvc.BindingView) string {
	if !v.Enabled {
		return "paused"
	}
	if v.AgentID == "" {
		return "agent_required"
	}
	if v.ConnectionState == channelsvc.BindingStateConnected {
		return "ready"
	}
	if v.ConnectionState == channelsvc.BindingStateUnauthorized {
		return "authorization_required"
	}
	return "connecting"
}
