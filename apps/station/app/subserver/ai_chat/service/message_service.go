package service

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/errcode"
	dbModel "github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

func ListMessages(ctx context.Context, req *model.ListMessagesRequest) ([]*model.ChatMessage, error) {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	pageSize := int(req.GetPageSize())
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 50
	}
	query := rds.Model(&dbModel.Message{}).Where("session_id = ?", req.GetSessionId()).Order("created_at asc").Limit(pageSize)
	if req.GetTopicId() != "" {
		query = query.Where("topic_id = ?", req.GetTopicId())
	}
	var rows []dbModel.Message
	if err := query.Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to list messages", err)
	}
	result := make([]*model.ChatMessage, 0, len(rows))
	for i := range rows {
		result = append(result, toProtoMessage(&rows[i]))
	}
	return result, nil
}

func GetMessage(ctx context.Context, messageID string) (*model.ChatMessage, error) {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	var row dbModel.Message
	if err := rds.Joins("JOIN ai_chat_sessions ON ai_chat_sessions.id = ai_chat_messages.session_id").
		Where("ai_chat_messages.id = ? AND ai_chat_sessions.user_id = ?", messageID, subject.ID).
		First(&row).Error; err != nil {
		return nil, errcode.New(errcode.AIChatNotFound, http.StatusNotFound, "message not found", err)
	}
	return toProtoMessage(&row), nil
}

func DeleteMessage(ctx context.Context, messageID string) error {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	if err := rds.Where("id IN (SELECT m.id FROM ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id WHERE m.id = ? AND s.user_id = ?)", messageID, subject.ID).
		Delete(&dbModel.Message{}).Error; err != nil {
		return errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to delete message", err)
	}
	return nil
}

func toProtoMessage(m *dbModel.Message) *model.ChatMessage {
	out := &model.ChatMessage{
		Id:        m.ID,
		SessionId: m.SessionID,
		Role:      parseRole(m.Role),
		CreatedAt: m.CreatedAt.UnixMilli(),
		UpdatedAt: m.UpdatedAt.UnixMilli(),
	}
	if m.TopicID != nil {
		out.TopicId = *m.TopicID
	}
	if m.ModelName != nil {
		out.ModelName = *m.ModelName
	}
	if m.Content != nil {
		out.Content = *m.Content
	}
	out.MetadataJson = string(m.MetadataJSON)
	out.PluginJson = string(m.PluginJSON)
	out.ToolCallsJson = string(m.ToolCallsJSON)
	out.ReasoningJson = string(m.ReasoningJSON)
	out.ErrorJson = string(m.ErrorJSON)
	return out
}

func parseRole(role string) model.ChatRole {
	switch role {
	case "system":
		return model.ChatRole_CHAT_ROLE_SYSTEM
	case "assistant":
		return model.ChatRole_CHAT_ROLE_ASSISTANT
	case "tool":
		return model.ChatRole_CHAT_ROLE_TOOL
	default:
		return model.ChatRole_CHAT_ROLE_USER
	}
}
