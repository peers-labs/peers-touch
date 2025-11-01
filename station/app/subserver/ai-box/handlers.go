package aibox

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol/consts"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
)

// Handler represents the AI box HTTP handlers
type Handler struct {
	service *Service
}

// NewHandler creates a new handler instance
func NewHandler(service *Service) *Handler {
	return &Handler{
		service: service,
	}
}

// Agent Management

// HandleCreateAgent handles agent creation
func (h *Handler) HandleCreateAgent(ctx context.Context, c *app.RequestContext) {
	var req Agent
	if err := c.BindAndValidate(&req); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	if err := h.service.CreateAgent(ctx, &req); err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to create agent", err)
		return
	}

	h.respondSuccess(c, consts.StatusCreated, req)
}

// HandleGetAgent handles getting a single agent
func (h *Handler) HandleGetAgent(ctx context.Context, c *app.RequestContext) {
	agentID := c.Param("agent_id")
	if agentID == "" {
		h.respondError(c, consts.StatusBadRequest, "agent_id is required", nil)
		return
	}

	agent, err := h.service.GetAgent(ctx, agentID)
	if err != nil {
		if err.Error() == fmt.Sprintf("agent not found: %s", agentID) {
			h.respondError(c, consts.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(c, consts.StatusInternalServerError, "failed to get agent", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, agent)
}

// HandleListAgents handles listing agents
func (h *Handler) HandleListAgents(ctx context.Context, c *app.RequestContext) {
	limit := 20
	offset := 0

	// Parse query parameters
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	agents, total, err := h.service.ListAgents(ctx, limit, offset)
	if err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to list agents", err)
		return
	}

	response := map[string]interface{}{
		"agents": agents,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}

	h.respondSuccess(c, consts.StatusOK, response)
}

// HandleCreateAgentConfiguration handles agent configuration creation
func (h *Handler) HandleCreateAgentConfiguration(ctx context.Context, c *app.RequestContext) {
	agentID := c.Param("agent_id")
	if agentID == "" {
		h.respondError(c, consts.StatusBadRequest, "agent_id is required", nil)
		return
	}

	var req AgentConfiguration
	if err := c.BindAndValidate(&req); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	req.AgentID = agentID
	if err := h.service.CreateAgentConfiguration(ctx, &req); err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to create agent configuration", err)
		return
	}

	h.respondSuccess(c, consts.StatusCreated, req)
}

// HandleGetAgentConfiguration handles getting agent configuration
func (h *Handler) HandleGetAgentConfiguration(ctx context.Context, c *app.RequestContext) {
	agentID := c.Param("agent_id")
	if agentID == "" {
		h.respondError(c, consts.StatusBadRequest, "agent_id is required", nil)
		return
	}

	config, err := h.service.GetAgentConfiguration(ctx, agentID)
	if err != nil {
		if err.Error() == fmt.Sprintf("agent configuration not found: %s", agentID) {
			h.respondError(c, consts.StatusNotFound, "agent configuration not found", err)
			return
		}
		h.respondError(c, consts.StatusInternalServerError, "failed to get agent configuration", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, config)
}

// Conversation Management

// HandleCreateConversation handles conversation creation
func (h *Handler) HandleCreateConversation(ctx context.Context, c *app.RequestContext) {
	var req Conversation
	if err := c.BindAndValidate(&req); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	if err := h.service.CreateConversation(ctx, &req); err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to create conversation", err)
		return
	}

	h.respondSuccess(c, consts.StatusCreated, req)
}

// HandleListConversations handles listing conversations for an agent
func (h *Handler) HandleListConversations(ctx context.Context, c *app.RequestContext) {
	agentID := c.Param("agent_id")
	if agentID == "" {
		h.respondError(c, consts.StatusBadRequest, "agent_id is required", nil)
		return
	}

	limit := 20
	offset := 0

	// Parse query parameters
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	conversations, total, err := h.service.ListConversations(ctx, agentID, limit, offset)
	if err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to list conversations", err)
		return
	}

	response := map[string]interface{}{
		"conversations": conversations,
		"total":         total,
		"limit":         limit,
		"offset":        offset,
	}

	h.respondSuccess(c, consts.StatusOK, response)
}

// Chat Handler

