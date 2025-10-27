package registry

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/peers-touch/peers-touch-go/core/logger"
)

// NodeStatus 节点状态枚举
type NodeStatus string

const (
	NodeStatusOnline   NodeStatus = "online"
	NodeStatusOffline  NodeStatus = "offline"
	NodeStatusInactive NodeStatus = "inactive"
)

// Node 表示一个网络节点
type Node struct {
	ID               string                 `json:"id"`
	Name             string                 `json:"name"`
	Version          string                 `json:"version"`
	Capabilities     []string               `json:"capabilities"`
	Metadata         map[string]interface{} `json:"metadata"`
	PublicKey        string                 `json:"public_key"`
	Addresses        []string               `json:"addresses"`
	Port             int                    `json:"port"`
	Status           NodeStatus             `json:"status"`
	RegisteredAt     time.Time              `json:"registered_at"`
	LastSeen         time.Time              `json:"last_seen"`
	LastSeenAt       time.Time              `json:"last_seen_at"`       // 兼容字段
	HeartbeatAt      time.Time              `json:"heartbeat_at"`       // 心跳时间
	HeartbeatTTL     time.Duration          `json:"heartbeat_ttl"`
	ConnectionCount  int                    `json:"connection_count"`   // 连接数
	RequestCount     int64                  `json:"request_count"`      // 请求数
}

// NodeFilter 节点过滤器
type NodeFilter struct {
	Status       []NodeStatus `json:"status"`
	Capabilities []string     `json:"capabilities"`
	IDs          []string     `json:"ids"`          // 节点ID列表
	Names        []string     `json:"names"`        // 节点名称列表
	OnlineOnly   bool         `json:"online_only"`
	Limit        int          `json:"limit"`
	Offset       int          `json:"offset"`
}

// NodeRegistry 节点注册中心
type NodeRegistry struct {
	storage           NodeStorage
	nodes             map[string]*Node // 内存中的节点缓存
	mu                sync.RWMutex
	cleanupTicker     *time.Ticker
	stopCh            chan struct{}
	cancel            context.CancelFunc
	wg                sync.WaitGroup
	ctx               context.Context
	cleanupInterval   time.Duration
	heartbeatInterval time.Duration
	offlineTimeout    time.Duration
}

// NewNodeRegistry 创建新的节点注册中心
func NewNodeRegistry(storage NodeStorage) *NodeRegistry {
	ctx, cancel := context.WithCancel(context.Background())
	
	nr := &NodeRegistry{
		storage:           storage,
		nodes:             make(map[string]*Node),
		stopCh:            make(chan struct{}),
		ctx:               ctx,
		cancel:            cancel,
		cleanupInterval:   5 * time.Minute,
		heartbeatInterval: 30 * time.Second,
		offlineTimeout:    2 * time.Minute,
	}
	
	// 启动后台清理任务
	nr.startBackgroundTasks()
	
	return nr
}

// Register 注册节点
func (nr *NodeRegistry) Register(ctx context.Context, node *Node) error {
	if node == nil {
		return fmt.Errorf("node cannot be nil")
	}
	
	// 生成ID（如果没有）
	if node.ID == "" {
		node.ID = nr.generateNodeID()
	}
	
	// 验证节点信息
	if err := nr.validateNode(node); err != nil {
		return fmt.Errorf("invalid node: %w", err)
	}
	
	nr.mu.Lock()
	defer nr.mu.Unlock()
	
	now := time.Now()
	
	// 检查是否已存在
	if existing, exists := nr.nodes[node.ID]; exists {
		// 更新现有节点
		existing.Name = node.Name
		existing.Version = node.Version
		existing.Capabilities = node.Capabilities
		existing.Metadata = node.Metadata
		existing.Addresses = node.Addresses
		existing.Port = node.Port
		existing.Status = NodeStatusOnline
		existing.LastSeenAt = now
		existing.HeartbeatAt = now
		
		// 保存到数据库
		if err := nr.saveNode(ctx, existing); err != nil {
			return fmt.Errorf("failed to update node: %w", err)
		}
		
		logger.Infof(ctx, "Updated node: %s", node.ID)
		return nil
	}
	
	// 新节点注册
	node.Status = NodeStatusOnline
	node.RegisteredAt = now
	node.LastSeenAt = now
	node.HeartbeatAt = now
	node.ConnectionCount = 0
	node.RequestCount = 0
	
	// 保存到内存和数据库
	nr.nodes[node.ID] = node
	if err := nr.saveNode(ctx, node); err != nil {
		delete(nr.nodes, node.ID)
		return fmt.Errorf("failed to save node: %w", err)
	}
	
	logger.Infof(ctx, "Registered new node: %s", node.ID)
	return nil
}

