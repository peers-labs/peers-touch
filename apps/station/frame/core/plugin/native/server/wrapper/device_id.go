package wrapper

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type deviceIDKey struct{}

func DeviceID() server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			if headers := req.Header(); headers != nil {
				if id := headers["X-Device-ID"]; id != "" {
					ctx = context.WithValue(ctx, deviceIDKey{}, id)
				}
			}
			return next(ctx, req, resp)
		}
	}
}

func GetDeviceID(ctx context.Context) string {
	if id, ok := ctx.Value(deviceIDKey{}).(string); ok {
		return id
	}
	return ""
}
