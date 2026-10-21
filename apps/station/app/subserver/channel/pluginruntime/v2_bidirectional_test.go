package pluginruntime_test

// Protocol v2 bidirectional contract tests using the real echo subprocess:
// plugin-initiated inbound events with host-side idempotent admission,
// retry classification and host->plugin binding/delivery calls.

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginrpc"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginruntime"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/service/ingress"
	"google.golang.org/protobuf/encoding/protojson"
)

type testInboundHost struct {
	mu        sync.Mutex
	processed []string
	failNext  bool
	pipeline  ingress.Handler
}

func newTestInboundHost() *testInboundHost {
	h := &testInboundHost{}
	h.pipeline = ingress.HostPipeline(func(ctx context.Context, ev *model.NormalizedInboundEvent) (string, error) {
		h.mu.Lock()
		fail := h.failNext
		h.failNext = false
		h.processed = append(h.processed, ev.GetEventId())
		h.mu.Unlock()
		if fail {
			return "", errors.New("simulated pre-admission failure")
		}
		// Durable admission happens at turn submission; mark immediately to
		// unblock transport acknowledgement.
		ingress.MarkMessageAccepted(ctx)
		return "", nil
	})
	return h
}

func (h *testInboundHost) handler(_ context.Context, params json.RawMessage) (any, error) {
	var ev model.NormalizedInboundEvent
	if err := protojson.Unmarshal(params, &ev); err != nil {
		// Echo forwards snake_case JSON; protojson accepts proto field names.
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
	}
	var duplicate bool
	ctx := ingress.WithRuntimeCallbacks(context.Background(), ingress.RuntimeCallbacks{
		MarkAccepted:  func() {},
		MarkDuplicate: func() { duplicate = true },
	})
	_, err := h.pipeline(ctx, &ev)
	ack := &model.InboundAck{}
	switch {
	case err == nil:
		if duplicate {
			ack.State = model.InboundAckState_INBOUND_ACK_STATE_DUPLICATE
		} else {
			ack.State = model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED
		}
	case errors.Is(err, ingress.ErrRetryOnly):
		ack.State = model.InboundAckState_INBOUND_ACK_STATE_RETRY
		ack.ErrorCode = "retry_only"
	default:
		// Pre-admission failure: the plugin must fail the platform callback so
		// it redelivers.
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: err.Error()}
	}
	raw, mErr := protojson.Marshal(ack)
	if mErr != nil {
		return nil, mErr
	}
	return json.RawMessage(raw), nil
}

func startV2Plugin(t *testing.T, host *testInboundHost) *pluginruntime.State {
	t.Helper()
	state, err := pluginruntime.Start(context.Background(), pluginruntime.ProcessConfig{
		ExecPath:         buildEchoPlugin(t),
		HandshakeTimeout: 5 * time.Second,
		StopGrace:        2 * time.Second,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if info := state.Info(); info.Protocol != 2 {
		t.Fatalf("want protocol 2, got %+v", info)
	}
	state.OnMethod(pluginrpc.MethodInboundEvent, host.handler)
	return state
}

func emitEvent(t *testing.T, state *pluginruntime.State, eventID, messageID string) model.InboundAckState {
	t.Helper()
	// snake_case keys are the on-wire proto field names accepted by protojson.
	params := map[string]any{
		"binding_id":    "binding-1",
		"provider_kind": "lark",
		"event_id":      eventID,
		"message_id":    messageID,
		"chat_id":       "oc_test",
		"chat_type":     "private",
		"sender_id":     "ou_sender",
		"text":          "ping",
	}
	raw, err := state.Call(context.Background(), pluginrpc.MethodTestEmitEvent, params)
	if err != nil {
		var rpcErr *pluginrpc.RPCError
		if errors.As(err, &rpcErr) {
			if rpcErr.Code == pluginrpc.CodeRetryableDelivery {
				return model.InboundAckState_INBOUND_ACK_STATE_RETRY
			}
		}
		t.Fatalf("emitEvent %s: %v", eventID, err)
	}
	var ack model.InboundAck
	if err := protojson.Unmarshal(raw, &ack); err != nil {
		t.Fatalf("decode ack: %v (%s)", err, raw)
	}
	return ack.GetState()
}

func TestV2InboundAcceptedThenDuplicate(t *testing.T) {
	host := newTestInboundHost()
	state := startV2Plugin(t, host)
	defer func() { _ = state.Stop() }()

	if got := emitEvent(t, state, "evt-1", "om-1"); got != model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED {
		t.Fatalf("first delivery: want ACCEPTED, got %v", got)
	}
	if got := emitEvent(t, state, "evt-1", "om-1"); got != model.InboundAckState_INBOUND_ACK_STATE_DUPLICATE {
		t.Fatalf("replayed event: want DUPLICATE, got %v", got)
	}
	// Same platform message, different event id (P1/P2 dual delivery).
	if got := emitEvent(t, state, "evt-1-alt", "om-1"); got != model.InboundAckState_INBOUND_ACK_STATE_DUPLICATE {
		t.Fatalf("dual-version delivery: want DUPLICATE, got %v", got)
	}

	host.mu.Lock()
	defer host.mu.Unlock()
	if len(host.processed) != 1 || host.processed[0] != "evt-1" {
		t.Fatalf("downstream ran %v, want exactly evt-1 once", host.processed)
	}
}

func TestV2InboundRetryBeforeAdmission(t *testing.T) {
	host := newTestInboundHost()
	host.failNext = true
	state := startV2Plugin(t, host)
	defer func() { _ = state.Stop() }()

	if got := emitEvent(t, state, "evt-2", "om-2"); got != model.InboundAckState_INBOUND_ACK_STATE_RETRY {
		t.Fatalf("failed admission: want RETRY, got %v", got)
	}
	// Platform redelivery runs as a fresh leader once the failed entry is gone.
	if got := emitEvent(t, state, "evt-2", "om-2"); got != model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED {
		t.Fatalf("redelivery: want ACCEPTED, got %v", got)
	}
}

func TestV2BindingAndDeliveryCalls(t *testing.T) {
	host := newTestInboundHost()
	state := startV2Plugin(t, host)
	defer func() { _ = state.Stop() }()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if _, err := state.Call(ctx, pluginrpc.MethodBindingStart, map[string]any{
		"binding_id":      "binding-1",
		"provider_kind":   "lark",
		"provider_app_id": "cli_test",
	}); err != nil {
		t.Fatalf("bindingStart: %v", err)
	}
	if _, err := state.Call(ctx, pluginrpc.MethodBindingStop, map[string]any{
		"binding_id": "binding-1",
	}); err != nil {
		t.Fatalf("bindingStop: %v", err)
	}

	// Same delivery id must always yield the same platform message id.
	for i := 0; i < 2; i++ {
		raw, err := state.Call(ctx, pluginrpc.MethodDeliver, map[string]any{
			"delivery_id":    "del-1",
			"binding_id":     "binding-1",
			"target_chat_id": "oc_test",
			"text":           "pong",
		})
		if err != nil {
			t.Fatalf("deliver: %v", err)
		}
		var receipt model.DeliveryReceipt
		if err := protojson.Unmarshal(raw, &receipt); err != nil {
			t.Fatalf("decode receipt: %v (%s)", err, raw)
		}
		if !receipt.GetOk() || receipt.GetProviderMessageId() != "echo-del-1" {
			t.Fatalf("unexpected receipt: ok=%v message_id=%q", receipt.GetOk(), receipt.GetProviderMessageId())
		}
	}
}
