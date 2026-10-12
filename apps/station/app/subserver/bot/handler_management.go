package bot

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// webhookPath builds the Station-relative webhook path. Clients prefix their
// configured Station origin; the id is unguessable and is the public route.
func webhookPath(webhookID string) string {
	return "/bot/webhook/" + webhookID
}

func ownerFromContext(ctx context.Context) (string, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return "", server.Unauthorized("authentication required")
	}
	return subject.ID, nil
}

func mapDomainError(err error) error {
	de, ok := domain.AsError(err)
	if !ok {
		return server.InternalErrorWithCause("bot operation failed", err)
	}
	switch de.Code {
	case domain.CodeUnauthenticated:
		return server.Unauthorized(de.Message)
	case domain.CodeInvalidArgument, domain.CodeSecretNotSet, domain.CodeScopeForbidden:
		return server.BadRequest(de.Message)
	case domain.CodeNameConflict, domain.CodeStateConflict:
		return server.Conflict(de.Message)
	case domain.CodeNotFound:
		return server.NotFound(de.Message)
	default:
		return server.InternalErrorWithCause(de.Message, err)
	}
}

func toProtoBot(b *domain.Bot) *botmodel.Bot {
	if b == nil {
		return nil
	}
	return &botmodel.Bot{
		BotPtid:            b.BotPtid,
		OwnerPtid:          b.OwnerPtid,
		Name:               b.Name,
		State:              botmodel.BotState(int32(b.State)),
		WebhookId:          b.WebhookID,
		SecretDelivered:    b.SecretDelivered,
		SecretHint:         b.SecretHint,
		DeliveryScope:      botmodel.BotDeliveryScope(int32(b.DeliveryScope)),
		RateLimitPerMinute: b.RateLimitPerMin,
		CreatedAtMs:        b.CreatedAt.UnixMilli(),
		DisabledAtMs:       unixMilliPtr(b.DisabledAt),
		RevokedAtMs:        unixMilliPtr(b.RevokedAt),
	}
}

func unixMilliPtr(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return t.UnixMilli()
}

func (s *subServer) handleCreate(ctx context.Context, req *botmodel.CreateBotRequest) (*botmodel.CreateBotResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	created, err := s.registry.Create(ctx, owner, req.GetName(), "peers", req.GetAvatar())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.CreateBotResponse{
		Bot:             toProtoBot(created.Bot),
		WebhookUrl:      webhookPath(created.Bot.WebhookID),
		SecretPlaintext: created.SecretPlaintext,
	}, nil
}

func (s *subServer) handleList(ctx context.Context, _ *botmodel.ListMyBotsRequest) (*botmodel.ListMyBotsResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	bots, err := s.registry.List(ctx, owner)
	if err != nil {
		return nil, mapDomainError(err)
	}
	out := make([]*botmodel.Bot, 0, len(bots))
	for _, b := range bots {
		out = append(out, toProtoBot(b))
	}
	return &botmodel.ListMyBotsResponse{Bots: out}, nil
}

func (s *subServer) handleRotateSecret(ctx context.Context, req *botmodel.RotateBotSecretRequest) (*botmodel.RotateBotSecretResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	secret, err := s.registry.RotateSecret(ctx, owner, req.GetBotPtid())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.RotateBotSecretResponse{SecretPlaintext: secret}, nil
}

func (s *subServer) handleSetState(ctx context.Context, req *botmodel.SetBotStateRequest) (*botmodel.SetBotStateResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	bot, err := s.registry.SetState(ctx, owner, req.GetBotPtid(), domain.State(req.GetTargetState()))
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.SetBotStateResponse{Bot: toProtoBot(bot)}, nil
}

func (s *subServer) handleSetProfile(ctx context.Context, req *botmodel.SetBotProfileRequest) (*botmodel.SetBotProfileResponse, error) {
	owner, err := ownerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	bot, err := s.registry.SetProfile(ctx, owner, req.GetBotPtid(), req.GetAvatar())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &botmodel.SetBotProfileResponse{Bot: toProtoBot(bot)}, nil
}
