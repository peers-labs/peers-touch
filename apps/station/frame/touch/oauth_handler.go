package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"

	stationoauth "github.com/peers-labs/peers-touch/station/app/subserver/oauth"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	touchauth "github.com/peers-labs/peers-touch/station/frame/touch/auth"
	oauthbridge "github.com/peers-labs/peers-touch/station/frame/touch/model/oauthbridge"
)

// OAuthLogin handles external OAuth gateway callback.
// Verifies HMAC signature, performs find-or-register, issues JWT + session.
func OAuthLogin(c context.Context, ctx *app.RequestContext) {
	var req oauthbridge.BrokerOAuthBridgeRequest
	if err := ctx.Bind(&req); err != nil {
		log.Warnf(c, "[OAuth] bind: %v", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if err := touchauth.VerifyBridgeSignature(&req); err != nil {
		log.Warnf(c, "[OAuth] signature verification failed: %v", err)
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}

	if err := touchauth.ConsumeOAuthBridgeAssertion(c, &req); err != nil {
		log.Warnf(c, "[OAuth] assertion consumption failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}
	completion, err := stationoauth.CompleteBrokerBridge(
		c,
		&req,
	)
	if err != nil {
		log.Warnf(c, "[OAuth] candidate completion failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	SuccessResponse(c, ctx, "OAuth candidate evaluated", &oauthbridge.BrokerOAuthBridgeResponse{
		Completion: completion,
	})
}

// OAuthConnectorLink verifies a broker assertion and binds it to the current
// authenticated actor without issuing or replacing a login session.
func OAuthConnectorLink(c context.Context, ctx *app.RequestContext) {
	var req oauthbridge.BrokerOAuthBridgeRequest
	if err := ctx.Bind(&req); err != nil {
		log.Warnf(c, "[OAuth] connector bind: %v", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := touchauth.VerifyBridgeSignature(&req); err != nil {
		log.Warnf(c, "[OAuth] connector signature verification failed: %v", err)
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	subject := coreauth.GetSubject(c)
	if subject == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	actorRow, err := touchactor.GetActorByPTID(c, subject.ID)
	if err != nil || actorRow == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid user identity"})
		return
	}
	if err := touchauth.BindOAuthConnector(c, &req, actorRow); err != nil {
		log.Warnf(c, "[OAuth] connector binding failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "OAuth connector linked", &oauthbridge.BrokerOAuthConnectorLinkResponse{
		ActorRef: touchactor.ProtoActorRef(actorRow, baseURLFrom(ctx)),
	})
}
