package registry

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
)

type CreatedBot struct {
	Bot        *domain.Bot
	Publishing PublishingGrant
	Secret     string
}

type Service struct {
	repo             Repository
	minter           ActorMinter
	publishing       PublishingManager
	profilePublisher ProfileChangePublisher
	now              func() time.Time
}

type Option func(*Service)

func WithProfileChangePublisher(publisher ProfileChangePublisher) Option {
	return func(s *Service) { s.profilePublisher = publisher }
}

func NewService(
	repo Repository,
	minter ActorMinter,
	publishing PublishingManager,
	opts ...Option,
) *Service {
	s := &Service{
		repo:       repo,
		minter:     minter,
		publishing: publishing,
		now:        func() time.Time { return time.Now().UTC() },
	}
	for _, option := range opts {
		if option != nil {
			option(s)
		}
	}
	return s
}

func (s *Service) Create(
	ctx context.Context,
	ownerPtid string,
	displayName string,
	namespace string,
	avatar string,
) (*CreatedBot, error) {
	if ownerPtid == "" || s.publishing == nil {
		return nil, domain.NewError(domain.CodeUnauthenticated, "owner identity required")
	}
	name := strings.TrimSpace(displayName)
	if err := domain.ValidateName(name); err != nil {
		return nil, err
	}
	conflict, err := s.repo.ActiveByName(ctx, ownerPtid, name)
	if err != nil {
		return nil, err
	}
	if conflict != nil {
		return nil, domain.NewError(domain.CodeNameConflict, "an active bot named %q already exists", name)
	}
	if namespace == "" {
		namespace = "peers"
	}
	handle := strings.ReplaceAll(uuid.NewString(), "-", "")
	if len(handle) > 28 {
		handle = handle[:28]
	}
	botPtid, err := s.minter.MintAgentActor(ctx, "bot-"+handle, name, namespace)
	if err != nil {
		return nil, err
	}
	published, err := s.publishing.CreateForBot(ctx, ownerPtid, botPtid, name)
	if err != nil {
		return nil, err
	}
	bot, err := domain.NewActive(
		botPtid,
		ownerPtid,
		published.Grant.ID,
		name,
		s.now(),
	)
	if err != nil {
		return nil, err
	}
	if avatar != "" {
		if err := s.minter.SetAgentAvatar(ctx, botPtid, avatar); err != nil {
			_, _ = s.publishing.Revoke(ctx, ownerPtid, published.Grant.ID)
			return nil, err
		}
	}
	if err := s.repo.Create(ctx, bot); err != nil {
		_, _ = s.publishing.Revoke(ctx, ownerPtid, published.Grant.ID)
		return nil, err
	}
	return &CreatedBot{Bot: bot, Publishing: published.Grant, Secret: published.Secret}, nil
}

func (s *Service) SetProfile(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
	avatar string,
) (*domain.Bot, error) {
	bot, err := s.loadOwned(ctx, ownerPtid, botPtid)
	if err != nil {
		return nil, err
	}
	if err := s.minter.SetAgentAvatar(ctx, botPtid, avatar); err != nil {
		return nil, domain.NewError(domain.CodeInvalidArgument, "invalid avatar: %v", err)
	}
	s.notifyProfileChanged(ownerPtid, botPtid)
	return bot, nil
}

func (s *Service) notifyProfileChanged(ownerPtid, botPtid string) {
	if s.profilePublisher == nil {
		return
	}
	wake := ProfileChangeWake{
		OwnerPtid:       ownerPtid,
		BotPtid:         botPtid,
		ChangedAtUnixMs: s.now().UnixMilli(),
	}
	go func() {
		_ = s.profilePublisher.PublishActorProfileChanged(context.Background(), wake)
	}()
}

func (s *Service) RotateSecret(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
) (PublishingCreated, error) {
	bot, err := s.loadOwned(ctx, ownerPtid, botPtid)
	if err != nil {
		return PublishingCreated{}, err
	}
	return s.publishing.Rotate(ctx, ownerPtid, bot.PublishingID)
}

func (s *Service) SetState(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
	target domain.State,
) (*domain.Bot, PublishingGrant, error) {
	bot, err := s.loadOwned(ctx, ownerPtid, botPtid)
	if err != nil {
		return nil, PublishingGrant{}, err
	}
	now := s.now()
	var grant PublishingGrant
	switch target {
	case domain.StateActive:
		if err = bot.Enable(now); err == nil {
			grant, err = s.publishing.SetDisabled(ctx, ownerPtid, bot.PublishingID, false)
		}
	case domain.StateDisabled:
		if err = bot.Disable(now); err == nil {
			grant, err = s.publishing.SetDisabled(ctx, ownerPtid, bot.PublishingID, true)
		}
	case domain.StateRevoked:
		if err = bot.Revoke(now); err == nil {
			grant, err = s.publishing.Revoke(ctx, ownerPtid, bot.PublishingID)
		}
	default:
		err = domain.NewError(domain.CodeInvalidArgument, "unsupported target state %d", target)
	}
	if err != nil {
		return nil, PublishingGrant{}, err
	}
	if err := s.repo.Update(ctx, bot); err != nil {
		if target == domain.StateActive {
			_, _ = s.publishing.SetDisabled(ctx, ownerPtid, bot.PublishingID, true)
		} else if target == domain.StateDisabled {
			_, _ = s.publishing.SetDisabled(ctx, ownerPtid, bot.PublishingID, false)
		}
		return nil, PublishingGrant{}, err
	}
	return bot, grant, nil
}

func (s *Service) List(ctx context.Context, ownerPtid string) ([]*domain.Bot, error) {
	if ownerPtid == "" {
		return nil, domain.NewError(domain.CodeUnauthenticated, "owner identity required")
	}
	return s.repo.ListByOwner(ctx, ownerPtid)
}

func (s *Service) PublishingGrant(
	ctx context.Context,
	ownerPtid string,
	bot *domain.Bot,
) (PublishingGrant, error) {
	if bot == nil || !bot.Owns(ownerPtid) {
		return PublishingGrant{}, domain.NewNotFound("")
	}
	return s.publishing.Get(ctx, ownerPtid, bot.PublishingID)
}

func (s *Service) loadOwned(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
) (*domain.Bot, error) {
	if ownerPtid == "" {
		return nil, domain.NewError(domain.CodeUnauthenticated, "owner identity required")
	}
	bot, err := s.repo.GetByPtid(ctx, botPtid)
	if err != nil {
		return nil, err
	}
	if !bot.Owns(ownerPtid) {
		return nil, domain.NewNotFound(botPtid)
	}
	return bot, nil
}
