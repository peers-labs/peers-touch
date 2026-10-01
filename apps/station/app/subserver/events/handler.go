package events

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/network"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	hertzadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/hertz"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
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
	"OFFER":        realtime.CallSignal_OFFER,
	"ANSWER":       realtime.CallSignal_ANSWER,
	"CANDIDATE":    realtime.CallSignal_CANDIDATE,
	"HANGUP":       realtime.CallSignal_HANGUP,
	"CALL_REQUEST": realtime.CallSignal_CALL_REQUEST,
	"CALL_ACCEPT":  realtime.CallSignal_CALL_ACCEPT,
	"CALL_REJECT":  realtime.CallSignal_CALL_REJECT,
	"CALL_END":     realtime.CallSignal_CALL_END,
	"ROOM_ACTIVE":  realtime.CallSignal_ROOM_ACTIVE,
	"ROOM_ENDED":   realtime.CallSignal_ROOM_ENDED,
}

// Heartbeat cadence; see contract §2.4.
const heartbeatInterval = 15 * time.Second

const remoteSignalTimeout = 5 * time.Second

type signalHomeStationResolver interface {
	ResolveActorHomeStationPeerID(context.Context, string) (string, error)
}

type signalFederationCaller interface {
	CallPeer(context.Context, federationruntime.PeerCall) error
	LocalStationPeerID() string
}

type signalFederationRuntimeProvider interface {
	FederationDeliveryRuntime() *federationruntime.Runtime
}

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
		server.NewHertzHandler("realtime-call-resolution", "/realtime/call-resolution", server.GET, s.handleGetCallResolution, hertzJWTWrapper),
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
	actorPTID := subject.ID

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

	sub, unsub, err := bus.Subscribe(connCtx, actorPTID, deviceID, cursor)
	if err != nil {
		logger.DefaultHelper.Warnf("events: subscribe failed actor_ptid=%s err=%v", actorPTID, err)
		// Best-effort write; if it fails the connection is already gone.
		_, _ = c.Write([]byte(fmt.Sprintf(": error %s\n\n", err.Error())))
		_ = c.Flush()
		return
	}
	defer unsub()

	logger.DefaultHelper.Infof("events: subscriber connected actor_ptid=%s device=%s cursor=%q", actorPTID, deviceID, cursor)

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
				logger.DefaultHelper.Infof("events: subscription closed actor_ptid=%s device=%s", actorPTID, deviceID)
				return
			}
			if err := writeFrame(c, ev); err != nil {
				logger.DefaultHelper.Warnf("events: write failed actor_ptid=%s err=%v", actorPTID, err)
				return
			}
			floorID = ev.GetEventId()

		case <-heartbeat.C:
			if valid, reason := coreauth.CheckSubjectSessionValid(ctx, subject); !valid {
				logger.DefaultHelper.Infof("events: closing revoked stream actor_ptid=%s session=%s reason=%s", actorPTID, subject.SessionID, reason)
				return
			}

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
	RecipientPTID string `json:"recipient_ptid"`
	SessionULID   string `json:"session_ulid"`
	Kind          string `json:"kind"`
	PayloadB64    string `json:"payload_b64"`
	CallID        string `json:"call_id,omitempty"`
	DeviceID      string `json:"device_id,omitempty"`
}

