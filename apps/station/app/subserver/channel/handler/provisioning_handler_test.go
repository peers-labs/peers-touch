package handler_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/handler"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/provisioning"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

type testKEK struct{}

func (testKEK) KEK() ([]byte, string, error) {
	return []byte("0123456789abcdef0123456789abcdef"), "test-v1", nil
}

type fakeProvisioningManager struct {
	start      *provisioning.QRStart
	startErr   error
	poll       *provisioning.PollResult
	credential *provisioning.Credential
	committed  bool
	startCalls int
	pollCalls  int
}

func (f *fakeProvisioningManager) Start(
	_ context.Context, _, _, _ string,
) (*provisioning.QRStart, error) {
	f.startCalls++
	if f.startErr != nil {
		return nil, f.startErr
	}
	return f.start, nil
}

func (f *fakeProvisioningManager) Poll(_ context.Context, _ string) *provisioning.PollResult {
	f.pollCalls++
	return f.poll
}

func (f *fakeProvisioningManager) SnapshotCredential(_ string) (provisioning.Credential, *provisioning.BotSummary, bool) {
	if f.committed || f.credential == nil {
		return provisioning.Credential{}, nil, false
	}
	var bot *provisioning.BotSummary
	if f.poll != nil {
		bot = f.poll.Bot
	}
	return *f.credential, bot, true
}

func (f *fakeProvisioningManager) CommitCredential(_ string) {
	f.committed = true
}

func (f *fakeProvisioningManager) Cancel(_ string) bool {
	f.committed = true
	return true
}

func newConfirmFixture(t *testing.T, manager *fakeProvisioningManager) (*handler.ProvisioningHandlers, *channelsvc.BindingService) {
	t.Helper()
	dsn := fmt.Sprintf("file:prov-%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatal(err)
	}
	secrets := secret.NewService(db, testKEK{})
	bindings := channelsvc.NewBindingService(db, secrets)
	coordinator := channelsvc.NewProvisioningCoordinator(
		db, manager, secrets, bindings, nil,
	)
	return handler.NewProvisioningHandlers(coordinator), bindings
}

func actorCtx() context.Context {
	return coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "ptid-1"})
}

func TestProvisioningHandlers_StartAndPoll(t *testing.T) {
	manager := &fakeProvisioningManager{
		start: &provisioning.QRStart{
			SessionID: "s1",
			QRPayload: `{"qrlogin":{"token":"tok-1"}}`,
			ExpiresIn: 300 * time.Second,
		},
		poll: &provisioning.PollResult{
			Status:     provisioning.StatusSuccess,
			ConsoleURL: "https://open.feishu.cn/app/cli_x",
			Bot: &provisioning.BotSummary{
				AppID: "cli_x", AppName: "Peers Assistant",
				ConsoleURL:          "https://open.feishu.cn/app/cli_x",
				OwnerProviderUserID: "ou_owner",
				PublishedOnline:     true,
			},
		},
	}
	h, _ := newConfirmFixture(t, manager)
	ctx := actorCtx()

	start, err := h.HandleStart(ctx, &model.StartChannelProvisioningRequest{AppName: "Peers Assistant"})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if start.SessionId != "s1" || start.QrPayload != `{"qrlogin":{"token":"tok-1"}}` || start.ExpiresInSeconds != 300 {
		t.Fatalf("unexpected start response: %+v", start)
	}

	poll, err := h.HandlePoll(ctx, &model.PollChannelProvisioningRequest{SessionId: "s1"})
	if err != nil {
		t.Fatalf("poll: %v", err)
	}
	if poll.Status != "ready" || poll.Bot == nil ||
		poll.Bot.AppId != "cli_x" ||
		poll.Bot.OwnerProviderUserId != "ou_owner" ||
		!poll.Bot.PublishedOnline {
		t.Fatalf("unexpected poll response: %+v", poll)
	}
}

