package handler

import (
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"github.com/peers-labs/peers-touch/station/frame/touch/peer"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type NodeHandlers struct{}

func NewNodeHandlers() *NodeHandlers {
	return &NodeHandlers{}
}

func (h *NodeHandlers) HandleListNodes(ctx context.Context, req *pb.ListNodesRequest) (*pb.ListNodesResponse, error) {
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	offset := int(req.Offset)
	if offset < 0 {
		offset = 0
	}

	filter := &registry.NodeFilter{
		Limit:  limit,
		Offset: offset,
	}

	if len(req.Status) > 0 {
		for _, s := range req.Status {
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

	if len(req.Capabilities) > 0 {
		filter.Capabilities = req.Capabilities
	}

	if req.OnlineOnly {
		filter.OnlineOnly = true
	}

	nr := peer.GetNodeRegistry()
	nodes, total, err := nr.ListNodes(ctx, filter)
	if err != nil {
		logger.Error(ctx, "Failed to list nodes", "error", err)
		return nil, err
	}

	protoNodes := make([]*pb.Node, 0, len(nodes))
	for _, node := range nodes {
		protoNode := convertNodeToProto(node)
		protoNodes = append(protoNodes, protoNode)
	}

	page := int32(offset/limit + 1)
	return &pb.ListNodesResponse{
		Nodes: protoNodes,
		Total: int64(total),
		Page:  page,
		Size:  int32(len(protoNodes)),
	}, nil
}

func (h *NodeHandlers) HandleGetNode(ctx context.Context, req *pb.GetNodeRequest) (*pb.GetNodeResponse, error) {
	if req.NodeId == "" {
		logger.Error(ctx, "Missing node_id in request")
		return nil, &nodeError{message: "node_id is required"}
	}

	nr := peer.GetNodeRegistry()
	node, err := nr.GetNode(ctx, req.NodeId)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return nil, &nodeError{message: "node not found", notFound: true}
		}
		logger.Error(ctx, "Failed to get node", "error", err, "node_id", req.NodeId)
		return nil, err
	}

	return &pb.GetNodeResponse{
		Node: convertNodeToProto(node),
	}, nil
}

func (h *NodeHandlers) HandleRegisterNode(ctx context.Context, req *pb.RegisterNodeRequest) (*pb.RegisterNodeResponse, error) {
	if req.Name == "" {
		return nil, &nodeError{message: "node name is required"}
	}
	if req.Version == "" {
		return nil, &nodeError{message: "node version is required"}
	}
	if len(req.Addresses) == 0 {
		return nil, &nodeError{message: "at least one address is required"}
	}
	if req.Port <= 0 || req.Port > 65535 {
		return nil, &nodeError{message: "invalid port number"}
	}

	metadata := make(map[string]interface{})
	for k, v := range req.Metadata {
		metadata[k] = v
	}

	node := &registry.Node{
		Name:         req.Name,
		Version:      req.Version,
		Capabilities: req.Capabilities,
		Metadata:     metadata,
		PublicKey:    req.PublicKey,
		Addresses:    req.Addresses,
		Port:         int(req.Port),
	}

	nr := peer.GetNodeRegistry()
	if err := nr.Register(ctx, node); err != nil {
		logger.Error(ctx, "Failed to register node", "error", err)
		return nil, err
	}

	logger.Info(ctx, "Successfully registered node", "node_id", node.ID)

	return &pb.RegisterNodeResponse{
		Node: convertNodeToProto(node),
	}, nil
}

func (h *NodeHandlers) HandleDeregisterNode(ctx context.Context, req *pb.DeregisterNodeRequest) (*pb.DeregisterNodeResponse, error) {
	if req.NodeId == "" {
		return nil, &nodeError{message: "node_id is required"}
	}

	nr := peer.GetNodeRegistry()
	if err := nr.Deregister(ctx, req.NodeId); err != nil {
		if strings.Contains(err.Error(), "not found") {
			return nil, &nodeError{message: "node not found", notFound: true}
		}
		logger.Error(ctx, "Failed to deregister node", "error", err, "node_id", req.NodeId)
		return nil, err
	}

	logger.Info(ctx, "Successfully deregistered node", "node_id", req.NodeId)

	return &pb.DeregisterNodeResponse{
		Success: true,
		NodeId:  req.NodeId,
	}, nil
}

func convertNodeToProto(node *registry.Node) *pb.Node {
	if node == nil {
		return nil
	}

	metadata := make(map[string]string)
	for k, v := range node.Metadata {
		if str, ok := v.(string); ok {
			metadata[k] = str
		}
	}

	protoNode := &pb.Node{
		Id:           node.ID,
		Name:         node.Name,
		Version:      node.Version,
		Addresses:    node.Addresses,
		Capabilities: node.Capabilities,
		Metadata:     metadata,
		Status:       node.Status,
		PublicKey:    node.PublicKey,
		Port:         int32(node.Port),
	}

	if lastSeen, ok := node.LastSeenAt.(string); ok && lastSeen != "" {
		protoNode.LastSeenAt = timestamppb.New(parseTime(lastSeen))
	}

	if heartbeat, ok := node.HeartbeatAt.(string); ok && heartbeat != "" {
		protoNode.HeartbeatAt = timestamppb.New(parseTime(heartbeat))
	}

	if registered, ok := node.RegisteredAt.(string); ok && registered != "" {
		protoNode.RegisteredAt = timestamppb.New(parseTime(registered))
	}

	return protoNode
}

func parseTime(timeStr string) time.Time {
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02 15:04:05",
	}
	for _, format := range formats {
		if t, err := time.Parse(format, timeStr); err == nil {
			return t
		}
	}
	return time.Now()
}

type nodeError struct {
	message  string
	notFound bool
}

func (e *nodeError) Error() string {
	return e.message
}
