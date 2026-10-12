package registry

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
)

// CreatedBot bundles the aggregate with the one-time plaintext secret.
type CreatedBot struct {
	Bot             *domain.Bot
	SecretPlaintext string
}

// Service implements owner-scoped registry management.
type Service struct {
	repo   Repository
	minter ActorMinter
	now    func() time.Time
}

func NewService(repo Repository, minter ActorMinter) *Service {
	return &Service{repo: repo, minter: minter, now: func() time.Time { return time.Now().UTC() }}
}

// Create mints a HIDDEN AGENT actor and registers an active bot. The returned
// plaintext secret is shown exactly once.
func (s *Service) Create(ctx context.Context, ownerPtid, displayName, namespace string) (*CreatedBot, error) {
	if ownerPtid == "" {
		return nil, domain.NewError(domain.CodeUnauthenticated, "owner identity required")
	}
	name := displayName
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

	webhookID, err := domain.GenerateWebhookID()
	if err != nil {
		return nil, err
	}
	secret, err := domain.GenerateSecret()
	if err != nil {
		return nil, err
	}

	// The actor handle is namespaced by the unguessable webhook id so bot
	// display names never collide with human handles; the display name is
	// stored separately on the bot row.
	handle := "bot-" + webhookID
	if namespace == "" {
		namespace = "peers"
	}
	botPtid, err := s.minter.MintAgentActor(ctx, handle, name, namespace)
	if err != nil {
		return nil, err
	}

	bot, err := domain.NewActive(botPtid, ownerPtid, name, webhookID, secret, s.now())
	if err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, bot); err != nil {
		return nil, err
	}
	return &CreatedBot{Bot: bot, SecretPlaintext: secret}, nil
}

// RotateSecret issues a new secret, invalidating the old one immediately.
func (s *Service) RotateSecret(ctx context.Context, ownerPtid, botPtid string) (string, error) {
	bot, err := s.loadOwned(ctx, ownerPtid, botPtid)
	if err != nil {
		return "", err
	}
	secret, err := domain.GenerateSecret()
	if err != nil {
		return "", err
	}
	if err := bot.ReplaceSecret(secret, s.now()); err != nil {
		return "", err
	}
	if err := s.repo.Update(ctx, bot); err != nil {
		return "", err
	}
	return secret, nil
}

// SetState transitions the registry lifecycle (enable/disable/revoke).
func (s *Service) SetState(ctx context.Context, ownerPtid, botPtid string, target domain.State) (*domain.Bot, error) {
	bot, err := s.loadOwned(ctx, ownerPtid, botPtid)
	if err != nil {
		return nil, err
	}
	now := s.now()
	switch target {
	case domain.StateActive:
		err = bot.Enable(now)
	case domain.StateDisabled:
		err = bot.Disable(now)
	case domain.StateRevoked:
		err = bot.Revoke(now)
	default:
		err = domain.NewError(domain.CodeInvalidArgument, "unsupported target state %d", target)
	}
	if err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, bot); err != nil {
		return nil, err
	}
	return bot, nil
}

// List returns the owner's bots, newest first.
func (s *Service) List(ctx context.Context, ownerPtid string) ([]*domain.Bot, error) {
	if ownerPtid == "" {
		return nil, domain.NewError(domain.CodeUnauthenticated, "owner identity required")
	}
	return s.repo.ListByOwner(ctx, ownerPtid)
}

// loadOwned fetches a bot and enforces that the caller is its owner.
func (s *Service) loadOwned(ctx context.Context, ownerPtid, botPtid string) (*domain.Bot, error) {
	if ownerPtid == "" {
		return nil, domain.NewError(domain.CodeUnauthenticated, "owner identity required")
	}
	bot, err := s.repo.GetByPtid(ctx, botPtid)
	if err != nil {
		return nil, err
	}
	if !bot.Owns(ownerPtid) {
		return nil, domain.NewError(domain.CodeNotFound, "bot not found: %s", botPtid)
	}
	return bot, nil
}

// AuthenticateWebhook verifies a public webhook edge call. Unknown ids,
// inactive bots, and wrong secrets all return false with no detail so the edge
// cannot distinguish them (BOT-A10). A dummy comparison still runs on misses
// to keep the response path constant-time at the application layer.
func (s *Service) AuthenticateWebhook(
	ctx context.Context,
	webhookID, presentedSecret string,
) (*domain.Bot, bool) {
	const dummyHash = ""
	bot, err := s.repo.GetByWebhookID(ctx, webhookID)
	if err != nil || bot == nil || !bot.CanIngest() || bot.SecretHash == "" {
		domain.VerifySecret(dummyHash, presentedSecret)
		return nil, false
	}
	if !domain.VerifySecret(bot.SecretHash, presentedSecret) {
		return nil, false
	}
	return bot, true
}