type callResolutionResponse struct {
	CallID          string `json:"call_id"`
	State           string `json:"state"`
	WinningDeviceID string `json:"winning_device_id,omitempty"`
	TerminalAction  string `json:"terminal_action,omitempty"`
	RingDeadlineMs  int64  `json:"ring_deadline_unix_ms"`
	ResolvedAtMs    int64  `json:"resolved_at_unix_ms,omitempty"`
	ExpiresAtMs     int64  `json:"expires_at_unix_ms"`
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
	senderPTID := subject.ID

	var req signalIngressRequest
	if err := json.Unmarshal(c.Request.Body(), &req); err != nil {
		c.JSON(400, map[string]string{"error": "invalid json: " + err.Error()})
		return
	}

	if req.RecipientPTID == "" || req.SessionULID == "" || req.Kind == "" {
		c.JSON(400, map[string]string{"error": "recipient_ptid, session_ulid, kind are required"})
		return
	}

	kind, ok := signalKindMap[req.Kind]
	if !ok {
		c.JSON(400, map[string]string{"error": "unknown kind: " + req.Kind})
		return
	}

	if senderPTID != req.RecipientPTID {
		authorizer := getSignalAuthorizer()
		if authorizer == nil {
			logger.DefaultHelper.Warnf("events: signal authorizer not registered, rejecting signal sender_ptid=%s", senderPTID)
			c.JSON(503, map[string]string{"error": "signal authorization unavailable"})
			return
		}
		allowed, err := authorizer.CanSignal(senderPTID, req.RecipientPTID)
		if err != nil {
			logger.DefaultHelper.Warnf("events: signal authorization check failed sender_ptid=%s recipient_ptid=%s: %v", senderPTID, req.RecipientPTID, err)
			c.JSON(500, map[string]string{"error": "authorization check failed"})
			return
		}
		if !allowed {
			c.JSON(403, map[string]string{"error": "not authorized to signal this recipient"})
			return
		}
	}

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

	if isCallLifecycleSignal(kind) {
		if req.CallID == "" || req.DeviceID == "" {
			c.JSON(400, map[string]string{
				"error": "call_id and device_id are required for call lifecycle signals",
			})
			return
		}
		if _, err := verifiedSignalDeviceID(
			ctx,
			subject,
			req.DeviceID,
			string(c.GetHeader("X-Device-ID")),
		); err != nil {
			writeSignalError(c, err)
			return
		}
	}

	signal := &realtime.CallSignal{
		SessionUlid:   req.SessionULID,
		FromActorPtid: senderPTID,
		Kind:          kind,
		Payload:       payload,
		CallId:        req.CallID,
	}

	if kind == realtime.CallSignal_CALL_ACCEPT || kind == realtime.CallSignal_CALL_REJECT {
		if s.callResolution == nil {
			c.JSON(503, map[string]string{"error": "call resolution unavailable"})
			return
		}
		action := "accept"
		if kind == realtime.CallSignal_CALL_REJECT {
			action = "reject"
		}
		result, err := s.callResolution.resolve(
			ctx,
			senderPTID,
			req.RecipientPTID,
			req.SessionULID,
			req.CallID,
			req.DeviceID,
			action,
		)
		if err != nil {
			if result.becameNoAnswer {
				s.fanOutNoAnswer(ctx, result.record)
			}
			writeCallResolutionError(c, err, result.record)
			return
		}
		signal.WinningDeviceId = result.record.WinningDeviceID
	}

	_, err = s.routeSignal(ctx, senderPTID, req.RecipientPTID, req.SessionULID, signal)
	if err != nil {
		if errors.Is(err, errCallResolutionConflict) ||
			errors.Is(err, errCallResolutionExpired) ||
			errors.Is(err, errCallResolutionNotFound) {
			writeCallResolutionError(c, err, callResolutionModel{})
			return
		}
		logger.DefaultHelper.Warnf("events: signal route failed sender_ptid=%s recipient_ptid=%s: %v", senderPTID, req.RecipientPTID, err)
		c.JSON(502, map[string]string{"error": "signal delivery failed"})
		return
	}

	if senderPTID != req.RecipientPTID {
		bus := GetBus()
		if bus != nil {
			ev := &realtime.StreamEvent{
				Kind: &realtime.StreamEvent_Signaling{Signaling: signal},
			}
			if _, echoErr := bus.Publish(senderPTID, ev); echoErr != nil {
				logger.DefaultHelper.Warnf("events: signal echo to sender failed actor_ptid=%s: %v", senderPTID, echoErr)
			}
		}
	}

	c.SetStatusCode(204)
}

func (s *eventsSubServer) handleGetCallResolution(ctx context.Context, c *app.RequestContext) {
	subject := hertzadapter.GetSubject(c)
	if subject == nil {
		c.JSON(401, map[string]string{"error": "unauthorized"})
		return
	}
	if s.callResolution == nil {
		c.JSON(503, map[string]string{"error": "call resolution unavailable"})
		return
	}
	callID := string(c.Query("call_id"))
	peerActorPTID := string(c.Query("peer_actor_ptid"))
	record, err := s.readCallResolution(ctx, subject.ID, peerActorPTID, callID)
	if err != nil {
		writeCallResolutionError(c, err, record)
		return
	}
	c.JSON(200, callResolutionResponseFromModel(record))
}

