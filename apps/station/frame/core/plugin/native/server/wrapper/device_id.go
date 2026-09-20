package wrapper

import (
	"context"
	"net/http"
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

// RequireStructuredDeviceID propagates a missing device assertion to the
// canonical route projector. The header remains only a consistency assertion;
// the application must verify device possession independently.
func RequireStructuredDeviceID(unauthorizedCode int32) server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(
			ctx context.Context,
			req server.Request,
			resp server.Response,
		) error {
			for name, id := range req.Header() {
				if strings.EqualFold(name, "X-Device-ID") &&
					strings.TrimSpace(id) != "" {
					ctx = context.WithValue(
						ctx,
						deviceIDKey{},
						strings.TrimSpace(id),
					)
					return next(ctx, req, resp)
				}
			}
			return next(
				server.WithRouteFailure(ctx, server.RouteError{
					Status:     http.StatusUnauthorized,
					StableCode: unauthorizedCode,
					Message:    "unauthorized",
				}),
				req,
				resp,
			)
		}
	}
}

func GetDeviceID(ctx context.Context) string {
	if id, ok := ctx.Value(deviceIDKey{}).(string); ok {
		return id
	}
	return ""
}
