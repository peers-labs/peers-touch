package key_exchange

import (
	"context"

	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
)

type keyExchangeSubjectResolver func(context.Context, string) (string, error)

func withCanonicalKeyExchangeSubject(
	jwtWrapper server.Wrapper,
	resolve keyExchangeSubjectResolver,
) server.Wrapper {
	return serverwrapper.CanonicalSubject(jwtWrapper, serverwrapper.SubjectResolver(resolve))
}

func resolveKeyExchangeSubjectPTID(ctx context.Context, subjectID string) (string, error) {
	return touchactor.ResolveSubjectPTID(ctx, subjectID)
}
