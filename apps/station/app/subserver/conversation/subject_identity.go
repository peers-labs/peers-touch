package conversation

import (
	"context"

	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
)

type conversationSubjectResolver func(context.Context, string) (string, error)

func withCanonicalConversationSubject(
	jwtWrapper server.Wrapper,
	resolve conversationSubjectResolver,
) server.Wrapper {
	return serverwrapper.CanonicalSubject(jwtWrapper, serverwrapper.SubjectResolver(resolve))
}

func resolveConversationSubjectPTID(ctx context.Context, subjectPTID string) (string, error) {
	return touchactor.ResolveSubjectPTID(ctx, subjectPTID)
}
