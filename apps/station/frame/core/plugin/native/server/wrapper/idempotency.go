package wrapper

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type idempotencyKeyKey struct{}

func IdempotencyKey() server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			if headers := req.Header(); headers != nil {
				if key := headers["Idempotency-Key"]; key != "" {
					ctx = context.WithValue(ctx, idempotencyKeyKey{}, key)
				}
			}
			return next(ctx, req, resp)
		}
	}
}

func GetIdempotencyKey(ctx context.Context) string {
	if key, ok := ctx.Value(idempotencyKeyKey{}).(string); ok {
		return key
	}
	return ""
}
