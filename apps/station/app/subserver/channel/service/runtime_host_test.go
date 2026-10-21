package service_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protojson"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginpkg"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginruntime"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
)

type staticKEK struct{}

func (staticKEK) KEK() ([]byte, string, error) {
	return []byte("0123456789abcdef0123456789abcdef"), "test-v1", nil
}

type fakeAdmitter struct {
	events chan *model.NormalizedInboundEvent
}

func (f *fakeAdmitter) AdmitInbound(
	_ context.Context,
	_ string,
	ev *model.NormalizedInboundEvent,
) (*model.InboundAck, error) {
	select {
	case f.events <- ev:
	default:
	}
	return &model.InboundAck{
		State: model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED,
	}, nil
}

func (f *fakeAdmitter) HandleCardAction(
	_ context.Context,
	_ string,
	_ *model.CardActionEvent,
) (*model.CardActionAck, error) {
	return &model.CardActionAck{Ok: true}, nil
}

func newRuntimeHostFixture(t *testing.T) (*channelsvc.Catalog, *channelsvc.BindingService, *channelsvc.RuntimeHost) {
	t.Helper()
	db := openDB(t)
	installer, err := pluginpkg.NewInstaller(t.TempDir() + "/installed")
	if err != nil {
		t.Fatal(err)
	}
	catalog := channelsvc.NewCatalog(db, installer)
	secrets := secret.NewService(db, staticKEK{})
	bindings := channelsvc.NewBindingService(db, secrets)
	host := channelsvc.NewRuntimeHost(db, catalog, bindings, secrets)
	host.SetRestartConfig(channelsvc.RestartConfig{
		InitialDelay: 20 * time.Millisecond,
		MaxDelay:     100 * time.Millisecond,
		MaxAttempts:  5,
	})
	host.SetAdmitter(&fakeAdmitter{events: make(chan *model.NormalizedInboundEvent, 4)})
	return catalog, bindings, host
}

func importEnabledEcho(t *testing.T, catalog *channelsvc.Catalog) {
	t.Helper()
	if _, err := catalog.ImportFromDirectory(context.Background(), buildEchoPackage(t)); err != nil {
		t.Fatalf("import: %v", err)
	}
}

func createTestBinding(t *testing.T, bindings *channelsvc.BindingService) channelsvc.BindingView {
	t.Helper()
	view, err := bindings.Create(context.Background(), channelsvc.CreateBindingInput{
		ActorPTID:     "ptid-1",
		PluginID:      "echo",
		ProviderKind:  "lark",
		ProviderAppID: "cli_test",
		AgentID:       "agent-1",
		Enabled:       true,
		AppSecret:     "secret-value",
	})
	if err != nil {
		t.Fatalf("create binding: %v", err)
	}
	return view
}

func TestBindingLifecycleAndCredentialProxy(t *testing.T) {
	catalog, bindings, host := newRuntimeHostFixture(t)
	importEnabledEcho(t, catalog)
	binding := createTestBinding(t, bindings)
	ctx := context.Background()

	if err := host.StartBinding(ctx, binding.ID); err != nil {
		t.Fatalf("StartBinding: %v", err)
	}
	state := catalog.RunningStateForTest("echo")
	if state == nil {
		t.Fatal("plugin process not running")
	}

	if !bindingActive(t, state, binding.ID) {
		t.Fatal("binding not active after StartBinding")
	}

	raw, err := state.Call(ctx, "test.getCredential", &model.CredentialRequest{
		BindingId: binding.ID,
		Usage:     "ws",
	})
	if err != nil {
		t.Fatalf("getCredential: %v", err)
	}
	var creds model.CredentialResponse
	if err := protojson.Unmarshal(raw, &creds); err != nil {
		t.Fatalf("decode credential: %v", err)
	}
	if creds.GetAppId() != "cli_test" || creds.GetAppSecret() != "secret-value" {
		t.Fatalf("unexpected credential: app_id=%q secret=%q", creds.GetAppId(), creds.GetAppSecret())
	}

	if _, err := state.Call(ctx, "test.getCredential", map[string]any{
		"binding_id": binding.ID,
		"usage":      "bogus",
	}); err == nil {
		t.Fatal("expected invalid usage error")
	}

	report := &model.ConnectionStatusReport{
		BindingId: binding.ID,
		State:     model.ConnectionState_CONNECTION_STATE_CONNECTED,
	}
	if _, err := state.Call(ctx, "test.reportStatus", report); err != nil {
		t.Fatalf("connectionStatus: %v", err)
	}
	view, err := bindings.Get(ctx, "ptid-1", binding.ID)
	if err != nil {
		t.Fatalf("get binding: %v", err)
	}
	if view.ConnectionState != channelsvc.BindingStateConnected {
		t.Fatalf("connection state = %q, want connected", view.ConnectionState)
	}

	if err := host.StopBinding(ctx, binding.ID); err != nil {
		t.Fatalf("StopBinding: %v", err)
	}
	if bindingActive(t, state, binding.ID) {
		t.Fatal("binding still active after StopBinding")
	}
}

