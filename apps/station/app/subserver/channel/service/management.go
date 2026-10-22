package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"gorm.io/gorm"
)

type RouteView struct {
	ID        string
	BindingID string
	ChatID    string
	ChatName  string
	AgentID   string
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type AutomationView struct {
	ID                string
	BindingID         string
	TriggerType       string
	TriggerValue      string
	ActionPrompt      string
	AgentID           string
	DestinationChatID string
	Enabled           bool
	Revision          uint64
	NextDueAt         *time.Time
	LastTriggeredAt   *time.Time
	LastRunStatus     string
	LastRunAt         *time.Time
	LastError         string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type ChatView struct {
	ChatID         string
	Name           string
	ChatType       string
	LastSenderName string
	LastMessageAt  time.Time
}

type DiagnosticView struct {
	ID           string
	BindingID    string
	Direction    string
	Phase        string
	MessageType  string
	Summary      string
	SenderID     string
	SenderName   string
	TargetID     string
	ChatType     string
	TurnID       string
	DeliveryID   string
	ErrorCode    string
	ErrorMessage string
	OccurredAt   time.Time
	LatencyMS    int64
}

type ChannelStats struct {
	TotalInbound     int64
	TotalOutbound    int64
	TotalErrors      int64
	TodayInbound     int64
	TodayOutbound    int64
	AverageLatencyMS int64
}

type ManagementService struct {
	db       *gorm.DB
	bindings *BindingService
}

func NewManagementService(db *gorm.DB, bindings *BindingService) *ManagementService {
	return &ManagementService{db: db, bindings: bindings}
}

func (s *ManagementService) UpsertRoute(
	ctx context.Context,
	actorPTID string,
	view RouteView,
) (RouteView, error) {
	if _, err := s.bindings.loadForActor(actorPTID, view.BindingID); err != nil {
		return RouteView{}, err
	}
	view.ChatID = strings.TrimSpace(view.ChatID)
	view.AgentID = strings.TrimSpace(view.AgentID)
	if view.ChatID == "" || view.AgentID == "" {
		return RouteView{}, fmt.Errorf("%w: chat and agent are required", ErrInvalidBinding)
	}
	now := time.Now().UTC()
	if strings.TrimSpace(view.ID) == "" {
		view.ID = newBindingID()
	}
	var record persistence.ChannelRoute
	err := s.db.WithContext(ctx).
		Where("id = ? AND binding_id = ?", view.ID, view.BindingID).
		First(&record).Error
	switch {
	case err == nil:
		record.ChatID = view.ChatID
		record.ChatName = strings.TrimSpace(view.ChatName)
		record.AgentID = view.AgentID
		record.Enabled = view.Enabled
		record.UpdatedAt = now
		if err := s.db.WithContext(ctx).Save(&record).Error; err != nil {
			return RouteView{}, fmt.Errorf("update channel route: %w", err)
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		record = persistence.ChannelRoute{
			ID: view.ID, BindingID: view.BindingID, ChatID: view.ChatID,
			ChatName: strings.TrimSpace(view.ChatName), AgentID: view.AgentID,
			Enabled: view.Enabled, CreatedAt: now, UpdatedAt: now,
		}
		if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
			return RouteView{}, fmt.Errorf("create channel route: %w", err)
		}
	default:
		return RouteView{}, fmt.Errorf("load channel route: %w", err)
	}
	return routeView(record), nil
}

func (s *ManagementService) DeleteRoute(
	ctx context.Context,
	actorPTID, bindingID, routeID string,
) error {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return err
	}
	result := s.db.WithContext(ctx).
		Where("id = ? AND binding_id = ?", routeID, bindingID).
		Delete(&persistence.ChannelRoute{})
	if result.Error != nil {
		return fmt.Errorf("delete channel route: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return ErrBindingNotFound
	}
	return nil
}

func (s *ManagementService) ListRoutes(
	ctx context.Context,
	actorPTID, bindingID string,
) ([]RouteView, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return nil, err
	}
	var records []persistence.ChannelRoute
	if err := s.db.WithContext(ctx).Where("binding_id = ?", bindingID).
		Order("created_at ASC").Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list channel routes: %w", err)
	}
	views := make([]RouteView, 0, len(records))
	for _, record := range records {
		views = append(views, routeView(record))
	}
	return views, nil
}

