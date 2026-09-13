package hertzadapter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	hertzserver "github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type authLogCapture struct {
	mu       sync.Mutex
	messages []string
}

func (c *authLogCapture) Init(context.Context, ...logger.Option) error { return nil }
func (c *authLogCapture) Options() logger.Options {
	return logger.Options{Level: logger.TraceLevel}
}
func (c *authLogCapture) Fields(map[string]interface{}) logger.Logger { return c }
func (c *authLogCapture) String() string                              { return "auth-log-capture" }
func (c *authLogCapture) Log(ctx context.Context, level logger.Level, values ...interface{}) {
	c.append(ctx, level, fmt.Sprint(values...))
}
func (c *authLogCapture) Logf(ctx context.Context, level logger.Level, format string, values ...interface{}) {
	c.append(ctx, level, fmt.Sprintf(format, values...))
}
func (c *authLogCapture) append(ctx context.Context, level logger.Level, message string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messages = append(c.messages, fmt.Sprintf(
		"level=%s request_id=%s trace_id=%s message=%s",
		level,
		logger.GetRequestID(ctx),
		logger.GetTraceID(ctx),
		message,
	))
}
func (c *authLogCapture) StringOutput() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.Join(c.messages, "\n")
}

type authTestProvider struct {
	subject *coreauth.Subject
	err     error
}

type optionalAuthTestProvider struct{}

func (p authTestProvider) Method() coreauth.Method { return coreauth.MethodJWT }
func (p authTestProvider) Authenticate(context.Context, coreauth.Credentials) (*coreauth.Subject, *coreauth.Token, error) {
	return nil, nil, errors.New("not implemented")
}
func (p authTestProvider) Validate(context.Context, string) (*coreauth.Subject, error) {
	return p.subject, p.err
}
func (p authTestProvider) Revoke(context.Context, string) error { return errors.New("not implemented") }

func (optionalAuthTestProvider) Method() coreauth.Method { return coreauth.MethodJWT }
func (optionalAuthTestProvider) Authenticate(context.Context, coreauth.Credentials) (*coreauth.Subject, *coreauth.Token, error) {
	return nil, nil, errors.New("not implemented")
}
func (optionalAuthTestProvider) Validate(_ context.Context, token string) (*coreauth.Subject, error) {
	switch token {
	case "valid-token":
		return &coreauth.Subject{ID: "ptid:actor:canonical"}, nil
	case "revoked-token":
		return &coreauth.Subject{ID: "ptid:actor:revoked", SessionID: "revoked-session"}, nil
	default:
		return nil, errors.New("invalid or expired token")
	}
}
func (optionalAuthTestProvider) Revoke(context.Context, string) error {
	return errors.New("not implemented")
}

type rejectingSessionValidator struct {
	reason string
}

func (v rejectingSessionValidator) CheckSessionValid(context.Context, string) (bool, string) {
	return false, v.reason
}

func TestOptionalJWTTraversesRealHertzRequest(t *testing.T) {
	handlerCalls := 0
	engine := hertzserver.New()
	engine.GET(
		"/public",
		OptionalJWT(
			optionalAuthTestProvider{},
			rejectingSessionValidator{reason: "revoked"},
		),
		func(_ context.Context, ctx *app.RequestContext) {
			handlerCalls++
			subject := GetSubject(ctx)
			if subject == nil {
				ctx.Header("X-Auth-Subject", "anonymous")
			} else {
				ctx.Header("X-Auth-Subject", subject.ID)
			}
			ctx.SetStatusCode(http.StatusNoContent)
		},
	)

	tests := []struct {
		name            string
		authorization   string
		wantStatus      int
		wantSubject     string
		wantHandlerCall bool
	}{
		{name: "absent is anonymous", wantStatus: http.StatusNoContent, wantSubject: "anonymous", wantHandlerCall: true},
		{name: "valid bearer injects subject", authorization: "Bearer valid-token", wantStatus: http.StatusNoContent, wantSubject: "ptid:actor:canonical", wantHandlerCall: true},
		{name: "wrong scheme is rejected", authorization: "Basic credential", wantStatus: http.StatusUnauthorized},
		{name: "empty bearer is rejected", authorization: "Bearer ", wantStatus: http.StatusUnauthorized},
		{name: "invalid bearer is rejected", authorization: "Bearer invalid-token", wantStatus: http.StatusUnauthorized},
		{name: "expired bearer is rejected", authorization: "Bearer expired-token", wantStatus: http.StatusUnauthorized},
		{name: "revoked bearer is rejected", authorization: "Bearer revoked-token", wantStatus: http.StatusUnauthorized},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			before := handlerCalls
			headers := []ut.Header{}
			if test.authorization != "" {
				headers = append(headers, ut.Header{Key: "Authorization", Value: test.authorization})
			}

			response := ut.PerformRequest(engine.Engine, http.MethodGet, "/public", nil, headers...).Result()

			if response.StatusCode() != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode(), test.wantStatus)
			}
			if got := string(response.Header.Peek("X-Auth-Subject")); got != test.wantSubject {
				t.Fatalf("subject = %q, want %q", got, test.wantSubject)
			}
			called := handlerCalls == before+1
			if called != test.wantHandlerCall {
				t.Fatalf("downstream called = %t, want %t", called, test.wantHandlerCall)
			}
		})
	}
}

