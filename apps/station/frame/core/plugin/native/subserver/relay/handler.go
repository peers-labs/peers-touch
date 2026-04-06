package relay

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	relaymodel "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/model"
	turnmodel "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/turn/model"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const relayForwardPrefix = "/relay/forward/"

type relayHandler struct {
	sub *SubServer
}

func newRelayHandler(sub *SubServer) *relayHandler {
	return &relayHandler{sub: sub}
}

func (h *relayHandler) handlers() []server.Handler {
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	return []server.Handler{
		server.NewHTTPHandler("relay-invite-create", "/api/v1/relay/invite", server.POST,
			server.HTTPHandlerFunc(h.handleCreateInvite), jwtWrapper),
		server.NewHTTPHandler("relay-invite-list", "/api/v1/relay/invites", server.GET,
			server.HTTPHandlerFunc(h.handleListInvites), jwtWrapper),
		server.NewHTTPHandler("relay-mount-list", "/api/v1/relay/mounts", server.GET,
			server.HTTPHandlerFunc(h.handleListMounts), jwtWrapper),
		server.NewHTTPHandler("relay-mount-stats", "/api/v1/relay/stats", server.GET,
			server.HTTPHandlerFunc(h.handleStats)),
		server.NewHTTPHandler("relay-register", "/api/v1/relay/register", server.POST,
			server.HTTPHandlerFunc(h.handleRegister)),
		server.NewHTTPHandler("relay-forward", relayForwardPrefix+"*path", server.ANY,
			server.HTTPHandlerFunc(h.handleForward)),
	}
}

type createInviteRequest struct {
	StationPeerID string `json:"station_peer_id,omitempty"`
	Label         string `json:"label,omitempty"`
	MaxClients    int32  `json:"max_clients,omitempty"`
	ExpiresIn     string `json:"expires_in,omitempty"`
}

type createInviteResponse struct {
	InviteToken string `json:"invite_token"`
	ExpiresAt   string `json:"expires_at"`
}

func (h *relayHandler) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req createInviteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sub.writeHTTPError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	expiresIn := 7 * 24 * time.Hour
	if req.ExpiresIn != "" {
		d, err := time.ParseDuration(req.ExpiresIn)
		if err != nil {
			h.sub.writeHTTPError(w, http.StatusBadRequest, "invalid expires_in format")
			return
		}
		expiresIn = d
	}

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	claims := coreauth.Credentials{
		SubjectID: fmt.Sprintf("relay-invite:%s", req.StationPeerID),
		Attributes: map[string]string{
			"type":            "relay_invite",
			"station_peer_id": req.StationPeerID,
			"label":           req.Label,
		},
	}
	_, token, err := provider.Authenticate(ctx, claims)
	if err != nil {
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to generate invite token")
		return
	}

	invite := &relaymodel.RelayInvite{
		Token:          token.Value,
		StationPeerID:  req.StationPeerID,
		Label:          req.Label,
		MaxClients:     req.MaxClients,
		BandwidthLimit: 0,
		Status:         relaymodel.InviteStatusActive,
		ExpiresAt:      time.Now().Add(expiresIn),
	}

	if err := h.sub.store.CreateInvite(ctx, invite); err != nil {
		logger.Errorf(ctx, "[relay] failed to create invite: %v", err)
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to create invite")
		return
	}

	resp := createInviteResponse{
		InviteToken: invite.Token,
		ExpiresAt:   invite.ExpiresAt.Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *relayHandler) handleListInvites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	invites, err := h.sub.store.ListInvites(ctx)
	if err != nil {
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to list invites")
		return
	}

	type inviteInfo struct {
		ID            uint64 `json:"id"`
		Token         string `json:"token"`
		StationPeerID string `json:"station_peer_id"`
		Label         string `json:"label"`
		MaxClients    int32  `json:"max_clients"`
		Status        int32  `json:"status"`
		ConsumedBy    string `json:"consumed_by,omitempty"`
		ExpiresAt     string `json:"expires_at"`
		CreatedAt     string `json:"created_at"`
	}

	result := make([]inviteInfo, 0, len(invites))
	for _, inv := range invites {
		result = append(result, inviteInfo{
			ID:            inv.ID,
			Token:         inv.Token,
			StationPeerID: inv.StationPeerID,
			Label:         inv.Label,
			MaxClients:    inv.MaxClients,
			Status:        int32(inv.Status),
			ConsumedBy:    inv.ConsumedBy,
			ExpiresAt:     inv.ExpiresAt.Format(time.RFC3339),
			CreatedAt:     inv.CreatedAt.Format(time.RFC3339),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"invites": result})
}

