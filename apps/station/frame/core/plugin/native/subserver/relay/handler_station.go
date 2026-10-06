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
)

// ---- DTO: ICE server ----

type iceServerJSON struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
	Source     string   `json:"source,omitempty"`
	Priority   int      `json:"priority,omitempty"`
}

type enrollmentChallengeRequest struct {
	InviteToken string `json:"invite_token"`
	Label       string `json:"label,omitempty"`
}

type enrollmentChallengeResponse struct {
	ChallengeID string `json:"challenge_id"`
	InviteID    uint64 `json:"invite_id,omitempty"`
	RelayPeerID string `json:"relay_peer_id"`
	Challenge   []byte `json:"challenge"`
	IssuedAt    string `json:"issued_at"`
	ExpiresAt   string `json:"expires_at"`
}

type registerRequest struct {
	InviteToken string                      `json:"invite_token"`
	Proof       domain.StationIdentityProof `json:"proof"`
}

type rotateCredentialRequest struct {
	Proof domain.StationIdentityProof `json:"proof"`
}

func challengeResponse(
	challenge *domain.EnrollmentChallenge,
) enrollmentChallengeResponse {
	return enrollmentChallengeResponse{
		ChallengeID: challenge.ID,
		InviteID:    challenge.InviteID,
		RelayPeerID: challenge.RelayPeerID,
		Challenge:   append([]byte(nil), challenge.Challenge...),
		IssuedAt:    challenge.IssuedAt.Format(time.RFC3339),
		ExpiresAt:   challenge.ExpiresAt.Format(time.RFC3339),
	}
}

func credentialResponse(
	credential *domain.MountCredential,
) map[string]interface{} {
	return map[string]interface{}{
		"relay_token":     credential.Token,
		"relay_peer_id":   credential.RelayPeerID,
		"station_peer_id": credential.StationPeerID,
		"mount_id":        credential.MountID,
		"generation":      credential.Generation,
		"expires_at":      credential.ExpiresAt.Format(time.RFC3339),
	}
}

// ---- Public: Challenge + Register ----

func (h *relayHandler) handleEnrollmentChallenge(
	w http.ResponseWriter,
	r *http.Request,
) {
	var req enrollmentChallengeRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}
	if strings.TrimSpace(req.InviteToken) == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("invite_token is required"))
		return
	}
	challenge, err := h.sub.svc.BeginEnrollmentChallenge(
		r.Context(),
		req.InviteToken,
		req.Label,
	)
	if err != nil {
		h.writeEnrollmentError(w, r.Context(), err)
		return
	}
	writeJSON(w, http.StatusOK, challengeResponse(challenge))
}

func (h *relayHandler) handleRotationChallenge(
	w http.ResponseWriter,
	r *http.Request,
) {
	token, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody("valid Relay mount credential required"))
		return
	}
	challenge, err := h.sub.svc.BeginRotationChallenge(r.Context(), token)
	if err != nil {
		h.writeEnrollmentError(w, r.Context(), err)
		return
	}
	writeJSON(w, http.StatusOK, challengeResponse(challenge))
}

func (h *relayHandler) handleRegister(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req registerRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}
	if req.InviteToken == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("invite_token is required"))
		return
	}

	result, err := h.sub.svc.Register(
		ctx,
		req.InviteToken,
		req.Proof,
		h.sub.opts.MaxStations,
	)
	if err != nil {
		h.writeEnrollmentError(w, ctx, err)
		return
	}
	h.sub.streams.Remove(ctx, result.Credential.StationPeerID)

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

	logger.Infof(
		ctx,
		"[relay] station %s registered generation=%d",
		result.Credential.StationPeerID,
		result.Credential.Generation,
	)

	response := credentialResponse(result.Credential)
	response["ice_servers"] = iceOut
	writeJSON(w, http.StatusOK, response)
}

