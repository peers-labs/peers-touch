package conversationengine

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestCanonicalCommandRoutesKeepPolicyAtTheOwningLayer(t *testing.T) {
	policy := func(next server.EndpointHandler) server.EndpointHandler { return next }
	subserver := &subServer{
		composition: &Composition{},
		dependencies: Dependencies{
			CreateDirectPolicy: policy,
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
	if wrapperCounts["conversation-command-submit"] != 3 {
		t.Fatalf(
			"command submission must defer command-aware authorization to the authority service; got %d wrappers",
			wrapperCounts["conversation-command-submit"],
		)
	}
}
