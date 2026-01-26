package wrapper

import (
	"context"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/stretchr/testify/assert"
)

func TestJWT(t *testing.T) {
	t.Run("creates JWT wrapper successfully", func(t *testing.T) {
		provider := &mockJWTProvider{}
		wrapper := JWT(provider)

		assert.NotNil(t, wrapper)
	})

	t.Run("JWT wrapper is compatible with server.Wrapper", func(t *testing.T) {
		provider := &mockJWTProvider{}
		wrapper := JWT(provider)

		handler := wrapper(func(ctx context.Context, req server.Request, resp server.Response) error {
			return nil
		})

		assert.NotNil(t, handler)
	})
}

func TestGetSubject(t *testing.T) {
	t.Run("returns nil when no subject in context", func(t *testing.T) {
		ctx := context.Background()
		req := &mockRequest{headers: make(map[string]string)}

		subject := GetSubject(ctx, req)
		assert.Nil(t, subject)
	})

	t.Run("returns subject from context", func(t *testing.T) {
		expectedSubject := &coreauth.Subject{
			ID:         "user123",
			Attributes: map[string]string{"name": "Test User"},
		}
		ctx := context.WithValue(context.Background(), httpadapter.SubjectContextKey, expectedSubject)
		req := &mockRequest{headers: make(map[string]string)}

		subject := GetSubject(ctx, req)
		assert.NotNil(t, subject)
		assert.Equal(t, "user123", subject.ID)
		assert.Equal(t, "Test User", subject.Attributes["name"])
	})

	t.Run("returns nil when context value is not Subject type", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), httpadapter.SubjectContextKey, "not-a-subject")
		req := &mockRequest{headers: make(map[string]string)}

		subject := GetSubject(ctx, req)
		assert.Nil(t, subject)
	})
}