func (s *ManagementService) AgentForChat(
	ctx context.Context,
	bindingID, chatID, fallbackAgentID string,
) (string, error) {
	var route persistence.ChannelRoute
	err := s.db.WithContext(ctx).
		Where("binding_id = ? AND chat_id = ? AND enabled = ?", bindingID, chatID, true).
		First(&route).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fallbackAgentID, nil
	}
	if err != nil {
		return "", fmt.Errorf("resolve channel route: %w", err)
	}
	return route.AgentID, nil
}

func (s *ManagementService) UpsertAutomation(
	ctx context.Context,
	actorPTID string,
	view AutomationView,
) (AutomationView, error) {
	if _, err := s.bindings.loadForActor(actorPTID, view.BindingID); err != nil {
		return AutomationView{}, err
	}
	view.TriggerType = strings.TrimSpace(view.TriggerType)
	view.TriggerValue = strings.TrimSpace(view.TriggerValue)
	view.ActionPrompt = strings.TrimSpace(view.ActionPrompt)
	view.AgentID = strings.TrimSpace(view.AgentID)
	view.DestinationChatID = strings.TrimSpace(view.DestinationChatID)
	if !validTriggerType(view.TriggerType) || view.TriggerValue == "" ||
		view.ActionPrompt == "" || view.AgentID == "" || view.DestinationChatID == "" {
		return AutomationView{}, fmt.Errorf("%w: automation is incomplete", ErrInvalidBinding)
	}
	now := time.Now().UTC()
	var nextDueAt *time.Time
	missedWindowSecs := int64(defaultAutomationMissedWindow.Seconds())
	if view.TriggerType == "schedule" && view.Enabled {
		_, next, window, err := parseAutomationSchedule(view.TriggerValue, now)
		if err != nil {
			return AutomationView{}, fmt.Errorf("%w: %v", ErrInvalidBinding, err)
		}
		nextDueAt = &next
		missedWindowSecs = int64(window.Seconds())
	}
	if strings.TrimSpace(view.ID) == "" {
		view.ID = newBindingID()
	}
	var record persistence.ChannelAutomation
	err := s.db.WithContext(ctx).
		Where("id = ? AND binding_id = ?", view.ID, view.BindingID).
		First(&record).Error
	switch {
	case err == nil:
		sameSchedule := record.TriggerType == view.TriggerType &&
			record.TriggerValue == view.TriggerValue && record.Enabled && view.Enabled &&
			record.NextDueAt != nil
		previousNextDueAt := record.NextDueAt
		record.TriggerType = view.TriggerType
		record.TriggerValue = view.TriggerValue
		record.ActionPrompt = view.ActionPrompt
		record.AgentID = view.AgentID
		record.DestinationChatID = view.DestinationChatID
		record.Enabled = view.Enabled
		record.Revision++
		record.NextDueAt = nextDueAt
		record.MissedWindowSecs = missedWindowSecs
		if sameSchedule {
			record.NextDueAt = previousNextDueAt
		}
		if !view.Enabled {
			record.LastRunStatus = "paused"
		}
		record.UpdatedAt = now
		if err := s.db.WithContext(ctx).Save(&record).Error; err != nil {
			return AutomationView{}, fmt.Errorf("update channel automation: %w", err)
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		record = persistence.ChannelAutomation{
			ID: view.ID, BindingID: view.BindingID,
			TriggerType: view.TriggerType, TriggerValue: view.TriggerValue,
			ActionPrompt: view.ActionPrompt, AgentID: view.AgentID,
			DestinationChatID: view.DestinationChatID, Enabled: view.Enabled,
			Revision: 1, NextDueAt: nextDueAt, MissedWindowSecs: missedWindowSecs,
			LastRunStatus: "never", CreatedAt: now, UpdatedAt: now,
		}
		if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
			return AutomationView{}, fmt.Errorf("create channel automation: %w", err)
		}
	default:
		return AutomationView{}, fmt.Errorf("load channel automation: %w", err)
	}
	return automationView(record), nil
}

func (s *ManagementService) DeleteAutomation(
	ctx context.Context,
	actorPTID, bindingID, automationID string,
) error {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return err
	}
	result := s.db.WithContext(ctx).
		Where("id = ? AND binding_id = ?", automationID, bindingID).
		Delete(&persistence.ChannelAutomation{})
	if result.Error != nil {
		return fmt.Errorf("delete channel automation: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return ErrBindingNotFound
	}
	return nil
}

