package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	legacyTestClientID     = "legacy-client"
	legacyTestClientSecret = "legacy-secret"
	legacyTestRedirectURI  = "urn:ietf:wg:oauth:2.0:oob"
	legacyTestActorPTID    = "ptid:v1:actor:peers:p:alice:fingerprint"
)

func newLegacyOAuthFixture(t *testing.T) (*oauthSubServer, *gorm.DB) {
	t.Helper()

	dsn := fmt.Sprintf(
		"file:legacy_oauth_%s?mode=memory&cache=shared&_busy_timeout=5000",
		url.QueryEscape(t.Name()),
	)
	database, err := gorm.Open(
		sqlite.Open(dsn),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatalf("open legacy OAuth database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("get legacy OAuth database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := database.AutoMigrate(&db.OAuthClient{}, &db.OAuthAuthCode{}, &db.OAuthToken{}); err != nil {
		t.Fatalf("migrate legacy OAuth tables: %v", err)
	}
	if err := database.Create(&db.OAuthClient{
		Name:             "Legacy Test Client",
		ClientID:         legacyTestClientID,
		ClientSecretHash: util.HashString(legacyTestClientSecret),
		RedirectURI:      legacyTestRedirectURI,
		Scopes:           "profile email",
	}).Error; err != nil {
		t.Fatalf("create legacy OAuth client: %v", err)
	}

	return &oauthSubServer{
		legacyDatabase: func(context.Context) (*gorm.DB, error) {
			return database, nil
		},
	}, database
}

func legacyAuthorizeContext(values url.Values) *app.RequestContext {
	requestContext := app.NewContext(0)
	requestContext.Request.Header.SetMethod(http.MethodGet)
	requestContext.Request.SetRequestURI("/oauth/authorize?" + values.Encode())
	return requestContext
}

func validLegacyAuthorizeValues() url.Values {
	return url.Values{
		"client_id":    {legacyTestClientID},
		"redirect_uri": {legacyTestRedirectURI},
		"scope":        {"profile"},
		"state":        {"state-test"},
		"consent":      {"approve"},
	}
}

func legacyTokenContext(code string) *app.RequestContext {
	requestContext := app.NewContext(0)
	requestContext.Request.Header.SetMethod(http.MethodPost)
	requestContext.Request.Header.SetContentTypeBytes([]byte("application/x-www-form-urlencoded"))
	requestContext.Request.SetRequestURI("/oauth/token")
	requestContext.Request.SetBodyString(url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {legacyTestClientID},
		"client_secret": {legacyTestClientSecret},
		"code":          {code},
	}.Encode())
	return requestContext
}

func legacyResponseError(t *testing.T, requestContext *app.RequestContext) string {
	t.Helper()
	var response struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(requestContext.Response.Body(), &response); err != nil {
		t.Fatalf("decode OAuth error response: %v", err)
	}
	return response.Error
}

func TestLegacyAuthorizeRouteRequiresJWTWrapper(t *testing.T) {
	subserver := &oauthSubServer{
		jwtWrapper: func(next server.EndpointHandler) server.EndpointHandler {
			return next
		},
	}

	for _, handler := range subserver.Handlers() {
		if handler.Path() != "/oauth/authorize" {
			continue
		}
		if len(handler.Wrappers()) != 1 {
			t.Fatalf("authorize wrapper count = %d, want 1", len(handler.Wrappers()))
		}
		return
	}
	t.Fatal("legacy authorize route is not registered")
}

func TestLegacyAuthorizeRequiresAuthenticatedSubject(t *testing.T) {
	subserver, database := newLegacyOAuthFixture(t)
	requestContext := legacyAuthorizeContext(validLegacyAuthorizeValues())

	subserver.handleAuthorize(context.Background(), requestContext)

	if got := requestContext.Response.StatusCode(); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", got, http.StatusUnauthorized)
	}
	var count int64
	if err := database.Model(&db.OAuthAuthCode{}).Count(&count).Error; err != nil {
		t.Fatalf("count authorization codes: %v", err)
	}
	if count != 0 {
		t.Fatalf("authorization codes = %d, want 0", count)
	}
}

func TestLegacyAuthorizeRequiresExplicitConsent(t *testing.T) {
	subserver, database := newLegacyOAuthFixture(t)
	values := validLegacyAuthorizeValues()
	values.Del("consent")
	requestContext := legacyAuthorizeContext(values)
	authenticated := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: legacyTestActorPTID},
	)

	subserver.handleAuthorize(authenticated, requestContext)

	if got := requestContext.Response.StatusCode(); got != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", got, http.StatusBadRequest)
	}
	var count int64
	if err := database.Model(&db.OAuthAuthCode{}).Count(&count).Error; err != nil {
		t.Fatalf("count authorization codes: %v", err)
	}
	if count != 0 {
		t.Fatalf("authorization codes = %d, want 0", count)
	}
}

func TestLegacyAuthorizeRejectsActorImpersonationParameter(t *testing.T) {
	subserver, database := newLegacyOAuthFixture(t)
	values := validLegacyAuthorizeValues()
	values.Set("actor_ptid", "ptid:v1:actor:peers:p:mallory:fingerprint")
	requestContext := legacyAuthorizeContext(values)
	authenticated := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: legacyTestActorPTID},
	)

	subserver.handleAuthorize(authenticated, requestContext)

	if got := requestContext.Response.StatusCode(); got != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", got, http.StatusBadRequest)
	}
	var count int64
	if err := database.Model(&db.OAuthAuthCode{}).Count(&count).Error; err != nil {
		t.Fatalf("count authorization codes: %v", err)
	}
	if count != 0 {
		t.Fatalf("authorization codes = %d, want 0", count)
	}
}

