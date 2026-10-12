package relay

// 2026-04-08: Extracted admin handlers from the monolithic handler.go.
// Each handler follows the same pattern as friend_chat/handler.go:
//   - DTO structs defined at the top of the file
//   - Handler methods use server.* error constructors
//   - Minimal boilerplate, clear flow

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
)

// ---- DTO: Invite ----

type createInviteRequest struct {
	StationPeerID  string `json:"station_peer_id,omitempty"`
	Label          string `json:"label,omitempty"`
	MaxClients     int32  `json:"max_clients,omitempty"`
	BandwidthLimit int64  `json:"bandwidth_limit,omitempty"`
	ExpiresIn      string `json:"expires_in,omitempty"`
}

type inviteInfo struct {
	ID                    uint64 `json:"id"`
	IntendedStationPeerID string `json:"intended_station_peer_id,omitempty"`
	Label                 string `json:"label"`
	MaxClients            int32  `json:"max_clients"`
	BandwidthLimit        int64  `json:"bandwidth_limit"`
	Status                int32  `json:"status"`
	ConsumedBy            string `json:"consumed_by,omitempty"`
	ExpiresAt             string `json:"expires_at"`
	CreatedAt             string `json:"created_at"`
}

// ---- DTO: Enrollment ----

type enrollmentInfo struct {
	StationPeerID string `json:"station_peer_id"`
	NodePeerID    string `json:"node_peer_id"`
	Label         string `json:"label"`
	Status        int32  `json:"status"`
	Generation    uint64 `json:"generation"`
	EnrolledAt    string `json:"enrolled_at"`
	RevokedAt     string `json:"revoked_at,omitempty"`
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

	invite, secret, err := h.sub.svc.CreateInvite(
		ctx,
		req.StationPeerID,
		req.Label,
		req.MaxClients,
		req.BandwidthLimit,
		expiresIn,
	)
	if err != nil {
		if errors.Is(err, application.ErrInvalidRequest) {
			writeJSON(w, http.StatusBadRequest, errorBody("invalid invite request"))
			return
		}
		logger.Errorf(ctx, "[relay] create invite failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to create invite"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"invite_id":    strconv.FormatUint(invite.ID, 10),
		"invite_token": secret,
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
			ID:                    inv.ID,
			IntendedStationPeerID: inv.IntendedStationPeerID,
			Label:                 inv.Label,
			MaxClients:            inv.MaxClients,
			BandwidthLimit:        inv.BandwidthLimit,
			Status:                int32(inv.Status),
			ConsumedBy:            inv.ConsumedBy,
			ExpiresAt:             inv.ExpiresAt.Format(time.RFC3339),
			CreatedAt:             inv.CreatedAt.Format(time.RFC3339),
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

func (h *relayHandler) handleListEnrollments(w http.ResponseWriter, r *http.Request) {
	enrollments, err := h.sub.svc.ListOnlineEnrollments(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to list enrollments"))
		return
	}

	result := make([]enrollmentInfo, 0, len(enrollments))
	for _, m := range enrollments {
		revokedAt := ""
		if m.RevokedAt != nil {
			revokedAt = m.RevokedAt.Format(time.RFC3339)
		}
		result = append(result, enrollmentInfo{
			StationPeerID: m.StationPeerID,
			NodePeerID:    m.NodePeerID,
			Label:         m.Label,
			Status:        int32(m.Status),
			Generation:    m.Generation,
			EnrolledAt:    m.EnrolledAt.Format(time.RFC3339),
			RevokedAt:     revokedAt,
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"enrollments": result})
}

func (h *relayHandler) handleDeleteEnrollment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		StationPeerID string `json:"station_peer_id"`
		NodePeerID    string `json:"node_peer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("invalid request body"))
		return
	}
	if req.StationPeerID == "" || req.NodePeerID == "" {
		writeJSON(
			w,
			http.StatusBadRequest,
			errorBody("station_peer_id and node_peer_id are required"),
		)
		return
	}

	if _, err := h.sub.svc.RevokeEnrollment(
		ctx,
		req.StationPeerID,
		req.NodePeerID,
	); err != nil {
		if errors.Is(err, application.ErrEnrollmentNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody("enrollment not found"))
			return
		}
		logger.Errorf(ctx, "[relay] revoke enrollment %s: %v", req.StationPeerID, err)
		writeJSON(w, http.StatusInternalServerError, errorBody("failed to revoke enrollment"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (h *relayHandler) handleStats(w http.ResponseWriter, r *http.Request) {
	nodes, routes, permits := h.sub.opts.Admission.Counts()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"admitted_nodes": nodes,
		"active_routes":  routes,
		"active_permits": permits,
		"max_stations":   h.sub.opts.MaxStations,
	})
}