func (s *ManagementService) ListAutomations(
	ctx context.Context,
	actorPTID, bindingID string,
) ([]AutomationView, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return nil, err
	}
	var records []persistence.ChannelAutomation
	if err := s.db.WithContext(ctx).Where("binding_id = ?", bindingID).
		Order("created_at ASC").Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list channel automations: %w", err)
	}
	views := make([]AutomationView, 0, len(records))
	for _, record := range records {
		views = append(views, automationView(record))
	}
	return views, nil
}

func (s *ManagementService) Automation(
	ctx context.Context,
	actorPTID, bindingID, automationID string,
) (*persistence.ChannelAutomation, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return nil, err
	}
	var record persistence.ChannelAutomation
	err := s.db.WithContext(ctx).
		Where("id = ? AND binding_id = ?", automationID, bindingID).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrBindingNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load channel automation: %w", err)
	}
	return &record, nil
}

func (s *ManagementService) UpsertChat(
	ctx context.Context,
	bindingID, chatID, chatName, chatType, senderName string,
	observedAt time.Time,
) error {
	if strings.TrimSpace(chatID) == "" {
		return nil
	}
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}
	var record persistence.ChannelChat
	err := s.db.WithContext(ctx).
		Where("binding_id = ? AND chat_id = ?", bindingID, chatID).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		record = persistence.ChannelChat{
			ID: newBindingID(), BindingID: bindingID, ChatID: chatID,
			Name: strings.TrimSpace(chatName), ChatType: chatType,
			LastSenderName: strings.TrimSpace(senderName),
			LastMessageAt:  observedAt, CreatedAt: observedAt, UpdatedAt: observedAt,
		}
		return s.db.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	updates := map[string]any{
		"chat_type": chatType, "last_sender_name": strings.TrimSpace(senderName),
		"last_message_at": observedAt, "updated_at": observedAt,
	}
	if strings.TrimSpace(chatName) != "" {
		updates["name"] = strings.TrimSpace(chatName)
	}
	return s.db.WithContext(ctx).Model(&record).Updates(updates).Error
}

func (s *ManagementService) ListChats(
	ctx context.Context,
	actorPTID, bindingID string,
) ([]ChatView, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return nil, err
	}
	var records []persistence.ChannelChat
	if err := s.db.WithContext(ctx).Where("binding_id = ?", bindingID).
		Order("last_message_at DESC").Limit(200).Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list channel chats: %w", err)
	}
	views := make([]ChatView, 0, len(records))
	for _, record := range records {
		views = append(views, ChatView{
			ChatID: record.ChatID, Name: record.Name, ChatType: record.ChatType,
			LastSenderName: record.LastSenderName, LastMessageAt: record.LastMessageAt,
		})
	}
	return views, nil
}

func (s *ManagementService) RecordDiagnostic(
	ctx context.Context,
	event DiagnosticView,
) error {
	event.Summary = redactDiagnostic(event.Summary)
	event.ErrorMessage = redactDiagnostic(event.ErrorMessage)
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	return s.db.WithContext(ctx).Create(&persistence.ChannelDiagnosticEvent{
		ID: newBindingID(), BindingID: event.BindingID, Direction: event.Direction,
		Phase: event.Phase, MessageType: event.MessageType, Summary: event.Summary,
		SenderID: event.SenderID, SenderName: event.SenderName, TargetID: event.TargetID,
		ChatType: event.ChatType, TurnID: event.TurnID, DeliveryID: event.DeliveryID,
		ErrorCode: event.ErrorCode, ErrorMessage: event.ErrorMessage,
		OccurredAt: event.OccurredAt, LatencyMS: event.LatencyMS,
		CreatedAt: time.Now().UTC(),
	}).Error
}

