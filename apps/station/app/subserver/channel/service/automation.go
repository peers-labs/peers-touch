package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"gorm.io/gorm"
)

const automationRunLease = 30 * time.Second

type automationRunTrigger struct {
	Type         string
	Identity     string
	PayloadJSON  string
	ScheduledFor *time.Time
}

func (b *DurableBridge) RunAutomation(
	ctx context.Context,
	actorPTID, bindingID, automationID, idempotencyKey string,
) (AutomationView, error) {
	automation, err := b.management.Automation(
		ctx, actorPTID, bindingID, automationID,
	)
	if err != nil {
		return AutomationView{}, err
	}
	if !automation.Enabled {
		return AutomationView{}, fmt.Errorf("%w: automation is paused", ErrInvalidBinding)
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return AutomationView{}, fmt.Errorf("%w: idempotency key is required", ErrInvalidBinding)
	}
	run, err := b.enqueueAutomationRun(ctx, automation, idempotencyKey, automationRunTrigger{
		Type: "manual", Identity: idempotencyKey,
	})
	if err != nil {
		return AutomationView{}, err
	}
	if err := b.processAutomationRun(ctx, run.ID); err != nil {
		return AutomationView{}, err
	}
	refreshed, err := b.management.Automation(ctx, actorPTID, bindingID, automationID)
	if err != nil {
		return AutomationView{}, err
	}
	return automationView(*refreshed), nil
}

