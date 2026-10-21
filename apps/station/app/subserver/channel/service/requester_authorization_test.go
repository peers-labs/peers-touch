package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type fakeRequesterCLICall struct {
	configDir string
	args      []string
}

type fakeRequesterCLIRunner struct {
	mu      sync.Mutex
	calls   []fakeRequesterCLICall
	handler func(context.Context, string, CLIInvocation) ([]byte, []byte, error)
}

func (r *fakeRequesterCLIRunner) Run(
	ctx context.Context,
	configDir string,
	invocation CLIInvocation,
) ([]byte, []byte, error) {
	r.mu.Lock()
	r.calls = append(r.calls, fakeRequesterCLICall{
		configDir: configDir,
		args:      append([]string(nil), invocation.Args...),
	})
	r.mu.Unlock()
	if r.handler == nil {
		return nil, nil, errors.New("unexpected lark-cli invocation")
	}
	return r.handler(ctx, configDir, invocation)
}

func (r *fakeRequesterCLIRunner) countCommand(parts ...string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, call := range r.calls {
		if commandContains(call.args, parts...) {
			count++
		}
	}
	return count
}

func commandContains(args []string, parts ...string) bool {
	haystack := strings.Join(args, "\x00")
	return strings.Contains(haystack, strings.Join(parts, "\x00"))
}

type requesterAuthorizationFixture struct {
	db       *gorm.DB
	bindings *BindingService
	secrets  *secret.Service
	service  *RequesterAuthorizationService
	binding  BindingView
	now      time.Time
	root     string
}

