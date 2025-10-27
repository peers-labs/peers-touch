package registry

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-touch/peers-touch-go/core/store"
	"gorm.io/gorm"
)

// NodeStorage 节点存储接口
type NodeStorage interface {
	// 基本操作
	Save(ctx context.Context, node *Node) error
	Get(ctx context.Context, nodeID string) (*Node, error)
	Delete(ctx context.Context, nodeID string) error
	Exists(ctx context.Context, nodeID string) (bool, error)
	
	// 批量操作
	SaveBatch(ctx context.Context, nodes []*Node) error
	GetBatch(ctx context.Context, nodeIDs []string) ([]*Node, error)
	
	// 查询操作
	List(ctx context.Context, filter *NodeFilter) ([]*Node, int, error)
	Search(ctx context.Context, query string, limit int) ([]*Node, error)
	
	// 状态操作
	UpdateStatus(ctx context.Context, nodeID string, status NodeStatus) error
	UpdateHeartbeat(ctx context.Context, nodeID string, timestamp time.Time) error
	
	// 统计操作
	Count(ctx context.Context, filter *NodeFilter) (int, error)
	GetStats(ctx context.Context) (*StorageStats, error)
	
	// 清理操作
	Cleanup(ctx context.Context, olderThan time.Time) (int, error)
	
	// 生命周期
	Close() error
}

// StorageStats 存储统计信息
type StorageStats struct {
	TotalNodes    int `json:"total_nodes"`
	OnlineNodes   int `json:"online_nodes"`
	OfflineNodes  int `json:"offline_nodes"`
	InactiveNodes int `json:"inactive_nodes"`
}

// MemoryStorage 内存存储实现
type MemoryStorage struct {
	nodes map[string]*Node
	mu    sync.RWMutex
}

// NewMemoryStorage 创建内存存储
func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{
		nodes: make(map[string]*Node),
	}
}

func (ms *MemoryStorage) Save(ctx context.Context, node *Node) error {
	if node == nil || node.ID == "" {
		return fmt.Errorf("invalid node")
	}
	
	ms.mu.Lock()
	defer ms.mu.Unlock()
	
	// 深拷贝节点以避免外部修改
	ms.nodes[node.ID] = ms.copyNode(node)
	return nil
}

func (ms *MemoryStorage) Get(ctx context.Context, nodeID string) (*Node, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("node ID cannot be empty")
	}
	
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	
	node, exists := ms.nodes[nodeID]
	if !exists {
		return nil, fmt.Errorf("node not found: %s", nodeID)
	}
	
	return ms.copyNode(node), nil
}

func (ms *MemoryStorage) Delete(ctx context.Context, nodeID string) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	ms.mu.Lock()
	defer ms.mu.Unlock()
	
	if _, exists := ms.nodes[nodeID]; !exists {
		return fmt.Errorf("node not found: %s", nodeID)
	}
	
	delete(ms.nodes, nodeID)
	return nil
}

func (ms *MemoryStorage) Exists(ctx context.Context, nodeID string) (bool, error) {
	if nodeID == "" {
		return false, fmt.Errorf("node ID cannot be empty")
	}
	
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	
	_, exists := ms.nodes[nodeID]
	return exists, nil
}

func (ms *MemoryStorage) SaveBatch(ctx context.Context, nodes []*Node) error {
	if len(nodes) == 0 {
		return nil
	}
	
	ms.mu.Lock()
	defer ms.mu.Unlock()
	
	for _, node := range nodes {
		if node != nil && node.ID != "" {
			ms.nodes[node.ID] = ms.copyNode(node)
		}
	}
	
	return nil
}

func (ms *MemoryStorage) GetBatch(ctx context.Context, nodeIDs []string) ([]*Node, error) {
	if len(nodeIDs) == 0 {
		return []*Node{}, nil
	}
	
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	
	var nodes []*Node
	for _, id := range nodeIDs {
		if node, exists := ms.nodes[id]; exists {
			nodes = append(nodes, ms.copyNode(node))
		}
	}
	
	return nodes, nil
}

