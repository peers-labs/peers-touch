// actor_handler.go — Actor management handlers (signup, login, logout, profile, list, search).
//
// Extracted from activitypub_handler.go during the activitypub→actor rename refactoring.
// AP protocol handlers remain in activitypub_handler.go; only client-facing actor
// management endpoints live here.

package touch

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	gate "github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	gatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// ActorHandlerInfo represents a single handler's information for actor management endpoints.
type ActorHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// GetActorHandlers returns all actor management handler configurations.
// These cover signup, login, logout, profile, list, search, and OAuth login.
func GetActorHandlers() []ActorHandlerInfo {
	actorWrapper := CommonAccessControlWrapper(model.RouteNameActor)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	commonWrapper := CommonAccessControlWrapper(model.RouteNameActor)

	return []ActorHandlerInfo{
		// Actor Management Endpoints (Client API)
		{
			RouterURL: RouterURLActorSignUP,
			Handler:   ActorSignup,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLOAuthLogin,
			Handler:   OAuthLogin,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLOAuthConnectorLink,
			Handler:   OAuthConnectorLink,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLAccessAttemptStart,
			Handler:   StartAccessAttempt,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessAttemptStart,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessGateSubmit,
			Handler:   SubmitAccessGate,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessGateSubmit,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessDecision,
			Handler:   GetAccessDecision,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessDecision,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessAttemptCancel,
			Handler:   CancelAccessAttempt,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessAttemptCancel,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLActorLogout,
			Handler:   ActorLogout,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorSessionTakeover,
			Handler:   ActorSessionTakeover,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorChangePassword,
			Handler:   ActorChangePassword,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorProfile,
			Handler:   GetActorProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLPublicProfile,
			Handler:   PublicProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public access
		},
		{
			RouterURL: RouterURLFederationProfile,
			Handler:   FederationProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public — federation surface
		},
		{
			RouterURL: RouterURLFederationHealth,
			Handler:   FederationHealth,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public — readiness probe
		},
		{
			RouterURL: RouterURLActorBasicInfo,
			Handler:   GetActorBasicInfo,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public access - for Avatar component
		},
		{
			RouterURL: RouterURLActorPublicProfileByID,
			Handler:   GetActorPublicProfileByID,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorProfile,
			Handler:   UpdateActorProfile,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorList,
			Handler:   ListActors,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorSearch,
			Handler:   SearchActors,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
	}
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

func ActorSignup(c context.Context, ctx *app.RequestContext) {
	var params model.ActorSignRequest
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Signup bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Check(); err != nil {
		log.Warnf(c, "Signup checked params failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	err := actor.SignUp(c, &params, baseURLFrom(ctx))
	if err != nil {
		log.Warnf(c, "Signup failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	SuccessResponse(c, ctx, "Actor signup successful", nil)
}

// stationLabel returns the human-readable station name from environment.
func stationLabel() string {
	return os.Getenv("PEERS_NODE_LABEL")
}

func StartAccessAttempt(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.StartAccessAttemptRequest
	if err := bindAccessProto(ctx, &req); err != nil {
		log.Warnf(c, "Access attempt bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	decision, err := gate.StartAttempt(c, &req)
	if err != nil {
		log.Warnf(c, "Access attempt start failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	SuccessResponse(c, ctx, "Access attempt started", &gatepb.StartAccessAttemptResponse{
		Decision:     decision,
		StationLabel: stationLabel(),
	})
}

func HandleAccessGateOptions(_ context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	writeAccessGatePreflight(ctx)
}

func setAccessGateCORSHeaders(ctx *app.RequestContext) {
	origin := string(ctx.GetHeader("Origin"))
	if origin == "" {
		origin = "*"
	}

	ctx.Header("Access-Control-Allow-Origin", origin)
	ctx.Header("Access-Control-Allow-Credentials", "true")
	ctx.Header("Access-Control-Allow-Methods", "POST, OPTIONS")
	ctx.Header("Access-Control-Allow-Headers", "Accept, Content-Type, Authorization")
	ctx.Header("Access-Control-Max-Age", "600")
}

func isAccessGatePreflight(ctx *app.RequestContext) bool {
	return string(ctx.Method()) == string(server.OPTIONS)
}

func writeAccessGatePreflight(ctx *app.RequestContext) {
	ctx.Data(http.StatusNoContent, "text/plain", nil)
}

func SubmitAccessGate(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.SubmitAccessGateRequest
	if err := bindAccessProto(ctx, &req); err != nil {
		log.Warnf(c, "Access gate submit bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}
	submitSchemaBoundAccessGate(c, ctx, &req)
}

func GetAccessDecision(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.GetAccessDecisionRequest
	if err := bindAccessProto(ctx, &req); err != nil {
		log.Warnf(c, "Access decision bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	attempt, ok := gate.GetAttempt(c, req.GetAttemptId())
	if !ok {
		FailedResponse(c, ctx, errors.New("access attempt expired or not found"))
		return
	}
	if err := gate.ValidateDecisionRead(attempt, &req); err != nil {
		FailedResponse(c, ctx, err)
		return
	}

	decision, err := gate.RefreshDecision(c, attempt)
	if err != nil {
		FailedResponse(c, ctx, err)
		return
	}
	var credential *model.LoginResponse
	if decision.GetState() == gatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED &&
		req.GetStationPeerId() != "" {
		credential, err = gate.FinalizeGrantedSession(
			c,
			req.GetAttemptId(),
			req.GetStationPeerId(),
			req.GetDeviceId(),
			req.GetLifecycleGeneration(),
			ctx.ClientIP(),
			string(ctx.GetHeader("User-Agent")),
		)
		if err != nil {
			FailedResponse(c, ctx, err)
			return
		}
	}
	SuccessResponse(c, ctx, "Access decision", &gatepb.GetAccessDecisionResponse{
		Decision:      decision,
		LoginResponse: credential,
	})
}

func ActorSessionTakeover(c context.Context, ctx *app.RequestContext) {
	subject := coreauth.GetSubject(c)
	if subject == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	user, err := actor.GetActorByPTID(c, subject.ID)
	if err != nil || user == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid user identity"})
		return
	}

	var req struct {
		DeviceType string `json:"device_type"`
	}
	_ = ctx.Bind(&req)
	if req.DeviceType == "" {
		req.DeviceType = "desktop"
	}

	actorRef := actor.ProtoActorRef(user, baseURLFrom(ctx))
	if allowed, reason := gate.CheckActorAllowed(c, actorRef, user.PreferredUsername, user.Email); !allowed {
		log.Warnf(c, "Session takeover blocked by access gate policy: ptid=%s reason=%s", actorRef.GetPtid(), reason)
		FailedResponse(c, ctx, errors.New(reason))
		return
	}

	result, err := auth.IssueTokenAndSession(c, user, ctx.ClientIP(), string(ctx.GetHeader("User-Agent")), req.DeviceType, map[string]interface{}{
		"auth_method": "session_takeover",
	})
	if err != nil {
		log.Warnf(c, "Session takeover failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	_ = actor.UpdateActorStatus(c, user.ID, db.ActorStatusOnline, string(ctx.GetHeader("User-Agent")))
	ctx.SetCookie("session_id", result.SessionID, int(24*time.Hour.Seconds()), "/", "", protocol.CookieSameSiteDisabled, false, true)

	loginResp := loginResponseFromSessionResult(result, actorRef)
	SuccessResponse(c, ctx, "Session takeover successful", loginResp)
}

func loginResponseFromSessionResult(result *auth.SessionLoginResult, actorRef *model.ActorRef) *model.LoginResponse {
	expiresAt := result.ExpiresAt.Format(time.RFC3339)
	return &model.LoginResponse{
		Tokens: &model.AuthTokens{
			Token:        result.AccessToken,
			AccessToken:  result.AccessToken,
			RefreshToken: result.RefreshToken,
			TokenType:    result.TokenType,
			ExpiresAt:    expiresAt,
		},
		SessionId: result.SessionID,
		ActorRef:  actorRef,
	}
}

func submitSchemaBoundAccessGate(
	c context.Context,
	ctx *app.RequestContext,
	req *gatepb.SubmitAccessGateRequest,
) {
	claim, err := gate.BeginSubmission(c, req)
	if err != nil {
		log.Warnf(c, "Schema-bound access gate submission rejected: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	decision := claim.Decision
	if !claim.Replay {
		switch req.GetType() {
		case gatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN:
			decision, err = submitAccessLoginCandidate(c, ctx, req)
		case gatepb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE:
			decision, err = gate.CompleteInviteCode(c, req.GetAttemptId(), req.GetInviteCode())
		case gatepb.AccessGateType_ACCESS_GATE_TYPE_TERMS_ACCEPTANCE,
			gatepb.AccessGateType_ACCESS_GATE_TYPE_CUSTOM:
			decision, err = gate.CompleteGenericAction(
				c,
				req.GetAttemptId(),
				req.GetActionId(),
				req.GetGeneric(),
			)
		default:
			err = fmt.Errorf("unsupported schema-bound access gate type: %s", req.GetType().String())
		}
		if err != nil {
			gate.AbandonSubmission(c, req)
			FailedResponse(c, ctx, err)
			return
		}
	}

	var credential *model.LoginResponse
	if decision.GetState() == gatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED {
		credential, err = gate.FinalizeGrantedSession(
			c,
			req.GetAttemptId(),
			req.GetStationPeerId(),
			req.GetDeviceId(),
			req.GetLifecycleGeneration(),
			ctx.ClientIP(),
			string(ctx.GetHeader("User-Agent")),
		)
		if err != nil {
			FailedResponse(c, ctx, err)
			return
		}
	}
	if !claim.Replay {
		if err := gate.CompleteSubmission(c, req, decision); err != nil {
			FailedResponse(c, ctx, err)
			return
		}
	}
	if credential != nil {
		gate.MarkGrantedActorOnline(c, credential, string(ctx.GetHeader("User-Agent")))
	}
	SuccessResponse(c, ctx, "Access gate evaluated", &gatepb.SubmitAccessGateResponse{
		Decision:      decision,
		LoginResponse: credential,
	})
}

func submitAccessLoginCandidate(
	c context.Context,
	ctx *app.RequestContext,
	req *gatepb.SubmitAccessGateRequest,
) (*gatepb.AccessDecision, error) {
	loginReq := req.GetLogin()
	if loginReq == nil {
		return nil, errors.New("login gate requires credentials")
	}
	params := model.ActorLoginParams{
		Email:      loginReq.GetEmail(),
		Password:   loginReq.GetPassword(),
		DeviceType: loginReq.GetDeviceType(),
	}
	if err := params.Check(); err != nil {
		return nil, err
	}
	actorRecord, err := auth.AuthenticatePassword(c, &auth.Credentials{
		Email:    params.Email,
		Password: params.Password,
	})
	if err != nil {
		log.Warnf(c, "Access login authentication failed: %v", err)
		return nil, err
	}
	return gate.CompleteLoginCandidate(
		c,
		req.GetAttemptId(),
		actor.ProtoActorRef(actorRecord, baseURLFrom(ctx)),
		actorRecord.PreferredUsername,
		actorRecord.Email,
	)
}

// CancelAccessAttempt closes a live attempt so an abandoned gate flow leaves a
// terminal record instead of lingering until expiry. It is idempotent.
func CancelAccessAttempt(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.CancelAccessAttemptRequest
	if err := bindAccessProto(ctx, &req); err != nil {
		log.Warnf(c, "Access cancel bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}
	if attempt, ok := gate.GetAttempt(c, req.GetAttemptId()); ok {
		if err := gate.ValidateCancellation(attempt, &req); err != nil {
			FailedResponse(c, ctx, err)
			return
		}
	}

	cancelled, err := gate.CancelAttempt(c, req.GetAttemptId())
	if err != nil {
		log.Warnf(c, "Access cancel failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	SuccessResponse(c, ctx, "Access attempt cancelled", &gatepb.CancelAccessAttemptResponse{Cancelled: cancelled})
}

func ActorLogout(c context.Context, ctx *app.RequestContext) {
	// 1. Try to get session_id from cookie or request body
	sessionID := string(ctx.Cookie("session_id"))

	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := ctx.Bind(&req); err == nil && req.SessionID != "" {
		sessionID = req.SessionID
	}

	// 2. Clear from store
	if sessionID != "" {
		_ = auth.LogoutSession(c, sessionID)
	}

	// 3. Update user status to offline
	subject := coreauth.GetSubject(c)
	if subject != nil {
		if currentActor, err := actor.GetActorByPTID(c, subject.ID); err == nil && currentActor != nil {
			_ = actor.UpdateActorStatus(c, currentActor.ID, db.ActorStatusOffline, "")
		}
	}

	// 4. Clear session cookie
	ctx.SetCookie("session_id", "", -1, "/", "", protocol.CookieSameSiteDisabled, false, true)

	SuccessResponse(c, ctx, "Logout successful", nil)
}

func ActorChangePassword(c context.Context, ctx *app.RequestContext) {
	subject := coreauth.GetSubject(c)
	if subject == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	currentActor, err := actor.GetActorByPTID(c, subject.ID)
	if err != nil || currentActor == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid user identity"})
		return
	}

	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := ctx.Bind(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if req.OldPassword == "" || req.NewPassword == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "old_password and new_password are required"})
		return
	}
	if len(req.NewPassword) < 1 {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "new password too short"})
		return
	}

	if err := auth.ChangePassword(c, currentActor.ID, req.OldPassword, req.NewPassword); err != nil {
		if err == auth.ErrInvalidCredentials {
			ctx.JSON(http.StatusForbidden, map[string]string{"error": "old password is incorrect"})
			return
		}
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to change password"})
		return
	}

	SuccessResponse(c, ctx, "Password changed successfully", nil)
}

func GetActorProfile(c context.Context, ctx *app.RequestContext) {
	actorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	baseURL := baseURLFrom(ctx)
	resp, err := actor.GetWebProfileByID(c, actorID, baseURL)
	if err != nil {
		log.Warnf(c, "Get actor profile failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "Actor profile retrieved", actor.WebProfileToActorProfileProto(resp))
}

// GetActorPublicProfileByID returns the rich public profile of any actor by
// PTID. Used by chat detail / contacts detail to render peer
// profile cards that mirror the structure of the user's own profile view.
//
// Returned `ActorProfile` carries only fields intended for public exposure;
// sensitive data (email, password hash, raw keys, session metadata, ...) is
// never serialized into `ActorProfile`. Auth is enforced to prevent the
// endpoint becoming an open enumeration surface.
func GetActorPublicProfileByID(c context.Context, ctx *app.RequestContext) {
	idStr := ctx.Param("id")
	if idStr == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor id is required"})
		return
	}

	if _, err := actor.ResolveSubjectPTID(c, idStr); err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid actor PTID"})
		return
	}
	resp, err := actor.GetWebProfileByPTID(c, idStr, baseURLFrom(ctx))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, map[string]string{"error": "actor not found"})
			return
		}
		log.Warnf(c, "Get peer profile failed: id=%s err=%v", idStr, err)
		FailedResponse(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "Peer profile retrieved", actor.WebProfileToActorProfileProto(resp))
}

func PublicProfile(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("actor")
	if username == "" {
		log.Warnf(c, "Username parameter is required")
		ctx.JSON(http.StatusBadRequest, "Username parameter is required")
		return
	}

	baseURL := baseURLFrom(ctx)
	resp, err := actor.GetWebProfile(c, username, baseURL)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, "User not found")
			return
		}
		log.Errorf(c, "Failed to fetch actor profile: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Internal Server Error")
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ActorBasicInfoResponse contains only non-sensitive public info for an actor.
// Used by Avatar component to resolve unknown actor's avatar/name.
type ActorBasicInfoResponse struct {
	Actor       *model.ActorRef `json:"actor"`
	DisplayName string          `json:"display_name"`
	Username    string          `json:"username"`
	AvatarURL   string          `json:"avatar_url"`
	CoverURL    string          `json:"cover_url"`
}

// GetActorBasicInfo returns public basic info (displayName, avatarUrl, coverUrl) for an actor by ID.
// This is a public endpoint (no auth required) for Avatar component to resolve unknown actors.
func GetActorBasicInfo(c context.Context, ctx *app.RequestContext) {
	idStr := ctx.Param("id")
	if idStr == "" {
		ctx.JSON(http.StatusBadRequest, "Actor ID is required")
		return
	}

	if _, err := actor.ResolveSubjectPTID(c, idStr); err != nil {
		ctx.JSON(http.StatusBadRequest, "Invalid actor PTID format")
		return
	}

	baseURL := baseURLFrom(ctx)
	record, err := actor.GetActorByPTID(c, idStr)
	if err != nil || record == nil {
		ctx.JSON(http.StatusNotFound, "Actor not found")
		return
	}
	resp, err := actor.GetWebProfileByPTID(c, idStr, baseURL)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, "Actor not found")
			return
		}
		log.Errorf(c, "Failed to fetch actor basic info: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Internal Server Error")
		return
	}

	// Return only non-sensitive public info
	basicInfo := ActorBasicInfoResponse{
		Actor:       actor.ProtoActorRef(record, baseURL),
		DisplayName: resp.DisplayName,
		Username:    resp.Username,
		AvatarURL:   resp.Avatar,
		CoverURL:    resp.Header,
	}

	ctx.JSON(http.StatusOK, basicInfo)
}

func UpdateActorProfile(c context.Context, ctx *app.RequestContext) {
	var protoReq model.UpdateProfileRequest
	if err := bindProtoOrJSON(ctx, &protoReq); err != nil {
		log.Warnf(c, "Update profile bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}
	params := actor.UpdateProfileRequestFromProto(&protoReq)
	if err := actor.ValidateProfileUpdateRequest(params); err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	actorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	result, err := actor.UpdateProfileByID(c, actorID, baseURLFrom(ctx), params)
	if err != nil {
		log.Warnf(c, "Update profile failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "Profile update resolved", &model.UpdateProfileResponse{
		Outcome: result.Outcome,
		Profile: actor.WebProfileToActorProfileProto(result.Profile),
	})
}

// ListActors returns actors from preset configuration.
func ListActors(c context.Context, ctx *app.RequestContext) {
	// Get current user ID from context (if authenticated)
	var currentActorID uint64
	if subject := coreauth.GetSubject(c); subject != nil {
		if currentActor, err := actor.GetActorByPTID(c, subject.ID); err == nil && currentActor != nil {
			currentActorID = currentActor.ID
			log.Infof(c, "[ListActors] Current user actor ID: %d", currentActorID)
		}
	}

	actors, err := actor.ListActors(c, currentActorID)
	if err != nil {
		log.Warnf(c, "List actors failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	// Map to proto ActorList with relationship status
	items := make([]*model.Actor, 0, len(actors))
	for _, a := range actors {
		isFollowing := false
		if currentActorID > 0 {
			isFollowing, _ = actor.IsFollowing(c, currentActorID, a.ID)
		}

		items = append(items, &model.Actor{
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			Email:       a.Email,
			Inbox:       a.Inbox,
			Outbox:      a.Outbox,
			Endpoints:   nil,
			Ref:         actor.ProtoActorRef(a, baseURLFrom(ctx)),
			IsFollowing: isFollowing,
		})
	}
	SuccessResponse(c, ctx, "Actor list", &model.ActorList{Items: items, Total: int64(len(items))})
}

// SearchActors searches local actors by query (fuzzy match on username and display name).
func SearchActors(c context.Context, ctx *app.RequestContext) {
	query := string(ctx.Query("q"))
	if query == "" {
		FailedResponse(c, ctx, errors.New("query parameter 'q' is required"))
		return
	}

	// Get current user ID from context (if authenticated)
	var excludeActorID uint64
	if subject := coreauth.GetSubject(c); subject != nil {
		if currentActor, err := actor.GetActorByPTID(c, subject.ID); err == nil && currentActor != nil {
			excludeActorID = currentActor.ID
			log.Infof(c, "[SearchActors] Excluding current user with actor ID: %d", excludeActorID)
		}
	}

	actors, err := actor.SearchActorsAsPreset(c, query, excludeActorID)
	if err != nil {
		log.Warnf(c, "Search actors failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	// Map to proto ActorList
	items := make([]*model.Actor, 0, len(actors))
	for _, a := range actors {
		items = append(items, &model.Actor{
			Username:    a.Username,
			DisplayName: a.DisplayName,
			Email:       a.Email,
			Inbox:       a.Inbox,
			Outbox:      a.Outbox,
			Endpoints:   a.Endpoints,
			Ref:         a.Ref,
		})
	}
	SuccessResponse(c, ctx, "Search results", &model.ActorList{Items: items, Total: int64(len(items))})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// resolveActorID translates the authenticated PTID to the Station-local
// persistence key at the repository boundary.
func resolveActorID(c context.Context, ctx *app.RequestContext) (uint64, error) {
	authHeader := string(ctx.GetHeader("Authorization"))
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return 0, errors.New("no_token")
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	subj, err := provider.Validate(c, token)
	if err != nil {
		return 0, err
	}
	record, err := actor.GetActorByPTID(c, subj.ID)
	if err != nil {
		return 0, err
	}
	if record == nil {
		return 0, errors.New("authenticated actor PTID not found")
	}
	return record.ID, nil
}

func baseURLFrom(ctx *app.RequestContext) string {
	scheme := string(ctx.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		scheme = string(ctx.URI().Scheme())
	}
	if scheme == "" {
		scheme = "https"
	}

	host := string(ctx.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = string(ctx.Host())
	}

	if _, _, err := net.SplitHostPort(host); err != nil {
		port := string(ctx.GetHeader("X-Forwarded-Port"))
		if port != "" && port != "80" && port != "443" {
			host = net.JoinHostPort(host, port)
		}
	}

	return fmt.Sprintf("%s://%s", scheme, host)
}
