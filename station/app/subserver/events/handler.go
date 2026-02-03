package events

import (
	"encoding/json"
	"net/http"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	"github.com/peers-labs/peers-touch/station/frame/core/event"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func (s *eventsSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	
	// JWT wrapper for authenticated endpoints
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	
	return []server.Handler{
		// SSE stream endpoint - main real-time push channel
		server.NewHTTPHandler("events-stream", "/events/stream", server.GET, server.HTTPHandlerFunc(s.handleSSEStream), logIDWrapper, jwtWrapper),
		
		// Pull endpoint for missed events
		server.NewHTTPHandler("events-pull", "/events/pull", server.GET, server.HTTPHandlerFunc(s.handlePull), logIDWrapper, jwtWrapper),
		
		// ACK endpoint for confirming event receipt
		server.NewHTTPHandler("events-ack", "/events/ack", server.POST, server.HTTPHandlerFunc(s.handleAck), logIDWrapper, jwtWrapper),
		
		// Stats endpoint (for debugging)
		server.NewHTTPHandler("events-stats", "/events/stats", server.GET, server.HTTPHandlerFunc(s.handleStats), logIDWrapper),
	}
}

// handleSSEStream handles SSE stream connections
// GET /events/stream
func (s *eventsSubServer) handleSSEStream(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user
	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorID := subject.ID

	es := event.GetGlobalEventSystem()
	if es == nil {
		http.Error(w, "event system not initialized", http.StatusServiceUnavailable)
		return
	}

	lastEventID := r.Header.Get("Last-Event-ID")
	if lastEventID == "" {
		lastEventID = r.URL.Query().Get("lastEventId")
	}

	// Create SSE connection
	conn, err := event.NewSSEConnection(actorID, w, lastEventID)
	if err != nil {
		logger.DefaultHelper.Errorf("Failed to create SSE connection: %v", err)
		http.Error(w, "failed to establish SSE connection", http.StatusInternalServerError)
		return
	}

	// Register connection
	es.Hub.Register(conn)

	// Subscribe actor to receive all their events
	es.Hub.GetRegistry().SubscribeActor(actorID, nil) // nil = receive all event types

	logger.DefaultHelper.Infof("SSE connection established for actor %s", actorID)

	// If lastEventID provided, send missed events first
	if lastEventID != "" {
		go s.sendMissedEvents(conn, lastEventID, es)
	}

	// Run the SSE writer loop (blocks until connection closes)
	es.Hub.RunSSEWriter(conn)
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
