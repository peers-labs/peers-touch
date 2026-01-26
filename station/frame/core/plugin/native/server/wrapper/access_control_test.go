package wrapper

import (
	"context"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/stretchr/testify/assert"
)

func TestAccessControl(t *testing.T) {
	t.Run("allows access when route is enabled", func(t *testing.T) {
		config := &mockAccessControlConfig{
			enabledRoutes: map[string]bool{
				"admin": true,
			},
		}

		var handlerCalled bool
		wrapper := AccessControl("admin", config)
		handler := wrapper(func(ctx context.Context, req server.Request, resp server.Response) error {
			handlerCalled = true
			return nil
		})

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		err := handler(context.Background(), req, resp)

		assert.NoError(t, err)
		assert.True(t, handlerCalled, "Handler should be called when route is enabled")
	})

	t.Run("blocks access when route is disabled", func(t *testing.T) {
		config := &mockAccessControlConfig{
			enabledRoutes: map[string]bool{
				"admin": false,
			},
		}

		var handlerCalled bool
		wrapper := AccessControl("admin", config)
		handler := wrapper(func(ctx context.Context, req server.Request, resp server.Response) error {
			handlerCalled = true
			return nil
		})

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		err := handler(context.Background(), req, resp)

		assert.NoError(t, err)
		assert.False(t, handlerCalled, "Handler should not be called when route is disabled")
		assert.Equal(t, http.StatusNotFound, resp.statusCode, "Should return 404 status")
		assert.Contains(t, string(resp.body), "Page not found", "Should return error message")
	})

	t.Run("blocks access for unknown routes", func(t *testing.T) {
		config := &mockAccessControlConfig{
			enabledRoutes: map[string]bool{
				"admin": true,
			},
		}

		var handlerCalled bool
		wrapper := AccessControl("unknown", config)
		handler := wrapper(func(ctx context.Context, req server.Request, resp server.Response) error {
			handlerCalled = true
			return nil
		})

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		err := handler(context.Background(), req, resp)

		assert.NoError(t, err)
		assert.False(t, handlerCalled, "Handler should not be called for unknown route")
		assert.Equal(t, http.StatusNotFound, resp.statusCode)
	})

	t.Run("allows all routes when config returns true by default", func(t *testing.T) {
		config := &mockAccessControlConfig{}

		var handlerCalled bool
		wrapper := AccessControl("any-route", config)
		handler := wrapper(func(ctx context.Context, req server.Request, resp server.Response) error {
			handlerCalled = true
			return nil
		})

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		err := handler(context.Background(), req, resp)

		assert.NoError(t, err)
		assert.True(t, handlerCalled, "Handler should be called when config allows by default")
	})

	t.Run("returns 404 status on blocked access", func(t *testing.T) {
		config := &mockAccessControlConfig{
			enabledRoutes: map[string]bool{
				"admin": false,
			},
		}

		var handlerCalled bool
		wrapper := AccessControl("admin", config)
		handler := wrapper(func(ctx context.Context, req server.Request, resp server.Response) error {
			handlerCalled = true
			return nil
		})

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		_ = handler(context.Background(), req, resp)

		assert.False(t, handlerCalled, "Handler should not be called")
		assert.Equal(t, http.StatusNotFound, resp.statusCode, "Should return 404 status")
	})
}

func TestAccessControlIntegration(t *testing.T) {
	t.Run("works with multiple wrappers", func(t *testing.T) {
		config := &mockAccessControlConfig{
			enabledRoutes: map[string]bool{
				"admin": true,
			},
		}

		var logIDCaptured string
		var handlerCalled bool

		accessWrapper := AccessControl("admin", config)
		logWrapper := LogID()

		handler := logWrapper(accessWrapper(func(ctx context.Context, req server.Request, resp server.Response) error {
			handlerCalled = true
			logIDCaptured = GetLogID(ctx)
			return nil
		}))

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		err := handler(context.Background(), req, resp)

		assert.NoError(t, err)
		assert.True(t, handlerCalled, "Handler should be called")
		assert.NotEmpty(t, logIDCaptured, "Log ID should be captured")
	})
}
