package bot

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/registry"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func ingressPath(publishingID string) string {
	return "/message-ingress/" + publishingID
}

func ownerFromContext(ctx context.Context) (string, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return "", server.Unauthorized("authentication required")
	}
	return subject.ID, nil
}

func mapDomainError(err error) error {
	if de, ok := domain.AsError(err); ok {
		switch de.Code {
		case domain.CodeUnauthenticated:
			return server.Unauthorized(de.Message)
		case domain.CodeInvalidArgument:
			return server.BadRequest(de.Message)
		case domain.CodeNameConflict, domain.CodeStateConflict:
			return server.Conflict(de.Message)
		case domain.CodeNotFound:
			return server.NotFound(de.Message)
		default:
			return server.InternalErrorWithCause(de.Message, err)
		}
	}
	switch conversationdomain.CodeOf(err) {
	case conversationdomain.ErrorCodeInvalidArgument:
		return server.BadRequest("invalid message publishing request")
	case conversationdomain.ErrorCodeUnauthorized:
		return server.Forbidden("message publishing operation is not authorized")
	case conversationdomain.ErrorCodeNotFound:
		return server.NotFound("message publishing grant not found")
	case conversationdomain.ErrorCodeCommandConflict:
		return server.Conflict("message publishing state conflict")
	default:
		return server.InternalErrorWithCause("bot operation failed", err)
	}
}

func toProtoBot(b *domain.Bot, grant registry.PublishingGrant) *botmodel.Bot {
	if b == nil {
		return nil
	}
	return &botmodel.Bot{
		BotPtid:         b.BotPtid,
		OwnerPtid:       b.OwnerPtid,
		Name:            b.Name,
		State:           botmodel.BotState(int32(b.State)),
		PublishingGrant: toProtoPublishingGrant(grant),
	}
}

func toProtoPublishingGrant(grant registry.PublishingGrant) *chat.MessagePublishingGrant {
	result := &chat.MessagePublishingGrant{
		PublishingId:       grant.ID,
		OwnerPtid:          grant.OwnerPtid,
		SenderPtid:         grant.SenderPtid,
		Name:               grant.Name,
		SourceNamespace:    grant.SourceNamespace,
		DefaultTarget:      grant.DefaultTarget,
		AllowedTargets:     append([]string(nil), grant.AllowedTargets...),
		SecretHint:         grant.SecretHint,
		Revoked:            grant.Revoked,
		CreatedAt:          timestamppb.New(grant.CreatedAt),
		RateLimitPerMinute: grant.RateLimitPerMinute,
		Disabled:           grant.Disabled,
	}
	if grant.ExpiresAt != nil {
		result.ExpiresAt = timestamppb.New(*grant.ExpiresAt)
	}
	return result
}

func (s *subServer) handleCreate(
	ctx context.Context,
	req *botmodel.CreateBotRequest,
) (*botmodel.CreateBotResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	created, err := s.registry.Create(ctx, owner, req.GetName(), "peers", req.GetAvatar())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.CreateBotResponse{
		Bot:        toProtoBot(created.Bot, created.Publishing),
		IngressUrl: ingressPath(created.Publishing.ID),
		Secret:     created.Secret,
	}, nil
}

func (s *subServer) handleList(
	ctx context.Context,
	_ *botmodel.ListMyBotsRequest,
) (*botmodel.ListMyBotsResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	bots, err := s.registry.List(ctx, owner)
	if err != nil {
		return nil, mapDomainError(err)
	}
	out := make([]*botmodel.Bot, 0, len(bots))
	for _, item := range bots {
		grant, err := s.registry.PublishingGrant(ctx, owner, item)
		if err != nil {
			return nil, mapDomainError(err)
		}
		out = append(out, toProtoBot(item, grant))
	}
	return &botmodel.ListMyBotsResponse{Bots: out}, nil
}

func (s *subServer) handleRotateSecret(
	ctx context.Context,
	req *botmodel.RotateBotSecretRequest,
) (*botmodel.RotateBotSecretResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	rotated, err := s.registry.RotateSecret(ctx, owner, req.GetBotPtid())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.RotateBotSecretResponse{Secret: rotated.Secret}, nil
}

func (s *subServer) handleSetState(
	ctx context.Context,
	req *botmodel.SetBotStateRequest,
) (*botmodel.SetBotStateResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	bot, grant, err := s.registry.SetState(
		ctx,
		owner,
		req.GetBotPtid(),
		domain.State(req.GetTargetState()),
	)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.SetBotStateResponse{Bot: toProtoBot(bot, grant)}, nil
}

func (s *subServer) handleSetProfile(
	ctx context.Context,
	req *botmodel.SetBotProfileRequest,
) (*botmodel.SetBotProfileResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	bot, err := s.registry.SetProfile(ctx, owner, req.GetBotPtid(), req.GetAvatar())
	if err != nil {
		return nil, mapDomainError(err)
	}
	grant, err := s.registry.PublishingGrant(ctx, owner, bot)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.SetBotProfileResponse{Bot: toProtoBot(bot, grant)}, nil
}
