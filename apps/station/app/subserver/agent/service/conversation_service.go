package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type ConversationService struct{}

func NewConversationService() *ConversationService {
	return &ConversationService{}
}

func (s *ConversationService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName("agent"))
}

func (s *ConversationService) ListConversations(ctx context.Context, agentID, userID, statusFilter string, page, pageSize int) ([]*domain.Conversation, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, 0, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agent_id is required", nil)
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	query := db.WithContext(ctx).Model(&persistence.Conversation{}).Where("agent_id = ?", agentID)
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	status := strings.TrimSpace(statusFilter)
	if status != "" {
		query = query.Where("status = ?", status)
	} else {
		query = query.Where("status != ?", "deleted")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to count conversations", err)
	}

	var rows []persistence.Conversation
	if err := query.Order("updated_at DESC").
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list conversations", err)
	}

	result := make([]*domain.Conversation, 0, len(rows))
	for i := range rows {
		result = append(result, persistenceConversationToDomain(&rows[i]))
	}
	return result, total, nil
}

func (s *ConversationService) GetConversation(ctx context.Context, conversationID string) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}
	var row persistence.Conversation
	if err := db.WithContext(ctx).Where("id = ?", conversationID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get conversation", err)
	}
	return persistenceConversationToDomain(&row), nil
}

func (s *ConversationService) CreateConversation(ctx context.Context, agentID, userID, title, description, modelName, providerID string) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agent_id is required", nil)
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "New Chat"
	}

	now := time.Now()
	row := &persistence.Conversation{
		ID:         generateID("conv"),
		AgentID:    agentID,
		UserID:     strings.TrimSpace(userID),
		Title:      title,
		ProviderID: firstNonEmpty(providerID, ""),
		Status:     string(domain.ConversationStatusActive),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if description != "" {
		row.Description = &description
	}
	if modelName != "" {
		row.ModelName = &modelName
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create conversation", err)
	}
	logger.Infof(ctx, "conversation created: conv_id=%s agent_id=%s user_id=%s", row.ID, agentID, userID)
	return persistenceConversationToDomain(row), nil
}

func (s *ConversationService) CreateConversationWithID(ctx context.Context, conversationID, agentID, userID, title, description, modelName, providerID string) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	agentID = strings.TrimSpace(agentID)
	if conversationID == "" {
		return s.CreateConversation(ctx, agentID, userID, title, description, modelName, providerID)
	}
	if agentID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agent_id is required", nil)
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "New Chat"
	}
	now := time.Now()
	row := &persistence.Conversation{
		ID:         conversationID,
		AgentID:    agentID,
		UserID:     strings.TrimSpace(userID),
		Title:      title,
		ProviderID: firstNonEmpty(providerID, ""),
		Status:     string(domain.ConversationStatusActive),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if description != "" {
		row.Description = &description
	}
	if modelName != "" {
		row.ModelName = &modelName
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create conversation", err)
	}
	logger.Infof(ctx, "conversation created with id: conv_id=%s agent_id=%s user_id=%s", row.ID, agentID, userID)
	return persistenceConversationToDomain(row), nil
}

func (s *ConversationService) UpdateConversation(ctx context.Context, conversationID, title, description, modelName string, meta map[string]string) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}

	updates := map[string]interface{}{"updated_at": time.Now()}
	if strings.TrimSpace(title) != "" {
		updates["title"] = title
	}
	if description != "" {
		updates["description"] = description
	}
	if strings.TrimSpace(modelName) != "" {
		updates["model_name"] = modelName
	}
	if len(meta) > 0 {
		metaJSON, _ := json.Marshal(meta)
		updates["meta"] = metaJSON
	}

	if err := db.WithContext(ctx).Model(&persistence.Conversation{}).Where("id = ?", conversationID).Updates(updates).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update conversation", err)
	}
	return s.GetConversation(ctx, conversationID)
}

