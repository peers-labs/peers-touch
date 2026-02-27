package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/network"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	hertzadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/hertz"
	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	"github.com/peers-labs/peers-touch/station/frame/core/event"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	eventsmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/events"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// newSSEWriter creates an SSE-compatible chunked body writer
func newSSEWriter(response *protocol.Response, writer network.Writer) network.ExtWriter {
	return resp.NewChunkedBodyWriter(response, writer)
}

func (s *eventsSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()

	// JWT wrapper for authenticated endpoints
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := serverwrapper.JWT(provider)

	// Hertz JWT wrapper for SSE endpoint
	hertzJWTWrapper := hertzadapter.RequireJWT(provider)

	return []server.Handler{
		// SSE stream endpoint - uses Hertz native handler for proper SSE streaming
		server.NewHertzHandler("events-stream", "/events/stream", server.GET, s.handleSSEStreamHertz, hertzJWTWrapper),

		// Pull endpoint for missed events - TypedHandler with Proto
		server.NewTypedHandler("events-pull", "/events/pull", server.POST, s.handlePull, logIDWrapper, jwtWrapper),

		// ACK endpoint for confirming event receipt - TypedHandler with Proto
		server.NewTypedHandler("events-ack", "/events/ack", server.POST, s.handleAck, logIDWrapper, jwtWrapper),

		// Stats endpoint (for debugging) - TypedHandler with Proto
		server.NewTypedHandler("events-stats", "/events/stats", server.GET, s.handleStats, logIDWrapper),
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

func (s *eventsSubServer) handlePull(ctx context.Context, req *eventsmodel.PullEventsRequest) (*eventsmodel.PullEventsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorID := subject.ID

	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	es := event.GetGlobalEventSystem()
	if es == nil || es.Broker == nil {
		return nil, server.InternalError("event system not available")
	}

	sinceID := ""
	if req.SinceTs > 0 {
		sinceID = fmt.Sprintf("%d", req.SinceTs)
	}

	topic := "events:" + actorID
	messages, err := es.Broker.Pull(ctx, topic, sinceID, limit, broker.PullOptions{})
	if err != nil {
		logger.Error(ctx, "Failed to pull events", "error", err)
		return nil, server.InternalErrorWithCause("failed to pull events", err)
	}

	events := make([]*eventsmodel.Event, 0, len(messages))
	for _, msg := range messages {
		var evt event.Event
		if err := json.Unmarshal(msg.Payload, &evt); err != nil {
			continue
		}
		events = append(events, &eventsmodel.Event{
			Id:        evt.ID,
			Type:      string(evt.Type),
			Payload:   evt.Payload,
			CreatedAt: timestamppb.New(evt.Timestamp),
		})
	}

	return &eventsmodel.PullEventsResponse{
		Events: events,
	}, nil
}

func (s *eventsSubServer) handleAck(ctx context.Context, req *eventsmodel.AckEventsRequest) (*eventsmodel.AckEventsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorID := subject.ID

	if len(req.EventIds) == 0 {
		return nil, server.BadRequest("event_ids is required")
	}

	logger.Info(ctx, "Actor acknowledged events", "actorID", actorID, "count", len(req.EventIds))

	return &eventsmodel.AckEventsResponse{
		AckedCount: int32(len(req.EventIds)),
	}, nil
}

func (s *eventsSubServer) handleStats(ctx context.Context, req *eventsmodel.GetEventsStatsRequest) (*eventsmodel.GetEventsStatsResponse, error) {
	es := event.GetGlobalEventSystem()
	if es == nil {
		return nil, server.InternalError("event system not initialized")
	}

	hubStats := es.Hub.Stats()

	return &eventsmodel.GetEventsStatsResponse{
		PendingCount:  int64(hubStats["connections"].(int)),
		TotalDelivered: 0,
		ActiveStreams: int64(hubStats["connections"].(int)),
	}, nil
}
