package oauth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
	"gorm.io/gorm"
)

type oauthURL struct{ name, path string }

func (s oauthURL) SubPath() string { return s.path }
func (s oauthURL) Name() string    { return s.name }

type oauthSubServer struct {
	addrs          []string
	status         server.Status
	service        *oauthService
	legacyDatabase func(context.Context) (*gorm.DB, error)
	jwtWrapper     server.Wrapper
}

func (s *oauthSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	return nil
}
func (s *oauthSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}
func (s *oauthSubServer) Stop(ctx context.Context) error { s.status = server.StatusStopped; return nil }
func (s *oauthSubServer) Status() server.Status          { return s.status }
func (s *oauthSubServer) Name() string                   { return "oauth" }
func (s *oauthSubServer) Type() server.SubserverType     { return server.SubserverTypeHTTP }
func (s *oauthSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

func (s *oauthSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHTTPHandler("oauth-providers", "/oauth/providers", server.GET, server.HertzHandlerFunc(s.handleProviders)),
		server.NewHTTPHandler("oauth-providers-api", "/api/oauth/providers", server.GET, server.HertzHandlerFunc(s.handleProviders)),
		server.NewHTTPHandler(
			"oauth-authorize",
			"/oauth/authorize",
			server.GET,
			server.HertzHandlerFunc(s.handleAuthorize),
			s.jwtWrapper,
		),
		server.NewHTTPHandler("oauth-token", "/oauth/token", server.POST, server.HertzHandlerFunc(s.handleToken)),
		server.NewTypedHandler[oauthpb.StartOAuthAttemptRequest, oauthpb.StartOAuthAttemptResponse](
			"oauth-mobile-start",
			"/oauth/mobile/start",
			server.POST,
			s.startOAuthAttempt,
		),
		server.NewTypedHandler[oauthpb.CompleteOAuthAttemptRequest, oauthpb.CompleteOAuthAttemptResponse](
			"oauth-mobile-complete",
			"/oauth/mobile/complete",
			server.POST,
			s.completeOAuthAttempt,
		),
		server.NewTypedHandler[oauthpb.GetOAuthAttemptRequest, oauthpb.GetOAuthAttemptResponse](
			"oauth-mobile-status",
			"/oauth/mobile/status",
			server.POST,
			s.getOAuthAttempt,
		),
		server.NewTypedHandler[oauthpb.CancelOAuthAttemptRequest, oauthpb.CancelOAuthAttemptResponse](
			"oauth-mobile-cancel",
			"/oauth/mobile/cancel",
			server.POST,
			s.cancelOAuthAttempt,
		),
		server.NewTypedHandler[oauthpb.AcknowledgeOAuthCredentialRequest, oauthpb.AcknowledgeOAuthCredentialResponse](
			"oauth-mobile-acknowledge",
			"/oauth/mobile/acknowledge",
			server.POST,
			s.acknowledgeOAuthCredential,
		),
	}
}

func NewOAuthSubServer(opts ...option.Option) server.Subserver {
	database := func(ctx context.Context) (*gorm.DB, error) {
		return store.GetRDS(ctx)
	}
	repository := newGormOAuthRepository(database)
	return &oauthSubServer{
		addrs:          []string{},
		status:         server.StatusStopped,
		legacyDatabase: database,
		service: newOAuthService(
			repository,
			newHTTPProviderExchange(),
			stationAccessCoordinator{},
			stationActorResolver{},
			stationSessionCredentialIssuer{},
		),
	}
}

func (s *oauthSubServer) startOAuthAttempt(
	ctx context.Context,
	req *oauthpb.StartOAuthAttemptRequest,
) (*oauthpb.StartOAuthAttemptResponse, error) {
	response, err := s.service.Start(ctx, req)
	if err != nil {
		return nil, server.BadRequestWithCause("OAuth attempt start rejected", err)
	}
	return response, nil
}

func (s *oauthSubServer) completeOAuthAttempt(
	ctx context.Context,
	req *oauthpb.CompleteOAuthAttemptRequest,
) (*oauthpb.CompleteOAuthAttemptResponse, error) {
	response, err := s.service.Complete(ctx, req)
	if err != nil {
		return nil, server.InternalErrorWithCause("OAuth attempt completion failed", err)
	}
	return response, nil
}

func (s *oauthSubServer) getOAuthAttempt(
	ctx context.Context,
	req *oauthpb.GetOAuthAttemptRequest,
) (*oauthpb.GetOAuthAttemptResponse, error) {
	response, err := s.service.Status(ctx, req)
	if err != nil {
		if errors.Is(err, errOAuthAttemptNotFound) {
			return nil, server.NotFound("OAuth attempt not found")
		}
		return nil, server.InternalErrorWithCause("OAuth attempt status failed", err)
	}
	return response, nil
}

func (s *oauthSubServer) cancelOAuthAttempt(
	ctx context.Context,
	req *oauthpb.CancelOAuthAttemptRequest,
) (*oauthpb.CancelOAuthAttemptResponse, error) {
	response, err := s.service.Cancel(ctx, req)
	if err != nil {
		if errors.Is(err, errOAuthAttemptNotFound) {
			return nil, server.NotFound("OAuth attempt not found")
		}
		return nil, server.InternalErrorWithCause("OAuth attempt cancellation failed", err)
	}
	return response, nil
}

