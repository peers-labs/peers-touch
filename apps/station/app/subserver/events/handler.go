package events

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/network"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	hertzadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/hertz"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
)

// Heartbeat cadence; see contract §2.4.
const heartbeatInterval = 15 * time.Second

func newSSEWriter(response *protocol.Response, writer network.Writer) network.ExtWriter {
	return resp.NewChunkedBodyWriter(response, writer)
}

func (s *eventsSubServer) Handlers() []server.Handler {
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	hertzJWTWrapper := hertzadapter.RequireJWT(provider)

	return []server.Handler{
		// Single canonical realtime endpoint. Per contract §1.2 there
		// are no per-feature SSE endpoints; every kind of realtime
		// event multiplexes through this one stream.
		server.NewHertzHandler("events-stream", "/events/stream", server.GET, s.handleStream, hertzJWTWrapper),
	}
}

// handleStream serves the single SSE stream per device-window.
//
// Wire format per contract §2.3:
//
//	event: stream
//	id:    <event_id>
//	data:  <base64(protobuf StreamEvent)>
//	\n
func (s *eventsSubServer) handleStream(ctx context.Context, c *app.RequestContext) {
	subject := hertzadapter.GetSubject(c)
	if subject == nil {
		c.JSON(401, map[string]string{"error": "unauthorized"})
		return
	}
	actorID := subject.ID

	bus := GetBus()
	if bus == nil {
		c.JSON(503, map[string]string{"error": "event bus not initialized"})
		return
	}

	cursor := string(c.GetHeader("Last-Event-ID"))
	deviceID := string(c.GetHeader("X-Device-ID"))
	if deviceID == "" {
		deviceID = fmt.Sprintf("anon-%d", time.Now().UnixNano())
	}

	// SSE response headers must be set before we hijack the writer.
	c.Response.Header.Set("Content-Type", "text/event-stream")
	c.Response.Header.Set("Cache-Control", "no-cache")
	c.Response.Header.Set("Connection", "keep-alive")
	c.Response.Header.Set("X-Accel-Buffering", "no") // disable nginx buffering
	c.Response.Header.Set("Transfer-Encoding", "chunked")
	c.SetStatusCode(200)
	c.Response.HijackWriter(newSSEWriter(&c.Response, c.GetWriter()))

	connCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub, unsub, err := bus.Subscribe(connCtx, actorID, deviceID, cursor)
	if err != nil {
		logger.DefaultHelper.Warnf("events: subscribe failed actor=%s err=%v", actorID, err)
		// Best-effort write; if it fails the connection is already gone.
		_, _ = c.Write([]byte(fmt.Sprintf(": error %s\n\n", err.Error())))
		_ = c.Flush()
		return
	}
	defer unsub()

	logger.DefaultHelper.Infof("events: subscriber connected actor=%s device=%s cursor=%q", actorID, deviceID, cursor)

	// Emit a comment frame so intermediaries flush the response head.
	if _, err := c.Write([]byte(": connected\n\n")); err != nil {
		return
	}
	if err := c.Flush(); err != nil {
		return
	}

	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()

	// Track the newest event_id we've sent on this connection so
	// Heartbeat carries an accurate floor_event_id (contract §2.4).
	var floorID string

	for {
		select {
		case <-ctx.Done():
			return

		case <-connCtx.Done():
			return

		case ev, ok := <-sub.Events:
			if !ok {
				logger.DefaultHelper.Infof("events: subscription closed actor=%s device=%s", actorID, deviceID)
				return
			}
			if err := writeFrame(c, ev); err != nil {
				logger.DefaultHelper.Warnf("events: write failed actor=%s err=%v", actorID, err)
				return
			}
			floorID = ev.GetEventId()

		case <-heartbeat.C:
			hb := &realtime.StreamEvent{
				// Heartbeat doesn't go through the bus and so doesn't
				// participate in resume — by design (contract §2.4
				// allows heartbeats to be best-effort). We still stamp
				// a per-connection event_id so the client's
				// Last-Event-ID never regresses.
				EventId:  floorID,
				TsUnixMs: time.Now().UTC().UnixMilli(),
				Kind: &realtime.StreamEvent_Hb{
					Hb: &realtime.Heartbeat{FloorEventId: floorID},
				},
			}
			if err := writeFrame(c, hb); err != nil {
				return
			}
		}
	}
}

// writeFrame encodes ev as a single SSE frame per contract §2.3 and
// flushes the underlying TCP socket.
func writeFrame(c *app.RequestContext, ev *realtime.StreamEvent) error {
	bytes, err := proto.Marshal(ev)
	if err != nil {
		return fmt.Errorf("marshal stream event: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(bytes)

	// id: only present when we have one — heartbeats early in a
	// connection may not yet have a floor.
	if id := ev.GetEventId(); id != "" {
		if _, err := c.Write([]byte("id: " + id + "\n")); err != nil {
			return err
		}
	}
	if _, err := c.Write([]byte("event: stream\ndata: " + encoded + "\n\n")); err != nil {
		return err
	}
	return c.Flush()
}