// SetMessageTranslation persists a translation for an existing message by
// merging it into the message's metadata_json column (R10). Passing an empty
// translation clears it. No proto/schema change — translation lives in metadata.
func (s *ConversationService) SetMessageTranslation(ctx context.Context, messageID, translation string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "message_id is required", nil)
	}

	var row persistence.AgentMessage
	if err := db.WithContext(ctx).Where("id = ?", messageID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusNotFound, "message not found", err)
		}
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load message", err)
	}

	meta := map[string]interface{}{}
	if len(row.MetadataJSON) > 0 {
		_ = json.Unmarshal(row.MetadataJSON, &meta)
	}
	if strings.TrimSpace(translation) == "" {
		delete(meta, "translation")
	} else {
		meta["translation"] = translation
	}
	metaJSON, _ := json.Marshal(meta)

	if err := db.WithContext(ctx).Model(&persistence.AgentMessage{}).Where("id = ?", messageID).
		Updates(map[string]interface{}{"metadata_json": metaJSON, "updated_at": time.Now()}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update message translation", err)
	}
	return nil
}

func (s *ConversationService) ArchiveConversation(ctx context.Context, conversationID string, permanent bool) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}
	status := string(domain.ConversationStatusArchived)
	if permanent {
		status = "deleted"
	}
	if err := db.WithContext(ctx).Model(&persistence.Conversation{}).
		Where("id = ?", conversationID).
		Updates(map[string]interface{}{"status": status, "updated_at": time.Now()}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to archive conversation", err)
	}
	logger.Infof(ctx, "conversation archived: conv_id=%s permanent=%v", conversationID, permanent)
	return nil
}

func (s *ConversationService) ListMessages(ctx context.Context, conversationID string, afterSeq, beforeSeq int64, limit int) ([]*domain.Message, int64, bool, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, false, err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, 0, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	query := db.WithContext(ctx).Model(&persistence.AgentMessage{}).Where("conversation_id = ?", conversationID)
	if afterSeq > 0 {
		query = query.Where("seq > ?", afterSeq)
	}
	if beforeSeq > 0 {
		query = query.Where("seq < ?", beforeSeq)
	}

	var rows []persistence.AgentMessage
	if err := query.Order("seq ASC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return nil, 0, false, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list messages", err)
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	messages := make([]*domain.Message, 0, len(rows))
	var lastSeq int64
	for i := range rows {
		messages = append(messages, persistenceAgentMessageToDomain(&rows[i]))
		if rows[i].Seq > lastSeq {
			lastSeq = rows[i].Seq
		}
	}
	nextCursor := lastSeq
	if !hasMore {
		nextCursor = 0
	}
	return messages, nextCursor, hasMore, nil
}

func (s *ConversationService) NextSeq(ctx context.Context, conversationID string) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	var maxSeq struct{ MaxSeq int64 }
	db.WithContext(ctx).Model(&persistence.AgentMessage{}).
		Where("conversation_id = ?", conversationID).
		Select("COALESCE(MAX(seq), 0) as max_seq").
		Scan(&maxSeq)

	var maxEventSeq struct{ MaxSeq int64 }
	db.WithContext(ctx).Model(&persistence.TurnEvent{}).
		Where("conversation_id = ?", conversationID).
		Select("COALESCE(MAX(event_seq), 0) as max_seq").
		Scan(&maxEventSeq)

	next := maxSeq.MaxSeq
	if maxEventSeq.MaxSeq > next {
		next = maxEventSeq.MaxSeq
	}
	return next + 1, nil
}

func (s *ConversationService) PersistTurnEvent(ctx context.Context, conversationID, turnID, eventType string, payload map[string]interface{}) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	seq, err := s.NextSeq(ctx, conversationID)
	if err != nil {
		return 0, err
	}
	payloadBytes, _ := json.Marshal(payload)
	row := &persistence.TurnEvent{
		ID:             generateID("tevt"),
		ConversationID: conversationID,
		TurnID:         turnID,
		EventSeq:       seq,
		EventType:      eventType,
		Payload:        string(payloadBytes),
		CreatedAt:      time.Now(),
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to persist turn event", err)
	}
	return seq, nil
}

