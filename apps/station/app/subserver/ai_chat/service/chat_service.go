package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/errcode"
	dbModel "github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

func CompleteChat(ctx context.Context, req *model.ChatCompletionRequest) (*model.ChatCompletionResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	if req.GetSessionId() == "" {
		return nil, errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "session_id is required", nil)
	}
	if _, err := singleUserInput(req); err != nil {
		return nil, err
	}
	idemKey := buildCompletionIdempotencyKey(subject.ID, req)
	return withCompletionIdempotency(idemKey, func() (*model.ChatCompletionResponse, error) {
		return completeChatOnce(ctx, req, subject.ID)
	})
}

func completeChatOnce(ctx context.Context, req *model.ChatCompletionRequest, userID string) (*model.ChatCompletionResponse, error) {
	inputContent, inputErr := singleUserInput(req)
	if inputErr != nil {
		return nil, inputErr
	}
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	now := time.Now()
	contextMessages := make([]*model.ChatMessage, 0, 7)
	var history []dbModel.Message
	if err := rds.Joins("JOIN ai_chat.sessions ON ai_chat.sessions.id = ai_chat.messages.session_id").
		Where("ai_chat.messages.session_id = ? AND ai_chat.sessions.user_id = ?", req.GetSessionId(), userID).
		Order("ai_chat.messages.created_at desc").
		Limit(6).
		Find(&history).Error; err == nil {
		for i := len(history) - 1; i >= 0; i-- {
			content := ""
			if history[i].Content != nil {
				content = *history[i].Content
			}
			contextMessages = append(contextMessages, &model.ChatMessage{
				Id:      history[i].ID,
				Role:    parseRole(history[i].Role),
				Content: content,
			})
		}
	}
	contextMessages = append(contextMessages, &model.ChatMessage{
		Role:    model.ChatRole_CHAT_ROLE_USER,
		Content: inputContent,
	})
	modelName := req.GetModel()
	lastUserContent := inputContent
	var sessionCount int64
	if err := rds.Model(&dbModel.Session{}).Where("id = ? AND user_id = ?", req.GetSessionId(), userID).Count(&sessionCount).Error; err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to query session", err)
	}
	if sessionCount == 0 {
		title := lastUserContent
		if len(title) > 40 {
			title = title[:40]
		}
		if title == "" {
			title = "New Chat"
		}
		newSession := &dbModel.Session{
			ID:         req.GetSessionId(),
			Title:      title,
			ProviderID: "ollama-default",
			UserID:     userID,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := rds.Create(newSession).Error; err != nil {
			return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to create session", err)
		}
	}
	if modelName == "" {
		var session dbModel.Session
		if err := rds.Where("id = ? AND user_id = ?", req.GetSessionId(), userID).First(&session).Error; err == nil {
			if session.ModelName != nil && *session.ModelName != "" {
				modelName = *session.ModelName
			}
		}
	}
	generated, usedModel, err := completeWithProvider(ctx, rds, userID, req.GetSessionId(), contextMessages, modelName)
	if err != nil {
		return nil, errcode.New(errcode.AIChatProviderFailed, http.StatusBadGateway, "provider completion failed", err)
	}
	answer := strings.TrimSpace(generated)
	if answer == "" {
		return nil, errcode.New(errcode.AIChatProviderFailed, http.StatusBadGateway, "empty completion response", nil)
	}
	if usedModel != "" {
		modelName = usedModel
	}
	message := &model.ChatMessage{
		Id:        fmt.Sprintf("msg_%d", now.UnixNano()),
		SessionId: req.GetSessionId(),
		TopicId:   req.GetTopicId(),
		ModelName: modelName,
		Role:      model.ChatRole_CHAT_ROLE_ASSISTANT,
		Content:   answer,
		CreatedAt: now.UnixMilli(),
		UpdatedAt: now.UnixMilli(),
	}
	if lastUserContent != "" {
		userRole := model.ChatRole_CHAT_ROLE_USER.String()
		userID := fmt.Sprintf("msg_%d_u", now.UnixNano())
		userMsg := &dbModel.Message{
			ID:        userID,
			SessionID: req.GetSessionId(),
			Role:      userRole,
			Content:   &lastUserContent,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if req.GetTopicId() != "" {
			t := req.GetTopicId()
			userMsg.TopicID = &t
		}
		if err := rds.Create(userMsg).Error; err != nil {
			return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to save user message", err)
		}
	}
	role := model.ChatRole_CHAT_ROLE_ASSISTANT.String()
	content := answer
	dbMsg := &dbModel.Message{
		ID:        message.Id,
		SessionID: req.GetSessionId(),
		Role:      role,
		Content:   &content,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if modelName != "" {
		m := modelName
		dbMsg.ModelName = &m
	}
	if req.GetTopicId() != "" {
		t := req.GetTopicId()
		dbMsg.TopicID = &t
	}
	if err := rds.Create(dbMsg).Error; err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to save assistant message", err)
	}
	return &model.ChatCompletionResponse{
		Id:      fmt.Sprintf("chatcmpl_%d", now.UnixNano()),
		Object:  "chat.completion",
		Created: now.Unix(),
		Model:   modelName,
		Choices: []*model.ChatChoice{
			{
				Index:   0,
				Message: message,
			},
		},
		Usage: &model.Usage{
			PromptTokens:     0,
			CompletionTokens: 0,
			TotalTokens:      0,
		},
	}, nil
}

func buildCompletionIdempotencyKey(userID string, req *model.ChatCompletionRequest) string {
	latest, err := singleUserInput(req)
	if err != nil {
		latest = ""
	}
	sum := sha256.Sum256([]byte(latest))
	return strings.Join([]string{
		"u=" + userID,
		"s=" + req.GetSessionId(),
		"t=" + req.GetTopicId(),
		"m=" + req.GetModel(),
		"h=" + hex.EncodeToString(sum[:]),
	}, "|")
}

func singleUserInput(req *model.ChatCompletionRequest) (string, error) {
	messages := req.GetMessages()
	if len(messages) != 1 {
		return "", errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "messages must contain exactly one user input", nil)
	}
	msg := messages[0]
	if msg.GetRole() != model.ChatRole_CHAT_ROLE_USER {
		return "", errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "message role must be CHAT_ROLE_USER", nil)
	}
	content := strings.TrimSpace(msg.GetContent())
	if content == "" {
		return "", errcode.New(errcode.AIChatInvalidRequest, http.StatusBadRequest, "message content is required", nil)
	}
	return content, nil
}