func (b *DurableBridge) runAutomationScheduler(ctx context.Context) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		b.scheduleDueAutomations(ctx)
		b.resumePendingAutomationRuns(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (b *DurableBridge) scheduleDueAutomations(ctx context.Context) {
	now := b.now()
	var automations []persistence.ChannelAutomation
	if err := b.db.WithContext(ctx).
		Where("enabled = ? AND trigger_type = ? AND next_due_at IS NOT NULL AND next_due_at <= ?",
			true, "schedule", now).
		Order("next_due_at ASC").Limit(32).Find(&automations).Error; err != nil {
		return
	}
	for index := range automations {
		automation := &automations[index]
		scheduledFor := automation.NextDueAt
		if scheduledFor == nil {
			continue
		}
		spec, _, parsedWindow, err := parseAutomationSchedule(
			automation.TriggerValue, scheduledFor.Add(-time.Nanosecond),
		)
		if err != nil {
			b.markAutomationScheduleInvalid(ctx, automation, err)
			continue
		}
		window := parsedWindow
		if automation.MissedWindowSecs > 0 {
			window = time.Duration(automation.MissedWindowSecs) * time.Second
		}
		next, nextErr := nextScheduleAfterNow(spec, *scheduledFor, now)
		if nextErr != nil {
			b.markAutomationScheduleInvalid(ctx, automation, nextErr)
			continue
		}
		if now.Sub(*scheduledFor) > window {
			b.advanceAutomationSchedule(
				ctx, automation, next, "missed",
				"scheduled occurrence exceeded its delivery window",
			)
			continue
		}
		key := fmt.Sprintf(
			"automation:%s:schedule:%d", automation.ID, scheduledFor.UTC().Unix(),
		)
		payload, _ := json.Marshal(map[string]any{
			"scheduled_for": scheduledFor.UTC().Format(time.RFC3339),
			"trigger":       automation.TriggerValue,
		})
		if _, err := b.enqueueAutomationRun(ctx, automation, key, automationRunTrigger{
			Type: "schedule", Identity: scheduledFor.UTC().Format(time.RFC3339),
			PayloadJSON: string(payload), ScheduledFor: scheduledFor,
		}); err != nil {
			continue
		}
		b.advanceAutomationSchedule(ctx, automation, next, "queued", "")
	}
}

func (b *DurableBridge) advanceAutomationSchedule(
	ctx context.Context,
	automation *persistence.ChannelAutomation,
	next time.Time,
	status, errorMessage string,
) {
	updates := map[string]any{
		"next_due_at": nextDueValue(next), "trigger_cursor": automation.NextDueAt.UTC().Format(time.RFC3339),
		"last_triggered_at": b.now(), "last_run_status": status,
		"last_error": redactDiagnostic(errorMessage), "updated_at": b.now(),
	}
	_ = b.db.WithContext(ctx).Model(&persistence.ChannelAutomation{}).
		Where("id = ? AND revision = ? AND next_due_at = ?",
			automation.ID, automation.Revision, automation.NextDueAt).
		Updates(updates).Error
}

func nextDueValue(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.UTC()
}

func (b *DurableBridge) markAutomationScheduleInvalid(
	ctx context.Context,
	automation *persistence.ChannelAutomation,
	cause error,
) {
	_ = b.db.WithContext(ctx).Model(&persistence.ChannelAutomation{}).
		Where("id = ? AND revision = ?", automation.ID, automation.Revision).
		Updates(map[string]any{
			"enabled": false, "next_due_at": nil, "last_run_status": "invalid",
			"last_error": redactDiagnostic(cause.Error()), "updated_at": b.now(),
		}).Error
}

func (b *DurableBridge) enqueueAutomationRun(
	ctx context.Context,
	automation *persistence.ChannelAutomation,
	idempotencyKey string,
	trigger automationRunTrigger,
) (*persistence.ChannelAutomationRun, error) {
	var existing persistence.ChannelAutomationRun
	err := b.db.WithContext(ctx).Where("idempotency_key = ?", idempotencyKey).
		First(&existing).Error
	if err == nil {
		if existing.AutomationID != automation.ID {
			return nil, fmt.Errorf("%w: automation idempotency conflict", ErrInvalidBinding)
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := b.now()
	run := &persistence.ChannelAutomationRun{
		ID: newBindingID(), AutomationID: automation.ID,
		AutomationRevision: automation.Revision, IdempotencyKey: idempotencyKey,
		TriggerType: trigger.Type, TriggerIdentity: trigger.Identity,
		TriggerPayloadJSON: trigger.PayloadJSON, ScheduledFor: trigger.ScheduledFor,
		Status: "pending", CreatedAt: now, UpdatedAt: now,
	}
	if err := b.db.WithContext(ctx).Create(run).Error; err != nil {
		if loadErr := b.db.WithContext(ctx).Where(
			"idempotency_key = ?", idempotencyKey,
		).First(&existing).Error; loadErr == nil && existing.AutomationID == automation.ID {
			return &existing, nil
		}
		return nil, fmt.Errorf("create automation run: %w", err)
	}
	return run, nil
}

func (b *DurableBridge) resumePendingAutomationRuns(ctx context.Context) {
	now := b.now()
	var runs []persistence.ChannelAutomationRun
	if err := b.db.WithContext(ctx).
		Where(
			"(status = ? OR (status = ? AND turn_id = '')) AND "+
				"(lease_expires_at IS NULL OR lease_expires_at < ?)",
			"pending", "running", now,
		).
		Order("created_at ASC").Limit(16).Find(&runs).Error; err != nil {
		return
	}
	for index := range runs {
		_ = b.processAutomationRun(ctx, runs[index].ID)
	}
}

func (b *DurableBridge) processAutomationRun(ctx context.Context, runID string) error {
	lease := randomToken(16)
	now := b.now()
	result := b.db.WithContext(ctx).Model(&persistence.ChannelAutomationRun{}).
		Where(
			"id = ? AND (status = ? OR (status = ? AND turn_id = '')) AND "+
				"(lease_expires_at IS NULL OR lease_expires_at < ?)",
			runID, "pending", "running", now,
		).
		Updates(map[string]any{
			"lease_token": lease, "lease_expires_at": now.Add(automationRunLease),
			"status": "running", "updated_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return nil
	}
	var run persistence.ChannelAutomationRun
	if err := b.db.WithContext(ctx).Where(
		"id = ? AND lease_token = ?", runID, lease,
	).First(&run).Error; err != nil {
		return err
	}
	var automation persistence.ChannelAutomation
	if err := b.db.WithContext(ctx).Where("id = ?", run.AutomationID).
		First(&automation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return b.cancelAutomationRun(ctx, &run, lease, "automation was deleted")
		}
		return b.failAutomationRun(ctx, &run, lease, err)
	}
	if !automation.Enabled || automation.Revision != run.AutomationRevision {
		return b.cancelAutomationRun(ctx, &run, lease, "automation changed or was paused")
	}
	binding, err := b.bindings.GetRecord(ctx, automation.BindingID)
	if err != nil {
		return b.failAutomationRun(ctx, &run, lease, err)
	}
	conversationID, err := b.bindings.ResolveConversation(
		ctx, binding.ID, "automation:"+automation.ID,
		automation.DestinationChatID, "private", "", "",
		newChannelConversationID(),
	)
	if err != nil {
		return b.failAutomationRun(ctx, &run, lease, err)
	}
	if err := b.executor.EnsureConversation(
		ctx, binding.ActorPTID, automation.AgentID, conversationID,
		"Automation: "+truncateTitle(automation.ActionPrompt),
	); err != nil {
		return b.failAutomationRun(ctx, &run, lease, err)
	}
	prompt := automation.ActionPrompt
	if strings.TrimSpace(run.TriggerPayloadJSON) != "" {
		prompt += "\n\nTrigger context:\n" + run.TriggerPayloadJSON
	}
	inbound, err := b.ensureAutomationInbound(
		ctx, binding, &automation, &run, conversationID, prompt,
	)
	if err != nil {
		return b.failAutomationRun(ctx, &run, lease, err)
	}
	admission, err := b.executor.AdmitTurn(ctx, TurnAdmissionInput{
		ActorPTID: binding.ActorPTID, AgentID: automation.AgentID,
		ConversationID: conversationID, Title: "Lark automation",
		UserInput: prompt, IdempotencyKey: inbound.AdmissionKey,
	})
	if err != nil {
		_ = b.failInbound(ctx, inbound.ID, "automation_admission_failed", err)
		return b.failAutomationRun(ctx, &run, lease, err)
	}
	admittedAt := b.now()
	err = b.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.ChannelInboundEvent{}).
			Where("id = ?", inbound.ID).
			Updates(map[string]any{
				"turn_id": admission.TurnID, "status": inboundStatusAdmitted,
				"admitted_at": admittedAt, "updated_at": admittedAt,
			}).Error; err != nil {
			return err
		}
		if err := tx.Model(&persistence.ChannelAutomationRun{}).
			Where("id = ? AND lease_token = ?", run.ID, lease).
			Updates(map[string]any{
				"inbound_id": inbound.ID, "turn_id": admission.TurnID,
				"status": "running", "lease_token": "", "lease_expires_at": nil,
				"updated_at": admittedAt,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.ChannelAutomation{}).
			Where("id = ? AND revision = ?", automation.ID, automation.Revision).
			Updates(map[string]any{
				"last_run_status": "running", "last_run_at": admittedAt,
				"last_error": "", "updated_at": admittedAt,
			}).Error
	})
	return err
}

func (b *DurableBridge) ensureAutomationInbound(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	automation *persistence.ChannelAutomation,
	run *persistence.ChannelAutomationRun,
	conversationID, prompt string,
) (*persistence.ChannelInboundEvent, error) {
	id := "autin-" + sanitizeToken(run.ID)
	var existing persistence.ChannelInboundEvent
	if err := b.db.WithContext(ctx).Where("id = ?", id).First(&existing).Error; err == nil {
		return &existing, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := b.now()
	inbound := &persistence.ChannelInboundEvent{
		ID: id, BindingID: binding.ID, ProviderKind: binding.ProviderKind,
		ProviderEventID: "automation:" + run.ID, ProviderMessageID: "automation:" + run.ID,
		PayloadHash: run.IdempotencyKey, ChatID: automation.DestinationChatID,
		ChatType: "private", ScopeKey: "automation:" + automation.ID,
		SenderID: "automation", SenderName: "Automation",
		MessageType: "automation", Text: prompt,
		AgentID: automation.AgentID, ConversationID: conversationID,
		AdmissionKey: "channel-automation:" + sanitizeToken(run.IdempotencyKey),
		Status:       inboundStatusReceived, ReceivedAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := b.db.WithContext(ctx).Create(inbound).Error; err != nil {
		if loadErr := b.db.WithContext(ctx).Where("id = ?", id).
			First(&existing).Error; loadErr == nil {
			return &existing, nil
		}
		return nil, err
	}
	_ = b.db.WithContext(ctx).Model(&persistence.ChannelAutomationRun{}).
		Where("id = ?", run.ID).
		Updates(map[string]any{"inbound_id": inbound.ID, "updated_at": now}).Error
	return inbound, nil
}

func (b *DurableBridge) failAutomationRun(
	ctx context.Context,
	run *persistence.ChannelAutomationRun,
	lease string,
	cause error,
) error {
	now := b.now()
	message := redactDiagnostic(cause.Error())
	_ = b.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.ChannelAutomationRun{}).
			Where("id = ? AND lease_token = ?", run.ID, lease).
			Updates(map[string]any{
				"status": "failed", "lease_token": "", "lease_expires_at": nil,
				"error_message": message, "updated_at": now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.ChannelAutomation{}).
			Where("id = ?", run.AutomationID).
			Updates(map[string]any{
				"last_run_status": "failed", "last_run_at": now,
				"last_error": message, "updated_at": now,
			}).Error
	})
	return cause
}

func (b *DurableBridge) cancelAutomationRun(
	ctx context.Context,
	run *persistence.ChannelAutomationRun,
	lease, reason string,
) error {
	now := b.now()
	if run.TurnID != "" && b.executor != nil {
		_ = b.executor.CancelTurn(ctx, "", run.TurnID)
	}
	return b.db.WithContext(ctx).Model(&persistence.ChannelAutomationRun{}).
		Where("id = ? AND lease_token = ?", run.ID, lease).
		Updates(map[string]any{
			"status": "cancelled", "cancelled_at": now,
			"lease_token": "", "lease_expires_at": nil,
			"error_message": redactDiagnostic(reason), "updated_at": now,
		}).Error
}

func (b *DurableBridge) ReconcileAutomationMutation(
	ctx context.Context,
	actorPTID, bindingID, automationID string,
) error {
	if _, err := b.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return err
	}
	var automation persistence.ChannelAutomation
	currentErr := b.db.WithContext(ctx).Where(
		"id = ? AND binding_id = ?", automationID, bindingID,
	).First(&automation).Error
	var runs []persistence.ChannelAutomationRun
	if err := b.db.WithContext(ctx).Where(
		"automation_id = ? AND status IN ?", automationID, []string{"pending", "running"},
	).Find(&runs).Error; err != nil {
		return err
	}
	for index := range runs {
		run := &runs[index]
		cancel := errors.Is(currentErr, gorm.ErrRecordNotFound) || !automation.Enabled ||
			run.AutomationRevision != automation.Revision
		if !cancel {
			continue
		}
		if run.TurnID != "" && b.executor != nil {
			_ = b.executor.CancelTurn(ctx, actorPTID, run.TurnID)
		}
		now := b.now()
		_ = b.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if run.InboundID != "" {
				_ = tx.Model(&persistence.ChannelDeliveryIntent{}).
					Where("inbound_id = ? AND status IN ?", run.InboundID,
						[]string{deliveryStatusPending, deliveryStatusRetry, deliveryStatusLeased}).
					Updates(map[string]any{
						"status": deliveryStatusFailed, "terminal": true,
						"last_error_code": "automation_cancelled",
						"last_error":      "automation changed or was cancelled", "updated_at": now,
					}).Error
			}
			return tx.Model(&persistence.ChannelAutomationRun{}).
				Where("id = ? AND status IN ?", run.ID, []string{"pending", "running"}).
				Updates(map[string]any{
					"status": "cancelled", "cancelled_at": now,
					"lease_token": "", "lease_expires_at": nil,
					"error_message": "automation changed or was cancelled", "updated_at": now,
				}).Error
		})
	}
	if currentErr != nil && !errors.Is(currentErr, gorm.ErrRecordNotFound) {
		return currentErr
	}
	return nil
}

