// Command echo-plugin is a minimal channel plugin used by plugin runtime
// tests. It speaks newline-delimited JSON-RPC 2.0 on stdio using the shared
// pluginrpc endpoint:
//   - initialize -> identity + protocol 2 + messaging capabilities
//   - health     -> {ok:true}
//   - bindingStart/bindingStop -> tracks active bindings in memory
//   - deliver    -> deterministic receipt (provider message id from delivery id)
//   - test.emitEvent -> forwards an inbound event to the host and returns its ack
//   - shutdown   -> clean exit
//
// The test.emitEvent method is a test harness hook; production plugins must
// never implement it.
package main

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginrpc"
)

func main() {
	var mu sync.Mutex
	bindings := map[string]bool{}

	peer := pluginrpc.NewPeer(os.Stdin, os.Stdout, 4)

	peer.Handle("initialize", func(_ context.Context, _ json.RawMessage) (any, error) {
		return pluginrpc.InitializeResult{
			Protocol: 2,
			Name:     "echo-plugin",
			Version:  "0.2.0",
			Provider: "echo",
			Capabilities: []string{
				"messaging.receive",
				"messaging.send",
				"messaging.longconn",
			},
		}, nil
	})
	peer.Handle("health", func(_ context.Context, _ json.RawMessage) (any, error) {
		return pluginrpc.HealthResult{OK: true}, nil
	})
	peer.Handle("bindingStart", func(_ context.Context, params json.RawMessage) (any, error) {
		var req struct {
			BindingID string `json:"binding_id"`
		}
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		mu.Lock()
		bindings[req.BindingID] = true
		mu.Unlock()
		return map[string]any{"ok": true}, nil
	})
	peer.Handle("bindingStop", func(_ context.Context, params json.RawMessage) (any, error) {
		var req struct {
			BindingID string `json:"binding_id"`
		}
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		mu.Lock()
		delete(bindings, req.BindingID)
		mu.Unlock()
		return map[string]any{"ok": true}, nil
	})
	peer.Handle("deliver", func(_ context.Context, params json.RawMessage) (any, error) {
		var req struct {
			DeliveryID string `json:"delivery_id"`
		}
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		return map[string]any{
			"delivery_id":         req.DeliveryID,
			"provider_message_id": "echo-" + req.DeliveryID,
			"ok":                  true,
		}, nil
	})
	peer.Handle("test.emitEvent", func(ctx context.Context, params json.RawMessage) (any, error) {
		var event map[string]any
		if err := json.Unmarshal(params, &event); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		// Forward the event to the host and relay its admission decision.
		raw, err := peer.Call(ctx, pluginrpc.MethodInboundEvent, event)
		if err != nil {
			return nil, err
		}
		return raw, nil
	})
	peer.Handle("test.getCredential", func(ctx context.Context, params json.RawMessage) (any, error) {
		raw, err := peer.Call(ctx, pluginrpc.MethodGetCredential, params)
		if err != nil {
			return nil, err
		}
		return raw, nil
	})
	peer.Handle("test.reportStatus", func(ctx context.Context, params json.RawMessage) (any, error) {
		raw, err := peer.Call(ctx, pluginrpc.MethodConnectionStatus, params)
		if err != nil {
			return nil, err
		}
		return raw, nil
	})
	peer.Handle("test.bindingActive", func(_ context.Context, params json.RawMessage) (any, error) {
		var req struct {
			BindingID string `json:"binding_id"`
		}
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		mu.Lock()
		active := bindings[req.BindingID]
		mu.Unlock()
		return map[string]any{"active": active}, nil
	})
	peer.Handle("shutdown", func(_ context.Context, _ json.RawMessage) (any, error) {
		// Exit after the response frame has been written.
		go func() {
			time.Sleep(100 * time.Millisecond)
			os.Exit(0)
		}()
		return map[string]any{"ok": true}, nil
	})

	_ = peer.Serve(context.Background())
}
