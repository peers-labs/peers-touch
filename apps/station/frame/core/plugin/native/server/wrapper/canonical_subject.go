package wrapper

import (
	"context"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type SubjectResolver func(context.Context, string) (string, error)

func CanonicalSubject(jwtWrapper server.Wrapper, resolve SubjectResolver) server.Wrapper {
	canonicalSubjectWrapper := func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			subject := coreauth.GetSubject(ctx)
			if subject == nil {
				return server.Unauthorized("authentication required")
			}
			ptid, err := resolve(ctx, subject.ID)
			if err != nil {
				return server.InternalErrorWithCause("resolve authenticated actor PTID failed", err)
			}
			canonical := *subject
			canonical.ID = ptid
			return next(coreauth.WithSubject(ctx, &canonical), req, resp)
		}
	}

	return func(next server.EndpointHandler) server.EndpointHandler {
		return jwtWrapper(canonicalSubjectWrapper(next))
	}
}
