package wrapper

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/stretchr/testify/assert"
)

func TestLogID(t *testing.T) {
	t.Run("generates and injects log ID", func(t *testing.T) {
		var capturedCtx context.Context
		var capturedLogID string

		handler := LogID()(func(ctx context.Context, req server.Request, resp server.Response) error {
			capturedCtx = ctx
			capturedLogID = GetLogID(ctx)
			return nil
		})

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		err := handler(context.Background(), req, resp)

		assert.NoError(t, err)
		assert.NotEmpty(t, capturedLogID, "Log ID should be generated")
		assert.Equal(t, capturedLogID, resp.headers["X-Log-Id"], "Log ID should be in response header")
		assert.Equal(t, capturedLogID, GetLogID(capturedCtx), "Log ID should be retrievable from context")
	})

	t.Run("log ID format is valid ULID", func(t *testing.T) {
		handler := LogID()(func(ctx context.Context, req server.Request, resp server.Response) error {
			logID := GetLogID(ctx)
			assert.Len(t, logID, 26, "ULID should be 26 characters")
			return nil
		})

		req := &mockRequest{headers: make(map[string]string)}
		resp := &mockResponse{headers: make(map[string]string)}

		err := handler(context.Background(), req, resp)
		assert.NoError(t, err)
	})

	t.Run("each request gets unique log ID", func(t *testing.T) {
		logIDs := make(map[string]bool)

		handler := LogID()(func(ctx context.Context, req server.Request, resp server.Response) error {
			logID := GetLogID(ctx)
			logIDs[logID] = true
			return nil
		})

		for i := 0; i < 10; i++ {
			req := &mockRequest{headers: make(map[string]string)}
			resp := &mockResponse{headers: make(map[string]string)}
			_ = handler(context.Background(), req, resp)
		}

		assert.Len(t, logIDs, 10, "All log IDs should be unique")
	})
}

func TestGetLogID(t *testing.T) {
	t.Run("returns empty string when no log ID in context", func(t *testing.T) {
		ctx := context.Background()
		logID := GetLogID(ctx)
		assert.Empty(t, logID)
	})

	t.Run("returns log ID from context", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), logIDKey{}, "test-log-id")
		logID := GetLogID(ctx)
		assert.Equal(t, "test-log-id", logID)
	})
}