func TestRequireJWTTraversesRealHertzRequest(t *testing.T) {
	engine := hertzserver.New()
	calls := 0
	engine.GET(
		"/protected",
		RequireJWT(authTestProvider{subject: &coreauth.Subject{ID: "ptid:actor:canonical"}}),
		func(_ context.Context, ctx *app.RequestContext) {
			calls++
			ctx.SetStatusCode(http.StatusNoContent)
		},
	)

	response := ut.PerformRequest(
		engine.Engine,
		http.MethodGet,
		"/protected",
		nil,
		ut.Header{Key: "Authorization", Value: "Bearer valid-token"},
	).Result()

	if response.StatusCode() != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.StatusCode(), http.StatusNoContent)
	}
	if calls != 1 {
		t.Fatalf("downstream calls = %d, want 1", calls)
	}
}

func TestRequireJWTLogsOutcomeAndCorrelationWithoutCredentialsOrIdentity(t *testing.T) {
	const (
		bearerToken = "secret-bearer-value"
		actorPTID   = "ptid:actor:secret"
		sessionID   = "session-secret-value"
		requestID   = "request-safe-correlation"
	)

	capture := &authLogCapture{}
	originalLogger := logger.DefaultLogger
	logger.DefaultLogger = capture
	t.Cleanup(func() {
		logger.DefaultLogger = originalLogger
	})

	ctx := logger.WithRequestID(context.Background(), requestID)
	provider := authTestProvider{
		err: fmt.Errorf(
			"validation failed token=%s actor=%s session=%s",
			bearerToken,
			actorPTID,
			sessionID,
		),
	}
	requestContext := &app.RequestContext{}
	requestContext.Request.Header.Set("Authorization", "Bearer "+bearerToken)

	RequireJWT(provider)(ctx, requestContext)

	if requestContext.Response.StatusCode() != 401 {
		t.Fatalf("status = %d, want 401", requestContext.Response.StatusCode())
	}

	output := capture.StringOutput()
	for _, secret := range []string{"Authorization", bearerToken, actorPTID, sessionID} {
		if strings.Contains(output, secret) {
			t.Fatalf("captured logs contain sensitive value %q: %s", secret, output)
		}
	}
	for _, expected := range []string{requestID, "credentials rejected: validation failed"} {
		if !strings.Contains(output, expected) {
			t.Fatalf("captured logs missing %q: %s", expected, output)
		}
	}
}

func TestRequireJWTSessionRejectionLogExcludesSubjectSessionAndReason(t *testing.T) {
	const (
		actorPTID = "ptid:actor:private"
		sessionID = "session-private"
	)

	capture := &authLogCapture{}
	originalLogger := logger.DefaultLogger
	logger.DefaultLogger = capture
	t.Cleanup(func() {
		logger.DefaultLogger = originalLogger
	})

	provider := authTestProvider{
		subject: &coreauth.Subject{ID: actorPTID, SessionID: sessionID},
	}
	validator := rejectingSessionValidator{
		reason: "revoked actor=" + actorPTID + " session=" + sessionID,
	}
	requestContext := &app.RequestContext{}
	requestContext.Request.Header.Set("Authorization", "Bearer valid-but-private")

	RequireJWT(provider, validator)(context.Background(), requestContext)

	output := capture.StringOutput()
	for _, secret := range []string{actorPTID, sessionID, "valid-but-private"} {
		if strings.Contains(output, secret) {
			t.Fatalf("captured logs contain sensitive value %q: %s", secret, output)
		}
	}
	if !strings.Contains(output, "credentials rejected: session invalid") {
		t.Fatalf("captured logs missing session rejection outcome: %s", output)
	}
}
