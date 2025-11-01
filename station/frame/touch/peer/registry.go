package peer

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
	"github.com/peers-touch/peers-touch/station/frame/touch/model"
)

// RegisterRegistryEndpoints 注册节点注册中心相关的路由端点
func RegisterRegistryEndpoints() []model.Endpoint {
	return []model.Endpoint{
		{
			Method:  "GET",
			Path:    "/nodes",
			Handler: ListNodesHandler,
		},
		{
			Method:  "GET",
			Path:    "/nodes/:id",
			Handler: GetNodeHandler,
		},
		{
			Method:  "POST",
			Path:    "/nodes",
			Handler: RegisterNodeHandler,
		},
		{
			Method:  "PUT",
			Path:    "/nodes/:id",
			Handler: UpdateNodeHandler,
		},
		{
			Method:  "DELETE",
			Path:    "/nodes/:id",
			Handler: UnregisterNodeHandler,
		},
		{
			Method:  "POST",
			Path:    "/nodes/:id/heartbeat",
			Handler: HeartbeatHandler,
		},
		{
			Method:  "GET",
			Path:    "/nodes/stats",
			Handler: GetNodeStatsHandler,
		},
	}
}

// 全局节点注册中心实例
var nodeRegistry *registry.NodeRegistry

// InitNodeRegistry 初始化节点注册中心
func InitNodeRegistry(storage registry.NodeStorage) {
	if storage == nil {
		storage = registry.NewMemoryStorage()
	}
	nodeRegistry = registry.NewNodeRegistry(storage)
}

// GetNodeRegistry 获取节点注册中心实例
func GetNodeRegistry() *registry.NodeRegistry {
	if nodeRegistry == nil {
		InitNodeRegistry(nil)
	}
	return nodeRegistry
}

// NodeListResponse 节点列表响应
type NodeListResponse struct {
	Nodes []*registry.Node `json:"nodes"`
	Total int              `json:"total"`
	Page  int              `json:"page"`
	Size  int              `json:"size"`
}

// RegisterNodeRequest 注册节点请求
type RegisterNodeRequest struct {
	ID           string                 `json:"id" binding:"required"`
	Name         string                 `json:"name" binding:"required"`
	Addresses    []string               `json:"addresses" binding:"required"`
	Capabilities []string               `json:"capabilities"`
	Metadata     map[string]interface{} `json:"metadata"`
}

// UpdateNodeRequest 更新节点请求
type UpdateNodeRequest struct {
	Name         string                 `json:"name"`
	Addresses    []string               `json:"addresses"`
	Capabilities []string               `json:"capabilities"`
	Metadata     map[string]interface{} `json:"metadata"`
}

// ListNodesHandler 处理 GET /nodes - 列出节点
func ListNodesHandler(ctx context.Context, c *app.RequestContext) {
	// 解析查询参数
	limitStr := c.Query("limit")
	offsetStr := c.Query("offset")
	status := c.Query("status")
	capabilities := c.Query("capabilities")
	onlineOnly := c.Query("online_only")

	limit := 20 // 默认限制
	offset := 0 // 默认偏移

	if limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 && parsedLimit <= 100 {
			limit = parsedLimit
		}
	}

	if offsetStr != "" {
		if parsedOffset, err := strconv.Atoi(offsetStr); err == nil && parsedOffset >= 0 {
			offset = parsedOffset
		}
	}

	// 构建过滤器
	filter := &registry.NodeFilter{
		Limit:  limit,
		Offset: offset,
	}

	if status != "" {
		statusList := strings.Split(status, ",")
		for _, s := range statusList {
			switch strings.TrimSpace(s) {
			case "online":
				filter.Status = append(filter.Status, registry.NodeStatusOnline)
			case "offline":
				filter.Status = append(filter.Status, registry.NodeStatusOffline)
			case "inactive":
				filter.Status = append(filter.Status, registry.NodeStatusInactive)
			}
		}
	}

	if capabilities != "" {
		filter.Capabilities = strings.Split(capabilities, ",")
		for i, cap := range filter.Capabilities {
			filter.Capabilities[i] = strings.TrimSpace(cap)
		}
	}

	if onlineOnly == "true" {
		filter.OnlineOnly = true
	}

	// 获取节点列表
	nr := GetNodeRegistry()
	nodes, total, err := nr.ListNodes(ctx, filter)
	if err != nil {
		logger.Errorf(ctx, "Failed to list nodes: %v", err)
		c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
			"500",
			"Failed to list nodes",
			model.NewError("500", err.Error()),
		))
		return
	}

	page := offset/limit + 1
	response := &NodeListResponse{
		Nodes: nodes,
		Total: total,
		Page:  page,
		Size:  len(nodes),
	}

	c.JSON(http.StatusOK, model.NewSuccessResponse("success", response))
}

// GetNodeHandler 处理 GET /nodes/:id - 获取单个节点
func GetNodeHandler(ctx context.Context, c *app.RequestContext) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, model.NewFailedResponse(
			"400",
			"node ID is required",
			model.UndefinedError(fmt.Errorf("missing node ID")),
		))
		return
	}

	nr := GetNodeRegistry()
	node, err := nr.GetNode(ctx, nodeID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, model.NewFailedResponse(
				"404",
				fmt.Sprintf("node not found: %s", nodeID),
				model.NewError("404", err.Error()),
			))
		} else {
			logger.Errorf(ctx, "Failed to get node %s: %v", nodeID, err)
			c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
				"500",
				"Failed to get node",
				model.NewError("500", err.Error()),
			))
		}
		return
	}

	c.JSON(http.StatusOK, model.NewSuccessResponse("success", node))
}

