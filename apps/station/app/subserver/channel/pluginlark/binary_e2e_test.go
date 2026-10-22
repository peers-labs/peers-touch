package pluginlark_test

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protojson"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginrpc"
)

func buildLarkPlugin(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("subprocess plugin tests unix-only")
	}
	_, thisFile, _, _ := runtime.Caller(0)
	// .../app/subserver/channel/pluginlark -> ../../../cmd/lark-channel-plugin
	cmdDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "cmd", "lark-channel-plugin")
	out := filepath.Join(t.TempDir(), "lark-plugin")
	cmd := exec.Command("go", "build", "-o", out, ".")
	cmd.Dir = cmdDir
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build lark plugin: %v\n%s", err, b)
	}
	return out
}

type hostHarness struct {
	peer      *pluginrpc.Peer
	states    []string
	events    []*model.NormalizedInboundEvent
	mu        sync.Mutex
	connected chan struct{}
}

func TestLarkPluginBinaryEndToEnd(t *testing.T) {
	frame := eventFrame(t, []byte(p2pTextEventJSON))
	srv := newFakeLarkServer(t, frame)

	bin := buildLarkPlugin(t)
	child := exec.Command(bin)
	stdinR, stdinW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	stdoutR, stdoutW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	child.Stdin = stdinR
	child.Stdout = stdoutW
	child.Stderr = io.Discard
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = child.Process.Kill()
		_, _ = child.Process.Wait()
		_ = stdinR.Close()
		_ = stdinW.Close()
		_ = stdoutR.Close()
		_ = stdoutW.Close()
	})

	h := &hostHarness{connected: make(chan struct{}, 4)}
	peer := pluginrpc.NewPeer(stdoutR, stdinW, 8)
	h.peer = peer
	peer.Handle(pluginrpc.MethodGetCredential, func(_ context.Context, _ json.RawMessage) (any, error) {
		return &model.CredentialResponse{AppId: "cli_test", AppSecret: "secret"}, nil
	})
	peer.Handle(pluginrpc.MethodInboundEvent, func(_ context.Context, params json.RawMessage) (any, error) {
		var ev model.NormalizedInboundEvent
		if err := protojson.Unmarshal(params, &ev); err != nil {
			return nil, err
		}
		h.mu.Lock()
		h.events = append(h.events, &ev)
		h.mu.Unlock()
		return &model.InboundAck{State: model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED}, nil
	})
	peer.Handle(pluginrpc.MethodConnectionStatus, func(_ context.Context, params json.RawMessage) (any, error) {
		var report model.ConnectionStatusReport
		if err := protojson.Unmarshal(params, &report); err != nil {
			return nil, err
		}
		state := report.GetState().String()
		h.mu.Lock()
		h.states = append(h.states, state)
		h.mu.Unlock()
		if report.GetState() == model.ConnectionState_CONNECTION_STATE_CONNECTED {
			select {
			case h.connected <- struct{}{}:
			default:
			}
		}
		return &model.ConnectionStatusAck{Ok: true}, nil
	})
	serveDone := make(chan struct{})
	go func() { _ = peer.Serve(context.Background()); close(serveDone) }()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	raw, err := peer.Call(ctx, "initialize", &pluginrpc.InitializeParams{
		ProtocolMin: 1, ProtocolMax: 2, HostName: "test-host",
	})
	if err != nil {
		t.Fatalf("initialize: %v", err)
	}
	var info pluginrpc.InitializeResult
	if err := json.Unmarshal(raw, &info); err != nil {
		t.Fatal(err)
	}
	if info.Protocol != 2 || info.Provider != "lark" {
		t.Fatalf("bad handshake: %+v", info)
	}

	if _, err := peer.Call(ctx, pluginrpc.MethodBindingStart, &model.BindingStartRequest{
		BindingId:     "binding-1",
		ProviderKind:  "lark",
		ProviderAppId: "cli_test",
		Domain:        srv.baseURL(),
	}); err != nil {
		t.Fatalf("bindingStart: %v", err)
	}

	select {
	case <-h.connected:
	case <-ctx.Done():
		t.Fatal("plugin never reported connected")
	}

	waitFor(t, 5*time.Second, func() bool {
		h.mu.Lock()
		defer h.mu.Unlock()
		return len(h.events) == 1
	})
	h.mu.Lock()
	ev := h.events[0]
	h.mu.Unlock()
	if ev.GetEventId() != "evt-1" || ev.GetText() != "hello world" || ev.GetChatType() != "private" {
		t.Fatalf("normalized event mismatch: %+v", ev)
	}
	// The plugin acked the frame 200 after host acceptance.
	waitFor(t, 3*time.Second, func() bool {
		_, _, replies, _ := srv.snapshot()
		return len(replies) >= 1
	})

	if _, err := peer.Call(ctx, pluginrpc.MethodDeliver, &model.DeliveryRequest{
		DeliveryId:     "del-1",
		BindingId:      "binding-1",
		TargetChatId:   "oc_1",
		Text:           "pong",
		IdempotencyKey: "idempotency-1",
	}); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	waitFor(t, 3*time.Second, func() bool {
		_, _, _, deliveries := srv.snapshot()
		return len(deliveries) == 1
	})
	_, _, _, deliveries := srv.snapshot()
	if deliveries[0].uuid != "idempotency-1" || deliveries[0].receiveID != "chat_id" {
		t.Fatalf("unexpected send capture: %+v", deliveries[0])
	}
	var sentContent map[string]string
	_ = json.Unmarshal([]byte(deliveries[0].body), &sentContent)
	if sentContent["text"] != "pong" {
		t.Fatalf("sent content mismatch: %q", deliveries[0].body)
	}

	if _, err := peer.Call(ctx, pluginrpc.MethodBindingStop, &model.BindingStopRequest{
		BindingId: "binding-1",
	}); err != nil {
		t.Fatalf("bindingStop: %v", err)
	}
}
