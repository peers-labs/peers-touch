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

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

const (
	inboundStatusReceived   = "received"
	inboundStatusAdmitted   = "admitted"
	inboundStatusProcessing = "processing"
	inboundStatusCompleted  = "completed"
	inboundStatusFailed     = "failed"
	inboundStatusIgnored    = "ignored"

	deliveryStatusPending   = "pending"
	deliveryStatusLeased    = "leased"
	deliveryStatusDelivered = "delivered"
	deliveryStatusRetry     = "retry"
	deliveryStatusFailed    = "failed"
	deliveryStatusUnknown   = "unknown"
)

type ResourceFetcher interface {
	FetchResource(
		ctx context.Context,
		bindingID, messageID string,
		resource *model.ChannelResourceRef,
	) (AttachmentPayload, error)
}

type OutboundDeliverer interface {
	Deliver(ctx context.Context, request *model.DeliveryRequest) (*model.DeliveryReceipt, error)
	UploadResource(
		ctx context.Context,
		request *model.ResourceUploadRequest,
	) (*model.ResourceUploadResponse, error)
	SyncAutomationTrigger(
		ctx context.Context,
		request *model.SyncAutomationTriggerRequest,
	) error
}

// DurableBridge owns the Channel ingress and delivery journals. Provider
// callbacks stop at durable Agent admission; long Agent execution and provider
// delivery continue under Station lifecycle workers.
type DurableBridge struct {
	db         *gorm.DB
	bindings   *BindingService
	management *ManagementService
	executor   TurnExecutor
	resources  ResourceFetcher
	deliverer  OutboundDeliverer
	now        func() time.Time

	startOnce sync.Once
}