func (h *relayHandler) writeEnrollmentError(
	w http.ResponseWriter,
	ctx context.Context,
	err error,
) {
	switch {
	case errors.Is(err, application.ErrInviteNotFound):
		writeJSON(w, http.StatusUnauthorized, errorBody("invalid invite token"))
	case errors.Is(err, application.ErrInviteInactive):
		writeJSON(w, http.StatusForbidden, errorBody("invite token is no longer active"))
	case errors.Is(err, application.ErrInviteExpired):
		writeJSON(w, http.StatusForbidden, errorBody("invite token has expired"))
	case errors.Is(err, application.ErrChallengeInvalid),
		errors.Is(err, application.ErrChallengeExpired),
		errors.Is(err, application.ErrProofInvalid),
		errors.Is(err, application.ErrStationMismatch):
		writeJSON(w, http.StatusForbidden, errorBody("station identity proof rejected"))
	case errors.Is(err, application.ErrCredentialInvalid):
		writeJSON(w, http.StatusUnauthorized, errorBody("Relay enrollment required"))
	case errors.Is(err, application.ErrInvalidRequest):
		writeJSON(w, http.StatusBadRequest, errorBody("invalid enrollment request"))
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

	identity, ok := mountIdentityFromRequest(r)
	if !ok || identity.StationPeerID != peerID {
		writeJSON(w, http.StatusUnauthorized, errorBody("invalid Relay mount identity"))
		return
	}
	if err := h.sub.svc.UpdateHeartbeat(ctx, identity); err != nil {
		logger.Errorf(ctx, "[relay] heartbeat failed for %s: %v", peerID, err)
		writeJSON(w, http.StatusUnauthorized, errorBody("Relay enrollment required"))
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

	token, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody("valid Relay mount credential required"))
		return
	}
	var req rotateCredentialRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}
	credential, err := h.sub.svc.RotateCredential(ctx, token, req.Proof)
	if err != nil {
		logger.Errorf(ctx, "[relay] credential rotation failed for %s: %v", peerID, err)
		h.writeEnrollmentError(w, ctx, err)
		return
	}
	h.sub.streams.Remove(ctx, peerID)
	writeJSON(w, http.StatusOK, credentialResponse(credential))
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

	currentToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody("valid Relay mount credential required"))
		return
	}
	credential, err := h.sub.svc.MintClientToken(ctx, currentToken, ttl)
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
		"client_token":    credential.Token,
		"station_peer_id": credential.StationPeerID,
		"generation":      credential.Generation,
		"expires_at":      credential.ExpiresAt.Format(time.RFC3339),
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

	// 4. Lookup stream entry.
	entry, ok := h.sub.streams.GetEntry(stationPeerID)
	if !ok {
		writeJSON(w, http.StatusServiceUnavailable,
			errorBody(fmt.Sprintf("station %s is not available", stationPeerID)))
		return
	}

	// 5. Per-station concurrency limiter.
	if !entry.AcquireSemaphore() {
		writeJSON(w, http.StatusServiceUnavailable,
			errorBody(fmt.Sprintf("station %s: too many concurrent requests", stationPeerID)))
		return
	}
	defer entry.ReleaseSemaphore()

	// 6. Inflight tracking + metrics.
	h.sub.streams.TrackInflight()
	defer h.sub.streams.UntrackInflight()

	metInflightForwards.Inc()
	defer metInflightForwards.Dec()

	// 7. Read body.
	body, err := io.ReadAll(io.LimitReader(r.Body, int64(h.sub.opts.MaxBodySize)))
	if err != nil {
		metForwardTotal.Inc("read_error")
		writeJSON(w, http.StatusBadRequest, errorBody("failed to read request body"))
		return
	}

	// 8. Collect headers.
	headers := make(map[string]string, len(r.Header))
	for k, v := range r.Header {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}

	// 9. Send request frame to station.
	reqID := h.sub.streams.NextRequestID()
	logger.Debugf(ctx, "[relay] forwarding %s %s to %s (req_id=%d)", r.Method, targetPath, stationPeerID, reqID)

	fwdTimeout := time.Duration(h.sub.opts.ForwardTimeout) * time.Second
	fwdCtx, fwdCancel := context.WithTimeout(ctx, fwdTimeout)
	defer fwdCancel()

	resp, err := entry.SendRequest(fwdCtx, reqID, r.Method, targetPath, headers, body)
	if err != nil {
		elapsed := time.Since(start).Seconds()
		metForwardDuration.Observe(elapsed)

		if fwdCtx.Err() != nil {
			metForwardTotal.Inc("timeout")
			writeJSON(w, http.StatusGatewayTimeout,
				errorBody(fmt.Sprintf("station %s did not respond within %v", stationPeerID, fwdTimeout)))
		} else {
			metForwardTotal.Inc("error")
			h.sub.streams.Remove(ctx, stationPeerID)
			writeJSON(w, http.StatusBadGateway, errorBody("failed to communicate with station stream"))
		}
		return
	}

	// 10. Write station response back to client.
	elapsed := time.Since(start).Seconds()
	metForwardDuration.Observe(elapsed)
	metForwardTotal.Inc("success")

	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(int(resp.StatusCode))
	if len(resp.Body) > 0 {
		_, _ = w.Write(resp.Body)
	}
}