func isCallLifecycleSignal(kind realtime.CallSignal_Kind) bool {
	switch kind {
	case realtime.CallSignal_CALL_REQUEST,
		realtime.CallSignal_CALL_ACCEPT,
		realtime.CallSignal_CALL_REJECT,
		realtime.CallSignal_CALL_END,
		realtime.CallSignal_CALL_NO_ANSWER:
		return true
	default:
		return false
	}
}

func verifiedSignalDeviceID(
	ctx context.Context,
	subject *coreauth.Subject,
	requestDeviceID string,
	assertedDeviceID string,
) (string, error) {
	asserted := strings.TrimSpace(assertedDeviceID)
	if asserted == "" || requestDeviceID == "" || subject.SessionID == "" {
		return "", errors.New("authenticated device binding is required")
	}
	resolver, ok := coreauth.GetGlobalSessionValidator().(coreauth.SessionDeviceIDResolver)
	if !ok {
		return "", errors.New("session device binding is unavailable")
	}
	persisted := resolver.ResolveSessionDeviceID(ctx, subject.SessionID)
	if persisted == "" || persisted != asserted || persisted != requestDeviceID {
		return "", errors.New("authenticated device binding mismatch")
	}
	return persisted, nil
}

func writeSignalError(c *app.RequestContext, err error) {
	status := 403
	if err.Error() == "session device binding is unavailable" {
		status = 503
	}
	c.JSON(status, map[string]string{"error": err.Error()})
}

func callResolutionHandlerError(err error) error {
	switch {
	case errors.Is(err, errCallResolutionConflict):
		return server.NewHandlerError(409, "CALL_ALREADY_HANDLED")
	case errors.Is(err, errCallResolutionExpired):
		return server.NewHandlerError(409, "CALL_NO_ANSWER")
	case errors.Is(err, errCallResolutionNotFound):
		return server.NewHandlerError(409, "CALL_REQUEST_NOT_FOUND")
	default:
		return server.NewHandlerError(503, "call resolution unavailable")
	}
}

func writeCallResolutionError(
	c *app.RequestContext,
	err error,
	record callResolutionModel,
) {
	switch {
	case errors.Is(err, errCallResolutionConflict):
		c.JSON(409, map[string]any{
			"error":             "CALL_ALREADY_HANDLED",
			"state":             record.State,
			"winning_device_id": record.WinningDeviceID,
			"terminal_action":   record.TerminalAction,
		})
	case errors.Is(err, errCallResolutionExpired):
		c.JSON(409, map[string]any{
			"error":           "CALL_NO_ANSWER",
			"state":           callStateNoAnswer,
			"terminal_action": "no_answer",
		})
	case errors.Is(err, errCallResolutionNotFound):
		c.JSON(409, map[string]string{"error": "CALL_REQUEST_NOT_FOUND"})
	default:
		c.JSON(503, map[string]string{"error": "call resolution unavailable"})
	}
}

func callResolutionResponseFromModel(record callResolutionModel) callResolutionResponse {
	var resolvedAt int64
	if record.ResolvedAt != nil {
		resolvedAt = record.ResolvedAt.UnixMilli()
	}
	return callResolutionResponse{
		CallID:          record.CallID,
		State:           record.State,
		WinningDeviceID: record.WinningDeviceID,
		TerminalAction:  record.TerminalAction,
		RingDeadlineMs:  record.RingDeadline.UnixMilli(),
		ResolvedAtMs:    resolvedAt,
		ExpiresAtMs:     record.ExpiresAt.UnixMilli(),
	}
}

func streamEventForSignal(signal *realtime.CallSignal) *realtime.StreamEvent {
	return &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Signaling{
			Signaling: proto.Clone(signal).(*realtime.CallSignal),
		},
	}
}

