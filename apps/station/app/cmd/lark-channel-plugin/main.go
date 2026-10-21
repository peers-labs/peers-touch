// Command lark-channel-plugin is the packaged Lark channel plugin. It speaks
// the bidirectional channel JSON-RPC contract on stdio and owns the Lark
// long-connection generations per binding. Credentials never touch disk in
// the plugin: they are fetched on demand from the host vault proxy.
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

	"google.golang.org/protobuf/encoding/protojson"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginlark"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginrpc"
)

func main() {
	peer := pluginrpc.NewPeer(os.Stdin, os.Stdout, 8)
	rt := pluginlark.NewRuntime(
		func(ctx context.Context, bindingID, usage string) (string, string, error) {
			raw, err := peer.Call(ctx, pluginrpc.MethodGetCredential, &model.CredentialRequest{
				BindingId: bindingID,
				Usage:     usage,
			})
			if err != nil {
				return "", "", err
			}
			var resp model.CredentialResponse
			if err := protojson.Unmarshal(raw, &resp); err != nil {
				return "", "", err
			}
			return resp.GetAppId(), resp.GetAppSecret(), nil
		},
		func(ctx context.Context, event *model.NormalizedInboundEvent) (*model.InboundAck, error) {
			raw, err := peer.Call(ctx, pluginrpc.MethodInboundEvent, event)
			if err != nil {
				return nil, err
			}
			var ack model.InboundAck
			if err := protojson.Unmarshal(raw, &ack); err != nil {
				return nil, err
			}
			return &ack, nil
		},
		func(ctx context.Context, bindingID, state, reason string) error {
			report := &model.ConnectionStatusReport{
				BindingId: bindingID,
				Reason:    reason,
			}
			switch state {
			case "connecting":
				report.State = model.ConnectionState_CONNECTION_STATE_CONNECTING
			case "connected":
				report.State = model.ConnectionState_CONNECTION_STATE_CONNECTED
			case "reconnecting":
				report.State = model.ConnectionState_CONNECTION_STATE_RECONNECTING
			case "unauthorized":
				report.State = model.ConnectionState_CONNECTION_STATE_UNAUTHORIZED
			case "failed":
				report.State = model.ConnectionState_CONNECTION_STATE_FAILED
			default:
				report.State = model.ConnectionState_CONNECTION_STATE_STOPPED
			}
			_, err := peer.Call(ctx, pluginrpc.MethodConnectionStatus, report)
			return err
		},
	)
	rt.SetIdentityReporter(func(ctx context.Context, bindingID, botOpenID, tenantKey string) error {
		_, err := peer.Call(ctx, pluginrpc.MethodConnectionStatus, &model.ConnectionStatusReport{
			BindingId: bindingID, BotOpenId: botOpenID, TenantKey: tenantKey,
		})
		return err
	})
	rt.SetCardActionCaller(func(ctx context.Context, action *model.CardActionEvent) (*model.CardActionAck, error) {
		raw, err := peer.Call(ctx, pluginrpc.MethodCardAction, action)
		if err != nil {
			return nil, err
		}
		var ack model.CardActionAck
		if err := protojson.Unmarshal(raw, &ack); err != nil {
			return nil, err
		}
		return &ack, nil
	})

	peer.Handle("initialize", func(_ context.Context, params json.RawMessage) (any, error) {
		var request pluginrpc.InitializeParams
		if err := json.Unmarshal(params, &request); err != nil {
			return nil, &pluginrpc.RPCError{
				Code: pluginrpc.CodeInvalidParams, Message: err.Error(),
			}
		}
		protocol := min(request.ProtocolMax, 3)
		if protocol < max(request.ProtocolMin, 1) {
			return nil, &pluginrpc.RPCError{
				Code:    pluginrpc.CodeInvalidRequest,
				Message: "channel plugin protocol ranges do not overlap",
			}
		}
		return pluginrpc.InitializeResult{
			Protocol: protocol,
			Name:     "lark-channel-plugin",
			Version:  "0.1.0",
			Provider: "lark",
			Capabilities: []string{
				"messaging.receive",
				"messaging.send",
				"messaging.longconn",
				"messaging.rich-content",
				"messaging.resources",
				"messaging.cards",
				"messaging.groups",
			},
		}, nil
	})
	peer.Handle("health", func(_ context.Context, _ json.RawMessage) (any, error) {
		return pluginrpc.HealthResult{OK: true}, nil
	})
	peer.Handle(pluginrpc.MethodBindingStart, func(ctx context.Context, params json.RawMessage) (any, error) {
		var req model.BindingStartRequest
		if err := protojson.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		return rt.StartBinding(ctx, &req)
	})
	peer.Handle(pluginrpc.MethodBindingStop, func(ctx context.Context, params json.RawMessage) (any, error) {
		var req model.BindingStopRequest
		if err := protojson.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		return rt.StopBinding(ctx, &req)
	})
	peer.Handle(pluginrpc.MethodDeliver, func(ctx context.Context, params json.RawMessage) (any, error) {
		var req model.DeliveryRequest
		if err := protojson.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		return rt.Deliver(ctx, &req)
	})
	peer.Handle(pluginrpc.MethodResourceFetch, func(ctx context.Context, params json.RawMessage) (any, error) {
		var req model.ResourceFetchRequest
		if err := protojson.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		return rt.FetchResource(ctx, &req)
	})
	peer.Handle(pluginrpc.MethodResourceUpload, func(ctx context.Context, params json.RawMessage) (any, error) {
		var req model.ResourceUploadRequest
		if err := protojson.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		return rt.UploadResource(ctx, &req)
	})
	peer.Handle(pluginrpc.MethodAutomationSync, func(ctx context.Context, params json.RawMessage) (any, error) {
		var req model.SyncAutomationTriggerRequest
		if err := protojson.Unmarshal(params, &req); err != nil {
			return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
		}
		return rt.SyncAutomationTrigger(ctx, &req)
	})
	peer.Handle("shutdown", func(_ context.Context, _ json.RawMessage) (any, error) {
		go func() {
			time.Sleep(100 * time.Millisecond)
			os.Exit(0)
		}()
		return map[string]any{"ok": true}, nil
	})

	if err := peer.Serve(context.Background()); err != nil {
		log.Printf("lark plugin exited: %v", err)
	}
}
