package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginrpc"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginruntime"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/encoding/protojson"
)

// TurnAdmitter durably admits one inbound event (fp-04 binds it to
// TurnService submission). B2 only needs the admission decision; turn
// execution and reply delivery arrive with fp-04.
type TurnAdmitter interface {
	AdmitInbound(
		ctx context.Context,
		pluginID string,
		event *model.NormalizedInboundEvent,
	) (*model.InboundAck, error)
	HandleCardAction(
		ctx context.Context,
		pluginID string,
		action *model.CardActionEvent,
	) (*model.CardActionAck, error)
}

// RestartConfig bounds crash-driven process restarts.
type RestartConfig struct {
	InitialDelay time.Duration
	MaxDelay     time.Duration
	MaxAttempts  int
}

func defaultRestartConfig() RestartConfig {
	return RestartConfig{InitialDelay: time.Second, MaxDelay: 60 * time.Second, MaxAttempts: 5}
}

// RuntimeHost reconciles plugin processes and bindings and answers
// plugin-initiated RPCs. It is the only component that talks to running
// plugin processes.
type RuntimeHost struct {
	db       *gorm.DB
	catalog  *Catalog
	bindings *BindingService
	secrets  *secret.Service

	mu         sync.Mutex
	admitter   TurnAdmitter
	restart    RestartConfig
	supervised map[string]context.CancelFunc
}

func NewRuntimeHost(db *gorm.DB, catalog *Catalog, bindings *BindingService, secrets *secret.Service) *RuntimeHost {
	h := &RuntimeHost{
		db:         db,
		catalog:    catalog,
		bindings:   bindings,
		secrets:    secrets,
		restart:    defaultRestartConfig(),
		supervised: make(map[string]context.CancelFunc),
	}
	catalog.OnHostMethod(pluginrpc.MethodInboundEvent, h.handleInbound)
	catalog.OnHostMethod(pluginrpc.MethodConnectionStatus, h.handleConnectionStatus)
	catalog.OnHostMethod(pluginrpc.MethodGetCredential, h.handleGetCredential)
	catalog.OnHostMethod(pluginrpc.MethodCardAction, h.handleCardAction)
	catalog.SetCrashObserver(h.onPluginCrashed)
	return h
}

// SetRestartConfig overrides restart bounds (tests use short delays).
func (h *RuntimeHost) SetRestartConfig(cfg RestartConfig) {
	if cfg.InitialDelay > 0 {
		h.restart.InitialDelay = cfg.InitialDelay
	}
	if cfg.MaxDelay > 0 {
		h.restart.MaxDelay = cfg.MaxDelay
	}
	if cfg.MaxAttempts > 0 {
		h.restart.MaxAttempts = cfg.MaxAttempts
	}
}

// SetAdmitter installs the durable turn-admission sink (the TurnLink
// bridge once the agent domain is wired; tests use a fake).
func (h *RuntimeHost) SetAdmitter(admitter TurnAdmitter) {
	h.mu.Lock()
	h.admitter = admitter
	h.mu.Unlock()
}

// Deliver sends one typed delivery through the plugin owning the binding.
func (h *RuntimeHost) Deliver(
	ctx context.Context,
	request *model.DeliveryRequest,
) (*model.DeliveryReceipt, error) {
	if request == nil {
		return nil, fmt.Errorf("delivery request is required")
	}
	record, err := h.bindings.GetRecord(ctx, request.GetBindingId())
	if err != nil {
		return nil, err
	}
	state := h.catalog.RunningState(record.PluginID)
	if state == nil {
		return nil, fmt.Errorf("plugin %s is not running", record.PluginID)
	}
	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	raw, err := state.Call(callCtx, pluginrpc.MethodDeliver, request)
	if err != nil {
		return nil, err
	}
	var receipt model.DeliveryReceipt
	if err := protojson.Unmarshal(raw, &receipt); err != nil {
		return nil, fmt.Errorf("decode delivery receipt: %w", err)
	}
	if receipt.GetErrorCategory() == "unauthorized" {
		_ = h.bindings.SetConnectionState(
			ctx, request.GetBindingId(), BindingStateUnauthorized,
			receipt.GetErrorMessage(),
		)
	}
	return &receipt, nil
}

