package relay

// 2026-04-08: Refactored — handler.go now contains ONLY:
//   - relayHandler struct
//   - Handlers() route table
//   - subject-guard wrappers
//   - JSON utility functions shared by all handlers
//
// Handler implementations live in handler_admin.go and handler_station.go.
// Auth is constructed once in SubServer.Init() and stored as jwtWrapper field,
// following the same pattern as friend_chat/subserver.go.

import (
	"encoding/json"
	"net/http"
	"strings"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const relayForwardPrefix = "/relay/forward/"

// ---- Handler ----

type relayHandler struct {
	sub *SubServer
}

func newRelayHandler(sub *SubServer) *relayHandler {
	return &relayHandler{sub: sub}
}

// ---- Route table ----

func (h *relayHandler) handlers() []server.Handler {
	jwt := h.sub.jwtWrapper
	logID := serverwrapper.LogID()

	return []server.Handler{

		// Admin endpoints — deny relay-access / relay-client tokens
		server.NewHTTPHandler("relay-invite-create", "/api/v1/relay/invite", server.POST,
			h.requireAdmin(h.handleCreateInvite), logID, jwt),
		server.NewHTTPHandler("relay-invite-list", "/api/v1/relay/invites", server.GET,
			h.requireAdmin(h.handleListInvites), logID, jwt),
		server.NewHTTPHandler("relay-invite-revoke", "/api/v1/relay/invite/revoke", server.POST,
			h.requireAdmin(h.handleRevokeInvite), logID, jwt),
		server.NewHTTPHandler("relay-mount-list", "/api/v1/relay/mounts", server.GET,
			h.requireAdmin(h.handleListMounts), logID, jwt),
		server.NewHTTPHandler("relay-mount-delete", "/api/v1/relay/mount", server.DELETE,
			h.requireAdmin(h.handleDeleteMount), logID, jwt),
		server.NewHTTPHandler("relay-stats", "/api/v1/relay/stats", server.GET,
			h.requireAdmin(h.handleStats), logID, jwt),

		// Public — no auth
		server.NewHTTPHandler("relay-register", "/api/v1/relay/register", server.POST,
			server.HTTPHandlerFunc(h.handleRegister), logID),

		// Station only — requires relay-access token
		server.NewHTTPHandler("relay-heartbeat", "/api/v1/relay/heartbeat", server.POST,
			h.requireStation(h.handleHeartbeat), logID, jwt),
		server.NewHTTPHandler("relay-token-refresh", "/api/v1/relay/token/refresh", server.POST,
			h.requireStation(h.handleTokenRefresh), logID, jwt),
		server.NewHTTPHandler("relay-client-token", "/api/v1/relay/client-token", server.POST,
			h.requireStation(h.handleMintClientToken), logID, jwt),

		// Network access — relay-access OR relay-client token
		server.NewHTTPHandler("relay-forward", relayForwardPrefix+"*path", server.ANY,
			h.requireNetwork(h.handleForward), logID, jwt),
	}
}

// ---- Subject guards ----
//
// These wrap http.HandlerFunc and check subject prefix AFTER jwtWrapper has
// already injected the subject into the request context via httpadapter.
func (h *relayHandler) requireAdmin(next http.HandlerFunc) server.EndpointHandler {
	return server.HTTPHandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subj := coreauth.GetSubject(r.Context())
		if subj == nil {
			writeJSON(w, http.StatusUnauthorized, errorBody("authentication required"))
			return
		}

		if strings.HasPrefix(subj.ID, domain.SubjectRelayAccess) ||
			strings.HasPrefix(subj.ID, domain.SubjectRelayClient) {
			writeJSON(w, http.StatusForbidden, errorBody("relay tokens cannot call admin endpoints"))
			return
		}

		next(w, r)
	})
}

func (h *relayHandler) requireStation(next http.HandlerFunc) server.EndpointHandler {
	return server.HTTPHandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subj := coreauth.GetSubject(r.Context())
		if subj == nil || !strings.HasPrefix(subj.ID, domain.SubjectRelayAccess) {
			writeJSON(w, http.StatusForbidden, errorBody("valid relay access token required"))
			return
		}
		next(w, r)
	})
}

func (h *relayHandler) requireNetwork(next http.HandlerFunc) server.EndpointHandler {
	return server.HTTPHandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subj := coreauth.GetSubject(r.Context())
		if subj == nil {
			writeJSON(w, http.StatusForbidden, errorBody("valid relay network token required"))
			return
		}
		if !strings.HasPrefix(subj.ID, domain.SubjectRelayAccess) &&
			!strings.HasPrefix(subj.ID, domain.SubjectRelayClient) {
			writeJSON(w, http.StatusForbidden, errorBody("valid relay network token required"))
			return
		}
		next(w, r)
	})
}

func stationPeerIDFromRequest(r *http.Request) (string, bool) {
	subj := coreauth.GetSubject(r.Context())
	if subj == nil || !strings.HasPrefix(subj.ID, domain.SubjectRelayAccess) {
		return "", false
	}
	return strings.TrimPrefix(subj.ID, domain.SubjectRelayAccess), true
}

// ---- JSON helpers (shared by handler_admin.go + handler_station.go) ----

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func errorBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}