func (s *eventsSubServer) routeSignal(
	ctx context.Context,
	senderPTID, recipientPTID, sessionULID string,
	signal *realtime.CallSignal,
) (local bool, err error) {
	instances := server.GetOptions().SubserverInstances
	actors, actorsOK := instances["actor_identity"].(signalHomeStationResolver)
	fedProvider, fedOK := instances["federation"].(signalFederationRuntimeProvider)
	var federation signalFederationCaller
	if fedOK && fedProvider != nil && fedProvider.FederationDeliveryRuntime() != nil {
		federation = fedProvider.FederationDeliveryRuntime()
	}

	isRemote := false
	if actorsOK && actors != nil && federation != nil {
		localPeerID := strings.TrimSpace(federation.LocalStationPeerID())
		if localPeerID != "" {
			homePeerID, resolveErr := actors.ResolveActorHomeStationPeerID(ctx, recipientPTID)
			if resolveErr == nil {
				homePeerID = strings.TrimSpace(homePeerID)
				if homePeerID != "" && homePeerID != localPeerID {
					isRemote = true
					callCtx, cancel := context.WithTimeout(ctx, remoteSignalTimeout)
					defer cancel()
					err = federation.CallPeer(callCtx, federationruntime.PeerCall{
						TargetStationPeerID: homePeerID,
						Route:               federationruntime.PeerRouteRealtimeSignal,
						Subject:             senderPTID,
						Claims: map[string]string{
							federationruntime.ClaimSenderPTID:          senderPTID,
							federationruntime.ClaimRecipientPTID:       recipientPTID,
							federationruntime.ClaimSessionULID:         sessionULID,
							federationruntime.ClaimSourceStationPeerID: localPeerID,
							federationruntime.ClaimTargetStationPeerID: homePeerID,
						},
						Request:  signal,
						Response: &realtime.CallSignal{},
					})
					if err != nil {
						return false, fmt.Errorf("federation signal forward: %w", err)
					}
					return false, nil
				}
			}
		}
	}

	if !isRemote {
		if signal.GetKind() == realtime.CallSignal_CALL_REQUEST {
			if s.callResolution == nil {
				return true, fmt.Errorf("call resolution unavailable")
			}
			if _, openErr := s.callResolution.open(
				ctx,
				senderPTID,
				recipientPTID,
				sessionULID,
				signal.GetCallId(),
				callRequestDigest(
					senderPTID,
					recipientPTID,
					sessionULID,
					signal.GetCallId(),
					signal.GetPayload(),
				),
			); openErr != nil {
				return true, openErr
			}
		}
		bus := GetBus()
		if bus == nil {
			return true, fmt.Errorf("event bus not initialized")
		}
		ev := &realtime.StreamEvent{
			Kind: &realtime.StreamEvent_Signaling{Signaling: signal},
		}
		if _, pubErr := bus.Publish(recipientPTID, ev); pubErr != nil {
			return true, fmt.Errorf("local publish: %w", pubErr)
		}
	}

	return true, nil
}

func (s *eventsSubServer) readCallResolution(
	ctx context.Context,
	requestingActorPTID string,
	peerActorPTID string,
	callID string,
) (callResolutionModel, error) {
	result, err := s.callResolution.getForActor(ctx, requestingActorPTID, callID)
	if err == nil {
		if !callResolutionParticipantsMatch(
			result.record,
			requestingActorPTID,
			peerActorPTID,
		) {
			return callResolutionModel{}, errCallResolutionNotFound
		}
		if result.becameNoAnswer {
			s.fanOutNoAnswer(ctx, result.record)
		}
		return result.record, nil
	}
	if !errors.Is(err, errCallResolutionNotFound) || strings.TrimSpace(peerActorPTID) == "" {
		return callResolutionModel{}, err
	}

	instances := server.GetOptions().SubserverInstances
	actors, actorsOK := instances["actor_identity"].(signalHomeStationResolver)
	federationProvider, federationOK := instances["federation"].(signalFederationRuntimeProvider)
	if !actorsOK || actors == nil || !federationOK || federationProvider == nil {
		return callResolutionModel{}, err
	}
	federation := federationProvider.FederationDeliveryRuntime()
	if federation == nil {
		return callResolutionModel{}, err
	}
	localStationPeerID := strings.TrimSpace(federation.LocalStationPeerID())
	targetStationPeerID, resolveErr := actors.ResolveActorHomeStationPeerID(ctx, peerActorPTID)
	if resolveErr != nil {
		return callResolutionModel{}, fmt.Errorf(
			"events: resolve call owner Home Station: %w",
			resolveErr,
		)
	}
	if targetStationPeerID == "" || targetStationPeerID == localStationPeerID {
		return callResolutionModel{}, errCallResolutionNotFound
	}
	request := &realtime.GetFederatedCallResolutionRequest{
		RequestingActorPtid: requestingActorPTID,
		CallId:              callID,
		PeerActorPtid:       peerActorPTID,
	}
	response := &realtime.GetFederatedCallResolutionResponse{}
	if callErr := federation.CallPeer(
		ctx,
		federationruntime.PeerCall{
			TargetStationPeerID: targetStationPeerID,
			Route:               federationruntime.PeerRouteRealtimeCallResolution,
			Subject:             requestingActorPTID,
			Claims: map[string]string{
				federationruntime.ClaimActorPTID:           requestingActorPTID,
				federationruntime.ClaimCallID:              callID,
				federationruntime.ClaimSourceStationPeerID: localStationPeerID,
				federationruntime.ClaimTargetStationPeerID: targetStationPeerID,
			},
			Request:  request,
			Response: response,
		},
	); callErr != nil {
		return callResolutionModel{}, callErr
	}
	return callResolutionModelFromProto(response), nil
}