func (ms *MemoryStorage) List(ctx context.Context, filter *NodeFilter) ([]*Node, int, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	
	var nodes []*Node
	for _, node := range ms.nodes {
		if ms.matchFilter(node, filter) {
			nodes = append(nodes, ms.copyNode(node))
		}
	}
	
	total := len(nodes)
	
	// 应用分页
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

func (ms *MemoryStorage) Search(ctx context.Context, query string, limit int) ([]*Node, error) {
	if query == "" {
		return []*Node{}, nil
	}
	
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	
	query = strings.ToLower(query)
	var nodes []*Node
	
	for _, node := range ms.nodes {
		// 搜索节点名称和ID
		if strings.Contains(strings.ToLower(node.Name), query) ||
		   strings.Contains(strings.ToLower(node.ID), query) {
			nodes = append(nodes, ms.copyNode(node))
			
			if limit > 0 && len(nodes) >= limit {
				break
			}
		}
	}
	
	return nodes, nil
}

func (ms *MemoryStorage) UpdateStatus(ctx context.Context, nodeID string, status NodeStatus) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	ms.mu.Lock()
	defer ms.mu.Unlock()
	
	node, exists := ms.nodes[nodeID]
	if !exists {
		return fmt.Errorf("node not found: %s", nodeID)
	}
	
	node.Status = status
	node.LastSeenAt = time.Now()
	
	return nil
}

func (ms *MemoryStorage) UpdateHeartbeat(ctx context.Context, nodeID string, timestamp time.Time) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	ms.mu.Lock()
	defer ms.mu.Unlock()
	
	node, exists := ms.nodes[nodeID]
	if !exists {
		return fmt.Errorf("node not found: %s", nodeID)
	}
	
	node.HeartbeatAt = timestamp
	node.LastSeenAt = timestamp
	if node.Status == NodeStatusOffline {
		node.Status = NodeStatusOnline
	}
	
	return nil
}

func (ms *MemoryStorage) Count(ctx context.Context, filter *NodeFilter) (int, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	
	count := 0
	for _, node := range ms.nodes {
		if ms.matchFilter(node, filter) {
			count++
		}
	}
	
	return count, nil
}

func (ms *MemoryStorage) GetStats(ctx context.Context) (*StorageStats, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	
	stats := &StorageStats{}
	
	for _, node := range ms.nodes {
		stats.TotalNodes++
		switch node.Status {
		case NodeStatusOnline:
			stats.OnlineNodes++
		case NodeStatusOffline:
			stats.OfflineNodes++
		case NodeStatusInactive:
			stats.InactiveNodes++
		}
	}
	
	return stats, nil
}

func (ms *MemoryStorage) Cleanup(ctx context.Context, olderThan time.Time) (int, error) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	
	var toDelete []string
	for id, node := range ms.nodes {
		if node.LastSeenAt.Before(olderThan) {
			toDelete = append(toDelete, id)
		}
	}
	
	for _, id := range toDelete {
		delete(ms.nodes, id)
	}
	
	return len(toDelete), nil
}

func (ms *MemoryStorage) Close() error {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	
	ms.nodes = make(map[string]*Node)
	return nil
}

func (ms *MemoryStorage) copyNode(node *Node) *Node {
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

func (ms *MemoryStorage) matchFilter(node *Node, filter *NodeFilter) bool {
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

// PersistentStorage 持久化存储实现（使用内存缓存）
type PersistentStorage struct {
	store  store.Store
	memory *MemoryStorage // 内存缓存
}

// NewPersistentStorage 创建持久化存储
func NewPersistentStorage(store store.Store) *PersistentStorage {
	return &PersistentStorage{
		store:  store,
		memory: NewMemoryStorage(),
	}
}

func (ps *PersistentStorage) Save(ctx context.Context, node *Node) error {
	if node == nil || node.ID == "" {
		return fmt.Errorf("invalid node")
	}
	
	// 保存到内存缓存
	if err := ps.memory.Save(ctx, node); err != nil {
		return fmt.Errorf("failed to save to memory: %w", err)
	}
	
	// TODO: 实现持久化存储逻辑
	
	return nil
}

func (ps *PersistentStorage) Get(ctx context.Context, nodeID string) (*Node, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("node ID cannot be empty")
	}
	
	// 从内存缓存获取
	return ps.memory.Get(ctx, nodeID)
}

func (ps *PersistentStorage) Delete(ctx context.Context, nodeID string) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	// 从内存缓存删除
	return ps.memory.Delete(ctx, nodeID)
}

func (ps *PersistentStorage) Exists(ctx context.Context, nodeID string) (bool, error) {
	if nodeID == "" {
		return false, fmt.Errorf("node ID cannot be empty")
	}
	
	// 检查内存缓存
	return ps.memory.Exists(ctx, nodeID)
}

