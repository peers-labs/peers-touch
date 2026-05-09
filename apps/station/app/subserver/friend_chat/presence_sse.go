package friend_chat

import (
	"context"
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
)

// newSSEWriter mirrors events/handler.go: Hertz needs a chunked-aware
// extension writer to flush each SSE frame end-to-end.
func newSSEWriter(response *protocol.Response, writer network.Writer) network.ExtWriter {
	return resp.NewChunkedBodyWriter(response, writer)
}

// handlePresenceStream is a long-lived SSE endpoint that pushes
// `PresenceEvent` JSON every time any user transitions online ↔ offline.
//
// Why a per-feature endpoint instead of `/events/stream`:
//   - Presence is ephemeral / non-durable. The global event hub persists
//     events to an outbox so cold-starting clients can replay them; we
//     explicitly do not want that for presence (a client coming online
//     should reread `/friend-chat/sessions` to get the truth, not replay
//     stale flips).
//   - Fan-out semantics differ. Global events route per actor topic;
//     presence is broadcast to all subscribers and the client filters to
//     "DIDs I have a session with".
//
// Auth: same JWT flow as `/events/stream`. We ignore the subject's own
// presence on the wire (a client doesn't need to be told "you're online")
// to keep the stream signal-only for *peer* status.
func (s *subServer) handlePresenceStream(ctx context.Context, c *app.RequestContext) {
	subject := hertzadapter.GetSubject(c)
	if subject == nil {
		c.JSON(401, map[string]string{"error": "unauthorized"})
		return
	}
	selfDID := subject.ID

	c.Response.Header.Set("Content-Type", "text/event-stream")
	c.Response.Header.Set("Cache-Control", "no-cache")
	c.Response.Header.Set("Connection", "keep-alive")
	c.Response.Header.Set("X-Accel-Buffering", "no")
	c.Response.Header.Set("Transfer-Encoding", "chunked")
	c.SetStatusCode(200)
	c.Response.HijackWriter(newSSEWriter(&c.Response, c.GetWriter()))

	connCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 64 is generous; presence transitions are rare and a slow client just
	// drops events (it can resync via the sessions endpoint).
	ch := make(chan PresenceEvent, 64)
	subID := fmt.Sprintf("presence-%s-%d", selfDID, time.Now().UnixNano())
	s.addPresenceSub(subID, ch)
	defer s.removePresenceSub(subID)

	// Initial snapshot — clients reconnect without missing the *current*
	// state of any peer they care about. Server doesn't know the friend
	// graph here without a query, so we just send every online DID; the
	// client filters by its session participants.
	s.mu.RLock()
	for did := range s.online {
		if did == selfDID {
			continue
		}
		evt := PresenceEvent{Did: did, Online: true, AtUnix: time.Now().Unix()}
		data, _ := json.Marshal(evt)
		fmt.Fprintf(c, "event: presence\ndata: %s\n\n", string(data))
	}
	s.mu.RUnlock()
	if err := c.Flush(); err != nil {
		logger.DefaultHelper.Warnf("presence sse: initial flush failed: %v", err)
		return
	}

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-connCtx.Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			// Suppress self-presence; the client already knows its own state.
			if evt.Did == selfDID {
				continue
			}
			data, err := json.Marshal(evt)
			if err != nil {
				continue
			}
			fmt.Fprintf(c, "event: presence\ndata: %s\n\n", string(data))
			if err := c.Flush(); err != nil {
				logger.DefaultHelper.Warnf("presence sse: flush failed: %v", err)
				return
			}
		case <-heartbeat.C:
			if valid, reason := coreauth.CheckSubjectSessionValid(ctx, subject); !valid {
				logger.DefaultHelper.Infof("presence sse: closing revoked stream actor=%s session=%s reason=%s", selfDID, subject.SessionID, reason)
				return
			}

			if _, err := c.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			if err := c.Flush(); err != nil {
				return
			}
		}
	}
}
