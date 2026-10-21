package handler

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
)

type RequesterAuthorizationHandlers struct {
	authorizations *channelsvc.RequesterAuthorizationService
}

func NewRequesterAuthorizationHandlers(
	authorizations *channelsvc.RequesterAuthorizationService,
) *RequesterAuthorizationHandlers {
	return &RequesterAuthorizationHandlers{authorizations: authorizations}
}

func (h *RequesterAuthorizationHandlers) HandleStart(
	ctx context.Context,
	req *model.StartChannelRequesterAuthorizationRequest,
) (*model.StartChannelRequesterAuthorizationResponse, error) {
	view, err := h.authorizations.StartAuthorization(
		ctx,
		channelsvc.StartRequesterAuthorizationInput{
			ActorPTID: actorPTID(ctx), BindingID: req.GetBindingId(),
			ProviderUserID: req.GetProviderUserId(), TenantKey: req.GetTenantKey(),
			Domains: req.GetDomains(), IdempotencyKey: req.GetIdempotencyKey(),
		},
	)
	if err != nil {
		return nil, err
	}
	return &model.StartChannelRequesterAuthorizationResponse{
		Authorization: requesterAuthorizationViewToProto(view),
	}, nil
}

func (h *RequesterAuthorizationHandlers) HandleGet(
	ctx context.Context,
	req *model.GetChannelRequesterAuthorizationRequest,
) (*model.GetChannelRequesterAuthorizationResponse, error) {
	view, err := h.authorizations.GetAuthorization(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetProviderUserId(),
	)
	if err != nil {
		return nil, err
	}
	return &model.GetChannelRequesterAuthorizationResponse{
		Authorization: requesterAuthorizationViewToProto(view),
	}, nil
}

func (h *RequesterAuthorizationHandlers) HandleRefresh(
	ctx context.Context,
	req *model.RefreshChannelRequesterAuthorizationRequest,
) (*model.RefreshChannelRequesterAuthorizationResponse, error) {
	view, err := h.authorizations.RefreshAuthorization(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetAuthorizationId(),
		req.GetExpectedRevision(),
	)
	if err != nil {
		return nil, err
	}
	return &model.RefreshChannelRequesterAuthorizationResponse{
		Authorization: requesterAuthorizationViewToProto(view),
	}, nil
}

func (h *RequesterAuthorizationHandlers) HandleRevoke(
	ctx context.Context,
	req *model.RevokeChannelRequesterAuthorizationRequest,
) (*model.RevokeChannelRequesterAuthorizationResponse, error) {
	view, err := h.authorizations.RevokeAuthorization(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetAuthorizationId(),
		req.GetExpectedRevision(),
	)
	if err != nil {
		return nil, err
	}
	return &model.RevokeChannelRequesterAuthorizationResponse{
		Authorization: requesterAuthorizationViewToProto(view),
	}, nil
}

func (h *RequesterAuthorizationHandlers) HandleCancel(
	ctx context.Context,
	req *model.CancelChannelRequesterAuthorizationRequest,
) (*model.CancelChannelRequesterAuthorizationResponse, error) {
	view, err := h.authorizations.CancelAuthorization(
		ctx, actorPTID(ctx), req.GetBindingId(), req.GetAuthorizationId(),
		req.GetExpectedRevision(),
	)
	if err != nil {
		return nil, err
	}
	return &model.CancelChannelRequesterAuthorizationResponse{
		Authorization: requesterAuthorizationViewToProto(view),
	}, nil
}

func requesterAuthorizationViewToProto(
	view channelsvc.RequesterAuthorizationView,
) *model.ChannelRequesterAuthorizationInfo {
	result := &model.ChannelRequesterAuthorizationInfo{
		AuthorizationId: view.ID, BindingId: view.BindingID,
		ProviderUserId: view.ProviderUserID, TenantKey: view.TenantKey,
		Region: view.Region, Status: requesterAuthorizationStatus(view.Status),
		UserName: view.UserName, Email: view.Email,
		GrantedScopes:    append([]string(nil), view.GrantedScopes...),
		RequestedDomains: append([]string(nil), view.RequestedDomains...),
		PendingDomains:   append([]string(nil), view.PendingDomains...),
		RecoveryAction:   view.RecoveryAction, ErrorMessage: view.ErrorMessage,
		VerificationUrl: view.VerificationURL, Revision: view.Revision,
	}
	if view.ExpiresAt != nil {
		result.ExpiresAtUnixMs = view.ExpiresAt.UnixMilli()
	}
	if view.AccessExpiresAt != nil {
		result.AccessExpiresAtUnixMs = view.AccessExpiresAt.UnixMilli()
	}
	if view.LastVerifiedAt != nil {
		result.LastVerifiedAtUnixMs = view.LastVerifiedAt.UnixMilli()
	}
	return result
}

func requesterAuthorizationStatus(
	status string,
) model.ChannelRequesterAuthorizationStatus {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "disconnected":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_DISCONNECTED
	case "pending":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_PENDING
	case "ready":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_READY
	case "needs_refresh":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_NEEDS_REFRESH
	case "expired":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_EXPIRED
	case "scope_denied":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_SCOPE_DENIED
	case "revoked":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_REVOKED
	case "failed":
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_FAILED
	default:
		return model.ChannelRequesterAuthorizationStatus_CHANNEL_REQUESTER_AUTHORIZATION_STATUS_UNSPECIFIED
	}
}