func (ps *PersistentStorage) SaveBatch(ctx context.Context, nodes []*Node) error {
	if len(nodes) == 0 {
		return nil
	}
	
	// 保存到内存缓存
	return ps.memory.SaveBatch(ctx, nodes)
}

func (ps *PersistentStorage) GetBatch(ctx context.Context, nodeIDs []string) ([]*Node, error) {
	if len(nodeIDs) == 0 {
		return []*Node{}, nil
	}
	
	// 从内存缓存获取
	return ps.memory.GetBatch(ctx, nodeIDs)
}

func (ps *PersistentStorage) List(ctx context.Context, filter *NodeFilter) ([]*Node, int, error) {
	// 从内存缓存列出
	return ps.memory.List(ctx, filter)
}

func (ps *PersistentStorage) Search(ctx context.Context, query string, limit int) ([]*Node, error) {
	// 从内存缓存搜索
	return ps.memory.Search(ctx, query, limit)
}

func (ps *PersistentStorage) UpdateStatus(ctx context.Context, nodeID string, status NodeStatus) error {
	// 更新内存缓存
	return ps.memory.UpdateStatus(ctx, nodeID, status)
}

func (ps *PersistentStorage) UpdateHeartbeat(ctx context.Context, nodeID string, timestamp time.Time) error {
	// 更新内存缓存
	return ps.memory.UpdateHeartbeat(ctx, nodeID, timestamp)
}

func (ps *PersistentStorage) Count(ctx context.Context, filter *NodeFilter) (int, error) {
	return ps.memory.Count(ctx, filter)
}

func (ps *PersistentStorage) GetStats(ctx context.Context) (*StorageStats, error) {
	return ps.memory.GetStats(ctx)
}

func (ps *PersistentStorage) Cleanup(ctx context.Context, olderThan time.Time) (int, error) {
	// 从内存缓存清理
	return ps.memory.Cleanup(ctx, olderThan)
}

func (ps *PersistentStorage) Close() error {
	return ps.memory.Close()
}

// DatabaseStorage GORM数据库存储实现
type DatabaseStorage struct {
	db *gorm.DB
}

// NewDatabaseStorage 创建数据库存储
func NewDatabaseStorage(db *gorm.DB) *DatabaseStorage {
	// 自动迁移表结构
	db.AutoMigrate(&Node{})
	
	return &DatabaseStorage{
		db: db,
	}
}

func (ds *DatabaseStorage) Save(ctx context.Context, node *Node) error {
	if node == nil || node.ID == "" {
		return fmt.Errorf("invalid node")
	}
	
	return ds.db.WithContext(ctx).Save(node).Error
}

func (ds *DatabaseStorage) Get(ctx context.Context, nodeID string) (*Node, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("node ID cannot be empty")
	}
	
	var node Node
	err := ds.db.WithContext(ctx).First(&node, "id = ?", nodeID).Error
	if err != nil {
		return nil, err
	}
	
	return &node, nil
}

func (ds *DatabaseStorage) Delete(ctx context.Context, nodeID string) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	return ds.db.WithContext(ctx).Delete(&Node{}, "id = ?", nodeID).Error
}

func (ds *DatabaseStorage) Exists(ctx context.Context, nodeID string) (bool, error) {
	if nodeID == "" {
		return false, fmt.Errorf("node ID cannot be empty")
	}
	
	var count int64
	err := ds.db.WithContext(ctx).Model(&Node{}).Where("id = ?", nodeID).Count(&count).Error
	return count > 0, err
}

func (ds *DatabaseStorage) SaveBatch(ctx context.Context, nodes []*Node) error {
	if len(nodes) == 0 {
		return nil
	}
	
	return ds.db.WithContext(ctx).CreateInBatches(nodes, 100).Error
}

func (ds *DatabaseStorage) GetBatch(ctx context.Context, nodeIDs []string) ([]*Node, error) {
	if len(nodeIDs) == 0 {
		return []*Node{}, nil
	}
	
	var nodes []*Node
	err := ds.db.WithContext(ctx).Where("id IN ?", nodeIDs).Find(&nodes).Error
	return nodes, err
}

