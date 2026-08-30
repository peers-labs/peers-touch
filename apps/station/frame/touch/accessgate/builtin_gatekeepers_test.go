package accessgate

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate/gatekeeper"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
)

func TestLoginGateAdvertisesOAuthAsAlternativeAction(t *testing.T) {
	gate := (loginGatekeeper{}).Evaluate(context.Background(), &gatekeeper.EvalContext{})
	if gate.GetType() != pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN {
		t.Fatalf("gate type = %s", gate.GetType())
	}

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
	if oauthActions != 1 {
		t.Fatalf("AUTH_OAUTH alternatives = %d, want 1", oauthActions)
	}
}
