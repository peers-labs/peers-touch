package dashboard

import (
	"strings"
	"testing"
)

func TestPeersActorRoutesUsePTID(t *testing.T) {
	routes := []string{
		routeActorDetail,
		routeActorSessions,
		routeActorResetPassword,
		routeActorRevokeSession,
		routePeersRevokeSession,
	}

	for _, route := range routes {
		if !strings.Contains(route, ":ptid") {
			t.Errorf("route %q does not carry a PTID", route)
		}
		if strings.Contains(route, "/actors/:id") {
			t.Errorf("route %q retains the numeric actor ID boundary", route)
		}
	}
}