func TestLegacyAuthorizeDerivesActorFromAuthenticatedSubject(t *testing.T) {
	subserver, database := newLegacyOAuthFixture(t)
	requestContext := legacyAuthorizeContext(validLegacyAuthorizeValues())
	authenticated := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: legacyTestActorPTID},
	)

	subserver.handleAuthorize(authenticated, requestContext)

	if got := requestContext.Response.StatusCode(); got != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", got, http.StatusOK, requestContext.Response.Body())
	}
	var response struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(requestContext.Response.Body(), &response); err != nil {
		t.Fatalf("decode authorization response: %v", err)
	}
	var authCode db.OAuthAuthCode
	if err := database.Where("code_hash = ?", util.HashString(response.Code)).First(&authCode).Error; err != nil {
		t.Fatalf("load authorization code: %v", err)
	}
	if authCode.UserID != legacyTestActorPTID {
		t.Fatalf("authorization actor PTID = %q, want %q", authCode.UserID, legacyTestActorPTID)
	}
}

func TestLegacyAuthorizationCodeExpiryFailsClosed(t *testing.T) {
	subserver, database := newLegacyOAuthFixture(t)
	code := "expired-authorization-code"
	if err := database.Create(&db.OAuthAuthCode{
		CodeHash:  util.HashString(code),
		ClientID:  legacyTestClientID,
		UserID:    legacyTestActorPTID,
		Scopes:    "profile",
		ExpiresAt: time.Now().UTC().Add(-time.Second),
	}).Error; err != nil {
		t.Fatalf("create expired authorization code: %v", err)
	}

	requestContext := legacyTokenContext(code)
	subserver.handleToken(context.Background(), requestContext)
	if got := requestContext.Response.StatusCode(); got != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", got, http.StatusBadRequest)
	}
	if got := legacyResponseError(t, requestContext); got != "invalid_grant" {
		t.Fatalf("error = %q, want invalid_grant", got)
	}

	var authCode db.OAuthAuthCode
	if err := database.Where("code_hash = ?", util.HashString(code)).First(&authCode).Error; err != nil {
		t.Fatalf("reload expired authorization code: %v", err)
	}
	if authCode.Used {
		t.Fatal("expired authorization code was consumed")
	}
}

func TestLegacyAuthorizationCodeConcurrentRedemptionHasOneWinner(t *testing.T) {
	subserver, database := newLegacyOAuthFixture(t)
	code := "single-use-authorization-code"
	if err := database.Create(&db.OAuthAuthCode{
		CodeHash:  util.HashString(code),
		ClientID:  legacyTestClientID,
		UserID:    legacyTestActorPTID,
		Scopes:    "profile",
		ExpiresAt: time.Now().UTC().Add(time.Minute),
	}).Error; err != nil {
		t.Fatalf("create authorization code: %v", err)
	}

	const callers = 16
	var wait sync.WaitGroup
	results := make(chan *app.RequestContext, callers)
	wait.Add(callers)
	for range callers {
		go func() {
			defer wait.Done()
			requestContext := legacyTokenContext(code)
			subserver.handleToken(context.Background(), requestContext)
			results <- requestContext
		}()
	}
	wait.Wait()
	close(results)

	successes := 0
	invalidGrants := 0
	for requestContext := range results {
		switch requestContext.Response.StatusCode() {
		case http.StatusOK:
			successes++
		case http.StatusBadRequest:
			if got := legacyResponseError(t, requestContext); got != "invalid_grant" {
				t.Fatalf("concurrent redemption error = %q, want invalid_grant", got)
			}
			invalidGrants++
		default:
			t.Fatalf(
				"concurrent redemption status = %d; body=%s",
				requestContext.Response.StatusCode(),
				requestContext.Response.Body(),
			)
		}
	}
	if successes != 1 || invalidGrants != callers-1 {
		t.Fatalf(
			"redemption outcomes: successes=%d invalid_grants=%d, want 1 and %d",
			successes,
			invalidGrants,
			callers-1,
		)
	}

	var tokenCount int64
	if err := database.Model(&db.OAuthToken{}).Count(&tokenCount).Error; err != nil {
		t.Fatalf("count OAuth tokens: %v", err)
	}
	if tokenCount != 1 {
		t.Fatalf("OAuth tokens = %d, want 1", tokenCount)
	}
}

func TestLegacyAuthorizationCodePersistenceFailureRollsBackConsume(t *testing.T) {
	_, database := newLegacyOAuthFixture(t)
	code := "retryable-authorization-code"
	if err := database.Create(&db.OAuthAuthCode{
		CodeHash:  util.HashString(code),
		ClientID:  legacyTestClientID,
		UserID:    legacyTestActorPTID,
		Scopes:    "profile",
		ExpiresAt: time.Now().UTC().Add(time.Minute),
	}).Error; err != nil {
		t.Fatalf("create authorization code: %v", err)
	}
	if err := database.Migrator().DropTable(&db.OAuthToken{}); err != nil {
		t.Fatalf("drop OAuth token table: %v", err)
	}

	_, _, err := redeemLegacyAuthorizationCode(
		context.Background(),
		database,
		legacyTestClientID,
		code,
		time.Now().UTC(),
	)
	if err == nil || errors.Is(err, errLegacyAuthorizationCodeInvalid) {
		t.Fatalf("persistence error = %v, want propagated storage failure", err)
	}

	var authCode db.OAuthAuthCode
	if err := database.Where("code_hash = ?", util.HashString(code)).First(&authCode).Error; err != nil {
		t.Fatalf("reload authorization code after rollback: %v", err)
	}
	if authCode.Used {
		t.Fatal("authorization code remained consumed after token persistence rollback")
	}
}