func TestProvisioningHandlers_StartError(t *testing.T) {
	manager := &fakeProvisioningManager{startErr: context.DeadlineExceeded}
	h, _ := newConfirmFixture(t, manager)
	if _, err := h.HandleStart(actorCtx(), &model.StartChannelProvisioningRequest{}); err == nil {
		t.Fatal("expected start error to propagate")
	}
}

func TestProvisioningHandlers_ConfirmSealsCredentialOnce(t *testing.T) {
	manager := &fakeProvisioningManager{
		start: &provisioning.QRStart{
			SessionID: "s1", QRPayload: "qr", ExpiresIn: time.Minute,
		},
		poll: &provisioning.PollResult{
			Status: provisioning.StatusSuccess,
			Bot: &provisioning.BotSummary{
				AppID: "cli_x", AppName: "Peers Assistant",
				OwnerProviderUserID: "ou_owner",
				PublishedOnline:     true,
			},
		},
		credential: &provisioning.Credential{AppID: "cli_x", AppSecret: "sec_x"},
	}
	h, bindings := newConfirmFixture(t, manager)
	ctx := actorCtx()

	start, err := h.HandleStart(ctx, &model.StartChannelProvisioningRequest{AppName: "Peers Assistant"})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := h.HandlePoll(ctx, &model.PollChannelProvisioningRequest{
		SessionId: "s1", JobId: start.JobId,
	}); err != nil {
		t.Fatalf("poll: %v", err)
	}
	resp, err := h.HandleConfirm(ctx, &model.ConfirmChannelProvisioningRequest{
		SessionId: "s1", JobId: start.JobId,
		PluginId: "lark-plugin", AgentId: "agent-1", Enabled: false,
	})
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	b := resp.Binding
	if b.ProviderAppId != "cli_x" || b.ProviderKind != "lark" || b.PluginId != "lark-plugin" || b.AgentId != "agent-1" {
		t.Fatalf("unexpected binding: %+v", b)
	}
	if b.OwnerProviderUserId != "ou_owner" {
		t.Fatalf("binding owner = %q", b.OwnerProviderUserId)
	}
	if b.Enabled {
		t.Fatal("enabled flag must round-trip")
	}

	// The secret is sealed in the vault and retrievable only host-internally.
	payload, err := bindings.CredentialForBinding(ctx, b.BindingId)
	if err != nil {
		t.Fatalf("sealed credential unreadable: %v", err)
	}
	if payload.AppID != "cli_x" || payload.AppSecret != "sec_x" {
		t.Fatalf("sealed payload mismatch: %+v", payload)
	}

	// Repeated confirm returns the same binding without consuming a second
	// credential or creating another row.
	replayed, err := h.HandleConfirm(ctx, &model.ConfirmChannelProvisioningRequest{
		SessionId: "s1", JobId: start.JobId, PluginId: "lark-plugin",
	})
	if err != nil || !replayed.Replayed || replayed.Binding.BindingId != b.BindingId {
		t.Fatalf("confirm replay mismatch: response=%+v err=%v", replayed, err)
	}
	views, err := bindings.List(ctx, "ptid-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(views) != 1 {
		t.Fatalf("expected exactly one binding, got %d", len(views))
	}
}

func TestProvisioningHandlers_ConfirmRejectsUnreadySession(t *testing.T) {
	manager := &fakeProvisioningManager{
		start: &provisioning.QRStart{
			SessionID: "s2", QRPayload: "qr", ExpiresIn: time.Minute,
		},
		poll: &provisioning.PollResult{Status: provisioning.StatusPending},
	}
	h, bindings := newConfirmFixture(t, manager)
	start, err := h.HandleStart(actorCtx(), &model.StartChannelProvisioningRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.HandleConfirm(actorCtx(), &model.ConfirmChannelProvisioningRequest{
		SessionId: "s2", JobId: start.JobId, PluginId: "lark-plugin",
	}); err == nil {
		t.Fatal("confirm must fail while the session is not online")
	}
	views, err := bindings.List(actorCtx(), "ptid-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(views) != 0 {
		t.Fatalf("no binding may be created from an unready session, got %d", len(views))
	}
}
