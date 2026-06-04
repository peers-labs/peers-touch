// federation_api_handler.go — JWT-protected federation control surface
// for the Desktop client. Three endpoints, all under /actor/federation/*:
//
//   GET  /actor/federation/me            — current user's federation snapshot
//   GET  /actor/federation/resolve       — resolve a remote handle
//   PUT  /actor/federation/visibility    — flip current user's visibility
//
// Wire format is content-negotiated through SuccessResponse / RspError:
// every endpoint speaks proto when the caller advertises
// `Accept: application/protobuf`, and JSON otherwise. The proto path is
// the canonical one — Desktop and other first-party Peers-Touch
// clients MUST use protobuf to satisfy the Iron Law in AGENTS.md §5
// (inter-app communication). JSON is preserved for operator curl and
// for parity with the public /health endpoint, which is intentionally
// human-readable.
//
// The bootstrap subserver still hosts operator-only diagnostics
// (/sub-bootstrap/federation/*) on top of the same internal calls;
// those use a slightly different envelope shape and are kept alive on
// purpose so an operator can debug without forging a JWT.

package touch

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/hlog"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	apipb "github.com/peers-labs/peers-touch/station/frame/touch/federation/api/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
	"gorm.io/gorm"
)

// FederationMe returns the federated identity snapshot of the
// currently-logged-in actor. Always scoped to the JWT subject; there
// is no path parameter for a different actor — that would break the
// "I can only edit my own visibility" boundary that PUT /visibility
// relies on.
//
// Status mapping:
//
//	200 — snapshot in body
//	401 — missing / invalid JWT
//	403 — actor row exists but is remote_cached (federation control
//	      plane is local-only)
//	404 — actor row gone (deleted between login and request)
//	500 — unexpected DB / store error
func FederationMe(c context.Context, ctx *app.RequestContext) {
	actorID, err := resolveActorID(c, ctx)
	if err != nil || actorID == 0 {
		writeFederationError(c, ctx, http.StatusUnauthorized,
			modelpb.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			"unauthorized", nil)
		return
	}

	snap, err := actor.GetFederationSelf(c, actorID)
	if err != nil {
		writeFederationSelfError(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "federation self", selfViewFromSnapshot(snap))
}

// FederationUpdateVisibility flips the requesting actor's visibility.
// The handler:
//  1. parses + validates the wire label,
//  2. delegates to actor.UpdateVisibility (DB UPDATE + async publish),
//  3. returns the post-mutation snapshot so the UI can re-render
//     without a follow-up GET /me.
func FederationUpdateVisibility(c context.Context, ctx *app.RequestContext) {
	actorID, err := resolveActorID(c, ctx)
	if err != nil || actorID == 0 {
		writeFederationError(c, ctx, http.StatusUnauthorized,
			modelpb.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			"unauthorized", nil)
		return
	}

	req := &apipb.FederationVisibilityRequest{}
	if _, err := util.ReqBind(c, ctx, req); err != nil {
		// ReqBind already wrote a structured error response.
		return
	}

	target, err := actor.VisibilityFromLabel(req.GetVisibility())
	if err != nil {
		writeFederationError(c, ctx, http.StatusBadRequest,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_INVALID_VISIBILITY,
			err.Error(),
			map[string]string{"visibility": req.GetVisibility()})
		return
	}

	snap, err := actor.UpdateVisibility(c, actorID, target)
	if err != nil {
		writeFederationSelfError(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "visibility updated", selfViewFromSnapshot(snap))
}

// FederationResolve wraps frame/touch/federation/resolver.ResolveByHandle
// so the Desktop can search / add a remote contact by federated handle
// without learning anything about DHT or signed envelopes.
//
// Query parameters:
//
//	handle  - "user@host" or "@user@host"; required
//	timeout - optional duration string; default 15s, capped at 60s.
//	          A high cap protects clients on slow/relay-only paths
//	          from a server-imposed early abort, while preventing a
//	          pathological caller from pinning a Hertz worker forever.
//
// Status mapping:
//
//	200 — verified envelope projected to a Desktop-friendly view
//	400 — missing / malformed handle
//	401 — missing / invalid JWT
//	404 — handle not found (locator missing OR home station unreachable)
//	410 — handle is tombstoned (owner withdrew)
//	503 — federation gate closed (DHT routing table below threshold)
//	      OR local identity not registered (boot still in progress)
//	500 — resolver internal error (signature verify, network, ...)
func FederationResolve(c context.Context, ctx *app.RequestContext) {
	if _, err := resolveActorID(c, ctx); err != nil {
		writeFederationError(c, ctx, http.StatusUnauthorized,
			modelpb.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			"unauthorized", nil)
		return
	}

	handle := string(ctx.Query("handle"))
	if handle == "" {
		writeFederationError(c, ctx, http.StatusBadRequest,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_HANDLE_REQUIRED,
			"handle parameter is required", nil)
		return
	}

	timeout := 15 * time.Second
	if t := string(ctx.Query("timeout")); t != "" {
		if d, perr := time.ParseDuration(t); perr == nil && d > 0 {
			if d > 60*time.Second {
				d = 60 * time.Second
			}
			timeout = d
		}
	}

	resolveCtx, cancel := context.WithTimeout(c, timeout)
	defer cancel()

	res, err := resolver.New(resolver.Config{}).ResolveByHandle(
		resolveCtx,
		handle,
		actor.FederationProfileFetcher(""),
		actor.FederationKeyCache(),
	)
	if err != nil {
		writeFederationResolveError(c, ctx, handle, err)
		return
	}

	SuccessResponse(c, ctx, "federation resolve verified", resolveViewFromResolved(res))
}

// ── projections (snapshot/resolved → wire proto) ───────────────────

// selfViewFromSnapshot projects an actor's snapshot into the wire
// proto. ActorID is rendered as a string because uint64 is not safely
// representable in JavaScript number; ActorIdUint carries the raw
// uint64 for proto-savvy consumers (Rust station gateway). The two
// MUST always agree.
func selfViewFromSnapshot(s *actor.FederationSelfSnapshot) *apipb.FederationSelfView {
	if s == nil {
		return &apipb.FederationSelfView{}
	}
	return &apipb.FederationSelfView{
		ActorId:           strconv.FormatUint(s.ActorID, 10),
		ActorIdUint:       s.ActorID,
		PreferredUsername: s.PreferredUsername,
		FederatedHandle:   s.FederatedHandle,
		HomeStationPeerId: s.HomeStationPeerID,
		HomeStationDomain: s.HomeStationDomain,
		Visibility:        visibilityToProto(s.Visibility),
		VisibilityLabel:   s.VisibilityLabel,
		LocatorSeq:        s.LocatorSeq,
		Origin:            s.Origin,
		// Tier B2 — diagnostic exposure of the relay-mount labels the
		// next signed locator publish will carry. Read at request time
		// from the live RelayClient handle so a Settings panel reload
		// reflects the relay-client subserver's current state without
		// needing a republish to flow through.
		InboxRelayMounts: liveInboxRelayMounts(),
	}
}

// liveInboxRelayMounts mirrors the touch-actor locator hook's
// currentInboxRelayMounts() helper, but in the API namespace so the
// /me endpoint can advertise mounts even before the next periodic
// republish stamps them onto a real locator record. Empty when
// relay-client is disabled or has not yet acquired its mount.
func liveInboxRelayMounts() []string {
	rc := fednode.RelayClient()
	if rc == nil {
		return nil
	}
	base := strings.TrimSpace(rc.BaseURL())
	if base == "" {
		return nil
	}
	return []string{strings.TrimRight(base, "/")}
}

// resolveViewFromResolved flattens the resolver result into a
// Desktop-shaped proto view. The full envelope (signature, key PEM)
// stays server-side — clients never need to verify themselves; they
// trust this station's resolver and the TOFU pin behind it.
func resolveViewFromResolved(r *resolver.Resolved) *apipb.FederationResolveView {
	if r == nil || r.Envelope == nil {
		return &apipb.FederationResolveView{}
	}
	env := r.Envelope
	view := &apipb.FederationResolveView{
		FederatedHandle:   env.GetFederatedHandle(),
		HomeStationPeerId: env.GetHomeStationPeerId(),
		HomeStationDomain: env.GetHomeStationDomain(),
		IsLocal:           r.IsLocal,
		FromCache:         r.FromCache,
		Profile:           env.GetProfile(),
		LocatorSeq:        r.Locator.GetSeq(),
		IssuedAtUnixMs:    env.GetIssuedAtUnixMs(),
		ExpiresAtUnixMs:   env.GetExpiresAtUnixMs(),
		SigningKeyKid:     env.GetSigningKeyKid(),
	}
	return view
}

// visibilityToProto maps the int16 DB value into the wire enum. The
// numeric ranges already line up (see actor/locator_hook.go), but we
// still go through the enum so a future renumbering on either side is
// caught at compile time.
func visibilityToProto(v int16) apipb.FederationVisibility {
	switch v {
	case actor.VisibilityHidden:
		return apipb.FederationVisibility_FEDERATION_VISIBILITY_HIDDEN
	case actor.VisibilityByHandle:
		return apipb.FederationVisibility_FEDERATION_VISIBILITY_BY_HANDLE
	case actor.VisibilityIndexed:
		return apipb.FederationVisibility_FEDERATION_VISIBILITY_INDEXED
	default:
		return apipb.FederationVisibility_FEDERATION_VISIBILITY_UNSPECIFIED
	}
}

// ── error helpers ──────────────────────────────────────────────────

// writeFederationError renders an error response in the active
// content-negotiated format. We go through util.RspError so a proto
// caller gets a typed ErrorResponse and a JSON caller gets the legacy
// {code, message} shape — same path Touch's other handlers use.
func writeFederationError(
	c context.Context,
	ctx *app.RequestContext,
	httpStatus int,
	code modelpb.ErrorCode,
	message string,
	details map[string]string,
) {
	resp := &modelpb.ErrorResponse{Code: code, Message: message}
	if len(details) > 0 {
		resp.Details = details
	}
	util.RspError(c, ctx, httpStatus, resp)
}

// writeFederationSelfError centralises the error mapping for /me and
// PUT /visibility (which share the same not-found / not-local /
// unexpected-error branches). Keeping it as a single helper means
// future error additions only have to happen in one place.
func writeFederationSelfError(c context.Context, ctx *app.RequestContext, err error) {
	switch {
	case actor.IsRecordNotFound(err) || errors.Is(err, gorm.ErrRecordNotFound):
		writeFederationError(c, ctx, http.StatusNotFound,
			modelpb.ErrorCode_ERROR_CODE_ACTOR_NOT_FOUND,
			"actor not found", nil)
	case errors.Is(err, actor.ErrNotLocal):
		writeFederationError(c, ctx, http.StatusForbidden,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_NOT_LOCAL,
			"actor is not local to this station", nil)
	case errors.Is(err, actor.ErrInvalidVisibility):
		writeFederationError(c, ctx, http.StatusBadRequest,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_INVALID_VISIBILITY,
			err.Error(), nil)
	default:
		hlog.Warnf("[federation self] err=%v", err)
		writeFederationError(c, ctx, http.StatusInternalServerError,
			modelpb.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR,
			err.Error(), nil)
	}
}

// writeFederationResolveError maps resolver-side error sentinels to
// HTTP status codes + typed error codes. The default branch collapses
// every "I tried but it broke" case to ERROR_CODE_FEDERATION_RESOLVE_FAILED
// so a Desktop client only has to switch on a small set of codes.
func writeFederationResolveError(c context.Context, ctx *app.RequestContext, handle string, err error) {
	details := map[string]string{"handle": handle}
	switch {
	case errors.Is(err, resolver.ErrTombstoned):
		writeFederationError(c, ctx, http.StatusGone,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_TOMBSTONED,
			"actor withdrawn (tombstone)", details)
	case errors.Is(err, resolver.ErrLocalIdentityMissing):
		writeFederationError(c, ctx, http.StatusServiceUnavailable,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_LOCAL_IDENTITY_MISSING,
			"federation not ready: local identity unavailable", details)
	case errors.Is(err, resolver.ErrFederationNotReady):
		details["detail"] = err.Error()
		writeFederationError(c, ctx, http.StatusServiceUnavailable,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_NOT_READY,
			"federation not ready", details)
	case errors.Is(err, locator.ErrNotFound):
		writeFederationError(c, ctx, http.StatusNotFound,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_HANDLE_NOT_FOUND,
			"handle not found", details)
	default:
		hlog.Warnf("[federation resolve] handle=%s err=%v", handle, err)
		details["detail"] = err.Error()
		writeFederationError(c, ctx, http.StatusInternalServerError,
			modelpb.ErrorCode_ERROR_CODE_FEDERATION_RESOLVE_FAILED,
			"resolve failed", details)
	}
}