// ResolveFederatedCallResolution handles a signed caller readback at the
// callee Home Station.
func (s *eventsSubServer) ResolveFederatedCallResolution(
	ctx context.Context,
	sourceStationPeerID string,
	request *realtime.GetFederatedCallResolutionRequest,
) (*realtime.GetFederatedCallResolutionResponse, error) {
	if request == nil || s.callResolution == nil {
		return nil, errors.New(
			"events: Federation call-resolution dependencies are unavailable",
		)
	}
	instances := server.GetOptions().SubserverInstances
	actors, ok := instances["actor_identity"].(signalHomeStationResolver)
	if !ok || actors == nil {
		return nil, errors.New(
			"events: Federation call-resolution dependencies are unavailable",
		)
	}
	requestingActorPTID := strings.TrimSpace(request.GetRequestingActorPtid())
	callID := strings.TrimSpace(request.GetCallId())
	peerActorPTID := strings.TrimSpace(request.GetPeerActorPtid())
	if requestingActorPTID == "" || peerActorPTID == "" || callID == "" {
		return nil, errors.New(
			"events: Federation call-resolution request is incomplete",
		)
	}
	requesterHome, err := actors.ResolveActorHomeStationPeerID(ctx, requestingActorPTID)
	if err != nil {
		return nil, err
	}
	if requesterHome != sourceStationPeerID {
		return nil, errors.New(
			"events: requesting actor does not belong to source Station",
		)
	}
	result, err := s.callResolution.getForActor(ctx, requestingActorPTID, callID)
	if err != nil {
		return nil, err
	}
	record := result.record
	if !callResolutionParticipantsMatch(record, requestingActorPTID, peerActorPTID) {
		return nil, errCallResolutionNotFound
	}
	if result.becameNoAnswer {
		s.fanOutNoAnswer(ctx, record)
	}
	return callResolutionProtoFromModel(record), nil
}

func callResolutionParticipantsMatch(
	record callResolutionModel,
	firstActorPTID string,
	secondActorPTID string,
) bool {
	return (record.CallerActorPTID == firstActorPTID &&
		record.CalleeActorPTID == secondActorPTID) ||
		(record.CallerActorPTID == secondActorPTID &&
			record.CalleeActorPTID == firstActorPTID)
}

func callResolutionProtoFromModel(
	record callResolutionModel,
) *realtime.GetFederatedCallResolutionResponse {
	var resolvedAt int64
	if record.ResolvedAt != nil {
		resolvedAt = record.ResolvedAt.UnixMilli()
	}
	return &realtime.GetFederatedCallResolutionResponse{
		CallId:             record.CallID,
		State:              record.State,
		WinningDeviceId:    record.WinningDeviceID,
		TerminalAction:     record.TerminalAction,
		RingDeadlineUnixMs: record.RingDeadline.UnixMilli(),
		ResolvedAtUnixMs:   resolvedAt,
		ExpiresAtUnixMs:    record.ExpiresAt.UnixMilli(),
	}
}

func callResolutionModelFromProto(
	response *realtime.GetFederatedCallResolutionResponse,
) callResolutionModel {
	record := callResolutionModel{
		CallID:          response.GetCallId(),
		State:           response.GetState(),
		WinningDeviceID: response.GetWinningDeviceId(),
		TerminalAction:  response.GetTerminalAction(),
		RingDeadline:    time.UnixMilli(response.GetRingDeadlineUnixMs()).UTC(),
		ExpiresAt:       time.UnixMilli(response.GetExpiresAtUnixMs()).UTC(),
	}
	if response.GetResolvedAtUnixMs() > 0 {
		resolvedAt := time.UnixMilli(response.GetResolvedAtUnixMs()).UTC()
		record.ResolvedAt = &resolvedAt
	}
	return record
}