func (s *ConversationService) PersistUserMessage(ctx context.Context, conversationID, content, turnID string) (*domain.Message, error) {
	return s.persistMessage(ctx, conversationID, "user", content, "", turnID)
}

func (s *ConversationService) PersistAssistantMessage(ctx context.Context, conversationID, content, modelName, turnID string) (*domain.Message, error) {
	return s.persistMessage(ctx, conversationID, "assistant", content, modelName, turnID)
}

func (s *ConversationService) persistMessage(ctx context.Context, conversationID, role, content, modelName, turnID string) (*domain.Message, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}

	var maxSeq struct{ MaxSeq int64 }
	db.WithContext(ctx).Model(&persistence.AgentMessage{}).
		Where("conversation_id = ?", conversationID).
		Select("COALESCE(MAX(seq), 0) as max_seq").
		Scan(&maxSeq)

	row := &persistence.AgentMessage{
		ID:             generateID("amsg"),
		ConversationID: conversationID,
		Role:           role,
		Content:        &content,
		Seq:            maxSeq.MaxSeq + 1,
	}
	if modelName != "" {
		row.ModelName = &modelName
	}
	if turnID != "" {
		row.TurnID = &turnID
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to persist message", err)
	}
	if err := db.WithContext(ctx).Model(&persistence.Conversation{}).Where("id = ?", conversationID).
		Updates(map[string]interface{}{"updated_at": time.Now()}).Error; err != nil {
		logger.Warnf(ctx, "failed to update conversation timestamp: %v", err)
	}
	return persistenceAgentMessageToDomain(row), nil
}

func (s *ConversationService) ReplayTurnEvents(ctx context.Context, conversationID string, afterSeq int64) ([]*persistence.TurnEvent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.TurnEvent
	query := db.WithContext(ctx).Where("conversation_id = ?", conversationID)
	if afterSeq > 0 {
		query = query.Where("event_seq > ?", afterSeq)
	}
	if err := query.Order("event_seq ASC").Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to replay turn events", err)
	}
	result := make([]*persistence.TurnEvent, len(rows))
	for i := range rows {
		result[i] = &rows[i]
	}
	return result, nil
}

func persistenceConversationToDomain(row *persistence.Conversation) *domain.Conversation {
	c := &domain.Conversation{
		ConversationID: row.ID,
		AgentID:        row.AgentID,
		UserID:         row.UserID,
		Title:          row.Title,
		ProviderID:     row.ProviderID,
		Status:         domain.ConversationStatus(row.Status),
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.Description != nil {
		c.Description = *row.Description
	}
	if row.ModelName != nil {
		c.ModelName = *row.ModelName
	}
	if row.ParentID != nil {
		c.ParentID = *row.ParentID
	}
	if len(row.Meta) > 0 {
		_ = json.Unmarshal(row.Meta, &c.Meta)
	}
	if len(row.ConfigJSON) > 0 {
		c.ConfigJSON = row.ConfigJSON
	}
	return c
}

func persistenceAgentMessageToDomain(row *persistence.AgentMessage) *domain.Message {
	m := &domain.Message{
		MessageID:      row.ID,
		ConversationID: row.ConversationID,
		ModelName:      "",
		Role:           domain.MessageRole(row.Role),
		Content:        "",
		ReasoningJSON:  row.ReasoningJSON,
		ToolCallsJSON:  row.ToolCallsJSON,
		MetadataJSON:   row.MetadataJSON,
		ErrorJSON:      row.ErrorJSON,
		Seq:            row.Seq,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.TurnID != nil {
		m.TurnID = *row.TurnID
	}
	if row.ModelName != nil {
		m.ModelName = *row.ModelName
	}
	if row.Content != nil {
		m.Content = *row.Content
	}
	if row.BranchID != nil {
		m.BranchID = *row.BranchID
	}
	if row.ReplacesMessageID != nil {
		m.ReplacesMessageID = *row.ReplacesMessageID
	}
	if row.ThreadID != nil {
		m.ThreadID = *row.ThreadID
	}
	return m
}
