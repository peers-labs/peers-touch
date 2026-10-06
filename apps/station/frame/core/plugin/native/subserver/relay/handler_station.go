package relay

// 2026-04-08: Extracted station/forward handlers from the monolithic handler.go.
// Includes: register, heartbeat, token-refresh, mint-client-token, and forward.
// Forward MUST stay as HTTPHandler (transparent proxy: wildcard path, ANY method,
// raw body/header passthrough). All other handlers follow standard patterns.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

// ---- DTO: ICE server ----

type iceServerJSON struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
	Source     string   `json:"source,omitempty"`
	Priority   int      `json:"priority,omitempty"`
}

// ---- Public: Register ----

func (h *relayHandler) handleRegister(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		InviteToken string `json:"invite_token"`
		Label       string `json:"label,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}
	if req.InviteToken == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("invite_token is required"))
		return
	}

	result, err := h.sub.svc.Register(ctx, req.InviteToken, req.Label,
		r.Header.Get("X-Station-Peer-ID"), h.sub.opts.MaxStations)
	if err != nil {
		h.writeRegisterError(w, ctx, err)
		return
	}

	iceServers := h.sub.svc.BuildICEServers(application.TurnConfig{
		Enabled:    h.sub.opts.TurnEnabled,
		PublicIP:   h.sub.opts.TurnPublicIP,
		Port:       h.sub.opts.TurnPort,
		AuthSecret: h.sub.opts.TurnAuthSecret,
	})

	iceOut := make([]iceServerJSON, 0, len(iceServers))
	for _, s := range iceServers {
		iceOut = append(iceOut, iceServerJSON{
			URLs:       s.URLs,
			Username:   s.Username,
			Credential: s.Credential,
			Source:     s.Source,
			Priority:   s.Priority,
		})
	}

	logger.Infof(ctx, "[relay] station %s registered", result.StationPeerID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"station_peer_id": result.StationPeerID,
		"relay_token":     result.RelayToken,
		"expires_at":      result.ExpiresAt.Format(time.RFC3339),
		"ice_servers":     iceOut,
	})
}

// writeRegisterError maps application-layer sentinel errors to HTTP responses.
func (h *relayHandler) writeRegisterError(w http.ResponseWriter, ctx context.Context, err error) {
	switch {
	case errors.Is(err, application.ErrInviteNotFound):
		writeJSON(w, http.StatusUnauthorized, errorBody("invalid invite token"))
	case errors.Is(err, application.ErrInviteInactive):
		writeJSON(w, http.StatusForbidden, errorBody("invite token is no longer active"))
	case errors.Is(err, application.ErrInviteExpired):
		writeJSON(w, http.StatusForbidden, errorBody("invite token has expired"))
	case errors.Is(err, application.ErrNoPeerID):
		writeJSON(w, http.StatusBadRequest, errorBody("station_peer_id cannot be determined"))
	case errors.Is(err, application.ErrCapacityFull):
		writeJSON(w, http.StatusServiceUnavailable, errorBody("relay capacity exceeded"))
	default:
		logger.Errorf(ctx, "[relay] register failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorBody("registration failed"))
	}
}

// ---- Station: Heartbeat ----

func (h *relayHandler) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	peerID, ok := stationPeerIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody("missing relay access subject"))
		return
	}

	if err := h.sub.svc.UpdateHeartbeat(ctx, peerID); err != nil {
		logger.Errorf(ctx, "[relay] heartbeat failed for %s: %v", peerID, err)
		writeJSON(w, http.StatusInternalServerError, errorBody("heartbeat failed"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ---- Station: Token refresh ----

func (h *relayHandler) handleTokenRefresh(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	peerID, ok := stationPeerIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody("missing relay access subject"))
		return
	}

	newToken, expiresAt, err := h.sub.svc.RefreshToken(ctx, peerID)
	if err != nil {
		logger.Errorf(ctx, "[relay] token refresh failed for %s: %v", peerID, err)
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to refresh token"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"relay_token": newToken,
		"expires_at":  expiresAt.Format(time.RFC3339),
	})
}

// ---- Station: Mint client token ----

func (h *relayHandler) handleMintClientToken(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	peerID, ok := stationPeerIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody("missing relay access subject"))
		return
	}

	var req struct {
		TTL string `json:"ttl,omitempty"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
			return
		}
	}

	ttl := 24 * time.Hour
	if req.TTL != "" {
		d, err := time.ParseDuration(req.TTL)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid ttl format"))
			return
		}
		ttl = d
	}

	token, expiresAt, err := h.sub.svc.MintClientToken(ctx, peerID, ttl)
	if err != nil {
		if errors.Is(err, application.ErrMountNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody("station is not mounted on this relay"))
			return
		}
		logger.Errorf(ctx, "[relay] mint client token for %s: %v", peerID, err)
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to mint client token"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"client_token":    token,
		"station_peer_id": peerID,
		"expires_at":      expiresAt.Format(time.RFC3339),
	})
}

// ---- Forward (transparent HTTP proxy) ----

