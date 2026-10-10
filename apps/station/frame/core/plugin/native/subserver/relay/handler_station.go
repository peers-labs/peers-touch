package relay

// Station enrollment, heartbeat, credential rotation, and route handlers.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

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