// Deregister 注销节点
func (nr *NodeRegistry) Deregister(ctx context.Context, nodeID string) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	nr.mu.Lock()
	defer nr.mu.Unlock()
	
	node, exists := nr.nodes[nodeID]
	if !exists {
		return fmt.Errorf("node not found: %s", nodeID)
	}
	
	// 更新状态为离线
	node.Status = NodeStatusOffline
	node.LastSeenAt = time.Now()
	
	// 保存到数据库
	if err := nr.saveNode(ctx, node); err != nil {
		return fmt.Errorf("failed to update node status: %w", err)
	}
	
	// 从内存中移除
	delete(nr.nodes, nodeID)
	
	logger.Infof(ctx, "Deregistered node: %s", nodeID)
	return nil
}

// GetNode 获取单个节点
func (nr *NodeRegistry) GetNode(ctx context.Context, nodeID string) (*Node, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("node ID cannot be empty")
	}
	
	nr.mu.RLock()
	defer nr.mu.RUnlock()
	
	if node, exists := nr.nodes[nodeID]; exists {
		// 返回副本，避免外部修改
		return nr.copyNode(node), nil
	}
	
	// 从数据库查询
	node, err := nr.loadNode(ctx, nodeID)
	if err != nil {
		return nil, fmt.Errorf("failed to load node: %w", err)
	}
	
	if node == nil {
		return nil, fmt.Errorf("node not found: %s", nodeID)
	}
	
	return node, nil
}

// ListNodes 列出节点（支持过滤）
func (nr *NodeRegistry) ListNodes(ctx context.Context, filter *NodeFilter) ([]*Node, int, error) {
	nr.mu.RLock()
	defer nr.mu.RUnlock()
	
	var nodes []*Node
	
	// 从内存中筛选
	for _, node := range nr.nodes {
		if nr.matchFilter(node, filter) {
			nodes = append(nodes, nr.copyNode(node))
		}
	}
	
	// 如果内存中的节点不够，从数据库补充
	if filter != nil && filter.Limit > 0 && len(nodes) < filter.Limit {
		dbNodes, err := nr.loadNodesFromDB(ctx, filter)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to load nodes from database: %w", err)
		}
		
		// 合并结果，去重
		nodeMap := make(map[string]*Node)
		for _, node := range nodes {
			nodeMap[node.ID] = node
		}
		for _, node := range dbNodes {
			if _, exists := nodeMap[node.ID]; !exists {
				nodeMap[node.ID] = node
				nodes = append(nodes, node)
			}
		}
	}
	
	// 应用分页
	total := len(nodes)
	if filter != nil {
		if filter.Offset > 0 && filter.Offset < len(nodes) {
			nodes = nodes[filter.Offset:]
		}
		if filter.Limit > 0 && filter.Limit < len(nodes) {
			nodes = nodes[:filter.Limit]
		}
	}
	
	return nodes, total, nil
}

// Heartbeat 节点心跳
func (nr *NodeRegistry) Heartbeat(ctx context.Context, nodeID string) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	nr.mu.Lock()
	defer nr.mu.Unlock()
	
	node, exists := nr.nodes[nodeID]
	if !exists {
		return fmt.Errorf("node not found: %s", nodeID)
	}
	
	now := time.Now()
	node.Status = NodeStatusOnline
	node.LastSeenAt = now
	node.HeartbeatAt = now
	
	// 异步保存到数据库
	go func() {
		if err := nr.saveNode(context.Background(), node); err != nil {
			logger.Errorf(ctx, "Failed to save heartbeat for node %s: %v", nodeID, err)
		}
	}()
	
	return nil
}

// DiscoverNodes 发现匹配的节点
func (nr *NodeRegistry) DiscoverNodes(ctx context.Context, capabilities []string, maxResults int) ([]*Node, error) {
	filter := &NodeFilter{
		Capabilities: capabilities,
		OnlineOnly:   true,
		Limit:        maxResults,
	}
	
	nodes, _, err := nr.ListNodes(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("failed to discover nodes: %w", err)
	}
	
	return nodes, nil
}

// Close 关闭注册中心
func (nr *NodeRegistry) Close() error {
	nr.cancel()
	nr.wg.Wait()
	return nil
}

// 私有方法

func (nr *NodeRegistry) generateNodeID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func (nr *NodeRegistry) validateNode(node *Node) error {
	if node.Name == "" {
		return fmt.Errorf("node name cannot be empty")
	}
	if node.Version == "" {
		return fmt.Errorf("node version cannot be empty")
	}
	if len(node.Addresses) == 0 {
		return fmt.Errorf("node must have at least one address")
	}
	if node.Port <= 0 || node.Port > 65535 {
		return fmt.Errorf("invalid port: %d", node.Port)
	}
	return nil
}

