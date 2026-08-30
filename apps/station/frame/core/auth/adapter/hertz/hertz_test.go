package hertzadapter

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
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

func (p authTestProvider) Method() coreauth.Method { return coreauth.MethodJWT }
func (p authTestProvider) Authenticate(context.Context, coreauth.Credentials) (*coreauth.Subject, *coreauth.Token, error) {
	return nil, nil, errors.New("not implemented")
}
func (p authTestProvider) Validate(context.Context, string) (*coreauth.Subject, error) {
	return p.subject, p.err
}
func (p authTestProvider) Revoke(context.Context, string) error { return errors.New("not implemented") }

type rejectingSessionValidator struct {
	reason string
}

func (v rejectingSessionValidator) CheckSessionValid(context.Context, string) (bool, string) {
	return false, v.reason
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
