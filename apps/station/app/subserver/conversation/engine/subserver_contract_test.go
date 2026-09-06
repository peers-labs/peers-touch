package conversationengine

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestCanonicalCommandRoutesIncludeConversationPolicies(t *testing.T) {
	policy := func(next server.EndpointHandler) server.EndpointHandler { return next }
	subserver := &subServer{
		composition: &Composition{},
		dependencies: Dependencies{
			CreateDirectPolicy:  policy,
			SubmitCommandPolicy: policy,
		},
		jwtWrapper: policy,
	}

	wrapperCounts := make(map[string]int)
	for _, handler := range subserver.Handlers() {
		wrapperCounts[handler.Name()] = len(handler.Wrappers())
	}
	if wrapperCounts["conversation-create-direct"] != 4 {
		t.Fatalf(
			"direct creation must include log, device, social-policy, and JWT wrappers; got %d",
			wrapperCounts["conversation-create-direct"],
		)
	}
	if wrapperCounts["conversation-command-submit"] != 4 {
		t.Fatalf(
			"command submission must include log, device, social-policy, and JWT wrappers; got %d",
			wrapperCounts["conversation-command-submit"],
		)
	}
}

func TestMergeConversationViewsKeepsFollowerOnlyConversations(t *testing.T) {
	authority := []*chat.MessagingConversationView{{
		ConversationId: "local",
	}}
	followers := []*chat.MessagingConversationView{
		{ConversationId: "local"},
		{ConversationId: "remote"},
	}

	merged := mergeConversationViews(authority, followers)
	if len(merged) != 2 {
		t.Fatalf("expected one local and one follower conversation, got %d", len(merged))
	}
	if merged[0].ConversationId != "local" || merged[1].ConversationId != "remote" {
		t.Fatalf("unexpected merged conversation order: %#v", merged)
	}
}
