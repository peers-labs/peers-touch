package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
	"gorm.io/gorm"
)

func (b *DurableBridge) HandleCardAction(
	ctx context.Context,
	pluginID string,
	action *model.CardActionEvent,
) (*model.CardActionAck, error) {
	if action == nil || strings.TrimSpace(action.GetActionId()) == "" ||
		strings.TrimSpace(action.GetBindingId()) == "" {
		return nil, fmt.Errorf("%w: incomplete card action", ErrInvalidBinding)
	}
	binding, err := b.bindings.GetRecord(ctx, action.GetBindingId())
	if err != nil {
		return nil, err
	}
	if binding.PluginID != strings.TrimSpace(pluginID) {
		return nil, fmt.Errorf("%w: plugin does not own binding", ErrInvalidBinding)
	}
	var existing persistence.ChannelCardAction
	err = b.db.WithContext(ctx).Where("action_id = ?", action.GetActionId()).
		First(&existing).Error
	if err == nil {
		return &model.CardActionAck{
			Ok: existing.Status == "applied", Toast: existing.Result,
			ErrorCode: existing.Status,
		}, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	allowed, _, err := b.management.AuthorizeSender(
		ctx, binding, action.GetOpenId(), "",
	)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return &model.CardActionAck{
			Ok: false, Toast: "This action is not authorized.",
			ErrorCode: "unauthorized",
		}, nil
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(action.GetValueJson()), &value); err != nil {
		return nil, fmt.Errorf("%w: invalid card action value", ErrInvalidBinding)
	}
	turnID := mapString(value, "turn_id")
	approvalID := mapString(value, "approval_id")
	decision := firstNonEmpty(mapString(value, "decision"), action.GetAction())
	idempotencyKey := "lark-action:" + sanitizeToken(action.GetActionId())
	resultText := "Action applied."
	applyErr := error(nil)
	if decision == "cancel" || decision == "approve" || decision == "approved" ||
		decision == "deny" || decision == "denied" || decision == "reject" ||
		decision == "positive_feedback" || decision == "negative_feedback" {
		applyErr = b.validateCardActionTarget(
			ctx, binding, action, value, turnID, approvalID,
		)
	}
	switch decision {
	case "cancel":
		if applyErr == nil {
			applyErr = b.executor.CancelTurn(ctx, binding.ActorPTID, turnID)
		}
		resultText = "Cancellation requested."
	case "approve", "approved":
		if applyErr == nil {
			applyErr = b.executor.SubmitToolDecision(
				ctx, binding.ActorPTID, ToolDecisionInput{
					TurnID: turnID, ApprovalID: approvalID,
					ToolCallID:       mapString(value, "tool_call_id"),
					DecisionID:       firstNonEmpty(mapString(value, "decision_id"), action.GetActionId()),
					ExpectedRevision: mapUint64(value, "expected_revision"),
					Approved:         true, IdempotencyKey: idempotencyKey,
				},
			)
		}
		resultText = "Approved."
	case "deny", "denied", "reject":
		if applyErr == nil {
			applyErr = b.executor.SubmitToolDecision(
				ctx, binding.ActorPTID, ToolDecisionInput{
					TurnID: turnID, ApprovalID: approvalID,
					ToolCallID:       mapString(value, "tool_call_id"),
					DecisionID:       firstNonEmpty(mapString(value, "decision_id"), action.GetActionId()),
					ExpectedRevision: mapUint64(value, "expected_revision"),
					Approved:         false, IdempotencyKey: idempotencyKey,
				},
			)
		}
		resultText = "Declined."
	case "positive_feedback", "negative_feedback":
		if applyErr == nil {
			applyErr = b.recordCardFeedback(
				ctx,
				binding,
				turnID,
				decision == "positive_feedback",
				idempotencyKey,
			)
		}
		resultText = "Feedback recorded."
	default:
		applyErr = fmt.Errorf("unsupported action")
	}
	now := time.Now().UTC()
	status := "applied"
	errorCode := ""
	if applyErr != nil {
		status = "failed"
		errorCode = "action_failed"
		resultText = "This action is no longer available."
	}
	record := persistence.ChannelCardAction{
		ID: newBindingID(), BindingID: binding.ID, ActionID: action.GetActionId(),
		ProviderUserID: action.GetOpenId(), MessageID: action.GetMessageId(),
		Action: decision, ValueJSON: action.GetValueJson(), Status: status,
		Result: resultText, CreatedAt: now, UpdatedAt: now,
	}
	if err := b.db.WithContext(ctx).Create(&record).Error; err != nil {
		var raced persistence.ChannelCardAction
		if getErr := b.db.WithContext(ctx).Where("action_id = ?", action.GetActionId()).
			First(&raced).Error; getErr == nil {
			return &model.CardActionAck{
				Ok: raced.Status == "applied", Toast: raced.Result,
				ErrorCode: raced.Status,
			}, nil
		}
		return nil, err
	}
	return &model.CardActionAck{
		Ok: applyErr == nil, Toast: resultText, ErrorCode: errorCode,
	}, nil
}

