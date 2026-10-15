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
	createCalls []publishingManagerCall
	getCalls    []publishingManagerCall
	rotateCalls []publishingManagerCall
	stateCalls  []publishingManagerCall
	revokeCalls []publishingManagerCall
}

type publishingManagerCall struct {
	owner        string
	bot          string
	name         string
	publishingID string
}

func (m *fakePublishingManager) CreateForBot(
	_ context.Context,
	owner string,
	bot string,
	name string,
) (PublishingCreated, error) {
	m.createCalls = append(m.createCalls, publishingManagerCall{
		owner: owner,
		bot:   bot,
		name:  name,
	})
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
	_ context.Context,
	owner string,
	publishingID string,
) (PublishingGrant, error) {
	m.getCalls = append(m.getCalls, publishingManagerCall{
		owner:        owner,
		publishingID: publishingID,
	})
	return m.grant, nil
}
func (m *fakePublishingManager) Rotate(
	_ context.Context,
	owner string,
	publishingID string,
) (PublishingCreated, error) {
	m.rotateCount++
	m.rotateCalls = append(m.rotateCalls, publishingManagerCall{
		owner:        owner,
		publishingID: publishingID,
	})
	return PublishingCreated{Grant: m.grant, Secret: "secret-2"}, nil
}
func (m *fakePublishingManager) SetDisabled(
	_ context.Context,
	owner string,
	publishingID string,
	disabled bool,
) (PublishingGrant, error) {
	m.disabled = append(m.disabled, disabled)
	m.stateCalls = append(m.stateCalls, publishingManagerCall{
		owner:        owner,
		publishingID: publishingID,
	})
	m.grant.Disabled = disabled
	return m.grant, nil
}
func (m *fakePublishingManager) Revoke(
	_ context.Context,
	owner string,
	publishingID string,
) (PublishingGrant, error) {
	m.revokeCount++
	m.revokeCalls = append(m.revokeCalls, publishingManagerCall{
		owner:        owner,
		publishingID: publishingID,
	})
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
	if len(publishing.createCalls) != 1 {
		t.Fatalf("create calls = %v", publishing.createCalls)
	}
	call := publishing.createCalls[0]
	if call.owner != created.Bot.OwnerPtid ||
		call.bot != created.Bot.BotPtid ||
		call.name != created.Bot.Name {
		t.Fatalf("generic publishing create call = %+v", call)
	}
	if created.Publishing.SenderPtid != created.Bot.BotPtid ||
		created.Publishing.SourceNamespace != "bot."+created.Bot.BotPtid {
		t.Fatalf("publishing adapter projection = %+v", created.Publishing)
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
	if len(publishing.rotateCalls) != 1 ||
		publishing.rotateCalls[0].owner != created.Bot.OwnerPtid ||
		publishing.rotateCalls[0].publishingID != created.Bot.PublishingID {
		t.Fatalf("rotate adapter calls = %+v", publishing.rotateCalls)
	}
	grant, err := service.PublishingGrant(
		context.Background(),
		created.Bot.OwnerPtid,
		created.Bot,
	)
	if err != nil {
		t.Fatal(err)
	}
	if grant.ID != created.Bot.PublishingID ||
		len(publishing.getCalls) != 1 ||
		publishing.getCalls[0].publishingID != created.Bot.PublishingID {
		t.Fatalf("publishing grant adapter calls = %+v", publishing.getCalls)
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
	if len(publishing.stateCalls) != 1 ||
		publishing.stateCalls[0].owner != created.Bot.OwnerPtid ||
		publishing.stateCalls[0].publishingID != created.Bot.PublishingID {
		t.Fatalf("state adapter calls = %+v", publishing.stateCalls)
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
	if len(publishing.revokeCalls) != 1 ||
		publishing.revokeCalls[0].owner != created.Bot.OwnerPtid ||
		publishing.revokeCalls[0].publishingID != created.Bot.PublishingID {
		t.Fatalf("revoke adapter calls = %+v", publishing.revokeCalls)
	}
}
