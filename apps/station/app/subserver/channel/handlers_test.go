package channel

import "testing"

func TestHandlersApplyConfiguredBasePath(t *testing.T) {
	t.Setenv("PEERS_AUTH_SECRET", "channel-handler-test-secret")

	subserver := &channelSubServer{
		opts: &Options{Path: "/sub-channel"},
	}
	handlers := subserver.Handlers()
	for _, handler := range handlers {
		if handler.Name() == "channel-binding-list" {
			if got, want := handler.Path(), "/sub-channel/channel/binding/list"; got != want {
				t.Fatalf("channel binding list path = %q, want %q", got, want)
			}
			return
		}
	}
	t.Fatal("channel binding list handler is missing")
}