func (nr *NodeRegistry) copyNode(node *Node) *Node {
	if node == nil {
		return nil
	}
	
	nodeCopy := *node
	
	// 深拷贝切片和映射
	if node.Capabilities != nil {
		nodeCopy.Capabilities = make([]string, len(node.Capabilities))
		copy(nodeCopy.Capabilities, node.Capabilities)
	}
	
	if node.Addresses != nil {
		nodeCopy.Addresses = make([]string, len(node.Addresses))
		copy(nodeCopy.Addresses, node.Addresses)
	}
	
	if node.Metadata != nil {
		nodeCopy.Metadata = make(map[string]interface{})
		for k, v := range node.Metadata {
			nodeCopy.Metadata[k] = v
		}
	}
	
	return &nodeCopy
}

func (nr *NodeRegistry) matchFilter(node *Node, filter *NodeFilter) bool {
	if filter == nil {
		return true
	}
	
	// 检查ID
	if len(filter.IDs) > 0 {
		found := false
		for _, id := range filter.IDs {
			if node.ID == id {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	// 检查名称
	if len(filter.Names) > 0 {
		found := false
		for _, name := range filter.Names {
			if node.Name == name {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	// 检查状态
	if len(filter.Status) > 0 {
		found := false
		for _, status := range filter.Status {
			if node.Status == status {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	// 检查能力
	if len(filter.Capabilities) > 0 {
		for _, requiredCap := range filter.Capabilities {
			found := false
			for _, nodeCap := range node.Capabilities {
				if nodeCap == requiredCap {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
	}
	
	// 检查在线状态
	if filter.OnlineOnly && node.Status != NodeStatusOnline {
		return false
	}
	
	return true
}

func (nr *NodeRegistry) saveNode(ctx context.Context, node *Node) error {
	if nr.storage == nil {
		return nil // 如果没有存储，只保存在内存中
	}
	
	return nr.storage.Save(ctx, node)
}

func (nr *NodeRegistry) loadNode(ctx context.Context, nodeID string) (*Node, error) {
	if nr.storage == nil {
		return nil, nil
	}
	
	return nr.storage.Get(ctx, nodeID)
}

func (nr *NodeRegistry) loadNodesFromDB(ctx context.Context, filter *NodeFilter) ([]*Node, error) {
	// 这里应该实现从数据库加载节点的逻辑
	// 暂时返回空结果
	return []*Node{}, nil
}

func (nr *NodeRegistry) startBackgroundTasks() {
	// 启动清理任务
	nr.wg.Add(1)
	go nr.cleanupTask()
	
	// 启动状态检查任务
	nr.wg.Add(1)
	go nr.statusCheckTask()
}

func (nr *NodeRegistry) cleanupTask() {
	defer nr.wg.Done()
	
	ticker := time.NewTicker(nr.cleanupInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-nr.ctx.Done():
			return
		case <-ticker.C:
			nr.performCleanup()
		}
	}
}

func (nr *NodeRegistry) statusCheckTask() {
	defer nr.wg.Done()
	
	ticker := time.NewTicker(nr.heartbeatInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-nr.ctx.Done():
			return
		case <-ticker.C:
			nr.checkNodeStatus()
		}
	}
}

func (nr *NodeRegistry) performCleanup() {
	nr.mu.Lock()
	defer nr.mu.Unlock()
	
	now := time.Now()
	toRemove := []string{}
	
	for id, node := range nr.nodes {
		// 移除长时间离线的节点
		if node.Status == NodeStatusOffline && 
		   now.Sub(node.LastSeenAt) > 24*time.Hour {
			toRemove = append(toRemove, id)
		}
	}
	
	for _, id := range toRemove {
		delete(nr.nodes, id)
		logger.Infof(nr.ctx, "Cleaned up inactive node: %s", id)
	}
}

func (nr *NodeRegistry) checkNodeStatus() {
	nr.mu.Lock()
	defer nr.mu.Unlock()
	
	now := time.Now()
	
	for _, node := range nr.nodes {
		// 检查心跳超时
		if node.Status == NodeStatusOnline && 
		   now.Sub(node.HeartbeatAt) > nr.offlineTimeout {
			node.Status = NodeStatusOffline
			node.LastSeenAt = now
			
			// 异步保存状态变更
			go func(n *Node) {
				if err := nr.saveNode(context.Background(), n); err != nil {
					logger.Errorf(nr.ctx, "Failed to save node status change: %v", err)
				}
			}(node)
			
			logger.Warnf(nr.ctx, "Node went offline due to heartbeat timeout: %s", node.ID)
		}
	}
}

// GetStats 获取节点统计信息
func (nr *NodeRegistry) GetStats(ctx context.Context) (*StorageStats, error) {
	return nr.storage.GetStats(ctx)
}