func completeWithProvider(ctx context.Context, rds *gorm.DB, userID, sessionID string, contextMessages []*model.ChatMessage, requestedModel string) (string, string, error) {
	if sessionID == "" {
		return "", requestedModel, fmt.Errorf("session id is empty")
	}
	var session dbModel.Session
	if err := rds.Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		return "", requestedModel, err
	}
	var provider dbModel.Provider
	if err := rds.Where("id = ?", session.ProviderID).Order("updated_at desc").First(&provider).Error; err != nil {
		return "", requestedModel, err
	}
	modelName := requestedModel
	if modelName == "" && session.ModelName != nil {
		modelName = *session.ModelName
	}
	if modelName == "" {
		modelName = provider.CheckModel
	}
	if modelName == "" {
		modelName = "llama3.2:latest"
	}
	messages := toLLMMessages(contextMessages)
	if len(messages) == 0 {
		return "", modelName, fmt.Errorf("no context messages")
	}
	baseURL, apiKey := extractProviderConfig(provider)
	if isOllamaProvider(provider) {
		if baseURL == "" {
			baseURL = "http://127.0.0.1:11434"
		}
		answer, err := callOllamaChat(ctx, baseURL, modelName, messages)
		return answer, modelName, err
	}
	if baseURL == "" {
		return "", modelName, fmt.Errorf("provider base url is empty")
	}
	answer, err := callOpenAICompatibleChat(ctx, baseURL, apiKey, modelName, messages)
	return answer, modelName, err
}

func toLLMMessages(input []*model.ChatMessage) []map[string]string {
	out := make([]map[string]string, 0, len(input))
	for _, m := range input {
		content := strings.TrimSpace(m.GetContent())
		if content == "" {
			continue
		}
		role := "user"
		switch m.GetRole() {
		case model.ChatRole_CHAT_ROLE_SYSTEM:
			role = "system"
		case model.ChatRole_CHAT_ROLE_ASSISTANT:
			role = "assistant"
		case model.ChatRole_CHAT_ROLE_TOOL:
			role = "tool"
		default:
			role = "user"
		}
		out = append(out, map[string]string{
			"role":    role,
			"content": content,
		})
	}
	return out
}

func extractProviderConfig(provider dbModel.Provider) (string, string) {
	cfg := map[string]any{}
	_ = json.Unmarshal(provider.Config, &cfg)
	baseURL := asString(cfg["base_url"])
	if baseURL != "" && !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "http://" + baseURL
	}
	rawKeyVault := provider.KeyVaults
	if decoded, ok := decodeMaybeBase64(rawKeyVault); ok {
		rawKeyVault = decoded
	}
	kv := map[string]any{}
	_ = json.Unmarshal([]byte(rawKeyVault), &kv)
	apiKey := asString(kv["api_key"])
	if apiKey == "" {
		apiKey = asString(kv["key"])
	}
	if apiKey == "" {
		apiKey = asString(kv["token"])
	}
	return strings.TrimSpace(baseURL), strings.TrimSpace(apiKey)
}

func isOllamaProvider(provider dbModel.Provider) bool {
	name := strings.ToLower(provider.Name)
	return strings.Contains(name, "ollama") || strings.EqualFold(provider.SourceType, "local")
}

func callOllamaChat(ctx context.Context, baseURL, modelName string, messages []map[string]string) (string, error) {
	endpoint := strings.TrimRight(baseURL, "/") + "/api/chat"
	payload := map[string]any{
		"model":    modelName,
		"messages": messages,
		"stream":   false,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var data struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Response string `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if strings.TrimSpace(data.Message.Content) != "" {
		return data.Message.Content, nil
	}
	if strings.TrimSpace(data.Response) != "" {
		return data.Response, nil
	}
	return "", fmt.Errorf("empty ollama response")
}

func callOpenAICompatibleChat(ctx context.Context, baseURL, apiKey, modelName string, messages []map[string]string) (string, error) {
	endpointBase := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(endpointBase, "/v1") {
		endpointBase = endpointBase + "/chat/completions"
	} else {
		endpointBase = endpointBase + "/v1/chat/completions"
	}
	payload := map[string]any{
		"model":    modelName,
		"messages": messages,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpointBase, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var data struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if len(data.Choices) == 0 || strings.TrimSpace(data.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("empty openai-compatible response")
	}
	return data.Choices[0].Message.Content, nil
}

func asString(v any) string {
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return s
}

func decodeMaybeBase64(input string) (string, bool) {
	decoded, err := base64.StdEncoding.DecodeString(input)
	if err != nil {
		return "", false
	}
	out := strings.TrimSpace(string(decoded))
	if strings.HasPrefix(out, "{") && strings.HasSuffix(out, "}") {
		return out, true
	}
	return "", false
}
