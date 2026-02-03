package event

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// SSEConnection represents a single SSE connection to a client
type SSEConnection struct {
	ID           string
	ActorID      string
	Writer       http.ResponseWriter
	Flusher      http.Flusher
	Context      context.Context
	Cancel       context.CancelFunc
	LastEventID  string
	ConnectedAt  time.Time
	EventChan    chan *Event
	Subscribed   map[EventType]bool // Event types to receive
	mu           sync.RWMutex
}

// NewSSEConnection creates a new SSE connection
func NewSSEConnection(actorID string, w http.ResponseWriter, lastEventID string) (*SSEConnection, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("response writer does not support flushing")
	}

	ctx, cancel := context.WithCancel(context.Background())
	
	return &SSEConnection{
		ID:          generateEventID(),
		ActorID:     actorID,
		Writer:      w,
		Flusher:     flusher,
		Context:     ctx,
		Cancel:      cancel,
		LastEventID: lastEventID,
		ConnectedAt: time.Now(),
		EventChan:   make(chan *Event, 256), // Buffered to handle bursts
		Subscribed:  make(map[EventType]bool),
	}, nil
}

// Send sends an event to this connection
func (c *SSEConnection) Send(event *Event) error {
	select {
	case c.EventChan <- event:
		return nil
	default:
		// Channel full, connection may be slow
		return fmt.Errorf("event channel full for connection %s", c.ID)
	}
}

// Close closes the connection
func (c *SSEConnection) Close() {
	c.Cancel()
	close(c.EventChan)
}

// ConnectionHub manages all active SSE connections
// Implements the ConnectionHub from the design doc
type ConnectionHub struct {
	mu          sync.RWMutex
	connections map[string][]*SSEConnection // actorID -> connections (one actor can have multiple devices)
	registry    *SubscriptionRegistry
	logger      logger.Logger
}

// NewConnectionHub creates a new ConnectionHub
func NewConnectionHub(log logger.Logger) *ConnectionHub {
	hub := &ConnectionHub{
		connections: make(map[string][]*SSEConnection),
		logger:      log,
	}
	hub.registry = NewSubscriptionRegistry(hub)
	return hub
}

// Register registers a new SSE connection
func (h *ConnectionHub) Register(conn *SSEConnection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.connections[conn.ActorID] = append(h.connections[conn.ActorID], conn)
	logger.Infof(context.Background(), "[ConnectionHub] Registered connection %s for actor %s, total connections: %d",
		conn.ID, conn.ActorID, len(h.connections[conn.ActorID]))
}

// Unregister removes an SSE connection
func (h *ConnectionHub) Unregister(conn *SSEConnection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	conns := h.connections[conn.ActorID]
	for i, c := range conns {
		if c.ID == conn.ID {
			h.connections[conn.ActorID] = append(conns[:i], conns[i+1:]...)
			break
		}
	}

	if len(h.connections[conn.ActorID]) == 0 {
		delete(h.connections, conn.ActorID)
	}

	logger.Infof(context.Background(), "[ConnectionHub] Unregistered connection %s for actor %s", conn.ID, conn.ActorID)
}

// GetConnectionsForActor returns all connections for an actor
func (h *ConnectionHub) GetConnectionsForActor(actorID string) []*SSEConnection {
	h.mu.RLock()
	defer h.mu.RUnlock()

	conns := h.connections[actorID]
	result := make([]*SSEConnection, len(conns))
	copy(result, conns)
	return result
}

// IsActorOnline checks if an actor has any active connections
func (h *ConnectionHub) IsActorOnline(actorID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return len(h.connections[actorID]) > 0
}

// Broadcast sends an event to all connections of a target actor
func (h *ConnectionHub) Broadcast(targetActorID string, event *Event) int {
	conns := h.GetConnectionsForActor(targetActorID)
	if len(conns) == 0 {
		logger.Debugf(context.Background(), "[ConnectionHub] Actor %s is offline, event %s will be stored for later", targetActorID, event.ID)
		return 0
	}

	sent := 0
	for _, conn := range conns {
		if err := conn.Send(event); err != nil {
			logger.Warnf(context.Background(), "[ConnectionHub] Failed to send event to connection %s: %v", conn.ID, err)
		} else {
			sent++
		}
	}

	logger.Debugf(context.Background(), "[ConnectionHub] Broadcast event %s to %d connections of actor %s", event.ID, sent, targetActorID)
	return sent
}

// Stats returns connection statistics
func (h *ConnectionHub) Stats() map[string]interface{} {
	h.mu.RLock()
	defer h.mu.RUnlock()

	totalConns := 0
	for _, conns := range h.connections {
		totalConns += len(conns)
	}

	return map[string]interface{}{
		"total_actors":      len(h.connections),
		"total_connections": totalConns,
	}
}

// RunSSEWriter runs the event writer loop for a connection
// This should be called in a goroutine after registering the connection
func (h *ConnectionHub) RunSSEWriter(conn *SSEConnection) {
	defer h.Unregister(conn)

	// Set SSE headers
	conn.Writer.Header().Set("Content-Type", "text/event-stream")
	conn.Writer.Header().Set("Cache-Control", "no-cache")
	conn.Writer.Header().Set("Connection", "keep-alive")
	conn.Writer.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering
	conn.Flusher.Flush()

	// Send initial comment to establish connection
	fmt.Fprintf(conn.Writer, ": connected\n\n")
	conn.Flusher.Flush()

	// Heartbeat ticker (keep connection alive)
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-conn.Context.Done():
			logger.Infof(context.Background(), "[ConnectionHub] Connection %s closed by context", conn.ID)
			return

		case event, ok := <-conn.EventChan:
			if !ok {
				return
			}
			data, err := json.Marshal(event)
			if err != nil {
				logger.Errorf(context.Background(), "[ConnectionHub] Failed to marshal event: %v", err)
				continue
			}

			// SSE format: id, event, data
			fmt.Fprintf(conn.Writer, "id: %s\n", event.ID)
			fmt.Fprintf(conn.Writer, "event: %s\n", event.Type)
			fmt.Fprintf(conn.Writer, "data: %s\n\n", string(data))
			conn.Flusher.Flush()

		case <-heartbeat.C:
			// Send heartbeat comment
			fmt.Fprintf(conn.Writer, ": heartbeat\n\n")
			conn.Flusher.Flush()
		}
	}
}

// GetRegistry returns the subscription registry
func (h *ConnectionHub) GetRegistry() *SubscriptionRegistry {
	return h.registry
}
