package accessgate

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate/gatekeeper"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
)

func TestLoginGateOAuthActionFollowsProviderAvailability(t *testing.T) {
	previous := oauthAvailability
	t.Cleanup(func() { oauthAvailability = previous })

	countOAuthActions := func() int {
		gate := (loginGatekeeper{}).Evaluate(context.Background(), &gatekeeper.EvalContext{})
		oauthActions := 0
		for _, action := range gate.GetAlternativeActions() {
			if action.GetType() != pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH {
				continue
			}
			oauthActions++
			if action.GetActionId() != "auth.oauth" || action.GetSubmitAction() != "start_oauth" {
				t.Fatalf("unexpected OAuth alternative action: %#v", action)
			}
		}
		return oauthActions
	}

	// Without a registered availability predicate the gate must not advertise
	// a sign-in path the Station would reject.
	oauthAvailability = nil
	if count := countOAuthActions(); count != 0 {
		t.Fatalf("AUTH_OAUTH alternatives without providers = %d, want 0", count)
	}

	oauthAvailability = func(context.Context) bool { return false }
	if count := countOAuthActions(); count != 0 {
		t.Fatalf("AUTH_OAUTH alternatives without credentials = %d, want 0", count)
	}

	oauthAvailability = func(context.Context) bool { return true }
	if count := countOAuthActions(); count != 1 {
		t.Fatalf("AUTH_OAUTH alternatives with a configured provider = %d, want 1", count)
	}
}