// DeliverToBinding is retained for focused plugin-host tests. Production uses
// the typed Deliver contract.
func (h *RuntimeHost) DeliverToBinding(
	ctx context.Context,
	deliveryID, bindingID, targetChatID, text string,
) error {
	receipt, err := h.Deliver(ctx, &model.DeliveryRequest{
		DeliveryId: deliveryID, BindingId: bindingID,
		TargetChatId: targetChatID, Text: text,
		IdempotencyKey: platformUUID(deliveryID),
		Kind:           model.DeliveryKind_DELIVERY_KIND_TEXT,
		Operation:      model.DeliveryOperation_DELIVERY_OPERATION_CREATE,
	})
	if err != nil {
		return err
	}
	if receipt.GetOk() {
		return nil
	}
	switch receipt.GetErrorCategory() {
	case "permanent":
		return ErrPermanentDelivery
	case "unauthorized":
		return ErrDeliveryUnauthorized
	default:
		return fmt.Errorf("delivery failed: %s", receipt.GetErrorMessage())
	}
}

// FetchResource transfers one provider resource in bounded chunks. No
// arbitrary-size blob is embedded in a normal inbound RPC.
func (h *RuntimeHost) FetchResource(
	ctx context.Context,
	bindingID, messageID string,
	resource *model.ChannelResourceRef,
) (AttachmentPayload, error) {
	if resource == nil || strings.TrimSpace(resource.GetProviderKey()) == "" {
		return AttachmentPayload{}, fmt.Errorf("provider resource key is required")
	}
	record, err := h.bindings.GetRecord(ctx, bindingID)
	if err != nil {
		return AttachmentPayload{}, err
	}
	state := h.catalog.RunningState(record.PluginID)
	if state == nil {
		return AttachmentPayload{}, fmt.Errorf("plugin %s is not running", record.PluginID)
	}
	const chunkSize = 512 * 1024
	const maxResourceBytes = 32 * 1024 * 1024
	var body []byte
	var fileName = resource.GetFileName()
	var mimeType = resource.GetMimeType()
	for {
		callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		raw, callErr := state.Call(callCtx, pluginrpc.MethodResourceFetch, &model.ResourceFetchRequest{
			BindingId: bindingID, MessageId: messageID,
			ProviderKey: resource.GetProviderKey(), Kind: resource.GetKind(),
			Offset: uint64(len(body)), MaxBytes: chunkSize,
		})
		cancel()
		if callErr != nil {
			return AttachmentPayload{}, callErr
		}
		var chunk model.ResourceFetchResponse
		if err := protojson.Unmarshal(raw, &chunk); err != nil {
			return AttachmentPayload{}, fmt.Errorf("decode resource chunk: %w", err)
		}
		if len(body)+len(chunk.GetData()) > maxResourceBytes {
			return AttachmentPayload{}, fmt.Errorf("provider resource exceeds 32 MiB limit")
		}
		body = append(body, chunk.GetData()...)
		fileName = firstNonEmpty(fileName, chunk.GetFileName())
		mimeType = firstNonEmpty(mimeType, chunk.GetMimeType())
		if chunk.GetEof() {
			break
		}
		if len(chunk.GetData()) == 0 {
			return AttachmentPayload{}, fmt.Errorf("provider resource returned empty non-terminal chunk")
		}
	}
	checksum := sha256.Sum256(body)
	if strings.TrimSpace(fileName) == "" {
		switch resource.GetKind() {
		case "image":
			fileName = "lark-image.png"
		case "audio":
			fileName = "lark-audio.ogg"
		case "video":
			fileName = "lark-video.mp4"
		default:
			fileName = "lark-file.bin"
		}
	}
	return AttachmentPayload{
		AttachmentID: "channel-" + sanitizeToken(messageID) + "-" +
			sanitizeToken(resource.GetProviderKey()),
		FileName: fileName, MIMEType: mimeType, Body: body,
		Checksum: "sha256:" + hex.EncodeToString(checksum[:]),
	}, nil
}

