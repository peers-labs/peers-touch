package relay

// 2026-04-08: Refactored — handler.go now contains ONLY:
//   - relayHandler struct
//   - Handlers() route table
//   - subject-guard wrappers
//   - JSON utility functions shared by all handlers
//
// Handler implementations live in handler_admin.go and handler_station.go.
// Operator and network credentials use separate wrappers constructed during
// SubServer.Init.

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap/accessendpoint"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// ---- Handler ----

type relayHandler struct {
	sub *SubServer
}

func newRelayHandler(sub *SubServer) *relayHandler {
	return &relayHandler{sub: sub}
}

// ---- Route table ----

func (h *relayHandler) handlers() []server.Handler {
	mountJWT := h.sub.mountJWTWrapper
	mountRotateJWT := h.sub.mountRotateJWTWrapper
	routePublishJWT := h.sub.routePublishJWTWrapper
	operatorJWT := h.sub.operatorJWTWrapper
	logID := serverwrapper.LogID()

	return []server.Handler{
		// Public readiness surface.
		server.NewHTTPHandler("relay-healthz", "/healthz", server.GET,
			server.HTTPHandlerFunc(h.handleHealthz), logID),

		// Operator endpoints use a dedicated key, issuer, audience, and scope.
		server.NewHTTPHandler("relay-metrics", "/metrics", server.GET,
			h.requireAdmin(h.handleMetrics), logID, operatorJWT),
		server.NewHTTPHandler("relay-invite-create", "/api/v1/relay/invite", server.POST,
			h.requireAdmin(h.handleCreateInvite), logID, operatorJWT),
		server.NewHTTPHandler("relay-invite-list", "/api/v1/relay/invites", server.GET,
			h.requireAdmin(h.handleListInvites), logID, operatorJWT),
		server.NewHTTPHandler("relay-invite-revoke", "/api/v1/relay/invite/revoke", server.POST,
			h.requireAdmin(h.handleRevokeInvite), logID, operatorJWT),
		server.NewHTTPHandler("relay-mount-list", "/api/v1/relay/mounts", server.GET,
			h.requireAdmin(h.handleListMounts), logID, operatorJWT),
		server.NewHTTPHandler("relay-mount-delete", "/api/v1/relay/mount", server.DELETE,
			h.requireAdmin(h.handleDeleteMount), logID, operatorJWT),
		server.NewHTTPHandler("relay-stats", "/api/v1/relay/stats", server.GET,
			h.requireAdmin(h.handleStats), logID, operatorJWT),

		// Public — no auth
		server.NewHTTPHandler(
			"relay-enrollment-challenge",
			"/api/v1/relay/enrollment/challenge",
			server.POST,
			server.HTTPHandlerFunc(h.handleEnrollmentChallenge),
			logID,
		),
		server.NewHTTPHandler("relay-register", "/api/v1/relay/register", server.POST,
			server.HTTPHandlerFunc(h.handleRegister), logID),
		accessendpoint.Handler(h.sub, logID),

		// Station only — requires a current Relay mount credential.
		server.NewHTTPHandler("relay-heartbeat", "/api/v1/relay/heartbeat", server.POST,
			h.requireStation(h.handleHeartbeat), logID, mountJWT),
		server.NewHTTPHandler(
			"relay-rotation-challenge",
			"/api/v1/relay/rotation/challenge",
			server.POST,
			h.requireStation(h.handleRotationChallenge),
			logID,
			mountRotateJWT,
		),
		server.NewHTTPHandler("relay-token-refresh", "/api/v1/relay/token/refresh", server.POST,
			h.requireStation(h.handleTokenRefresh), logID, mountRotateJWT),
		server.NewStrictTypedHandler(
			"relay-route-publish",
			"/api/v1/relay/routes",
			server.POST,
			h.handlePublishStationRoute,
			logID,
			routePublishJWT,
		),
		server.NewStrictTypedHandler(
			"relay-grant-register",
			"/api/v1/relay/grants",
			server.POST,
			h.handleRegisterConnectionGrant,
			logID,
			routePublishJWT,
		),

		// Opaque network access. Authentication is completed by TunnelOpen:
		// client grant reservation or Station mount peer-tunnel scope.
		server.NewHertzHandler(
			"relay-opaque-tunnel",
			"/.well-known/peers-touch/tunnel",
			server.GET,
			h.handleTunnel,
		),
	}
}

func (h *relayHandler) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	status := http.StatusOK
	body := map[string]string{"role": "relay", "status": "ready"}
	if h.sub.status != server.StatusRunning {
		status = http.StatusServiceUnavailable
		body["status"] = "not_ready"
	}
	writeJSON(w, status, body)
}

func (h *relayHandler) handleMetrics(w http.ResponseWriter, request *http.Request) {
	metrics.Get().Handler().ServeHTTP(w, request)
}

// ---- Subject guards ----
//
// These wrap http.HandlerFunc and check the subject after the route-specific
// credential wrapper has injected it into the request context.
func (h *relayHandler) requireAdmin(next http.HandlerFunc) server.EndpointHandler {
	return server.HTTPHandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subj := coreauth.GetSubject(r.Context())
		if subj == nil {
			writeJSON(w, http.StatusUnauthorized, errorBody("authentication required"))
			return
		}

		if subj.Attributes["audience"] != h.sub.opts.OperatorAudience ||
			subj.Attributes["scope"] != h.sub.opts.OperatorScope {
			writeJSON(w, http.StatusForbidden, errorBody("relay operator policy rejected credential"))
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

func stationPeerIDFromRequest(r *http.Request) (string, bool) {
	subj := coreauth.GetSubject(r.Context())
	if subj == nil || !strings.HasPrefix(subj.ID, domain.SubjectRelayAccess) {
		return "", false
	}
	return strings.TrimPrefix(subj.ID, domain.SubjectRelayAccess), true
}

func mountIdentityFromRequest(
	r *http.Request,
) (domain.MountIdentity, bool) {
	subject := coreauth.GetSubject(r.Context())
	if subject == nil {
		return domain.MountIdentity{}, false
	}
	return mountIdentityFromSubject(subject.ID, subject.Attributes)
}

func mountIdentityFromSubject(
	subjectID string,
	attributes map[string]string,
) (domain.MountIdentity, bool) {
	if !strings.HasPrefix(subjectID, domain.SubjectRelayAccess) {
		return domain.MountIdentity{}, false
	}
	mountID, err := strconv.ParseUint(attributes["mount_id"], 10, 64)
	if err != nil || mountID == 0 {
		return domain.MountIdentity{}, false
	}
	generation, err := strconv.ParseUint(
		attributes["generation"],
		10,
		64,
	)
	if err != nil || generation == 0 {
		return domain.MountIdentity{}, false
	}
	stationPeerID := attributes["station_peer_id"]
	jti := attributes["jti"]
	if stationPeerID == "" || jti == "" {
		return domain.MountIdentity{}, false
	}
	return domain.MountIdentity{
		RelayPeerID:   attributes["relay_peer_id"],
		StationPeerID: stationPeerID,
		MountID:       mountID,
		Generation:    generation,
		JTI:           jti,
	}, true
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