func TestBindingCRUDValidation(t *testing.T) {
	_, bindings, _ := newRuntimeHostFixture(t)
	ctx := context.Background()

	if _, err := bindings.Create(ctx, channelsvc.CreateBindingInput{
		ActorPTID: "ptid-1", PluginID: "echo", ProviderKind: "lark",
		ProviderAppID: "cli_test",
	}); err == nil {
		t.Fatal("expected missing secret validation error")
	}

	view := createTestBinding(t, bindings)
	agent2 := "agent-2"
	updated, rotated, err := bindings.Update(ctx, "ptid-1", view.ID, channelsvc.UpdateInput{
		AgentID: &agent2,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if rotated || updated.AgentID != "agent-2" {
		t.Fatalf("unexpected update result rotated=%v agent=%s", rotated, updated.AgentID)
	}

	if _, err := bindings.Create(ctx, channelsvc.CreateBindingInput{
		ActorPTID: "ptid-1", PluginID: "echo", ProviderKind: "lark",
		ProviderAppID: "cli_test", AppSecret: "x",
	}); err == nil {
		t.Fatal("expected duplicate identity rejection")
	}

	if err := bindings.Delete(ctx, "ptid-1", view.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := bindings.Get(ctx, "ptid-1", view.ID); err == nil {
		t.Fatal("binding should be gone after delete")
	}
}

func TestCrashRestartReplaysBindings(t *testing.T) {
	catalog, bindings, host := newRuntimeHostFixture(t)
	importEnabledEcho(t, catalog)
	binding := createTestBinding(t, bindings)
	ctx := context.Background()
	if err := host.StartBinding(ctx, binding.ID); err != nil {
		t.Fatalf("StartBinding: %v", err)
	}
	old := catalog.RunningStateForTest("echo")
	if err := old.KillProcessGroupForTest(); err != nil {
		t.Fatalf("kill: %v", err)
	}
	<-old.Exited()

	deadline := time.Now().Add(10 * time.Second)
	replayed := false
	for time.Now().Before(deadline) {
		newState := catalog.RunningStateForTest("echo")
		if newState != nil && newState != old {
			if bindingActive(t, newState, binding.ID) {
				replayed = true
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !replayed {
		t.Fatal("plugin did not restart and replay binding within deadline")
	}
}

func TestReconcileAllReplaysEnabledBindings(t *testing.T) {
	catalog, bindings, host := newRuntimeHostFixture(t)
	importEnabledEcho(t, catalog)
	binding := createTestBinding(t, bindings)

	// Reconcile starts previously-enabled plugins; new imports are disabled
	// until management enables them (StartBinding does it on first use).
	if _, err := catalog.Enable(context.Background(), "echo"); err != nil {
		t.Fatalf("enable echo: %v", err)
	}
	if failures := host.ReconcileAll(context.Background()); len(failures) != 0 {
		t.Fatalf("ReconcileAll failures: %v", failures)
	}
	state := catalog.RunningStateForTest("echo")
	if state == nil {
		t.Fatal("plugin not started by reconcile")
	}
	if !bindingActive(t, state, binding.ID) {
		t.Fatal("binding not replayed by reconcile")
	}
}

func bindingActive(t *testing.T, state *pluginruntime.State, bindingID string) bool {
	t.Helper()
	raw, err := state.Call(context.Background(), "test.bindingActive",
		map[string]any{"binding_id": bindingID})
	if err != nil {
		return false
	}
	var resp struct {
		Active bool `json:"active"`
	}
	return json.Unmarshal(raw, &resp) == nil && resp.Active
}