func (h *relayHandler) handleListMounts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	mounts, err := h.sub.store.ListOnlineMounts(ctx)
	if err != nil {
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to list mounts")
		return
	}

	type mountInfo struct {
		StationPeerID string `json:"station_peer_id"`
		Label         string `json:"label"`
		Status        int32  `json:"status"`
		LastHeartbeat string `json:"last_heartbeat"`
		MountedAt     string `json:"mounted_at"`
	}

	result := make([]mountInfo, 0, len(mounts))
	for _, m := range mounts {
		result = append(result, mountInfo{
			StationPeerID: m.StationPeerID,
			Label:         m.Label,
			Status:        int32(m.Status),
			LastHeartbeat: m.LastHeartbeat.Format(time.RFC3339),
			MountedAt:     m.MountedAt.Format(time.RFC3339),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"mounts": result})
}

func (h *relayHandler) handleStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	count, err := h.sub.store.CountOnlineMounts(ctx)
	if err != nil {
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to get stats")
		return
	}

	h.sub.mu.RLock()
	activeStreams := len(h.sub.streams)
	h.sub.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"online_stations":   count,
		"active_streams":    activeStreams,
		"max_stations":      h.sub.opts.MaxStations,
		"heartbeat_timeout": h.sub.opts.HeartbeatTimeout,
	})
}

type registerRequest struct {
	InviteToken string `json:"invite_token"`
	Label       string `json:"label,omitempty"`
}

type registerResponse struct {
	StationPeerID string                    `json:"station_peer_id"`
	RelayToken    string                    `json:"relay_token"`
	ExpiresAt     string                    `json:"expires_at"`
	ICEServers    []turnmodel.ICEServerInfo  `json:"ice_servers,omitempty"`
}

