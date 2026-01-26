package wrapper

import (
	"context"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type mockRequest struct {
	headers map[string]string
}

func (m *mockRequest) Context() context.Context      { return context.Background() }
func (m *mockRequest) Header() map[string]string     { return m.headers }
func (m *mockRequest) Method() server.Method         { return server.GET }
func (m *mockRequest) Path() string                  { return "/test" }
func (m *mockRequest) Body() []byte                  { return nil }

type mockResponse struct {
	headers    map[string]string
	body       []byte
	statusCode int
}

func (m *mockResponse) Header() map[string]string { return m.headers }
func (m *mockResponse) Write(b []byte) (int, error) {
	m.body = append(m.body, b...)
	return len(b), nil
}
func (m *mockResponse) WriteHeader(code int) { m.statusCode = code }
func (m *mockResponse) Status() int          { return m.statusCode }

type mockJWTProvider struct {
	validateFunc func(ctx context.Context, token string) (*coreauth.Subject, error)
}

func (m *mockJWTProvider) Method() coreauth.Method {
	return coreauth.MethodJWT
}

func (m *mockJWTProvider) Authenticate(ctx context.Context, cred coreauth.Credentials) (*coreauth.Subject, *coreauth.Token, error) {
	return &coreauth.Subject{ID: "user123"}, &coreauth.Token{Value: "mock-token"}, nil
}

func (m *mockJWTProvider) Validate(ctx context.Context, token string) (*coreauth.Subject, error) {
	if m.validateFunc != nil {
		return m.validateFunc(ctx, token)
	}
	return &coreauth.Subject{ID: "user123"}, nil
}

func (m *mockJWTProvider) Revoke(ctx context.Context, token string) error {
	return nil
}

type mockAccessControlConfig struct {
	enabledRoutes map[string]bool
}

func (m *mockAccessControlConfig) IsEnabled(routeName string) bool {
	if m.enabledRoutes == nil {
		return true
	}
	return m.enabledRoutes[routeName]
}