// HandleChat handles chat requests
func (h *Handler) HandleChat(ctx context.Context, c *app.RequestContext) {
	var req ChatRequest
	if err := c.BindAndValidate(&req); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	response, err := h.service.Chat(ctx, &req)
	if err != nil {
		h.respondError(c, consts.StatusInternalServerError, "chat failed", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, response)
}

// Utility Handlers

// HandleHealth handles health check
func (h *Handler) HandleHealth(ctx context.Context, c *app.RequestContext) {
	h.respondSuccess(c, consts.StatusOK, map[string]string{
		"status":  "healthy",
		"service": "ai-box",
	})
}

// HandleProviders handles provider listing
func (h *Handler) HandleProviders(ctx context.Context, c *app.RequestContext) {
	providers := h.service.GetProviders(ctx)
	h.respondSuccess(c, consts.StatusOK, map[string]interface{}{
		"providers": providers,
	})
}

// HandleProviderInfo handles getting provider information
func (h *Handler) HandleProviderInfo(ctx context.Context, c *app.RequestContext) {
	providerName := c.Param("provider_name")
	if providerName == "" {
		h.respondError(c, consts.StatusBadRequest, "provider_name is required", nil)
		return
	}

	info, err := h.service.GetProviderInfo(ctx, providerName)
	if err != nil {
		h.respondError(c, consts.StatusNotFound, "provider not found", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, info)
}

// HandleListProviderInfos handles listing detailed provider information
func (h *Handler) HandleListProviderInfos(ctx context.Context, c *app.RequestContext) {
	infos := h.service.ListProviderInfos(ctx)
	h.respondSuccess(c, consts.StatusOK, map[string]interface{}{
		"providers": infos,
	})
}

// HandleUpdateProviderConfig handles updating provider configuration
func (h *Handler) HandleUpdateProviderConfig(ctx context.Context, c *app.RequestContext) {
	providerName := c.Param("provider_name")
	if providerName == "" {
		h.respondError(c, consts.StatusBadRequest, "provider_name is required", nil)
		return
	}

	var config map[string]interface{}
	if err := c.BindAndValidate(&config); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	if err := h.service.UpdateProviderConfig(ctx, providerName, config); err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to update provider config", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, map[string]string{"message": "provider config updated successfully"})
}

// HandleSetProviderEnabled handles setting provider enabled status
func (h *Handler) HandleSetProviderEnabled(ctx context.Context, c *app.RequestContext) {
	providerName := c.Param("provider_name")
	if providerName == "" {
		h.respondError(c, consts.StatusBadRequest, "provider_name is required", nil)
		return
	}

	var req struct {
		Enabled bool `json:"enabled" binding:"required"`
	}
	if err := c.BindAndValidate(&req); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	if err := h.service.SetProviderEnabled(ctx, providerName, req.Enabled); err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to set provider enabled status", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, map[string]string{"message": fmt.Sprintf("provider %s successfully", map[bool]string{true: "enabled", false: "disabled"}[req.Enabled])})
}

// HandleTestProviderConnection handles testing provider connection
func (h *Handler) HandleTestProviderConnection(ctx context.Context, c *app.RequestContext) {
	providerName := c.Param("provider_name")
	if providerName == "" {
		h.respondError(c, consts.StatusBadRequest, "provider_name is required", nil)
		return
	}

	// Parse test model from request
	model := c.Query("model")
	if model == "" {
		model = "default"
	}

	err := h.service.TestProviderConnection(ctx, providerName)
	status := "success"
	details := ""
	if err != nil {
		status = "error"
		details = err.Error()
	}

	h.respondSuccess(c, consts.StatusOK, map[string]interface{}{
		"status":    status,
		"details":   details,
		"model":     model,
		"timestamp": time.Now(),
	})
}

// Vector Storage Handlers

// HandleCreateKnowledgeBase handles knowledge base creation
func (h *Handler) HandleCreateKnowledgeBase(ctx context.Context, c *app.RequestContext) {
	var req KnowledgeBase
	if err := c.BindAndValidate(&req); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	if err := h.service.CreateKnowledgeBase(ctx, &req); err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to create knowledge base", err)
		return
	}

	h.respondSuccess(c, consts.StatusCreated, req)
}

// HandleListKnowledgeBases handles listing knowledge bases
func (h *Handler) HandleListKnowledgeBases(ctx context.Context, c *app.RequestContext) {
	limit := 20
	offset := 0

	// Parse query parameters
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	knowledgeBases, total, err := h.service.ListKnowledgeBases(ctx, limit, offset)
	if err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to list knowledge bases", err)
		return
	}

	response := map[string]interface{}{
		"knowledge_bases": knowledgeBases,
		"total":           total,
		"limit":           limit,
		"offset":          offset,
	}

	h.respondSuccess(c, consts.StatusOK, response)
}

// HandleAssociateAgentKnowledgeBase handles associating agent with knowledge base
func (h *Handler) HandleAssociateAgentKnowledgeBase(ctx context.Context, c *app.RequestContext) {
	agentID := c.Param("agent_id")
	if agentID == "" {
		h.respondError(c, consts.StatusBadRequest, "agent_id is required", nil)
		return
	}

	var req struct {
		KnowledgeBaseID string `json:"knowledge_base_id" binding:"required"`
		Priority        int    `json:"priority"`
	}
	if err := c.BindAndValidate(&req); err != nil {
		h.respondError(c, consts.StatusBadRequest, "invalid request body", err)
		return
	}

	if err := h.service.AssociateAgentWithKnowledgeBase(ctx, agentID, req.KnowledgeBaseID, req.Priority); err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to associate agent with knowledge base", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, map[string]string{"message": "associated successfully"})
}

// HandleGetAgentKnowledgeBases handles getting knowledge bases for an agent
func (h *Handler) HandleGetAgentKnowledgeBases(ctx context.Context, c *app.RequestContext) {
	agentID := c.Param("agent_id")
	if agentID == "" {
		h.respondError(c, consts.StatusBadRequest, "agent_id is required", nil)
		return
	}

	knowledgeBases, err := h.service.GetAgentKnowledgeBases(ctx, agentID)
	if err != nil {
		h.respondError(c, consts.StatusInternalServerError, "failed to get agent knowledge bases", err)
		return
	}

	h.respondSuccess(c, consts.StatusOK, map[string]interface{}{
		"knowledge_bases": knowledgeBases,
	})
}

// Helper methods

func (h *Handler) respondSuccess(c *app.RequestContext, status int, data interface{}) {
	response := map[string]interface{}{
		"success": true,
		"data":    data,
	}
	c.JSON(status, response)
}

func (h *Handler) respondError(c *app.RequestContext, status int, message string, err error) {
	response := map[string]interface{}{
		"success": false,
		"error":   message,
	}

	if err != nil {
		response["details"] = err.Error()
		logger.Logf(logger.ErrorLevel, "%s: %v", message, err)
	}

	c.JSON(status, response)
}