func NewDurableBridge(
	db *gorm.DB,
	bindings *BindingService,
	management *ManagementService,
	executor TurnExecutor,
	resources ResourceFetcher,
	deliverer OutboundDeliverer,
) *DurableBridge {
	return &DurableBridge{
		db: db, bindings: bindings, management: management,
		executor: executor, resources: resources, deliverer: deliverer,
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (b *DurableBridge) Start(ctx context.Context) {
	b.startOnce.Do(func() {
		go b.runTurnProjection(ctx)
		go b.runDelivery(ctx)
		go b.runAutomationScheduler(ctx)
	})
}

func (b *DurableBridge) AdmitInbound(
	ctx context.Context,
	pluginID string,
	event *model.NormalizedInboundEvent,
) (*model.InboundAck, error) {
	if err := validateInbound(event); err != nil {
		return nil, err
	}
	binding, err := b.bindings.GetRecord(ctx, event.GetBindingId())
	if err != nil {
		return nil, err
	}
	if binding.PluginID != strings.TrimSpace(pluginID) ||
		binding.ProviderKind != strings.TrimSpace(event.GetProviderKind()) {
		return nil, fmt.Errorf("%w: plugin does not own binding", ErrInvalidBinding)
	}
	payloadHash, err := inboundHash(event)
	if err != nil {
		return nil, err
	}
	record, duplicate, err := b.persistInbound(ctx, binding, event, payloadHash)
	if err != nil {
		return nil, err
	}
	if duplicate {
		return &model.InboundAck{
			State:     model.InboundAckState_INBOUND_ACK_STATE_DUPLICATE,
			InboundId: record.ID, TurnId: record.TurnID,
		}, nil
	}
	if !binding.Enabled {
		if err := b.markInboundIgnored(ctx, record.ID, "binding_disabled"); err != nil {
			return nil, err
		}
		return &model.InboundAck{
			State:     model.InboundAckState_INBOUND_ACK_STATE_IGNORED,
			InboundId: record.ID,
		}, nil
	}
	if event.GetSenderIsBot() {
		if err := b.markInboundIgnored(ctx, record.ID, "bot_loop_suppressed"); err != nil {
			return nil, err
		}
		return &model.InboundAck{
			State:     model.InboundAckState_INBOUND_ACK_STATE_IGNORED,
			InboundId: record.ID,
		}, nil
	}
	if event.GetMessageType() == "document_event" {
		if err := b.enqueueMatchingEventAutomations(ctx, binding, record, event); err != nil {
			_ = b.failInbound(ctx, record.ID, "automation_trigger_failed", err)
			return nil, err
		}
		now := b.now()
		_ = b.db.WithContext(ctx).Model(record).Updates(map[string]any{
			"status": inboundStatusCompleted, "completed_at": now, "updated_at": now,
		}).Error
		return &model.InboundAck{
			State:     model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED,
			InboundId: record.ID,
		}, nil
	}
	if event.GetChatType() == "group" && !bindingRespondsToGroup(binding, event) {
		if err := b.markInboundIgnored(ctx, record.ID, "group_policy_ignored"); err != nil {
			return nil, err
		}
		return &model.InboundAck{
			State:     model.InboundAckState_INBOUND_ACK_STATE_IGNORED,
			InboundId: record.ID,
		}, nil
	}
	providerUserID := firstNonEmpty(
		event.GetSenderUserId(),
		event.GetSenderUnionId(),
		event.GetSenderId(),
	)
	allowed, accessStatus, err := b.management.AuthorizeSender(
		ctx, binding, providerUserID, event.GetSenderName(),
	)
	if err != nil {
		return nil, err
	}
	if !allowed {
		if err := b.markInboundIgnored(ctx, record.ID, "access_"+accessStatus); err != nil {
			return nil, err
		}
		if accessStatus == "pending" {
			_, _ = b.createDeliveryIntent(ctx, DeliveryIntentInput{
				Identity: "access:" + record.ID, BindingID: binding.ID,
				TargetChatID: event.GetChatId(), ReplyToMessageID: event.GetMessageId(),
				Kind: "text", Text: "Access requested. The connection owner can approve it in Peers.",
				Terminal: true,
			})
		}
		return &model.InboundAck{
			State:     model.InboundAckState_INBOUND_ACK_STATE_IGNORED,
			InboundId: record.ID,
		}, nil
	}
	if err := b.enqueueMatchingEventAutomations(ctx, binding, record, event); err != nil {
		_ = b.failInbound(ctx, record.ID, "automation_trigger_failed", err)
		return nil, err
	}

	agentID, err := b.management.AgentForChat(
		ctx, binding.ID, event.GetChatId(), binding.AgentID,
	)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(agentID) == "" {
		return nil, fmt.Errorf("%w: binding has no ready Agent", ErrInvalidBinding)
	}
	scopeKey := conversationScope(binding, event)
	conversationID, err := b.bindings.ResolveConversation(
		ctx, binding.ID, scopeKey, event.GetChatId(), event.GetChatType(),
		event.GetRootId(), event.GetThreadId(), newChannelConversationID(),
	)
	if err != nil {
		return nil, err
	}
	title := channelConversationTitle(event)
	if err := b.executor.EnsureConversation(
		ctx, binding.ActorPTID, agentID, conversationID, title,
	); err != nil {
		return nil, fmt.Errorf("ensure channel conversation: %w", err)
	}
	attachments, err := b.fetchAttachments(ctx, event)
	if err != nil {
		_ = b.failInbound(ctx, record.ID, "resource_fetch_failed", err)
		return nil, err
	}
	input := normalizedUserInput(event, attachments)
	admission, err := b.executor.AdmitTurn(ctx, TurnAdmissionInput{
		ActorPTID: binding.ActorPTID, AgentID: agentID,
		ConversationID: conversationID, Title: title, UserInput: input,
		IdempotencyKey: record.AdmissionKey, Attachments: attachments,
	})
	if err != nil {
		_ = b.failInbound(ctx, record.ID, "turn_admission_failed", err)
		return nil, err
	}
	now := b.now()
	result := b.db.WithContext(ctx).Model(&persistence.ChannelInboundEvent{}).
		Where("id = ? AND status = ?", record.ID, inboundStatusReceived).
		Updates(map[string]any{
			"agent_id": agentID, "conversation_id": conversationID,
			"turn_id": admission.TurnID, "status": inboundStatusAdmitted,
			"admitted_at": now, "updated_at": now,
		})
	if result.Error != nil {
		return nil, fmt.Errorf("record channel admission: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return nil, fmt.Errorf("%w: inbound admission changed concurrently", ErrInvalidBinding)
	}
	_ = b.management.UpsertChat(
		ctx, binding.ID, event.GetChatId(), event.GetMetadata()["chat_name"],
		event.GetChatType(), event.GetSenderName(), now,
	)
	_ = b.management.RecordDiagnostic(ctx, DiagnosticView{
		BindingID: binding.ID, Direction: "inbound", Phase: "received",
		MessageType: event.GetMessageType(), Summary: diagnosticSummary(event.GetText()),
		SenderID: event.GetSenderId(), SenderName: event.GetSenderName(),
		TargetID: event.GetChatId(), ChatType: event.GetChatType(),
		TurnID: admission.TurnID, OccurredAt: now,
	})
	return &model.InboundAck{
		State:     model.InboundAckState_INBOUND_ACK_STATE_ACCEPTED,
		InboundId: record.ID, TurnId: admission.TurnID,
	}, nil
}

func (b *DurableBridge) persistInbound(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	event *model.NormalizedInboundEvent,
	payloadHash string,
) (*persistence.ChannelInboundEvent, bool, error) {
	var existing persistence.ChannelInboundEvent
	query := b.db.WithContext(ctx).Where(
		"binding_id = ? AND provider_event_id = ?",
		binding.ID, event.GetEventId(),
	)
	if err := query.First(&existing).Error; err == nil {
		if existing.PayloadHash != payloadHash {
			return nil, false, fmt.Errorf("%w: event id reused with different payload", ErrInvalidBinding)
		}
		return &existing, true, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	if event.GetMessageId() != "" {
		err := b.db.WithContext(ctx).Where(
			"binding_id = ? AND provider_message_id = ?",
			binding.ID, event.GetMessageId(),
		).First(&existing).Error
		if err == nil {
			if existing.PayloadHash != payloadHash {
				return nil, false, fmt.Errorf("%w: message id reused with different payload", ErrInvalidBinding)
			}
			return &existing, true, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, err
		}
	}
	resources, _ := json.Marshal(event.GetResources())
	mentions, _ := json.Marshal(event.GetMentions())
	now := b.now()
	record := &persistence.ChannelInboundEvent{
		ID: newBindingID(), BindingID: binding.ID, ProviderKind: event.GetProviderKind(),
		ProviderEventID: event.GetEventId(), ProviderMessageID: event.GetMessageId(),
		PayloadHash: payloadHash, ChatID: event.GetChatId(), ChatType: event.GetChatType(),
		ScopeKey: conversationScope(binding, event), SenderID: event.GetSenderId(),
		SenderName: event.GetSenderName(), SenderTenantKey: event.GetSenderTenantKey(),
		MessageType: event.GetMessageType(), Text: event.GetText(),
		ContentJSON: event.GetContentJson(), ResourcesJSON: string(resources),
		MentionsJSON: string(mentions), ParentID: event.GetParentId(),
		RootID: event.GetRootId(), ThreadID: event.GetThreadId(),
		AdmissionKey: channelAdmissionKey(binding.ID, event),
		Status:       inboundStatusReceived, ReceivedAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := b.db.WithContext(ctx).Create(record).Error; err != nil {
		var raced persistence.ChannelInboundEvent
		if getErr := b.db.WithContext(ctx).Where(
			"binding_id = ? AND (provider_event_id = ? OR provider_message_id = ?)",
			binding.ID, event.GetEventId(), event.GetMessageId(),
		).First(&raced).Error; getErr == nil && raced.PayloadHash == payloadHash {
			return &raced, true, nil
		}
		return nil, false, fmt.Errorf("persist channel inbound: %w", err)
	}
	return record, false, nil
}

func (b *DurableBridge) fetchAttachments(
	ctx context.Context,
	event *model.NormalizedInboundEvent,
) ([]AttachmentPayload, error) {
	if len(event.GetResources()) == 0 {
		return nil, nil
	}
	if b.resources == nil {
		return nil, fmt.Errorf("channel resource fetcher unavailable")
	}
	attachments := make([]AttachmentPayload, 0, len(event.GetResources()))
	for _, resource := range event.GetResources() {
		if resource == nil || (resource.GetKind() != "image" && resource.GetKind() != "file") {
			continue
		}
		attachment, err := b.resources.FetchResource(
			ctx,
			event.GetBindingId(),
			firstNonEmpty(resource.GetSourceMessageId(), event.GetMessageId()),
			resource,
		)
		if err != nil {
			return nil, err
		}
		attachments = append(attachments, attachment)
	}
	return attachments, nil
}

func (b *DurableBridge) runTurnProjection(ctx context.Context) {
	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()
	for {
		b.projectPendingTurns(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (b *DurableBridge) projectPendingTurns(ctx context.Context) {
	var records []persistence.ChannelInboundEvent
	if err := b.db.WithContext(ctx).
		Where("status IN ?", []string{inboundStatusAdmitted, inboundStatusProcessing}).
		Order("received_at ASC").Limit(32).Find(&records).Error; err != nil {
		return
	}
	for i := range records {
		b.projectTurn(ctx, &records[i])
	}
}

func (b *DurableBridge) projectTurn(
	ctx context.Context,
	record *persistence.ChannelInboundEvent,
) {
	if b.executor == nil || record == nil {
		return
	}
	binding, err := b.bindings.GetRecord(ctx, record.BindingID)
	if err != nil {
		return
	}
	if record.TurnID == "" {
		resolved, err := b.executor.ResolveAdmission(
			ctx, binding.ActorPTID, record.ConversationID, record.AdmissionKey,
		)
		if err != nil || resolved.TurnID == "" {
			return
		}
		record.TurnID = resolved.TurnID
		_ = b.db.WithContext(ctx).Model(record).Updates(map[string]any{
			"turn_id": resolved.TurnID, "updated_at": b.now(),
		}).Error
	}
	snapshot, err := b.executor.Snapshot(
		ctx, binding.ActorPTID, record.ConversationID, record.TurnID,
	)
	if err != nil {
		return
	}
	if !terminalTurnStatus(snapshot.Status) {
		_ = b.db.WithContext(ctx).Model(record).Updates(map[string]any{
			"status": inboundStatusProcessing, "updated_at": b.now(),
		}).Error
		if strings.TrimSpace(snapshot.Text) != "" {
			_, _ = b.createDeliveryIntent(ctx, DeliveryIntentInput{
				Identity: record.ID, BindingID: record.BindingID,
				TargetChatID: record.ChatID, ReplyToMessageID: record.ProviderMessageID,
				RootID: record.RootID, ThreadID: record.ThreadID,
				Kind: "card", Text: snapshot.Text,
				ContentJSON: turnCardJSON(snapshot, false),
				Terminal:    false,
			})
		} else if snapshot.Pending != nil {
			_, _ = b.createDeliveryIntent(ctx, DeliveryIntentInput{
				Identity: record.ID, BindingID: record.BindingID,
				TargetChatID: record.ChatID, ReplyToMessageID: record.ProviderMessageID,
				RootID: record.RootID, ThreadID: record.ThreadID,
				Kind: "card", Text: "Approval required",
				ContentJSON: turnCardJSON(snapshot, false),
				Terminal:    false,
			})
		}
		return
	}
	now := b.now()
	if snapshot.Status == "completed" {
		text := strings.TrimSpace(snapshot.Text)
		if text != "" {
			kind := "card"
			content := turnCardJSON(snapshot, true)
			_, _ = b.createDeliveryIntent(ctx, DeliveryIntentInput{
				Identity: record.ID, BindingID: record.BindingID,
				TargetChatID: record.ChatID, ReplyToMessageID: record.ProviderMessageID,
				RootID: record.RootID, ThreadID: record.ThreadID,
				Kind: kind, Text: text, ContentJSON: content, Terminal: true,
			})
		}
		for _, output := range snapshot.Outputs {
			resourceJSON, err := json.Marshal(deliveryResourceState{
				TurnID: record.TurnID, Output: output,
			})
			if err != nil {
				continue
			}
			kind := "file"
			if strings.HasPrefix(strings.ToLower(output.MIMEType), "image/") {
				kind = "image"
			}
			_, _ = b.createDeliveryIntent(ctx, DeliveryIntentInput{
				Identity:  record.ID + ":output:" + output.OutputID,
				BindingID: record.BindingID, TargetChatID: record.ChatID,
				ReplyToMessageID: record.ProviderMessageID,
				RootID:           record.RootID, ThreadID: record.ThreadID,
				Kind: kind, Text: output.Summary,
				ResourceJSON: string(resourceJSON), Terminal: true,
			})
		}
		_ = b.db.WithContext(ctx).Model(record).Updates(map[string]any{
			"status": inboundStatusCompleted, "completed_at": now, "updated_at": now,
		}).Error
		return
	}
	_, _ = b.createDeliveryIntent(ctx, DeliveryIntentInput{
		Identity: record.ID, BindingID: record.BindingID,
		TargetChatID: record.ChatID, ReplyToMessageID: record.ProviderMessageID,
		RootID: record.RootID, ThreadID: record.ThreadID, Kind: "text",
		Text:     "This request could not be completed. You can retry from the same conversation.",
		Terminal: true,
	})
	_ = b.db.WithContext(ctx).Model(record).Updates(map[string]any{
		"status": inboundStatusFailed, "error_code": "turn_" + snapshot.Status,
		"error_message": redactDiagnostic(snapshot.TerminalReason),
		"completed_at":  now, "updated_at": now,
	}).Error
}

type DeliveryIntentInput struct {
	Identity         string
	BindingID        string
	TargetChatID     string
	ReplyToMessageID string
	RootID           string
	ThreadID         string
	Kind             string
	Text             string
	ContentJSON      string
	ResourceJSON     string
	Terminal         bool
}

func (b *DurableBridge) createDeliveryIntent(
	ctx context.Context,
	input DeliveryIntentInput,
) (string, error) {
	now := b.now()
	var existing persistence.ChannelDeliveryIntent
	err := b.db.WithContext(ctx).Where(
		"inbound_id = ? AND intent_kind = ?",
		input.Identity, "turn_reply",
	).First(&existing).Error
	if err == nil {
		if existing.Terminal {
			return existing.ID, nil
		}
		if existing.Kind == input.Kind &&
			existing.Text == input.Text &&
			existing.ContentJSON == input.ContentJSON &&
			existing.ResourceJSON == input.ResourceJSON &&
			existing.Terminal == input.Terminal {
			return existing.ID, nil
		}
		nextRevision := existing.Revision + 1
		updates := map[string]any{
			"kind": input.Kind, "text": input.Text, "content_json": input.ContentJSON,
			"resource_json": input.ResourceJSON, "terminal": input.Terminal,
			"revision": nextRevision, "updated_at": now,
		}
		if existing.Status == deliveryStatusDelivered && existing.ProviderMessageID != "" {
			updates["status"] = deliveryStatusPending
		} else if existing.Status != deliveryStatusLeased {
			updates["status"] = deliveryStatusPending
		}
		if err := b.db.WithContext(ctx).Model(&existing).Updates(updates).Error; err != nil {
			return "", err
		}
		return existing.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	record := persistence.ChannelDeliveryIntent{
		ID: newDeliveryID(input.Identity), BindingID: input.BindingID,
		InboundID: input.Identity, IntentKind: "turn_reply",
		TargetChatID: input.TargetChatID, ReplyToMessageID: input.ReplyToMessageID,
		RootID: input.RootID, ThreadID: input.ThreadID, Kind: input.Kind,
		Text: input.Text, ContentJSON: input.ContentJSON, ResourceJSON: input.ResourceJSON,
		Status: deliveryStatusPending, Revision: 1, Terminal: input.Terminal,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := b.db.WithContext(ctx).Create(&record).Error; err != nil {
		return "", fmt.Errorf("create channel delivery intent: %w", err)
	}
	return record.ID, nil
}

func (b *DurableBridge) Send(
	ctx context.Context,
	bindingID, targetChatID, text, idempotencyKey string,
) (string, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return "", fmt.Errorf("%w: delivery idempotency key is required", ErrInvalidBinding)
	}
	return b.createDeliveryIntent(ctx, DeliveryIntentInput{
		Identity:  "manual:" + sanitizeToken(idempotencyKey),
		BindingID: bindingID, TargetChatID: targetChatID,
		Kind: "text", Text: strings.TrimSpace(text), Terminal: true,
	})
}

func (b *DurableBridge) RetryDelivery(
	ctx context.Context,
	actorPTID, bindingID, deliveryID string,
) error {
	if _, err := b.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return err
	}
	result := b.db.WithContext(ctx).Model(&persistence.ChannelDeliveryIntent{}).
		Where("id = ? AND binding_id = ? AND status IN ?",
			deliveryID, bindingID,
			[]string{deliveryStatusRetry, deliveryStatusFailed, deliveryStatusUnknown}).
		Updates(map[string]any{
			"status": deliveryStatusPending, "next_attempt_at": nil,
			"last_error": "", "last_error_code": "", "updated_at": b.now(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("%w: delivery is not retryable", ErrInvalidBinding)
	}
	return nil
}

func (b *DurableBridge) runDelivery(ctx context.Context) {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		b.deliverPending(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (b *DurableBridge) deliverPending(ctx context.Context) {
	now := b.now()
	var records []persistence.ChannelDeliveryIntent
	if err := b.db.WithContext(ctx).
		Where("status IN ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
			[]string{deliveryStatusPending, deliveryStatusRetry}, now).
		Order("created_at ASC").Limit(16).Find(&records).Error; err != nil {
		return
	}
	for i := range records {
		b.deliverOne(ctx, &records[i])
	}
}

func (b *DurableBridge) deliverOne(
	ctx context.Context,
	record *persistence.ChannelDeliveryIntent,
) {
	if b.deliverer == nil || record == nil {
		return
	}
	lease := randomToken(16)
	expires := b.now().Add(30 * time.Second)
	result := b.db.WithContext(ctx).Model(&persistence.ChannelDeliveryIntent{}).
		Where("id = ? AND revision = ? AND status IN ?",
			record.ID, record.Revision,
			[]string{deliveryStatusPending, deliveryStatusRetry}).
		Updates(map[string]any{
			"status": deliveryStatusLeased, "lease_token": lease,
			"lease_expires_at": expires, "updated_at": b.now(),
		})
	if result.Error != nil || result.RowsAffected != 1 {
		return
	}
	request := &model.DeliveryRequest{
		DeliveryId: record.ID, BindingId: record.BindingID,
		TargetChatId: record.TargetChatID, Text: record.Text,
		IdempotencyKey: platformUUID(record.ID),
		Kind:           deliveryKind(record.Kind), ContentJson: record.ContentJSON,
		ReplyToMessageId: record.ReplyToMessageID, RootId: record.RootID,
		ThreadId: record.ThreadID, Revision: record.Revision, Terminal: record.Terminal,
		Operation:         model.DeliveryOperation_DELIVERY_OPERATION_CREATE,
		ProviderMessageId: record.ProviderMessageID,
	}
	if record.Kind == "image" || record.Kind == "file" {
		resource, err := b.prepareDeliveryResource(ctx, record, lease)
		if err != nil {
			b.setDeliveryFailure(ctx, record, lease, "unknown", err.Error(), 0)
			return
		}
		request.Resource = resource
	}
	if record.ProviderMessageID != "" && record.Kind == "card" {
		request.Operation = model.DeliveryOperation_DELIVERY_OPERATION_UPDATE
	} else if record.ReplyToMessageID != "" {
		request.Operation = model.DeliveryOperation_DELIVERY_OPERATION_REPLY
	}
	attemptAt := b.now()
	receipt, err := b.deliverer.Deliver(ctx, request)
	if err != nil {
		b.setDeliveryFailure(ctx, record, lease, "unknown", err.Error(), 0)
		return
	}
	if receipt.GetOk() {
		deliveredAt := b.now()
		if receipt.GetDeliveredAtUnixMs() > 0 {
			deliveredAt = time.UnixMilli(receipt.GetDeliveredAtUnixMs()).UTC()
		}
		var current persistence.ChannelDeliveryIntent
		if err := b.db.WithContext(ctx).
			Where("id = ? AND lease_token = ?", record.ID, lease).
			First(&current).Error; err != nil {
			return
		}
		nextStatus := deliveryStatusDelivered
		if current.Revision > record.Revision {
			nextStatus = deliveryStatusPending
		}
		_ = b.db.WithContext(ctx).Model(&persistence.ChannelDeliveryIntent{}).
			Where("id = ? AND lease_token = ?", record.ID, lease).
			Updates(map[string]any{
				"status":              nextStatus,
				"provider_message_id": firstNonEmpty(receipt.GetProviderMessageId(), record.ProviderMessageID),
				"attempt_count":       record.AttemptCount + 1, "last_attempt_at": attemptAt,
				"delivered_at": deliveredAt, "lease_token": "", "lease_expires_at": nil,
				"last_error": "", "last_error_code": "", "updated_at": b.now(),
			}).Error
		_ = b.management.RecordDiagnostic(ctx, DiagnosticView{
			BindingID: record.BindingID, Direction: "outbound", Phase: "delivered",
			MessageType: record.Kind, Summary: diagnosticSummary(record.Text),
			TargetID: record.TargetChatID, DeliveryID: record.ID,
			OccurredAt: deliveredAt, LatencyMS: deliveredAt.Sub(record.CreatedAt).Milliseconds(),
		})
		b.markAutomationDelivery(
			ctx, record.InboundID, record.ID, nextStatus, "", deliveredAt,
		)
		return
	}
	b.setDeliveryFailure(
		ctx, record, lease, receipt.GetErrorCategory(),
		receipt.GetErrorMessage(), receipt.GetRetryAfterSeconds(),
	)
}

type deliveryResourceState struct {
	TurnID      string     `json:"turn_id"`
	Output      TurnOutput `json:"output"`
	ProviderKey string     `json:"provider_key,omitempty"`
}

func (b *DurableBridge) prepareDeliveryResource(
	ctx context.Context,
	record *persistence.ChannelDeliveryIntent,
	lease string,
) (*model.ChannelResourceRef, error) {
	if b.executor == nil || b.deliverer == nil {
		return nil, fmt.Errorf("channel output delivery is unavailable")
	}
	var state deliveryResourceState
	if err := json.Unmarshal([]byte(record.ResourceJSON), &state); err != nil {
		return nil, fmt.Errorf("decode channel output: %w", err)
	}
	if state.ProviderKey != "" {
		return deliveryResourceRef(record.Kind, state), nil
	}
	binding, err := b.bindings.GetRecord(ctx, record.BindingID)
	if err != nil {
		return nil, err
	}
	body, err := b.executor.ReadOutput(
		ctx, binding.ActorPTID, state.TurnID, state.Output,
	)
	if err != nil {
		return nil, err
	}
	if len(body) == 0 || len(body) > 30*1024*1024 {
		return nil, fmt.Errorf("channel output size is outside provider limits")
	}
	if state.Output.SizeBytes > 0 && uint64(len(body)) != state.Output.SizeBytes {
		return nil, fmt.Errorf("channel output size changed")
	}
	sum := sha256.Sum256(body)
	checksum := "sha256:" + hex.EncodeToString(sum[:])
	if state.Output.Checksum != "" && !strings.EqualFold(
		normalizedChecksum(state.Output.Checksum), normalizedChecksum(checksum),
	) {
		return nil, fmt.Errorf("channel output checksum changed")
	}
	state.Output.SizeBytes = uint64(len(body))
	state.Output.Checksum = checksum
	const chunkSize = 512 * 1024
	uploadID := "channel-output:" + sanitizeToken(record.ID)
	var response *model.ResourceUploadResponse
	for offset := 0; offset < len(body); offset += chunkSize {
		end := min(offset+chunkSize, len(body))
		response, err = b.deliverer.UploadResource(ctx, &model.ResourceUploadRequest{
			BindingId: record.BindingID, UploadId: uploadID,
			Kind: record.Kind, FileName: state.Output.Name,
			MimeType: state.Output.MIMEType, TotalBytes: uint64(len(body)),
			Checksum: checksum, Offset: uint64(offset), Data: body[offset:end],
			Eof: end == len(body),
		})
		if err != nil {
			return nil, err
		}
		if response.GetAcceptedOffset() != uint64(end) {
			return nil, fmt.Errorf("provider upload offset mismatch")
		}
	}
	if response == nil || !response.GetComplete() ||
		strings.TrimSpace(response.GetProviderKey()) == "" {
		return nil, fmt.Errorf("provider upload did not complete")
	}
	state.ProviderKey = response.GetProviderKey()
	encoded, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	result := b.db.WithContext(ctx).Model(&persistence.ChannelDeliveryIntent{}).
		Where("id = ? AND lease_token = ?", record.ID, lease).
		Update("resource_json", string(encoded))
	if result.Error != nil || result.RowsAffected != 1 {
		if result.Error != nil {
			return nil, result.Error
		}
		return nil, fmt.Errorf("channel output delivery lease changed")
	}
	record.ResourceJSON = string(encoded)
	return deliveryResourceRef(record.Kind, state), nil
}

func deliveryResourceRef(kind string, state deliveryResourceState) *model.ChannelResourceRef {
	return &model.ChannelResourceRef{
		ProviderKey: state.ProviderKey, Kind: kind,
		FileName: state.Output.Name, MimeType: state.Output.MIMEType,
		SizeBytes: state.Output.SizeBytes,
	}
}

func normalizedChecksum(value string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "sha256:")
}

func (b *DurableBridge) setDeliveryFailure(
	ctx context.Context,
	record *persistence.ChannelDeliveryIntent,
	lease, category, message string,
	retryAfter int64,
) {
	var current persistence.ChannelDeliveryIntent
	if err := b.db.WithContext(ctx).
		Where("id = ? AND lease_token = ?", record.ID, lease).
		First(&current).Error; err != nil {
		return
	}
	if current.Revision > record.Revision {
		_ = b.db.WithContext(ctx).Model(&persistence.ChannelDeliveryIntent{}).
			Where("id = ? AND lease_token = ?", record.ID, lease).
			Updates(map[string]any{
				"status": deliveryStatusPending, "lease_token": "",
				"lease_expires_at": nil, "updated_at": b.now(),
			}).Error
		return
	}
	attempts := record.AttemptCount + 1
	status := deliveryStatusFailed
	var next *time.Time
	switch category {
	case "retryable":
		if attempts < 6 {
			status = deliveryStatusRetry
			delay := time.Duration(1<<min(attempts, 6)) * time.Second
			if retryAfter > 0 {
				delay = time.Duration(retryAfter) * time.Second
			}
			value := b.now().Add(delay)
			next = &value
		}
	case "unknown":
		status = deliveryStatusUnknown
	}
	_ = b.db.WithContext(ctx).Model(&persistence.ChannelDeliveryIntent{}).
		Where("id = ? AND lease_token = ?", record.ID, lease).
		Updates(map[string]any{
			"status": status, "attempt_count": attempts, "last_attempt_at": b.now(),
			"next_attempt_at": next, "lease_token": "", "lease_expires_at": nil,
			"last_error_code": category, "last_error": redactDiagnostic(message),
			"updated_at": b.now(),
		}).Error
	_ = b.management.RecordDiagnostic(ctx, DiagnosticView{
		BindingID: record.BindingID, Direction: "outbound", Phase: "failed",
		MessageType: record.Kind, Summary: diagnosticSummary(record.Text),
		TargetID: record.TargetChatID, DeliveryID: record.ID,
		ErrorCode: category, ErrorMessage: message, OccurredAt: b.now(),
	})
	b.markAutomationDelivery(
		ctx, record.InboundID, record.ID, status, message, b.now(),
	)
}

func (b *DurableBridge) RecoverLeases(ctx context.Context) error {
	now := b.now()
	return b.db.WithContext(ctx).Model(&persistence.ChannelDeliveryIntent{}).
		Where("status = ? AND lease_expires_at < ?", deliveryStatusLeased, now).
		Updates(map[string]any{
			"status": deliveryStatusUnknown, "lease_token": "",
			"lease_expires_at": nil, "last_error_code": "lease_expired",
			"last_error": "delivery result is unknown after process interruption",
			"updated_at": now,
		}).Error
}

func (b *DurableBridge) markInboundIgnored(ctx context.Context, id, reason string) error {
	now := b.now()
	return b.db.WithContext(ctx).Model(&persistence.ChannelInboundEvent{}).
		Where("id = ? AND status = ?", id, inboundStatusReceived).
		Updates(map[string]any{
			"status": inboundStatusIgnored, "error_code": reason,
			"completed_at": now, "updated_at": now,
		}).Error
}

func (b *DurableBridge) failInbound(ctx context.Context, id, code string, err error) error {
	now := b.now()
	return b.db.WithContext(ctx).Model(&persistence.ChannelInboundEvent{}).
		Where("id = ?", id).Updates(map[string]any{
		"status": inboundStatusFailed, "error_code": code,
		"error_message": redactDiagnostic(err.Error()),
		"completed_at":  now, "updated_at": now,
	}).Error
}

func validateInbound(event *model.NormalizedInboundEvent) error {
	if event == nil || strings.TrimSpace(event.GetBindingId()) == "" ||
		strings.TrimSpace(event.GetProviderKind()) == "" ||
		strings.TrimSpace(event.GetEventId()) == "" ||
		strings.TrimSpace(event.GetChatId()) == "" {
		return fmt.Errorf("%w: incomplete inbound event", ErrInvalidBinding)
	}
	if event.GetMessageId() == "" && event.GetMessageType() != "card_action" {
		return fmt.Errorf("%w: provider message id is required", ErrInvalidBinding)
	}
	if event.GetChatType() != "private" && event.GetChatType() != "group" {
		return fmt.Errorf("%w: unsupported chat type", ErrInvalidBinding)
	}
	return nil
}

func inboundHash(event *model.NormalizedInboundEvent) (string, error) {
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func channelAdmissionKey(bindingID string, event *model.NormalizedInboundEvent) string {
	identity := event.GetEventId()
	if identity == "" {
		identity = event.GetMessageId()
	}
	return "channel:" + sanitizeToken(bindingID) + ":" + sanitizeToken(identity)
}

func conversationScope(binding *persistence.ChannelBinding, event *model.NormalizedInboundEvent) string {
	if event.GetChatType() != "group" || binding == nil || !binding.ThreadIsolation {
		return event.GetChatType() + ":" + event.GetChatId()
	}
	topic := firstNonEmpty(event.GetThreadId(), event.GetRootId())
	if topic == "" {
		return "group:" + event.GetChatId()
	}
	return "group:" + event.GetChatId() + ":topic:" + topic
}

func bindingRespondsToGroup(
	binding *persistence.ChannelBinding,
	event *model.NormalizedInboundEvent,
) bool {
	switch binding.GroupResponseMode {
	case "all":
		return true
	case "off":
		return false
	}
	for _, mention := range event.GetMentions() {
		if mention.GetIsBot() ||
			(binding.BotOpenID != "" && mention.GetOpenId() == binding.BotOpenID) {
			return true
		}
	}
	return false
}

func normalizedUserInput(
	event *model.NormalizedInboundEvent,
	attachments []AttachmentPayload,
) string {
	text := strings.TrimSpace(event.GetText())
	if text == "" && len(attachments) > 0 {
		text = "Analyze the attached content and answer in the current conversation."
	}
	if quoted := strings.TrimSpace(event.GetMetadata()["quoted_text"]); quoted != "" {
		text += "\n\nQuoted Lark message:\n" + quoted
	} else if event.GetParentId() != "" {
		text += "\n\nThis message replies to Lark message " + event.GetParentId() + "."
	}
	return strings.TrimSpace(text)
}

func channelConversationTitle(event *model.NormalizedInboundEvent) string {
	if name := strings.TrimSpace(event.GetMetadata()["chat_name"]); name != "" {
		return truncateTitle(name)
	}
	return truncateTitle(firstNonEmpty(event.GetText(), "Lark conversation"))
}

func terminalTurnStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "failed", "cancelled", "interrupted":
		return true
	default:
		return false
	}
}

func deliveryKind(kind string) model.DeliveryKind {
	switch kind {
	case "post":
		return model.DeliveryKind_DELIVERY_KIND_POST
	case "card":
		return model.DeliveryKind_DELIVERY_KIND_CARD
	case "image":
		return model.DeliveryKind_DELIVERY_KIND_IMAGE
	case "file":
		return model.DeliveryKind_DELIVERY_KIND_FILE
	default:
		return model.DeliveryKind_DELIVERY_KIND_TEXT
	}
}

func turnCardJSON(snapshot TurnSnapshot, terminal bool) string {
	status := "Working"
	template := "blue"
	text := strings.TrimSpace(snapshot.Text)
	if terminal {
		status = "Complete"
		template = "green"
	} else if snapshot.Pending != nil {
		status = "Approval required"
		template = "orange"
		if text == "" {
			text = "This turn is waiting for your decision."
		}
	}
	if text == "" {
		text = "Working on this request..."
	}
	card := map[string]any{
		"config": map[string]any{"wide_screen_mode": true},
		"header": map[string]any{
			"template": template,
			"title":    map[string]any{"tag": "plain_text", "content": status},
		},
		"elements": []any{
			map[string]any{"tag": "markdown", "content": text},
			map[string]any{"tag": "note", "elements": []any{
				map[string]any{"tag": "plain_text", "content": "Peers · " + snapshot.TurnID},
			}},
		},
	}
	elements := card["elements"].([]any)
	if snapshot.Pending != nil && snapshot.Pending.Kind == "approval" {
		pending := snapshot.Pending
		detail := strings.TrimSpace(pending.Detail)
		if detail == "" {
			detail = "{}"
		}
		elements = append(elements,
			map[string]any{
				"tag": "markdown",
				"content": fmt.Sprintf(
					"**Tool:** %s\n\n```json\n%s\n```", pending.Title, detail,
				),
			},
			map[string]any{
				"tag": "action",
				"actions": []any{
					approvalCardButton(
						"Approve", "primary", "approve", snapshot, pending,
					),
					approvalCardButton(
						"Decline", "danger", "deny", snapshot, pending,
					),
				},
			},
		)
	} else if terminal {
		elements = append(elements, map[string]any{
			"tag": "action",
			"actions": []any{
				map[string]any{
					"tag": "button", "text": map[string]any{
						"tag": "plain_text", "content": "Helpful",
					},
					"type": "primary",
					"value": map[string]any{
						"action": "positive_feedback", "turn_id": snapshot.TurnID,
						"snapshot_revision": snapshot.Revision,
					},
				},
				map[string]any{
					"tag": "button", "text": map[string]any{
						"tag": "plain_text", "content": "Not helpful",
					},
					"value": map[string]any{
						"action": "negative_feedback", "turn_id": snapshot.TurnID,
						"snapshot_revision": snapshot.Revision,
					},
				},
			},
		})
	} else {
		elements = append(elements, map[string]any{
			"tag": "action",
			"actions": []any{
				map[string]any{
					"tag": "button", "text": map[string]any{
						"tag": "plain_text", "content": "Cancel",
					},
					"type": "danger",
					"value": map[string]any{
						"action": "cancel", "turn_id": snapshot.TurnID,
						"snapshot_revision": snapshot.Revision,
					},
				},
			},
		})
	}
	card["elements"] = elements
	raw, _ := json.Marshal(card)
	return string(raw)
}

func approvalCardButton(
	label, buttonType, action string,
	snapshot TurnSnapshot,
	pending *TurnPendingInteraction,
) map[string]any {
	return map[string]any{
		"tag":  "button",
		"text": map[string]any{"tag": "plain_text", "content": label},
		"type": buttonType,
		"value": map[string]any{
			"action": action, "turn_id": snapshot.TurnID,
			"approval_id":       pending.InteractionID,
			"tool_call_id":      pending.ToolCallID,
			"decision_id":       pending.DecisionID,
			"expected_revision": pending.ExpectedRevision,
			"snapshot_revision": snapshot.Revision,
		},
	}
}

func diagnosticSummary(value string) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) > 160 {
		return string([]rune(value)[:160]) + "..."
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