func newRequesterAuthorizationFixture(
	t *testing.T,
	runner LarkCLIRunner,
) *requesterAuthorizationFixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(filepath.Join(t.TempDir(), "channel.db")),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatal(err)
	}
	vault := secret.NewService(
		db,
		secret.StaticKEKProvider{Material: []byte("requester-test-kek-0123456789abcdef")},
	)
	bindings := NewBindingService(db, vault)
	binding, err := bindings.Create(context.Background(), CreateBindingInput{
		ActorPTID: "ptid:person:owner", PluginID: "plugin-lark",
		ProviderKind: "lark", ProviderAppID: "cli_requester_test",
		AppSecret: "app-secret", Name: "Test Lark", Region: "lark",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := bindings.SetConnectionIdentity(
		context.Background(),
		binding.ID,
		"ou_bot",
		"tenant-a",
	); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	service := NewRequesterAuthorizationService(db, bindings, vault, runner, root)
	now := time.Now().UTC().Truncate(time.Second)
	service.now = func() time.Time { return now }
	return &requesterAuthorizationFixture{
		db: db, bindings: bindings, secrets: vault, service: service,
		binding: binding, now: now, root: root,
	}
}

func requesterStatusJSON(
	t *testing.T,
	openID string,
	refreshExpiresAt time.Time,
) []byte {
	t.Helper()
	value := map[string]any{
		"identity": "user",
		"identities": map[string]any{
			"user": map[string]any{
				"status": "ready", "available": true, "verified": true,
				"openId": openID, "userName": "Requester",
				"scope":            "docs:document:readonly drive:drive:readonly",
				"expiresAt":        refreshExpiresAt.Add(-6 * 24 * time.Hour).Format(time.RFC3339),
				"refreshExpiresAt": refreshExpiresAt.Format(time.RFC3339),
			},
		},
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func waitForRequesterAuthorization(
	t *testing.T,
	db *gorm.DB,
	id string,
	status string,
) persistence.ChannelRequesterAuthorization {
	t.Helper()
	return waitForRequesterAuthorizationCondition(
		t,
		db,
		id,
		"status "+status,
		func(record persistence.ChannelRequesterAuthorization) bool {
			return record.Status == status
		},
	)
}

func waitForRequesterAuthorizationCondition(
	t *testing.T,
	db *gorm.DB,
	id string,
	description string,
	predicate func(persistence.ChannelRequesterAuthorization) bool,
) persistence.ChannelRequesterAuthorization {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var record persistence.ChannelRequesterAuthorization
		if err := db.First(&record, "id = ?", id).Error; err == nil &&
			predicate(record) {
			return record
		}
		time.Sleep(10 * time.Millisecond)
	}
	var record persistence.ChannelRequesterAuthorization
	_ = db.First(&record, "id = ?", id).Error
	t.Fatalf("authorization %s did not reach %s: %+v", id, description, record)
	return persistence.ChannelRequesterAuthorization{}
}

func TestRequesterAuthorizationPendingToReadyUsesRefreshExpiry(t *testing.T) {
	deviceStarted := make(chan struct{})
	releaseDevice := make(chan struct{})
	var startOnce sync.Once
	var now time.Time
	runner := &fakeRequesterCLIRunner{}
	runner.handler = func(
		ctx context.Context,
		_ string,
		invocation CLIInvocation,
	) ([]byte, []byte, error) {
		switch {
		case commandContains(invocation.Args, "config", "init"):
			return nil, nil, nil
		case commandContains(invocation.Args, "auth", "login", "--domain"):
			return []byte(`{"verification_url":"https://example.test/authorize","device_code":"device-1","expires_in":600}`), nil, nil
		case commandContains(invocation.Args, "auth", "login", "--device-code"):
			startOnce.Do(func() { close(deviceStarted) })
			select {
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case <-releaseDevice:
				return nil, nil, nil
			}
		case commandContains(invocation.Args, "auth", "status"):
			return requesterStatusJSON(t, "ou_requester", now.Add(7*24*time.Hour)), nil, nil
		case commandContains(invocation.Args, "auth", "logout"):
			return []byte(`{"ok":true}`), nil, nil
		default:
			return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
		}
	}
	fixture := newRequesterAuthorizationFixture(t, runner)
	now = fixture.now
	view, err := fixture.service.StartAuthorization(
		context.Background(),
		StartRequesterAuthorizationInput{
			ActorPTID: "ptid:person:owner", BindingID: fixture.binding.ID,
			ProviderUserID: "ou_requester", TenantKey: "tenant-a",
			Domains:        []string{"wiki", "docs", "drive", "contact"},
			IdempotencyKey: "attempt-ready",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if view.Status != requesterAuthPending || view.VerificationURL == "" {
		t.Fatalf("unexpected pending view: %+v", view)
	}
	select {
	case <-deviceStarted:
	case <-time.After(time.Second):
		t.Fatal("device authorization worker did not start")
	}
	close(releaseDevice)
	stored := waitForRequesterAuthorization(
		t,
		fixture.db,
		view.ID,
		requesterAuthReady,
	)
	wantExpiry := now.Add(7 * 24 * time.Hour)
	if stored.ExpiresAt == nil || !stored.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("grant expiry = %v, want refresh expiry %v", stored.ExpiresAt, wantExpiry)
	}
	wantAccessExpiry := now.Add(24 * time.Hour)
	if stored.AccessExpiresAt == nil || !stored.AccessExpiresAt.Equal(wantAccessExpiry) {
		t.Fatalf(
			"access expiry = %v, want %v",
			stored.AccessExpiresAt,
			wantAccessExpiry,
		)
	}
	var binding persistence.ChannelBinding
	if err := fixture.db.First(&binding, "id = ?", fixture.binding.ID).Error; err != nil {
		t.Fatal(err)
	}
	if binding.OwnerProviderUserID != "ou_requester" ||
		binding.PersonalOAuthConnectionID != view.ID ||
		binding.PersonalOAuthStatus != requesterAuthReady {
		t.Fatalf("binding requester projection not committed: %+v", binding)
	}
	if runner.countCommand("auth", "status") != 1 {
		t.Fatalf("auth status calls = %d, want 1", runner.countCommand("auth", "status"))
	}
}

func TestRequesterAuthorizationRejectsWrongRequesterAndRevokesProfile(t *testing.T) {
	var now time.Time
	runner := &fakeRequesterCLIRunner{}
	runner.handler = func(
		_ context.Context,
		_ string,
		invocation CLIInvocation,
	) ([]byte, []byte, error) {
		switch {
		case commandContains(invocation.Args, "config", "init"):
			return nil, nil, nil
		case commandContains(invocation.Args, "auth", "login", "--domain"):
			return []byte(`{"verification_url":"https://example.test/authorize","device_code":"device-2","expires_in":600}`), nil, nil
		case commandContains(invocation.Args, "auth", "login", "--device-code"):
			return nil, nil, nil
		case commandContains(invocation.Args, "auth", "status"):
			return requesterStatusJSON(t, "ou_wrong", now.Add(7*24*time.Hour)), nil, nil
		case commandContains(invocation.Args, "auth", "logout"):
			return []byte(`{"ok":true}`), nil, nil
		default:
			return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
		}
	}
	fixture := newRequesterAuthorizationFixture(t, runner)
	now = fixture.now
	view, err := fixture.service.StartAuthorization(
		context.Background(),
		StartRequesterAuthorizationInput{
			ActorPTID: "ptid:person:owner", BindingID: fixture.binding.ID,
			ProviderUserID: "ou_expected", TenantKey: "tenant-a",
			IdempotencyKey: "attempt-wrong-user",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	stored := waitForRequesterAuthorization(
		t,
		fixture.db,
		view.ID,
		requesterAuthFailed,
	)
	if stored.RecoveryAction != "authorize_correct_requester" ||
		!strings.Contains(stored.ErrorMessage, "does not match") {
		t.Fatalf("unexpected mismatch projection: %+v", stored)
	}
	if runner.countCommand("auth", "logout") != 1 {
		t.Fatalf("logout calls = %d, want 1", runner.countCommand("auth", "logout"))
	}
}

func TestRequesterAuthorizationForTurnIsStrictlyRequesterAndTenantScoped(t *testing.T) {
	fixture := newRequesterAuthorizationFixture(t, &fakeRequesterCLIRunner{})
	expires := fixture.now.Add(7 * 24 * time.Hour)
	authorization := persistence.ChannelRequesterAuthorization{
		ID: "authorization-a", ActorPTID: "ptid:person:owner",
		BindingID: fixture.binding.ID, ProviderUserID: "ou_requester",
		TenantKey: "tenant-a", Region: "lark", Status: requesterAuthReady,
		AttemptKey: "attempt-a", Revision: 1, ExpiresAt: &expires,
		CreatedAt: fixture.now, UpdatedAt: fixture.now,
	}
	if err := fixture.db.Create(&authorization).Error; err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name      string
		senderID  string
		tenantKey string
	}{
		{name: "wrong tenant", senderID: "ou_requester", tenantKey: "tenant-b"},
		{name: "missing requester", senderID: "", tenantKey: "tenant-a"},
		{name: "wrong requester", senderID: "ou_other", tenantKey: "tenant-a"},
	} {
		t.Run(test.name, func(t *testing.T) {
			turnID := "turn-" + strings.ReplaceAll(test.name, " ", "-")
			inbound := persistence.ChannelInboundEvent{
				ID: "inbound-" + turnID, BindingID: fixture.binding.ID,
				ProviderKind: "lark", ProviderEventID: "event-" + turnID,
				ProviderMessageID: "message-" + turnID,
				PayloadHash:       "hash", ChatID: "chat", ChatType: "private",
				ScopeKey: "chat", SenderID: test.senderID,
				SenderTenantKey: test.tenantKey, AdmissionKey: "admission-" + turnID,
				TurnID: turnID, Status: "admitted",
				ReceivedAt: fixture.now, CreatedAt: fixture.now, UpdatedAt: fixture.now,
			}
			if err := fixture.db.Create(&inbound).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := fixture.service.authorizationForTurn(
				context.Background(),
				turnID,
			); err == nil {
				t.Fatal("cross-requester or cross-tenant authorization unexpectedly succeeded")
			}
		})
	}
}

func TestRequesterAuthorizationRecoversPersistedPendingAttempt(t *testing.T) {
	var now time.Time
	runner := &fakeRequesterCLIRunner{}
	runner.handler = func(
		_ context.Context,
		_ string,
		invocation CLIInvocation,
	) ([]byte, []byte, error) {
		switch {
		case commandContains(invocation.Args, "auth", "login", "--device-code"):
			return nil, nil, nil
		case commandContains(invocation.Args, "auth", "status"):
			return requesterStatusJSON(t, "ou_recovered", now.Add(7*24*time.Hour)), nil, nil
		default:
			return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
		}
	}
	fixture := newRequesterAuthorizationFixture(t, runner)
	now = fixture.now
	expires := now.Add(10 * time.Minute)
	payload, _ := json.Marshal(requesterDeviceFlowSecret{
		DeviceCode: "restart-device", VerificationURL: "https://example.test/restart",
	})
	secretID, err := fixture.secrets.Put(context.Background(), secret.PutInput{
		ActorPTID: "ptid:person:owner", Purpose: secret.PurposeChannelRequesterOAuth,
		Name: "requester:authorization-restart", Plaintext: payload, ExpiresAt: &expires,
	})
	if err != nil {
		t.Fatal(err)
	}
	record := persistence.ChannelRequesterAuthorization{
		ID: "authorization-restart", ActorPTID: "ptid:person:owner",
		BindingID: fixture.binding.ID, ProviderUserID: "ou_recovered",
		TenantKey: "tenant-a", Region: "lark", Status: requesterAuthPending,
		RequestedScope: "contact,docs,drive,wiki", AttemptKey: "attempt-restart",
		SecretID: secretID, Revision: 2, RecoveryAction: "complete_authorization",
		AttemptExpiresAt: &expires, CreatedAt: now, UpdatedAt: now,
	}
	if err := fixture.db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}

	restarted := NewRequesterAuthorizationService(
		fixture.db,
		fixture.bindings,
		fixture.secrets,
		runner,
		fixture.root,
	)
	restarted.now = func() time.Time { return now }
	restarted.processPending(context.Background(), record.ID)

	stored := waitForRequesterAuthorization(
		t,
		fixture.db,
		record.ID,
		requesterAuthReady,
	)
	if stored.SecretID != "" || stored.ProviderUserID != "ou_recovered" {
		t.Fatalf("pending attempt was not recovered cleanly: %+v", stored)
	}
}

func TestRequesterScopeUpgradeFailurePreservesExistingGrant(t *testing.T) {
	var now time.Time
	runner := &fakeRequesterCLIRunner{}
	runner.handler = func(
		_ context.Context,
		_ string,
		invocation CLIInvocation,
	) ([]byte, []byte, error) {
		switch {
		case commandContains(invocation.Args, "auth", "login", "--domain"):
			return []byte(`{"verification_url":"https://example.test/upgrade","device_code":"upgrade-device","expires_in":600}`), nil, nil
		case commandContains(invocation.Args, "auth", "login", "--device-code"):
			return nil, []byte(`{"error":{"message":"requested scopes were not granted"}}`), errors.New("exit 4")
		case commandContains(invocation.Args, "auth", "status"):
			return requesterStatusJSON(t, "ou_requester", now.Add(7*24*time.Hour)), nil, nil
		case commandContains(invocation.Args, "auth", "logout"):
			return []byte(`{"ok":true}`), nil, nil
		default:
			return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
		}
	}
	fixture := newRequesterAuthorizationFixture(t, runner)
	now = fixture.now
	expires := now.Add(7 * 24 * time.Hour)
	record := persistence.ChannelRequesterAuthorization{
		ID: "authorization-upgrade", ActorPTID: "ptid:person:owner",
		BindingID: fixture.binding.ID, ProviderUserID: "ou_requester",
		TenantKey: "tenant-a", Region: "lark", Status: requesterAuthReady,
		GrantedScopes:  "docs:document:readonly drive:drive:readonly",
		RequestedScope: "contact,docs,drive,wiki",
		AttemptKey:     "attempt-original", Revision: 3, ExpiresAt: &expires,
		CreatedAt: now, UpdatedAt: now, LastVerifiedAt: &now,
	}
	if err := fixture.db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&persistence.ChannelBinding{}).
		Where("id = ?", fixture.binding.ID).
		Updates(map[string]any{
			"owner_provider_user_id":       "ou_requester",
			"personal_oauth_connection_id": record.ID,
			"personal_oauth_status":        requesterAuthReady,
		}).Error; err != nil {
		t.Fatal(err)
	}

	pending, err := fixture.service.StartAuthorization(
		context.Background(),
		StartRequesterAuthorizationInput{
			ActorPTID: record.ActorPTID, BindingID: record.BindingID,
			ProviderUserID: record.ProviderUserID, TenantKey: record.TenantKey,
			Domains: []string{"calendar"}, IdempotencyKey: "attempt-upgrade",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Status != requesterAuthPending ||
		!slicesContain(pending.PendingDomains, "calendar") {
		t.Fatalf("unexpected scope upgrade projection: %+v", pending)
	}
	stored := waitForRequesterAuthorizationCondition(
		t,
		fixture.db,
		record.ID,
		"preserved grant after scope denial",
		func(current persistence.ChannelRequesterAuthorization) bool {
			return current.Status == requesterAuthReady &&
				current.RecoveryAction == "retry_scope_upgrade"
		},
	)
	if stored.RequestedScope != "contact,docs,drive,wiki" ||
		stored.PendingScope != "" ||
		stored.RecoveryAction != "retry_scope_upgrade" ||
		!strings.Contains(stored.ErrorMessage, "not granted") {
		t.Fatalf("existing grant was not preserved: %+v", stored)
	}
	if runner.countCommand("config", "init") != 0 ||
		runner.countCommand("auth", "logout") != 0 {
		t.Fatalf(
			"scope upgrade reset the managed profile: config=%d logout=%d",
			runner.countCommand("config", "init"),
			runner.countCommand("auth", "logout"),
		)
	}
}

func TestStartAuthorizationRefreshesExistingGrantWithoutNewDeviceFlow(t *testing.T) {
	var now time.Time
	runner := &fakeRequesterCLIRunner{}
	runner.handler = func(
		_ context.Context,
		_ string,
		invocation CLIInvocation,
	) ([]byte, []byte, error) {
		if commandContains(invocation.Args, "auth", "status") {
			return requesterStatusJSON(t, "ou_requester", now.Add(7*24*time.Hour)), nil, nil
		}
		return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
	}
	fixture := newRequesterAuthorizationFixture(t, runner)
	now = fixture.now
	accessExpires := now.Add(-time.Minute)
	refreshExpires := now.Add(7 * 24 * time.Hour)
	record := persistence.ChannelRequesterAuthorization{
		ID: "authorization-refresh-before-login", ActorPTID: "ptid:person:owner",
		BindingID: fixture.binding.ID, ProviderUserID: "ou_requester",
		TenantKey: "tenant-a", Region: "lark", Status: requesterAuthNeedsRefresh,
		GrantedScopes:  "docs:document:readonly drive:drive:readonly",
		RequestedScope: "contact,docs,drive,wiki",
		AttemptKey:     "attempt-old", Revision: 5,
		AccessExpiresAt: &accessExpires, ExpiresAt: &refreshExpires,
		CreatedAt: now, UpdatedAt: now, LastVerifiedAt: &now,
	}
	if err := fixture.db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&persistence.ChannelBinding{}).
		Where("id = ?", fixture.binding.ID).
		Updates(map[string]any{
			"owner_provider_user_id":       "ou_requester",
			"personal_oauth_connection_id": record.ID,
			"personal_oauth_status":        requesterAuthNeedsRefresh,
		}).Error; err != nil {
		t.Fatal(err)
	}

	refreshed, err := fixture.service.StartAuthorization(
		context.Background(),
		StartRequesterAuthorizationInput{
			ActorPTID: record.ActorPTID, BindingID: record.BindingID,
			ProviderUserID: record.ProviderUserID, TenantKey: record.TenantKey,
			Domains:        []string{"contact", "docs", "drive", "wiki"},
			IdempotencyKey: "attempt-should-not-start",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != requesterAuthReady ||
		refreshed.AccessExpiresAt == nil ||
		!refreshed.AccessExpiresAt.Equal(now.Add(24*time.Hour)) {
		t.Fatalf("existing grant was not refreshed: %+v", refreshed)
	}
	if runner.countCommand("auth", "login", "--domain") != 0 {
		t.Fatal("a fresh device flow was started for a refreshable authorization")
	}
}

func TestReadyAuthorizationRefreshLoopExpiresGrantAndBindingTogether(t *testing.T) {
	fixture := newRequesterAuthorizationFixture(t, &fakeRequesterCLIRunner{
		handler: func(
			_ context.Context,
			_ string,
			invocation CLIInvocation,
		) ([]byte, []byte, error) {
			return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
		},
	})
	expired := fixture.now.Add(-time.Minute)
	record := persistence.ChannelRequesterAuthorization{
		ID: "authorization-expired-refresh-grant", ActorPTID: "ptid:person:owner",
		BindingID: fixture.binding.ID, ProviderUserID: "ou_requester",
		TenantKey: "tenant-a", Region: "lark", Status: requesterAuthReady,
		RequestedScope: "contact,docs,drive,wiki",
		AttemptKey:     "attempt-expired-refresh-grant", Revision: 4,
		ExpiresAt: &expired, CreatedAt: fixture.now, UpdatedAt: fixture.now,
	}
	if err := fixture.db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&persistence.ChannelBinding{}).
		Where("id = ?", fixture.binding.ID).
		Updates(map[string]any{
			"owner_provider_user_id":       "ou_requester",
			"personal_oauth_connection_id": record.ID,
			"personal_oauth_status":        requesterAuthReady,
		}).Error; err != nil {
		t.Fatal(err)
	}

	fixture.service.refreshReadyAuthorizations(context.Background())

	var stored persistence.ChannelRequesterAuthorization
	if err := fixture.db.First(&stored, "id = ?", record.ID).Error; err != nil {
		t.Fatal(err)
	}
	var binding persistence.ChannelBinding
	if err := fixture.db.First(&binding, "id = ?", fixture.binding.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != requesterAuthExpired ||
		stored.RecoveryAction != "reconnect" ||
		binding.PersonalOAuthStatus != requesterAuthExpired {
		t.Fatalf("refresh grant expiry projection is inconsistent: auth=%+v binding=%+v", stored, binding)
	}
}

func TestCancelRequesterScopeUpgradeKeepsExistingGrant(t *testing.T) {
	deviceStarted := make(chan struct{})
	var startOnce sync.Once
	var now time.Time
	runner := &fakeRequesterCLIRunner{}
	runner.handler = func(
		ctx context.Context,
		_ string,
		invocation CLIInvocation,
	) ([]byte, []byte, error) {
		switch {
		case commandContains(invocation.Args, "auth", "login", "--domain"):
			return []byte(`{"verification_url":"https://example.test/cancel","device_code":"cancel-device","expires_in":600}`), nil, nil
		case commandContains(invocation.Args, "auth", "login", "--device-code"):
			startOnce.Do(func() { close(deviceStarted) })
			<-ctx.Done()
			return nil, nil, ctx.Err()
		case commandContains(invocation.Args, "auth", "status"):
			return requesterStatusJSON(t, "ou_requester", now.Add(7*24*time.Hour)), nil, nil
		case commandContains(invocation.Args, "auth", "logout"):
			return []byte(`{"ok":true}`), nil, nil
		default:
			return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
		}
	}
	fixture := newRequesterAuthorizationFixture(t, runner)
	now = fixture.now
	expires := fixture.now.Add(7 * 24 * time.Hour)
	record := persistence.ChannelRequesterAuthorization{
		ID: "authorization-cancel-upgrade", ActorPTID: "ptid:person:owner",
		BindingID: fixture.binding.ID, ProviderUserID: "ou_requester",
		TenantKey: "tenant-a", Region: "lark", Status: requesterAuthReady,
		GrantedScopes:  "docs:document:readonly drive:drive:readonly",
		RequestedScope: "contact,docs,drive,wiki",
		AttemptKey:     "attempt-cancel-original", Revision: 2, ExpiresAt: &expires,
		CreatedAt: fixture.now, UpdatedAt: fixture.now,
		LastVerifiedAt: &fixture.now,
	}
	if err := fixture.db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&persistence.ChannelBinding{}).
		Where("id = ?", fixture.binding.ID).
		Updates(map[string]any{
			"owner_provider_user_id":       "ou_requester",
			"personal_oauth_connection_id": record.ID,
			"personal_oauth_status":        requesterAuthReady,
		}).Error; err != nil {
		t.Fatal(err)
	}
	pending, err := fixture.service.StartAuthorization(
		context.Background(),
		StartRequesterAuthorizationInput{
			ActorPTID: record.ActorPTID, BindingID: record.BindingID,
			ProviderUserID: record.ProviderUserID, TenantKey: record.TenantKey,
			Domains: []string{"calendar"}, IdempotencyKey: "attempt-cancel-upgrade",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-deviceStarted:
	case <-time.After(time.Second):
		t.Fatal("scope upgrade worker did not start")
	}
	cancelled, err := fixture.service.CancelAuthorization(
		context.Background(),
		record.ActorPTID,
		record.BindingID,
		record.ID,
		pending.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != requesterAuthReady ||
		cancelled.ExpiresAt == nil ||
		!cancelled.ExpiresAt.Equal(expires) ||
		len(cancelled.PendingDomains) != 0 ||
		!slicesContain(cancelled.RequestedDomains, "docs") {
		t.Fatalf("cancelled scope upgrade lost the effective grant: %+v", cancelled)
	}
	if runner.countCommand("auth", "logout") != 0 {
		t.Fatal("cancelling an additive scope upgrade logged out the existing grant")
	}
}

func TestRequesterAuthorizationRefreshAndRevoke(t *testing.T) {
	var now time.Time
	runner := &fakeRequesterCLIRunner{}
	runner.handler = func(
		_ context.Context,
		_ string,
		invocation CLIInvocation,
	) ([]byte, []byte, error) {
		switch {
		case commandContains(invocation.Args, "auth", "status"):
			return requesterStatusJSON(t, "ou_requester", now.Add(14*24*time.Hour)), nil, nil
		case commandContains(invocation.Args, "auth", "logout"):
			return []byte(`{"ok":true,"loggedOut":true}`), nil, nil
		default:
			return nil, nil, fmt.Errorf("unexpected invocation: %v", invocation.Args)
		}
	}
	fixture := newRequesterAuthorizationFixture(t, runner)
	now = fixture.now
	expires := now.Add(7 * 24 * time.Hour)
	record := persistence.ChannelRequesterAuthorization{
		ID: "authorization-refresh", ActorPTID: "ptid:person:owner",
		BindingID: fixture.binding.ID, ProviderUserID: "ou_requester",
		TenantKey: "tenant-a", Region: "lark", Status: requesterAuthReady,
		AttemptKey: "attempt-refresh", Revision: 3, ExpiresAt: &expires,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := fixture.db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&persistence.ChannelBinding{}).
		Where("id = ?", fixture.binding.ID).
		Updates(map[string]any{
			"owner_provider_user_id":       "ou_requester",
			"personal_oauth_connection_id": record.ID,
			"personal_oauth_status":        requesterAuthReady,
		}).Error; err != nil {
		t.Fatal(err)
	}

	refreshed, err := fixture.service.RefreshAuthorization(
		context.Background(),
		record.ActorPTID,
		record.BindingID,
		record.ID,
		record.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	wantExpiry := now.Add(14 * 24 * time.Hour)
	if refreshed.ExpiresAt == nil || !refreshed.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("refreshed expiry = %v, want %v", refreshed.ExpiresAt, wantExpiry)
	}
	revoked, err := fixture.service.RevokeAuthorization(
		context.Background(),
		record.ActorPTID,
		record.BindingID,
		record.ID,
		refreshed.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if revoked.Status != requesterAuthRevoked {
		t.Fatalf("revoke status = %q", revoked.Status)
	}
	var binding persistence.ChannelBinding
	if err := fixture.db.First(&binding, "id = ?", fixture.binding.ID).Error; err != nil {
		t.Fatal(err)
	}
	if binding.PersonalOAuthConnectionID != "" ||
		binding.PersonalOAuthStatus != requesterAuthDisconnected {
		t.Fatalf("binding revoke projection not cleared: %+v", binding)
	}
}

func TestManagedLarkCLIRunnerRejectsStorageOverridingWrapper(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lark-cli")
	if err := os.WriteFile(
		path,
		[]byte("#!/bin/sh\nexport LARKSUITE_CLI_CONFIG_DIR=/shared\nexec true\n"),
		0o700,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := validateManagedLarkCLIExecutable(path); err == nil {
		t.Fatal("storage-overriding wrapper was accepted")
	}
}

func TestManagedLarkCLIRunnerIsolatesConfigDataAndInheritedIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lark-cli")
	script := `#!/bin/sh
printf '%s\n%s\n%s\n%s\n' \
  "$LARKSUITE_CLI_CONFIG_DIR" \
  "$LARKSUITE_CLI_DATA_DIR" \
  "${LARKSUITE_CLI_USER_ACCESS_TOKEN-}" \
  "${OTHER_LARK_PROFILE-}"
`
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LARKSUITE_CLI_USER_ACCESS_TOKEN", "must-not-leak")
	t.Setenv("OTHER_LARK_PROFILE", "must-not-leak")
	runner := &managedLarkCLIRunner{executable: path}
	configDir := filepath.Join(t.TempDir(), "authorization")
	stdout, stderr, err := runner.Run(
		context.Background(),
		configDir,
		CLIInvocation{Args: []string{"auth", "status"}},
	)
	if err != nil {
		t.Fatalf("run: %v, stderr=%s", err, stderr)
	}
	lines := strings.Split(strings.TrimSpace(string(stdout)), "\n")
	if len(lines) != 2 ||
		lines[0] != configDir ||
		lines[1] != filepath.Join(configDir, "data") {
		t.Fatalf("unexpected managed environment: %q", stdout)
	}
}

func TestManagedLarkCLIEnvironment(t *testing.T) {
	tests := []struct {
		name    string
		current []string
		want    string
	}{
		{"empty", nil, ""},
		{"identity isolation", []string{
			"OTHER_LARK_PROFILE=foreign-profile",
			"LARKSUITE_CLI_PROFILE=foreign-profile",
			"LARKSUITE_CLI_USER_ACCESS_TOKEN=foreign-token",
			"PT_LARK_PROFILE=foreign-profile",
		}, ""},
		{"ordinary values and malformed entries", []string{
			"PATH=/usr/bin",
			"LANG=en_US.UTF-8",
			"NO_EQUALS",
			"PT_LARK_PROFILE_DESCRIPTION=ordinary",
			"VALUE=with=equals",
		}, "PATH=/usr/bin\nLANG=en_US.UTF-8\nPT_LARK_PROFILE_DESCRIPTION=ordinary\nVALUE=with=equals"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := strings.Join(managedLarkCLIEnvironment(test.current), "\n")
			if got != test.want {
				t.Fatalf("managed environment = %q, want %q", got, test.want)
			}
		})
	}
}
