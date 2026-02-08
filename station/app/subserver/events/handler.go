package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/network"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	hertzadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/hertz"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	"github.com/peers-labs/peers-touch/station/frame/core/event"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// newSSEWriter creates an SSE-compatible chunked body writer
func newSSEWriter(response *protocol.Response, writer network.Writer) network.ExtWriter {
	return resp.NewChunkedBodyWriter(response, writer)
}

func (s *eventsSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	
	// JWT wrapper for authenticated endpoints (HTTP style)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	
	// Hertz JWT wrapper for SSE endpoint
	hertzJWTWrapper := hertzadapter.RequireJWT(provider)
	
	return []server.Handler{
		// SSE stream endpoint - uses Hertz native handler for proper SSE streaming
		server.NewHertzHandler("events-stream", "/events/stream", server.GET, s.handleSSEStreamHertz, hertzJWTWrapper),
		
		// Pull endpoint for missed events
		server.NewHTTPHandler("events-pull", "/events/pull", server.GET, server.HTTPHandlerFunc(s.handlePull), logIDWrapper, jwtWrapper),
		
		// ACK endpoint for confirming event receipt
		server.NewHTTPHandler("events-ack", "/events/ack", server.POST, server.HTTPHandlerFunc(s.handleAck), logIDWrapper, jwtWrapper),
		
		// Stats endpoint (for debugging)
		server.NewHTTPHandler("events-stats", "/events/stats", server.GET, server.HTTPHandlerFunc(s.handleStats), logIDWrapper),
	}
}

// handleSSEStreamHertz handles SSE stream connections using Hertz native streaming
// GET /events/stream
func (s *eventsSubServer) handleSSEStreamHertz(ctx context.Context, c *app.RequestContext) {
	// Get authenticated user from Hertz context
	subject := hertzadapter.GetSubject(c)
	if subject == nil {
		c.JSON(401, map[string]string{"error": "unauthorized"})
		return
	}
	actorID := subject.ID

	es := event.GetGlobalEventSystem()
	if es == nil {
		c.JSON(503, map[string]string{"error": "event system not initialized"})
		return
	}

	lastEventID := string(c.GetHeader("Last-Event-ID"))
	if lastEventID == "" {
		lastEventID = c.Query("lastEventId")
	}

	// Set SSE headers BEFORE hijacking the writer
	c.Response.Header.Set("Content-Type", "text/event-stream")
	c.Response.Header.Set("Cache-Control", "no-cache")
	c.Response.Header.Set("Connection", "keep-alive")
	c.Response.Header.Set("X-Accel-Buffering", "no") // Disable nginx buffering
	c.Response.Header.Set("Transfer-Encoding", "chunked")
	c.SetStatusCode(200)

	// Hijack the response writer for streaming (chunked transfer)
	// This enables immediate flushing of data to the client
	c.Response.HijackWriter(newSSEWriter(&c.Response, c.GetWriter()))

	// Create connection context
	connCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create event channel for this connection
	eventChan := make(chan *event.Event, 256)
	connID := fmt.Sprintf("sse-%s-%d", actorID, time.Now().UnixNano())

	// Create wrapper connection for the hub
	conn := &event.SSEConnection{
		ID:          connID,
		ActorID:     actorID,
		Context:     connCtx,
		Cancel:      cancel,
		LastEventID: lastEventID,
		ConnectedAt: time.Now(),
		EventChan:   eventChan,
		Subscribed:  make(map[event.EventType]bool),
	}

	// Register connection
	es.Hub.RegisterSSE(conn)
	defer es.Hub.Unregister(conn)

	// Subscribe actor to receive all their events
	es.Hub.GetRegistry().SubscribeActor(actorID, nil)

	logger.DefaultHelper.Infof("SSE connection established for actor %s (Hertz streaming)", actorID)

	// Send initial connection message - this must flush immediately
	c.Write([]byte(": connected\n\n"))
	c.Flush()

	// If lastEventID provided, send missed events
	if lastEventID != "" {
		s.sendMissedEventsToHertz(c, actorID, lastEventID, es)
	}

	// Heartbeat ticker
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	// Main event loop
	for {
		select {
		case <-ctx.Done():
			logger.DefaultHelper.Infof("SSE connection %s closed by client", connID)
			return

		case <-connCtx.Done():
			logger.DefaultHelper.Infof("SSE connection %s closed by server", connID)
			return

		case evt, ok := <-eventChan:
			if !ok {
				return
			}
			data, err := json.Marshal(evt)
			if err != nil {
				logger.DefaultHelper.Errorf("Failed to marshal event: %v", err)
				continue
			}

			// Write SSE formatted message
			sseMsg := fmt.Sprintf("id: %s\nevent: %s\ndata: %s\n\n", evt.ID, evt.Type, string(data))
			c.Write([]byte(sseMsg))
			if err := c.Flush(); err != nil {
				logger.DefaultHelper.Warnf("Failed to flush SSE: %v", err)
				return
			}

		case <-heartbeat.C:
			// Send heartbeat comment
			c.Write([]byte(": heartbeat\n\n"))
			if err := c.Flush(); err != nil {
				logger.DefaultHelper.Warnf("Failed to flush heartbeat: %v", err)
				return
			}
		}
	}
}