func (b *DurableBridge) recordCardFeedback(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	turnID string,
	positive bool,
	idempotencyKey string,
) error {
	if b.executor == nil {
		return fmt.Errorf("turn feedback is unavailable")
	}
	var inbound persistence.ChannelInboundEvent
	if err := b.db.WithContext(ctx).
		Where("binding_id = ? AND turn_id = ?", binding.ID, turnID).
		First(&inbound).Error; err != nil {
		return fmt.Errorf("turn feedback target not found")
	}
	return b.executor.RecordFeedback(
		ctx,
		binding.ActorPTID,
		TurnFeedbackInput{
			TurnID: turnID, ConversationID: inbound.ConversationID,
			AgentID: inbound.AgentID, Positive: positive,
			IdempotencyKey: idempotencyKey,
		},
	)
}

func (b *DurableBridge) validateCardActionTarget(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	action *model.CardActionEvent,
	value map[string]any,
	turnID, approvalID string,
) error {
	if b.executor == nil || turnID == "" {
		return fmt.Errorf("turn action is no longer available")
	}
	var inbound persistence.ChannelInboundEvent
	if err := b.db.WithContext(ctx).
		Where("binding_id = ? AND turn_id = ?", binding.ID, turnID).
		First(&inbound).Error; err != nil {
		return fmt.Errorf("turn action target not found")
	}
	expectedActor := strings.TrimSpace(inbound.SenderID)
	if expectedActor == "automation" {
		expectedActor = strings.TrimSpace(binding.OwnerProviderUserID)
	}
	if expectedActor == "" || expectedActor != strings.TrimSpace(action.GetOpenId()) {
		return fmt.Errorf("card action actor does not own this turn")
	}
	var delivery persistence.ChannelDeliveryIntent
	if err := b.db.WithContext(ctx).
		Where("inbound_id = ? AND intent_kind = ?", inbound.ID, "turn_reply").
		First(&delivery).Error; err != nil {
		return fmt.Errorf("turn action delivery not found")
	}
	if delivery.ProviderMessageID == "" ||
		delivery.ProviderMessageID != strings.TrimSpace(action.GetMessageId()) {
		return fmt.Errorf("card action message does not match the current turn card")
	}
	snapshot, err := b.executor.Snapshot(
		ctx, binding.ActorPTID, inbound.ConversationID, turnID,
	)
	if err != nil {
		return err
	}
	if snapshot.Revision != mapUint64(value, "snapshot_revision") {
		return fmt.Errorf("turn card revision is stale")
	}
	if approvalID != "" {
		if snapshot.Pending == nil ||
			snapshot.Pending.Kind != "approval" ||
			snapshot.Pending.InteractionID != approvalID ||
			snapshot.Pending.ToolCallID != mapString(value, "tool_call_id") ||
			snapshot.Pending.ExpectedRevision != mapUint64(value, "expected_revision") {
			return fmt.Errorf("approval action no longer matches the pending tool")
		}
	}
	return nil
}

func mapString(value map[string]any, key string) string {
	text, _ := value[key].(string)
	return strings.TrimSpace(text)
}

func mapUint64(value map[string]any, key string) uint64 {
	number, _ := value[key].(float64)
	if number <= 0 {
		return 0
	}
	return uint64(number)
}