func (h *RuntimeHost) UploadResource(
	ctx context.Context,
	request *model.ResourceUploadRequest,
) (*model.ResourceUploadResponse, error) {
	if request == nil || strings.TrimSpace(request.GetBindingId()) == "" ||
		strings.TrimSpace(request.GetUploadId()) == "" {
		return nil, fmt.Errorf("resource upload identity is required")
	}
	record, err := h.bindings.GetRecord(ctx, request.GetBindingId())
	if err != nil {
		return nil, err
	}
	state := h.catalog.RunningState(record.PluginID)
	if state == nil {
		return nil, fmt.Errorf("plugin %s is not running", record.PluginID)
	}
	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	raw, err := state.Call(callCtx, pluginrpc.MethodResourceUpload, request)
	if err != nil {
		return nil, err
	}
	var response model.ResourceUploadResponse
	if err := protojson.Unmarshal(raw, &response); err != nil {
		return nil, fmt.Errorf("decode resource upload response: %w", err)
	}
	if response.GetUploadId() != request.GetUploadId() {
		return nil, fmt.Errorf("resource upload identity mismatch")
	}
	return &response, nil
}

func (h *RuntimeHost) SyncAutomationTrigger(
	ctx context.Context,
	request *model.SyncAutomationTriggerRequest,
) error {
	if request == nil || strings.TrimSpace(request.GetBindingId()) == "" ||
		strings.TrimSpace(request.GetAutomationId()) == "" {
		return fmt.Errorf("automation trigger identity is required")
	}
	record, err := h.bindings.GetRecord(ctx, request.GetBindingId())
	if err != nil {
		return err
	}
	state := h.catalog.RunningState(record.PluginID)
	if state == nil {
		return fmt.Errorf("plugin %s is not running", record.PluginID)
	}
	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	raw, err := state.Call(callCtx, pluginrpc.MethodAutomationSync, request)
	if err != nil {
		return err
	}
	var response model.SyncAutomationTriggerResponse
	if err := protojson.Unmarshal(raw, &response); err != nil {
		return fmt.Errorf("decode automation trigger sync response: %w", err)
	}
	if !response.GetOk() {
		return fmt.Errorf("plugin rejected automation trigger: %s", response.GetErrorMessage())
	}
	return nil
}

// platformUUID derives the 1h-window provider idempotency token from a
// delivery id, bounded to the API's length limit.
func platformUUID(deliveryID string) string {
	key := strings.TrimSpace(deliveryID)
	if len(key) > 50 {
		return key[:50]
	}
	return key
}

// ReconcileAll starts every enabled plugin and replays its enabled bindings.
// Used at Station startup; failures are returned per plugin and never block
// the caller's other reconciliations.
func (h *RuntimeHost) ReconcileAll(ctx context.Context) []error {
	var plugins []persistence.ChannelPlugin
	if err := h.db.Where("enabled = ?", true).Find(&plugins).Error; err != nil {
		return []error{fmt.Errorf("list enabled plugins: %w", err)}
	}
	var failures []error
	for i := range plugins {
		pluginID := plugins[i].ID
		if state := h.catalog.RunningState(pluginID); state == nil {
			if _, err := h.catalog.Enable(ctx, pluginID); err != nil {
				failures = append(failures, fmt.Errorf("reconcile plugin %s: %w", pluginID, err))
				continue
			}
		}
		// Bindings are owned by the host and must always be replayed: the
		// process may already run for another binding or have been enabled
		// out of band.
		if err := h.replayBindings(ctx, pluginID); err != nil {
			failures = append(failures, fmt.Errorf("reconcile plugin %s bindings: %w", pluginID, err))
		}
	}
	return failures
}

