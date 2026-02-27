package touch

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/peer"
	peerhandler "github.com/peers-labs/peers-touch/station/frame/touch/peer/handler"
)

const (
	RouterURLSetPeerAddr   RouterPath = "/set-addr"
	RouterURLGetMyPeerAddr RouterPath = "/get-my-peer-info"
	RouterURLTouchHiTo     RouterPath = "/touch-hi-to"
)

type PeerRouters struct{}

// Ensure PeerRouters implements server.Routers interface
var _ server.Routers = (*PeerRouters)(nil)

// Routers registers all peer-related handlers
func (pr *PeerRouters) Handlers() []server.Handler {
	log.Infof(context.Background(), "Registering peer handlers")

	commonWrapper := CommonAccessControlWrapper(model.RouteNamePeer)

	return []server.Handler{
		server.NewTypedHandler(
			RouterURLSetPeerAddr.Name(),
			RouterURLSetPeerAddr.SubPath(),
			server.POST,
			peerhandler.HandleSetPeerAddr,
			commonWrapper,
		),
		server.NewTypedHandler(
			RouterURLGetMyPeerAddr.Name(),
			RouterURLGetMyPeerAddr.SubPath(),
			server.GET,
			peerhandler.HandleGetMyPeerAddr,
			commonWrapper,
		),
		server.NewTypedHandler(
			RouterURLTouchHiTo.Name(),
			RouterURLTouchHiTo.SubPath(),
			server.POST,
			peerhandler.HandleTouchHi,
			commonWrapper,
		),
		server.NewHTTPHandler(
			"peer-list-nodes",
			"/nodes",
			server.GET,
			server.HertzHandlerFunc(ListNodesHandler),
			commonWrapper,
		),
		server.NewHTTPHandler(
			"peer-get-node",
			"/nodes/:id",
			server.GET,
			server.HertzHandlerFunc(GetNodeHandler),
			commonWrapper,
		),
		server.NewHTTPHandler(
			"peer-register-node",
			"/nodes",
			server.POST,
			server.HertzHandlerFunc(RegisterNodeHandler),
			commonWrapper,
		),
		server.NewHTTPHandler(
			"peer-deregister-node",
			"/nodes/:id",
			server.DELETE,
			server.HertzHandlerFunc(DeregisterNodeHandler),
			commonWrapper,
		),
	}
}

func (mr *PeerRouters) Name() string {
	return model.RouteNamePeer
}

// NewPeerRouter creates PeerRouters
func NewPeerRouter() *PeerRouters {
	return &PeerRouters{}
}

// Registry endpoint handlers - these implement registry functionality using ctx directly

// ListNodesHandler handles GET /nodes - list nodes
func ListNodesHandler(c context.Context, ctx *app.RequestContext) {
	// Parse query parameters
	limitStr := string(ctx.QueryArgs().Peek("limit"))
	offsetStr := string(ctx.QueryArgs().Peek("offset"))
	status := string(ctx.QueryArgs().Peek("status"))
	capabilities := string(ctx.QueryArgs().Peek("capabilities"))
	onlineOnly := string(ctx.QueryArgs().Peek("online_only"))

	limit := 20 // default limit
	offset := 0 // default offset

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

	// Build filter
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

	// Get node registry and list nodes
	nr := peer.GetNodeRegistry()
	nodes, total, err := nr.ListNodes(c, filter)
	if err != nil {
		log.Errorf(c, "Failed to list nodes: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	page := offset/limit + 1
	SuccessResponse(c, ctx, "Nodes listed successfully", map[string]interface{}{
		"nodes": nodes,
		"total": total,
		"page":  page,
		"size":  len(nodes),
	})
}

// GetNodeHandler handles GET /nodes/{id} - get single node
func GetNodeHandler(c context.Context, ctx *app.RequestContext) {
	nodeID := ctx.Param("id")

	if nodeID == "" {
		FailedResponse(c, ctx, errors.New("node id is required"))
		return
	}

	nr := peer.GetNodeRegistry()
	node, err := nr.GetNode(c, nodeID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			ctx.JSON(http.StatusNotFound, map[string]interface{}{
				"code": http.StatusNotFound,
				"msg":  fmt.Sprintf("node not found: %s", nodeID),
			})
		} else {
			log.Errorf(c, "Failed to get node %s: %v", nodeID, err)
			FailedResponse(c, ctx, err)
		}
		return
	}

	SuccessResponse(c, ctx, "Node retrieved", map[string]interface{}{
		"node": node,
	})
}

// RegisterNodeHandler handles POST /nodes - register node
func RegisterNodeHandler(c context.Context, ctx *app.RequestContext) {
	var req struct {
		Name         string                 `json:"name" binding:"required"`
		Version      string                 `json:"version" binding:"required"`
		Capabilities []string               `json:"capabilities"`
		Metadata     map[string]interface{} `json:"metadata"`
		PublicKey    string                 `json:"public_key"`
		Addresses    []string               `json:"addresses" binding:"required"`
		Port         int                    `json:"port" binding:"required"`
	}

	if err := ctx.Bind(&req); err != nil {
		log.Errorf(c, "Failed to bind JSON: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	// Validate request parameters
	if req.Name == "" {
		FailedResponse(c, ctx, errors.New("node name is required"))
		return
	}

	if req.Version == "" {
		FailedResponse(c, ctx, errors.New("node version is required"))
		return
	}

	if len(req.Addresses) == 0 {
		FailedResponse(c, ctx, errors.New("at least one address is required"))
		return
	}

	if req.Port <= 0 || req.Port > 65535 {
		FailedResponse(c, ctx, errors.New("invalid port number"))
		return
	}

	// Create node object
	node := &registry.Node{
		Name:         req.Name,
		Version:      req.Version,
		Capabilities: req.Capabilities,
		Metadata:     req.Metadata,
		PublicKey:    req.PublicKey,
		Addresses:    req.Addresses,
		Port:         req.Port,
	}

	// Register node
	nr := peer.GetNodeRegistry()
	if err := nr.Register(c, node); err != nil {
		log.Errorf(c, "Failed to register node: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	log.Infof(c, "Successfully registered node: %s", node.ID)

	SuccessResponse(c, ctx, "Node registered successfully", map[string]interface{}{
		"node": node,
	})
}

// DeregisterNodeHandler handles DELETE /nodes/{id} - deregister node
func DeregisterNodeHandler(c context.Context, ctx *app.RequestContext) {
	nodeID := ctx.Param("id")
	if nodeID == "" {
		FailedResponse(c, ctx, errors.New("node id is required"))
		return
	}

	nr := peer.GetNodeRegistry()
	if err := nr.Deregister(c, nodeID); err != nil {
		if strings.Contains(err.Error(), "not found") {
			ctx.JSON(http.StatusNotFound, map[string]interface{}{
				"code": http.StatusNotFound,
				"msg":  fmt.Sprintf("node not found: %s", nodeID),
			})
		} else {
			log.Errorf(c, "Failed to deregister node %s: %v", nodeID, err)
			FailedResponse(c, ctx, err)
		}
		return
	}

	log.Infof(c, "Successfully deregistered node: %s", nodeID)

	SuccessResponse(c, ctx, "Node deregistered successfully", map[string]string{"id": nodeID})
}