func (h *relayHandler) handleForward(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start := time.Now()

	// 1. Parse path: /relay/forward/{stationPeerID}/{targetPath...}
	trimmed := strings.TrimPrefix(r.URL.Path, relayForwardPrefix)
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) < 1 || parts[0] == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("missing station_peer_id in path"))
		return
	}
	stationPeerID := parts[0]

	// 2. relay-client tokens are scoped to a single station — enforce the binding.
	if subj := coreauth.GetSubject(r.Context()); subj != nil &&
		strings.HasPrefix(subj.ID, domain.SubjectRelayClient) {
		boundID := strings.TrimPrefix(subj.ID, domain.SubjectRelayClient)
		if boundID != stationPeerID {
			writeJSON(w, http.StatusForbidden,
				errorBody(fmt.Sprintf("client token not authorized for station %s", stationPeerID)))
			return
		}
	}

	// 3. Build target path.
	targetPath := "/"
	if len(parts) > 1 && parts[1] != "" {
		targetPath = "/" + parts[1]
	}
	if r.URL.RawQuery != "" {
		targetPath += "?" + r.URL.RawQuery
	}
	routePolicy, hasRoutePolicy := protocol.RoutePolicyForPath(targetPath)
	privateObjectLog, _ := protocol.PrivateObjectRouteLogContext(
		r.Method,
		targetPath,
		map[string]string{
			protocol.PeerHopRequestIDHeader: r.Header.Get(protocol.PeerHopRequestIDHeader),
		},
	)

	// 4. Lookup stream entry.
	entry, ok := h.sub.streams.GetEntry(stationPeerID)
	if !ok {
		if hasRoutePolicy {
			logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeRetryable)
		}
		writeJSON(w, http.StatusServiceUnavailable,
			errorBody(fmt.Sprintf("station %s is not available", stationPeerID)))
		return
	}

	// 5. Inflight tracking + metrics.
	h.sub.streams.TrackInflight()
	defer h.sub.streams.UntrackInflight()

	metInflightForwards.Inc()
	defer metInflightForwards.Dec()

	// 6. Read body under the route-specific request cap.
	maxRequestBodyLen := uint32(h.sub.opts.MaxBodySize)
	if hasRoutePolicy {
		maxRequestBodyLen = routePolicy.MaxRequestBodyLen
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, int64(maxRequestBodyLen)+1))
	if err != nil {
		metForwardTotal.Inc("read_error")
		if hasRoutePolicy {
			logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeRejected)
		}
		writeJSON(w, http.StatusBadRequest, errorBody("failed to read request body"))
		return
	}
	if uint64(len(body)) > uint64(maxRequestBodyLen) {
		metForwardTotal.Inc("body_too_large")
		if hasRoutePolicy {
			logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeRejected)
		}
		writeJSON(w, http.StatusRequestEntityTooLarge, errorBody("request body exceeds relay limit"))
		return
	}

	// 7. Collect headers.
	headers := make(map[string]string, len(r.Header))
	for k, v := range r.Header {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}

	// 8. Send request frame to station.
	fwdTimeout := time.Duration(h.sub.opts.ForwardTimeout) * time.Second
	fwdCtx, fwdCancel := context.WithTimeout(ctx, fwdTimeout)
	defer fwdCancel()

	responsePayloadLimit := uint32(protocol.MaxPayloadLen)
	if hasRoutePolicy {
		responsePayloadLimit = routePolicy.MaxResponsePayloadLen
	}
	resp, reqID, err := entry.SendRequest(
		fwdCtx,
		r.Method,
		targetPath,
		headers,
		body,
		responsePayloadLimit,
		fwdTimeout,
	)
	if err != nil {
		elapsed := time.Since(start).Seconds()
		metForwardDuration.Observe(elapsed)

		switch {
		case errors.Is(err, ErrTooManyConcurrent):
			metForwardTotal.Inc("concurrency_limit")
			if hasRoutePolicy {
				logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeRetryable)
			}
			writeJSON(w, http.StatusServiceUnavailable,
				errorBody(fmt.Sprintf("station %s: too many concurrent requests", stationPeerID)))
		case errors.Is(err, ErrRequestIDExhausted):
			metForwardTotal.Inc("stream_retiring")
			if hasRoutePolicy {
				logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeRetryable)
			}
			writeJSON(w, http.StatusServiceUnavailable, errorBody("station stream is recycling"))
		case fwdCtx.Err() != nil:
			metForwardTotal.Inc("timeout")
			if hasRoutePolicy {
				logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeInterrupted)
			}
			writeJSON(w, http.StatusGatewayTimeout,
				errorBody(fmt.Sprintf("station %s did not respond within %v", stationPeerID, fwdTimeout)))
		default:
			metForwardTotal.Inc("error")
			if hasRoutePolicy {
				logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeRetryable)
			}
			h.sub.streams.RemoveIfSame(ctx, stationPeerID, entry)
			writeJSON(w, http.StatusBadGateway, errorBody("failed to communicate with station stream"))
		}
		return
	}

	if !hasRoutePolicy {
		logger.Debugf(
			ctx,
			"[relay] forwarded %s %s to %s (req_id=%d)",
			r.Method,
			targetPath,
			stationPeerID,
			reqID,
		)
	}

	// 9. Write station response back to client.
	elapsed := time.Since(start).Seconds()
	metForwardDuration.Observe(elapsed)
	metForwardTotal.Inc("success")
	if hasRoutePolicy {
		logPrivateObjectForward(ctx, privateObjectLog, protocol.RouteLogOutcomeAccepted)
	}

	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(int(resp.StatusCode))
	if len(resp.Body) > 0 {
		_, _ = w.Write(resp.Body)
	}
}

func logPrivateObjectForward(
	ctx context.Context,
	logContext protocol.RouteLogContext,
	outcome string,
) {
	logger.Debugf(
		ctx,
		"[relay] route=%s method=%s outcome=%s request_id=%s",
		logContext.Category,
		logContext.Method,
		outcome,
		logContext.RequestID,
	)
}