func (s *oauthSubServer) acknowledgeOAuthCredential(
	ctx context.Context,
	req *oauthpb.AcknowledgeOAuthCredentialRequest,
) (*oauthpb.AcknowledgeOAuthCredentialResponse, error) {
	response, err := s.service.Acknowledge(ctx, req)
	if err != nil {
		if errors.Is(err, errOAuthAttemptNotFound) {
			return nil, server.NotFound("OAuth attempt not found")
		}
		return nil, server.InternalErrorWithCause("OAuth credential acknowledgement failed", err)
	}
	return response, nil
}

func (s *oauthSubServer) handleAuthorize(c context.Context, ctx *app.RequestContext) {
	clientID := string(ctx.Query("client_id"))
	redirectURI := string(ctx.Query("redirect_uri"))
	scope := string(ctx.Query("scope"))
	state := string(ctx.Query("state"))
	consent := string(ctx.Query("consent"))
	if clientID == "" || redirectURI == "" || consent == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	// Actor identity is exclusively authenticated context. Identity-bearing
	// query parameters are rejected rather than retained as a compatibility path.
	if len(ctx.Query("actor_ptid")) > 0 || len(ctx.Query("user_id")) > 0 {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	if consent != "approve" {
		ctx.JSON(http.StatusForbidden, map[string]string{"error": "access_denied"})
		return
	}
	subject := coreauth.GetSubject(c)
	if subject == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication_required"})
		return
	}
	actorPTID, err := touchactor.ResolveSubjectPTID(c, subject.ID)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication_required"})
		return
	}
	rds, err := s.legacyDatabase(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	var client db.OAuthClient
	if err := rds.Where("client_id = ?", clientID).First(&client).Error; err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_client"})
		return
	}
	if client.RedirectURI != redirectURI {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_redirect_uri"})
		return
	}
	if scope == "" {
		scope = client.Scopes
	}
	if !scopeSubset(scope, client.Scopes) {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_scope"})
		return
	}
	code, err := util.RandomString(32)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ac := db.OAuthAuthCode{CodeHash: util.HashString(code), ClientID: clientID, UserID: actorPTID, Scopes: scope, ExpiresAt: time.Now().Add(5 * time.Minute), Used: false}
	if err := rds.Create(&ac).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	if redirectURI == "urn:ietf:wg:oauth:2.0:oob" {
		ctx.JSON(http.StatusOK, map[string]string{"code": code, "state": state})
		return
	}
	ctx.Redirect(http.StatusFound, []byte(redirectURI+"?code="+code+"&state="+state))
}

func (s *oauthSubServer) handleToken(c context.Context, ctx *app.RequestContext) {
	grantType := string(ctx.PostForm("grant_type"))
	clientID := string(ctx.PostForm("client_id"))
	clientSecret := string(ctx.PostForm("client_secret"))
	code := string(ctx.PostForm("code"))
	if grantType != "authorization_code" || clientID == "" || clientSecret == "" || code == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	rds, err := s.legacyDatabase(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	var client db.OAuthClient
	if err := rds.Where("client_id = ?", clientID).First(&client).Error; err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_client"})
		return
	}
	if client.ClientSecretHash != util.HashString(clientSecret) {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_client"})
		return
	}
	access, ac, err := redeemLegacyAuthorizationCode(c, rds, clientID, code, time.Now().UTC())
	if errors.Is(err, errLegacyAuthorizationCodeInvalid) {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	ctx.JSON(http.StatusOK, map[string]interface{}{
		"access_token": access,
		"token_type":   "Bearer",
		"scope":        ac.Scopes,
		"created_at":   time.Now().Unix(),
	})
}

func (s *oauthSubServer) handleProviders(c context.Context, ctx *app.RequestContext) {
	providers := make([]map[string]any, 0, len(oauthOptions.Peers.Node.Server.Subserver.OAuth.Providers))
	for _, p := range oauthOptions.Peers.Node.Server.Subserver.OAuth.Providers {
		if !p.Enabled {
			continue
		}
		envs := make([]map[string]any, 0, len(p.Environments))
		for _, env := range p.Environments {
			envs = append(envs, map[string]any{
				"id":            env.ID,
				"name":          env.Name,
				"authorize_url": env.AuthorizeURL,
				"token_url":     env.TokenURL,
				"userinfo_url":  env.UserinfoURL,
				"default":       env.Default,
			})
		}
		providers = append(providers, map[string]any{
			"id":              p.ID,
			"name":            p.Name,
			"description":     p.Description,
			"icon":            p.Icon,
			"color":           p.Color,
			"category":        p.Category,
			"builtin":         true,
			"enabled":         p.Enabled,
			"status":          p.Status,
			"has_credentials": p.HasCredentials,
			"connected":       false,
			"callback_url":    p.CallbackURL,
			"environments":    envs,
		})
	}
	ctx.JSON(http.StatusOK, providers)
}

func scopeSubset(req, allowed string) bool {
	if allowed == "" {
		return req == ""
	}
	allowedSet := make(map[string]struct{})
	for _, s := range strings.Fields(allowed) {
		allowedSet[s] = struct{}{}
	}
	for _, s := range strings.Fields(req) {
		if _, ok := allowedSet[s]; !ok {
			return false
		}
	}
	return true
}
