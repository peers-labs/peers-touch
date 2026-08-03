package wrapper

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type deviceIDKey struct{}

func DeviceID() server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			for name, id := range req.Header() {
				if strings.EqualFold(name, "X-Device-ID") && id != "" {
					ctx = context.WithValue(ctx, deviceIDKey{}, id)
					break
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