// sendMissedEventsToHertz sends missed events directly to Hertz context
func (s *eventsSubServer) sendMissedEventsToHertz(c *app.RequestContext, actorID, lastEventID string, es *event.EventSystem) {
	if es.Broker == nil {
		return
	}

	topic := "events:" + actorID
	messages, err := es.Broker.Pull(context.Background(), topic, lastEventID, 100, broker.PullOptions{})
	if err != nil {
		logger.DefaultHelper.Warnf("Failed to pull missed events: %v", err)
		return
	}

	for _, msg := range messages {
		var evt event.Event
		if err := json.Unmarshal(msg.Payload, &evt); err != nil {
			continue
		}
		data, _ := json.Marshal(&evt)
		fmt.Fprintf(c, "id: %s\n", evt.ID)
		fmt.Fprintf(c, "event: %s\n", evt.Type)
		fmt.Fprintf(c, "data: %s\n\n", string(data))
	}
	c.Flush()

	logger.DefaultHelper.Infof("Sent %d missed events to actor %s", len(messages), actorID)
}

// sendMissedEvents sends events that were missed while the client was offline
func (s *eventsSubServer) sendMissedEvents(conn *event.SSEConnection, lastEventID string, es *event.EventSystem) {
	if es.Broker == nil {
		return
	}

	topic := "events:" + conn.ActorID
	messages, err := es.Broker.Pull(conn.Context, topic, lastEventID, 100, broker.PullOptions{})
	if err != nil {
		logger.DefaultHelper.Warnf("Failed to pull missed events: %v", err)
		return
	}

	for _, msg := range messages {
		var evt event.Event
		if err := json.Unmarshal(msg.Payload, &evt); err != nil {
			continue
		}
		conn.Send(&evt)
	}

	logger.DefaultHelper.Infof("Sent %d missed events to actor %s", len(messages), conn.ActorID)
}

// handlePull handles pull-based event retrieval
// GET /events/pull
func (s *eventsSubServer) handlePull(w http.ResponseWriter, r *http.Request) {
	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorID := subject.ID

	sinceID := r.URL.Query().Get("since")
	limit := 50 // Default limit

	es := event.GetGlobalEventSystem()
	if es == nil || es.Broker == nil {
		http.Error(w, "event system not available", http.StatusServiceUnavailable)
		return
	}

	topic := "events:" + actorID
	messages, err := es.Broker.Pull(r.Context(), topic, sinceID, limit, broker.PullOptions{})
	if err != nil {
		logger.DefaultHelper.Errorf("Failed to pull events: %v", err)
		http.Error(w, "failed to pull events", http.StatusInternalServerError)
		return
	}

	events := make([]event.Event, 0, len(messages))
	for _, msg := range messages {
		var evt event.Event
		if err := json.Unmarshal(msg.Payload, &evt); err != nil {
			continue
		}
		events = append(events, evt)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"events": events,
		"count":  len(events),
	})
}

// handleAck handles event acknowledgment
// POST /events/ack
func (s *eventsSubServer) handleAck(w http.ResponseWriter, r *http.Request) {
	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorID := subject.ID

	var req struct {
		EventIDs []string `json:"eventIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// TODO: Implement ACK handling - mark events as acknowledged
	// This would update the event status in the outbox/store

	logger.DefaultHelper.Infof("Actor %s acknowledged %d events", actorID, len(req.EventIDs))
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"acknowledged": len(req.EventIDs),
	})
}

// handleStats returns event system statistics
// GET /events/stats
func (s *eventsSubServer) handleStats(w http.ResponseWriter, r *http.Request) {
	es := event.GetGlobalEventSystem()
	if es == nil {
		http.Error(w, "event system not initialized", http.StatusServiceUnavailable)
		return
	}

	hubStats := es.Hub.Stats()
	registryStats := es.Hub.GetRegistry().Stats()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"hub":      hubStats,
		"registry": registryStats,
	})
}
