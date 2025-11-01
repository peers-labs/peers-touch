package registry

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// memoryNodeStorage implements NodeStorage interface

// memoryNodeStorage implements NodeStorage interface
type memoryNodeStorage struct {
	mu    sync.RWMutex
	nodes map[string]*Node
}

func (m *memoryNodeStorage) Register(ctx context.Context, node *Node) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.nodes[node.ID] = node
	return nil
}

func (m *memoryNodeStorage) Deregister(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.nodes, id)
	return nil
}

func (m *memoryNodeStorage) GetNode(ctx context.Context, id string) (*Node, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	node, exists := m.nodes[id]
	if !exists {
		return nil, fmt.Errorf("node not found: %s", id)
	}
	return node, nil
}

func (m *memoryNodeStorage) ListNodes(ctx context.Context, filter *NodeFilter) ([]*Node, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var nodes []*Node
	for _, node := range m.nodes {
		// Apply filters
		if filter != nil {
			if filter.OnlineOnly && node.Status != NodeStatusOnline {
				continue
			}

			if len(filter.Status) > 0 {
				found := false
				for _, status := range filter.Status {
					if node.Status == status {
						found = true
						break
					}
				}
				if !found {
					continue
				}
			}

			if len(filter.Capabilities) > 0 {
				found := false
				for _, cap := range filter.Capabilities {
					for _, nodeCap := range node.Capabilities {
						if cap == nodeCap {
							found = true
							break
						}
					}
					if found {
						break
					}
				}
				if !found {
					continue
				}
			}
		}

		nodes = append(nodes, node)
	}

	total := len(nodes)

	// Apply pagination
	if filter != nil && filter.Limit > 0 {
		start := filter.Offset
		if start >= len(nodes) {
			nodes = []*Node{}
		} else {
			end := start + filter.Limit
			if end > len(nodes) {
				end = len(nodes)
			}
			nodes = nodes[start:end]
		}
	}

	return nodes, total, nil
}

func (m *memoryNodeStorage) UpdateNode(ctx context.Context, node *Node) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.nodes[node.ID]; !exists {
		return fmt.Errorf("node not found: %s", node.ID)
	}

	m.nodes[node.ID] = node
	return nil
}

func (m *memoryNodeStorage) Heartbeat(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	node, exists := m.nodes[id]
	if !exists {
		return fmt.Errorf("node not found: %s", id)
	}

	node.HeartbeatAt = time.Now()
	node.LastSeenAt = time.Now()
	return nil
}

// NodeRegistry methods implementation
type NodeRegistry struct {
	storage NodeStorage
}

// NewMemoryStorage creates a new in-memory node storage
func NewMemoryStorage() NodeStorage {
	return &memoryNodeStorage{
		nodes: make(map[string]*Node),
	}
}

// NewNodeRegistry creates a new node registry
func NewNodeRegistry(storage NodeStorage) *NodeRegistry {
	if storage == nil {
		storage = NewMemoryStorage()
	}
	return &NodeRegistry{
		storage: storage,
	}
}

// GetStats returns statistics about the registry
func (n *NodeRegistry) GetStats(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})
	stats["total_nodes"] = 0
	stats["online_nodes"] = 0
	stats["offline_nodes"] = 0
	stats["inactive_nodes"] = 0
	return stats, nil
}

func (n *NodeRegistry) Register(ctx context.Context, node *Node) error {
	return n.storage.Register(ctx, node)
}

func (n *NodeRegistry) Deregister(ctx context.Context, id string) error {
	return n.storage.Deregister(ctx, id)
}

func (n *NodeRegistry) GetNode(ctx context.Context, id string) (*Node, error) {
	return n.storage.GetNode(ctx, id)
}

func (n *NodeRegistry) ListNodes(ctx context.Context, filter *NodeFilter) ([]*Node, int, error) {
	return n.storage.ListNodes(ctx, filter)
}

func (n *NodeRegistry) UpdateNode(ctx context.Context, node *Node) error {
	return n.storage.UpdateNode(ctx, node)
}

func (n *NodeRegistry) Heartbeat(ctx context.Context, id string) error {
	return n.storage.Heartbeat(ctx, id)
}