func (s *ManagementService) ListDiagnostics(
	ctx context.Context,
	actorPTID, bindingID string,
	limit, offset int,
) ([]DiagnosticView, int64, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	var total int64
	if err := s.db.WithContext(ctx).Model(&persistence.ChannelDiagnosticEvent{}).
		Where("binding_id = ?", bindingID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []persistence.ChannelDiagnosticEvent
	if err := s.db.WithContext(ctx).Where("binding_id = ?", bindingID).
		Order("occurred_at DESC").Limit(limit).Offset(offset).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	views := make([]DiagnosticView, 0, len(records))
	for _, record := range records {
		views = append(views, DiagnosticView{
			ID: record.ID, BindingID: record.BindingID, Direction: record.Direction,
			Phase: record.Phase, MessageType: record.MessageType, Summary: record.Summary,
			SenderID: record.SenderID, SenderName: record.SenderName, TargetID: record.TargetID,
			ChatType: record.ChatType, TurnID: record.TurnID, DeliveryID: record.DeliveryID,
			ErrorCode: record.ErrorCode, ErrorMessage: record.ErrorMessage,
			OccurredAt: record.OccurredAt, LatencyMS: record.LatencyMS,
		})
	}
	return views, total, nil
}

func (s *ManagementService) Stats(
	ctx context.Context,
	actorPTID, bindingID string,
) (ChannelStats, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return ChannelStats{}, err
	}
	var stats ChannelStats
	base := s.db.WithContext(ctx).Model(&persistence.ChannelDiagnosticEvent{}).
		Where("binding_id = ?", bindingID)
	if err := base.Where("direction = ?", "inbound").Count(&stats.TotalInbound).Error; err != nil {
		return stats, err
	}
	if err := base.Where("direction = ?", "outbound").Count(&stats.TotalOutbound).Error; err != nil {
		return stats, err
	}
	if err := base.Where("phase = ?", "failed").Count(&stats.TotalErrors).Error; err != nil {
		return stats, err
	}
	start := time.Now().UTC().Truncate(24 * time.Hour)
	_ = base.Where("direction = ? AND occurred_at >= ?", "inbound", start).
		Count(&stats.TodayInbound).Error
	_ = base.Where("direction = ? AND occurred_at >= ?", "outbound", start).
		Count(&stats.TodayOutbound).Error
	var average struct{ Value float64 }
	_ = base.Select("COALESCE(AVG(latency_ms), 0) AS value").
		Where("latency_ms > 0").Scan(&average).Error
	stats.AverageLatencyMS = int64(average.Value)
	return stats, nil
}

func (s *ManagementService) ExportDiagnostics(
	ctx context.Context,
	actorPTID, bindingID string,
) ([]byte, error) {
	binding, err := s.bindings.Get(ctx, actorPTID, bindingID)
	if err != nil {
		return nil, err
	}
	events, _, err := s.ListDiagnostics(ctx, actorPTID, bindingID, 200, 0)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(map[string]any{
		"binding": map[string]any{
			"id": binding.ID, "provider": binding.ProviderKind,
			"app_id_suffix": redactedAppID(binding.ProviderAppID),
			"state":         binding.ConnectionState, "region": binding.Region,
		},
		"events":      events,
		"exported_at": time.Now().UTC(),
	}, "", "  ")
}

func routeView(record persistence.ChannelRoute) RouteView {
	return RouteView{
		ID: record.ID, BindingID: record.BindingID, ChatID: record.ChatID,
		ChatName: record.ChatName, AgentID: record.AgentID, Enabled: record.Enabled,
		CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt,
	}
}

func automationView(record persistence.ChannelAutomation) AutomationView {
	return AutomationView{
		ID: record.ID, BindingID: record.BindingID,
		TriggerType: record.TriggerType, TriggerValue: record.TriggerValue,
		ActionPrompt: record.ActionPrompt, AgentID: record.AgentID,
		DestinationChatID: record.DestinationChatID, Enabled: record.Enabled,
		Revision: record.Revision, NextDueAt: record.NextDueAt,
		LastTriggeredAt: record.LastTriggeredAt,
		LastRunStatus:   record.LastRunStatus, LastRunAt: record.LastRunAt,
		LastError: record.LastError, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt,
	}
}

func validTriggerType(value string) bool {
	return value == "schedule" || value == "message" || value == "document"
}

func redactDiagnostic(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 500 {
		value = value[:500]
	}
	for _, marker := range []string{"app_secret", "access_token", "refresh_token"} {
		if strings.Contains(strings.ToLower(value), marker) {
			return "[redacted]"
		}
	}
	return value
}

func redactedAppID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 6 {
		return "***"
	}
	return "***" + value[len(value)-6:]
}
