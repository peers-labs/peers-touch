package registry

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
)

type memoryRepository struct {
	bots map[string]*domain.Bot
}

func (r *memoryRepository) Create(_ context.Context, bot *domain.Bot) error {
	if r.bots == nil {
		r.bots = make(map[string]*domain.Bot)
	}
	copy := *bot
	r.bots[bot.BotPtid] = &copy
	return nil
}
func (r *memoryRepository) Update(ctx context.Context, bot *domain.Bot) error {
	return r.Create(ctx, bot)
}
func (r *memoryRepository) GetByPtid(_ context.Context, ptid string) (*domain.Bot, error) {
	bot := r.bots[ptid]
	if bot == nil {
		return nil, domain.NewNotFound(ptid)
	}
	copy := *bot
	return &copy, nil
}
func (r *memoryRepository) ListByOwner(_ context.Context, owner string) ([]*domain.Bot, error) {
	var result []*domain.Bot
	for _, bot := range r.bots {
		if bot.OwnerPtid == owner {
			copy := *bot
			result = append(result, &copy)
		}
	}
	return result, nil
}
func (r *memoryRepository) ActiveByName(_ context.Context, owner, name string) (*domain.Bot, error) {
	for _, bot := range r.bots {
		if bot.OwnerPtid == owner && bot.Name == name && bot.State != domain.StateRevoked {
			copy := *bot
			return &copy, nil
		}
	}
	return nil, nil
}

type fakeMinter struct{}

func (fakeMinter) MintAgentActor(context.Context, string, string, string) (string, error) {
	return "ptid:v1:actor:peers:b:bot:test", nil
}
func (fakeMinter) SetAgentAvatar(context.Context, string, string) error { return nil }

type fakePublishingManager struct {
	grant       PublishingGrant
	secret      string
	disabled    []bool
	rotateCount int
	revokeCount int
}

func (m *fakePublishingManager) CreateForBot(
	_ context.Context,
	owner string,
	bot string,
	name string,
) (PublishingCreated, error) {
	m.grant = PublishingGrant{
		ID:                 "publishing-1",
		OwnerPtid:          owner,
		SenderPtid:         bot,
		Name:               name,
		SourceNamespace:    "bot." + bot,
		DefaultTarget:      "conversation-1",
		AllowedTargets:     []string{"conversation-1"},
		RateLimitPerMinute: 120,
	}
	m.secret = "secret-1"
	return PublishingCreated{Grant: m.grant, Secret: m.secret}, nil
}
func (m *fakePublishingManager) Get(
	context.Context,
	string,
	string,
) (PublishingGrant, error) {
	return m.grant, nil
}
func (m *fakePublishingManager) Rotate(
	context.Context,
	string,
	string,
) (PublishingCreated, error) {
	m.rotateCount++
	return PublishingCreated{Grant: m.grant, Secret: "secret-2"}, nil
}
func (m *fakePublishingManager) SetDisabled(
	_ context.Context,
	_ string,
	_ string,
	disabled bool,
) (PublishingGrant, error) {
	m.disabled = append(m.disabled, disabled)
	m.grant.Disabled = disabled
	return m.grant, nil
}
func (m *fakePublishingManager) Revoke(
	context.Context,
	string,
	string,
) (PublishingGrant, error) {
	m.revokeCount++
	m.grant.Revoked = true
	return m.grant, nil
}

func newRegistryService() (*Service, *fakePublishingManager) {
	publishing := &fakePublishingManager{}
	service := NewService(&memoryRepository{}, fakeMinter{}, publishing)
	service.now = func() time.Time {
		return time.Date(2026, time.October, 14, 0, 0, 0, 0, time.UTC)
	}
	return service, publishing
}

func TestBotCreateDelegatesToGenericPublishing(t *testing.T) {
	service, publishing := newRegistryService()
	created, err := service.Create(
		context.Background(),
		"ptid:v1:actor:peers:p:owner:test",
		"Build Bot",
		"peers",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.Bot.PublishingID != publishing.grant.ID ||
		created.Publishing.ID != publishing.grant.ID ||
		created.Secret != "secret-1" {
		t.Fatalf("created Bot = %+v", created)
	}
}

func TestBotLifecycleControlsSamePublishingGrant(t *testing.T) {
	service, publishing := newRegistryService()
	created, err := service.Create(
		context.Background(),
		"ptid:v1:actor:peers:p:owner:test",
		"Build Bot",
		"peers",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.RotateSecret(
		context.Background(),
		created.Bot.OwnerPtid,
		created.Bot.BotPtid,
	); err != nil {
		t.Fatal(err)
	}
	if publishing.rotateCount != 1 {
		t.Fatalf("rotate calls = %d", publishing.rotateCount)
	}
	if _, _, err := service.SetState(
		context.Background(),
		created.Bot.OwnerPtid,
		created.Bot.BotPtid,
		domain.StateDisabled,
	); err != nil {
		t.Fatal(err)
	}
	if len(publishing.disabled) != 1 || !publishing.disabled[0] {
		t.Fatalf("disable calls = %v", publishing.disabled)
	}
	if _, _, err := service.SetState(
		context.Background(),
		created.Bot.OwnerPtid,
		created.Bot.BotPtid,
		domain.StateRevoked,
	); err != nil {
		t.Fatal(err)
	}
	if publishing.revokeCount != 1 {
		t.Fatalf("revoke calls = %d", publishing.revokeCount)
	}
}
