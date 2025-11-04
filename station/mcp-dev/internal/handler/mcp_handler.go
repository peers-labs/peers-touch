package handler

import (
	"context"
	"fmt"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/hlog"
	"github.com/cloudwego/hertz/pkg/protocol/consts"
	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/service"
	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/types"
)

type MCPHandler struct {
	mcpService service.MCPService
}

func NewMCPHandler(mcpService service.MCPService) *MCPHandler {
	return &MCPHandler{
		mcpService: mcpService,
	}
}

func (h *MCPHandler) RegisterRoutes(hertzServer *server.Hertz) {
	// MCP protocol endpoints
	hertzServer.POST("/mcp/initialize", h.handleInitialize)
	hertzServer.POST("/mcp/list-tools", h.handleListTools)
	hertzServer.POST("/mcp/call-tool", h.handleCallTool)
	hertzServer.POST("/mcp/list-prompts", h.handleListPrompts)
	hertzServer.POST("/mcp/get-prompt", h.handleGetPrompt)
	
	// Health check
	hertzServer.GET("/health", h.handleHealth)
}

func (h *MCPHandler) handleInitialize(ctx context.Context, c *app.RequestContext) {
	var req types.InitializeRequest
	if err := c.BindJSON(&req); err != nil {
		hlog.Errorf("Failed to bind initialize request: %v", err)
		c.JSON(consts.StatusBadRequest, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInvalidRequest,
				Message: "Invalid request format",
			},
		})
		return
	}
	
	response, err := h.mcpService.Initialize(ctx, &req)
	if err != nil {
		hlog.Errorf("Failed to initialize MCP: %v", err)
		c.JSON(consts.StatusInternalServerError, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInternalError,
				Message: fmt.Sprintf("Failed to initialize: %v", err),
			},
		})
		return
	}
	
	c.JSON(consts.StatusOK, response)
}

func (h *MCPHandler) handleListTools(ctx context.Context, c *app.RequestContext) {
	var req types.ListToolsRequest
	if err := c.BindJSON(&req); err != nil {
		hlog.Errorf("Failed to bind list tools request: %v", err)
		c.JSON(consts.StatusBadRequest, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInvalidRequest,
				Message: "Invalid request format",
			},
		})
		return
	}
	
	tools, err := h.mcpService.ListTools(ctx)
	if err != nil {
		hlog.Errorf("Failed to list tools: %v", err)
		c.JSON(consts.StatusInternalServerError, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInternalError,
				Message: fmt.Sprintf("Failed to list tools: %v", err),
			},
		})
		return
	}
	
	c.JSON(consts.StatusOK, types.ListToolsResponse{
		Tools: tools,
	})
}

func (h *MCPHandler) handleCallTool(ctx context.Context, c *app.RequestContext) {
	var req types.CallToolRequest
	if err := c.BindJSON(&req); err != nil {
		hlog.Errorf("Failed to bind call tool request: %v", err)
		c.JSON(consts.StatusBadRequest, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInvalidRequest,
				Message: "Invalid request format",
			},
		})
		return
	}
	
	response, err := h.mcpService.CallTool(ctx, &req)
	if err != nil {
		hlog.Errorf("Failed to call tool %s: %v", req.Name, err)
		c.JSON(consts.StatusInternalServerError, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInternalError,
				Message: fmt.Sprintf("Failed to call tool: %v", err),
			},
		})
		return
	}
	
	c.JSON(consts.StatusOK, response)
}

func (h *MCPHandler) handleListPrompts(ctx context.Context, c *app.RequestContext) {
	var req types.ListPromptsRequest
	if err := c.BindJSON(&req); err != nil {
		hlog.Errorf("Failed to bind list prompts request: %v", err)
		c.JSON(consts.StatusBadRequest, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInvalidRequest,
				Message: "Invalid request format",
			},
		})
		return
	}
	
	prompts, err := h.mcpService.ListPrompts(ctx)
	if err != nil {
		hlog.Errorf("Failed to list prompts: %v", err)
		c.JSON(consts.StatusInternalServerError, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInternalError,
				Message: fmt.Sprintf("Failed to list prompts: %v", err),
			},
		})
		return
	}
	
	c.JSON(consts.StatusOK, types.ListPromptsResponse{
		Prompts: prompts,
	})
}

func (h *MCPHandler) handleGetPrompt(ctx context.Context, c *app.RequestContext) {
	var req types.GetPromptRequest
	if err := c.BindJSON(&req); err != nil {
		hlog.Errorf("Failed to bind get prompt request: %v", err)
		c.JSON(consts.StatusBadRequest, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInvalidRequest,
				Message: "Invalid request format",
			},
		})
		return
	}
	
	response, err := h.mcpService.GetPrompt(ctx, &req)
	if err != nil {
		hlog.Errorf("Failed to get prompt %s: %v", req.Name, err)
		c.JSON(consts.StatusInternalServerError, types.ErrorResponse{
			Error: &types.ErrorData{
				Code:    types.ErrorCodeInternalError,
				Message: fmt.Sprintf("Failed to get prompt: %v", err),
			},
		})
		return
	}
	
	c.JSON(consts.StatusOK, response)
}

func (h *MCPHandler) handleHealth(ctx context.Context, c *app.RequestContext) {
	c.JSON(consts.StatusOK, map[string]interface{}{
		"status": "healthy",
		"service": "peers-dev-mcp",
	})
}