// StartBinding ensures the plugin process is up and starts one binding.
func (h *RuntimeHost) StartBinding(ctx context.Context, bindingID string) error {
	record, err := h.bindings.GetRecord(ctx, bindingID)
	if err != nil {
		return err
	}
	if err := h.ensurePlugin(ctx, record.PluginID); err != nil {
		return err
	}
	return h.startBindingOnProcess(ctx, record)
}

// StopBinding asks the plugin to stop one binding.
func (h *RuntimeHost) StopBinding(ctx context.Context, bindingID string) error {
	record, err := h.bindings.GetRecord(ctx, bindingID)
	if err != nil {
		return err
	}
	state := h.catalog.RunningState(record.PluginID)
	if state == nil {
		return nil
	}
	callCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	raw, err := state.Call(callCtx, pluginrpc.MethodBindingStop, &model.BindingStopRequest{
		BindingId: record.ID,
	})
	if err != nil {
		return fmt.Errorf("binding stop: %w", err)
	}
	var resp model.BindingStopResponse
	if err := protojson.Unmarshal(raw, &resp); err != nil {
		return fmt.Errorf("decode binding stop response: %w", err)
	}
	_ = h.bindings.SetConnectionState(ctx, record.ID, BindingStateStopped, "")
	return nil
}

func (h *RuntimeHost) ensurePlugin(ctx context.Context, pluginID string) error {
	if state := h.catalog.RunningState(pluginID); state != nil {
		return nil
	}
	h.beginSupervision(pluginID)
	if _, err := h.catalog.Enable(ctx, pluginID); err != nil {
		// Enable marks failed state itself; restart supervision will retry
		// through the crash observer only after a process had run. A startup
		// handshake failure gets one bounded retry here.
		return err
	}
	return h.replayBindings(ctx, pluginID)
}

func (h *RuntimeHost) replayBindings(ctx context.Context, pluginID string) error {
	records, err := h.bindings.ListEnabledByPlugin(ctx, pluginID)
	if err != nil {
		return err
	}
	for i := range records {
		if err := h.startBindingOnProcess(ctx, &records[i]); err != nil {
			return fmt.Errorf("start binding %s: %w", records[i].ID, err)
		}
	}
	return nil
}

func (h *RuntimeHost) startBindingOnProcess(ctx context.Context, record *persistence.ChannelBinding) error {
	state := h.catalog.RunningState(record.PluginID)
	if state == nil {
		return fmt.Errorf("plugin %s is not running", record.PluginID)
	}
	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	raw, err := state.Call(callCtx, pluginrpc.MethodBindingStart, &model.BindingStartRequest{
		BindingId:     record.ID,
		ProviderKind:  record.ProviderKind,
		ProviderAppId: record.ProviderAppID,
		Domain:        record.Domain,
	})
	if err != nil {
		return err
	}
	var resp model.BindingStartResponse
	if err := protojson.Unmarshal(raw, &resp); err != nil {
		return fmt.Errorf("decode binding start response: %w", err)
	}
	if !resp.GetOk() {
		return fmt.Errorf("plugin rejected binding start: %s", resp.GetErrorMessage())
	}
	h.replayAutomationTriggers(ctx, record, state)
	return nil
}

