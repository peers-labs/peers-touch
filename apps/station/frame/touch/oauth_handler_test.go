package touch

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestOAuthRoutesAreRegisteredWithDistinctAuthentication(t *testing.T) {
	var login, connector *ActorHandlerInfo
	handlers := GetActorHandlers()
	for index := range handlers {
		switch handlers[index].RouterURL {
		case RouterURLOAuthLogin:
			login = &handlers[index]
		case RouterURLOAuthConnectorLink:
			connector = &handlers[index]
		}
	}

	if login == nil || login.Method != server.POST || len(login.Wrappers) != 1 {
		t.Fatalf("public signed OAuth bridge is not registered correctly: %#v", login)
	}
	if connector == nil || connector.Method != server.POST || len(connector.Wrappers) != 2 {
		t.Fatalf("authenticated OAuth connector route is not registered correctly: %#v", connector)
	}
}