func (b *DurableBridge) SyncAutomationTrigger(
	ctx context.Context,
	actorPTID string,
	automation AutomationView,
) error {
	if _, err := b.bindings.loadForActor(
		actorPTID, automation.BindingID,
	); err != nil {
		return err
	}
	if b.deliverer == nil {
		return fmt.Errorf("channel plugin runtime is unavailable")
	}
	return b.deliverer.SyncAutomationTrigger(
		ctx,
		&model.SyncAutomationTriggerRequest{
			BindingId: automation.BindingID, AutomationId: automation.ID,
			TriggerType: automation.TriggerType, TriggerValue: automation.TriggerValue,
			Enabled: automation.Enabled,
		},
	)
}

func (b *DurableBridge) enqueueMatchingEventAutomations(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	inbound *persistence.ChannelInboundEvent,
	event *model.NormalizedInboundEvent,
) error {
	triggerType := "message"
	if event.GetMessageType() == "document_event" {
		triggerType = "document"
	}
	var automations []persistence.ChannelAutomation
	if err := b.db.WithContext(ctx).Where(
		"binding_id = ? AND enabled = ? AND trigger_type = ?",
		binding.ID, true, triggerType,
	).Find(&automations).Error; err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]any{
		"event_id": event.GetEventId(), "message_id": event.GetMessageId(),
		"message_type": event.GetMessageType(), "text": event.GetText(),
		"content": event.GetContentJson(), "metadata": event.GetMetadata(),
	})
	for index := range automations {
		automation := &automations[index]
		if !automationMatchesEvent(automation, event) {
			continue
		}
		key := fmt.Sprintf("automation:%s:event:%s", automation.ID, inbound.ID)
		if _, err := b.enqueueAutomationRun(ctx, automation, key, automationRunTrigger{
			Type: triggerType, Identity: event.GetEventId(), PayloadJSON: string(payload),
		}); err != nil {
			return err
		}
		now := b.now()
		_ = b.db.WithContext(ctx).Model(&persistence.ChannelAutomation{}).
			Where("id = ? AND revision = ?", automation.ID, automation.Revision).
			Updates(map[string]any{
				"trigger_cursor": event.GetEventId(), "last_triggered_at": now,
				"last_run_status": "queued", "last_error": "", "updated_at": now,
			}).Error
	}
	return nil
}

