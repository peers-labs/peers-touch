package command

import (
	"testing"

	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
)

func TestForwardableCommandKindIncludesMemberAuthority(t *testing.T) {
	if !forwardableCommandKind(domainevent.KindMemberAuthority) {
		t.Fatal("member-authority command is not admitted by SubmitForwarded")
	}
}
