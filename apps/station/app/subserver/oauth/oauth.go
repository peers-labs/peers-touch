package oauth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
)

type oauthURL struct{ name, path string }

func (s oauthURL) SubPath() string { return s.path }
func (s oauthURL) Name() string    { return s.name }

type oauthSubServer struct {
	addrs  []string
	status server.Status
}

func (s *oauthSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
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
		server.NewHTTPHandler("oauth-authorize", "/oauth/authorize", server.GET, server.HertzHandlerFunc(s.handleAuthorize)),
		server.NewHTTPHandler("oauth-token", "/oauth/token", server.POST, server.HertzHandlerFunc(s.handleToken)),
	}
}

func NewOAuthSubServer(opts ...option.Option) server.Subserver {
	return &oauthSubServer{addrs: []string{}, status: server.StatusStopped}
}

func (s *oauthSubServer) handleAuthorize(c context.Context, ctx *app.RequestContext) {
	clientID := string(ctx.Query("client_id"))
	redirectURI := string(ctx.Query("redirect_uri"))
	scope := string(ctx.Query("scope"))
	state := string(ctx.Query("state"))
	userID := string(ctx.Query("user_id"))
	if clientID == "" || redirectURI == "" || userID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	rds, err := store.GetRDS(c)
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
	ac := db.OAuthAuthCode{CodeHash: util.HashString(code), ClientID: clientID, UserID: userID, Scopes: scope, ExpiresAt: time.Now().Add(5 * time.Minute), Used: false}
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
	rds, err := store.GetRDS(c)
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
	var ac db.OAuthAuthCode
	if err := rds.Where("code_hash = ? AND client_id = ?", util.HashString(code), clientID).First(&ac).Error; err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	if ac.Used || time.Now().After(ac.ExpiresAt) {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	ac.Used = true
	_ = rds.Save(&ac).Error
	access, err := util.RandomString(32)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	tok := db.OAuthToken{AccessTokenHash: util.HashString(access), TokenType: "Bearer", Scope: ac.Scopes, UserID: ac.UserID, ClientID: clientID, CreatedAt: time.Now(), ExpiresAt: time.Now().Add(2 * time.Hour)}
	if err := rds.Create(&tok).Error; err != nil {
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
