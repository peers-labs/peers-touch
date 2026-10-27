package bot

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
)

func toProtoBinding(b *domain.AgentBinding) *botmodel.BotAgentBinding {
	if b == nil {
		return nil
	}
	return &botmodel.BotAgentBinding{
		BotPtid:   b.BotPtid,
		OwnerPtid: b.OwnerPtid,
		AgentId:   b.AgentID,
		Enabled:   b.Enabled,
		Version:   b.Version,
		CreatedAt: b.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: b.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func (s *subServer) bindingProjection(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
) (*botmodel.BotAgentBinding, error) {
	binding, found, err := s.registry.AgentBinding(ctx, ownerPtid, botPtid)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	return toProtoBinding(binding), nil
}

func (s *subServer) handleSetAgentBinding(
	ctx context.Context,
	req *botmodel.SetBotAgentBindingRequest,
) (*botmodel.SetBotAgentBindingResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	binding, err := s.registry.SetAgentBinding(
		ctx,
		owner,
		req.GetBotPtid(),
		req.GetAgentId(),
		req.GetEnabled(),
		req.GetExpectedVersion(),
	)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.SetBotAgentBindingResponse{Binding: toProtoBinding(binding)}, nil
}

func (s *subServer) handleGetAgentBinding(
	ctx context.Context,
	req *botmodel.GetBotAgentBindingRequest,
) (*botmodel.GetBotAgentBindingResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	binding, found, err := s.registry.AgentBinding(ctx, owner, req.GetBotPtid())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.GetBotAgentBindingResponse{
		Binding: toProtoBinding(binding),
		Bound:   found,
	}, nil
}

func (s *subServer) handleListAgentBindings(
	ctx context.Context,
	_ *botmodel.ListBotAgentBindingsRequest,
) (*botmodel.ListBotAgentBindingsResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	bindings, err := s.registry.ListAgentBindings(ctx, owner)
	if err != nil {
		return nil, mapDomainError(err)
	}
	out := make([]*botmodel.BotAgentBinding, 0, len(bindings))
	for _, binding := range bindings {
		out = append(out, toProtoBinding(binding))
	}
	return &botmodel.ListBotAgentBindingsResponse{Bindings: out}, nil
}

func (s *subServer) handleDeleteAgentBinding(
	ctx context.Context,
	req *botmodel.DeleteBotAgentBindingRequest,
) (*botmodel.DeleteBotAgentBindingResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.registry.DeleteAgentBinding(
		ctx,
		owner,
		req.GetBotPtid(),
		req.GetExpectedVersion(),
	); err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.DeleteBotAgentBindingResponse{Deleted: true}, nil
}

// ActiveAgentBinding is the Station-internal structural lookup consumed by
// the agent subserver's inbound turn projection. It bypasses owner-scoped
// HTTP authorization because the binding row itself carries the owner.
func (s *subServer) ActiveAgentBinding(
	ctx context.Context,
	botPtid string,
) (*domain.AgentBinding, bool, error) {
	return s.registry.ActiveBindingForBot(ctx, botPtid)
}
