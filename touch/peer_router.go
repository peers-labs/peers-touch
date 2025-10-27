package touch

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/registry"
	"github.com/peers-touch/peers-touch-go/core/server"
	"github.com/peers-touch/peers-touch-go/touch/model"
	"github.com/peers-touch/peers-touch-go/touch/peer"
)

const (
	RouterURLSetPeerAddr    RouterPath = "/set-addr"
	RouterURLGetMyPeerAddr  RouterPath = "/get-my-peer-info"
	RouterURLTouchHiTo      RouterPath = "/touch-hi-to"

)

type PeerRouters struct{}

// Ensure PeerRouters implements server.Routers interface
var _ server.Routers = (*PeerRouters)(nil)

// Routers registers all peer-related handlers
func (pr *PeerRouters) Handlers() []server.Handler {
	log.Infof(context.Background(), "Registering peer handlers")

	handlerInfos := GetPeerHandlers()
	handlers := make([]server.Handler, len(handlerInfos))

	for i, info := range handlerInfos {
		handlers[i] = server.NewHandler(
			info.RouterURL,
			info.Handler,
			server.WithMethod(info.Method),
			server.WithWrappers(info.Wrappers...),
		)
	}

	return handlers
}

func (mr *PeerRouters) Name() string {
	return RoutersNamePeer
}

// NewPeerRouter creates PeerRouters
func NewPeerRouter() *PeerRouters {
	return &PeerRouters{}
}

// SetPeerAddrHandler handles the HTTP request to set a peer address.
// It binds the incoming JSON payload to a PeerAddressParam struct,
// validates the data, and calls the SetPeerAddr function to save it.
func SetPeerAddrHandler(c context.Context, ctx *app.RequestContext) {
	var param model.PeerAddressParam
	// Bind the JSON payload to the PeerAddressParam struct
	if err := ctx.Bind(&param); err != nil {
		log.Warnf(c, "SetPeerAddr bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	// Validate the PeerAddressParam data
	if err := param.Check(); err != nil {
		log.Warnf(c, "SetPeerAddr checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Call the SetPeerAddr function to save the peer address
	if err := peer.SetPeerAddr(c, &param); err != nil {
		if errors.Is(err, model.ErrPeerAddrExists) {
			log.Warnf(c, "SetPeerAddr executed failed: %v", err)
			ctx.JSON(http.StatusConflict, err.Error())
		} else {
			log.Errorf(c, "SetPeerAddr executed failed: %v", err)
			ctx.JSON(http.StatusInternalServerError, err.Error())
		}
		return
	}

	// If everything is successful, return a success response
	SuccessResponse(ctx, "Peer address saved successfully", nil)
}

func GetMyPeerAddrInfos(c context.Context, ctx *app.RequestContext) {
	// Call the GetMyPeerInfos function to retrieve the peer address information
	peerAddrInfos, err := peer.GetMyPeerInfos(c)
	if err != nil {
		log.Warnf(c, "GetMyPeerInfos executed failed: %v", err)
		FailedResponse(ctx, err)
		return
	}
	// If everything is successful, return the peer address information as a success response
	SuccessResponse(ctx, "Peer address information retrieved successfully", peerAddrInfos)
}

// TouchHiToHandler initiates a connection to a peer address and establishes a stream
func TouchHiToHandler(c context.Context, ctx *app.RequestContext) {
	var param model.TouchHiToParam
	if err := ctx.Bind(&param); err != nil {
		log.Warnf(c, "TouchHiTo bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := param.Check(); err != nil {
		log.Warnf(c, "TouchHiTo checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Establish connection and get status
	status, err := peer.TouchHiTo(c, &param)
	if err != nil {
		log.Errorf(c, "TouchHiTo connection failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Connection established successfully", status)
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
		FailedResponse(ctx, err)
		return
	}

	page := offset/limit + 1
	SuccessResponse(ctx, "Nodes listed successfully", map[string]interface{}{
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
		FailedResponse(ctx, errors.New("node id is required"))
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
			FailedResponse(ctx, err)
		}
		return
	}

	SuccessResponse(ctx, "Node retrieved", map[string]interface{}{
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
		FailedResponse(ctx, err)
		return
	}

	// Validate request parameters
	if req.Name == "" {
		FailedResponse(ctx, errors.New("node name is required"))
		return
	}

	if req.Version == "" {
		FailedResponse(ctx, errors.New("node version is required"))
		return
	}

	if len(req.Addresses) == 0 {
		FailedResponse(ctx, errors.New("at least one address is required"))
		return
	}

	if req.Port <= 0 || req.Port > 65535 {
		FailedResponse(ctx, errors.New("invalid port number"))
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
		FailedResponse(ctx, err)
		return
	}

	log.Infof(c, "Successfully registered node: %s", node.ID)

	SuccessResponse(ctx, "Node registered successfully", map[string]interface{}{
		"node": node,
	})
}

// DeregisterNodeHandler handles DELETE /nodes/{id} - deregister node
func DeregisterNodeHandler(c context.Context, ctx *app.RequestContext) {
	nodeID := ctx.Param("id")
	if nodeID == "" {
		FailedResponse(ctx, errors.New("node id is required"))
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
			FailedResponse(ctx, err)
		}
		return
	}

	log.Infof(c, "Successfully deregistered node: %s", nodeID)

	SuccessResponse(ctx, "Node deregistered successfully", map[string]string{"id": nodeID})
}