// RegisterNodeHandler 处理 POST /nodes - 注册新节点
func RegisterNodeHandler(ctx context.Context, c *app.RequestContext) {
	var req RegisterNodeRequest
	if err := c.BindAndValidate(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.NewFailedResponse(
			"400",
			"Invalid request body",
			model.NewError("400", err.Error()),
		))
		return
	}

	// 创建节点对象
	node := &registry.Node{
		ID:           req.ID,
		Name:         req.Name,
		Addresses:    req.Addresses,
		Capabilities: req.Capabilities,
		Metadata:     req.Metadata,
		Status:       registry.NodeStatusOnline,
		LastSeenAt:   time.Now(),
		HeartbeatAt:  time.Now(),
		RegisteredAt: time.Now(),
	}

	nr := GetNodeRegistry()
	if err := nr.Register(ctx, node); err != nil {
		logger.Errorf(ctx, "Failed to register node %s: %v", req.ID, err)
		c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
			"500",
			"Failed to register node",
			model.NewError("500", err.Error()),
		))
		return
	}

	logger.Infof(ctx, "Node registered successfully: %s", req.ID)
	c.JSON(http.StatusCreated, model.NewSuccessResponse("Node registered successfully", node))
}

// UpdateNodeHandler 处理 PUT /nodes/:id - 更新节点信息
func UpdateNodeHandler(ctx context.Context, c *app.RequestContext) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, model.NewFailedResponse(
			"400",
			"node ID is required",
			model.NewError("400", "missing node ID"),
		))
		return
	}

	nr := GetNodeRegistry()
	existingNode, err := nr.GetNode(ctx, nodeID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, model.NewFailedResponse(
				"404",
				fmt.Sprintf("node not found: %s", nodeID),
				model.NewError("404", err.Error()),
			))
		} else {
			c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
				"500",
				"Failed to get node",
				model.NewError("500", err.Error()),
			))
		}
		return
	}

	var req UpdateNodeRequest
	if err := c.BindAndValidate(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.NewFailedResponse(
			"400",
			"Invalid request body",
			model.NewError("400", err.Error()),
		))
		return
	}

	// 更新节点信息
	if req.Name != "" {
		existingNode.Name = req.Name
	}
	if len(req.Addresses) > 0 {
		existingNode.Addresses = req.Addresses
	}
	if len(req.Capabilities) > 0 {
		existingNode.Capabilities = req.Capabilities
	}
	if req.Metadata != nil {
		existingNode.Metadata = req.Metadata
	}
	existingNode.LastSeenAt = time.Now()

	if err := nr.Register(ctx, existingNode); err != nil {
		logger.Errorf(ctx, "Failed to update node %s: %v", nodeID, err)
		c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
			"500",
			"Failed to update node",
			model.NewError("500", err.Error()),
		))
		return
	}

	logger.Infof(ctx, "Node updated successfully: %s", nodeID)
	c.JSON(http.StatusOK, model.NewSuccessResponse("Node updated successfully", existingNode))
}

// UnregisterNodeHandler 处理 DELETE /nodes/:id - 注销节点
func UnregisterNodeHandler(ctx context.Context, c *app.RequestContext) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, model.NewFailedResponse(
			"400",
			"node ID is required",
			model.NewError("400", "missing node ID"),
		))
		return
	}

	nr := GetNodeRegistry()
	if err := nr.Deregister(ctx, nodeID); err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, model.NewFailedResponse(
				"404",
				fmt.Sprintf("node not found: %s", nodeID),
				model.NewError("404", err.Error()),
			))
		} else {
			logger.Errorf(ctx, "Failed to unregister node %s: %v", nodeID, err)
			c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
				"500",
				"Failed to unregister node",
				model.NewError("500", err.Error()),
			))
		}
		return
	}

	logger.Infof(ctx, "Node unregistered successfully: %s", nodeID)
	c.JSON(http.StatusOK, model.NewSuccessResponse("Node unregistered successfully", nil))
}

// HeartbeatHandler 处理 POST /nodes/:id/heartbeat - 节点心跳
func HeartbeatHandler(ctx context.Context, c *app.RequestContext) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, model.NewFailedResponse(
			"400",
			"node ID is required",
			model.NewError("400", "missing node ID"),
		))
		return
	}

	nr := GetNodeRegistry()
	if err := nr.Heartbeat(ctx, nodeID); err != nil {
		logger.Errorf(ctx, "Failed to update heartbeat for node %s: %v", nodeID, err)
		c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
			"500",
			"Failed to update heartbeat",
			model.NewError("500", err.Error()),
		))
		return
	}

	c.JSON(http.StatusOK, model.NewSuccessResponse("Heartbeat updated successfully", nil))
}

// GetNodeStatsHandler 处理 GET /nodes/stats - 获取节点统计信息
func GetNodeStatsHandler(ctx context.Context, c *app.RequestContext) {
	nr := GetNodeRegistry()
	stats, err := nr.GetStats(ctx)
	if err != nil {
		logger.Errorf(ctx, "Failed to get node stats: %v", err)
		c.JSON(http.StatusInternalServerError, model.NewFailedResponse(
			"500",
			"Failed to get node statistics",
			model.NewError("500", err.Error()),
		))
		return
	}

	c.JSON(http.StatusOK, model.NewSuccessResponse("success", stats))
}