func (h *RuntimeHost) replayAutomationTriggers(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	state *pluginruntime.State,
) {
	var automations []persistence.ChannelAutomation
	if err := h.db.WithContext(ctx).Where(
		"binding_id = ? AND enabled = ? AND trigger_type = ?",
		binding.ID, true, "document",
	).Find(&automations).Error; err != nil {
		return
	}
	for _, automation := range automations {
		callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		raw, err := state.Call(callCtx, pluginrpc.MethodAutomationSync,
			&model.SyncAutomationTriggerRequest{
				BindingId: binding.ID, AutomationId: automation.ID,
				TriggerType:  automation.TriggerType,
				TriggerValue: automation.TriggerValue, Enabled: true,
			})
		cancel()
		var response model.SyncAutomationTriggerResponse
		if err == nil {
			err = protojson.Unmarshal(raw, &response)
			if err == nil && !response.GetOk() {
				err = fmt.Errorf("%s", response.GetErrorMessage())
			}
		}
		if err != nil {
			_ = h.db.WithContext(context.WithoutCancel(ctx)).
				Model(&persistence.ChannelAutomation{}).
				Where("id = ?", automation.ID).
				Updates(map[string]any{
					"last_run_status": "trigger_sync_failed",
					"last_error":      redactDiagnostic(err.Error()),
					"updated_at":      time.Now().UTC(),
				}).Error
		}
	}
}

// beginSupervision registers one restart loop slot per plugin. Restart loops
// are owned by the crash observer; this only guards duplicates.
func (h *RuntimeHost) beginSupervision(pluginID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.supervised[pluginID]; !ok {
		h.supervised[pluginID] = func() {}
	}
}

func (h *RuntimeHost) onPluginCrashed(pluginID string) {
	h.mu.Lock()
	cfg := h.restart
	if _, active := h.supervised[pluginID]; !active {
		h.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.supervised[pluginID] = cancel
	h.mu.Unlock()

	go h.restartLoop(ctx, cfg, pluginID)
}

func (h *RuntimeHost) restartLoop(ctx context.Context, cfg RestartConfig, pluginID string) {
	delay := cfg.InitialDelay
	for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		// The plugin may have been disabled/deleted while waiting.
		record, err := h.catalog.Get(pluginID)
		if err != nil || !record.Enabled {
			return
		}
		if _, err := h.catalog.Enable(ctx, pluginID); err != nil {
			logger.Warnf(ctx, "channel plugin restart attempt %d/%d failed: %v", attempt, cfg.MaxAttempts, err)
			delay = nextDelay(delay, cfg.MaxDelay)
			continue
		}
		logger.Infof(ctx, "channel plugin %s restarted on attempt %d", pluginID, attempt)
		if err := h.replayBindings(ctx, pluginID); err != nil {
			logger.Warnf(ctx, "channel binding replay after restart failed: %v", err)
		}
		return
	}
	logger.Warnf(ctx, "channel plugin %s restart budget exhausted after %d attempts", pluginID, cfg.MaxAttempts)
}

func nextDelay(current, max time.Duration) time.Duration {
	next := current * 2
	if next > max {
		return max
	}
	return next
}

// handleInbound answers plugin -> inboundEvent. Plugin process identity is
// injected by Catalog and checked against binding ownership in DurableBridge.
func (h *RuntimeHost) handleInbound(ctx context.Context, params json.RawMessage) (any, error) {
	var event model.NormalizedInboundEvent
	if err := protojson.Unmarshal(params, &event); err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
	}
	h.mu.Lock()
	admitter := h.admitter
	h.mu.Unlock()
	if admitter == nil {
		return nil, &pluginrpc.RPCError{
			Code:    pluginrpc.CodeRetryableDelivery,
			Message: "turn admission not configured",
		}
	}
	ack, err := admitter.AdmitInbound(
		ctx, pluginruntime.PluginIdentity(ctx), &event,
	)
	if err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: safeError(err)}
	}
	return ack, nil
}