func (ds *DatabaseStorage) List(ctx context.Context, filter *NodeFilter) ([]*Node, int, error) {
	query := ds.db.WithContext(ctx).Model(&Node{})
	
	// 应用过滤条件
	if filter != nil {
		if len(filter.IDs) > 0 {
			query = query.Where("id IN ?", filter.IDs)
		}
		if len(filter.Names) > 0 {
			query = query.Where("name IN ?", filter.Names)
		}
		if len(filter.Status) > 0 {
			query = query.Where("status IN ?", filter.Status)
		}
		if filter.OnlineOnly {
			query = query.Where("status = ?", NodeStatusOnline)
		}
	}
	
	// 获取总数
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	
	// 应用分页
	if filter != nil {
		if filter.Offset > 0 {
			query = query.Offset(filter.Offset)
		}
		if filter.Limit > 0 {
			query = query.Limit(filter.Limit)
		}
	}
	
	var nodes []*Node
	err := query.Find(&nodes).Error
	return nodes, int(total), err
}

func (ds *DatabaseStorage) Search(ctx context.Context, query string, limit int) ([]*Node, error) {
	if query == "" {
		return []*Node{}, nil
	}
	
	dbQuery := ds.db.WithContext(ctx).Where("name LIKE ? OR id LIKE ?", "%"+query+"%", "%"+query+"%")
	if limit > 0 {
		dbQuery = dbQuery.Limit(limit)
	}
	
	var nodes []*Node
	err := dbQuery.Find(&nodes).Error
	return nodes, err
}

func (ds *DatabaseStorage) UpdateStatus(ctx context.Context, nodeID string, status NodeStatus) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	return ds.db.WithContext(ctx).Model(&Node{}).Where("id = ?", nodeID).Updates(map[string]interface{}{
		"status":       status,
		"last_seen_at": time.Now(),
	}).Error
}

func (ds *DatabaseStorage) UpdateHeartbeat(ctx context.Context, nodeID string, timestamp time.Time) error {
	if nodeID == "" {
		return fmt.Errorf("node ID cannot be empty")
	}
	
	return ds.db.WithContext(ctx).Model(&Node{}).Where("id = ?", nodeID).Updates(map[string]interface{}{
		"heartbeat_at": timestamp,
		"last_seen_at": timestamp,
		"status":       NodeStatusOnline,
	}).Error
}

func (ds *DatabaseStorage) Count(ctx context.Context, filter *NodeFilter) (int, error) {
	query := ds.db.WithContext(ctx).Model(&Node{})
	
	// 应用过滤条件
	if filter != nil {
		if len(filter.IDs) > 0 {
			query = query.Where("id IN ?", filter.IDs)
		}
		if len(filter.Names) > 0 {
			query = query.Where("name IN ?", filter.Names)
		}
		if len(filter.Status) > 0 {
			query = query.Where("status IN ?", filter.Status)
		}
		if filter.OnlineOnly {
			query = query.Where("status = ?", NodeStatusOnline)
		}
	}
	
	var count int64
	err := query.Count(&count).Error
	return int(count), err
}

func (ds *DatabaseStorage) GetStats(ctx context.Context) (*StorageStats, error) {
	stats := &StorageStats{}
	
	var totalNodes int64
	var onlineNodes int64
	var offlineNodes int64
	var inactiveNodes int64
	
	// 总节点数
	ds.db.WithContext(ctx).Model(&Node{}).Count(&totalNodes)
	stats.TotalNodes = int(totalNodes)
	
	// 在线节点数
	ds.db.WithContext(ctx).Model(&Node{}).Where("status = ?", NodeStatusOnline).Count(&onlineNodes)
	stats.OnlineNodes = int(onlineNodes)
	
	// 离线节点数
	ds.db.WithContext(ctx).Model(&Node{}).Where("status = ?", NodeStatusOffline).Count(&offlineNodes)
	stats.OfflineNodes = int(offlineNodes)
	
	// 非活跃节点数
	ds.db.WithContext(ctx).Model(&Node{}).Where("status = ?", NodeStatusInactive).Count(&inactiveNodes)
	stats.InactiveNodes = int(inactiveNodes)
	
	return stats, nil
}

func (ds *DatabaseStorage) Cleanup(ctx context.Context, olderThan time.Time) (int, error) {
	result := ds.db.WithContext(ctx).Where("last_seen_at < ?", olderThan).Delete(&Node{})
	return int(result.RowsAffected), result.Error
}

func (ds *DatabaseStorage) Close() error {
	if sqlDB, err := ds.db.DB(); err == nil {
		return sqlDB.Close()
	}
	return nil
}