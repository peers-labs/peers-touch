package wrapper

import (
	"context"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type logIDKey struct{}

func LogID() server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			logID := ulid.Make().String()
			resp.Header()["X-Log-Id"] = logID

			ctx = context.WithValue(ctx, logIDKey{}, logID)

			return next(ctx, req, resp)
		}
	}
}

func GetLogID(ctx context.Context) string {
	if logID, ok := ctx.Value(logIDKey{}).(string); ok {
		return logID
	}
	return ""
}