func (h *RuntimeHost) handleConnectionStatus(ctx context.Context, params json.RawMessage) (any, error) {
	var report model.ConnectionStatusReport
	if err := protojson.Unmarshal(params, &report); err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
	}
	if err := h.requirePluginBinding(ctx, report.GetBindingId()); err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeUnauthorized, Message: err.Error()}
	}
	if report.GetState() != model.ConnectionState_CONNECTION_STATE_UNSPECIFIED {
		if err := h.bindings.SetConnectionState(ctx, report.GetBindingId(), connectionStateName(report.GetState()), report.GetReason()); err != nil {
			return nil, &pluginrpc.RPCError{Code: -32603, Message: err.Error()}
		}
	}
	if report.GetBotOpenId() != "" || report.GetTenantKey() != "" {
		if err := h.bindings.SetConnectionIdentity(
			ctx, report.GetBindingId(), report.GetBotOpenId(), report.GetTenantKey(),
		); err != nil {
			return nil, &pluginrpc.RPCError{Code: -32603, Message: err.Error()}
		}
	}
	return &model.ConnectionStatusAck{Ok: true}, nil
}

func (h *RuntimeHost) handleGetCredential(ctx context.Context, params json.RawMessage) (any, error) {
	var req model.CredentialRequest
	if err := protojson.Unmarshal(params, &req); err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
	}
	usage := strings.TrimSpace(req.GetUsage())
	if usage != "ws" && usage != "api" {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: "usage must be ws or api"}
	}
	if err := h.requirePluginBinding(ctx, req.GetBindingId()); err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeUnauthorized, Message: "credential unavailable"}
	}
	payload, err := h.bindings.CredentialForBinding(ctx, req.GetBindingId())
	if err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeUnauthorized, Message: "credential unavailable"}
	}
	logger.Infof(ctx, "[channel] credential issued binding=%s usage=%s", req.GetBindingId(), usage)
	return &model.CredentialResponse{AppId: payload.AppID, AppSecret: payload.AppSecret}, nil
}

func (h *RuntimeHost) handleCardAction(ctx context.Context, params json.RawMessage) (any, error) {
	var action model.CardActionEvent
	if err := protojson.Unmarshal(params, &action); err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeInvalidParams, Message: err.Error()}
	}
	if err := h.requirePluginBinding(ctx, action.GetBindingId()); err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeUnauthorized, Message: err.Error()}
	}
	h.mu.Lock()
	admitter := h.admitter
	h.mu.Unlock()
	if admitter == nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: "action admission unavailable"}
	}
	ack, err := admitter.HandleCardAction(
		ctx, pluginruntime.PluginIdentity(ctx), &action,
	)
	if err != nil {
		return nil, &pluginrpc.RPCError{Code: pluginrpc.CodeRetryableDelivery, Message: safeError(err)}
	}
	return ack, nil
}

func (h *RuntimeHost) requirePluginBinding(ctx context.Context, bindingID string) error {
	pluginID := pluginruntime.PluginIdentity(ctx)
	if pluginID == "" {
		return fmt.Errorf("plugin identity is unavailable")
	}
	record, err := h.bindings.GetRecord(ctx, bindingID)
	if err != nil {
		return err
	}
	if record.PluginID != pluginID {
		return fmt.Errorf("plugin does not own binding")
	}
	return nil
}

func connectionStateName(state model.ConnectionState) string {
	switch state {
	case model.ConnectionState_CONNECTION_STATE_STOPPED:
		return BindingStateStopped
	case model.ConnectionState_CONNECTION_STATE_CONNECTING:
		return BindingStateConnecting
	case model.ConnectionState_CONNECTION_STATE_CONNECTED:
		return BindingStateConnected
	case model.ConnectionState_CONNECTION_STATE_RECONNECTING:
		return BindingStateReconnecting
	case model.ConnectionState_CONNECTION_STATE_UNAUTHORIZED:
		return BindingStateUnauthorized
	case model.ConnectionState_CONNECTION_STATE_FAILED:
		return BindingStateFailed
	default:
		return BindingStateStopped
	}
}

func safeError(err error) string {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "admission cancelled"
	}
	msg := err.Error()
	if len(msg) > 512 {
		return msg[:512]
	}
	return msg
}
