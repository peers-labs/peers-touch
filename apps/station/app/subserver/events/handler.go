package events

import (
	"context"
	"encoding/base64"
	"encoding/json"
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

// signalIngressMaxPayloadBytes is the cap on the decoded ciphertext
// of a single signaling event. SDP offers/answers in our codec set
// run ~3-5 KiB; ICE candidates ~200 B; the encryption envelope adds
// ~50 B overhead. 64 KiB is a generous ceiling that still bounds
// memory pressure if a misbehaving peer floods us with garbage.
const signalIngressMaxPayloadBytes = 64 * 1024

// signalKindMap converts the wire string form of a signaling kind
// (the JSON sent by the client) into the protobuf enum that rides
// on the EventBus. Mirroring the proto enum here, rather than
// reflecting it, keeps the JSON contract stable across proto-gen
// tweaks.
var signalKindMap = map[string]realtime.CallSignal_Kind{
	"OFFER":     realtime.CallSignal_OFFER,
	"ANSWER":    realtime.CallSignal_ANSWER,
	"CANDIDATE": realtime.CallSignal_CANDIDATE,
	"HANGUP":    realtime.CallSignal_HANGUP,
}

// Heartbeat cadence; see contract §2.4.
const heartbeatInterval = 15 * time.Second

func newSSEWriter(response *protocol.Response, writer network.Writer) network.ExtWriter {
	return resp.NewChunkedBodyWriter(response, writer)
}

func (s *eventsSubServer) Handlers() []server.Handler {
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	hertzJWTWrapper := hertzadapter.RequireJWT(provider)

	return []server.Handler{
		// Single canonical realtime egress endpoint. Per contract §1.2
		// there are no per-feature SSE endpoints; every kind of
		// realtime event multiplexes through this one stream.
		server.NewHertzHandler("events-stream", "/events/stream", server.GET, s.handleStream, hertzJWTWrapper),

		// Signaling ingress (contract §2.7.1). WebRTC offer / answer /
		// ICE candidate / hangup arrive here as opaque ciphertext
		// (contract §2.7.2 — encrypted with the chat session ratchet)
		// and Station fan-outs them onto the recipient's SSE stream
		// plus the sender's stream for multi-device echo. Station
		// never inspects the payload.
		server.NewHertzHandler("realtime-signal", "/realtime/signal", server.POST, s.handlePostSignal, hertzJWTWrapper),

		// Typing-state ingress. The sender publishes a typing=true
		// pulse on input and a typing=false on idle / blur / send;
		// Station fan-outs it onto the recipient's SSE stream so the
		// receiver's UI can show "X is typing…" in real time. Typing
		// is ephemeral — Station never persists it — so this endpoint
		// is best-effort: bus errors are logged but the caller still
		// receives a 204 because there is nothing useful for the
		// caller to do about a typing-frame that didn't land.
		server.NewHertzHandler("realtime-typing", "/realtime/typing", server.POST, s.handlePostTyping, hertzJWTWrapper),
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

// signalIngressRequest is the JSON body of POST /realtime/signal.
//
// `payload_b64` is the base64-encoded ciphertext produced by the
// client per contract §2.7.2. Station treats it as opaque bytes —
// it never decodes / decrypts / parses the JSON inside.
type signalIngressRequest struct {
	RecipientActorID string `json:"recipient_actor_id"`
	SessionULID      string `json:"session_ulid"`
	Kind             string `json:"kind"`
	PayloadB64       string `json:"payload_b64"`
}

// handlePostSignal ingests a single WebRTC signaling event from the
// caller, validates the routing metadata, and fan-outs a CallSignal
// frame onto the recipient's (and, when distinct, the sender's) SSE
// stream. See contract §2.7.1 for the wire shape.
func (s *eventsSubServer) handlePostSignal(ctx context.Context, c *app.RequestContext) {
	subject := hertzadapter.GetSubject(c)
	if subject == nil {
		c.JSON(401, map[string]string{"error": "unauthorized"})
		return
	}
	senderActorID := subject.ID

	var req signalIngressRequest
	if err := json.Unmarshal(c.Request.Body(), &req); err != nil {
		c.JSON(400, map[string]string{"error": "invalid json: " + err.Error()})
		return
	}

	if req.RecipientActorID == "" || req.SessionULID == "" || req.Kind == "" {
		c.JSON(400, map[string]string{"error": "recipient_actor_id, session_ulid, kind are required"})
		return
	}

	kind, ok := signalKindMap[req.Kind]
	if !ok {
		c.JSON(400, map[string]string{"error": "unknown kind: " + req.Kind})
		return
	}

	// Decode payload purely to length-check it. We never inspect the
	// plaintext — that is the chat session's per-message ciphertext.
	payload, err := base64.StdEncoding.DecodeString(req.PayloadB64)
	if err != nil {
		c.JSON(400, map[string]string{"error": "payload_b64 is not valid base64"})
		return
	}
	if len(payload) > signalIngressMaxPayloadBytes {
		c.JSON(413, map[string]string{
			"error": fmt.Sprintf("payload too large: %d > %d", len(payload), signalIngressMaxPayloadBytes),
		})
		return
	}

	bus := GetBus()
	if bus == nil {
		// EventBus down means the realtime plane is unreachable;
		// reject the publish so the client can surface the error
		// rather than silently dropping the signal. (Unlike the
		// chat path, signaling has no durable persistence layer
		// behind it — the EventBus IS the delivery contract.)
		c.JSON(503, map[string]string{"error": "event bus not initialized"})
		return
	}

	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Signaling{
			Signaling: &realtime.CallSignal{
				SessionUlid: req.SessionULID,
				FromActorId: senderActorID,
				Kind:        kind,
				Payload:     payload,
			},
		},
	}

	if _, err := bus.Publish(req.RecipientActorID, ev); err != nil {
		// Publish errors are operational, not policy. Log and bail
		// with 502 so the caller knows the routing failed.
		logger.DefaultHelper.Warnf("events: signal publish to recipient failed actor=%s: %v", req.RecipientActorID, err)
		c.JSON(502, map[string]string{"error": "publish failed: " + err.Error()})
		return
	}

	// Multi-device sender echo: a caller running two clients of the
	// same actor needs the second client to learn the call was
	// initiated. When sender == recipient (self-call, which is
	// nonsense for voice/video but legal for protocol completeness),
	// we skip the echo to avoid a duplicate frame.
	if senderActorID != req.RecipientActorID {
		if _, err := bus.Publish(senderActorID, ev); err != nil {
			// Sender echo is best-effort — the caller's primary
			// device already knows it sent the signal because it
			// got a 204 from us. Don't fail the request.
			logger.DefaultHelper.Warnf("events: signal echo to sender failed actor=%s: %v", senderActorID, err)
		}
	}

	c.SetStatusCode(204)
}

// typingIngressRequest is the JSON body of POST /realtime/typing.
//
// Typing is purely advisory metadata — there is no payload, no
// encryption, no persistence. Misrouting it is a privacy issue (a
// peer would learn that the actor is talking to someone) but not a
// confidentiality one (no message content leaks).
type typingIngressRequest struct {
	RecipientActorID string `json:"recipient_actor_id"`
	SessionULID      string `json:"session_ulid"`
	Typing           bool   `json:"typing"`
}

// handlePostTyping ingests a single typing-state update from the
// caller and fan-outs a TypingState frame onto the recipient's SSE
// stream. Unlike signaling, we do NOT echo to other sender devices —
// only the peer needs to know the actor is typing.
//
// Bus errors are logged at warn level but the caller still receives
// a 204; typing frames are ephemeral and the next frame (e.g. the
// auto-fire typing=false on send) will heal the state regardless.
func (s *eventsSubServer) handlePostTyping(ctx context.Context, c *app.RequestContext) {
	subject := hertzadapter.GetSubject(c)
	if subject == nil {
		c.JSON(401, map[string]string{"error": "unauthorized"})
		return
	}
	senderActorID := subject.ID

	var req typingIngressRequest
	if err := json.Unmarshal(c.Request.Body(), &req); err != nil {
		c.JSON(400, map[string]string{"error": "invalid json: " + err.Error()})
		return
	}

	if req.RecipientActorID == "" || req.SessionULID == "" {
		c.JSON(400, map[string]string{"error": "recipient_actor_id, session_ulid are required"})
		return
	}

	bus := GetBus()
	if bus == nil {
		// Typing without a bus is a no-op, but the *caller* still
		// did its job. Return 204 so the client doesn't retry.
		logger.DefaultHelper.Warnf("events: typing ingress dropped (bus down) actor=%s", senderActorID)
		c.SetStatusCode(204)
		return
	}

	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Typing{
			Typing: &realtime.TypingState{
				SessionUlid: req.SessionULID,
				FromActorId: senderActorID,
				Typing:      req.Typing,
			},
		},
	}

	if _, err := bus.Publish(req.RecipientActorID, ev); err != nil {
		logger.DefaultHelper.Warnf("events: typing publish to recipient failed actor=%s: %v", req.RecipientActorID, err)
	}

	c.SetStatusCode(204)
}
