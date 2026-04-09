package relay

// 2026-04-08: Extracted admin handlers from the monolithic handler.go.
// Each handler follows the same pattern as friend_chat/handler.go:
//   - DTO structs defined at the top of the file
//   - Handler methods use server.* error constructors
//   - Minimal boilerplate, clear flow

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// ---- DTO: Invite ----

type createInviteRequest struct {
	StationPeerID string `json:"station_peer_id,omitempty"`
	Label         string `json:"label,omitempty"`
	MaxClients    int32  `json:"max_clients,omitempty"`
	ExpiresIn     string `json:"expires_in,omitempty"`
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

// ---- DTO: Mount ----

type mountInfo struct {
	StationPeerID string `json:"station_peer_id"`
	Label         string `json:"label"`
	Status        int32  `json:"status"`
	LastHeartbeat string `json:"last_heartbeat"`
	MountedAt     string `json:"mounted_at"`
}

// ---- Handlers ----

func (h *relayHandler) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req createInviteRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}

	expiresIn := 7 * 24 * time.Hour
	if req.ExpiresIn != "" {
		d, err := time.ParseDuration(req.ExpiresIn)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid expires_in format"))
			return
		}
		expiresIn = d
	}

	invite, _, err := h.sub.svc.CreateInvite(ctx, req.StationPeerID, req.Label, req.MaxClients, expiresIn)
	if err != nil {
		logger.Errorf(ctx, "[relay] create invite failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to create invite"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"invite_token": invite.Token,
		"expires_at":   invite.ExpiresAt.Format(time.RFC3339),
	})
}

func (h *relayHandler) handleListInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := h.sub.svc.ListInvites(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to list invites"))
		return
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

	writeJSON(w, http.StatusOK, map[string]interface{}{"invites": result})
}

func (h *relayHandler) handleRevokeInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		InviteID uint64 `json:"invite_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}

	if err := h.sub.svc.RevokeInvite(ctx, req.InviteID); err != nil {
		logger.Errorf(ctx, "[relay] revoke invite %d: %v", req.InviteID, err)
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to revoke invite"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (h *relayHandler) handleListMounts(w http.ResponseWriter, r *http.Request) {
	mounts, err := h.sub.svc.ListOnlineMounts(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to list mounts"))
		return
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

	writeJSON(w, http.StatusOK, map[string]interface{}{"mounts": result})
}

func (h *relayHandler) handleDeleteMount(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		StationPeerID string `json:"station_peer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}
	if req.StationPeerID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("station_peer_id is required"))
		return
	}

	h.sub.streams.Remove(ctx, req.StationPeerID)

	if err := h.sub.svc.DeleteMount(ctx, req.StationPeerID); err != nil {
		logger.Errorf(ctx, "[relay] delete mount %s: %v", req.StationPeerID, err)
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to delete mount"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *relayHandler) handleStats(w http.ResponseWriter, r *http.Request) {
	count, err := h.sub.svc.CountOnlineMounts(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to get stats"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"online_stations":   count,
		"active_streams":    h.sub.streams.Count(),
		"inflight_forwards": h.sub.streams.Inflight(),
		"max_stations":      h.sub.opts.MaxStations,
		"heartbeat_timeout": h.sub.opts.HeartbeatTimeout,
	})
}