type automationEventSpec struct {
	Match       string   `json:"match"`
	Value       string   `json:"value"`
	ChatID      string   `json:"chat_id,omitempty"`
	MessageType string   `json:"message_type,omitempty"`
	FileToken   string   `json:"file_token,omitempty"`
	Events      []string `json:"events,omitempty"`
}

func automationMatchesEvent(
	automation *persistence.ChannelAutomation,
	event *model.NormalizedInboundEvent,
) bool {
	var spec automationEventSpec
	raw := strings.TrimSpace(automation.TriggerValue)
	if strings.HasPrefix(raw, "{") {
		if err := json.Unmarshal([]byte(raw), &spec); err != nil {
			return false
		}
	} else if automation.TriggerType == "message" {
		spec = automationEventSpec{Match: "contains", Value: raw}
	} else {
		spec = automationEventSpec{FileToken: raw}
	}
	if spec.ChatID != "" && spec.ChatID != event.GetChatId() {
		return false
	}
	if spec.MessageType != "" && spec.MessageType != event.GetMessageType() {
		return false
	}
	if automation.TriggerType == "document" {
		token := event.GetMetadata()["file_token"]
		eventName := event.GetMetadata()["document_event"]
		if spec.FileToken != "" && spec.FileToken != token {
			return false
		}
		if len(spec.Events) > 0 && !containsString(spec.Events, eventName) {
			return false
		}
		return token != ""
	}
	target := event.GetText() + "\n" + event.GetContentJson()
	switch firstNonEmpty(strings.ToLower(spec.Match), "contains") {
	case "equals":
		return strings.EqualFold(strings.TrimSpace(target), strings.TrimSpace(spec.Value))
	case "regex":
		pattern, err := regexp.Compile(spec.Value)
		return err == nil && pattern.MatchString(target)
	default:
		return strings.Contains(strings.ToLower(target), strings.ToLower(spec.Value))
	}
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}