func (h *relayHandler) handleRegister(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sub.writeHTTPError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.InviteToken == "" {
		h.sub.writeHTTPError(w, http.StatusBadRequest, "invite_token is required")
		return
	}

	invite, err := h.sub.store.GetInviteByToken(ctx, req.InviteToken)
	if err != nil {
		h.sub.writeHTTPError(w, http.StatusUnauthorized, "invalid invite token")
		return
	}

	if invite.Status != relaymodel.InviteStatusActive {
		h.sub.writeHTTPError(w, http.StatusForbidden, "invite token is no longer active")
		return
	}

	if time.Now().After(invite.ExpiresAt) {
		h.sub.writeHTTPError(w, http.StatusForbidden, "invite token has expired")
		return
	}

	stationPeerID := invite.StationPeerID
	if stationPeerID == "" {
		stationPeerID = r.Header.Get("X-Station-Peer-ID")
	}
	if stationPeerID == "" {
		h.sub.writeHTTPError(w, http.StatusBadRequest, "station_peer_id cannot be determined")
		return
	}

	if err := h.sub.store.ConsumeInvite(ctx, invite.ID, stationPeerID); err != nil {
		logger.Errorf(ctx, "[relay] failed to consume invite: %v", err)
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to consume invite")
		return
	}

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	claims := coreauth.Credentials{
		SubjectID: fmt.Sprintf("relay-access:%s", stationPeerID),
		Attributes: map[string]string{
			"type":            "relay_access",
			"station_peer_id": stationPeerID,
		},
	}
	_, relayToken, err := provider.Authenticate(ctx, claims)
	if err != nil {
		logger.Errorf(ctx, "[relay] failed to generate relay token: %v", err)
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to generate relay token")
		return
	}

	now := time.Now()
	mount := &relaymodel.RelayMount{
		StationPeerID: stationPeerID,
		Label:         req.Label,
		Status:        relaymodel.MountStatusOnline,
		MaxClients:    invite.MaxClients,
		InviteID:      invite.ID,
		LastHeartbeat: now,
		MountedAt:     now,
	}

	existing, existErr := h.sub.store.GetMountByStationPeerID(ctx, stationPeerID)
	if existErr != nil {
		if err := h.sub.store.CreateMount(ctx, mount); err != nil {
			logger.Errorf(ctx, "[relay] failed to create mount: %v", err)
			h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to create mount")
			return
		}
	} else {
		existing.Status = relaymodel.MountStatusOnline
		existing.Label = req.Label
		existing.InviteID = invite.ID
		existing.LastHeartbeat = now
		if err := h.sub.store.UpdateMountStatus(ctx, stationPeerID, relaymodel.MountStatusOnline); err != nil {
			logger.Errorf(ctx, "[relay] failed to update mount: %v", err)
		}
		if err := h.sub.store.UpdateHeartbeat(ctx, stationPeerID); err != nil {
			logger.Errorf(ctx, "[relay] failed to update heartbeat: %v", err)
		}
	}

	logger.Infof(ctx, "[relay] station %s registered via invite %d", stationPeerID, invite.ID)

	resp := registerResponse{
		StationPeerID: stationPeerID,
		RelayToken:    relayToken.Value,
		ExpiresAt:     relayToken.Expiry.Format(time.RFC3339),
		ICEServers:    h.buildRelayICEServers(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *relayHandler) handleForward(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	trimmed := strings.TrimPrefix(r.URL.Path, relayForwardPrefix)
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) < 1 || parts[0] == "" {
		h.sub.writeHTTPError(w, http.StatusBadRequest, "missing station_peer_id in path")
		return
	}
	stationPeerID := parts[0]
	targetPath := "/"
	if len(parts) > 1 && parts[1] != "" {
		targetPath = "/" + parts[1]
	}
	if r.URL.RawQuery != "" {
		targetPath += "?" + r.URL.RawQuery
	}

	stream, ok := h.sub.GetStream(stationPeerID)
	if !ok {
		h.sub.writeHTTPError(w, http.StatusServiceUnavailable,
			fmt.Sprintf("station %s is not available", stationPeerID))
		return
	}

	logger.Debugf(ctx, "[relay] forwarding %s %s to station %s", r.Method, targetPath, stationPeerID)

	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.sub.writeHTTPError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	headers := make(map[string]string)
	for k, v := range r.Header {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}
	headerBytes, err := json.Marshal(headers)
	if err != nil {
		h.sub.writeHTTPError(w, http.StatusInternalServerError, "failed to serialize headers")
		return
	}

	h.sub.streamMu(stationPeerID)
	defer h.sub.streamUnlock(stationPeerID)

	if err := writeFrame(stream, r.Method, targetPath, headerBytes, body); err != nil {
		h.sub.UnregisterStream(ctx, stationPeerID)
		h.sub.writeHTTPError(w, http.StatusBadGateway, "failed to write to station stream")
		return
	}

	reader := bufio.NewReader(stream)
	statusCode, respHeaderBytes, respBody, err := readFrame(reader)
	if err != nil {
		h.sub.UnregisterStream(ctx, stationPeerID)
		h.sub.writeHTTPError(w, http.StatusBadGateway, "failed to read from station stream")
		return
	}

	var respHeaders map[string]string
	if len(respHeaderBytes) > 0 {
		_ = json.Unmarshal(respHeaderBytes, &respHeaders)
	}
	for k, v := range respHeaders {
		w.Header().Set(k, v)
	}

	w.WriteHeader(int(statusCode))
	if len(respBody) > 0 {
		_, _ = w.Write(respBody)
	}
}

func (h *relayHandler) buildRelayICEServers() []turnmodel.ICEServerInfo {
	if !h.sub.opts.TurnEnabled || h.sub.opts.TurnPublicIP == "" {
		return nil
	}

	ttl := 24 * time.Hour
	expiresAt := time.Now().Add(ttl)
	tempUsername := fmt.Sprintf("%d:relay-user", expiresAt.Unix())

	mac := hmac.New(sha1.New, []byte(h.sub.opts.TurnAuthSecret))
	mac.Write([]byte(tempUsername))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	turnAddr := fmt.Sprintf("%s:%d", h.sub.opts.TurnPublicIP, h.sub.opts.TurnPort)

	return []turnmodel.ICEServerInfo{
		{
			URLs:       []string{fmt.Sprintf("turn:%s", turnAddr)},
			Username:   tempUsername,
			Credential: credential,
			Source:     "relay",
			Priority:   2,
		},
		{
			URLs:       []string{fmt.Sprintf("turn:%s?transport=tcp", turnAddr)},
			Username:   tempUsername,
			Credential: credential,
			Source:     "relay",
			Priority:   2,
		},
	}
}

func writeFrame(w io.Writer, method, path string, headerBytes, body []byte) error {
	methodBytes := []byte(method)
	pathBytes := []byte(path)

	buf := make([]byte, 4)

	binary.BigEndian.PutUint32(buf, uint32(len(methodBytes)))
	if _, err := w.Write(buf); err != nil {
		return err
	}
	if _, err := w.Write(methodBytes); err != nil {
		return err
	}

	binary.BigEndian.PutUint32(buf, uint32(len(pathBytes)))
	if _, err := w.Write(buf); err != nil {
		return err
	}
	if _, err := w.Write(pathBytes); err != nil {
		return err
	}

	binary.BigEndian.PutUint32(buf, uint32(len(headerBytes)))
	if _, err := w.Write(buf); err != nil {
		return err
	}
	if len(headerBytes) > 0 {
		if _, err := w.Write(headerBytes); err != nil {
			return err
		}
	}

	binary.BigEndian.PutUint32(buf, uint32(len(body)))
	if _, err := w.Write(buf); err != nil {
		return err
	}
	if len(body) > 0 {
		if _, err := w.Write(body); err != nil {
			return err
		}
	}

	return nil
}

func readFrame(r io.Reader) (statusCode uint32, headerBytes, body []byte, err error) {
	buf := make([]byte, 4)

	if _, err = io.ReadFull(r, buf); err != nil {
		return 0, nil, nil, fmt.Errorf("read status code: %w", err)
	}
	statusCode = binary.BigEndian.Uint32(buf)

	if _, err = io.ReadFull(r, buf); err != nil {
		return 0, nil, nil, fmt.Errorf("read header length: %w", err)
	}
	headerLen := binary.BigEndian.Uint32(buf)
	if headerLen > 0 {
		headerBytes = make([]byte, headerLen)
		if _, err = io.ReadFull(r, headerBytes); err != nil {
			return 0, nil, nil, fmt.Errorf("read headers: %w", err)
		}
	}

	if _, err = io.ReadFull(r, buf); err != nil {
		return 0, nil, nil, fmt.Errorf("read body length: %w", err)
	}
	bodyLen := binary.BigEndian.Uint32(buf)
	if bodyLen > 0 {
		body = make([]byte, bodyLen)
		if _, err = io.ReadFull(r, body); err != nil {
			return 0, nil, nil, fmt.Errorf("read body: %w", err)
		}
	}

	return statusCode, headerBytes, body, nil
}
